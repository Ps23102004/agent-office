import * as THREE from 'three';
import { SPECS, CARS, SEATS, seatOffset, seatHips, leanAngle, carPoint, type Box, type CarDef, type CarKind, type CarPose, type CarSeat, type CarState } from '../../shared/garage';
import { citySolids } from '../../shared/city';
import { FLOOR, SLAB, STREET_Y, WALL_T } from '../../shared/layout';
import type { Collider, Interactable } from './office';
import { mergeByMaterial, mergeColored, mesh, toon } from './toon';

const WIDTH = 1.9;
const WHEEL_R = 0.37;
const WHEEL_Y = 0.37;

/** Wheel arches cut up into the bottom of a side profile, rear to front. */
function sill(s: THREE.Shape, rearX: number, frontX: number, axles: [number, number], bottom = 0.2) {
  const r = 0.46;
  const dx = Math.sqrt(r * r - (WHEEL_Y - bottom) ** 2);
  const a0 = Math.PI + Math.atan2(WHEEL_Y - bottom, dx);
  const a1 = -Math.atan2(WHEEL_Y - bottom, dx);
  s.moveTo(rearX, bottom);
  for (const ax of axles) {
    s.lineTo(ax - dx, bottom);
    s.absarc(ax, WHEEL_Y, r, a0, a1, true);
  }
  s.lineTo(frontX, bottom);
}

/**
 * Side profiles (x runs rear to front along the car, y up): the painted body and the glass cabin on
 * top, and the windshield that's left of the cabin with the roof off (its foot, and how far up).
 */
function profiles(kind: 'lambo' | 'ferrari'): { body: THREE.Shape; cabin: THREE.Shape; axle: number; screen: [number, number, number, number] } {
  const body = new THREE.Shape();
  const cabin = new THREE.Shape();
  if (kind === 'lambo') {
    // All wedge: a knife-edge nose, a flat hood running straight up into the windshield.
    const axle = 1.42;
    sill(body, -2.22, 2.15, [-axle, axle]);
    body.lineTo(2.32, 0.3);
    body.lineTo(2.3, 0.44);
    body.lineTo(0.95, 0.74);
    body.lineTo(-1.75, 0.86);
    body.lineTo(-2.3, 0.82);
    body.lineTo(-2.32, 0.38);
    body.closePath();
    cabin.moveTo(1.05, 0.66);
    cabin.lineTo(-0.05, 1.1);
    cabin.lineTo(-0.85, 1.1);
    cabin.lineTo(-2.05, 0.8);
    cabin.lineTo(-2.05, 0.66);
    cabin.closePath();
    return { body, cabin, axle, screen: [1.05, 0.66, 0.34, 0.95] };
  }
  // Curves: a rounded nose, a long hood and big rear haunches.
  const axle = 1.36;
  sill(body, -2.2, 2.12, [-axle, axle]);
  body.quadraticCurveTo(2.3, 0.22, 2.28, 0.42);
  body.quadraticCurveTo(1.7, 0.64, 0.55, 0.76);
  body.lineTo(-1.1, 0.84);
  body.quadraticCurveTo(-2.05, 0.96, -2.25, 0.72);
  body.lineTo(-2.26, 0.3);
  body.closePath();
  cabin.moveTo(0.65, 0.68);
  cabin.quadraticCurveTo(0.05, 1.16, -0.55, 1.13);
  cabin.quadraticCurveTo(-1.35, 1.1, -1.85, 0.78);
  cabin.lineTo(-1.85, 0.68);
  cabin.closePath();
  return { body, cabin, axle, screen: [0.68, 0.68, 0.22, 0.98] };
}

/** Extrudes a side profile `width` across, centered, and turns it so the front points to +z. */
function extrude(shape: THREE.Shape, width: number, bevel: number): THREE.BufferGeometry {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 10,
  });
  geo.translate(0, 0, -(width - bevel * 2) / 2);
  geo.rotateY(-Math.PI / 2);
  return geo;
}

/** A car's model, in parts that change while it's driven. */
export interface CarModel {
  root: THREE.Group;
  body: THREE.Group;
  pedals?: THREE.Object3D;
  /** The painted roof and the glass round the cabin: off while anyone's in it, so their heads fit. */
  top: THREE.Object3D;
  /** With the roof off: the windshield, the two seats and the steering wheel. */
  open: THREE.Object3D;
  /** Both axles spin; the front wheels also turn to steer. */
  wheels: THREE.Object3D[];
}

