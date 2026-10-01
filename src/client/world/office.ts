import * as THREE from 'three';
import { ASHTRAY, BALCONY, BALCONY_DOOR, BEANBAGS, BOARDS, BOOKSHELF, CABINET, DESKS, DESK_SIZE, ELEVATOR, EXIT_DOOR, EXIT_STAIRS, FLOOR, GONG, JUKEBOX, KIOSK, LADDER, LOFT, MACHINE_MONITOR, MEETING_BOARD, MEETING_ROOM, MEETING_SEATS, MEETING_TABLE, PLANTS, SEATING_BY_ID, SLAB, STAIRS, STATIONS, STATION_AGENT, STOREY, STREET_Y, TV, WALL_HEIGHT, WALL_T, WINDOWS, WING, WING_DESKS, deskSeat, plantByWing, streetBelow, wingMinZ, wingRowZ, type DeskDef, type Opening, type Side, type StationKind } from '../../shared/layout';
import { frameRect, overlaps, wallFacing, wallPose, wallTop, type WallId, type WallRect } from '../../shared/decor';
import { deskPoint } from '../../shared/nav';
import { FLOOR_PALETTES, type FloorPalette } from '../../shared/floors';
import { buildGarage, buildStreet, bulb, type NightParts } from './outside';
import { buildStreetLife, type StreetLife } from './streetlife';
import { buildCityGate } from './circuit';
import { buildArenaCityGate } from './arena';
import { Fleet } from './cars';
import { mergeByMaterial, mergeColored, mesh, roundedBox, textPlane, toon, toonUnique } from './toon';
import { ART_COUNT, blinds, blobShadows, onWallAt, setShadowFloors, userFrames, wallArt, type ArtItem, type Blob, type BlindItem } from './detail';
import { officeClock } from './sky';
import { palette, piece } from './models';
import { buildElevator, type Elevator } from './elevator';
import { buildGong, type Gong } from './gong';
import { buildJukebox, type JukeboxView } from './jukebox';
import { buildBookshelf } from './bookshelf';
import { buildCabinet, type CabinetModel } from './cabinet';
import { buildWhiteboard, type WhiteboardStand } from './whiteboard';
import { buildGreen, buildTee, type Green, type Tee } from './golf';
import { buildStack, type Stack } from './stack';
import { buildTower, wingWindows } from './tower';
import { buildHoop, type HoopView } from './hoop';
import { buildKitchen } from './kitchen';
import { buildDeskSigns, type DeskSigns } from './desksigns';
import { HOOP } from '../../shared/hoop';
import { buildVenues, type Venues } from './venues';
import { CARS } from '../../shared/garage';
import { vehicleSolids } from '../../shared/city';

export interface Collider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  top: number;
  /** Underside, for things you walk beneath (the loft). Defaults to the floor. */
  bottom?: number;
  /** Only there to keep people out: its top isn't anything to land on, so confetti falls through it. */
  fence?: boolean;
}

export type InteractKind = 'desk' | 'station' | 'issues' | 'pulls' | 'services' | 'queue' | 'tv' | 'coffee' | 'decor' | 'smoke' | 'elevator' | 'gong' | 'dog' | 'jukebox' | 'seat' | 'whiteboard' | 'cabinet' | 'ladder' | 'pole' | 'meeting' | 'bar' | 'dj' | 'golf' | 'ball' | 'bookshelf' | 'darts' | 'axe' | 'telescope' | 'car' | 'expand' | 'herald';

/** Something you can use. Its scene object carries it as `userData.interact`, for clicking. */
export interface Interactable {
  kind: InteractKind;
  x: number;
  z: number;
  /** The floor it's on, when that's not the office floor (the loft's). */
  y?: number;
  radius: number;
  deskId?: string;
  decorId?: string;
  seatId?: string;
  /** Which of POLES, for a fire pole. */
  pole?: number;
  /** Which of CARS (shared/garage.ts), for a car. */
  car?: number;
  /** Put away for now (a bean bag nobody needs yet): can't be used. */
  off?: boolean;
  /** What the hint calls it, where a map's own looks differ from the office's (the castle's ale for the coffee machine). */
  label?: string;
}

/** A desk, a bean bag, a board agent's kiosk or a chair at the meeting table: somewhere a worker sits (or stands). */
export interface DeskView {
  def: DeskDef;
  group: THREE.Group;
  /** The laptop goes in here: placed, turned and sized for this seat. */
  laptopAnchor: THREE.Object3D;
  /** The worker goes in here, the same way. */
  seatAnchor: THREE.Object3D;
  /** Where the worker gets up to dance when a pull request merges: its feet, and the way it faces. */
  stage: THREE.Object3D;
  chair: THREE.Group;
  /** Shown while nobody is there: the "+" over a free seat, or the board agent waiting to be asked. */
  vacancy: THREE.Group;
  /** How high the vacancy marker floats. */
  vacancyY: number;
}

export interface Office {
  group: THREE.Group;
  colliders: Collider[];
  interactables: Interactable[];
  /** Every seat by id: the desks, the bean bags and the board agents' kiosks. */
  desks: Map<string, DeskView>;
  /**
   * Brings out the bean bags in `out` and puts the rest away. Returns the colliders of the ones that
   * just came out, in case someone is standing there.
   */
  setBeanbags(out: Set<string>): Collider[];
  boardMeshes: Record<keyof typeof BOARDS, THREE.Mesh>;
  tvScreen: THREE.Mesh;
  /** The monitor on the boss's desk upstairs, where Minesweeper plays (ui/arcade.ts). */
  bossScreen: THREE.Mesh;
  /** The monitor on the west wall showing how busy the office's machine is (world/machine.ts). */
  machineScreen: THREE.Mesh;
  /** The meeting room's board, showing the meeting's output as it's written, and the sign by its door. */
  meetingBoard: THREE.Mesh;
  meetingSign: THREE.Mesh;
  /** What's already on the walls (boards, the TV, windows…), so pictures don't hang over it. */
  fixtures(): WallRect[];
  elevator: Elevator;
  /** The elevator's stop down in the garage, under the building. */
  garageLift: Elevator;
  /** The Lambos and Ferraris in the garage, which anyone can drive (see driving.ts). */
  cars: Fleet;
  /** The traffic and the people out on the street. */
  life: StreetLife;
  /** W6: the café and the bar out in the city (world/venues.ts). */
  venues: Venues;
  /** The merge gong by the PR board. */
  gong: Gong;
  jukebox: JukeboxView;
  /** The arcade cabinet in the lounge, where BLOCKFALL plays (ui/cabinet.ts). */
  cabinet: CabinetModel;
  /** The rolling whiteboard everyone draws on together. */
  whiteboard: WhiteboardStand;
  /** The golf tee on the balcony, and the hole across the street it's hit at. */
  tee: Tee;
  green: Green;
  /** The basketball hoop on the west wall (the ball is main.ts's: see world/hoop.ts). */
  hoop: HoopView;
  /** The ceiling, the floor, and the ladder and fire poles between the floors of the building. */
  stack: Stack;
  /** The back office through the north wall, as far as this floor's built out (see WING). */
  wing: WingView;
  /** Builds the back office out `level` rows, or walls it up: the plants in the way go too. */
  setWing(level: number): void;
  /** The signs hung over the desks (see shared/floorplan.ts). */
  signs: DeskSigns;
  /** The sign over the elevator doors: which floor you're on. */
  setProjectName(name: string): void;
  /** Paints the walls, their trim and the floor in a floor's colors, so each project looks like itself. */
  setLook(p: FloorPalette): void;
  /**
   * You're on floor `index` of a building `count` floors tall (0 is the bottom one): the rest of the
   * building goes up over you and down under you, the street that many storeys down, and only the
   * bottom floor has its exit door. `wings` is how far each floor's back office is built out, for
   * the building's outside.
   */
  setLevel(index: number, count: number, wings?: readonly number[]): void;
  /** Lights, windows and glass for the sky to change with the time of day and the weather. */
  night: NightParts;
  /** The potted plants round the room, in PLANTS' order. At Christmas world/holiday.ts hides their leaves (plantLeaves()) and stands a little tree in each pot. */
  plants: THREE.Group[];
  /** Animates the office; doors open for anyone in `people` who comes up to them. */
  update(t: number, dt: number, people: Iterable<{ x: number; y: number; z: number }>): void;
}

/** A door that opens by itself when someone comes up to it, and closes behind them. */
interface Door {
  x: number;
  y: number;
  z: number;
  /** 0 shut, 1 wide open. */
  open: number;
  show(open: number): void;
  /** Stays shut: the exit door, seen from a floor above it. */
  locked?: boolean;
}

const PALETTE = {
  floor: FLOOR_PALETTES[0].floor,
  floorAlt: FLOOR_PALETTES[0].floorAlt,
  wall: FLOOR_PALETTES[0].wall,
  wallTrim: FLOOR_PALETTES[0].trim,
  desk: '#f7f3ea',
  deskLeg: '#3d405b',
  wood: '#c98b5a',
  cork: '#d8a86a',
  chairs: ['#ff8a5b', '#5bc0eb', '#9bc53d', '#b388eb', '#ffb400', '#f7aef8'],
  rugs: ['#bde0fe', '#ffd6a5', '#caffbf', '#ffc6ff'],
  plant: '#5fb760',
  plantDark: '#3f8f45',
  pot: '#e76f51',
  ink: '#2b2d42',
  /** The building's outside paint. */
  exterior: '#e07a5f',
};

/** Window glass: faintly blue and see-through. */
const GLASS = new THREE.MeshBasicMaterial({ color: '#d6f1ff', transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide });
const SHINE = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });

/** A sheet of glass `w` by `h`, centered, with a couple of cartoon glints so it reads as glass. */
function glassPane(w: number, h: number): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.PlaneGeometry(w, h), GLASS, 0, 0, 0, false));
  for (const [gx, gw] of [
    [-w * 0.2, 0.18],
    [-w * 0.2 + 0.32, 0.08],
  ]) {
    const glint = mesh(new THREE.PlaneGeometry(gw, h * 0.55), SHINE, gx, h * 0.07, 0.01, false);
    glint.rotation.z = -0.5;
    g.add(glint);
  }
  return g;
}

/** The middle of an outside wall at `u` along it, and the turn that makes local +z point outdoors. */
function onWall(side: Side, u: number): { x: number; z: number; rotY: number } {
  switch (side) {
    case 'north':
      return { x: u, z: FLOOR.minZ - WALL_T / 2, rotY: Math.PI };
    case 'south':
      return { x: u, z: FLOOR.maxZ + WALL_T / 2, rotY: 0 };
    case 'west':
      return { x: FLOOR.minX - WALL_T / 2, z: u, rotY: -Math.PI / 2 };
    case 'east':
      return { x: FLOOR.maxX + WALL_T / 2, z: u, rotY: Math.PI / 2 };
  }
}

/** Chunky planks in a floor's colors. */
function paintPlanks(c: HTMLCanvasElement, p: FloorPalette) {
  const g = c.getContext('2d')!;
  g.fillStyle = p.floor;
  g.fillRect(0, 0, 512, 512);
  for (let row = 0; row < 8; row++) {
    const offset = (row % 2) * 128;
    for (let col = -1; col < 3; col++) {
      const x = col * 256 + offset;
      g.fillStyle = (row + col) % 3 === 0 ? p.floorAlt : p.floor;
      g.fillRect(x + 2, row * 64 + 2, 252, 60);
    }
    g.fillStyle = p.seam;
    g.fillRect(0, row * 64, 512, 3);
  }
  // Wood grain and a little tone difference from plank to plank, from a fixed sequence so every
  // floor's boards look the same each time. Painted once into the texture, so it costs nothing to draw.
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let row = 0; row < 8; row++) {
    for (let col = -1; col < 3; col++) {
      const x = col * 256 + (row % 2) * 128;
      g.fillStyle = rnd() < 0.5 ? `rgba(255, 244, 220, ${0.05 + rnd() * 0.07})` : `rgba(70, 40, 20, ${0.03 + rnd() * 0.06})`;
      g.fillRect(x + 2, row * 64 + 2, 252, 60);
      g.strokeStyle = 'rgba(90, 55, 25, 0.13)';
      g.lineWidth = 1;
      for (let i = 0; i < 4; i++) {
        const y = row * 64 + 8 + rnd() * 48;
        g.beginPath();
        g.moveTo(x + 4, y);
        g.bezierCurveTo(x + 80, y + (rnd() - 0.5) * 6, x + 170, y + (rnd() - 0.5) * 6, x + 250, y + (rnd() - 0.5) * 3);
        g.stroke();
      }
    }
    // A lit edge under each seam, so the boards read as boards.
    g.fillStyle = 'rgba(255, 255, 255, 0.12)';
    g.fillRect(0, row * 64 + 3, 512, 1);
  }
}

/** How many meters of wall the paint texture covers before it repeats. */
const WALL_TEX_W = 4;

/**
 * Wall paint, in white so the floor's own wall color shows through it: soft mottling, panelling up
 * to a chair rail, shadow where the wall meets the floor and the ceiling, and a crown band up top.
 * One texture goes right up the wall (0 to WALL_HEIGHT) and repeats along it every WALL_TEX_W meters.
 */
function wallTexture(): THREE.CanvasTexture {
  const W = 512;
  const H = 1024;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const py = (y: number) => H * (1 - y / WALL_HEIGHT);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, W, H);
  let seed = 3;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  // Mottling: broad, faint blotches of lighter and darker paint, wrapped so the repeat has no seam.
  for (let i = 0; i < 90; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const r = 40 + rnd() * 90;
    const dark = rnd() < 0.55;
    for (const dx of [-W, 0, W]) {
      const grad = g.createRadialGradient(x + dx, y, 0, x + dx, y, r);
      grad.addColorStop(0, dark ? 'rgba(120, 90, 70, 0.045)' : 'rgba(255, 255, 255, 0.35)');
      grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      g.fillStyle = grad;
      g.fillRect(x + dx - r, y - r, r * 2, r * 2);
    }
  }
  // Panelling below the chair rail: a shade darker, with a groove every meter.
  const rail = 1.15;
  g.fillStyle = 'rgba(150, 110, 80, 0.13)';
  g.fillRect(0, py(rail), W, H - py(rail));
  g.fillStyle = 'rgba(90, 60, 40, 0.16)';
  for (let x = 0; x < W; x += W / WALL_TEX_W) g.fillRect(x, py(rail - 0.08), 3, py(0.3) - py(rail - 0.08));
  // The rail itself: a lit top, a shadow under it.
  g.fillStyle = 'rgba(255, 255, 255, 0.85)';
  g.fillRect(0, py(rail + 0.03), W, py(rail) - py(rail + 0.03));
  g.fillStyle = 'rgba(80, 50, 30, 0.3)';
  g.fillRect(0, py(rail), W, 7);
  // Shadow where the wall meets the floor, and where it meets the ceiling.
  let grad = g.createLinearGradient(0, py(0.9), 0, py(0.25));
  grad.addColorStop(0, 'rgba(40, 25, 15, 0)');
  grad.addColorStop(1, 'rgba(40, 25, 15, 0.22)');
  g.fillStyle = grad;
  g.fillRect(0, py(0.9), W, py(0.25) - py(0.9));
  grad = g.createLinearGradient(0, py(WALL_HEIGHT - 1.1), 0, py(WALL_HEIGHT));
  grad.addColorStop(0, 'rgba(40, 25, 15, 0)');
  grad.addColorStop(1, 'rgba(40, 25, 15, 0.24)');
  g.fillStyle = grad;
  g.fillRect(0, py(WALL_HEIGHT - 1.1), W, py(WALL_HEIGHT) - py(WALL_HEIGHT - 1.1));
  // A crown band, lit on top and shaded under.
  g.fillStyle = 'rgba(255, 255, 255, 0.7)';
  g.fillRect(0, py(WALL_HEIGHT), W, py(WALL_HEIGHT - 0.22) - py(WALL_HEIGHT));
  g.fillStyle = 'rgba(70, 45, 30, 0.35)';
  g.fillRect(0, py(WALL_HEIGHT - 0.22), W, 6);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Puts a wall piece's texture in the wall's own meters (around (cx, cy, cz) in the world), whatever its size, so the paint doesn't stretch. */
