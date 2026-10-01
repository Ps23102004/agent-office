import type { ClientMsg } from '../shared/protocol';
import { CHECKPOINTS, CIRCUIT, crossed, nearestProgress, pointAt, track } from '../shared/circuit';
import type { Practicer, Racer, Timing } from '../shared/race';
import { store, type LiveGap } from './state';

// What you can do about the race at the circuit (shared/race.ts), for the race's panel and HUD
// (ui/race.ts) to call. main.ts wires them to the office and to getting you into a car. How the race
// is going is store.race ('race' topic), kept up to date wherever you are.

interface Wiring {
  send(msg: ClientMsg): void;
  /** Behind the wheel of one of the circuit's cars: the one you're in, else a free one. False if there's none (or you're not at the circuit). */
  intoCar(): boolean;
}

let wiring: Wiring | null = null;

/** main.ts, once it's ready. */
export function wireRace(w: Wiring) {
  wiring = w;
}

/** Whether you're at the circuit (the race is there to join). */
export function atCircuit(): boolean {
  return store.floor === CIRCUIT;
}

/** You, if you're in the race. */
export function myRacer(): Racer | undefined {
  return store.race.racers.find((r) => r.id === store.you);
}

/** Lines you up on the grid, in the car you're driving (or the first free one of the circuit's). False if you can't be. */
export function joinGrid(): boolean {
  if (!wiring || !atCircuit() || myRacer() || !wiring.intoCar()) return false;
  wiring.send({ t: 'race.join' });
  return true;
}

/** Starts the countdown: anyone on the grid can, while it's lining up. */
export function startRace() {
  if (store.race.phase === 'lobby' && myRacer()) wiring?.send({ t: 'race.start' });
}

/** Pulls you out of the race (or off the grid). */
export function leaveRace() {
  if (myRacer()) wiring?.send({ t: 'race.leave' });
}

/** You, if you're on practice laps (driving at the circuit, not in the race). */
export function myPractice(): Practicer | undefined {
  return store.race.practice.find((p) => p.id === store.you);
}

/** Your timing now: the race's while you're in it, else your practice laps'. Sectors, splits and bests are on it (shared/race.ts Timing). */
export function myTiming(): Racer | Practicer | undefined {
  return myRacer() ?? myPractice();
}

/** The checkpoint you're to go through next (racing or on practice laps), or null when there's none: not driving at the circuit, the race not on yet, or you're home. */
export function nextCheckpoint(): number | null {
  if (!atCircuit()) return null;
  const r = myRacer();
  if (r) return store.race.phase === 'racing' && r.finishedAt === undefined ? (r.checkpoint + 1) % CHECKPOINTS : null;
  const p = myPractice();
  return p ? (p.checkpoint + 1) % CHECKPOINTS : null;
}

/** The checkpoint after the last one this page has seen you go through, which may be ahead of what the office has said yet. */
let ahead = -1;

/**
 * Your car went from `from` to `to`: the checkpoint you missed, if that took you through a line out of
 * order (the office won't count it: shared/circuit.ts crossed, server/race.ts). Undefined otherwise,
 * and before you're on a lap (practice laps start at the line).
 */
export function missedCheckpoint(from: { x: number; z: number }, to: { x: number; z: number }, t: Timing | undefined = myTiming()): number | undefined {
  const next = nextCheckpoint();
  if (next === null || !t || t.checkpoint < 0) return undefined;
  const d = (k: number) => (k - next + CHECKPOINTS) % CHECKPOINTS;
  // A few lines ahead of the office at most; anything else is from some other lap or race.
  if (ahead < 0 || d(ahead) > 3) ahead = next;
  for (let i = 0; i < CHECKPOINTS; i++) {
    if (!crossed(i, from, to)) continue;
    if (d(i) > d(ahead)) return ahead;
    if (d(i + 1) > d(ahead)) ahead = (i + 1) % CHECKPOINTS;
  }
  return undefined;
}

// ---- Live, between the office's words: how far round, the wrong way, back on the track, the ghost ----

/** How far round the race someone is (m from the lights going out): their laps, their last line, and how far past it their car at (x, z) has got. */
export function progress(t: { lap?: number; checkpoint: number }, x: number, z: number): number {
  const L = track().length;
  const gap = L / CHECKPOINTS;
  const line = Math.max(0, t.checkpoint) * gap;
  let past = (nearestProgress(x, z).s - line + L) % L;
  // Short of the line (backing up, or not over it yet): behind it, not most of a lap past it.
  if (past > L - gap) past -= L;
  return (t.lap ?? 0) * L + line + past;
}

/** Someone in the race, where their car is now. */
export interface Runner {
  id: string;
  name: string;
  /** progress(); for anyone home, how soon they got there decides it instead. */
  at: number;
  speed: number;
  finishedAt?: number;
}

