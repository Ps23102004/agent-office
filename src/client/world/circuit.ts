import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CHECKPOINTS, CIRCUIT_CARS, CIRCUIT_GATE, CITY_GATE, GARAGES, PADDOCK, PIT_WALL, TRACK, checkpoint, gridPose, nearestProgress, pointAt, surfaceAt, track, type Gate } from '../../shared/circuit';
import { RACE_PLAZA, rng } from '../../shared/city';
import { RACE, type RaceState } from '../../shared/race';
import { racingLine, rubber } from '../../shared/racingline';
import { decorTicker } from '../quality';
import { Fleet, supercar } from './cars';
import { loadModel, type ModelName } from './models';
import type { Collider, Interactable } from './office';
import { Decals, decalUV, detail, type Grain } from './surface';
import { SKY_BODIES } from './sky';
import { gradientMap, mergeColored, mesh, textPlane, toon, toonVertexUnique } from './toon';
import type { CarDef } from '../../shared/garage';

// The race circuit (shared/circuit.ts), drawn: the track with its kerbs, gravel and white lines, the
// rubber down the racing line and skid marks into the corners you brake for, the grid's boxes and
// the chequered start line under the gantry and its five red lights, the pit lane's markings, tyre
// walls and Armco barriers round the grass, catch fencing in front of the grandstands and a fence
// round the grounds, sponsor boards (textures made for it: public/textures/race-sponsors-*.jpg),
// grandstands full of a cheering crowd, braking boards and chevrons at the corners, the pit garages
// along the paddock, trees, hills on the horizon, and the circuit's own cars waiting in the paddock
// (and your best lap's ghost). Every surface you drive on is level with the cars (y = 0), each one a
// mesh with its own grain (surface.ts), drawn over the one under it by polygonOffset rather than a
// few millimetres up, which would flicker far off. The grandstands, garages, trees and the like are Kenney's Racing
// Kit (CC0, see CREDITS.md), painted in the office's toon colors and merged, so the whole place is a
// couple of dozen draw calls, its cars aside. Also the gate on the plaza in the city that gets you here.

/** A Kenney Racing Kit tile, in metres: its buildings are a tile or so across. */
const TILE = 8;
/** Where the asphalt's edge is, and where the grass stops at the barriers. */
const EDGE = TRACK.width / 2;
const BAND = TRACK.width / 2 + TRACK.runoff;
/**
 * The barriers stand just past where a car can go (BAND, shared/circuit.ts circuitGround), the tyre
 * walls in front of them touching it, and the boards behind them: so a car stops at the tyres, and
 * nothing it could drive through is drawn on the grass.
 */
const RAIL = BAND + 1;
const TYRES = BAND + 0.45;
const BOARDS = RAIL + 0.35;
/** Braking boards and chevrons, behind the sponsor boards and up over them. */
const SIGNS = RAIL + 1.6;
/** Half a grandstand's width (Kenney's is 9.7 m across at TILE). */
const STAND = 4.9;

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
  /** The checkpoint coach: one arrow floating over checkpoint `next`'s line, pointing the way round (null: none). Each frame. */
  coach(next: number | null): void;
  /** Your best lap's ghost, in car `def`, where it is now (null: none). Each frame. */
  ghost(def: CarDef | null, at: { x: number; z: number; rotY: number } | null): void;
}

const UP = [0, 1, 0] as const;

/** Vertex-colored flat pieces of ground, all in one mesh: triangles facing up. */
class Flat {
  pos: number[] = [];
  col: number[] = [];
  norm: number[] = [];
  private c = new THREE.Color();

  /** `n`: the normal it's lit with, when that isn't straight up (a kerb's slope). Colors: one, or one a corner. */
  tri(a: THREE.Vector3Like, b: THREE.Vector3Like, c: THREE.Vector3Like, color: string | readonly THREE.Color[], n: readonly number[] = UP) {
    // Wound anticlockwise seen from above, so it faces up.
    const up = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z) > 0;
    const cols = typeof color === 'string' ? [this.c.set(color), this.c, this.c] : color;
    const order = up ? [0, 1, 2] : [0, 2, 1];
    const pts = [a, b, c];
    for (const i of order) {
      this.pos.push(pts[i].x, pts[i].y, pts[i].z);
      this.col.push(cols[i].r, cols[i].g, cols[i].b);
      this.norm.push(n[0], n[1], n[2]);
    }
  }

  quad(a: THREE.Vector3Like, b: THREE.Vector3Like, c: THREE.Vector3Like, d: THREE.Vector3Like, color: string | readonly THREE.Color[], n: readonly number[] = UP) {
    const cols = typeof color === 'string' ? color : [color[0], color[1], color[2], color[3]];
    this.tri(a, b, c, typeof cols === 'string' ? cols : [cols[0], cols[1], cols[2]], n);
    this.tri(a, c, d, typeof cols === 'string' ? cols : [cols[0], cols[2], cols[3]], n);
  }

  /** A band along the track from `s0` to `s1` (m round it), `from` to `to` metres off the centre line (+ is the left). */
  band(s0: number, s1: number, from: number, to: number, y: number, color: string | readonly THREE.Color[], n: readonly number[] = UP, yTo = y) {
    const a = pointAt(s0), b = pointAt(s1);
    const at = (p: { x: number; z: number; tx: number; tz: number }, d: number, h: number) => ({ x: p.x + p.tz * d, y: h, z: p.z - p.tx * d });
    this.quad(at(a, from, y), at(b, from, y), at(b, to, yTo), at(a, to, yTo), color, n);
  }

  /** As one mesh in `mat` (vertex-colored), drawn `offset` steps behind (+) or in front of (-) what it's level with. */
  mesh(mat: THREE.Material = toonVertexUnique(), offset = 0): THREE.Mesh {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.norm, 3));
    if (offset) {
      mat.polygonOffset = true;
      mat.polygonOffsetFactor = offset;
      mat.polygonOffsetUnits = offset;
    }
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    return m;
  }
}

/** A vertex-colored material with the surface `grain` on it (surface.ts). */
const ground = (grain: Grain) => detail(toonVertexUnique(), grain);

/** How sharply the track turns `s` metres round (1 / radius), and which way: + to the left. */
function bend(s: number): number {
  const a = pointAt(s - 6), b = pointAt(s + 6);
  return (a.tx * b.tz - a.tz * b.tx) / -12;
}

