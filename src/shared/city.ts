// The city's street grid, shared by the page that draws it (client/world/city.ts), the street life
// on it (traffic, people on the sidewalks) and the office that checks where a driver says they are.
// Streets run down x = STREET_X + PERIOD·k and z = STREET_Z + PERIOD·k; the one past the garage is
// z = STREET_Z (layout.ts ROAD).
//
// Everything here is plain numbers, no three.js: the lots and parks laid out (cityLayout), the lamps
// and signals along the streets, where a car can go (cityPaved) and what's in its way (citySolids).

import { GOLF_HOLE } from './layout.js';
import { placeDressing, type Dressing } from './dressing.js';
import { VENUES, VENUE_DOORS, venueWalls } from './venues.js';

/** A block and the street beside it (m). */
export const PERIOD = 56;
export const STREET_X = 28;
export const STREET_Z = 27;
/** The road's width, and a sidewalk either side of it. */
export const ROAD_W = 8;
export const WALK = 2;
/** How far out the city goes: past this the haze has it anyway. */
export const RADIUS = 330;
/** The lots and parks between the streets are this wide (m). */
export const INNER = PERIOD - ROAD_W - WALK * 2;

/** The same numbers every time for a seed, so everyone sees the same city. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Somewhere flat on the ground, x and z (the same shape as garage.ts Box). */
export interface Area {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const rect = (x: number, z: number, w: number, d: number): Area => ({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
const touches = (a: Area, b: Area) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
const hash = (...n: number[]) => n.reduce((h, v) => Math.imul(h ^ (v + 0x9e3779b9), 0x85ebca6b) >>> 0, 2166136261);

// ---- The hand-built streetscape round the office -------------------------------------------------

/**
 * The neighbours' buildings round the office, hand-placed (client/world/outside.ts draws them, the
 * golf ball bounces off them): [x, z, width, height, depth, paint]. The city leaves their lots to them.
 */
export const NEIGHBOURS: readonly (readonly [number, number, number, number, number, string])[] = [
  [-40, 45, 11, 10, 9, '#8ecae6'],
  [-18, 46, 6, 16, 10, '#ffb4a2'],
  [12, 47, 16, 19, 12, '#cdb4db'],
  [40, 45, 11, 9, 9, '#ffd6a5'],
  [-12, -42, 18, 14, 10, '#a2d2ff'],
  [8, -44, 16, 20, 12, '#f4acb7'],
  [-48, -6, 10, 12, 16, '#ffe5b4'],
  [50, 4, 10, 15, 18, '#bde0fe'],
];

/** Which way a neighbour at (x, z) is turned: its front to the office. */
export const neighbourFacing = (x: number, z: number) => (Math.abs(x) > 40 ? (x > 0 ? -Math.PI / 2 : Math.PI / 2) : z > 0 ? Math.PI : 0);

/** A neighbour's footprint. Turned a quarter, its width runs along z. */
export function neighbourArea(n: (typeof NEIGHBOURS)[number]): Area {
  const [x, z, w, , d] = n;
  return Math.abs(Math.sin(neighbourFacing(x, z))) > 0.5 ? rect(x, z, d, w) : rect(x, z, w, d);
}

/**
 * Where the garage's own lots are (garage.ts LOT and SIDE_LOT, out to the sidewalk), and the row of
 * hand-placed street lamps out front (outside.ts, x from -40 to 40): the city puts no lamps, signals
 * or benches of its own there.
 */
const CLEAR: Area[] = [
  { minX: -31, maxX: 31, minZ: 12, maxZ: 23 },
  { minX: 17, maxX: 31, minZ: -16, maxZ: 18 },
  { minX: -46, maxX: 46, minZ: 20, maxZ: 34 },
];
export const keepClear = (x: number, z: number) => CLEAR.some((a) => x > a.minX && x < a.maxX && z > a.minZ && z < a.maxZ);

/** The block behind the office, east of it, left open as a paved plaza with the gate to the race circuit on it (circuit.ts). */
export const RACE_PLAZA: Area = rect(STREET_X + PERIOD / 2, STREET_Z - PERIOD * 1.5, INNER, INNER);

// ---- The lots ------------------------------------------------------------------------------------

/** What kind of building stands on a lot (client/world/city.ts dresses each). */
export type LotKind = 'block' | 'glass' | 'shop' | 'walkup' | 'house' | 'gas' | 'deck';

/**
 * A building on a lot, as it was laid out round a roof six floors up. How much of that height it
 * stands depends on how far out it is (`ring`: close by, further out, or on the skyline).
 */
export interface Lot {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  /** An index into the client's paints (0–8: the first seven are for walls, the last two glass towers). */
  paint: number;
  /** Where its lit windows start in the pattern. */
  ou: number;
  ov: number;
  ring: 0 | 1 | 2;
  kind: LotKind;
  /** Which way its front faces, toward the street it's nearest: one of them is 0, the other ±1. */
  fx: number;
  fz: number;
  /** The whole plot it stands on (what's left when the block is split up). */
  plot: Area;
  /** On a neighbour's or the golf hole's lot, round the office: only the roof's view has this one (the street has the hand-built ones). */
  hand: boolean;
  /** A house's tree in the yard, if it has one. */
  yard?: { x: number; z: number; s: number; tone: 0 | 1 };
  /** Tall ones step back on the way up: the top part's footprint, and how much taller it goes. */
  step?: { w: number; d: number; up: number };
  /** On its roof: a mast with a red light, a water tower, or a box of air conditioning. */
  top?: { kind: 'mast' } | { kind: 'tank'; x: number; z: number } | { kind: 'plant'; x: number; z: number; w: number; d: number };
}

export interface Park {
  x: number;
  z: number;
  size: number;
  trees: { x: number; z: number; s: number; tone: 0 | 1 }[];
}

/** The gas station: its forecourt (all of `plot`), the canopy over the pumps, and the pumps. The shop is the lot. */
export interface GasStation {
  plot: Area;
  canopy: Area;
  pumps: Area[];
  /** The price sign's pole. */
  sign: { x: number; z: number };
  /** Which way the front faces (see Lot). */
  fx: number;
  fz: number;
}

export interface CityLayout {
  lots: Lot[];
  parks: Park[];
  gas: GasStation | null;
  /** How many numbers the layout took from `rng(20260927)`: the roof's own dice carry on after those. */
  draws: number;
}

/** The two glass-tower paints. */
const GLASS_TOWERS = [7, 8];
/** Houses go on blocks from this far out, shops on the ones closer than SHOPS_TO. */
const HOUSES_FROM = 230;
const SHOPS_TO = 200;

let laid: CityLayout | null = null;

/**
 * The whole city's blocks, laid out once and the same every time (pure, no three.js). Heights are as
 * they'd be round a roof six floors up: the roof's view lowers the near ones (client/world/city.ts).
 */
export function cityLayout(): CityLayout {
  if (laid) return laid;
  let draws = 0;
  const base = rng(20260927);
  const r = () => (draws++, base());
  const lots: Lot[] = [];
  const parks: Park[] = [];
  const handBuilt: Area[] = [
    ...NEIGHBOURS.map((n) => {
      const a = neighbourArea(n);
      return { minX: a.minX - 3, maxX: a.maxX + 3, minZ: a.minZ - 3, maxZ: a.maxZ + 3 };
    }),
    // The golf hole across the street: its fairway and green, and the trees behind it.
    { minX: GOLF_HOLE.x - 16, maxX: GOLF_HOLE.x + 20, minZ: 33, maxZ: GOLF_HOLE.z + 16 },
    // W6: the café and the bar (shared/venues.ts), and their terraces: client/world/venues.ts builds them.
    ...VENUES.map((v) => ({ minX: Math.min(v.box.minX, v.terrace.minX), maxX: Math.max(v.box.maxX, v.terrace.maxX), minZ: Math.min(v.box.minZ, v.terrace.minZ), maxZ: Math.max(v.box.maxZ, v.terrace.maxZ) })),
  ];
  const n = Math.ceil(RADIUS / PERIOD) + 1;
  const inner = INNER;
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      const bx = STREET_X - PERIOD / 2 + i * PERIOD;
      const bz = STREET_Z - PERIOD / 2 + j * PERIOD;
      const dist = Math.hypot(bx, bz);
      if (dist > RADIUS) continue;
      // The block the office stands on: a plaza round it.
      if (i === 0 && j === 0) continue;
      // Now and then a park, with trees.
      if (r() < 0.1 && dist > 60) {
        const park: Park = { x: bx, z: bz, size: inner, trees: [] };
        for (let k = 0; k < 7; k++) {
          const s = 0.8 + r() * 0.7;
          const tone = r() < 0.5 ? 0 : 1;
          park.trees.push({ s, tone, x: bx + (r() - 0.5) * (inner - 6), z: bz + (r() - 0.5) * (inner - 6) });
        }
        parks.push(park);
        continue;
      }
      // The block split into lots: one big one, two halves or four quarters.
      const split = r();
      const plots: [number, number, number, number][] = [];
      const gap = 2;
      if (split < 0.25) plots.push([bx, bz, inner, inner]);
      else if (split < 0.6) {
        const w = (inner - gap) / 2;
        const alongX = r() < 0.5;
        for (const s of [-1, 1]) plots.push(alongX ? [bx + (s * (w + gap)) / 2, bz, w, inner] : [bx, bz + (s * (w + gap)) / 2, inner, w]);
      } else {
        const w = (inner - gap) / 2;
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) plots.push([bx + (sx * (w + gap)) / 2, bz + (sz * (w + gap)) / 2, w, w]);
      }
      // Lower than the roof round about, so you see out over them; taller further out, and tallest
      // downtown, off to the north-east, where the skyline is.
      const downtown = Math.max(0, 1 - Math.hypot(bx - 210, bz + 220) / 150);
      for (const [lx, lz, lw, ld] of plots) {
        const back = 1 + r() * 3;
        const w = lw - back * 2;
        const d = ld - back * 2;
        if (w < 6 || d < 6) continue;
        let h: number;
        if (dist < 100) h = 9 + r() * 24 + (r() < 0.1 ? 8 : 0);
        else if (dist < 190) h = r() < 0.1 ? 50 + r() * 40 : 12 + r() * 28;
        else h = r() < 0.2 ? 65 + r() * 95 : 20 + r() * 30;
        h *= 1 + downtown * 1.3;
        const glassy = h > 70 && r() < 0.6;
        const paint = glassy ? GLASS_TOWERS[Math.floor(r() * GLASS_TOWERS.length)] : Math.floor(r() * 7);
        const lot: Lot = {
          x: lx,
          z: lz,
          w,
          d,
          h,
          paint,
          ou: Math.floor(r() * 16),
          ov: Math.floor(r() * 16),
          ring: dist < 100 ? 0 : dist < 190 ? 1 : 2,
          kind: glassy ? 'glass' : 'block',
          fx: 0,
          fz: 0,
          plot: rect(lx, lz, lw, ld),
          hand: false,
        };
        let tall = h;
        let tw = w;
        let td = d;
        // Tall ones step back once on the way up.
        if (h > 55 && r() < 0.6) {
          tw = w * (0.55 + r() * 0.25);
          td = d * (0.55 + r() * 0.25);
          lot.step = { w: tw, d: td, up: 12 + r() * h * 0.5 };
          tall += lot.step.up;
        }
        // On the roof: a water tower, a box of air conditioning, or a mast with a red light.
        const what = r();
        if (tall > 90) lot.top = { kind: 'mast' };
        else if (what < 0.3) lot.top = { kind: 'tank', x: lx + (r() - 0.5) * tw * 0.4, z: lz + (r() - 0.5) * td * 0.4 };
        else if (what < 0.65) {
          const pw = 3 + r() * 3;
          const pd = 2 + r() * 2;
          lot.top = { kind: 'plant', w: pw, d: pd, x: lx + (r() - 0.5) * tw * 0.4, z: lz + (r() - 0.5) * td * 0.4 };
        }
        // Everything from here on has its own dice, so the layout above stays as it was.
        const k = rng(hash(i, j, Math.round(lx), Math.round(lz)));
        const dx = lx - bx;
        const dz = lz - bz;
        if (Math.abs(dx) > Math.abs(dz) + 0.01) lot.fx = Math.sign(dx);
        else if (Math.abs(dz) > Math.abs(dx) + 0.01) lot.fz = Math.sign(dz);
        else if ((i + j) & 1) lot.fx = k() < 0.5 ? -1 : 1;
        else lot.fz = k() < 0.5 ? -1 : 1;
        lot.hand = handBuilt.some((a) => touches(a, rect(lx, lz, lw, ld)));
        const kr = k();
        if (glassy) lot.kind = 'glass';
        else if (dist >= HOUSES_FROM && h < 45 && kr < 0.5) {
          // A low house with a pitched roof at the outskirts, on a smaller footprint.
          lot.kind = 'house';
          lot.w = Math.min(w, 13 + k() * 3);
          lot.d = Math.min(d, 11 + k() * 3);
          lot.h = 5.5 + k() * 2;
          delete lot.step;
          delete lot.top;
          if (k() < 0.65) {
            const side = k() < 0.5 ? -3.5 : 3.5;
            lot.yard = { x: lot.x + lot.fx * (lot.w / 2 + 3) + lot.fz * side, z: lot.z + lot.fz * (lot.d / 2 + 3) + lot.fx * 3.5, s: 0.9 + k() * 0.4, tone: k() < 0.5 ? 0 : 1 };
          }
        } else if (dist < SHOPS_TO && h < 34) lot.kind = kr < 0.55 ? 'shop' : kr < 0.8 ? 'walkup' : 'block';
        lots.push(lot);
      }
    }
  }

