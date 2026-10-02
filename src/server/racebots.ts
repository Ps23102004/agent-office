import { BOTS, BOT_ID, BOT_LEVELS, BOT_NAMES, isBot, isBotLevel, type BotLevel, type BotSettings } from '../shared/bots.js';
import { CHECKPOINTS, CIRCUIT_CARS, CIRCUIT_COURSE, circuitGround, gridPose, nearestProgress, pastLine, pointAt, resetSpots, surfaceAt, track } from '../shared/circuit.js';
import { DRIVE_STEP, NEAR_MISS_EVERY, SPECS, TANK, advance, carFits, tankFill, type Box, type CarKind, type CarPose, type CarState, type Pedals } from '../shared/garage.js';
import { Marshal, RACE, type RaceState, type Timing } from '../shared/race.js';
import { RACE_SKILL, RaceBot, nearestLine, racingLine, seeded, speedPlan } from '../shared/racebot.js';
import type { Garage } from './garage.js';
import type { RaceControl } from './race.js';

// The office's own racers at the circuit (shared/racebot.ts drives one), so someone on their own still
// gets a race. Lining up, bots top the grid up to the setting's `fill` (people included); in the race,
// each is a racer like anyone (Racer.bot), its laps counted by the same RaceControl through the same
// checks, its car one of the circuit's, driven through the same physics a person's page runs and
// passed on to everyone there as a person's is (car.move), so their pages draw it the same way. A bot's
// lap never goes on the record. Out on practice laps, a bot can be a rabbit for someone to chase.
//
// The office runs them on `tick`, every 50 ms while there are any: the physics in DRIVE_STEP steps,
// each bot deciding what to press every other tick (ten times a second, half of them each tick), and
// where its car's got to out to everyone every tick.

/** Of its level's pace, the least a bot well ahead of every person in the race eases off to (see ease). */
const EASE = 0.97;
/** How far ahead of the leading person (m) a bot starts easing off, and where it's eased off all it will. */
const EASE_FROM = 50;
const EASE_TO = 300;
/** Of its pace, how a bot drives once it's home (a lap of honour, out of the others' way). */
const COOL = 0.6;
/**
 * Going nowhere round the track for this long (s) on a lap, a bot's put back on it as the marshal
 * would (the same spots): circling on the grass, or pinned against a tyre wall with its foot down,
 * which a person steers out of but the marshal, going by the speedo, doesn't see. GOT: metres round
 * the track that count as getting somewhere.
 */
const LOST = 6;
const GOT = 15;
/** At most this many rabbits out at once, one each. */
const RABBITS = 2;
/** How far ahead of you a rabbit sets off (m round the track). */
const RABBIT_AHEAD = 30;

/**
 * A `race.bots` ask as it came (from anyone, so anything at all): the setting it asks for, or what's
 * wrong with it. `fill` a whole number of racers from 1 (no bots) to RACE.slots, at one of BOT_LEVELS.
 */
export function askedBots(fill: unknown, level: unknown): { fill: number; level: BotLevel } | string {
  if (typeof fill !== 'number' || !Number.isInteger(fill) || fill < 1 || fill > RACE.slots || !isBotLevel(level)) return `Bots: 1 to ${RACE.slots} racers in all, at ${BOT_LEVELS.join(', ')}`;
  return { fill, level };
}

/** One of the office's racers. */
interface Bot {
  id: string;
  name: string;
  car: number;
  kind: CarKind;
  driver: RaceBot;
  pose: CarPose;
  pedals: Pedals;
  marshal: Marshal;
  /** The physics clock (s), for spacing out near misses as a page does. */
  clock: number;
  nearMissAt: number;
  /** When its foot goes down after the lights (ms), once they've gone out. */
  go?: number;
  /** A rabbit: who it's out for. */
  rabbitOf?: string;
  /** How many times it's run into another car (at 2 m/s or more), and been put back on the track. */
  hits: number;
  resets: number;
  /** Where everyone last saw it (x,z,rotY). */
  seen?: string;
  /** How far round the track it last got somewhere (m), and when (s of its physics clock): see LOST. */
  mark: { s: number; at: number };
}

