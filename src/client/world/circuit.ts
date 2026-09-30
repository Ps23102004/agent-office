import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CENTER, CIRCUIT_CARS, CIRCUIT_GATE, CITY_GATE, GARAGES, PADDOCK, PIT_WALL, TRACK, gridPose, nearestProgress, pointAt, surfaceAt, track, type Gate } from '../../shared/circuit';
import { RACE_PLAZA, rng } from '../../shared/city';
import { RACE, type RaceState } from '../../shared/race';
import { decorTicker } from '../quality';
import { Fleet } from './cars';
import { loadModel, type ModelName } from './models';
import type { Collider, Interactable } from './office';
import { mergeColored, mesh, textPlane, toon, toonVertex } from './toon';

// The race circuit (shared/circuit.ts), drawn: the track with its kerbs, gravel and white lines, the
// grid and the chequered start line under the gantry and its five red lights, tyre walls and barriers
// round the grass, sponsor boards (textures made for it: public/textures/race-sponsors-*.jpg),
// grandstands full of a cheering crowd, the pit garages along the paddock, trees, and the circuit's
// own cars waiting in the paddock. The grandstands, garages, trees and the like are Kenney's Racing
// Kit (CC0, see CREDITS.md), painted in the office's toon colors and merged, so the whole place is a
// couple of dozen draw calls, its cars aside. Also the gate on the plaza in the city that gets you here.

/** A Kenney Racing Kit tile, in metres: its buildings are a tile or so across. */
const TILE = 8;
/** Where the asphalt's edge is, and where the grass stops at the barriers. */
const EDGE = TRACK.width / 2;
const BAND = TRACK.width / 2 + TRACK.runoff;

export interface Circuit {
  group: THREE.Group;
  colliders: Collider[];
  interactables: Interactable[];
  /** What you can point at to use (the cars). */
  pickables: THREE.Object3D[];
  /** The circuit's cars (CIRCUIT_CARS), driven like the garage's. */
  fleet: Fleet;
  /** Each frame while you're there: the start lights, the crowd, the gate's shimmer. `now` is the office's clock (ms). */
  update(dt: number, t: number, race: RaceState, now: number, cars: readonly { x: number; z: number; speed: number }[]): void;
}

/** Vertex-colored flat pieces of ground, all in one mesh: triangles facing up. */
class Flat {
  pos: number[] = [];
  col: number[] = [];
  private c = new THREE.Color();

  tri(a: THREE.Vector3Like, b: THREE.Vector3Like, c: THREE.Vector3Like, color: string) {
    // Wound anticlockwise seen from above, so it faces up.
    const up = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z) > 0;
    const [p, q] = up ? [b, c] : [c, b];
    this.pos.push(a.x, a.y, a.z, p.x, p.y, p.z, q.x, q.y, q.z);
    this.c.set(color);
    for (let i = 0; i < 3; i++) this.col.push(this.c.r, this.c.g, this.c.b);
  }

  quad(a: THREE.Vector3Like, b: THREE.Vector3Like, c: THREE.Vector3Like, d: THREE.Vector3Like, color: string) {
    this.tri(a, b, c, color);
    this.tri(a, c, d, color);
  }

  /** A band along the track from `s0` to `s1` (m round it), `from` to `to` metres off the centre line (+ is the left). */
  band(s0: number, s1: number, from: number, to: number, y: number, color: string) {
    const a = pointAt(s0), b = pointAt(s1);
    const at = (p: { x: number; z: number; tx: number; tz: number }, d: number) => ({ x: p.x + p.tz * d, y, z: p.z - p.tx * d });
    this.quad(at(a, from), at(b, from), at(b, to), at(a, to), color);
  }

  mesh(): THREE.Mesh {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    const n = new Float32Array(this.pos.length);
    for (let i = 1; i < n.length; i += 3) n[i] = 1;
    geo.setAttribute('normal', new THREE.BufferAttribute(n, 3));
    const m = new THREE.Mesh(geo, toonVertex());
    m.receiveShadow = true;
    return m;
  }
}

/** How sharply the track turns `s` metres round (1 / radius), and which way: + to the left. */
function bend(s: number): number {
  const a = pointAt(s - 6), b = pointAt(s + 6);
  return (a.tx * b.tz - a.tz * b.tx) / -12;
}

/** A box `w` across, `h` high and `l` long, standing at (x, z) and turned `rotY`, into `into`. */
function box(into: THREE.Object3D, w: number, h: number, l: number, color: string, x: number, y: number, z: number, rotY = 0, cast = true) {
  const m = mesh(new THREE.BoxGeometry(w, h, l), toon(color), x, y + h / 2, z, cast);
  m.rotation.y = rotY;
  into.add(m);
  return m;
}