  // The race circuit's plaza stays open, for the gate (see circuit.ts CITY_GATE): the dice above are thrown all the same.
  for (let k = lots.length - 1; k >= 0; k--) if (touches(lots[k].plot, RACE_PLAZA)) lots.splice(k, 1);
  for (let k = parks.length - 1; k >= 0; k--) if (touches(rect(parks[k].x, parks[k].z, parks[k].size, parks[k].size), RACE_PLAZA)) parks.splice(k, 1);

  // One gas station and one parking structure, on the lots nearest the distance they look best at.
  const pick = (min: number, from: number, to: number, target: number) => {
    let best: Lot | null = null;
    for (const l of lots) {
      const dist = Math.hypot(l.x, l.z);
      if (l.hand || l.kind === 'house' || l.kind === 'glass' || dist < from || dist > to || Math.min(l.plot.maxX - l.plot.minX, l.plot.maxZ - l.plot.minZ) < min) continue;
      if (!best || Math.abs(dist - target) < Math.abs(Math.hypot(best.x, best.z) - target)) best = l;
    }
    return best;
  };
  let gas: GasStation | null = null;
  const station = pick(20, 80, 200, 120);
  if (station) {
    const p = station.plot;
    const { fx, fz } = station;
    const cx = (p.minX + p.maxX) / 2;
    const cz = (p.minZ + p.maxZ) / 2;
    const D = fz ? p.maxZ - p.minZ : p.maxX - p.minX;
    // Local (u along the street, v back from it) to a spot on the ground; and a box in those.
    const at = (u: number, v: number) => (fz ? { x: cx + u, z: cz + fz * (D / 2 - v) } : { x: cx + fx * (D / 2 - v), z: cz + u });
    const box = (u0: number, u1: number, v0: number, v1: number): Area => {
      const a = at(u0, v0);
      const b = at(u1, v1);
      return { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) };
    };
    const v0 = Math.min(D - 8, 16);
    const shop = box(-6, 6, v0, v0 + 5);
    station.kind = 'gas';
    station.x = (shop.minX + shop.maxX) / 2;
    station.z = (shop.minZ + shop.maxZ) / 2;
    station.w = shop.maxX - shop.minX;
    station.d = shop.maxZ - shop.minZ;
    station.h = 4.4;
    delete station.step;
    delete station.top;
    const sign = { x: fz ? p.minX + 2 : fx > 0 ? p.maxX - 1.5 : p.minX + 1.5, z: fx ? p.minZ + 2 : fz > 0 ? p.maxZ - 1.5 : p.minZ + 1.5 };
    gas = { plot: p, canopy: box(-7, 7, 4, 12), pumps: [-4.5, 0, 4.5].map((u) => box(u - 0.4, u + 0.4, 7.4, 9.4)), sign, fx, fz };
  }
  const deck = pick(20, 100, 220, 170);
  if (deck && deck !== station) {
    deck.kind = 'deck';
    deck.h = 3.3 * (3 + Math.floor(rng(hash(Math.round(deck.x), Math.round(deck.z)))() * 3));
    delete deck.step;
    delete deck.top;
  }
  return (laid = { lots, parks, gas, draws });
}

