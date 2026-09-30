import type { ClientMsg } from '../shared/protocol';
import { CIRCUIT } from '../shared/circuit';
import type { Racer } from '../shared/race';
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
