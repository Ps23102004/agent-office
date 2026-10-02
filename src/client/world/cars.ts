import * as THREE from 'three';
import { SPECS, CARS, DRIVE_STEP, drive, seatOffset, seatHips, leanAngle, carPoint, type Box, type CarDef, type CarKind, type CarPose, type CarSeat, type CarState, type Pedals } from '../../shared/garage';
import { citySolids, surfaceAt, type Surface } from '../../shared/city';
import { FLOOR, SLAB, STREET_Y, WALL_T } from '../../shared/layout';
import type { Collider, Interactable } from './office';
import { mergeByMaterial, mergeColored, mesh, toon } from './toon';
import { kitMaterial, kitModel, type KitModel, type KitName } from './carkit';
import { mergeGeometries, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * A supercar's wheel on one axle: along the car (z), its radius (its hub that high), how far out its hub
 * is, half its tread, and the arch over it (its radius about the hub).
 */
export interface Axle { z: number; r: number; x: number; tread: number; arch: number }
/** How far a supercar's front wheels are drawn turned at most (rad), tucked in as they are; an open-wheeler's or a bike's, which nothing's round. */
const STEER = 0.35;
const STEER_OPEN = 0.42;

/** A line along the car: its values at points z (rear to front), straight between and level past the ends. */
function line(...pts: [z: number, v: number][]): (z: number) => number {
  return (z) => {
    let i = 1;
    while (i < pts.length - 1 && z > pts[i][0]) i++;
    const [z0, a] = pts[i - 1], [z1, b] = pts[i];
    return a + (b - a) * THREE.MathUtils.clamp((z - z0) / (z1 - z0), 0, 1);
  };
}

/**
 * A supercar's body as lines along it (z, rear to front): every slice across it is drawn from these
 * (slice). Heights are its underside, its widest point, its shoulders (the fenders' tops) and its middle
 * (the hood and the deck); `half` is half its width seen from above.
 */
export interface Hull {
  axles: [rear: Axle, front: Axle];
  tail: number;
  nose: number;
  floor(z: number): number;
  side(z: number): number;
  crest(z: number): number;
  mid(z: number): number;
  half(z: number): number;
  /** How far the sill tucks in under the widest point, the shoulders lean in over it, the flanks swell out between and the hood bulges (m). */
  tuck: number;
  lean: number;
  swell: number;
  crown: number;
  /** Folds sharper than this (rad) are drawn as edges, gentler ones smooth: a Lambo's all facets. */
  crease: number;
  /**
   * The glass house on top, from its tail end (`from`) to the windshield's foot (`to`), its roof between
   * `roofFrom` and `roofTo`: how high it is, and half its width at the beltline and at the roof.
   */
  cabin: { from: number; to: number; roofFrom: number; roofTo: number; top(z: number): number; belt(z: number): number; roof(z: number): number };
}

/** Lambos are wedges: a knife-edge nose, fenders over the hood, a long glass engine cover and a wing. Ferraris are curves: a rounded nose, a long hood, big haunches and a ducktail. */
export const HULLS: Record<'lambo' | 'ferrari', Hull> = {
  lambo: {
    axles: [{ z: -1.4, r: 0.36, x: 0.82, tread: 0.16, arch: 0.435 }, { z: 1.4, r: 0.33, x: 0.75, tread: 0.13, arch: 0.405 }],
    tail: -2.32,
    nose: 2.32,
    floor: line([-2.32, 0.27], [-1.95, 0.15], [2.0, 0.13], [2.32, 0.17]),
    side: line([-2.32, 0.52], [-1.4, 0.5], [0, 0.44], [1.4, 0.44], [2.32, 0.27]),
    crest: line([-2.32, 0.8], [-2.05, 0.87], [-1.4, 0.88], [-0.7, 0.84], [0.2, 0.79], [0.95, 0.79], [1.4, 0.8], [1.95, 0.63], [2.32, 0.4]),
    mid: line([-2.32, 0.78], [-2.05, 0.85], [-1.0, 0.86], [-0.6, 0.8], [0.95, 0.75], [1.4, 0.69], [2.0, 0.53], [2.32, 0.38]),
    half: line([-2.32, 0.88], [-2.05, 0.98], [-1.85, 1.0], [-0.95, 1.0], [-0.45, 0.93], [0.45, 0.93], [0.95, 0.99], [1.85, 0.99], [2.1, 0.93], [2.32, 0.78]),
    tuck: 0.04,
    lean: 0.08,
    swell: 0,
    crown: 0,
    crease: 0.35,
    cabin: {
      from: -2.08, to: 0.95, roofFrom: -0.8, roofTo: -0.05,
      top: line([-2.08, 0.85], [-0.8, 1.09], [-0.42, 1.11], [-0.05, 1.1], [0.95, 0.76]),
      belt: line([-2.08, 0.5], [-1.3, 0.72], [-0.6, 0.79], [0.4, 0.8], [0.95, 0.72]),
      roof: line([-2.08, 0.42], [-0.8, 0.56], [-0.05, 0.56], [0.95, 0.66]),
    },
  },
  ferrari: {
    axles: [{ z: -1.36, r: 0.355, x: 0.82, tread: 0.155, arch: 0.43 }, { z: 1.36, r: 0.33, x: 0.75, tread: 0.13, arch: 0.405 }],
    tail: -2.3,
    nose: 2.3,
    floor: line([-2.3, 0.28], [-1.95, 0.15], [2.0, 0.13], [2.3, 0.19]),
    side: line([-2.3, 0.55], [-1.36, 0.52], [0, 0.46], [1.36, 0.46], [2.3, 0.3]),
    crest: line([-2.3, 0.77], [-2.1, 0.85], [-1.36, 0.89], [-0.7, 0.82], [0.3, 0.78], [1.0, 0.79], [1.36, 0.81], [1.75, 0.75], [2.05, 0.64], [2.3, 0.45]),
    mid: line([-2.3, 0.75], [-2.1, 0.83], [-1.2, 0.84], [-0.6, 0.79], [0.7, 0.75], [1.36, 0.73], [1.8, 0.66], [2.1, 0.57], [2.3, 0.43]),
    half: line([-2.3, 0.84], [-2.1, 0.96], [-1.8, 1.0], [-0.95, 1.0], [-0.45, 0.94], [0.45, 0.95], [0.95, 0.99], [1.8, 0.99], [2.1, 0.93], [2.3, 0.72]),
    tuck: 0.05,
    lean: 0.1,
    swell: 0.03,
    crown: 0.025,
    crease: 0.9,
    cabin: {
      from: -1.95, to: 0.7, roofFrom: -0.75, roofTo: -0.15,
      top: line([-1.95, 0.84], [-1.35, 0.98], [-0.75, 1.13], [-0.45, 1.155], [-0.15, 1.15], [0.25, 1.0], [0.7, 0.77]),
      belt: line([-1.95, 0.52], [-1.3, 0.74], [-0.6, 0.79], [0.3, 0.8], [0.7, 0.74]),
      roof: line([-1.95, 0.4], [-0.75, 0.55], [-0.15, 0.55], [0.7, 0.66]),
    },
  },
};

/** How far either side of its hub a wheel's arch comes down to the floor: its legs, the well's front and back walls. */
const leg = (a: Axle, floor: number) => Math.sqrt(a.arch ** 2 - (a.r - floor) ** 2);

/**
 * The body's slice across at z, its left half (x up from 0), from the middle underneath round to the
 * middle of the top: the floor, the wheel well (`well`: up from the floor to the arch, its inner wall
 * far enough in for a front tire to turn), the sill and its skirt (round an arch, its lip), the widest
 * point, the flank, the shoulder, the hood's edge and the middle of the hood. Over a well the shoulder
 * is always above the arch, so a tire never shows through the hood.
 */
export function slice(h: Hull, z: number, well: boolean): [x: number, y: number][] {
  const f = h.floor(z), w = h.half(z), crest = h.crest(z), mid = h.mid(z);
  const a = z > 0 ? h.axles[1] : h.axles[0];
  const roof = well ? a.r + Math.sqrt(Math.max(0, a.arch ** 2 - (z - a.z) ** 2)) : f;
  const inner = a.x - a.tread - (a.z > 0 ? 0.1 : 0.04);
  const side = Math.max(h.side(z), roof + 0.025);
  const hood = Math.min(inner - 0.04, w - h.lean - 0.1);
  return [
    [0, f], [inner, f], [inner, roof], [w - h.tuck, roof], [w - h.tuck * 0.4, well ? roof + 0.012 : f + 0.07], [w, side],
    [w - h.lean / 2 + h.swell, (side + crest) / 2], [w - h.lean, crest],
    [hood, crest - 0.015], [hood / 2, (crest - 0.015 + mid) / 2 + h.crown], [0, mid],
  ];
}

/** Where the body's sliced along the car: closer round the arches, and twice at each arch's legs (outside the well, then in it). */
export function stations(h: Hull): { z: number; well: boolean }[] {
  const plain = [h.tail, h.tail + 0.05, h.tail + 0.14, h.tail + 0.28, h.nose - 0.28, h.nose - 0.14, h.nose - 0.05, h.nose];
  for (let z = h.tail + 0.45; z < h.nose - 0.4; z += 0.25) plain.push(z);
  plain.sort((a, b) => a - b);
  const out: { z: number; well: boolean }[] = [];
  let from = -Infinity;
  for (const a of h.axles) {
    const l = leg(a, h.floor(a.z));
    out.push(...plain.filter((z) => z >= from && z < a.z - l - 0.05).map((z) => ({ z, well: false })));
    out.push({ z: a.z - l, well: false });
    // Even steps round the arch, from its back leg over the top to its front one.
    const t0 = Math.acos(l / a.arch);
    for (let i = 0; i <= 10; i++) out.push({ z: a.z - a.arch * Math.cos(t0 + ((Math.PI - 2 * t0) * i) / 10), well: true });
    out.push({ z: a.z + l, well: false });
    from = a.z + l + 0.05;
  }
  out.push(...plain.filter((z) => z >= from).map((z) => ({ z, well: false })));
  return out;
}

/**
 * A closed hull through slices across the car (each its left half, mirrored for the right), its ends
 * capped: a geometry for each color `paint(segment, z)` gives a strip of it (the slice's segment, -1
 * for the end caps), with folds sharper than `crease` drawn as edges.
 */
function loft(rings: { z: number; pts: [number, number][] }[], paint: (seg: number, z: number) => string, crease: number): Map<string, THREE.BufferGeometry> {
  const n = rings[0].pts.length;
  // Each ring: up the left side from the middle underneath to the middle on top, and down the right.
  const full = rings.map(({ z, pts }) => [...pts, ...pts.slice(1, -1).reverse().map(([x, y]) => [-x, y] as [number, number])].map(([x, y]) => new THREE.Vector3(x, y, z)));
  const R = full[0].length;
  const out = new Map<string, number[]>();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  const tri = (key: string, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
    if (e1.subVectors(b, a).cross(e2.subVectors(c, a)).lengthSq() < 1e-12) return;
    if (!out.has(key)) out.set(key, []);
    out.get(key)!.push(...a.toArray(), ...b.toArray(), ...c.toArray());
  };
  const seg = (k: number) => (k < n - 1 ? k : 2 * n - 3 - k);
  for (let i = 0; i + 1 < full.length; i++) {
    const z = (rings[i].z + rings[i + 1].z) / 2;
    for (let k = 0; k < R; k++) {
      const a = full[i][k], b = full[i][(k + 1) % R], c = full[i + 1][(k + 1) % R], d = full[i + 1][k];
      tri(paint(seg(k), z), a, b, c);
      tri(paint(seg(k), z), a, c, d);
    }
  }
  // The ends, fanned from their middles.
  for (const [ring, back] of [[full[0], true], [full[full.length - 1], false]] as const) {
    const c = new THREE.Vector3(0, (ring[0].y + ring[n - 1].y) / 2, ring[0].z);
    for (let k = 0; k < R; k++) back ? tri(paint(-1, c.z), c, ring[(k + 1) % R], ring[k]) : tri(paint(-1, c.z), c, ring[k], ring[(k + 1) % R]);
  }
  const geos = new Map<string, THREE.BufferGeometry>();
  for (const [key, pos] of out) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geos.set(key, toCreasedNormals(g, crease));
  }
  return geos;
}

