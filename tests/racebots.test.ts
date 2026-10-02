import test from 'node:test';
import assert from 'node:assert/strict';
import { CIRCUIT_CARS, CIRCUIT_COURSE, circuitGround, gridPose, nearestProgress, pointAt, track } from '../src/shared/circuit.js';
import { DRIVE_STEP, advance, type CarPose, type Pedals } from '../src/shared/garage.js';
import { BOTS, BOT_ID, isBot } from '../src/shared/bots.js';
import { RACE } from '../src/shared/race.js';
import { RaceBot, seeded } from '../src/shared/racebot.js';
import { Garage } from '../src/server/garage.js';
import { RaceControl } from '../src/server/race.js';
import { RaceBots, askedBots, carBox } from '../src/server/racebots.js';

/** The circuit as the office has it, on a clock of its own: its cars, the race, and the bots. */
function circuit() {
  const clock = { now: 1_000_000 };
  const garage = new Garage(() => clock.now, CIRCUIT_CARS, circuitGround);
  const race = new RaceControl();
  const heard = { moved: 0, cars: 0, race: 0 };
  const bots = new RaceBots(race, garage, { moved: () => void heard.moved++, cars: () => void heard.cars++, race: () => void heard.race++ }, seeded(1));
  /** `id` gets behind the wheel of circuit car `car` and lines up, as the office has it (server.ts race.join). */
  const line = (id: string, car: number) => {
    assert.ok(garage.enter(id, car, 'driver'));
    bots.makeRoom(clock.now);
    const joined = race.join(id, id, car, clock.now);
    bots.sync(clock.now);
    return joined;
  };
  const botRacers = () => bots.state().racers.filter((r) => isBot(r.id));
  return { clock, garage, race, bots, heard, line, botRacers };
}

test('a race.bots ask is checked: a whole number of racers from 1 to the grid, at one of the levels', () => {
  assert.deepEqual(askedBots(4, 'hard'), { fill: 4, level: 'hard' });
  assert.deepEqual(askedBots(1, 'easy'), { fill: 1, level: 'easy' });
  assert.deepEqual(askedBots(RACE.slots, 'insane'), { fill: RACE.slots, level: 'insane' });
  for (const [fill, level] of [[0, 'normal'], [RACE.slots + 1, 'normal'], [2.5, 'normal'], ['4', 'normal'], [NaN, 'normal'], [undefined, 'normal'], [Infinity, 'normal'], [4, 'godlike'], [4, null], [4, undefined]]) {
    assert.equal(typeof askedBots(fill, level), 'string', `${String(fill)} at ${String(level)}`);
  }
});

test('lining up alone, bots top the grid up to the setting; it changes once a second at most; people take a bot’s place; they go when the people do', () => {
  const { clock, garage, race, bots, line, botRacers } = circuit();
  // Nobody lined up: no bots, but the setting's there for the lobby to show (4 at normal till someone says).
  assert.equal(bots.size, 0);
  assert.deepEqual(bots.state().bots, { fill: BOTS.fill, level: BOTS.level });
  assert.ok(line('ann', 0));
  let mine = botRacers();
  assert.equal(mine.length, BOTS.fill - 1);
  assert.equal(bots.state().racers.length, BOTS.fill);
  for (const r of mine) {
    assert.ok(r.id.startsWith(BOT_ID) && r.name.startsWith('🤖 '), r.name);
    assert.equal(r.bot, 'normal');
    assert.deepEqual(garage.seatOf(r.id), { car: r.car, seat: 'driver' });
  }
  assert.equal(new Set(bots.state().racers.map((r) => r.car)).size, BOTS.fill, 'a car each');
  // On the grid, each on its slot.
  clock.now += 200;
  bots.tick(clock.now);
  for (const r of mine) {
    const at = garage.state()[r.car], g = gridPose(r.slot);
    assert.ok(Math.hypot(at.x - g.x, at.z - g.z) < 0.5, `${r.name} on slot ${r.slot}`);
  }

  // Fewer, harder: straight away while lining up. Again within the second: no.
  assert.ok(bots.set(2, 'hard', 'Ann', clock.now));
  mine = botRacers();
  assert.deepEqual(mine.map((r) => r.bot), ['hard']);
  assert.deepEqual(bots.state().bots, { fill: 2, level: 'hard', by: 'Ann' });
  assert.equal(bots.set(3, 'easy', 'Ann', clock.now + BOTS.every - 1), false);
  // None: their cars back in their spots in the paddock, nobody in them.
  clock.now += BOTS.every;
  assert.ok(bots.set(1, 'hard', 'Ann', clock.now));
  assert.equal(botRacers().length, 0);
  assert.equal(bots.size, 0);
  for (const r of mine) {
    const c = garage.state()[r.car];
    assert.ok(!c.driver && c.x === CIRCUIT_CARS[r.car].x && c.z === CIRCUIT_CARS[r.car].z);
  }

  // A full grid: someone else lining up takes the last bot's place.
  clock.now += BOTS.every;
  assert.ok(bots.set(RACE.slots, 'easy', 'Ann', clock.now));
  assert.equal(bots.state().racers.length, RACE.slots);
  const free = CIRCUIT_CARS.findIndex((_, i) => !garage.state()[i].driver);
  assert.ok(line('ben', free), 'Ben gets on the grid');
  assert.equal(bots.state().racers.length, RACE.slots);
  assert.equal(botRacers().length, RACE.slots - 2);

  // Everyone gone: the bots go too, and the circuit's idle again.
  race.leave('ann', clock.now);
  race.leave('ben', clock.now);
  bots.sync(clock.now);
  assert.equal(bots.size, 0);
  assert.equal(bots.state().phase, 'idle');
  assert.ok(garage.state().every((c) => !c.driver || c.driver === 'ann' || c.driver === 'ben'));
});

