import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PERIOD, RADIUS, STREET_X, STREET_Z, citySolids } from '../src/shared/city.js';
import { MAX_PEOPLE, MAX_VEHICLES, activity, busStops, buildStreetLife, canGo, canWalk, carOut, carProgress, crossRange, dodge, gapAhead, ghostCars, ghostPeds, hourAt, lightPhase, loopAt, loopLength, loopProgress, loopRoute, nextCrossing, pedAt, pedOut, ringAt, route, safeSpeed, stopForLight, trafficDensity, yieldsTo, type Road } from '../src/client/world/streetlife.js';

// The pure rules of the street life (lights, lanes, following, dodging) and a whole simulated minute of it, no WebGL.

test('the lights never give two ways a green, and a walk sign is only ever on the green way', () => {
  for (const at of [{ ix: 0, iz: 0 }, { ix: 3, iz: -2 }]) {
    const seen = new Set<string>();
    for (let t = 0; t < 120; t += 0.25) {
      const l = lightPhase(t, at);
      const other = l.green === 'x' ? 'z' : 'x';
      assert.equal(canGo(other, l), false);
      if (l.walk) assert.equal(l.stage, 'green');
      assert.equal(canWalk(other, l), false);
      seen.add(`${l.green}${l.stage}${l.walk}`);
    }
    assert.ok(seen.size >= 6, 'every stage comes round');
  }
  // Not every crossing changes at once.
  const greens = new Set<string>();
  for (let ix = 0; ix < 12; ix++) greens.add(lightPhase(5, { ix, iz: 0 }).green);
  assert.equal(greens.size, 2);
});

test('cars stop at a red, not once they are over the line, and can run an amber they cannot stop for', () => {
  const red = { green: 'z', stage: 'green', walk: true } as const;
  assert.equal(stopForLight(red, 'x', 10, 8), true);
  assert.equal(stopForLight(red, 'x', -2, 8), false);
  assert.equal(stopForLight(red, 'z', 10, 8), false);
  const amber = { green: 'x', stage: 'amber', walk: false } as const;
  assert.equal(stopForLight(amber, 'x', 20, 8), true);
  assert.equal(stopForLight(amber, 'x', 1, 12), false);
});

test('following distance leaves room to stop and never asks for more than the top speed', () => {
  assert.equal(safeSpeed(1, 0, 13), 0);
  assert.equal(safeSpeed(1000, 0, 13), 13);
  let last = 0;
  for (let gap = 3; gap < 60; gap += 3) {
    const v = safeSpeed(gap, 5, 13);
    assert.ok(v >= last);
    last = v;
  }
  // From that speed it can stop within what's left of the gap.
  const v = safeSpeed(20, 0, 13);
  assert.ok((v * v) / (2 * 7) <= 20 - 2.2);
});

test('a car ahead is one in your lane, not beside you or behind', () => {
  const me = { x: 0, z: 0, yaw: 0, len: 4.4, wid: 1.85 };
  const car = (x: number, z: number, yaw = 0) => ({ x, z, yaw, len: 4.4, wid: 1.85 });
  assert.ok(Math.abs(gapAhead(me, car(0, 10))! - 5.6) < 1e-9);
  assert.equal(gapAhead(me, car(4, 10)), null);
  assert.equal(gapAhead(me, car(0, -10)), null);
  assert.equal(gapAhead(me, car(0, 100)), null);
  // Across the way it takes up its width, not its length.
  assert.ok(Math.abs(gapAhead(me, car(0, 10, Math.PI / 2))! - (10 - 2.2 - 0.925)) < 1e-9);
});