function wallUv(geo: THREE.BufferGeometry, cx: number, cy: number, cz: number): THREE.BufferGeometry {
  const p = geo.attributes.position;
  const n = geo.attributes.normal;
  const uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const along = Math.abs(n.getX(i)) > 0.5 ? p.getZ(i) + cz : p.getX(i) + cx;
    uv.setXY(i, along / WALL_TEX_W, (p.getY(i) + cy) / WALL_HEIGHT);
  }
  return geo;
}

function floorTexture(width = FLOOR.maxX - FLOOR.minX, depth = FLOOR.maxZ - FLOOR.minZ): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  paintPlanks(c, FLOOR_PALETTES[0]);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(width / 6, depth / 6);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function box(w: number, h: number, d: number) {
  return new THREE.BoxGeometry(w, h, d);
}

// The potted plants are modelled in Blender (blender/scripts/build_plants.py): each plant is a painted
// copy of one species in plants.glb (see piece()). A species is its pot, named after it, with everything that
// grows out of the pot hung under it as `<species>_leaves` (see plantLeaves()). The colors are the old
// code-built plants' pot and greens, the Christmas tree's trunk brown for the soil, the street trees'
// trunk brown for the ficus's, and the kitchen cupboards' blue for the snake plant's glazed pot.
export type PlantSpecies = 'monstera' | 'snake_plant' | 'ficus' | 'succulent';
/** The species that stand on the floor, which a row of plants takes turns with (see floorPlant()). */
export const FLOOR_PLANTS = ['monstera', 'snake_plant', 'ficus'] as const satisfies readonly PlantSpecies[];
const PLANT_COLORS = { Pot: PALETTE.pot, Glaze: '#8ecae6', Soil: '#6b4226', Bark: '#8a5a3b', Leaf: PALETTE.plant, LeafDark: PALETTE.plantDark };
const paintPlant = palette(PLANT_COLORS);

/**
 * A potted plant of `species`, `scale` times its modelled size, its origin on the floor in the middle of
 * its pot. At scale 1 a floor species' pot is the old one's size (0.28 round at the top, 0.5 tall, its
 * soil at 0.45), so colliders of 0.3 * scale still fit it; the succulent is desk-sized as it is. If the
 * model didn't load, an empty group: the office opens without it.
 */
export function plant(species: PlantSpecies, scale = 1): THREE.Group {
  const g = new THREE.Group();
  g.add(piece('plants', species, paintPlant));
  g.scale.setScalar(scale);
  return g;
}

/** The floor species for the `i`th of a row of plants: they take turns, so no two neighbours match. */
function floorPlant(i: number): PlantSpecies {
  return FLOOR_PLANTS[i % FLOOR_PLANTS.length];
}

/**
 * A plant's leaves, and whatever else grows out of its pot (stalks, a trunk): everything but the pot and
 * its soil. Christmas hides them and stands a little tree in the pot instead (world/holiday.ts). None if
 * the model didn't load.
 */
export function plantLeaves(potted: THREE.Object3D): THREE.Object3D[] {
  const leaves: THREE.Object3D[] = [];
  potted.traverse((o) => {
    if (o.name.endsWith('_leaves')) leaves.push(o);
  });
  return leaves;
}

// The desks' knick-knacks are modelled in Blender (blender/scripts/build_desk_props.py): a mug of coffee,
// and books in a few arrangements, each a piece of desk_props.glb (see piece()). The colors are the old
// code-built books' covers, book.ts's page edges and the coffee in a worker's mug (coffeeMug() in
// character.ts); the mug itself is painted whatever color it's given.
const DESK_PROP_COLORS = { CoverRed: '#e63946', CoverBlue: '#457b9d', CoverOrange: '#f4a261', Pages: '#f3ead8', Coffee: '#6f4518' };
const paintDeskProp = palette(DESK_PROP_COLORS);
/** The arrangements of books, which the desks with books take turns with (see deskBooks()). */
export const DESK_BOOKS = ['books_upright', 'books_leaning', 'books_stack'] as const;

/**
 * A mug of coffee, its body `color`, its origin on the desk under the middle of its body and its handle out
 * to +x. The body is the old code-built mug's size (0.06 round at the top, 0.12 tall). If the model didn't
 * load, an empty group.
 */
export function deskMug(color: string): THREE.Object3D {
  const body = toon(color);
  return piece('desk_props', 'mug', (name) => (name === 'Mug' ? body : paintDeskProp(name)));
}

/**
 * The `i`th arrangement of books (they take turns, see DESK_BOOKS), spines to +z, its origin on the desk in
 * the middle of its footprint, which is at most the old code-built books' 0.26 by 0.18, and 0.24 tall. If
 * the model didn't load, an empty group.
 */
export function deskBooks(i: number): THREE.Object3D {
  return piece('desk_props', DESK_BOOKS[i % DESK_BOOKS.length], paintDeskProp);
}

// The lounge's furniture is modelled in Blender (blender/scripts/build_lounge.py): the sofa, a throw pillow, a
// floor pouf and the coffee table, each a piece of lounge.glb placed on its own (see piece()), so they can be
// moved round one by one. Sofa is the old couch's blue, Wood and Frame the old coffee table's top and pedestal,
// and WoodDark the sofa's feet (the desk furniture's darker wood). A pillow's or a pouf's Cloth is each copy's
// own color, so it has none here: a copy that forgets its color comes out magenta.
const LOUNGE_COLORS = { Sofa: '#5b8def', WoodDark: '#8a5a3b', Wood: PALETTE.wood, Frame: PALETTE.deskLeg };
const paintLounge = palette(LOUNGE_COLORS);

/** A pillow or a pouf, its Cloth in `color`. */
function upholstered(part: 'pillow' | 'pouf', color: string): THREE.Object3D {
  const cloth = toon(color);
  return piece('lounge', part, (name) => (name === 'Cloth' ? cloth : paintLounge(name)));
}

/**
 * The lounge's couch: the sofa, facing +z like every model, with a throw pillow leaning on its back cushions
 * either side of its middle, halfway between its places (SEATING's couch, 1.2 apart), clear of whoever sits
 * there. Its origin is on the floor under its middle, it's 4.2 long across x and 1.0 deep, and its seat
 * cushions' tops are 0.47 up. The pillows hang under it, so a click on one is a click on the couch.
 */
export function loungeCouch(): THREE.Group {
  const g = new THREE.Group();
  g.add(piece('lounge', 'sofa', paintLounge));
  for (const [x, color] of [
    [0.6, '#ffd166'],
    [-0.6, '#ef476f'],
  ] as const) {
    const pillow = upholstered('pillow', color);
    // Standing on the seat, sunk in a little, its top tipped back onto the back cushions.
    pillow.position.set(x, 0.46, -0.08);
    pillow.rotation.x = -0.15;
    g.add(pillow);
  }
  return g;
}

/** A floor pouf in `color`, about 1.05 round and 0.4 tall, its origin on the floor under its middle. */
export function pouf(color: string): THREE.Object3D {
  return upholstered('pouf', color);
}

/** The lounge's round coffee table, 0.9 round, its top 0.46 up (where the holiday pumpkin stands). */
export function coffeeTable(): THREE.Object3D {
  return piece('lounge', 'coffee_table', paintLounge);
}

/** A pendant lamp, its shade at 0, on a cord `cord` meters long. */
function pendant(cord = 0.48): THREE.Group {
  const lamp = new THREE.Group();
  const c = cord / 0.8;
  lamp.add(mesh(new THREE.CylinderGeometry(0.01, 0.01, c, 4), toon(PALETTE.ink), 0, c / 2, 0, false));
  lamp.add(mesh(new THREE.ConeGeometry(0.5, 0.45, 16, 1, true), toon('#ffd166'), 0, 0, 0, false));
  lamp.add(mesh(new THREE.SphereGeometry(0.16, 10, 8), toon('#fff7d6', { emissive: '#ffe08a' }), 0, -0.15, 0, false));
  lamp.scale.setScalar(0.8);
  return lamp;
}

/** A window filling its hole in an outside wall: a frame lining the hole, a mullion, sills and real glass. */
function windowIn(o: Opening): THREE.Group {
  const g = new THREE.Group();
  const frame = toon('#ffffff');
  const w = o.width;
  const h = o.y1 - o.y0;
  const F = 0.09;
  const D = WALL_T + 0.04;
  // Built along x with the outside toward +z, then turned onto its wall.
  g.add(mesh(box(w, F, D), frame, 0, o.y1 - F / 2, 0, false));
  g.add(mesh(box(w, F, D), frame, 0, o.y0 + F / 2, 0, false));
  for (const sx of [-1, 1]) g.add(mesh(box(F, h, D), frame, sx * (w / 2 - F / 2), (o.y0 + o.y1) / 2, 0, false));
  g.add(mesh(box(F * 0.8, h - 2 * F, 0.08), frame, 0, (o.y0 + o.y1) / 2, 0, false));
  const pane = glassPane(w - 2 * F, h - 2 * F);
  pane.position.y = (o.y0 + o.y1) / 2;
  g.add(pane);
  g.add(mesh(box(w + 0.2, 0.06, 0.2), frame, 0, o.y0 - 0.03, -(WALL_T / 2 + 0.08)));
  g.add(mesh(box(w + 0.2, 0.06, 0.16), frame, 0, o.y0 - 0.03, WALL_T / 2 + 0.06));
  const at = onWall(o.wall, o.u);
  g.position.set(at.x, 0, at.z);
  g.rotation.y = at.rotY;
  return g;
}

/** Rain on the outside of a window's glass (see sky.ts), kept out of the merged glazing so it keeps its UVs. */
function wetPane(o: Opening, mat: THREE.Material): THREE.Group {
  const F = 0.09;
  const w = o.width - 2 * F;
  const h = o.y1 - o.y0 - 2 * F;
  const geo = new THREE.PlaneGeometry(w, h);
  // The drops are the same size on every window, whatever its size.
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / 0.9, (uv.getY(i) * h) / 0.9 + o.u * 0.37);
  const pane = new THREE.Mesh(geo, mat);
  pane.position.set(0, (o.y0 + o.y1) / 2, 0.05);
  const g = new THREE.Group();
  g.add(pane);
  const at = onWall(o.wall, o.u);
  g.position.set(at.x, 0, at.z);
  g.rotation.y = at.rotY;
  return g;
}

/** A door's frame and threshold, lining its hole in the wall (built like windowIn: along x, outdoors toward +z). */
function doorFrame(o: Opening): THREE.Group {
  const g = new THREE.Group();
  const frame = toon('#ffffff');
  const F = 0.08;
  const D = WALL_T + 0.04;
  g.add(mesh(box(o.width, F, D), frame, 0, o.y1 - F / 2, 0, false));
  for (const sx of [-1, 1]) g.add(mesh(box(F, o.y1, D), frame, sx * (o.width / 2 - F / 2), o.y1 / 2, 0, false));
  g.add(mesh(box(o.width, 0.03, D), toon('#8d99ae'), 0, 0.015, 0, false));
  return g;
}

/** Stands a wall-built group (along x, outdoors toward +z) in its wall. */
function mount(g: THREE.Group, o: Opening): THREE.Group {
  const at = onWall(o.wall, o.u);
  g.position.set(at.x, 0, at.z);
  g.rotation.y = at.rotY;
  return g;
}

/** The way out: a teal door with a porthole in the west wall. It swings outward, onto the landing. */
function exitDoor(night: NightParts): { group: THREE.Group; door: Door } {
  const o = EXIT_DOOR;
  const g = doorFrame(o);
  const F = 0.08;
  const leafW = o.width - 2 * F - 0.02;
  const leafH = o.y1 - F - 0.02;
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(leafW, 0);
  shape.lineTo(leafW, leafH);
  shape.lineTo(0, leafH);
  shape.closePath();
  const port = { x: leafW / 2, y: leafH - 0.55, r: 0.2 };
  const hole = new THREE.Path();
  hole.absarc(port.x, port.y, port.r, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const leafGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: false, curveSegments: 16 });
  leafGeo.translate(0, 0, -0.03);
  const leaf = new THREE.Group();
  leaf.add(mesh(leafGeo, toon('#2a9d8f'), 0, 0.01, 0));
  leaf.add(mesh(new THREE.CircleGeometry(port.r, 20), GLASS, port.x, port.y + 0.01, 0, false));
  leaf.add(mesh(new THREE.TorusGeometry(port.r, 0.035, 8, 24), toon('#ffffff'), port.x, port.y + 0.01, 0, false));
  // A push bar inside, a pull handle outside.
  leaf.add(mesh(box(leafW * 0.7, 0.05, 0.05), toon('#adb5bd'), leafW * 0.5, 1.0, -0.07));
  leaf.add(mesh(box(0.05, 0.3, 0.05), toon('#adb5bd'), leafW - 0.15, 1.0, 0.07));
  // Hinged on the outer face, so it opens out of the building.
  const hinge = new THREE.Group();
  hinge.position.set(-o.width / 2 + F + 0.01, 0, WALL_T / 2 - 0.05);
  hinge.add(leaf);
  g.add(hinge);

  const exit = textPlane('EXIT', { bg: '#2a9d4b', color: '#ffffff', size: 64, border: '#ffffff' });
  exit.scale.multiplyScalar(0.7);
  exit.position.set(0, o.y1 + 0.35, -(WALL_T / 2 + 0.03));
  exit.rotation.y = Math.PI;
  g.add(exit);
  // A lamp over it outside.
  g.add(mesh(box(0.32, 0.1, 0.18), toon(PALETTE.ink), 0, o.y1 + 0.42, WALL_T / 2 + 0.09));
  g.add(mesh(new THREE.SphereGeometry(0.08, 10, 8), toon('#fff7d6', { emissive: '#ffe08a' }), 0, o.y1 + 0.33, WALL_T / 2 + 0.12, false));

  const at = onWall(o.wall, o.u);
  // Over the landing, where it lights the way down at night.
  const lampAt = new THREE.Vector3(at.x - WALL_T / 2 - 0.14, o.y1 + 0.33, at.z);
  night.halos.push({ at: lampAt, size: 0.9, color: '#ffe08a', ground: true });
  night.lamps.push({ x: lampAt.x - 0.6, y: lampAt.y, z: lampAt.z, reach: 5, color: '#ffe3a3', power: 2.2, ground: true });
  const door: Door = {
    x: at.x,
    y: 0,
    z: at.z,
    open: 0,
    show: (k) => (hinge.rotation.y = -1.8 * k * k * (3 - 2 * k)),
  };
  return { group: mount(g, o), door };
}

/** Glass doors out to the balcony that slide apart, into the wall on either side, when someone comes up. */
function balconyDoor(): { group: THREE.Group; door: Door } {
  const o = BALCONY_DOOR;
  const g = doorFrame(o);
  const F = 0.08;
  const half = (o.width - 2 * F) / 2;
  const h = o.y1 - F;
  const alu = toon('#aab4be');
  const panels: [THREE.Group, number][] = [];
  for (const side of [-1, 1]) {
    const p = new THREE.Group();
    const pw = half + 0.02;
    for (const y of [0.04, h - 0.04]) p.add(mesh(box(pw, 0.08, 0.05), alu, 0, y, 0, false));
    for (const x of [-pw / 2 + 0.035, pw / 2 - 0.035]) p.add(mesh(box(0.07, h, 0.05), alu, x, h / 2, 0, false));
    const pane = glassPane(pw - 0.14, h - 0.16);
    pane.position.y = h / 2;
    p.add(pane);
    p.add(mesh(box(0.03, 0.45, 0.08), toon(PALETTE.ink), -side * (pw / 2 - 0.12), 1.05, 0, false));
    const x0 = (side * half) / 2;
    p.position.x = x0;
    g.add(p);
    panels.push([p, x0]);
  }
  const at = onWall(o.wall, o.u);
  const door: Door = {
    x: at.x,
    y: 0,
    z: at.z,
    open: 0,
    show: (k) => {
      const e = k * k * (3 - 2 * k);
      for (const [p, x0] of panels) p.position.x = x0 + Math.sign(x0) * e * (half + 0.04);
    },
  };
  return { group: mount(g, o), door };
}