// ---- The gates ---------------------------------------------------------------------------------

/**
 * A gate `g`: two red-and-white pillars, a chequered beam over them with flags on top, a sign, and a
 * shimmer across the opening. Its parts go in `solid` (to be merged); the sign and the shimmer (which
 * moves) are returned to add as they are. Colliders stand from `y0`.
 */
function gate(g: Gate, sign: string, solid: THREE.Group, colliders: Collider[], y0: number): { sign: THREE.Object3D; shimmer: THREE.Mesh } {
  const s = Math.sin(g.rotY), c = Math.cos(g.rotY);
  // Across the opening is (c, -s); through it is (s, c).
  const at = (across: number, through = 0) => ({ x: g.x + across * c + through * s, z: g.z - across * s + through * c });
  const H = 7;
  for (const side of [-1, 1]) {
    const p = at(side * (g.width / 2 + 0.6));
    for (let k = 0; k < 5; k++) box(solid, 1.2, H / 5, 1.2, k % 2 ? '#f8f9fa' : '#e63946', p.x, (k * H) / 5, p.z, g.rotY);
    colliders.push({ minX: p.x - 0.7, maxX: p.x + 0.7, minZ: p.z - 0.7, maxZ: p.z + 0.7, bottom: y0, top: y0 + H + 1.4 });
    // A chequered flag on a pole up top.
    box(solid, 0.08, 2.6, 0.08, '#adb5bd', p.x, H + 1.4, p.z);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
      const q = at(side * (g.width / 2 + 0.85 + i * 0.4));
      box(solid, 0.4, 0.4, 0.05, (i + j) % 2 ? '#212529' : '#f8f9fa', q.x, H + 2.8 + j * 0.4, q.z, g.rotY, false);
    }
  }
  // The beam: chequered on both faces.
  const span = g.width + 2.4;
  const n = Math.round(span / 0.6);
  box(solid, span, 1.4, 0.8, '#212529', g.x, H, g.z, g.rotY);
  for (let i = 0; i < n; i++) for (let j = 0; j < 2; j++) for (const face of [-1, 1]) {
    const p = at(-span / 2 + (i + 0.5) * (span / n), face * 0.42);
    box(solid, span / n, 0.7, 0.04, (i + j) % 2 ? '#212529' : '#f8f9fa', p.x, H + j * 0.7, p.z, g.rotY, false);
  }
  const label = textPlane(sign, { size: 64, bg: '#ffd166', color: '#2b2d42' });
  label.scale.setScalar(1.6);
  const face = at(0, -0.9);
  label.position.set(face.x, y0 + H - 1.2, face.z);
  // Facing whoever's coming to go through it.
  label.rotation.y = g.rotY + Math.PI;
  const shimmer = new THREE.Mesh(
    new THREE.PlaneGeometry(g.width, H - 0.2),
    new THREE.MeshBasicMaterial({ color: '#9bf6ff', transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }),
  );
  shimmer.position.set(g.x, y0 + (H - 0.2) / 2, g.z);
  shimmer.rotation.y = g.rotY;
  return { sign: label, shimmer };
}

/** The shimmer across a gate's opening, gently pulsing. */
function pulse(shimmer: THREE.Mesh, t: number) {
  (shimmer.material as THREE.MeshBasicMaterial).opacity = 0.14 + 0.08 * Math.sin(t * 2.4);
}

/**
 * The gate to the circuit, on its plaza in the city (RACE_PLAZA), with the plaza's paving round it: for
 * the office's street to hold, the ground at y = 0 (put the group at the street's height, `street`).
 * Its colliders stand from `street`.
 */
