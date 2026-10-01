import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SLAB, STREET_Y, seatPlace } from '../../shared/layout';
import { VENUES, VENUE_SEATS, VENUE_WALL, frontZ, venueAt, wallPieces, type Venue, type VenueId } from '../../shared/venues';
import { DRINK_BY_ID, type DrinkId } from '../../shared/rooftop';
import { lookFromSeed } from '../../shared/avatar';
import { Person } from './character';
import type { Collider, Interactable } from './office';
import { bulb, type NightParts } from './outside';
import { mergeByMaterial, mergeColored, mesh, toon } from './toon';
import chairUrl from '../models/venues/chair.glb?url';
import chairCushionUrl from '../models/venues/chairCushion.glb?url';
import stoolBarUrl from '../models/venues/stoolBar.glb?url';
import loungeSofaUrl from '../models/venues/loungeSofa.glb?url';
import coffeeMachineUrl from '../models/venues/kitchenCoffeeMachine.glb?url';
import lampUrl from '../models/venues/lampRoundTable.glb?url';
import pottedPlantUrl from '../models/venues/pottedPlant.glb?url';
import plantSmall1Url from '../models/venues/plantSmall1.glb?url';
import plantSmall2Url from '../models/venues/plantSmall2.glb?url';
import speakerUrl from '../models/venues/speaker.glb?url';
import ceilingFanUrl from '../models/venues/ceilingFan.glb?url';
import radioUrl from '../models/venues/radio.glb?url';
import coatRackUrl from '../models/venues/coatRackStanding.glb?url';
import fridgeUrl from '../models/venues/kitchenFridgeSmall.glb?url';
import rugUrl from '../models/venues/rugRectangle.glb?url';
import bookcaseUrl from '../models/venues/bookcaseOpenLow.glb?url';

// The café and the bar out in the city (shared/venues.ts has where): Café Corner on the office's side
// of the street a block east, and The Night Owl across the street from it. Each is a real room at
// street level you walk into through its door: a counter with someone behind it, tables and stools,
// a sofa, a menu on the wall, people sitting about, warm lamps at night. Sit down and E orders a
// coffee or a drink (main.ts: the office's caffeine and booze); the bartender comes over to pour it.
//
// Cheap to have about: from outside it's a facade, its sign and awning and the tables out front, a
// dozen draw calls; the room behind the glass (and the people in it) is only there, and only moves,
// while you're close. The furniture is Kenney's Furniture Kit (CC0, see CREDITS.md) painted in the
// venue's own colors and merged, with the counters, shelves and the espresso machine built here.

export interface Venues {
  group: THREE.Group;
  /** Counters, tables, the sofas, the stage and the ceilings, at street level (the walls are the city's: citySolids). */
  colliders: Collider[];
  interactables: Interactable[];
  /** The street is `y` down from the floor you're on: the counters' and seats' height for E. */
  setStreet(y: number): void;
  /** Which one you're in (or out front of, on its terrace), or null. */
  at(): VenueId | null;
  /** The counter `it` is, or null if it's something else. */
  counter(it: Interactable): VenueId | null;
  /** Someone ordered at `id`: whoever's behind the counter makes it. Where it's made, for its sound. */
  serve(id: VenueId): { x: number; y: number; z: number };
  /** How much of each one's murmur (and the bar's music) you hear: 1 inside, less out by the door. */
  hearing(): { id: VenueId; level: number } | null;
  /** `people` are everyone about, you first: doors open for them, the rooms come and go with you. */
  update(t: number, dt: number, people: readonly { x: number; y: number; z: number }[]): void;
}

const E = Math.PI / 2;
/** How close you have to be to see in. */
const NEAR = 34;
/** And to see its terrace's chairs: the furniture loads the first time you're this close. */
const FURNISH = 140;
/**
 * And how close (from its walls) for the people in there to be about: a couple of dozen draw calls
 * each, so only once you're on its terrace, at its windows or inside.
 */
const CLOSE = 9;

// ---- Building blocks -----------------------------------------------------------------------------

const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 14);
const BALL = new THREE.SphereGeometry(1, 10, 8);

/** A box `w` × `h` × `d` of `color` into `g`, standing on y (its bottom), turned `rotY`. */
function box(g: THREE.Object3D, color: string, x: number, y: number, z: number, w: number, h: number, d: number, rotY = 0) {
  const m = mesh(BOX, toon(color), x, y + h / 2, z);
  m.scale.set(w, h, d);
  m.rotation.y = rotY;
  g.add(m);
  return m;
}

/** A box between two corners, standing on y0 up to y1. */
function span(g: THREE.Object3D, color: string, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) {
  return box(g, color, (x0 + x1) / 2, y0, (z0 + z1) / 2, Math.abs(x1 - x0), y1 - y0, Math.abs(z1 - z0));
}

function cyl(g: THREE.Object3D, color: string, x: number, y: number, z: number, r: number, h: number) {
  const m = mesh(CYL, toon(color), x, y + h / 2, z);
  m.scale.set(r, h, r);
  g.add(m);
  return m;
}

function ball(g: THREE.Object3D, color: string, x: number, y: number, z: number, r: number) {
  const m = mesh(BALL, toon(color), x, y, z, false);
  m.scale.setScalar(r);
  g.add(m);
  return m;
}

/** Flat faces of one look piling up into a mesh: walls, a ceiling, a floor. Each faces one way only. */
class Faces {
  pos: number[] = [];
  norm: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  private c = new THREE.Color();

  /**
   * A rectangle facing `n` (one of ±x, ±z, ±y), its middle at (x, y, z), `w` across and `h` up (on the
   * ground or overhead, `w` along x and `h` along z). UVs are in meters, so a texture repeats by size.
   */
  quad(n: 'x+' | 'x-' | 'z+' | 'z-' | 'y+' | 'y-', x: number, y: number, z: number, w: number, h: number, color = '#ffffff') {
    const hw = w / 2;
    const hh = h / 2;
    // Corners counter-clockwise seen from the side it faces.
    let p: number[][];
    if (n === 'z+') p = [[x - hw, y - hh, z], [x + hw, y - hh, z], [x + hw, y + hh, z], [x - hw, y + hh, z]];
    else if (n === 'z-') p = [[x + hw, y - hh, z], [x - hw, y - hh, z], [x - hw, y + hh, z], [x + hw, y + hh, z]];
    else if (n === 'x+') p = [[x, y - hh, z + hw], [x, y - hh, z - hw], [x, y + hh, z - hw], [x, y + hh, z + hw]];
    else if (n === 'x-') p = [[x, y - hh, z - hw], [x, y - hh, z + hw], [x, y + hh, z + hw], [x, y + hh, z - hw]];
    else if (n === 'y+') p = [[x - hw, y, z + hh], [x + hw, y, z + hh], [x + hw, y, z - hh], [x - hw, y, z - hh]];
    else p = [[x - hw, y, z - hh], [x + hw, y, z - hh], [x + hw, y, z + hh], [x - hw, y, z + hh]];
    const normal = { 'x+': [1, 0, 0], 'x-': [-1, 0, 0], 'z+': [0, 0, 1], 'z-': [0, 0, -1], 'y+': [0, 1, 0], 'y-': [0, -1, 0] }[n];
    // Meters along the face from its middle, for the texture.
    const u0 = (n[0] === 'z' || n[0] === 'y' ? x : z) - hw;
    const v0 = (n[0] === 'y' ? z : y) - hh;
    const uvs = [[u0, v0], [u0 + w, v0], [u0 + w, v0 + h], [u0, v0 + h]];
    this.c.set(color);
    for (const k of [0, 1, 2, 0, 2, 3]) {
      this.pos.push(...p[k]);
      this.norm.push(...normal);
      this.uv.push(...uvs[k]);
      this.col.push(this.c.r, this.c.g, this.c.b);
    }
  }

  mesh(mat: THREE.Material): THREE.Mesh {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.norm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    return m;
  }
}