/** A sagging string of party bulbs from `a` to `b`, in `bulbs` (one per color); they light up at night. */
function stringLights(a: THREE.Vector3, b: THREE.Vector3, sag: number, bulbs: [string, THREE.Material][], night: NightParts): THREE.Group {
  const mid = a.clone().add(b).multiplyScalar(0.5);
  mid.y -= sag * 2;
  const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
  const g = new THREE.Group();
  g.add(mesh(new THREE.TubeGeometry(curve, 24, 0.012, 4), toon(PALETTE.ink), 0, 0, 0, false));
  const n = Math.max(2, Math.round(curve.getLength() / 0.5));
  for (let i = 1; i < n; i++) {
    const p = curve.getPoint(i / n);
    const [color, mat] = bulbs[i % bulbs.length];
    g.add(mesh(new THREE.SphereGeometry(0.055, 8, 6), mat, p.x, p.y - 0.06, p.z, false));
    night.halos.push({ at: new THREE.Vector3(p.x, p.y - 0.06, p.z), size: 0.55, color });
  }
  return mergeByMaterial(g);
}

/**
 * The smoking balcony off the south wall, over the garage entrance: a deck with a glass railing on
 * its three open sides, string lights, a bench under the window, a bistro table, plants and the
 * ashtray, where you take a smoke break.
 */
function buildBalcony(group: THREE.Group, colliders: Collider[], interactables: Interactable[], night: NightParts) {
  const { minX, maxX, minZ, maxZ } = BALCONY;
  const w = maxX - minX;
  const d = maxZ - minZ;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  // Everything that doesn't move and isn't textured goes in here, merged at the end.
  const parts = new THREE.Group();
  parts.add(mesh(box(w, SLAB - 0.01, d), toon(PALETTE.wallTrim), cx, -SLAB / 2 - 0.005, cz));
  const deck = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshToonMaterial({ map: floorTexture(w, d), color: '#d6a574', gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap }));
  deck.rotation.x = -Math.PI / 2;
  deck.position.set(cx, 0.002, cz);
  deck.receiveShadow = true;
  group.add(deck);
  colliders.push({ minX, maxX, minZ, maxZ, bottom: -SLAB, top: 0 });

  // The railing: posts, a wooden top rail and glass between, on the three open sides.
  const railH = 1.05;
  const ink = toon(PALETTE.deskLeg);
  const wood = toon(PALETTE.wood);
  const inset = 0.06;
  const sides: [number, number, number, number][] = [
    [minX + inset, maxZ - inset, maxX - inset, maxZ - inset],
    [minX + inset, minZ, minX + inset, maxZ - inset],
    [maxX - inset, minZ, maxX - inset, maxZ - inset],
  ];
  for (const [x0, z0, x1, z1] of sides) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const alongX = z0 === z1;
    const n = Math.ceil(len / 1.6);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      parts.add(mesh(box(0.06, railH, 0.06), ink, x0 + (x1 - x0) * t, railH / 2, z0 + (z1 - z0) * t, false));
    }
    const rail = mesh(alongX ? box(len + 0.1, 0.07, 0.12) : box(0.12, 0.07, len + 0.1), wood, (x0 + x1) / 2, railH + 0.02, (z0 + z1) / 2);
    parts.add(rail);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const pane = glassPane(len / n - 0.1, railH - 0.2);
      pane.position.set(x0 + (x1 - x0) * t, (railH - 0.2) / 2 + 0.08, z0 + (z1 - z0) * t);
      pane.rotation.y = alongX ? 0 : Math.PI / 2;
      parts.add(pane);
    }
    colliders.push({ minX: Math.min(x0, x1) - 0.05, maxX: Math.max(x0, x1) + 0.05, minZ: Math.min(z0, z1) - 0.05, maxZ: Math.max(z0, z1) + 0.05, bottom: -SLAB, top: 99 });
  }

  // Lamp poles on the outer corners, with string lights to them from the wall and between them.
  const poleH = 2.7;
  const sw = new THREE.Vector3(minX + inset, poleH, maxZ - inset);
  const se = new THREE.Vector3(maxX - inset, poleH, maxZ - inset);
  for (const p of [sw, se]) parts.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, poleH - railH, 6), ink, p.x, (poleH + railH) / 2, p.z, false));
  const bulbs = ['#ffd166', '#ff8fa3', '#8ecae6', '#caffbf'].map((c): [string, THREE.Material] => [c, bulb(night, c, 0.4)]);
  parts.add(stringLights(sw, se, 0.35, bulbs, night));
  parts.add(stringLights(sw, new THREE.Vector3(-6.5, 3.5, minZ + 0.02), 0.3, bulbs, night));
  parts.add(stringLights(new THREE.Vector3(-6.5, 3.5, minZ + 0.02), se, 0.35, bulbs, night));
  // At night they light the deck, the table and whoever's out there.
  for (const x of [cx - 3.2, cx + 3.2]) night.lamps.push({ x, y: 2.4, z: cz, reach: 5.5, color: '#ffc9a6', power: 2.4 });

  // A bench under the window, a bistro table with two stools, and plants.
  const bench = new THREE.Group();
  bench.add(mesh(roundedBox(2, 0.08, 0.46, 0.05), wood, 0, 0.45, 0));
  bench.add(mesh(box(2, 0.32, 0.06), wood, 0, 0.78, -0.2));
  for (const sx of [-0.85, 0.85]) bench.add(mesh(box(0.06, 0.45, 0.4), ink, sx, 0.22, 0));
  bench.position.set(-9, 0, minZ + 0.3);
  // Somewhere to sit, so not merged with the rest: its own meshes carry what E is about when you look at it.
  group.add(bench);
  colliders.push({ minX: -10, maxX: -8, minZ, maxZ: minZ + 0.55, top: 0.49 });
  seatable(bench, 'bench', 1.6, interactables);
  const tx = 0.2;
  const tz = cz + 0.2;
  const table = new THREE.Group();
  table.add(mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.05, 20), toon('#fffaf3'), 0, 0.74, 0));
  table.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.7, 8), ink, 0, 0.37, 0));
  table.add(mesh(new THREE.CylinderGeometry(0.25, 0.28, 0.04, 16), ink, 0, 0.02, 0));
  table.add(mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.12, 10), toon('#ef476f'), 0.15, 0.82, 0.05));
  table.position.set(tx, 0, tz);
  parts.add(table);
  colliders.push({ minX: tx - 0.4, maxX: tx + 0.4, minZ: tz - 0.4, maxZ: tz + 0.4, top: 0.77 });
  for (const sx of [-1, 1]) {
    const x = tx + sx * 0.8;
    const stool = new THREE.Group();
    stool.add(mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 16), toon(sx < 0 ? '#5bc0eb' : '#ff8a5b'), 0, 0.46, 0));
    stool.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.44, 6), ink, 0, 0.22, 0));
    stool.add(mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.03, 12), ink, 0, 0.015, 0));
    stool.position.set(x, 0, tz);
    group.add(stool);
    colliders.push({ minX: x - 0.2, maxX: x + 0.2, minZ: tz - 0.2, maxZ: tz + 0.2, top: 0.49 });
    seatable(stool, sx < 0 ? 'stool-1' : 'stool-2', 0.9, interactables);
  }
  for (const [i, [px, pz, sc]] of [
    [maxX - 0.55, minZ + 0.5, 1.1],
    [minX + 0.55, maxZ - 0.55, 0.9],
  ].entries()) {
    // Starting past the monstera, which spreads too wide for a spot this near the rail.
    const p = plant(floorPlant(i + 1), sc);
    p.position.set(px, 0, pz);
    parts.add(p);
    const r = 0.3 * sc;
    colliders.push({ minX: px - r, maxX: px + r, minZ: pz - r, maxZ: pz + r, top: 0.5 * sc });
  }

  group.add(mergeByMaterial(parts));

  // The ashtray: a standing bin with a sand-filled bowl and a couple of butts in it.
  const tray = new THREE.Group();
  const steel = toon('#8d99ae');
  tray.add(mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.05, 16), steel, 0, 0.025, 0));
  tray.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.8, 10), steel, 0, 0.45, 0));
  tray.add(mesh(new THREE.CylinderGeometry(0.2, 0.14, 0.14, 16), steel, 0, 0.9, 0));
  tray.add(mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.02, 16), toon('#e9d8a6'), 0, 0.965, 0, false));
  for (const [bx, bz, a] of [
    [0.06, 0.02, 0.4],
    [-0.05, -0.06, 2.1],
    [-0.02, 0.08, 1.2],
  ]) {
    const butt = mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.07, 6).rotateZ(Math.PI / 2), toon(a > 1 ? '#fffaf3' : '#e9a03b'), bx, 0.98, bz, false);
    butt.rotation.y = a;
    tray.add(butt);
  }
  tray.position.set(ASHTRAY.x, 0, ASHTRAY.z);
  group.add(tray);
  colliders.push({ minX: ASHTRAY.x - 0.2, maxX: ASHTRAY.x + 0.2, minZ: ASHTRAY.z - 0.2, maxZ: ASHTRAY.z + 0.2, top: 1 });
  const it: Interactable = { kind: 'smoke', x: ASHTRAY.x, z: ASHTRAY.z, radius: 1.8 };
  interactables.push(it);
  tray.userData.interact = it;

  const sign = textPlane('🚬 Smoke break', { bg: '#2b2d42', color: '#fffaf3', size: 56, border: '#fffaf3' });
  sign.scale.multiplyScalar(0.8);
  sign.position.set(-6.5, 2.2, minZ + 0.02);
  group.add(sign);
}

/** The bottom floor's balcony stands on posts down to the street, at its outer corners (the ones above it hang off their walls). */
function buildBalconyPosts(group: THREE.Group, colliders: Collider[]) {
  const { minX, maxX, maxZ } = BALCONY;
  const postH = -SLAB - STREET_Y;
  for (const x of [minX + 0.25, maxX - 0.25]) {
    group.add(mesh(new THREE.CylinderGeometry(0.12, 0.12, postH, 12), toon('#e6e8ee'), x, STREET_Y + postH / 2, maxZ - 0.25));
    colliders.push({ minX: x - 0.14, maxX: x + 0.14, minZ: maxZ - 0.39, maxZ: maxZ - 0.11, bottom: STREET_Y, top: -SLAB });
  }
}

/**
 * Outside the exit: a concrete landing level with the office floor, and steps running south
 * along the west wall down to the street, with a railing on the open side.
 */
function buildExitStairs(group: THREE.Group, colliders: Collider[]) {
  const { minX, maxX, landingZ0, landingZ1, steps, run } = EXIT_STAIRS;
  const width = maxX - minX;
  const rise = -STREET_Y / steps;
  const treads = steps - 1;
  const L = landingZ1 - landingZ0;
  // Side profile: x runs south from the landing's north end, y is height.
  const profile = new THREE.Shape();
  profile.moveTo(0, STREET_Y);
  profile.lineTo(0, 0);
  profile.lineTo(L, 0);
  for (let i = 1; i <= treads; i++) {
    profile.lineTo(L + (i - 1) * run, -i * rise);
    profile.lineTo(L + i * run, -i * rise);
  }
  profile.lineTo(L + treads * run, STREET_Y);
  profile.closePath();
  const block = mesh(new THREE.ExtrudeGeometry(profile, { depth: width, bevelEnabled: false }), toon('#d3d6dd'), maxX, 0, landingZ0);
  block.rotation.y = -Math.PI / 2;
  group.add(block);
  const tread = toon('#b9bdc6');
  const cx = (minX + maxX) / 2;
  group.add(mesh(box(width, 0.04, L), tread, cx, -0.015, landingZ0 + L / 2, false));
  colliders.push({ minX, maxX, minZ: landingZ0, maxZ: landingZ1, bottom: STREET_Y, top: 0 });
  for (let i = 1; i <= treads; i++) {
    const z0 = landingZ1 + (i - 1) * run;
    group.add(mesh(box(width, 0.04, run + 0.02), tread, cx, -i * rise - 0.015, z0 + run / 2, false));
    colliders.push({ minX, maxX, minZ: z0, maxZ: z0 + run, bottom: STREET_Y, top: -i * rise });
  }

  // The railing: round the landing's open sides, then down the stairs.
  const ink = toon(PALETTE.deskLeg);
  const railX = minX + 0.06;
  const railH = 1.0;
  const post = (x: number, y: number, z: number) => group.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, railH, 6), ink, x, y + railH / 2, z, false));
  const rail = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => {
    const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
    const r = mesh(new THREE.CylinderGeometry(0.035, 0.035, len, 6), ink, (x0 + x1) / 2, (y0 + y1) / 2 + railH, (z0 + z1) / 2, false);
    r.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(x1 - x0, y1 - y0, z1 - z0).normalize());
    group.add(r);
  };
  const nz = landingZ0 + 0.06;
  post(maxX - 0.05, 0, nz);
  post(railX, 0, nz);
  post(railX, 0, landingZ1);
  rail(maxX - 0.05, 0, nz, railX, 0, nz);
  rail(railX, 0, nz, railX, 0, landingZ1);
  const bottomZ = landingZ1 + (treads - 0.5) * run;
  for (let i = 2; i <= treads; i += 3) post(railX, -i * rise, landingZ1 + (i - 0.5) * run);
  post(railX, -treads * rise, bottomZ);
  rail(railX, 0, landingZ1, railX, -treads * rise, bottomZ);
  colliders.push({ minX: minX - 0.05, maxX: minX + 0.1, minZ: landingZ0, maxZ: bottomZ, bottom: STREET_Y, top: 99 });
  colliders.push({ minX, maxX, minZ: landingZ0 - 0.05, maxZ: landingZ0 + 0.1, bottom: STREET_Y, top: 99 });
}

/** Walls throw shade only this far up: any higher and a low sun's shadow would fill the room. */
const SHADE_HEIGHT = 4.2;

/**
 * The four outside walls, built in pieces around their windows and doors. Each is painted inside in
 * the floor's colors and outside in the building's.
 */
function buildWalls(group: THREE.Group, colliders: Collider[], openings: Opening[], looks: Looks) {
  const inside = looks.paint;
  const outside = toon(PALETTE.exterior);
  const trimMat = looks.trim;
  const T = WALL_T;
  const walls: { side: Side; at: number; spans: [number, number, number][] }[] = [
    // The north wall stops at the back office, whose own bit of wall (buildWing's plug) comes down for it.
    { side: 'north', at: FLOOR.minZ - T / 2, spans: [[FLOOR.minX - T, WING.minX, WALL_HEIGHT]] },
    { side: 'south', at: FLOOR.maxZ + T / 2, spans: [[FLOOR.minX - T, FLOOR.maxX + T, WALL_HEIGHT]] },
    { side: 'west', at: FLOOR.minX - T / 2, spans: [[FLOOR.minZ, FLOOR.maxZ, WALL_HEIGHT]] },
    { side: 'east', at: FLOOR.maxX + T / 2, spans: [[FLOOR.minZ, FLOOR.maxZ, WALL_HEIGHT]] },
  ];
  for (const w of walls) {
    const alongX = w.side === 'north' || w.side === 'south';
    // A box's faces go +x, -x, +y, -y, +z, -z; the one facing outdoors gets the outside paint, and so
    // do the ends of the north and south walls, which run on past the east and west ones to the corners.
    const out = { east: 0, west: 1, south: 4, north: 5 }[w.side];
    const at = (u: number, y: number) => (alongX ? new THREE.Vector3(u, y, w.at) : new THREE.Vector3(w.at, y, u));
    const piece = (u0: number, u1: number, y0: number, y1: number) => {
      if (u1 - u0 < 0.001 || y1 - y0 < 0.001) return;
      // Up high the sun shines through, as it does through the ceiling and the loft's roof.
      if (y0 < SHADE_HEIGHT && y1 > SHADE_HEIGHT) {
        piece(u0, u1, y0, SHADE_HEIGHT);
        piece(u0, u1, SHADE_HEIGHT, y1);
        return;
      }
      const ends = alongX ? [u0 <= FLOOR.minX - T + 0.001 ? 1 : -1, u1 >= FLOOR.maxX + T - 0.001 ? 0 : -1] : [];
      const mats = Array.from({ length: 6 }, (_, i) => (i === out || ends.includes(i) ? outside : inside));
      const where = at((u0 + u1) / 2, (y0 + y1) / 2);
      const m = new THREE.Mesh(wallUv(alongX ? box(u1 - u0, y1 - y0, T) : box(T, y1 - y0, u1 - u0), where.x, where.y, where.z), mats);
      m.position.copy(where);
      m.castShadow = y1 <= SHADE_HEIGHT;
      m.receiveShadow = true;
      group.add(m);
    };
    // Baseboard and collider run between the doors.
    const run = (u0: number, u1: number) => {
      if (u1 - u0 < 0.001) return;
      const p = at((u0 + u1) / 2, 0.125);
      group.add(mesh(alongX ? box(u1 - u0, 0.25, T + 0.04) : box(T + 0.04, 0.25, u1 - u0), trimMat, p.x, p.y, p.z, false));
      block(u0, u1);
    };
    const block = (u0: number, u1: number, bottom?: number) =>
      colliders.push(alongX ? { minX: u0, maxX: u1, minZ: w.at - T / 2, maxZ: w.at + T / 2, top: 99, bottom } : { minX: w.at - T / 2, maxX: w.at + T / 2, minZ: u0, maxZ: u1, top: 99, bottom });
    const holes = openings.filter((o) => o.wall === w.side).sort((a, b) => a.u - b.u);
    for (const [a, b, top] of w.spans) {
      let u = a;
      let floorU = a;
      for (const o of holes) {
        const h0 = o.u - o.width / 2;
        const h1 = o.u + o.width / 2;
        if (h0 < a || h1 > b) continue;
        piece(u, h0, 0, top);
        piece(h0, h1, 0, o.y0);
        piece(h0, h1, o.y1, top);
        u = h1;
        if (o.y0 > 0) continue;
        // A door: walk through it, under the wall above.
        run(floorU, h0);
        block(h0, h1, o.y1);
        floorU = h1;
      }
      piece(u, b, 0, top);
      run(floorU, b);
    }
  }
}

