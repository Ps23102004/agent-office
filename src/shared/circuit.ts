import type { Area } from './city.js';
import type { Box, CarDef, CarPose, Course } from './garage.js';

// The race circuit: a place of its own, like the rooftop bar, reached through the gate on the plaza
// in the city (CITY_GATE). Everything here is plain numbers, no three.js: the track's shape, where a
// car can be, the checkpoints the office counts laps by (server/race.ts), the grid, and the cars
// waiting in the paddock. client/world/circuit.ts draws it.
//
// The circuit is laid out a long way from the city (CENTER), so nothing of the city's (its lamps'
// light, the office's shelter from the rain, the garage's ceiling) reaches it.

/** Where you are while you're at the circuit (a peer's `floor`, and `floor.go`'s): never a project floor's id. */
export const CIRCUIT = '@circuit';
export const CIRCUIT_NAME = 'Race circuit';

/** The start line, out in the world: the rest of the circuit is east and south of it. */
export const CENTER = { x: 0, z: -3000 } as const;

/** The asphalt's width, the red-and-white kerbs along its edges, and the grass either side out to the tyre walls (m). */
export const TRACK = { width: 14, curb: 1.2, runoff: 20 } as const;

/**
 * A stretch of the lap: straight on for `straight` metres, or round a bend of `turn` degrees (+ to
 * the right) at radius `r`. A bend's `name` is the corner's; `brake`: a hard stop into it from a
 * straight, with braking boards before it.
 */
type Leg = { straight: number } | { turn: number; r: number; name: string; brake?: boolean };

/**
 * The lap, from the start line: east down the main straight, the hard stop into Turn 1, a fast
 * chicane, the sweeper onto the back straight west, the hairpin at the end of it, the esses through
 * the infield, the carousel (one long double-apex right), the bottom straight west, the tight slow
 * complex, north up the kinked west straight, and the final corner onto the main straight again.
 * Clockwise from above. Two of the straights' lengths are whatever closes the loop.
 */
const LEGS: readonly Leg[] = [
  { straight: 480 },
  { turn: 90, r: 30, name: 'Turn 1', brake: true },
  { straight: 60 },
  { turn: -20, r: 80, name: 'Chicane' },
  { turn: 40, r: 80, name: 'Chicane' },
  { turn: -20, r: 80, name: 'Chicane' },
  { straight: 40 },
  { turn: 90, r: 110, name: 'Sweeper' },
  { straight: 380 },
  { turn: -160, r: 16, name: 'Hairpin', brake: true },
  { straight: 100 },
  { turn: 40, r: 90, name: 'Esses' },
  { turn: -40, r: 90, name: 'Esses' },
  { turn: 40, r: 90, name: 'Esses' },
  { turn: -60, r: 90, name: 'Esses' },
  { straight: 80 },
  { turn: 90, r: 40, name: 'Carousel' },
  { straight: 30 },
  { turn: 90, r: 40, name: 'Carousel' },
  { straight: 536.8 },
  // Its legs longer than the grass either side of them twice over, so there's no cutting across it.
  { turn: 90, r: 18, name: 'Complex', brake: true },
  { straight: 60 },
  { turn: -90, r: 18, name: 'Complex' },
  { straight: 60 },
  { turn: 90, r: 22, name: 'Complex' },
  { straight: 171.2 },
  { turn: 20, r: 260, name: 'Kink' },
  { straight: 60 },
  { turn: -20, r: 260, name: 'Kink' },
  { straight: 120 },
  { turn: 90, r: 45, name: 'Final corner', brake: true },
  { straight: 150 },
];

export interface TrackPoint {
  x: number;
  z: number;
  /** How far round the lap from the start line (m). */
  s: number;
  /** Which way the track runs here (a unit vector). */
  tx: number;
  tz: number;
}

export interface Track {
  points: TrackPoint[];
  /** Once round (m). */
  length: number;
  /** Its corners, in order round the lap. */
  corners: Corner[];
}

