import { FLOOR, ROAD, WALL_T } from './layout.js';
import { surfaceAt, type Surface } from './city.js';

// The cars and bikes in the garage, which anyone can drive: where they're parked, where you can
// take them (the garage, the lots round it and the street), and the arcade physics a driver's own
// page runs. Everyone else on the floor sees the car where its driver says it is.

export type CarKind = 'lambo' | 'ferrari' | 'motorbike' | 'bicycle' | 'sedan-sports' | 'suv' | 'police' | 'taxi' | 'race' | 'race-future';

/** Metres for the body, kg with riders for the mass, m/s at the top (a supercar's ≈ 240 km/h), m/s² on the gas off the line, and tire grip. */
export const SPECS = {
  lambo: { length: 4.6, width: 2, body: 0.82, roof: 1.12, mass: 1450, top: 66, accel: 10, grip: 1.15, seats: 2, wheelbase: 2.8, reverse: 9 },
  ferrari: { length: 4.6, width: 2, body: 0.82, roof: 1.16, mass: 1550, top: 64, accel: 9.6, grip: 1.2, seats: 2, wheelbase: 2.72, reverse: 9 },
  motorbike: { length: 2.2, width: 0.78, body: 0.8, roof: 1.15, mass: 260, top: 50, accel: 9, grip: 1.05, seats: 2, wheelbase: 1.5, reverse: 3 },
  bicycle: { length: 1.85, width: 0.62, body: 0.82, roof: 1.12, mass: 95, top: 9, accel: 1.8, grip: 0.9, seats: 1, wheelbase: 1.12, reverse: 2 },
  // Kenney's cars (client/world/carkit.ts): their sizes are the models'. `seatZ`/`hips`: where you sit, if not the usual.
  'sedan-sports': { length: 4.34, width: 1.76, body: 1.08, roof: 1.49, mass: 1350, top: 58, accel: 8.6, grip: 1.12, seats: 2, wheelbase: 2.24, reverse: 8 },
  suv: { length: 4.59, width: 2.03, body: 1.08, roof: 1.76, mass: 2100, top: 44, accel: 6.4, grip: 1.0, seats: 2, wheelbase: 2.24, reverse: 7 },
  police: { length: 5.27, width: 2.03, body: 1.08, roof: 1.76, mass: 1750, top: 55, accel: 8, grip: 1.1, seats: 2, wheelbase: 2.75, reverse: 8 },
  taxi: { length: 4.68, width: 2.03, body: 1.08, roof: 2.03, mass: 1500, top: 42, accel: 6, grip: 1.0, seats: 2, wheelbase: 2.58, reverse: 7 },
  race: { length: 4.35, width: 1.62, body: 0.66, roof: 0.99, mass: 760, top: 78, accel: 12, grip: 1.4, seats: 1, wheelbase: 2.58, reverse: 6, seatZ: -0.35, hips: 0.25 },
  'race-future': { length: 4.52, width: 1.62, body: 0.8, roof: 1.12, mass: 780, top: 80, accel: 12.4, grip: 1.45, seats: 1, wheelbase: 2.58, reverse: 6, seatZ: -0.45, hips: 0.3 },
} as const;
// Older callers mean a Lambo when they don't give a kind.
export const CAR = SPECS.lambo;

/** The building's footprint, walls included: the garage is under it. */
const B = { minX: FLOOR.minX - WALL_T, maxX: FLOOR.maxX + WALL_T, minZ: FLOOR.minZ - WALL_T, maxZ: FLOOR.maxZ + WALL_T } as const;

/** Somewhere flat on the ground, x and z. */
export interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /**
   * Turned (another vehicle): the rectangle `hx` across and `hz` along (half-sizes) about the box's
   * middle, its nose `rotY` round like a car's. The min/max are then only its bounds.
   */
  rotY?: number;
  hx?: number;
  hz?: number;
  /** Another vehicle: its mass and motion. A wall has no mass here (it never moves). */
  mass?: number;
  vx?: number;
  vz?: number;
}

