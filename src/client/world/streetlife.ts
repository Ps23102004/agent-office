import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PERIOD, RADIUS, ROAD_W, STREET_X, STREET_Z, WALK, cityLayout, citySolids, cityStreetscape, lightPhase as signals, rng } from '../../shared/city';
import { HAIR_COLORS, SKIN_TONES } from '../../shared/avatar';
import type { Box } from '../../shared/garage';
import type { NightParts } from './outside';
import { decorTicker } from '../quality';
import { toonVertex } from './toon';
import { CROWD, crowdMaterial, outlineMaterial, pickLook, type CrowdPart, type PedLook } from './crowd';
import { kitMaterial, kitModel, type KitName } from './carkit';

// The city's street life, down at ground level: traffic that keeps to its lane, turns at the corners and
// waits at red lights, and people on the sidewalks who cross when the walk sign says so, stop to look in a
// window or chat, and jump out of the way of a car. Everything is batched (all the vehicles one BatchedMesh,
// everyone on foot and their dogs another, see crowd.ts, each with its outline) and moves by matrices, so
// 40 vehicles and 80 people cost a handful of draw calls. Only what's near you (SPAWN_R) exists: what you drive away from is put down somewhere
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
/**
 * The lights at a crossing at time `t` (s, Date.now() / 1000 so everyone agrees): the same signals the
 * poles show (shared/city.ts lightPhase), as the traffic reads them.
 */
export function lightPhase(t: number, at: Crossing): Light {
  const p = signals(t, { i: at.ix, j: at.iz });
  const green: Axis = p.z !== 'red' ? 'z' : 'x';
  const stage = p[green] === 'yellow' ? 'amber' : p[green];
  return { green, stage, walk: green === 'x' ? p.walkX : p.walkZ };
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
/** A person in the saddle: shirt, skin, and a helmet or hat. */
const rider = (y: number, z: number, shirt: string, hat: string): Part[] => [box(0.34, 0.5, 0.24, 0, y + 0.3, z, shirt), ball(0.16, 0, y + 0.78, z, '#f1c27d'), ball(0.18, 0, y + 0.84, z, hat, 0.7)];

export type VKind =
  | 'sedan' | 'hatch' | 'sports' | 'suv' | 'suvlux' | 'taxi' | 'police' | 'van' | 'truck' | 'tow' | 'pickup'
  | 'bus' | 'garbage' | 'ambulance' | 'firetruck' | 'moto' | 'bike';

interface Spec {
  len: number;
  wid: number;
  vmax: number;
  /** How many of the MAX_VEHICLES are this kind. */
  count: number;
  /** The colors it comes in (its paint is tinted to one); for a Kenney model with none given, the paint it came in. */
  paints: string[];
  /** Its Kenney model (client/world/carkit.ts), if it has one. */
  model?: KitName;
  /** Built in code: the bus and the bikes, and any car while (or if) its model isn't in. No wheels, but a bike's. */
  parts: () => Part[];
  /** A bus's wheels (built in code, it has no model): where, and how big. */
  hubs?: [x: number, y: number, z: number][];
}

const CAR_PAINTS = ['#ef476f', '#ffd166', '#06d6a0', '#118ab2', '#f4f1de', '#3d405b', '#e07a5f', '#8ecae6', '#9d4edd', '#ff8fab', '#d62828', '#8d99ae'];
const PALE = ['#ffffff', '#f4f1de', '#ffd9a8', '#cfe8ff'];
const SMART = ['#2b2d42', '#f4f1de', '#3d405b', '#8d99ae', '#6c757d', '#1d3557'];

/** A car in code, in case its model never comes: a body and a cabin, nose to +z. */
function sedan(taxi: boolean): Part[] {
  return [
    box(1.85, 0.62, 4.4, 0, 0.62, 0),
    box(1.6, 0.5, 2.3, 0, 1.18, -0.25),
    box(1.66, 0.28, 2.36, 0, 1.22, -0.2, GLASS),
    box(1.5, 0.08, 2.0, 0, 1.46, -0.25),
    box(1.8, 0.2, 0.1, 0, 0.36, 2.2, TRIM),
    box(1.8, 0.2, 0.1, 0, 0.36, -2.2, TRIM),
    ...(taxi ? [box(0.6, 0.16, 0.3, 0, 1.62, -0.2, '#fff3a0')] : []),
  ];
}
const van = (): Part[] => [box(2, 1.55, 5, 0, 1.2, 0), box(2.04, 0.5, 1.3, 0, 1.65, 1.6, GLASS), box(2.04, 0.34, 3.2, 0, 1.75, -0.9, TRIM), box(1.9, 0.2, 0.1, 0, 0.42, 2.5, TRIM)];
const lorry = (): Part[] => [box(2.2, 1.5, 1.9, 0, 1.15, 2.4, '#ff8a65'), box(2.24, 0.55, 0.8, 0, 1.65, 2.9, GLASS), box(2.3, 2.4, 4.6, 0, 1.85, -1.1), box(2.2, 0.2, 6.6, 0, 0.55, 0, TRIM)];

// The street's mix: everyday cars mostly, a few vans and trucks, buses, bikes, and now and then a police
// car, an ambulance or a fire engine (their lights flash).
const SPECS: Record<VKind, Spec> = {
  sedan: { len: 4.35, wid: 2.03, vmax: 13, count: 7, paints: CAR_PAINTS, model: 'sedan', parts: () => sedan(false) },
  hatch: { len: 4.85, wid: 1.76, vmax: 13, count: 3, paints: CAR_PAINTS, model: 'hatchback-sports', parts: () => sedan(false) },
  sports: { len: 4.35, wid: 1.76, vmax: 15, count: 3, paints: ['#d62828', '#ffd166', '#06d6a0', '#118ab2', '#ff8fab', '#f4f1de'], model: 'sedan-sports', parts: () => sedan(false) },
  suv: { len: 4.6, wid: 2.03, vmax: 13, count: 5, paints: CAR_PAINTS, model: 'suv', parts: () => sedan(false) },
  suvlux: { len: 4.85, wid: 2.03, vmax: 13, count: 2, paints: SMART, model: 'suv-luxury', parts: () => sedan(false) },
  taxi: { len: 4.7, wid: 2.03, vmax: 14, count: 4, paints: [], model: 'taxi', parts: () => sedan(true) },
  police: { len: 5.3, wid: 2.03, vmax: 14, count: 1, paints: ['#ffffff'], model: 'police', parts: () => sedan(false) },
  van: { len: 4.7, wid: 2.03, vmax: 11, count: 3, paints: CAR_PAINTS, model: 'van', parts: van },
  truck: { len: 5.55, wid: 2.03, vmax: 10, count: 2, paints: PALE.concat(['#61cb8b', '#6794d9']), model: 'delivery', parts: lorry },
  tow: { len: 5.55, wid: 2.03, vmax: 10, count: 1, paints: [], model: 'delivery-flat', parts: lorry },
  pickup: { len: 5.05, wid: 2.03, vmax: 12, count: 2, paints: CAR_PAINTS, model: 'truck', parts: van },
  bus: {
    len: 10,
    wid: 2.5,
    vmax: 10,
    count: 2,
    paints: ['#ffb703', '#e63946', '#2a9d8f', '#4361ee'],
    parts: () => [box(2.5, 2.6, 10, 0, 1.7, 0), box(2.54, 0.9, 9.4, 0, 2.15, 0, GLASS), box(2.3, 0.3, 9.6, 0, 3.05, 0, W), box(1.6, 0.25, 3, 0, 3.15, -1, TRIM), box(2.6, 0.3, 0.1, 0, 0.55, 5, TRIM), box(2.2, 0.5, 0.06, 0, 2.95, 5.01, '#1b1b1f')],
    hubs: [[1.0, 0.5, 3.4], [-1.0, 0.5, 3.4], [1.0, 0.5, -3], [-1.0, 0.5, -3]],
  },
  garbage: { len: 5.9, wid: 2.16, vmax: 9, count: 1, paints: [], model: 'garbage-truck', parts: lorry },
  ambulance: { len: 5.55, wid: 2.03, vmax: 14, count: 1, paints: [], model: 'ambulance', parts: van },
  firetruck: { len: 5.8, wid: 2.03, vmax: 12, count: 1, paints: [], model: 'firetruck', parts: lorry },
  moto: { len: 2, wid: 0.7, vmax: 14, count: 3, paints: ['#ffffff', '#ffe9c9', '#d9f0ff', '#ffd6e0'], parts: () => [box(0.28, 0.36, 1.1, 0, 0.7, 0.1), tyre(0, 0.32, 0.7, 0.32, 0.12), tyre(0, 0.32, -0.7, 0.32, 0.12), box(0.1, 0.5, 0.1, 0, 0.75, 0.75, TRIM), ...rider(0.7, -0.1, '#e9c46a', '#e63946')] },
  bike: { len: 1.8, wid: 0.6, vmax: 5, count: 3, paints: ['#ffffff', '#ffe9c9', '#d9f0ff', '#ffd6e0'], parts: () => [box(0.06, 0.06, 0.9, 0, 0.62, 0), tyre(0, 0.34, 0.55, 0.34, 0.05), tyre(0, 0.34, -0.55, 0.34, 0.05), box(0.4, 0.05, 0.05, 0, 1.0, 0.45, TRIM), ...rider(0.55, -0.15, '#4361ee', '#ffd166')] },
};
const KINDS = Object.keys(SPECS) as VKind[];

type V3 = readonly number[];
/** How a kind is drawn: what keeps its colors, what's tinted its paint, its wheels and its lights. */
interface Look {
  body: THREE.BufferGeometry | null;
  paint: THREE.BufferGeometry | null;
  wheel: THREE.BufferGeometry | null;
  hubs: V3[];
  radius: number;
  /** Front axle to back (for how far the front wheels steer). */
  wheelbase: number;
  head: V3[];
  tail: V3[];
  beacons: { at: V3; color: 'red' | 'blue' }[];
  /** The paints it comes in. */
  paints: string[];
}

const codeWheels = new Map<number, THREE.BufferGeometry>();
/** A wheel in code (hub facing -x), for the bus, and for every car if the models aren't in. */
function wheelInCode(r: number): THREE.BufferGeometry {
  let g = codeWheels.get(r);
  if (!g) {
    g = merged([[new THREE.CylinderGeometry(r, r, 0.3, 18).rotateZ(Math.PI / 2).translate(-0.15, 0, 0), TYRE], [new THREE.CylinderGeometry(r * 0.55, r * 0.55, 0.32, 10).rotateZ(Math.PI / 2).translate(-0.16, 0, 0), '#c8ccd6']]);
    g.setIndex([...Array(g.attributes.position.count).keys()]);
    codeWheels.set(r, g);
  }
  return g;
}

let hullMat: THREE.MeshBasicMaterial | null = null;
/** The traffic's outline, as the page's OutlineEffect draws everyone else's: dark, its back faces pushed out a few pixels along their normals. */
function trafficOutline(): THREE.MeshBasicMaterial {
  if (hullMat) return hullMat;
  hullMat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(0.17, 0.18, 0.26), side: THREE.BackSide });
  hullMat.userData.outlineParameters = { visible: false };
  hullMat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      #ifdef USE_BATCHING
        vec4 outward = projectionMatrix * modelViewMatrix * batchingMatrix * vec4(transformed + normal, 1.0);
        gl_Position += normalize(outward - gl_Position) * 0.0032 * gl_Position.w;
      #endif`,
    );
  };
  return hullMat;
}