// ---- Lamps, signals and street furniture ---------------------------------------------------------

/** A street lamp on a sidewalk, its arm reaching out toward the road along (ax, az). */
export interface StreetLamp {
  x: number;
  z: number;
  ax: number;
  az: number;
  /** A hand-placed lamp (outside.ts) or the garage's lot is here already: only the roof's view has this one. */
  hand: boolean;
}

/** A signal pole on a corner of an intersection, its head facing (fx, fz) toward the traffic it stops. */
export interface SignalPole {
  x: number;
  z: number;
  fx: number;
  fz: number;
  /** Which way the traffic runs that it stops: 'x' (east–west) or 'z'. */
  axis: 'x' | 'z';
  /** The intersection's place in the grid (see lightPhase). */
  i: number;
  j: number;
}

export interface Prop {
  kind: 'bench' | 'bin' | 'hydrant';
  x: number;
  z: number;
  /** About the vertical, so its front (local +z) faces the road. */
  rot: number;
}

export interface Intersection {
  i: number;
  j: number;
  x: number;
  z: number;
}

export interface Streetscape {
  intersections: Intersection[];
  lamps: StreetLamp[];
  poles: SignalPole[];
  props: Prop[];
}

/** Lamp posts and street furniture are drawn, and are solid, only this far from the origin (m); the lamps' glow goes on out to RADIUS. */
export const POST_RADIUS = 240;
export const PROP_RADIUS = 200;

