// The café and the bar out in the city, a street east of the office (client/world/venues.ts builds
// them): Café Corner on the office's side of the street, facing it, and The Night Owl across from it.
// You walk in through the door, sit down and order. Plain numbers here, no three.js and nothing
// imported at run time, so the city (shared/city.ts: the lots they stand on, their walls in its
// solids) and the office's seats (shared/layout.ts SEATING) can both use them.

import type { SeatDef } from './layout.js';

export type VenueId = 'cafe' | 'bar';

interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface Venue {
  id: VenueId;
  name: string;
  /** The building's footprint, walls included. */
  box: Box;
  /** Which way its front faces: the street at +z (1) or -z (-1). */
  fz: 1 | -1;
  /** The doorway in the front wall: its middle and how wide it is. */
  door: { x: number; w: number };
  /** Out front, between the building and the sidewalk: tables outside. */
  terrace: Box;
  /** How high the room's ceiling is, and how tall the building stands outside (floors over it). */
  ceiling: number;
  height: number;
}

/** How thick the walls are. */
export const VENUE_WALL = 0.25;

export const VENUES: readonly Venue[] = [
  {
    id: 'cafe',
    name: 'Café Corner',
    box: { minX: 61, maxX: 75, minZ: 5, maxZ: 17 },
    fz: 1,
    door: { x: 64, w: 1.6 },
    terrace: { minX: 61, maxX: 75, minZ: 17, maxZ: 21 },
    ceiling: 3.4,
    height: 7.4,
  },
  {
    id: 'bar',
    name: 'The Night Owl',
    box: { minX: 59, maxX: 77, minZ: 37, maxZ: 51 },
    fz: -1,
    door: { x: 62.2, w: 1.6 },
    terrace: { minX: 59, maxX: 77, minZ: 33, maxZ: 37 },
    ceiling: 3.6,
    height: 10.4,
  },
];

export const VENUE_BY_ID = new Map(VENUES.map((v) => [v.id, v]));

/** The front wall's line (z). */
export const frontZ = (v: Venue) => (v.fz > 0 ? v.box.maxZ : v.box.minZ);

/** The walls round the room, a box each, with the doorway left open in the front one: what's solid of it. */
export function venueWalls(v: Venue): Box[] {
  const { minX, maxX, minZ, maxZ } = v.box;
  const t = VENUE_WALL;
  const f = frontZ(v);
  const back = v.fz > 0 ? minZ : maxZ;
  const fz0 = v.fz > 0 ? f - t : f;
  const bz0 = v.fz > 0 ? back : back - t;
  return [
    { minX, maxX, minZ: bz0, maxZ: bz0 + t },
    { minX, maxX: minX + t, minZ, maxZ },
    { minX: maxX - t, maxX, minZ, maxZ },
    { minX, maxX: v.door.x - v.door.w / 2, minZ: fz0, maxZ: fz0 + t },
    { minX: v.door.x + v.door.w / 2, maxX, minZ: fz0, maxZ: fz0 + t },
  ];
}

/** Which venue (x, z) is inside, between its walls, or null. */
export function venueAt(x: number, z: number): Venue | null {
  return VENUES.find((v) => x > v.box.minX && x < v.box.maxX && z > v.box.minZ && z < v.box.maxZ) ?? null;
}

const inBox = (b: Box, x: number, z: number) => x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ;

/** Whether (x, z) is in venue `id` or out on its terrace. */
export function atVenue(id: VenueId, x: number, z: number): boolean {
  const v = VENUE_BY_ID.get(id)!;
  return inBox(v.box, x, z) || inBox(v.terrace, x, z);
}

/** Down on the street (a peer's y is under the bottom floor's, whichever floor they came down from). */
const STREET_BELOW = -1;

/**
 * Whether the office lets someone hold a drink, where they are: up on the roof (its Sky Bar), or on
 * the office's own map down at The Night Owl or on its terrace. Not on the circuit, nor on another map.
 */
export function mayHoldDrink(at: { roof: boolean; officeMap: boolean; circuit: boolean; x: number; y: number; z: number }): boolean {
  return at.roof || (at.officeMap && !at.circuit && at.y < STREET_BELOW && atVenue('bar', at.x, at.z));
}

/** How far from a seat out in the city you can be and still sit down on it (the last move you sent may lag a step). */
export const STREET_SEAT_REACH = 4;

/** Whether someone at `p` can sit on the city seat whose place is at (x, z): down on the street close by, not on the circuit. */
export function streetSeatNear(place: { x: number; z: number }, p: { x: number; y: number; z: number }, circuit: boolean): boolean {
  return !circuit && p.y < STREET_BELOW && Math.hypot(p.x - place.x, p.z - place.z) <= STREET_SEAT_REACH;
}

/**
 * Where a vehicle can't be: anywhere inside the café's or the bar's walls (a bike fits the door,
 * but it doesn't go in). For the office's checks on a car's moves (server/garage.ts).
 */