/** A kind's look: its Kenney model if that's in, else what's built in code (the bus's wheels included). */
function lookOf(k: VKind): Look {
  const look = lookIn(k);
  const zs = look.hubs.map((h) => h[2]);
  return { ...look, wheelbase: zs.length ? Math.max(...zs) - Math.min(...zs) : 1 };
}

function lookIn(k: VKind): Omit<Look, 'wheelbase'> {
  const spec = SPECS[k];
  const m = spec.model ? kitModel(spec.model) : null;
  if (m) {
    // One with no paint (the police car's black and white) is all "paint", tinted white.
    return { body: m.paint ? m.body : null, paint: m.paint ?? m.body, wheel: m.wheel, hubs: m.hubs.map((h) => [h.x, h.y, h.z]), radius: m.radius, head: m.head, tail: m.tail, beacons: m.beacons, paints: spec.paints.length || !m.paintColor ? spec.paints : [m.paintColor] };
  }
  const paint = merged(spec.parts());
  paint.setIndex([...Array(paint.attributes.position.count).keys()]);
  const bike = spec.wid < 1;
  const r = spec.hubs?.[0][1] ?? 0.36;
  const hx = spec.wid / 2 - 0.2, hz = spec.len / 2 - 0.9;
  const ends = (z: number, y: number): V3[] => (bike ? [[0, y, z]] : [[spec.wid / 2 - 0.3, y, z], [-(spec.wid / 2 - 0.3), y, z]]);
  return {
    body: null,
    paint,
    wheel: bike ? null : wheelInCode(r),
    hubs: bike ? [] : spec.hubs ?? [[hx, r, hz], [-hx, r, hz], [hx, r, -hz], [-hx, r, -hz]],
    radius: r,
    head: ends(spec.len / 2 + 0.02, bike ? 0.9 : 0.65),
    tail: ends(-spec.len / 2 - 0.02, bike ? 0.75 : 0.65),
    beacons: [],
    paints: spec.paints.length ? spec.paints : ['#ffcf1f'],
  };
}

const SHIRTS = ['#ef476f', '#ffd166', '#06d6a0', '#118ab2', '#f4f1de', '#e07a5f', '#9d4edd', '#8ecae6', '#ff8fab', '#3d405b'];
const PANTS = ['#3d405b', '#264653', '#5c4a3a', '#1d3557', '#6d6875', '#4a4e69'];
const COATS = ['#c8a27a', '#3d405b', '#6d6875', '#5a6b3a', '#8d2c2c', '#264653', '#e9e3d5'];
const GREYS = ['#d9d9d9', '#bdbdbd', '#f2f2f2', '#9e9e9e'];
/** Bare legs under a dress, or tights. */
const TIGHTS = ['#2b2d42', '#6d2e46'];
const DOG_COATS = ['#c68642', '#f1dcb7', '#4a3222', '#d9d9d9', '#e0a96d'];
/** Which of a person's instances in the crowd's BatchedMesh is which part (arms, hands and legs take two each). */
const SLOT = { top: 0, head: 1, hair: 2, hat: 3, carry: 4, arm: 5, hand: 7, leg: 9, dog: 11 } as const;
const SLOTS = 12;

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
  /** The ghost it follows (an index into ghostCars()), or -1, and how far round that ghost's loop it is. */
  gj: number;
  S: number;
  /** Its acceleration, eased (m/s²), and how it leans into braking and into a turn. */
  acc: number;
  pitch: number;
  roll: number;
}

export type PedState = 'walk' | 'wait' | 'cross' | 'idle' | 'sit' | 'door' | 'down';

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
  /** The ghost they follow (an index into ghostPeds()), or -1; how far round its ring they've got (m, lap on lap); the next stop they'll come to (counting laps too). */
  gj: number;
  R: number;
  stopN: number;
  /** At a stop: which, and how far they've gone to the door or bench (0–1). */
  at: Stop | null;
  dr: number;
  /** Which side of a pair they are (0 alone, else ±1). */
  pairSide: number;
  /** Their head's turn to the side, and their fidget (eased). */
  look: number;
  /** The state that a tumble came out of. */
  prev: PedState;
  timer: number;
  speed: number;
  phase: number;
  /** When to try for a ghost again. */
  retry: number;
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
  /** A dog on a lead, where it is. */
  dog: boolean;
  dogX: number;
  dogZ: number;
  dogYaw: number;
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
  update(t: number, dt: number, night: number, near: { x: number; z: number }, avoid?: readonly Avoid[], hour?: number): void;
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

// --- Shared days: everybody's routes are a function of the clock ---------------------------------------------
//
// Nothing out here is dealt out at random per page. There is a fixed population of ghosts, cars on
// rectangular loops of streets and people on rings of sidewalk, each with a seed: where a ghost is, and what
// it's doing, is a pure function of shared time (t, Date.now() / 1000) and the office's hour. The things
// you see are slots that pick up ghosts near you and follow them: a red light or a queue holds a car back,
// and it speeds up to catch its ghost afterwards, so two pages show the same street within a few metres.

/** The office's hour of the day (0–24) at shared time `t` (s), for a clock `offsetMin` minutes from UTC. */
export const hourAt = (t: number, offsetMin: number): number => ((((t / 3600 + offsetMin / 60) % 24) + 24) % 24);

const bump = (h: number, at: number, w: number) => {
  let d = Math.abs(h - at);
  d = Math.min(d, 24 - d);
  return Math.exp(-((d / w) ** 2));
};

/** How busy the roads are (0–1): rush hours either side of the working day, a lull at lunch, empty at night. */
export const trafficDensity = (hour: number): number => clamp(0.12 + 0.75 * bump(hour, 8.2, 1.4) + 0.85 * bump(hour, 17.6, 1.7) + 0.45 * bump(hour, 12.6, 2.4) + 0.25 * bump(hour, 21, 2), 0, 1);

export type Role = 'commuter' | 'lunch' | 'shopper' | 'evening' | 'jogger' | 'dog' | 'late';

/** How likely a person of this kind is to be out at `hour`: a day for each of them. */
export function activity(role: Role, hour: number): number {
  switch (role) {
    case 'commuter': return Math.max(bump(hour, 8.2, 1.3), bump(hour, 17.8, 1.5)) + 0.12 * bump(hour, 13, 3);
    case 'lunch': return bump(hour, 12.8, 1.1);
    case 'shopper': return 0.9 * bump(hour, 13.5, 3.4);
    case 'evening': return bump(hour, 20, 2.2);
    case 'jogger': return Math.max(bump(hour, 6.9, 1.1), bump(hour, 18.3, 1.3));
    case 'dog': return Math.max(bump(hour, 7.6, 1), bump(hour, 18, 1.6), 0.3 * bump(hour, 13, 2));
    case 'late': return 0.9 * bump(hour, 23.6, 2.4);
  }
}

/** A loop of streets a car goes round for ever: crossings ix a..b, iz c..d. `cw` goes +x first (right turns all the way), else +z first (lefts). */
export interface Loop {
  a: number;
  b: number;
  c: number;
  d: number;
  cw: boolean;
}
interface Side extends Road {
  from: number;
  to: number;
  len: number;
  start: number;
}
const sidesOf = (l: Loop): Side[] => {
  const raw: Omit<Side, 'len' | 'start'>[] = l.cw
    ? [{ axis: 'x', dir: 1, line: l.c, from: l.a, to: l.b }, { axis: 'z', dir: 1, line: l.b, from: l.c, to: l.d }, { axis: 'x', dir: -1, line: l.d, from: l.b, to: l.a }, { axis: 'z', dir: -1, line: l.a, from: l.d, to: l.c }]
    : [{ axis: 'z', dir: 1, line: l.a, from: l.c, to: l.d }, { axis: 'x', dir: 1, line: l.d, from: l.a, to: l.b }, { axis: 'z', dir: -1, line: l.b, from: l.d, to: l.c }, { axis: 'x', dir: -1, line: l.c, from: l.b, to: l.a }];
  let start = 0;
  return raw.map((r) => {
    const len = Math.abs(r.to - r.from) * PERIOD;
    const side = { ...r, len, start };
    start += len;
    return side;
  });
};
export const loopLength = (l: Loop) => 2 * (l.b - l.a + l.d - l.c) * PERIOD;

