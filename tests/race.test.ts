import test from 'node:test';
import assert from 'node:assert/strict';
import { CENTER, CHECKPOINTS, CIRCUIT_CARS, CIRCUIT_GATE, CITY_GATE, PADDOCK, TRACK, checkpoint, circuitGround, crossed, gridPose, inGate, nearestProgress, onTrack, pointAt, pastLine, resetSpots, surfaceAt, track, GRASS_TOP } from '../src/shared/circuit.js';
import { RACE_PLAZA, cityPaved, citySolids } from '../src/shared/city.js';
import { RACE } from '../src/shared/race.js';
import { RaceControl } from '../src/server/race.js';
import { Garage } from '../src/server/garage.js';

const BAND = TRACK.width / 2 + TRACK.runoff;

test('the circuit is a closed loop of a proper length, never running into itself', () => {
  const { points, length, corners } = track();
  assert.ok(length > 3000 && length < 3600, `about a lap: ${length.toFixed(0)} m`);
  const first = points[0], last = points[points.length - 1];
  assert.ok(Math.hypot(first.x - last.x, first.z - last.z) < 3, 'the last point comes round to the first');
  // Wherever two parts of the track come close enough for their grass to meet (so you could drive
  // across from one to the other), it's never much of a short cut: the way round between them is at
  // most a few times as far as straight across (the tightest is the hairpin's legs). Everywhere else
  // they're far enough apart for one's barrier to stay off the other's grass.
  for (let i = 0; i < points.length; i += 2) {
    for (let j = i + 2; j < points.length; j += 2) {
      const along = Math.min(points[j].s - points[i].s, length - (points[j].s - points[i].s));
      const across = Math.hypot(points[i].x - points[j].x, points[i].z - points[j].z);
      if (across > 2 * BAND + 4) continue;
      assert.ok(along < 3.5 * across, `s ${points[i].s.toFixed(0)} and ${points[j].s.toFixed(0)}: ${along.toFixed(0)} m round, ${across.toFixed(0)} m across`);
    }
  }
  // Nor does the centre line cross itself anywhere.
  const n = points.length;
  const side = (a: { x: number; z: number }, b: { x: number; z: number }, c: { x: number; z: number }) => Math.sign((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x));
  for (let i = 0; i < n; i++) {
    const a = points[i], b = points[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if ((j + 1) % n === i) continue;
      const c = points[j], d = points[(j + 1) % n];
      assert.ok(!(side(a, b, c) !== side(a, b, d) && side(c, d, a) !== side(c, d, b)), `crosses at s ${a.s.toFixed(0)} and ${c.s.toFixed(0)}`);
    }
  }
  // A proper lap: hairpins and slow corners to brake for, fast sweepers, and a long straight to the first corner.
  assert.ok(corners.some((c) => Math.abs(c.turn) >= 150 && c.r < 20), 'a hairpin');
  assert.ok(corners.filter((c) => c.brake).length >= 3);
  assert.ok(corners.some((c) => c.r >= 100));
  assert.ok(corners[0].s0 >= 400, 'a long run down to Turn 1');
  // About one checkpoint every hundred metres.
  assert.ok(length / CHECKPOINTS > 80 && length / CHECKPOINTS < 130);
  // The start line is on the main straight, heading east past the paddock.
  const line = pointAt(0);
  assert.ok(Math.abs(line.tx - 1) < 0.01 && Math.abs(line.z - CENTER.z) < 0.5);
});

test('the barriers stand clear of the track all round the outside of every corner and along the straights', () => {
  const RAIL = BAND + 1;
  const clear = (x: number, z: number) => Math.abs(nearestProgress(x, z).d) > RAIL - 0.5;
  const { points, corners } = track();
  let blocked = 0;
  for (const p of points) {
    for (const side of [-1, 1]) {
      const x = p.x + p.tz * RAIL * side, z = p.z - p.tx * RAIL * side;
      if (clear(x, z)) continue;
      blocked++;
      // Only ever round the inside of a tight corner, near it.
      const c = corners.find((c) => p.s > c.s0 - 80 && p.s < c.s1 + 80 && c.r < 2 * RAIL && (c.turn > 0 ? -1 : 1) === side);
      assert.ok(c, `a barrier on the track's grass at s ${p.s.toFixed(0)}, side ${side}`);
    }
  }
  assert.ok(blocked < points.length * 0.1);
});

