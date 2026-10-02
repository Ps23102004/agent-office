import { nearestProgress, pointAt } from './circuit.js';
import type { BotLevel, BotSettings } from './bots.js';

// The race circuit: a place of its own (like the rooftop bar) reached through a gate in the city.
// Anyone there can line up on the grid; when the race starts, everyone on the grid races the laps,
// through the checkpoints in order, and the office keeps the positions and lap times for everyone
// (server/race.ts). The circuit's shape, the physics and who's where are the circuit's pages'
// (client/world/circuit.ts); what the race looks like on screen is client/ui/race.ts.

/** Where the race is: nobody lined up, lining up, counting down, going, or everyone's in. */
export type RacePhase = 'idle' | 'lobby' | 'countdown' | 'racing' | 'finished';

/**
 * The lap split in three sectors: each starts at one of these checkpoints (the first at the start
 * line) and ends at the next one's. The office times them (server/race.ts), racing or practising.
 */
export const SECTORS = [0, 11, 22] as const;

/** A sector just done: which, how long it took (ms), and against your best before it (ms, - is quicker). */
export interface Split {
  sector: number;
  ms: number;
  delta?: number;
}

/** A driver's timing round the circuit, as the office keeps it (racing, or practice laps). */
export interface Timing {
  /** The last checkpoint they went through on this lap (-1: not on a lap yet). */
  checkpoint: number;
  /** When they started the lap they're on (epoch ms), for the live lap clock. */
  lapStartedAt?: number;
  /** Their fastest whole lap, ms. */
  bestLap?: number;
  /** The last whole lap's time (ms): one the office counted. */
  lastLap?: number;
  /** This lap's sector times so far (ms), in SECTORS order. */
  sectors?: number[];
  /** Their fastest time for each sector (ms; null: none yet). */
  bestSectors?: (number | null)[];
  /** The sector they've just done. */
  lastSplit?: Split;
}

/** Someone in the race (PeerInfo id), and how they're getting on. */
export interface Racer extends Timing {
  id: string;
  name: string;
  /** What they drive: an index into the circuit's own cars (see client/world/circuit.ts). */
  car: number;
  /** Their grid slot, from the front. */
  slot: number;
  /** Laps done (checkpoint is the last one they went through on this one). */
  lap: number;
  /** When they crossed the line for the last time (epoch ms), once they have. */
  finishedAt?: number;
  /** Where they are in the order, 1 first. */
  position: number;
  /** How far (ms) they went through their last checkpoint behind whoever went through it first on the same lap: 0 for them. */
  gap?: number;
  /** One of the office's own racers (server/racebots.ts, shared/racebot.ts), at this level; its id starts with BOT_ID. */
  bot?: BotLevel;
}

/** Someone driving practice laps at the circuit, on their own, outside the race. */
export interface Practicer extends Timing {
  id: string;
  name: string;
  car: number;
  /** Whole practice laps done this time out. */
  laps: number;
  /** One of the office's own racers, out on practice laps at this level for someone to chase (`rabbitOf`, a PeerInfo id: `race.rabbit`). Never on the practice record. */
  bot?: BotLevel;
  rabbitOf?: string;
}

export interface RaceState {
  phase: RacePhase;
  laps: number;
  /** When the lights go out (epoch ms), counting down. */
  startsAt?: number;
  /** When the first person home finished (epoch ms; a bot home first starts no clock): the rest have a while to follow before it's over. */
  firstHomeAt?: number;
  racers: Racer[];
  /** The fastest lap anyone's done here since the office started: who and how long (ms). Never a bot's. */
  record?: { name: string; ms: number };
  /** Everyone at the circuit driving a car and not in the race: their practice laps. */
  practice: Practicer[];
  /** The fastest practice lap since the office started, kept apart from the race record. */
  practiceRecord?: { name: string; ms: number };
  /**
   * The office's own racers (server/racebots.ts): lining up, bots top the grid up to `fill` racers,
   * people included (1: none), at `level`; `by` who last changed it. Set with `race.bots`. A race
   * already on keeps the bots it started with.
   */
  bots?: BotSettings;
}

export const RACE = {
  /** Laps in a race. */
  laps: 3,
  /** Seconds of countdown once someone starts it. */
  countdown: 5,
  /** Grid slots. */
  slots: 8,
  /** Seconds the others get after the winner before the race ends without them. */
  grace: 30,
  /** Seconds the results stay up once it's over, before the circuit's idle again (or until someone lines up for the next). */
  results: 45,
} as const;

export function idleRace(): RaceState {
  return { phase: 'idle', laps: RACE.laps, racers: [], practice: [] };
}

/** Which sector checkpoint `i` is in. */
export function sectorOf(i: number): number {
  let k = 0;
  while (k + 1 < SECTORS.length && i >= SECTORS[k + 1]) k++;
  return k;
}

/** Seconds of trouble (off the track and slow, stuck, or facing the wrong way) before you're put back on it; and of going the wrong way before you're told. */
export const MARSHAL = { reset: 3, wrongWay: 1, warn: 1 } as const;

/**
 * Keeps an eye on your car while you're on a lap: going the wrong way round, and in trouble long
 * enough to be put back on the track (shared/circuit.ts resetSpots: a person's page does it, client/main.ts,
 * and the office for its bots, server/racebots.ts).
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