export function buildCityGate(street: number): { group: THREE.Group; colliders: Collider[]; update(t: number): void } {
  const group = new THREE.Group();
  const colliders: Collider[] = [];
  const solid = new THREE.Group();
  const p = RACE_PLAZA;
  // Paving, a chequered strip up to the gate and a racing-red runway through it.
  const ground = new Flat();
  const corner = (x: number, z: number, y = 0.03) => ({ x, y, z });
  ground.quad(corner(p.minX, p.minZ), corner(p.maxX, p.minZ), corner(p.maxX, p.maxZ), corner(p.minX, p.maxZ), '#c9ccd3');
  const g = CITY_GATE;
  ground.quad(corner(g.x - 5, p.minZ + 2, 0.04), corner(g.x + 5, p.minZ + 2, 0.04), corner(g.x + 5, p.maxZ, 0.04), corner(g.x - 5, p.maxZ, 0.04), '#d6455d');
  for (let i = 0; i < 10; i++) for (let j = 0; j < 2; j++) {
    const x = g.x - 5 + i, z = g.z + 3 + j;
    ground.quad(corner(x, z, 0.05), corner(x + 1, z, 0.05), corner(x + 1, z + 1, 0.05), corner(x, z + 1, 0.05), (i + j) % 2 ? '#212529' : '#f8f9fa');
  }
  group.add(ground.mesh());
  const { sign, shimmer } = gate(g, '🏁 Race circuit', solid, colliders, street);
  // The gate's colliders were made from the street (`street`), its meshes from 0: they go up with the group.
  sign.position.y -= street;
  shimmer.position.y -= street;
  // A few racing tyres stacked either side, and bollards along the pavement's edge.
  for (const side of [-1, 1]) for (let k = 0; k < 3; k++) tyreStack(solid, g.x + side * (g.width / 2 + 3 + k * 1.2), g.z + 2, ['#e63946', '#f8f9fa', '#212529'][k]);
  group.add(mergeColored(solid), sign, shimmer);
  return { group, colliders, update: (t) => pulse(shimmer, t) };
}

/** Three tyres on top of each other (for the city gate's decoration: the circuit's are instanced). */
function tyreStack(into: THREE.Object3D, x: number, z: number, color: string) {
  for (let k = 0; k < 3; k++) into.add(mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.28, 14), toon(k === 1 ? color : '#2b2d42'), x, 0.15 + k * 0.3, z));
}

// ---- The circuit ---------------------------------------------------------------------------------

/** Kenney's models this uses, by what they're for. */
const PROPS = {
  stand: 'race/grandStand',
  covered: 'race/grandStandCovered',
  garage: 'race/pitsGarage',
  office: 'race/pitsOffice',
  tree: 'race/treeLarge',
  bush: 'race/treeSmall',
  towerRed: 'race/bannerTowerRed',
  towerGreen: 'race/bannerTowerGreen',
  lamp: 'race/lightPostLarge',
  tent: 'race/tentLong',
} as const satisfies Record<string, ModelName>;
type Prop = keyof typeof PROPS;

/** Somewhere a prop goes: which, where, turned how (its front, +z in the model, faces along rotY), how big. */
interface Placed {
  prop: Prop;
  x: number;
  z: number;
  rotY: number;
  scale: number;
}

/**
 * Where the grandstands go, and the rest of the props: along the main straight across from the pits,
 * round the outside of the hairpin, the fast first corner and the last one; garages along the back of
 * the paddock; trees all round outside the barriers. Worked out now, so the colliders are there before
 * the models load.
 */
function layout(): { stands: Placed[]; props: Placed[] } {
  const stands: Placed[] = [];
  const props: Placed[] = [];
  const clear = (x: number, z: number, r: number) =>
    [[0, 0], [r, r], [-r, r], [r, -r], [-r, -r]].every(([dx, dz]) => surfaceAt(x + dx, z + dz) === 'out' && Math.abs(nearestProgress(x + dx, z + dz).d) > BAND + 1.5);
  const row = (from: number, to: number, side: 1 | -1 | 0, step: number, covered = (_s: number) => false) => {
    for (let s = from; s <= to; s += step) {
      const p = pointAt(s);
      // The outside of the corner, unless told which side.
      const out = side || (bend(s) > 0 ? -1 : 1);
      const off = BAND + TILE / 2 + 2.5;
      const x = p.x + p.tz * off * out, z = p.z - p.tx * off * out;
      if (!clear(x, z, TILE / 2)) continue;
      // Facing the track: toward the centre line.
      stands.push({ prop: covered(s) ? 'covered' : 'stand', x, z, rotY: Math.atan2(-p.tz * out, p.tx * out), scale: TILE });
    }
  };
  const L = track().length;
  // The main straight's, across from the pit wall (on the right, heading for the line); covered by the line.
  row(L - 100, L + 150, -1, TILE, (s) => Math.abs(s - L) < 50);
  row(250, 310, 0, 7.5);
  row(470, 545, 0, 7);
  row(1225, 1290, 0, 7);
  // The pit garages along the back of the paddock, facing it, with an office every so often.
  const n = Math.floor((GARAGES.maxX - GARAGES.minX) / TILE);
  for (let i = 0; i < n; i++) {
    props.push({ prop: i % 6 === 3 ? 'office' : 'garage', x: GARAGES.minX + (i + 0.5) * TILE, z: (GARAGES.minZ + GARAGES.maxZ) / 2, rotY: 0, scale: TILE });
  }
  // Tents for the teams at the paddock's east end, and floodlights along it.
  for (let i = 0; i < 3; i++) props.push({ prop: 'tent', x: PADDOCK.maxX - 12, z: PADDOCK.minZ + 8 + i * 9, rotY: -Math.PI / 2, scale: 5 });
  for (let x = PADDOCK.minX + 20; x < PADDOCK.maxX; x += 45) props.push({ prop: 'lamp', x, z: PADDOCK.minZ + 1.5, rotY: 0, scale: 11 });
  // Banner towers on the outside of the corners.
  for (const s of [215, 360, 600, 690, 900, 1100]) {
    const p = pointAt(s);
    const out = bend(s) > 0 ? -1 : 1;
    const off = BAND + 3;
    const x = p.x + p.tz * off * out, z = p.z - p.tx * off * out;
    if (clear(x, z, 1)) props.push({ prop: s % 2 ? 'towerRed' : 'towerGreen', x, z, rotY: Math.atan2(-p.tz * out, p.tx * out), scale: 6 });
  }
  // Trees round about, outside everything, the same for everyone.
  const r = rng(20261001);
  const spot = (x: number, z: number) => clear(x, z, 3) && !stands.some((s) => Math.hypot(s.x - x, s.z - z) < TILE + 3);
  for (let k = 0; k < 900 && props.length < 320; k++) {
    const x = CENTER.x - 330 + r() * 680;
    const z = CENTER.z - 130 + r() * 420;
    if (z < GARAGES.minZ + 2 && z > GARAGES.minZ - 30 && x > GARAGES.minX - 20 && x < GARAGES.maxX + 20) continue;
    if (!spot(x, z)) continue;
    props.push({ prop: r() < 0.6 ? 'tree' : 'bush', x, z, rotY: r() * Math.PI * 2, scale: 5 + r() * 2.5 });
  }
  return { stands, props };
}