test('a car put back on the track: just past its last checkpoint or behind it, on the asphalt, facing the way round', () => {
  for (const k of [-1, 0, 5, CHECKPOINTS - 1]) {
    const spots = resetSpots({ checkpoint: k });
    assert.ok(spots.length >= 6);
    const first = nearestProgress(spots[0].x, spots[0].z);
    const line = k < 0 ? track().length - 10 : (k * track().length) / CHECKPOINTS;
    assert.ok(Math.abs(first.d) < 0.3, 'the first on the centre line');
    assert.ok(Math.abs(first.s - line) < 12 || Math.abs(first.s - line) > track().length - 12);
    for (const r of spots) {
      const at = nearestProgress(r.x, r.z);
      assert.ok(Math.abs(at.d) < TRACK.width / 2 - 1);
      assert.ok(pastLine(k, r.x, r.z) <= pastLine(k, spots[0].x, spots[0].z) + 0.5, 'none further round than the first');
      const p = pointAt(at.s);
      assert.ok(Math.sin(r.rotY) * p.tx + Math.cos(r.rotY) * p.tz > 0.99);
    }
  }
  // Racing, before the first line after the start: your own slot on the grid, and behind it.
  const back = resetSpots({ checkpoint: 0, lap: 0, slot: 7 });
  assert.ok(Math.hypot(back[0].x - gridPose(7).x, back[0].z - gridPose(7).z) < 0.01);
  assert.ok(back.every((r) => pastLine(0, r.x, r.z) <= pastLine(0, gridPose(7).x, gridPose(7).z) + 0.5));
});

test('the grass is slower than any corner, and there\'s no boost on it', async () => {
  const { drive, SPECS } = await import('../src/shared/garage.js');
  // Round the tightest corner at a modest 1.2 g is still quicker than the grass lets you go.
  const tightest = Math.min(...track().corners.map((c) => c.r));
  assert.ok(GRASS_TOP < Math.sqrt(12 * tightest));
  const flat = { x: 0, z: 0, rotY: 0, speed: SPECS.race.top * 0.6, steer: 0, slip: 0 };
  const on = (boost: boolean) => drive(flat, { gas: 1, turn: 0, brake: false, boost }, 1, 'race', 'grass').speed;
  assert.equal(on(true), on(false));
});

test('where you are on the track: how far round, how far off it, and what it is underfoot', () => {
  const p = pointAt(400);
  const left = { x: p.x + p.tz * 3, z: p.z - p.tx * 3 };
  const at = nearestProgress(left.x, left.z);
  assert.ok(Math.abs(at.s - 400) < 1.5);
  assert.ok(Math.abs(at.d - 3) < 0.2, 'three metres to the left');
  assert.ok(onTrack(left.x, left.z));
  const grass = { x: p.x - p.tz * (TRACK.width / 2 + 8), z: p.z + p.tx * (TRACK.width / 2 + 8) };
  assert.equal(surfaceAt(grass.x, grass.z), 'grass');
  assert.ok(circuitGround(grass.x, grass.z));
  const beyond = { x: p.x - p.tz * (BAND + 3), z: p.z + p.tx * (BAND + 3) };
  assert.equal(circuitGround(beyond.x, beyond.z), false, 'past the barriers');
  assert.equal(surfaceAt((PADDOCK.minX + PADDOCK.maxX) / 2, (PADDOCK.minZ + PADDOCK.maxZ) / 2), 'paddock');
  for (const c of CIRCUIT_CARS) assert.ok(circuitGround(c.x, c.z) && circuitGround(c.x, c.z + 2.5), `${c.name} is parked where it can drive off`);
  assert.ok(circuitGround(CIRCUIT_GATE.out.x, CIRCUIT_GATE.out.z));
});

test('looking only near the track, where you are comes out just as it does checking every point', () => {
  const { points, length } = track();
  const every = (x: number, z: number) => {
    let best = 0;
    for (let i = 1; i < points.length; i++) if ((points[i].x - x) ** 2 + (points[i].z - z) ** 2 < (points[best].x - x) ** 2 + (points[best].z - z) ** 2) best = i;
    const p = points[best];
    const along = (x - p.x) * p.tx + (z - p.z) * p.tz;
    const q = pointAt(p.s + along);
    return { s: q.s, d: (x - q.x) * q.tz - (z - q.z) * q.tx };
  };
  const xs = points.map((p) => p.x), zs = points.map((p) => p.z);
  const [x0, x1, z0, z1] = [Math.min(...xs) - 80, Math.max(...xs) + 80, Math.min(...zs) - 80, Math.max(...zs) + 80];
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < 4000; k++) {
    // Anywhere round the track and well out past it, and (half of them) close by it.
    const by = k % 2 ? pointAt(rand() * length) : null;
    const x = by ? by.x + (rand() - 0.5) * 70 : x0 + rand() * (x1 - x0);
    const z = by ? by.z + (rand() - 0.5) * 70 : z0 + rand() * (z1 - z0);
    assert.deepEqual(nearestProgress(x, z), every(x, z), `at (${x.toFixed(1)}, ${z.toFixed(1)})`);
  }
});

