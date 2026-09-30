import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PERIOD, RADIUS, ROAD_W, STREET_X, STREET_Z, WALK, rng } from '../../shared/city';
import { HAIR_COLORS, SKIN_TONES } from '../../shared/avatar';
import type { Box } from '../../shared/garage';
import type { NightParts } from './outside';
import { decorTicker } from '../quality';
import { toonVertex } from './toon';

// The city's street life, down at ground level: traffic that keeps to its lane, turns at the corners and
// waits at red lights, and people on the sidewalks who cross when the walk sign says so, stop to look in a
// window or chat, and jump out of the way of a car. Everything is instanced (a mesh per kind of vehicle and
// per part of a person, each part a single draw call) and moves by matrices, so 40 vehicles and 80 people
// cost 13 draw calls. Only what's near you (SPAWN_R) exists: what you drive away from is put down somewhere
// ahead of you. Everything is in city coordinates, the ones the streets of shared/city.ts are laid out in,
// with the street at y = 0.

export const MAX_VEHICLES = 40;
export const MAX_PEOPLE = 80;
/** Things appear within this far of you (never closer than SPAWN_MIN, so nothing pops in at your feet) and go past CULL_R. */
export const SPAWN_R = 150;
const SPAWN_MIN = 90;
const CULL_R = 175;
/** What's within this far of you is updated every frame; the rest at the decor rate (quality.ts). */
const NEAR_R = 60;

const LANE = ROAD_W / 4;
/** How far the road's edge is from the street's middle, and the middle of the sidewalk. */
const CURB = ROAD_W / 2;
const WALK_OFF = CURB + WALK / 2;
/** Where a car stops for a light: this far from the middle of the crossing. */
const STOP = CURB + 1.2;

const ACC = 3.2;
const BRAKE = 7;
const MIN_GAP = 2.2;
const HEADWAY = 0.8;
const LOOK = 30;
const TURN_SPEED = 5;

export type Axis = 'x' | 'z';
export type Dir = 1 | -1;
export type Turn = 'straight' | 'right' | 'left';

/** The same numbers every time for the same inputs: what makes routes agree from page to page. */
export const roll = (...n: number[]): number => rng(n.reduce((h, x) => Math.imul(h ^ (x | 0), 0x9e3779b1) >>> 0, 0x811c9dc5))();

// --- The grid --------------------------------------------------------------------------------------------

/** Where the streets are along an axis (the crossings a traveller meets), and where the streets that run along it are. */
const alongO = (a: Axis) => (a === 'x' ? STREET_X : STREET_Z);
const lineO = (a: Axis) => (a === 'x' ? STREET_Z : STREET_X);
const other = (a: Axis): Axis => (a === 'x' ? 'z' : 'x');
export const crossAt = (origin: number, k: number) => origin + PERIOD * k;
/** The first and last street of the city along an axis. */
export const crossRange = (origin: number): [number, number] => [Math.ceil((-RADIUS - origin) / PERIOD), Math.floor((RADIUS - origin) / PERIOD)];
/** The index of the next street ahead of `s` going `dir` (one you're standing on doesn't count). */
export function nextCrossing(s: number, dir: Dir, origin: number): number {
  const k = (s - origin) / PERIOD;
  return dir > 0 ? Math.floor(k + 1e-6) + 1 : Math.ceil(k - 1e-6) - 1;
}
/** A crossing by which street it is either way: x = STREET_X + PERIOD·ix, z = STREET_Z + PERIOD·iz. */
export interface Crossing {
  ix: number;
  iz: number;
}
/** The crossing at index `k` along a road that runs along `axis` on street `line`. */
const crossingOf = (axis: Axis, line: number, k: number): Crossing => (axis === 'x' ? { ix: k, iz: line } : { ix: line, iz: k });
/** Which side of the road's middle a lane is on: right-hand traffic, so the right of the way you're facing. */
export const laneOffset = (axis: Axis, dir: Dir) => (axis === 'x' ? dir * LANE : -dir * LANE);
/** The way a thing facing along `axis` in `dir` is turned (0 is +z, as garage.ts rotY). */
const yawOf = (axis: Axis, dir: Dir) => (axis === 'x' ? (dir * Math.PI) / 2 : dir > 0 ? 0 : Math.PI);

// --- Traffic lights --------------------------------------------------------------------------------------

/** What a crossing's lights say: which way has the green, how far into it, and whether people going that way may start crossing. */
export interface Light {
  green: Axis;
  stage: 'green' | 'amber' | 'red';
  walk: boolean;
}
const GREEN = 12;
const AMBER = 2;
const CLEAR = 1;
const HALF = GREEN + AMBER + CLEAR;
const CYCLE = HALF * 2;
/** People may set off in the first WALK_T seconds of a green, which leaves the rest of it (and the red for the cross street) to get over. */
const WALK_T = 6;

/**
 * The lights at a crossing at time `t` (s, shared by everyone): each crossing has its own offset so they don't all change together.
 */
// ponytail: local stand-in for shared/city.ts lightPhase (WS-A); same idea, swap it for that one when it lands.
export function lightPhase(t: number, at: Crossing): Light {
  const u = (((t + roll(at.ix, at.iz, 77) * CYCLE) % CYCLE) + CYCLE) % CYCLE;
  const v = u % HALF;
  return { green: u < HALF ? 'x' : 'z', stage: v < GREEN ? 'green' : v < GREEN + AMBER ? 'amber' : 'red', walk: v < WALK_T };
}

/** Whether traffic going along `axis` has a green. */
export const canGo = (axis: Axis, l: Light) => l.green === axis && l.stage === 'green';
/** Whether a person walking along `axis` may start across (the street they cross is the one that has its red). */
export const canWalk = (axis: Axis, l: Light) => l.green === axis && l.walk;

/** Whether a car `dist` (m) from the stop line at speed `v` should stop for these lights: on a red or an amber it can stop for, not once it's over the line. */
export function stopForLight(l: Light, axis: Axis, dist: number, v: number): boolean {
  if (canGo(axis, l)) return false;
  if (dist < -0.5) return false;
  if (l.green === axis && l.stage === 'amber') return dist >= (v * v) / (2 * BRAKE);
  return true;
}

// --- Driving ---------------------------------------------------------------------------------------------

/** A road: along `axis`, going `dir`, on street number `line` of the streets that run that way. */
export interface Road {
  axis: Axis;
  dir: Dir;
  line: number;
}

