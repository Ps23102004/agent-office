import { BOOST, DRIVE, SPECS, TANK, drive, steerLimit, type Box, type CarKind, type CarPose, type Pedals } from './garage.js';
import { TRACK, nearestProgress, onGrass, track } from './circuit.js';
import type { BotLevel } from './bots.js';

// The office's own racers at the circuit (server/racebots.ts) and how one drives. A bot has the same
// car, the same pedals and wheel and the same boost tank as a person: the office runs its car through
// the same physics a person's page does (shared/garage.ts advance on CIRCUIT_COURSE), so all a bot
// decides is what to press, ten times a second. It drives a racing line (out wide, in to the apex,
// out wide again), at a speed planned from how hard the tyres can turn it and the brakes stop it, and
// steers by trying a handful of wheel positions on the same tyre physics (shared/garage.ts drive) a
// second or so ahead and keeping the one that stays nearest the line. Other cars are in that look
// ahead too: it follows one it can't get by, moves over a lane to pass, keeps off the side of one
// alongside, and goes round one stopped on the track (backing off it first if it got too close).

/** What a level's bot is like: how near the limit it drives, and how human it is about it. */
export interface RaceSkill {
  /** Of the planned speed everywhere (1 is as fast as a bot can go round without leaving the track). */
  pace: number;
  /** Mistakes a second, on average: braking late for a corner, or a wobble on the wheel. */
  mistakes: number;
  /** From the lights going out to its foot on the gas (ms, the least and the most). */
  launch: readonly [number, number];
  /** How much earlier or later than it should it brakes, as seconds of look ahead each way. */
  brakes: number;
  /** The gap it leaves behind a car it can't pass (s of its own speed). */
  gap: number;
  /** How keen it is to go round a slower car: the cost of moving over a lane (low is keen). */
  shy: number;
  /** Uses the boost. */
  boost: boolean;
}

/**
 * Each level (shared/bots.ts BotLevel), measured round the circuit (tests/racebot.test.ts): see LAPS
 * there for the times each car does. Easy is a beginner who brakes early and wobbles; normal an average
 * driver; hard a quick one; insane right at what the car can do, without a slip.
 */
export const RACE_SKILL: Record<BotLevel, RaceSkill> = {
  easy: { pace: 0.8, mistakes: 0.08, launch: [450, 700], brakes: 0.25, gap: 0.6, shy: 8, boost: false },
  normal: { pace: 0.89, mistakes: 0.04, launch: [300, 450], brakes: 0.15, gap: 0.45, shy: 5, boost: true },
  hard: { pace: 0.95, mistakes: 0.015, launch: [220, 320], brakes: 0.08, gap: 0.35, shy: 3, boost: true },
  insane: { pace: 1, mistakes: 0, launch: [180, 240], brakes: 0, gap: 0.3, shy: 2, boost: true },
};

/** How far the racing line keeps in from the edge of the asphalt, for a car's middle (m). */
const EDGE = 1.2;
/** Of the tyres' grip, what the plan uses going round a bend: the rest is for the wheel to correct with. */
const LAT = 0.95;
/** How hard the plan brakes on the straight (m/s²): the brakes do 20, but the car's not always straight. */
const BRAKE = 18;
/** How far apart two lanes are, either side of the racing line (m). */
const LANE = 3.5;
/** How far ahead of where it is (s) it steers for the line's bend: about how long the car takes to answer the wheel. */
const LEAD = 0.25;
/** How long a move across into another lane takes (s): no harder across than the tyres can do easily at speed; quicker slow (swap). */
const SWAP = 2;
const swap = (v: number) => Math.min(SWAP, Math.max(0.8, 0.5 + v / 30));
/** What a lane off the racing line costs it (each metre), and being held up behind someone (each m/s). */
const OFF_LINE = 1.5;
const HELD = 4;
/** What a lane with a car stopped in it ahead costs it: more than any way round, less than a hit. */
const DEAD = 500;
/** What changing its mind costs it halfway across into a lane: it sees a move through, unless that's into something. */
const COMMIT = 150;
/** A bend sharper than this (1/m: a radius under 150 m) is one it doesn't change lanes in, unless it's going slower than CRAWL (m/s). */
const BEND = 1 / 150;
const CRAWL = 15;
/** Slower than this (m/s), a car ahead is as good as stopped: something to go round, not follow; and how far short of it to stop (m), to have room to. */
const STOPPED = 3;
const ROOM = 6;
/** Stuck behind one that long (s), it backs off for this long (s). */
const BACK = { wait: 1.5, for: 1.2 } as const;
/** How far ahead it looks for other cars (m): a second and a half's driving and some, and always far enough to stop (at BRAKE) short of one stopped on the track; never past TRAFFIC. */
const TRAFFIC = 200;
const looks = (v: number) => Math.min(TRAFFIC, Math.max(15 + v * 1.5, (v * v) / (2 * BRAKE) + 30, v * swap(v) + 30));

