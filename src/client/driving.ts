import { SPECS, DRIVE_STEP, seatOffset, carFits, carPoint, drive, impact, overlaps, onPavement, type Box, type CarPose, type CarSeat, type Pedals } from '../shared/garage';
import type { PlayerController } from './player';
import type { Fleet } from './world/cars';

// Driving the cars in the garage: E at one gets you in (behind the wheel, or beside whoever's
// there), and it takes hold of you (PlayerController.rig) until you get out. The driver's page runs
// the car (shared/garage.ts) and tells the office where it's got to; everyone else's follows it.

export interface DriveHooks {
  /** The car you're driving has got to `pose`: tell the office, for everyone else on the floor. */
  moved(car: number, pose: CarPose): void;
  /** You ran into something at `speed` m/s, at (x, z). */
  bump(at: { x: number; z: number }, speed: number): void;
  /** What else is moving about near (x, z): the street's traffic, with its mass and motion. */
  traffic?(x: number, z: number, reach: number): Box[];
  /** Where a car can be, if not the pavement (at the race circuit: the track, its grass and the paddock). */
  ground?(): ((x: number, z: number) => boolean) | undefined;
  /** What the ground does to the car after a step of `dt` (grass slows it): the car as it is then. */
  surface?(p: CarPose, dt: number): CarPose;
  /** Held on the brakes, whatever you press (on the grid, counting down). */
  hold?(): boolean;
}

