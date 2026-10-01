import * as THREE from 'three';
import { FLOOR, SLAB, STREET_Y, WALL_T, roofDrop } from '../../shared/layout';
import type { NightParts } from './outside';
import { decorTicker } from '../quality';
import { mergeByMaterial, mesh, textPlane, toon, toonVertex } from './toon';
import { buildTower } from './tower';
import { GRID, INNER, POST_RADIUS, PERIOD, RADIUS, ROAD_W as ROAD, STREET_X, STREET_Z, WALK, NEIGHBOURS, cityLayout, cityStreetscape, lightPhase, neighbourArea, parkHedges, rng, type Light, type Lot } from '../../shared/city';
import { VENUES } from '../../shared/venues';
import { buildIsland } from './ocean';
import { buildSway, type Canopy, type Fringe } from './dressing';

// The city around the rooftop bar: the building's own floors going down to the street (as the tower
// looks from outside, world/tower.ts), a grid of streets with cars running along them, parks, and
// blocks of buildings out to the haze, most of them lower than the roof so you look out over them,
// with a skyline of towers further off. At night their windows light up, the street lamps come on
// and the cars' lights show. The building is as tall as there are floors, so the street is that far
// down (see setFloors), and the buildings round about are only as tall as leaves the view over them.
//
// Everything is built from a handful of shared materials (a window texture per paint, repeated a
// window at a time), merged into a few meshes, so the whole city is a few dozen draw calls.

/** The building, walls included. */
const B = { minX: FLOOR.minX - WALL_T, maxX: FLOOR.maxX + WALL_T, minZ: FLOOR.minZ - WALL_T, maxZ: FLOOR.maxZ + WALL_T } as const;
/** One storey, and one bay of windows, in meters. */
const STOREY = 3.3;
const BAY = 2.8;
/** How far down the street was from the roof the neighbours' heights were picked for: six floors. */
const LAID_OUT = roofDrop(6);

export interface City {
  group: THREE.Group;
  /**
   * The building has `floors` floors under the roof: the street goes as far down as that is tall,
   * and the buildings nearby come down to stay under the roof.
   */
  setFloors(floors: number, wings?: readonly number[]): void;
  /** The cars along the streets, the blinking lights on the towers: `night` is how dark it is (0–1). */
  update(t: number, dt: number, night: number): void;
}

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 16;
  return t;
}

/** How a building's walls look: its paint, and the windows in it (glass towers are nearly all window). */
interface Paint {
  wall: string;
  glass: string;
  /** The window's share of a bay across and of a storey up. */
  wide: number;
  tall: number;
  /** Brick, with the mortar showing (walk-ups); or `open`: dark openings and no glass shine (a parking structure). */
  brick?: boolean;
  open?: boolean;
}

const PAINTS: Paint[] = [
  { wall: '#d9a27e', glass: '#a9d6f5', wide: 0.5, tall: 0.55 },
  { wall: '#c96f5a', glass: '#b8e0f7', wide: 0.45, tall: 0.55 },
  { wall: '#e9dcc3', glass: '#9cc9ea', wide: 0.55, tall: 0.6 },
  { wall: '#b9c0c9', glass: '#bfe3ff', wide: 0.6, tall: 0.55 },
  { wall: '#a7c4d9', glass: '#e6f4ff', wide: 0.5, tall: 0.6 },
  { wall: '#e8b4b8', glass: '#bfe3ff', wide: 0.5, tall: 0.55 },
  { wall: '#f1e3b3', glass: '#a9d6f5', wide: 0.45, tall: 0.5 },
  // Glass towers.
  { wall: '#4f6d8a', glass: '#7fb8d8', wide: 0.9, tall: 0.82 },
  { wall: '#3e7c7c', glass: '#8fd3d0', wide: 0.9, tall: 0.82 },
  // Brick walk-ups, and a parking structure (only the street sees these).
  { wall: '#b5573f', glass: '#a9d6f5', wide: 0.42, tall: 0.55, brick: true },
  { wall: '#9c4a3a', glass: '#bfe3ff', wide: 0.46, tall: 0.55, brick: true },
  { wall: '#b7b6ae', glass: '#2f323b', wide: 0.92, tall: 0.5, open: true },
];
const BRICKS = [9, 10];
const DECK = 11;

/** One bay of one storey: the wall with a window in it. */
function bayTexture(p: Paint): THREE.CanvasTexture {
  const S = 64;
  return canvasTexture(S, S, (g) => {
    g.fillStyle = p.wall;
    g.fillRect(0, 0, S, S);
    if (p.brick) {
      g.fillStyle = 'rgba(255,240,220,0.22)';
      for (let y = 0; y < S; y += 8) {
        g.fillRect(0, y, S, 1);
        for (let x = (y / 8) % 2 ? 0 : 8; x < S; x += 16) g.fillRect(x, y, 1, 8);
      }
    }
    const w = S * p.wide;
    const h = S * p.tall;
    const x = (S - w) / 2;
    const y = S * 0.18;
    g.fillStyle = p.glass;
    g.fillRect(x, y, w, h);
    if (p.open) return;
    g.fillStyle = 'rgba(255,255,255,0.45)';
    g.fillRect(x + w * 0.12, y, w * 0.1, h);
    // A sill under it.
    g.fillStyle = 'rgba(0,0,0,0.12)';
    g.fillRect(x - 2, y + h, w + 4, 3);
  });
}

/** Which windows are lit at night: 16 × 16 bays of them, each building showing a different part. */
function litTexture(p: Paint, seed: number): THREE.CanvasTexture {
  const N = 16;
  const C = 16;
  const r = rng(seed);
  return canvasTexture(N * C, N * C, (g) => {
    g.fillStyle = '#000000';
    g.fillRect(0, 0, N * C, N * C);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        if (r() < 0.5) continue;
        const k = r();
        g.fillStyle = k < 0.12 ? '#9ec9ff' : k < 0.55 ? '#ffd27a' : '#ffe6b0';
        const w = C * p.wide;
        const h = C * p.tall;
        g.fillRect(i * C + (C - w) / 2, j * C + C * 0.18, w, h);
      }
    }
  });
}

/** Wall faces piling up for one material, to be one mesh. */
class Walls {
  pos: number[] = [];
  norm: number[] = [];
  uv: number[] = [];
  index: number[] = [];

  /** A quad from its bottom-left corner `a` along `u` (across) and up `h`, facing `n`; `uv` is [u0, v0, u1, v1]. */
  quad(a: [number, number, number], u: [number, number, number], h: number, n: [number, number, number], uv: [number, number, number, number]) {
    const i = this.pos.length / 3;
    const [x, y, z] = a;
    const up: [number, number, number] = n[1] === 1 ? [0, 0, -h] : [0, h, 0];
    this.pos.push(x, y, z, x + u[0], y + u[1], z + u[2], x + u[0] + up[0], y + u[1] + up[1], z + u[2] + up[2], x + up[0], y + up[1], z + up[2]);
    for (let k = 0; k < 4; k++) this.norm.push(...n);
    const [u0, v0, u1, v1] = uv;
    this.uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    this.index.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }

  /** The four walls of a box from y0 to y1, windows a bay across and a storey up, lit windows from (ou, ov) of the pattern. `sides` are the ones to do: 1 is +z, 2 -z, 4 +x, 8 -x. */
  box(cx: number, cz: number, w: number, d: number, y0: number, y1: number, ou: number, ov: number, sides = 15) {
    const hw = w / 2;
    const hd = d / 2;
    const floors = Math.max(1, Math.round((y1 - y0) / STOREY));
    const h = y1 - y0;
    const across = (span: number) => Math.max(1, Math.round(span / BAY));
    const cw = across(w);
    const cd = across(d);
    if (sides & 1) this.quad([cx - hw, y0, cz + hd], [w, 0, 0], h, [0, 0, 1], [ou, ov, ou + cw, ov + floors]);
    if (sides & 2) this.quad([cx + hw, y0, cz - hd], [-w, 0, 0], h, [0, 0, -1], [ou + 3, ov, ou + 3 + cw, ov + floors]);
    if (sides & 4) this.quad([cx + hw, y0, cz + hd], [0, 0, -d], h, [1, 0, 0], [ou + 7, ov, ou + 7 + cd, ov + floors]);
    if (sides & 8) this.quad([cx - hw, y0, cz - hd], [0, 0, d], h, [-1, 0, 0], [ou + 11, ov, ou + 11 + cd, ov + floors]);
  }

  /** A flat top at y. */
  top(cx: number, cz: number, w: number, d: number, y: number) {
    this.quad([cx - w / 2, y, cz + d / 2], [w, 0, 0], d, [0, 1, 0], [0, 0, 1, 1]);
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.norm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.index);
    g.computeBoundingSphere();
    return g;
  }
}

/** The streets' square (shared/city.ts GRID) as a flat plane on the ground, for a block-at-a-time texture. */
function streetsGround(): THREE.PlaneGeometry {
  return new THREE.PlaneGeometry(GRID.maxX - GRID.minX, GRID.maxZ - GRID.minZ).rotateX(-Math.PI / 2).translate((GRID.minX + GRID.maxX) / 2, 0, (GRID.minZ + GRID.maxZ) / 2);
}

/** The streets and blocks, a block at a time: roads, sidewalks, crossings and the lane markings. */
function groundTexture(): THREE.CanvasTexture {
  const S = 512;
  const px = S / PERIOD;
  return canvasTexture(S, S, (g) => {
    g.fillStyle = '#b3aea4';
    g.fillRect(0, 0, S, S);
    const mid = S / 2;
    const road = ROAD * px;
    const walk = (ROAD + WALK * 2) * px;
    g.fillStyle = '#d9d3c5';
    g.fillRect(mid - walk / 2, 0, walk, S);
    g.fillRect(0, mid - walk / 2, S, walk);
    g.fillStyle = '#4b505c';
    g.fillRect(mid - road / 2, 0, road, S);
    g.fillRect(0, mid - road / 2, S, road);
    // Dashed yellow down the middle of each road, stopping short of the crossing.
    g.fillStyle = '#ffd166';
    for (let i = 0; i < S; i += 24) {
      if (Math.abs(i + 6 - mid) < walk * 0.9) continue;
      g.fillRect(mid - 1.5, i, 3, 12);
      g.fillRect(i, mid - 1.5, 12, 3);
    }
    // Zebra crossings round the intersection.
    g.fillStyle = '#f1f1f1';
    for (let k = -road / 2 + 3; k < road / 2 - 3; k += 7) {
      for (const s of [-1, 1]) {
        g.fillRect(mid + k, mid + s * (walk / 2 + 2) - (s < 0 ? 16 : 0), 4, 16);
        g.fillRect(mid + s * (walk / 2 + 2) - (s < 0 ? 16 : 0), mid + k, 16, 4);
      }
    }
  });
}

/** A tree of size `s` (0.8 to 1.5), with one of two greens. */
const TREE_GREENS = ['#5fb760', '#4ea657'];
function tree(s: number, tone: number): THREE.Group {
  const t = new THREE.Group();
  t.add(mesh(new THREE.CylinderGeometry(0.25 * s, 0.32 * s, 2.4 * s, 6), toon('#8a5a3b'), 0, 1.2 * s, 0, false));
  t.add(mesh(new THREE.SphereGeometry(1.9 * s, 8, 6), toon(TREE_GREENS[tone]), 0, 3.4 * s, 0, false));
  return t;
}

/** Soft round blob, for lamps seen from far off. */
function glowTexture(): THREE.CanvasTexture {
  return canvasTexture(64, 64, (g) => {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,255,255,0.7)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  });
}

/**
 * How much of its laid-out height a building in `ring` stands with the street `drop` below the roof.
 * Close by they come down with the roof, to stay under it; further out a bit less, and the skyline
 * stays the skyline. Up to six floors, where they were laid out; no taller past that.
 */
function rise(ring: number, drop: number): number {
  const k = Math.min(1, drop / LAID_OUT);
  return ring === 0 ? k : ring === 1 ? Math.sqrt(k) : 1;
}

/** Walls, roofs and beacons piling up for a set of buildings, to be a mesh per paint. */
interface Batch {
  walls: Map<number, Walls>;
  tops: Walls;
  /** Where the masts' red lights go (x, y, z each). */
  beacons: number[];
}
const newBatch = (): Batch => ({ walls: new Map(), tops: new Walls(), beacons: [] });

/**
 * Stacks a lot's building into `b`, `k` of its laid-out height (see rise), in `paint` (the lot's own
 * unless said), from `y0` (a shop's storey of its own goes under it); `sides` are the ground band's walls
 * to do (see Walls.box) and `flat`: whether to put a flat roof on. Returns how high its top ended up.
 */
function stack(b: Batch, lot: Lot, k: number, o: { paint?: number; y0?: number; flat?: boolean } = {}): number {
  const paint = o.paint ?? lot.paint;
  let bucket = b.walls.get(paint);
  if (!bucket) b.walls.set(paint, (bucket = new Walls()));
  const y0 = o.y0 ?? 0;
  let topY = lot.h * k;
  bucket.box(lot.x, lot.z, lot.w, lot.d, y0, topY, lot.ou, lot.ov);
  let tw = lot.w;
  let td = lot.d;
  if (lot.step) {
    b.tops.top(lot.x, lot.z, lot.w, lot.d, topY);
    tw = lot.step.w;
    td = lot.step.d;
    bucket.box(lot.x, lot.z, tw, td, topY, topY + lot.step.up * k, lot.ou + 5, lot.ov + 3);
    topY += lot.step.up * k;
  }
  if (o.flat !== false) b.tops.top(lot.x, lot.z, tw, td, topY);
  return topY;
}

interface Car {
  /** Along x (true) or z. */
  alongX: boolean;
  /** The lane's line across the street, and which way it drives (±1). */
  lane: number;
  dir: number;
  at: number;
  speed: number;
}

