import test from 'node:test';
import assert from 'node:assert/strict';
import { CIRCUIT_CARS, CIRCUIT_COURSE, TRACK, gridPose, nearestProgress, track } from '../src/shared/circuit.js';
import { DRIVE_STEP, advance, tankFill, type Box, type CarKind, type CarPose, type Pedals } from '../src/shared/garage.js';
import { BOT_LEVELS, type BotLevel } from '../src/shared/bots.js';
import { RaceBot, racingLine, seeded, speedPlan } from '../src/shared/racebot.js';
import { RaceControl } from '../src/server/race.js';
import { carBox } from '../src/server/racebots.js';

/**
 * What a bot's first timed practice lap takes (s: from just behind the start line, so close to a
 * standing start; seed 7), each car of the circuit's at each level, as measured. A flying lap's a
 * second or two quicker. Change the physics or the bot and these move: measure again (the test says
 * what it got) and put the new ones here.
 */
const LAPS: Record<string, Record<BotLevel, number>> = {
  lambo: { easy: 110.3, normal: 98.7, hard: 92.7, insane: 88.6 },
  ferrari: { easy: 110.5, normal: 98.5, hard: 92.5, insane: 88.5 },
  motorbike: { easy: 121.2, normal: 106.5, hard: 100.8, insane: 96.1 },
  'sedan-sports': { easy: 116.8, normal: 103.0, hard: 96.7, insane: 92.5 },
  race: { easy: 102.0, normal: 90.7, hard: 85.1, insane: 81.5 },
  'race-future': { easy: 100.4, normal: 89.5, hard: 83.8, insane: 80.3 },
};

/** The asphalt and its kerbs, either side of the centre line (m): past it is the grass. */
const ASPHALT = TRACK.width / 2 + TRACK.curb;

/**
 * One bot in `kind` at `level` from grid slot 0, on the circuit's physics (as the office runs a bot's
 * car), among `parked` cars, its car reported to the office's race control twenty times a second as
 * someone on practice laps, until it's done a lap (or `secs` run out). The lap as the office timed it
 * (s, Infinity if none), how far it ever got off the centre line (m), how many times it touched a car,
 * and where it ended up.
 */
function drive(kind: CarKind, level: BotLevel, { parked = [] as Box[], seed = 7, secs = 200 } = {}) {
  const car = CIRCUIT_CARS.findIndex((c) => c.kind === kind);
  const race = new RaceControl();
  let p: CarPose = { ...gridPose(0), speed: 0, steer: 0, slip: 0, yaw: 0 };
  const bot = new RaceBot(kind, level, p, seeded(seed));
  let pedals: Pedals = { gas: 0, turn: 0, brake: false };
  let wide = 0, hits = 0, touching = false;
  const t0 = 1_000_000;
  for (let k = 0; k * DRIVE_STEP < secs; k++) {
    if (k % 12 === 0) pedals = bot.decide(p, parked, 0.1);
    let touch = false;
    p = advance(p, pedals, DRIVE_STEP, kind, { ...CIRCUIT_COURSE, solids: parked, bumped: (_, __, vehicle) => void (touch ||= vehicle) });
    if (touch && !touching) hits++;
    touching = touch;
    bot.refuel(DRIVE_STEP, tankFill(p, kind, parked).rate);
    wide = Math.max(wide, Math.abs(nearestProgress(p.x, p.z).d));
    if (k % 6 === 0) {
      race.drove('bot', p.x, p.z, t0 + k * DRIVE_STEP * 1000, { name: 'bot', car });
      const me = race.state().practice[0];
      if (me?.laps) return { lap: me.lastLap! / 1000, wide, hits, p };
    }
  }
  return { lap: Infinity, wide, hits, p };
}

test('the racing line bends least, on the asphalt everywhere, and plans a sensible lap in each car', () => {
  const line = racingLine();
  assert.equal(line.length, track().points.length);
  assert.ok(line.every((q) => Math.abs(q.d) <= TRACK.width / 2 - 1), 'a car on it is never over the edge');
  const length = line.reduce((a, q) => a + q.ds, 0);
  assert.ok(length < track().length, `shorter than the centre line: ${length.toFixed(0)} m`);
  // Out wide into a corner, in to the apex: somewhere it's right over on each side.
  assert.ok(Math.min(...line.map((q) => q.d)) < -5 && Math.max(...line.map((q) => q.d)) > 5);
  // The race cars are the quickest, the motorbike the slowest of the circuit's cars.
  const lap = (k: CarKind) => speedPlan(k).lap;
  assert.ok(lap('race-future') < lap('race') && lap('race') < lap('lambo') && lap('lambo') < lap('sedan-sports') && lap('sedan-sports') < lap('motorbike'));
});

test('a bot laps in every one of the circuit cars at every level: in its time, on the asphalt, and the office counts it', () => {
  const got: Record<string, Record<string, number>> = {};
  for (const kind of new Set(CIRCUIT_CARS.map((c) => c.kind))) {
    got[kind] = {};
    let slower = Infinity;
    for (const level of BOT_LEVELS) {
      const r = drive(kind, level);
      got[kind][level] = +r.lap.toFixed(1);
      // Counted by the same race control as a person's lap: driven round, through every checkpoint, no cut.
      assert.ok(Number.isFinite(r.lap), `${kind} ${level}: no lap counted`);
      const want = LAPS[kind]?.[level];
      assert.ok(want && Math.abs(r.lap - want) <= want * 0.03, `${kind} ${level}: ${r.lap.toFixed(1)} s, expected about ${want} (all measured: ${JSON.stringify(got)})`);
      assert.ok(r.wide <= ASPHALT, `${kind} ${level}: on the grass (${r.wide.toFixed(1)} m off the centre line)`);
      // Each level quicker than the one before.
      assert.ok(r.lap < slower, `${kind} ${level} is quicker than the level below`);
      slower = r.lap;
    }
  }
});

test('a bot goes round a car stopped on its line, flat out on a straight and in a slow corner, without touching it', () => {
  const line = racingLine();
  for (const [kind, level] of [['lambo', 'normal'], ['race-future', 'insane'], ['motorbike', 'easy']] as [CarKind, BotLevel][]) {
    const plan = speedPlan(kind);
    // Its fastest point and its slowest corner, past the first bend.
    let fast = 200, slow = 200;
    for (let i = 200; i < line.length - 50; i++) {
      if (plan.v[i] > plan.v[fast]) fast = i;
      if (plan.v[i] < plan.v[slow]) slow = i;
    }
    const parked = [fast, slow].map((i) => carBox('lambo', { x: line[i].x, z: line[i].z, rotY: Math.atan2(line[i].tx, line[i].tz), speed: 0, steer: 0 }));
    const r = drive(kind, level, { parked });
    assert.equal(r.hits, 0, `${kind} ${level} touched a stopped car`);
    assert.ok(r.lap < LAPS[kind][level] + 6, `${kind} ${level}: round them in ${r.lap.toFixed(1)} s`);
    assert.ok(r.wide <= TRACK.width / 2 + TRACK.runoff, 'inside the tyre walls');
  }
});

test('a bot drives the same way every time from the same seed, and another way from another', () => {
  const a = drive('lambo', 'easy', { secs: 20 }).p, b = drive('lambo', 'easy', { secs: 20 }).p, c = drive('lambo', 'easy', { secs: 20, seed: 8 }).p;
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});