let scape: Streetscape | null = null;

const R = Math.ceil(RADIUS / PERIOD) + 1;

/** The intersections, street lamps, signal poles and benches, bins and hydrants of the city, made once. */
export function cityStreetscape(): Streetscape {
  if (scape) return scape;
  const intersections: Intersection[] = [];
  const lamps: StreetLamp[] = [];
  const poles: SignalPole[] = [];
  const props: Prop[] = [];
  for (let i = -R; i <= R; i++) {
    for (let j = -R; j <= R; j++) {
      const x = STREET_X + i * PERIOD;
      const z = STREET_Z + j * PERIOD;
      if (Math.hypot(x, z) >= RADIUS) continue;
      intersections.push({ i, j, x, z });
      // A pole on each corner, its head facing the traffic it's for: on the far side of the crossing,
      // on the driver's right (right-hand traffic).
      const d = ROAD_W / 2 + 1;
      poles.push({ x: x + d, z: z + d, fx: -1, fz: 0, axis: 'x', i, j }, { x: x - d, z: z - d, fx: 1, fz: 0, axis: 'x', i, j });
      poles.push({ x: x - d, z: z + d, fx: 0, fz: -1, axis: 'z', i, j }, { x: x + d, z: z - d, fx: 0, fz: 1, axis: 'z', i, j });
    }
  }
  // Lamps down both sides of every street, every 28 m, all the way out.
  for (let k = -R; k <= R; k++) {
    for (let a = -RADIUS; a <= RADIUS; a += 28) {
      for (const s of [-1, 1]) {
        const off = s * (ROAD_W / 2 + 0.6);
        const sx = STREET_X + k * PERIOD;
        const sz = STREET_Z + k * PERIOD;
        // Not past the ring road (see GRID): that's grass, and then the beach.
        const inGrid = (x: number, z: number) => x > GRID.minX && x < GRID.maxX && z > GRID.minZ && z < GRID.maxZ;
        if (Math.hypot(sx + off, a) < RADIUS && inGrid(sx + off, a)) lamps.push({ x: sx + off, z: a, ax: -s, az: 0, hand: keepClear(sx + off, a) });
        if (Math.hypot(a, sz + off) < RADIUS && inGrid(a, sz + off)) lamps.push({ x: a, z: sz + off, ax: 0, az: -s, hand: keepClear(a, sz + off) });
      }
    }
  }
  // A bench, a bin and a hydrant along the sidewalks of the blocks, now and then.
  const mid = ROAD_W / 2 + WALK / 2;
  for (let i = -R; i <= R; i++) {
    for (let j = -R; j <= R; j++) {
      const bx = STREET_X - PERIOD / 2 + i * PERIOD;
      const bz = STREET_Z - PERIOD / 2 + j * PERIOD;
      if (Math.hypot(bx, bz) > RADIUS - 30) continue;
      const k = rng(hash(i, j, 77));
      // The sidewalk along a block's side: along x or z, and which way the road is from it (±1).
      for (const [alongX, sign] of [
        [true, -1],
        [true, 1],
        [false, -1],
        [false, 1],
      ] as const) {
        const line = (alongX ? bz : bx) + sign * (PERIOD / 2 - mid);
        const rot = alongX ? (sign < 0 ? Math.PI : 0) : sign < 0 ? -Math.PI / 2 : Math.PI / 2;
        const put = (kind: Prop['kind'], u: number) => {
          const p = alongX ? { x: bx + u, z: line } : { x: line, z: bz + u };
          if (!keepClear(p.x, p.z) && Math.hypot(p.x, p.z) <= PROP_RADIUS) props.push({ kind, ...p, rot });
        };
        if (k() < 0.4) put('bench', -9 + k() * 4);
        if (k() < 0.55) put('bin', 8 + k() * 4);
        if (k() < 0.45) put('hydrant', (k() < 0.5 ? -1 : 1) * 19);
      }
    }
  }
  return (scape = { intersections, lamps, poles, props });
}

