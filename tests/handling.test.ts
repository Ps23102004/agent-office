import test from 'node:test';
import assert from 'node:assert/strict';
import { DRIVE_STEP, SPECS, advance, drive, type Box, type CarKind, type CarPose, type Pedals } from '../src/shared/garage.js';

// How the cars handle, measured the way a driver feels it: scripted inputs through the shared physics
// (shared/garage.ts), the same at every frame rate, so each target here is a number that can't drift
// without someone noticing. An arcade grip/drift hybrid: crisp at speed, safe to lift or brake in a
// corner, drifted on purpose with the handbrake, and never stuck on a barrier.

const H = DRIVE_STEP;
const deg = (r: number) => (r * 180) / Math.PI;
const start = (speed = 0): CarPose => ({ x: 0, z: 0, rotY: 0, speed, steer: 0, slip: 0, yaw: 0 });
/** The gas to hold `v0`. */
const hold = (v0: number, p: CarPose) => Math.max(-1, Math.min(1, (v0 - p.speed) * 2));
/** How far it's sliding (degrees): + with its tail out to the right, as in a left-hand drift. */
const slide = (p: CarPose) => deg(Math.atan2(-(p.slip ?? 0), Math.max(0.1, p.speed)));

function run(p: CarPose, seconds: number, pedals: (p: CarPose, t: number) => Pedals, kind: CarKind = 'lambo', each?: (p: CarPose, t: number) => void): CarPose {
  for (let t = 0; t < seconds - 1e-9; t += H) {
    p = drive(p, pedals(p, t), H, kind);
    each?.(p, t + H);
  }
  return p;
}

/** Full lock at `v0` (speed held), settled. */
const cornering = (v0: number, kind: CarKind = 'lambo') => run(start(v0), 4, (p) => ({ gas: hold(v0, p), turn: 1, brake: false }), kind);

/** A step of full lock at `v0`: how soon it's turning (63% of the way), how far past it overshoots, and how soon it stops turning once let go. */
function stepSteer(v0: number, kind: CarKind = 'lambo') {
  const yaws: number[] = [];
  let p = run(start(v0), 3, (q) => ({ gas: hold(v0, q), turn: 1, brake: false }), kind, (q) => yaws.push(q.yaw!));
  const steady = yaws.slice(-30).reduce((a, b) => a + b, 0) / 30;
  const t63 = (yaws.findIndex((y) => y >= 0.63 * steady) + 1) * H;
  const overshoot = Math.max(...yaws) / steady - 1;
  let released = Infinity;
  p = run(p, 3, (q) => ({ gas: hold(v0, q), turn: 0, brake: false }), kind, (q, t) => {
    if (released === Infinity && Math.abs(q.yaw!) <= 0.1 * steady) released = t;
  });
  return { t63, overshoot, released, steady };
}

test('quick off the line, hard on the brakes, and a gentle lift at top speed', () => {
  let t = 0;
  for (let p = start(); p.speed < 100 / 3.6; t += H) p = drive(p, { gas: 1, turn: 0, brake: false }, H);
  assert.ok(t < 3.3, `0-100 km/h in ${t.toFixed(2)} s`);
  let p = start(100 / 3.6);
  while (p.speed > 0) p = drive(p, { gas: -1, turn: 0, brake: false }, H);
  assert.ok(p.z < 22, `100-0 km/h in ${p.z.toFixed(1)} m`);
  const top = SPECS.lambo.top - 0.5;
  const lift = (top - drive(start(top), { gas: 0, turn: 0, brake: false }, H).speed) / H;
  assert.ok(lift <= 4, `lifting at top speed slows it ${lift.toFixed(2)} m/s² (it used to be 9)`);
});

test('the wheel bites at once at speed, without overshoot, and lets go when you do', () => {
  for (const v of [30, 45, 60]) {
    const s = stepSteer(v);
    assert.ok(s.t63 >= 0.12 && s.t63 <= 0.25, `${v} m/s: turning in ${(s.t63 * 1000).toFixed(0)} ms`);
    assert.ok(s.overshoot <= 0.1, `${v} m/s: ${(s.overshoot * 100).toFixed(1)}% overshoot`);
    assert.ok(s.released <= 0.6, `${v} m/s: straight again ${(s.released * 1000).toFixed(0)} ms after letting go`);
  }
  const future = stepSteer(80, 'race-future');
  assert.ok(future.t63 <= 0.3, `a race car at 80 m/s turns in ${(future.t63 * 1000).toFixed(0)} ms`);
  assert.ok(stepSteer(30, 'suv').t63 <= 0.3, 'an SUV too');
});