/**
 * The glass house's slice at z (its left half, as for loft): sunk a little into the body at its foot, up
 * the side window to the roof's edge, and over the roof. At its two ends it's flat on the body: the
 * windshield and the engine cover rise from there.
 */
function cabinSlice(h: Hull, z: number): [number, number][] {
  const c = h.cabin;
  const base = h.mid(z) - 0.02, belt = h.crest(z) - 0.03, wb = c.belt(z);
  if (z <= c.from || z >= c.to) return [[0, base], [wb, belt], [wb, belt], [wb, belt], [0, base]];
  const top = Math.max(c.top(z), belt + 0.06);
  return [[0, base], [wb, belt], [c.roof(z), top - 0.04], [c.roof(z) - 0.08, top - 0.01], [0, top]];
}

/** The x of the body's side at height y (above its sill) in the slice at z: for putting things on its flank. */
function flank(h: Hull, z: number, y: number): number {
  const p = slice(h, z, false);
  for (let k = 4; k < 7; k++) {
    const [x0, y0] = p[k], [x1, y1] = p[k + 1];
    if (y <= y1 || k === 6) return x0 + (x1 - x0) * THREE.MathUtils.clamp((y - y0) / (y1 - y0), 0, 1);
  }
  return p[5][0];
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
  /** How far the front wheels are ever drawn turned (rad): further, a closed body's would stick out of its sides. */
  steer: number;
  /** Lit over its tail lights (hidden while they're off): red when it brakes, or driven after dark (see Fleet). */
  tails: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  /** White lamps at the back, lit while it backs up. */
  reverse: THREE.Object3D;
  /** Lit over its headlights, while their beams are on the road (see Fleet). */
  heads: THREE.Object3D;
  /** Half its width at the widest, wheels and all (m): an open-wheeler's stick out past its body. */
  half: number;
}

/**
 * Lamps that light up over a car's own (each car's own material, its color changed as they go on): hidden
 * till then. Not tone mapped, so a lit lamp's its own full color, not washed out pink-white.
 */