/**
 * A cartoon supercar, nose toward +z, wheels on y = 0. A Lambo is a lime, orange or yellow wedge
 * with a wing; a Ferrari is curvy, round taillights and a yellow badge.
 */
export function supercar(kind: CarKind, color: string): CarModel {
  if (kind === 'motorbike' || kind === 'bicycle') return bike(kind, color);
  const g = new THREE.Group();
  const lights = new THREE.Group();
  const paint = toon(color);
  const glass = toon('#233347');
  const tire = toon('#1f1f26');
  const rim = toon(kind === 'lambo' ? '#e9b949' : '#d9dbe3');
  const lamp = toon('#fff6c9', { emissive: '#b8a960' });
  const tail = toon('#ff2d3f', { emissive: '#a3001a' });
  const dark = toon('#2b2d42');
  const { body, cabin, axle, screen } = profiles(kind);
  g.add(mesh(extrude(body, WIDTH, 0.05), paint));
  const wheel = (x: number, z: number) => {
    const w = new THREE.Group();
    w.position.set(x, WHEEL_Y, z);
    w.add(mesh(new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.28, 18).rotateZ(Math.PI / 2), tire));
    w.add(mesh(new THREE.TorusGeometry(WHEEL_R * 0.65, 0.035, 5, 16).rotateY(Math.PI / 2), rim));
    // Open rims with five spokes, so you can see them turn.
    for (let i = 0; i < 5; i++) {
      const spoke = mesh(new THREE.BoxGeometry(0.31, 0.035, 0.24), rim);
      spoke.rotation.x = i * Math.PI / 5;
      w.add(spoke);
    }
    const spin = packed(w);
    const pivot = new THREE.Group();
    pivot.position.copy(w.position);
    pivot.userData.radius = WHEEL_R;
    pivot.add(spin);
    return pivot;
  };
  const wheels: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    const x = sx * (WIDTH / 2 - 0.16);
    const rear = wheel(x, -axle), front = wheel(x, axle);
    rear.userData.front = false;
    front.userData.front = true;
    wheels.push(rear, front);
  }
  const L = SPECS[kind].length / 2;
  if (kind === 'lambo') {
    for (const sx of [-1, 1]) {
      const head = mesh(new THREE.BoxGeometry(0.5, 0.06, 0.26), lamp, sx * 0.62, 0.46, L - 0.14);
      head.rotation.set(-0.25, sx * 0.25, 0);
      lights.add(head);
      // Air intakes behind the doors.
      g.add(mesh(new THREE.BoxGeometry(0.03, 0.26, 0.7), dark, sx * (WIDTH / 2 + 0.03), 0.56, -1.0));
      g.add(mesh(new THREE.BoxGeometry(0.06, 0.26, 0.06), dark, sx * 0.7, 0.98, -2.0));
    }
    lights.add(mesh(new THREE.BoxGeometry(1.7, 0.08, 0.05), tail, 0, 0.7, -L - 0.03));
    // The rear wing, on two struts.
    g.add(mesh(new THREE.BoxGeometry(1.9, 0.05, 0.36), dark, 0, 1.12, -2.02));
  } else {
    for (const sx of [-1, 1]) {
      const head = mesh(new THREE.BoxGeometry(0.42, 0.08, 0.3), lamp, sx * 0.64, 0.5, L - 0.3);
      head.rotation.set(-0.35, sx * 0.3, 0);
      lights.add(head);
      for (const off of [0.28, 0.62]) lights.add(mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.05, 12).rotateX(Math.PI / 2), tail, sx * off, 0.62, -L + 0.18));
      // The badge on each flank.
      g.add(mesh(new THREE.BoxGeometry(0.02, 0.12, 0.09), toon('#ffd400'), sx * (WIDTH / 2 + 0.03), 0.6, 0.9));
    }
    g.add(mesh(new THREE.BoxGeometry(0.1, 0.12, 0.03), toon('#ffd400'), 0, 0.46, L - 0.04));
    g.add(mesh(new THREE.BoxGeometry(0.9, 0.1, 0.05), dark, 0, 0.3, L - 0.06));
  }

  // Mirrors out by the windshield, a grille under the nose and two exhausts at the tail.
  for (const sx of [-1, 1]) {
    g.add(mesh(new THREE.BoxGeometry(0.23, 0.1, 0.19), paint, sx * 1.02, 0.82, 0.35));
    g.add(mesh(new THREE.BoxGeometry(0.02, 0.07, 0.15), glass, sx * 1.14, 0.82, 0.34));
    g.add(mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.22, 8).rotateX(Math.PI / 2), rim, sx * 0.62, 0.28, -2.25));
  }
  for (let i = -3; i <= 3; i++) g.add(mesh(new THREE.BoxGeometry(0.07, 0.14, 0.03), dark, i * 0.12, 0.36, 2.24));

  // The cabin: glass all round under a painted roof.
  const closed = new THREE.Group();
  closed.add(mesh(extrude(cabin, 1.42, 0.03), glass));
  closed.add(mesh(new THREE.BoxGeometry(1.3, 0.05, kind === 'lambo' ? 0.8 : 0.7), paint, 0, kind === 'lambo' ? 1.11 : 1.13, kind === 'lambo' ? -0.45 : -0.3));

  // Roof off: a windshield up from the hood, bucket seats, and a wheel in front of the driver.
  const open = new THREE.Group();
  const [z0, y0, z1, y1] = screen;
  const pane = mesh(new THREE.BoxGeometry(1.36, 0.04, Math.hypot(z1 - z0, y1 - y0)), glass, 0, (y0 + y1) / 2, (z0 + z1) / 2);
  pane.rotation.x = Math.atan2(y1 - y0, z0 - z1);
  open.add(pane);
  for (const s of Object.values(SEATS)) {
    const back = mesh(new THREE.BoxGeometry(0.5, 0.6, 0.1), dark, s.x, 0.95, s.z - 0.34);
    back.rotation.x = -0.18;
    open.add(back, mesh(new THREE.BoxGeometry(0.5, 0.1, 0.52), dark, s.x, 0.5, s.z));
  }
  const hoop = mesh(new THREE.TorusGeometry(0.16, 0.028, 6, 18), dark, SEATS.driver.x, 0.98, SEATS.driver.z + 0.5);
  hoop.rotation.x = -0.45;
  open.add(hoop);

  const root = new THREE.Group();
  const top = packed(closed);
  const inside = packed(open);
  inside.visible = false;
  const bodyGroup = new THREE.Group();
  lights.traverse((o) => { o.castShadow = false; });
  // A car's springs move its body, not its wheels: the tires stay on the road (only a bike's wheels lean with it).
  bodyGroup.add(packed(g, true), mergeByMaterial(lights), top, inside);
  root.add(bodyGroup, ...wheels);
  return { root, body: bodyGroup, top, open: inside, wheels };
}

