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
/** A concrete barrier's height: over it standing, hidden behind it crouching (see CROUCH). */
const BARRIER_H = 1.3;

/**
 * Half the yard (from its middle, m): the other half is the same turned round (x, z → -x, -z), so
 * nobody's side is better. A two-container block in the middle with crates to climb it, a pinwheel of
 * containers round it, low barriers across the lanes, crates piled in the corners and a stack of two
 * containers on each side wall. Crates are 1.2 m: jump at one and you climb up (see client/player.ts
 * MANTLE), then up again onto a container.
 */
const HALF: readonly ArenaBox[] = [
  box(0, 1.3, 6, CW, CH, 'container', 0),
  box(4.2, 2.2, 1.2, 1.2, 1.2, 'crate'),
  box(12, -6, CW, 12, CH, 'container', 1),
  box(-6, -12, 12, CW, CH, 'container', 2),
  box(22, 10, 0.6, 8, BARRIER_H, 'barrier'),
  box(10, -22, 8, 0.6, BARRIER_H, 'barrier'),
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

/**
 * Where someone stands, and how they're shaped to be hit, as character.ts draws a Person (m): a body
 * BODY_R round from their feet up to HEAD_Y, and above it the head, a ball HEAD_R round its middle at
 * HEAD_C. BODY_H is how tall they stand, hair and all.
 */
export const BODY_R = 0.42;
export const BODY_H = 1.75;
export const HEAD_Y = 1.0;
export const HEAD_C = 1.32;
export const HEAD_R = 0.34;
/** Where the eyes are, above the feet: where a shot leaves from. */
export const EYE_Y = 1.4;
/** How much lower crouching puts your eyes, your head and the top of your body (m). */
export const CROUCH = 0.32;

/** Someone to be hit: where their feet are, and whether they're crouching. */
export interface Body extends V3 {
  crouch?: boolean;
}

/** Where `p`'s eyes are, crouching or not. */
export const eyeY = (p: { y: number; crouch?: boolean }) => p.y + EYE_Y - (p.crouch ? CROUCH : 0);

/**
 * How wide a shot goes (radians), round where you're looking: from the hip standing still, more the
 * faster you move (`move` at walking pace, WALK m/s) and in the air, less the more you're aiming down
 * the sights (`ads`, which only halves what moving adds) and crouching (`crouch`), plus the bloom from
 * firing (`perShot` a round, up to `maxBloom`, settling at `settle` a second). Everyone's the same:
 * people (client/arena.ts) and bots.
 */
export const SPREAD = { hip: 0.012, move: 0.02, air: 0.045, ads: 0.15, crouch: 0.7, perShot: 0.006, maxBloom: 0.03, settle: 0.08 };
/** How far each shot kicks the view up (radians), and sideways at most, and how quickly it settles. */
export const KICK = { up: 0.012, side: 0.004, settle: 9 };
/** Walking pace (m/s), what SPREAD.move is for: client/player.ts's WALK. */
const WALK = 4.6;

/** How wide a shot goes (radians): moving at `speed` (m/s), on the ground or not, `ads` (0 to 1) down the sights, with `bloom` from firing; crouching, steadier. */
export function spreadOf(speed: number, grounded: boolean, ads: number, bloom: number, crouch = false): number {
  const still = (SPREAD.hip + bloom + (grounded ? 0 : SPREAD.air)) * (1 - ads * (1 - SPREAD.ads));
  return (still + SPREAD.move * Math.min(1.6, speed / WALK) * (1 - ads * 0.5)) * (crouch ? SPREAD.crouch : 1);
}

/**
 * When your next shot can go, holding the trigger down, after one that was due at `due` went at `now`
 * (a frame late, likely): in its slot, so a late frame doesn't slow the rifle down. Unless it's late
 * by more than half a gap (the trigger was let go a while, or the page stalled): then from now, so
 * two shots never come closer than half a gap.
 */
export const nextShot = (due: number, now: number, every: number = RULES.every) => (now - due > every / 2 ? now : due) + every;

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
  /** Safe from shots till then (epoch ms), just back in; gone once they fire. */
  safeUntil?: number;
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
  /**
   * In warm-up only, the practice targets (see targetAt): when each is back up after it's been shot
   * down (epoch ms), or 0 while it's standing.
   */
  targets?: number[];
}