/** What the office passes on for the bots. */
export interface RaceBotsIO {
  /** A bot's car has got to `pose` (and is or isn't on the boost): everyone at the circuit sees it there. */
  moved(car: number, pose: CarPose, boost: boolean): void;
  /** Bots got into or out of the circuit's cars. */
  cars(): void;
  /** The race changed: a bot lined up or left, or went through a checkpoint. */
  race(): void;
}

/** A car as something to bump into: turned, with its mass and how it's going (as a page has another car: client/world/cars.ts solids). */
export function carBox(kind: CarKind, p: CarPose): Box {
  const hx = SPECS[kind].width / 2, hz = SPECS[kind].length / 2;
  const s = Math.abs(Math.sin(p.rotY)), c = Math.abs(Math.cos(p.rotY));
  const ex = c * hx + s * hz, ez = s * hx + c * hz;
  return {
    minX: p.x - ex, maxX: p.x + ex, minZ: p.z - ez, maxZ: p.z + ez, rotY: p.rotY, hx, hz, mass: SPECS[kind].mass,
    vx: Math.sin(p.rotY) * p.speed + Math.cos(p.rotY) * (p.slip ?? 0),
    vz: Math.cos(p.rotY) * p.speed - Math.sin(p.rotY) * (p.slip ?? 0),
  };
}

/** How far round the race someone is (m from the lights going out), their car at (x, z). */
const progress = (t: Timing & { lap?: number }, x: number, z: number) => (t.lap ?? 0) * track().length + (Math.max(0, t.checkpoint) * track().length) / CHECKPOINTS + pastLine(t.checkpoint, x, z);

export class RaceBots {
  /** How the bots top the grid up: shared with everyone as RaceState.bots. */
  settings: BotSettings = { fill: BOTS.fill, level: BOTS.level };
  private bots = new Map<string, Bot>();
  private changedAt = -Infinity;
  /** When each person last asked for a rabbit (or sent theirs home). */
  private rabbitAt = new Map<string, number>();
  private last: number | undefined;
  private ticks = 0;
  private made = 0;
  /** When the bots last looked at how far ahead of the people they are. */
  private easedAt = 0;

  /** `now` the office's clock (ms); `rand` for each bot's seed, so a test runs the same race every time. */
  constructor(
    private race: RaceControl,
    private garage: Garage,
    private io: RaceBotsIO,
    private rand: () => number = Math.random,
  ) {}

  /** How many bots are out (racing or rabbits): while there are any, tick them. */
  get size(): number {
    return this.bots.size;
  }

  /** The race as everyone hears it: with the bots' setting. */
  state(): RaceState {
    return { ...this.race.state(), bots: { ...this.settings } };
  }

  /**
   * Bots to top the grid up to `fill` racers, people included (1: none), at `level`; `by` who said so.
   * At most once a second (BOTS.every): sooner is refused. Lining up, the grid changes straight away;
   * a race already on keeps the bots it started with. Says whether it took.
   */
  set(fill: number, level: BotLevel, by: string, now: number): boolean {
    if (now - this.changedAt < BOTS.every) return false;
    this.changedAt = now;
    this.settings = { fill: Math.max(1, Math.min(RACE.slots, Math.trunc(fill))), level, by };
    this.sync(now);
    return true;
  }

  /** A person's about to line up: a bot gives them its place if the grid's full or it would be over `fill`. */
  makeRoom(now: number) {
    const r = this.race.state();
    if (r.phase !== 'lobby' && r.phase !== 'countdown') return;
    const people = r.racers.filter((x) => !isBot(x.id)).length + 1;
    const bots = this.racing(r);
    if (bots.length && (r.racers.length >= RACE.slots || bots.length > this.wanted(people))) this.remove(bots[bots.length - 1], now);
  }