/** Plain colors share one mesh, even on the moving wheels; lights keep their emissive materials. */
function packed(parts: THREE.Group, shadow = false): THREE.Group {
  parts.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = false; });
  const out = mergeColored(parts);
  out.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = shadow; });
  return out;
}

/** A bike's frame, bars and saddle, with two wheels that turn separately from it. */
function bike(kind: 'motorbike' | 'bicycle', color: string): CarModel {
  const spec = SPECS[kind];
  const motor = kind === 'motorbike';
  const root = new THREE.Group(), parts = new THREE.Group(), body = new THREE.Group();
  const paint = toon(color), dark = toon('#222633'), metal = toon('#c8ccd6');
  const radius = motor ? 0.34 : 0.33;
  const axle = spec.wheelbase / 2;
  const tube = (a: number[], b: number[], r = 0.035, mat = paint) => {
    const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b);
    const delta = to.clone().sub(from);
    const m = mesh(new THREE.CylinderGeometry(r, r, delta.length(), 8), mat);
    m.position.copy(from.add(to).multiplyScalar(0.5));
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
    parts.add(m);
  };
  const rear = [0, radius, -axle], front = [0, radius, axle];
  const crank = [0, 0.3, -0.08], saddle = [0, 0.78, -0.2], neck = [0, 0.88, axle - 0.12];
  for (const [a, b] of [[rear, crank], [rear, saddle], [crank, saddle], [saddle, neck], [crank, neck], [neck, front]]) tube(a, b);
  tube(neck, [0, 1.07, axle - 0.24], 0.025, metal);
  tube([-0.3, 1.07, axle - 0.24], [0.3, 1.07, axle - 0.24], 0.035, dark);
  parts.add(mesh(new THREE.BoxGeometry(motor ? 0.36 : 0.22, 0.08, motor ? 0.82 : 0.28), dark, 0, 0.78, motor ? -0.32 : -0.2));
  if (motor) {
    parts.add(mesh(new THREE.BoxGeometry(0.42, 0.3, 0.56), paint, 0, 0.67, 0.22));
    parts.add(mesh(new THREE.BoxGeometry(0.38, 0.3, 0.4), metal, 0, 0.36, -0.08));
    parts.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.55, 8).rotateX(Math.PI / 2), metal, -0.25, 0.32, -0.55));
    tube([-0.28, 0.33, -0.1], [0.28, 0.33, -0.1], 0.04, dark);
  } else tube(rear, crank, 0.014, dark); // The chain beside the frame.
  const wheels: THREE.Object3D[] = [];
  for (const z of [-axle, axle]) {
    const bits = new THREE.Group();
    bits.add(mesh(new THREE.TorusGeometry(radius - 0.035, motor ? 0.065 : 0.025, 6, 20).rotateY(Math.PI / 2), dark));
    bits.add(mesh(new THREE.TorusGeometry(radius - 0.06, 0.015, 4, 20).rotateY(Math.PI / 2), metal));
    for (let i = 0; i < 8; i++) {
      const spoke = mesh(new THREE.BoxGeometry(0.025, radius * 1.7, 0.015), metal);
      spoke.rotation.x = i * Math.PI / 8;
      bits.add(spoke);
    }
    const pivot = new THREE.Group();
    pivot.position.set(0, radius, z);
    pivot.userData.front = z > 0;
    pivot.userData.radius = radius;
    pivot.add(packed(bits));
    wheels.push(pivot);
  }
  const lights = new THREE.Group();
  lights.add(mesh(new THREE.BoxGeometry(0.16, 0.12, 0.06), toon('#fff6c9', { emissive: '#b8a960' }), 0, 0.98, axle - 0.12, false));
  lights.add(mesh(new THREE.BoxGeometry(0.14, 0.06, 0.04), toon('#ff2d3f', { emissive: '#a3001a' }), 0, 0.74, -axle, false));
  const pedals = new THREE.Group();
  if (!motor) {
    const bits = new THREE.Group();
    bits.add(mesh(new THREE.BoxGeometry(0.36, 0.035, 0.035), metal));
    for (const sx of [-1, 1]) bits.add(mesh(new THREE.BoxGeometry(0.11, 0.035, 0.1), dark, sx * 0.2, sx * 0.14));
    pedals.position.set(0, 0.3, -0.08);
    pedals.add(packed(bits));
  }
  // Wheels and cranks are in the body group too, so the whole bike leans as one about the ground line.
  body.add(packed(parts, true), mergeByMaterial(lights), ...wheels, pedals);
  root.add(body);
  return { root, body, top: new THREE.Group(), open: new THREE.Group(), wheels, pedals };
}