function overlay(parts: THREE.BufferGeometry[], color: string): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
  const mat = new THREE.MeshBasicMaterial({ color, toneMapped: false });
  mat.userData.outlineParameters = { visible: false };
  const m = new THREE.Mesh(parts.length ? mergeGeometries(parts.map((g) => g.toNonIndexed()))! : new THREE.BufferGeometry(), mat);
  m.visible = false;
  return m;
}

/** A box `size` big at `at`, turned `turn` (rad, about x, y then z). */
const lampBox = (size: [number, number, number], at: readonly number[], turn: [number, number, number] = [0, 0, 0]) =>
  new THREE.BoxGeometry(...size).applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...at), new THREE.Quaternion().setFromEuler(new THREE.Euler(...turn)), new THREE.Vector3(1, 1, 1)));

/** A lamp's lens (`geo`, for `unlit`) and what lights up over it, a little bigger. */
interface Lamp { geo: THREE.BufferGeometry; glow: THREE.BufferGeometry }
const boxLamp = (size: [number, number, number], at: readonly number[], turn?: [number, number, number]): Lamp => ({ geo: lampBox(size, at, turn), glow: lampBox([size[0] + 0.02, size[1] + 0.02, size[2] + 0.02], at, turn) });
const roundLamp = (r: number, at: readonly number[]): Lamp => ({ geo: new THREE.CylinderGeometry(r, r, 0.04, 14).rotateX(Math.PI / 2).translate(at[0], at[1], at[2]), glow: new THREE.CylinderGeometry(r + 0.012, r + 0.012, 0.06, 14).rotateX(Math.PI / 2).translate(at[0], at[1], at[2]) });

/**
 * A cartoon supercar, nose toward +z, wheels on y = 0: a hull lofted through slices across it (see
 * HULLS), the wheels in real wells under its arches, the glass house on top. A Lambo is a lime, orange or
 * yellow wedge with a wing; a Ferrari is curvy, round taillights, a ducktail and yellow badges.
 */
