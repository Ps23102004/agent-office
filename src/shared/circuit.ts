import type { Area } from './city.js';
import type { CarDef } from './garage.js';

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

/** The circuit's middle, out in the world. */
export const CENTER = { x: 0, z: -3000 } as const;

/** The asphalt's width, the red-and-white kerbs along its edges, and the grass either side out to the tyre walls (m). */
export const TRACK = { width: 12, curb: 1.2, runoff: 20 } as const;

/**
 * The line the track follows, a closed loop through these points (m, from CENTER): the main straight
 * east past the pits and the start line, a fast right at the end of it, a hairpin, a chicane, the long
 * sweeper round the back and a tight final corner onto the straight again. It runs clockwise from above.
 */
const POINTS: readonly (readonly [number, number])[] = [
  [-20, 0],
  [60, 0],
  [150, 0],
  [192, 12],
  [212, 48],
  [216, 110],
  [208, 150],
  [182, 164],
  [156, 150],
  [146, 118],
  [128, 92],
  [104, 82],
  [90, 94],
  [74, 84],
  [50, 80],
  [0, 96],
  [-60, 138],
  [-120, 166],
  [-170, 150],
  [-196, 104],
  [-188, 58],
  [-160, 20],
  [-110, 0],
];

/** POINTS were drawn a little small: this many times as big. */
const SCALE = 1.3;

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
}

/** About how far apart the track's points are (m). */
const STEP = 2;

let built: Track | null = null;

/**
 * The track's centre line, every couple of metres from the start line round: a centripetal
 * Catmull-Rom curve through POINTS, which never overshoots into a loop at a tight corner.
 */
export function track(): Track {
  if (built) return built;
  const P = POINTS.map(([x, z]) => ({ x: x * SCALE + CENTER.x, z: z * SCALE + CENTER.z }));
  const n = P.length;
  const raw: { x: number; z: number }[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = P[(i - 1 + n) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n];
    const knot = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.sqrt(Math.hypot(b.x - a.x, b.z - a.z));
    const t1 = knot(p0, p1), t2 = t1 + knot(p1, p2), t3 = t2 + knot(p2, p3);
    const steps = Math.max(2, Math.ceil(Math.hypot(p2.x - p1.x, p2.z - p1.z) / (STEP / 2)));
    for (let k = 0; k < steps; k++) {
      const t = t1 + ((t2 - t1) * k) / steps;
      const lerp = (a: { x: number; z: number }, b: { x: number; z: number }, ta: number, tb: number) => ({
        x: ((tb - t) * a.x + (t - ta) * b.x) / (tb - ta),
        z: ((tb - t) * a.z + (t - ta) * b.z) / (tb - ta),
      });
      const a1 = lerp(p0, p1, 0, t1), a2 = lerp(p1, p2, t1, t2), a3 = lerp(p2, p3, t2, t3);
      const b1 = lerp(a1, a2, 0, t2), b2 = lerp(a2, a3, t1, t3);
      raw.push(lerp(b1, b2, t1, t2));
    }
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
  return (built = { points, length });
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

/**
 * The nearest the track comes to (x, z): how far round it that is (`s`), and how far from the centre
 * line (`d`, + to a driver's left going the right way round). Checks every point: a few hundred.
 */
export function nearestProgress(x: number, z: number): { s: number; d: number } {
  const { points } = track();
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const d = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
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

/** Lines across the track, evenly round it; the first is the start and finish line. A lap is all of them, in order. */
export const CHECKPOINTS = 14;

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