  /**
   * The bots in step with the race: out of it once it's moved on without them (the results came
   * down, a new race), all out when no person's left in it; and lining up, as many as the setting
   * wants for the people on the grid, at its level. Rabbits go when whoever they're out for isn't
   * driving here any more, or lines up. Call it whenever the race or the circuit's cars change.
   */
  sync(now: number) {
    const r = this.race.state();
    let changed = false;
    for (const b of [...this.bots.values()]) {
      const gone = b.rabbitOf !== undefined
        ? this.garage.seatOf(b.rabbitOf)?.seat !== 'driver' || r.racers.some((x) => x.id === b.rabbitOf)
        : !r.racers.some((x) => x.id === b.id);
      if (gone) changed = this.remove(b, now) || changed;
    }
    const people = r.racers.filter((x) => !isBot(x.id));
    if (!people.length) {
      for (const b of this.racing(r)) changed = this.remove(b, now) || changed;
    } else if (r.phase === 'lobby' || r.phase === 'countdown') {
      // At another level than the setting's (it changed while lining up): out, for one at the right one.
      for (const b of this.racing(r)) if (b.driver.level !== this.settings.level) changed = this.remove(b, now) || changed;
      const want = this.wanted(people.length);
      for (let bots = this.racing(); bots.length > want; bots = this.racing()) changed = this.remove(bots[bots.length - 1], now) || changed;
      while (this.racing().length < want && this.add(now, people.map((p) => CIRCUIT_CARS[p.car]?.kind))) changed = true;
    }
    if (changed) {
      this.io.cars();
      this.io.race();
    }
  }

  /**
   * `id`, driving one of the circuit's cars and not in the race, wants a bot at `level` to chase on
   * practice laps (null: send theirs home). It sets off RABBIT_AHEAD round the track from them, at about
   * their speed. At most once a second each (BOTS.every). What's wrong, if it can't.
   */
  rabbit(id: string, level: BotLevel | null, now: number): string | undefined {
    if (now - (this.rabbitAt.get(id) ?? -Infinity) < BOTS.every) return 'You only just changed your rabbit: give it a second';
    for (const [k, at] of this.rabbitAt) if (now - at >= BOTS.every) this.rabbitAt.delete(k);
    this.rabbitAt.set(id, now);
    const mine = [...this.bots.values()].find((b) => b.rabbitOf === id);
    if (mine) this.remove(mine, now);
    const seat = this.garage.seatOf(id);
    const err =
      level === null ? undefined
      : seat?.seat !== 'driver' ? 'Get behind the wheel of one of the circuit’s cars to have a rabbit to chase'
      : this.race.state().racers.some((x) => x.id === id) ? 'You’re in the race: the rabbit’s for practice laps'
      : [...this.bots.values()].filter((b) => b.rabbitOf).length >= RABBITS ? `There are ${RABBITS} rabbits out already`
      : undefined;
    const car = seat && this.garage.state()[seat.car];
    const added = level !== null && !err && !!car && this.add(now, [CIRCUIT_CARS[seat!.car].kind], { rabbitOf: id, level, at: nearestProgress(car.x, car.z).s + RABBIT_AHEAD, speed: Math.max(0, car.speed) });
    if (mine || added) {
      this.io.cars();
      this.io.race();
    }
    return err ?? (level !== null && !added ? 'There’s no free car for a rabbit right now' : undefined);
  }

  /** The bots out racing (not rabbits), from the back of the grid's first slot to the last. */
  private racing(r: RaceState = this.race.state()): Bot[] {
    const slot = (b: Bot) => r.racers.find((x) => x.id === b.id)?.slot ?? Infinity;
    return [...this.bots.values()].filter((b) => b.rabbitOf === undefined).sort((a, b) => slot(a) - slot(b));
  }

  /** How many bots the setting wants for `people` on the grid. */
  private wanted(people: number): number {
    return Math.max(0, Math.min(this.settings.fill, RACE.slots) - people);
  }