/** The paved lot in front of the garage, out to the sidewalk, and the one down its east side. */
export const LOT: Box = { minX: -30, maxX: 30, minZ: B.maxZ, maxZ: 21 };
export const SIDE_LOT: Box = { minX: B.maxX, maxX: B.maxX + 12, minZ: B.minZ - 2, maxZ: B.maxZ + 4 };
/** How far along the street either way (from the building) you can drive, before it's too far to see. */
export const STREET_END = 90;

/**
 * Where a car can go: the garage (inside its back and west walls, open to the south and east), the
 * lots round it, across the sidewalk and along the street. What stands on them (columns, lamps,
 * trees, the other cars) is the driver's page to bump into.
 */
export const PAVEMENT: Box[] = [
  { minX: FLOOR.minX, maxX: B.maxX, minZ: FLOOR.minZ, maxZ: B.maxZ },
  { ...LOT, maxZ: ROAD.minZ },
  SIDE_LOT,
  { minX: -STREET_END, maxX: STREET_END, minZ: ROAD.minZ, maxZ: ROAD.maxZ },
];

export interface CarDef {
  kind: CarKind;
  color: string;
  /** What the hint calls it: "Orange Lambo". */
  name: string;
  /** Its spot: where it's parked when the office starts, and which way its nose points (0 is +z). */
  x: number;
  z: number;
  rotY: number;
}

// Lambos nose-in along the back wall, Ferraris backed in facing the street, and one out front.
const BACK = B.minZ + WALL_T + 0.4 + CAR.length / 2;
const FRONT = B.maxZ - 0.5 - CAR.length / 2;
export const CARS: readonly CarDef[] = [
  { kind: 'lambo', color: '#8ac926', name: 'Lime Lambo', x: -14.4, z: BACK, rotY: Math.PI },
  { kind: 'lambo', color: '#ff7b00', name: 'Orange Lambo', x: -8, z: BACK, rotY: Math.PI },
  { kind: 'lambo', color: '#ffd000', name: 'Yellow Lambo', x: 1.6, z: BACK, rotY: Math.PI },
  { kind: 'lambo', color: '#7b2cbf', name: 'Purple Lambo', x: 11.2, z: BACK, rotY: Math.PI },
  { kind: 'ferrari', color: '#d90429', name: 'Red Ferrari', x: -14.4, z: FRONT, rotY: 0 },
  { kind: 'ferrari', color: '#d90429', name: 'Rosso Ferrari', x: -4.8, z: FRONT, rotY: 0 },
  { kind: 'ferrari', color: '#ffc300', name: 'Giallo Ferrari', x: 4.8, z: FRONT, rotY: 0 },
  { kind: 'ferrari', color: '#e5383b', name: 'Scarlet Ferrari', x: 14.4, z: FRONT, rotY: 0 },
  // Left out front, for everyone upstairs to look at.
  { kind: 'lambo', color: '#00b4d8', name: 'Blue Lambo', x: 9, z: 18.2, rotY: Math.PI / 2 },
  { kind: 'motorbike', color: '#f77f00', name: 'Orange Motorbike', x: B.maxX + 3, z: -10, rotY: Math.PI / 2 },
  { kind: 'motorbike', color: '#4361ee', name: 'Blue Motorbike', x: B.maxX + 3, z: -6, rotY: Math.PI / 2 },
  { kind: 'bicycle', color: '#2a9d8f', name: 'Green Bicycle', x: B.maxX + 3, z: -2, rotY: Math.PI / 2 },
  { kind: 'bicycle', color: '#e9c46a', name: 'Yellow Bicycle', x: B.maxX + 3, z: 2, rotY: Math.PI / 2 },
  // Kenney's, out on the front lot either side of the door, noses to the street.
  { kind: 'sedan-sports', color: '#ef233c', name: 'Red Sports Car', x: -21, z: 17.6, rotY: 0 },
  { kind: 'suv', color: '#2a9d8f', name: 'Green SUV', x: -17.6, z: 17.6, rotY: 0 },
  { kind: 'police', color: '#ffffff', name: 'Police Car', x: -14.2, z: 17.6, rotY: 0 },
  { kind: 'taxi', color: '#ffc044', name: 'Taxi', x: 14.5, z: 17.6, rotY: 0 },
  { kind: 'race', color: '#e63946', name: 'Red Race Car', x: 17.9, z: 17.6, rotY: 0 },
];