/** A copy of one of Kenney's models, the middle of its footprint at the origin and its base on the ground. */
function centred(scene: THREE.Object3D): THREE.Group {
  const box = new THREE.Box3().setFromObject(scene);
  const c = box.getCenter(new THREE.Vector3());
  scene.position.set(-c.x, -box.min.y, -c.z);
  const g = new THREE.Group();
  g.add(scene);
  return g;
}

/**
 * Where people sit in a grandstand model (centred, at its own size): straight down onto its steps,
 * on a grid, one to a step. From just under its roof, if it has one.
 */
function seatsOf(model: THREE.Group, from: number): THREE.Vector3[] {
  model.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const box = new THREE.Box3().setFromObject(model);
  const seats: THREE.Vector3[] = [];
  const w = box.max.x - box.min.x, d = box.max.z - box.min.z;
  for (let i = 0; i < 9; i++) {
    const x = box.min.x + w * (0.1 + (0.8 * i) / 8);
    const levels: number[] = [];
    for (let j = 0; j < 40; j++) {
      const z = box.min.z + d * (0.05 + (0.9 * j) / 39);
      ray.set(new THREE.Vector3(x, from, z), down);
      const hit = ray.intersectObject(model, true)[0];
      // Not the walkway in front, nor the top of the wall at the back.
      if (!hit || !hit.face || hit.face.normal.y < 0.9 || hit.point.y < box.max.y * 0.08 || hit.point.y > box.max.y * 0.72) continue;
      // One to a step.
      if (levels.some((y) => Math.abs(y - hit.point.y) < box.max.y * 0.04)) continue;
      levels.push(hit.point.y);
      seats.push(new THREE.Vector3(x, hit.point.y, z));
    }
  }
  return seats;
}

/** The crowd: a body and a head for each, the colors of a crowd on a sunny day. */
function crowdOf(spots: THREE.Matrix4[]): { bodies: THREE.InstancedMesh; heads: THREE.InstancedMesh; base: THREE.Matrix4[] } {
  const n = spots.length;
  const bodies = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.2, 0.26, 0.62, 7).translate(0, 0.31, 0), toon('#ffffff'), n);
  const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.17, 8, 6).translate(0, 0.8, 0), toon('#ffffff'), n);
  const r = rng(77);
  const shirts = ['#e63946', '#ffd166', '#06d6a0', '#118ab2', '#f78c6b', '#8338ec', '#ffffff', '#ff006e', '#3a86ff', '#fb5607'];
  const skins = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac', '#f5cfa0'];
  const c = new THREE.Color();
  spots.forEach((m, i) => {
    bodies.setMatrixAt(i, m);
    heads.setMatrixAt(i, m);
    bodies.setColorAt(i, c.set(shirts[Math.floor(r() * shirts.length)]));
    heads.setColorAt(i, c.set(skins[Math.floor(r() * skins.length)]));
  });
  for (const m of [bodies, heads]) {
    m.castShadow = false;
    m.receiveShadow = true;
    // They bounce about: never culled by where they were at first.
    m.frustumCulled = false;
  }
  return { bodies, heads, base: spots };
}