/** One of the floor's cars, as it's drawn here. */
export interface CarView extends CarModel {
  index: number;
  def: CarDef;
  /** Where it's drawn now: the page's own driving, or the office's word smoothed out. */
  pose: CarPose;
  /** Somebody's in it: the roof's off. */
  occupied: boolean;
  lastSpeed: number;
  spin: number;
  pedalPhase: number;
  /** What you bump into and stand on: along its body (turned, it takes a few boxes), and its roof. */
  colliders: Collider[];
  interactable: Interactable;
}

/** Whether the whole car is in under the building (the office's floor over it), rather than out on the lot or the street. */
function underneath(p: CarPose, kind: CarKind): boolean {
  const spec = SPECS[kind];
  return [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ].every(([sx, sz]) => {
    const c = carPoint(p, (sx * spec.width) / 2, (sz * spec.length) / 2);
    return c.x > FLOOR.minX - WALL_T && c.x < FLOOR.maxX + WALL_T && c.z > FLOOR.minZ - WALL_T && c.z < FLOOR.maxZ + WALL_T;
  });
}

/** Boxes along the car's body, for colliders: a car turned off square takes more than one. */
const SLICES = 3;

/**
 * The floor's cars (see CARS in shared/garage.ts), down on the street under the floor you're on: in
 * their spots, where somebody's driving them or where they were left.
 */