/** A move across, from one lane to another (m off the racing line), started at `at` (s), taking `T` s. */
interface Move {
  from: number;
  at: number;
  T: number;
}

/** A point of the racing line: where, which way it runs, how sharply it bends there (1/m, + to the left), and on to the next (m). */
export interface LinePoint {
  x: number;
  z: number;
  /** Off the centre line (m, + to a driver's left). */
  d: number;
  tx: number;
  tz: number;
  k: number;
  ds: number;
}

let built: LinePoint[] | null = null;

/**
 * The racing line, at each of the track's points (track().points): the one that bends least, kept
 * EDGE in from the edges. (Not shared/racingline.ts: that's the rubber the circuit draws, shaped by
 * eye; this is the one a fast lap needs.) Found by relaxing every point toward where the bend round it is least (the
 * fourth difference), on every fifth point first so the long corners settle, then on all of them.
 * About half a second, once.
 */
export function racingLine(): LinePoint[] {
  if (built) return built;
  const { points } = track();
  const n = points.length;
  const half = TRACK.width / 2 - EDGE;
  const relax = (idx: number[], d: Float64Array, iters: number) => {
    const m = idx.length;
    const px = new Float64Array(m), pz = new Float64Array(m);
    const at = (j: number) => {
      const p = points[idx[j]];
      px[j] = p.x + p.tz * d[j];
      pz[j] = p.z - p.tx * d[j];
    };
    for (let j = 0; j < m; j++) at(j);
    for (let it = 0; it < iters; it++) {
      for (let j = 0; j < m; j++) {
        const a = (j - 2 + m) % m, b = (j - 1 + m) % m, c = (j + 1) % m, e = (j + 2) % m;
        const tx = (4 * (px[b] + px[c]) - px[a] - px[e]) / 6, tz = (4 * (pz[b] + pz[c]) - pz[a] - pz[e]) / 6;
        const p = points[idx[j]];
        d[j] = Math.max(-half, Math.min(half, (tx - p.x) * p.tz - (tz - p.z) * p.tx));
        at(j);
      }
    }
    return d;
  };
  const K = 5;
  const coarse = Array.from({ length: Math.floor(n / K) }, (_, j) => j * K);
  const dc = relax(coarse, new Float64Array(coarse.length), 20000);
  const fine = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const j = Math.floor(i / K) % coarse.length, f = Math.min(1, (i - coarse[j]) / K);
    fine[i] = dc[j] + (dc[(j + 1) % coarse.length] - dc[j]) * f;
  }
  const d = relax(Array.from({ length: n }, (_, i) => i), fine, 1500);
  const line = points.map((p, i) => ({ x: p.x + p.tz * d[i], z: p.z - p.tx * d[i], d: d[i], tx: 0, tz: 0, k: 0, ds: 0 }));
  for (let i = 0; i < n; i++) {
    const a = line[(i - 3 + n) % n], b = line[i], c = line[(i + 3) % n], next = line[(i + 1) % n];
    const ab = Math.hypot(b.x - a.x, b.z - a.z), bc = Math.hypot(c.x - b.x, c.z - b.z), ca = Math.hypot(a.x - c.x, a.z - c.z);
    // Through three points round the bend (+ bending to the left, as the wheel's turn is).
    b.k = (-2 * ((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x))) / Math.max(1e-9, ab * bc * ca);
    b.ds = Math.hypot(next.x - b.x, next.z - b.z);
    const l = Math.hypot(c.x - a.x, c.z - a.z) || 1;
    b.tx = (c.x - a.x) / l;
    b.tz = (c.z - a.z) / l;
  }
  return (built = line);
}