/** Wall where the exit door is, for the floors above the bottom one: painted like the rest of the wall, inside and out, with its baseboard. */
function exitPlug(looks: Looks): { group: THREE.Group; collider: Collider } {
  const o = EXIT_DOOR;
  const at = onWall(o.wall, o.u);
  const group = new THREE.Group();
  // A box's faces go +x, -x, +y, -y, +z, -z; on the west wall, -x is outdoors.
  const mats = Array.from({ length: 6 }, (_, i) => (i === 1 ? toon(PALETTE.exterior) : looks.wall));
  const wall = new THREE.Mesh(box(WALL_T, o.y1 - o.y0, o.width), mats);
  wall.position.set(at.x, (o.y0 + o.y1) / 2, at.z);
  wall.receiveShadow = true;
  group.add(wall);
  group.add(mesh(box(WALL_T + 0.04, 0.25, o.width), looks.trim, at.x, 0.125, at.z, false));
  group.visible = false;
  return { group, collider: { minX: FLOOR.minX - WALL_T, maxX: FLOOR.minX, minZ: o.u - o.width / 2, maxZ: o.u + o.width / 2, top: 99 } };
}

/**
 * A straight run of outside wall `at` (z for one along x, x for one along z) from `u0` to `u1`, with
 * its outdoor side toward `out` (-1 or +1): painted inside in the floor's colors and outside in the
 * building's, and the ends in `endsOut` outside too. It has holes for `holes` (windows), a baseboard
 * and a collider. The back office's walls, and the bit of north wall that comes down for it.
 */
function wallRun(into: THREE.Group, cols: Collider[], axis: 'x' | 'z', at: number, u0: number, u1: number, out: 1 | -1, holes: Opening[], looks: Looks, endsOut: [boolean, boolean]) {
  const T = WALL_T;
  const outside = toon(PALETTE.exterior);
  // A box's faces go +x, -x, +y, -y, +z, -z.
  const outFace = axis === 'x' ? (out > 0 ? 4 : 5) : out > 0 ? 0 : 1;
  const endFaces = axis === 'x' ? [1, 0] : [5, 4];
  const paint = Array.from({ length: 6 }, (_, i) => (i === outFace || endFaces.some((f, k) => f === i && endsOut[k]) ? outside : looks.paint));
  const piece = (a: number, b: number, y0: number, y1: number) => {
    if (b - a < 0.001 || y1 - y0 < 0.001) return;
    if (y0 < SHADE_HEIGHT && y1 > SHADE_HEIGHT) {
      piece(a, b, y0, SHADE_HEIGHT);
      piece(a, b, SHADE_HEIGHT, y1);
      return;
    }
    const u = (a + b) / 2;
    const pos = new THREE.Vector3(axis === 'x' ? u : at, (y0 + y1) / 2, axis === 'x' ? at : u);
    const m = new THREE.Mesh(wallUv(axis === 'x' ? box(b - a, y1 - y0, T) : box(T, y1 - y0, b - a), pos.x, pos.y, pos.z), paint);
    m.position.copy(pos);
    m.castShadow = y1 <= SHADE_HEIGHT;
    m.receiveShadow = true;
    into.add(m);
  };
  let u = u0;
  for (const o of [...holes].sort((a, b) => a.u - b.u)) {
    piece(u, o.u - o.width / 2, 0, WALL_HEIGHT);
    piece(o.u - o.width / 2, o.u + o.width / 2, 0, o.y0);
    piece(o.u - o.width / 2, o.u + o.width / 2, o.y1, WALL_HEIGHT);
    u = o.u + o.width / 2;
  }
  piece(u, u1, 0, WALL_HEIGHT);
  const len = u1 - u0;
  const mid = (u0 + u1) / 2;
  into.add(mesh(axis === 'x' ? box(len, 0.25, T + 0.04) : box(T + 0.04, 0.25, len), looks.trim, axis === 'x' ? mid : at, 0.125, axis === 'x' ? at : mid, false));
  cols.push(axis === 'x' ? { minX: u0, maxX: u1, minZ: at - T / 2, maxZ: at + T / 2, top: 99 } : { minX: at - T / 2, maxX: at + T / 2, minZ: u0, maxZ: u1, top: 99 });
}

/** The sign that says there's room to grow, painted for how far the back office is built out. */
function paintGrowSign(c: HTMLCanvasElement, level: number) {
  const g = c.getContext('2d')!;
  const w = c.width;
  const h = c.height;
  const full = level >= WING.rows;
  g.fillStyle = full ? '#e9ecef' : '#ffd166';
  g.fillRect(0, 0, w, h);
  // Hazard stripes along the top and the bottom, while there's building to do.
  if (!full) {
    g.save();
    for (const y of [0, h - 34]) {
      g.beginPath();
      g.rect(0, y, w, 34);
      g.clip();
      g.fillStyle = '#2b2d42';
      for (let x = -40; x < w + 40; x += 56) {
        g.beginPath();
        g.moveTo(x, y + 34);
        g.lineTo(x + 28, y + 34);
        g.lineTo(x + 56, y);
        g.lineTo(x + 28, y);
        g.fill();
      }
      g.restore();
      g.save();
    }
    g.restore();
  }
  g.fillStyle = '#2b2d42';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '800 88px Nunito, ui-rounded, system-ui, sans-serif';
  g.fillText(full ? '🏢 As big as it gets' : '🚧 Room to grow', w / 2, h * 0.4);
  g.font = '700 46px Nunito, ui-rounded, system-ui, sans-serif';
  g.fillText(full ? 'The back office is built all the way out' : level ? 'Press E to go back another row: 2 more desks' : 'Press E to knock through: 2 more desks', w / 2, h * 0.68);
}

/** The back office, as far as it's built out (see WING). */
export interface WingView {
  /** How many rows it's built out. */
  level: number;
  /** Builds it out `level` rows (or walls it up): walls, floor, ceiling, desks and all. */
  set(level: number): void;
}

/**
 * The back office: the bit of north wall between the gong and the east wall, which comes down when
 * the floor's built out, and behind it the bay, a row deeper each time, with a pair of desks down the
 * middle of each row, a rug under them, a lamp over them and a window in the east wall. The sign that
 * says there's room to grow hangs on whichever wall is at the back.
 */
function buildWing(group: THREE.Group, colliders: Collider[], interactables: Interactable[], desks: Map<string, DeskView>, looks: Looks, trimMat: THREE.Material, planks: THREE.Material, ceiling: THREE.Material, night: NightParts): WingView {
  const T = WALL_T;
  const midX = (WING.minX + WING.maxX) / 2;

  // The wall where it goes through, standing while there's none.
  const plug = new THREE.Group();
  const plugCols: Collider[] = [];
  wallRun(plug, plugCols, 'x', FLOOR.minZ - T / 2, WING.minX, FLOOR.maxX + T, -1, [], looks, [false, true]);
  group.add(plug);

  // Each row's desks, and its rug and lamp.
  const rows = Array.from({ length: WING.rows }, (_, i) => {
    const row = i + 1;
    const z = wingRowZ(row);
    const extras = new THREE.Group();
    extras.add(mesh(roundedBox(3.4, 0.02, WING.row - 1, 0.5), toon(PALETTE.rugs[(row + 1) % PALETTE.rugs.length]), midX, 0.011, z, false));
    const lamp = pendant(WALL_HEIGHT - 4.05);
    lamp.position.set(midX, 4.05, z);
    extras.add(lamp);
    extras.visible = false;
    group.add(extras);
    const seats = WING_DESKS.filter((d) => d.wing === row).map((def) => {
      const view = buildDesk(def, DESKS.length + WING_DESKS.indexOf(def), trimMat);
      view.group.visible = false;
      group.add(view.group);
      desks.set(def.id, view);
      const hw = DESK_SIZE.width / 2 - 0.05;
      const hd = DESK_SIZE.depth / 2 - 0.02;
      const collider: Collider = { minX: def.x - hw, maxX: def.x + hw, minZ: def.z - hd, maxZ: def.z + hd, top: DESK_SIZE.height };
      const at = deskSeat(def, 1.25);
      const it: Interactable = { kind: 'desk', deskId: def.id, x: at.x, z: at.z, radius: 1.3, off: true };
      interactables.push(it);
      view.group.userData.interact = it;
      return { view, collider, it };
    });
    return { extras, seats };
  });

  // The sign: on the wall at the back, high enough to read from across the room over the desks.
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 420;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const sign = new THREE.Group();
  const board = mesh(roundedBox(2.64, 0.06, 1.12, 0.06), toon(PALETTE.ink), 0, 0, 0, false);
  board.rotation.x = Math.PI / 2;
  sign.add(board);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(2.56, 1.05), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  face.position.z = 0.032;
  sign.add(face);
  group.add(sign);
  const it: Interactable = { kind: 'expand', x: midX, z: FLOOR.minZ + 0.3, radius: 2.2 };
  interactables.push(it);
  sign.userData.interact = it;

  let built: THREE.Object3D[] = [];
  let mine: Collider[] = [];
  const view: WingView = {
    level: -1,
    set(level) {
      level = Math.max(0, Math.min(WING.rows, level));
      if (level === view.level) return;
      view.level = level;
      for (const o of built) {
        o.removeFromParent();
        o.traverse((m) => {
          if ((m as THREE.Mesh).isMesh) (m as THREE.Mesh).geometry.dispose();
        });
      }
      built = [];
      for (const c of mine) {
        const i = colliders.indexOf(c);
        if (i >= 0) colliders.splice(i, 1);
      }
      mine = [];
      const take = (o: THREE.Object3D) => {
        group.add(o);
        built.push(o);
        return o;
      };

      plug.visible = level === 0;
      if (level === 0) mine.push(...plugCols);
      rows.forEach(({ extras, seats }, i) => {
        const on = i < level;
        extras.visible = on;
        for (const s of seats) {
          s.view.group.visible = on;
          s.it.off = !on;
          if (on) mine.push(s.collider);
        }
      });

      const back = wingMinZ(level);
      if (level > 0) {
        const shell = new THREE.Group();
        wallRun(shell, mine, 'z', WING.minX - T / 2, back, FLOOR.minZ - T, -1, [], looks, [false, false]);
        const windows = wingWindows(level);
        wallRun(shell, mine, 'z', FLOOR.maxX + T / 2, back, FLOOR.minZ, 1, windows, looks, [false, false]);
        wallRun(shell, mine, 'x', back - T / 2, WING.minX - T, FLOOR.maxX + T, -1, [], looks, [true, true]);
        for (const o of windows) {
          shell.add(windowIn(o));
          shell.add(wetPane(o, night.wetGlass));
        }
        take(shell);

        // The floor: the room's planks carried on through (the same texture, lined up with it), on a
        // slab like the room's; and the ceiling's tiles over it.
        const w = WING.maxX - WING.minX;
        const d = FLOOR.minZ - back;
        const floorGeo = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2).translate(midX, 0, (back + FLOOR.minZ) / 2);
        const uv = floorGeo.getAttribute('uv');
        const pos = floorGeo.getAttribute('position');
        for (let k = 0; k < pos.count; k++) uv.setXY(k, (pos.getX(k) - FLOOR.minX) / (FLOOR.maxX - FLOOR.minX), (FLOOR.maxZ - pos.getZ(k)) / (FLOOR.maxZ - FLOOR.minZ));
        const floor = take(new THREE.Mesh(floorGeo, planks)) as THREE.Mesh;
        floor.receiveShadow = true;
        // Its edges are the band between the floors outside, its underside concrete.
        const band = toon('#e8a87c');
        const concrete = toon('#d3d6dd');
        const slab = new THREE.Mesh(box(w + 2 * T, SLAB - 0.01, d), [band, band, concrete, concrete, band, band]);
        slab.position.set(midX, -SLAB / 2 - 0.005, (back - T + FLOOR.minZ - T) / 2);
        slab.receiveShadow = true;
        take(slab);
        const ceilGeo = new THREE.PlaneGeometry(w, d).rotateX(Math.PI / 2).translate(midX, WALL_HEIGHT, (back + FLOOR.minZ) / 2);
        const cuv = ceilGeo.getAttribute('uv');
        const cpos = ceilGeo.getAttribute('position');
        for (let k = 0; k < cpos.count; k++) cuv.setXY(k, cpos.getX(k), cpos.getZ(k));
        take(new THREE.Mesh(ceilGeo, ceiling)).receiveShadow = false;
        // Its roof, flush with the tops of its walls, for when there's no floor over it.
        take(mesh(box(w + 2 * T, 0.02, d + T), toon('#fffaf3'), midX, WALL_HEIGHT + 0.03, (back - T + FLOOR.minZ) / 2, false));
        mine.push({ minX: WING.minX - T, maxX: FLOOR.maxX + T, minZ: back - T, maxZ: FLOOR.minZ - T, bottom: -SLAB, top: 0 });
        mine.push({ minX: WING.minX, maxX: FLOOR.maxX, minZ: back, maxZ: FLOOR.minZ, bottom: WALL_HEIGHT, top: WALL_HEIGHT + SLAB });
      }
      colliders.push(...mine);

      // The sign on whichever wall is at the back: low on the old wall, up over the desks and their
      // lamps once they're there, where it reads from across the room.
      sign.position.set(midX, level ? 5.3 : 2.4, back + 0.05);
      it.z = back + 0.3;
      paintGrowSign(canvas, level);
      tex.needsUpdate = true;
    },
  };
  void document.fonts?.ready.then(() => {
    paintGrowSign(canvas, Math.max(0, view.level));
    tex.needsUpdate = true;
  });
  view.set(0);
  return view;
}

/** Makes `obj` somewhere to sit (see SEATING): walk up to it, or look at it, and press E. */
function seatable(obj: THREE.Object3D, seatId: string, radius: number, interactables: Interactable[]) {
  const seat = SEATING_BY_ID.get(seatId)!;
  const it: Interactable = { kind: 'seat', seatId, x: seat.x, y: seat.y, z: seat.z, radius };
  interactables.push(it);
  obj.userData.interact = it;
}

function chair(color: string): THREE.Group {
  const g = new THREE.Group();
  const mat = toon(color);
  g.add(mesh(roundedBox(0.62, 0.1, 0.58, 0.12), mat, 0, 0.5, 0));
  const back = mesh(roundedBox(0.62, 0.1, 0.6, 0.12), mat, 0, 0.86, 0.27);
  back.rotation.x = Math.PI / 2 - 0.12;
  g.add(back);
  // A padded seat with a stitched-looking rim, a stem and five spokes with a caster on each.
  g.add(mesh(box(0.65, 0.035, 0.6), toon('#ffffff'), 0, 0.455, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.42, 8), toon(PALETTE.deskLeg), 0, 0.26, 0));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const leg = mesh(box(0.05, 0.04, 0.32), toon(PALETTE.deskLeg), Math.sin(a) * 0.15, 0.05, Math.cos(a) * 0.15);
    leg.rotation.y = a;
    g.add(leg);
    g.add(mesh(box(0.05, 0.05, 0.05), toon('#2b2d42'), Math.sin(a) * 0.29, 0.03, Math.cos(a) * 0.29, false));
  }
  // One or two draw calls, not fifteen.
  const merged = mergeColored(g);
  g.clear();
  g.add(...merged.children);
  return g;
}