test('full lock holds the road: a grip corner past 1 g, hardly sliding', () => {
  const p = cornering(40);
  assert.ok(Math.abs(slide(p)) <= 4.5, `sliding ${slide(p).toFixed(1)}°`);
  assert.ok((Math.abs(p.yaw!) * p.speed) / 9.81 >= 1, `${((p.yaw! * p.speed) / 9.81).toFixed(2)} g`);
  // On the boost at 85 m/s a race car still turns (the boost doesn't spin its wheels, and the air holds it down).
  let most = 0;
  const boosted = run(start(85), 2, () => ({ gas: 1, turn: 1, brake: false, boost: true }), 'race-future', (q) => (most = Math.max(most, Math.abs(slide(q)))));
  assert.ok((Math.abs(boosted.yaw!) * boosted.speed) / 9.81 >= 1, `boosting, ${((boosted.yaw! * boosted.speed) / 9.81).toFixed(2)} g`);
  assert.ok(most < 10, `and no spin (${most.toFixed(1)}°)`);
});

test('lifting off or braking hard mid-corner never spins it', () => {
  for (const v of [50, 62]) {
    let most = 0;
    run(cornering(v), 2, () => ({ gas: 0, turn: 1, brake: false }), 'lambo', (q) => (most = Math.max(most, Math.abs(slide(q)))));
    assert.ok(most <= 12, `lifting at ${v} m/s: ${most.toFixed(1)}° at most`);
  }
  for (const v of [25, 45]) {
    let yaw = 0, most = 0;
    run(cornering(v), 1.5, () => ({ gas: -1, turn: 1, brake: false }), 'lambo', (q) => {
      yaw = Math.max(yaw, Math.abs(q.yaw!));
      if (q.speed > 5) most = Math.max(most, Math.abs(slide(q)));
    });
    assert.ok(yaw <= 1 && most <= 10, `braking at ${v} m/s: ${yaw.toFixed(2)} rad/s, ${most.toFixed(1)}° at most`);
  }
});

/** A tug on the handbrake into a left-hander at `v0`, then the gas and the wheel held into it; then the wheel let go. */
function drift(v0: number, kind: CarKind = 'lambo', tug = 0.3, held = 3) {
  let inBand = 0, most = 0;
  let p = run(start(v0), tug + held, (_q, t) => ({ gas: t < tug ? 0 : 1, turn: 1, brake: t < tug }), kind, (q, t) => {
    most = Math.max(most, slide(q));
    if (t > tug && slide(q) >= 15 && slide(q) <= 50 && q.speed >= 10) inBand += H;
  });
  const kept = p.speed / v0;
  let out = Infinity, swing = 0;
  p = run(p, 3, () => ({ gas: 1, turn: 0, brake: false }), kind, (q, t) => {
    swing = Math.min(swing, slide(q));
    if (out === Infinity && Math.abs(slide(q)) < 5 && Math.abs(q.yaw!) < 0.3) out = t;
  });
  return { inBand, most, kept, out, swing };
}

test('a tug on the handbrake starts a drift you hold on the gas and the wheel, and it straightens when you let go', () => {
  for (const [kind, v] of [['lambo', 30], ['lambo', 45], ['race', 30], ['suv', 25]] as const) {
    const d = drift(v, kind);
    assert.ok(d.inBand >= 2.5, `${kind} at ${v} m/s: drifting ${d.inBand.toFixed(2)} s of 3`);
    assert.ok(d.most <= 45, `${kind}: no further round than ${d.most.toFixed(1)}°`);
    assert.ok(d.kept >= 0.6, `${kind}: ${(d.kept * 100).toFixed(0)}% of its speed kept`);
    assert.ok(d.out <= 1, `${kind}: straight ${d.out.toFixed(2)} s after letting go of the wheel`);
    assert.ok(d.swing >= -10, `${kind}: swinging ${(-d.swing).toFixed(1)}° the other way at most`);
  }
  // Playing it on the keys, eight taps a second (into the turn, or the wheel let go): it holds.
  let best = 0;
  for (const target of [20, 25, 30]) {
    let ped: Pedals = { gas: 0, turn: 1, brake: true }, next = 0, good = 0;
    run(start(30), 5, (q, t) => {
      if (t < 0.3) return ped;
      if (t >= next) {
        next = t + 1 / 8;
        ped = { gas: 1, turn: slide(q) > target + 3 ? 0 : 1, brake: false };
      }
      return ped;
    }, 'lambo', (q, t) => {
      if (t > 0.3 && slide(q) >= 15 && slide(q) <= 45 && q.speed >= 12) good += H;
    });
    best = Math.max(best, good);
  }
  assert.ok(best >= 3.5, `held ${best.toFixed(2)} s of 5 on the keys`);
});