/** How often the office hears where your car is, at most (seconds). */
const SEND_EVERY = 0.066;
/** How soon after one crunch another can sound (seconds). */
const BUMP_EVERY = 0.35;
/** The longest step a car takes in one go (m), so it never jumps a lamp post between two frames. */
const STEP = 0.25;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class Driver {
  /** The car you're in (its place in CARS), and your seat; null on your feet. */
  car: number | null = null;
  seat: CarSeat | null = null;
  /** How hard you're on the gas (-1 in reverse), for the engine. */
  gas = 0;
  /** Seconds behind the wheel (or beside it), for how often things happen. */
  private clock = 0;
  private sent = { at: -Infinity, x: 0, z: 0, rotY: 0, speed: 0, steer: 0, slip: 0 };
  private bumpedAt = -Infinity;
  /** The way the car pointed last frame, to turn a first-person view along with it. */
  private yaw = 0;
  private remainder = 0;
  /** How the third-person camera was before you got in: it pulls back to see the car. */
  private camWas: { dist: number; pitch: number } | null = null;

  constructor(
    private player: PlayerController,
    /** The cars you can get into where you are: the garage's, or the race circuit's. Changed only while you're on your feet. */
    public fleet: Fleet,
    private hooks: DriveHooks,
  ) {}

  get active(): boolean {
    return this.car !== null;
  }

  /** Behind the wheel, rather than beside it. */
  get driving(): boolean {
    return this.seat === 'driver';
  }

  /** The car you're in, as it's drawn. */
  get pose(): CarPose | null {
    return this.car === null ? null : this.fleet.cars[this.car].pose;
  }

  /** Gets into `seat` of car `car`, looking out over its hood. */
  enter(car: number, seat: CarSeat) {
    const v = this.fleet.cars[car];
    if (this.active || !v || (seat === 'passenger' && SPECS[v.def.kind].seats < 2)) return;
    this.car = car;
    this.seat = seat;
    this.gas = 0;
    this.remainder = 0;
    this.sent.at = -Infinity;
    const p = this.player;
    p.stopWalking();
    p.moving = false;
    p.vy = 0;
    this.yaw = v.pose.rotY;
    if (p.view === 'first') {
      p.camYaw = v.pose.rotY + Math.PI;
      p.lookPitch = -0.12;
    } else {
      this.camWas = { dist: p.camDist, pitch: p.camPitch };
      p.camDist = Math.max(p.camDist, 9);
      p.camPitch = Math.min(p.camPitch, 0.32);
      p.camYaw = v.pose.rotY + Math.PI;
    }
    p.rig = (dt) => this.step(dt);
    p.riding = true;
    this.sit(0);
  }

  /**
   * Where you'd be getting out: by your own door, else the other one, else behind the car or in
   * front of it. Null if there's no room anywhere (or you're not in a car).
   */
  wayOut(): { x: number; y: number; z: number } | null {
    const car = this.car;
    const seat = this.seat;
    if (car === null || seat === null) return null;
    const pose = this.fleet.cars[car].pose;
    const y = this.fleet.seatAt(car, seat)!.y;
    const kind = this.fleet.cars[car].def.kind;
    const spec = SPECS[kind];
    const s = seatOffset(kind, seat);
    // Far enough out to clear the car's boxes at any angle (turned, they stick out past its sides).
    const out = spec.width / 2 + 0.8;
    const side = Math.sign(s.x || 1);
    for (const [lx, lz] of [
      [side * out, s.z],
      [side * out, 0.9],
      [-side * out, s.z],
      [0, -spec.length / 2 - 0.6],
      [0, spec.length / 2 + 0.6],
    ]) {
      const q = carPoint(pose, lx, lz);
      if (this.player.fits(q.x, q.z, y)) return { x: q.x, y, z: q.z };
    }
    return null;
  }

  /** Out onto your feet beside the car (see wayOut). False if there's no room, unless `anyway` (you stand up where you sat). */
  leave(anyway = false): boolean {
    const pose = this.pose;
    if (!pose) return true;
    const at = this.wayOut();
    if (!at && !anyway) return false;
    this.drop();
    const p = this.player;
    if (at) p.pos.set(at.x, at.y, at.z);
    p.facing = pose.rotY;
    p.camYaw = pose.rotY + Math.PI;
    p.lookPitch = -0.08;
    return true;
  }

  /** Lets go of the car where you are (something else is moving you: another floor, a desk): driving, it stops there. */
  drop() {
    const car = this.car;
    if (car === null) return;
    if (this.driving) {
      const pose = { ...this.fleet.cars[car].pose, speed: 0, slip: 0, yaw: 0 };
      this.fleet.place(car, pose);
      this.hooks.moved(car, pose);
    }
    const p = this.player;
    p.rig = null;
    p.riding = false;
    if (this.camWas) {
      p.camDist = this.camWas.dist;
      p.camPitch = this.camWas.pitch;
      this.camWas = null;
    }
    this.car = null;
    this.seat = null;
    this.gas = 0;
  }

  /** Each frame in the car: drive it (behind the wheel), and sit in your seat wherever it's got to. */
  private step(dt: number) {
    const car = this.car!;
    this.clock += dt;
    if (this.driving) {
      const p = this.player;
      const held = this.hooks.hold?.() ?? false;
      const pedals: Pedals = {
        gas: held ? 0 : (p.holding('KeyW', 'ArrowUp') ? 1 : 0) - (p.holding('KeyS', 'ArrowDown') ? 1 : 0),
        turn: (p.holding('KeyA', 'ArrowLeft') ? 1 : 0) - (p.holding('KeyD', 'ArrowRight') ? 1 : 0),
        brake: held || p.holding('Space'),
      };
      this.gas = pedals.gas;
      // A slow frame carries its fraction over; a paused tab never gets a giant physics step.
      this.remainder += Math.min(0.1, Math.max(0, dt));
      let pose = this.fleet.cars[car].pose;
      // What's in the way, once a frame: a frame's steps don't take the car out of reach of it.
      const solids = this.fleet.solids(car);
      if (this.hooks.traffic) solids.push(...this.hooks.traffic(pose.x, pose.z, 12 + Math.abs(pose.speed) * 0.2));
      while (this.remainder + 1e-10 >= DRIVE_STEP) {
        pose = this.move(pose, pedals, DRIVE_STEP, solids);
        this.fleet.place(car, pose);
        this.remainder = Math.max(0, this.remainder - DRIVE_STEP);
      }
      this.fleet.place(car, pose);
      this.send(car, pose);
    }
    this.sit(dt);
  }

  /**
   * The car `dt` on from `from`: in short steps, stopping at whatever's in the way. At an angle to
   * it, the car slides along it; head on, it bounces back off.
   */
  private move(from: CarPose, pedals: Pedals, dt: number, solids: Box[]): CarPose {
    const kind = this.fleet.cars[this.car!].def.kind;
    const ground = this.hooks.ground?.();
    const fits = (p: CarPose) => carFits(p, solids, kind, ground);
    const n = Math.max(1, Math.ceil((Math.hypot(from.speed, from.slip ?? 0) * dt) / STEP));
    const h = dt / n;
    // Already in something (someone parked on top of you): drive out of it any way you like.
    const stuck = !fits(from);
    let pose = from;
    for (let i = 0; i < n; i++) {
      const driven = drive(pose, pedals, h, kind);
      const next = this.hooks.surface ? this.hooks.surface(driven, h) : driven;
      if (stuck ? onPavement(next, kind, ground) : fits(next)) {
        pose = next;
        continue;
      }
      // Sliding keeps only the part of the move along what's in the way (everything here is square to
      // the street), and only that much of the speed; the car swings round to run along it.
      const dx = next.x - pose.x;
      const dz = next.z - pose.z;
      const want = Math.hypot(dx, dz) || 1;
      const hit = solids.find((b) => overlaps(next, b, kind));
      // Which face stopped the move? If both did, use the nearest face of the box.
      const xClear = fits({ ...next, x: pose.x });
      const zClear = fits({ ...next, z: pose.z });
      const across = xClear && !zClear ? true : zClear && !xClear ? false : hit
        ? Math.abs(pose.x - (hit.minX + hit.maxX) / 2) / ((hit.maxX - hit.minX) / 2 + SPECS[kind].width / 2)
          > Math.abs(pose.z - (hit.minZ + hit.maxZ) / 2) / ((hit.maxZ - hit.minZ) / 2 + SPECS[kind].length / 2)
        : Math.abs(dx) > Math.abs(dz);
      const nx = across ? -Math.sign(dx || 1) : 0;
      const nz = across ? 0 : -Math.sign(dz || 1);
      const struck = impact(next, kind, nx, nz, hit);
      const hitSpeed = Math.max(0, -(
        nx * (Math.sin(next.rotY) * next.speed + Math.cos(next.rotY) * (next.slip ?? 0) - (hit?.vx ?? 0))
        + nz * (Math.cos(next.rotY) * next.speed - Math.sin(next.rotY) * (next.slip ?? 0) - (hit?.vz ?? 0))));
      const slides = [
        { to: { ...next, z: pose.z }, keep: Math.abs(dx) / want, heading: Math.sign(dx) * (Math.PI / 2) },
        { to: { ...next, x: pose.x }, keep: Math.abs(dz) / want, heading: dz > 0 ? 0 : Math.PI },
      ].filter((q) => q.keep > 0.25 && fits(q.to));
      const along = slides.sort((a, b) => b.keep - a.keep)[0];
      if (along) {
        this.bumped(pose, hitSpeed);
        const slid = { ...along.to, yaw: 0 };
        // Backing along it, it's the tail that leads.
        const heading = along.heading + (next.speed < 0 ? Math.PI : 0);
        // Three tenths of the way round each 1/120 s, however short the step: it settles along it without a pop.
        const rotY = wrap(slid.rotY + wrap(heading - slid.rotY) * (1 - 0.7 ** (h * 120)));
        // Swinging round about its middle takes its far end into it: a nudge off it, the way it came.
        const off = along.heading === 0 || along.heading === Math.PI ? { x: -Math.sign(dx), z: 0 } : { x: 0, z: -Math.sign(dz) };
        const turned = [0, 0.03, 0.08].map((d) => ({ ...slid, rotY, x: slid.x + off.x * d, z: slid.z + off.z * d })).find((q) => fits(q));
        pose = turned ?? slid;
        // Keep the tangent in world space while the body turns under it.
        const vx = Math.sin(next.rotY) * struck.speed + Math.cos(next.rotY) * (struck.slip ?? 0);
        const vz = Math.cos(next.rotY) * struck.speed - Math.sin(next.rotY) * (struck.slip ?? 0);
        const alongX = along.heading === Math.PI / 2 || along.heading === -Math.PI / 2;
        const tx = alongX ? vx : 0;
        const tz = alongX ? 0 : vz;
        pose = { ...pose, speed: tx * Math.sin(pose.rotY) + tz * Math.cos(pose.rotY),
          slip: SPECS[kind].width < 1 ? 0 : tx * Math.cos(pose.rotY) - tz * Math.sin(pose.rotY) };
        continue;
      }
      this.bumped(pose, hitSpeed);
      pose = { ...struck, x: pose.x, z: pose.z, rotY: pose.rotY, steer: next.steer };
      break;
    }
    return pose;
  }

  /** Ran into something, losing `speed` m/s of the car's: a crunch, if it's enough to hear. */
  private bumped(pose: CarPose, speed: number) {
    if (speed < 2 || this.clock - this.bumpedAt < BUMP_EVERY) return;
    this.bumpedAt = this.clock;
    this.hooks.bump(carPoint(pose, 0, (Math.sign(pose.speed) * SPECS[this.fleet.cars[this.car!].def.kind].length) / 2), speed);
  }

  /** Tells the office where the car is, every so often while it's going (and once more when it stops). */
  private send(car: number, pose: CarPose) {
    const s = this.sent;
    const changed = Math.abs(pose.x - s.x) + Math.abs(pose.z - s.z) > 0.01 || Math.abs(wrap(pose.rotY - s.rotY)) > 0.004 || pose.speed !== s.speed || (pose.slip ?? 0) !== s.slip || Math.abs(pose.steer - s.steer) > 0.02;
    if (!changed || this.clock - s.at < SEND_EVERY) return;
    this.sent = { at: this.clock, x: pose.x, z: pose.z, rotY: pose.rotY, speed: pose.speed, steer: pose.steer, slip: pose.slip ?? 0 };
    this.hooks.moved(car, pose);
  }

  /**
   * You in your seat, wherever the car's got to. In first person you look round from it, turning as
   * it turns; in third, the camera swings round behind it as it goes.
   */
  private sit(dt: number) {
    const p = this.player;
    const at = this.fleet.seatAt(this.car!, this.seat!)!;
    p.pos.set(at.x, at.y, at.z);
    p.facing = at.rotY;
    p.moving = false;
    const turned = wrap(at.rotY - this.yaw);
    this.yaw = at.rotY;
    if (p.view === 'first') p.camYaw += turned;
    else {
      const speed = Math.abs(this.fleet.cars[this.car!].pose.speed);
      const k = Math.min(1, dt * 2.5 * Math.min(1, speed / 4));
      p.camYaw += wrap(at.rotY + Math.PI - p.camYaw) * k;
    }
  }
}