/** A corner (one bend of LEGS): where it starts and ends round the lap (m), which way and how tight. */
export interface Corner {
  name: string;
  s0: number;
  s1: number;
  /** Degrees, + to the right. */
  turn: number;
  r: number;
  brake: boolean;
}

/** About how far apart the track's points are (m). */
const STEP = 2;

let built: Track | null = null;

/** The track's centre line, every couple of metres from the start line round: LEGS walked from CENTER heading east. */
export function track(): Track {
  if (built) return built;
  const raw: { x: number; z: number }[] = [];
  const corners: Corner[] = [];
  // Heading `th`: 0 is east (+x), + turns right (toward +z, south).
  let x = CENTER.x, z = CENTER.z, th = 0, s = 0;
  for (const leg of LEGS) {
    if ('straight' in leg) {
      const n = Math.ceil(leg.straight / (STEP / 2));
      for (let k = 0; k < n; k++) raw.push({ x: x + (Math.cos(th) * leg.straight * k) / n, z: z + (Math.sin(th) * leg.straight * k) / n });
      x += Math.cos(th) * leg.straight;
      z += Math.sin(th) * leg.straight;
      s += leg.straight;
      continue;
    }
    const a = (leg.turn * Math.PI) / 180, side = Math.sign(a);
    // The bend's middle, off to the side it turns.
    const cx = x - Math.sin(th) * leg.r * side, cz = z + Math.cos(th) * leg.r * side;
    const n = Math.ceil((Math.abs(a) * leg.r) / (STEP / 2));
    for (let k = 0; k < n; k++) {
      const t = th + (a * k) / n;
      raw.push({ x: cx + Math.sin(t) * leg.r * side, z: cz - Math.cos(t) * leg.r * side });
    }
    th += a;
    x = cx + Math.sin(th) * leg.r * side;
    z = cz - Math.cos(th) * leg.r * side;
    corners.push({ name: leg.name, s0: s, s1: s + Math.abs(a) * leg.r, turn: leg.turn, r: leg.r, brake: !!leg.brake });
    s += Math.abs(a) * leg.r;
  }
  // Evenly spaced along it, so a point's index says how far round it is.
  const along = [0];
  for (let i = 1; i <= raw.length; i++) along.push(along[i - 1] + Math.hypot(raw[i % raw.length].x - raw[i - 1].x, raw[i % raw.length].z - raw[i - 1].z));
  const length = along[raw.length];
  const count = Math.round(length / STEP);
  const points: TrackPoint[] = [];
  let j = 0;
  for (let k = 0; k < count; k++) {
    const s = (k * length) / count;
    while (along[j + 1] < s) j++;
    const a = raw[j], b = raw[(j + 1) % raw.length];
    const f = (s - along[j]) / (along[j + 1] - along[j]);
    points.push({ x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, s, tx: 0, tz: 0 });
  }
  for (let k = 0; k < count; k++) {
    const a = points[(k - 1 + count) % count], b = points[(k + 1) % count];
    const d = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    points[k].tx = (b.x - a.x) / d;
    points[k].tz = (b.z - a.z) / d;
  }
  return (built = { points, length, corners });
}

/** The track `s` metres round from the start line (either way round, as far as you like). */
export function pointAt(s: number): TrackPoint {
  const { points, length } = track();
  const u = ((s % length) + length) % length;
  const f = (u / length) * points.length;
  const i = Math.floor(f) % points.length;
  const a = points[i], b = points[(i + 1) % points.length];
  const k = f - Math.floor(f);
  const tx = a.tx + (b.tx - a.tx) * k, tz = a.tz + (b.tz - a.tz) * k;
  const d = Math.hypot(tx, tz) || 1;
  return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, s: u, tx: tx / d, tz: tz / d };
}

