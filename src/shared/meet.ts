import { CENTER, CIRCUIT, CITY_GATE, PADDOCK } from './circuit.js';
import { FIRE_PIT } from './layout.js';
import { ROOF } from './rooftop.js';

// Meet here: somebody posts one of a few well-known places to the office chat, and anyone can click
// it to be taken there (client/meet.ts). The office checks the spot and how often (server.ts 'meet.post').

/** Where a spot is: on a floor (its office), down on the street under it, up on the roof, or at the circuit. */
export type MeetWhere = 'floor' | 'street' | 'roof' | 'circuit';

export interface MeetSpot {
  name: string;
  icon: string;
  where: MeetWhere;
  /** Where to stand there. */
  x: number;
  z: number;
}

export const MEET_SPOTS = {
  gate: { name: 'the circuit gate', icon: '🏁', where: 'street', x: CITY_GATE.out.x, z: CITY_GATE.out.z },
  lounge: { name: 'the office lounge', icon: '🛋️', where: 'floor', x: 13.5, z: 0 },
  firepit: { name: 'the roof fire pit', icon: '🔥', where: 'roof', x: FIRE_PIT.x, z: FIRE_PIT.z + 2.2 },
  pits: { name: 'the circuit pits', icon: '🏎️', where: 'circuit', x: CENTER.x, z: PADDOCK.minZ + 18 },
} as const satisfies Record<string, MeetSpot>;

export type MeetSpotId = keyof typeof MEET_SPOTS;

/** A meeting spot posted to chat: the spot, and the floor it's on (or under) when that matters. */
export interface MeetPin {
  spot: MeetSpotId;
  floor?: string;
}

/** How often one person can post a meeting spot (ms). */
export const MEET_EVERY = 20_000;

export function isMeetSpot(v: unknown): v is MeetSpotId {
  return typeof v === 'string' && Object.hasOwn(MEET_SPOTS, v);
}

/** The floor id (peer.floor) a pin is on: ROOF, CIRCUIT, or the floor it names. */
export function pinFloor(pin: MeetPin): string | undefined {
  const where = MEET_SPOTS[pin.spot].where;
  return where === 'roof' ? ROOF : where === 'circuit' ? CIRCUIT : pin.floor;
}