test('giving way: queue behind, a left turn yields to oncoming, the lower number goes first at a crossing', () => {
  const me = { id: 5, yaw: 0, left: false, stuck: 0, inside: false };
  assert.equal(yieldsTo(me, { id: 9, yaw: 0, v: 5, left: false, inside: false }), true);
  assert.equal(yieldsTo(me, { id: 9, yaw: Math.PI, v: 5, left: false, inside: false }), false);
  assert.equal(yieldsTo({ ...me, left: true, inside: false }, { id: 9, yaw: Math.PI, v: 5, left: false, inside: false }), true);
  assert.equal(yieldsTo({ ...me, left: true, inside: false }, { id: 9, yaw: Math.PI, v: 5, left: true, inside: false }), false);
  assert.equal(yieldsTo({ ...me, left: true, inside: false }, { id: 2, yaw: Math.PI, v: 5, left: true, inside: false }), true);
  assert.equal(yieldsTo(me, { id: 2, yaw: Math.PI / 2, v: 5, left: false, inside: false }), true);
  assert.equal(yieldsTo(me, { id: 9, yaw: Math.PI / 2, v: 5, left: false, inside: false }), false);
  assert.equal(yieldsTo(me, { id: 2, yaw: Math.PI / 2, v: 0, left: false, inside: false }), false);
  // One already in the crossing goes first.
  assert.equal(yieldsTo(me, { id: 9, yaw: Math.PI / 2, v: 5, left: false, inside: true }), true);
  assert.equal(yieldsTo({ ...me, inside: true }, { id: 2, yaw: Math.PI / 2, v: 5, left: false, inside: false }), false);
  assert.equal(yieldsTo({ ...me, stuck: 11 }, { id: 2, yaw: Math.PI / 2, v: 5, left: false, inside: false }), false);
});

test('a car with the streets in front of it always has somewhere to go, and never off the edge of the city', () => {
  const [xlo, xhi] = crossRange(STREET_X);
  const [zlo, zhi] = crossRange(STREET_Z);
  for (const axis of ['x', 'z'] as const) {
    const [lo, hi] = axis === 'x' ? [xlo, xhi] : [zlo, zhi];
    const [llo, lhi] = axis === 'x' ? [zlo, zhi] : [xlo, xhi];
    for (const dir of [1, -1] as const) {
      for (let line = llo; line <= lhi; line++) {
        for (let k = lo; k <= hi; k++) {
          const r: Road = { axis, dir, line };
          // Only crossings it can still get to are ones ahead of it.
          if ((k - (dir > 0 ? lo : hi)) * dir < 0) continue;
          for (const u of [0, 0.5, 0.7, 0.9, 0.999]) {
            const { to } = route(r, k, u);
            const a = to.axis;
            const [alo, ahi] = a === 'x' ? [xlo, xhi] : [zlo, zhi];
            // The road it turns onto has a crossing ahead in the city.
            const from = to.axis === axis ? k : line;
            const next = from + to.dir;
            assert.ok(next >= alo && next <= ahi, `${axis}${dir} line ${line} k ${k} u ${u}`);
          }
        }
      }
    }
  }
  assert.equal(nextCrossing(STREET_X + 3, 1, STREET_X), 1);
  assert.equal(nextCrossing(STREET_X + 3, -1, STREET_X), 0);
  assert.equal(nextCrossing(STREET_X + PERIOD * 2, 1, STREET_X), 3);
  // Right-hand traffic: heading +x, turning right is heading +z.
  const right = route({ axis: 'x', dir: 1, line: 0 }, 0, 0.7);
  assert.deepEqual(right.to, { axis: 'z', dir: 1, line: 0 });
});

test('a person jumps clear of a car coming at them, not one going past or away', () => {
  const car = { x: 0, z: 0, vx: 0, vz: 10 };
  const d = dodge({ x: 0.5, z: 8 }, car)!;
  assert.ok(d && Math.abs(d.z) < 1e-9 && d.x > 0, 'to the side they are already on');
  assert.equal(dodge({ x: 0.5, z: -8 }, car), null);
  assert.equal(dodge({ x: 6, z: 8 }, car), null);
  assert.equal(dodge({ x: 0.5, z: 8 }, { ...car, vz: 1 }), null);
  assert.equal(dodge({ x: 0.5, z: 80 }, car), null);
});