/** The map in GRID-metre squares, each with the track's points within NEAR m of it (out past the grass to the tyre walls, and a little more). */
const GRID = 16;
const NEAR = 32;
let grid: { minX: number; minZ: number; cols: number; rows: number; cells: number[][] } | null = null;
const NONE: number[] = [];

/** The track's points (their places in track().points, in order) within NEAR of (x, z), and maybe a few more; none far off the track. */
function nearby(x: number, z: number): number[] {
  if (!grid) {
    const { points } = track();
    const minX = Math.min(...points.map((p) => p.x)) - NEAR, minZ = Math.min(...points.map((p) => p.z)) - NEAR;
    const cols = Math.ceil((Math.max(...points.map((p) => p.x)) + NEAR - minX) / GRID) + 1;
    const rows = Math.ceil((Math.max(...points.map((p) => p.z)) + NEAR - minZ) / GRID) + 1;
    const cells: number[][] = Array.from({ length: cols * rows }, () => []);
    points.forEach((p, i) => {
      for (let cz = Math.floor((p.z - NEAR - minZ) / GRID); cz <= Math.floor((p.z + NEAR - minZ) / GRID); cz++) {
        for (let cx = Math.floor((p.x - NEAR - minX) / GRID); cx <= Math.floor((p.x + NEAR - minX) / GRID); cx++) {
          // How far the point is from the square (0 inside it).
          const dx = Math.max(0, minX + cx * GRID - p.x, p.x - (minX + (cx + 1) * GRID));
          const dz = Math.max(0, minZ + cz * GRID - p.z, p.z - (minZ + (cz + 1) * GRID));
          if (dx * dx + dz * dz <= NEAR * NEAR) cells[cz * cols + cx].push(i);
        }
      }
    });
    grid = { minX, minZ, cols, rows, cells };
  }
  const cx = Math.floor((x - grid.minX) / GRID), cz = Math.floor((z - grid.minZ) / GRID);
  return cx < 0 || cz < 0 || cx >= grid.cols || cz >= grid.rows ? NONE : grid.cells[cz * grid.cols + cx];
}

/**
 * The nearest the track comes to (x, z): how far round it that is (`s`), and how far from the centre
 * line (`d`, + to a driver's left going the right way round). Near the track it checks only the points
 * close by (a car runs this many times a step, a bot's on the office's too); further off, every one.
 */