export const vehicleBarred = (x: number, z: number) => venueAt(x, z) !== null;

/**
 * Boxes across the doorways, for vehicles only (people walk through): what driving bumps into there,
 * besides citySolids. Shared and never changed.
 */
export const VENUE_DOORS: readonly Box[] = VENUES.map((v) => {
  const f = v.fz > 0 ? v.box.maxZ : v.box.minZ;
  return { minX: v.door.x - v.door.w / 2, maxX: v.door.x + v.door.w / 2, minZ: f - VENUE_WALL, maxZ: f + VENUE_WALL };
});

/** The parts of a front wall round its openings (door, windows), as rectangles in x and y. */
export function wallPieces(x0: number, x1: number, y0: number, y1: number, holes: readonly { x0: number; x1: number; y0: number; y1: number }[]) {
  const cuts = [x0, x1, ...holes.flatMap((h) => [h.x0, h.x1])].sort((a, b) => a - b);
  const out: { x0: number; x1: number; y0: number; y1: number }[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i];
    const b = cuts[i + 1];
    if (b - a < 1e-3) continue;
    const h = holes.find((o) => o.x0 <= a + 1e-6 && o.x1 >= b - 1e-6);
    if (!h) out.push({ x0: a, x1: b, y0, y1 });
    else {
      if (h.y0 > y0) out.push({ x0: a, x1: b, y0, y1: h.y0 });
      if (h.y1 < y1) out.push({ x0: a, x1: b, y0: h.y1, y1 });
    }
  }
  return out;
}

// ---- Where you can sit ---------------------------------------------------------------------------
// `y` is above the street, which is further down the higher the floor you came down from (the
// client puts them there: see `street`). At the café, E sitting down orders a coffee; at the bar, a drink.

const chair = { hips: 0.48, depth: 0, out: -0.75, street: true } as const;
const stool = { hips: 0.78, depth: 0, out: -0.75, street: true } as const;
const sofa = { hips: 0.48, depth: 0.05, out: 0.85, street: true } as const;
const E = Math.PI / 2;

/** A table's two chairs, one either side of it along x, facing it. */
const pair = (id: string, label: string, x: number, z: number, more: Partial<SeatDef>): SeatDef[] => [
  { id: `${id}-w`, label, x: x - 0.75, y: 0, z, rotY: E, places: [0], ...chair, ...more },
  { id: `${id}-e`, label, x: x + 0.75, y: 0, z, rotY: -E, places: [0], ...chair, ...more },
];

/** The café's and the bar's seats, ids starting `cafe-` and `bar-` (SEATING has them). */
export const VENUE_SEATS: SeatDef[] = [
  // Café Corner: two tables in the middle of the room, three stools at the window looking out, the
  // sofa by the door, and two tables out on the terrace under the parasols.
  ...pair('cafe-t1', '🪑 Café chair', 67.2, 11.9, { cafe: true }),
  ...pair('cafe-t2', '🪑 Café chair', 70.6, 11.9, { cafe: true }),
  ...[67, 69.5, 72].map((x, i): SeatDef => ({ id: `cafe-window-${i + 1}`, label: '🪑 Window stool', x, y: 0, z: 15.6, rotY: 0, places: [0], ...stool, cafe: true })),
  { id: 'cafe-sofa', label: '🛋️ Café sofa', x: 61.7, y: 0, z: 8.6, rotY: E, places: [-0.5, 0.5], ...sofa, cafe: true },
  ...pair('cafe-out1', '☀️ Terrace chair', 66.5, 19.2, { cafe: true }),
  ...pair('cafe-out2', '☀️ Terrace chair', 71.5, 19.2, { cafe: true }),
  // The Night Owl: stools along the bar (facing it, east), the booth by the west wall, two high tables.
  ...[40.3, 41.9, 43.5, 45.1, 46.7].map((z, i): SeatDef => ({ id: `bar-stool-${i + 1}`, label: '🪑 Bar stool', x: 72.35, y: 0, z, rotY: E, places: [0], ...stool, bar: true })),
  { id: 'bar-booth', label: '🛋️ Booth', x: 59.67, y: 0, z: 41.6, rotY: E, places: [-0.5, 0.5], ...sofa, bar: true },
  ...[41.8, 46.6].flatMap((z, i): SeatDef[] => [
    { id: `bar-high${i + 1}-s`, label: '🪑 High stool', x: 66, y: 0, z: z - 0.75, rotY: 0, places: [0], ...stool, bar: true },
    { id: `bar-high${i + 1}-n`, label: '🪑 High stool', x: 66, y: 0, z: z + 0.75, rotY: Math.PI, places: [0], ...stool, bar: true },
  ]),
  ...pair('bar-out', '🌙 Terrace stool', 66, 35, { bar: true, hips: 0.78 }),
];