test('the grid: eight slots behind the line, two by two, on the asphalt, facing the lights', () => {
  const seen = new Set<string>();
  for (let slot = 0; slot < RACE.slots; slot++) {
    const g = gridPose(slot);
    const at = nearestProgress(g.x, g.z);
    assert.ok(at.s > track().length - 80, `behind the line: ${at.s.toFixed(0)}`);
    assert.ok(Math.abs(at.d) < TRACK.width / 2 - 1.5, 'on the asphalt, with room');
    assert.ok(Math.abs(Math.sin(g.rotY) - 1) < 0.02, 'facing along the straight');
    seen.add(`${g.x.toFixed(1)},${g.z.toFixed(1)}`);
  }
  assert.equal(seen.size, RACE.slots);
});

test('a checkpoint counts going through it the right way, and only near the track', () => {
  const c = checkpoint(3);
  const p = pointAt((3 * track().length) / CHECKPOINTS);
  const before = { x: c.x - p.tx * 2, z: c.z - p.tz * 2 };
  const after = { x: c.x + p.tx * 2, z: c.z + p.tz * 2 };
  assert.ok(crossed(3, before, after));
  assert.equal(crossed(3, after, before), false, 'backwards');
  const far = { x: p.tz * 200, z: -p.tx * 200 };
  assert.equal(crossed(3, { x: before.x + far.x, z: before.z + far.z }, { x: after.x + far.x, z: after.z + far.z }), false, 'nowhere near it');
});

test('the city gate is on an open, paved plaza off the street', () => {
  const g = CITY_GATE;
  assert.ok(g.x > RACE_PLAZA.minX && g.x < RACE_PLAZA.maxX && g.z > RACE_PLAZA.minZ && g.z < RACE_PLAZA.maxZ);
  for (const [x, z] of [[g.x, g.z], [g.out.x, g.out.z], [g.x, RACE_PLAZA.maxZ + 3]]) assert.ok(cityPaved(x, z), `${x}, ${z}`);
  assert.deepEqual(citySolids(g.x, g.z, 12), [], 'no building or tree in the way');
  assert.ok(inGate(g, g.x, g.z) && !inGate(g, g.out.x, g.out.z), 'you come out clear of it');
  assert.ok(inGate(CIRCUIT_GATE, CIRCUIT_GATE.x, CIRCUIT_GATE.z) && !inGate(CIRCUIT_GATE, CIRCUIT_GATE.out.x, CIRCUIT_GATE.out.z));
});

test('the circuit cars go where the circuit says, not the city', () => {
  const garage = new Garage(() => 0, CIRCUIT_CARS, circuitGround);
  assert.ok(garage.enter('a', 0, 'driver'));
  const g = gridPose(0);
  assert.ok(garage.drive('a', 0, { ...g, speed: 5, steer: 0 }));
  assert.equal(garage.drive('a', 0, { x: 0, z: 27, rotY: 0, speed: 5, steer: 0 }), undefined, 'the city street is nowhere near the circuit');
});

/** Drives `id` from where they are round the track, `metres` on, reporting every couple of metres. */
function driveOn(race: RaceControl, id: string, from: number, metres: number, now: { t: number }, lateral = 0, who?: { name: string; car: number }) {
  for (let s = from; s <= from + metres; s += 2) {
    const p = pointAt(s);
    now.t += 100;
    race.drove(id, p.x + p.tz * lateral, p.z - p.tx * lateral, now.t, who);
  }
}