// ---- The signals ---------------------------------------------------------------------------------

export type Light = 'green' | 'yellow' | 'red';

/**
 * What an intersection's signals show. `x` is the light for traffic running along x (east–west), `z`
 * for traffic along z; `walkX` is people walking along x (across the streets that run along z) being
 * allowed to go, `walkZ` the same across the ones along x. Never both directions green.
 *
 * The cycle is 40 seconds: x green 16, yellow 3, everything red 1, then z's turn. Walking is allowed
 * for the first 13 seconds of a green, and the light stays red for the traffic they cross a good
 * while after that (yellow and the red gap), so there's time to get over.
 */
export interface Phase {
  x: Light;
  z: Light;
  walkX: boolean;
  walkZ: boolean;
}

export const SIGNAL = { green: 16, yellow: 3, allRed: 1, walk: 13 } as const;
const CYCLE = 2 * (SIGNAL.green + SIGNAL.yellow + SIGNAL.allRed);

/** An intersection, by its place in the grid (0, 0 is where STREET_X and STREET_Z cross) or by where it is (x, z). */
export type IntersectionRef = { i: number; j: number } | { x: number; z: number };

const cell = (a: IntersectionRef) => ('i' in a ? { i: a.i, j: a.j } : { i: Math.round((a.x - STREET_X) / PERIOD), j: Math.round((a.z - STREET_Z) / PERIOD) });

/**
 * The signals at `at` at time `t` (seconds; the street uses Date.now() / 1000, so every page agrees).
 * Pure: the same answer for the same time. Neighbouring intersections are a few seconds out of step,
 * so the whole street doesn't go at once.
 */
export function lightPhase(t: number, at: IntersectionRef): Phase {
  const { i, j } = cell(at);
  const s = (((t + i * 7 + j * 13) % CYCLE) + CYCLE) % CYCLE;
  const { green, yellow, walk } = SIGNAL;
  const half = CYCLE / 2;
  const turn = (u: number): Light => (u < green ? 'green' : u < green + yellow ? 'yellow' : 'red');
  return s < half ? { x: turn(s), z: 'red', walkX: s < walk, walkZ: false } : { x: 'red', z: turn(s - half), walkX: false, walkZ: s - half < walk };
}

// ---- Where a car can go, and what's in the way ----------------------------------------------------

/** How far from a street's line its sidewalk goes out. */
const BAND = ROAD_W / 2 + WALK;
/** How far `v` is from the nearest of the streets, which are PERIOD apart from `line`. */
const across = (v: number, line: number) => {
  const m = (((v - line) % PERIOD) + PERIOD) % PERIOD;
  return Math.min(m, PERIOD - m);
};

/**
 * Whether (x, z) is out on the city's streets or sidewalks (the garage and its lots are garage.ts
 * PAVEMENT): not on anyone's lot, in a park or out past the last street. The gas station's forecourt
 * and the office's plaza count. A car can go further than this (see surfaceAt): this is what's paved.
 */
export function cityPaved(x: number, z: number): boolean {
  const s = surfaceAt(x, z);
  return s === 'road' || s === 'walk';
}

// ---- The island ----------------------------------------------------------------------------------

/**
 * The first and last street each way (the same streets street life drives: client/world/streetlife.ts
 * crossRange). The outermost ones make a ring road round the whole city, with grass, then a beach,
 * then the sea beyond it.
 */
const lineRange = (origin: number) => [origin + PERIOD * Math.ceil((-RADIUS - origin) / PERIOD), origin + PERIOD * Math.floor((RADIUS - origin) / PERIOD)] as const;
const [GX0, GX1] = lineRange(STREET_X);
const [GZ0, GZ1] = lineRange(STREET_Z);
/** The streets' square, out to the ring road's outer sidewalk. */
export const GRID: Area = { minX: GX0 - BAND, maxX: GX1 + BAND, minZ: GZ0 - BAND, maxZ: GZ1 + BAND };
/** The island is a rounded square (a superellipse this big across its middle), wobbling a little. */
const ISLAND = 390;
const ROUND = 4;
/** At least this much grass past the ring road, even at the corners. */
const VERGE = 12;
/** How wide the beach is, give or take its wobble. */
const BEACH = 26;