test('the handbrake alone swings the tail without stopping the car, and a spin ends without a jolt', () => {
  const v0 = 30;
  let p = run(start(v0), 0.4, () => ({ gas: 0, turn: 1, brake: true }));
  assert.ok(p.speed / v0 >= 0.85, `${((p.speed / v0) * 100).toFixed(0)}% kept through a 0.4 s tug`);
  // Held on with full lock it spins round, and slows smoothly: no 22 g stop as it comes round.
  let prev = v0, jolt = 0;
  p = run(start(v0), 3, () => ({ gas: 0, turn: 1, brake: true }), 'lambo', (q) => {
    const v = Math.hypot(q.speed, q.slip ?? 0);
    jolt = Math.max(jolt, (prev - v) / H / 9.81);
    prev = v;
  });
  assert.ok(jolt <= 2.5, `at most ${jolt.toFixed(2)} g`);
});

/** Along a barrier at z = 0 (the ground is z < 0, or a wall: `solid`), angled `angle`° into it at `v` m/s, gas down, for 3 s. */
function graze(angle: number, v: number, solid: boolean) {
  const course = solid ? { solids: [{ minX: -1e3, maxX: 1e3, minZ: 0, maxZ: 2 }] as Box[] } : { solids: [], ground: (_x: number, z: number) => z < 0 };
  let p: CarPose = { ...start(v), z: -2.5, rotY: Math.PI / 2 - (angle * Math.PI) / 180 };
  let stuck = 0, yaw = 0, hits = 0, kept = NaN;
  for (let t = H; t <= 3; t += H) {
    const was = p;
    p = advance(p, { gas: 1, turn: 0, brake: false }, H, 'lambo', { ...course, surfaceAt: () => 'road', bumped: () => hits++ });
    if (hits) yaw = Math.max(yaw, Math.abs(p.yaw!));
    if (Math.hypot(p.speed, p.slip ?? 0) > 5 && Math.hypot(p.x - was.x, p.z - was.z) < 1e-4) stuck++;
    if (Math.abs(t - 1) < H / 2) kept = Math.hypot(p.speed, p.slip ?? 0) / v;
  }
  return { stuck, yaw, hits, kept, heading: deg(p.rotY) - 90 };
}

test('grazing a barrier or a wall it glances off and runs on along it: never pinned, never spun', () => {
  for (const solid of [false, true]) {
    for (const angle of [2, 5, 10, 20, 35]) {
      for (const v of [30, 50, 70]) {
        const g = graze(angle, v, solid);
        const what = `${solid ? 'wall' : 'barrier'} at ${angle}°, ${v} m/s`;
        assert.ok(g.hits > 0, `${what}: touched`);
        assert.equal(g.stuck, 0, `${what}: never stuck in place`);
        assert.ok(g.kept >= (angle > 20 ? 0.7 : 0.85), `${what}: ${(g.kept * 100).toFixed(0)}% of its speed after 1 s`);
        assert.ok(g.yaw <= (angle > 20 ? 2.5 : 1.5), `${what}: turned at most ${g.yaw.toFixed(2)} rad/s`);
        assert.ok(Math.abs(g.heading) < 3, `${what}: running along it (${g.heading.toFixed(1)}°)`);
      }
    }
  }
});

test('a parked car is a wall that bounces you back, and a pole off-centre turns you but no more than that', () => {
  const parked: Box = { minX: 37.7, maxX: 42.3, minZ: -1, maxZ: 1, rotY: Math.PI / 2, hx: 1, hz: 2.3, mass: SPECS.lambo.mass, vx: 0, vz: 0 };
  let p: CarPose = { ...start(28.7), x: 30, rotY: Math.PI / 2 };
  for (let t = 0; t < 1; t += H) p = advance(p, { gas: 0, turn: 0, brake: false }, H, 'lambo', { solids: [parked], surfaceAt: () => 'road' });
  assert.ok(p.speed < -4, `bounced back off it at ${p.speed.toFixed(1)} m/s (it used to stop you dead)`);
  const pole: Box = { minX: 39.85, maxX: 40.15, minZ: 0.45, maxZ: 0.75 };
  let yaw = 0;
  p = { ...start(25), x: 30, rotY: Math.PI / 2 };
  for (let t = 0; t < 1.5; t += H) {
    p = advance(p, { gas: 0, turn: 0, brake: false }, H, 'lambo', { solids: [pole], surfaceAt: () => 'road' });
    yaw = Math.max(yaw, Math.abs(p.yaw!));
  }
  assert.ok(yaw > 0.3 && yaw <= 1.5, `a pole at 25 m/s, 0.6 m off-centre: ${yaw.toFixed(2)} rad/s (it used to be 5)`);
});