export function nearestProgress(x: number, z: number): { s: number; d: number } {
  const { points } = track();
  let best = 0;
  let bestD = Infinity;
  const scan = (ids: Iterable<number>) => {
    for (const i of ids) {
      const d = (points[i].x - x) ** 2 + (points[i].z - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
  };
  // One of those near it within NEAR: anything nearer is among them too, so it's the nearest of all.
  scan(nearby(x, z));
  if (bestD > NEAR * NEAR) {
    bestD = Infinity;
    scan(points.keys());
  }
  // Between that point and the next (or the one before), for the part of a step it's along.
  const p = points[best];
  const along = (x - p.x) * p.tx + (z - p.z) * p.tz;
  const q = pointAt(p.s + along);
  // The driver's left, heading (tx, tz), is (tz, -tx) (see garage.ts carPoint).
  return { s: q.s, d: (x - q.x) * q.tz - (z - q.z) * q.tx };
}

/** On the asphalt, kerbs and all. */
export function onTrack(x: number, z: number): boolean {
  return Math.abs(nearestProgress(x, z).d) <= TRACK.width / 2 + TRACK.curb;
}

/**
 * The paddock beside the main straight (the driver's left, heading for the start line): the pit
 * garages along its back, the circuit's cars waiting in front of them, and the gate back to the city.
 */
export const PADDOCK: Area = { minX: CENTER.x - 125, maxX: CENTER.x + 110, minZ: CENTER.z - 64, maxZ: CENTER.z - TRACK.width / 2 - TRACK.runoff + 1 };
/** The pit wall between the paddock and the straight, with a way through at either end. */
export const PIT_WALL: Area = { minX: CENTER.x - 95, maxX: CENTER.x + 80, minZ: PADDOCK.maxZ - 1.4, maxZ: PADDOCK.maxZ - 0.8 };
/** The pit garages, a long low building along the back of the paddock. */
export const GARAGES: Area = { minX: CENTER.x - 100, maxX: CENTER.x + 90, minZ: CENTER.z - 76, maxZ: PADDOCK.minZ };

export type Surface = 'track' | 'grass' | 'paddock' | 'out';

/** What's underfoot (or under the tires) at (x, z). */
export function surfaceAt(x: number, z: number): Surface {
  if (x >= PADDOCK.minX && x <= PADDOCK.maxX && z >= PADDOCK.minZ && z <= PADDOCK.maxZ) return 'paddock';
  const d = Math.abs(nearestProgress(x, z).d);
  return d <= TRACK.width / 2 + TRACK.curb ? 'track' : d <= TRACK.width / 2 + TRACK.runoff ? 'grass' : 'out';
}

/** Whether a car can be at (x, z): on the track, the grass up to the tyre walls, or in the paddock. */
export function circuitGround(x: number, z: number): boolean {
  return surfaceAt(x, z) !== 'out';
}

// ---- The checkpoints and the grid ----------------------------------------------------------------

/** Lines across the track, evenly round it (about one every 100 m); the first is the start and finish line. A lap is all of them, in order. */
export const CHECKPOINTS = 32;

/** Checkpoint `i`'s line, right across the track and its grass from tyre wall to tyre wall. */
export function checkpoint(i: number): { x: number; z: number; ax: number; az: number; bx: number; bz: number } {
  const p = pointAt((i * track().length) / CHECKPOINTS);
  const r = TRACK.width / 2 + TRACK.runoff + 2;
  return { x: p.x, z: p.z, ax: p.x + p.tz * r, az: p.z - p.tx * r, bx: p.x - p.tz * r, bz: p.z + p.tx * r };
}

/** Whether going straight from `a` to `b` took you across checkpoint `i`'s line, the right way round. */
export function crossed(i: number, a: { x: number; z: number }, b: { x: number; z: number }): boolean {
  const c = checkpoint(i);
  const p = pointAt((i * track().length) / CHECKPOINTS);
  // Behind the line, then on or past it.
  const before = (a.x - c.x) * p.tx + (a.z - c.z) * p.tz;
  const after = (b.x - c.x) * p.tx + (b.z - c.z) * p.tz;
  if (!(before < 0 && after >= 0)) return false;
  // Where it crossed, within the line's reach.
  const f = before / (before - after);
  const x = a.x + (b.x - a.x) * f, z = a.z + (b.z - a.z) * f;
  return Math.hypot(x - c.x, z - c.z) <= Math.hypot(c.ax - c.x, c.az - c.z);
}

/** How far past a checkpoint's line a car put back on the track is set down (m). */
export const RESET_PAST = 3;

/** As fast as a car goes on the circuit's grass (m/s): slower than round any of its corners. */
export const GRASS_TOP = 12;

/** Off the track, the grass (slippery already: shared/garage.ts GROUND, and no boost there) bogs a car down to a crawl, slower than any corner. */
export function onGrass(p: CarPose, dt: number): CarPose {
  if (surfaceAt(p.x, p.z) !== 'grass') return p;
  const drag = Math.exp(-dt * 0.8);
  const speed = Math.abs(p.speed) > GRASS_TOP ? p.speed - Math.sign(p.speed) * Math.min(Math.abs(p.speed) - GRASS_TOP, 16 * dt) : p.speed;
  return { ...p, speed, slip: (p.slip ?? 0) * drag };
}

/**
 * How a car drives here (shared/garage.ts advance): the tyre walls round the grass are a barrier, and
 * the grass is slippery and slow. A person's page and the office's bots both drive on this.
 */
export const CIRCUIT_COURSE: Omit<Course, 'solids' | 'bumped'> = {
  ground: circuitGround,
  surfaceAt: (x, z) => (surfaceAt(x, z) === 'grass' ? 'grass' : 'road'),
  surface: onGrass,
};

/**
 * How far round the lap (x, z) is past the line of checkpoint `last` (m; - is short of it, and so
 * is anywhere before the first time over the start line). For telling a reset that's behind a car
 * from one that's ahead of it.
 */
export function pastLine(last: number, x: number, z: number): number {
  const L = track().length;
  const gap = L / CHECKPOINTS;
  const past = (nearestProgress(x, z).s - Math.max(0, last) * gap + L) % L;
  return past > L - gap ? past - L : past;
}

/**
 * Where a car goes back on the track (off it too long, stuck, or the wrong way round), in the order
 * to try them till there's one with room: just past the last checkpoint it went through (`t`, its
 * timing), facing the way round; then a little to either side, and further back. Racing, before the
 * first line after the start, its own grid slot and behind it; before its first time over the start
 * line on practice laps, just short of that. The office takes a car turning up on one of these, and
 * no further round than it was, as a fair reset rather than a jump (server/race.ts).
 */
export function resetSpots(t: { checkpoint: number; lap?: number; slot?: number }): { x: number; z: number; rotY: number }[] {
  const base =
    t.slot !== undefined && t.lap === 0 && t.checkpoint <= 0
      ? nearestProgress(gridPose(t.slot).x, gridPose(t.slot).z)
      : { s: t.checkpoint < 0 ? -10 : (t.checkpoint * track().length) / CHECKPOINTS + RESET_PAST, d: 0 };
  const spots: { x: number; z: number; rotY: number }[] = [];
  for (let back = 0; back <= 24; back += 8) {
    for (const across of [0, 4, -4]) {
      const d = base.d + across;
      if (Math.abs(d) > TRACK.width / 2 - 1.5) continue;
      const p = pointAt(base.s - back);
      spots.push({ x: p.x + p.tz * d, z: p.z - p.tx * d, rotY: Math.atan2(p.tx, p.tz) });
    }
  }
  return spots;
}

/** Grid slot `slot`'s spot behind the start line: two by two, staggered, the odd ones on the right. */
export function gridPose(slot: number): { x: number; z: number; rotY: number } {
  const row = Math.floor(slot / 2);
  const right = slot % 2 === 1;
  const p = pointAt(-7 - row * 9 - (right ? 4.5 : 0));
  const side = right ? -2.8 : 2.8;
  return { x: p.x + p.tz * side, z: p.z - p.tx * side, rotY: Math.atan2(p.tx, p.tz) };
}

// ---- The gates and the circuit's cars ------------------------------------------------------------

/**
 * A gate: an arch you walk or drive through, its opening `width` across (m), turned `rotY` (0: you
 * go through heading +z). `out` is where you come out of the gate at the other end, and which way you face.
 */
export interface Gate {
  x: number;
  z: number;
  rotY: number;
  width: number;
  out: { x: number; z: number; rotY: number };
}

/**
 * The gate to the circuit, on the plaza off the street behind the office (see city.ts RACE_PLAZA):
 * you go through it heading north, away from the street (-z). Coming back, you come out in front of
 * it facing the street.
 */
export const CITY_GATE: Gate = { x: 56, z: -52, rotY: Math.PI, width: 12, out: { x: 56, z: -44, rotY: 0 } };

/** The gate home, at the west end of the paddock: through it heading west. You arrive in front of it, facing the paddock. */
export const CIRCUIT_GATE: Gate = { x: CENTER.x - 116, z: CENTER.z - 42, rotY: -Math.PI / 2, width: 10, out: { x: CENTER.x - 106, z: CENTER.z - 42, rotY: Math.PI / 2 } };

/** Whether (x, z) is in the gate's opening (a couple of metres deep). */
export function inGate(g: Gate, x: number, z: number): boolean {
  const s = Math.sin(g.rotY), c = Math.cos(g.rotY);
  const across = (x - g.x) * c - (z - g.z) * s;
  const along = (x - g.x) * s + (z - g.z) * c;
  return Math.abs(across) < g.width / 2 - 0.4 && Math.abs(along) < 1.6;
}

/**
 * Where a car driven into gate `g` waits while you're away, nearest first: 2 m short of its `out`
 * side, 2 m and then 6 m clear of the opening's edge either side, facing through it. Out of the way
 * of the next one through.
 */
export function besideGate(g: Gate): { x: number; z: number; rotY: number }[] {
  const s = Math.sin(g.rotY), c = Math.cos(g.rotY);
  const d = g.width / 2 + 2;
  return [-d, d, -d - 4, d + 4].map((a) => ({ x: g.out.x + s * 2 + c * a, z: g.out.z + c * 2 - s * a, rotY: g.rotY }));
}

/** Gate `g`'s two pillars (their middles, each 1.4 m square), either side of its opening. */
export function gatePillars(g: Gate): { x: number; z: number }[] {
  const s = Math.sin(g.rotY), c = Math.cos(g.rotY);
  return [-1, 1].map((side) => ({ x: g.x + side * (g.width / 2 + 0.6) * c, z: g.z - side * (g.width / 2 + 0.6) * s }));
}

/** The gantry over the start line stands on two legs (1.1 m square), this far either side of the centre line (m): just past the kerbs. */
export const GANTRY_LEG = TRACK.width / 2 + TRACK.curb + 1.4;

let standing: Box[] | null = null;

/**
 * What stands on the circuit's ground for a car to run into, besides the other cars: the gantry's
 * legs either side of the start line, the pit wall, the garages and the gate's pillars (the
 * grandstands and the trees are past the tyre walls). A person's page (client/world/circuit.ts, its
 * colliders) and the office's bots (server/racebots.ts) drive among the same ones.
 */
export function circuitSolids(): readonly Box[] {
  if (standing) return standing;
  const square = (p: { x: number; z: number }, h: number): Box => ({ minX: p.x - h, maxX: p.x + h, minZ: p.z - h, maxZ: p.z + h });
  const line = pointAt(0);
  const legs = [-1, 1].map((side) => ({ x: line.x + line.tz * side * GANTRY_LEG, z: line.z - line.tx * side * GANTRY_LEG }));
  return (standing = [...legs.map((p) => square(p, 0.55)), { ...PIT_WALL }, { ...GARAGES }, ...gatePillars(CIRCUIT_GATE).map((p) => square(p, 0.7))]);
}

/** The circuit's cars, waiting nose-out in front of the pit garages. Racer.car is an index into these. */
export const CIRCUIT_CARS: readonly CarDef[] = (
  [
    ['lambo', '#ff006e', 'Pink Lambo'],
    ['ferrari', '#d90429', 'Red Ferrari'],
    ['lambo', '#3a86ff', 'Blue Lambo'],
    ['ferrari', '#ffbe0b', 'Yellow Ferrari'],
    ['motorbike', '#fb5607', 'Orange Motorbike'],
    ['lambo', '#06d6a0', 'Mint Lambo'],
    ['ferrari', '#8338ec', 'Violet Ferrari'],
    ['motorbike', '#118ab2', 'Teal Motorbike'],
    ['race', '#e63946', 'Red Race Car'],
    ['race-future', '#3a86ff', 'Blue Race Car'],
    ['sedan-sports', '#ffbe0b', 'Yellow Sports Car'],
  ] as const
).map(([kind, color, name], i) => ({ kind, color, name, x: CENTER.x - 70 + i * 16, z: PADDOCK.minZ + 8, rotY: 0 }));