test('a race: lining up, the countdown, laps through every checkpoint in order, positions, and the finish', () => {
  const race = new RaceControl();
  const now = { t: 1_000_000 };
  assert.ok(race.join('a', 'Ada', 0, now.t));
  assert.equal(race.state().phase, 'lobby');
  assert.ok(race.join('b', 'Bo', 1, now.t));
  assert.equal(race.join('c', 'Cy', 1, now.t), false, 'someone is in that car already');
  assert.equal(race.start('nobody', now.t), false);
  assert.ok(race.start('a', now.t));
  assert.equal(race.state().phase, 'countdown');
  const L = track().length;
  // On the grid before the lights go out.
  race.drove('a', gridPose(0).x, gridPose(0).z, now.t);
  race.drove('b', gridPose(1).x, gridPose(1).z, now.t);
  now.t += RACE.countdown * 1000;
  assert.ok(race.tick(now.t));
  let r = race.state();
  assert.equal(r.phase, 'racing');
  assert.ok(r.racers.every((x) => x.lap === 0 && x.checkpoint === 0 && x.lapStartedAt === r.startsAt));

  // A cheat: straight from the grid to halfway round counts nothing.
  race.drove('b', pointAt(L / 2).x, pointAt(L / 2).z, now.t + 50);
  assert.equal(race.state().racers.find((x) => x.id === 'b')!.checkpoint, 0);

  // Ada drives one lap and a bit; she leads.
  driveOn(race, 'a', -7, L + 30, now);
  r = race.state();
  const ada = r.racers.find((x) => x.id === 'a')!;
  assert.equal(ada.lap, 1);
  assert.equal(ada.checkpoint, 0);
  assert.ok(ada.bestLap! > 0);
  assert.equal(ada.position, 1);
  assert.deepEqual(r.record, { name: 'Ada', ms: ada.bestLap });

  // She finishes: laps done, and the race waits a while for Bo.
  driveOn(race, 'a', 30, L * (RACE.laps - 1), now);
  r = race.state();
  assert.equal(r.racers.find((x) => x.id === 'a')!.lap, RACE.laps);
  assert.ok(r.racers.find((x) => x.id === 'a')!.finishedAt);
  assert.equal(r.phase, 'racing');
  assert.ok(r.firstHomeAt);
  // Bo gives up: with everyone left home, it's over.
  assert.ok(race.leave('b', now.t));
  assert.equal(race.state().phase, 'finished');
  now.t += RACE.results * 1000 + 1;
  assert.ok(race.tick(now.t));
  r = race.state();
  assert.equal(r.phase, 'idle');
  assert.deepEqual(r.racers, []);
  assert.equal(r.record?.name, 'Ada', 'the lap record stays');
});

test('the stragglers get a while after the winner, then it ends without them', () => {
  const race = new RaceControl();
  const now = { t: 0 };
  race.join('a', 'Ada', 0, now.t);
  race.join('b', 'Bo', 1, now.t);
  race.start('a', now.t);
  race.drove('a', gridPose(0).x, gridPose(0).z, now.t);
  now.t += RACE.countdown * 1000;
  race.tick(now.t);
  driveOn(race, 'a', -7, track().length * RACE.laps + 10, now);
  assert.equal(race.state().phase, 'racing');
  now.t += RACE.grace * 1000;
  assert.ok(race.tick(now.t));
  assert.equal(race.state().phase, 'finished');
  // Lining up for the next one clears the results.
  assert.ok(race.join('b', 'Bo', 2, now.t));
  assert.equal(race.state().phase, 'lobby');
  assert.equal(race.state().racers.length, 1);
});

test('going round the wrong way, or skipping a checkpoint, never makes a lap', () => {
  const race = new RaceControl();
  const now = { t: 0 };
  race.join('a', 'Ada', 0, now.t);
  race.start('a', now.t);
  race.drove('a', gridPose(0).x, gridPose(0).z, now.t);
  now.t += RACE.countdown * 1000;
  race.tick(now.t);
  const L = track().length;
  // Backwards round the whole lap.
  for (let s = -7; s > -7 - L - 20; s -= 2) {
    const p = pointAt(s);
    now.t += 100;
    race.drove('a', p.x, p.z, now.t);
  }
  assert.equal(race.state().racers[0].lap, 0);
  assert.equal(race.state().racers[0].checkpoint, 0);
});

/** A race of `ids` from the grid, the lights out at `now.t`. */
function started(ids: string[], now: { t: number }): RaceControl {
  const race = new RaceControl();
  ids.forEach((id, i) => race.join(id, id.toUpperCase(), i, now.t));
  race.start(ids[0], now.t);
  now.t += RACE.countdown * 1000;
  race.tick(now.t);
  return race;
}