export type CarSeat = 'driver' | 'passenger';

/**
 * Where the two of you sit, in the car's own frame (x across, +x on the driver's left side; z toward
 * the nose), and how high your hips are off the ground. Your head's up out of the top: with anyone
 * in it, the roof comes off.
 */
export const SEATS: Record<CarSeat, { x: number; z: number }> = { driver: { x: 0.42, z: -0.5 }, passenger: { x: -0.42, z: -0.5 } };
export const SEAT_HIPS = 0.45;

/** A saddle runs down the middle; on a motorbike there's room behind you for a passenger. A single-seater's seat is in the middle too. */
export function seatOffset(kind: CarKind, seat: CarSeat): { x: number; z: number } {
  const spec = SPECS[kind];
  if (spec.width < 1) return { x: 0, z: seat === 'driver' ? -0.12 : -0.6 };
  const z = 'seatZ' in spec ? spec.seatZ : SEATS[seat].z;
  return spec.seats < 2 ? { x: 0, z } : { x: SEATS[seat].x, z };
}

export function seatHips(kind: CarKind): number {
  const spec = SPECS[kind];
  return spec.width < 1 ? 0.82 : 'hips' in spec ? spec.hips : SEAT_HIPS;
}

/** A car where it is and how it's going: `speed` in m/s along its nose (negative in reverse), `steer` the front wheels' angle (+ is left). */
export interface CarPose {
  x: number;
  z: number;
  rotY: number;
  speed: number;
  steer: number;
  /** Across the body (+ toward your left), m/s. Old pages omit it: treat that as zero. */
  slip?: number;
  /** Turning speed, rad/s, kept by your own physics; it needn't travel on the wire. */
  yaw?: number;
}

/** A car as the office has it: where it is, and who's in it (PeerInfo ids). */
export interface CarState extends CarPose {
  driver?: string;
  passenger?: string;
  /** Its driver's on the boost (car.move says): flames out the back. */
  boost?: boolean;
}

/** Every car in its spot, as the office starts (the garage's, or `defs`: the race circuit's). */
export function parked(defs: readonly CarDef[] = CARS): CarState[] {
  return defs.map((c) => ({ x: c.x, z: c.z, rotY: c.rotY, speed: 0, steer: 0, slip: 0 }));
}

/** The pedals and the wheel: `gas` 1 forward, -1 back (braking first if you're going the other way), `turn` +1 hard left. */
export interface Pedals {
  gas: number;
  turn: number;
  /** Space: the handbrake on a car, an ordinary brake on a bike. */
  brake: boolean;
  /** Shift, with boost in the tank (client/driving.ts keeps the meter): faster, and on past top speed. */
  boost?: boolean;
}

/** Boost: how far past top speed it takes you, and the extra shove (m/s²) on top of the engine's. */
export const BOOST = { top: 1.35, accel: 9 } as const;
/** How much faster than top speed `kind` can go: on the boost, but a bicycle has none. */
export const boostTop = (kind: CarKind) => (kind === 'bicycle' ? 1 : BOOST.top);

export const DRIVE = {
  /** Flat out, forward and in reverse (m/s): a Lambo's. */
  top: SPECS.lambo.top,
  reverse: SPECS.lambo.reverse,
  /** Speeding up, forward and back, and slowing down on the brake or rolling (m/s²). */
  accel: 8,
  reverseAccel: 5,
  brake: 20,
  coast: 2.5,
  /** The air, off the gas: m/s² for each (m/s)², so a fast car slows quicker than a slow one. */
  drag: 0.0015,
  /** Between the axles (m): how tight it turns. */
  wheelbase: 2.8,
  /** How far the front wheels turn at a crawl (radians): less the faster you go, so it doesn't spin out. */
  steer: 0.6,
  /** How fast they turn (radians a second). */
  steerRate: 2.8,
  /** How hard a turn full lock asks for at speed (m/s² sideways): a little past what the tires hold, so you can lean on them. */
  turn: 14,
} as const;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** How far the front wheels can turn at `speed`: less the faster you go, down to what keeps the turn on the tires. */
export function steerLimit(speed: number): number {
  return Math.min(DRIVE.steer / (1 + Math.abs(speed) / 9), Math.atan((DRIVE.wheelbase * DRIVE.turn) / Math.max(1, speed * speed)));
}