export class Fleet {
  readonly group = new THREE.Group();
  readonly cars: CarView[];
  /** How far below the floor you're on the street is (see streetBelow). */
  private street = STREET_Y;
  private vehicleBoxes = new Map<Collider, number>();

  constructor(
    /** The office's: the cars' go in with them. */
    private all: Collider[],
    interactables: Interactable[],
    /** Which cars: the garage's, or the race circuit's (shared/circuit.ts). */
    readonly defs: readonly CarDef[] = CARS,
    /** What stands in a car's way besides `all`, near (x, z): the city's buildings and lamp posts. */
    private near: (x: number, z: number, reach: number) => Box[] = citySolids,
  ) {
    this.cars = defs.map((def, index) => {
      const model = supercar(def.kind, def.color);
      const interactable: Interactable = { kind: 'car', x: def.x, z: def.z, y: this.street, radius: 3.2, car: index };
      model.root.userData.interact = interactable;
      this.group.add(model.root);
      interactables.push(interactable);
      const colliders: Collider[] = [];
      for (let i = 0; i <= SLICES; i++) colliders.push({ minX: 0, maxX: 0, minZ: 0, maxZ: 0, top: 0, bottom: 0 });
      all.push(...colliders);
      for (const c of colliders) this.vehicleBoxes.set(c, index);
      const view: CarView = { ...model, index, def, pose: { x: def.x, z: def.z, rotY: def.rotY, speed: 0, steer: 0 }, occupied: false, lastSpeed: 0, spin: 0, pedalPhase: 0, colliders, interactable };
      this.show(view);
      return view;
    });
  }

  /** The floor you're on is `street` above the street: the cars and everything about them are down there. */
  setStreet(street: number) {
    this.street = street;
    for (const v of this.cars) this.show(v);
  }

  /**
   * Each frame: every car where the office says it is (smoothed out, and carried on a little the
   * way it's going, since its driver said so), but for the one you're in (`mine`) if you're driving
   * it, which is where your own driving put it. The office doesn't tell you your own moves, so that
   * goes back into `cars` for when you get out.
   */
  update(dt: number, cars: CarState[], at: number[], now: number, mine: { car: number; driving: boolean } | null, eye: THREE.Vector3) {
    const k = 1 - Math.exp(-dt * 12);
    // From up in the office, the cars in under it can't be seen through its floor: not drawn at all.
    const indoors = eye.y > -SLAB && eye.x > FLOOR.minX && eye.x < FLOOR.maxX && eye.z > FLOOR.minZ && eye.z < FLOOR.maxZ;
    for (const v of this.cars) v.root.visible = !indoors || !underneath(v.pose, v.def.kind);
    for (const v of this.cars) {
      this.animate(v, dt);
      const c = cars[v.index];
      if (!c) continue;
      const occupied = !!(c.driver || c.passenger) || v.index === mine?.car;
      if (occupied !== v.occupied) {
        v.occupied = occupied;
        v.top.visible = !occupied;
        v.open.visible = occupied;
        this.show(v);
      }
      if (v.index === mine?.car && mine.driving) {
        Object.assign(c, v.pose);
        at[v.index] = now;
        continue;
      }
      const p = v.pose;
      // Where it'd be by now, going on as it was: at most a quarter of a second on.
      const ahead = Math.min(0.25, Math.max(0, (now - (at[v.index] ?? now)) / 1000));
      const x = c.x + (Math.sin(c.rotY) * c.speed + Math.cos(c.rotY) * (c.slip ?? 0)) * ahead;
      const z = c.z + (Math.cos(c.rotY) * c.speed - Math.sin(c.rotY) * (c.slip ?? 0)) * ahead;
      const far = Math.hypot(x - p.x, z - p.z) > 8;
      const turn = Math.atan2(Math.sin(c.rotY - p.rotY), Math.cos(c.rotY - p.rotY));
      p.x = far ? x : p.x + (x - p.x) * k;
      p.z = far ? z : p.z + (z - p.z) * k;
      p.rotY = far ? c.rotY : p.rotY + turn * k;
      p.speed = c.speed;
      p.slip = c.slip ?? 0;
      p.steer += (c.steer - p.steer) * k;
      this.show(v);
    }
  }

