import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PERIOD, RADIUS, STREET_X, STREET_Z } from '../src/shared/city.js';
import { MAX_PEOPLE, MAX_VEHICLES, buildStreetLife, canGo, canWalk, crossRange, dodge, gapAhead, lightPhase, nextCrossing, route, safeSpeed, stopForLight, yieldsTo, type Road } from '../src/client/world/streetlife.js';

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
  assert.ok(meshes <= 15, `${meshes} draw calls`);
  const near = { x: 0, z: STREET_Z };
  const carsAt = new Set<number>();
  let t = 1000;
  for (let i = 0; i < 60 * 30; i++) {
    t += 1 / 30;
    life.update(t, 1 / 30, 0.2, near, [{ x: near.x, z: near.z, vx: 0, vz: 0 }]);
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
  for (let i = 0; i < 90; i++) life.update((t += 1 / 30), 1 / 30, 0, near);
  assert.notEqual(p.state, 'down');
  assert.equal(p.tilt, 0);
});