/**
 * How hard `kind` can turn (m/s² across) at a speed: measured on the physics itself, the wheel held
 * all the way round and the gas holding the speed, every 5 m/s up to its top speed on the boost. Less
 * than the tyres' grip the faster it goes (the wheel turns less at speed: shared/garage.ts steerLimit).
 */
function cornering(kind: CarKind): (speed: number) => number {
  const step = 5;
  const top = SPECS[kind].top * BOOST.top;
  const most: number[] = [];
  for (let v0 = 0; v0 <= top + step; v0 += step) {
    let p: CarPose = { x: 0, z: 0, rotY: 0, speed: Math.max(1, v0), steer: 0, slip: 0, yaw: 0 };
    for (let t = 0; t < 3; t += 1 / 30) p = drive(p, { gas: Math.max(-1, Math.min(1, (v0 - p.speed) * 0.5 + 0.3)), turn: 1, brake: false, boost: v0 > SPECS[kind].top }, 1 / 30, kind);
    most.push(Math.abs(p.speed * (p.yaw ?? 0)));
  }
  return (v) => {
    const f = Math.max(0, Math.min(most.length - 1.001, v / step));
    const i = Math.floor(f);
    return most[i] + (most[i + 1] - most[i]) * (f - i);
  };
}

/** The speed plan for one kind of car round the racing line (m/s at each point): `v` on the engine alone, `cap` as fast as the corners allow, for the boost. */
export interface SpeedPlan {
  v: Float64Array;
  cap: Float64Array;
  /** A lap at `v`, on the line (s). */
  lap: number;
  /** As fast as it plans to go round a bend of `k` (1/m), on the boost if need be (m/s). */
  bend: (k: number) => number;
}

const plans = new Map<CarKind, SpeedPlan>();

/**
 * How fast `kind` can go at each point of the racing line: no faster round a bend than its tyres hold
 * (LAT of their grip, which grows with speed on a car), no faster than its engine gets it there from
 * the point before, and slow enough to brake for what's next (less hard in a bend, where the tyres
 * are busy turning it). Twice round, so the start line joins up.
 */
export function speedPlan(kind: CarKind): SpeedPlan {
  const had = plans.get(kind);
  if (had) return had;
  const spec = SPECS[kind];
  const line = racingLine();
  const n = line.length;
  const most = cornering(kind);
  const lat = (v: number) => LAT * most(v);
  const corner = (k: number, most: number) => {
    let v = most;
    for (let it = 0; it < 4; it++) v = Math.min(most, Math.sqrt(lat(v) / Math.max(1e-6, Math.abs(k))));
    return v;
  };
  const plan = (most: number, push: (v: number) => number) => {
    const v = Float64Array.from(line, (p) => corner(p.k, most));
    // How much of the tyres the bend is using at `v`: what's left of them for the engine or the brakes.
    const left = (i: number, s: number) => Math.sqrt(Math.max(0.05, 1 - ((s * s * Math.abs(line[i].k)) / lat(s)) ** 2));
    for (let lap = 0; lap < 2; lap++) {
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        v[j] = Math.min(v[j], Math.sqrt(v[i] ** 2 + 2 * Math.max(0, push(v[i])) * left(i, v[i]) * line[i].ds));
      }
      for (let i = n - 1; i >= 0; i--) {
        const j = (i + 1) % n;
        v[i] = Math.min(v[i], Math.sqrt(v[j] ** 2 + 2 * (BRAKE * left(j, v[j]) + DRIVE.drag * v[j] ** 2) * line[i].ds));
      }
    }
    return v;
  };
  const v = plan(spec.top, (s) => spec.accel * (1 - 0.8 * (s / spec.top) ** 2));
  const top = spec.top * BOOST.top;
  const cap = plan(top, (s) => spec.accel * (1 - 0.8 * (s / top) ** 2) + BOOST.accel);
  let lap = 0;
  for (let i = 0; i < n; i++) lap += line[i].ds / v[i];
  const out = { v, cap, lap, bend: (k: number) => corner(k, top) };
  plans.set(kind, out);
  return out;
}