/**
 * The `index`th desk (of DESKS) at `def`: its top, legs and modesty panel (in `trimMat`), its knick-knack,
 * its chair, and the anchors its worker and laptop go in.
 */
export function buildDesk(def: DeskDef, index: number, trimMat: THREE.Material): DeskView {
  const group = new THREE.Group();
  group.position.set(def.x, 0, def.z);
  group.rotation.y = def.rotY;
  const { width, depth, height } = DESK_SIZE;
  // What never moves on a desk (its top and legs, the cable tray under it, and what's left lying about on
  // it) is one mesh: each desk's own clutter is a matter of which desk it is.
  const still = new THREE.Group();
  still.add(mesh(roundedBox(width - 0.06, 0.08, depth - 0.04, 0.08), toon(PALETTE.desk), 0, height - 0.04, 0));
  const legMat = toon('#8d99ae');
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      still.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, height - 0.08, 8), legMat, sx * (width / 2 - 0.14), (height - 0.08) / 2, sz * (depth / 2 - 0.12)));
    }
  }
  const dark = toon('#4a4e69');
  still.add(mesh(box(width - 0.5, 0.04, 0.14), dark, 0, height - 0.16, -depth / 2 + 0.1, false));
  for (const x of [-0.5, 0.1, 0.6]) still.add(mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.5, 4).rotateZ(Math.PI / 2), toon('#1d1d1d'), x, height - 0.2 + Math.sin(x * 9) * 0.02, -depth / 2 + 0.16, false));
  still.add(mesh(new THREE.CylinderGeometry(0.009, 0.009, height - 0.2, 4), toon('#1d1d1d'), width / 2 - 0.3, (height - 0.2) / 2, -depth / 2 + 0.08, false));
  const top = height;
  const lie = (geo: THREE.BufferGeometry, color: string, x: number, y: number, z: number, turn = 0) => {
    const m = mesh(geo, toon(color), x, top + y, z, false);
    m.rotation.y = turn;
    still.add(m);
  };
  const pastel = ['#ffd166', '#ef8354', '#06d6a0', '#118ab2', '#ef476f'];
  // A notepad at its own angle on every desk, and then, depending on the desk, some of the rest.
  lie(box(0.2, 0.012, 0.27), '#fff7d6', -0.72, 0.006, 0.28, 0.35 * Math.sin(index * 2.3));
  lie(new THREE.CylinderGeometry(0.008, 0.008, 0.15, 5).rotateZ(Math.PI / 2), pastel[(index + 2) % 5], -0.6, 0.02, 0.36, 0.9 + index * 0.7);
  const kind = index % 4;
  if (kind === 0 || kind === 3) {
    // A pen cup with a few pens in it.
    lie(new THREE.CylinderGeometry(0.04, 0.035, 0.1, 6), pastel[index % 5], -0.35, 0.05, -0.32);
    for (let i = 0; i < 3; i++) lie(new THREE.CylinderGeometry(0.006, 0.006, 0.09, 4), pastel[(index + i + 1) % 5], -0.35 + (i - 1) * 0.02, 0.13, -0.32 + (i % 2) * 0.015);
  }
  if (kind === 1) {
    // Headphones left on the desk, band up.
    lie(new THREE.TorusGeometry(0.07, 0.012, 5, 12, Math.PI).rotateX(-0.5), '#2b2d42', -0.35, 0.06, 0.3);
    for (const sx of [-1, 1]) lie(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 8).rotateZ(Math.PI / 2), '#ef476f', -0.35 + sx * 0.07, 0.035, 0.3);
  }
  if (kind === 2 || kind === 3) {
    // A water bottle, and sticky notes stuck up on the desk.
    lie(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 6), '#a8dadc', -0.42, 0.1, -0.3);
    lie(new THREE.CylinderGeometry(0.02, 0.02, 0.03, 6), '#1d3557', -0.42, 0.215, -0.3);
    lie(box(0.075, 0.006, 0.075), '#ffe066', -0.3, 0.003, 0.02, 0.3);
    lie(box(0.075, 0.006, 0.075), '#ff9ecb', -0.24, 0.009, 0.06, -0.2);
  }
  group.add(mergeColored(still));
  // Modesty panel facing away from the worker
  group.add(mesh(box(width - 0.3, 0.32, 0.03), trimMat, 0, height - 0.26, -depth / 2 + 0.06));
  // Little desk decorations. Which desk gets which stays as it is: the holiday present goes in whichever
  // back corner it leaves free (DESK_SPOTS in holiday.ts).
  const deco = index % 3;
  if (deco === 0) {
    // In the chair's color.
    const mug = deskMug(PALETTE.chairs[index % 6]);
    mug.position.set(width / 2 - 0.25, height, -0.2);
    group.add(mug);
  } else if (deco === 1) {
    const p = plant('succulent');
    p.position.set(-width / 2 + 0.25, height, -0.25);
    group.add(p);
  } else {
    // Where the old three boxes stood, the desks with books taking turns with the arrangements.
    const books = deskBooks(Math.floor(index / 3));
    books.position.set(width / 2 - 0.26, height, -0.3);
    group.add(books);
  }

  const laptopAnchor = new THREE.Object3D();
  laptopAnchor.position.set(0, height, -0.06);
  laptopAnchor.scale.setScalar(1.3);
  group.add(laptopAnchor);

  // On the chair, facing the desk.
  const seatAnchor = new THREE.Object3D();
  seatAnchor.position.set(0, 0.4, 0.93);
  seatAnchor.rotation.y = Math.PI;
  seatAnchor.scale.setScalar(0.82);
  group.add(seatAnchor);

  // Up on the desk beside the laptop, clear of the mug or books at the back, facing the chair.
  const stage = new THREE.Object3D();
  stage.position.set(0.72, height - 0.07, 0.18);
  group.add(stage);

  const ch = chair(PALETTE.chairs[index % PALETTE.chairs.length]);
  ch.position.set(0, 0, 0.9);
  group.add(ch);

  const vacancyY = height + 0.55;
  const vacancy = vacancyMarker(vacancyY);
  group.add(vacancy);

  return { def, group, laptopAnchor, seatAnchor, stage, chair: ch, vacancy, vacancyY };
}

/** The floating green "+" over an empty seat. */
export function vacancyMarker(y: number): THREE.Group {
  const vacancy = new THREE.Group();
  const plusMat = toon('#7cf29a', { emissive: '#1f7a3a' });
  vacancy.add(mesh(box(0.28, 0.08, 0.08), plusMat, 0, 0, 0, false));
  vacancy.add(mesh(box(0.08, 0.28, 0.08), plusMat, 0, 0, 0, false));
  vacancy.position.set(0, y, 0);
  return vacancy;
}

const BEANBAG_COLORS = ['#ff6b6b', '#4ecdc4', '#9b5de5', '#ffd166', '#f15bb5', '#00bbf9', '#06d6a0', '#fb8500'];
/** A bean bag's footprint, with the lap desk in front of it (-z). */
const BEANBAG_BOX = { minX: -0.62, maxX: 0.62, minZ: -1.1, maxZ: 0.64, top: 0.62 } as const;

/** An overflow seat: a squashy bean bag, and a low lap desk in front of it for the laptop. */
function buildBeanbag(def: DeskDef, index: number): DeskView {
  const group = new THREE.Group();
  group.position.set(def.x, 0, def.z);
  group.rotation.y = def.rotY;
  const bag = new THREE.Group();
  const cloth = toon(BEANBAG_COLORS[index % BEANBAG_COLORS.length]);
  const seat = mesh(new THREE.SphereGeometry(0.62, 20, 14), cloth, 0, 0.3, 0);
  seat.scale.set(1, 0.52, 1);
  bag.add(seat);
  // Slumped up behind the worker, like a back rest.
  const back = mesh(new THREE.SphereGeometry(0.5, 18, 12), cloth, 0, 0.6, 0.32);
  back.scale.set(1.05, 0.95, 0.7);
  bag.add(back);
  group.add(bag);

  const tray = new THREE.Group();
  const wood = toon(PALETTE.wood);
  tray.add(mesh(roundedBox(0.95, 0.05, 0.6, 0.05), wood, 0, 0.42, 0));
  for (const sx of [-1, 1]) tray.add(mesh(box(0.05, 0.4, 0.5), toon('#8a5a3b'), sx * 0.4, 0.2, 0));
  tray.position.z = -0.8;
  group.add(tray);

  const laptopAnchor = new THREE.Object3D();
  laptopAnchor.position.set(0, 0.445, -0.8);
  laptopAnchor.scale.setScalar(1.05);
  group.add(laptopAnchor);

  // Sunk into the bag, facing the lap desk.
  const seatAnchor = new THREE.Object3D();
  seatAnchor.position.set(0, 0.32, 0.04);
  seatAnchor.rotation.y = Math.PI;
  seatAnchor.scale.setScalar(0.82);
  group.add(seatAnchor);

  // Standing up on the bag, sunk in a little.
  const stage = new THREE.Object3D();
  stage.position.set(0, BEANBAG_BOX.top - 0.1, -0.05);
  stage.rotation.y = Math.PI;
  group.add(stage);

  const vacancyY = 1.25;
  const vacancy = vacancyMarker(vacancyY);
  group.add(vacancy);

  return { def, group, laptopAnchor, seatAnchor, stage, chair: bag, vacancy, vacancyY };
}

const KIOSK_SIGN: Record<StationKind, string> = { issues: '📌 Ask me', pulls: '🔀 Ask me', queue: '📋 Ask me' };

/**
 * A board agent's kiosk: a little counter in its color with a sign on the front, and the agent standing
 * behind it. Its `vacancy` is where the agent waits before anyone has asked it anything (main.ts puts
 * one there), in the same spot and pose as the one who gets hired.
 */
function buildKiosk(def: DeskDef): DeskView {
  const kind = def.station!;
  const group = new THREE.Group();
  group.position.set(def.x, 0, def.z);
  group.rotation.y = def.rotY;
  const { width, depth, height } = KIOSK;
  const color = toon(STATION_AGENT[kind].color);
  // Narrower at the foot, like a lectern, with a lip round the top.
  group.add(mesh(roundedBox(width - 0.16, height - 0.1, depth - 0.12, 0.06), color, 0, (height - 0.1) / 2 + 0.04, 0));
  group.add(mesh(roundedBox(width - 0.02, 0.06, depth + 0.02, 0.05), toon(PALETTE.ink), 0, 0.03, 0));
  group.add(mesh(roundedBox(width, 0.06, depth, 0.05), toon(PALETTE.desk), 0, height - 0.03, 0));
  const sign = textPlane(KIOSK_SIGN[kind], { bg: '#fffaf3', size: 56 });
  sign.scale.multiplyScalar(0.62);
  sign.position.set(0, height * 0.55, -(depth - 0.12) / 2 - 0.012);
  sign.rotation.y = Math.PI;
  group.add(sign);

  // No laptop: its lid would hide the agent's face from whoever walks up, and its screen would face
  // the wall. The agent's terminal is a key press away (O).
  const laptopAnchor = new THREE.Object3D();
  laptopAnchor.visible = false;
  group.add(laptopAnchor);

  // On its feet behind the kiosk, facing it and the room beyond.
  const stand = new THREE.Object3D();
  stand.position.set(0, -0.07 * 1.1, KIOSK.stand);
  stand.rotation.y = Math.PI;
  stand.scale.setScalar(1.1);
  const seatAnchor = stand.clone();
  group.add(seatAnchor);
  const vacancy = new THREE.Group();
  vacancy.add(stand);
  group.add(vacancy);
  // Up on the counter, facing the room.
  const stage = new THREE.Object3D();
  stage.position.set(0, height - 0.1, 0);
  stage.rotation.y = Math.PI;
  group.add(stage);

  return { def, group, laptopAnchor, seatAnchor, stage, chair: new THREE.Group(), vacancy, vacancyY: 0 };
}

/** A framed board on a wall; the face gets a canvas texture (cork, chalk or whiteboard). */
function wallBoard(width: number, height: number, frameColor: string): { group: THREE.Group; face: THREE.Mesh } {
  const group = new THREE.Group();
  const frame = mesh(roundedBox(width + 0.3, 0.12, height + 0.3, 0.1), toon(frameColor), 0, 0, 0);
  frame.rotation.x = Math.PI / 2;
  group.add(frame);
  const faceMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(width, height), faceMat);
  face.position.z = 0.07;
  group.add(face);
  return { group, face };
}