/** A toon material for Faces: the vertices' colors, a texture if given, and no ink outline (they're flat). */
function facesMaterial(map?: THREE.Texture): THREE.MeshToonMaterial {
  const m = (toon('#ffffff') as THREE.MeshToonMaterial).clone();
  m.vertexColors = true;
  if (map) m.map = map;
  m.userData.outlineParameters = { visible: false };
  return m;
}

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** Café floor: cream and terracotta tiles, a meter of them (two by two) to the texture. */
const tiles = () =>
  canvasTexture(128, 128, (g) => {
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        g.fillStyle = (i + j) % 2 ? '#c8674a' : '#f3e6cf';
        g.fillRect(i * 64, j * 64, 64, 64);
      }
    }
    g.strokeStyle = 'rgba(80,50,30,0.25)';
    g.lineWidth = 2;
    for (let k = 0; k <= 128; k += 64) {
      g.beginPath();
      g.moveTo(k, 0);
      g.lineTo(k, 128);
      g.moveTo(0, k);
      g.lineTo(128, k);
      g.stroke();
    }
  });

/** Bar floor: dark boards, a meter of them to the texture. */
const planks = () =>
  canvasTexture(128, 128, (g) => {
    for (let r = 0; r < 8; r++) {
      const tone = 0.85 + ((r * 37) % 11) / 50;
      g.fillStyle = `rgb(${Math.round(150 * tone)}, ${Math.round(98 * tone)}, ${Math.round(62 * tone)})`;
      g.fillRect(0, r * 16, 128, 15);
      g.fillStyle = 'rgba(30,15,5,0.5)';
      g.fillRect(((r * 53) % 7) * 18, r * 16, 2, 16);
    }
  });

/** Brick, a meter by a meter, for the bar's walls outside. */
const bricks = () =>
  canvasTexture(128, 128, (g) => {
    g.fillStyle = '#e7d9c4';
    g.fillRect(0, 0, 128, 128);
    const tones = ['#a4503c', '#9a4634', '#b0594a', '#8f3f30'];
    for (let r = 0; r < 16; r++) {
      for (let c = -1; c < 4; c++) {
        g.fillStyle = tones[(r * 3 + c * 5 + 8) % tones.length];
        g.fillRect(c * 32 + (r % 2) * 16 + 1, r * 8 + 1, 30, 6);
      }
    }
  });

/** A sign's lettering on a board, `w` × `h` pixels. `neon` glows instead. */
function signTexture(text: string, w: number, h: number, o: { bg?: string; ink: string; neon?: string; font?: string }): THREE.CanvasTexture {
  return canvasTexture(
    w,
    h,
    (g) => {
      if (o.bg) {
        g.fillStyle = o.bg;
        g.fillRect(0, 0, w, h);
      } else g.clearRect(0, 0, w, h);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      let px = h * 0.62;
      const font = (n: number) => `900 ${n}px ${o.font ?? 'Nunito, ui-rounded, system-ui, sans-serif'}`;
      g.font = font(px);
      const tw = g.measureText(text).width;
      if (tw > w * 0.9) g.font = font((px = Math.floor((px * w * 0.9) / tw)));
      for (const [blur, color] of o.neon ? ([[h * 0.25, o.neon], [h * 0.08, o.neon], [0, o.ink]] as const) : ([[0, o.ink]] as const)) {
        g.shadowColor = o.neon ?? 'transparent';
        g.shadowBlur = blur;
        g.fillStyle = color;
        g.fillText(text, w / 2, h / 2 + px * 0.05);
      }
    },
    false,
  );
}

// ---- Kenney's furniture --------------------------------------------------------------------------

const FURNITURE = {
  chair: chairUrl,
  chairCushion: chairCushionUrl,
  stoolBar: stoolBarUrl,
  loungeSofa: loungeSofaUrl,
  coffeeMachine: coffeeMachineUrl,
  lamp: lampUrl,
  pottedPlant: pottedPlantUrl,
  plantSmall1: plantSmall1Url,
  plantSmall2: plantSmall2Url,
  speaker: speakerUrl,
  ceilingFan: ceilingFanUrl,
  radio: radioUrl,
  coatRack: coatRackUrl,
  fridge: fridgeUrl,
  rug: rugUrl,
  bookcase: bookcaseUrl,
};
type Piece = keyof typeof FURNITURE;
/** How tall each stands, in meters (Kenney's are about half size). A rug's is its length. */
const TALL: Record<Piece, number> = {
  chair: 0.92,
  chairCushion: 0.92,
  stoolBar: 0.8,
  loungeSofa: 0.92,
  coffeeMachine: 0.42,
  lamp: 0.5,
  pottedPlant: 1.15,
  plantSmall1: 0.4,
  plantSmall2: 0.4,
  speaker: 1.25,
  ceilingFan: 0.32,
  radio: 0.32,
  coatRack: 1.8,
  fridge: 0.85,
  rug: 3,
  bookcase: 0.9,
};

let furniture: Promise<Map<Piece, THREE.Object3D>> | null = null;
/** Every piece, centred on its footprint and standing on the ground at its size: loaded the first time a venue's near. */
function loadFurniture(): Promise<Map<Piece, THREE.Object3D>> {
  return (furniture ??= (async () => {
    const loader = new GLTFLoader();
    const out = new Map<Piece, THREE.Object3D>();
    await Promise.all(
      (Object.keys(FURNITURE) as Piece[]).map(async (name) => {
        try {
          const scene = (await loader.loadAsync(FURNITURE[name])).scene;
          const b = new THREE.Box3().setFromObject(scene);
          const size = b.getSize(new THREE.Vector3());
          const s = TALL[name] / (name === 'rug' ? size.x : size.y);
          const c = b.getCenter(new THREE.Vector3());
          scene.position.set(-c.x, -b.min.y, -c.z);
          const g = new THREE.Group();
          g.add(scene);
          g.scale.setScalar(s);
          out.set(name, g);
        } catch (err) {
          console.error(`venues: ${name}.glb didn't load`, err);
        }
      }),
    );
    return out;
  })());
}

/** Where a piece goes: which, where, which way it faces (rotY, +z at 0), and what its materials are painted. */
interface Put {
  piece: Piece;
  x: number;
  y?: number;
  z: number;
  rotY: number;
}

/** Copies of the pieces where they go, painted, merged into one or two meshes. */
function furnish(models: Map<Piece, THREE.Object3D>, puts: readonly Put[], paint: Record<string, string>): THREE.Group {
  const holder = new THREE.Group();
  for (const p of puts) {
    const m = models.get(p.piece);
    if (!m) continue;
    const copy = m.clone();
    copy.position.set(p.x, p.y ?? 0, p.z);
    copy.rotation.y = p.rotY;
    copy.traverse((o) => {
      const mm = o as THREE.Mesh;
      if (mm.isMesh) mm.material = toon(paint[(mm.material as THREE.Material).name] ?? '#c98b5a');
    });
    holder.add(copy);
  }
  return mergeColored(holder);
}

// ---- The two venues ------------------------------------------------------------------------------

/** How each looks, and what's in it: the parts that differ between the café and the bar. */
interface Look {
  outside: string;
  /** The storefront's frames and trim. */
  trim: string;
  inside: string;
  /** The panelling along the bottom of the walls inside. */
  dado: string;
  ceiling: string;
  beams: string;
  floor: () => THREE.CanvasTexture;
  brick?: boolean;
  /** The front's windows (x from–to), and how high they go. */
  windows: [number, number][];
  sill: number;
  head: number;
  /** The upper floors' windows: x of each, and the heights of each row's bottom. */
  upper: { xs: number[]; rows: number[]; w: number; h: number; frame: string; box?: string };
  /** Kenney's materials' colors here. */
  paint: Record<string, string>;
}

const LOOKS: Record<VenueId, Look> = {
  cafe: {
    outside: '#f4e4c8',
    trim: '#2f5d50',
    inside: '#fbefd9',
    dado: '#86ad94',
    ceiling: '#fff8ec',
    beams: '#a0704a',
    floor: tiles,
    windows: [
      [61.55, 62.95],
      [65.3, 74.45],
    ],
    sill: 0.6,
    head: 2.7,
    upper: { xs: [62.6, 66.1, 69.6, 73.1], rows: [5.0], w: 1.4, h: 1.8, frame: '#ffffff', box: '#e76f51' },
    paint: { wood: '#c98b5a', woodDark: '#8a5a3b', carpet: '#e07a5f', carpetWhite: '#f4f1ea', carpetDarker: '#a8513b', carpetBlue: '#5b8fb9', metal: '#c9ced6', metalMedium: '#5c6b73', metalLight: '#eef2f4', metalDark: '#3d405b', plant: '#5fb760', lamp: '#ffe8a3', glass: '#cfe8f3', _defaultMat: '#f4f1ea' },
  },
  bar: {
    outside: '#ffffff',
    trim: '#1f2a2e',
    inside: '#3f6655',
    dado: '#5a3522',
    ceiling: '#5a463a',
    beams: '#4a3222',
    floor: planks,
    brick: true,
    windows: [
      [63.4, 67.4],
      [68.8, 72.8],
      [74, 76.4],
    ],
    sill: 0.95,
    head: 2.55,
    upper: { xs: [60.8, 64, 67.2, 70.4, 73.6, 76], rows: [4.6, 7.9], w: 1.2, h: 1.6, frame: '#e9e2d6' },
    paint: { wood: '#6b3f24', woodDark: '#4a2c1d', carpet: '#8e2b3c', carpetWhite: '#e9e2d6', carpetDarker: '#5e1b28', carpetBlue: '#1d4e5f', metal: '#d4a64a', metalMedium: '#3d405b', metalLight: '#e9e2d6', metalDark: '#2b2d42', plant: '#4ea657', lamp: '#ffd27a', glass: '#9cc9d6', _defaultMat: '#e9e2d6' },
  },
};