/** The coast's wobbles: the same every time (seeded), a few long ones and a few short. */
const WOBBLE = (() => {
  const r = rng(20261001);
  return [2, 3, 5, 7, 11].map((k) => ({ k, a: (18 / k) * (0.6 + r() * 0.8), p: r() * Math.PI * 2 }));
})();
const SANDS = (() => {
  const r = rng(20261002);
  return [3, 4, 9].map((k) => ({ k, a: (9 / Math.sqrt(k)) * (0.6 + r() * 0.8), p: r() * Math.PI * 2 }));
})();

/** How far out, along the way (cos, sin) points from the middle, the grass ends and the sand starts. */
function landAt(c: number, s: number, th: number): number {
  const ac = Math.abs(c);
  const as = Math.abs(s);
  const round = ISLAND / (ac ** ROUND + as ** ROUND) ** (1 / ROUND);
  let w = 0;
  for (const o of WOBBLE) w += o.a * Math.sin(o.k * th + o.p);
  // Never over the ring road: the streets' square along this way, and a verge of grass past it.
  const edge = Math.min(ac > 1e-9 ? (c > 0 ? GRID.maxX : -GRID.minX) / ac : Infinity, as > 1e-9 ? (s > 0 ? GRID.maxZ : -GRID.minZ) / as : Infinity);
  return Math.max(round + w, edge + VERGE);
}

function beachAt(th: number): number {
  let w = BEACH;
  for (const o of SANDS) w += o.a * Math.sin(o.k * th + o.p);
  return Math.max(14, w);
}

/**
 * The coast along angle `th` (radians, atan2(z, x)): how far out the grass ends (`land`) and the water
 * starts (`shore`). Pure; the page that draws the island and the physics agree on it.
 */
export function coastAt(th: number): { land: number; shore: number } {
  const land = landAt(Math.cos(th), Math.sin(th), th);
  return { land, shore: land + beachAt(th) };
}

/** Everywhere inside this is land for sure (the coast is never nearer), so most asks skip the trigonometry. */
/** Nearer the middle than this, it's land whichever way you look (the coast is never nearer): radial, as the coast is. */
const SURELY_LAND = Math.min(GRID.maxX, -GRID.minX, GRID.maxZ, -GRID.minZ) + VERGE - 1;

/**
 * The pier, off the beach at the bottom of the street x = STREET_X, out over the water to the south:
 * boards you can walk and drive along (and drive off the end of).
 */
export const PIER = (() => {
  const shore = coastAt(-Math.PI / 2).shore;
  // Where the street's line meets the water, near enough (the coast barely bends over a few metres).
  const th = Math.atan2(-shore, STREET_X);
  const at = coastAt(th);
  const to = -at.shore - 70;
  // A rail down each side, from just before the water to the end (which is open).
  return { x: STREET_X, width: 6, from: -at.land - 4, to, rails: [-at.shore + 2, to + 0.3] as const };
})();

/** The lighthouse, on a point of the beach off the north-east corner, near downtown: its footprint's middle and radius. */
export const LIGHTHOUSE = (() => {
  const th = -Math.PI / 4;
  const { land, shore } = coastAt(th);
  const r = (land + shore) / 2 + 4;
  return { x: Math.cos(th) * r, z: Math.sin(th) * r, radius: 2.6 };
})();

export type Surface = 'road' | 'walk' | 'grass' | 'sand' | 'water';

/**
 * What's underfoot at (x, z): a road, a sidewalk (or the plaza, or the pier's boards), the grass of a
 * park or a lawn or the verge, the beach's sand, or the sea. Pure and quick: the physics ask it every
 * step, for the grip under the tires. Buildings stand on grass here: citySolids has them.
 */
export function surfaceAt(x: number, z: number): Surface {
  // Inside the streets' square it's the city's; past it, the verge, the beach or the sea (or the pier).
  if (x < GRID.minX || x > GRID.maxX || z < GRID.minZ || z > GRID.maxZ) {
    if (x >= PIER.x - PIER.width / 2 && x <= PIER.x + PIER.width / 2 && z <= PIER.from && z >= PIER.to) return 'walk';
    const r = Math.hypot(x, z);
    if (r <= SURELY_LAND) return 'grass';
    const th = Math.atan2(z, x);
    const land = landAt(x / r, z / r, th);
    return r <= land ? 'grass' : r > land + beachAt(th) ? 'water' : 'sand';
  }
  const ax = across(x, STREET_X);
  const az = across(z, STREET_Z);
  if (ax <= ROAD_W / 2 || az <= ROAD_W / 2) return 'road';
  if (ax <= BAND || az <= BAND) return 'walk';
  // The race plaza, with the gate to the circuit on it (client/world/circuit.ts).
  if (x >= RACE_PLAZA.minX && x <= RACE_PLAZA.maxX && z >= RACE_PLAZA.minZ && z <= RACE_PLAZA.maxZ) return 'walk';
  const g = cityLayout().gas?.plot;
  if (g && x >= g.minX && x <= g.maxX && z >= g.minZ && z <= g.maxZ) return 'road';
  // The office's block is its plaza, paved all over.
  if (Math.abs(x - (STREET_X - PERIOD / 2)) <= INNER / 2 && Math.abs(z - (STREET_Z - PERIOD / 2)) <= INNER / 2) return 'walk';
  return 'grass';
}