/** The circuit, built the first time anyone goes there. */
export function buildCircuit(): Circuit {
  const group = new THREE.Group();
  const colliders: Collider[] = [];
  const interactables: Interactable[] = [];
  const { points, length: L } = track();
  // The ground under it all, to stand on; and a fence far out, so nobody wanders off into the haze.
  const far = { minX: CENTER.x - 420, maxX: CENTER.x + 440, minZ: CENTER.z - 200, maxZ: CENTER.z + 360 };
  colliders.push({ ...far, bottom: -1, top: 0 });
  colliders.push(
    { minX: far.minX, maxX: far.minX + 1, minZ: far.minZ, maxZ: far.maxZ, top: 6, fence: true },
    { minX: far.maxX - 1, maxX: far.maxX, minZ: far.minZ, maxZ: far.maxZ, top: 6, fence: true },
    { minX: far.minX, maxX: far.maxX, minZ: far.minZ, maxZ: far.minZ + 1, top: 6, fence: true },
    { minX: far.minX, maxX: far.maxX, minZ: far.maxZ - 1, maxZ: far.maxZ, top: 6, fence: true },
  );

  // ---- The ground: grass, the paddock, the track, kerbs, gravel, lines, the grid and the start line.
  const flat = new Flat();
  const g = (x: number, z: number, y: number) => ({ x, y, z });
  flat.quad(g(far.minX - 400, far.minZ - 400, -0.05), g(far.maxX + 400, far.minZ - 400, -0.05), g(far.maxX + 400, far.maxZ + 400, -0.05), g(far.minX - 400, far.maxZ + 400, -0.05), '#8ccf6a');
  // Mown stripes across the infield and round about.
  for (let x = far.minX; x < far.maxX; x += 24) flat.quad(g(x, far.minZ, -0.04), g(x + 12, far.minZ, -0.04), g(x + 12, far.maxZ, -0.04), g(x, far.maxZ, -0.04), '#9ad677');
  const P = PADDOCK;
  flat.quad(g(P.minX, P.minZ, 0), g(P.maxX, P.minZ, 0), g(P.maxX, P.maxZ, 0), g(P.minX, P.maxZ, 0), '#a4a8b3');
  // Parking bays in front of the garages, where the circuit's cars wait.
  for (const def of CIRCUIT_CARS) {
    for (const dx of [-3, 3]) flat.quad(g(def.x + dx - 0.12, def.z - 3, 0.02), g(def.x + dx + 0.12, def.z - 3, 0.02), g(def.x + dx + 0.12, def.z + 3, 0.02), g(def.x + dx - 0.12, def.z + 3, 0.02), '#f8f9fa');
  }
  const step = L / points.length;
  for (let i = 0; i < points.length; i++) {
    const s0 = i * step, s1 = s0 + step;
    const k = bend(s0 + step / 2);
    flat.band(s0, s1, -EDGE, EDGE, 0, '#5d616d');
    // White lines inside the edges.
    flat.band(s0, s1, EDGE - 0.6, EDGE - 0.3, 0.02, '#f8f9fa');
    flat.band(s0, s1, -EDGE + 0.3, -EDGE + 0.6, 0.02, '#f8f9fa');
    // Kerbs where it bends, red and white, both sides; gravel on the outside of the tight ones.
    if (Math.abs(k) > 1 / 160) {
      const color = Math.floor(s0 / 3) % 2 ? '#e63946' : '#f8f9fa';
      flat.band(s0, s1, EDGE, EDGE + TRACK.curb, 0.005, color);
      flat.band(s0, s1, -EDGE - TRACK.curb, -EDGE, 0.005, color);
    }
    if (Math.abs(k) > 1 / 70) {
      const out = k > 0 ? -1 : 1;
      const a = EDGE + TRACK.curb, b = a + 10;
      flat.band(s0, s1, out > 0 ? a : -b, out > 0 ? b : -a, -0.02, '#ecd9a0');
    }
  }
  // The chequered start line, and the grid's slots behind it.
  for (let i = 0; i < 12; i++) {
    for (let j = 0; j < 2; j++) flat.band(-1 + j, j, -EDGE + i, -EDGE + i + 1, 0.025, (i + j) % 2 ? '#212529' : '#f8f9fa');
  }
  for (let slot = 0; slot < RACE.slots; slot++) {
    const p = gridPose(slot);
    const np = nearestProgress(p.x, p.z);
    flat.band(np.s + 2.6, np.s + 2.9, np.d - 1.3, np.d + 1.3, 0.025, '#f8f9fa');
    flat.band(np.s - 2.4, np.s + 2.9, np.d + (np.d > 0 ? 1.3 : -1.6), np.d + (np.d > 0 ? 1.6 : -1.3), 0.025, '#f8f9fa');
  }
  group.add(flat.mesh());

  // ---- What stands: barriers, the pit wall, the gantry, the gate home. Merged at the end.
  const solid = new THREE.Group();
  const tyres: { x: number; z: number; color: string }[] = [];
  const inPaddock = (x: number, z: number) => x > P.minX - 2 && x < P.maxX + 2 && z > P.minZ - 2 && z < P.maxZ + 3;
  for (let i = 0; i < points.length; i += 2) {
    const s = i * step;
    const k = bend(s + step);
    for (const side of [-1, 1]) {
      const a = pointAt(s), b = pointAt(s + step * 2);
      const ax = a.x + a.tz * BAND * side, az = a.z - a.tx * BAND * side;
      const bx = b.x + b.tz * BAND * side, bz = b.z - b.tx * BAND * side;
      if (inPaddock(ax, az) || inPaddock(bx, bz)) continue;
      const len = Math.hypot(bx - ax, bz - az);
      box(solid, 0.35, 0.9, len + 0.05, (i / 2) % 2 ? '#f8f9fa' : '#1d3557', (ax + bx) / 2, 0, (az + bz) / 2, Math.atan2(bx - ax, bz - az));
      // Tyre walls in front of it on the outside of the corners.
      const outside = k > 0 ? -1 : 1;
      if (Math.abs(k) > 1 / 110 && side === outside) {
        for (let f = 0; f < 1; f += 0.34) {
          const x = ax + (bx - ax) * f - a.tz * side * 0.6, z = az + (bz - az) * f + a.tx * side * 0.6;
          tyres.push({ x, z, color: ['#e63946', '#f8f9fa', '#ffd166', '#118ab2'][Math.floor(s / 12) % 4] });
        }
      }
    }
  }
  // The pit wall: concrete, a red top and the sponsors along it (below).
  const W = PIT_WALL;
  box(solid, W.maxX - W.minX, 1.1, W.maxZ - W.minZ, '#d6d8de', (W.minX + W.maxX) / 2, 0, (W.minZ + W.maxZ) / 2, Math.PI / 2);
  box(solid, W.maxX - W.minX, 0.12, W.maxZ - W.minZ + 0.1, '#e63946', (W.minX + W.maxX) / 2, 1.1, (W.minZ + W.maxZ) / 2, Math.PI / 2);
  colliders.push({ ...W, top: 1.2 });
  // The garages' block, and the grandstands' (from the layout below), before their models come in.
  colliders.push({ ...GARAGES, top: 5.6 });

  // The gantry over the start line, and its lights.
  const line = pointAt(0);
  const across = (d: number, along = 0) => ({ x: line.x + line.tz * d + line.tx * along, z: line.z - line.tx * d + line.tz * along });
  const gantryY = 6.4;
  const lineRot = Math.atan2(line.tx, line.tz);
  for (const side of [-1, 1]) {
    const p = across(side * (EDGE + TRACK.curb + 1.4));
    box(solid, 0.9, gantryY + 1.2, 0.9, '#343a40', p.x, 0, p.z, lineRot);
    colliders.push({ minX: p.x - 0.55, maxX: p.x + 0.55, minZ: p.z - 0.55, maxZ: p.z + 0.55, top: gantryY + 1.2 });
  }
  const span = 2 * (EDGE + TRACK.curb + 1.4) + 0.9;
  const beam = across(0);
  box(solid, 1.2, 1.2, span, '#343a40', beam.x, gantryY, beam.z, lineRot + Math.PI / 2);
  // Chequered along the beam, both faces.
  const cells = 24;
  for (let i = 0; i < cells; i++) for (let j = 0; j < 2; j++) for (const face of [-1, 1]) {
    const p = across(-span / 2 + (i + 0.5) * (span / cells), face * 0.62);
    box(solid, 0.04, 0.6, span / cells, (i + j) % 2 ? '#212529' : '#f8f9fa', p.x, gantryY + j * 0.6, p.z, lineRot + Math.PI / 2, false);
  }
  // The lights' housing, facing the grid.
  const pod = across(0, -0.9);
  box(solid, 0.5, 0.9, 5.2, '#212529', pod.x, gantryY + 1.25, pod.z, lineRot + Math.PI / 2);
  const lights = new THREE.InstancedMesh(new THREE.SphereGeometry(0.34, 12, 8), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), 5);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 5; i++) {
    const p = across((i - 2) * 1.0, -1.2);
    lights.setMatrixAt(i, m4.makeTranslation(p.x, gantryY + 1.7, p.z));
    lights.setColorAt(i, new THREE.Color('#3a1010'));
  }
  lights.castShadow = false;
  group.add(lights);

  // The gate home.
  const home = gate(CIRCUIT_GATE, '🏙️ Back to the city', solid, colliders, 0);
  group.add(home.sign, home.shimmer);

  // ---- The layout: grandstands (solid to walk into), props.
  const { stands, props } = layout();
  for (const s of stands) {
    const hx = TILE / 2, hz = TILE / 2;
    colliders.push({ minX: s.x - hx, maxX: s.x + hx, minZ: s.z - hz, maxZ: s.z + hz, top: 6.5 });
  }

  // ---- Sponsor boards: on the pit wall, along the barriers across from it, and round the corners.
  /** `free`: standing on its own at the barriers, with a back and legs (the pit wall's are on the wall). */
  const boards: { x: number; z: number; rotY: number; banner: number; free?: boolean }[] = [];
  for (let x = W.minX + 6, k = 0; x < W.maxX - 4; x += 10, k++) boards.push({ x, z: W.maxZ + 0.02, rotY: 0, banner: k });
  for (let s = L - 90, k = 3; s < L + 140; s += 10, k++) {
    const p = pointAt(s);
    boards.push({ x: p.x - p.tz * (BAND - 0.2), z: p.z + p.tx * (BAND - 0.2), rotY: Math.atan2(p.tz, -p.tx), banner: k, free: true });
  }
  for (const s0 of [260, 480, 700, 1000, 1240]) {
    for (let j = 0; j < 4; j++) {
      const s = s0 + j * 9;
      const p = pointAt(s);
      const out = bend(s) > 0 ? -1 : 1;
      const d = (BAND - 0.25) * out;
      boards.push({ x: p.x + p.tz * d, z: p.z - p.tx * d, rotY: Math.atan2(-p.tz * out, p.tx * out), banner: j + s0, free: true });
    }
  }
  const loader = new THREE.TextureLoader();
  const gradient = (toon('#ffffff') as THREE.MeshToonMaterial).gradientMap;
  for (const atlas of ['a', 'b'] as const) {
    const mine = boards.filter((b) => (b.banner % 8 < 4) === (atlas === 'a'));
    if (!mine.length) continue;
    const tex = loader.load(`${import.meta.env.BASE_URL}textures/race-sponsors-${atlas}.jpg`);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const geos = mine.map((b) => {
      const plane = new THREE.PlaneGeometry(8, 2);
      // One banner of the four on the sheet, top to bottom.
      const k = b.banner % 4;
      const uv = plane.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - (k + 1 - uv.getY(i)) / 4);
      plane.rotateY(b.rotY).translate(b.x, 1.1 + 1, b.z);
      return plane;
    });
    const merged = new THREE.Mesh(mergeAll(geos), new THREE.MeshToonMaterial({ map: tex, gradientMap: gradient }));
    merged.receiveShadow = true;
    group.add(merged);
    // Their backs and legs, where they stand on their own.
    for (const b of mine) if (b.free) {
      const back = { x: b.x - Math.sin(b.rotY) * 0.08, z: b.z - Math.cos(b.rotY) * 0.08 };
      box(solid, 8, 2, 0.12, '#495057', back.x, 1.1, back.z, b.rotY);
    }
  }

  // ---- Tyre walls: one mesh for them all.
  const stack = mergeAll([0, 1, 2].map((k) => new THREE.CylinderGeometry(0.42, 0.42, 0.3, 12).translate(0, 0.16 + k * 0.31, 0)));
  const tyreMesh = new THREE.InstancedMesh(stack, toon('#ffffff'), tyres.length);
  const tc = new THREE.Color();
  tyres.forEach((t, i) => {
    tyreMesh.setMatrixAt(i, m4.makeTranslation(t.x, 0, t.z));
    tyreMesh.setColorAt(i, tc.set(i % 3 === 1 ? t.color : '#2b2d42'));
  });
  tyreMesh.castShadow = true;
  tyreMesh.receiveShadow = true;
  group.add(tyreMesh);

  group.add(mergeColored(solid));

  // ---- The circuit's cars, in the paddock.
  const fleet = new Fleet(colliders, interactables, CIRCUIT_CARS, () => []);
  fleet.setStreet(0);
  group.add(fleet.group);

  // ---- Kenney's models, once they're in: merged, and the crowd in the stands.
  let crowd: ReturnType<typeof crowdOf> | null = null;
  /** Each stand's middle, and how excited its crowd is. */
  const cheer = stands.map((s) => ({ x: s.x, z: s.z, level: 0 }));
  let seatsPerStand: number[] = [];
  void (async () => {
    const names = Object.keys(PROPS) as Prop[];
    const loaded = await Promise.all(names.map((n) => loadModel(PROPS[n]).catch((err: unknown) => (console.error(`${PROPS[n]}.glb didn't load`, err), null))));
    const models = new Map(names.map((n, i) => [n, loaded[i] ? centred(loaded[i]!.scene) : null]));
    const holder = new THREE.Group();
    const spots: THREE.Matrix4[] = [];
    const seats = new Map<Prop, THREE.Vector3[]>();
    for (const p of [...stands, ...props]) {
      const model = models.get(p.prop);
      if (!model) continue;
      const copy = model.clone();
      copy.scale.setScalar(p.scale);
      copy.rotation.y = p.rotY;
      copy.position.set(p.x, 0, p.z);
      copy.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = p.prop !== 'bush';
      });
      holder.add(copy);
      if (p.prop !== 'stand' && p.prop !== 'covered') continue;
      let list = seats.get(p.prop);
      if (!list) seats.set(p.prop, (list = seatsOf(model, p.prop === 'covered' ? 0.92 : 2)));
      copy.updateMatrix();
      for (const seat of list) spots.push(new THREE.Matrix4().multiplyMatrices(copy.matrix, new THREE.Matrix4().makeTranslation(seat.x, seat.y, seat.z)).multiply(new THREE.Matrix4().makeScale(1 / p.scale, 1 / p.scale, 1 / p.scale)));
    }
    seatsPerStand = stands.map((s) => seats.get(s.prop)?.length ?? 0);
    group.add(mergeColored(holder));
    if (spots.length) {
      crowd = crowdOf(spots);
      group.add(crowd.bodies, crowd.heads);
    }
  })();

  const tick = decorTicker();
  const moved = new THREE.Matrix4();
  const lift = new THREE.Matrix4();
  const off = new THREE.Color('#3a1010'), red = new THREE.Color('#ff2a2a'), green = new THREE.Color('#3dff5a');
  let shown = '';
  const update: Circuit['update'] = (dt, t, race, now, cars) => {
    pulse(home.shimmer, t);
    // The start lights: one more red each second of the countdown, all out at the start; green a moment after.
    let lit = 0;
    let color = red;
    if (race.phase === 'countdown' && race.startsAt) lit = Math.max(0, Math.min(5, 6 - Math.ceil((race.startsAt - now) / 1000)));
    else if (race.phase === 'racing' && race.startsAt && now - race.startsAt < 3000) {
      lit = 5;
      color = green;
    }
    const key = `${lit}${color === green}`;
    if (key !== shown) {
      shown = key;
      for (let i = 0; i < 5; i++) lights.setColorAt(i, i < lit ? color : off);
      lights.instanceColor!.needsUpdate = true;
    }
    const step = tick(dt);
    if (!step || !crowd) return;
    // The crowd: on their feet and bouncing where the cars are going past, and all of them when it's on.
    const on = race.phase === 'racing' || race.phase === 'countdown' ? 0.5 : race.phase === 'finished' ? 0.8 : 0.12;
    for (const c of cheer) {
      let near = 0;
      for (const car of cars) if (Math.abs(car.speed) > 3) near = Math.max(near, 1 - Math.hypot(car.x - c.x, car.z - c.z) / 70);
      c.level += (Math.max(on, near) - c.level) * Math.min(1, step * 3);
    }
    let i = 0;
    for (let k = 0; k < cheer.length; k++) {
      const level = cheer[k].level;
      for (let j = 0; j < seatsPerStand[k]; j++, i++) {
        const hop = level * 0.28 * Math.max(0, Math.sin(t * (8 + (i % 5)) + i * 1.7));
        moved.multiplyMatrices(lift.makeTranslation(0, hop, 0), crowd.base[i]);
        crowd.bodies.setMatrixAt(i, moved);
        crowd.heads.setMatrixAt(i, moved);
      }
    }
    crowd.bodies.instanceMatrix.needsUpdate = true;
    crowd.heads.instanceMatrix.needsUpdate = true;
  };

  return { group, colliders, interactables, pickables: [fleet.group], fleet, update };
}

/** Geometries of the same kind into one. */
function mergeAll(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  return mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)))!;
}