/** One venue as built: what moves, and what's shown when. */
interface Built {
  v: Venue;
  /** The outside walls (hidden while you're in, so the camera sees in from wherever it is). */
  shell: THREE.Group;
  /** The room and everything in it: only while you're near. */
  room: THREE.Group;
  glass: THREE.MeshBasicMaterial;
  doors: { leaf: THREE.Object3D; open: number; sign: 1 | -1 }[];
  staff: Person;
  /** Where the one behind the counter drifts to, along it (x for the café, z for the bar), and when they next wander. */
  tend: { to: number; next: number; min: number; max: number };
  regulars: { person: Person; when: 'day' | 'night' | 'always' }[];
  fan: THREE.Object3D | null;
  /** Where things are made: the espresso machine, the taps. */
  makeAt: { x: number; y: number; z: number };
  /** Kenney's pieces, and whether they've been sent for yet. */
  puts: Put[];
  loaded: boolean;
  near: boolean;
}

export function buildVenues(night: NightParts): Venues {
  const group = new THREE.Group();
  const colliders: Collider[] = [];
  const interactables: Interactable[] = [];
  const counters = new Map<Interactable, VenueId>();
  /** Furniture, toon-painted: per venue. */
  const built: Built[] = [];
  let street = STREET_Y;
  /** You, last frame: in which venue (or on its terrace), and how far in. */
  let here: { id: VenueId; level: number } | null = null;

  /** Where you were last frame, for the staff to come over to. */
  let lastYou: { x: number; y: number; z: number } | null = null;
  // Something to sit on at each seat (shared/venues.ts), for E.
  for (const s of VENUE_SEATS) {
    const it: Interactable = { kind: 'seat', seatId: s.id, x: s.x, y: street, z: s.z, radius: s.places.length > 1 ? 1.5 : 1 };
    interactables.push(it);
    // Something to click on that isn't drawn: the seat's piece of furniture merges with the rest.
    const hit = new THREE.Mesh(BOX, new THREE.MeshBasicMaterial({ visible: false }));
    hit.scale.set(s.places.length > 1 ? 2 : 0.6, 1, 0.6);
    hit.position.set(s.x, 0.5, s.z);
    hit.rotation.y = s.rotY;
    hit.userData.interact = it;
    group.add(hit);
  }

  for (const v of VENUES) {
    const look = LOOKS[v.id];
    const { minX, maxX, minZ, maxZ } = v.box;
    const T = VENUE_WALL;
    const fz = v.fz;
    const front = frontZ(v);
    const back = fz > 0 ? minZ : maxZ;
    /** z a little in from the front (+) or out from it (-). */
    const inFrom = (d: number) => front - fz * d;
    const midX = (minX + maxX) / 2;
    const midZ = (minZ + maxZ) / 2;
    const C = v.ceiling;
    const H = v.height;
    const holes = [
      { x0: v.door.x - v.door.w / 2, x1: v.door.x + v.door.w / 2, y0: 0, y1: 2.45 },
      ...look.windows.map(([x0, x1]) => ({ x0, x1, y0: look.sill, y1: look.head })),
    ];
    const venue = new THREE.Group();
    group.add(venue);

    // ---- Outside: the walls, the storefront, the floors over it, the sign, the awning.
    const shell = new THREE.Group();
    venue.add(shell);
    const out = new Faces();
    const nOut = fz > 0 ? 'z+' : 'z-';
    for (const p of wallPieces(minX, maxX, 0, H, holes)) out.quad(nOut, (p.x0 + p.x1) / 2, (p.y0 + p.y1) / 2, front, p.x1 - p.x0, p.y1 - p.y0, look.outside);
    out.quad(fz > 0 ? 'z-' : 'z+', midX, H / 2, back, maxX - minX, H, look.outside);
    out.quad('x-', minX, H / 2, midZ, maxZ - minZ, H, look.outside);
    out.quad('x+', maxX, H / 2, midZ, maxZ - minZ, H, look.outside);
    const brick = look.brick ? bricks() : undefined;
    // Two meters of brick to the texture.
    brick?.repeat.set(0.5, 0.5);
    shell.add(out.mesh(facesMaterial(brick)));

    const trim = new THREE.Group();
    const t = look.trim;
    const fo = front + fz * 0.04;
    // The storefront: frames round the openings, mullions, a kick plate under the glass, the fascia over it.
    for (const h of holes) {
      span(trim, t, h.x0 - 0.08, h.x0, h.y0, h.y1 + 0.08, front - fz * T, fo);
      span(trim, t, h.x1, h.x1 + 0.08, h.y0, h.y1 + 0.08, front - fz * T, fo);
      span(trim, t, h.x0 - 0.08, h.x1 + 0.08, h.y1, h.y1 + 0.08, front - fz * T, fo);
      if (h.y0 > 0) {
        span(trim, t, h.x0 - 0.08, h.x1 + 0.08, h.y0 - 0.06, h.y0, front - fz * T, front + fz * 0.12);
        span(trim, t, h.x0, h.x1, 0, h.y0 - 0.06, front - fz * 0.02, fo);
      }
      const panes = Math.max(1, Math.round((h.x1 - h.x0) / 1.8));
      if (h.y0 > 0) for (let k = 1; k < panes; k++) span(trim, t, h.x0 + ((h.x1 - h.x0) * k) / panes - 0.04, h.x0 + ((h.x1 - h.x0) * k) / panes + 0.04, h.y0, h.y1, front - fz * 0.15, front - fz * 0.05);
    }
    span(trim, t, minX, maxX, 2.75, 3.45, front, front + fz * 0.12);
    span(trim, t, minX - 0.05, maxX + 0.05, 0, 0.25, front, front + fz * 0.08);
    // The floors over it: windows with frames (and flower boxes at the café), a cornice at the top.
    const u = look.upper;
    for (const y of u.rows) {
      for (const x of u.xs) {
        span(trim, '#3a5a78', x - u.w / 2, x + u.w / 2, y, y + u.h, front, front + fz * 0.03);
        span(trim, u.frame, x - u.w / 2 - 0.1, x + u.w / 2 + 0.1, y - 0.12, y, front, front + fz * 0.14);
        span(trim, u.frame, x - u.w / 2 - 0.1, x + u.w / 2 + 0.1, y + u.h, y + u.h + 0.12, front, front + fz * 0.08);
        span(trim, u.frame, x - 0.04, x + 0.04, y, y + u.h, front, front + fz * 0.06);
        if (u.box) {
          span(trim, u.box, x - u.w / 2, x + u.w / 2, y - 0.4, y - 0.12, front + fz * 0.05, front + fz * 0.35);
          for (let k = 0; k < 5; k++) ball(trim, k % 2 ? '#ff8fab' : '#5fb760', x - u.w / 2 + 0.15 + k * ((u.w - 0.3) / 4), y - 0.05, front + fz * 0.2, 0.13);
        }
      }
    }
    // The cornice round the top (its top's the roof), and a parapet round that.
    span(trim, '#9a958c', minX - 0.15, maxX + 0.15, H - 0.3, H, minZ - 0.15, maxZ + 0.15);
    const cap = look.brick ? '#e9e2d6' : '#d9c7a7';
    span(trim, cap, minX - 0.15, maxX + 0.15, H - 0.32, H - 0.12, minZ - 0.17, maxZ + 0.17);
    span(trim, cap, minX - 0.15, maxX + 0.15, H, H + 0.4, minZ - 0.15, minZ + 0.1);
    span(trim, cap, minX - 0.15, maxX + 0.15, H, H + 0.4, maxZ - 0.1, maxZ + 0.15);
    span(trim, cap, minX - 0.15, minX + 0.1, H, H + 0.4, minZ, maxZ);
    span(trim, cap, maxX - 0.1, maxX + 0.15, H, H + 0.4, minZ, maxZ);
    // Side windows upstairs, so it isn't a blank box from down the street.
    for (const y of u.rows) {
      for (const sx of [minX, maxX]) {
        const n = sx === minX ? -1 : 1;
        span(trim, '#3a5a78', sx, sx + n * 0.03, y, y + u.h, midZ - u.w / 2, midZ + u.w / 2);
        span(trim, u.frame, sx, sx + n * 0.12, y - 0.12, y, midZ - u.w / 2 - 0.1, midZ + u.w / 2 + 0.1);
      }
    }
    shell.add(mergeColored(trim));

    // ---- What's always out front: the sign, the awning, the terrace, the glass.
    const outside = new THREE.Group();
    const paving = new Faces();
    const tz0 = Math.min(v.terrace.minZ, v.terrace.maxZ);
    const tz1 = Math.max(v.terrace.minZ, v.terrace.maxZ);
    paving.quad('y+', midX, 0.02, (tz0 + tz1) / 2, maxX - minX, tz1 - tz0, v.id === 'cafe' ? '#dccbad' : '#8e8a83');
    venue.add(paving.mesh(facesMaterial()));

    if (v.id === 'cafe') {
      // A striped awning over the windows, sloping down toward the street.
      const n = 18;
      for (let k = 0; k < n; k++) {
        const x = minX + 0.2 + ((maxX - minX - 0.4) * (k + 0.5)) / n;
        const m = box(outside, k % 2 ? '#f6f1e4' : '#2f5d50', x, 3.25, front + fz * 0.85, (maxX - minX - 0.4) / n, 0.06, 1.7);
        m.rotation.x = fz * 0.32;
        box(outside, k % 2 ? '#f6f1e4' : '#2f5d50', x, 2.78, front + fz * 1.68, (maxX - minX - 0.4) / n, 0.24, 0.04);
      }
    } else {
      // A canopy over the door, and the string lights out over the terrace.
      box(outside, '#1d4e5f', v.door.x, 2.85, front + fz * 0.7, 2.6, 0.14, 1.4);
      box(outside, '#d4a64a', v.door.x, 2.82, front + fz * 1.4, 2.6, 0.2, 0.04);
      const posts = [minX + 1, (minX + maxX) / 2, maxX - 1];
      const lights = new THREE.Group();
      const festoon = bulb(night, '#ffd27a', 0.5);
      for (const x of posts) {
        cyl(outside, '#2b2d42', x, 0, front + fz * 3.6, 0.06, 2.9);
        colliders.push({ minX: x - 0.12, maxX: x + 0.12, minZ: front + fz * 3.6 - 0.12, maxZ: front + fz * 3.6 + 0.12, top: 2.9 });
      }
      // From the wall over the windows out to the posts, sagging, a bulb every half meter.
      for (const [ax, bx] of [
        [minX + 1, posts[0]],
        [midX - 3, posts[1]],
        [midX + 3, posts[1]],
        [maxX - 1, posts[2]],
        [posts[0], posts[1]],
        [posts[1], posts[2]],
      ]) {
        const fromWall = ax !== posts[0] && ax !== posts[1];
        const a = new THREE.Vector3(ax, fromWall ? 3.6 : 2.85, fromWall ? front + fz * 0.1 : front + fz * 3.6);
        const b = new THREE.Vector3(bx, 2.85, front + fz * 3.6);
        const mid = a.clone().add(b).multiplyScalar(0.5);
        mid.y -= 0.5;
        const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
        outside.add(mesh(new THREE.TubeGeometry(curve, 16, 0.012, 4), toon('#2b2d42'), 0, 0, 0, false));
        const n = Math.max(2, Math.round(curve.getLength() / 0.5));
        for (let i = 1; i < n; i++) {
          const p = curve.getPoint(i / n);
          const bl = mesh(BALL, festoon, p.x, p.y - 0.05, p.z, false);
          bl.scale.setScalar(0.05);
          lights.add(bl);
        }
      }
      venue.add(mergeByMaterial(lights));
    }

    // The terrace's tables (Kenney's chairs come later, with the rest of the furniture).
    const terraceTables = v.id === 'cafe' ? [66.5, 71.5] : [66, 71];
    const tableZ = v.id === 'cafe' ? 19.2 : 35;
    for (const x of terraceTables) {
      if (v.id === 'cafe') {
        cyl(outside, '#f4f1ea', x, 0.72, tableZ, 0.4, 0.04);
        cyl(outside, '#2b2d42', x, 0, tableZ, 0.04, 0.72);
        cyl(outside, '#2b2d42', x, 0, tableZ, 0.24, 0.03);
        // A parasol over it.
        cyl(outside, '#f4f1ea', x, 0.76, tableZ, 0.03, 1.9);
        const top = mesh(new THREE.ConeGeometry(1.45, 0.5, 8), toon('#e07a5f'), x, 2.85, tableZ);
        outside.add(top);
        ball(outside, '#f4f1ea', x, 3.12, tableZ, 0.06);
        colliders.push({ minX: x - 0.4, maxX: x + 0.4, minZ: tableZ - 0.4, maxZ: tableZ + 0.4, top: 0.76 });
      } else {
        // A barrel for a table, with its hoops.
        cyl(outside, '#7a4a2e', x, 0, tableZ, 0.38, 1.0);
        for (const y of [0.15, 0.82]) cyl(outside, '#3d405b', x, y, tableZ, 0.39, 0.05);
        colliders.push({ minX: x - 0.38, maxX: x + 0.38, minZ: tableZ - 0.38, maxZ: tableZ + 0.38, top: 1.0 });
      }
    }
    // Planters either side, clear of the door, and the chalk A-board out by the sidewalk.
    const plant = (x0: number, x1: number) => {
      const z0 = front + fz * 3.2;
      const z1 = front + fz * 3.8;
      span(outside, v.id === 'cafe' ? '#2f5d50' : '#3e2a1c', x0, x1, 0, 0.5, z0, z1);
      for (let x = x0 + 0.25; x < x1; x += 0.45) ball(outside, (x * 7) % 2 > 1 ? '#5fb760' : '#4ea657', x, 0.62, (z0 + z1) / 2, 0.26);
      colliders.push({ minX: x0, maxX: x1, minZ: Math.min(z0, z1), maxZ: Math.max(z0, z1), top: 0.5 });
    };
    plant(minX + 0.3, v.door.x - v.door.w / 2 - 0.6);
    plant(maxX - 1.8, maxX - 0.3);
    const ax = v.id === 'cafe' ? 65.6 : 64.2;
    const az = front + fz * 3.5;
    for (const s of [-1, 1]) {
      const leg = box(outside, '#6b3f24', ax, 0, az + s * 0.18, 0.62, 1.0, 0.05);
      leg.rotation.x = s * 0.2;
      const board = box(outside, '#2b2d42', ax, 0.15, az + s * 0.2, 0.52, 0.75, 0.03);
      board.rotation.x = s * 0.2;
    }
    colliders.push({ minX: ax - 0.35, maxX: ax + 0.35, minZ: az - 0.3, maxZ: az + 0.3, top: 1.0 });
    venue.add(mergeColored(outside));

    // The name over the windows: painted letters at the café, neon at the bar.
    const signW = v.id === 'cafe' ? 6 : 8;
    const signTex =
      v.id === 'cafe'
        ? signTexture('☕ Café Corner', 1024, 128, { bg: '#2f5d50', ink: '#fff3d6', font: 'Georgia, serif' })
        : signTexture('🦉 The Night Owl', 1024, 128, { ink: '#fff2c4', neon: '#ffb347', font: 'Georgia, serif' });
    const signMat = new THREE.MeshBasicMaterial({ map: signTex, transparent: v.id === 'bar', toneMapped: false });
    // (The café's over its awning, the bar's over its windows.)
    const sign = mesh(new THREE.PlaneGeometry(signW, signW / 8), signMat, v.id === 'cafe' ? 68 : midX + 1, v.id === 'cafe' ? 4.05 : 3.1, front + fz * (v.id === 'cafe' ? 0.06 : 0.14), false);
    sign.rotation.y = fz > 0 ? 0 : Math.PI;
    venue.add(sign);

    // The glass in the windows and the door: clear while you're close enough to see in, lit up from inside at night.
    const glass = new THREE.MeshBasicMaterial({ color: '#bfe3ff', transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide });
    glass.userData.outlineParameters = { visible: false };
    const panes = new Faces();
    for (const [x0, x1] of look.windows) panes.quad(nOut, (x0 + x1) / 2, (look.sill + look.head) / 2, front - fz * 0.1, x1 - x0, look.head - look.sill);
    const paneMesh = panes.mesh(glass);
    paneMesh.renderOrder = 2;
    venue.add(paneMesh);

    // The double door: two glass leaves, hinged at the frame, swinging out when anyone comes up to it.
    const doors: Built['doors'] = [];
    for (const s of [-1, 1] as const) {
      const leaf = new THREE.Group();
      const w = v.door.w / 2;
      const frame = new THREE.Group();
      span(frame, t, 0, 0.07, 0, 2.4, -0.03, 0.03);
      span(frame, t, w - 0.07, w, 0, 2.4, -0.03, 0.03);
      span(frame, t, 0, w, 0, 0.3, -0.03, 0.03);
      span(frame, t, 0, w, 2.33, 2.4, -0.03, 0.03);
      span(frame, '#d4a64a', w - 0.2, w - 0.16, 0.9, 1.3, -0.08, 0.08);
      leaf.add(mergeColored(frame));
      const pane = mesh(new THREE.PlaneGeometry(w - 0.14, 2.03), glass, w / 2, 1.315, 0, false);
      pane.renderOrder = 2;
      leaf.add(pane);
      // The hinge at the frame's edge; the leaf reaches toward the middle of the doorway.
      leaf.position.set(v.door.x + s * w, 0, front - fz * 0.12);
      leaf.scale.x = -s;
      venue.add(leaf);
      doors.push({ leaf, open: 0, sign: s });
    }

    // ---- Inside: the room, built now but only shown when you're near.
    const room = new THREE.Group();
    room.visible = false;
    venue.add(room);
    const inner = new Faces();
    const x0 = minX + T;
    const x1 = maxX - T;
    const zb = back + fz * T;
    const zf = front - fz * T;
    const nIn = fz > 0 ? 'z-' : 'z+';
    // The front from inside, round its door and windows; the back and sides; the ceiling.
    for (const p of wallPieces(x0, x1, 0, C, holes)) inner.quad(nIn, (p.x0 + p.x1) / 2, (p.y0 + p.y1) / 2, zf, p.x1 - p.x0, p.y1 - p.y0, look.inside);
    inner.quad(fz > 0 ? 'z+' : 'z-', midX, C / 2, zb, x1 - x0, C, look.inside);
    inner.quad('x+', x0, C / 2, midZ, maxZ - minZ - 2 * T, C, look.inside);
    inner.quad('x-', x1, C / 2, midZ, maxZ - minZ - 2 * T, C, look.inside);
    inner.quad('y-', midX, C, midZ, x1 - x0, maxZ - minZ - 2 * T, look.ceiling);
    room.add(inner.mesh(facesMaterial()));
    const floor = new Faces();
    floor.quad('y+', midX, 0.015, midZ, x1 - x0, maxZ - minZ - 2 * T);
    room.add(floor.mesh(facesMaterial(look.floor())));
    // The ceiling's under the floors upstairs: you can't jump through it, and the camera stays under it.
    colliders.push({ minX, maxX, minZ, maxZ, bottom: C, top: C + 0.3 });

    const stuff = new THREE.Group();
    // Panelling round the bottom of the walls, and beams across the ceiling.
    const dadoH = v.id === 'cafe' ? 0.95 : 1.1;
    span(stuff, look.dado, x0, x1, 0, dadoH, zb, zb + fz * 0.04);
    span(stuff, look.dado, x0, x0 + 0.04, 0, dadoH, minZ + T, maxZ - T);
    span(stuff, look.dado, x1 - 0.04, x1, 0, dadoH, minZ + T, maxZ - T);
    span(stuff, look.beams, x0, x1, dadoH, dadoH + 0.06, zb, zb + fz * 0.07);
    for (let x = x0 + 1.5; x < x1 - 0.5; x += 2.6) span(stuff, look.beams, x - 0.1, x + 0.1, C - 0.2, C, minZ + T, maxZ - T);
    // Lamps hanging over the counter: their bulbs glow at night, and light the room round them (sky.ts).
    const bulbs = new THREE.Group();
    const glowMat = bulb(night, '#ffd9a0', 0.35);
    const lampAt = (x: number, z: number, y: number) => {
      cyl(stuff, '#2b2d42', x, y + 0.3, z, 0.01, C - y - 0.3);
      const shade = mesh(new THREE.ConeGeometry(0.22, 0.24, 12, 1, true), toon(v.id === 'cafe' ? '#2f5d50' : '#d4a64a'), x, y + 0.2, z);
      stuff.add(shade);
      const b = mesh(BALL, glowMat, x, y + 0.08, z, false);
      b.scale.setScalar(0.07);
      bulbs.add(b);
      night.halos.push({ at: new THREE.Vector3(x, STREET_Y + y + 0.08, z), size: 0.6, color: '#ffd9a0', ground: true });
    };

    // ---- Each one's own: counters, shelves, tables, the menu, the people.
    let makeAt = { x: midX, y: 1.2, z: midZ };
    const puts: Put[] = [];
    const add = (piece: Piece, x: number, z: number, rotY: number, y = 0) => puts.push({ piece, x, z, rotY, y });
    const seatPut = (piece: Piece, id: string) => {
      const s = VENUE_SEATS.find((q) => q.id === id)!;
      add(piece, s.x, s.z, s.rotY);
    };
    let staff: Person;
    let tend: Built['tend'];
    const regulars: Built['regulars'] = [];
    const person = (name: string, color: string, seed: string) => {
      const p = new Person(name, color, lookFromSeed(seed));
      p.showLabel(false);
      room.add(p.root);
      return p;
    };
    /** A regular sat at (x, z) facing rotY, hips that high, with a mug or a drink. */
    const regular = (seed: string, color: string, x: number, z: number, rotY: number, hips: number | null, when: 'day' | 'night' | 'always', holding: DrinkId | 'mug', read = false) => {
      const p = person(seed, color, seed);
      p.root.position.set(x, 0, z);
      p.root.rotation.y = rotY;
      p.sit(hips);
      if (holding === 'mug') p.holdMug(true);
      else p.holdDrink(DRINK_BY_ID.get(holding) ?? null);
      if (read) p.read(true);
      regulars.push({ person: p, when });
    };

    if (v.id === 'cafe') {
      /** The counter's top. */
      const CT = 0.94;
      // The counter across the back, an L round the barista, marble on top, slats down its front.
      span(stuff, '#7a4a2e', 64.6, x1, 0, CT - 0.06, 7.6, 8.4);
      span(stuff, '#7a4a2e', 64.6, 65.4, 0, CT - 0.06, zb, 7.6);
      for (let x = 64.8; x < x1 - 0.1; x += 0.3) span(stuff, '#a0704a', x, x + 0.16, 0.08, CT - 0.14, 8.4, 8.44);
      span(stuff, '#ece6dc', 64.55, x1, CT - 0.06, CT, 7.55, 8.48);
      span(stuff, '#ece6dc', 64.55, 65.45, CT - 0.06, CT, zb, 7.6);
      colliders.push({ minX: 64.6, maxX: x1, minZ: 7.6, maxZ: 8.4, top: CT }, { minX: 64.6, maxX: 65.4, minZ: zb, maxZ: 7.6, top: CT });
      // The espresso machine: chrome, two group heads with cups under them, a steam wand, cups warming on top.
      const ex = 71.8;
      span(stuff, '#c9ced6', ex - 0.5, ex + 0.5, CT, CT + 0.5, 7.7, 8.2);
      span(stuff, '#b5462f', ex - 0.5, ex + 0.5, CT + 0.34, CT + 0.4, 8.2, 8.22);
      for (const dx of [-0.22, 0.22]) {
        cyl(stuff, '#3d405b', ex + dx, CT + 0.22, 8.3, 0.06, 0.1);
        cyl(stuff, '#2b2d42', ex + dx, CT + 0.16, 8.38, 0.012, 0.08);
        cyl(stuff, '#f4f1ea', ex + dx, CT, 8.3, 0.04, 0.07);
      }
      cyl(stuff, '#c9ced6', ex + 0.42, CT + 0.06, 8.32, 0.01, 0.3);
      for (let k = 0; k < 6; k++) cyl(stuff, '#f4f1ea', ex - 0.35 + k * 0.14, CT + 0.5, 7.95, 0.045, 0.08);
      makeAt = { x: ex, y: CT + 0.25, z: 8.2 };
      // The pastry case: croissants and cupcakes under glass.
      span(stuff, '#7a4a2e', 66.9, 68.7, CT, CT + 0.06, 7.7, 8.35);
      for (let k = 0; k < 4; k++) {
        const c = mesh(new THREE.CapsuleGeometry(0.05, 0.12, 4, 8), toon('#e0a85a'), 67.15 + k * 0.42, CT + 0.12, 7.9);
        c.rotation.z = E;
        stuff.add(c);
        cyl(stuff, '#f2b5c8', 67.15 + k * 0.42, CT + 0.06, 8.15, 0.05, 0.07);
        ball(stuff, '#ff8fab', 67.15 + k * 0.42, CT + 0.16, 8.15, 0.05);
      }
      const case_ = mesh(BOX, glass, 67.8, CT + 0.26, 8.02, false);
      case_.scale.set(1.8, 0.4, 0.62);
      case_.renderOrder = 2;
      room.add(case_);
      // The till, a tip jar, a stack of cups.
      span(stuff, '#2b2d42', 69.5, 69.9, CT, CT + 0.12, 7.85, 8.2);
      const till = box(stuff, '#3d405b', 69.7, CT + 0.12, 8.0, 0.36, 0.22, 0.04);
      till.rotation.x = -0.3;
      cyl(stuff, '#cfe8f3', 70.3, CT, 8.3, 0.06, 0.16);
      for (let k = 0; k < 5; k++) cyl(stuff, '#f4f1ea', 73.4, CT + k * 0.07, 8.0, 0.05, 0.065);
      // Shelves on the back wall either side of the menu: jars, bags of beans, cups.
      for (const [sx0, sx1] of [
        [65.6, 68.8],
        [71.2, 74.5],
      ]) {
        for (const y of [1.55, 2.15]) {
          span(stuff, '#a0704a', sx0, sx1, y, y + 0.04, zb, zb + 0.3);
          for (let x = sx0 + 0.18, k = 0; x < sx1 - 0.1; x += 0.32, k++) {
            if (k % 3 === 0) span(stuff, ['#8a5a3b', '#c1440e', '#2f5d50'][k % 3], x - 0.1, x + 0.1, y + 0.04, y + 0.34, zb + 0.06, zb + 0.22);
            else if (k % 3 === 1) cyl(stuff, '#e9c46a', x, y + 0.04, zb + 0.15, 0.08, 0.22);
            else cyl(stuff, '#f4f1ea', x, y + 0.04, zb + 0.15, 0.06, 0.1);
          }
        }
      }
      // A back counter under them, with the grinder (Kenney's coffee machine) and a radio on it.
      span(stuff, '#7a4a2e', 65.4, x1, 0, 0.92, zb, zb + 0.6);
      span(stuff, '#ece6dc', 65.4, x1, 0.92, 0.96, zb, zb + 0.62);
      add('coffeeMachine', 66.4, zb + 0.3, 0, 0.96);
      add('radio', 73.8, zb + 0.25, 0, 0.96);
      // Tables in the middle of the room (Kenney's chairs round them), the stools at the window, the sofa.
      for (const tx of [67.2, 70.6, 73.6]) {
        cyl(stuff, '#ece6dc', tx, 0.73, 11.9, 0.42, 0.04);
        cyl(stuff, '#2b2d42', tx, 0, 11.9, 0.04, 0.73);
        cyl(stuff, '#2b2d42', tx, 0, 11.9, 0.24, 0.03);
        cyl(stuff, '#f4f1ea', tx - 0.12, 0.77, 11.8, 0.05, 0.08);
        colliders.push({ minX: tx - 0.42, maxX: tx + 0.42, minZ: 11.48, maxZ: 12.32, top: 0.77 });
      }
      for (const id of ['cafe-t1-w', 'cafe-t1-e', 'cafe-t2-w', 'cafe-t2-e']) seatPut('chairCushion', id);
      add('chairCushion', 72.85, 11.9, E);
      add('chairCushion', 74.35, 11.9, -E);
      span(stuff, '#a0704a', 65.6, 74.45, 1.0, 1.05, 16.3, zf);
      for (const x of [66.5, 70, 73.5]) span(stuff, '#2b2d42', x - 0.03, x + 0.03, 0.75, 1.0, zf - 0.05, zf);
      colliders.push({ minX: 65.6, maxX: 74.45, minZ: 16.3, maxZ: zf, top: 1.05 });
      for (const id of ['cafe-window-1', 'cafe-window-2', 'cafe-window-3']) seatPut('stoolBar', id);
      add('stoolBar', 73.9, 15.6, 0);
      seatPut('loungeSofa', 'cafe-sofa');
      span(stuff, '#a0704a', 62.7, 63.3, 0, 0.42, 8.1, 9.1);
      span(stuff, '#a0704a', 62.68, 63.32, 0.42, 0.46, 8.08, 9.12);
      cyl(stuff, '#f4f1ea', 63.0, 0.46, 8.4, 0.05, 0.08);
      colliders.push({ minX: x0, maxX: 62.15, minZ: 7.6, maxZ: 9.6, top: 0.45 }, { minX: 62.7, maxX: 63.3, minZ: 8.1, maxZ: 9.1, top: 0.46 });
      // Out on the terrace: two chairs at each table.
      for (const id of ['cafe-out1-w', 'cafe-out1-e', 'cafe-out2-w', 'cafe-out2-e']) seatPut('chair', id);
      // Plants, the coat rack, a bookcase under the poster.
      add('pottedPlant', 61.75, 16.2, 0);
      add('pottedPlant', 74.25, 9.3, 0);
      add('coatRack', 61.75, 14.6, 0);
      add('bookcase', 61.5, 12.2, E);
      add('plantSmall1', 61.5, 12.6, 0, 0.9);
      add('plantSmall2', 66.0, zb + 0.15, 0, 2.19);
      for (const [x, z] of [
        [67, 8.0],
        [70.4, 8.0],
        [73.6, 8.0],
      ])
        lampAt(x, z, 2.35);
      for (const [x, z] of [
        [67.2, 11.9],
        [70.6, 11.9],
      ])
        lampAt(x, z, 2.55);
      // A warm pool of light at night (sky.ts), short enough to stay inside the walls.
      night.lamps.push({ x: 68, y: STREET_Y + 2.4, z: 11, reach: 5.2, color: '#ffcf8a', power: 2.4, ground: true });
      // The people: the barista behind the counter, a couple at the far table (one with a book), someone at the window.
      staff = person('Barista', '#6f4e37', 'barista-mo');
      staff.root.position.set(69, 0, 6.7);
      tend = { to: 69, next: 0, min: 66.2, max: 73.8 };
      regular('cafe-reader', '#8ecae6', 72.85, 11.9, E, 0.48, 'day', 'mug', true);
      regular('cafe-friend', '#f4a261', 74.35, 11.9, -E, 0.48, 'day', 'mug');
      regular('cafe-window', '#cdb4db', 73.9, 15.6, 0, 0.76, 'always', 'mug');
      // The counter: E there for a coffee.
      const it: Interactable = { kind: 'coffee', x: 69.5, y: street, z: 9.1, radius: 1.8, label: '☕ Café Corner' };
      interactables.push(it);
      counters.set(it, 'cafe');
      const hit = new THREE.Mesh(BOX, new THREE.MeshBasicMaterial({ visible: false }));
      hit.scale.set(10.2, 1.1, 0.9);
      hit.position.set(69.7, 0.55, 8.0);
      hit.userData.interact = it;
      venue.add(hit);
    } else {
      /** The bar's top. */
      const BT = 1.04;
      // The bar along the east wall: panelled wood, a dark top, a brass foot rail, the taps.
      span(stuff, '#5a3522', 73.0, 73.8, 0, BT - 0.06, 39.5, 48.5);
      for (let z = 39.7; z < 48.4; z += 0.6) span(stuff, '#6b3f24', 72.96, 73.0, 0.15, BT - 0.18, z, z + 0.45);
      span(stuff, '#3a2416', 72.9, 73.85, BT - 0.06, BT, 39.45, 48.55);
      const rail = mesh(CYL, toon('#d4a64a'), 72.75, 0.22, 44, false);
      rail.scale.set(0.025, 9, 0.025);
      rail.rotation.x = E;
      stuff.add(rail);
      for (const z of [43.4, 43.8, 44.2]) {
        cyl(stuff, '#d4a64a', 73.5, BT, z, 0.03, 0.42);
        span(stuff, ['#ef476f', '#06d6a0', '#ffd166'][Math.round((z - 43.4) / 0.4)], 73.38, 73.44, BT + 0.3, BT + 0.48, z - 0.02, z + 0.02);
      }
      makeAt = { x: 73.5, y: BT + 0.25, z: 43.8 };
      for (const z of [40.4, 41.0, 46.2, 47.4]) cyl(stuff, '#cfe8f3', 73.3, BT, z, 0.05, 0.14);
      ball(stuff, '#ffd166', 73.4, BT + 0.08, 45.4, 0.07);
      ball(stuff, '#7ed957', 73.5, BT + 0.08, 45.5, 0.07);
      // Half-doors at either end of the bar, so nobody wanders behind it.
      span(stuff, '#5a3522', 73.8, x1, 0, BT, 39.3, 39.5);
      span(stuff, '#5a3522', 73.8, x1, 0, BT, 48.5, 48.7);
      colliders.push({ minX: 73.0, maxX: 73.8, minZ: 39.5, maxZ: 48.5, top: BT }, { minX: 73.8, maxX: x1, minZ: 39.3, maxZ: 39.5, top: BT }, { minX: 73.8, maxX: x1, minZ: 48.5, maxZ: 48.7, top: BT });
      // The back bar: a cabinet with fridges, shelves of bottles against an amber glow.
      span(stuff, '#4a2c1d', 76.15, x1, 0, 0.95, 39.5, 48.5);
      add('fridge', 76.3, 41.2, -E);
      add('fridge', 76.3, 46.8, -E);
      const bottleColors = ['#2a9d8f', '#e9c46a', '#8ecae6', '#6a994e', '#bc4749', '#f4a261', '#dda15e'];
      let k = 0;
      for (const y of [1.25, 1.75, 2.25]) {
        span(stuff, '#4a2c1d', 76.3, x1, y - 0.04, y, 39.8, 48.2);
        for (let z = 40.0; z < 48.1; z += 0.24) {
          const h = 0.26 + ((k * 7) % 5) * 0.03;
          const c = bottleColors[k++ % bottleColors.length];
          cyl(stuff, c, 76.5, y, z, 0.045, h);
          cyl(stuff, c, 76.5, y + h, z, 0.015, 0.08);
        }
      }
      const amber = new THREE.MeshBasicMaterial({ color: '#ffb55a', toneMapped: false });
      room.add(mesh(new THREE.PlaneGeometry(8.4, 1.6).rotateY(-E), amber, x1 - 0.01, 1.85, 44, false));
      colliders.push({ minX: 76.15, maxX: x1, minZ: 39.5, maxZ: 48.5, top: 2.4 });
      // Booths along the west wall (Kenney's sofas) with a little table and a lamp each, and a rug.
      seatPut('loungeSofa', 'bar-booth');
      add('loungeSofa', 59.67, 46.4, E);
      for (const z of [41.6, 46.4]) {
        span(stuff, '#4a2c1d', 60.75, 61.35, 0, 0.5, z - 0.45, z + 0.45);
        add('lamp', 61.05, z - 0.25, 0, 0.5);
        colliders.push({ minX: x0, maxX: 60.15, minZ: z - 1, maxZ: z + 1, top: 0.45 }, { minX: 60.75, maxX: 61.35, minZ: z - 0.45, maxZ: z + 0.45, top: 0.5 });
      }
      add('rug', 62, 44, E, 0.02);
      // High tables in the middle, two high stools each.
      for (const z of [41.8, 46.6]) {
        cyl(stuff, '#3a2416', 66, 1.02, z, 0.42, 0.05);
        cyl(stuff, '#2b2d42', 66, 0, z, 0.05, 1.02);
        cyl(stuff, '#2b2d42', 66, 0, z, 0.28, 0.03);
        colliders.push({ minX: 65.58, maxX: 66.42, minZ: z - 0.42, maxZ: z + 0.42, top: 1.07 });
      }
      for (const s of VENUE_SEATS) if (s.id.startsWith('bar-stool') || s.id.startsWith('bar-high') || s.id.startsWith('bar-out')) seatPut('stoolBar', s.id);
      add('stoolBar', 72.35, 48.3, E);
      add('stoolBar', 70.25, 35, E);
      add('stoolBar', 71.75, 35, -E);
      // A little stage in the back corner: an upright piano, speakers, a mic, and a neon sign over it.
      span(stuff, '#3e2a1c', x0, 63.8, 0, 0.25, 48.6, zb);
      span(stuff, '#1a1a1a', 60.75, 62.25, 0.25, 1.5, 50.1, zb);
      span(stuff, '#f4f1ea', 60.8, 62.2, 0.95, 1.0, 49.9, 50.1);
      span(stuff, '#1a1a1a', 60.75, 62.25, 0.95, 1.05, 49.85, 49.9);
      cyl(stuff, '#2b2d42', 63.0, 0.25, 49.4, 0.015, 1.3);
      ball(stuff, '#2b2d42', 63.0, 1.6, 49.4, 0.05);
      add('speaker', 59.65, 50.35, Math.PI, 0.25);
      add('speaker', 63.45, 50.35, Math.PI, 0.25);
      colliders.push({ minX: x0, maxX: 63.8, minZ: 48.6, maxZ: zb, top: 0.25 }, { minX: 60.75, maxX: 62.25, minZ: 50.1, maxZ: zb, top: 1.5 });
      const jazz = new THREE.MeshBasicMaterial({ map: signTexture('♪ JAZZ ♪', 512, 128, { ink: '#ffe3fb', neon: '#ff4fd8' }), transparent: true, depthWrite: false, toneMapped: false });
      const neon = mesh(new THREE.PlaneGeometry(2.2, 0.55), jazz, 61.5, 2.8, zb - 0.02, false);
      neon.rotation.y = Math.PI;
      room.add(neon);
      add('plantSmall1', 63.6, 49.0, 0, 0.25);
      add('pottedPlant', x0 + 0.4, 38.0, 0);
      add('pottedPlant', 72.4, 38.0, 0);
      for (const z of [40.6, 44, 47.4]) lampAt(72.6, z, 2.4);
      lampAt(66, 41.8, 2.6);
      lampAt(66, 46.6, 2.6);
      night.lamps.push({ x: 68, y: STREET_Y + 2.6, z: 44, reach: 6.5, color: '#ffb86b', power: 2.4, ground: true });
      // The people: the bartender, someone at the end of the bar, a couple in the far booth, one standing at a table.
      staff = person('Bartender', '#2b2d42', 'bartender-jo');
      staff.root.position.set(75.2, 0, 44);
      staff.root.rotation.y = -E;
      tend = { to: 44, next: 0, min: 40.2, max: 47.8 };
      regular('bar-end', '#e76f51', 72.35, 48.3, E, 0.78, 'always', 'beer');
      const booth = seatPlace({ ...VENUE_SEATS.find((s) => s.id === 'bar-booth')!, z: 46.4 }, 0);
      const booth2 = seatPlace({ ...VENUE_SEATS.find((s) => s.id === 'bar-booth')!, z: 46.4 }, 1);
      regular('bar-date-a', '#cdb4db', booth.x, booth.z, E, 0.48, 'night', 'wine');
      regular('bar-date-b', '#457b9d', booth2.x, booth2.z, E, 0.48, 'night', 'martini');
      regular('bar-stand', '#06d6a0', 66.85, 46.6, -E, null, 'night', 'mojito');
      // The bar: E there for a drink.
      const it: Interactable = { kind: 'bar', x: 72.1, y: street, z: 44, radius: 2.2, label: '🦉 The Night Owl' };
      interactables.push(it);
      counters.set(it, 'bar');
      const hit = new THREE.Mesh(BOX, new THREE.MeshBasicMaterial({ visible: false }));
      hit.scale.set(0.9, 1.2, 9);
      hit.position.set(73.4, 0.6, 44);
      hit.userData.interact = it;
      venue.add(hit);
    }
    room.add(mergeColored(stuff));
    room.add(mergeByMaterial(bulbs));

    // The menu on the wall, and a poster: textures made for them (public/textures/venue-*.jpg).
    const pics = v.id === 'cafe' ? { menu: { x: 70, y: 2.4, z: zb + 0.02, w: 1.3, h: 1.56, rot: 0 }, poster: { x: x0 + 0.02, y: 2.05, z: 12.6, w: 0.9, h: 1.35, rot: E } } : { menu: { x: 70, y: 2.0, z: zb - 0.02, w: 1.1, h: 1.65, rot: Math.PI }, poster: { x: x0 + 0.02, y: 2.1, z: 44, w: 0.9, h: 1.35, rot: E } };
    const loader = new THREE.TextureLoader();
    for (const [name, p] of Object.entries(pics)) {
      const tex = loader.load(`${import.meta.env.BASE_URL}textures/venue-${v.id}-${name}.jpg`);
      tex.colorSpace = THREE.SRGBColorSpace;
      // The menu's to be read, lamp or no lamp: unlit. The poster takes the room's light.
      const mat = name === 'menu' ? new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }) : (toon('#ffffff') as THREE.MeshToonMaterial).clone();
      if (mat instanceof THREE.MeshToonMaterial) mat.map = tex;
      mat.userData.outlineParameters = { visible: false };
      const pic = mesh(new THREE.PlaneGeometry(p.w, p.h), mat, p.x, p.y, p.z, false);
      pic.rotation.y = p.rot;
      room.add(pic);
      // A frame round it.
      const f = mesh(BOX, toon(v.id === 'cafe' ? '#6b3f24' : '#d4a64a'), p.x - Math.sin(p.rot) * 0.015, p.y, p.z - Math.cos(p.rot) * 0.015);
      f.scale.set(p.w + 0.1, p.h + 0.1, 0.03);
      f.rotation.y = p.rot;
      room.add(f);
    }

    built.push({ v, shell, room, glass, doors, staff: staff!, tend: tend!, regulars, fan: null, makeAt, puts, loaded: false, near: false });
  }

  /** Sees to the furniture the first time a venue's near. */
  const furnishOnce = (b: Built) => {
    if (b.loaded) return;
    b.loaded = true;
    const { puts } = b;
    void loadFurniture().then((models) => {
      b.room.add(furnish(models, puts.filter((p) => !(b.v.id === 'cafe' && p.z > 17) && !(b.v.id === 'bar' && p.z < 37)), LOOKS[b.v.id].paint));
      // The terrace's are outside: seen from the street too.
      const outsidePuts = puts.filter((p) => (b.v.id === 'cafe' ? p.z > 17 : p.z < 37));
      if (outsidePuts.length) b.room.parent!.add(furnish(models, outsidePuts, LOOKS[b.v.id].paint));
      if (b.v.id === 'cafe') {
        const fan = models.get('ceilingFan');
        if (fan) {
          const copy = fan.clone();
          copy.traverse((o) => {
            const m = o as THREE.Mesh;
            if (m.isMesh) m.material = toon(LOOKS.cafe.paint[(m.material as THREE.Material).name] ?? '#c98b5a');
          });
          const holder = new THREE.Group();
          holder.add(copy);
          holder.position.set(64.2, b.v.ceiling - 0.34, 12.4);
          b.room.add(holder);
          b.fan = holder;
        }
      }
    });
  };

  const glassNear = new THREE.Color('#bfe3ff');
  const glassFar = new THREE.Color('#40566b');
  const glassLit = new THREE.Color('#ffcf8a');
  const darkness = () => Math.min(1, (night.windows[0]?.emissiveIntensity ?? 0) / 1.1);

  return {
    group,
    // At the street's height, as the office's other colliders down there are (it moves them with the street).
    colliders: colliders.map((c) => ({ ...c, top: c.top + STREET_Y, bottom: (c.bottom ?? 0) + STREET_Y })),
    interactables,
    setStreet(y) {
      street = y;
      for (const it of interactables) it.y = y;
    },
    at: () => here?.id ?? null,
    counter: (it) => counters.get(it) ?? null,
    serve(id) {
      const b = built.find((q) => q.v.id === id)!;
      // Over to where you are along the counter, and reach for it.
      const me = lastYou;
      if (me) b.tend.to = THREE.MathUtils.clamp(id === 'cafe' ? me.x : me.z, b.tend.min, b.tend.max);
      b.tend.next = 6;
      b.staff.reach();
      return { x: b.makeAt.x, y: street + b.makeAt.y, z: b.makeAt.z };
    },
    hearing: () => here,
    update(t, dt, people) {
      const you = people[0];
      lastYou = you ?? null;
      const onStreet = !!you && you.y < -SLAB - 1;
      const dark = darkness();
      here = null;
      for (const b of built) {
        const { v } = b;
        const cx = (v.box.minX + v.box.maxX) / 2;
        const cz = (v.box.minZ + v.box.maxZ) / 2;
        const far = onStreet ? Math.hypot(you.x - cx, you.z - cz) : Infinity;
        const near = far < NEAR;
        // Kenney's furniture is sent for the first time you're down on the street within sight of it
        // (the terrace's chairs show from the street), never from the roof or another map.
        if (far < FURNISH) furnishOnce(b);
        if (near !== b.near) {
          b.near = near;
          b.room.visible = near;
        }
        // Clear glass while you can see in; from further off it shows the sky, or the room lit up at night.
        b.glass.color.copy(near ? glassNear : glassFar).lerp(glassLit, near ? 0 : dark * 0.85);
        b.glass.opacity = near ? 0.22 : 0.9;
        const inside = onStreet && !!you && venueAt(you.x, you.z) === v;
        b.shell.visible = !inside;
        // Heard inside, fading away out the door and across the terrace.
        const out = onStreet ? Math.hypot(Math.max(v.box.minX - you.x, 0, you.x - v.box.maxX), Math.max(v.box.minZ - you.z, 0, you.z - v.box.maxZ)) : Infinity;
        const level = inside ? 1 : Math.max(0, 0.45 - out / 14);
        if (level > (here?.level ?? 0)) here = { id: v.id, level };
        // The door swings open for anyone stepping up to it, inside or out.
        const fzLine = frontZ(v);
        let want = 0;
        for (const p of people) if (p.y < -SLAB - 1 && Math.abs(p.x - v.door.x) < 1.6 && Math.abs(p.z - fzLine) < 1.8) want = 1;
        for (const d of b.doors) {
          if (d.open === want) continue;
          d.open = want > d.open ? Math.min(1, d.open + dt * 2.5) : Math.max(0, d.open - dt * 1.6);
          // Out toward the street, eased.
          const k = d.open * d.open * (3 - 2 * d.open);
          d.leaf.rotation.y = d.sign * v.fz * k * 1.45;
        }
        const close = out < CLOSE;
        b.staff.root.visible = close;
        if (!close) {
          for (const r of b.regulars) r.person.root.visible = false;
          if (b.fan) b.fan.rotation.y += dt * 3.2;
          continue;
        }
        // The one behind the counter drifts along it between customers, and comes over to whoever orders.
        b.tend.next -= dt;
        if (b.tend.next <= 0) {
          b.tend.next = 5 + Math.random() * 7;
          b.tend.to = b.tend.min + Math.random() * (b.tend.max - b.tend.min);
        }
        const sp = b.staff.root.position;
        const along = v.id === 'cafe' ? 'x' : 'z';
        const gap = b.tend.to - sp[along];
        const step = THREE.MathUtils.clamp(gap, -dt * 1.4, dt * 1.4);
        sp[along] += step;
        const walking = Math.abs(gap) > 0.05;
        // Facing the way they walk, then back round to the counter.
        const face = walking ? (v.id === 'cafe' ? (gap > 0 ? E : -E) : gap > 0 ? 0 : Math.PI) : v.id === 'cafe' ? 0 : -E;
        let turn = face - b.staff.root.rotation.y;
        turn = Math.atan2(Math.sin(turn), Math.cos(turn));
        b.staff.root.rotation.y += turn * Math.min(1, dt * 8);
        b.staff.update(dt, t, walking, false);
        // The regulars: the café's by day, the bar's of an evening.
        for (const r of b.regulars) {
          const there = r.when === 'always' || (r.when === 'day' ? dark < 0.6 : dark > 0.35);
          r.person.root.visible = there;
          if (!there) continue;
          r.person.update(dt, t, false, false);
          // A sip now and then.
          if (Math.random() < dt * 0.04) r.person.reach();
        }
        if (b.fan) b.fan.rotation.y += dt * 3.2;
      }
    },
  };
}
