import test from 'node:test';
import assert from 'node:assert/strict';
import { CENTER, CHECKPOINTS, CIRCUIT_CARS, CIRCUIT_GATE, CITY_GATE, PADDOCK, TRACK, checkpoint, circuitGround, crossed, gridPose, inGate, nearestProgress, onTrack, pointAt, surfaceAt, track } from '../src/shared/circuit.js';
import { RACE_PLAZA, cityPaved, citySolids } from '../src/shared/city.js';
import { RACE } from '../src/shared/race.js';
import { RaceControl } from '../src/server/race.js';
import { Garage } from '../src/server/garage.js';

const BAND = TRACK.width / 2 + TRACK.runoff;

test('the circuit is a closed loop of a proper length, never running into itself', () => {
  const { points, length } = track();
  assert.ok(length > 1200 && length < 1800, `about a lap: ${length.toFixed(0)} m`);
  const first = points[0], last = points[points.length - 1];
  assert.ok(Math.hypot(first.x - last.x, first.z - last.z) < 3, 'the last point comes round to the first');
  // Parts of the track a good way apart round the lap are never within two run-offs of each other.
  for (let i = 0; i < points.length; i += 3) {
    for (let j = i + 1; j < points.length; j += 3) {
      const apart = Math.min(Math.abs(points[i].s - points[j].s), length - Math.abs(points[i].s - points[j].s));
      if (apart < 150) continue;
      assert.ok(Math.hypot(points[i].x - points[j].x, points[i].z - points[j].z) > 2 * BAND, `s ${points[i].s.toFixed(0)} and ${points[j].s.toFixed(0)}`);
    }
  }
  // The start line is on the main straight, heading east past the paddock.
  const line = pointAt(0);
  assert.ok(Math.abs(line.tx - 1) < 0.01 && Math.abs(line.z - CENTER.z) < 0.5);
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
function driveOn(race: RaceControl, id: string, from: number, metres: number, now: { t: number }, lateral = 0) {
  for (let s = from; s <= from + metres; s += 2) {
    const p = pointAt(s);
    now.t += 100;
    race.drove(id, p.x + p.tz * lateral, p.z - p.tx * lateral, now.t);
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