/** A short physics step (seconds), the same at 30 fps as at 60. */
export const DRIVE_STEP = 1 / 120;
export const TIRES = { gravity: 9.81, stiffness: 40, height: 0.45, rearBrakeGrip: 0.16, inertia: 1.3, restitution: 0.25 } as const;

/** How far a bike leans into a corner: upright at rest, never laid flat. */
export function leanAngle(p: CarPose, kind: CarKind): number {
  return SPECS[kind].width < 1 ? clamp(Math.atan(p.speed * p.speed * Math.tan(p.steer) / (SPECS[kind].wheelbase * TIRES.gravity)), -0.55, 0.55) : 0;
}

/**
 * What the ground does to the tires (shared/city.ts surfaceAt): how much of their grip they keep, how
 * hard it drags at the wheels (m/s², on top of rolling to a stop), and how much of top speed you can
 * get to on it. Grass is slippery, sand bogs you down, and the sea very nearly stops you.
 */
export const GROUND: Record<Surface, { grip: number; drag: number; top: number }> = {
  road: { grip: 1, drag: 0, top: 1 },
  walk: { grip: 1, drag: 0, top: 1 },
  grass: { grip: 0.62, drag: 1.2, top: 0.7 },
  sand: { grip: 0.78, drag: 3.2, top: 0.45 },
  water: { grip: 0.3, drag: 9, top: 0.15 },
};

/**
 * The car `dt` seconds on: tires push across the body and turn it about its middle, on `surface`
 * (a road, unless said). No world state: the caller asks surfaceAt where the car is.
 */
export function drive(p: CarPose, pedals: Pedals, dt: number, kind: CarKind = 'lambo', surface: Surface = 'road'): CarPose {
  if (!Number.isFinite(dt) || dt <= 0) return { ...p };
  // Also keep callers outside Driver stable when they give us a whole frame at once.
  const n = Math.ceil(dt / DRIVE_STEP);
  const h = dt / n;
  let next = p;
  for (let i = 0; i < n; i++) next = tireStep(next, pedals, h, kind, GROUND[surface] ?? GROUND.road);
  return next;
}

