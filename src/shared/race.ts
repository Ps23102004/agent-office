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
}

/** Someone driving practice laps at the circuit, on their own, outside the race. */
export interface Practicer extends Timing {
  id: string;
  name: string;
  car: number;
  /** Whole practice laps done this time out. */
  laps: number;
  /** The last whole lap's time (ms). */
  lastLap?: number;
}

export interface RaceState {
  phase: RacePhase;
  laps: number;
  /** When the lights go out (epoch ms), counting down. */
  startsAt?: number;
  /** When the first one home finished (epoch ms): the rest have a while to follow before it's over. */
  firstHomeAt?: number;
  racers: Racer[];
  /** The fastest lap anyone's done here since the office started: who and how long (ms). */
  record?: { name: string; ms: number };
  /** Everyone at the circuit driving a car and not in the race: their practice laps. */
  practice: Practicer[];
  /** The fastest practice lap since the office started, kept apart from the race record. */
  practiceRecord?: { name: string; ms: number };
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