  /** Every car straight to where the office says it is, not smoothed: a floor's cars as you arrive on it. */
  snap(cars: CarState[]) {
    for (const v of this.cars) {
      const c = cars[v.index];
      if (!c) continue;
      Object.assign(v.pose, { x: c.x, z: c.z, rotY: c.rotY, speed: c.speed, steer: c.steer, slip: c.slip ?? 0, yaw: 0 });
      this.show(v);
    }
  }

  /** Puts car `i` at `pose` (your own driving). */
  place(i: number, pose: CarPose) {
    const v = this.cars[i];
    if (!v) return;
    Object.assign(v.pose, pose, { slip: pose.slip ?? 0, yaw: pose.yaw ?? 0 });
    this.show(v);
  }

  /** Where someone sitting in `seat` of car `i` is: their feet (on the street; sitting lifts them) and the way they face. */
  seatAt(i: number, seat: CarSeat): { x: number; y: number; z: number; rotY: number } | undefined {
    const v = this.cars[i];
    if (!v || (seat === 'passenger' && SPECS[v.def.kind].seats < 2)) return undefined;
    const s = seatOffset(v.def.kind, seat);
    const at = carPoint(v.pose, s.x, s.z);
    return { x: at.x, y: this.street, z: at.z, rotY: v.pose.rotY };
  }

  /**
   * What a car bumps into on the street, besides the pavement's edge: whatever stands on it (the
   * garage's columns and walls, street lamps, trees, the elevator, the other cars), but not car
   * `except`'s own boxes.
   */
  solids(except: number): Box[] {
    const own = this.cars[except]?.colliders;
    const out: Box[] = [];
    for (const c of this.all) {
      // Not the ground itself (the lawn, the lots), nor anything overhead.
      if (own?.includes(c) || (c.bottom ?? 0) > this.street + 1 || c.top < this.street + 0.3) continue;
      const index = this.vehicleBoxes.get(c);
      const vehicle = index === undefined ? undefined : this.cars[index];
      const p = vehicle?.pose;
      out.push(p && vehicle ? { ...c, mass: SPECS[vehicle.def.kind].mass,
        vx: Math.sin(p.rotY) * p.speed + Math.cos(p.rotY) * (p.slip ?? 0),
        vz: Math.cos(p.rotY) * p.speed - Math.sin(p.rotY) * (p.slip ?? 0) } : c);
    }
    const p = this.cars[except]?.pose;
    if (p) out.push(...this.near(p.x, p.z, 10 + Math.hypot(p.speed, p.slip ?? 0) * 0.1));
    return out;
  }

  /** Hands on the bars, both riders leaning with the bike; the driver's legs pedal on a bicycle. */
  poseRider(person: { ride(hips: number, lean: number, phase: number, pedaling: boolean): void }, i: number, seat: CarSeat) {
    const v = this.cars[i];
    if (!v || SPECS[v.def.kind].width >= 1) return;
    // The bike's own (smoothed) lean, so the rider never gets ahead of the frame.
    person.ride(seatHips(v.def.kind), v.body.rotation.z, v.pedalPhase, v.def.kind === 'bicycle' && seat === 'driver');
  }