/** Where `S` metres round a loop is: which road, and how far along it (x or z). */
export function loopAt(l: Loop, S: number): Road & { s: number } {
  const P = loopLength(l);
  S = ((S % P) + P) % P;
  const sides = sidesOf(l);
  const side = sides.find((x) => S < x.start + x.len) ?? sides[3];
  return { axis: side.axis, dir: side.dir, line: side.line, s: crossAt(alongO(side.axis), side.from) + side.dir * (S - side.start) };
}

/** How far round the loop a car on this road at `s` is, or null if it isn't on the loop. */
export function loopProgress(l: Loop, r: Road, s: number): number | null {
  const side = sidesOf(l).find((x) => x.axis === r.axis && x.dir === r.dir && x.line === r.line);
  if (!side) return null;
  const off = (s - crossAt(alongO(side.axis), side.from)) * side.dir;
  return off < -1 || off > side.len + 1 ? null : side.start + clamp(off, 0, side.len);
}

/** Which way to go at crossing `k` of road `r` on a loop: on round it, turning at its corners; null if `r` isn't on it. */
export function loopRoute(l: Loop, r: Road, k: number): { turn: Turn; to: Road } | null {
  const sides = sidesOf(l);
  const i = sides.findIndex((x) => x.axis === r.axis && x.dir === r.dir && x.line === r.line);
  if (i < 0) return null;
  const side = sides[i];
  if (k !== side.to) return { turn: 'straight', to: r };
  const n = sides[(i + 1) % 4];
  const [dx, dz] = r.axis === 'x' ? [r.dir, 0] : [0, r.dir];
  const [nx, nz] = n.axis === 'x' ? [n.dir, 0] : [0, n.dir];
  const cross = dx * nz - dz * nx;
  return { turn: cross > 0 ? 'right' : 'left', to: { axis: n.axis, dir: n.dir, line: n.line } };
}

/** A car that's always out there: its kind, loop, where it was at time 0, and its cruising speed. */
export interface CarGhost {
  j: number;
  kind: VKind;
  loop: Loop;
  phase: number;
  speed: number;
  /** Out at all when the roads are this busy or more. */
  u: number;
}
export const CAR_GHOSTS = 200;
let carGhosts: CarGhost[] | null = null;
/** The kinds in a run of MAX_VEHICLES, so the ghosts have the mix the slots do. */
const KIND_RUN = (Object.keys(SPECS) as VKind[]).flatMap((k) => Array<VKind>(SPECS[k].count).fill(k));
export function ghostCars(): CarGhost[] {
  if (carGhosts) return carGhosts;
  const [xlo, xhi] = crossRange(STREET_X);
  const [zlo, zhi] = crossRange(STREET_Z);
  return (carGhosts = Array.from({ length: CAR_GHOSTS }, (_, j) => {
    const r = rng(31000 + j * 101);
    const kind = KIND_RUN[j % KIND_RUN.length];
    const w = 1 + Math.floor(r() * 3);
    const h = 1 + Math.floor(r() * 3);
    const a = xlo + Math.floor(r() * Math.max(1, xhi - xlo - w + 1));
    const c = zlo + Math.floor(r() * Math.max(1, zhi - zlo - h + 1));
    const loop: Loop = { a, b: Math.min(xhi, a + w), c, d: Math.min(zhi, c + h), cw: r() < 0.6 };
    return { j, kind, loop, phase: r() * loopLength(loop), speed: SPECS[kind].vmax * (0.3 + r() * 0.08), u: r() };
  }));
}
/** Where ghost car `g` is round its loop at shared time `t`. */
export const carProgress = (g: CarGhost, t: number) => (g.phase + g.speed * t) % loopLength(g.loop);

/** A ring of sidewalk round blocks: x crossings a..b, z c..d, walked along the middle of the sidewalk on the block side. */
export interface Ring {
  a: number;
  b: number;
  c: number;
  d: number;
  cw: boolean;
  pts: [number, number][];
  P: number;
  /** Start of each side along the ring, and the crossings of streets it walks over. */
  starts: number[];
  crossings: { o0: number; o1: number; axis: Axis; line: number; k: number }[];
}
/** How far from a street's middle the walkers keep (the sidewalk's outer part: benches, lamps and bins are inboard). */
const LAT = 5.65;
export function makeRing(a: number, b: number, c: number, d: number, cw: boolean): Ring {
  const x0 = crossAt(STREET_X, a) + LAT, x1 = crossAt(STREET_X, b) - LAT, z0 = crossAt(STREET_Z, c) + LAT, z1 = crossAt(STREET_Z, d) - LAT;
  const pts: [number, number][] = cw ? [[x0, z0], [x1, z0], [x1, z1], [x0, z1]] : [[x0, z0], [x0, z1], [x1, z1], [x1, z0]];
  const starts: number[] = [];
  let P = 0;
  const crossings: Ring['crossings'] = [];
  for (let i = 0; i < 4; i++) {
    const [px, pz] = pts[i];
    const [qx, qz] = pts[(i + 1) % 4];
    starts.push(P);
    const alongX = pz === qz;
    const dir = Math.sign(alongX ? qx - px : qz - pz);
    const len = Math.abs(alongX ? qx - px : qz - pz);
    // The streets it walks across: the ones strictly between its ends.
    const [lo, hi] = alongX ? [a, b] : [c, d];
    const line = alongX ? (pz < (z0 + z1) / 2 ? c : d) : px < (x0 + x1) / 2 ? a : b;
    for (let k = lo + 1; k < hi; k++) {
      const mid = crossAt(alongX ? STREET_X : STREET_Z, k);
      const start = alongX ? px : pz;
      const u = [(mid - CURB - start) * dir, (mid + CURB - start) * dir];
      crossings.push({ o0: P + Math.min(...u), o1: P + Math.max(...u), axis: alongX ? 'x' : 'z', line, k });
    }
    P += len;
  }
  return { a, b, c, d, cw, pts, P, starts, crossings };
}
/** Where `S` metres round a ring is, and which way it's heading there. */
export function ringAt(r: Ring, S: number): { x: number; z: number; dx: number; dz: number; side: number; axis: Axis } {
  S = ((S % r.P) + r.P) % r.P;
  let i = 3;
  for (let k = 0; k < 3; k++) if (S < r.starts[k + 1]) { i = k; break; }
  const [px, pz] = r.pts[i];
  const [qx, qz] = r.pts[(i + 1) % 4];
  const len = Math.hypot(qx - px, qz - pz);
  const dx = (qx - px) / len, dz = (qz - pz) / len;
  const o = S - r.starts[i];
  return { x: px + dx * o, z: pz + dz * o, dx, dz, side: i, axis: dx ? 'x' : 'z' };
}

/** A place on a ring where someone stops for a while. */
export interface Stop {
  /** How far round the ring it is. */
  off: number;
  dwell: number;
  kind: 'door' | 'bench' | 'bus' | 'look';
  /** Where they go from the sidewalk (into the door, onto the bench, to the shelter), if anywhere. */
  x?: number;
  z?: number;
  /** The way they face there. */
  face: number;
}

export interface PedGhost {
  j: number;
  role: Role;
  pair: boolean;
  dog: boolean;
  ring: Ring;
  speed: number;
  phase: number;
  stops: Stop[];
  /** Seconds for a whole lap, stops and all. */
  cycle: number;
  u: number;
}

/** Places to stop along the sidewalks: doors on the building fronts, the benches, the bus shelters. Keyed by the street side they're on. */
interface Poi {
  kind: Stop['kind'];
  along: number;
  x: number;
  z: number;
  face: number;
}
/** Which side of which street a sidewalk line is: its street, and ±1 for the side of the street's middle. */
const sideOf = (axis: Axis, coord: number): { k: number; sign: number } => {
  const c0 = axis === 'x' ? STREET_Z : STREET_X;
  const k = Math.round((coord - c0) / PERIOD);
  return { k, sign: Math.sign(coord - c0 - k * PERIOD) };
};
const sideKey = (axis: Axis, coord: number): string => {
  const { k, sign } = sideOf(axis, coord);
  return `${axis}:${k}:${sign}`;
};
/** Bus shelters: on some of the blocks' sidewalks, away from the benches and bins. */
let shelters: ReturnType<typeof busStopsNow> | null = null;
export const busStops = () => (shelters ??= busStopsNow());

/** Whether a shelter at (x, z) facing `face` has nothing solid under it (a park's hedge, a bench, a lamp, a building). */
function shelterClear(x: number, z: number, face: number): boolean {
  const sx = Math.sin(face), cz = Math.cos(face);
  for (const lx of [-1.7, -0.85, 0, 0.85, 1.7, 2.1]) {
    for (const lz of [-1.9, -1.2, -0.4, 0.2]) {
      const wx = x + lx * cz + lz * sx;
      const wz = z - lx * sx + lz * cz;
      if (citySolids(wx, wz, 0.05).some((a) => wx >= a.minX - 0.05 && wx <= a.maxX + 0.05 && wz >= a.minZ - 0.05 && wz <= a.maxZ + 0.05)) return false;
    }
  }
  return true;
}

