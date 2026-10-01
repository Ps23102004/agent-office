import type { ClientMsg } from '../shared/protocol';
import { CHECKPOINTS, CIRCUIT, crossed } from '../shared/circuit';
import type { Practicer, Racer, Timing } from '../shared/race';
import { store } from './state';

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