/**
 * Where you come back after going into the sea at (x, z): a car on the nearest road, on the cross
 * street just in from the ring road, in its right-hand lane and facing inland; on foot (`onFoot`),
 * up the beach from where you went in, facing inland. Pure, so the office can check it too.
 */
export function shoreRespawn(x: number, z: number, onFoot = false): { x: number; z: number; rotY: number } {
  if (onFoot) {
    const th = Math.atan2(z, x);
    const { land, shore } = coastAt(th);
    const r = land + (shore - land) * 0.35;
    // rotY 0 faces +z: facing the middle.
    return { x: Math.cos(th) * r, z: Math.sin(th) * r, rotY: Math.atan2(-Math.cos(th), -Math.sin(th)) };
  }
  return shoreRespawns(x, z)[0];
}

/**
 * Every spot a car out of the sea at (x, z) can come back to, best first: in the right-hand lane of
 * the cross street nearest it, just in from the ring road on the side it went in off, facing inland;
 * then further in along that street; then the streets either side. The driver's page takes the first
 * one with room (a parked car or traffic may be on it), and the office accepts only these.
 */
export function shoreRespawns(x: number, z: number): { x: number; z: number; rotY: number }[] {
  // Which side of the ring road it's off: the one it's furthest past (or nearest to, from inside).
  const past = [x - GX1, GX0 - x, z - GZ1, GZ0 - z];
  const side = past.indexOf(Math.max(...past));
  const LANE = ROAD_W / 4;
  const alongX = side < 2;
  const [origin, lo, hi, v] = alongX ? [STREET_Z, GZ0, GZ1, z] : [STREET_X, GX0, GX1, x];
  const k = Math.min((hi - origin) / PERIOD, Math.max((lo - origin) / PERIOD, Math.round((v - origin) / PERIOD)));
  const lines = [k, k + 1, k - 1]
    .map((n) => origin + PERIOD * n)
    .filter((l) => l >= lo && l <= hi)
    .sort((a, b) => Math.abs(a - v) - Math.abs(b - v));
  const out: { x: number; z: number; rotY: number }[] = [];
  // Right-hand traffic: heading +x you keep to +z, -x to -z; heading +z to -x, -z to +x.
  for (const line of lines) {
    for (const IN of [16, 26, 36, 46]) {
      if (side === 0) out.push({ x: GX1 - IN, z: line - LANE, rotY: -Math.PI / 2 });
      else if (side === 1) out.push({ x: GX0 + IN, z: line + LANE, rotY: Math.PI / 2 });
      else if (side === 2) out.push({ x: line + LANE, z: GZ1 - IN, rotY: Math.PI });
      else out.push({ x: line - LANE, z: GZ0 + IN, rotY: 0 });
    }
  }
  return out;
}

/**
 * Where a car last seen on land at (x, z) can have come back to out of the sea: every spot of
 * shoreRespawns for the water near it (it went in within a few metres, and drifted a little).
 */
export function seaRespawnsFrom(x: number, z: number): { x: number; z: number; rotY: number }[] {
  const out: { x: number; z: number; rotY: number }[] = [];
  for (const r of [0, 4, 8, 14, 22, 32]) {
    for (let a = 0; a < (r ? 16 : 1); a++) {
      const qx = x + Math.cos((a / 16) * Math.PI * 2) * r;
      const qz = z + Math.sin((a / 16) * Math.PI * 2) * r;
      if (surfaceAt(qx, qz) === 'water') out.push(...shoreRespawns(qx, qz));
    }
  }
  return out;
}

/** How wide the gaps in a park's hedge are, where its two paths come out on each side: room for a car. */
export const PARK_GATE = 6;

/** A park's hedge, all round it but for a gap at the end of each path: eight boxes. */
export function parkHedges(p: Park): Area[] {
  const h = p.size / 2;
  const k = 0.5;
  const g = PARK_GATE / 2;
  const out: Area[] = [];
  for (const [a0, a1] of [[-h, -g], [g, h]]) {
    out.push({ minX: p.x + a0, maxX: p.x + a1, minZ: p.z - h, maxZ: p.z - h + k });
    out.push({ minX: p.x + a0, maxX: p.x + a1, minZ: p.z + h - k, maxZ: p.z + h });
    out.push({ minX: p.x - h, maxX: p.x - h + k, minZ: p.z + a0, maxZ: p.z + a1 });
    out.push({ minX: p.x + h - k, maxX: p.x + h, minZ: p.z + a0, maxZ: p.z + a1 });
  }
  return out;
}

const CELL = 24;
/** How tall a solid is (m), for people on foot: a hedge or a bench can be hopped, a building can't. */
const heights = new WeakMap<Area, number>();
const TALL = 100;
export const solidHeight = (a: Area): number => heights.get(a) ?? TALL;
let index: Map<number, Area[]> | null = null;
const cellKey = (cx: number, cz: number) => (cx + 4096) * 8192 + (cz + 4096);