function busStopsNow(): { x: number; z: number; face: number; axis: Axis; coord: number; along: number }[] {
  const out: { x: number; z: number; face: number; axis: Axis; coord: number; along: number }[] = [];
  const R = Math.ceil(PROP_R / PERIOD);
  for (let i = -R; i <= R; i++) {
    for (let j = -R; j <= R; j++) {
      const bx = STREET_X - PERIOD / 2 + i * PERIOD;
      const bz = STREET_Z - PERIOD / 2 + j * PERIOD;
      if (Math.hypot(bx, bz) > PROP_R - 20 || Math.hypot(bx, bz) < 75) continue;
      const k = rng((i * 7919 + j * 104729 + 55) >>> 0);
      for (const [alongX, sgn] of [[true, -1], [true, 1], [false, -1], [false, 1]] as const) {
        if (k() > 0.07) continue;
        const line = (alongX ? bz : bx) + sgn * (PERIOD / 2 - 5);
        const face = alongX ? (sgn < 0 ? Math.PI : 0) : sgn < 0 ? -Math.PI / 2 : Math.PI / 2;
        // Where it fits: the first place along the sidewalk with nothing in the way, else none.
        for (const u of [14 + k() * 3, -16, 21, -10, 4]) {
          const x = alongX ? bx + u : line;
          const z = alongX ? line : bz + u;
          if (!shelterClear(x, z, face)) continue;
          out.push({ x, z, face, axis: alongX ? 'x' : 'z', coord: line, along: alongX ? x : z });
          break;
        }
      }
    }
  }
  return out;
}
const PROP_R = 200;
let poiMap: Map<string, Poi[]> | null = null;
function pois(): Map<string, Poi[]> {
  if (poiMap) return poiMap;
  const map = new Map<string, Poi[]>();
  const add = (axis: Axis, coord: number, p: Poi) => {
    const key = sideKey(axis, coord);
    const list = map.get(key);
    if (list) list.push(p);
    else map.set(key, [p]);
  };
  for (const l of cityLayout().lots) {
    if (l.hand || l.kind === 'glass' || l.kind === 'deck' || l.kind === 'gas') continue;
    const dx = l.x + l.fx * (l.w / 2 + 0.15);
    const dz = l.z + l.fz * (l.d / 2 + 0.15);
    const axis: Axis = l.fx ? 'z' : 'x';
    const street = l.fx ? STREET_X + PERIOD * Math.round((dx - STREET_X) / PERIOD) : STREET_Z + PERIOD * Math.round((dz - STREET_Z) / PERIOD);
    const coord = street - (l.fx || l.fz) * 5;
    const along = l.fx ? dz : dx;
    add(axis, coord, { kind: 'door', along, x: dx, z: dz, face: Math.atan2(l.fx, l.fz) });
  }
  for (const p of cityStreetscape().props) {
    if (p.kind !== 'bench') continue;
    const axis: Axis = Math.abs(Math.sin(p.rot)) < 0.5 ? 'x' : 'z';
    add(axis, axis === 'x' ? p.z : p.x, { kind: 'bench', along: axis === 'x' ? p.x : p.z, x: p.x, z: p.z, face: p.rot });
  }
  for (const b of busStops()) {
    // Stand back in the shelter, looking out at the road.
    add(b.axis, b.coord, { kind: 'bus', along: b.along, x: b.x - Math.sin(b.face) * 0.9, z: b.z - Math.cos(b.face) * 0.9, face: b.face });
  }
  return (poiMap = map);
}

/** The stops along a ring: what's on its sides (not at a corner or in a crossing), in the order they come. */
function stopsFor(ring: Ring, want: Stop['kind'][], r: () => number, dwell: [number, number]): Stop[] {
  const candidates: Stop[] = [];
  for (let i = 0; i < 4; i++) {
    const [px, pz] = ring.pts[i];
    const [qx, qz] = ring.pts[(i + 1) % 4];
    const alongX = pz === qz;
    const dir = Math.sign(alongX ? qx - px : qz - pz);
    const start = alongX ? px : pz;
    const coord = alongX ? pz : px;
    const len = Math.abs(alongX ? qx - px : qz - pz);
    for (const p of pois().get(sideKey(alongX ? 'x' : 'z', coord)) ?? []) {
      const o = (p.along - start) * dir;
      if (!want.includes(p.kind) || o < 3 || o > len - 3) continue;
      const off = ring.starts[i] + o;
      if (ring.crossings.some((c) => off > c.o0 - 2 && off < c.o1 + 2)) continue;
      candidates.push({ off, dwell: 0, kind: p.kind, x: p.x, z: p.z, face: p.face });
    }
  }
  const picked: Stop[] = [];
  for (const kind of want) {
    const pool = candidates.filter((c) => c.kind === kind && picked.every((s) => Math.abs(s.off - c.off) > 12));
    if (!pool.length) continue;
    const c = pool[Math.floor(r() * pool.length)];
    picked.push({ ...c, dwell: dwell[0] + r() * (dwell[1] - dwell[0]) });
  }
  return picked.sort((p, q) => p.off - q.off);
}

export const PED_GHOSTS = 480;
let pedGhosts: PedGhost[] | null = null;
const ROLES: Role[] = ['commuter', 'commuter', 'commuter', 'lunch', 'shopper', 'shopper', 'evening', 'jogger', 'dog', 'late'];
/** Which blocks have parks, as a ring of crossings round each: where joggers run and dogs are walked. */
const parkRings = (): [number, number, number, number][] =>
  cityLayout().parks.map((p) => {
    const i = Math.round((p.x - (STREET_X - PERIOD / 2)) / PERIOD);
    const j = Math.round((p.z - (STREET_Z - PERIOD / 2)) / PERIOD);
    return [i - 1, i, j - 1, j] as [number, number, number, number];
  });
export function ghostPeds(): PedGhost[] {
  if (pedGhosts) return pedGhosts;
  const [xlo, xhi] = crossRange(STREET_X);
  const [zlo, zhi] = crossRange(STREET_Z);
  const parks = parkRings().filter(([a, b, c, d]) => a >= xlo && b <= xhi && c >= zlo && d <= zhi);
  return (pedGhosts = Array.from({ length: PED_GHOSTS }, (_, j) => {
    const r = rng(52000 + j * 131);
    const pair = j % 5 === 0;
    const role: Role = pair ? (r() < 0.5 ? 'shopper' : 'evening') : ROLES[Math.floor(r() * ROLES.length)];
    const park = (role === 'jogger' || role === 'dog') && parks.length ? parks[Math.floor(r() * parks.length)] : null;
    const w = park || r() < 0.65 ? 1 : 2;
    const h = park || r() < 0.65 ? 1 : 2;
    const a = park ? park[0] : xlo + Math.floor(r() * Math.max(1, xhi - xlo - w + 1));
    const c = park ? park[2] : zlo + Math.floor(r() * Math.max(1, zhi - zlo - h + 1));
    const ring = makeRing(a, park ? park[1] : Math.min(xhi, a + w), c, park ? park[3] : Math.min(zhi, c + h), r() < 0.5);
    const speed = role === 'jogger' ? 2.6 + r() * 0.8 : pair ? 1.15 + r() * 0.5 : 1.2 + r() * 0.55;
    const plan: Record<Role, [Stop['kind'][], [number, number]]> = {
      commuter: [['bus', 'door'], [50, 110]],
      lunch: [['door', 'bench'], [40, 90]],
      shopper: [['door', 'door', 'bench'], [30, 70]],
      evening: [['door', 'bench'], [40, 100]],
      jogger: [[], [0, 0]],
      dog: [['bench'], [20, 50]],
      late: [['bench', 'door'], [30, 80]],
    };
    const [kinds, dwell] = plan[role];
    const stops = stopsFor(ring, kinds, r, dwell);
    // A glance in a window somewhere, for a good many of them.
    if (role !== 'jogger' && r() < 0.4) {
      const off = r() * ring.P;
      if (!ring.crossings.some((c) => off > c.o0 - 3 && off < c.o1 + 3) && stops.every((s) => Math.abs(s.off - off) > 10)) {
        stops.push({ off, dwell: 4 + r() * 6, kind: 'look', face: 0 });
        stops.sort((p, q) => p.off - q.off);
      }
    }
    // What a look is at: the building, across the walker's left or right.
    for (const s of stops) if (s.kind === 'look') {
      const at = ringAt(ring, s.off);
      const m = ring.cw ? 1 : -1;
      s.face = Math.atan2(-at.dz * m, at.dx * m);
    }
    const cycle = ring.P / speed + stops.reduce((n, s) => n + s.dwell, 0);
    return { j, role, pair, dog: role === 'dog', ring, speed, phase: r() * cycle, stops, cycle, u: r() };
  }));
}

/** What ghost `g` is doing at shared time `t`: how far it's got (metres, adding up lap after lap), how many stops it's done, and the stop it's at, if any. */
export function pedAt(g: PedGhost, t: number): { R: number; done: number; at: number; since: number } {
  const T = t + g.phase;
  const n = Math.floor(T / g.cycle);
  let u = T - n * g.cycle;
  const R0 = n * g.ring.P;
  const done0 = n * g.stops.length;
  let prev = 0;
  for (let i = 0; i < g.stops.length; i++) {
    const s = g.stops[i];
    const walk = (s.off - prev) / g.speed;
    if (u < walk) return { R: R0 + prev + u * g.speed, done: done0 + i, at: -1, since: 0 };
    u -= walk;
    if (u < s.dwell) return { R: R0 + s.off, done: done0 + i, at: i, since: u };
    u -= s.dwell;
    prev = s.off;
  }
  return { R: R0 + prev + u * g.speed, done: done0 + g.stops.length, at: -1, since: 0 };
}

/** Whether this ghost is out at this hour: each has its own chance, so the crowd thickens and thins smoothly. */
export const pedOut = (g: PedGhost, hour: number): boolean => g.u < activity(g.role, hour);
export const carOut = (g: CarGhost, hour: number): boolean => g.u < trafficDensity(hour);


/** A glass-backed shelter with a roof and a bench at each bus stop, and a sign on a pole: one geometry. */
function busShelters(): THREE.BufferGeometry | null {
  const parts: Part[] = [];
  for (const b of busStops()) {
    // In the shelter's own frame +z is toward the road, +x along the sidewalk; the building's behind it (-z).
    const local: Part[] = [
      box(3, 2.1, 0.06, 0, 1.15, -1.6, GLASS),
      box(3.2, 0.12, 1.7, 0, 2.3, -1.15, TRIM),
      box(0.1, 2.2, 0.1, -1.5, 1.1, -0.4, TRIM),
      box(0.1, 2.2, 0.1, 1.5, 1.1, -0.4, TRIM),
      box(2.2, 0.08, 0.5, 0, 0.5, -1.3, '#9a6b3f'),
      box(0.08, 2.6, 0.08, 2.1, 1.3, 0.2, TRIM),
      box(0.5, 0.5, 0.06, 2.1, 2.45, 0.2, '#2a6fdb'),
    ];
    for (const [g, c] of local) parts.push([g.rotateY(b.face).translate(b.x, 0, b.z), c]);
  }
  return parts.length ? merged(parts) : null;
}