/**
 * Which way to go at crossing `k` of road `r`, given a roll `u` in [0, 1): mostly straight on, sometimes right
 * or left, never off the edge of the city.
 */
export function route(r: Road, k: number, u: number): { turn: Turn; to: Road } {
  const [dx, dz] = r.axis === 'x' ? [r.dir, 0] : [0, r.dir];
  const opts: { turn: Turn; to: Road; w: number }[] = [];
  const range = (a: Axis) => crossRange(alongO(a));
  // Straight on needs another street ahead to reach.
  const next = k + r.dir;
  const [lo, hi] = range(r.axis);
  if (next >= lo && next <= hi) opts.push({ turn: 'straight', to: r, w: 0.6 });
  // A turn goes down street k, and needs another crossing ahead along it, from where we were.
  for (const [turn, hx, hz] of [['right', -dz, dx], ['left', dz, -dx]] as [Turn, number, number][]) {
    const a = other(r.axis);
    const dir: Dir = (a === 'x' ? hx : hz) > 0 ? 1 : -1;
    const [alo, ahi] = range(a);
    const ahead = r.line + dir;
    if (ahead >= alo && ahead <= ahi) opts.push({ turn, to: { axis: a, dir, line: k }, w: 0.2 });
  }
  let pick = u * opts.reduce((n, o) => n + o.w, 0);
  for (const o of opts) if ((pick -= o.w) < 0) return o;
  return opts[opts.length - 1];
}

/** How fast (m/s) it's safe to go with `gap` metres to something that's going `vAhead`: room to stop in, with a gap kept by the second. */
export function safeSpeed(gap: number, vAhead: number, vmax: number): number {
  const room = gap - MIN_GAP - HEADWAY * vAhead;
  if (room <= 0) return 0;
  return Math.min(vmax, Math.sqrt(vAhead * vAhead + 2 * BRAKE * 0.7 * room));
}

/** Something flat on the ground with a way it's facing: the middle, `yaw` (0 is +z), and length and width. */
export interface Body {
  x: number;
  z: number;
  yaw: number;
  len: number;
  wid: number;
}

/** How far it is (bumper to bumper) to `o` if it's in the way of `me` ahead, or null when it's beside, behind or too far. */
export function gapAhead(me: Body, o: Body): number | null {
  const dx = o.x - me.x;
  const dz = o.z - me.z;
  const f = dx * Math.sin(me.yaw) + dz * Math.cos(me.yaw);
  if (f <= 0 || f > LOOK) return null;
  const l = dx * Math.cos(me.yaw) - dz * Math.sin(me.yaw);
  const d = Math.abs(Math.cos(o.yaw - me.yaw));
  const s = Math.sqrt(1 - d * d);
  // How far `o` reaches along and across my way, whichever way it's turned.
  const along = (d * o.len + s * o.wid) / 2;
  const across = (d * o.wid + s * o.len) / 2;
  if (Math.abs(l) > me.wid / 2 + across + 0.4) return null;
  return f - me.len / 2 - along;
}

/** Whether `me` gives way to `o`, which is in front of it: queue behind, a left turn gives way to what's coming (two of them, the higher number does), whoever's already in the crossing goes first, then the lower number. */
export function yieldsTo(me: { id: number; yaw: number; left: boolean; stuck: number; inside: boolean }, o: { id: number; yaw: number; v: number; left: boolean; inside: boolean }): boolean {
  // Stuck for good, two waiting on each other: go.
  if (me.stuck > 10) return false;
  const c = Math.cos(o.yaw - me.yaw);
  if (c > 0.5) return true;
  // Whoever's in the crossing already has it.
  if (me.inside !== o.inside) return o.inside;
  if (c < -0.5) return me.left && (!o.left || o.id < me.id);
  return o.v > 1 && o.id < me.id;
}

/** Whether two cars going through a crossing at once would cross paths: not if they're going the same way, only if one's turning left across oncoming, or they're on different streets. */
export function conflicts(a: { yaw: number; turn: Turn }, b: { yaw: number; turn: Turn }): boolean {
  const c = Math.cos(a.yaw - b.yaw);
  if (c > 0.5) return false;
  return c < -0.5 ? a.turn === 'left' || b.turn === 'left' : true;
}

/** Which way a person at `p` jumps to get out of the way of `c` (going (vx, vz) m/s), as a unit vector, or null if it isn't coming their way. */
export function dodge(p: { x: number; z: number }, c: { x: number; z: number; vx: number; vz: number }): { x: number; z: number } | null {
  const sp2 = c.vx * c.vx + c.vz * c.vz;
  if (sp2 < 9) return null;
  const rx = p.x - c.x;
  const rz = p.z - c.z;
  const tc = (rx * c.vx + rz * c.vz) / sp2;
  if (tc < 0 || tc > 1.6) return null;
  const cx = rx - c.vx * tc;
  const cz = rz - c.vz * tc;
  if (Math.hypot(cx, cz) > 2.4) return null;
  const sp = Math.sqrt(sp2);
  // Sideways, to the side they're already on.
  let px = -c.vz / sp;
  let pz = c.vx / sp;
  if (px * cx + pz * cz < 0) {
    px = -px;
    pz = -pz;
  }
  return { x: px, z: pz };
}

// --- The models ------------------------------------------------------------------------------------------

type Part = [geo: THREE.BufferGeometry, color: string];