test('teleporting up to each line and stepping over it counts nothing, and sets no record', () => {
  const now = { t: 1_000_000 };
  const race = started(['a'], now);
  const L = track().length;
  for (let lap = 0; lap < RACE.laps; lap++) {
    for (let k = 1; k <= CHECKPOINTS; k++) {
      const s = ((k % CHECKPOINTS) * L) / CHECKPOINTS;
      for (const p of [pointAt(s - 1), pointAt(s + 1)]) {
        now.t += 16;
        race.drove('a', p.x, p.z, now.t);
      }
    }
  }
  const r = race.state();
  assert.equal(r.racers[0].lap, 0);
  assert.equal(r.record, undefined);
  // Even sitting a while by each line before stepping over (the office then takes the car to be there), nothing counts.
  for (let k = 1; k <= 3; k++) {
    const s = (k * L) / CHECKPOINTS;
    const b = pointAt(s - 1), a = pointAt(s + 1);
    now.t += 16;
    race.drove('a', b.x, b.z, now.t);
    now.t += 4000;
    race.drove('a', b.x, b.z, now.t);
    now.t += 100;
    race.drove('a', a.x, a.z, now.t);
  }
  assert.equal(race.state().racers[0].checkpoint, 0);
});

test('someone who never drives off can’t keep the circuit forever', () => {
  const now = { t: 0 };
  const race = started(['a', 'b'], now);
  now.t += 3 * 60_000 + 1;
  assert.ok(race.tick(now.t));
  assert.equal(race.state().phase, 'finished');
  // Crawling round, checkpoint by checkpoint, it still ends in the end.
  const slow = started(['a'], { t: 0 });
  let t = 0;
  const cap = RACE.laps * 5 * 60_000;
  for (let s = -7; t < cap - 1000; s += 1) {
    const p = pointAt(s);
    t += 1000;
    slow.drove('a', p.x, p.z, t);
  }
  assert.equal(slow.state().phase, 'racing', 'still going, a line every couple of minutes');
  assert.ok(slow.state().racers[0].checkpoint > 0);
  assert.ok(slow.tick(RACE.countdown * 1000 + cap + 1), 'the lights went out that long ago');
  assert.equal(slow.state().phase, 'finished');
});

test('the finishers stay in the results when they get out or go home', () => {
  const now = { t: 0 };
  const race = started(['a', 'b'], now);
  driveOn(race, 'a', -7, track().length * RACE.laps + 10, now);
  assert.equal(race.leave('a', now.t), false, 'Ada is home: she stays in');
  assert.ok(race.leave('b', now.t));
  let r = race.state();
  assert.equal(r.phase, 'finished');
  assert.deepEqual(r.racers.map((x) => [x.name, x.position]), [['A', 1]]);
  race.leave('a', now.t);
  assert.equal(race.state().phase, 'finished', 'the results stay up');
  now.t += RACE.results * 1000 + 1;
  race.tick(now.t);
  r = race.state();
  assert.equal(r.phase, 'idle');
});

test('counting down, a car stays on its slot; starting from anywhere else counts for nothing', () => {
  const race = new RaceControl();
  race.join('a', 'Ada', 0, 0);
  race.start('a', 0);
  const g = gridPose(0);
  assert.equal(race.offGrid('a', g.x + 1, g.z), false);
  assert.ok(race.offGrid('a', g.x + 10, g.z));
  assert.equal(race.offGrid('nobody', g.x + 10, g.z), false);
  race.tick(RACE.countdown * 1000);
  assert.equal(race.offGrid('a', g.x + 10, g.z), false, 'once it’s on, it’s racing');
  // Over the first line from somewhere up the road: too far from the grid to have driven it.
  const s = track().length / CHECKPOINTS;
  const b = pointAt(s - 1), a = pointAt(s + 1);
  race.drove('a', b.x, b.z, RACE.countdown * 1000 + 100);
  race.drove('a', a.x, a.z, RACE.countdown * 1000 + 200);
  assert.equal(race.state().racers[0].checkpoint, 0);
});