/** Whether a barrier (or anything else) `RAIL` off the centre line at (x, z) is clear of every part of the track's grass, where two parts come close or round the inside of a tight corner. */
function railClear(x: number, z: number): boolean {
  return Math.abs(nearestProgress(x, z).d) > RAIL - 0.5;
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
export function gate(g: Gate, sign: string, solid: THREE.Group, colliders: Collider[], y0: number, paint: readonly [string, string] = ['#e63946', '#f8f9fa']): { sign: THREE.Object3D; shimmer: THREE.Mesh } {
  const s = Math.sin(g.rotY), c = Math.cos(g.rotY);
  // Across the opening is (c, -s); through it is (s, c).
  const at = (across: number, through = 0) => ({ x: g.x + across * c + through * s, z: g.z - across * s + through * c });
  const H = 7;
  for (const side of [-1, 1]) {
    const p = at(side * (g.width / 2 + 0.6));
    for (let k = 0; k < 5; k++) box(solid, 1.2, H / 5, 1.2, paint[k % 2], p.x, (k * H) / 5, p.z, g.rotY);
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
  // Hung from the beam's front face on two short rods (it used to float 0.75 m below it), facing whoever's coming to go through.
  const hang = 0.3;
  const { width: lw, height: lh } = label.geometry.parameters;
  const face = at(0, -0.47);
  label.position.set(face.x, y0 + H - hang - (lh * 1.6) / 2, face.z);
  label.rotation.y = g.rotY + Math.PI;
  for (const side of [-1, 1]) {
    const rod = at(side * (lw * 0.8 - 0.4), -0.47);
    box(solid, 0.06, hang + 0.05, 0.06, '#adb5bd', rod.x, H - hang, rod.z, g.rotY, false);
  }
  const shimmer = new THREE.Mesh(
    new THREE.PlaneGeometry(g.width, H - 0.2),
    new THREE.MeshBasicMaterial({ color: '#9bf6ff', transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }),
  );
  shimmer.position.set(g.x, y0 + (H - 0.2) / 2, g.z);
  shimmer.rotation.y = g.rotY;
  return { sign: label, shimmer };
}

/** The shimmer across a gate's opening, gently pulsing. */
export function pulse(shimmer: THREE.Mesh, t: number) {
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
  // Paving, a racing-red carpet up to the gate from the street and a chequered strip across it: all
  // level with the street (the cars drive over them), each drawn over the one under it. One carpet:
  // from a little short of the sidewalk to just through the gate (past it you're at the circuit), its
  // edges trimmed a darker red.
  const paving = new Flat(), runway = new Flat(), paint = new Flat();
  const corner = (x: number, z: number) => ({ x, y: 0, z });
  paving.quad(corner(p.minX, p.minZ), corner(p.maxX, p.minZ), corner(p.maxX, p.maxZ), corner(p.minX, p.maxZ), '#c9ccd3');
  const g = CITY_GATE;
  const far = g.z - 1.2, near = p.maxZ - 2;
  runway.quad(corner(g.x - 5, far), corner(g.x + 5, far), corner(g.x + 5, near), corner(g.x - 5, near), '#d6455d');
  for (const [x0, z0, x1, z1] of [[g.x - 5, far, g.x - 4.7, near], [g.x + 4.7, far, g.x + 5, near], [g.x - 4.7, near - 0.3, g.x + 4.7, near], [g.x - 4.7, far, g.x + 4.7, far + 0.3]]) {
    paint.quad(corner(x0, z0), corner(x1, z0), corner(x1, z1), corner(x0, z1), '#8f1f30');
  }
  for (let i = 0; i < 10; i++) for (let j = 0; j < 2; j++) {
    const x = g.x - 5 + i, z = g.z + 3 + j;
    paint.quad(corner(x, z), corner(x + 1, z), corner(x + 1, z + 1), corner(x, z + 1), (i + j) % 2 ? '#212529' : '#f8f9fa');
  }
  group.add(paving.mesh(ground('slab')), runway.mesh(ground('runoff'), -1), paint.mesh(toonVertexUnique(), -2));
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

// ---- Fences and the horizon -------------------------------------------------------------------------

/** How far apart a chain-link fence's wires cross (m): a tile of chainLink is 8 of them. */
const LINK = 0.075;

let linkTex: THREE.CanvasTexture | null = null;
/** Chain-link: galvanised wire in diamonds, see-through between. Repeating. */
function chainLink(): THREE.CanvasTexture {
  if (linkTex) return linkTex;
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.strokeStyle = '#c3c9d1';
  g.lineWidth = 2.5;
  for (let k = -S; k <= S * 2; k += S / 8) {
    g.beginPath();
    g.moveTo(k, 0);
    g.lineTo(k + S, S);
    g.moveTo(k, S);
    g.lineTo(k + S, 0);
    g.stroke();
  }
  linkTex = new THREE.CanvasTexture(c);
  linkTex.colorSpace = THREE.SRGBColorSpace;
  linkTex.wrapS = linkTex.wrapT = THREE.RepeatWrapping;
  linkTex.anisotropy = 4;
  return linkTex;
}

/**
 * Chain-link fencing, as one mesh: a panel from (ax, az) to (bx, bz) for each, `h` high from `y` up (the
 * ground if not said), seen from either side, its wire starting `u` m along (0 if not said): a run of
 * panels gives each where the last left off.
 */
function fencing(panels: { ax: number; az: number; bx: number; bz: number; h: number; u?: number; y?: number }[]): THREE.Mesh {
  const pos: number[] = [], uv: number[] = [], norm: number[] = [];
  const tile = LINK * 8;
  for (const p of panels) {
    const len = Math.hypot(p.bx - p.ax, p.bz - p.az);
    const nx = (p.bz - p.az) / len, nz = -(p.bx - p.ax) / len;
    const u = p.u ?? 0, y = p.y ?? 0;
    const c = [[p.ax, y, p.az, u, 0], [p.bx, y, p.bz, u + len, 0], [p.bx, y + p.h, p.bz, u + len, p.h], [p.ax, y + p.h, p.az, u, p.h]];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      pos.push(c[i][0], c[i][1], c[i][2]);
      uv.push(c[i][3] / tile, c[i][4] / tile);
      norm.push(nx, 0, nz);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  // Blended rather than cut out: further off, where its smaller mipmaps average the wire and the gaps, it
  // fades to a haze of wire (as a fence does) instead of vanishing.
  const mat = new THREE.MeshToonMaterial({ map: chainLink(), gradientMap: gradientMap(), transparent: true, depthWrite: false, alphaTest: 0.02, side: THREE.DoubleSide });
  mat.userData.outlineParameters = { visible: false };
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  return m;
}

/** A ridge line round the horizon, `n` heights a lap, each between 0 and about the sum of the octaves' weights. */
function ridge(n: number, octaves: [cells: number, weight: number][], r: () => number): Float32Array {
  const out = new Float32Array(n);
  for (const [cells, w] of octaves) {
    const lat = Array.from({ length: cells }, () => r());
    for (let i = 0; i < n; i++) {
      const f = (i * cells) / n;
      const i0 = Math.floor(f);
      const t = (f - i0) * (f - i0) * (3 - 2 * (f - i0));
      out[i] += (lat[i0 % cells] * (1 - t) + lat[(i0 + 1) % cells] * t) * w;
    }
  }
  return out;
}

/**
 * Hills far off all round, and woods in front of them, in the haze: so the circuit's grass doesn't
 * just stop at the sky. Shapes only (no texture), colored the sky's color darkened, and drawn at the
 * very back, only where nothing else is: they ride along with you, so they look infinitely far off.
 */
function horizon(): THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> {
  const pos: number[] = [], layer: number[] = [];
  const r = rng(30303);
  const ring = (n: number, radius: number, base: number, heights: Float32Array, k: number) => {
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      const h0 = base + heights[i], h1 = base + heights[(i + 1) % n];
      const p = [[a0, -60], [a1, -60], [a1, h1], [a0, -60], [a1, h1], [a0, h0]];
      for (const [a, y] of p) {
        pos.push(Math.cos(a) * radius, y, Math.sin(a) * radius);
        layer.push(k);
      }
    }
  };
  ring(256, 600, 8, ridge(256, [[3, 26], [7, 14], [19, 6], [53, 2]], r), 0);
  // Treetops: a jagged line, a crown every couple of degrees.
  const woods = ridge(720, [[11, 5], [41, 3]], r);
  for (let i = 0; i < woods.length; i += 2) woods[i] += 1 + r() * 1.6;
  ring(720, 560, 1, woods, 1);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('layer', new THREE.Float32BufferAttribute(layer, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { horizon: { value: new THREE.Color() }, haze: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute float layer;
      varying float vLayer;
      void main() {
        vLayer = layer;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        // At the very back of the depth buffer: only where nothing's been drawn.
        gl_Position.z = gl_Position.w * 0.99999;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 horizon;
      uniform float haze;
      varying float vLayer;
      void main() {
        vec3 tint = mix( vec3( 0.8, 0.87, 0.93 ), vec3( 0.58, 0.72, 0.62 ), vLayer );
        gl_FragColor = vec4( mix( horizon, horizon * tint, haze ), 1.0 );
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide,
    // With what's see-through, after everything solid (so the depth buffer says where nothing is), but
    // over the sun, moon and stars (sky.ts SKY_BODIES), which it hides as it should, and under the
    // world's own see-through things (the catch fences), which go over it.
    transparent: true,
    depthWrite: false,
  });
  mat.userData.outlineParameters = { visible: false };
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = SKY_BODIES + 100;
  m.frustumCulled = false;
  const at = new THREE.Vector3();
  m.onBeforeRender = (_r, scene, camera) => {
    camera.getWorldPosition(at);
    m.position.set(at.x, 0, at.z);
    m.updateMatrixWorld();
    if (scene.background instanceof THREE.Color) mat.uniforms.horizon.value.copy(scene.background);
    // Lost in fog or rain, as the haze closes in.
    const fog = scene.fog as THREE.Fog | null;
    mat.uniforms.haze.value = fog ? THREE.MathUtils.smoothstep(fog.far, 40, 230) : 1;
  };
  return m;
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
      const off = BAND + STAND + 2.5;
      const x = p.x + p.tz * off * out, z = p.z - p.tx * off * out;
      if (!clear(x, z, STAND)) continue;
      // Facing the track: toward the centre line.
      stands.push({ prop: covered(s) ? 'covered' : 'stand', x, z, rotY: Math.atan2(-p.tz * out, p.tx * out), scale: TILE });
    }
  };
  const { length: L, corners } = track();
  // The main straight's, across from the pit wall (on the right, heading for the line); covered by the line.
  row(L - 100, L + 150, -1, TILE, (s) => Math.abs(s - L) < 50);
  // Round the outside of the corners you brake hard for, and the carousel's.
  for (const c of corners) if (c.brake || c === corners.find((k) => k.name === 'Carousel')) row(c.s0 - 15, c.s1 + 15, c.turn > 0 ? 1 : -1, 7.5);
  // The pit garages along the back of the paddock, facing it, with an office every so often.
  const n = Math.floor((GARAGES.maxX - GARAGES.minX) / TILE);
  for (let i = 0; i < n; i++) {
    props.push({ prop: i % 6 === 3 ? 'office' : 'garage', x: GARAGES.minX + (i + 0.5) * TILE, z: (GARAGES.minZ + GARAGES.maxZ) / 2, rotY: 0, scale: TILE });
  }
  // Tents for the teams at the paddock's east end, and floodlights along it.
  for (let i = 0; i < 3; i++) props.push({ prop: 'tent', x: PADDOCK.maxX - 12, z: PADDOCK.minZ + 8 + i * 9, rotY: -Math.PI / 2, scale: 5 });
  for (let x = PADDOCK.minX + 20; x < PADDOCK.maxX; x += 45) props.push({ prop: 'lamp', x, z: PADDOCK.minZ + 1.5, rotY: 0, scale: 11 });
  // Banner towers on the outside of the corners: behind the boards and the signs (SIGNS), and clear of the stands.
  for (const c of corners) {
    const s = Math.round((c.s0 + c.s1) / 2);
    const p = pointAt(s);
    const out = bend(s) > 0 ? -1 : 1;
    const off = BAND + 5.5;
    const x = p.x + p.tz * off * out, z = p.z - p.tx * off * out;
    if (clear(x, z, 1.7) && !stands.some((t) => Math.hypot(t.x - x, t.z - z) < STAND + 2.5)) props.push({ prop: s % 2 ? 'towerRed' : 'towerGreen', x, z, rotY: Math.atan2(-p.tz * out, p.tx * out), scale: 6 });
  }
  // Trees round about, outside everything, the same for everyone.
  const r = rng(20261001);
  const spot = (x: number, z: number) => clear(x, z, 3) && !stands.some((s) => Math.hypot(s.x - x, s.z - z) < TILE + 3);
  const far = grounds();
  for (let k = 0; k < 2400 && props.length < 560; k++) {
    const x = far.minX + 10 + r() * (far.maxX - far.minX - 20);
    const z = far.minZ + 10 + r() * (far.maxZ - far.minZ - 20);
    if (z < GARAGES.minZ + 2 && z > GARAGES.minZ - 30 && x > GARAGES.minX - 20 && x < GARAGES.maxX + 20) continue;
    if (!spot(x, z)) continue;
    props.push({ prop: r() < 0.6 ? 'tree' : 'bush', x, z, rotY: r() * Math.PI * 2, scale: 5 + r() * 2.5 });
  }
  return { stands, props };
}

/** The circuit's grounds: round the track with room to spare, and a fence round them. */
function grounds(): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const { points } = track();
  const xs = points.map((p) => p.x), zs = points.map((p) => p.z);
  const m = 140;
  return { minX: Math.min(...xs) - m, maxX: Math.max(...xs) + m, minZ: Math.min(...zs) - m, maxZ: Math.max(...zs) + m };
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

/** The teams in the pit garages: named for the sponsors on the boards, each in its colour. */
const TEAMS: [name: string, color: string][] = [
  ['ZOOMY COLA', '#e63946'], ['NIMBUS', '#118ab2'], ['BYTE BURGER', '#8338ec'], ['PIXEL PETROL', '#06d6a0'],
  ['MEGA MANGO', '#f4a261'], ['ROCKET', '#ef476f'], ['CHECKERED', '#343a40'], ['TURBO', '#3a86ff'],
];
/** Kenney's pit garage at TILE: two bays either side of a pillar in its middle, and how high its opening and its front are (m). */
const BAY = { off: 1.83, w: 2.9, open: 3.16, top: 4.35, front: 4.36 } as const;

/**
 * The fronts of the pit garages (Kenney's, centred at `xs` along z = `z`, facing the paddock): over each
 * bay its team's board, the car's number in a white disc and the team's name in the team's colour (all
 * on one canvas, one mesh); and a roller door in each, part way down, into `solid`.
 */
function garageFronts(xs: number[], z: number, solid: THREE.Group): THREE.Mesh {
  const bays = xs.flatMap((x) => [x - BAY.off, x + BAY.off]);
  const CW = 256, CH = 64, COLS = 4;
  const c = document.createElement('canvas');
  c.width = CW * COLS;
  c.height = THREE.MathUtils.ceilPowerOfTwo(CH * Math.ceil(bays.length / COLS));
  const g = c.getContext('2d')!;
  g.textBaseline = 'middle';
  const front = z + BAY.front + 0.02, h = BAY.top - BAY.open - 0.44;
  const geos = bays.map((x, k) => {
    const [name, color] = TEAMS[Math.floor(k / 2) % TEAMS.length];
    const cx = (k % COLS) * CW, cy = Math.floor(k / COLS) * CH;
    g.fillStyle = color;
    g.fillRect(cx, cy, CW, CH);
    g.fillStyle = '#f8f9fa';
    g.fillRect(cx, cy + CH - 6, CW, 6);
    g.beginPath();
    g.arc(cx + 34, cy + 29, 24, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = color;
    g.textAlign = 'center';
    g.font = '900 30px system-ui, sans-serif';
    g.fillText(String(k + 1), cx + 34, cy + 31);
    g.fillStyle = '#f8f9fa';
    g.textAlign = 'left';
    g.font = `900 ${name.length > 10 ? 24 : 28}px system-ui, sans-serif`;
    g.fillText(name, cx + 68, cy + 31, CW - 78);
    const plane = new THREE.PlaneGeometry(BAY.w, h);
    const uv = plane.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (cx + uv.getX(i) * CW) / c.width, 1 - (cy + (1 - uv.getY(i)) * CH) / c.height);
    plane.translate(x, BAY.open + 0.22 + h / 2, front);
    // The door, rolled part way down, set back in the opening.
    box(solid, BAY.w, 1.25, 0.06, '#c9ced6', x, BAY.open - 1.25, front - 0.35, 0, false);
    box(solid, BAY.w, 0.08, 0.1, '#868e96', x, BAY.open - 1.29, front - 0.35, 0, false);
    return plane;
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const m = new THREE.Mesh(mergeAll(geos), new THREE.MeshToonMaterial({ map: tex, gradientMap: gradientMap() }));
  m.receiveShadow = true;
  return m;
}

/** The circuit, built the first time anyone goes there. */
export function buildCircuit(): Circuit {
  const group = new THREE.Group();
  const colliders: Collider[] = [];
  const interactables: Interactable[] = [];
  const { points, length: L, corners } = track();
  // The ground under it all, to stand on; and a fence far out, so nobody wanders off into the haze.
  const far = grounds();
  colliders.push({ ...far, bottom: -1, top: 0 });
  colliders.push(
    { minX: far.minX, maxX: far.minX + 1, minZ: far.minZ, maxZ: far.maxZ, top: 6, fence: true },
    { minX: far.maxX - 1, maxX: far.maxX, minZ: far.minZ, maxZ: far.maxZ, top: 6, fence: true },
    { minX: far.minX, maxX: far.maxX, minZ: far.minZ, maxZ: far.minZ + 1, top: 6, fence: true },
    { minX: far.minX, maxX: far.maxX, minZ: far.maxZ - 1, maxZ: far.maxZ, top: 6, fence: true },
  );

  // ---- The ground: grass, the paddock, the track, kerbs, gravel, lines, the grid and the start line.
  // All at y = 0, a mesh a surface, each over the one it's laid on (Flat.mesh's offset).
  const grass = new Flat(), runoff = new Flat(), gravel = new Flat(), paddock = new Flat(), asphalt = new Flat(), kerbs = new Flat(), paint = new Flat();
  const g = (x: number, z: number, y = 0) => ({ x, y, z });
  // Grass all round, mown in stripes (the shader's: see surface.ts 'lawn').
  grass.quad(g(far.minX - 400, far.minZ - 400), g(far.maxX + 400, far.minZ - 400), g(far.maxX + 400, far.maxZ + 400), g(far.minX - 400, far.maxZ + 400), '#8ccf6a');
  const P = PADDOCK;
  // On under the garages, so there's no strip of grass between them and the paddock.
  paddock.quad(g(P.minX, GARAGES.minZ - 1), g(P.maxX, GARAGES.minZ - 1), g(P.maxX, P.maxZ), g(P.minX, P.maxZ), '#a4a8b3');
  // Parking bays in front of the garages, where the circuit's cars wait.
  for (const def of CIRCUIT_CARS) {
    for (const dx of [-3, 3]) paint.quad(g(def.x + dx - 0.12, def.z - 3), g(def.x + dx + 0.12, def.z - 3), g(def.x + dx + 0.12, def.z + 3), g(def.x + dx - 0.12, def.z + 3), '#f8f9fa');
  }
  // The pit lane, along the front of the paddock behind the pit wall: its edge line, PIT LANE and its speed limit at either end.
  const W0 = PIT_WALL;
  const laneZ = W0.minZ - 9;
  paint.quad(g(W0.minX, laneZ - 0.12), g(W0.maxX, laneZ - 0.12), g(W0.maxX, laneZ + 0.12), g(W0.minX, laneZ + 0.12), '#f8f9fa');
  for (let x = W0.minX - 24; x < W0.minX; x += 3) paint.quad(g(x, laneZ - 0.12), g(x + 1.5, laneZ - 0.12), g(x + 1.5, laneZ + 0.12), g(x, laneZ + 0.12), '#f8f9fa');
  for (let x = W0.maxX; x < W0.maxX + 24; x += 3) paint.quad(g(x, laneZ - 0.12), g(x + 1.5, laneZ - 0.12), g(x + 1.5, laneZ + 0.12), g(x, laneZ + 0.12), '#f8f9fa');
  const marks = new Decals();
  for (const [x, dir] of [[W0.minX + 8, 1], [W0.maxX - 8, -1]] as const) {
    // Read by whoever's driving in: along the lane, heading east at the west end and west at the east.
    marks.flat(decalUV('pit'), x, 0, laneZ + 4.5, 7.6, 1.9, (dir * Math.PI) / 2);
    marks.flat(decalUV('limit'), x + dir * 6, 0, laneZ + 4.5, 2.4, 2.4, (dir * Math.PI) / 2);
  }
  const step = L / points.length;
  const shade = (k: number) => new THREE.Color('#5d616d').multiplyScalar(1 - 0.42 * k);
  /** Whether `s` m round is in a hard braking zone: the 80 m into a corner you brake for. */
  const brakingZone = (s: number) => corners.some((c) => c.brake && s > c.s0 - 80 && s <= c.s0 + 10);
  const ACROSS = 16;
  for (let i = 0; i < points.length; i++) {
    const s0 = i * step, s1 = s0 + step;
    const k = bend(s0 + step / 2);
    // The asphalt, in strips across, darker where the rubber's down along the racing line (and heavier in the
    // braking zones), and laid in sections a few hundred metres long, each a shade of its own where it was resurfaced.
    const heavy = brakingZone(s0) ? 1.35 : 1;
    const laid = 0.94 + 0.12 * ((Math.sin(Math.floor((s0 + step / 2) / 230) * 12.9898) * 43758.5453) % 1 + 1) % 1;
    for (let j = 0; j < ACROSS; j++) {
      const d0 = -EDGE + (j * 2 * EDGE) / ACROSS, d1 = d0 + (2 * EDGE) / ACROSS;
      const c = (s: number, d: number) => shade(Math.min(1, rubber(s, d) * heavy + 0.08)).multiplyScalar(laid);
      asphalt.band(s0, s1, d0, d1, 0, [c(s0, d0), c(s1, d0), c(s1, d1), c(s0, d1)]);
    }
    // White lines inside the edges: stopping either side of the chequered start line (s -1 to 1), which they'd lie on.
    const la = i === 0 ? 1 : s0, lb = i === points.length - 1 ? L - 1 : s1;
    paint.band(la, lb, EDGE - 0.6, EDGE - 0.3, 0, '#f8f9fa');
    paint.band(la, lb, -EDGE + 0.3, -EDGE + 0.6, 0, '#f8f9fa');
    // Kerbs where it bends, both sides: a metre of white and a metre of red, rising a centimetre to the
    // outside and lit as if they rose more (their slope is what you see of a kerb).
    if (Math.abs(k) > 1 / 160) {
      const p = pointAt(s0 + step / 2);
      for (const side of [-1, 1]) {
        const tilt = 0.22;
        const n = [-side * p.tz * Math.sin(tilt), Math.cos(tilt), side * p.tx * Math.sin(tilt)];
        for (let h = 0; h < 2; h++) {
          const a = s0 + (h * step) / 2, b = a + step / 2;
          kerbs.band(a, b, side * EDGE, side * (EDGE + TRACK.curb), 0, h ? '#e63946' : '#f8f9fa', n, 0.01);
        }
      }
    }
    // Gravel round the outside of the slow corners; a wide run-off of pale asphalt round the fast ones.
    const c = corners.find((c) => s0 > c.s0 - 10 && s0 < c.s1 + 10 && c.r < 200);
    if (c) {
      const out = c.turn > 0 ? 1 : -1;
      const slow = c.r < 70;
      const a = EDGE + TRACK.curb, b = a + (slow ? 10 : 13);
      (slow ? gravel : runoff).band(s0, s1, out > 0 ? a : -b, out > 0 ? b : -a, 0, slow ? '#c2baa6' : '#8f949e');
    }
  }
  // Tyre marks: black streaks laid along the track, each a run of decals from `from` for `len` m, `off(s)`
  // m off the centre line, `w` wide, narrowing to nothing over `fade` m at either end (where the tyre
  // bit, and where it let go).
  const skid = decalUV('skid');
  const sr = rng(4242);
  const streak = (from: number, len: number, off: (s: number) => number, w = 0.28, fade = 8) => {
    for (let s = from; s < from + len; s += 2) {
      const a = pointAt(s), b = pointAt(s + 2);
      const at = (p: typeof a, dd: number) => [p.x + p.tz * dd, 0, p.z - p.tx * dd];
      const da = off(s), db = off(s + 2);
      const half = (t: number) => (w / 2) * Math.max(0, Math.min(1, (t - from) / fade, (from + len - t) / fade));
      const ha = half(s), hb = half(s + 2);
      marks.quad(at(a, da - ha), at(a, da + ha), at(b, db + hb), at(b, db - hb), skid, UP);
    }
  };
  /** How far off the centre line a car's middle can be with both its tyres' streaks on the asphalt, inside the white lines. */
  const mid = EDGE - 0.8 - 0.8;
  for (const c of corners) {
    // Into the corners you brake for: pairs of locked tyres' streaks along the racing line.
    if (c.brake) for (let n = 0; n < 5; n++) {
      const from = c.s0 - 85 + sr() * 30, len = 30 + sr() * 35, wander = (sr() - 0.5) * 2.4;
      for (const wheel of [-0.8, 0.8]) streak(from, len, (s) => THREE.MathUtils.clamp(racingLine(s) + wander + Math.sin(s * 0.11 + n) * 0.15, -mid, mid) + wheel);
    }
    // Out of the slow ones: wheelspin, the rear stepping out toward the outside of the exit and caught.
    if (c.brake || c.r < 70) for (let n = 0; n < 3; n++) {
      const from = (c.s0 + c.s1) / 2 + sr() * 6, len = 18 + sr() * 16, wander = (sr() - 0.5) * 1.6;
      const out = c.turn > 0 ? 1 : -1;
      for (const wheel of [-0.8, 0.8]) streak(from, len, (s) => THREE.MathUtils.clamp(racingLine(s) + wander + out * 0.9 * Math.sin(Math.min(1, (s - from) / len) * Math.PI), -mid, mid) + wheel, 0.24, 5);
    }
  }
  // Patches down the lap, where the asphalt's been dug out and relaid: a shade darker, with sealed edges.
  const patch = decalUV('patch');
  for (let s = 40 + sr() * 60; s < L - 40; s += 80 + sr() * 120) {
    const len = 3 + sr() * 7, w = 2 + sr() * 3, d = (sr() - 0.5) * (2 * EDGE - w - 1.4);
    const a = pointAt(s), b = pointAt(s + len);
    const at = (p: typeof a, dd: number) => [p.x + p.tz * dd, 0, p.z - p.tx * dd];
    marks.quad(at(a, d - w / 2), at(a, d + w / 2), at(b, d + w / 2), at(b, d - w / 2), patch, UP);
  }
  // The chequered start line, and the grid's boxes behind it: a bar across the front of each, its sides running back, and its
  // number just ahead of the bar, where the car parked in the box doesn't cover it (the car's middle is at np.s).
  for (let i = 0; i < 12; i++) {
    for (let j = 0; j < 2; j++) paint.band(-1 + j, j, -EDGE + i, -EDGE + i + 1, 0, (i + j) % 2 ? '#212529' : '#f8f9fa');
  }
  for (let slot = 0; slot < RACE.slots; slot++) {
    const p = gridPose(slot);
    const np = nearestProgress(p.x, p.z);
    paint.band(np.s + 2.6, np.s + 2.9, np.d - 1.4, np.d + 1.4, 0, '#f8f9fa');
    for (const side of [-1, 1]) paint.band(np.s + 1.4, np.s + 2.9, np.d + side * 1.4 - 0.12, np.d + side * 1.4 + 0.12, 0, '#f8f9fa');
    const num = pointAt(np.s + 3.6);
    marks.flat(decalUV('digit', slot), num.x + num.tz * np.d, 0, num.z - num.tx * np.d, 1.1, 1.1, Math.atan2(num.tx, num.tz));
    // Black from the starts: the rear tyres spinning away from the box, a few launches' worth, over the number.
    for (let n = 0; n < 3; n++) {
      const len = 5 + sr() * 6, nudge = (sr() - 0.5) * 0.25;
      for (const wheel of [-0.8, 0.8]) streak(np.s - 1.3, len, () => np.d + wheel + nudge, 0.26, 3);
    }
  }
  group.add(
    grass.mesh(ground('lawn'), 3),
    paddock.mesh(ground('slab'), 1.5),
    gravel.mesh(ground('gravel'), 1.5),
    runoff.mesh(ground('runoff'), 1.5),
    asphalt.mesh(ground('track')),
    kerbs.mesh(ground('concrete')),
    paint.mesh(toonVertexUnique(), -1),
    marks.mesh(),
  );

  // ---- What stands: barriers, the pit wall, the gantry, the gate home. Merged at the end.
  const solid = new THREE.Group();
  const tyres: { x: number; z: number; color: string }[] = [];
  const inPaddock = (x: number, z: number) => x > P.minX - 2 && x < P.maxX + 2 && z > P.minZ - 2 && z < P.maxZ + 3;
  /** Which side's barrier (+ the left) a car that doesn't stop for a corner `s` m round runs into, in the 80 m before it: the corner's outside. */
  const braking = (s: number) => {
    const c = corners.find((c) => c.brake && s > c.s0 - 80 && s <= c.s0);
    return c ? (c.turn > 0 ? 1 : -1) : 0;
  };
  for (let i = 0; i < points.length; i += 2) {
    const s = i * step;
    const k = bend(s + step);
    for (const side of [-1, 1]) {
      const a = pointAt(s), b = pointAt(s + step * 2);
      const ax = a.x + a.tz * RAIL * side, az = a.z - a.tx * RAIL * side;
      const bx = b.x + b.tz * RAIL * side, bz = b.z - b.tx * RAIL * side;
      // None round the inside of a tight corner, or where it would stand on another part of the track's grass.
      if (inPaddock(ax, az) || inPaddock(bx, bz) || !railClear((ax + bx) / 2, (az + bz) / 2)) continue;
      const len = Math.hypot(bx - ax, bz - az);
      // Armco: two galvanised rails on a post every few metres, the post behind them.
      const rot = Math.atan2(bx - ax, bz - az);
      for (const y of [0.3, 0.62]) box(solid, 0.12, 0.3, len + 0.05, '#b9c0c8', (ax + bx) / 2, y, (az + bz) / 2, rot);
      box(solid, 0.14, 0.95, 0.14, '#5c636e', ax + a.tz * side * 0.14, 0, az - a.tx * side * 0.14, rot);
      // Tyre walls in front of it on the outside of the corners, and at the end of the braking zones.
      const outside = k > 0 ? -1 : 1;
      if ((Math.abs(k) > 1 / 110 && side === outside) || braking(s) === side) {
        for (let f = 0; f < 1; f += 0.34) {
          const x = ax + (bx - ax) * f - a.tz * side * (RAIL - TYRES), z = az + (bz - az) * f + a.tx * side * (RAIL - TYRES);
          tyres.push({ x, z, color: ['#e63946', '#f8f9fa', '#ffd166', '#118ab2'][Math.floor(s / 12) % 4] });
        }
      }
    }
  }
  // The pit wall: concrete, a red top, the sponsors along both its faces (below), a debris fence over it
  // (with the catch fencing, below), and the teams' stands on the pit lane's side: a desk of screens
  // under an awning in the team's colour.
  const W = PIT_WALL;
  const wallZ = (W.minZ + W.maxZ) / 2;
  box(solid, W.maxX - W.minX, 1.1, W.maxZ - W.minZ, '#d6d8de', (W.minX + W.maxX) / 2, 0, wallZ);
  box(solid, W.maxX - W.minX, 0.12, W.maxZ - W.minZ + 0.1, '#e63946', (W.minX + W.maxX) / 2, 1.1, wallZ);
  colliders.push({ ...W, top: 4.2 });
  const teams = ['#e63946', '#118ab2', '#ffd166', '#06d6a0', '#8338ec', '#f78c6b', '#212529'];
  for (let x = W.minX + 14, k = 0; x < W.maxX - 10; x += 24, k++) {
    const z = W.minZ - 0.55;
    box(solid, 3.2, 1.05, 1, '#343a40', x, 0, z);
    for (const dx of [-0.8, 0.8]) {
      box(solid, 1.1, 0.62, 0.08, '#1d1f24', x + dx, 1.05, W.minZ - 0.2);
      box(solid, 0.98, 0.5, 0.02, '#4cc9f0', x + dx, 1.11, W.minZ - 0.25, 0, false);
    }
    // The awning, out over the desk on two poles.
    for (const dx of [-1.6, 1.6]) box(solid, 0.08, 2.5, 0.08, '#adb5bd', x + dx, 0, W.minZ - 1.9);
    box(solid, 3.6, 0.1, 2.1, teams[k % teams.length], x, 2.5, W.minZ - 1.05);
    // Solid out to its poles, so a car in the pit lane doesn't drive through them.
    colliders.push({ minX: x - 1.65, maxX: x + 1.65, minZ: W.minZ - 1.95, maxZ: W.minZ, top: 2.6 });
  }
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
  // The lights' housing, facing the grid: standing on the beam, at its front edge.
  const pod = across(0, -0.35);
  box(solid, 0.5, 0.9, 5.2, '#212529', pod.x, gantryY + 1.2, pod.z, lineRot + Math.PI / 2);
  const lights = new THREE.InstancedMesh(new THREE.SphereGeometry(0.34, 12, 8), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), 5);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 5; i++) {
    const p = across((i - 2) * 1.0, -0.62);
    lights.setMatrixAt(i, m4.makeTranslation(p.x, gantryY + 1.65, p.z));
    lights.setColorAt(i, new THREE.Color('#3a1010'));
  }
  lights.castShadow = false;
  group.add(lights);

  // The gate home.
  const home = gate(CIRCUIT_GATE, '🏙️ Back to the city', solid, colliders, 0);
  group.add(home.sign, home.shimmer);

  // ---- The layout: grandstands (solid to walk into), props; the pit garages' boards and doors.
  const { stands, props } = layout();
  group.add(garageFronts(props.filter((p) => p.prop === 'garage').map((p) => p.x), (GARAGES.minZ + GARAGES.maxZ) / 2, solid));
  for (const s of stands) colliders.push({ minX: s.x - STAND, maxX: s.x + STAND, minZ: s.z - STAND, maxZ: s.z + STAND, top: 6.5 });

  // ---- Fences: catch fencing along the barrier in front of the grandstands, and round the grounds (which
  // were only ever colliders). Chain-link on posts, all in one mesh.
  const panels: { ax: number; az: number; bx: number; bz: number; h: number; u?: number; y?: number }[] = [];
  const post = (x: number, z: number, h: number, y = 0) => box(solid, 0.1, h, 0.1, '#6c757d', x, y, z, 0, false);
  // The debris fence along the pit wall, from its top.
  for (let x = W.minX; x < W.maxX - 0.01; x += 4.4) {
    const x1 = Math.min(W.maxX, x + 4.4);
    panels.push({ ax: x, az: wallZ, bx: x1, bz: wallZ, h: 3, y: 1.22, u: x - W.minX });
    post(x, wallZ, 3.1, 1.22);
  }
  post(W.maxX, wallZ, 3.1, 1.22);
  // In panels about 4 m long at fixed places round the lap, each side's taken once however many stands
  // it's in front of: stands side by side share one run, rather than each laying its own over the next's.
  const count = Math.round(L / 4), panel = L / count;
  const fenced = [new Set<number>(), new Set<number>()];
  for (const st of stands) {
    const np = nearestProgress(st.x, st.z);
    for (let k = Math.floor((np.s - STAND - 0.5) / panel); k <= Math.floor((np.s + STAND + 0.5) / panel); k++) fenced[np.d > 0 ? 1 : 0].add(((k % count) + count) % count);
  }
  fenced.forEach((cells, left) => {
    const d = (left ? 1 : -1) * (RAIL + 0.7);
    const at = (s: number) => {
      const p = pointAt(s);
      return { x: p.x + p.tz * d, z: p.z - p.tx * d };
    };
    // In order round the lap, the wire carrying on from one panel to the next.
    let u = 0;
    for (const k of [...cells].sort((p, q) => p - q)) {
      const a = at(k * panel), b = at((k + 1) * panel);
      panels.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, h: 4.2, u });
      u += Math.hypot(b.x - a.x, b.z - a.z);
      post(a.x, a.z, 4.3);
      // A post at the end of each run, too.
      if (!cells.has((k + 1) % count)) post(b.x, b.z, 4.3);
    }
  });
  const edges: [number, number, number, number][] = [
    [far.minX, far.minZ, far.maxX, far.minZ],
    [far.maxX, far.minZ, far.maxX, far.maxZ],
    [far.maxX, far.maxZ, far.minX, far.maxZ],
    [far.minX, far.maxZ, far.minX, far.minZ],
  ];
  for (const [ax, az, bx, bz] of edges) {
    const len = Math.hypot(bx - ax, bz - az), n = Math.ceil(len / 6);
    for (let k = 0; k < n; k++) {
      const f0 = k / n, f1 = (k + 1) / n;
      panels.push({ ax: ax + (bx - ax) * f0, az: az + (bz - az) * f0, bx: ax + (bx - ax) * f1, bz: az + (bz - az) * f1, h: 2.6 });
      post(ax + (bx - ax) * f0, az + (bz - az) * f0, 2.7);
    }
  }
  group.add(fencing(panels));
  const sky = horizon();
  group.add(sky);

  // ---- Sponsor boards: on the pit wall, along the barriers across from it, and round the corners.
  /**
   * `free`: standing on its own at the barriers, with a back and legs. The pit wall's are on its faces,
   * end to end down both sides, a size to fit (`w` across, `y` up to its foot: 8 m from 1.1 m up if not said).
   */
  const boards: { x: number; z: number; rotY: number; banner: number; free?: boolean; w?: number; y?: number }[] = [];
  const onWall = Math.floor((W.maxX - W.minX) / 4.4);
  for (let k = 0; k < onWall; k++) {
    const x = (W.minX + W.maxX) / 2 + (k - (onWall - 1) / 2) * 4.4;
    boards.push({ x, z: W.maxZ + 0.02, rotY: 0, banner: k, w: 4.4, y: 0 }, { x, z: W.minZ - 0.02, rotY: Math.PI, banner: k + 2, w: 4.4, y: 0 });
  }
  /** Not in a grandstand's way. */
  const open = (x: number, z: number) => !stands.some((t) => Math.hypot(t.x - x, t.z - z) < STAND + 1.5);
  for (let s = L - 90, k = 3; s < L + 140; s += 10, k++) {
    const p = pointAt(s);
    const x = p.x - p.tz * BOARDS, z = p.z + p.tx * BOARDS;
    if (open(x, z)) boards.push({ x, z, rotY: Math.atan2(p.tz, -p.tx), banner: k, free: true });
  }
  for (const c of corners) {
    if (c.r > 120) continue;
    for (let j = 0; j < 4; j++) {
      const s = c.s0 + j * 9;
      const p = pointAt(s);
      const out = c.turn > 0 ? 1 : -1;
      const d = BOARDS * out;
      const x = p.x + p.tz * d, z = p.z - p.tx * d;
      if (railClear(x, z) && open(x, z)) boards.push({ x, z, rotY: Math.atan2(-p.tz * out, p.tx * out), banner: j + Math.round(c.s0), free: true });
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
      const plane = new THREE.PlaneGeometry(b.w ?? 8, (b.w ?? 8) / 4);
      // One banner of the four on the sheet, top to bottom.
      const k = b.banner % 4;
      const uv = plane.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - (k + 1 - uv.getY(i)) / 4);
      plane.rotateY(b.rotY).translate(b.x, (b.y ?? 1.1) + (b.w ?? 8) / 8, b.z);
      return plane;
    });
    const merged = new THREE.Mesh(mergeAll(geos), new THREE.MeshToonMaterial({ map: tex, gradientMap: gradient }));
    merged.receiveShadow = true;
    group.add(merged);
    // Their backs and legs, where they stand on their own.
    for (const b of mine) if (b.free) {
      const back = { x: b.x - Math.sin(b.rotY) * 0.08, z: b.z - Math.cos(b.rotY) * 0.08 };
      box(solid, 8, 2, 0.12, '#495057', back.x, 1.1, back.z, b.rotY);
      for (const side of [-1, 1]) box(solid, 0.12, 1.1, 0.12, '#495057', back.x + Math.cos(b.rotY) * 3.4 * side, 0, back.z - Math.sin(b.rotY) * 3.4 * side, b.rotY);
    }
  }

  // ---- Braking boards (150, 100 and 50 m to go) before the corners you stop for, and chevrons round
  // the outside of the tight ones: on posts behind the barrier and the sponsor boards, up over them,
  // facing the cars coming. One mesh a sign.
  const SIGN_Y = 3.3;
  const signs = new Map<string, { x: number; z: number; rotY: number }[]>();
  const sign = (label: string, s: number, out: 1 | -1, face: number) => {
    const p = pointAt(s);
    const d = SIGNS * out;
    const x = p.x + p.tz * d, z = p.z - p.tx * d;
    if (!railClear(x, z) || !open(x, z)) return;
    // Facing whoever's `face` m back round the track.
    const from = pointAt(s - face);
    const rotY = Math.atan2(from.x - x, from.z - z);
    box(solid, 0.15, SIGN_Y, 0.15, '#495057', x - Math.sin(rotY) * 0.1, 0, z - Math.cos(rotY) * 0.1);
    (signs.get(label) ?? signs.set(label, []).get(label)!).push({ x, z, rotY });
  };
  for (const c of corners) {
    const out = c.turn > 0 ? 1 : -1;
    if (c.brake) for (const m of [150, 100, 50]) sign(String(m), c.s0 - m, out, 30);
    if (c.r <= 60 && Math.abs(c.turn) >= 60) for (const f of [0.2, 0.5, 0.8]) sign(c.turn > 0 ? '›››' : '‹‹‹', c.s0 + (c.s1 - c.s0) * f, out, 25);
  }
  for (const [label, spots] of signs) {
    const chevron = !/\d/.test(label);
    const proto = textPlane(label, chevron ? { size: 96, bg: '#e63946', color: '#ffffff', border: '#f8f9fa' } : { size: 96, bg: '#f8f9fa', color: '#212529' });
    // A couple of metres across, its own shape.
    const { width, height } = proto.geometry.parameters;
    const w = 2.2, h = (2.2 * height) / width;
    group.add(new THREE.Mesh(mergeAll(spots.map((p) => new THREE.PlaneGeometry(w, h).rotateY(p.rotY).translate(p.x, SIGN_Y + h / 2, p.z))), proto.material));
    proto.geometry.dispose();
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

  // ---- The checkpoint coach: a big chevron over the next line you're to go through. One draw call.
  const chevron = new THREE.Shape([
    new THREE.Vector2(-1.6, -1.2),
    new THREE.Vector2(0, 0.6),
    new THREE.Vector2(1.6, -1.2),
    new THREE.Vector2(1.6, 0.2),
    new THREE.Vector2(0, 2),
    new THREE.Vector2(-1.6, 0.2),
  ]);
  // Lying flat, its point (+y of the shape) towards +z, the way round the track once turned.
  const arrowGeo = new THREE.ExtrudeGeometry(chevron, { depth: 0.35, bevelEnabled: false }).rotateX(Math.PI / 2);
  const arrow = new THREE.Mesh(arrowGeo, toon('#ffd60a', { emissive: '#7a5c00' }));
  arrow.visible = false;
  group.add(arrow);
  let arrowAt = -1;
  let clock = 0;
  const coach: Circuit['coach'] = (next) => {
    arrow.visible = next !== null && next >= 0 && next < CHECKPOINTS;
    if (!arrow.visible) return;
    if (next !== arrowAt) {
      arrowAt = next!;
      const c = checkpoint(arrowAt);
      const p = pointAt((arrowAt * L) / CHECKPOINTS);
      arrow.position.set(c.x, 0, c.z);
      arrow.rotation.y = Math.atan2(p.tx, p.tz);
    }
    clock += 1 / 60;
    arrow.position.y = 4.5 + Math.sin(clock * 3) * 0.4;
  };

  // ---- Your best lap's ghost: a see-through copy of your car, made the first time it's wanted (and again for another car).
  let ghostCar: { key: string; root: THREE.Group } | null = null;
  const see = new THREE.MeshBasicMaterial({ color: '#9bf6ff', transparent: true, opacity: 0.28, depthWrite: false });
  const ghost: Circuit['ghost'] = (def, at) => {
    if (!def || !at) {
      if (ghostCar) ghostCar.root.visible = false;
      return;
    }
    const key = `${def.kind}|${def.color}`;
    if (ghostCar?.key !== key) {
      if (ghostCar) group.remove(ghostCar.root);
      const root = supercar(def.kind, def.color).root;
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = m.receiveShadow = false;
        m.material = see;
      });
      group.add(root);
      ghostCar = { key, root };
    }
    ghostCar.root.visible = true;
    ghostCar.root.position.set(at.x, 0, at.z);
    ghostCar.root.rotation.y = at.rotY;
  };

  return { group, colliders, interactables, pickables: [fleet.group], fleet, update, coach, ghost };
}

/** Geometries of the same kind into one. */
function mergeAll(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  return mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)))!;
}