  /**
   * One more bot: into a free car of the circuit's (the kind nearest in pace to `like`'s, the people's
   * cars), then onto the grid, or out on the track as `rabbit`. Says whether there was one to add.
   */
  private add(now: number, like: (CarKind | undefined)[], rabbit?: { rabbitOf: string; level: BotLevel; at: number; speed: number }): boolean {
    const cars = this.garage.state();
    const taken = new Set(this.race.state().racers.map((x) => x.car));
    const free = CIRCUIT_CARS.map((_, i) => i).filter((i) => !cars[i]?.driver && !cars[i]?.passenger && !taken.has(i));
    if (!free.length) return false;
    const pace = like.filter((k): k is CarKind => !!k).map((k) => speedPlan(k).lap);
    const ref = pace.length ? pace.reduce((a, b) => a + b, 0) / pace.length : speedPlan('lambo').lap;
    const car = free.sort((a, b) => Math.abs(speedPlan(CIRCUIT_CARS[a].kind).lap - ref) - Math.abs(speedPlan(CIRCUIT_CARS[b].kind).lap - ref) || a - b)[0];
    const used = new Set([...this.bots.values()].map((b) => b.name));
    const name = `🤖 ${BOT_NAMES.find((n) => !used.has(`🤖 ${n}`)) ?? BOT_NAMES[this.made % BOT_NAMES.length]}`;
    const id = `${BOT_ID}race:${++this.made}`;
    const level = rabbit?.level ?? this.settings.level;
    if (!this.garage.enter(id, car, 'driver')) return false;
    let at: { x: number; z: number; rotY: number };
    if (rabbit) {
      const kind = CIRCUIT_CARS[car].kind;
      const others = this.solids(id);
      const spots = [0, 10, 20, 30].map((more) => {
        const p = pointAt(rabbit.at + more);
        const i = racingLine()[Math.round((p.s / track().length) * racingLine().length) % racingLine().length];
        return { x: i.x, z: i.z, rotY: Math.atan2(i.tx, i.tz) };
      });
      at = spots.find((p) => carFits(p, others, kind, circuitGround)) ?? spots[spots.length - 1];
    } else {
      if (!this.race.join(id, name, car, now, level)) {
        this.garage.leave(id);
        return false;
      }
      at = gridPose(this.race.state().racers.find((x) => x.id === id)!.slot);
    }
    const kind = CIRCUIT_CARS[car].kind;
    const pose: CarPose = { ...at, speed: rabbit ? Math.min(rabbit.speed, speedPlan(kind).v[nearestLine(at.x, at.z)] * RACE_SKILL[level].pace) : 0, steer: 0, slip: 0, yaw: 0 };
    const driver = new RaceBot(kind, level, pose, seeded(Math.floor(this.rand() * 2 ** 32)));
    this.bots.set(id, { id, name, car, kind, driver, pose, pedals: { gas: 0, turn: 0, brake: false, stop: true }, marshal: new Marshal(), clock: 0, nearMissAt: -Infinity, hits: 0, resets: 0, mark: { s: nearestProgress(pose.x, pose.z).s, at: 0 }, ...(rabbit ? { rabbitOf: rabbit.rabbitOf } : {}) });
    this.report(this.bots.get(id)!, now);
    if (rabbit) this.race.drove(id, pose.x, pose.z, now, { name, car, bot: level, rabbitOf: rabbit.rabbitOf });
    return true;
  }

  /** A bot out of the race (if it's still in it) and its car, back to its spot in the paddock. */
  private remove(b: Bot, now: number): boolean {
    this.bots.delete(b.id);
    this.race.leave(b.id, now);
    this.garage.leave(b.id);
    this.garage.park(b.car);
    return true;
  }