export function buildOffice(): Office {
  const group = new THREE.Group();
  const colliders: Collider[] = [];
  const interactables: Interactable[] = [];
  const fixtures: WallRect[] = [];
  const fixture = (wall: WallId, u: number, y: number, w: number, h: number) => fixtures.push({ wall, u0: u - w / 2, u1: u + w / 2, y0: y - h / 2, y1: y + h / 2 });

  // What each floor paints its own way (see setLook): the walls, their trim, the planks.
  const looks: Looks = { wall: toonUnique(PALETTE.wall), paint: toonUnique(PALETTE.wall), trim: toonUnique(PALETTE.wallTrim), planks: [] };
  looks.paint.map = wallTexture();

  // Floor, and the ceiling, with the ways up and down to the other floors through them (see stack.ts).
  const floorTex = floorTexture();
  looks.planks.push(floorTex);
  const floorMat = new THREE.MeshToonMaterial({ map: floorTex, gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap });
  const stack = buildStack(colliders, floorMat);
  stack.set({ index: 0, count: 1 });
  group.add(stack.group);
  interactables.push(...stack.interactables);
  // The ladder and its sign, up the west wall.
  fixture('west', LADDER.z + 0.6, WALL_HEIGHT / 2, LADDER.width + 2.4, WALL_HEIGHT);

  // Rugs under each desk cluster
  [
    [-10.5, -4],
    [-1.5, -4],
    [-10.5, 4],
    [-1.5, 4],
  ].forEach(([x, z], i) => {
    const rug = mesh(roundedBox(6.2, 0.02, 4.6, 0.6), toon(PALETTE.rugs[i]), x, 0.011, z, false);
    group.add(rug);
  });

  const night: NightParts = {
    bulbs: [],
    halos: [],
    lamps: [],
    windows: [],
    street: STREET_Y,
    clouds: toonUnique('#ffffff'),
    wetGlass: new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false, visible: false }),
  };

  // Outside walls, with real windows you see out of and a door out.
  const trimMat = looks.trim;
  const openings = [...WINDOWS, EXIT_DOOR, BALCONY_DOOR];
  buildWalls(group, colliders, openings, looks);
  const glazing = new THREE.Group();
  for (const o of WINDOWS) {
    glazing.add(windowIn(o));
    fixture(o.wall, o.u, (o.y0 + o.y1) / 2 - 0.03, o.width + 0.2, o.y1 - o.y0 + 0.12);
    group.add(wetPane(o, night.wetGlass));
  }
  group.add(mergeByMaterial(glazing));
  // Blinds half-drawn at the top of every window, all in one mesh; and crown molding round the top of the room.
  group.add(
    blinds(
      WINDOWS.map((o): BlindItem => {
        const at = onWall(o.wall, o.u);
        return { x: at.x, y: o.y1 - 0.09, z: at.z, rotY: at.rotY, w: o.width - 0.18, drop: (o.y1 - o.y0 - 0.18) * 0.32 };
      }).map((b) => {
        // On the room side of the wall (its outdoor side is +z, here).
        const m = onWallAt(b.x, b.y, b.z, b.rotY, -(WALL_T / 2 + 0.02));
        const p = new THREE.Vector3().setFromMatrixPosition(m);
        return { ...b, x: p.x, z: p.z };
      }),
    ),
  );
  const crown = (x0: number, x1: number, z0: number, z1: number) => group.add(mesh(box(x1 - x0, 0.2, z1 - z0), trimMat, (x0 + x1) / 2, WALL_HEIGHT - 0.1, (z0 + z1) / 2, false));
  crown(FLOOR.minX, WING.minX, FLOOR.minZ, FLOOR.minZ + 0.08);
  crown(FLOOR.minX, FLOOR.maxX, FLOOR.maxZ - 0.08, FLOOR.maxZ);
  crown(FLOOR.minX, FLOOR.minX + 0.08, FLOOR.minZ, FLOOR.maxZ);
  crown(FLOOR.maxX - 0.08, FLOOR.maxX, FLOOR.minZ, FLOOR.maxZ);
  const doors: Door[] = [];
  // Out the glass doors on the south wall: the balcony.
  const slider = balconyDoor();
  group.add(slider.group);
  doors.push(slider.door);
  fixture(BALCONY_DOOR.wall, BALCONY_DOOR.u, (BALCONY_DOOR.y1 + 0.1) / 2, BALCONY_DOOR.width + 0.2, BALCONY_DOOR.y1 + 0.1);
  buildBalcony(group, colliders, interactables, night);
  const tee = buildTee(group, colliders, interactables);

  // Down to the street, which is the bottom floor's: its exit door and the steps down from it, the
  // posts under its balcony, the garage under it and the street out front. On a floor above it, all
  // of it is that many storeys further down (see setLevel).
  const ground = new THREE.Group();
  const groundColliders: Collider[] = [];
  const exit = exitDoor(night);
  ground.add(exit.group);
  doors.push(exit.door);
  const stairs = new THREE.Group();
  buildExitStairs(stairs, groundColliders);
  buildBalconyPosts(stairs, groundColliders);
  ground.add(mergeByMaterial(stairs));
  // The door, its frame and the EXIT sign over it.
  fixture(EXIT_DOOR.wall, EXIT_DOOR.u, (EXIT_DOOR.y1 + 0.7) / 2, EXIT_DOOR.width + 0.3, EXIT_DOOR.y1 + 0.7);
  buildGarage(ground, groundColliders);
  // The cars move, so their boxes follow them (and the street) themselves rather than setLevel.
  // (W6: what the cars bump into includes the café's and the bar's doorways: see vehicleSolids.)
  const cars = new Fleet(colliders, interactables, CARS, vehicleSolids);
  ground.add(cars.group);
  // The clouds stay up in the sky, however far down the street is.
  buildStreet(ground, groundColliders, night, group);
  // Traffic on the city's streets and people on its sidewalks (world/streetlife.ts).
  const life = buildStreetLife(night);
  life.group.position.y = STREET_Y;
  ground.add(life.group);
  // W2: the gate to the race circuit, on its plaza behind the office (world/circuit.ts).
  const raceGate = buildCityGate(STREET_Y);
  raceGate.group.position.y = STREET_Y;
  ground.add(raceGate.group);
  groundColliders.push(...raceGate.colliders);
  // The arena's gate beside it (world/arena.ts).
  const arenaGate = buildArenaCityGate(STREET_Y);
  arenaGate.group.position.y = STREET_Y;
  ground.add(arenaGate.group);
  groundColliders.push(...arenaGate.colliders);
  // W6: the café and the bar a block east, on the street (world/venues.ts).
  const venues = buildVenues(night);
  venues.group.position.y = STREET_Y;
  ground.add(venues.group);
  groundColliders.push(...venues.colliders);
  interactables.push(...venues.interactables);
  const green = buildGreen(ground, groundColliders, night);
  group.add(ground);
  colliders.push(...groundColliders);
  const groundBase = groundColliders.map((c) => ({ c, top: c.top, bottom: c.bottom ?? 0 }));
  // Upstairs there's no way out on the west side: the doorway is wall like the rest of it.
  const plug = exitPlug(looks);
  group.add(plug.group);
  // The rest of the building, above and below this floor.
  const tower = buildTower(colliders, night);
  group.add(tower.group);

  // Desks
  const desks = new Map<string, DeskView>();
  DESKS.forEach((def, i) => {
    const view = buildDesk(def, i, trimMat);
    group.add(view.group);
    desks.set(def.id, view);
    const hw = DESK_SIZE.width / 2 - 0.05;
    const hd = DESK_SIZE.depth / 2 - 0.02;
    colliders.push({ minX: def.x - hw, maxX: def.x + hw, minZ: def.z - hd, maxZ: def.z + hd, top: DESK_SIZE.height });
    const seat = deskSeat(def, 1.25);
    const it: Interactable = { kind: 'desk', deskId: def.id, x: seat.x, z: seat.z, radius: 1.3 };
    interactables.push(it);
    view.group.userData.interact = it;
  });

  // Bean bags, put away until every desk is taken.
  const beanbags = new Map<string, { view: DeskView; it: Interactable; collider: Collider }>();
  BEANBAGS.forEach((def, i) => {
    const view = buildBeanbag(def, i);
    view.group.visible = false;
    group.add(view.group);
    desks.set(def.id, view);
    const it: Interactable = { kind: 'desk', deskId: def.id, x: def.x, z: def.z, radius: 1.8, off: true };
    interactables.push(it);
    view.group.userData.interact = it;
    // Its footprint turned the way it faces (a quarter turn at a time).
    const c = Math.round(Math.cos(def.rotY));
    const s = Math.round(Math.sin(def.rotY));
    const xs = [BEANBAG_BOX.minX, BEANBAG_BOX.maxX].flatMap((lx) => [BEANBAG_BOX.minZ, BEANBAG_BOX.maxZ].map((lz) => def.x + lx * c + lz * s));
    const zs = [BEANBAG_BOX.minX, BEANBAG_BOX.maxX].flatMap((lx) => [BEANBAG_BOX.minZ, BEANBAG_BOX.maxZ].map((lz) => def.z - lx * s + lz * c));
    const collider = { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs), top: BEANBAG_BOX.top };
    beanbags.set(def.id, { view, it, collider });
  });
  // The board agents' kiosks, each just west of its board.
  for (const def of STATIONS) {
    const view = buildKiosk(def);
    group.add(view.group);
    desks.set(def.id, view);
    // The kiosk and the agent behind it, back to the wall (they all stand by the north wall) so
    // nobody squeezes in behind, and up over the agent's head so nobody hops on it.
    const corners = [-1, 1].flatMap((t) => [-KIOSK.depth / 2, KIOSK.stand + 0.35].map((sz) => deskPoint(def, (t * KIOSK.width) / 2, sz)));
    const xs = corners.map(([x]) => x);
    const zs = corners.map(([, z]) => z);
    colliders.push({ minX: Math.min(...xs), maxX: Math.max(...xs), minZ: FLOOR.minZ, maxZ: Math.max(...zs), top: 1.5, fence: true });
    // Walk up to its front.
    const [fx, fz] = deskPoint(def, 0, -1);
    const it: Interactable = { kind: 'station', deskId: def.id, x: fx, z: fz, radius: 1.3 };
    interactables.push(it);
    view.group.userData.interact = it;
    // The agent, its name tag and the card over its head, up against the wall.
    fixture('north', def.x, 1.45, 1.4, 2.9);
  }
  const setBeanbags = (out: Set<string>) => {
    const appeared: Collider[] = [];
    for (const [id, b] of beanbags) {
      const show = out.has(id);
      if (show === b.view.group.visible) continue;
      b.view.group.visible = show;
      b.it.off = !show;
      if (show) {
        colliders.push(b.collider);
        appeared.push(b.collider);
      } else colliders.splice(colliders.indexOf(b.collider), 1);
    }
    return appeared;
  };

  // Cork boards on the walls
  const boardMeshes = {} as Office['boardMeshes'];
  for (const key of Object.keys(BOARDS) as (keyof typeof BOARDS)[]) {
    const b = BOARDS[key];
    // Out from the wall, the way the board faces.
    const nx = Math.sin(b.rotY);
    const nz = Math.cos(b.rotY);
    // The queue is a whiteboard in an aluminium frame; the others hang in wood.
    const { group: bg, face } = wallBoard(b.width, b.height, key === 'queue' ? '#aab4be' : PALETTE.wood);
    bg.position.set(b.x + nx * 0.08, b.y, b.z + nz * 0.08);
    bg.rotation.y = b.rotY;
    group.add(bg);
    boardMeshes[key] = face;
    const label = textPlane(b.label, { bg: '#fffaf3', size: 64 });
    label.scale.multiplyScalar(1.3);
    label.position.set(b.x + nx * 0.04, b.y + b.height / 2 + 0.5, b.z + nz * 0.04);
    label.rotation.y = b.rotY;
    group.add(label);
    const it: Interactable = { kind: key, x: b.x + nx * 1.6, z: b.z + nz * 1.6, radius: 2.4 };
    interactables.push(it);
    bg.userData.interact = it;
    // The board and its label above it, up to the ceiling.
    const wall = wallFacing(b.rotY);
    const bottom = b.y - (b.height + 0.3) / 2;
    fixture(wall, wall === 'north' || wall === 'south' ? b.x : b.z, (bottom + WALL_HEIGHT) / 2, b.width + 0.3, WALL_HEIGHT - bottom);
  }

  // Lounge: TV, couch, coffee table, beanbags, and the jukebox and the arcade in the corner
  const tvGroup = new THREE.Group();
  tvGroup.add(mesh(roundedBox(TV.width + 0.3, 0.14, TV.height + 0.3, 0.12), toon(PALETTE.ink), 0, 0, 0));
  (tvGroup.children[0] as THREE.Mesh).rotation.x = Math.PI / 2;
  const tvScreen = new THREE.Mesh(new THREE.PlaneGeometry(TV.width, TV.height), new THREE.MeshBasicMaterial({ color: '#1b1d2e', toneMapped: false }));
  tvScreen.position.z = 0.08;
  tvGroup.add(tvScreen);
  tvGroup.position.set(TV.x - 0.1, TV.y, TV.z);
  tvGroup.rotation.y = -Math.PI / 2;
  group.add(tvGroup);
  const tv: Interactable = { kind: 'tv', x: TV.x - 4.5, z: TV.z, radius: 3.2 };
  interactables.push(tv);
  tvGroup.userData.interact = tv;
  fixture('east', TV.z, TV.y, TV.width + 0.3, TV.height + 0.3);

  // The machine monitor between the west windows, facing the desks.
  const monitor = new THREE.Group();
  const bezel = mesh(roundedBox(MACHINE_MONITOR.width + 0.16, 0.1, MACHINE_MONITOR.height + 0.16, 0.06), toon(PALETTE.ink), 0, 0, 0);
  bezel.rotation.x = Math.PI / 2;
  monitor.add(bezel);
  const machineScreen = new THREE.Mesh(new THREE.PlaneGeometry(MACHINE_MONITOR.width, MACHINE_MONITOR.height), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }));
  machineScreen.position.z = 0.06;
  monitor.add(machineScreen);
  monitor.position.set(MACHINE_MONITOR.x + 0.07, MACHINE_MONITOR.y, MACHINE_MONITOR.z);
  monitor.rotation.y = Math.PI / 2;
  group.add(monitor);
  fixture('west', MACHINE_MONITOR.z, MACHINE_MONITOR.y, MACHINE_MONITOR.width + 0.2, MACHINE_MONITOR.height + 0.2);

  // The couch, its back to the room, turned from the model's +z to face the TV on the east wall (+x).
  const couch = loungeCouch();
  couch.position.set(10.5, 0, 0);
  couch.rotation.y = Math.PI / 2;
  group.add(couch);
  // Its top on the seat cushions, so someone standing on the couch stands on them.
  colliders.push({ minX: 10, maxX: 11, minZ: -2.2, maxZ: 2.2, top: 0.47 });
  seatable(couch, 'couch', 2.6, interactables);

  const table = coffeeTable();
  table.position.set(13, 0, 0);
  group.add(table);
  colliders.push({ minX: 12.2, maxX: 13.8, minZ: -0.8, maxZ: 0.8, top: 0.46 });
  const lounge = mesh(roundedBox(7, 0.02, 7, 1.2), toon('#ffc6ff'), 13.4, 0.011, 0, false);
  group.add(lounge);

  // A pouf either side of the lounge (the seats still called beanbags), turned to the TV like whoever sits on it.
  for (const [i, [color, x, z]] of (
    [
      ['#06d6a0', 12.5, 3.5],
      ['#ffd166', 14.5, -3.4],
    ] as const
  ).entries()) {
    const id = `lounge-beanbag-${i + 1}`;
    const seat = pouf(color);
    seat.position.set(x, 0, z);
    seat.rotation.y = SEATING_BY_ID.get(id)!.rotY;
    group.add(seat);
    // Its top on the pouf's, the button in the middle of it.
    colliders.push({ minX: x - 0.5, maxX: x + 0.5, minZ: z - 0.5, maxZ: z + 0.5, top: 0.42 });
    seatable(seat, id, 1.4, interactables);
  }
  const jukebox = buildJukebox();
  group.add(jukebox.group);
  colliders.push(jukebox.collider);
  interactables.push(jukebox.interactable);
  fixture('east', JUKEBOX.z, JUKEBOX.height / 2, JUKEBOX.width + 0.1, JUKEBOX.height);
  const cabinet = buildCabinet();
  group.add(cabinet.group);
  colliders.push(cabinet.collider);
  interactables.push(cabinet.interactable);
  fixture('east', CABINET.z, CABINET.height / 2, CABINET.width + 0.1, CABINET.height);

  // The bookshelf of the project's docs, on the south wall between the middle window and the balcony doors.
  const shelf = buildBookshelf();
  group.add(shelf.group);
  colliders.push(shelf.collider);
  interactables.push(shelf.interactable);
  fixture('south', BOOKSHELF.x, (BOOKSHELF.height + 0.55) / 2, BOOKSHELF.width + 0.2, BOOKSHELF.height + 0.55);

  // Kitchen corner: counter + coffee machine + fridge
  const kitchen = buildKitchen();
  group.add(kitchen.group);
  colliders.push(...kitchen.colliders);
  interactables.push(kitchen.interactable);
  // Counter, coffee machine and fridge, in front of the south wall.
  fixture('south', -14.5, 0.55, 5.1, 1.1);
  fixture('south', -15.7, 0.9, 0.6, 1.8);
  fixture('south', -11.3, 1.1, 1.1, 2.2);

  // Plants around the room
  const plants: THREE.Group[] = [];
  /** The ones in the way into the back office, and their colliders, to put away while it's built. */
  const plantsByWing: { group: THREE.Group; collider: Collider }[] = [];
  for (const [i, spot] of PLANTS.entries()) {
    const [x, z, s] = spot;
    const p = plant(floorPlant(i), s);
    p.position.set(x, 0, z);
    group.add(p);
    plants.push(p);
    const r = 0.3 * s;
    const collider: Collider = { minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r, top: 0.5 * s };
    colliders.push(collider);
    if (plantByWing(spot)) plantsByWing.push({ group: p, collider });
  }

  // Ceiling lamps (cartoon pendants), hung on long cords down from the high ceiling.
  const lampY = 4.05;
  for (const [x, z] of [
    [-10.5, -4],
    [-1.5, -4],
    [-10.5, 4],
    [-1.5, 4],
    [13, 0],
  ]) {
    const lamp = pendant(WALL_HEIGHT - lampY);
    lamp.position.set(x, lampY, z);
    group.add(lamp);
    night.halos.push({ at: new THREE.Vector3(x, lampY - 0.12, z), size: 1.3, color: '#ffe08a' });
  }

  // The back office through the north wall past the gong, walled up until the floor's built out.
  const wing = buildWing(group, colliders, interactables, desks, looks, trimMat, floorMat, stack.ceiling, night);
  fixture('north', (WING.minX + FLOOR.maxX) / 2, WALL_HEIGHT / 2, FLOOR.maxX - WING.minX, WALL_HEIGHT);
  const setWing = (level: number) => {
    wing.set(level);
    for (const p of plantsByWing) {
      const out = wing.level === 0;
      if (p.group.visible === out) continue;
      p.group.visible = out;
      const i = colliders.indexOf(p.collider);
      if (out && i < 0) colliders.push(p.collider);
      else if (!out && i >= 0) colliders.splice(i, 1);
    }
  };
  // The signs over the desks.
  const signs = buildDeskSigns();
  group.add(signs.group);

  const bossScreen = buildLoft(group, colliders, interactables, looks);
  // Under the loft: the meeting room.
  const meeting = buildMeetingRoom(group, colliders, interactables, desks, doors, night);
  fixture('south', MEETING_BOARD.x, MEETING_BOARD.y, MEETING_BOARD.width + 0.4, MEETING_BOARD.height + 0.4);

  // The elevator to the other floors, against the north wall between the PR board and the gong.
  const elevator = buildElevator();
  group.add(elevator.group);
  colliders.push(...elevator.colliders);
  interactables.push(elevator.interactable);
  fixture('north', ELEVATOR.x, WALL_HEIGHT / 2, ELEVATOR.width + 0.1, WALL_HEIGHT);
  // Its stop in the garage, at the bottom of the same shaft: as tall as the garage, and as far down
  // as the street is (see setLevel).
  const garageLift = buildElevator(-SLAB - STREET_Y);
  garageLift.setSign('🛗 Garage');
  group.add(garageLift.group);
  colliders.push(...garageLift.colliders);
  interactables.push(garageLift.interactable);

  // The gong, just past the elevator from the PR board.
  const gong = buildGong();
  group.add(gong.group);
  colliders.push(...gong.colliders);
  interactables.push(gong.interactable);
  fixture('north', GONG.x, (GONG.height + 0.3) / 2, GONG.width + 1.2, GONG.height + 0.3);

  // The basketball hoop, on the west wall between the exit door and the kitchen.
  const hoop = buildHoop();
  group.add(hoop.group);
  colliders.push(...hoop.colliders);
  fixture('west', HOOP.z, (HOOP.board.bottom - 0.6 + HOOP.board.top + 0.1) / 2, HOOP.board.width + 0.2, HOOP.board.top - HOOP.board.bottom + 0.7);

  // The whiteboard, out on the floor between the desks and the lounge.
  const whiteboard = buildWhiteboard();
  group.add(whiteboard.group);
  colliders.push(...whiteboard.colliders);
  interactables.push(whiteboard.interactable);
  // Pictures stay clear of the stairs (step by step, so they can hang above them) and of what's on
  // the loft's walls upstairs, as buildLoft places it: the couch and the sign.
  const run = (STAIRS.toX - STAIRS.fromX) / STAIRS.steps;
  const rise = LOFT.y / STAIRS.steps;
  for (let i = 1; i <= STAIRS.steps; i++) fixture('south', STAIRS.fromX + (i - 0.5) * run, (i * rise) / 2, run, i * rise);
  const loftZ = (LOFT.minZ + LOFT.maxZ) / 2;
  fixture('east', loftZ, LOFT.y + 0.5, 2.4, 1);
  fixture('south', LOFT.maxX - 3, LOFT.y + 1.9, 2.6, 0.6);

  setShadowFloors(colliders);
  // Soft contact shadows under the furniture, in one mesh (the sun's shadow map leaves the small pieces out).
  const spots: Blob[] = [];
  for (const d of DESKS) {
    spots.push([d.x, d.z, 2.7, 1.6, d.rotY, 0.9], [d.x + Math.sin(d.rotY) * 0.9, d.z + Math.cos(d.rotY) * 0.9, 1.0, 1.0, d.rotY, 0.9]);
  }
  spots.push([10.5, 0, 1.5, 4.8, 0, 0.8], [13, 0, 2.1, 1.4, 0, 0.7]);
  for (const [x, z, sc] of PLANTS) spots.push([x, z, 0.95 * sc, 0.95 * sc, 0, 0.8]);
  group.add(blobShadows(spots));

  // Pictures on the walls, wherever there's room: the frames are one mesh and the paintings (all on one sheet) another.
  const art: ArtItem[] = [];
  const artRects0: WallRect[] = [];
  const taken: WallRect[] = [...fixtures];
  const clear = (r: WallRect) => taken.every((f) => f.wall !== r.wall || !overlaps(r, f, 0.35));
  const skipOpening = (o: Opening) => taken.push({ wall: o.wall, u0: o.u - o.width / 2, u1: o.u + o.width / 2, y0: o.y0, y1: o.y1 });
  [...WINDOWS, EXIT_DOOR, BALCONY_DOOR].forEach(skipOpening);
  const frames = ['#c98b5a', '#2b2d42', '#fffaf3', '#e9b949', '#2a9d8f', '#ff8a5b'];
  let n = 0;
  for (const wall of ['north', 'west', 'south', 'east'] as const) {
    const [lo, hi] = wall === 'north' || wall === 'south' ? [FLOOR.minX, wall === 'north' ? WING.minX : FLOOR.maxX] : [FLOOR.minZ, FLOOR.maxZ];
    for (let u = lo + 1.8; u < hi - 1.2; u += 3.1) {
      for (const y of [5.5, 2.6]) {
        const w = 1.1 + ((n * 7) % 5) * 0.16;
        const h = 0.8 + ((n * 3) % 4) * 0.14;
        const r = frameRect({ wall, u, y, w, h });
        // Not into the loft's corner, nor where the wall's too short for it.
        if (wall === 'south' && r.u1 > LOFT.minX - 0.5) continue;
        if (wall === 'east' && r.u1 > LOFT.minZ - 0.5) continue;
        if (wallTop(wall, r.u0) < r.y1 + 0.3 || wallTop(wall, r.u1) < r.y1 + 0.3 || !clear(r)) continue;
        taken.push(r);
        artRects0.push(r);
        fixtures.push(r);
        const pose = wallPose(wall, u, y);
        art.push({ x: pose.x, y, z: pose.z, rotY: pose.rotY, w, h, art: n % ART_COUNT, frame: frames[(n * 5) % frames.length] });
        n++;
      }
    }
  }
  // What people have hung wins: a painting that's under one of their frames comes down, whenever the gallery changes.
  const artRects = art.map((item, i) => ({ item, rect: artRects0[i] }));
  let artMesh: THREE.Group | null = null;
  const showArt = () => {
    if (artMesh) {
      group.remove(artMesh);
      artMesh.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
    artMesh = wallArt(artRects.filter(({ rect }) => userFrames.rects.every((f) => f.wall !== rect.wall || !overlaps(rect, f, 0.05))).map((a) => a.item));
    group.add(artMesh);
  };
  userFrames.listeners.add(showArt);
  showArt();

  // A wall clock, with the time on it.
  const clock = new THREE.Group();
  {
    const pose = wallPose('south', -5.6, 5.4);
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = '#2b2d42';
    g.beginPath();
    g.arc(64, 64, 64, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fffaf3';
    g.beginPath();
    g.arc(64, 64, 55, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#2b2d42';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.fillRect(64 + Math.sin(a) * 46 - (i % 3 ? 2 : 4), 64 - Math.cos(a) * 46 - (i % 3 ? 2 : 4), i % 3 ? 4 : 8, i % 3 ? 4 : 8);
    }
    const face = new THREE.CanvasTexture(c);
    face.colorSpace = THREE.SRGBColorSpace;
    clock.add(new THREE.Mesh(new THREE.CircleGeometry(0.42, 24), new THREE.MeshToonMaterial({ map: face, gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap })));
    fixture('south', -5.6, 5.4, 1, 1);
    clock.position.set(pose.x, 5.4, pose.z - 0.03);
    clock.rotation.y = pose.rotY;
  }
  const hand = (len: number, w: number) => {
    const pivot = new THREE.Group();
    const bar = mesh(box(w, len, 0.01), toon('#2b2d42'), 0, len / 2 - 0.03, 0.012, false);
    pivot.add(bar);
    clock.add(pivot);
    return pivot;
  };
  const hourHand = hand(0.22, 0.028);
  const minuteHand = hand(0.32, 0.02);
  group.add(clock);
  const setClock = () => {
    // The office's time, whatever the viewer's clock says.
    const d = new Date(Date.now() + officeClock.utcOffset * 60_000);
    minuteHand.rotation.z = -((d.getUTCMinutes() + d.getUTCSeconds() / 60) / 60) * Math.PI * 2;
    hourHand.rotation.z = -(((d.getUTCHours() % 12) + d.getUTCMinutes() / 60) / 12) * Math.PI * 2;
  };
  setClock();
  let clockAt = 0;

  const setProjectName = (name: string) => elevator.setSign(`🛗 ${name}`);
  const setLook = (p: FloorPalette) => {
    looks.wall.color.set(p.wall);
    looks.paint.color.set(p.wall);
    looks.trim.color.set(p.trim);
    for (const t of looks.planks) {
      paintPlanks(t.image as HTMLCanvasElement, p);
      t.needsUpdate = true;
    }
  };

  const setLevel = (index: number, count: number, wings: readonly number[] = []) => {
    const drop = index * STOREY;
    ground.position.y = -drop;
    for (const g of groundBase) {
      // Walls up into the sky stay that way.
      if (g.top <= 50) g.c.top = g.top - drop;
      g.c.bottom = g.bottom - drop;
    }
    night.street = streetBelow(index);
    exit.door.y = -drop;
    exit.door.locked = index > 0;
    garageLift.setFloor(streetBelow(index));
    cars.setStreet(streetBelow(index));
    venues.setStreet(streetBelow(index));
    plug.group.visible = index > 0;
    const i = colliders.indexOf(plug.collider);
    if (index > 0 && i < 0) colliders.push(plug.collider);
    else if (index === 0 && i >= 0) colliders.splice(i, 1);
    tower.set(index, count, wings);
  };
  setLevel(0, 1);

  const update = (t: number, dt: number, people: Iterable<{ x: number; y: number; z: number }>) => {
    raceGate.update(t);
    arenaGate.update(t);
    const crowd = [...people];
    venues.update(t, dt, crowd);
    const near = new Set<Door>();
    for (const p of crowd) for (const d of doors) if (Math.abs(p.y - d.y) < 1.6 && Math.hypot(p.x - d.x, p.z - d.z) < 2.4) near.add(d);
    for (const d of doors) {
      const want = near.has(d) && !d.locked ? 1 : 0;
      if (d.open === want) continue;
      d.open = want > d.open ? Math.min(1, d.open + dt * 2.5) : Math.max(0, d.open - dt * 1.6);
      d.show(d.open);
    }
    for (const d of desks.values()) {
      // A board agent waiting to be asked stands still (its own idle bob is in Worker.update).
      if (!d.vacancy.visible || !d.group.visible || d.def.station) continue;
      d.vacancy.position.y = d.vacancyY + Math.sin(t * 2 + d.def.x) * 0.06;
      d.vacancy.rotation.y = t * 1.2;
    }
    if (t - clockAt > 5) {
      clockAt = t;
      setClock();
    }
    elevator.update(dt);
    garageLift.update(dt);
    gong.update(dt);
    green.update(t);
    hoop.update(dt);
  };

  return { group, colliders, interactables, desks, setBeanbags, boardMeshes, tvScreen, bossScreen, machineScreen, meetingBoard: meeting.board, meetingSign: meeting.sign, fixtures: () => fixtures, elevator, garageLift, cars, life, venues, gong, jukebox, cabinet, whiteboard, tee, green, hoop, stack, wing, setWing, signs, setProjectName, setLook, setLevel, night, plants, update };
}

/** A chair at the meeting table, with its laptop on the table in front of it. */
function buildMeetingSeat(def: DeskDef, index: number): DeskView {
  const group = new THREE.Group();
  group.position.set(def.x, 0, def.z);
  group.rotation.y = def.rotY;
  const laptopAnchor = new THREE.Object3D();
  laptopAnchor.position.set(0, MEETING_TABLE.height, 0);
  laptopAnchor.scale.setScalar(1.15);
  group.add(laptopAnchor);
  const seatAnchor = new THREE.Object3D();
  seatAnchor.position.set(0, 0.4, 0.85);
  seatAnchor.rotation.y = Math.PI;
  seatAnchor.scale.setScalar(0.82);
  group.add(seatAnchor);
  const ch = chair(['#2b2d42', '#ef476f', '#118ab2', '#06d6a0', '#ffd166'][index % 5]);
  ch.position.set(0, 0, 0.85);
  group.add(ch);
  // A merge's dance party: up on its chair rather than the table, where the laptops are close together.
  const stage = new THREE.Object3D();
  stage.position.set(0, 0.48, 0.85);
  group.add(stage);
  // Nobody is hired here from the floor, so there's no '+' over a free chair: a meeting fills them.
  const vacancy = new THREE.Group();
  group.add(vacancy);
  return { def, group, laptopAnchor, seatAnchor, stage, chair: ch, vacancy, vacancyY: 0 };
}

/**
 * The meeting room under the loft: glass walls from the loft's posts round to the outside walls, a
 * sliding glass door facing the lounge, a long table with its chairs (MEETING_SEATS), a board on the
 * back wall for the meeting's output and a sign by the door for how it's going.
 */
function buildMeetingRoom(group: THREE.Group, colliders: Collider[], interactables: Interactable[], desks: Map<string, DeskView>, doors: Door[], night: NightParts): { board: THREE.Mesh; sign: THREE.Mesh } {
  const R = MEETING_ROOM;
  const H = R.height;
  const T = 0.1;
  const frameMat = toon('#ffffff');
  const walls = new THREE.Group();
  const bar = (w: number, h: number, d: number, x: number, y: number, z: number) => walls.add(mesh(box(w, h, d), frameMat, x, y, z, false));
  /** A run of glass along x (north wall) or z (west wall), from a to b, in panes about `pane` wide. */
  const run = (axis: 'x' | 'z', a: number, b: number, at: number, pane = 2.2) => {
    const len = b - a;
    const n = Math.max(1, Math.round(len / pane));
    for (let i = 0; i < n; i++) {
      const g = glassPane(len / n, H);
      const u = a + (i + 0.5) * (len / n);
      if (axis === 'x') g.position.set(u, H / 2, at);
      else {
        g.position.set(at, H / 2, u);
        g.rotation.y = Math.PI / 2;
      }
      walls.add(g);
    }
    for (let i = 0; i <= n; i++) {
      const u = a + i * (len / n);
      if (axis === 'x') bar(0.08, H, T + 0.04, u, H / 2, at);
      else bar(T + 0.04, H, 0.08, at, H / 2, u);
    }
    for (const y of [0.05, H - 0.05]) {
      if (axis === 'x') bar(len, 0.1, T + 0.06, (a + b) / 2, y, at);
      else bar(T + 0.06, 0.1, len, at, y, (a + b) / 2);
    }
    colliders.push(axis === 'x' ? { minX: a, maxX: b, minZ: at - T / 2, maxZ: at + T / 2, top: H } : { minX: at - T / 2, maxX: at + T / 2, minZ: a, maxZ: b, top: H });
  };
  run('x', R.minX, R.door.x0, R.minZ);
  run('x', R.door.x1, R.maxX, R.minZ);
  run('z', R.minZ, R.maxZ, R.minX);
  // Over the door, up to the loft's floor.
  bar(R.door.x1 - R.door.x0, 0.1, T + 0.06, (R.door.x0 + R.door.x1) / 2, 2.3, R.minZ);
  group.add(walls);

  // The door: two glass leaves that slide apart over the glass on either side when someone comes up.
  const dx = (R.door.x0 + R.door.x1) / 2;
  const half = (R.door.x1 - R.door.x0) / 2;
  const alu = toon('#aab4be');
  const leaves: [THREE.Group, number][] = [];
  for (const side of [-1, 1]) {
    const leaf = new THREE.Group();
    const h = 2.25;
    for (const y of [0.04, h - 0.04]) leaf.add(mesh(box(half, 0.07, 0.04), alu, 0, y, 0, false));
    for (const x of [-half / 2 + 0.03, half / 2 - 0.03]) leaf.add(mesh(box(0.06, h, 0.04), alu, x, h / 2, 0, false));
    const pane = glassPane(half - 0.12, h - 0.14);
    pane.position.y = h / 2;
    leaf.add(pane);
    leaf.add(mesh(box(0.03, 0.4, 0.07), toon(PALETTE.ink), -side * (half / 2 - 0.1), 1.05, 0, false));
    const x0 = dx + (side * half) / 2;
    leaf.position.set(x0, 0, R.minZ - T / 2 - 0.04);
    group.add(leaf);
    leaves.push([leaf, x0]);
  }
  doors.push({
    x: dx,
    y: 0,
    z: R.minZ,
    open: 0,
    show: (k) => {
      const e = k * k * (3 - 2 * k);
      for (const [leaf, x0] of leaves) leaf.position.x = x0 + Math.sign(x0 - dx) * e * (half - 0.06);
    },
  });
  const label = textPlane('🤝 Meeting room', { bg: '#2b2d42', color: '#fffaf3', size: 56, border: '#fffaf3' });
  label.scale.multiplyScalar(0.62);
  label.position.set(dx, 2.52, R.minZ - 0.07);
  label.rotation.y = Math.PI;
  group.add(label);

  // The table, on two pedestals, and its chairs.
  const table = new THREE.Group();
  const top = MEETING_TABLE;
  table.add(mesh(roundedBox(top.width, 0.08, top.depth, 0.1), toon(PALETTE.wood), 0, top.height - 0.04, 0));
  for (const sx of [-1, 1]) {
    table.add(mesh(new THREE.CylinderGeometry(0.1, 0.12, top.height - 0.08, 10), toon(PALETTE.deskLeg), sx * (top.width / 2 - 0.7), (top.height - 0.08) / 2, 0));
    table.add(mesh(roundedBox(0.9, 0.05, 0.6, 0.05), toon(PALETTE.deskLeg), sx * (top.width / 2 - 0.7), 0.025, 0));
  }
  table.position.set(top.x, 0, top.z);
  group.add(table);
  colliders.push({ minX: top.x - top.width / 2, maxX: top.x + top.width / 2, minZ: top.z - top.depth / 2, maxZ: top.z + top.depth / 2, top: top.height });
  const talk: Interactable = { kind: 'meeting', x: top.x, z: top.z, radius: 2.6 };
  interactables.push(talk);
  table.userData.interact = talk;
  MEETING_SEATS.forEach((def, i) => {
    const view = buildMeetingSeat(def, i);
    group.add(view.group);
    desks.set(def.id, view);
    const at = deskSeat(def, 1.2);
    const it: Interactable = { kind: 'desk', deskId: def.id, x: at.x, z: at.z, radius: 1 };
    interactables.push(it);
    view.group.userData.interact = it;
  });

  // The board on the back wall: the meeting's output file as it's being written.
  const b = MEETING_BOARD;
  const { group: frame, face } = wallBoard(b.width, b.height, '#aab4be');
  frame.position.set(b.x, b.y, b.z);
  frame.rotation.y = Math.PI;
  group.add(frame);
  const read: Interactable = { kind: 'meeting', x: b.x, z: b.z - 1.4, radius: 2.4 };
  interactables.push(read);
  frame.userData.interact = read;

  // The panel on the glass beside the door, like a room-booking screen: what's on, the round, the
  // tokens, and the summary once it's over. Beside the door rather than past it, so the board shows.
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.96), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }));
  sign.position.set((R.minX + R.door.x0) / 2 + 0.01, 1.45, R.minZ - T / 2 - 0.03);
  sign.rotation.y = Math.PI;
  group.add(sign);
  const plate = mesh(roundedBox(0.66, 1.03, 0.03, 0.03), toon(PALETTE.ink), sign.position.x, sign.position.y, R.minZ - T / 2 - 0.012, false);
  group.add(plate);
  const door: Interactable = { kind: 'meeting', x: sign.position.x, z: R.minZ - 1.2, radius: 1.8 };
  interactables.push(door);
  sign.userData.interact = door;
  plate.userData.interact = door;

  // Flat lights set in the loft's floor over the table: a hanging lamp would be in front of the board.
  for (const dx of [-0.95, 0.95]) {
    group.add(mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.04, 20), toon('#fff7d6', { emissive: '#ffe08a' }), top.x + dx, H - 0.02, top.z, false));
    night.halos.push({ at: new THREE.Vector3(top.x + dx, H - 0.08, top.z), size: 0.9, color: '#ffe08a' });
  }
  return { board: face, sign };
}

