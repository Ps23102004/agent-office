import { SPECS, DRIVE_STEP, NEAR_MISS_EVERY, TANK, advance, seatOffset, carFits, carPoint, tankFill, type Box, type CarKind, type CarPose, type CarSeat, type Course, type Pedals } from '../shared/garage';
import { shoreRespawns, surfaceAt, vehicleSolids } from '../shared/city';
import type { PlayerController } from './player';
import type { ViewMode } from './state';
import type { Fleet } from './world/cars';

// Driving the cars in the garage: E at one gets you in (behind the wheel, or beside whoever's
// there), and it takes hold of you (PlayerController.rig) until you get out. The driver's page runs
// the car (shared/garage.ts) and tells the office where it's got to; everyone else's follows it.

export interface DriveHooks {
  /** The car you're driving has got to `pose` (on the boost, or not): tell the office, for everyone else on the floor. */
  moved(car: number, pose: CarPose, boosting?: boolean): void;
  /** You ran into something at `speed` m/s, at (x, z) (`vehicle`: another car, which stops). */
  bump(at: { x: number; z: number }, speed: number, vehicle?: boolean): void;
  /** What else is moving about near (x, z): the street's traffic, with its mass and motion. */
  traffic?(x: number, z: number, reach: number): Box[];
  /** The car you're driving went into the sea at (x, z), `speed` m/s: a splash. */
  splash?(at: { x: number; z: number }, speed: number): void;
  /** The screen going dark (and light again) while the car's fished out and put back on the road. */
  fade?(on: boolean): void;
  /** Where you're driving, if not the city's streets: the race circuit's edge and grass (shared/circuit.ts CIRCUIT_COURSE). */
  course?(): Omit<Course, 'solids' | 'bumped'> | undefined;
  /** Held on the brakes, whatever you press (on the grid, counting down). */
  hold?(): boolean;
}

/** Into the sea: how long the car takes to go under, when the screen goes dark, and when it's back on the road (seconds). */
const SINK = { fade: 0.7, back: 1.1, up: 1.25 } as const;