test('a minute of street life: within budget, everything finite, no cars on top of each other, people get hit and get up', () => {
  const life = buildStreetLife();
  let meshes = 0;
  life.group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes++;
  });
  assert.ok(meshes <= 16, `${meshes} draw calls`);
  const near = { x: 0, z: STREET_Z };
  const carsAt = new Set<number>();
  let t = 1000;
  for (let i = 0; i < 60 * 30; i++) {
    t += 1 / 30;
    life.update(t, 1 / 30, 0.2, near, [{ x: near.x, z: near.z, vx: 0, vz: 0 }], 12.5);
    if (i % 30) continue;
    const on = life.vehicles.filter((v) => v.on);
    assert.ok(on.length <= MAX_VEHICLES && life.people.length <= MAX_PEOPLE);
    for (const v of on) {
      assert.ok(Number.isFinite(v.x) && Number.isFinite(v.z) && Number.isFinite(v.v) && Math.abs(v.x) < RADIUS + 20 && Math.abs(v.z) < RADIUS + 20);
      carsAt.add(v.id);
      assert.ok(Math.hypot(v.x - near.x, v.z - near.z) < 200, 'kept near you');
    }
    for (let a = 0; a < on.length; a++) for (let b = a + 1; b < on.length; b++) assert.ok(Math.hypot(on[a].x - on[b].x, on[a].z - on[b].z) > 1.2, `cars ${on[a].id} and ${on[b].id} overlap at t=${i}`);
    for (const p of life.people.filter((p) => p.on)) assert.ok(Number.isFinite(p.x + p.z + p.dx + p.dz));
  }
  assert.ok(carsAt.size > 20, 'the streets are busy');
  assert.ok(life.people.filter((p) => p.on).length > 40);
  // Something moving to bump into, and someone to knock over.
  const v = life.vehicles.find((v) => v.on)!;
  assert.ok(life.obstacles(v.x, v.z, 5).some((o) => o.box.minX <= v.x && o.box.maxX >= v.x));
  const p = life.people.find((p) => p.on && p.state !== 'down')!;
  assert.equal(life.hit({ x: p.x, z: p.z }, 8), 'person');
  assert.equal(p.state, 'down');
  for (let i = 0; i < 90; i++) life.update((t += 1 / 30), 1 / 30, 0, near, undefined, 12.5);
  assert.notEqual(p.state, 'down');
  assert.equal(p.tilt, 0);
});

test('the day has rush hours, a lunch, and a quiet night', () => {
  assert.ok(trafficDensity(8.2) > trafficDensity(3) * 3 && trafficDensity(17.6) > trafficDensity(14));
  assert.ok(trafficDensity(3) < 0.2 && trafficDensity(17.6) >= 0.95);
  assert.ok(activity('commuter', 8.2) > 0.9 && activity('commuter', 3) < 0.01);
  assert.ok(activity('lunch', 12.8) > 0.9 && activity('lunch', 8) < 0.1);
  assert.ok(activity('jogger', 7) > 0.9 && activity('jogger', 13) < 0.1);
  // How many are out: a crowd at lunch and on the way home, almost no one at 3 a.m.
  const out = (h: number) => ghostPeds().filter((g) => pedOut(g, h)).length;
  assert.ok(out(3) < 15 && out(12.8) > 120 && out(17.8) > 150);
  const cars = (h: number) => ghostCars().filter((g) => carOut(g, h)).length;
  assert.ok(cars(8.2) > 2 * cars(3));
  // A clock in another zone.
  assert.ok(Math.abs(hourAt(0, 330) - 5.5) < 1e-9 && Math.abs(hourAt(3600 * 23, 120) - 1) < 1e-9);
});