/**
 * What became of a shot, as the office judged it (server/arena.ts) and tells everyone in the arena
 * (arena.shot): where it stopped, and who it hit, `hit` (a peer id) or the practice `target` (its
 * index). Then whether in the `head`, the damage it did (`dmg`) and what they have left (`hp`), and
 * whether that killed them (`kill`, with the shooter's `streak` counting it). `shield`: who it hit
 * that was still safe (see ArenaPlayer.safeUntil), doing them no harm.
 */
export interface ShotResult {
  end: V3;
  hit?: string;
  target?: number;
  head?: boolean;
  dmg?: number;
  hp?: number;
  kill?: boolean;
  streak?: number;
  shield?: string;
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

/** How far along the ray from `o` going `d` (a unit vector) it goes into the ball round `c`, or undefined if it misses. */
function raySphere(o: V3, d: V3, c: V3, r: number): number | undefined {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const disc = b * b - (ox * ox + oy * oy + oz * oz - r * r);
  if (disc < 0) return undefined;
  const s = Math.sqrt(disc);
  if (-b + s < 0) return undefined;
  return Math.max(0, -b - s);
}

/** How far along the ray it goes into the upright column `r` round `p`, from its feet up to `top`, or undefined if it misses. */
function rayColumn(o: V3, d: V3, p: V3, r: number, top: number): number | undefined {
  // Seen from above first.
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
    let y0 = (p.y - o.y) / d.y, y1 = (top - o.y) / d.y;
    if (y0 > y1) [y0, y1] = [y1, y0];
    t0 = Math.max(t0, y0);
    t1 = Math.min(t1, y1);
  } else if (o.y < p.y || o.y > top) return undefined;
  if (t0 > t1 || t1 < 0) return undefined;
  return Math.max(0, t0);
}

/**
 * Where the ray from `o` going `d` (a unit vector) first touches someone with their feet at `p`: how
 * far along, and whether that's their head (the ball, if it gets there before the body). `r` is how
 * far round them their body counts (a little more than it is, for the moment the office has them a
 * bit off where the shooter saw them); the head grows by half as much. Undefined if it misses them.
 */
export function rayPerson(o: V3, d: V3, p: Body, r: number = BODY_R): { t: number; head: boolean } | undefined {
  const low = p.crouch ? CROUCH : 0;
  const head = raySphere(o, d, { x: p.x, y: p.y + HEAD_C - low, z: p.z }, HEAD_R + (r - BODY_R) / 2);
  const body = rayColumn(o, d, p, r, p.y + HEAD_Y - low);
  if (head !== undefined && (body === undefined || head <= body)) return { t: head, head: true };
  return body === undefined ? undefined : { t: body, head: false };
}

// ---- Practice targets ------------------------------------------------------------------------------

/**
 * Cardboard figures for warm-up (fewer than RULES.players in, nobody to play), to shoot at alone: each
 * slides back and forth along an open lane, from `a` to `b` (m from the yard's middle) at `speed`
 * m/s. Shot down, one's back up after PRACTICE_DOWN seconds.
 */
const LANES: readonly { a: [number, number]; b: [number, number]; speed: number }[] = [
  { a: [19, -9], b: [19, 7], speed: 2.4 },
  { a: [-19, 9], b: [-19, -7], speed: 2.4 },
  { a: [-8, 25], b: [8, 25], speed: 3 },
  { a: [8, -25], b: [-8, -25], speed: 1.8 },
];
export const PRACTICE_TARGETS = LANES.length;
export const PRACTICE_DOWN = 3;

/** Where practice target `i` is at `now` (epoch ms, the office's clock): where its feet are. */
export function targetAt(i: number, now: number): V3 {
  const { a, b, speed } = LANES[i];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const s = ((now / 1000) * speed) % (2 * len);
  const k = (s < len ? s : 2 * len - s) / len;
  return { x: ARENA_CENTER.x + a[0] + (b[0] - a[0]) * k, y: 0, z: ARENA_CENTER.z + a[1] + (b[1] - a[1]) * k };
}

/** Whether (x, z) is inside the arena's walls (with a little room for whoever's standing there). */
export function inArena(x: number, z: number): boolean {
  return Math.abs(x - ARENA_CENTER.x) < ARENA_HALF + 2 && Math.abs(z - ARENA_CENTER.z) < ARENA_HALF + 2;
}