/** How often the office hears where your car is, at most (seconds). */
const SEND_EVERY = 0.066;
/** How soon after one crunch another can sound (seconds). */
const BUMP_EVERY = 0.35;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class Driver {
  /** The car you're in (its place in CARS), and your seat; null on your feet. */
  car: number | null = null;
  seat: CarSeat | null = null;
  /** How hard you're on the gas (-1 in reverse), for the engine. */
  gas = 0;
  /** The boost meter, 0 to 1 (see TANK), and whether you're on it now (Shift, with the gas down): for the HUD. */
  boost = 1;
  boosting = false;
  /** Holding X: looking back over your shoulder (or the chase camera round in front). */
  private lookingBack = false;
  /** Seconds behind the wheel (or beside it), for how often things happen. */
  private clock = 0;
  private sent = { at: -Infinity, x: 0, z: 0, rotY: 0, speed: 0, steer: 0, slip: 0, boosting: false };
  private bumpedAt = -Infinity;
  private nearMissAt = -Infinity;
  /** The way the car pointed last frame, to turn a first-person view along with it. */
  private yaw = 0;
  private remainder = 0;
  /** Seconds since the car went into the sea, while it's going under; null on land. */
  private sinking: number | null = null;
  /** How far under it's gone (m), which takes you down with it. */
  private sunk = 0;
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
    this.boosting = false;
    this.lookingBack = false;
    this.aim(v.pose);
    p.rig = (dt) => this.step(dt);
    p.riding = true;
    this.sit(0);
  }

  /** Looking out over the hood in first person, or from the chase camera behind the car in third (pulled back to see it). */
  private aim(pose: CarPose) {
    const p = this.player;
    p.camYaw = pose.rotY + Math.PI;
    if (p.view === 'first') {
      p.lookPitch = -0.12;
      this.chaseOff();
    } else if (!this.camWas) {
      this.camWas = { dist: p.camDist, pitch: p.camPitch };
      p.camDist = Math.max(p.camDist, 9);
      p.camPitch = Math.min(p.camPitch, 0.32);
    }
  }

  /** The third-person camera back as it was before the chase camera took it. */
  private chaseOff() {
    const p = this.player;
    if (!this.camWas) return;
    p.camDist = this.camWas.dist;
    p.camPitch = this.camWas.pitch;
    this.camWas = null;
  }

  /** First person or third, on your feet or in a car: in one, the camera goes over the hood or behind it. */
  setView(view: ViewMode) {
    const p = this.player;
    p.setView(view);
    const pose = this.pose;
    if (pose) {
      this.lookingBack = false;
      this.aim(pose);
      p.updateCamera(true);
    }
  }

  /**
   * How much wider the view is (degrees) for how fast you're going: nothing at a crawl, up to 22
   * more flat out, and 8 more on the boost.
   */
  get fov(): number {
    const pose = this.pose;
    if (!pose || this.car === null) return 0;
    const k = Math.min(1, Math.abs(pose.speed) / SPECS[this.fleet.cars[this.car].def.kind].top);
    return 22 * k * k + (this.boosting ? 8 : 0);
  }

  /**
   * Where you'd be getting out: by your own door, else the other one, else behind the car or in
   * front of it. Null if there's no room anywhere (or you're not in a car).
   */
  wayOut(): { x: number; y: number; z: number } | null {
    const car = this.car;
    const seat = this.seat;
    // Not while it's going under.
    if (car === null || seat === null || this.sinking !== null) return null;
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
    // Let go of on its way under: it's back on the road, as it would have been.
    const under = this.sinking !== null && this.sinking < SINK.back;
    if (this.sinking !== null) {
      this.sinking = null;
      this.sunk = 0;
      this.fleet.cars[car].root.rotation.x = 0;
      this.hooks.fade?.(false);
    }
    if (this.driving) {
      const was = this.fleet.cars[car].pose;
      const pose = { ...was, ...(under ? this.ashore(car, was) : {}), speed: 0, slip: 0, yaw: 0 };
      this.fleet.place(car, pose);
      this.hooks.moved(car, pose);
    }
    const p = this.player;
    p.rig = null;
    p.riding = false;
    this.chaseOff();
    if (this.boosting) this.fleet.cars[car].boosting = false;
    this.car = null;
    this.seat = null;
    this.gas = 0;
    this.boosting = false;
  }

  /** Each frame in the car: drive it (behind the wheel), and sit in your seat wherever it's got to. */
  private step(dt: number) {
    const car = this.car!;
    this.clock += dt;
    if (this.driving) {
      const p = this.player;
      const held = this.hooks.hold?.() ?? false;
      const kind = this.fleet.cars[car].def.kind;
      const pedals: Pedals = {
        gas: (p.holding('KeyW', 'ArrowUp') ? 1 : 0) - (p.holding('KeyS', 'ArrowDown') ? 1 : 0),
        turn: (p.holding('KeyA', 'ArrowLeft') ? 1 : 0) - (p.holding('KeyD', 'ArrowRight') ? 1 : 0),
        brake: p.holding('Space'),
        // A window open over the game (the map, the controls) takes your hands off: the brakes go on rather than it rolling on unsteered.
        stop: held || !p.enabled,
      };
      // Shift with the gas down, while there's boost left (pedals have no boost); run dry, it takes a tenth of a tank to light again.
      this.boosting = pedals.gas > 0 && !pedals.stop && this.boost > (this.boosting ? 0 : 0.1) && kind !== 'bicycle' && this.sinking === null && p.holding('ShiftLeft', 'ShiftRight');
      pedals.boost = this.boosting;
      this.fleet.cars[car].boosting = this.boosting;
      this.gas = pedals.gas;
      if (this.sinking !== null) {
        this.sink(car, dt);
        this.sit(dt);
        return;
      }
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
      this.boost = this.boosting ? Math.max(0, this.boost - Math.min(0.1, dt) / TANK.burn) : Math.min(1, this.boost + this.refill(pose, kind, solids, Math.min(0.1, dt)));
      // Its middle's gone off the beach into the sea: a splash, and it goes under (the office never hears it was in the water).
      if (!this.hooks.course?.() && surfaceAt(pose.x, pose.z) === 'water') {
        this.sinking = 0;
        this.remainder = 0;
        this.hooks.splash?.(pose, Math.hypot(pose.speed, pose.slip ?? 0));
        this.sink(car, 0);
      } else this.send(car, pose);
    }
    this.sit(dt);
  }

  /**
   * Going under: the car slows, noses down and sinks, the screen goes dark, and it's back on the
   * nearest road facing inland with room for it (see ashore), which the office hears as a jump.
   */
  private sink(car: number, dt: number) {
    const was = this.sinking!;
    const t = (this.sinking = was + dt);
    const v = this.fleet.cars[car];
    if (t < SINK.back) {
      const pose = v.pose;
      const drift = Math.max(0, 1 - t * 2.5);
      this.fleet.place(car, { ...pose, x: pose.x + Math.sin(pose.rotY) * pose.speed * drift * dt, z: pose.z + Math.cos(pose.rotY) * pose.speed * drift * dt, speed: pose.speed * drift, slip: 0, yaw: 0 });
      // Down it goes, nose first: the model only (the pose stays on the water, where the office last had it on land).
      const k = Math.min(1, t / SINK.back);
      this.sunk = k * k * 1.6;
      v.root.position.y -= this.sunk;
      v.root.rotation.order = 'YXZ';
      v.root.rotation.x = 0.35 * k;
      if (was < SINK.fade && t >= SINK.fade) this.hooks.fade?.(true);
      return;
    }
    if (was < SINK.back) {
      const at = this.ashore(car, v.pose);
      const pose: CarPose = { x: at.x, z: at.z, rotY: at.rotY, speed: 0, steer: 0, slip: 0, yaw: 0 };
      v.root.rotation.x = 0;
      this.sunk = 0;
      this.fleet.place(car, pose);
      this.yaw = pose.rotY;
      this.player.camYaw = pose.rotY + Math.PI;
      this.sent.at = -Infinity;
      this.send(car, pose);
    }
    if (t >= SINK.up) {
      this.sinking = null;
      this.hooks.fade?.(false);
    }
  }

  /**
   * Where car `car`, gone into the sea at `from`, comes back: the first of the spots by the nearest
   * road (shared/city.ts shoreRespawns) with room for it, clear of what's built there, the other cars
   * and the street's traffic. If every one is taken, the first anyway (you can drive out of that).
   */
  private ashore(car: number, from: { x: number; z: number }): { x: number; z: number; rotY: number } {
    const kind = this.fleet.cars[car].def.kind;
    const spots = shoreRespawns(from.x, from.z);
    const cars = this.fleet.solids(car);
    return spots.find((at) => carFits(at, [...cars, ...vehicleSolids(at.x, at.z, 8), ...(this.hooks.traffic?.(at.x, at.z, 12) ?? [])], kind)) ?? spots[0];
  }

  /** The car `dt` on from `from` (shared/garage.ts advance): through what's in the way, on the city's streets or the circuit. */
  private move(from: CarPose, pedals: Pedals, dt: number, solids: Box[]): CarPose {
    const kind = this.fleet.cars[this.car!].def.kind;
    return advance(from, pedals, dt, kind, { ...this.hooks.course?.(), solids, bumped: (at, speed, vehicle) => this.bumped(at, speed, vehicle) });
  }

  /** How much boost comes back (of the meter) over `dt` (shared/garage.ts tankFill), a near miss now and then. */
  private refill(p: CarPose, kind: CarKind, solids: Box[], dt: number): number {
    const { rate, nearMiss } = tankFill(p, kind, solids);
    if (!nearMiss || this.clock - this.nearMissAt <= NEAR_MISS_EVERY) return rate * dt;
    this.nearMissAt = this.clock;
    return rate * dt + TANK.nearMiss;
  }

  /** Ran into something at `at`, losing `speed` m/s of the car's: a crunch, if it's enough to hear. */
  private bumped(at: { x: number; z: number }, speed: number, vehicle = false) {
    if (speed < 2 || this.clock - this.bumpedAt < BUMP_EVERY) return;
    this.bumpedAt = this.clock;
    this.hooks.bump({ x: at.x, z: at.z }, speed, vehicle);
  }

  /** Tells the office where the car is, every so often while it's going (and once more when it stops). */
  private send(car: number, pose: CarPose) {
    const s = this.sent;
    const changed = Math.abs(pose.x - s.x) + Math.abs(pose.z - s.z) > 0.01 || Math.abs(wrap(pose.rotY - s.rotY)) > 0.004 || pose.speed !== s.speed || (pose.slip ?? 0) !== s.slip || Math.abs(pose.steer - s.steer) > 0.02 || this.boosting !== s.boosting;
    if (!changed || this.clock - s.at < SEND_EVERY) return;
    this.sent = { at: this.clock, x: pose.x, z: pose.z, rotY: pose.rotY, speed: pose.speed, steer: pose.steer, slip: pose.slip ?? 0, boosting: this.boosting };
    this.hooks.moved(car, pose, this.boosting);
  }

  /**
   * You in your seat, wherever the car's got to. In first person you look round from it, turning as
   * it turns; in third, the chase camera swings round behind it as it goes, on a spring that lags
   * through the corners and pulls back as you speed up. Holding X, you look back.
   */
  private sit(dt: number) {
    const p = this.player;
    const at = this.fleet.seatAt(this.car!, this.seat!)!;
    p.pos.set(at.x, at.y - this.sunk, at.z);
    p.facing = at.rotY;
    p.moving = false;
    const turned = wrap(at.rotY - this.yaw);
    this.yaw = at.rotY;
    const back = p.holding('KeyX');
    const flipped = back !== this.lookingBack;
    this.lookingBack = back;
    if (p.view === 'first') p.camYaw += turned + (flipped ? Math.PI : 0);
    else {
      const pose = this.fleet.cars[this.car!].pose;
      const speed = Math.abs(pose.speed);
      // Stiffer the faster it goes, so it never loses the car; looking back snaps round at once.
      const k = flipped ? 1 : Math.min(1, dt * (2.5 + speed * 0.06) * Math.min(1, speed / 4));
      p.camYaw += wrap(at.rotY + (back ? 0 : Math.PI) - p.camYaw) * k;
      if (this.camWas) {
        const top = SPECS[this.fleet.cars[this.car!].def.kind].top;
        const want = Math.max(this.camWas.dist, 9) + 3 * Math.min(1, speed / top);
        p.camDist += (want - p.camDist) * Math.min(1, dt * 2);
      }
    }
  }
}