/** Everything a car bumps into, in a spatial hash: buildings, park kerbs and trunks, lamps, signals, benches. */
function solids(): Map<number, Area[]> {
  if (index) return index;
  const map = new Map<number, Area[]>();
  const add = (a: Area, h = TALL) => {
    heights.set(a, h);
    for (let cx = Math.floor(a.minX / CELL); cx <= Math.floor(a.maxX / CELL); cx++) {
      for (let cz = Math.floor(a.minZ / CELL); cz <= Math.floor(a.maxZ / CELL); cz++) {
        const k = cellKey(cx, cz);
        const list = map.get(k);
        if (list) list.push(a);
        else map.set(k, [a]);
      }
    }
  };
  const post = (x: number, z: number, r: number) => add({ minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r });
  const { lots, parks, gas } = cityLayout();
  for (const l of lots) {
    if (l.hand) continue;
    add(rect(l.x, l.z, l.w, l.d));
    if (l.yard) post(l.yard.x, l.yard.z, 0.3 * l.yard.s);
  }
  for (const n of NEIGHBOURS) add(neighbourArea(n));
  // The café's and the bar's walls: hollow, the doorway open (shared/venues.ts).
  for (const v of VENUES) for (const w of venueWalls(v)) add(w);
  if (gas) {
    for (const p of gas.pumps) add(p);
    // The canopy's two posts, at its far corners.
    post(gas.canopy.minX + 0.3, gas.canopy.minZ + 0.3, 0.3);
    post(gas.canopy.maxX - 0.3, gas.canopy.maxZ - 0.3, 0.3);
    post(gas.sign.x, gas.sign.z, 0.12);
  }
  for (const p of parks) {
    // A hedge round the park, open where its paths come out, and the trees' trunks.
    for (const a of parkHedges(p)) add(a, 0.6);
    for (const t of p.trees) post(t.x, t.z, 0.3 * t.s);
  }
  post(LIGHTHOUSE.x, LIGHTHOUSE.z, LIGHTHOUSE.radius);
  for (const s of [-1, 1]) {
    const x = PIER.x + s * (PIER.width / 2 - 0.1);
    add({ minX: x - 0.1, maxX: x + 0.1, minZ: PIER.rails[1], maxZ: PIER.rails[0] });
  }
  const s = cityStreetscape();
  for (const l of s.lamps) if (!l.hand && Math.hypot(l.x, l.z) <= POST_RADIUS) post(l.x, l.z, 0.2);
  for (const p of s.poles) post(p.x, p.z, 0.2);
  for (const p of s.props) {
    if (p.kind === 'bench') {
      const alongZ = Math.abs(Math.sin(p.rot)) > 0.5;
      add(rect(p.x, p.z, alongZ ? 0.6 : 1.7, alongZ ? 1.7 : 0.6), 0.5);
    } else add(rect(p.x, p.z, p.kind === 'bin' ? 0.6 : 0.4, p.kind === 'bin' ? 0.6 : 0.4), p.kind === 'bin' ? 0.9 : 0.6);
  }
  // Signs, parasols, flagpoles: placed against what's above, and their poles are solid too.
  index = map;
  try {
    dressed = placeDressing((x, z, r) => !citySolids(x, z, r).some((a) => x + r > a.minX && x - r < a.maxX && z + r > a.minZ && z - r < a.maxZ));
    for (const d of dressed.solids) add(d.area, d.h);
  } catch (err) {
    // The street goes undressed rather than cityDressing() staying null for good.
    console.error("the street dressing couldn't be placed", err);
    dressed ??= { items: [], birds: [], solids: [] };
  }
  return map;
}

let dressed: Dressing | null = null;
/** The street dressing (shared/dressing.ts): signs, parasols, roadworks, flagpoles and birds, the same for everyone. */
export function cityDressing(): Dressing {
  solids();
  return dressed!;
}

/**
 * What stands in the way within `reach` of (x, z) out in the city: buildings, lamp posts, signal
 * poles, park kerbs and trees, benches, the gas station's pumps, the café's and the bar's walls. Boxes (shared, don't change them);
 * only what's near, through a spatial hash, so it's cheap to ask every step of a drive.
 */
export function citySolids(x: number, z: number, reach: number): Area[] {
  const map = solids();
  const out: Area[] = [];
  const seen = new Set<Area>();
  for (let cx = Math.floor((x - reach) / CELL); cx <= Math.floor((x + reach) / CELL); cx++) {
    for (let cz = Math.floor((z - reach) / CELL); cz <= Math.floor((z + reach) / CELL); cz++) {
      for (const a of map.get(cellKey(cx, cz)) ?? []) {
        if (seen.has(a) || a.maxX < x - reach || a.minX > x + reach || a.maxZ < z - reach || a.minZ > z + reach) continue;
        seen.add(a);
        out.push(a);
      }
    }
  }
  return out;
}

/**
 * What a vehicle bumps into near (x, z): citySolids, and the café's and the bar's doorways too
 * (shared/venues.ts VENUE_DOORS), which people walk through but nothing on wheels does.
 */
export function vehicleSolids(x: number, z: number, reach: number): Area[] {
  const out = citySolids(x, z, reach);
  for (const d of VENUE_DOORS) if (d.maxX >= x - reach && d.minX <= x + reach && d.maxZ >= z - reach && d.minZ <= z + reach) out.push(d);
  return out;
}