export function buildStreetLife(_night?: NightParts): StreetLife {
  const group = new THREE.Group();
  const mat = toonVertex();

  // Vehicles: every kind's body, paint and wheels in one batch (a single draw call), each car a few
  // instances of it: its body, its paint (tinted), and a wheel at each hub. Kenney's models when they're in.
  const vehicles: Vehicle[] = [];
  const vlooks = Object.fromEntries(KINDS.map((k) => [k, lookOf(k)])) as Record<VKind, Look>;
  const vgeos = new Set<THREE.BufferGeometry>();
  for (const k of KINDS) for (const g of [vlooks[k].body, vlooks[k].paint, vlooks[k].wheel]) if (g) vgeos.add(g);
  let vverts = 0;
  let vindices = 0;
  for (const g of vgeos) {
    vverts += g.attributes.position.count;
    vindices += g.index!.count;
  }
  const instances = KINDS.reduce((n, k) => n + SPECS[k].count * (Number(!!vlooks[k].body) + 1 + (vlooks[k].wheel ? vlooks[k].hubs.length : 0)), 0);
  // The page's OutlineEffect can't draw a batch's outline: a second batch, the same cars a touch bigger
  // and dark, inside out, draws it instead (two draw calls for all the traffic).
  const batchMat = (kitModel('sedan') ? kitMaterial() : mat).clone();
  batchMat.userData.outlineParameters = { visible: false };
  const batch = new THREE.BatchedMesh(instances, vverts, vindices, batchMat);
  const vhull = new THREE.BatchedMesh(instances, vverts, vindices, trafficOutline());
  batch.name = 'traffic';
  vhull.name = 'traffic outline';
  for (const b of [batch, vhull]) {
    b.frustumCulled = false;
    b.castShadow = false;
    group.add(b);
  }
  const both = [batch, vhull];
  const geoId = new Map<THREE.BufferGeometry, number>();
  for (const g of vgeos) {
    geoId.set(g, batch.addGeometry(g));
    vhull.addGeometry(g);
  }
  /** Each car's instances in the batch: body (or -1), paint, and its wheels. */
  const vparts: { body: number; paint: number; wheels: number[] }[] = [];
  const white = new THREE.Color('#ffffff');
  const add = (g: THREE.BufferGeometry) => {
    const id = batch.addInstance(geoId.get(g)!);
    // (Added in the same order, an instance has the same id in both.)
    vhull.addInstance(geoId.get(g)!);
    for (const b of both) b.setVisibleAt(id, false);
    batch.setColorAt(id, white);
    return id;
  };
  for (const k of KINDS) {
    const look = vlooks[k];
    for (let i = 0; i < SPECS[k].count; i++) {
      const id = vehicles.length;
      const r = rng(9000 + id);
      const paint = look.paints[Math.floor(r() * look.paints.length)];
      vparts.push({ body: look.body ? add(look.body) : -1, paint: add(look.paint!), wheels: look.wheel ? look.hubs.map(() => add(look.wheel!)) : [] });
      batch.setColorAt(vparts[id].paint, new THREE.Color(paint));
      vehicles.push({ id, kind: k, paint, on: false, v: 0, axis: 'x', dir: 1, line: 0, s: 0, path: null, plan: null, braking: false, hold: 0, stuck: 0, seed: id * 7919 + 13, slot: i, gj: -1, S: 0, acc: 0, pitch: 0, roll: 0, x: 0, z: 0, yaw: 0, len: SPECS[k].len, wid: SPECS[k].wid });
    }
  }
  /** How far each car's wheels have turned (rad), and how far its front ones are steered, eased. */
  const spun = vehicles.map(() => 0);
  const steered = vehicles.map(() => 0);
  const lastYaw = vehicles.map(() => 0);
  // Their lights, all in one mesh: two head, two tail and two on the roof (an emergency vehicle's) each.
  const LAMPS = 6;
  const lampMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  const lamps = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), lampMat, MAX_VEHICLES * LAMPS);
  lamps.frustumCulled = false;
  group.add(lamps);
  const HEAD = new THREE.Color('#fff3c4');
  const TAIL = new THREE.Color();
  const RED = new THREE.Color('#ff2030');
  const BLUE = new THREE.Color('#2f6bff');
  const DIM = new THREE.Color('#30343f');

  // People, and the dogs some of them walk: every part of everyone (see crowd.ts) is one BatchedMesh,
  // a single draw call, and their outline another. Each person has SLOTS instances, posed by their
  // matrices, shown only while they're out and wearing that part.
  const parts = {} as Record<CrowdPart, number>;
  const geos = (Object.keys(CROWD) as CrowdPart[]).map((k) => [k, CROWD[k]()] as const);
  const verts = geos.reduce((n, [, g]) => n + g.attributes.position.count, 0);
  const indices = geos.reduce((n, [, g]) => n + g.index!.count, 0);
  const [crowd, hull] = [crowdMaterial(mat.gradientMap), outlineMaterial()].map((m) => {
    const b = new THREE.BatchedMesh(MAX_PEOPLE * SLOTS, verts, indices, m);
    for (const [k, g] of geos) parts[k] = b.addGeometry(g);
    for (let n = 0; n < MAX_PEOPLE * SLOTS; n++) b.setVisibleAt(b.addInstance(parts.head), false);
    // Culled person by person (not as a whole: the crowd's all round you), never sorted.
    b.frustumCulled = b.sortObjects = false;
    b.perObjectFrustumCulled = true;
    b.castShadow = false;
    group.add(b);
    return b;
  });
  crowd.name = 'crowd';
  hull.name = 'crowd outline';
  const batches = [crowd, hull];
  /** How each of them is put together (by id). */
  const looks: PedLook[] = [];
  // The bus shelters, all of them as one static mesh.
  const shelter = busShelters();
  if (shelter) {
    const m = new THREE.Mesh(shelter, mat);
    m.frustumCulled = false;
    m.castShadow = false;
    group.add(m);
  }
  const people: Pedestrian[] = [];
  const tmpColor = new THREE.Color();
  /** Picks how `q` is put together from `r`, and paints them: a kid is shorter, an elder grey. */
  function dress(q: Pedestrian, r: () => number) {
    const L = (looks[q.id] = pickLook(r, q.pairSide));
    if (L.build === 'kid') q.h = 0.62 + r() * 0.1;
    const top = L.top === 'coat' ? COATS[Math.floor(r() * COATS.length)] : SHIRTS[q.shirt];
    const wear = (s: number, k: CrowdPart | null, c: string) => {
      if (!k) return;
      for (const b of batches) b.setGeometryIdAt(q.id * SLOTS + s, parts[k]);
      crowd.setColorAt(q.id * SLOTS + s, tmpColor.set(c));
    };
    wear(SLOT.top, L.top, top);
    wear(SLOT.head, 'head', SKIN_TONES[q.skin]);
    wear(SLOT.hair, L.hair, L.build === 'elder' ? GREYS[q.hair % GREYS.length] : HAIR_COLORS[q.hair]);
    wear(SLOT.hat, L.hat, SHIRTS[Math.floor(r() * SHIRTS.length)]);
    wear(SLOT.carry, L.carry, [...COATS, ...SHIRTS][Math.floor(r() * (COATS.length + SHIRTS.length))]);
    const legs = L.top === 'dress' ? (r() < 0.5 ? SKIN_TONES[q.skin] : TIGHTS[q.pants % TIGHTS.length]) : PANTS[q.pants];
    for (let a = 0; a < 2; a++) {
      wear(SLOT.arm + a, 'arm', top);
      wear(SLOT.hand + a, 'hand', SKIN_TONES[q.skin]);
      wear(SLOT.leg + a, 'leg', legs);
    }
    wear(SLOT.dog, 'dog', DOG_COATS[Math.floor(r() * DOG_COATS.length)]);
  }
  for (let i = 0; i < MAX_PEOPLE; i++) {
    const r = rng(4000 + i);
    // The first forty are twenty pairs, out together.
    const pair = i < 40 ? i ^ 1 : -1;
    const seed = 4000 + (pair >= 0 ? Math.min(i, pair) : i);
    const p: Pedestrian = { id: i, on: false, state: 'walk', x: 0, z: 0, yaw: 0, axis: 'x', dir: 1, gj: -1, R: 0, stopN: 0, at: null, dr: 0, pairSide: pair < 0 ? 0 : i % 2 ? 1 : -1, look: 0, prev: 'walk', timer: 0, speed: 1.4, phase: r() * 6, retry: 0, seed, pair, dx: 0, dz: 0, jx: 0, jz: 0, hop: 0, tilt: 0, cool: 0, dog: false, dogX: 0, dogZ: 0, dogYaw: 0, skin: Math.floor(r() * SKIN_TONES.length), hair: Math.floor(r() * HAIR_COLORS.length), shirt: Math.floor(r() * SHIRTS.length), pants: Math.floor(r() * PANTS.length), h: 0.92 + r() * 0.14 };
    people.push(p);
    dress(p, r);
  }

  // --- Placing things -------------------------------------------------------------------------------------

  let epoch = 0;
  const hourNow = { v: 12 };
  const others = (v: Vehicle, d: number) => vehicles.some((o) => o !== v && o.on && Math.hypot(o.x - v.x, o.z - v.z) < d);
  /** Which slot has each ghost, so no two show the same one. */
  const carTaken = new Map<number, number>();
  const pedTaken = new Map<number, number>();
  const vRetry = vehicles.map(() => 0);
  /** Who goes first at a crossing: by ghost (the same on every page), not by which slot they're drawn in. */
  const prio = (v: Vehicle) => (v.gj >= 0 ? v.gj : 1000 + v.id);
  const release = (v: Vehicle) => {
    v.on = false;
    if (carTaken.get(v.gj) === v.id) carTaken.delete(v.gj);
    v.gj = -1;
  };

  /** Sets `v` on ghost `g` exactly where it is now (paint and all): false if that's in a crossing or on top of another car. */
  function seat(v: Vehicle, g: CarGhost, t: number, within?: { x: number; z: number }): boolean {
    const S = carProgress(g, t);
    const r = loopAt(g.loop, S);
    const q = (((r.s - alongO(r.axis)) % PERIOD) + PERIOD) % PERIOD;
    if (q < 12 || q > PERIOD - 12) return false;
    const w = onRoad(r.axis, r.line, r.s, laneOffset(r.axis, r.dir));
    if (within && Math.hypot(w.x - within.x, w.z - within.z) > SPAWN_R) return false;
    const keep = { x: v.x, z: v.z, yaw: v.yaw, axis: v.axis, dir: v.dir, line: v.line, s: v.s };
    Object.assign(v, { axis: r.axis, dir: r.dir, line: r.line, s: r.s, x: w.x, z: w.z, yaw: yawOf(r.axis, r.dir) });
    if (others(v, 9)) {
      Object.assign(v, keep);
      return false;
    }
    // Its paint is the ghost's, the same on every page.
    const paints = vlooks[v.kind].paints;
    v.paint = paints[Math.floor(roll(g.j, 77) * paints.length)];
    batch.setColorAt(vparts[v.id].paint, tmpColor.set(v.paint));
    Object.assign(v, { v: g.speed, path: null, plan: null, hold: 0, stuck: 0, braking: false, gj: g.j, S, acc: 0, pitch: 0, roll: 0 });
    return true;
  }

  /** Puts `v` where some ghost of its kind is now (one that's out at this hour), between `minR` and `maxR` from `at` and out of a crossing: false if there's none. */
  function place(v: Vehicle, at: { x: number; z: number }, minR: number, maxR: number, t: number): boolean {
    const gs = ghostCars();
    const first = (v.seed + ++epoch * 37) % gs.length;
    for (let n = 0; n < gs.length; n++) {
      const g = gs[(first + n) % gs.length];
      if (g.kind !== v.kind || carTaken.has(g.j) || !carOut(g, hourNow.v)) continue;
      const r = loopAt(g.loop, carProgress(g, t));
      const w = onRoad(r.axis, r.line, r.s, laneOffset(r.axis, r.dir));
      const d = Math.hypot(w.x - at.x, w.z - at.z);
      if (d < minR || d > maxR || !seat(v, g, t)) continue;
      v.on = true;
      carTaken.set(g.j, v.id);
      return true;
    }
    v.gj = -1;
    return false;
  }

  /** Where a person on a ghost's ring is, and on the sidewalk or at their stop. */
  function ground(p: Pedestrian) {
    const g = ghostPeds()[p.gj];
    const at = ringAt(g.ring, p.R);
    let x = at.x;
    let z = at.z;
    // Two together walk a stride apart.
    if (p.pairSide) {
      x += -at.dz * 0.32 * p.pairSide;
      z += at.dx * 0.32 * p.pairSide;
    }
    const s = p.at;
    if (s && p.dr > 0 && s.x !== undefined && s.z !== undefined) {
      // Two on a bench sit along it.
      const tx = s.x + (p.pairSide && s.kind === 'bench' ? Math.cos(s.face) * 0.4 * p.pairSide : 0);
      const tz = s.z + (p.pairSide && s.kind === 'bench' ? -Math.sin(s.face) * 0.4 * p.pairSide : 0);
      x += (tx - x) * p.dr;
      z += (tz - z) * p.dr;
    }
    p.x = x;
    p.z = z;
    p.axis = at.axis;
    p.dir = (at.axis === 'x' ? at.dx : at.dz) > 0 ? 1 : -1;
  }

  const stopAt = (g: PedGhost, n: number): { stop: Stop; abs: number } => {
    const ns = g.stops.length;
    return { stop: g.stops[n % ns], abs: Math.floor(n / ns) * g.ring.P + g.stops[n % ns].off };
  };

  /** Starts `q` off on ghost `g` as it is at time `t`: walking, or already at a stop. */
  function start(q: Pedestrian, g: PedGhost, t: number) {
    const a = pedAt(g, t);
    Object.assign(q, { on: true, gj: g.j, R: a.R, stopN: a.done, at: null, dr: 0, state: 'walk', dx: 0, dz: 0, jx: 0, jz: 0, hop: 0, tilt: 0, cool: 0, look: 0, speed: g.speed, dog: g.dog, prev: 'walk' });
    // Their looks are the ghost's (and which of a pair), the same on every page.
    const r = rng(60000 + g.j * 3 + (q.pairSide > 0 ? 1 : 0));
    Object.assign(q, { skin: Math.floor(r() * SKIN_TONES.length), hair: Math.floor(r() * HAIR_COLORS.length), shirt: Math.floor(r() * SHIRTS.length), pants: Math.floor(r() * PANTS.length), h: 0.92 + r() * 0.14 });
    dress(q, r);
    if (a.at >= 0) enter(q, g.stops[a.at], a.since > 4 ? 1 : 0);
    ground(q);
    q.yaw = ringHeading(g, q.R);
    q.dogX = q.x + 0.9;
    q.dogZ = q.z;
  }
  const ringHeading = (g: PedGhost, R: number) => {
    const at = ringAt(g.ring, R);
    return Math.atan2(at.dx, at.dz);
  };

  function placePerson(p: Pedestrian, at: { x: number; z: number }, minR: number, maxR: number, t: number): boolean {
    const gs = ghostPeds();
    const first = (p.seed + ++epoch * 13) % gs.length;
    const partner = p.pair >= 0 ? people[p.pair] : null;
    for (let n = 0; n < gs.length; n++) {
      const g = gs[(first + n) % gs.length];
      if (g.pair !== (p.pair >= 0) || pedTaken.has(g.j) || !pedOut(g, hourNow.v)) continue;
      const a = pedAt(g, t);
      const w = ringAt(g.ring, a.R);
      const d = Math.hypot(w.x - at.x, w.z - at.z);
      if (d < minR || d > maxR) continue;
      for (const q of [p, partner]) if (q) start(q, g, t);
      pedTaken.set(g.j, p.id);
      return true;
    }
    return false;
  }

  /** Off the street for good (in through a door, or too far to be missed): the ghost is free for someone else. */
  function retire(p: Pedestrian) {
    const lead = p.pair >= 0 && p.id % 2 ? people[p.pair] : p;
    for (const q of [lead, lead.pair >= 0 ? people[lead.pair] : null]) if (q) q.on = false;
    if (pedTaken.get(lead.gj) === lead.id) pedTaken.delete(lead.gj);
  }

  /** Comes to a stop: the door, the bench, a look in the window, the bus shelter. */
  function enter(p: Pedestrian, s: Stop, dr = 0) {
    p.at = s;
    p.dr = s.x === undefined ? 0 : dr;
    p.state = s.kind === 'door' ? 'door' : s.kind === 'bench' ? 'sit' : 'idle';
  }

  const avoidBody = (a: Avoid): Body => ({ x: a.x, z: a.z, yaw: 0, len: 3, wid: 3 });

  function stepVehicle(v: Vehicle, dt: number, t: number, avoidBodies: Body[]) {
    const K = SPECS[v.kind];
    const gh = v.gj >= 0 ? ghostCars()[v.gj] : null;
    v.hold = Math.max(0, v.hold - dt);
    let target = K.vmax;
    let carAhead = false;
    let plan: Plan | null = null;
    if (v.path) target = Math.min(target, TURN_SPEED);
    else {
      const o = alongO(v.axis);
      const k = nextCrossing(v.s, v.dir, o);
      const c = crossingOf(v.axis, v.line, k);
      const road = { axis: v.axis, dir: v.dir, line: v.line };
      plan = v.plan?.k === k ? v.plan : (v.plan = { k, ...((gh && loopRoute(gh.loop, road, k)) || route(road, k, roll(v.seed, c.ix, c.iz))) });
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
    const me = { id: prio(v), yaw: v.yaw, left: (v.path?.turn ?? plan?.turn) === 'left', stuck: v.stuck, inside: !!v.path };
    for (const o of vehicles) {
      if (o === v || !o.on) continue;
      const g = gapAhead(v, o);
      if (g === null || !yieldsTo(me, { id: prio(o), yaw: o.yaw, v: o.v, left: (o.path?.turn ?? o.plan?.turn) === 'left', inside: !!o.path })) continue;
      const vo = Math.max(0, o.v * Math.cos(o.yaw - v.yaw));
      target = Math.min(target, safeSpeed(g, vo, K.vmax));
      carAhead = true;
    }
    for (const p of people) {
      if (!p.on || (p.state !== 'cross' && p.state !== 'down')) continue;
      const g = gapAhead(v, { x: p.x + p.dx, z: p.z + p.dz, yaw: 0, len: 0.7, wid: 0.7 });
      if (g !== null) target = Math.min(target, safeSpeed(g, 0, K.vmax));
    }
    for (const b of avoidBodies) {
      const g = gapAhead(v, b);
      if (g !== null) target = Math.min(target, safeSpeed(g, 0, K.vmax));
    }
    // Its ghost is where it should be by now: behind it, it hurries (up to the top speed); ahead, it eases off.
    if (gh) {
      const P = loopLength(gh.loop);
      const lag = ((carProgress(gh, t) - v.S + P * 1.5) % P) - P / 2;
      target = Math.min(target, clamp(gh.speed + 0.5 * lag, K.vmax * 0.12, K.vmax));
    }
    if (v.hold > 0) target = 0;
    v.stuck = v.v < 0.3 && carAhead ? v.stuck + dt : 0;
    v.braking = target < v.v - 0.3;
    // Ease the pedal: no jolt from gas to brake (a hard stop still bites at once).
    const want = clamp((target - v.v) / dt, -(BRAKE + 3), ACC);
    v.acc = want < -6 ? want : v.acc + (want - v.acc) * Math.min(1, dt * 10);
    v.v = Math.max(0, v.v + v.acc * dt);
    const yaw0 = v.yaw;
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
    if (gh) v.S = (v.path ? null : loopProgress(gh.loop, { axis: v.axis, dir: v.dir, line: v.line }, v.s)) ?? v.S + v.v * dt;
    // Nose down under braking, a lean out of a bend.
    const k = Math.min(1, dt * 6);
    v.pitch += (clamp(-v.acc * 0.0045, -0.03, 0.05) - v.pitch) * k;
    v.roll += (clamp((-wrap(v.yaw - yaw0) / dt) * v.v * 0.004, -0.05, 0.05) - v.roll) * k;
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


  const hidden = (p: Pedestrian) => p.state === 'door' && p.dr >= 1;
  const walkers = (p: Pedestrian) => p.on && p.state !== 'down' && !hidden(p);

  /** Tumbling, and jumping clear of what's coming: true while they're down (and nothing else about them moves). */
  function reactions(p: Pedestrian, dt: number, cars: Avoid[]): boolean {
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
      return true;
    }
    // Jump from what's coming, once in a while.
    if (p.cool === 0 && !hidden(p)) {
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
    return false;
  }

  /** A person (or one of a pair, the other copies them) on a ghost's ring: walking it, waiting for the walk sign, stopping where it stops. */
  function stepPerson(p: Pedestrian, dt: number, t: number, cars: Avoid[], near: { x: number; z: number }) {
    if (reactions(p, dt, cars)) return;
    const g = ghostPeds()[p.gj];
    if (!g) return retire(p);
    const lead = p.pair >= 0 && p.id % 2 ? people[p.pair] : null;
    if (lead) {
      // The second of a pair does what the first does.
      Object.assign(p, { R: lead.R, stopN: lead.stopN, at: lead.at, dr: lead.dr, speed: lead.speed, phase: lead.phase + 0.5, state: lead.state === 'down' ? lead.prev : lead.state });
    } else {
      const a = pedAt(g, t);
      const out = pedOut(g, hourNow.v);
      // Out of hours: in at the next door, or gone once they're too far to see go.
      if (!out && (hidden(p) || Math.hypot(p.x - near.x, p.z - near.z) > 45)) return retire(p);
      // Hours behind (a tab that slept, a clock that jumped): start over on the ghost, with its stop and the door or bench as it is now.
      if (Math.abs(a.R - p.R) > 100 || a.done - p.stopN > g.stops.length + 1 || p.stopN - a.done > g.stops.length + 1) {
        for (const q of [p, p.pair >= 0 ? people[p.pair] : null]) if (q) start(q, g, t);
        return;
      }
      if (p.at) {
        const s = p.at;
        const over = a.done > p.stopN;
        if (s.x !== undefined && s.z !== undefined) {
          const at = ringAt(g.ring, p.R);
          const dist = Math.max(0.4, Math.hypot(s.x - at.x, s.z - at.z));
          p.dr = clamp(p.dr + ((over ? -1 : 1) * (s.kind === 'door' ? 1.3 : 1.8) * dt) / dist, 0, 1);
        }
        if (over && p.dr === 0) {
          p.at = null;
          p.stopN++;
          p.state = 'walk';
        }
      } else {
        // Whoever's ahead has done with a stop: it's not one to wait for.
        if (a.done > p.stopN) p.stopN = a.done;
        const lag = a.R - p.R;
        const cruise = g.role === 'jogger' ? g.speed : p.speed;
        let v = clamp(cruise + 0.9 * lag, cruise * 0.3, cruise * 2.2);
        const P = g.ring.P;
        const base = Math.floor(p.R / P) * P;
        const o = p.R - base;
        let next = p.R + v * dt;
        let state: PedState = 'walk';
        for (const c of g.ring.crossings) {
          if (o < c.o0 && next - base >= c.o0 && next - base < c.o1 + 1) {
            if (!canWalk(c.axis, lightPhase(t, crossingOf(c.axis, c.line, c.k)))) {
              // Wait at the kerb for the walk sign.
              next = base + c.o0 - 0.01;
              state = 'wait';
            }
          } else if (o >= c.o0 && o < c.o1) {
            // Halfway over: across at a brisk pace, whatever the lights do now.
            state = 'cross';
            v = Math.max(1.7, cruise);
            next = p.R + v * dt;
          }
        }
        const s = g.stops.length ? stopAt(g, p.stopN) : null;
        if (s && next >= s.abs) {
          p.R = s.abs;
          enter(p, s.stop);
        } else {
          p.phase += dt * (state === 'wait' ? 0 : v) * 4.6;
          p.R = next;
          p.state = state;
        }
      }
    }
    ground(p);
    // Which way they face: where they're going; at a stop, what it's for; in a chat each other.
    const heading = ringHeading(g, p.R);
    let want = heading;
    if (p.state === 'idle' || p.state === 'sit' || p.state === 'door') {
      const q = p.pair >= 0 ? people[p.pair] : null;
      want = p.at?.kind === 'look' || p.at?.kind === 'bus' || p.at?.kind === 'bench' || p.at?.kind === 'door' ? p.at.face : heading;
      if (p.state === 'idle' && q?.on && p.at?.kind !== 'bus') want = Math.atan2(q.x - p.x, q.z - p.z);
    }
    p.yaw += wrap(want - p.yaw) * Math.min(1, dt * (p.state === 'walk' || p.state === 'cross' ? 7 : 4));
    // A glance at whoever's close by (you), a turn of the head and no more.
    const dxp = near.x - p.x, dzp = near.z - p.z;
    const turn = wrap(Math.atan2(dxp, dzp) - p.yaw);
    const look = Math.hypot(dxp, dzp) < 7 && Math.abs(turn) < 2.2 && !hidden(p) ? clamp(turn, -1.1, 1.1) : 0;
    p.look += (look - p.look) * Math.min(1, dt * 5);
    // The dog trots on its lead ahead and to one side, nosing about when they stop.
    if (p.dog) {
      const sx = Math.sin(p.yaw), sz = Math.cos(p.yaw);
      const still = p.state !== 'walk' && p.state !== 'cross';
      const sniff = still ? Math.sin(t * 0.9 + p.id) * 0.5 : 0;
      const tx = p.x + sx * 0.95 + sz * (0.55 + sniff);
      const tz = p.z + sz * 0.95 - sx * (0.55 + sniff);
      const k = Math.min(1, dt * 5);
      const mx = (tx - p.dogX) * k, mz = (tz - p.dogZ) * k;
      p.dogX += mx;
      p.dogZ += mz;
      if (Math.hypot(mx, mz) > 0.002) p.dogYaw += wrap(Math.atan2(mx, mz) - p.dogYaw) * Math.min(1, dt * 8);
    }
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
  const FWD = new THREE.Vector3(0, 0, 1);
  const pos = new THREE.Vector3();
  const sc = new THREE.Vector3();
  let started = false;
  let clock = 0;

  const Q = new THREE.Matrix4();
  /** Car `v` where it is: its body pitched and rolled about its axles' height, the wheels on the road, turning (and the front ones steering). */
  function writeVehicle(v: Vehicle, dt: number) {
    const ids = vparts[v.id];
    const base = v.id * LAMPS;
    for (const id of [ids.body, ids.paint, ...ids.wheels]) if (id >= 0) for (const b of both) b.setVisibleAt(id, v.on);
    if (!v.on) {
      for (let i = 0; i < LAMPS; i++) lamps.setMatrixAt(base + i, ZERO);
      lastYaw[v.id] = v.yaw;
      return;
    }
    const look = vlooks[v.kind];
    const h = look.radius;
    // Body: about the hubs' height, so its springs don't lift the wheels off the road.
    q.setFromAxisAngle(RIGHT, v.pitch).multiply(qt.setFromAxisAngle(FWD, v.roll));
    Q.makeRotationFromQuaternion(q);
    P.makeRotationY(v.yaw).setPosition(v.x, 0, v.z);
    M.multiplyMatrices(P, T.makeTranslation(0, h, 0)).multiply(Q).multiply(T.makeTranslation(0, -h, 0));
    for (const b of both) {
      if (ids.body >= 0) b.setMatrixAt(ids.body, M);
      b.setMatrixAt(ids.paint, M);
    }
    // Wheels: rolled as far as it's gone; the front ones turned by how fast it's turning.
    const turn = dt > 0 ? wrap(v.yaw - lastYaw[v.id]) / dt : 0;
    lastYaw[v.id] = v.yaw;
    const want = v.v > 0.5 ? clamp(Math.atan((turn * look.wheelbase) / v.v), -0.5, 0.5) : steered[v.id];
    steered[v.id] += (want - steered[v.id]) * Math.min(1, dt * 8);
    spun[v.id] = (spun[v.id] + (v.v * dt) / h) % (Math.PI * 2);
    ids.wheels.forEach((id, i) => {
      const [x, y, z] = look.hubs[i];
      const left = x > 0;
      q.setFromAxisAngle(UP, (z > 0 ? steered[v.id] : 0) + (left ? Math.PI : 0)).multiply(qt.setFromAxisAngle(RIGHT, left ? -spun[v.id] : spun[v.id]));
      T.compose(pos.set(x, y, z), q, sc.set(1, 1, 1));
      R.multiplyMatrices(P, T);
      for (const b of both) b.setMatrixAt(id, R);
    });
    // Lights, on the body.
    const lamp = (i: number, at: V3 | undefined, w: number, hgt: number, d: number) => {
      if (!at) return lamps.setMatrixAt(base + i, ZERO);
      T.makeScale(w, hgt, d).setPosition(at[0], at[1], at[2]);
      lamps.setMatrixAt(base + i, R.multiplyMatrices(M, T));
    };
    lamp(0, look.head[0], 0.36, 0.15, 0.08);
    lamp(1, look.head[1], 0.36, 0.15, 0.08);
    lamp(2, look.tail[0], 0.32, 0.13, 0.08);
    lamp(3, look.tail[1], 0.32, 0.13, 0.08);
    lamp(4, look.beacons[0]?.at, 0.24, 0.16, 0.22);
    lamp(5, look.beacons[1]?.at, 0.24, 0.16, 0.22);
  }

  const smooth = (x: number) => x * x * (3 - 2 * x);

  function writePerson(p: Pedestrian) {
    const i = p.id;
    if (!p.on || hidden(p)) {
      for (let s = 0; s < SLOTS; s++) for (const b of batches) b.setVisibleAt(i * SLOTS + s, false);
      return;
    }
    const L = looks[i];
    /** Shows slot `s` of theirs posed by `m`, or hides it (`on` false). */
    const pose = (s: number, m: THREE.Matrix4, on = true) => {
      for (const b of batches) {
        b.setVisibleAt(i * SLOTS + s, on);
        if (on) b.setMatrixAt(i * SLOTS + s, m);
      }
    };
    const flail = p.state === 'down';
    const moving = p.state === 'walk' || p.state === 'cross';
    const jog = p.speed > 2.4;
    // Going in at a door (or out of it) they shrink into it; on a bench they sit.
    const fade = p.state === 'door' ? (p.dr < 0.7 ? 1 : (1 - p.dr) / 0.3) : 1;
    const sit = p.state === 'sit' ? smooth(clamp((p.dr - 0.4) / 0.6, 0, 1)) : 0;
    // On the way to a door or a bench they're still walking.
    const stepping = moving || ((p.state === 'door' || p.state === 'sit') && p.dr > 0 && p.dr < 1);
    const w0 = moving ? p.phase : p.dr * 26;
    const t = clock + p.id * 1.7;
    const swing = Math.sin(w0);
    // Standing still they sway a little, and shift their weight now and then.
    const sway = !stepping && !flail ? Math.sin(t * 0.8) * 0.025 + Math.max(0, Math.sin(t * 0.31 + 2) - 0.85) * 0.25 : stepping ? swing * 0.03 : 0;
    const bob = stepping ? Math.abs(swing) * (jog ? 0.07 : 0.035) : 0;
    // On their back the body's laid along the ground, a little up off it.
    // An elder stoops a little.
    q.setFromAxisAngle(UP, p.yaw).multiply(qt.setFromAxisAngle(RIGHT, p.tilt + (jog && moving ? 0.12 : 0) + sit * -0.05 + (L.build === 'elder' ? 0.12 : 0))).multiply(new THREE.Quaternion().setFromAxisAngle(FWD, sway));
    P.compose(pos.set(p.x + p.dx, (flail ? p.hop : Math.sin((Math.PI * p.hop) / 0.5) * 0.45) + Math.abs(p.tilt) * 0.12 + bob - sit * (0.82 * p.h - 0.54), p.z + p.dz), q, sc.set(p.h, p.h * fade, p.h));
    pose(SLOT.top, P);
    pose(SLOT.carry, P, !!L.carry);
    // Their head turns to look (at you, at a window) about the neck; a kid's head is big for their size.
    M.multiplyMatrices(P, T.makeTranslation(0, 1.5, 0)).multiply(R.makeRotationY(p.look + (p.at?.kind === 'look' ? Math.sin(t * 0.5) * 0.3 : 0)));
    if (L.build === 'kid') M.multiply(T.makeScale(1.2, 1.2, 1.2));
    M.multiply(T.makeTranslation(0, -1.5, 0));
    pose(SLOT.head, M);
    pose(SLOT.hair, M, !!L.hair);
    pose(SLOT.hat, M, !!L.hat);
    const chat = p.state === 'idle' && p.pair >= 0 && p.at?.kind !== 'bus';
    const phone = p.state === 'idle' && p.at?.kind === 'bus';
    for (let a = 0; a < 2; a++) {
      const sd = a ? -1 : 1;
      const w = Math.sin(w0 + (a ? Math.PI : 0));
      const leg = flail ? Math.sin(p.phase * 3 + a * 2) * 0.9 : sit > 0 ? -1.3 * sit + (stepping ? w * 0.65 * (1 - sit) : 0) : stepping ? w * (jog ? 0.95 : 0.65) : 0;
      let arm = flail ? Math.sin(p.phase * 4 + a) * 1.4 : stepping ? -w * (jog ? 1.0 : 0.7) - (jog ? 0.6 : 0) : 0;
      if (!flail && !stepping) {
        if (chat) arm = a ? -1.1 + Math.sin(t * 2 + p.id) * 0.35 : 0.05;
        else if (phone) arm = a ? -1.5 : 0.05;
        else if (p.state === 'wait') arm = -0.25 + Math.sin(t * 1.3 + a) * 0.06;
        else if (sit > 0) arm = -0.7 * sit;
      }
      M.multiplyMatrices(P, T.makeTranslation(sd * 0.12, 0.82, 0)).multiply(R.makeRotationX(leg));
      pose(SLOT.leg + a, M);
      M.multiplyMatrices(P, T.makeTranslation(sd * 0.28, 1.36, 0)).multiply(R.makeRotationX(arm));
      pose(SLOT.arm + a, M);
      pose(SLOT.hand + a, M);
    }
    qt.setFromAxisAngle(UP, p.dogYaw);
    pose(SLOT.dog, M.compose(pos.set(p.dogX, moving ? Math.abs(Math.sin(t * 9)) * 0.03 : 0, p.dogZ), qt, sc.set(1, 1, 1)), p.dog);
  }

  const life: StreetLife = {
    group,
    vehicles,
    people,
    update(t, dt, night, near, avoid = [], hour = hourAt(t, -new Date().getTimezoneOffset())) {
      dt = Math.min(dt, 0.2);
      clock = t;
      hourNow.v = hour;
      const far = Math.min(tick(dt), 0.25);
      // Lights are on all day but only show at night.
      lampMat.color.setScalar(0.7 + 0.3 * night);
      const keepClear: Body[] = (avoid.length ? avoid : [{ x: near.x, z: near.z, vx: 0, vz: 0 }]).map(avoidBody);
      const cars: Avoid[] = [...avoid];
      const first = !started;
      if (first) {
        // First time: the streets are already busy.
        started = true;
        for (const v of vehicles) place(v, near, 15, SPAWN_R, t);
        for (const p of people) if (p.pair < 0 || p.id % 2 === 0) placePerson(p, near, 12, SPAWN_R, t);
      }
      for (const v of vehicles) {
        const gh = v.gj >= 0 ? ghostCars()[v.gj] : null;
        const away = Math.hypot(v.x - near.x, v.z - near.z);
        // Gone from the road when it's too far, or (out of your sight) when it's not a busy hour for it.
        if (v.on && (away > CULL_R || (gh && away > SPAWN_MIN && !carOut(gh, hour)))) release(v);
        if (v.on && gh) {
          const P = loopLength(gh.loop);
          const lag = ((carProgress(gh, t) - v.S + P * 1.5) % P) - P / 2;
          // Far behind (or ahead of) its ghost: a clock that jumped, or a long queue it lost its place in. Back on its ghost if nobody's close, or off the road for a fresh one if it's hopeless.
          if (Math.abs(lag) > 150) release(v);
          else if (Math.abs(lag) > 30 && away > NEAR_R) seat(v, gh, t, near);
        }
        if (!v.on) {
          // Looking for a ghost is a scan of them all: not every frame.
          if ((vRetry[v.id] -= dt) > 0 || !place(v, near, SPAWN_MIN, SPAWN_R, t)) {
            if (vRetry[v.id] <= 0) vRetry[v.id] = 0.5 + (v.id % 5) * 0.1;
            continue;
          }
        }
        if (v.v > 3) cars.push({ x: v.x, z: v.z, vx: Math.sin(v.yaw) * v.v, vz: Math.cos(v.yaw) * v.v });
        const step = Math.hypot(v.x - near.x, v.z - near.z) < NEAR_R ? dt : far;
        if (step > 0) stepVehicle(v, step, t, keepClear);
      }
      for (const p of people) {
        if (p.pair >= 0 && p.id % 2 === 1) continue;
        if (p.on && Math.hypot(p.x - near.x, p.z - near.z) > CULL_R) retire(p);
        if (!p.on) {
          if ((p.retry -= dt) > 0) continue;
          if (!placePerson(p, near, SPAWN_MIN, SPAWN_R, t)) p.retry = 0.6 + (p.id % 7) * 0.1;
        }
      }
      // Cars that are stopped or slow don't scare anyone; the ones going fast do.
      for (const lead of [true, false]) {
        for (const p of people) {
          if (!p.on || (p.pair >= 0 && p.id % 2 === 1) === lead) continue;
          const step = Math.hypot(p.x - near.x, p.z - near.z) < NEAR_R ? dt : far;
          if (step > 0) stepPerson(p, step, t, cars, near);
        }
      }
      for (const v of vehicles) writeVehicle(v, dt);
      // Emergency lights take turns, red and blue (or one then the other).
      const flash = Math.floor(t * 4) % 2;
      for (const v of vehicles) {
        const i = v.id * LAMPS;
        TAIL.set(v.braking ? '#ff3030' : night > 0.3 ? '#c81e1e' : '#8a2a2a');
        lamps.setColorAt(i, HEAD);
        lamps.setColorAt(i + 1, HEAD);
        lamps.setColorAt(i + 2, TAIL);
        lamps.setColorAt(i + 3, TAIL);
        vlooks[v.kind].beacons.forEach((b, k) => lamps.setColorAt(i + 4 + k, k === flash ? (b.color === 'red' ? RED : BLUE) : DIM));
      }
      for (const p of people) writePerson(p);
      for (const m of [lamps]) {
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
        const ax = d > 0.05 ? (p.x + p.dx - at.x) / d : Math.sin(roll(p.seed, p.id));
        const az = d > 0.05 ? (p.z + p.dz - at.z) / d : Math.cos(roll(p.seed, p.id));
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
