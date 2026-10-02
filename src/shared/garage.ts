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
  /** How far the tail's been let go of for a drift (0 to 1: see DRIFT), kept by your own physics like `yaw`. */
  drift?: number;
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
  /** Space: the handbrake on a car (it swings the tail round: a drift), an ordinary brake on a bike. */
  brake: boolean;
  /** Shift, with boost in the tank (client/driving.ts keeps the meter): faster, and on past top speed. */
  boost?: boolean;
  /** Held hard on the brakes whatever else is pressed, and kept stopped (no reverse): on the grid counting down, or with a window open over the game. */
  stop?: boolean;
}

/** Boost: how far past top speed it takes you, and the extra shove (m/s²) on top of the engine's. */
export const BOOST = { top: 1.35, accel: 9 } as const;
/** How much faster than top speed `kind` can go: on the boost, but a bicycle has none. */
export const boostTop = (kind: CarKind) => (kind === 'bicycle' ? 1 : BOOST.top);

export const DRIVE = {
  /** Flat out, forward and in reverse (m/s): a Lambo's. */
  top: SPECS.lambo.top,
  reverse: SPECS.lambo.reverse,
  /** Speeding up, forward and back, and slowing down on the brake (m/s²). */
  accel: 8,
  reverseAccel: 5,
  brake: 20,
  /** Rolling off the gas (m/s²): gentle, so lifting mid-corner never throws the car off it. */
  coast: 1.2,
  /** The air, off the gas: m/s² for each (m/s)², so a fast car slows quicker than a slow one. */
  drag: 0.0006,
  /** The handbrake: how hard it slows you (m/s²), and how much grip the locked rear tires keep. It swings the tail round; it doesn't stop you. */
  handbrake: 2.5,
  handbrakeGrip: 0.2,
  /** Between the axles (m): how tight a Lambo turns (every kind has its own: SPECS). */
  wheelbase: 2.8,
  /** How far the front wheels turn at a crawl (radians): less the faster you go, so it doesn't spin out. */
  steer: 0.6,
  /** How fast they turn at a crawl (radians a second). */
  steerRate: 2.8,
  /** At speed, how long the wheel takes from the middle to full lock, and back (s): quick, but never a twitch. */
  steerIn: 0.14,
  steerOut: 0.08,
  /** How hard a turn full lock asks for at speed, of what the tires hold: a little past it, so you can lean on them. */
  lock: 1.1,
  /** Under this speed (m/s, sideways too) the tires just follow the wheels: no sliding at a crawl. */
  crawl: 2.5,
} as const;

/**
 * The help a driver gets, as in an arcade racer: the car grips and goes where it's pointed, and you
 * drift it on purpose (the handbrake: see DRIFT), never by accident.
 * - `assist`: sliding, the front wheels turn into the slide by this much of its angle past `deadzone` (radians): the countersteer.
 * - `guard`: past this much slide (radians) drifting, the spin is caught; `guardOff` not drifting, much sooner. Never on the handbrake.
 * - `settle`: gripping (less slide than `deadzone`), how fast the turn eases to what the wheels ask (1/s): no wobble after a flick.
 * - `stability`: not drifting, it never turns faster than this much of what the tires can carry it round (the stability control).
 * - `power`: of the engine's push, the share the rear tires spend of their grip (the gas mid-corner steps the tail out); `traction`: of that, what's left with the wheel straight (the traction control).
 * - `brakeGrip`: braking spends grip too, the fronts most, but this much of it is always left to steer with (the ABS).
 * - `downforce`: grip grows by this much of (speed / top)², up to `downforceTop` of top speed, on cars.
 */
export const AIDS = { assist: 0.8, deadzone: 0.1, guard: 0.75, guardOff: 0.15, settle: 3, stability: 1.05, power: 0.7, traction: 0.4, brakeGrip: 0.55, downforce: 0.12, downforceTop: 1.2 } as const;

/**
 * A drift, on purpose: a tug on the handbrake at speed lets the tail go (`in` seconds to all the way).
 * It stays let go while the gas is down and the wheel turned into the turn (and, still sliding, a turn
 * back into it lets it go again), and grips again in `out` seconds once either isn't. Let go, the rear tires keep `rear` of their grip, and the car holds the
 * slide the wheel asks for: `angle` (radians) with it turned all the way into the turn, less with it
 * turned less, straight with it let go or off the gas, easing there in about `ease` seconds (`hold`: how firmly, 1/s).
 * Sideways, the tires scrub off speed: `scrub` g at right angles. Under `slow` m/s there's no drifting.
 */