  /**
   * Every 50 ms or so: the bots' cars on to `now` on the physics, what they press decided ten times a
   * second, and where they've got to out to everyone (and to the race).
   */
  tick(now: number) {
    if (!this.bots.size) {
      this.last = now;
      return;
    }
    // A stall (the office busy) isn't made up for: the physics goes on from a quarter of a second ago at most.
    this.last = Math.max(this.last ?? now, now - 250);
    const steps = Math.floor((now - this.last) / (DRIVE_STEP * 1000));
    const r = this.race.state();
    this.ticks++;
    if (now - this.easedAt >= 1000) {
      this.easedAt = now;
      this.ease(r);
    }
    const bots = [...this.bots.values()];
    bots.forEach((b, k) => {
      if ((this.ticks + k) % 2 === 0) b.pedals = this.decide(b, r, now);
    });
    // What the people's cars are doing (carried on from where they last said, as a page does: at most a quarter of a second).
    const cars = this.garage.state();
    const people = cars.flatMap((c, i) => (c.driver && isBot(c.driver) ? [] : [this.carried(i, c, now)]));
    for (let s = 0; s < steps; s++) for (const b of bots) this.step(b, r, people);
    this.last += steps * DRIVE_STEP * 1000;
    let raced = false;
    for (const b of bots) raced = this.report(b, now) || raced;
    if (raced) this.io.race();
  }

  /** What bot `b` presses now. */
  private decide(b: Bot, r: RaceState, now: number): Pedals {
    const stop: Pedals = { gas: 0, turn: 0, brake: false, stop: true };
    const racer = r.racers.find((x) => x.id === b.id);
    if (racer) {
      // On the grid: on its slot, and its foot on the brake.
      if (r.phase === 'lobby' || r.phase === 'countdown') {
        b.go = undefined;
        const g = gridPose(racer.slot);
        if (Math.hypot(b.pose.x - g.x, b.pose.z - g.z) > 0.5) this.place(b, g);
        return stop;
      }
      // The lights out: its launch, as quick as its level reacts.
      if (b.go === undefined) {
        const [lo, hi] = b.driver.skill.launch;
        b.go = (r.startsAt ?? now) + lo + (hi - lo) * this.rand();
      }
      if (now < b.go) return stop;
    }
    // Home (or the race over): a lap of honour, out of the way.
    if (racer && (racer.finishedAt !== undefined || r.phase === 'finished')) b.driver.ease = COOL;
    const others = [...this.solids(b.id)];
    return b.driver.decide(b.pose, others, 0.1);
  }

  /** One physics step for bot `b`: through the other cars on the circuit's ground, the boost tank, and the marshal. */
  private step(b: Bot, r: RaceState, people: Box[]) {
    const solids = [...people, ...[...this.bots.values()].filter((o) => o !== b).map((o) => carBox(o.kind, o.pose))];
    b.pose = advance(b.pose, b.pedals, DRIVE_STEP, b.kind, { ...CIRCUIT_COURSE, solids, bumped: (_, speed, vehicle) => void (vehicle && speed >= 2 && b.hits++) });
    b.clock += DRIVE_STEP;
    const fill = tankFill(b.pose, b.kind, solids);
    let rate = fill.rate;
    if (fill.nearMiss && b.clock - b.nearMissAt > NEAR_MISS_EVERY) {
      b.nearMissAt = b.clock;
      rate += TANK.nearMiss / DRIVE_STEP;
    }
    b.driver.refuel(DRIVE_STEP, rate);
    // In trouble on a lap (off and slow, stuck, the wrong way round) for a few seconds: back on the track, as a person would be.
    const racer = r.racers.find((x) => x.id === b.id);
    const t: Timing | undefined = racer ?? r.practice.find((x) => x.id === b.id);
    const onLap = racer ? r.phase === 'racing' || r.phase === 'finished' : !!b.rabbitOf;
    // Getting somewhere: GOT metres further round than it last did.
    const s = nearestProgress(b.pose.x, b.pose.z).s, L = track().length;
    if (((s - b.mark.s + 1.5 * L) % L) - L / 2 >= GOT || !t || !onLap || b.pedals.stop) b.mark = { s, at: b.clock };
    if (!t || !onLap || b.pedals.stop) {
      b.marshal.clear();
      return;
    }
    const trouble = b.marshal.step(DRIVE_STEP, b.pose, surfaceAt(b.pose.x, b.pose.z) === 'grass', b.pedals.gas !== 0) === 0;
    if (!trouble && b.clock - b.mark.at < LOST) return;
    b.resets++;
    const spots = resetSpots(racer ?? { checkpoint: t.checkpoint });
    this.place(b, spots.find((p) => carFits(p, solids, b.kind, circuitGround)) ?? spots[0]);
  }