/** The materials and textures a floor paints in its own colors. */
interface Looks {
  wall: THREE.MeshToonMaterial;
  /** The same color, painted (see wallTexture): for the flat walls, whose uvs are in meters. */
  paint: THREE.MeshToonMaterial;
  trim: THREE.MeshToonMaterial;
  planks: THREE.CanvasTexture[];
}

/**
 * The upstairs office: a loft on posts in the south-east corner, with glass on the two sides that
 * face the desks, reached by stairs along the south wall.
 */
function buildLoft(group: THREE.Group, colliders: Collider[], interactables: Interactable[], looks: Looks): THREE.Mesh {
  const { minX, maxX, minZ, maxZ, y: floorY, height } = LOFT;
  const w = maxX - minX;
  const d = maxZ - minZ;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const roofY = floorY + height;
  const SLAB = 0.25;
  const T = 0.12; // glass wall thickness
  const wallMat = looks.wall;
  const trimMat = looks.trim;
  const frameMat = toon('#ffffff');
  const woodMat = toon(PALETTE.wood);

  // Floor slab, planked like downstairs, with a trim fascia you see from below.
  group.add(mesh(box(w, SLAB, d), trimMat, cx, floorY - SLAB / 2, cz));
  const planks = floorTexture(w, d);
  looks.planks.push(planks);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshToonMaterial({ map: planks, gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, floorY + 0.005, cz);
  floor.receiveShadow = true;
  group.add(floor);
  colliders.push({ minX, maxX, minZ, maxZ, bottom: floorY - SLAB, top: floorY });

  // Posts holding up the open corner.
  for (const x of [minX + 0.15, cx]) {
    group.add(mesh(new THREE.CylinderGeometry(0.12, 0.12, floorY - SLAB, 12), trimMat, x, (floorY - SLAB) / 2, minZ + 0.15));
    colliders.push({ minX: x - 0.14, maxX: x + 0.14, minZ: minZ + 0.01, maxZ: minZ + 0.29, top: floorY - SLAB });
  }

  // The outside walls carry on up behind the loft (buildWalls); the sun shines through them and the roof.
  // The roof runs into them, stopping short of their outside face.
  const into = WALL_T - 0.03;
  const roof = mesh(box(w + into, 0.2, d + into), wallMat, cx + into / 2, roofY + 0.1, cz + into / 2, false);
  group.add(roof);
  group.add(mesh(box(w + 0.02 + into, 0.24, 0.04), trimMat, cx + (into - 0.02) / 2, roofY + 0.1, minZ - 0.02, false));
  group.add(mesh(box(0.04, 0.24, d + 0.02 + into), trimMat, minX - 0.02, roofY + 0.1, cz + (into - 0.02) / 2, false));
  colliders.push({ minX, maxX, minZ, maxZ, bottom: roofY, top: roofY + 0.2 });
  group.add(mesh(box(w, 0.25, 0.04), trimMat, cx, floorY + 0.125, maxZ - 0.02, false));
  group.add(mesh(box(0.04, 0.25, d), trimMat, maxX - 0.02, floorY + 0.125, cz, false));

  // Floor-to-ceiling glass on the north and west sides, so you can look down on everyone working.
  const doorZ = STAIRS.minZ;
  const pane = (len: number, px: number, pz: number, rotY: number) => {
    const g = glassPane(len, height);
    g.position.set(px, floorY + height / 2, pz);
    g.rotation.y = rotY;
    group.add(g);
  };
  const bar = (bw: number, bh: number, bd: number, x: number, y: number, z: number) => group.add(mesh(box(bw, bh, bd), frameMat, x, y, z, false));
  const northZ = minZ + T / 2;
  const westX = minX + T / 2;
  for (let i = 0; i < 6; i++) pane(w / 6, minX + (i + 0.5) * (w / 6), northZ, 0);
  for (let i = 0; i <= 6; i++) bar(0.1, height, T + 0.04, minX + i * (w / 6), floorY + height / 2, northZ);
  bar(w, 0.12, T + 0.06, cx, floorY + 0.06, northZ);
  bar(w, 0.12, T + 0.06, cx, roofY - 0.06, northZ);
  const westLen = doorZ - minZ;
  for (let i = 0; i < 2; i++) pane(westLen / 2, westX, minZ + (i + 0.5) * (westLen / 2), Math.PI / 2);
  for (let i = 0; i <= 2; i++) bar(T + 0.04, height, 0.1, westX, floorY + height / 2, minZ + i * (westLen / 2));
  bar(T + 0.06, 0.12, westLen, westX, floorY + 0.06, minZ + westLen / 2);
  bar(T + 0.06, 0.12, westLen, westX, roofY - 0.06, minZ + westLen / 2);
  colliders.push({ minX, maxX, minZ, maxZ: minZ + T, bottom: floorY, top: 99 });
  colliders.push({ minX, maxX: minX + T, minZ, maxZ: doorZ, bottom: floorY, top: 99 });
  // Over the door at the top of the stairs.
  const doorTop = floorY + 2.3;
  group.add(mesh(box(T + 0.04, roofY - doorTop, maxZ - doorZ), wallMat, westX, (roofY + doorTop) / 2, (doorZ + maxZ) / 2, false));
  colliders.push({ minX, maxX: minX + T, minZ: doorZ, maxZ, bottom: doorTop, top: roofY });

  // Stairs: a solid run of steps up the south wall, wood treads, a handrail on the open side.
  const { fromX, toX, steps } = STAIRS;
  const sw = STAIRS.maxZ - STAIRS.minZ;
  const run = (toX - fromX) / steps;
  const rise = floorY / steps;
  const profile = new THREE.Shape();
  profile.moveTo(0, 0);
  for (let i = 0; i < steps; i++) {
    profile.lineTo(i * run, (i + 1) * rise - 0.04);
    profile.lineTo((i + 1) * run, (i + 1) * rise - 0.04);
  }
  profile.lineTo(toX - fromX, 0);
  profile.closePath();
  const stairs = mesh(new THREE.ExtrudeGeometry(profile, { depth: sw, bevelEnabled: false }), wallMat, fromX, 0, STAIRS.minZ);
  group.add(stairs);
  for (let i = 1; i <= steps; i++) {
    group.add(mesh(box(run + 0.04, 0.06, sw), woodMat, fromX + (i - 0.5) * run - 0.02, i * rise - 0.03, STAIRS.minZ + sw / 2, false));
    colliders.push({ minX: fromX + (i - 1) * run, maxX: fromX + i * run, minZ: STAIRS.minZ, maxZ: STAIRS.maxZ, top: i * rise });
  }
  const railZ = STAIRS.minZ + 0.06;
  const railH = 0.9;
  const inkMat = toon(PALETTE.deskLeg);
  for (let i = 1; i <= steps; i += 2) {
    group.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, railH, 6), inkMat, fromX + (i - 0.5) * run, i * rise + railH / 2, railZ, false));
  }
  const x0 = fromX + 0.5 * run;
  const x1 = fromX + (steps - 0.5) * run;
  const handrail = mesh(box(Math.hypot(x1 - x0, (x1 - x0) * (rise / run)) + 0.1, 0.07, 0.07), woodMat, (x0 + x1) / 2, (rise + floorY) / 2 + railH, railZ, false);
  handrail.rotation.z = Math.atan2(rise, run);
  group.add(handrail);
  // You can't step off the side of the stairs, or climb on from it.
  colliders.push({ minX: fromX, maxX: toX, minZ: STAIRS.minZ - 0.1, maxZ: STAIRS.minZ, top: 99 });

  // Inside: the big desk facing the glass, a comfy couch, a telescope aimed at the desks.
  const deskX = cx + 0.5;
  const deskZ = cz - 0.3;
  const desk = new THREE.Group();
  desk.add(mesh(roundedBox(2.6, 0.1, 1.2, 0.1), woodMat, 0, 0.78, 0));
  desk.add(mesh(box(2.4, 0.66, 0.08), toon('#8a5a3b'), 0, 0.4, -0.5));
  for (const sx of [-1, 1]) desk.add(mesh(box(0.1, 0.72, 1.0), toon('#8a5a3b'), sx * 1.15, 0.37, 0));
  desk.add(mesh(roundedBox(0.9, 0.55, 0.06, 0.03), toon(PALETTE.ink), 0, 1.18, -0.2));
  desk.add(mesh(box(0.08, 0.2, 0.08), toon(PALETTE.ink), 0, 0.93, -0.2));
  // Minesweeper plays on it (ui/arcade.ts).
  const screen = mesh(new THREE.PlaneGeometry(0.8, 0.45), new THREE.MeshBasicMaterial({ color: '#4cc9f0' }), 0, 1.18, -0.165, false);
  desk.add(screen);
  desk.add(mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.12, 10), toon('#ffd166'), 0.9, 0.89, 0.15));
  const plate = textPlane('👑 BOSS', { bg: '#ffd166', size: 48 });
  plate.scale.multiplyScalar(0.55);
  plate.position.set(0, 0.5, -0.55);
  plate.rotation.y = Math.PI;
  desk.add(plate);
  const bossChair = chair('#2b2d42');
  bossChair.scale.setScalar(1.2);
  bossChair.position.set(0, 0, 1.0);
  desk.add(bossChair);
  seatable(bossChair, 'boss-chair', 1.2, interactables);
  // Clicking the screen is using the chair: sit down, then play.
  screen.userData.interact = bossChair.userData.interact;
  desk.position.set(deskX, floorY, deskZ);
  group.add(desk);
  colliders.push({ minX: deskX - 1.3, maxX: deskX + 1.3, minZ: deskZ - 0.6, maxZ: deskZ + 0.6, bottom: floorY, top: floorY + 0.8 });

  const couch = new THREE.Group();
  const couchMat = toon('#ef476f');
  couch.add(mesh(roundedBox(1, 0.45, 2.4, 0.2), couchMat, 0, 0.3, 0));
  couch.add(mesh(roundedBox(0.35, 0.9, 2.4, 0.15), couchMat, 0.45, 0.55, 0));
  for (const sz of [-1, 1]) couch.add(mesh(roundedBox(1, 0.7, 0.3, 0.15), couchMat, 0, 0.45, sz * 1.1));
  couch.add(mesh(roundedBox(0.2, 0.45, 0.5, 0.1), toon('#ffd166'), 0.2, 0.75, 0.4));
  couch.position.set(maxX - 0.65, floorY, cz);
  group.add(couch);
  colliders.push({ minX: maxX - 1.15, maxX, minZ: cz - 1.2, maxZ: cz + 1.2, bottom: floorY, top: floorY + 0.55 });
  seatable(couch, 'loft-couch', 1.8, interactables);

  const rug = mesh(roundedBox(4.6, 0.02, 3.2, 0.6), toon('#caffbf'), deskX - 0.3, floorY + 0.015, cz + 0.1, false);
  group.add(rug);

  const scope = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.1, 6), inkMat, Math.sin(a) * 0.2, 0.52, Math.cos(a) * 0.2);
    leg.rotation.set(Math.cos(a) * -0.35, 0, Math.sin(a) * 0.35);
    scope.add(leg);
  }
  const tube = new THREE.Group();
  const tubeGeo = new THREE.CylinderGeometry(0.1, 0.06, 0.9, 14);
  tubeGeo.rotateX(Math.PI / 2);
  tube.add(mesh(tubeGeo, toon('#ffd166'), 0, 0, 0.1));
  tube.add(mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.08, 14).rotateX(Math.PI / 2), toon(PALETTE.ink), 0, 0, 0.55));
  tube.position.y = 1.08;
  scope.add(tube);
  scope.position.set(minX + 0.9, floorY, minZ + 0.9);
  group.add(scope);
  tube.lookAt(-6, 0.8, 0);
  const telescope: Interactable = { kind: 'telescope', x: scope.position.x, y: floorY, z: scope.position.z, radius: 1.65 };
  scope.userData.interact = telescope;
  interactables.push(telescope);
  colliders.push({ minX: minX + 0.65, maxX: minX + 1.15, minZ: minZ + 0.65, maxZ: minZ + 1.15, bottom: floorY, top: floorY + 1.3 });

  for (const [i, [px, pz, s]] of [
    [maxX - 0.6, minZ + 0.6, 1],
    [maxX - 0.6, maxZ - 0.6, 1.2],
  ].entries()) {
    // Starting past the monstera, which spreads too wide for a corner this tight.
    const p = plant(floorPlant(i + 1), s);
    p.position.set(px, floorY, pz);
    group.add(p);
    const r = 0.3 * s;
    colliders.push({ minX: px - r, maxX: px + r, minZ: pz - r, maxZ: pz + r, bottom: floorY, top: floorY + 0.5 * s });
  }

  const lamp = pendant();
  lamp.position.set(deskX, roofY - 0.4, cz);
  group.add(lamp);

  // Signs: one on the back wall inside, one over the glass for everyone downstairs.
  const inside = textPlane('👑 Boss Office', { bg: '#fffaf3', size: 64 });
  inside.scale.multiplyScalar(0.8);
  inside.position.set(maxX - 3, floorY + 1.9, maxZ - 0.04);
  inside.rotation.y = Math.PI;
  group.add(inside);
  const outside = textPlane('👑 Boss Office', { bg: '#2b2d42', color: '#fffaf3', size: 64, border: '#fffaf3' });
  outside.scale.multiplyScalar(1.4);
  outside.position.set(cx, roofY + 0.2, minZ - 0.02);
  outside.rotation.y = Math.PI;
  group.add(outside);
  return screen;
}