test('every car ghost goes round a loop of streets that is closed, continuous and the same for everyone', () => {
  const gs = ghostCars();
  assert.equal(gs.length, ghostCars().length);
  for (const g of gs.slice(0, 60)) {
    const P = loopLength(g.loop);
    // Turns at each corner go on to a road that is on the loop, and the loop comes back to where it began.
    let r = loopAt(g.loop, 1) as Road & { s: number };
    for (let i = 0; i < 4; i++) {
      const at = loopAt(g.loop, 1 + i * 0.25 * P);
      assert.ok(loopProgress(g.loop, at, at.s) !== null);
    }
    const there = loopRoute(g.loop, { axis: r.axis, dir: r.dir, line: r.line }, nextCrossing(r.s, r.dir, r.axis === 'x' ? STREET_X : STREET_Z));
    assert.ok(there);
    assert.deepEqual(loopAt(g.loop, P + 5), loopAt(g.loop, 5));
    assert.ok(carProgress(g, 1.7e9) >= 0 && carProgress(g, 1.7e9) < P);
    // Half a minute on, it has moved its speed.
    assert.ok(Math.abs(((carProgress(g, 1.7e9 + 30) - carProgress(g, 1.7e9) + P) % P) - g.speed * 30) < 1e-3 || g.speed * 30 > P);
  }
});

test('people walk a ring of sidewalk with no jumps, wait their turn at a crossing, and stop where the ghost stops', () => {
  const gs = ghostPeds();
  assert.equal(gs.length, ghostPeds().length);
  let withStops = 0;
  for (const g of gs) {
    const { ring } = g;
    let last = ringAt(ring, 0);
    for (let S = 0.5; S <= ring.P; S += 0.5) {
      const at = ringAt(ring, S);
      assert.ok(Math.hypot(at.x - last.x, at.z - last.z) < 0.52, `ghost ${g.j} jumps at ${S}`);
      last = at;
    }
    // Stops are in order, on a side, and not inside a street.
    let prev = -1;
    for (const s of g.stops) {
      assert.ok(s.off > prev && s.off < ring.P && s.dwell > 0);
      assert.ok(!ring.crossings.some((c) => s.off > c.o0 && s.off < c.o1), 'stopped in the road');
      prev = s.off;
    }
    if (g.stops.length) withStops++;
    // Time runs one way: however the day is cut up, they never go back.
    let R = -1;
    for (let t = 1.7e9; t < 1.7e9 + g.cycle * 2; t += 7) {
      const a = pedAt(g, t);
      assert.ok(a.R >= R - 1e-6, `ghost ${g.j} goes back`);
      R = a.R;
    }
  }
  assert.ok(withStops > gs.length * 0.7);
  const kinds = new Set(gs.flatMap((g) => g.stops.map((s) => s.kind)));
  for (const k of ['door', 'bench', 'look'] as const) assert.ok(kinds.has(k), `somebody goes to a ${k}`);
});

test('two pages that never spoke agree on the street: the same people in the same places, the same cars where they are near', () => {
  const run = (near: { x: number; z: number }, dt: number) => {
    const life = buildStreetLife();
    let t = 1.7e9;
    while (t < 1.7e9 + 150) {
      t += dt;
      life.update(t, dt, 0, near, [{ ...near, vx: 0, vz: 0 }], 12.5);
    }
    return life;
  };
  const a = run({ x: 14, z: 0 }, 1 / 30);
  const b = run({ x: 40, z: 40 }, 1 / 20);
  let people = 0;
  let together = 0;
  for (const p of a.people) {
    const q = b.people.find((q) => q.on && q.gj === p.gj && q.pairSide === p.pairSide);
    if (!p.on || !q || p.state === 'down') continue;
    people++;
    // (One held at a red light is a while behind the other, then hurries to catch up.)
    if (Math.hypot(p.x - q.x, p.z - q.z) < 3) together++;
  }
  assert.ok(people > 10 && together >= people * 0.75, `${together}/${people} people in the same place`);
  let shared = 0;
  let close = 0;
  for (const v of a.vehicles) {
    const w = b.vehicles.find((w) => w.on && w.gj === v.gj);
    if (!v.on || !w || Math.hypot(v.x - 14, v.z) > 90 || Math.hypot(w.x - 40, w.z - 40) > 90) continue;
    shared++;
    if (Math.hypot(v.x - w.x, v.z - w.z) < 12) close++;
  }
  assert.ok(shared >= 3 && close >= shared * 0.6, `${close}/${shared} cars agree`);
});