export function supercar(kind: CarKind, color: string): CarModel {
  if (kind === 'motorbike' || kind === 'bicycle') return bike(kind, color);
  const kit = kind === 'lambo' || kind === 'ferrari' ? null : kitModel(kind satisfies KitName);
  if (kit) return kitCar(kind, kit, color);
  // A Kenney car before its model's in (or if it never loads): a Ferrari stretched to its size, with its seats.
  const spec = SPECS[kind];
  const ref = SPECS.ferrari;
  const fit = kind === 'lambo' || kind === 'ferrari' ? null : new THREE.Vector3(spec.width / ref.width, spec.roof / ref.roof, spec.length / ref.length);
  const lambo = kind === 'lambo';
  const h = HULLS[lambo ? 'lambo' : 'ferrari'];
  const mats = { paint: toon(color), glass: toon('#233347'), dark: toon('#24262f'), metal: toon('#aeb3bd'), badge: toon('#ffd400') };
  const tire = toon('#1f1f26');
  const rim = toon(lambo ? '#e9b949' : '#d9dbe3');
  const g = new THREE.Group();
  /** How steeply a line falls toward the nose at z (rad): to lay something flat on it. */
  const slope = (f: (z: number) => number, z: number) => Math.atan2(f(z - 0.05) - f(z + 0.05), 0.1);
  const add = (geo: THREE.BufferGeometry, mat: keyof typeof mats, to: THREE.Group = g) => to.add(mesh(geo, mats[mat]));

  // The body: the underside, the wells and the skirts dark, the rest painted.
  const body = loft(stations(h).map(({ z, well }) => ({ z, pts: slice(h, z, well) })), (seg) => (seg >= 0 && seg < 4 ? 'dark' : 'paint'), h.crease);
  for (const [k, geo] of body) add(geo, k as keyof typeof mats);
  // The glass house: windshield and side windows, painted pillars and roof, and behind the roof the
  // engine cover (a Lambo's painted and louvred, a Ferrari's glass) between painted buttresses. That
  // stays on with the roof off, a bulkhead behind the seats.
  const c = h.cabin;
  const split = c.roofFrom - 0.25;
  const cz = [c.from, c.from + 0.12, split, c.roofFrom, c.roofTo, c.to - 0.06, c.to];
  for (let z = c.from + 0.3; z < c.to - 0.1; z += 0.22) cz.push(z);
  const glasshouse = (from: number, to: number, into: THREE.Group) => {
    const parts = loft([...new Set(cz)].filter((z) => z >= from && z <= to).sort((a, b) => a - b).map((z) => ({ z, pts: cabinSlice(h, z) })), (seg, z) => {
      if (seg === 1) return z > split ? 'glass' : 'paint';
      if (seg === 3) return z > c.roofTo || (z < split && !lambo) ? 'glass' : 'paint';
      return seg === 0 ? 'dark' : 'paint';
    }, h.crease);
    for (const [k, geo] of parts) add(geo, k as keyof typeof mats, into);
  };
  glasshouse(c.from, split, g);
  const closed = new THREE.Group();
  glasshouse(split, c.to, closed);
  if (lambo) for (let z = c.from + 0.3; z < split - 0.08; z += 0.13) {
    add(lampBox([(c.roof(z) - 0.12) * 2, 0.02, 0.05], [0, c.top(z) + 0.005, z], [slope(c.top, z), 0, 0]), 'dark');
  }

  const T = h.tail, N = h.nose;
  // The lights: lenses (one unlit mesh between them), with what lights up over each.
  const heads: Lamp[] = [], tails: Lamp[] = [], backs: Lamp[] = [];
  // Mirrors out by the windshield's foot: the housing down on the shoulder, its stalk out from the side
  // window (where that is at the stalk's height: up from the beltline to the roof's edge), and the glass.
  const zm = c.to - 0.3, xm = c.belt(zm) + 0.17, ym = h.crest(zm) + 0.04, sy = ym - 0.03;
  const [, [bx, by], [rx, ry]] = cabinSlice(h, zm);
  const x0 = bx + ((rx - bx) * (sy - by)) / (ry - by), x1 = xm - 0.1;
  for (const sx of [-1, 1]) {
    add(lampBox([0.2, 0.09, 0.13], [sx * xm, ym, zm]), 'paint');
    add(lampBox([x1 - x0 + 0.02, 0.03, 0.05], [(sx * (x0 + x1)) / 2, sy, zm + 0.02]), 'dark');
    add(lampBox([0.16, 0.065, 0.01], [sx * xm, ym, zm - 0.066]), 'glass');
  }
  // Under the tail, the diffuser's fins: down from its ramp to the floor's level and no lower, so they don't scrape the road on the springs.
  const [fy0, fy1] = [h.floor(T + 0.37), h.floor(T)];
  for (const x of [-0.45, -0.15, 0.15, 0.45]) add(lampBox([0.025, fy1 - fy0, 0.36], [x, (fy0 + fy1) / 2, T + 0.18]), 'dark');
  /** A dark intake on a flank, through the corners (z, y) given, flush with the side. */
  const intake = (corners: [number, number][]) => {
    for (const sx of [-1, 1]) {
      const pts = corners.map(([z, y]) => new THREE.Vector3(sx * (flank(h, z, y) + 0.006), y, z));
      const geo = new THREE.BufferGeometry().setFromPoints(sx > 0 ? [pts[0], pts[2], pts[1], pts[0], pts[3], pts[2]] : [pts[0], pts[1], pts[2], pts[0], pts[2], pts[3]]);
      geo.computeVertexNormals();
      add(geo, 'dark');
    }
  };
  if (lambo) {
    for (const sx of [-1, 1]) {
      // Slim headlights along the nose's corners, and Y-shaped tail lights.
      heads.push(boxLamp([0.4, 0.035, 0.1], [sx * 0.68, h.crest(2.0) + 0.012, 2.0], [slope(h.crest, 2.0), sx * 0.3, 0]));
      tails.push(boxLamp([0.42, 0.05, 0.04], [sx * 0.5, 0.71, T - 0.01]), boxLamp([0.2, 0.05, 0.04], [sx * 0.69, 0.63, T - 0.01], [0, 0, sx * 0.85]));
      backs.push(boxLamp([0.16, 0.05, 0.04], [sx * 0.3, 0.6, T - 0.01]));
      // Air intakes low in the nose either side, and the exhausts out of the tail.
      add(lampBox([0.4, 0.11, 0.05], [sx * 0.5, 0.25, N - 0.01]), 'dark');
      add(new THREE.CylinderGeometry(0.075, 0.075, 0.14, 12).rotateX(Math.PI / 2).translate(sx * 0.4, 0.3, T - 0.03), 'metal');
      add(new THREE.CylinderGeometry(0.052, 0.052, 0.02, 12).rotateX(Math.PI / 2).translate(sx * 0.4, 0.3, T - 0.1), 'dark');
      // The wing's struts and end plates.
      add(lampBox([0.045, 0.26, 0.1], [sx * 0.55, 0.96, -2.12], [-0.25, 0, 0]), 'dark');
      add(lampBox([0.025, 0.15, 0.38], [sx * 0.93, 1.04, -2.15]), 'dark');
    }
    // The splitter under the nose, a slot between the intakes, the engine's grille across the tail, and the wing (its trailing edge up).
    add(lampBox([1.62, 0.03, 0.3], [0, h.floor(N - 0.29) + 0.015, N - 0.14]), 'dark');
    add(lampBox([0.34, 0.06, 0.05], [0, 0.3, N - 0.005]), 'dark');
    add(lampBox([1.12, 0.14, 0.04], [0, 0.48, T - 0.005]), 'dark');
    add(lampBox([1.86, 0.035, 0.34], [0, 1.085, -2.15], [0.12, 0, 0]), 'dark');
    // The big intakes behind the doors, ahead of the rear arches.
    intake([[-0.36, 0.74], [-0.98, 0.79], [-0.98, 0.57], [-0.56, 0.62]]);
  } else {
    for (const sx of [-1, 1]) {
      // Long headlights swept back over the front fenders, round tail lights two a side.
      heads.push(boxLamp([0.44, 0.04, 0.13], [sx * 0.66, h.crest(1.95) + 0.014, 1.95], [slope(h.crest, 1.95), sx * 0.42, 0]));
      for (const off of [0.3, 0.6]) tails.push(roundLamp(0.075, [sx * off, 0.64, T - 0.01]));
      backs.push(boxLamp([0.14, 0.05, 0.04], [sx * 0.45, 0.5, T - 0.01]));
      // Intakes either side of the grille, the badge on each front fender, two exhausts a side.
      add(lampBox([0.17, 0.1, 0.05], [sx * 0.59, 0.26, N - 0.01]), 'dark');
      add(lampBox([0.015, 0.11, 0.09], [sx * (flank(h, 0.82, 0.64) + 0.005), 0.64, 0.82]), 'badge');
      for (const dx of [0.32, 0.48]) {
        add(new THREE.CylinderGeometry(0.052, 0.052, 0.14, 12).rotateX(Math.PI / 2).translate(sx * dx, 0.3, T - 0.03), 'metal');
        add(new THREE.CylinderGeometry(0.036, 0.036, 0.02, 12).rotateX(Math.PI / 2).translate(sx * dx, 0.3, T - 0.1), 'dark');
      }
    }
    // The grille, the splitter, the badge on the nose, a vent between the tail lights and the ducktail's lip.
    add(lampBox([1.0, 0.15, 0.05], [0, 0.29, N - 0.01]), 'dark');
    add(lampBox([1.5, 0.025, 0.22], [0, h.floor(N - 0.22) + 0.0125, N - 0.11]), 'dark');
    add(lampBox([0.1, 0.12, 0.03], [0, 0.46, N - 0.04]), 'badge');
    add(lampBox([0.86, 0.07, 0.03], [0, 0.5, T - 0.005]), 'dark');
    add(lampBox([1.5, 0.035, 0.17], [0, h.crest(-2.2) + 0.02, -2.2], [0.25, 0, 0]), 'paint');
    // Scallops into the flanks ahead of the rear arches.
    intake([[-0.42, 0.64], [-0.96, 0.69], [-0.96, 0.5], [-0.62, 0.53]]);
  }
  const lens = (list: Lamp[], color: string) => list.map((l) => colored(l.geo, color));
  const lit = new THREE.Mesh(mergeGeometries([...lens(heads, '#fff6c9'), ...lens(tails, '#7d1622'), ...lens(backs, '#8d93a0')])!, unlit);
  lit.castShadow = false;

  // A stretched Ferrari's wheels grow with its body, so they still fill its arches.
  const size = fit?.y ?? 1;
  const wheel = (a: Axle, sx: number) => {
    const w = new THREE.Group();
    // The tire, its shoulders rounded, with enough sides that its flat bottom is down on the road, not a few millimetres up.
    const ri = a.r * 0.7, t = a.tread;
    const profile = [[ri, -t], [a.r - 0.035, -t], [a.r, 0.035 - t], [a.r, t - 0.035], [a.r - 0.035, t], [ri, t]].map(([x, y]) => new THREE.Vector2(x, y));
    w.add(mesh(new THREE.LatheGeometry(profile, 24).rotateZ(Math.PI / 2), tire));
    // The rim: dark set in behind five spokes, its lip round them.
    for (const s of [-1, 1]) {
      w.add(mesh(new THREE.CircleGeometry(ri, 16).rotateY((s * Math.PI) / 2).translate(s * (t - 0.025), 0, 0), mats.dark));
      w.add(mesh(new THREE.RingGeometry(ri * 0.84, ri, 16).rotateY((s * Math.PI) / 2).translate(s * (t - 0.02), 0, 0), rim));
    }
    for (let i = 0; i < 5; i++) w.add(mesh(new THREE.BoxGeometry(t * 2 - 0.035, ri * 0.92, 0.065).translate(0, ri * 0.46, 0).rotateX((i * 2 * Math.PI) / 5), rim));
    const spin = packed(w, true);
    const pivot = new THREE.Group();
    pivot.position.set(sx * a.x * (fit?.x ?? 1), a.r * size, a.z * (fit?.z ?? 1));
    pivot.scale.setScalar(size);
    pivot.userData.radius = a.r * size;
    // Over the tire, its arch's roof is this far up.
    pivot.userData.clear = (a.arch - a.r) * size;
    pivot.userData.tread = t * size;
    pivot.userData.front = a.z > 0;
    pivot.add(spin);
    return pivot;
  };
  const wheels: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) for (const a of h.axles) wheels.push(wheel(a, sx));

  // Roof off: a windshield up from the hood, a dark tub, bucket seats, and a wheel in front of the driver.
  const open = new THREE.Group();
  const glassUp = new THREE.Group();
  if (fit) glassUp.scale.copy(fit);
  open.add(glassUp);
  const z0 = c.to, y0 = h.crest(z0), z1 = c.to - (c.to - c.roofTo) * 0.4, y1 = c.top(z1);
  const pane = mesh(new THREE.BoxGeometry(c.belt(z1) * 2 - 0.06, 0.03, Math.hypot(z1 - z0, y1 - y0)), mats.glass, 0, (y0 + y1) / 2, (z0 + z1) / 2);
  pane.rotation.x = Math.atan2(y1 - y0, z0 - z1);
  glassUp.add(pane);
  const tub = [c.roofFrom - 0.2, c.to - 0.25];
  glassUp.add(mesh(lampBox([c.belt(-0.4) * 2 - 0.12, 0.02, tub[1] - tub[0]], [0, (h.mid(tub[0]) + h.mid(tub[1])) / 2 + 0.012, (tub[0] + tub[1]) / 2], [-Math.atan2(h.mid(tub[1]) - h.mid(tub[0]), tub[1] - tub[0]), 0, 0]), mats.dark));
  // The seats where their riders sit (seatOffset), not stretched: one, in the middle, in a single-seater.
  for (const seat of spec.seats < 2 ? (['driver'] as const) : (['driver', 'passenger'] as const)) {
    const s = seatOffset(kind, seat);
    const back = mesh(new THREE.BoxGeometry(0.5, 0.6, 0.1), mats.dark, s.x, 0.95, s.z - 0.34);
    back.rotation.x = -0.18;
    open.add(back, mesh(new THREE.BoxGeometry(0.5, 0.1, 0.52), mats.dark, s.x, 0.5, s.z));
  }
  const driver = seatOffset(kind, 'driver');
  const hoop = mesh(new THREE.TorusGeometry(0.16, 0.028, 6, 18), mats.dark, driver.x, 0.98, driver.z + 0.5);
  hoop.rotation.x = -0.45;
  open.add(hoop);

  const root = new THREE.Group();
  const top = packed(closed);
  const shell = packed(g, true);
  const tailGlow = overlay(tails.map((l) => l.glow), '#ff2d3f');
  const reverse = overlay(backs.map((l) => l.glow), '#ffffff');
  const headGlow = overlay(heads.map((l) => l.glow), '#fff4d6');
  for (const part of fit ? [shell, lit, top, tailGlow, reverse, headGlow] : []) part.scale.copy(fit!);
  const inside = packed(open);
  inside.visible = false;
  const bodyGroup = new THREE.Group();
  // A car's springs move its body, not its wheels: the tires stay on the road (only a bike's wheels lean with it).
  bodyGroup.add(shell, lit, top, inside, tailGlow, reverse, headGlow);
  root.add(bodyGroup, ...wheels);
  return { root, body: bodyGroup, top, open: inside, wheels, steer: STEER, tails: tailGlow, reverse, heads: headGlow, half: spec.width / 2 };
}