  /** Bot `b` put down at `at`, stopped. */
  private place(b: Bot, at: { x: number; z: number; rotY: number }) {
    b.pose = { x: at.x, z: at.z, rotY: at.rotY, speed: 0, steer: 0, slip: 0, yaw: 0 };
    b.driver.moved(at);
    b.marshal.clear();
    b.mark = { s: nearestProgress(at.x, at.z).s, at: b.clock };
  }

  /** Where bot `b`'s car has got to, out to everyone and to the race. Says whether the race changed. */
  private report(b: Bot, now: number): boolean {
    const pose = this.garage.drive(b.id, b.car, b.pose);
    if (!pose) return false;
    // Sat still where it was last seen (on the grid, lining up): nothing new to tell anyone.
    const at = `${pose.x},${pose.z},${pose.rotY}`;
    if (pose.speed || b.seen !== at) this.io.moved(b.car, pose, b.driver.boosting);
    b.seen = at;
    return this.race.drove(b.id, pose.x, pose.z, now, b.rabbitOf ? { name: b.name, car: b.car, bot: b.driver.level, rabbitOf: b.rabbitOf } : undefined);
  }

  /** Every car on the circuit but `id`'s, as something to bump into: the bots' where they are, the people's carried on. */
  private solids(id: string): Box[] {
    const now = this.last ?? 0;
    const cars = this.garage.state();
    return cars.flatMap((c, i) => {
      if (c.driver === id) return [];
      const b = c.driver ? this.bots.get(c.driver) : undefined;
      return [b ? carBox(b.kind, b.pose) : this.carried(i, c, now)];
    });
  }

  /** Circuit car `i` where its driver last said, carried on the way it was going (at most a quarter of a second, as a page does). */
  private carried(i: number, c: CarState, now: number): Box {
    const ahead = c.driver ? Math.min(0.25, Math.max(0, (now - (this.garage.heardAt(i) ?? now)) / 1000)) : 0;
    const vx = Math.sin(c.rotY) * c.speed + Math.cos(c.rotY) * (c.slip ?? 0), vz = Math.cos(c.rotY) * c.speed - Math.sin(c.rotY) * (c.slip ?? 0);
    return carBox(CIRCUIT_CARS[i].kind, { ...c, x: c.x + vx * ahead, z: c.z + vz * ahead });
  }

  /**
   * The bots' one help to the people they race, mild and honest: a bot well ahead of every person in
   * the race eases off, to EASE of its level's pace at most (from EASE_FROM metres ahead to EASE_TO).
   * Never faster than its level, never more grip or boost than the car has.
   */
  private ease(r: RaceState) {
    if (r.phase !== 'racing') return;
    const cars = this.garage.state();
    const people = r.racers.filter((x) => !isBot(x.id) && x.finishedAt === undefined).map((x) => progress(x, cars[x.car]?.x ?? 0, cars[x.car]?.z ?? 0));
    const lead = people.length ? Math.max(...people) : Infinity;
    for (const b of this.bots.values()) {
      const racer = r.racers.find((x) => x.id === b.id);
      if (!racer || racer.finishedAt !== undefined) continue;
      const ahead = progress(racer, b.pose.x, b.pose.z) - lead;
      b.driver.ease = 1 - (1 - EASE) * Math.max(0, Math.min(1, (ahead - EASE_FROM) / (EASE_TO - EASE_FROM)));
    }
  }
}