function tireStep(p: CarPose, pedals: Pedals, dt: number, kind: CarKind, ground: (typeof GROUND)[Surface]): CarPose {
  const spec = SPECS[kind];
  const grip = spec.grip * ground.grip;
  // No boost off the road: the grass and the sand only spin the wheels.
  const boost = !!pedals.boost && pedals.gas > 0 && !ground.drag;
  const fastest = spec.top * (boost ? BOOST.top : 1);
  const top = fastest * ground.top;
  const bike = spec.width < 1;
  // On the handbrake you can throw it in harder: that's how a drift starts.
  const want = clamp(pedals.turn, -1, 1) * (pedals.brake && !bike ? DRIVE.steer / (1 + Math.abs(p.speed) / 9) : steerLimit(p.speed));
  const steer = p.steer + clamp(want - p.steer, -DRIVE.steerRate * dt, DRIVE.steerRate * dt);
  // Crumbs of speed left from a slide count as stopped, so the gas isn't read as braking out of reverse forever.
  let v = Math.abs(p.speed) < 1e-3 ? 0 : p.speed;
  const toward = (target: number, rate: number) => (v += clamp(target - v, -rate * dt, rate * dt));
  const gas = clamp(pedals.gas, -1, 1);
  // A car's handbrake locks only the rear wheels: it slows you less, and lets the tail come round.
  // Brakes bite as hard as the ground lets the tires.
  const brake = DRIVE.brake * Math.min(1, ground.grip * 1.25);
  if (pedals.brake) toward(0, bike ? brake : brake * 0.5);
  else if (gas > 0) {
    if (v < 0) toward(0, brake);
    // The pull falls away toward top speed (a fifth of it left there, so it gets there): quick off the line, a long haul to the top.
    else if (v < top) v = Math.min(top, v + (spec.accel * (1 - 0.8 * (v / top) ** 2) + (boost ? BOOST.accel : 0)) * gas * dt);
  } else if (gas < 0) {
    if (v > 0) toward(0, brake);
    else v = Math.max(-spec.reverse * Math.max(0.5, ground.top), v + Math.min(DRIVE.reverseAccel, spec.accel) * gas * dt);
  } else toward(0, kind === 'bicycle' ? 0.65 : (kind === 'motorbike' ? 2 : DRIVE.coast) + DRIVE.drag * v * v);
  // Off the boost, past top speed: the air slows you back to it.
  if (!boost && v > spec.top * ground.top) toward(spec.top * ground.top, 4);
  // Off the road: the ground drags at the wheels, and bogs you down to what it lets you do.
  if (ground.drag) {
    // Rolling resistance grows with speed from nothing at rest: even a bicycle creeps across the sand.
    toward(0, ground.drag * Math.min(1, Math.abs(v) / 3));
    if (Math.abs(v) > top) toward(Math.sign(v) * top, 3 + ground.drag);
  }

  let yaw = p.yaw ?? 0;
  let slip = p.slip ?? 0;
  if (bike || Math.abs(v) < 3) {
    // At walking speed the tires settle before another step: no jitter, and no sideways bikes.
    // No sharper than the tires can hold: sideways, v × yaw is at most grip × g.
    const most = (grip * TIRES.gravity) / Math.max(1, Math.abs(v));
    const target = clamp((v * Math.tan(steer)) / spec.wheelbase, -most, most);
    yaw += (target - yaw) * (1 - Math.exp(-dt * 18));
    slip = bike ? 0 : slip * Math.exp(-dt * 12);
  } else {
    const axle = spec.wheelbase / 2;
    const acceleration = (v - p.speed) / dt;
    const transfer = spec.mass * acceleration * TIRES.height / spec.wheelbase;
    const weight = spec.mass * TIRES.gravity;
    const frontLoad = clamp(weight / 2 - transfer, weight * 0.15, weight * 0.85);
    const rearLoad = weight - frontLoad;
    const frontAngle = Math.atan2(slip + axle * yaw, Math.abs(v)) - steer * Math.sign(v);
    const rearAngle = Math.atan2(slip - axle * yaw, Math.abs(v));
    const frontGrip = grip * frontLoad;
    const rearGrip = grip * rearLoad * (pedals.brake ? TIRES.rearBrakeGrip : 1);
    const front = clamp(-frontAngle * spec.mass * TIRES.stiffness, -frontGrip, frontGrip);
    const rear = clamp(-rearAngle * spec.mass * TIRES.stiffness, -rearGrip, rearGrip);
    const inertia = spec.mass * (spec.length ** 2 + spec.width ** 2) / 12 * TIRES.inertia;
    yaw += axle * (front - rear) / inertia * dt;
    slip += ((front + rear) / spec.mass - v * yaw) * dt;
  }
  v = clamp(v + yaw * slip * dt, -spec.reverse, spec.top * boostTop(kind));
  slip = clamp(slip, -spec.top * 0.75, spec.top * 0.75);
  if (Math.abs(v) < 1e-3 && Math.abs(slip) < 0.01) { v = 0; slip = 0; yaw = 0; }
  const mid = p.rotY + yaw * dt / 2;
  return {
    x: p.x + (Math.sin(mid) * v + Math.cos(mid) * slip) * dt,
    z: p.z + (Math.cos(mid) * v - Math.sin(mid) * slip) * dt,
    rotY: Math.atan2(Math.sin(p.rotY + yaw * dt), Math.cos(p.rotY + yaw * dt)),
    speed: v, steer, slip, yaw,
  };
}