/** `geo` with `color` in its vertices (for `unlit`), and no uvs, so it merges with the others. */
function colored(geo: THREE.BufferGeometry, color: string): THREE.BufferGeometry {
  geo.deleteAttribute('uv');
  const c = new THREE.Color(color);
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3).map((_, i) => [c.r, c.g, c.b][i % 3]), 3));
  return geo;
}

const unlit = new THREE.MeshBasicMaterial({ vertexColors: true });

/** Boxes in the colors given, as one geometry with its colors in its vertices (for `unlit`). */
function lamps(boxes: { at: readonly number[]; size: [number, number, number]; color: string }[]): THREE.BufferGeometry | null {
  if (!boxes.length) return null;
  return mergeGeometries(boxes.map(({ at, size, color }) => colored(lampBox(size, at), color)))!;
}

/** Triangles wholly above `belt` (the cabin: pillars, glass and roof) and the rest, sharing the vertices. */
function cut(geo: THREE.BufferGeometry, belt: number): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const y = geo.attributes.position;
  const idx = geo.index!;
  const low: number[] = [], high: number[] = [];
  for (let i = 0; i < idx.count; i += 3) {
    const t = [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)];
    const ys = t.map((v) => y.getY(v));
    (Math.min(...ys) > belt - 0.02 && (ys[0] + ys[1] + ys[2]) / 3 > belt + 0.05 ? high : low).push(...t);
  }
  const part = (list: number[]) => {
    const g = new THREE.BufferGeometry();
    for (const [k, a] of Object.entries(geo.attributes)) g.setAttribute(k, a);
    g.setIndex(list);
    return g;
  };
  return [part(low), part(high)];
}

/**
 * One of Kenney's cars (client/world/carkit.ts), its paint in `color`. Off comes the cabin when somebody
 * gets in (a single-seater's open already): a dark floor where it was, and seats and a wheel.
 */