test('people go in at doors, sit on benches and stand about; at night hardly anyone is out', () => {
  const seen = new Set<string>();
  const life = buildStreetLife();
  let t = 1.7e9;
  for (let i = 0; i < 30 * 240; i++) {
    t += 1 / 30;
    life.update(t, 1 / 30, 0, { x: 14, z: 0 }, [{ x: 14, z: 0, vx: 0, vz: 0 }], 12.5);
    if (i % 15) continue;
    for (const p of life.people) if (p.on) seen.add(p.state + (p.state === 'door' && p.dr >= 1 ? ':inside' : ''));
  }
  for (const s of ['walk', 'cross', 'wait', 'sit', 'door:inside']) assert.ok(seen.has(s), `${s} never happened (${[...seen]})`);
  const night = buildStreetLife();
  t = 1.7e9;
  for (let i = 0; i < 30 * 30; i++) night.update((t += 1 / 30), 1 / 30, 1, { x: 14, z: 0 }, undefined, 3);
  assert.ok(night.people.filter((p) => p.on).length <= 6 && night.vehicles.filter((v) => v.on).length < 16);
});

test('a ghost looks the same on every page, whichever slot draws it; a slept tab starts its people over', () => {
  const run = (near: { x: number; z: number }, jump = 0) => {
    const life = buildStreetLife();
    let t = 1.7e9;
    for (let i = 0; i < 30 * 40; i++) life.update((t += 1 / 30), 1 / 30, 0, near, [{ ...near, vx: 0, vz: 0 }], 12.5);
    // A tab that slept for hours: the clock jumps.
    t += jump;
    for (let i = 0; i < 30 * 4; i++) life.update((t += 1 / 30), 1 / 30, 0, near, [{ ...near, vx: 0, vz: 0 }], 12.5);
    return { life, t };
  };
  const a = run({ x: 14, z: 0 }).life;
  const b = run({ x: 40, z: 40 }).life;
  let same = 0;
  for (const p of a.people) {
    const q = b.people.find((q) => q.on && p.on && q.gj === p.gj && q.pairSide === p.pairSide);
    if (!q) continue;
    same++;
    assert.deepEqual([p.skin, p.hair, p.shirt, p.pants, p.h], [q.skin, q.hair, q.shirt, q.pants, q.h]);
  }
  for (const v of a.vehicles) {
    const w = b.vehicles.find((w) => w.on && v.on && w.gj === v.gj);
    if (w) assert.equal(v.paint, w.paint);
  }
  assert.ok(same > 5);
  // Hours later every person is where their ghost is, not kilometres behind it.
  const { life, t } = run({ x: 14, z: 0 }, 6 * 3600);
  for (const p of life.people) {
    if (!p.on || p.pair >= 0 && p.id % 2) continue;
    const g = ghostPeds()[p.gj];
    assert.ok(Math.abs(pedAt(g, t).R - p.R) < 120, `person ${p.id} is ${Math.abs(pedAt(g, t).R - p.R)} m behind`);
  }
  for (const v of life.vehicles) if (v.on && v.gj >= 0) assert.ok(Math.hypot(v.x - 14, v.z) < 200);
});

test('bus shelters stand clear of hedges, benches, lamps and buildings', () => {
  const stops = busStops();
  assert.ok(stops.length > 5);
  for (const b of stops) {
    for (const lx of [-1.6, 0, 1.6]) {
      const x = b.x + lx * Math.cos(b.face) + -1.2 * Math.sin(b.face);
      const z = b.z - lx * Math.sin(b.face) + -1.2 * Math.cos(b.face);
      assert.ok(!citySolids(x, z, 0.05).some((a) => x >= a.minX && x <= a.maxX && z >= a.minZ && z <= a.maxZ), `shelter at ${b.x},${b.z} is in something`);
    }
  }
});