  /** Wheels travel with the car, while its springs let the body pitch and roll a little. */
  private animate(v: CarView, dt: number) {
    const p = v.pose, spec = SPECS[v.def.kind];
    const k = 1 - Math.exp(-dt * 10);
    const acceleration = dt > 0 ? THREE.MathUtils.clamp((p.speed - v.lastSpeed) / dt, -20, 8) : 0;
    v.lastSpeed = p.speed;
    v.spin += p.speed * dt;
    v.pedalPhase += p.speed * dt / 1.8;
    for (const w of v.wheels) {
      w.rotation.y = w.userData.front ? p.steer : 0;
      w.children[0].rotation.x = v.spin / w.userData.radius;
    }
    const bike = spec.width < 1;
    const lateral = p.speed * p.speed * Math.tan(p.steer) / spec.wheelbase;
    const roll = bike ? -leanAngle(p, v.def.kind) : THREE.MathUtils.clamp(lateral * 0.006, -0.08, 0.08);
    v.body.rotation.z += (roll - v.body.rotation.z) * k;
    v.body.rotation.x += ((bike ? 0 : -acceleration * 0.003) - v.body.rotation.x) * k;
    v.body.position.y = bike ? 0 : Math.sin((p.x + p.z) * 3) * 0.015 * Math.min(1, Math.abs(p.speed) / 4);
    if (v.pedals) v.pedals.rotation.x = v.pedalPhase;
  }

  /**
   * Out of the way of a car that's come at you where you stand (x, z) on the street: shoved out
   * of its side, or its nose or tail if that's nearer, and off to the side from there, so it
   * doesn't push you along in front of it. Returns how fast it was going, or 0.
   */
  shove(pos: { x: number; y: number; z: number }, except: number | null): number {
    if (Math.abs(pos.y - this.street) > 0.4) return 0;
    const r = 0.32;
    for (const v of this.cars) {
      if (v.index === except) continue;
      const p = v.pose;
      const spec = SPECS[v.def.kind];
      const s = Math.sin(p.rotY);
      const c = Math.cos(p.rotY);
      const dx = pos.x - p.x;
      const dz = pos.z - p.z;
      // Where you are in the car's own frame: across it (+ left), and along it (+ ahead).
      const lx = dx * c - dz * s;
      const lz = dx * s + dz * c;
      const hx = spec.width / 2 + r;
      const hz = spec.length / 2 + r;
      if (Math.abs(lx) >= hx || Math.abs(lz) >= hz) continue;
      const side = hx - Math.abs(lx);
      const end = hz - Math.abs(lz);
      const aside = Math.sign(lx || 1);
      const out = side < end ? { x: aside * (hx + 0.01), z: lz } : { x: lx + aside * Math.min(side, 0.08), z: Math.sign(lz || 1) * (hz + 0.01) };
      const at = carPoint(p, out.x, out.z);
      pos.x = at.x;
      pos.z = at.z;
      return Math.abs(p.speed);
    }
    return 0;
  }

  /** Draws car `v` where its pose says, and moves its boxes and its interactable along with it. */
  private show(v: CarView) {
    const p = v.pose;
    const spec = SPECS[v.def.kind];
    v.root.position.set(p.x, this.street, p.z);
    v.root.rotation.y = p.rotY;
    for (const w of v.wheels) w.rotation.y = w.userData.front ? p.steer : 0;
    const s = Math.abs(Math.sin(p.rotY));
    const c = Math.abs(Math.cos(p.rotY));
    const hx = spec.width / 2 - 0.08;
    const len = (spec.length - 0.16) / SLICES;
    // Along the body a slice at a time, each slice's box round it as turned.
    for (let i = 0; i < SLICES; i++) {
      const mid = carPoint(p, 0, -spec.length / 2 + 0.08 + len * (i + 0.5));
      const ex = c * hx + (s * len) / 2;
      const ez = s * hx + (c * len) / 2;
      Object.assign(v.colliders[i], { minX: mid.x - ex, maxX: mid.x + ex, minZ: mid.z - ez, maxZ: mid.z + ez, bottom: this.street, top: this.street + spec.body });
    }
    // The roof, over the cabin; with it off, only the body's there to stand on.
    const roof = carPoint(p, 0, -0.6);
    const rx = c * Math.min(0.6, spec.width / 2 - 0.04) + s * Math.min(0.7, spec.length / 3);
    const rz = s * Math.min(0.6, spec.width / 2 - 0.04) + c * Math.min(0.7, spec.length / 3);
    Object.assign(v.colliders[SLICES], { minX: roof.x - rx, maxX: roof.x + rx, minZ: roof.z - rz, maxZ: roof.z + rz, bottom: this.street, top: this.street + (v.occupied ? spec.body : spec.roof) });
    Object.assign(v.interactable, { x: p.x, z: p.z, y: this.street });
  }
}
