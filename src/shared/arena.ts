import type { Gate } from './circuit.js';

// The arena: a walled container yard of its own, like the race circuit, reached through a second gate
// on the race plaza in the city. Everyone there is in one free-for-all: a rifle each, first to the
// kill limit wins. Shots are the office's to judge (server/arena.ts): a page says where it fired from
// and which way, and the office works out what that hit, against where everyone is and the yard's
// cover. Everything here is plain numbers, no three.js; client/world/arena.ts draws it.

/** Where you are while you're in the arena (a peer's `floor`, and `floor.go`'s): never a project floor's id. */
export const ARENA = '@arena';
export const ARENA_NAME = 'Arena';

/** The arena's middle, out in the world: a long way from the city and the circuit. */
export const ARENA_CENTER = { x: -3000, z: 0 } as const;
/** Half the yard's width inside its walls (m), and how high they are. */
export const ARENA_HALF = 36;
export const WALL_H = 6;

/** A solid box in the yard (m, world coordinates): something to hide behind or climb on. */
export interface ArenaBox {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Bottom and top. */
  y0: number;
  y1: number;
  kind: 'container' | 'crate' | 'wall' | 'barrier';
  /** Which paint it gets (client/world/arena.ts). */
  paint: number;
}

const box = (x: number, z: number, sx: number, sz: number, h: number, kind: ArenaBox['kind'], paint = 0, y0 = 0): ArenaBox => ({
  minX: ARENA_CENTER.x + x - sx / 2,
  maxX: ARENA_CENTER.x + x + sx / 2,
  minZ: ARENA_CENTER.z + z - sz / 2,
  maxZ: ARENA_CENTER.z + z + sz / 2,
  y0,
  y1: y0 + h,
  kind,
  paint,
});

/** A container's height and width; they're 12 m long. */
const CH = 2.6, CW = 2.5;

/**
 * Half the yard (from its middle, m): the other half is the same turned round (x, z → -x, -z), so
 * nobody's side is better. A two-container block in the middle with crates to climb it, a pinwheel of
 * containers round it, low barriers across the lanes, crates piled in the corners and a stack of two
 * containers on each side wall. Crates are 1.2 m: jump onto one, then onto a container.
 */
const HALF: readonly ArenaBox[] = [
  box(0, 1.3, 6, CW, CH, 'container', 0),
  box(4.2, 2.2, 1.2, 1.2, 1.2, 'crate'),
  box(12, -6, CW, 12, CH, 'container', 1),
  box(-6, -12, 12, CW, CH, 'container', 2),
  box(22, 10, 0.6, 8, 1.15, 'barrier'),
  box(10, -22, 8, 0.6, 1.15, 'barrier'),
  box(26, 26, 1.4, 1.4, 1.4, 'crate'),
  box(27.6, 26, 1.4, 1.4, 1.4, 'crate'),
  box(26, 27.6, 1.4, 1.4, 2.8, 'crate'),
  box(26, -26, 1.4, 1.4, 1.4, 'crate'),
  box(26, -27.6, 1.4, 1.4, 1.4, 'crate'),
  box(29, 0, CW, 12, CH, 'container', 3),
  box(29, 0, CW, 12, CH, 'container', 0, CH),
  box(18, 18, 1.2, 1.2, 1.2, 'crate'),
  box(-2, -20, 1.2, 1.2, 1.2, 'crate'),
];

/** The four walls round the yard, a metre thick. */
const WALLS: readonly ArenaBox[] = [
  box(0, ARENA_HALF + 0.5, ARENA_HALF * 2 + 2, 1, WALL_H, 'wall'),
  box(0, -ARENA_HALF - 0.5, ARENA_HALF * 2 + 2, 1, WALL_H, 'wall'),
  box(ARENA_HALF + 0.5, 0, 1, ARENA_HALF * 2 + 2, WALL_H, 'wall'),
  box(-ARENA_HALF - 0.5, 0, 1, ARENA_HALF * 2 + 2, WALL_H, 'wall'),
];

const turned = (b: ArenaBox): ArenaBox => ({
  ...b,
  minX: 2 * ARENA_CENTER.x - b.maxX,
  maxX: 2 * ARENA_CENTER.x - b.minX,
  minZ: 2 * ARENA_CENTER.z - b.maxZ,
  maxZ: 2 * ARENA_CENTER.z - b.minZ,
});

/** Everything solid in the arena: its cover and its walls. */
export const ARENA_BOXES: readonly ArenaBox[] = [...HALF, ...HALF.map(turned), ...WALLS];

/** Where people come back in after they're killed, round the edge of the yard; each faces the middle. */
export const SPAWNS: readonly { x: number; z: number; rotY: number }[] = (
  [
    [33, -8], [-33, 8], [8, -33], [-8, 33], [32, 32], [-32, -32], [32, -32], [-32, 32], [16, 31], [-16, -31],
  ] as const
).map(([x, z]) => ({ x: ARENA_CENTER.x + x, z: ARENA_CENTER.z + z, rotY: Math.atan2(-x, -z) }));

/**
 * The gate home, against the middle of the south wall: through it heading south (+z), into the wall.
 * You arrive just in front of it, facing into the yard.
 */
export const ARENA_GATE: Gate = { x: ARENA_CENTER.x, z: ARENA_CENTER.z + 33.5, rotY: 0, width: 8, out: { x: ARENA_CENTER.x, z: ARENA_CENTER.z + 29, rotY: Math.PI } };

/**
 * The gate to the arena, on the east side of the race plaza in the city (city.ts RACE_PLAZA), beside
 * the circuit's: through it heading east. Coming back, you come out in front of it, facing the plaza.
 */