test('a race of one person and bots: the same rules for everyone, it finishes, the order’s right, and the lap record is a person’s', () => {
  const { clock, garage, race, bots, line, botRacers } = circuit();
  assert.ok(line('ann', 0));
  assert.ok(bots.set(4, 'insane', 'Ann', clock.now));
  // Ann's driven the way her page does it: her own car on the shared physics among the others, telling the office where it's got to.
  const kind = CIRCUIT_CARS[0].kind;
  const slot = race.state().racers.find((r) => r.id === 'ann')!.slot;
  let ann: CarPose = { ...gridPose(slot), speed: 0, steer: 0, slip: 0, yaw: 0 };
  const hands = new RaceBot(kind, 'normal', ann, seeded(2));
  let pedals: Pedals = { gas: 0, turn: 0, brake: false, stop: true };
  assert.ok(race.start('ann', clock.now));
  let ticks = 0, worst = 0;
  const started = clock.now;
  while (race.state().phase !== 'finished' && clock.now - started < 420_000) {
    clock.now += 50;
    race.tick(clock.now);
    const t = performance.now();
    bots.tick(clock.now);
    worst = Math.max(worst, performance.now() - t);
    bots.sync(clock.now);
    const others = garage.state().flatMap((c, i) => (i === 0 ? [] : [carBox(CIRCUIT_CARS[i].kind, c)]));
    if (++ticks % 2 === 0) pedals = race.state().phase === 'racing' ? hands.decide(ann, others, 0.1) : { gas: 0, turn: 0, brake: false, stop: true };
    for (let s = 0; s < 6; s++) ann = advance(ann, pedals, DRIVE_STEP, kind, { ...CIRCUIT_COURSE, solids: others });
    if (race.offGrid('ann', ann.x, ann.z)) continue;
    const now = garage.drive('ann', 0, ann);
    if (now) race.drove('ann', now.x, now.z, clock.now, { name: 'ann', car: 0 });
  }
  const r = bots.state();
  assert.equal(r.phase, 'finished');
  assert.equal(botRacers().length, 3);
  // Positions 1 to n: those home first in the order they got there, then the rest by how far round.
  assert.deepEqual(r.racers.map((x) => x.position).sort((a, b) => a - b), [1, 2, 3, 4]);
  const order = [...r.racers].sort((a, b) => a.position - b.position);
  const home = order.filter((x) => x.finishedAt !== undefined);
  assert.ok(home.length >= 3, `${home.length} home`);
  assert.ok(home.every((x, i) => x.lap === RACE.laps && (i === 0 || x.finishedAt! >= home[i - 1].finishedAt!)));
  assert.ok(order.slice(home.length).every((x) => x.finishedAt === undefined));
  // Insane bots lap quicker than Ann at normal, but the record is hers: a bot's lap is only its own best.
  assert.equal(r.record?.name, 'ann');
  assert.ok(botRacers().some((x) => x.bestLap! < r.record!.ms));
  // They raced clean: hardly a touch, never put back.
  const inside = (bots as unknown as { bots: Map<string, { hits: number; resets: number }> }).bots;
  for (const b of inside.values()) assert.ok(b.hits <= 2 && b.resets === 0, JSON.stringify(b));
  assert.ok(worst < 250, `the bots' slowest tick: ${worst.toFixed(1)} ms`);
});

test('a rabbit to chase on practice laps: one each, off ahead of you, never on the record, home when you stop', () => {
  const { clock, garage, race, bots } = circuit();
  assert.ok(garage.enter('ann', 0, 'driver'));
  const p = pointAt(400);
  garage.drive('ann', 0, { x: p.x, z: p.z, rotY: Math.atan2(p.tx, p.tz), speed: 20, steer: 0 });
  assert.match(bots.rabbit('cat', 'hard', clock.now)!, /behind the wheel/);
  assert.equal(bots.rabbit('ann', 'hard', clock.now), undefined);
  assert.match(bots.rabbit('ann', 'easy', clock.now + 10)!, /a second/);
  const rabbit = () => race.state().practice.find((x) => x.rabbitOf === 'ann');
  assert.equal(rabbit()?.bot, 'hard');
  assert.equal(bots.state().racers.length, 0, 'not in a race');
  const at = (id: string) => {
    const c = garage.state()[garage.seatOf(id)!.car];
    return nearestProgress(c.x, c.z).s;
  };
  const from = at(rabbit()!.id);
  assert.ok(from - 400 > 20 && from - 400 < 60, `just ahead of Ann: ${(from - 400).toFixed(0)} m`);
  for (let t = 0; t < 5000; t += 50) {
    clock.now += 50;
    bots.tick(clock.now);
  }
  const gone = (at(rabbit()!.id) - from + track().length) % track().length;
  assert.ok(gone > 100, `off round the track: ${gone.toFixed(0)} m in 5 s`);
  assert.equal(race.state().practiceRecord, undefined);
  // Ann gets out: it goes home, and its car's back in the paddock.
  const car = garage.seatOf(rabbit()!.id)!.car;
  garage.leave('ann');
  bots.sync(clock.now);
  assert.equal(rabbit(), undefined);
  assert.equal(bots.size, 0);
  assert.equal(garage.state()[car].x, CIRCUIT_CARS[car].x);
});