export const DRIFT = { in: 0.12, out: 0.35, rear: 0.8, angle: 0.55, ease: 0.25, hold: 8, scrub: 0.6, slow: 8 } as const;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** How hard `kind`'s tires hold at `speed` on `ground` (a road, unless said): a car's harder the faster it goes, the air pressing it down onto them (AIDS.downforce); a bike leans instead. */
export function gripAt(kind: CarKind, speed: number, ground: { grip: number } = GROUND.road): number {
  const spec = SPECS[kind];
  return spec.grip * ground.grip * (spec.width < 1 ? 1 : 1 + AIDS.downforce * Math.min(AIDS.downforceTop, Math.abs(speed) / spec.top) ** 2);
}

/**
 * How far the front wheels can turn at `speed`: less the faster you go, down to what keeps the turn on
 * `kind`'s tires (of `grip`: on a road, unless said). It's the wheel the physics gives you gripping;
 * sliding, the countersteer (AIDS.assist) turns them on past it.
 */
export function steerLimit(speed: number, kind: CarKind = 'lambo', grip: number = gripAt(kind, speed)): number {
  return Math.min(DRIVE.steer / (1 + Math.abs(speed) / 9), Math.atan((SPECS[kind].wheelbase * grip * TIRES.gravity * DRIVE.lock) / Math.max(1, speed * speed)));
}

/** A short physics step (seconds), the same at 30 fps as at 60. */
export const DRIVE_STEP = 1 / 120;
/**
 * The tires: how stiff they are sideways (N a radian of slip, for each kg on the axle), and how the grip
 * falls past its peak (`shape`: sliding, it keeps sin(shape × 90°) of it); how high the weight sits, and
 * how far it can shift front to back (`load`, the front's share); the car's turning inertia over a plain
 * box's, and how much a hit bounces.
 */
export const TIRES = { gravity: 9.81, stiffness: 110, shape: 1.35, height: 0.3, load: [0.4, 0.6], inertia: 1.3, restitution: 0.25 } as const;

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

/** How much of an axle's grip its tires push back with, slipping at `angle` (radians): a curve, stiff `b` at first, peaking about 10°. */
const tire = (angle: number, b: number) => Math.sin(TIRES.shape * Math.atan(b * angle));