/** Parts, each its own color painted into its vertices, as one geometry (paint tints whatever's white). */
function merged(parts: Part[]): THREE.BufferGeometry {
  const geos = parts.map(([g, c]) => {
    const geo = g.index ? g.toNonIndexed() : g;
    geo.deleteAttribute('uv');
    const n = geo.attributes.position.count;
    const rgb = new Float32Array(n * 3);
    const col = new THREE.Color(c);
    for (let i = 0; i < n; i++) col.toArray(rgb, i * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
    return geo;
  });
  return mergeGeometries(geos)!;
}

const W = '#ffffff';
const GLASS = '#243447';
const TYRE = '#1b1b1f';
const TRIM = '#3a3d45';
const box = (w: number, h: number, d: number, x: number, y: number, z: number, c = W): Part => [new THREE.BoxGeometry(w, h, d).translate(x, y, z), c];
const ball = (r: number, x: number, y: number, z: number, c: string, sy = 1): Part => [new THREE.SphereGeometry(r, 10, 8).scale(1, sy, 1).translate(x, y, z), c];
const tyre = (x: number, y: number, z: number, r: number, w: number): Part => [new THREE.CylinderGeometry(r, r, w, 10).rotateZ(Math.PI / 2).translate(x, y, z), TYRE];
/** Four wheels (or the pairs given), the nose is +z. */
const wheels = (halfW: number, zs: number[], r: number): Part[] => zs.flatMap((z) => [tyre(halfW, r, z, r, 0.26), tyre(-halfW, r, z, r, 0.26)]);
/** A person in the saddle: shirt, skin, and a helmet or hat. */
const rider = (y: number, z: number, shirt: string, hat: string): Part[] => [box(0.34, 0.5, 0.24, 0, y + 0.3, z, shirt), ball(0.16, 0, y + 0.78, z, '#f1c27d'), ball(0.18, 0, y + 0.84, z, hat, 0.7)];

export type VKind = 'sedan' | 'taxi' | 'van' | 'bus' | 'truck' | 'moto' | 'bike';

interface Spec {
  len: number;
  wid: number;
  vmax: number;
  /** How many of the MAX_VEHICLES are this kind. */
  count: number;
  /** Where its lights sit: height, and width of the strip. */
  lamp: [y: number, w: number];
  paints: string[];
  parts: () => Part[];
}

const CAR_PAINTS = ['#ef476f', '#ffd166', '#06d6a0', '#118ab2', '#f4f1de', '#3d405b', '#e07a5f', '#8ecae6', '#9d4edd', '#ff8fab'];
const PALE = ['#ffffff', '#f4f1de', '#ffd9a8', '#cfe8ff'];

function sedan(taxi: boolean): Part[] {
  return [
    box(1.85, 0.62, 4.4, 0, 0.62, 0),
    box(1.6, 0.5, 2.3, 0, 1.18, -0.25),
    box(1.66, 0.28, 2.36, 0, 1.22, -0.2, GLASS),
    box(1.5, 0.08, 2.0, 0, 1.46, -0.25),
    box(1.8, 0.2, 0.1, 0, 0.36, 2.2, TRIM),
    box(1.8, 0.2, 0.1, 0, 0.36, -2.2, TRIM),
    ...(taxi ? [box(0.6, 0.16, 0.3, 0, 1.62, -0.2, '#fff3a0')] : []),
    ...wheels(0.92, [1.4, -1.4], 0.34),
  ];
}

const SPECS: Record<VKind, Spec> = {
  sedan: { len: 4.4, wid: 1.85, vmax: 13, count: 14, lamp: [0.65, 1.4], paints: CAR_PAINTS, parts: () => sedan(false) },
  taxi: { len: 4.4, wid: 1.85, vmax: 14, count: 5, lamp: [0.65, 1.4], paints: ['#ffcf1f'], parts: () => sedan(true) },
  van: {
    len: 5,
    wid: 2,
    vmax: 11,
    count: 5,
    lamp: [0.8, 1.6],
    paints: CAR_PAINTS,
    parts: () => [box(2, 1.55, 5, 0, 1.2, 0), box(2.04, 0.5, 1.3, 0, 1.65, 1.6, GLASS), box(2.04, 0.34, 3.2, 0, 1.75, -0.9, TRIM), box(1.9, 0.2, 0.1, 0, 0.42, 2.5, TRIM), ...wheels(0.95, [1.6, -1.6], 0.38)],
  },
  bus: {
    len: 10,
    wid: 2.5,
    vmax: 10,
    count: 3,
    lamp: [0.9, 2],
    paints: ['#ffb703', '#e63946', '#2a9d8f', '#4361ee'],
    parts: () => [box(2.5, 2.6, 10, 0, 1.7, 0), box(2.54, 0.9, 9.4, 0, 2.15, 0, GLASS), box(2.3, 0.3, 9.6, 0, 3.05, 0, W), box(1.6, 0.25, 3, 0, 3.15, -1, TRIM), box(2.6, 0.3, 0.1, 0, 0.55, 5, TRIM), ...wheels(1.15, [3.4, -3], 0.5)],
  },
  truck: {
    len: 6.8,
    wid: 2.3,
    vmax: 10,
    count: 3,
    lamp: [0.8, 1.8],
    paints: PALE,
    parts: () => [box(2.2, 1.5, 1.9, 0, 1.15, 2.4, '#ff8a65'), box(2.24, 0.55, 0.8, 0, 1.65, 2.9, GLASS), box(2.3, 2.4, 4.6, 0, 1.85, -1.1), box(2.2, 0.2, 6.6, 0, 0.55, 0, TRIM), ...wheels(1.05, [2.5, -0.9, -2.3], 0.45)],
  },
  moto: { len: 2, wid: 0.7, vmax: 14, count: 4, lamp: [0.75, 0.3], paints: ['#ffffff', '#ffe9c9', '#d9f0ff', '#ffd6e0'], parts: () => [box(0.28, 0.36, 1.1, 0, 0.7, 0.1), tyre(0, 0.32, 0.7, 0.32, 0.12), tyre(0, 0.32, -0.7, 0.32, 0.12), box(0.1, 0.5, 0.1, 0, 0.75, 0.75, TRIM), ...rider(0.7, -0.1, '#e9c46a', '#e63946')] },
  bike: { len: 1.8, wid: 0.6, vmax: 5, count: 6, lamp: [0.8, 0.2], paints: ['#ffffff', '#ffe9c9', '#d9f0ff', '#ffd6e0'], parts: () => [box(0.06, 0.06, 0.9, 0, 0.62, 0), tyre(0, 0.34, 0.55, 0.34, 0.05), tyre(0, 0.34, -0.55, 0.34, 0.05), box(0.4, 0.05, 0.05, 0, 1.0, 0.45, TRIM), ...rider(0.55, -0.15, '#4361ee', '#ffd166')] },
};
const KINDS = Object.keys(SPECS) as VKind[];

const SHIRTS = ['#ef476f', '#ffd166', '#06d6a0', '#118ab2', '#f4f1de', '#e07a5f', '#9d4edd', '#8ecae6', '#ff8fab', '#3d405b'];
const PANTS = ['#3d405b', '#264653', '#5c4a3a', '#1d3557', '#6d6875', '#4a4e69'];

// --- The people and the traffic --------------------------------------------------------------------------

/** Where a car's headed at a crossing: worked out when it's on its way there (see route), carried out when it gets to the line. */
interface Plan {
  k: number;
  turn: Turn;
  to: Road;
}
/** The curve a car follows through a crossing: from where it entered, past the corner, to where it leaves. */
interface Path {
  p0: { x: number; z: number };
  c: { x: number; z: number };
  p1: { x: number; z: number };
  len: number;
  u: number;
  to: Road;
  turn: Turn;
}

export interface Vehicle extends Body {
  id: number;
  kind: VKind;
  paint: string;
  /** Whether it's out there (a recycled one waits until there's a place near you to put it). */
  on: boolean;
  /** m/s along its nose. */
  v: number;
  axis: Axis;
  dir: Dir;
  line: number;
  /** How far along the road it is (x or z). */
  s: number;
  path: Path | null;
  plan: Plan | null;
  braking: boolean;
  /** Stopped dead for this many more seconds (you hit it). */
  hold: number;
  /** How long it's sat waiting on another car. */
  stuck: number;
  seed: number;
  /** Which of the kind's instances, and of the lights' (2 each). */
  slot: number;
}

export type PedState = 'walk' | 'wait' | 'cross' | 'idle' | 'down';

export interface Pedestrian {
  id: number;
  on: boolean;
  state: PedState;
  /** Where they're standing (the walk itself; jumps and tumbles are on top of it, in dx and dz). */
  x: number;
  z: number;
  yaw: number;
  axis: Axis;
  dir: Dir;
  /** The street (index) they're on, and how far along (s) and across (lat) from its middle. */
  line: number;
  s: number;
  lat: number;
  /** Which side of the street (±1) and where the next stop is. */
  side: Dir;
  idleAt: number;
  /** The state that a tumble came out of. */
  prev: PedState;
  timer: number;
  speed: number;
  phase: number;
  /** How many decisions they've made; with `seed` it's what makes the next one. A pair share a seed, so they choose together. */
  n: number;
  seed: number;
  pair: number;
  /** Jumped or knocked out of place, and the way they're going, until they come back. */
  dx: number;
  dz: number;
  jx: number;
  jz: number;
  /** Airborne, and how far over on their back. */
  hop: number;
  tilt: number;
  cool: number;
  /** Colors (indexes) and height. */
  skin: number;
  hair: number;
  shirt: number;
  pants: number;
  h: number;
}

/** A car you're in (or anything else vehicles should keep clear of, and people jump from): where, and how it's going (m/s). */
export interface Avoid {
  x: number;
  z: number;
  vx: number;
  vz: number;
}

/** Something moving that you can bump into, and the way it's going (m/s). */
export interface Obstacle {
  box: Box;
  vx: number;
  vz: number;
}

export interface StreetLife {
  /** Put its y at the street's height, like the city's street group. */
  group: THREE.Group;
  /** `t` is shared time (s), `night` 0–1; `near` is where you are (what's far from it isn't kept up), `avoid` your car if you're in one (else it's you). */
  update(t: number, dt: number, night: number, near: { x: number; z: number }, avoid?: readonly Avoid[]): void;
  /** The moving vehicles within `reach` of (x, z), as boxes to collide with. */
  obstacles(x: number, z: number, reach: number): Obstacle[];
  /** Something of yours hit at `at` at `speed`: a person tumbles, a car stops. Says what it was (null: nothing there). */
  hit(at: { x: number; z: number }, speed: number): 'person' | 'car' | null;
  vehicles: readonly Vehicle[];
  people: readonly Pedestrian[];
}

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** A point on the curve p0 → c → p1 at u. */
const bez = (p: Path, u: number) => {
  const a = (1 - u) * (1 - u);
  const b = 2 * u * (1 - u);
  const c = u * u;
  return { x: a * p.p0.x + b * p.c.x + c * p.p1.x, z: a * p.p0.z + b * p.c.z + c * p.p1.z, dx: 2 * (1 - u) * (p.c.x - p.p0.x) + 2 * u * (p.p1.x - p.c.x), dz: 2 * (1 - u) * (p.c.z - p.p0.z) + 2 * u * (p.p1.z - p.c.z) };
};

/** Where a road's point `s` is in the world, in the lane going `dir` (or `off` from the street's middle). */
function onRoad(axis: Axis, line: number, s: number, off: number): { x: number; z: number } {
  const m = crossAt(lineO(axis), line) + off;
  return axis === 'x' ? { x: s, z: m } : { x: m, z: s };
}

export function buildStreetLife(_night?: NightParts): StreetLife {
  const group = new THREE.Group();
  const mat = toonVertex();

  // Vehicles: a mesh per kind, its instances being the slots that are that kind.
  const vehicles: Vehicle[] = [];
  const meshes = {} as Record<VKind, THREE.InstancedMesh>;
  for (const k of KINDS) {
    const m = new THREE.InstancedMesh(merged(SPECS[k].parts()), mat, SPECS[k].count);
    m.frustumCulled = false;
    m.castShadow = false;
    group.add((meshes[k] = m));
  }
  const filled = {} as Record<VKind, number>;
  for (const k of KINDS) filled[k] = 0;
  for (const k of KINDS) {
    for (let i = 0; i < SPECS[k].count; i++) {
      const id = vehicles.length;
      const r = rng(9000 + id);
      const paint = SPECS[k].paints[Math.floor(r() * SPECS[k].paints.length)];
      meshes[k].setColorAt(i, new THREE.Color(paint));
      vehicles.push({ id, kind: k, paint, on: false, v: 0, axis: 'x', dir: 1, line: 0, s: 0, path: null, plan: null, braking: false, hold: 0, stuck: 0, seed: id * 7919 + 13, slot: i, x: 0, z: 0, yaw: 0, len: SPECS[k].len, wid: SPECS[k].wid });
    }
  }
  // Their lights, all in one mesh: a head strip and a tail strip each.
  const lampMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  const lamps = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), lampMat, MAX_VEHICLES * 2);
  lamps.frustumCulled = false;
  group.add(lamps);
  const HEAD = new THREE.Color('#fff3c4');
  const TAIL = new THREE.Color();

  // People: a mesh per part (legs and arms are two instances a person), swung by their matrices.
  const solid = (g: THREE.BufferGeometry): THREE.BufferGeometry => merged([[g, W]]);
  const partMesh = (g: THREE.BufferGeometry, per: number) => {
    const m = new THREE.InstancedMesh(solid(g), mat, MAX_PEOPLE * per);
    m.frustumCulled = false;
    m.castShadow = false;
    group.add(m);
    return m;
  };
  const torso = partMesh(new THREE.CapsuleGeometry(0.2, 0.3, 4, 8).translate(0, 1.12, 0), 1);
  const head = partMesh(new THREE.SphereGeometry(0.19, 10, 8).translate(0, 1.65, 0), 1);
  const hairM = partMesh(new THREE.SphereGeometry(0.2, 10, 8).scale(1, 0.75, 1).translate(0, 1.72, -0.02), 1);
  const arms = partMesh(new THREE.BoxGeometry(0.11, 0.55, 0.12).translate(0, -0.25, 0), 2);
  const legs = partMesh(new THREE.BoxGeometry(0.17, 0.82, 0.19).translate(0, -0.41, 0), 2);
  const people: Pedestrian[] = [];
  const tmp = new THREE.Color();
  for (let i = 0; i < MAX_PEOPLE; i++) {
    const r = rng(4000 + i);
    // The first forty are twenty pairs, out together.
    const pair = i < 40 ? i ^ 1 : -1;
    const seed = 4000 + (pair >= 0 ? Math.min(i, pair) : i);
    const p: Pedestrian = { id: i, on: false, state: 'walk', x: 0, z: 0, yaw: 0, axis: 'x', dir: 1, line: 0, s: 0, lat: 0, side: 1, idleAt: NaN, prev: 'walk', timer: 0, speed: 1.4, phase: r() * 6, n: 0, seed, pair, dx: 0, dz: 0, jx: 0, jz: 0, hop: 0, tilt: 0, cool: 0, skin: Math.floor(r() * SKIN_TONES.length), hair: Math.floor(r() * HAIR_COLORS.length), shirt: Math.floor(r() * SHIRTS.length), pants: Math.floor(r() * PANTS.length), h: 0.92 + r() * 0.14 };
    people.push(p);
    torso.setColorAt(i, tmp.set(SHIRTS[p.shirt]));
    head.setColorAt(i, tmp.set(SKIN_TONES[p.skin]));
    // One in eight has no hair to show.
    hairM.setColorAt(i, tmp.set(r() < 0.125 ? SKIN_TONES[p.skin] : HAIR_COLORS[p.hair]));
    for (let a = 0; a < 2; a++) {
      arms.setColorAt(i * 2 + a, tmp.set(SHIRTS[p.shirt]));
      legs.setColorAt(i * 2 + a, tmp.set(PANTS[p.pants]));
    }
  }
  // People walking together walk at the same pace.
  for (const p of people) if (p.pair >= 0) p.speed = 1.15 + roll(p.seed, 5) * 0.5;
  for (const p of people) if (p.pair < 0) p.speed = 1.2 + roll(p.seed, 5) * 0.55;

  // --- Placing things -------------------------------------------------------------------------------------

  let epoch = 0;
  const others = (v: Vehicle, d: number) => vehicles.some((o) => o !== v && o.on && Math.hypot(o.x - v.x, o.z - v.z) < d);

  /** Puts `v` on some road between `minR` and `maxR` from `at`, and off any crossing: false if there's nowhere. */
  function place(v: Vehicle, at: { x: number; z: number }, minR: number, maxR: number): boolean {
    const r = rng(v.seed + ++epoch * 104729);
    for (let tries = 0; tries < 12; tries++) {
      const axis: Axis = r() < 0.5 ? 'x' : 'z';
      const dir: Dir = r() < 0.5 ? 1 : -1;
      const [lo, hi] = crossRange(lineO(axis));
      const lat = axis === 'x' ? at.z : at.x;
      const along = axis === 'x' ? at.x : at.z;
      const l0 = Math.max(lo, Math.ceil((lat - maxR - lineO(axis)) / PERIOD));
      const l1 = Math.min(hi, Math.floor((lat + maxR - lineO(axis)) / PERIOD));
      if (l1 < l0) continue;
      const line = l0 + Math.floor(r() * (l1 - l0 + 1));
      const [clo, chi] = crossRange(alongO(axis));
      let s = clamp(along + (r() * 2 - 1) * maxR, crossAt(alongO(axis), clo) + 9, crossAt(alongO(axis), chi) - 9);
      // Between crossings, not in one.
      const q = (((s - alongO(axis)) % PERIOD) + PERIOD) % PERIOD;
      s += clamp(q, 9, PERIOD - 9) - q;
      const at2 = onRoad(axis, line, s, laneOffset(axis, dir));
      const d = Math.hypot(at2.x - at.x, at2.z - at.z);
      if (d < minR || d > maxR) continue;
      Object.assign(v, { axis, dir, line, s, x: at2.x, z: at2.z, yaw: yawOf(axis, dir), v: SPECS[v.kind].vmax * 0.25 * (0.5 + r()), path: null, plan: null, hold: 0, stuck: 0, braking: false });
      if (others(v, 9)) continue;
      v.on = true;
      return true;
    }
    return false;
  }

  function placePerson(p: Pedestrian, at: { x: number; z: number }, minR: number, maxR: number): boolean {
    const r = rng(p.seed + ++epoch * 7919);
    for (let tries = 0; tries < 12; tries++) {
      const axis: Axis = r() < 0.5 ? 'x' : 'z';
      const dir: Dir = r() < 0.5 ? 1 : -1;
      const side: Dir = r() < 0.5 ? 1 : -1;
      const [lo, hi] = crossRange(lineO(axis));
      const lat = axis === 'x' ? at.z : at.x;
      const along = axis === 'x' ? at.x : at.z;
      const l0 = Math.max(lo, Math.ceil((lat - maxR - lineO(axis)) / PERIOD));
      const l1 = Math.min(hi, Math.floor((lat + maxR - lineO(axis)) / PERIOD));
      if (l1 < l0) continue;
      const line = l0 + Math.floor(r() * (l1 - l0 + 1));
      const [clo, chi] = crossRange(alongO(axis));
      let s = clamp(along + (r() * 2 - 1) * maxR, crossAt(alongO(axis), clo) + CURB + 2, crossAt(alongO(axis), chi) - CURB - 2);
      const q = (((s - alongO(axis)) % PERIOD) + PERIOD) % PERIOD;
      s += clamp(q, CURB + 2, PERIOD - CURB - 2) - q;
      const w = onRoad(axis, line, s, side * WALK_OFF);
      const d = Math.hypot(w.x - at.x, w.z - at.z);
      if (d < minR || d > maxR) continue;
      for (const q of [p, p.pair === p.id + 1 ? people[p.pair] : null]) {
        if (!q) continue;
        // A pair side by side, a stride apart across the sidewalk.
        const off = q === p ? -0.45 : 0.45;
        Object.assign(q, { axis, dir, side, line, s, lat: side * WALK_OFF + off, on: true, state: 'walk', timer: 0, dx: 0, dz: 0, jx: 0, jz: 0, hop: 0, tilt: 0, cool: 0, n: 0 });
        q.yaw = yawOf(axis, dir);
        schedule(q);
        ground(q);
      }
      return true;
    }
    return false;
  }

  /** Where they'll stop for a look in a window, maybe. */
  function schedule(p: Pedestrian) {
    p.idleAt = roll(p.seed, p.n++, 1) < 0.35 ? p.s + p.dir * (4 + roll(p.seed, p.n, 2) * 30) : NaN;
  }
  function ground(p: Pedestrian) {
    const w = onRoad(p.axis, p.line, p.s, p.lat);
    p.x = w.x;
    p.z = w.z;
  }

  // --- Stepping -------------------------------------------------------------------------------------------

  const avoidBody = (a: Avoid): Body => ({ x: a.x, z: a.z, yaw: 0, len: 3, wid: 3 });

  function stepVehicle(v: Vehicle, dt: number, t: number, avoidBodies: Body[]) {
    const K = SPECS[v.kind];
    v.hold = Math.max(0, v.hold - dt);
    let target = K.vmax;
    let carAhead = false;
    let plan: Plan | null = null;
    if (v.path) target = Math.min(target, TURN_SPEED);
    else {
      const o = alongO(v.axis);
      const k = nextCrossing(v.s, v.dir, o);
      const c = crossingOf(v.axis, v.line, k);
      plan = v.plan?.k === k ? v.plan : (v.plan = { k, ...route({ axis: v.axis, dir: v.dir, line: v.line }, k, roll(v.seed, c.ix, c.iz)) });
      const dist = (crossAt(o, k) - v.s) * v.dir - STOP - v.len / 2;
      if (dist < 14 && plan.turn !== 'straight') target = Math.min(target, TURN_SPEED + 2);
      const light = lightPhase(t, c);
      let hold = stopForLight(light, v.axis, dist, v.v);
      let path: Path | null = null;
      if (!hold && dist < 20) {
        // Not into the crossing unless there's room the far side to clear it, and nobody's in it going across us: stop at the line as for a red.
        path = pathThrough(v, plan, k);
        const hy = yawOf(path.to.axis, path.to.dir);
        const blocked = vehicles.some((o) => {
          if (o === v || !o.on) return false;
          const dx = o.x - path!.p1.x;
          const dz = o.z - path!.p1.z;
          const along = dx * Math.sin(hy) + dz * Math.cos(hy);
          return along > -2 && along < (v.len + o.len) / 2 + 2.5 && Math.abs(dx * Math.cos(hy) - dz * Math.sin(hy)) < (v.wid + o.wid) / 2 + 0.3;
        });
        const mid = { x: crossAt(STREET_X, c.ix), z: crossAt(STREET_Z, c.iz) };
        const crossed = vehicles.some((o) => o.path && Math.hypot(o.x - mid.x, o.z - mid.z) < CURB + 6 && conflicts({ yaw: v.yaw, turn: plan!.turn }, { yaw: o.yaw, turn: o.path.turn }));
        hold = blocked || crossed;
      }
      if (hold) target = Math.min(target, safeSpeed(dist + MIN_GAP, 0, K.vmax));
      else if (path && dist <= 0) v.path = path;
    }
    // Keep clear of what's ahead: cars (queue, give way), people crossing, and you.
    const me = { id: v.id, yaw: v.yaw, left: (v.path?.turn ?? plan?.turn) === 'left', stuck: v.stuck, inside: !!v.path };
    for (const o of vehicles) {
      if (o === v || !o.on) continue;
      const g = gapAhead(v, o);
      if (g === null || !yieldsTo(me, { id: o.id, yaw: o.yaw, v: o.v, left: (o.path?.turn ?? o.plan?.turn) === 'left', inside: !!o.path })) continue;
      const vo = Math.max(0, o.v * Math.cos(o.yaw - v.yaw));
      target = Math.min(target, safeSpeed(g, vo, K.vmax));
      carAhead = true;
    }
    for (const b of avoidBodies) {
      const g = gapAhead(v, b);
      if (g !== null) target = Math.min(target, safeSpeed(g, 0, K.vmax));
    }
    if (v.hold > 0) target = 0;
    v.stuck = v.v < 0.3 && carAhead ? v.stuck + dt : 0;
    v.braking = target < v.v - 0.3;
    v.v += clamp(target - v.v, -(BRAKE + 3) * dt, ACC * dt);
    if (v.path) {
      const p = v.path;
      p.u = Math.min(1, p.u + (v.v * dt) / p.len);
      const c = bez(p, p.u);
      v.x = c.x;
      v.z = c.z;
      v.yaw = Math.atan2(c.dx, c.dz);
      if (p.u >= 1) {
        v.axis = p.to.axis;
        v.dir = p.to.dir;
        v.line = p.to.line;
        v.s = v.axis === 'x' ? p.p1.x : p.p1.z;
        v.path = null;
        v.plan = null;
        v.yaw = yawOf(v.axis, v.dir);
      }
    } else {
      v.s += v.dir * v.v * dt;
      const w = onRoad(v.axis, v.line, v.s, laneOffset(v.axis, v.dir));
      v.x = w.x;
      v.z = w.z;
    }
  }

  /** At the line and cleared to go: the curve through the crossing. */
  function pathThrough(v: Vehicle, plan: Plan, k: number): Path {
    const c = crossingOf(v.axis, v.line, k);
    const mid = { x: crossAt(STREET_X, c.ix), z: crossAt(STREET_Z, c.iz) };
    const to = plan.to;
    const off = laneOffset(v.axis, v.dir);
    const noff = laneOffset(to.axis, to.dir);
    const p1 = to.axis === 'x' ? { x: mid.x + to.dir * CURB, z: mid.z + noff } : { x: mid.x + noff, z: mid.z + to.dir * CURB };
    const p0 = { x: v.x, z: v.z };
    const ctl = plan.turn === 'straight' ? { x: (p0.x + p1.x) / 2, z: (p0.z + p1.z) / 2 } : v.axis === 'x' ? { x: mid.x + noff, z: mid.z + off } : { x: mid.x + off, z: mid.z + noff };
    const len = (Math.hypot(ctl.x - p0.x, ctl.z - p0.z) + Math.hypot(p1.x - ctl.x, p1.z - ctl.z) + Math.hypot(p1.x - p0.x, p1.z - p0.z)) / 2;
    return { p0, c: ctl, p1, len: Math.max(1, len), u: 0, to, turn: plan.turn };
  }

  const walkers = (p: Pedestrian) => p.on && p.state !== 'down';

  function stepPerson(p: Pedestrian, dt: number, t: number, cars: Avoid[]) {
    p.cool = Math.max(0, p.cool - dt);
    // Tumbling: skid along, lie there, get up where they were.
    if (p.state === 'down') {
      p.timer += dt;
      const air = Math.min(1, p.timer / 0.7);
      p.hop = 0.9 * Math.sin(Math.PI * air);
      p.tilt = -(Math.PI / 2) * (p.timer < 0.35 ? p.timer / 0.35 : p.timer > 2.1 ? Math.max(0, (2.5 - p.timer) / 0.4) : 1);
      const fr = Math.exp(-2.2 * dt);
      p.jx *= fr;
      p.jz *= fr;
      p.dx += p.jx * dt;
      p.dz += p.jz * dt;
      if (p.timer >= 2.5) {
        p.state = p.prev;
        p.tilt = 0;
        p.hop = 0;
        p.timer = 0;
      }
      return;
    }
    // Jump from what's coming, once in a while.
    if (p.cool === 0) {
      for (const c of cars) {
        if (Math.abs(c.x - p.x) > 30 || Math.abs(c.z - p.z) > 30) continue;
        const d = dodge({ x: p.x + p.dx, z: p.z + p.dz }, c);
        if (d) {
          p.jx = d.x * 5;
          p.jz = d.z * 5;
          p.cool = 1.6;
          p.hop = 0.001;
          break;
        }
      }
    }
    if (p.hop > 0) {
      p.hop += dt;
      if (p.hop > 0.5) p.hop = 0;
      p.dx += p.jx * dt;
      p.dz += p.jz * dt;
      const fr = Math.exp(-4 * dt);
      p.jx *= fr;
      p.jz *= fr;
    } else {
      // Back to the walk, a little at a time.
      const back = Math.exp(-1.5 * dt);
      p.dx *= back;
      p.dz *= back;
    }
    const swing = p.state === 'walk' || p.state === 'cross';
    if (swing) p.phase += dt * p.speed * 4.6;
    const o = alongO(p.axis);
    if (p.state === 'walk') {
      p.s += p.dir * p.speed * dt;
      // A look in the window.
      if (!Number.isNaN(p.idleAt) && (p.s - p.idleAt) * p.dir >= 0) {
        p.state = 'idle';
        p.timer = 3 + roll(p.seed, p.n++, 3) * 5;
        p.idleAt = NaN;
      }
      const k = nextCrossing(p.s, p.dir, o);
      const [lo, hi] = crossRange(o);
      if (p.state !== 'walk') {
        // Stopped for a look.
      } else if (k < lo || k > hi) {
        // The edge of the city.
        if ((p.s - crossAt(o, p.dir > 0 ? hi : lo)) * p.dir > CURB + 2) p.dir = -p.dir as Dir;
      } else if ((crossAt(o, k) - p.s) * p.dir - CURB <= 0) {
        const u = roll(p.seed, p.n++, k, p.line);
        if (u < 0.55) p.state = 'wait';
        else if (u < 0.9) turnCorner(p, k);
        else {
          p.dir = -p.dir as Dir;
          schedule(p);
        }
      }
    } else if (p.state === 'wait') {
      const k = nextCrossing(p.s, p.dir, o);
      if (canWalk(p.axis, lightPhase(t, crossingOf(p.axis, p.line, k)))) p.state = 'cross';
    } else if (p.state === 'cross') {
      p.s += p.dir * 1.7 * dt;
      if ((p.s - crossAt(o, Math.round((p.s - o) / PERIOD))) * p.dir >= CURB + 0.2) {
        p.state = 'walk';
        schedule(p);
      }
    } else {
      p.timer -= dt;
      if (p.timer <= 0) {
        p.state = 'walk';
        schedule(p);
      }
    }
    ground(p);
    // Which way they face: where they're going, at a window the window, in a chat each other.
    let want = yawOf(p.axis, p.dir);
    if (p.state === 'idle') {
      const q = p.pair >= 0 ? people[p.pair] : null;
      want = q?.on ? Math.atan2(q.x - p.x, q.z - p.z) : yawOf(other(p.axis), p.side);
    }
    p.yaw += wrap(want - p.yaw) * Math.min(1, dt * 10);
  }

  /** At a corner: on down the cross street, away from the road they came to, not crossing anything. */
  function turnCorner(p: Pedestrian, k: number) {
    const side = Math.sign(p.lat) as Dir;
    const across = crossAt(lineO(p.axis), p.line) + p.lat;
    p.axis = other(p.axis);
    p.side = -p.dir as Dir;
    p.lat = p.side * WALK_OFF + (p.lat - side * WALK_OFF);
    p.s = across;
    p.dir = side;
    p.line = k;
    schedule(p);
  }

  // --- Frame ----------------------------------------------------------------------------------------------

  const tick = decorTicker();
  const M = new THREE.Matrix4();
  const P = new THREE.Matrix4();
  const T = new THREE.Matrix4();
  const R = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const qt = new THREE.Quaternion();
  const UP = new THREE.Vector3(0, 1, 0);
  const RIGHT = new THREE.Vector3(1, 0, 0);
  const pos = new THREE.Vector3();
  const sc = new THREE.Vector3();
  let started = false;

  function writeVehicle(v: Vehicle) {
    const m = meshes[v.kind];
    const hi = v.slot * 2;
    if (!v.on) {
      m.setMatrixAt(v.slot, ZERO);
      lamps.setMatrixAt(hi, ZERO);
      lamps.setMatrixAt(hi + 1, ZERO);
      return;
    }
    q.setFromAxisAngle(UP, v.yaw);
    P.compose(pos.set(v.x, 0, v.z), q, sc.set(1, 1, 1));
    m.setMatrixAt(v.slot, P);
    const [ly, lw] = SPECS[v.kind].lamp;
    for (const e of [1, -1]) {
      T.makeScale(lw, 0.16, 0.1).setPosition(0, ly, (e * (v.len + 0.02)) / 2);
      lamps.setMatrixAt(hi + (e > 0 ? 0 : 1), M.multiplyMatrices(P, T));
    }
  }

  function writePerson(p: Pedestrian) {
    const i = p.id;
    if (!p.on) {
      for (const [m, per] of [[torso, 1], [head, 1], [hairM, 1], [arms, 2], [legs, 2]] as [THREE.InstancedMesh, number][]) for (let a = 0; a < per; a++) m.setMatrixAt(i * per + a, ZERO);
      return;
    }
    const flail = p.state === 'down';
    // On their back the body's laid along the ground, a little up off it.
    q.setFromAxisAngle(UP, p.yaw).multiply(qt.setFromAxisAngle(RIGHT, p.tilt));
    P.compose(pos.set(p.x + p.dx, (flail ? p.hop : Math.sin((Math.PI * p.hop) / 0.5) * 0.45) + Math.abs(p.tilt) * 0.12, p.z + p.dz), q, sc.set(p.h, p.h, p.h));
    torso.setMatrixAt(i, P);
    head.setMatrixAt(i, P);
    hairM.setMatrixAt(i, P);
    const chat = p.state === 'idle';
    for (let a = 0; a < 2; a++) {
      const sd = a ? -1 : 1;
      const w = Math.sin(p.phase + (a ? Math.PI : 0));
      const leg = flail ? Math.sin(p.phase * 3 + a * 2) * 0.9 : w * 0.65;
      const arm = flail ? Math.sin(p.phase * 4 + a) * 1.4 : chat ? (a ? -1.1 + Math.sin(p.phase * 2) * 0.35 : 0.05) : -w * 0.7;
      M.multiplyMatrices(P, T.makeTranslation(sd * 0.12, 0.82, 0)).multiply(R.makeRotationX(leg));
      legs.setMatrixAt(i * 2 + a, M);
      M.multiplyMatrices(P, T.makeTranslation(sd * 0.28, 1.36, 0)).multiply(R.makeRotationX(arm));
      arms.setMatrixAt(i * 2 + a, M);
    }
  }

  const life: StreetLife = {
    group,
    vehicles,
    people,
    update(t, dt, night, near, avoid = []) {
      dt = Math.min(dt, 0.2);
      const far = Math.min(tick(dt), 0.25);
      // Lights are on all day but only show at night.
      lampMat.color.setScalar(0.7 + 0.3 * night);
      const keepClear: Body[] = (avoid.length ? avoid : [{ x: near.x, z: near.z, vx: 0, vz: 0 }]).map(avoidBody);
      const cars: Avoid[] = [...avoid];
      if (!started) {
        // First time: the streets are already busy.
        started = true;
        for (const v of vehicles) place(v, near, 15, SPAWN_R);
        for (const p of people) if (p.pair < 0 || p.id % 2 === 0) placePerson(p, near, 12, SPAWN_R);
      }
      for (const v of vehicles) {
        if (v.on && Math.hypot(v.x - near.x, v.z - near.z) > CULL_R) v.on = false;
        if (!v.on) place(v, near, SPAWN_MIN, SPAWN_R);
        if (!v.on) continue;
        if (v.v > 3) cars.push({ x: v.x, z: v.z, vx: Math.sin(v.yaw) * v.v, vz: Math.cos(v.yaw) * v.v });
        const step = Math.hypot(v.x - near.x, v.z - near.z) < NEAR_R ? dt : far;
        if (step > 0) stepVehicle(v, step, t, keepClear);
      }
      for (const p of people) {
        if (p.pair >= 0 && p.id % 2 === 1) continue;
        if (p.on && Math.hypot(p.x - near.x, p.z - near.z) > CULL_R) {
          p.on = false;
          if (p.pair >= 0) people[p.pair].on = false;
        }
        if (!p.on && !placePerson(p, near, SPAWN_MIN, SPAWN_R)) continue;
      }
      // Cars that are stopped or slow don't scare anyone; the ones going fast do.
      for (const p of people) {
        if (!p.on) continue;
        const step = Math.hypot(p.x - near.x, p.z - near.z) < NEAR_R ? dt : far;
        if (step > 0) stepPerson(p, step, t, cars);
      }
      for (const v of vehicles) writeVehicle(v);
      for (const v of vehicles) {
        lamps.setColorAt(v.slot * 2, HEAD);
        lamps.setColorAt(v.slot * 2 + 1, TAIL.set(v.braking ? '#ff3030' : night > 0.3 ? '#c81e1e' : '#8a2a2a'));
      }
      for (const p of people) writePerson(p);
      for (const m of [...KINDS.map((k) => meshes[k]), lamps, torso, head, hairM, arms, legs]) {
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
    },
    obstacles(x, z, reach) {
      const out: Obstacle[] = [];
      for (const v of vehicles) {
        if (!v.on || Math.abs(v.x - x) > reach + v.len || Math.abs(v.z - z) > reach + v.len) continue;
        const s = Math.abs(Math.sin(v.yaw));
        const c = Math.abs(Math.cos(v.yaw));
        const hx = (s * v.len + c * v.wid) / 2;
        const hz = (c * v.len + s * v.wid) / 2;
        out.push({ box: { minX: v.x - hx, maxX: v.x + hx, minZ: v.z - hz, maxZ: v.z + hz }, vx: Math.sin(v.yaw) * v.v, vz: Math.cos(v.yaw) * v.v });
      }
      return out;
    },
    hit(at, speed) {
      let best: Pedestrian | null = null;
      let bd = 2.4;
      for (const p of people) {
        if (!walkers(p)) continue;
        const d = Math.hypot(p.x + p.dx - at.x, p.z + p.dz - at.z);
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
      if (best) {
        const p = best;
        const d = Math.hypot(p.x + p.dx - at.x, p.z + p.dz - at.z) || 1;
        // Thrown away from the car, or wherever if it's right on them.
        const ax = d > 0.05 ? (p.x + p.dx - at.x) / d : Math.sin(roll(p.seed, p.n));
        const az = d > 0.05 ? (p.z + p.dz - at.z) / d : Math.cos(roll(p.seed, p.n));
        const sp = clamp(speed * 0.7, 3, 11);
        p.prev = p.state === 'idle' ? 'walk' : p.state;
        p.state = 'down';
        p.timer = 0;
        p.jx = ax * sp;
        p.jz = az * sp;
        p.hop = 0;
        return 'person';
      }
      for (const v of vehicles) {
        if (v.on && Math.hypot(v.x - at.x, v.z - at.z) < Math.max(v.len, v.wid) / 2 + 1.2) {
          v.hold = 2;
          v.v *= 0.3;
          return 'car';
        }
      }
      return null;
    },
  };
  return life;
}