/** A point in the car's own frame (x across, +x left; z toward the nose), out in the world. */
export function carPoint(p: { x: number; z: number; rotY: number }, lx: number, lz: number): { x: number; z: number } {
  const s = Math.sin(p.rotY);
  const c = Math.cos(p.rotY);
  return { x: p.x + lx * c + lz * s, z: p.z - lx * s + lz * c };
}

/**
 * Whether (x, z) is somewhere a car can be: the garage and its lots, and anywhere on the island,
 * off-road included (what stands in the way is citySolids'). Not out in the sea.
 */
export function paved(x: number, z: number): boolean {
  return PAVEMENT.some((b) => x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) || surfaceAt(x, z) !== 'water';
}

/** Whether the whole car is on land (or on `where`, somewhere else a car can be): its corners, and halfway along each side. */
export function onPavement(p: { x: number; z: number; rotY: number }, kind: CarKind = 'lambo', where: (x: number, z: number) => boolean = paved): boolean {
  const w = SPECS[kind].width / 2;
  const l = SPECS[kind].length / 2;
  for (const [lx, lz] of [
    [w, l],
    [-w, l],
    [w, -l],
    [-w, -l],
    [w, 0],
    [-w, 0],
    [0, l],
    [0, -l],
  ]) {
    const at = carPoint(p, lx, lz);
    if (!where(at.x, at.z)) return false;
  }
  return true;
}

/** A rectangle on the ground: its middle, half-sizes across (`hx`) and along (`hz`), turned `rotY` like a car. */
interface Rect {
  x: number;
  z: number;
  hx: number;
  hz: number;
  rotY: number;
}

const rectOf = (b: Box): Rect => ({
  x: (b.minX + b.maxX) / 2,
  z: (b.minZ + b.maxZ) / 2,
  hx: b.rotY === undefined ? (b.maxX - b.minX) / 2 : b.hx ?? 0,
  hz: b.rotY === undefined ? (b.maxZ - b.minZ) / 2 : b.hz ?? 0,
  rotY: b.rotY ?? 0,
});

/** Its four corners, out in the world. */
const corners = (r: Rect) => [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([sx, sz]) => carPoint(r, sx * r.hx, sz * r.hz));

/** Whether (x, z) is inside `r`. */
function inside(r: Rect, x: number, z: number): boolean {
  const s = Math.sin(r.rotY), c = Math.cos(r.rotY);
  const dx = x - r.x, dz = z - r.z;
  return Math.abs(dx * c - dz * s) < r.hx && Math.abs(dx * s + dz * c) < r.hz;
}

/** Where the car's in box `b`: which way out (`nx`, `nz`, a unit vector from it), how far in (m), and about where they touch. */
export interface Contact {
  nx: number;
  nz: number;
  depth: number;
  x: number;
  z: number;
}

/**
 * How the car's footprint at `p` (a rectangle turned by rotY) is into box `b`, or null if it's clear
 * (touching isn't in). Separating axes: of the four sides' directions, the one it's least far in along
 * is the way out.
 */