test('put back on the track at the last checkpoint, a racer carries on from there; anywhere else is still a jump', () => {
  const now = { t: 0 };
  const race = started(['a'], now);
  race.drove('a', gridPose(0).x, gridPose(0).z, now.t);
  const L = track().length;
  // Through three lines, then off into the grass a long way on and back to the third.
  driveOn(race, 'a', -7, (3 * L) / CHECKPOINTS + 20, now);
  assert.equal(race.state().racers[0].checkpoint, 3);
  const r = resetSpots({ checkpoint: 3 })[0];
  now.t += 100;
  race.drove('a', r.x, r.z, now.t);
  driveOn(race, 'a', (3 * L) / CHECKPOINTS + 4, L / CHECKPOINTS, now);
  assert.equal(race.state().racers[0].checkpoint, 4, 'the next line counts straight away');
  // Hopping to the next checkpoint's reset spot instead is a jump: nothing counts from there for a while.
  const ahead = resetSpots({ checkpoint: 6 })[0];
  now.t += 100;
  race.drove('a', ahead.x, ahead.z, now.t);
  driveOn(race, 'a', (6 * L) / CHECKPOINTS + 4, 30, now);
  assert.equal(race.state().racers[0].checkpoint, 4);
});

test('a reset is never further round than the line the car was last credited with', () => {
  const now = { t: 0 };
  const race = started(['a'], now);
  race.drove('a', gridPose(0).x, gridPose(0).z, now.t);
  const L = track().length;
  driveOn(race, 'a', -7, (3 * L) / CHECKPOINTS + 10, now);
  assert.equal(race.state().racers[0].checkpoint, 3);
  // Spun and off the wrong way a long way: put back just past line 3, which it already has, so it gains nothing and is taken.
  for (let s = (3 * L) / CHECKPOINTS + 10; s > (3 * L) / CHECKPOINTS - 100; s -= 2) race.drove('a', pointAt(s).x, pointAt(s).z, (now.t += 100));
  const r = resetSpots({ checkpoint: 3 })[0];
  race.drove('a', r.x, r.z, (now.t += 100));
  for (let s = (3 * L) / CHECKPOINTS + 4; s < (4 * L) / CHECKPOINTS + 10; s += 2) race.drove('a', pointAt(s).x, pointAt(s).z, (now.t += 50));
  assert.equal(race.state().racers[0].checkpoint, 4, 'driving on from the reset counts');
  // But not the reset spot of a line it hasn't reached: that's a jump, and the next line doesn't count for a while.
  const ahead = resetSpots({ checkpoint: 7 })[0];
  race.drove('a', ahead.x, ahead.z, (now.t += 100));
  for (let s = (7 * L) / CHECKPOINTS + 4; s < (8 * L) / CHECKPOINTS + 10; s += 2) race.drove('a', pointAt(s).x, pointAt(s).z, (now.t += 50));
  assert.equal(race.state().racers[0].checkpoint, 4);
});

test('cutting across the grass to the next line counts nothing', () => {
  const L = track().length;
  const gap = L / CHECKPOINTS;
  const who = { name: 'Cutter', car: 4 };
  let cuts = 0;
  for (let k = 1; k < CHECKPOINTS - 1; k++) {
    for (const side of [-1, 1]) {
      // Over line k out on the grass (still within its reach), then straight across the grass to line k + 1,
      // over it on the same side: tried only where that's a lot shorter than the way round.
      const p = pointAt(k * gap), line = pointAt((k + 1) * gap);
      const at = (q: typeof p, along: number, d: number) => ({ x: q.x + q.tx * along + q.tz * d, z: q.z + q.tz * along - q.tx * d });
      const over = at(p, 2, 25 * side), next = at(line, -2, 25 * side);
      if (Math.hypot(next.x - over.x, next.z - over.z) > 0.6 * gap) continue;
      cuts++;
      const race = new RaceControl();
      const now = { t: 0 };
      driveOn(race, 'p', -20, k * gap - 10, now, 0, who);
      const go = (to: { x: number; z: number }) => {
        const from = race['last'].get('p')!;
        const n = Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / 2);
        for (let i = 1; i <= n; i++) race.drove('p', from.x + ((to.x - from.x) * i) / n, from.z + ((to.z - from.z) * i) / n, (now.t += 100), who);
      };
      go(at(p, -2, 25 * side));
      go(over);
      assert.equal(race.state().practice[0].checkpoint, k, `over line ${k} on the grass`);
      go(next);
      go(at(line, 2, 25 * side));
      assert.equal(race.state().practice[0].checkpoint, k, `across to line ${k + 1}`);
    }
  }
  assert.ok(cuts > 0, 'somewhere (the carousel) could be cut');
});