function tireStep(p: CarPose, pedals: Pedals, dt: number, kind: CarKind, ground: (typeof GROUND)[Surface]): CarPose {
  const spec = SPECS[kind];
  const bike = spec.width < 1;
  // No boost off the road: the grass and the sand only spin the wheels.
  const boost = !!pedals.boost && pedals.gas > 0 && !pedals.stop && !ground.drag;
  const fastest = spec.top * (boost ? BOOST.top : 1);
  const top = fastest * ground.top;
  let v = Math.abs(p.speed) < 1e-3 ? 0 : p.speed;
  let yaw = p.yaw ?? 0;
  let slip = p.slip ?? 0;
  const moving = Math.hypot(v, slip);
  const grip = gripAt(kind, moving, ground);
  // How far it's sliding: the angle between where it's pointed and where it's going (+ toward its left).
  const slide = !bike && moving > DRIVE.crawl ? Math.atan2(slip, Math.abs(v) + 1e-6) : 0;
  const handbrake = pedals.brake && !bike;
  const onGas = pedals.gas > 0 && !pedals.stop;
  // Let go of on the handbrake, kept on the gas while it's sliding, caught again otherwise.
  let drift = p.drift ?? 0;
  // Which way it's drifting (+ round to the left: its tail out to the right), and whether the wheel's turned that way.
  const way = Math.abs(slide) > 0.02 ? -Math.sign(slide) : Math.sign(yaw);
  const into = pedals.turn * way > 0;
  if (bike || Math.abs(v) < DRIFT.slow) drift = 0;
  else if (handbrake || (drift > 0 && onGas && into && Math.abs(slide) > AIDS.deadzone)) drift = Math.min(1, drift + dt / DRIFT.in);
  else if (!(drift > 0 && onGas && into)) drift = Math.max(0, drift - dt / DRIFT.out);
  const limit = steerLimit(v, kind, grip);
  // Sliding, the wheels turn into it by themselves (the countersteer), past a little.
  const assist = AIDS.assist * Math.sign(slide) * Math.max(0, Math.abs(slide) - AIDS.deadzone);
  // On the handbrake you can throw it in harder: that's how a drift starts.
  const want = clamp(clamp(pedals.turn, -1, 1) * (handbrake ? DRIVE.steer / (1 + Math.abs(v) / 9) : limit) + assist, -DRIVE.steer, DRIVE.steer);
  // A keyboard's wheel: to full lock in steerIn and back in steerOut, whatever the speed; never slower than at a crawl.
  const rate = Math.max(limit / (Math.abs(want) < Math.abs(p.steer) ? DRIVE.steerOut : DRIVE.steerIn), assist ? 3 : 0, Math.abs(v) < 8 ? DRIVE.steerRate : 0);
  const steer = p.steer + clamp(want - p.steer, -rate * dt, rate * dt);

  // Along the nose: the engine, the brakes and the air.
  const was = v;
  const toward = (target: number, rate: number) => (v += clamp(target - v, -rate * dt, rate * dt));
  const gas = pedals.stop ? 0 : clamp(pedals.gas, -1, 1);
  // Brakes bite as hard as the ground lets the tires.
  const brake = DRIVE.brake * Math.min(1, ground.grip * 1.25);
  // How hard the engine's pushing and the brakes pulling (m/s²): both spend the tires' grip.
  let push = 0, braking = 0;
  if (pedals.stop) {
    toward(0, brake);
    braking = brake;
  } else if (gas > 0) {
    if (v < 0) toward(0, brake);
    // The pull falls away toward top speed (a fifth of it left there, so it gets there): quick off the line, a long haul to the top.
    else if (v < top) {
      // The boost's shove is on top: it doesn't spin the wheels.
      push = spec.accel * (1 - 0.8 * (v / top) ** 2) * gas;
      v = Math.min(top, v + (push + (boost ? BOOST.accel * gas : 0)) * dt);
    }
  } else if (gas < 0) {
    if (v > 0) {
      toward(0, brake * -gas);
      braking = brake * -gas;
    } else {
      // Sliding backwards faster than it reverses (a spin, a bounce off a wall), the brakes slow it, not all at once.
      const most = spec.reverse * Math.max(0.5, ground.top);
      if (v < -most) toward(-most, brake * -gas);
      else v = Math.max(-most, v + Math.min(DRIVE.reverseAccel, spec.accel) * gas * dt);
    }
  } else toward(0, kind === 'bicycle' ? 0.65 : (kind === 'motorbike' ? 2 : DRIVE.coast) + DRIVE.drag * v * v);
  // A car's handbrake locks only the rear wheels: it slows you a little (the gas still pulls), and lets the tail come round.
  if (pedals.brake) toward(0, bike ? brake : DRIVE.handbrake);
  // Sideways, the tires scrub off speed: a drift costs a little.
  if (drift > 0) toward(0, DRIFT.scrub * drift * Math.abs(Math.sin(slide)) * TIRES.gravity);
  // Off the boost, past top speed: the air slows you back to it.
  if (!boost && v > spec.top * ground.top) toward(spec.top * ground.top, 4);
  // Off the road: the ground drags at the wheels, and bogs you down to what it lets you do.
  if (ground.drag) {
    // Rolling resistance grows with speed from nothing at rest: even a bicycle creeps across the sand.
    toward(0, ground.drag * Math.min(1, Math.abs(v) / 3));
    if (Math.abs(v) > top) toward(Math.sign(v) * top, 3 + ground.drag);
  }

  if (bike || moving < DRIVE.crawl) {
    // At walking speed the tires settle before another step: no jitter, and no sideways bikes.
    // No sharper than the tires can hold: sideways, v × yaw is at most grip × g.
    const most = (grip * TIRES.gravity) / Math.max(1, Math.abs(v));
    const target = clamp((v * Math.tan(steer)) / spec.wheelbase, -most, most);
    yaw += (target - yaw) * (1 - Math.exp(-dt * 18));
    // Any sideways creep left stops as fast as the tires can stop it, not all at once.
    slip = bike ? 0 : slip - Math.sign(slip) * Math.min(Math.abs(slip), grip * TIRES.gravity * dt);
  } else {
    const axle = spec.wheelbase / 2;
    const weight = spec.mass * TIRES.gravity;
    // Speeding up sits it back on its rear tires; braking, onto the fronts.
    const transfer = (spec.mass * ((v - was) / dt) * TIRES.height) / spec.wheelbase;
    const frontLoad = clamp(weight / 2 - transfer, weight * TIRES.load[0], weight * TIRES.load[1]);
    const rearLoad = weight - frontLoad;
    const along = Math.max(Math.abs(v), 1);
    const frontAngle = Math.atan2(slip + axle * yaw, along) - steer * Math.sign(v || 1);
    const rearAngle = Math.atan2(slip - axle * yaw, along);
    // The curve's stiffness, so the first of it is TIRES.stiffness a kg at the car's own weight on the axle.
    const b = (2 * TIRES.stiffness) / (TIRES.shape * grip * TIRES.gravity);
    const frontMost = grip * frontLoad;
    const rearMost = grip * rearLoad * (handbrake ? DRIVE.handbrakeGrip : 1 - (1 - DRIFT.rear) * drift);
    // A tire has only so much grip: what the engine and the brakes spend of it isn't there for cornering (but some always is).
    const drivePush = spec.mass * AIDS.power * push * (AIDS.traction + (1 - AIDS.traction) * Math.min(1, Math.abs(pedals.turn)));
    // Braking spends the fronts' (the rears keep rolling, so the tail stays put).
    const rearSpent = drivePush;
    const frontSpent = spec.mass * braking;
    const rearSide = Math.max(rearMost * AIDS.brakeGrip, Math.sqrt(Math.max(0, rearMost ** 2 - rearSpent ** 2)));
    const frontSide = Math.max(frontMost * AIDS.brakeGrip, Math.sqrt(Math.max(0, frontMost ** 2 - frontSpent ** 2)));
    const front = -frontSide * tire(frontAngle, b);
    const rear = -rearSide * tire(rearAngle, b);
    yaw += (axle * (front - rear)) / inertia(kind) * dt;
    // As sharp a turn as the tires can carry the car round (rad/s).
    const most = (grip * TIRES.gravity) / Math.max(1, Math.abs(v));
    if (handbrake) {
      // Nothing helps: the tail's yours to throw.
    } else if (drift > 0) {
      // Drifting: it turns as fast as its path does, plus what takes the slide to the angle the wheel asks for.
      // Off the gas it straightens while the tail's caught again, whatever the wheel's doing.
      const asked = onGas ? -way * DRIFT.angle * clamp(pedals.turn * way, 0, 1) : 0;
      const path = (front + rear) / spec.mass / Math.max(1, Math.abs(v));
      yaw += (path - (asked - slide) / DRIFT.ease - yaw) * Math.min(1, DRIFT.hold * drift * dt);
    } else {
      // Gripping, it never turns faster than the tires can carry it (lifting off, braking: no spin), and
      // with hardly any slide the turn eases to what the wheels ask: no wobble after a flick.
      if (Math.abs(yaw) > most * AIDS.stability) yaw += (Math.sign(yaw) * most * AIDS.stability - yaw) * Math.min(1, 10 * dt);
      if (Math.abs(slide) < AIDS.deadzone) yaw += (clamp((v * Math.tan(steer)) / spec.wheelbase, -most, most) - yaw) * Math.min(1, AIDS.settle * dt);
    }
    // Sliding too far off the handbrake (drifting, it can go further), the spin is caught.
    const guard = AIDS.guardOff + (AIDS.guard - AIDS.guardOff) * drift;
    if (!handbrake && Math.abs(slide) > guard) yaw *= 1 - Math.min(1, (dt * 6 * (Math.abs(slide) - guard)) / 0.3);
    slip += ((front + rear) / spec.mass - v * yaw) * dt;
  }
  // Reverse's top speed is the engine's (S, above, brakes a car going back faster), not a spin's: sliding backwards keeps its speed.
  v = clamp(v + yaw * slip * dt, -spec.top, spec.top * boostTop(kind));
  // Sideways no faster than it can go at all (a spin swaps speed between the two).
  slip = clamp(slip, -spec.top * boostTop(kind), spec.top * boostTop(kind));
  if (Math.abs(v) < 1e-3 && Math.abs(slip) < 0.01) { v = 0; slip = 0; yaw = 0; }
  const mid = p.rotY + yaw * dt / 2;
  return {
    x: p.x + (Math.sin(mid) * v + Math.cos(mid) * slip) * dt,
    z: p.z + (Math.cos(mid) * v - Math.sin(mid) * slip) * dt,
    rotY: Math.atan2(Math.sin(p.rotY + yaw * dt), Math.cos(p.rotY + yaw * dt)),
    speed: v, steer, slip, yaw, drift,
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

/** What a car drives through: what's in the way, and the ground under it. */
export interface Course {
  /** What it bumps into: walls, lamps, trees, and the other cars with their mass and motion. */
  solids: Box[];
  /** Where a car can be, if the place has an edge (the race circuit's tyre walls): over it is a barrier. */
  ground?: (x: number, z: number) => boolean;
  /** What's under the tires at (x, z): the city's surface, unless said. */
  surfaceAt?: (x: number, z: number) => Surface;
  /** What the ground does to the car after a step of `dt` (the circuit's grass bogs it down): the car as it is then. */
  surface?: (p: CarPose, dt: number) => CarPose;
  /** It ran into something at `at`, going into it at `speed` m/s (`vehicle`: another car). */
  bumped?: (at: { x: number; z: number }, speed: number, vehicle: boolean) => void;
}

/** The longest step a car takes in one go (m), so it never jumps a lamp post between two frames. */
const REACH_STEP = 0.25;

/**
 * The car `dt` on from `from` through `course`: in short steps, bouncing off whatever's in the way.
 * It's pushed back out of anything it's got into (the way out that's shortest), and the hit takes the
 * motion into it: off-centre, it spins the car round; into another car, its mass counts. A step that
 * would leave it further into something than it was doesn't happen. Where the ground has an edge, the
 * edge is a barrier too. The driver's page runs this for its own car, and the office for a bot's.
 */
export function advance(from: CarPose, pedals: Pedals, dt: number, kind: CarKind, course: Course): CarPose {
  const { solids, ground } = course;
  const under = course.surfaceAt ?? surfaceAt;
  // Spinning, its ends swing round further than its middle goes.
  const reach = Math.hypot(SPECS[kind].length, SPECS[kind].width) / 2;
  const n = Math.max(1, Math.ceil(((Math.hypot(from.speed, from.slip ?? 0) + Math.abs(from.yaw ?? 0) * reach) * dt) / REACH_STEP));
  const h = dt / n;
  const on = (q: CarPose) => !ground || onPavement(q, kind, ground);
  let pose = from;
  for (let i = 0; i < n; i++) {
    const driven = drive(pose, pedals, h, kind, under(pose.x, pose.z));
    let next = course.surface ? course.surface(driven, h) : driven;
    // Over the edge (from on it: one that's off can drive back on): off the barrier, and on along it from
    // where it was, the way the hit left it going (still over, it stays where it was this step).
    if (!on(next) && on(pose)) {
      const c = edge(next, kind, ground!);
      const b = hit({ ...next, x: pose.x, z: pose.z, rotY: pose.rotY }, kind, c);
      course.bumped?.(c, closing(driven, c), false);
      const s = Math.sin(pose.rotY), co = Math.cos(pose.rotY), slip = b.slip ?? 0;
      next = { ...b, x: pose.x + (s * b.speed + co * slip) * h, z: pose.z + (co * b.speed - s * slip) * h, rotY: pose.rotY + (b.yaw ?? 0) * h };
    }
    const out = unstick(next, kind, solids, course.bumped);
    next = out.p;
    // Wedged in deeper than before (two things at once, or the edge): it stays where it was, as the hits left it going.
    if (!on(next) || (!out.clear && depth(next, kind, solids) > depth(pose, kind, solids) + 1e-6)) next = { ...next, x: pose.x, z: pose.z, rotY: pose.rotY };
    pose = next;
  }
  return pose;
}

/** The car at `p` pushed out of `solids`, deepest first, bouncing off each it was going into; `clear` if it's out of them all. */
function unstick(p: CarPose, kind: CarKind, solids: Box[], bumped: Course['bumped']): { p: CarPose; clear: boolean } {
  for (let k = 0; k < 5; k++) {
    let deepest: { c: Contact; b: Box } | null = null;
    for (const b of solids) {
      const c = contact(p, b, kind);
      if (c && (!deepest || c.depth > deepest.c.depth)) deepest = { c, b };
    }
    if (!deepest) return { p, clear: true };
    // Out of goes (four pushes): still in something.
    if (k === 4) break;
    const { c, b } = deepest;
    bumped?.(c, closing(p, c, b), !!b.mass);
    p = hit(p, kind, c, b);
    p = { ...p, x: p.x + c.nx * (c.depth + 1e-4), z: p.z + c.nz * (c.depth + 1e-4) };
  }
  return { p, clear: false };
}

/**
 * A hit, as a game has it (collide is the bare physics). Nose first, the car's swung round to run
 * along what it hit, taking `align` seconds to get there. Otherwise it takes `spin` of the turn the
 * hit would give it and its turning is scrubbed to `scrub` of what it was, so a scrape along a barrier
 * never sets it spinning. Whatever's still going into what it hit afterwards (the impulse went into
 * the turn, or a corner caught) comes off at `bounce`, the scrape taking up to `scrape` of the motion
 * along it. A parked car is as good as a wall: it doesn't give.
 */
export const CONTACT = { align: 0.25, spin: 0.35, scrub: 0.5, bounce: 0.15, scrape: 0.25 } as const;

function hit(p: CarPose, kind: CarKind, c: Contact, other: Pick<Box, 'mass' | 'vx' | 'vz'> = {}): CarPose {
  const moving = !!other.mass && Math.hypot(other.vx ?? 0, other.vz ?? 0) > 0.5;
  const q = collide(p, kind, c, moving ? other : {});
  const s = Math.sin(q.rotY), co = Math.cos(q.rotY);
  // Nose first into it, the hit swings the nose away to run along it (in about `align` seconds, no
  // further: a glance, not a ricochet). A tail slapped round into it is mostly scrubbed away.
  const ahead = Math.sign(q.speed || 1);
  const facing = -ahead * (s * c.nx + co * c.nz);
  const turned = (q.yaw ?? 0) - (p.yaw ?? 0);
  const yaw = facing > 0 && ahead * (co * c.nx - s * c.nz) * turned > 0
    ? clamp(q.yaw ?? 0, -Math.asin(Math.min(1, facing)) / CONTACT.align, Math.asin(Math.min(1, facing)) / CONTACT.align)
    : ((p.yaw ?? 0) + turned * CONTACT.spin) * CONTACT.scrub;
  let vx = s * q.speed + co * (q.slip ?? 0), vz = co * q.speed - s * (q.slip ?? 0);
  const into = vx * c.nx + vz * c.nz - (moving ? (other.vx ?? 0) * c.nx + (other.vz ?? 0) * c.nz : 0);
  if (into < 0) {
    const ax = vx - into * c.nx, az = vz - into * c.nz;
    const keep = Math.max(0.5, 1 - (CONTACT.scrape * -into) / Math.max(1, Math.hypot(ax, az)));
    vx = ax * keep - CONTACT.bounce * into * c.nx;
    vz = az * keep - CONTACT.bounce * into * c.nz;
  }
  return { ...q, speed: vx * s + vz * co, slip: SPECS[kind].width < 1 ? 0 : vx * co - vz * s, yaw };
}

/** How far into `solids` the car at `p` is, all told (m); 0 clear of them all. */
function depth(p: CarPose, kind: CarKind, solids: Box[]): number {
  let d = 0;
  for (const b of solids) d += contact(p, b, kind)?.depth ?? 0;
  return d;
}

/** How fast the car at `p` is going into what's at `c` (m/s; less what that's doing itself). */
function closing(p: CarPose, c: Contact, other: Pick<Box, 'vx' | 'vz'> = {}): number {
  const s = Math.sin(p.rotY), co = Math.cos(p.rotY);
  const vx = s * p.speed + co * (p.slip ?? 0) - (other.vx ?? 0);
  const vz = co * p.speed - s * (p.slip ?? 0) - (other.vz ?? 0);
  return Math.max(0, -(vx * c.nx + vz * c.nz));
}

/** Directions round a point, to feel for which way the edge of `where` runs. */
const RING = Array.from({ length: 24 }, (_, i) => [Math.cos((i / 24) * Math.PI * 2), Math.sin((i / 24) * Math.PI * 2)]);

/**
 * Where the car at `p` has gone over the edge of `where`, and which way is back in, square to the
 * barrier itself: felt for round the point that's over (the ones inside, on a ring about it, lie
 * in toward the track), so a graze along it slides on rather than stopping dead.
 */
function edge(p: CarPose, kind: CarKind, where: (x: number, z: number) => boolean): Contact {
  const w = SPECS[kind].width / 2, l = SPECS[kind].length / 2;
  const off = [[w, l], [-w, l], [w, -l], [-w, -l], [w, 0], [-w, 0], [0, l], [0, -l]].map(([lx, lz]) => carPoint(p, lx, lz)).filter((q) => !where(q.x, q.z));
  const at = off.reduce((m, q) => ({ x: m.x + q.x / off.length, z: m.z + q.z / off.length }), { x: 0, z: 0 });
  let nx = 0, nz = 0;
  for (const r of [0.6, 1.5]) for (const [cx, cz] of RING) if (where(at.x + cx * r, at.z + cz * r)) { nx += cx; nz += cz; }
  let d = Math.hypot(nx, nz);
  // Nothing inside round it (or all of it): back toward the car's middle.
  if (d < 1e-6) { nx = p.x - at.x; nz = p.z - at.z; d = Math.hypot(nx, nz) || 1; }
  return { nx: nx / d, nz: nz / d, depth: 0, x: at.x, z: at.z };
}

/**
 * The boost meter (0 empty to 1 full): a full tank lasts `burn` seconds on Shift. It fills back slowly
 * by itself (`trickle` a second), faster drifting (by slip × speed, counting no more than `slip` m/s of
 * slip: a held drift fills under half a tank a second), slipping close past another moving car much
 * faster or slower than it (`nearMiss` of a tank, now and then), and tucked in behind one (`draft`).
 */
export const TANK = { burn: 3.5, trickle: 0.02, drift: 0.002, slip: 4.5, nearMiss: 0.12, draft: 0.2 } as const;
/** A near miss fills the tank once (by TANK.nearMiss), then not again for this long (seconds). */
export const NEAR_MISS_EVERY = 1.5;

/**
 * How fast the boost meter fills (of a tank a second) for the car at `p` among `solids`: a trickle,
 * more sliding sideways at speed and tucked in behind another car; and whether it's slipping close
 * past one (`nearMiss`: worth TANK.nearMiss once in a while, which the caller times).
 */
export function tankFill(p: CarPose, kind: CarKind, solids: Box[]): { rate: number; nearMiss: boolean } {
  const spec = SPECS[kind];
  const v = Math.abs(p.speed);
  let rate = TANK.trickle;
  let near = false;
  if (v > 6 && Math.abs(p.slip ?? 0) > 1) rate += TANK.drift * Math.min(TANK.slip, Math.abs(p.slip ?? 0)) * v;
  if (v > 15) {
    const s = Math.sin(p.rotY), c = Math.cos(p.rotY);
    let draft = false;
    for (const b of solids) {
      // Only what's moving: a parked car, or one stopped at the lights, is no near miss.
      const ox = b.vx ?? 0, oz = b.vz ?? 0;
      if (!b.mass || Math.hypot(ox, oz) < 2) continue;
      const dx = (b.minX + b.maxX) / 2 - p.x, dz = (b.minZ + b.maxZ) / 2 - p.z;
      // Where it is from you: across (+ left) and ahead.
      const across = Math.abs(dx * c - dz * s), ahead = dx * s + dz * c;
      const half = b.hx ?? (b.maxX - b.minX) / 2;
      const gap = across - spec.width / 2 - half;
      // Past it, not keeping it company.
      const passing = Math.hypot(s * p.speed - ox, c * p.speed - oz) > 5;
      if (passing && gap > 0 && gap < 1.5 && Math.abs(ahead) < spec.length) near = true;
      const going = ox * s + oz * c;
      if (across < 1.5 && ahead > spec.length / 2 + 1 && ahead < 18 && going > 10) draft = true;
    }
    if (draft) rate += TANK.draft;
  }
  return { rate, nearMiss: near };
}
