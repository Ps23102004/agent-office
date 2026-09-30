import { FLOOR, ROAD, WALL_T } from './layout.js';
import { cityPaved } from './city.js';

// The cars and bikes in the garage, which anyone can drive: where they're parked, where you can
// take them (the garage, the lots round it and the street), and the arcade physics a driver's own
// page runs. Everyone else on the floor sees the car where its driver says it is.

export type CarKind = 'lambo' | 'ferrari' | 'motorbike' | 'bicycle';

/** Metres for the body, kg with riders for the mass, m/s at the top, m/s² on the gas, and tire grip. */
export const SPECS = {
  lambo: { length: 4.6, width: 2, body: 0.82, roof: 1.12, mass: 1450, top: 20, accel: 8, grip: 1.15, seats: 2, wheelbase: 2.8, reverse: 7 },
  ferrari: { length: 4.6, width: 2, body: 0.82, roof: 1.16, mass: 1550, top: 22, accel: 7.6, grip: 1.2, seats: 2, wheelbase: 2.72, reverse: 7 },
  motorbike: { length: 2.2, width: 0.78, body: 0.8, roof: 1.15, mass: 260, top: 24, accel: 6, grip: 1.05, seats: 2, wheelbase: 1.5, reverse: 3 },
  bicycle: { length: 1.85, width: 0.62, body: 0.82, roof: 1.12, mass: 95, top: 7, accel: 1.8, grip: 0.9, seats: 1, wheelbase: 1.12, reverse: 2 },
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
];

export type CarSeat = 'driver' | 'passenger';

/**
 * Where the two of you sit, in the car's own frame (x across, +x on the driver's left side; z toward
 * the nose), and how high your hips are off the ground. Your head's up out of the top: with anyone
 * in it, the roof comes off.
 */
export const SEATS: Record<CarSeat, { x: number; z: number }> = { driver: { x: 0.42, z: -0.5 }, passenger: { x: -0.42, z: -0.5 } };
export const SEAT_HIPS = 0.45;

/** A saddle runs down the middle; on a motorbike there's room behind you for a passenger. */
export function seatOffset(kind: CarKind, seat: CarSeat): { x: number; z: number } {
  return SPECS[kind].width < 1 ? { x: 0, z: seat === 'driver' ? -0.12 : -0.6 } : SEATS[seat];
}

export function seatHips(kind: CarKind): number {
  return SPECS[kind].width < 1 ? 0.82 : SEAT_HIPS;
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

/** Every car in its spot, as the office starts. */
export function parked(): CarState[] {
  return CARS.map((c) => ({ x: c.x, z: c.z, rotY: c.rotY, speed: 0, steer: 0, slip: 0 }));
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

/** The car `dt` seconds on: tires push across the body and turn it about its middle. No world state. */
export function drive(p: CarPose, pedals: Pedals, dt: number, kind: CarKind = 'lambo'): CarPose {
  if (!Number.isFinite(dt) || dt <= 0) return { ...p };
  // Also keep callers outside Driver stable when they give us a whole frame at once.
  const n = Math.ceil(dt / DRIVE_STEP);
  const h = dt / n;
  let next = p;
  for (let i = 0; i < n; i++) next = tireStep(next, pedals, h, kind);
  return next;
}

function tireStep(p: CarPose, pedals: Pedals, dt: number, kind: CarKind): CarPose {
  const spec = SPECS[kind];
  const bike = spec.width < 1;
  const want = clamp(pedals.turn, -1, 1) * steerLimit(p.speed);
  const steer = p.steer + clamp(want - p.steer, -DRIVE.steerRate * dt, DRIVE.steerRate * dt);
  let v = p.speed;
  const toward = (target: number, rate: number) => (v += clamp(target - v, -rate * dt, rate * dt));
  const gas = clamp(pedals.gas, -1, 1);
  if (pedals.brake) toward(0, DRIVE.brake);
  else if (gas > 0) {
    if (v < 0) toward(0, DRIVE.brake);
    else v = Math.min(spec.top, v + spec.accel * gas * dt);
  } else if (gas < 0) {
    if (v > 0) toward(0, DRIVE.brake);
    else v = Math.max(-spec.reverse, v + Math.min(DRIVE.reverseAccel, spec.accel) * gas * dt);
  } else toward(0, bike ? 0.65 : DRIVE.coast);

  let yaw = p.yaw ?? 0;
  let slip = p.slip ?? 0;
  if (bike || Math.abs(v) < 3) {
    // At walking speed the tires settle before another step: no jitter, and no sideways bikes.
    const target = v * Math.tan(steer) / spec.wheelbase;
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
    const frontGrip = spec.grip * frontLoad;
    const rearGrip = spec.grip * rearLoad * (pedals.brake ? TIRES.rearBrakeGrip : 1);
    const front = clamp(-frontAngle * spec.mass * TIRES.stiffness, -frontGrip, frontGrip);
    const rear = clamp(-rearAngle * spec.mass * TIRES.stiffness, -rearGrip, rearGrip);
    const inertia = spec.mass * (spec.length ** 2 + spec.width ** 2) / 12 * TIRES.inertia;
    yaw += axle * (front - rear) / inertia * dt;
    slip += ((front + rear) / spec.mass - v * yaw) * dt;
  }
  v = clamp(v + yaw * slip * dt, -spec.reverse, spec.top);
  slip = clamp(slip, -spec.top * 0.75, spec.top * 0.75);
  if (v === 0 && Math.abs(slip) < 0.01) { slip = 0; yaw = 0; }
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

/** Whether (x, z) is somewhere a car can be. */
export function paved(x: number, z: number): boolean {
  return PAVEMENT.some((b) => x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) || cityPaved(x, z);
}

/** Whether the whole car is on the pavement: its corners, and halfway along each side. */
export function onPavement(p: { x: number; z: number; rotY: number }, kind: CarKind = 'lambo'): boolean {
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
    if (!paved(at.x, at.z)) return false;
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

/** Whether the car can be at `p`: on the pavement, clear of all of `solids`. */
export function carFits(p: { x: number; z: number; rotY: number }, solids: Iterable<Box>, kind: CarKind = 'lambo'): boolean {
  if (!onPavement(p, kind)) return false;
  for (const b of solids) if (overlaps(p, b, kind)) return false;
  return true;
}