export const CITY_ARENA_GATE: Gate = { x: 72, z: -66, rotY: Math.PI / 2, width: 8, out: { x: 66, z: -66, rotY: -Math.PI / 2 } };

// ---- The rules ------------------------------------------------------------------------------------

export const RULES = {
  /** Health, and what a shot takes off it: anywhere, or in the head. */
  hp: 100,
  body: 25,
  head: 50,
  /** Rounds in the rifle, ms between shots, and ms to reload. */
  mag: 30,
  every: 100,
  reload: 1800,
  /** How far a shot goes (m). */
  range: 120,
  /** Seconds dead before you're back in, and safe from shots after (unless you shoot first). */
  respawn: 3,
  safe: 1.5,
  /** Seconds unhurt before you heal, and how fast (health a second). */
  healAfter: 4,
  heal: 60,
  /** Kills to win, minutes a match lasts at most, and seconds the results stay up. */
  limit: 20,
  minutes: 8,
  results: 12,
  /** Fewer in the arena than this, it's warm-up: shoot away, nothing's counted. */
  players: 2,
} as const;

/** Where someone stands, and how tall they are to be hit (m): a body up to HEAD_Y, then the head. */
export const BODY_R = 0.42;
export const BODY_H = 1.75;
export const HEAD_Y = 1.3;
/** Where the eyes are, above the feet: where a shot leaves from. */
export const EYE_Y = 1.4;

export type ArenaPhase = 'warmup' | 'live' | 'over';

export interface ArenaPlayer {
  id: string;
  name: string;
  kills: number;
  deaths: number;
  /** Kills since they last died. */
  streak: number;
  hp: number;
  alive: boolean;
  /** When they're back in (epoch ms), while they're dead. */
  respawnAt?: number;
}

export interface KillLine {
  at: number;
  killer: string;
  victim: string;
  head: boolean;
}

export interface ArenaState {
  phase: ArenaPhase;
  /** When a live match runs out of time; when the results come down. Epoch ms. */
  endsAt?: number;
  /** Whoever won the last match, while its results are up. */
  winner?: string;
  players: ArenaPlayer[];
  /** The last few kills, newest last. */
  feed: KillLine[];
}

export function idleArena(): ArenaState {
  return { phase: 'warmup', players: [], feed: [] };
}

// ---- Rays ------------------------------------------------------------------------------------------

export interface V3 {
  x: number;
  y: number;
  z: number;
}

/** How far along the ray from `o` going `d` (a unit vector) it goes into box `b`, or Infinity if it misses. */
export function rayBox(o: V3, d: V3, b: { minX: number; maxX: number; minZ: number; maxZ: number; y0: number; y1: number }): number {
  let near = 0, far = Infinity;
  for (const [p, v, lo, hi] of [
    [o.x, d.x, b.minX, b.maxX],
    [o.y, d.y, b.y0, b.y1],
    [o.z, d.z, b.minZ, b.maxZ],
  ] as const) {
    if (Math.abs(v) < 1e-9) {
      if (p < lo || p > hi) return Infinity;
      continue;
    }
    let t0 = (lo - p) / v, t1 = (hi - p) / v;
    if (t0 > t1) [t0, t1] = [t1, t0];
    near = Math.max(near, t0);
    far = Math.min(far, t1);
    if (near > far) return Infinity;
  }
  return near;
}

/** How far the ray goes before the yard stops it: a box, the ground, or its range. */
export function rayWorld(o: V3, d: V3, range: number = RULES.range): number {
  let t = range;
  if (d.y < 0) t = Math.min(t, -o.y / d.y);
  for (const b of ARENA_BOXES) t = Math.min(t, rayBox(o, d, b));
  return Math.max(0, t);
}

/**
 * Where the ray from `o` going `d` first touches someone standing with their feet at `p` (`r` round
 * them, a little more than they are for a laggy connection's sake): how far along, and whether it's
 * their head. Undefined if it misses them.
 */
export function rayPerson(o: V3, d: V3, p: V3, r: number = BODY_R): { t: number; head: boolean } | undefined {
  // Their upright cylinder, seen from above first.
  const ox = o.x - p.x, oz = o.z - p.z;
  const a = d.x * d.x + d.z * d.z;
  const b = 2 * (ox * d.x + oz * d.z);
  const c = ox * ox + oz * oz - r * r;
  let t0: number, t1: number;
  if (a < 1e-9) {
    // Straight up or down.
    if (c > 0) return undefined;
    [t0, t1] = [-Infinity, Infinity];
  } else {
    const disc = b * b - 4 * a * c;
    if (disc < 0) return undefined;
    const s = Math.sqrt(disc);
    [t0, t1] = [(-b - s) / (2 * a), (-b + s) / (2 * a)];
  }
  // Then the stretch of that inside their height.
  if (Math.abs(d.y) > 1e-9) {
    let y0 = (p.y - o.y) / d.y, y1 = (p.y + BODY_H - o.y) / d.y;
    if (y0 > y1) [y0, y1] = [y1, y0];
    t0 = Math.max(t0, y0);
    t1 = Math.min(t1, y1);
  } else if (o.y < p.y || o.y > p.y + BODY_H) return undefined;
  if (t0 > t1 || t1 < 0) return undefined;
  const t = Math.max(0, t0);
  // The head, if it goes in above the shoulders, or passes through up there.
  const head = o.y + d.y * t >= p.y + HEAD_Y || o.y + d.y * ((t + t1) / 2) >= p.y + HEAD_Y;
  return { t, head };
}

/** Whether (x, z) is inside the arena's walls (with a little room for whoever's standing there). */
export function inArena(x: number, z: number): boolean {
  return Math.abs(x - ARENA_CENTER.x) < ARENA_HALF + 2 && Math.abs(z - ARENA_CENTER.z) < ARENA_HALF + 2;
}
