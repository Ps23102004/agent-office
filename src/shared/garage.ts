import { FLOOR, ROAD, WALL_T } from './layout.js';
import { surfaceAt, type Surface } from './city.js';

// The cars and bikes in the garage, which anyone can drive: where they're parked, where you can
// take them (the garage, the lots round it and the street), and the arcade physics a driver's own
// page runs. Everyone else on the floor sees the car where its driver says it is.

export type CarKind = 'lambo' | 'ferrari' | 'motorbike' | 'bicycle' | 'sedan-sports' | 'suv' | 'police' | 'taxi' | 'race' | 'race-future';

/** Metres for the body, kg with riders for the mass, m/s at the top, m/s² on the gas, and tire grip. */
export const SPECS = {
  lambo: { length: 4.6, width: 2, body: 0.82, roof: 1.12, mass: 1450, top: 20, accel: 8, grip: 1.15, seats: 2, wheelbase: 2.8, reverse: 7 },
  ferrari: { length: 4.6, width: 2, body: 0.82, roof: 1.16, mass: 1550, top: 22, accel: 7.6, grip: 1.2, seats: 2, wheelbase: 2.72, reverse: 7 },
  motorbike: { length: 2.2, width: 0.78, body: 0.8, roof: 1.15, mass: 260, top: 24, accel: 6, grip: 1.05, seats: 2, wheelbase: 1.5, reverse: 3 },
  bicycle: { length: 1.85, width: 0.62, body: 0.82, roof: 1.12, mass: 95, top: 7, accel: 1.8, grip: 0.9, seats: 1, wheelbase: 1.12, reverse: 2 },
  // Kenney's cars (client/world/carkit.ts): their sizes are the models'. `seatZ`/`hips`: where you sit, if not the usual.
  'sedan-sports': { length: 4.34, width: 1.76, body: 1.08, roof: 1.49, mass: 1350, top: 21, accel: 7.4, grip: 1.12, seats: 2, wheelbase: 2.24, reverse: 7 },
  suv: { length: 4.59, width: 2.03, body: 1.08, roof: 1.76, mass: 2100, top: 17, accel: 5.6, grip: 1.0, seats: 2, wheelbase: 2.24, reverse: 6 },
  police: { length: 5.27, width: 2.03, body: 1.08, roof: 1.76, mass: 1750, top: 21, accel: 7, grip: 1.1, seats: 2, wheelbase: 2.75, reverse: 7 },
  taxi: { length: 4.68, width: 2.03, body: 1.08, roof: 2.03, mass: 1500, top: 16, accel: 5.5, grip: 1.0, seats: 2, wheelbase: 2.58, reverse: 6 },
  race: { length: 4.35, width: 1.62, body: 0.66, roof: 0.99, mass: 760, top: 26, accel: 10, grip: 1.4, seats: 1, wheelbase: 2.58, reverse: 5, seatZ: -0.35, hips: 0.25 },
  'race-future': { length: 4.52, width: 1.62, body: 0.8, roof: 1.12, mass: 780, top: 27, accel: 10.4, grip: 1.45, seats: 1, wheelbase: 2.58, reverse: 5, seatZ: -0.45, hips: 0.3 },
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
}

export const DRIVE = {
  /** Flat out, forward and in reverse (m/s). */
  top: 20,
  reverse: 7,
  /** Speeding up, forward and back, and slowing down on the brake or rolling (m/s²). */
  accel: 8,
  reverseAccel: 5,
  brake: 20,
  coast: 2.5,
  /** Between the axles (m): how tight it turns. */
  wheelbase: 2.8,
  /** How far the front wheels turn at a crawl (radians): less the faster you go, so it doesn't spin out. */
  steer: 0.6,
  /** How fast they turn (radians a second). */
  steerRate: 2.8,
} as const;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** How far the front wheels can turn at `speed`. */
export function steerLimit(speed: number): number {
  return DRIVE.steer / (1 + Math.abs(speed) / 9);
}

/** A short physics step (seconds), the same at 30 fps as at 60. */
export const DRIVE_STEP = 1 / 120;
export const TIRES = { gravity: 9.81, stiffness: 18, height: 0.45, rearBrakeGrip: 0.16, inertia: 1.3, restitution: 0.22 } as const;

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
  const top = spec.top * ground.top;
  const bike = spec.width < 1;
  const want = clamp(pedals.turn, -1, 1) * steerLimit(p.speed);
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
    else if (v < top) v = Math.min(top, v + spec.accel * gas * dt);
  } else if (gas < 0) {
    if (v > 0) toward(0, brake);
    else v = Math.max(-spec.reverse * Math.max(0.5, ground.top), v + Math.min(DRIVE.reverseAccel, spec.accel) * gas * dt);
  } else toward(0, kind === 'bicycle' ? 0.65 : kind === 'motorbike' ? 2 : DRIVE.coast);
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
  v = clamp(v + yaw * slip * dt, -spec.reverse, spec.top);
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

/** A hit takes away the motion into it, leaving the motion along it: mass matters for another vehicle. */
export function impact(p: CarPose, kind: CarKind, nx: number, nz: number, other: Pick<Box, 'mass' | 'vx' | 'vz'> = {}): CarPose {
  const s = Math.sin(p.rotY), c = Math.cos(p.rotY);
  let vx = s * p.speed + c * (p.slip ?? 0);
  let vz = c * p.speed - s * (p.slip ?? 0);
  const into = (vx - (other.vx ?? 0)) * nx + (vz - (other.vz ?? 0)) * nz;
  if (into >= 0) return { ...p };
  const share = other.mass ? other.mass / (SPECS[kind].mass + other.mass) : 1;
  const impulse = -(1 + TIRES.restitution) * into * share;
  vx += nx * impulse;
  vz += nz * impulse;
  return { ...p, speed: vx * s + vz * c, slip: SPECS[kind].width < 1 ? 0 : vx * c - vz * s, yaw: 0 };
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

/** Whether the car's footprint (a rectangle turned by rotY) overlaps box `b` (separating axes). */
export function overlaps(p: { x: number; z: number; rotY: number }, b: Box, kind: CarKind = 'lambo'): boolean {
  const hx = SPECS[kind].width / 2;
  const hz = SPECS[kind].length / 2;
  const ex = (b.maxX - b.minX) / 2;
  const ez = (b.maxZ - b.minZ) / 2;
  const dx = (b.minX + b.maxX) / 2 - p.x;
  const dz = (b.minZ + b.maxZ) / 2 - p.z;
  const s = Math.abs(Math.sin(p.rotY));
  const c = Math.abs(Math.cos(p.rotY));
  if (Math.abs(dx) >= c * hx + s * hz + ex) return false;
  if (Math.abs(dz) >= s * hx + c * hz + ez) return false;
  const sn = Math.sin(p.rotY);
  const cs = Math.cos(p.rotY);
  // Across the car, and along it.
  if (Math.abs(dx * cs - dz * sn) >= hx + ex * c + ez * s) return false;
  if (Math.abs(dx * sn + dz * cs) >= hz + ex * s + ez * c) return false;
  return true;
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