export function contact(p: { x: number; z: number; rotY: number }, b: Box, kind: CarKind = 'lambo'): Contact | null {
  const car: Rect = { x: p.x, z: p.z, hx: SPECS[kind].width / 2, hz: SPECS[kind].length / 2, rotY: p.rotY };
  // Nowhere near its bounds: clear, without the trigonometry.
  const reach = Math.hypot(car.hx, car.hz);
  if (p.x + reach <= b.minX || p.x - reach >= b.maxX || p.z + reach <= b.minZ || p.z - reach >= b.maxZ) return null;
  const box = rectOf(b);
  const dx = box.x - car.x, dz = box.z - car.z;
  let best: Contact | null = null;
  for (const r of [car, box]) {
    const s = Math.sin(r.rotY), c = Math.cos(r.rotY);
    // Across it, and along it.
    for (const [ax, az] of [[c, -s], [s, c]]) {
      const radius = (q: Rect) => {
        const qs = Math.sin(q.rotY), qc = Math.cos(q.rotY);
        return q.hx * Math.abs(ax * qc - az * qs) + q.hz * Math.abs(ax * qs + az * qc);
      };
      const d = dx * ax + dz * az;
      const depth = radius(car) + radius(box) - Math.abs(d);
      if (depth <= 0) return null;
      if (!best || depth < best.depth) best = { nx: d > 0 ? -ax : ax, nz: d > 0 ? -az : az, depth, x: 0, z: 0 };
    }
  }
  // Where they touch: the corners of each that are in the other, or halfway between their middles.
  const pts = [...corners(car).filter((q) => inside(box, q.x, q.z)), ...corners(box).filter((q) => inside(car, q.x, q.z))];
  const at = pts.length ? pts.reduce((m, q) => ({ x: m.x + q.x / pts.length, z: m.z + q.z / pts.length }), { x: 0, z: 0 }) : { x: (car.x + box.x) / 2, z: (car.z + box.z) / 2 };
  return { ...best!, ...at };
}

/** Whether the car's footprint (a rectangle turned by rotY) overlaps box `b`. */
export function overlaps(p: { x: number; z: number; rotY: number }, b: Box, kind: CarKind = 'lambo'): boolean {
  return contact(p, b, kind) !== null;
}

/** The fastest a hit sets a car spinning (rad/s). */
export const MAX_SPIN = 6;

/** How hard the car's turned about its middle by a shove off-centre: its mass spread over its footprint. */
export const inertia = (kind: CarKind) => SPECS[kind].mass * (SPECS[kind].length ** 2 + SPECS[kind].width ** 2) / 12 * TIRES.inertia;

/**
 * The car bouncing off what it hit at `c`: the motion into it at the point of contact, less the
 * restitution's bounce, comes off. Off-centre, that spins it; into another vehicle, its mass takes
 * its share. Already parting: as it was.
 */
export function collide(p: CarPose, kind: CarKind, c: Contact, other: Pick<Box, 'mass' | 'vx' | 'vz'> = {}): CarPose {
  const s = Math.sin(p.rotY), co = Math.cos(p.rotY);
  let vx = s * p.speed + co * (p.slip ?? 0);
  let vz = co * p.speed - s * (p.slip ?? 0);
  let yaw = p.yaw ?? 0;
  const rx = c.x - p.x, rz = c.z - p.z;
  // Turning at `yaw`, a point `r` from the middle goes yaw × (rz, -rx); a push along n at r turns it by r × n.
  const arm = rz * c.nx - rx * c.nz;
  const into = (vx + yaw * rz - (other.vx ?? 0)) * c.nx + (vz - yaw * rx - (other.vz ?? 0)) * c.nz;
  if (into >= 0) return { ...p };
  const m = SPECS[kind].mass;
  const I = inertia(kind);
  const j = (-(1 + TIRES.restitution) * into) / (1 / m + (arm * arm) / I + (other.mass ? 1 / other.mass : 0));
  vx += (j * c.nx) / m;
  vz += (j * c.nz) / m;
  yaw += (j * arm) / I;
  const bike = SPECS[kind].width < 1;
  // However hard the hit, no more than a spin the tires can soon catch.
  return { ...p, speed: vx * s + vz * co, slip: bike ? 0 : vx * co - vz * s, yaw: bike ? 0 : clamp(yaw, -MAX_SPIN, MAX_SPIN) };
}

/**
 * Whether the car can be at `p`: clear of all of `solids`. Nothing invisible stops it in the city: it can
 * roll on into the sea (the driver's page sees it go under: client/driving.ts). Given `where` (the race
 * circuit, whose barriers are its edge), it must be on that too.
 */
export function carFits(p: { x: number; z: number; rotY: number }, solids: Iterable<Box>, kind: CarKind = 'lambo', where?: (x: number, z: number) => boolean): boolean {
  if (where && !onPavement(p, kind, where)) return false;
  for (const b of solids) if (overlaps(p, b, kind)) return false;
  return true;
}
