// The race circuit: a place of its own (like the rooftop bar) reached through a gate in the city.
// Anyone there can line up on the grid; when the race starts, everyone on the grid races the laps,
// through the checkpoints in order, and the office keeps the positions and lap times for everyone
// (server/race.ts). The circuit's shape, the physics and who's where are the circuit's pages'
// (client/world/circuit.ts); what the race looks like on screen is client/ui/race.ts.

/** Where the race is: nobody lined up, lining up, counting down, going, or everyone's in. */
export type RacePhase = 'idle' | 'lobby' | 'countdown' | 'racing' | 'finished';

/** Someone in the race (PeerInfo id), and how they're getting on. */
export interface Racer {
  id: string;
  name: string;
  /** What they drive: an index into the circuit's own cars (see client/world/circuit.ts). */
  car: number;
  /** Their grid slot, from the front. */
  slot: number;
  /** Laps done, and the last checkpoint they went through on this one (-1 before the first). */
  lap: number;
  checkpoint: number;
  /** When they crossed the line for the last time (epoch ms), once they have. */
  finishedAt?: number;
  /** Their fastest whole lap, ms. */
  bestLap?: number;
  /** When they started the lap they're on (epoch ms), for the live lap clock. */
  lapStartedAt?: number;
  /** Where they are in the order, 1 first. */
  position: number;
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
} as const;

export function idleRace(): RaceState {
  return { phase: 'idle', laps: RACE.laps, racers: [] };
}
