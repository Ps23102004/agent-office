import { idleRace, type RaceState } from '../../shared/race';
import type { PeerInfo } from '../../shared/protocol';
import { store } from '../state';
import { toast } from './dom';
import type { MapPoint } from './race-view';

export interface CircuitMap {
  outline: readonly MapPoint[];
  dots: readonly (MapPoint & { id: string; name: string })[];
}

/** W2 supplies its store and actions here; the UI never sends race protocol messages itself. */
export interface RaceAdapter {
  store: { readonly race: RaceState };
  available(): boolean;
  atCircuit(): boolean;
  peerAtCircuit(peer: PeerInfo): boolean;
  now(): number;
  carName(car: number): string;
  map(): CircuitMap | null;
  startRace(): void;
  joinGrid(): void;
  leaveRace(): void;
}

const unavailable = () => { toast('The circuit is not ready yet', 'warn'); };

/** Local stub, deliberately idle. Merge wiring is one line: wireRaceUI({ store, startRace, joinGrid, leaveRace, … }). */
export const raceAdapter: RaceAdapter = {
  store: { race: idleRace() },
  available: () => false,
  atCircuit: () => false,
  peerAtCircuit: () => false,
  now: () => store.officeNow(),
  carName: (car) => `Circuit car ${car + 1}`,
  map: () => null,
  startRace: unavailable,
  joinGrid: unavailable,
  leaveRace: unavailable,
};

/** Call once with W2's live source. Existing windows and the HUD pick it up on their next update. */
export function wireRaceUI(source: RaceAdapter) {
  Object.assign(raceAdapter, source);
}