function kitCar(kind: CarKind, m: KitModel, color: string): CarModel {
  const spec = SPECS[kind];
  const mat = kitMaterial();
  let paint: THREE.BufferGeometry | null = null;
  if (m.paint) {
    paint = m.paint.clone();
    const c = new THREE.Color(color);
    const col = paint.attributes.color;
    for (let i = 0; i < col.count; i++) col.setXYZ(i, col.getX(i) * c.r, col.getY(i) * c.g, col.getZ(i) * c.b);
  }
  const whole = paint ? mergeGeometries([m.body, paint])! : m.body.clone();
  const single = spec.seats < 2;
  const [low, high] = single ? [whole, new THREE.BufferGeometry()] : cut(whole, m.belt);
  const top = new THREE.Group();
  if (!single) top.add(mesh(high, mat));

  const open = new THREE.Group();
  const dark = toon('#2b2d42');
  const seatColor = toon('#d8cbb3');
  const inside = new THREE.Group();
  const [z0, z1] = m.cabin;
  if (!single) inside.add(mesh(new THREE.BoxGeometry(m.width - 0.4, 0.06, Math.max(0.5, z1 - z0 - 0.2)), dark, 0, m.belt - 0.06, (z0 + z1) / 2, false));
  const hips = seatHips(kind);
  for (const seat of single ? (['driver'] as const) : (['driver', 'passenger'] as const)) {
    const s = seatOffset(kind, seat);
    if (!single) {
      const back = mesh(new THREE.BoxGeometry(0.5, 0.6, 0.1), seatColor, s.x, hips + 0.45, s.z - 0.34, false);
      back.rotation.x = -0.18;
      inside.add(back, mesh(new THREE.BoxGeometry(0.5, 0.1, 0.52), seatColor, s.x, hips + 0.05, s.z, false));
    }
    if (seat === 'driver') {
      const hoop = mesh(new THREE.TorusGeometry(0.16, 0.028, 6, 18), dark, s.x, hips + 0.53, s.z + 0.5, false);
      hoop.rotation.x = -0.45;
      inside.add(hoop);
    }
  }
  open.add(packed(inside));
  open.visible = false;

  const lights = new THREE.Group();
  // The tail lights' lenses are dark red: `tails` lights them up.
  const glow = lamps([
    ...m.head.map((at) => ({ at, size: [0.34, 0.14, 0.05] as [number, number, number], color: '#fff6c9' })),
    ...m.tail.map((at) => ({ at, size: [0.3, 0.12, 0.05] as [number, number, number], color: '#7d1622' })),
  ]);
  if (glow) lights.add(mesh(glow, unlit, 0, 0, 0, false));
  // The roof lights go with the roof.
  const bar = lamps(m.beacons.map((b) => ({ at: b.at, size: [0.22, 0.14, 0.2], color: b.color === 'red' ? '#ff2d3f' : '#3d7bff' })));
  if (bar) (single ? lights : top).add(mesh(bar, unlit, 0, 0, 0, false));

  m.wheel.computeBoundingBox();
  const tread = m.wheel.boundingBox ? Math.max(-m.wheel.boundingBox.min.x, m.wheel.boundingBox.max.x) : 0;
  const wheels = m.hubs.map((h) => {
    const tyre = mesh(m.wheel, mat);
    // The model's wheel is a right-hand one: turned round for the left.
    if (h.x > 0) tyre.rotation.y = Math.PI;
    const spin = new THREE.Group();
    spin.add(tyre);
    const pivot = new THREE.Group();
    pivot.position.set(h.x, h.y, h.z);
    pivot.userData.front = h.front;
    pivot.userData.radius = m.radius;
    pivot.userData.clear = m.clear;
    pivot.userData.tread = tread;
    pivot.add(spin);
    return pivot;
  });
  // Lit over the tail lights, and reversing lamps just inboard of them.
  const tails = overlay(m.tail.map((at) => lampBox([0.32, 0.14, 0.07], at)), '#ff2d3f');
  const reverse = overlay(m.tail.map((at) => lampBox([0.12, 0.1, 0.07], [at[0] - Math.sign(at[0]) * 0.24, at[1], at[2]])), '#ffffff');
  const heads = overlay(m.head.map((at) => lampBox([0.36, 0.16, 0.07], at)), '#fff4d6');

  const body = new THREE.Group();
  body.add(mesh(low, mat), lights, top, open, tails, reverse, heads);
  const root = new THREE.Group();
  root.add(body, ...wheels);
  return { root, body, top, open, wheels, steer: m.steer, tails, reverse, heads, half: Math.max(spec.width / 2, ...m.hubs.map((h) => Math.abs(h.x) + tread)) };
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
  // The tire's tube, fat on a motorbike: its outside edge is `radius` round the hub, and enough sides round that its flats aren't up off the road either.
  const tread = motor ? 0.065 : 0.025;
  for (const z of [-axle, axle]) {
    const bits = new THREE.Group();
    bits.add(mesh(new THREE.TorusGeometry(radius - tread, tread, 6, 32).rotateY(Math.PI / 2), dark));
    bits.add(mesh(new THREE.TorusGeometry(radius - tread * 2, 0.015, 4, 20).rotateY(Math.PI / 2), metal));
    for (let i = 0; i < 8; i++) {
      const spoke = mesh(new THREE.BoxGeometry(0.025, radius * 1.7, 0.015), metal);
      spoke.rotation.x = i * Math.PI / 8;
      bits.add(spoke);
    }
    const pivot = new THREE.Group();
    pivot.position.set(0, radius, z);
    pivot.userData.front = z > 0;
    pivot.userData.radius = radius;
    pivot.add(packed(bits, true));
    wheels.push(pivot);
  }
  const lights = new THREE.Group();
  lights.add(mesh(new THREE.BoxGeometry(0.16, 0.12, 0.06), toon('#fff6c9', { emissive: '#b8a960' }), 0, 0.98, axle - 0.12, false));
  lights.add(mesh(new THREE.BoxGeometry(0.14, 0.06, 0.04), toon('#a3202c', { emissive: '#3a0008' }), 0, 0.74, -axle, false));
  const tails = overlay([lampBox([0.16, 0.08, 0.06], [0, 0.74, -axle])], '#ff2d3f');
  const heads = overlay([lampBox([0.18, 0.14, 0.08], [0, 0.98, axle - 0.12])], '#fff4d6');
  const pedals = new THREE.Group();
  if (!motor) {
    const bits = new THREE.Group();
    bits.add(mesh(new THREE.BoxGeometry(0.36, 0.035, 0.035), metal));
    for (const sx of [-1, 1]) bits.add(mesh(new THREE.BoxGeometry(0.11, 0.035, 0.1), dark, sx * 0.2, sx * 0.14));
    pedals.position.set(0, 0.3, -0.08);
    pedals.add(packed(bits));
  }
  // Wheels and cranks are in the body group too, so the whole bike leans as one about the ground line.
  body.add(packed(parts, true), mergeByMaterial(lights), tails, heads, ...wheels, pedals);
  root.add(body);
  return { root, body, top: new THREE.Group(), open: new THREE.Group(), wheels, steer: STEER_OPEN, tails, reverse: new THREE.Group(), heads, pedals, half: spec.width / 2 };
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
  /**
   * Someone else's driving: how far it's drawn from where it should be by now (its driver's last word,
   * carried on), which dies away; and when that word came (the office's `at`).
   */
  err: { x: number; z: number; rotY: number };
  heard: number;
  /** On the boost (its driver's word, or your own): flames out of the exhausts. */
  boosting: boolean;
  flames: THREE.Object3D;
  /** Which way it was facing last frame, and how fast it's been speeding up (m/s², eased): for its body and its brake lights. */
  lastRotY: number;
  accel: number;
  /** How hard it'd be slowing just rolling, where it is (m/s², eased as `accel` is, so the two keep step). */
  rolling: number;
  /** How much longer (s) its brake lights stay on, so they don't flicker. */
  braked: number;
  /** Its headlights' light on the road ahead, after dark with someone in it. */
  beam: THREE.Object3D;
}

/**
 * Soft patches flat on the ground, as one geometry with how dark each is in its vertices' alpha: each
 * [x, z, w, d, alpha] darkest in its middle and fading out to nothing over its outer `soft` metres (nine
 * quads, the outside of the ring clear), so no texture's needed.
 */
export function patches(list: [x: number, z: number, w: number, d: number, alpha: number][], soft: number): THREE.BufferGeometry {
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  for (const [x, z, w, d, a] of list) {
    const fx = Math.min(soft, w * 0.45), fz = Math.min(soft, d * 0.45);
    const xs = [-w / 2, -w / 2 + fx, w / 2 - fx, w / 2], zs = [-d / 2, -d / 2 + fz, d / 2 - fz, d / 2];
    const base = pos.length / 3;
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      pos.push(x + xs[i], 0, z + zs[j]);
      col.push(1, 1, 1, i % 3 && j % 3 ? a : 0);
    }
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
      const q = base + j * 4 + i;
      idx.push(q, q + 4, q + 1, q + 1, q + 4, q + 5);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  geo.setIndex(idx);
  return geo;
}

/**
 * Contact shadows: dark on the road under a car, darker under each tire. Not lit, out of the outline pass,
 * drawn over the ground (nudged toward the camera) without hiding what's on it. Whatever the sun's
 * shadows are doing (or not, out of their reach), the car sits on the road.
 */