export function buildCity(night: NightParts): City {
  const group = new THREE.Group();
  /** Everything down on the street, which is as far below the roof as the building is tall. */
  const street = new THREE.Group();
  group.add(street);
  const r = rng(20260927);

  // The ground: every block and street, out to the ring road, and the island round it (world/ocean.ts).
  const groundGeo = streetsGround();
  const uv = groundGeo.getAttribute('uv') as THREE.BufferAttribute;
  const gp = groundGeo.getAttribute('position') as THREE.BufferAttribute;
  // Line the texture up with the streets: a road down its middle falls on x = STREET_X, z = STREET_Z.
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (gp.getX(i) - STREET_X) / PERIOD + 0.5, (gp.getZ(i) - STREET_Z) / PERIOD + 0.5);
  const ground = new THREE.Mesh(groundGeo, new THREE.MeshToonMaterial({ map: groundTexture(), gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap }));
  ground.receiveShadow = false;
  street.add(ground, buildIsland(night));

  // The blocks: parks now and then, and lots with a building on each, laid out once (shared/city.ts,
  // which the street's cars and the office's checks use too). How tall the buildings stand depends on
  // the roof (see raise, below).
  const { lots, parks: parkAt, draws } = cityLayout();
  // The dice go on from where the layout left them, so the trees and clouds below fall as they always did.
  for (let k = 0; k < draws; k++) r();
  const parks = new THREE.Group();
  const blockAt = (i: number, j: number) => ({ x: STREET_X - PERIOD / 2 + i * PERIOD, z: STREET_Z - PERIOD / 2 + j * PERIOD });
  const inner = INNER;
  for (const p of parkAt) {
    parks.add(mesh(new THREE.PlaneGeometry(p.size, p.size).rotateX(-Math.PI / 2), toon('#8fcf7a'), p.x, 0.03, p.z, false));
    for (const t of p.trees) {
      const tr = tree(t.s, t.tone);
      tr.position.set(t.x, 0, t.z);
      parks.add(tr);
    }
  }

  // The office's own building, a floor per project, from the street up to the roof, and the open
  // garage at the bottom: walled at the back and on the west side, columns along the other two.
  const building = buildTower([], night);
  group.add(building.group);
  const garage = new THREE.Group();
  const garageH = -STREET_Y - SLAB;
  const concrete = toon('#d3d6dd');
  garage.add(mesh(new THREE.BoxGeometry(B.maxX - B.minX, garageH, WALL_T), concrete, (B.minX + B.maxX) / 2, garageH / 2, B.minZ + WALL_T / 2, false));
  garage.add(mesh(new THREE.BoxGeometry(WALL_T, garageH, B.maxZ - B.minZ), concrete, B.minX + WALL_T / 2, garageH / 2, (B.minZ + B.maxZ) / 2, false));
  const column = new THREE.BoxGeometry(0.5, garageH, 0.5);
  for (const x of [B.maxX - 0.25, -9.6, 0, 9.6]) garage.add(mesh(column, toon('#e6e8ee'), x, garageH / 2, B.maxZ - 0.25, false));
  for (const z of [-6.5, 6.5, B.minZ + 0.25]) garage.add(mesh(column, toon('#e6e8ee'), B.maxX - 0.25, garageH / 2, z, false));
  garage.add(mesh(new THREE.PlaneGeometry(B.maxX - B.minX, B.maxZ - B.minZ).rotateX(-Math.PI / 2), toon('#9a9ea8'), (B.minX + B.maxX) / 2, 0.03, (B.minZ + B.maxZ) / 2, false));
  street.add(mergeByMaterial(garage));
  // Its plaza, with a few trees in front.
  parks.add(mesh(new THREE.PlaneGeometry(inner, inner).rotateX(-Math.PI / 2), toon('#cfc8b8'), blockAt(0, 0).x, 0.02, blockAt(0, 0).z, false));
  for (const [x, z] of [
    [-16, 18],
    [-6, 18],
    [6, 18],
    [16, 18],
    [-20, -18],
    // Clear of the back office, when a floor's built out into one (see WING).
    [21, -20],
  ]) {
    const s = 0.8 + r() * 0.7;
    const t = tree(s, r() < 0.5 ? 0 : 1);
    t.position.set(x, 0, z);
    parks.add(t);
  }
  street.add(mergeByMaterial(parks));

  // The buildings' walls (a material for each paint), their roofs, and what's on them.
  const gradient = (toon('#fff') as THREE.MeshToonMaterial).gradientMap;
  const paintMats = new Map<number, THREE.MeshToonMaterial>();
  const paintOf = (i: number) => {
    let m = paintMats.get(i);
    if (!m) {
      const p = PAINTS[i];
      const lit = litTexture(p, i + 1);
      lit.repeat.set(1 / 16, 1 / 16);
      m = new THREE.MeshToonMaterial({ map: bayTexture(p), emissive: '#ffffff', emissiveMap: lit, emissiveIntensity: 0, gradientMap: gradient });
      night.windows.push(m);
      paintMats.set(i, m);
    }
    return m;
  };
  const roofs = toon('#a19d97');
  const mastGeo = new THREE.CylinderGeometry(0.2, 0.35, 12, 6);
  const legGeo = new THREE.CylinderGeometry(0.12, 0.12, 2.4, 5);
  const tankGeo = new THREE.CylinderGeometry(1.6, 1.6, 3.2, 12);
  const capGeo = new THREE.ConeGeometry(1.8, 1.3, 12);
  const unitGeo = new THREE.BoxGeometry(1, 1.6, 1);
  const glow = glowTexture();
  const beaconMat = new THREE.PointsMaterial({ size: 5, map: glow, color: '#ff3b30', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const beaconPoints = new THREE.Points(new THREE.BufferGeometry(), beaconMat);
  street.add(beaconPoints);
  let raised: THREE.Object3D[] = [];

  /** Puts up the buildings, each as tall as `rise` says with the street `drop` below the roof. */
  const raise = (drop: number) => {
    for (const o of raised) {
      o.removeFromParent();
      o.traverse((m) => {
        if ((m as THREE.Mesh).isMesh) (m as THREE.Mesh).geometry.dispose();
      });
    }
    raised = [];
    const batch = newBatch();
    const tops = batch.tops;
    const extras = new THREE.Group();
    const beacons = batch.beacons;
    // W6: where the café and the bar stand, a plain box each at their height (and the neighbour that
    // shared the lot), not the lot's own building.
    type Box = { minX: number; maxX: number; minZ: number; maxZ: number };
    const meets = (a: Box, b: Box) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
    const venueLot = (l: Lot) => VENUES.some((v) => meets(l.plot, v.box) || meets(l.plot, v.terrace));
    const plain = (b: Box, h: number, paint: number) => {
      let bucket = batch.walls.get(paint);
      if (!bucket) batch.walls.set(paint, (bucket = new Walls()));
      const k = rise(0, drop);
      bucket.box((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2, b.maxX - b.minX, b.maxZ - b.minZ, 0, h * k, 0, 0);
      tops.top((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2, b.maxX - b.minX, b.maxZ - b.minZ, h * k);
    };
    for (const v of VENUES) plain(v.box, v.height, v.id === 'cafe' ? 6 : BRICKS[0]);
    for (const n of NEIGHBOURS) if (lots.some((l) => venueLot(l) && meets(l.plot, neighbourArea(n)))) plain(neighbourArea(n), n[3], 3);
    for (const lot of lots) {
      if (venueLot(lot)) continue;
      const k = rise(lot.ring, drop);
      const topY = stack(batch, lot, k);
      const top = lot.top;
      if (top?.kind === 'mast') {
        extras.add(mesh(mastGeo, toon('#8d99ae'), lot.x, topY + 6, lot.z, false));
        beacons.push(lot.x, topY + 12.3, lot.z);
      } else if (top?.kind === 'tank') {
        const wt = new THREE.Group();
        for (const [sx, sz] of [
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
        ])
          wt.add(mesh(legGeo, toon('#5b3a29'), sx * 1.1, 1.2, sz * 1.1, false));
        wt.add(mesh(tankGeo, toon('#9c6b4a'), 0, 4, 0, false));
        wt.add(mesh(capGeo, toon('#6b4a35'), 0, 6.25, 0, false));
        wt.position.set(top.x, topY, top.z);
        extras.add(wt);
      } else if (top?.kind === 'plant') {
        const unit = mesh(unitGeo, toon('#c9ccd4'), top.x, topY + 0.8, top.z, false);
        unit.scale.set(top.w, 1, top.d);
        extras.add(unit);
      }
    }
    const walls = batch.walls;
    for (const [paint, w] of walls) raised.push(new THREE.Mesh(w.geometry(), paintOf(paint)));
    raised.push(new THREE.Mesh(tops.geometry(), roofs), mergeByMaterial(extras));
    street.add(...raised);
    beaconPoints.geometry.dispose();
    beaconPoints.geometry = new THREE.BufferGeometry();
    beaconPoints.geometry.setAttribute('position', new THREE.Float32BufferAttribute(beacons, 3));
  };

  // Street lamps down both sides of every street, and red lights blinking on the masts.
  const lampPos: number[] = [];
  for (const l of cityStreetscape().lamps) lampPos.push(l.x, 5, l.z);
  const lampGeo = new THREE.BufferGeometry();
  lampGeo.setAttribute('position', new THREE.Float32BufferAttribute(lampPos, 3));
  const lamps = new THREE.Points(lampGeo, new THREE.PointsMaterial({ size: 4, map: glow, color: '#ffcf8a', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  lamps.visible = false;
  street.add(lamps);

  // Cars, up and down the streets round the office's block.
  const cars: Car[] = [];
  const lanes: [boolean, number][] = [
    [true, STREET_Z],
    [true, STREET_Z - PERIOD],
    [false, STREET_X],
    [false, STREET_X - PERIOD],
    [true, STREET_Z + PERIOD],
    [false, STREET_X + PERIOD],
  ];
  for (const [alongX, line] of lanes) {
    for (let k = 0; k < 7; k++) {
      const dir = k % 2 ? 1 : -1;
      cars.push({ alongX, lane: line + dir * (ROAD / 4) * (alongX ? 1 : -1), dir, at: -RADIUS + r() * RADIUS * 2, speed: 9 + r() * 6 });
    }
  }
  const body = new THREE.BoxGeometry(4.2, 1.05, 1.9).translate(0, 0.9, 0);
  const cabin = new THREE.BoxGeometry(2.2, 0.7, 1.7).translate(-0.3, 1.75, 0);
  const carGeo = mergeGeometries([body, cabin]);
  const carMesh = new THREE.InstancedMesh(carGeo, toon('#ffffff'), cars.length);
  const paints = ['#ef476f', '#ffd166', '#06d6a0', '#118ab2', '#f4f1de', '#3d405b', '#e07a5f', '#8ecae6'];
  cars.forEach((_, i) => carMesh.setColorAt(i, new THREE.Color(paints[Math.floor(r() * paints.length)])));
  const headMat = new THREE.MeshBasicMaterial({ color: '#fff6d0' });
  const tailMat = new THREE.MeshBasicMaterial({ color: '#ff2d2d' });
  const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.3, 1.6).translate(2.12, 0.95, 0), headMat, cars.length);
  const tails = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.25, 1.6).translate(-2.12, 0.95, 0), tailMat, cars.length);
  for (const m of [carMesh, heads, tails]) {
    m.frustumCulled = false;
    street.add(m);
  }
  const place = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const at = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const moveCars = (dt: number) => {
    cars.forEach((c, i) => {
      c.at += c.dir * c.speed * dt;
      if (c.at > RADIUS) c.at -= RADIUS * 2;
      if (c.at < -RADIUS) c.at += RADIUS * 2;
      if (c.alongX) at.set(c.at, 0, c.lane);
      else at.set(c.lane, 0, c.at);
      // The car's nose is +x: turned to face the way it's going.
      const yaw = c.alongX ? (c.dir > 0 ? 0 : Math.PI) : c.dir > 0 ? -Math.PI / 2 : Math.PI / 2;
      q.setFromAxisAngle(up, yaw);
      place.compose(at, q, one);
      carMesh.setMatrixAt(i, place);
      heads.setMatrixAt(i, place);
      tails.setMatrixAt(i, place);
    });
    for (const m of [carMesh, heads, tails]) m.instanceMatrix.needsUpdate = true;
  };
  moveCars(0);
  const carsTick = decorTicker();

  // Clouds, drifting past at about the height of the towers.
  const cloud = night.clouds;
  const sky = new THREE.Group();
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2 + r();
    const dist = 220 + r() * 120;
    const c = new THREE.Group();
    for (const [dx, dy, rad] of [
      [0, 0, 9],
      [10, -2, 7],
      [-10, -2, 6.5],
      [4, 4, 6],
    ]) {
      const puff = mesh(new THREE.SphereGeometry(rad, 12, 9), cloud, dx, dy, 0, false);
      puff.scale.y = 0.7;
      c.add(puff);
    }
    c.position.set(Math.cos(a) * dist, 40 + r() * 50, Math.sin(a) * dist);
    c.lookAt(0, c.position.y, 0);
    sky.add(c);
  }
  group.add(mergeByMaterial(sky));

  let floorsNow = 0;
  let wingsNow = '';
  let riseNow = -1;
  return {
    group,
    setFloors(floors, wings = []) {
      floors = Math.max(1, floors);
      if (floors === floorsNow && wings.join() === wingsNow) return;
      floorsNow = floors;
      wingsNow = wings.join();
      const drop = roofDrop(floors);
      street.position.y = -drop;
      building.set(floors, floors, wings);
      // The buildings only change height up to six floors (see rise).
      const k = Math.min(1, drop / LAID_OUT);
      if (k !== riseNow) {
        riseNow = k;
        raise(drop);
      }
    },
    update(t, dt, dark) {
      const carsDt = carsTick(dt);
      if (carsDt) moveCars(carsDt);
      lamps.visible = dark > 0.02;
      lamps.material.opacity = dark;
      headMat.color.setScalar(0.75 + 0.25 * dark);
      // The masts' lights blink, a second on and a second off, brighter at night.
      beaconMat.opacity = (Math.sin(t * Math.PI) > 0 ? 1 : 0.08) * (0.35 + 0.65 * dark);
    },
  };
}

/** Puts geometries (position and normal only) into one. */
function mergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const norm: number[] = [];
  for (const g of geos) {
    const flat = g.index ? g.toNonIndexed() : g;
    pos.push(...(flat.getAttribute('position').array as Float32Array));
    norm.push(...(flat.getAttribute('normal').array as Float32Array));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  return out;
}

// ---- The city at street level ---------------------------------------------------------------------

/** Vertex-colored geometry piling up out of shared shapes, to be one mesh: street furniture, trees, roofs. */
class Soup {
  private pos: number[] = [];
  private norm: number[] = [];
  private col: number[] = [];
  private flat = new Map<THREE.BufferGeometry, { p: ArrayLike<number>; n: ArrayLike<number> }>();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private sc = new THREE.Vector3();
  private c = new THREE.Color();

  /** `geo` (centered, a unit big) put at (x, y, z), scaled, turned `ry` about the vertical and `rx` about its own x. */
  add(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0) {
    let f = this.flat.get(geo);
    if (!f) {
      const g = geo.index ? geo.toNonIndexed() : geo;
      f = { p: g.getAttribute('position').array, n: g.getAttribute('normal').array };
      this.flat.set(geo, f);
    }
    this.e.set(rx, ry, 0, 'YXZ');
    this.m.compose(this.v.set(x, y, z), this.q.setFromEuler(this.e), this.sc.set(sx, sy, sz));
    const m = this.m.elements;
    this.c.set(color);
    for (let i = 0; i < f.p.length; i += 3) {
      const px = f.p[i];
      const py = f.p[i + 1];
      const pz = f.p[i + 2];
      this.pos.push(m[0] * px + m[4] * py + m[8] * pz + m[12], m[1] * px + m[5] * py + m[9] * pz + m[13], m[2] * px + m[6] * py + m[10] * pz + m[14]);
      const nx = f.n[i];
      const ny = f.n[i + 1];
      const nz = f.n[i + 2];
      const ax = m[0] * nx + m[4] * ny + m[8] * nz;
      const ay = m[1] * nx + m[5] * ny + m[9] * nz;
      const az = m[2] * nx + m[6] * ny + m[10] * nz;
      const len = Math.hypot(ax, ay, az) || 1;
      this.norm.push(ax / len, ay / len, az / len);
      this.col.push(this.c.r, this.c.g, this.c.b);
    }
  }

  /** A flat triangle. */
  tri(a: number[], b: number[], c: number[], color: THREE.ColorRepresentation) {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    this.c.set(color);
    for (const p of [a, b, c]) {
      this.pos.push(p[0], p[1], p[2]);
      this.norm.push(nx, ny, nz);
      this.col.push(this.c.r, this.c.g, this.c.b);
    }
  }

  mesh(): THREE.Mesh {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.norm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return new THREE.Mesh(g, toonVertex());
  }
}

/** The shop fronts: names, walls, sign and lettering colors. Sixteen of them make up the atlas. */
const SHOPS: [name: string, wall: string, sign: string, ink: string][] = [
  ['CAFE', '#e9d8c0', '#6f4e37', '#fff3d6'],
  ['PIZZA', '#f2c9a0', '#c1272d', '#ffffff'],
  ['BOOKS', '#c9d6e8', '#2b4c7e', '#ffe9a8'],
  ['PHARMACY', '#e8f1ee', '#1e9e6b', '#ffffff'],
  ['FLOWERS', '#f3d1dc', '#d1477a', '#ffffff'],
  ['BAKERY', '#f6e3b4', '#b5651d', '#fff8e1'],
  ['TACOS', '#f5d27a', '#2e8b57', '#fff3b0'],
  ['RAMEN', '#d9c7b0', '#8b1e2d', '#ffe8b0'],
  ['BARBER', '#d5dbe3', '#264653', '#ffffff'],
  ['GAMES', '#cdbff0', '#5b2a86', '#c7ffb8'],
  ['DELI', '#f1d7b8', '#a23e1e', '#fff1d0'],
  ['PETS', '#cfe8c8', '#3e8e41', '#fffbe0'],
  ['TAILOR', '#e2d3e8', '#4a2f6b', '#ffe4f0'],
  ['ICE CREAM', '#fbe1ec', '#e15a97', '#ffffff'],
  ['COFFEE', '#dfd0bf', '#3b2a20', '#ffd9a0'],
  ['SUSHI', '#e3e9f2', '#1d3557', '#ffd6d6'],
];
const CELL_W = 256;
const CELL_H = 160;
const COLS = 4;
/** Height of a shop's ground floor, and how far its awning comes out. */
const SHOP_H = 4;

/** Every shop front side by side: the wall, a sign, a window with wares in it, a door. `lit` draws only what glows at night. */
function shopAtlas(lit: boolean): THREE.CanvasTexture {
  const t = canvasTexture(CELL_W * COLS, CELL_H * (SHOPS.length / COLS), (g) => {
    SHOPS.forEach(([name, wall, sign, ink], i) => {
      const ox = (i % COLS) * CELL_W;
      const oy = Math.floor(i / COLS) * CELL_H;
      const r = rng(i + 101);
      if (lit) {
        g.fillStyle = '#000';
        g.fillRect(ox, oy, CELL_W, CELL_H);
      } else {
        g.fillStyle = wall;
        g.fillRect(ox, oy, CELL_W, CELL_H);
        // A plinth along the bottom, and a shadow under the sign.
        g.fillStyle = 'rgba(0,0,0,0.16)';
        g.fillRect(ox, oy + CELL_H - 14, CELL_W, 14);
        g.fillRect(ox, oy + 42, CELL_W, 6);
      }
      // The sign.
      g.fillStyle = lit ? sign : sign;
      g.fillRect(ox + 10, oy + 8, CELL_W - 20, 34);
      g.fillStyle = ink;
      g.font = `800 ${name.length > 7 ? 21 : 25}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(name, ox + CELL_W / 2, oy + 26);
      // The window, with wares in it.
      const wx = ox + 16;
      const wy = oy + 62;
      const ww = 140;
      const wh = 78;
      g.fillStyle = lit ? '#ffd88a' : '#a9d6f5';
      g.fillRect(wx, wy, ww, wh);
      for (let k = 0; k < 5; k++) {
        g.fillStyle = ['#ef476f', '#ffd166', '#06d6a0', '#118ab2', '#f78c6b'][Math.floor(r() * 5)];
        const bw = 14 + r() * 18;
        const bh = 12 + r() * 30;
        g.fillRect(wx + 8 + k * 26, wy + wh - bh - 6, bw, bh);
      }
      if (!lit) {
        g.fillStyle = 'rgba(255,255,255,0.4)';
        g.fillRect(wx + 8, wy, 10, wh);
        g.fillStyle = '#4b505c';
        for (const rect of [[wx - 4, wy - 4, ww + 8, 4], [wx - 4, wy + wh, ww + 8, 4], [wx - 4, wy - 4, 4, wh + 8], [wx + ww, wy - 4, 4, wh + 8]]) g.fillRect(rect[0], rect[1], rect[2], rect[3]);
      }
      // The door, with an OPEN sign in it.
      const dx = ox + 176;
      const dy = oy + 58;
      g.fillStyle = lit ? '#ffe6b0' : '#3d405b';
      g.fillRect(dx, dy, 64, CELL_H - dy + oy - 14);
      if (!lit) {
        g.fillStyle = '#bfe3ff';
        g.fillRect(dx + 8, dy + 8, 48, 62);
      }
      g.fillStyle = lit ? '#ff6b6b' : '#e63946';
      g.fillRect(dx + 18, dy + 34, 28, 10);
    });
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** How the ground lies at street level: a block's lawn, its sidewalks, the roads with their lane, edge and stop lines and crossings. */
function streetTexture(): THREE.CanvasTexture {
  const S = 1024;
  const px = S / PERIOD;
  const mid = S / 2;
  return canvasTexture(S, S, (g) => {
    // In meters from the middle of the intersection; z runs up the canvas (the ground plane's uv does).
    const R = (color: string, x0: number, z0: number, x1: number, z1: number) => {
      g.fillStyle = color;
      g.fillRect(mid + x0 * px, mid - z1 * px, (x1 - x0) * px, (z1 - z0) * px);
    };
    const H = PERIOD / 2;
    const road = ROAD / 2;
    const walk = road + WALK;
    R('#a7d98b', -H, -H, H, H);
    // Sidewalks, with a seam every two meters.
    R('#d9d3c5', -H, -walk, H, walk);
    R('#d9d3c5', -walk, -H, walk, H);
    g.fillStyle = 'rgba(120,112,98,0.28)';
    for (let a = -H; a < H; a += 2) {
      for (const s of [-1, 1]) {
        g.fillRect(mid + a * px, mid - (s * (road + WALK / 2) + WALK / 2) * px, 1.2, WALK * px);
        g.fillRect(mid + (s * (road + WALK / 2) - WALK / 2) * px, mid - (a + 1) * px, WALK * px, 1.2);
      }
    }
    // The roads, and the curb along them: a light edge on the sidewalk, a dark gutter in the road.
    R('#4b505c', -H, -road, H, road);
    R('#4b505c', -road, -H, road, H);
    for (const s of [-1, 1]) {
      for (const [a0, a1] of [[road, H], [-H, -road]]) {
        R('#f2eee4', a0, s * road + (s > 0 ? 0 : -0.3), a1, s * road + (s > 0 ? 0.3 : 0));
        R('#f2eee4', s * road + (s > 0 ? 0 : -0.3), a0, s * road + (s > 0 ? 0.3 : 0), a1);
        R('#383c46', a0, s * (road - 0.18) - 0.09, a1, s * (road - 0.18) + 0.09);
        R('#383c46', s * (road - 0.18) - 0.09, a0, s * (road - 0.18) + 0.09, a1);
      }
    }
    // Lane markings: a dashed yellow line down the middle, a white edge line each side, stopping short of the crossings.
    const dash = 2.6;
    for (let a = road + 5; a < H - 1; a += dash * 2) {
      for (const s of [-1, 1]) {
        const a0 = s > 0 ? a : -a - dash;
        R('#ffd166', a0, -0.09, a0 + dash, 0.09);
        R('#ffd166', -0.09, a0, 0.09, a0 + dash);
      }
    }
    for (const s of [-1, 1]) {
      for (const [a0, a1] of [[road + 5, H], [-H, -road - 5]]) {
        R('#f1f1f1', a0, s * (road - 0.55) - 0.07, a1, s * (road - 0.55) + 0.07);
        R('#f1f1f1', s * (road - 0.55) - 0.07, a0, s * (road - 0.55) + 0.07, a1);
      }
    }
    // Zebra crossings across all four arms, and stop lines in front of them, the lane each way's own.
    for (const s of [-1, 1]) {
      for (let k = -3; k <= 3; k++) {
        const c = k * 1.05;
        R('#f5f5f5', s * (road + 0.4) - (s < 0 ? 2 : 0), c - 0.26, s * (road + 0.4) + (s > 0 ? 2 : 0), c + 0.26);
        R('#f5f5f5', c - 0.26, s * (road + 0.4) - (s < 0 ? 2 : 0), c + 0.26, s * (road + 0.4) + (s > 0 ? 2 : 0));
      }
    }
    const stop = road + 3.1;
    // Right-hand traffic: heading +x you keep to +z, heading -x to -z, heading +z to -x, heading -z to +x.
    R('#f5f5f5', -stop - 0.5, 0.2, -stop, road - 0.2);
    R('#f5f5f5', stop, -road + 0.2, stop + 0.5, -0.2);
    R('#f5f5f5', -road + 0.2, -stop - 0.5, -0.2, -stop);
    R('#f5f5f5', 0.2, stop, road - 0.2, stop + 0.5);
  });
}

/** Light discs' colors: what the signal shows. */
const SIGNAL_COLOR: Record<Light, string> = { red: '#ff3b30', yellow: '#ffd60a', green: '#34c759' };
const SIGNAL_SLOT: Record<Light, number> = { red: 0.32, yellow: 0, green: -0.32 };

/** How dark it is (0–1), from the windows the sky lights up: 1.1 at night. */
const darkOf = (m: THREE.MeshToonMaterial) => Math.min(1, m.emissiveIntensity / 1.1);

/**
 * The whole city at street level, for the office's `ground` group to hold (see outside.ts buildStreet):
 * its roads and sidewalks with their markings, every block's buildings at full height (shop fronts
 * with awnings and signs, brick walk-ups, glass towers, low houses with pitched roofs at the outskirts,
 * a gas station, a parking structure), parks, street lamps, traffic lights that go through their
 * cycle (shared/city.ts lightPhase), benches, bins and hydrants. The ground's at y = 0: put the group
 * where the street is. The lots round the office that outside.ts builds by hand are left to it.
 */
export function buildStreetCity(night: NightParts): THREE.Group {
  const group = new THREE.Group();
  const gradient = (toon('#fff') as THREE.MeshToonMaterial).gradientMap;
  const { lots, parks, gas } = cityLayout();
  const scape = cityStreetscape();

  // The ground, pushed back a little so the garage's lots and the plaza, laid on top, always win: the
  // streets' square, out to the ring road's far sidewalk. Past that it's the island's (world/ocean.ts).
  const groundGeo = streetsGround();
  const uv = groundGeo.getAttribute('uv') as THREE.BufferAttribute;
  const gp = groundGeo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (gp.getX(i) - STREET_X) / PERIOD + 0.5, (gp.getZ(i) - STREET_Z) / PERIOD + 0.5);
  const groundMat = new THREE.MeshToonMaterial({ map: streetTexture(), gradientMap: gradient, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
  group.add(new THREE.Mesh(groundGeo, groundMat));
  group.add(buildIsland(night));

  // Walls: a material per paint, and the shop fronts' atlas.
  const paintMats = new Map<number, THREE.MeshToonMaterial>();
  const paintOf = (i: number) => {
    let m = paintMats.get(i);
    if (!m) {
      const p = PAINTS[i];
      const lit = litTexture(p, i + 1);
      lit.repeat.set(1 / 16, 1 / 16);
      m = new THREE.MeshToonMaterial({ map: bayTexture(p), emissive: '#ffffff', emissiveMap: lit, emissiveIntensity: 0, gradientMap: gradient });
      night.windows.push(m);
      paintMats.set(i, m);
    }
    return m;
  };
  const storeMat = new THREE.MeshToonMaterial({ map: shopAtlas(false), emissive: '#ffffff', emissiveMap: shopAtlas(true), emissiveIntensity: 0, gradientMap: gradient });
  night.windows.push(storeMat);
  const stores = new Walls();

  const batch = newBatch();
  const soup = new Soup();
  const box = new THREE.BoxGeometry(1, 1, 1);
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 6);
  const ball = new THREE.SphereGeometry(1, 8, 6);
  const beacons = batch.beacons;

  const tree = (x: number, z: number, s: number, tone: number) => {
    soup.add(cyl, '#8a5a3b', x, 1.2 * s, z, 0.28 * s, 2.4 * s, 0.28 * s);
    // The canopy is dressing.ts's, so it can sway in the wind.
    canopies.push({ x, y: 3.4 * s, z, r: 1.9 * s, color: TREE_GREENS[tone] });
  };
  const canopies: Canopy[] = [];
  const fringes: Fringe[] = [];

  // A shop's storey: its front in modules of shop front, an awning over each; the other walls plain.
  const face = (l: Lot) => (l.fz > 0 ? 1 : l.fz < 0 ? 2 : l.fx > 0 ? 4 : 8);
  const awnings = ['#e63946', '#2a9d8f', '#f4a261', '#457b9d', '#8e5bbf', '#e9c46a'];
  const shopFront = (l: Lot) => {
    const span = l.fz !== 0 ? l.w : l.d;
    const count = Math.max(1, Math.round(span / 6.5));
    const step = span / count;
    const pick = rng(l.ou * 31 + l.ov * 7 + Math.round(l.x) + Math.round(l.z) * 3);
    const awning = awnings[Math.floor(pick() * awnings.length)];
    let cell = Math.floor(pick() * SHOPS.length);
    for (let m = 0; m < count; m++) {
      cell = (cell + 5 + Math.floor(pick() * 3)) % SHOPS.length;
      const col = cell % COLS;
      const row = Math.floor(cell / COLS);
      const rows = SHOPS.length / COLS;
      const e = 0.5 / CELL_W;
      const uv: [number, number, number, number] = [col / COLS + e, 1 - (row + 1) / rows + e, (col + 1) / COLS - e, 1 - row / rows - e];
      let a: [number, number, number];
      let u: [number, number, number];
      let n: [number, number, number];
      if (l.fz > 0) [a, u, n] = [[l.x - l.w / 2 + step * m, 0, l.z + l.d / 2], [step, 0, 0], [0, 0, 1]];
      else if (l.fz < 0) [a, u, n] = [[l.x + l.w / 2 - step * m, 0, l.z - l.d / 2], [-step, 0, 0], [0, 0, -1]];
      else if (l.fx > 0) [a, u, n] = [[l.x + l.w / 2, 0, l.z + l.d / 2 - step * m], [0, 0, -step], [1, 0, 0]];
      else [a, u, n] = [[l.x - l.w / 2, 0, l.z - l.d / 2 + step * m], [0, 0, step], [-1, 0, 0]];
      stores.quad(a, u, SHOP_H, n, uv);
      // An awning over it, striped, sloping down to its front edge.
      const cx = a[0] + u[0] / 2;
      const cz = a[2] + u[2] / 2;
      const yaw = Math.atan2(n[0], n[2]);
      const stripes = 6;
      for (let k = 0; k < stripes; k++) {
        const off = ((k + 0.5) / stripes - 0.5) * step * 0.94;
        const sx = Math.cos(yaw) * off;
        const sz = -Math.sin(yaw) * off;
        soup.add(box, k % 2 ? '#f6f1e4' : awning, cx + n[0] * 0.75 + sx, 3.25, cz + n[2] * 0.75 + sz, (step * 0.94) / stripes, 0.07, 1.5, yaw, 0.32);
      }
      // A fringe hanging off its front edge, swaying (dressing.ts).
      fringes.push({ x: cx + n[0] * 1.46, y: 3.02, z: cz + n[2] * 1.46, yaw, w: step * 0.94, color: awning });
    }
  };

  // A low house: a pitched roof, a door, a chimney, and often a tree in the yard.
  const roofs = ['#b5523b', '#6b4a35', '#4a5568', '#8d5b4c', '#a34a3c'];
  const doors = ['#e63946', '#2a9d8f', '#f4a261', '#457b9d', '#6a4c93'];
  const house = (l: Lot) => {
    const pick = rng(l.ou * 17 + l.ov * 5 + Math.round(l.x));
    const roof = roofs[Math.floor(pick() * roofs.length)];
    const rise = 2.2;
    const hx = l.w / 2 + 0.5;
    const hz = l.d / 2 + 0.5;
    const y = l.h;
    // The ridge runs along the longer side.
    if (l.w >= l.d) {
      soup.tri([l.x - hx, y, l.z + hz], [l.x + hx, y, l.z + hz], [l.x + hx, y + rise, l.z], roof);
      soup.tri([l.x - hx, y, l.z + hz], [l.x + hx, y + rise, l.z], [l.x - hx, y + rise, l.z], roof);
      soup.tri([l.x + hx, y, l.z - hz], [l.x - hx, y, l.z - hz], [l.x - hx, y + rise, l.z], roof);
      soup.tri([l.x + hx, y, l.z - hz], [l.x - hx, y + rise, l.z], [l.x + hx, y + rise, l.z], roof);
      soup.tri([l.x + hx, y, l.z + hz], [l.x + hx, y, l.z - hz], [l.x + hx, y + rise, l.z], roof);
      soup.tri([l.x - hx, y, l.z - hz], [l.x - hx, y, l.z + hz], [l.x - hx, y + rise, l.z], roof);
    } else {
      soup.tri([l.x + hx, y, l.z - hz], [l.x + hx, y, l.z + hz], [l.x, y + rise, l.z + hz], roof);
      soup.tri([l.x + hx, y, l.z - hz], [l.x, y + rise, l.z + hz], [l.x, y + rise, l.z - hz], roof);
      soup.tri([l.x - hx, y, l.z + hz], [l.x - hx, y, l.z - hz], [l.x, y + rise, l.z - hz], roof);
      soup.tri([l.x - hx, y, l.z + hz], [l.x, y + rise, l.z - hz], [l.x, y + rise, l.z + hz], roof);
      soup.tri([l.x - hx, y, l.z + hz], [l.x + hx, y, l.z + hz], [l.x, y + rise, l.z + hz], roof);
      soup.tri([l.x + hx, y, l.z - hz], [l.x - hx, y, l.z - hz], [l.x, y + rise, l.z - hz], roof);
    }
    soup.add(box, '#8d99ae', l.x + l.w * 0.25, y + rise + 0.4, l.z + l.d * 0.2, 0.8, 1.8, 0.8);
    const door = doors[Math.floor(pick() * doors.length)];
    soup.add(box, door, l.x + l.fx * (l.w / 2 + 0.05), 1.05, l.z + l.fz * (l.d / 2 + 0.05), l.fx ? 0.12 : 1.1, 2.1, l.fz ? 0.12 : 1.1);
    soup.add(box, '#d9d3c5', l.x + l.fx * (l.w / 2 + 0.7), 0.06, l.z + l.fz * (l.d / 2 + 0.7), l.fx ? 1.4 : 1.6, 0.12, l.fz ? 1.4 : 1.6);
    if (l.yard) tree(l.yard.x, l.yard.z, l.yard.s, l.yard.tone);
  };

  // The gas station's forecourt, canopy, pumps and sign, with the lot's shop behind them.
  const station = () => {
    if (!gas) return;
    const p = gas.plot;
    const c = gas.canopy;
    soup.add(box, '#575c68', (p.minX + p.maxX) / 2, 0.03, (p.minZ + p.maxZ) / 2, p.maxX - p.minX, 0.06, p.maxZ - p.minZ);
    const cw = c.maxX - c.minX;
    const cd = c.maxZ - c.minZ;
    soup.add(box, '#f4f1de', (c.minX + c.maxX) / 2, 4.7, (c.minZ + c.maxZ) / 2, cw, 0.4, cd);
    soup.add(box, '#e63946', (c.minX + c.maxX) / 2, 4.5, (c.minZ + c.maxZ) / 2, cw + 0.06, 0.16, cd + 0.06);
    for (const [px, pz] of [
      [c.minX + 0.3, c.minZ + 0.3],
      [c.maxX - 0.3, c.maxZ - 0.3],
    ])
      soup.add(cyl, '#f4f1de', px, 2.25, pz, 0.28, 4.5, 0.28);
    for (const a of gas.pumps) {
      const x = (a.minX + a.maxX) / 2;
      const z = (a.minZ + a.maxZ) / 2;
      soup.add(box, '#e63946', x, 0.75, z, a.maxX - a.minX, 1.5, a.maxZ - a.minZ);
      soup.add(box, '#f5f5f5', x, 1.6, z, a.maxX - a.minX + 0.05, 0.25, a.maxZ - a.minZ + 0.05);
    }
    // A price sign on a pole out by the street.
    const { fx, fz } = gas;
    const { x: sx, z: sz } = gas.sign;
    soup.add(cyl, '#3d405b', sx, 3.2, sz, 0.12, 6.4, 0.12);
    const sign = textPlane('⛽ GAS', { bg: '#e63946', color: '#ffffff', size: 64, border: '#ffffff' });
    sign.scale.multiplyScalar(1.5);
    sign.position.set(sx + fx * 0.2, 6.6, sz + fz * 0.2);
    sign.rotation.y = Math.atan2(fx, fz);
    group.add(sign);
  };

  for (const lot of lots) {
    if (lot.hand) continue;
    switch (lot.kind) {
      case 'shop': {
        const bucket = batch.walls.get(lot.paint) ?? new Walls();
        batch.walls.set(lot.paint, bucket);
        // The other three walls of its ground floor are plain; the front is the shop's.
        bucket.box(lot.x, lot.z, lot.w, lot.d, 0, SHOP_H, lot.ou, lot.ov, 15 & ~face(lot));
        stack(batch, lot, 1, { y0: SHOP_H });
        shopFront(lot);
        break;
      }
      case 'walkup':
        stack(batch, lot, 1, { paint: BRICKS[(lot.ou + lot.ov) & 1] });
        break;
      case 'deck':
        stack(batch, lot, 1, { paint: DECK });
        break;
      case 'house':
        stack(batch, lot, 1, { flat: false });
        house(lot);
        break;
      case 'gas':
        stack(batch, lot, 1, { paint: 3 });
        station();
        break;
      default: {
        const topY = stack(batch, lot, 1);
        if (lot.top?.kind === 'mast') {
          soup.add(cyl, '#8d99ae', lot.x, topY + 6, lot.z, 0.28, 12, 0.28);
          beacons.push(lot.x, topY + 12.3, lot.z);
        }
      }
    }
  }
  for (const [paint, w] of batch.walls) group.add(new THREE.Mesh(w.geometry(), paintOf(paint)));
  group.add(new THREE.Mesh(batch.tops.geometry(), toon('#a19d97')), new THREE.Mesh(stores.geometry(), storeMat));

  // Parks: a lawn, a kerb of hedge all round, two paths, and the trees.
  for (const p of parks) {
    soup.add(box, '#8fcf7a', p.x, 0.04, p.z, p.size, 0.08, p.size);
    soup.add(box, '#dcd2b8', p.x, 0.09, p.z, 2.4, 0.06, p.size);
    soup.add(box, '#dcd2b8', p.x, 0.09, p.z, p.size, 0.06, 2.4);
    // Open where the paths come out: you can drive in (shared/city.ts parkHedges, which are solid).
    for (const a of parkHedges(p)) soup.add(box, '#4ea657', (a.minX + a.maxX) / 2, 0.3, (a.minZ + a.maxZ) / 2, a.maxX - a.minX, 0.6, a.maxZ - a.minZ);
    for (const t of p.trees) tree(t.x, t.z, t.s, t.tone);
  }

  // Street lamps (not the ones outside.ts has put up out front), and how the light comes on at night.
  const glow = glowTexture();
  const lampAt: number[] = [];
  for (const l of scape.lamps) {
    if (l.hand) continue;
    lampAt.push(l.x + l.ax * 1.2, 5, l.z + l.az * 1.2);
    // Only near enough to see the post (the glow carries on further out).
    if (Math.hypot(l.x, l.z) > POST_RADIUS) continue;
    soup.add(cyl, '#3d405b', l.x, 0.25, l.z, 0.22, 0.5, 0.22);
    soup.add(cyl, '#3d405b', l.x, 2.5, l.z, 0.08, 5, 0.08);
    soup.add(box, '#3d405b', l.x + l.ax * 0.6, 4.95, l.z + l.az * 0.6, l.ax ? 1.3 : 0.08, 0.08, l.az ? 1.3 : 0.08);
    soup.add(cyl, '#3d405b', l.x + l.ax * 1.2, 4.9, l.z + l.az * 1.2, 0.3, 0.24, 0.3);
    soup.add(ball, '#fff3d6', l.x + l.ax * 1.2, 4.72, l.z + l.az * 1.2, 0.2, 0.2, 0.2);
  }
  const lampsGeo = new THREE.BufferGeometry();
  lampsGeo.setAttribute('position', new THREE.Float32BufferAttribute(lampAt, 3));
  const lamps = new THREE.Points(lampsGeo, new THREE.PointsMaterial({ size: 4, map: glow, color: '#ffcf8a', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  lamps.frustumCulled = false;
  group.add(lamps);

  // Benches, bins and hydrants, near enough to be seen.
  for (const p of scape.props) {
    const s = Math.sin(p.rot);
    const c = Math.cos(p.rot);
    // (lx, lz) in the prop's own frame, +z toward the road, to the ground.
    const at = (lx: number, lz: number) => [p.x + lx * c + lz * s, p.z - lx * s + lz * c] as const;
    if (p.kind === 'bench') {
      const [sx, sz] = at(0, 0);
      soup.add(box, '#8a5a3b', sx, 0.45, sz, 1.7, 0.08, 0.5, p.rot);
      const [bx, bz] = at(0, -0.22);
      soup.add(box, '#8a5a3b', bx, 0.78, bz, 1.7, 0.4, 0.06, p.rot);
      for (const lx of [-0.7, 0.7]) {
        const [px, pz] = at(lx, 0);
        soup.add(box, '#3d405b', px, 0.22, pz, 0.08, 0.44, 0.44, p.rot);
      }
    } else if (p.kind === 'bin') {
      soup.add(cyl, '#2f6f4f', p.x, 0.45, p.z, 0.26, 0.9, 0.26);
      soup.add(cyl, '#1f2933', p.x, 0.93, p.z, 0.29, 0.08, 0.29);
    } else {
      soup.add(cyl, '#e63946', p.x, 0.36, p.z, 0.15, 0.72, 0.15);
      soup.add(ball, '#e63946', p.x, 0.75, p.z, 0.17, 0.17, 0.17);
      soup.add(cyl, '#f1c40f', p.x, 0.5, p.z, 0.25, 0.1, 0.1, p.rot + Math.PI / 2);
    }
  }

  // Traffic signals: a pole and a head on every corner. What each shows is drawn by one lit disc a corner.
  for (const p of scape.poles) {
    soup.add(cyl, '#3d405b', p.x, 2.2, p.z, 0.09, 4.4, 0.09);
    soup.add(box, '#22252f', p.x + p.fx * 0.25, 3.7, p.z + p.fz * 0.25, p.fx ? 0.3 : 0.36, 1.05, p.fz ? 0.3 : 0.36);
    soup.add(box, '#22252f', p.x + p.fx * 0.1, 4.0, p.z + p.fz * 0.1, p.fx ? 0.08 : 0.2, 0.06, p.fz ? 0.08 : 0.2);
  }
  const lit = new THREE.InstancedMesh(new THREE.CircleGeometry(0.12, 10), new THREE.MeshBasicMaterial({ color: '#ffffff' }), scape.poles.length);
  lit.frustumCulled = false;
  const place = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const unit = new THREE.Vector3(1, 1, 1);
  const spot = new THREE.Vector3();
  const tint = new THREE.Color();
  let signalAt = -1e9;
  const signals = () => {
    const now = performance.now();
    if (now - signalAt < 250) return;
    signalAt = now;
    const t = Date.now() / 1000;
    let last = -1;
    let phase = lightPhase(t, scape.intersections[0]);
    scape.poles.forEach((p, k) => {
      if (p.i * 1000 + p.j !== last) {
        last = p.i * 1000 + p.j;
        phase = lightPhase(t, p);
      }
      const state = p.axis === 'x' ? phase.x : phase.z;
      quat.setFromAxisAngle(yAxis, Math.atan2(p.fx, p.fz));
      place.compose(spot.set(p.x + p.fx * 0.41, 3.7 + SIGNAL_SLOT[state], p.z + p.fz * 0.41), quat, unit);
      lit.setMatrixAt(k, place);
      lit.setColorAt(k, tint.set(SIGNAL_COLOR[state]));
    });
    lit.instanceMatrix.needsUpdate = true;
    if (lit.instanceColor) lit.instanceColor.needsUpdate = true;
  };
  signals();
  lit.onBeforeRender = signals;
  group.add(lit);

  // Everything vertex-colored (trees' trunks, roofs, furniture, gas station...) in the one mesh.
  group.add(soup.mesh());
  // The trees' tops and the awnings' fringes sway in the wind (world/dressing.ts): they're the trees and awnings, so they're here at once.
  group.add(buildSway(canopies, fringes));
  // Signs, parasols, flags and birds (world/dressingModels.ts), loaded once the city's up: their models come in as files, so the module stays out of the first download (and out of the tests).
  void import('./dressingModels').then(({ buildDressing }) => group.add(buildDressing())).catch((err: unknown) => console.error("the street dressing didn't load", err));

  // The red lights blinking on the masts, and the street lamps' glow, brighter with the dark.
  const beaconMat = new THREE.PointsMaterial({ size: 5, map: glow, color: '#ff3b30', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const beaconGeo = new THREE.BufferGeometry();
  beaconGeo.setAttribute('position', new THREE.Float32BufferAttribute(beacons, 3));
  const beaconPoints = new THREE.Points(beaconGeo, beaconMat);
  beaconPoints.frustumCulled = false;
  group.add(beaconPoints);
  lamps.onBeforeRender = () => {
    const dark = darkOf(storeMat);
    (lamps.material as THREE.PointsMaterial).opacity = dark;
    beaconMat.opacity = (Math.sin((Date.now() / 1000) * Math.PI) > 0 ? 1 : 0.08) * (0.35 + 0.65 * dark);
  };
  return group;
}
