import test from 'node:test';
import assert from 'node:assert/strict';
import { CIRCUIT_CARS, CIRCUIT_COURSE, TRACK, gridPose, nearestProgress, pointAt, track } from '../src/shared/circuit.js';
import { DRIVE_STEP, advance, tankFill, type Box, type CarKind, type CarPose, type Pedals } from '../src/shared/garage.js';
import { BOT_LEVELS, type BotLevel } from '../src/shared/bots.js';
import { RaceBot, nearestLine, racingLine, seeded, speedPlan } from '../src/shared/racebot.js';
import { RaceControl } from '../src/server/race.js';
import { carBox } from '../src/server/racebots.js';

/**
 * What a bot's first timed practice lap takes (s: from just behind the start line, so close to a
 * standing start), each car of the circuit's at each level, as measured (the average over seeds 1 to
 * 12; any one is within about 1.5% of it). A flying lap's a second or two quicker. Change the physics
 * or the bot and these move: measure again (the test says what it got) and put the new ones here.
 */
const LAPS: Record<string, Record<BotLevel, number>> = {
  lambo: { easy: 110.9, normal: 98.5, hard: 92.9, insane: 89.0 },
  ferrari: { easy: 110.9, normal: 98.5, hard: 92.6, insane: 88.5 },
  motorbike: { easy: 121.5, normal: 106.8, hard: 100.6, insane: 96.0 },
  'sedan-sports': { easy: 116.5, normal: 102.7, hard: 96.6, insane: 92.5 },
  race: { easy: 101.7, normal: 91.0, hard: 85.5, insane: 82.1 },
  'race-future': { easy: 100.1, normal: 89.6, hard: 84.2, insane: 80.9 },
};
/** The seeds the lap test drives: two that once put a bot on the grass (insane makes no mistakes: every seed's the same lap). */
const SEEDS = [6, 12];

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

test('a bot laps in every one of the circuit cars at every level, whatever its seed: in its time, on the asphalt, and the office counts it', () => {
  const got: Record<string, Record<string, number[]>> = {};
  for (const kind of new Set(CIRCUIT_CARS.map((c) => c.kind))) {
    got[kind] = {};
    for (const seed of SEEDS) {
      let slower = Infinity;
      for (const level of BOT_LEVELS) {
        const r = level === 'insane' && seed !== SEEDS[0] ? { lap: got[kind].insane[0], wide: 0 } : drive(kind, level, { seed });
        (got[kind][level] ??= []).push(+r.lap.toFixed(1));
        // Counted by the same race control as a person's lap: driven round, through every checkpoint, no cut.
        assert.ok(Number.isFinite(r.lap), `${kind} ${level} seed ${seed}: no lap counted`);
        const want = LAPS[kind]?.[level];
        assert.ok(want && Math.abs(r.lap - want) <= want * 0.03, `${kind} ${level} seed ${seed}: ${r.lap.toFixed(1)} s, expected about ${want} (all measured: ${JSON.stringify(got)})`);
        // Its mistakes are small ones: onto the kerb at worst, never the grass.
        assert.ok(r.wide <= ASPHALT, `${kind} ${level} seed ${seed}: on the grass (${r.wide.toFixed(1)} m off the centre line)`);
        // Each level quicker than the one before.
        assert.ok(r.lap < slower, `${kind} ${level} seed ${seed} is quicker than the level below`);
        slower = r.lap;
      }
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

/**
 * A bot in `kind` at `level` coming up 240 m behind a slower lambo, a person being caught or lapped,
 * driven round at `frac` of the lambo's planned speed (at most 40 m/s), on the racing line or `lat` m
 * off the centre line (from `from` m round), as fast as a person really can round every bend. How many
 * times it touched that car (each time they came together), and whether it got 20 m past it in `secs`.
 */
function chase(kind: CarKind, level: BotLevel, { frac, from, follows, lat = 0, seed = 1, secs = 60 }: { frac: number; from: number; follows: 'line' | 'centre'; lat?: number; seed?: number; secs?: number }) {
  const line = racingLine(), n = line.length, L = track().length;
  const lam = speedPlan('lambo');
  // The slower car: `s` m round the centre line, or at the racing line's point `i` and `past` m on from it.
  let s = from, i = nearestLine(pointAt(from).x, pointAt(from).z), past = 0;
  const where = () => {
    if (follows === 'centre') {
      const c = pointAt(s);
      return { x: c.x + c.tz * lat, z: c.z - c.tx * lat, rotY: Math.atan2(c.tx, c.tz) };
    }
    const q = line[i];
    return { x: q.x + q.tx * past, z: q.z + q.tz * past, rotY: Math.atan2(q.tx, q.tz) };
  };
  const on = (by: number) => {
    s += by;
    for (past += by; past >= line[i].ds; i = (i + 1) % n) past -= line[i].ds;
  };
  const start = pointAt(from - 240);
  let p: CarPose = { x: start.x, z: start.z, rotY: Math.atan2(start.tx, start.tz), speed: 25, steer: 0, slip: 0, yaw: 0 };
  const bot = new RaceBot(kind, level, p, seeded(seed));
  let pedals: Pedals = { gas: 0, turn: 0, brake: false };
  let hits = 0, touching = false, by = false;
  for (let k = 0; k * DRIVE_STEP < secs; k++) {
    const at = where();
    const v = Math.min(40, frac * lam.v[nearestLine(at.x, at.z, i)]);
    const them = [carBox('lambo', { ...at, speed: v, steer: 0, slip: 0 })];
    if (k % 12 === 0) pedals = bot.decide(p, them, 0.1);
    let touch = false;
    p = advance(p, pedals, DRIVE_STEP, kind, { ...CIRCUIT_COURSE, solids: them, bumped: (_, __, vehicle) => void (touch ||= vehicle) });
    bot.refuel(DRIVE_STEP, tankFill(p, kind, them).rate);
    if (touch && !touching) hits++;
    touching = touch;
    on(v * DRIVE_STEP);
    by ||= ((nearestProgress(p.x, p.z).s - nearestProgress(at.x, at.z).s + 1.5 * L) % L) - L / 2 > 20;
  }
  return { hits, by };
}

test('a bot catches and gets by a slower car going round (on the racing line, or keeping to its side of the track), hardly touching it', () => {
  for (const [kind, level, o] of [
    // Into a bend alongside: it used to try to hold the inside as the car ahead turned in.
    ['lambo', 'normal', { frac: 0.8, from: 2200, follows: 'line', seed: 2, secs: 90 }],
    ['race', 'hard', { frac: 0.8, from: 2200, follows: 'line' }],
    ['race-future', 'insane', { frac: 0.65, from: 1000, follows: 'line' }],
    ['lambo', 'insane', { frac: 0.8, from: 600, follows: 'centre' }],
    ['race-future', 'insane', { frac: 0.65, from: 2600, follows: 'centre', lat: 3 }],
    ['sedan-sports', 'normal', { frac: 0.65, from: 1800, follows: 'centre', lat: 3 }],
  ] as [CarKind, BotLevel, Parameters<typeof chase>[2]][]) {
    const r = chase(kind, level, o);
    assert.ok(r.hits <= 1, `${kind} ${level} ${JSON.stringify(o)}: touched it ${r.hits} times`);
    assert.ok(r.by, `${kind} ${level} ${JSON.stringify(o)}: never got by`);
  }
});

test('a bot drives the same way every time from the same seed, and another way from another', () => {
  const a = drive('lambo', 'easy', { secs: 20 }).p, b = drive('lambo', 'easy', { secs: 20 }).p, c = drive('lambo', 'easy', { secs: 20, seed: 8 }).p;
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});