export const SHADE = new THREE.MeshBasicMaterial({ color: '#1a1424', vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
SHADE.userData.outlineParameters = { visible: false };

/** A car's contact shadows, `width` by `length`, with a patch under each of its wheels (x, z). */
export function groundShadow(width: number, length: number, wheels: { x: number; z: number }[], bike = false): THREE.BufferGeometry {
  return patches([[0, 0, width + 0.25, length + 0.1, 0.6], ...wheels.map((w) => [w.x, w.z, bike ? 0.3 : 0.5, bike ? 0.7 : 0.85, 0.9] as [number, number, number, number, number])], 0.3);
}

/** Headlights on the road ahead: from the bumper, two lobes widening and fading out 20 m on. Additive, faded in after dark (Fleet.lamps). */
const BEAM = new THREE.MeshBasicMaterial({ color: '#ffe7b0', vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
BEAM.userData.outlineParameters = { visible: false };
let pool: THREE.BufferGeometry | null = null;
function lightPool(): THREE.BufferGeometry {
  if (pool) return pool;
  const rows: [z: number, half: number, a: number][] = [[0, 0.8, 0.2], [2.5, 1.3, 0.8], [7, 2.4, 0.6], [13, 3.6, 0.25], [20, 4.6, 0]];
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  // Five across: clear at the edges, the two lamps' lobes either side of a slightly dimmer middle.
  const across: [u: number, a: number][] = [[-1, 0], [-0.5, 1], [0, 0.8], [0.5, 1], [1, 0]];
  rows.forEach(([z, half, a], j) => {
    for (const [u, b] of across) {
      pos.push(u * half, 0, z);
      col.push(1, 1, 1, a * b);
    }
    if (j) for (let i = 0; i < 4; i++) {
      const q = (j - 1) * 5 + i;
      idx.push(q, q + 5, q + 1, q + 1, q + 5, q + 6);
    }
  });
  pool = new THREE.BufferGeometry();
  pool.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  pool.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  pool.setIndex(idx);
  return pool;
}

/** Boost flames, flickering out the back: a hot core in a longer orange glow, one per exhaust (a bike's one). */
const FLAME = {
  core: new THREE.MeshBasicMaterial({ color: '#fff1a8', transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
  glow: new THREE.MeshBasicMaterial({ color: '#ff6a1a', transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }),
};
for (const m of Object.values(FLAME)) m.userData.outlineParameters = { visible: false };
const coneBack = (r: number, len: number) => new THREE.ConeGeometry(r, len, 10, 1, true).translate(0, -len / 2, 0).rotateX(Math.PI / 2);

function flames(kind: CarKind): THREE.Object3D {
  const spec = SPECS[kind];
  const out = new THREE.Group();
  const bike = spec.width < 1;
  for (const x of bike ? [-0.25] : [-0.4, 0.4]) {
    const f = new THREE.Group();
    f.position.set(x, bike ? 0.32 : 0.3, -spec.length / 2 - 0.02);
    f.add(new THREE.Mesh(coneBack(0.13, 0.9), FLAME.glow), new THREE.Mesh(coneBack(0.07, 0.5), FLAME.core));
    out.add(f);
  }
  out.visible = false;
  return out;
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

/**
 * How far a car's body goes on its springs, at most: pitch (rad, + nose down, braking), roll (rad, + its
 * left side up, turning left) and bob (m, the road under it). See springs.
 */
export const BODY = { pitch: 0.04, roll: 0.06, bob: 0.006 };
const center = new THREE.Vector3();
const arch = new THREE.Vector3();

/**
 * Sets a car's body on its springs: turned about the middle of the car at its axles' height, and bobbed;
 * then, if that would bring an arch down onto its tire (by more than the gap over it, the wheel's
 * `clear`), lifted so it doesn't. A hard stop dives the nose as far as its arches let it, then raises
 * the tail; the tires never show through the fenders. (A bike leans instead: see Fleet.animate.)
 */
export function springs(m: CarModel, pitch: number, roll: number, bob: number) {
  m.body.rotation.set(pitch, 0, roll);
  center.set(0, m.wheels[0]?.position.y ?? 0, 0);
  const lift = liftFor(m.wheels.map((w) => ({ ...w.position, ...(w.userData as { radius: number; clear?: number; tread?: number }) })), m.body.rotation, center, bob);
  m.body.position.copy(center).sub(arch.copy(center).applyEuler(m.body.rotation));
  m.body.position.y += bob + lift;
}

/**
 * How far a body turned `turn` about `center` and bobbed `bob` must be lifted so that the arch over no
 * wheel comes down on its tire by more than the gap over it (`clear`; checked over the tire's outside
 * edge, `tread` out from its hub, which a roll brings down furthest). Traffic's bodies too (streetlife.ts).
 */
export function liftFor(wheels: { x: number; y: number; z: number; radius: number; clear?: number; tread?: number }[], turn: THREE.Euler, at: THREE.Vector3, bob: number): number {
  let lift = 0;
  for (const w of wheels) {
    const top = w.y + w.radius;
    arch.set(w.x + Math.sign(w.x) * (w.tread ?? 0), top, w.z).sub(at).applyEuler(turn).add(at);
    lift = Math.max(lift, top - arch.y - bob - (w.clear ?? Infinity));
  }
  return lift;
}

/** The pedals of a car left to roll: what it'd slow down by without the brakes, to tell when it's braking. */
const ROLLING: Pedals = { gas: 0, turn: 0, brake: false };
/** Tail lights: driven after dark, and braking (brighter). */
export const TAIL_NIGHT = new THREE.Color('#c0121e');
export const TAIL_BRAKE = new THREE.Color('#ff1626');

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
  /** How dark it is, for headlights and tail lights: the sky's lampsOn (0 by day, 1 at night). */
  lamps = 0;
  /**
   * What's under the cars and what it does to them, as their drivers drive them (shared/garage.ts
   * drive): the city's surface, unless the place says otherwise (the circuit's grass, which bogs a car
   * down: main.ts). It's how a car slows just rolling where it is, so the grass or the sand dragging at
   * it isn't taken for braking.
   */
  course: { surfaceAt?(x: number, z: number): Surface; surface?(p: CarPose, dt: number): CarPose } = {};
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
      const fire = flames(def.kind);
      model.body.add(fire);
      // On the ground under it, not on its body: flat on the road however the body moves.
      const spec = SPECS[def.kind];
      const bike = spec.width < 1;
      const shade = new THREE.Mesh(groundShadow(spec.width, spec.length, model.wheels.map((w) => w.position), bike), SHADE);
      shade.position.y = 0.012;
      shade.renderOrder = 1;
      const beam = new THREE.Mesh(lightPool(), BEAM);
      beam.position.set(0, 0.02, spec.length / 2);
      beam.scale.x = bike ? 0.5 : 1;
      beam.visible = false;
      model.root.add(shade, beam);
      const view: CarView = { ...model, index, def, pose: { x: def.x, z: def.z, rotY: def.rotY, speed: 0, steer: 0 }, occupied: false, lastSpeed: 0, spin: 0, pedalPhase: 0, colliders, interactable, boosting: false, flames: fire, err: { x: 0, z: 0, rotY: 0 }, heard: -1, lastRotY: def.rotY, accel: 0, rolling: 0, braked: 0, beam };
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
    BEAM.opacity = 0.4 * this.lamps;
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
      // Word of where it's got to: what we drew it off by from there is the error to smooth away (a long way off, it jumps there).
      const e = v.err;
      if ((at[v.index] ?? -1) !== v.heard) {
        v.heard = at[v.index] ?? -1;
        e.x = p.x - x;
        e.z = p.z - z;
        e.rotY = Math.atan2(Math.sin(p.rotY - c.rotY), Math.cos(p.rotY - c.rotY));
        if (Math.hypot(e.x, e.z) > 8 + Math.abs(c.speed) * 0.25) e.x = e.z = e.rotY = 0;
      }
      const fade = 1 - k;
      e.x *= fade;
      e.z *= fade;
      e.rotY *= fade;
      p.x = x + e.x;
      p.z = z + e.z;
      p.rotY = c.rotY + e.rotY;
      p.speed = c.speed;
      p.slip = c.slip ?? 0;
      p.steer += (c.steer - p.steer) * k;
      v.boosting = !!c.boost && !!c.driver;
      this.show(v);
    }
  }

  /** Every car straight to where the office says it is, not smoothed: a floor's cars as you arrive on it. */
  snap(cars: CarState[]) {
    for (const v of this.cars) {
      const c = cars[v.index];
      if (!c) continue;
      Object.assign(v.pose, { x: c.x, z: c.z, rotY: c.rotY, speed: c.speed, steer: c.steer, slip: c.slip ?? 0, yaw: 0 });
      Object.assign(v.err, { x: 0, z: 0, rotY: 0 });
      this.show(v);
    }
  }

  /** Puts car `i` at `pose` (your own driving). */
  place(i: number, pose: CarPose) {
    const v = this.cars[i];
    if (!v) return;
    Object.assign(v.pose, pose, { slip: pose.slip ?? 0, yaw: pose.yaw ?? 0 });
    Object.assign(v.err, { x: 0, z: 0, rotY: 0 });
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
    const out: Box[] = [];
    for (const c of this.all) {
      // Not the ground itself (the lawn, the lots), nor anything overhead; the cars come next, whole.
      if (this.vehicleBoxes.has(c) || (c.bottom ?? 0) > this.street + 1 || c.top < this.street + 0.3) continue;
      out.push(c);
    }
    // Every other car as it's turned, with its mass and motion (where its driver last said: you keep clear of that).
    for (const v of this.cars) {
      if (v.index === except) continue;
      // Where it is by its driver's word (carried on), not the smoothed drawing of it.
      const p = { ...v.pose, x: v.pose.x - v.err.x, z: v.pose.z - v.err.z, rotY: v.pose.rotY - v.err.rotY };
      const hx = v.half, hz = SPECS[v.def.kind].length / 2;
      const s = Math.abs(Math.sin(p.rotY)), c = Math.abs(Math.cos(p.rotY));
      const ex = c * hx + s * hz, ez = s * hx + c * hz;
      out.push({ minX: p.x - ex, maxX: p.x + ex, minZ: p.z - ez, maxZ: p.z + ez, rotY: p.rotY, hx, hz, mass: SPECS[v.def.kind].mass,
        vx: Math.sin(p.rotY) * p.speed + Math.cos(p.rotY) * (p.slip ?? 0),
        vz: Math.cos(p.rotY) * p.speed - Math.sin(p.rotY) * (p.slip ?? 0) });
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

  /** Wheels travel with the car, while its springs let the body pitch and roll a little; and its lights. */
  private animate(v: CarView, dt: number) {
    const p = v.pose, spec = SPECS[v.def.kind];
    const k = 1 - Math.exp(-dt * 10);
    const acceleration = dt > 0 ? THREE.MathUtils.clamp((p.speed - v.lastSpeed) / dt, -20, 8) : 0;
    // How fast it's swinging round (rad/s): from its own turning, so a drift (or someone else's car) leans the way it's really going.
    const yaw = dt > 0 ? Math.atan2(Math.sin(p.rotY - v.lastRotY), Math.cos(p.rotY - v.lastRotY)) / dt : 0;
    v.lastSpeed = p.speed;
    v.lastRotY = p.rotY;
    v.accel += (acceleration - v.accel) * k;
    v.spin += p.speed * dt;
    v.pedalPhase += p.speed * dt / 1.8;
    for (const w of v.wheels) {
      w.rotation.y = w.userData.front ? THREE.MathUtils.clamp(p.steer, -v.steer, v.steer) : 0;
      w.children[0].rotation.x = v.spin / w.userData.radius;
    }
    if (spec.width < 1) {
      v.body.rotation.z += (-leanAngle(p, v.def.kind) - v.body.rotation.z) * k;
      v.body.rotation.x -= v.body.rotation.x * k;
      v.body.position.set(0, 0, 0);
    } else {
      // Out of a turn (sideways, speed times how fast it's swinging round) it rolls; under braking the nose dives; the road jiggles it a little.
      const roll = THREE.MathUtils.clamp(p.speed * yaw * 0.005, -BODY.roll, BODY.roll);
      const pitch = THREE.MathUtils.clamp(-acceleration * 0.0025, -BODY.pitch, BODY.pitch);
      const bob = Math.sin(v.spin * 0.9) * BODY.bob * Math.min(1, Math.abs(p.speed) / 4);
      springs(v, v.body.rotation.x + (pitch - v.body.rotation.x) * k, v.body.rotation.z + (roll - v.body.rotation.z) * k, bob);
    }
    if (v.pedals) v.pedals.rotation.x = v.pedalPhase;
    v.flames.visible = v.boosting;
    if (v.boosting) for (const f of v.flames.children) f.scale.set(1, 1, 0.75 + Math.random() * 0.5);
    // Slowing down faster than it would just rolling, there on that ground: it's braking (and the lights stay on a moment, so they don't flicker).
    const rolled = drive(p, ROLLING, DRIVE_STEP, v.def.kind, (this.course.surfaceAt ?? surfaceAt)(p.x, p.z));
    const coasted = this.course.surface ? this.course.surface(rolled, DRIVE_STEP) : rolled;
    v.rolling += ((Math.abs(p.speed) - Math.abs(coasted.speed)) / DRIVE_STEP - v.rolling) * k;
    v.braked = Math.abs(p.speed) > 0.5 && -Math.sign(p.speed) * v.accel > v.rolling + 3 ? 0.3 : Math.max(0, v.braked - dt);
    v.tails.visible = v.braked > 0 || (v.occupied && this.lamps > 0.3);
    v.tails.material.color.copy(v.braked > 0 ? TAIL_BRAKE : TAIL_NIGHT);
    v.reverse.visible = p.speed < -0.3;
    v.beam.visible = v.occupied && this.lamps > 0.02;
    v.heads.visible = v.beam.visible;
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
    for (const w of v.wheels) w.rotation.y = w.userData.front ? THREE.MathUtils.clamp(p.steer, -v.steer, v.steer) : 0;
    const s = Math.abs(Math.sin(p.rotY));
    const c = Math.abs(Math.cos(p.rotY));
    // Wheels and all: an open-wheeler's tires are as solid as its body.
    const hx = v.half;
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