/** The racing line's point nearest (x, z), looking only `window` points either side of `hint`, or everywhere without one. */
export function nearestLine(x: number, z: number, hint?: number, window = 12): number {
  const line = racingLine();
  const n = line.length;
  const from = hint ?? Math.round((nearestProgress(x, z).s / track().length) * n);
  let best = from, bd = Infinity;
  for (let k = -window; k <= window; k++) {
    const i = (((from + k) % n) + n) % n;
    const d = (line[i].x - x) ** 2 + (line[i].z - z) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

/** How far (x, z) is off the racing line at point `i` (m, + to a driver's left). */
const offLine = (x: number, z: number, i: number) => {
  const p = racingLine()[i];
  return (x - p.x) * p.tz - (z - p.z) * p.tx;
};

/** Lane `lane`'s middle (m off the racing line, `lane` across from it) at point `i`: kept on the asphalt, along its edge if need be. */
function laneAt(i: number, lane: number): number {
  const d = racingLine()[i].d;
  const half = TRACK.width / 2 - EDGE;
  return Math.max(-half, Math.min(half, d + lane)) - d;
}

/** How sharply lane `lane` bends at point `i` (1/m). */
function laneBend(i: number, lane: number): number {
  const line = racingLine();
  const n = line.length;
  const at = (j: number) => {
    const p = line[(j + n) % n], o = laneAt((j + n) % n, lane);
    return { x: p.x + p.tz * o, z: p.z - p.tx * o };
  };
  const a = at(i - 3), b = at(i), c = at(i + 3);
  const ab = Math.hypot(b.x - a.x, b.z - a.z), bc = Math.hypot(c.x - b.x, c.z - b.z), ca = Math.hypot(a.x - c.x, a.z - c.z);
  return (2 * ((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x))) / Math.max(1e-9, ab * bc * ca);
}

/** A small seeded random number source (mulberry32): a test drives the same race every time. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The middle of a box. */
const middle = (b: Box) => ({ x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 });

/**
 * The wheel (-1 to 1) that would take `kind` round the racing line's bend at point `i` at `speed`, if
 * the car turned the way its wheels point: the bot steers this, plus a correction (see RaceBot).
 */
export function lineTurn(kind: CarKind, i: number, speed: number): number {
  const line = racingLine();
  const k = line[i].k;
  return Math.max(-1, Math.min(1, Math.atan(SPECS[kind].wheelbase * k) / steerLimit(Math.max(1, speed), kind)));
}

/**
 * The corrections to the line's bend it tries each time, from its last one (of a full turn of the
 * wheel), never more than TRIM either way; and what changing it costs, so it doesn't saw at the wheel.
 */
const NUDGES = [-0.3, -0.1, 0, 0.1, 0.3];
/** Further off its lane than this (m), it plans its way back over SWAP seconds rather than at once. */
const REJOIN = 1.5;
const TRIM = 1.5;
const CHANGE = 0.5;
/** How far ahead it looks, the car and the cars round it run on (s): longer the faster it's going. */
const HORIZON = { min: 0.8, max: 1, step: 1 / 30 } as const;

/**
 * One bot's hands and feet. `decide` it ten times a second with where its car is and the other
 * cars round it (as solids: shared/garage.ts Box, with their motion); `refuel` it every physics step
 * with how much boost came back (shared/garage.ts tankFill, as a person's page does it).
 */
export class RaceBot {
  /** The racing line's point it's nearest. */
  i: number;
  /** The wheel it chose last (-1 to 1), what of that was its correction to the line's bend (lineTurn), and the lane it's in (m off the racing line). */
  turn = 0;
  trim = 0;
  lane = 0;
  /** The boost meter (0 to 1: TANK), and whether it's on it. */
  tank = 1;
  boosting = false;
  /** Of its level's pace: under 1 when it's a long way ahead of the people it's racing (see server/racebots.ts). */
  ease = 1;
  /** A mistake it's making, till when (s of its own clock). */
  private slip: { kind: 'late' | 'wobble'; until: number; by: number } | null = null;
  /** A move across under way (into another lane, or back onto its own): from how far off the racing line, since when (its clock), taking how long (s). */
  private move: Move | null = null;
  /** How long it's sat stuck behind something stopped (s), and how much longer it's backing off it. */
  private waited = 0;
  private backing = 0;
  /** How much earlier (+) or later it's braking than it should, as seconds of look ahead; till when. */
  private brakeBias = 0;
  private biasUntil = 0;
  private clock = 0;
  readonly skill: RaceSkill;

  constructor(
    readonly kind: CarKind,
    readonly level: BotLevel,
    at: { x: number; z: number },
    private rand: () => number = Math.random,
  ) {
    this.skill = RACE_SKILL[level];
    this.i = nearestLine(at.x, at.z);
  }

  /** Put somewhere else (back on the track): where it is on the line, found again. */
  moved(at: { x: number; z: number }) {
    this.i = nearestLine(at.x, at.z);
    this.turn = this.trim = 0;
    this.slip = null;
    this.move = null;
    this.waited = this.backing = 0;
  }

  /** What to press, `dt` seconds after it last decided, its car at `p` among `others`. */
  decide(p: CarPose, others: readonly Box[], dt: number): Pedals {
    this.clock += dt;
    const line = racingLine();
    const plan = speedPlan(this.kind);
    const spec = SPECS[this.kind];
    const n = line.length;
    this.i = nearestLine(p.x, p.z, this.i, 24);
    const v = Math.max(0, p.speed);
    const pace = this.skill.pace * this.ease;
    // Braking a little early or late, changing every couple of seconds.
    if (this.clock >= this.biasUntil) {
      this.brakeBias = (this.rand() * 2 - 1) * this.skill.brakes;
      this.biasUntil = this.clock + 1.5 + this.rand() * 2;
    }
    // A mistake, now and then: off the brakes into a corner, or a wobble on the wheel.
    if (!this.slip && this.rand() < this.skill.mistakes * dt) {
      this.slip = { kind: this.rand() < 0.5 ? 'late' : 'wobble', until: this.clock + 0.3 + this.rand() * 0.5, by: (this.rand() < 0.5 ? -1 : 1) * (0.15 + this.rand() * 0.2) };
    }
    if (this.slip && this.clock >= this.slip.until) this.slip = null;

    // The speed it wants a little way ahead (it brakes for what's coming, not for where it is).
    let k = this.i;
    for (let ahead = 0, want = Math.max(0, 0.3 + this.brakeBias) * v; ahead < want; k = (k + 1) % n) ahead += line[k].ds;
    // Boost, as a person would: tank lit (a tenth to light it), the wheel near straight, on the track, and room ahead to go faster.
    let room = this.skill.boost && Math.abs(this.turn) <= 0.2 && this.tank > (this.boosting ? 0 : 0.1) && Math.abs(offLine(p.x, p.z, this.i) + line[this.i].d) <= TRACK.width / 2;
    for (let m = this.i, look = 0; room && look < Math.max(60, v * 2); look += line[m].ds, m = (m + 1) % n) {
      if (plan.cap[m] * pace < Math.min(spec.top * BOOST.top * pace, v + 8)) room = false;
    }
    const target = (room ? plan.cap[k] : plan.v[k]) * pace;
    // In a bend (anywhere ahead it'll be for the next second), it keeps to its lane: a move across is for the straights (or a crawl).
    let bending = false;
    for (let m = this.i, look = 0; !bending && v > CRAWL && look < Math.max(20, v); look += line[m].ds, m = (m + 1) % n) bending = Math.abs(line[m].k) > BEND;

    // The cars about: ahead (as far as it looks) or alongside.
    const fx = Math.sin(p.rotY), fz = Math.cos(p.rotY);
    const near = others
      .filter((b) => b.mass)
      .map((b) => {
        const c = middle(b);
        // How far ahead round the track (not the way it's pointing: round a hairpin, the cars behind are in front of its nose).
        const j = nearestLine(c.x, c.z);
        const along = ((((j - this.i) % n) + n + n / 2) % n - n / 2) * (track().length / n);
        return { ...c, vx: b.vx ?? 0, vz: b.vz ?? 0, along, j, off: offLine(c.x, c.z, j), rotY: b.rotY ?? 0, hx: b.hx ?? 1, hz: b.hz ?? 2 };
      })
      .filter((o) => o.along > -8 && o.along < looks(v));
    // Something stopped (or as good as) in its lane ahead: in the way, bend or no bend.
    // In lane `lane` where it is (a lane's off the racing line by less where the line runs along the edge).
    const inLane = (o: (typeof near)[number], lane: number) => Math.abs(o.off - laneAt(o.j, lane)) <= spec.width / 2 + o.hx + 0.6;
    const going = (o: (typeof near)[number]) => Math.min(o.vx * fx + o.vz * fz, plan.v[o.j] * pace);
    const blocked = near.some((o) => o.along > 0 && going(o) < STOPPED && inLane(o, this.lane));
    // Stopped nose up behind something stopped for a while, no way round from there: it backs off a
    // little, for room to go round it (the one time a bot goes into reverse).
    const here = offLine(p.x, p.z, this.i);
    const nose = near.some((o) => o.along > 0 && o.along < spec.length + ROOM && going(o) < STOPPED && Math.abs(o.off - here) < spec.width / 2 + o.hx + 0.6);
    this.waited = v < 2 && nose ? this.waited + dt : 0;
    if (this.waited > BACK.wait) {
      this.waited = 0;
      this.backing = BACK.for;
    }
    if (this.backing > 0) {
      this.backing -= dt;
      this.turn = this.trim = 0;
      return { gas: -1, turn: 0, brake: false };
    }
    // Its own lane first (and the racing line, to get back onto it); the others only once it's held up
    // behind someone or about to touch them, and not in a bend.
    let best: { cost: number; trim: number; lane: number; gas: number; hit: boolean; held: boolean; go: Move | null } = { cost: Infinity, trim: 0, lane: 0, gas: 0, hit: false, held: false, go: null };
    const tried = new Set<string>();
    const tryLane = (lane: number, brake = false) => {
      if (tried.has(`${lane}${brake}`)) return;
      tried.add(`${lane}${brake}`);
      const off = laneAt(this.i, lane);
      // Off the racing line, its bends are another shape (squeezed against the edge of the asphalt, the
      // edge's): no faster than that lets it go, and slow enough to brake for what's ahead in it.
      let want = target;
      if (lane) {
        for (let m = this.i, look = 0; look < Math.max(40, v * 2); look += line[m].ds * 2, m = (m + 2) % n) {
          want = Math.min(want, Math.sqrt((plan.bend(laneBend(m, lane)) * pace) ** 2 + 2 * BRAKE * look));
        }
      }
      // A car ahead in it: keep a gap behind it (skill.gap seconds of its own speed), closing up to that in
      // about a second, and slowing for the bends ahead of it as it will.
      for (const o of near) {
        if (o.along <= 0 || !inLane(o, lane)) continue;
        // Short of one that's stopped by room to steer round it.
        want = Math.min(want, going(o) + o.along - spec.length / 2 - o.hz - (going(o) < STOPPED ? ROOM : 1.5) - v * this.skill.gap);
      }
      want = Math.max(0, want);
      // One stopped in it holds it up for good, however far off it still is: only a hit's worse.
      const dead = near.some((o) => o.along > 0 && going(o) < STOPPED && inLane(o, lane));
      // On the gas toward it, or the brakes as hard as it's over (never into reverse: a bot only backs up to get unstuck).
      let gas = v < want - 0.3 ? Math.min(1, (want - v) * 0.6 + 0.3) : v > want + 0.5 && v > 1 ? -Math.min(1, 0.25 + (v - want) * 0.15) : 0;
      if (gas < 0 && this.slip?.kind === 'late') gas = 0.3;
      // Or, about to hit someone whichever way it steers, hard on the brakes.
      if (brake) gas = v > 1 ? -1 : 0;
      // Into another lane, gently: from where it is across to it over SWAP seconds. The same back onto its
      // own lane from well off it (a mistake, a bump): heading straight back for it overshoots, and weaves.
      // A move already under way into it goes on from where it's got to; it isn't started over each time.
      const at = offLine(p.x, p.z, this.i);
      const go = lane === this.lane && this.move ? this.move : lane !== this.lane || Math.abs(at - off) > REJOIN ? { from: at, at: this.clock, T: swap(v) } : null;
      // A wobble's hands off the wheel's corrections: it holds what it had till it's over.
      for (const trim of this.slip?.kind === 'wobble' ? [this.trim] : this.candidates(v)) {
        const run = this.rollout(p, { gas, turn: 0, brake: false, boost: room && gas > 0 }, trim, lane, go, near);
        const cost = run.cost + CHANGE * (trim - this.trim) ** 2 + (lane === this.lane ? 0 : this.skill.shy + (this.move ? COMMIT : 0)) + Math.abs(lane) * OFF_LINE + (dead ? DEAD : Math.max(0, target - want) * HELD) + (brake ? HELD * (v - want) : 0);
        if (cost < best.cost) best = { cost, trim, lane, gas, hit: run.hit, held: want < target - 1, go };
      }
    };
    tryLane(near.length ? this.lane : 0);
    if (near.length && !bending) tryLane(0);
    if (blocked || ((best.hit || best.held) && !bending)) for (const lane of [LANE, -LANE]) tryLane(lane);
    if (best.hit) tryLane(best.lane, true);
    this.lane = best.lane;
    this.move = best.go && this.clock - best.go.at < best.go.T ? best.go : null;
    this.boosting = room && best.gas > 0;
    const bend = this.ahead(this.i, v);
    // Kept as what it really turned by, the wheel being only so far round: the next tries start from there, not from past full lock.
    this.trim = Math.max(-1, Math.min(1, bend + best.trim)) - bend;
    this.turn = Math.max(-1, Math.min(1, bend + best.trim + (this.slip?.kind === 'wobble' ? this.slip.by : 0)));
    return { gas: best.gas, turn: this.turn, brake: false, boost: this.boosting };
  }

  /** The tank over `dt` on the boost, or filling at `rate` (of a tank a second) off it. */
  refuel(dt: number, rate: number) {
    this.tank = this.boosting ? Math.max(0, this.tank - dt / TANK.burn) : Math.min(1, this.tank + rate * dt);
    if (this.tank <= 0) this.boosting = false;
  }

  /**
   * Its last correction nudged each way, and none at all (straight back to the line's bend: no
   * unwinding a big one a nudge at a time); at a crawl, full lock either way too (round something in the way).
   */
  private candidates(speed: number): number[] {
    return [...new Set([0, ...(speed < CRAWL ? [-TRIM, TRIM] : []), ...NUDGES.map((d) => Math.max(-TRIM, Math.min(TRIM, Math.round((this.trim + d) * 1000) / 1000)))])];
  }

  /** The line's bend a moment ahead of point `i` at `speed` (the car takes that long to answer the wheel), as a wheel position. */
  private ahead(i: number, speed: number): number {
    const n = racingLine().length;
    return lineTurn(this.kind, (i + Math.round((speed * LEAD) / 2)) % n, speed);
  }

  /**
   * How bad holding `pedals` from `p` for the next second or so would be: off `lane` (moving over into it
   * from `from`, off the racing line, over SWAP seconds), heading off the line at the end of it, off the
   * asphalt, and into any of `near` (going on as they are).
   */
  private rollout(p: CarPose, pedals: Pedals, trim: number, lane: number, go: Move | null, near: readonly { x: number; z: number; vx: number; vz: number; rotY: number; hx: number; hz: number }[]): { cost: number; hit: boolean } {
    const line = racingLine();
    const v = Math.max(0, p.speed);
    const H = Math.min(HORIZON.max, Math.max(HORIZON.min, 0.4 + v / 40));
    const dt = HORIZON.step;
    const steps = Math.ceil(H / dt);
    const spec = SPECS[this.kind];
    let q = p, i = this.i, cost = 0, hit = false;
    // Already off the asphalt (wide of it by `was`), only going further off is the cliff: getting back on is the line's job, smoothly.
    const was = Math.max(0, Math.abs(offLine(p.x, p.z, this.i) + line[this.i].d) - (TRACK.width / 2 - spec.width / 2));
    // On the grass (off the asphalt and its kerbs), the grass's physics, as the car will really have it (shared/circuit.ts CIRCUIT_COURSE).
    let grass = was > TRACK.curb + spec.width / 2;
    for (let s = 1; s <= steps; s++) {
      q = drive(q, { ...pedals, turn: Math.max(-1, Math.min(1, this.ahead(i, q.speed) + trim)) }, dt, this.kind, grass ? 'grass' : 'road');
      if (grass) q = onGrass(q, dt);
      i = nearestLine(q.x, q.z, i, 12);
      const at = offLine(q.x, q.z, i);
      const off = laneAt(i, lane);
      const f = go ? Math.min(1, (this.clock - go.at + s * dt) / go.T) : 1;
      const e = at - (go ? go.from + (off - go.from) * f * f * (3 - 2 * f) : off);
      cost += e * e * (s / steps);
      // Off the asphalt is far worse than any line: the grass is slow, and the tyre wall's past it.
      const wide = Math.abs(at + line[i].d) - (TRACK.width / 2 - spec.width / 2);
      if (wide > was) cost += 1000 * (1 + wide - was) ** 2;
      if (wide > 0) cost += 20 * wide;
      grass = wide > TRACK.curb + spec.width / 2;
      for (const o of near) {
        // Where it'll be, in its own frame: too close across and along is a hit.
        const ox = o.x + o.vx * s * dt, oz = o.z + o.vz * s * dt;
        const sn = Math.sin(o.rotY), cs = Math.cos(o.rotY);
        const dx = q.x - ox, dz = q.z - oz;
        const across = Math.abs(dx * cs - dz * sn) - o.hx - spec.width / 2 - 0.5;
        const along = Math.abs(dx * sn + dz * cs) - o.hz - spec.length / 2 - 0.8;
        if (across < 0 && along < 0) {
          cost += 300 * (1 + steps - s);
          hit = true;
        }
      }
    }
    const t = line[i];
    const vx = Math.sin(q.rotY) * q.speed + Math.cos(q.rotY) * (q.slip ?? 0), vz = Math.cos(q.rotY) * q.speed - Math.sin(q.rotY) * (q.slip ?? 0);
    const cross = (vx * t.tz - vz * t.tx) / (Math.hypot(vx, vz) || 1);
    return { cost: cost + 30 * cross * cross * steps, hit };
  }
}
