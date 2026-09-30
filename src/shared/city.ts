// The city's street grid, shared by the page that draws it (client/world/city.ts), the street life
// on it (traffic, people on the sidewalks) and the office that checks where a driver says they are.
// Streets run down x = STREET_X + PERIOD·k and z = STREET_Z + PERIOD·k; the one past the garage is
// z = STREET_Z (layout.ts ROAD).

/** A block and the street beside it (m). */
export const PERIOD = 56;
export const STREET_X = 28;
export const STREET_Z = 27;
/** The road's width, and a sidewalk either side of it. */
export const ROAD_W = 8;
export const WALK = 2;
/** How far out the city goes: past this the haze has it anyway. */
export const RADIUS = 330;

/** The same numbers every time for a seed, so everyone sees the same city. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Somewhere flat on the ground, x and z (the same shape as garage.ts Box). */
export interface Area {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * Whether (x, z) is out on the city's streets or sidewalks, where a car can go (the garage and its
 * lots are garage.ts PAVEMENT). Not on anyone's lot, and not out past RADIUS.
 */
// ponytail: stub until the open-world pass lays the streets out (see client/world/city.ts).
export function cityPaved(_x: number, _z: number): boolean {
  return false;
}

/** What stands in the way within `reach` of (x, z) out in the city: buildings, lamp posts, trees. */
export function citySolids(_x: number, _z: number, _reach: number): Area[] {
  return [];
}