/** Your place among `runners` (yours is `me`), and the gaps to the cars either side of you. Null if you're not among them. */
export function standings(runners: readonly Runner[], me: string): { position: number; ahead: LiveGap | null; behind: LiveGap | null } | null {
  const order = [...runners].sort((a, b) => (a.finishedAt ?? Infinity) - (b.finishedAt ?? Infinity) || b.at - a.at);
  const i = order.findIndex((r) => r.id === me);
  if (i < 0) return null;
  // How long the one behind takes to get to where the one ahead is, at its pace (walking pace at least).
  const gap = (front: Runner, back: Runner): LiveGap => {
    const metres = Math.max(0, front.at - back.at);
    return { id: (front.id === me ? back : front).id, name: (front.id === me ? back : front).name, metres, seconds: metres / Math.max(10, Math.abs(back.speed)) };
  };
  return { position: i + 1, ahead: i > 0 ? gap(order[i - 1], order[i]) : null, behind: i + 1 < order.length ? gap(order[i], order[i + 1]) : null };
}

/** Seconds of trouble (off the track and slow, stuck, or facing the wrong way) before you're put back on it; and of going the wrong way before you're told. */
export const MARSHAL = { reset: 3, wrongWay: 1, warn: 1 } as const;

/**
 * Keeps an eye on your car while you're on a lap: going the wrong way round, and in trouble long
 * enough to be put back on the track (main.ts does that: shared/circuit.ts resetPose).
 */
export class Marshal {
  private wrong = 0;
  private trouble = 0;
  wrongWay = false;

  /**
   * Each frame, `dt` s: your car facing `rotY` at `speed` m/s at (x, z), off the asphalt or not,
   * your foot down or not. Seconds till it's put back (null: it's fine; 0: now).
   */
  step(dt: number, car: { x: number; z: number; rotY: number; speed: number }, offTrack: boolean, pushing: boolean): number | null {
    const p = pointAt(nearestProgress(car.x, car.z).s);
    const facing = Math.sin(car.rotY) * p.tx + Math.cos(car.rotY) * p.tz;
    this.wrong = car.speed > 2 && facing < -0.3 ? this.wrong + dt : 0;
    this.wrongWay = this.wrong >= MARSHAL.wrongWay;
    const speed = Math.abs(car.speed);
    const stuck = (offTrack && speed < 4) || (pushing && speed < 1) || facing < -0.3;
    this.trouble = stuck ? this.trouble + dt : 0;
    if (this.trouble < MARSHAL.warn) return null;
    return Math.max(0, MARSHAL.reset - this.trouble);
  }

  /** Back on the track (or off a lap): all clear. */
  clear() {
    this.wrong = this.trouble = 0;
    this.wrongWay = false;
  }
}

/** A moment of a lap: how far into it (ms) and where the car was. */
interface Sample {
  t: number;
  x: number;
  z: number;
  rotY: number;
}

/** How often the ghost's lap is written down (ms). */
const GHOST_EVERY = 50;

/**
 * Your best lap this time out, to race against: recorded as you drive (every GHOST_EVERY ms of the
 * lap), and kept when the office says the lap you just did was your best. Only this page's.
 */
export class Ghost {
  private lap: Sample[] = [];
  private best: Sample[] | null = null;
  private bestMs = Infinity;
  /** When the lap being recorded started (office clock). */
  private started: number | undefined;

  /** Each frame on a lap: the lap started at `startedAt` (office clock), your best's `bestLap` ms, your car where it is `now`. */
  record(startedAt: number, bestLap: number | undefined, now: number, car: { x: number; z: number; rotY: number }) {
    if (startedAt !== this.started) {
      // A new lap: the one before, if the office has it as your best (and it's the quickest this page has seen).
      const ms = this.started === undefined ? NaN : startedAt - this.started;
      if (ms === bestLap && ms < this.bestMs && this.lap.length > 1) {
        this.best = this.lap.filter((s) => s.t <= ms);
        this.bestMs = ms;
      }
      this.lap = [];
      this.started = startedAt;
    }
    const t = now - startedAt;
    const last = this.lap[this.lap.length - 1];
    if (!last || t - last.t >= GHOST_EVERY) this.lap.push({ t, x: car.x, z: car.z, rotY: car.rotY });
  }

  /** Where the ghost is `t` ms into a lap: null with no best lap yet, or before its first moment or after its finish. */
  at(t: number): { x: number; z: number; rotY: number } | null {
    const b = this.best;
    if (!b || t < b[0].t || t > b[b.length - 1].t) return null;
    let lo = 0, hi = b.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (b[mid].t <= t) lo = mid;
      else hi = mid;
    }
    const p = b[lo], q = b[hi];
    const k = q.t === p.t ? 0 : (t - p.t) / (q.t - p.t);
    const turn = Math.atan2(Math.sin(q.rotY - p.rotY), Math.cos(q.rotY - p.rotY));
    return { x: p.x + (q.x - p.x) * k, z: p.z + (q.z - p.z) * k, rotY: p.rotY + turn * k };
  }

  /** Your best lap's time (ms), once there's a ghost of it. */
  get time(): number | undefined {
    return this.best ? this.bestMs : undefined;
  }
}
