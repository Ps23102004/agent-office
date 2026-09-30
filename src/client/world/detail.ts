// The small stuff that makes the office look lived in, drawn cheaply: soft contact shadows under
// things (the sun's shadow map skips small ones, see tinyForShadow), pictures for the walls painted on
// one sheet, and blinds. Everything static is merged so that all of it is a handful of draw calls.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toon } from './toon';

// ---- Contact shadows ----------------------------------------------------------------------------

let blobTex: THREE.CanvasTexture | null = null;
let blobMat: THREE.MeshBasicMaterial | null = null;
let blobGeo: THREE.BufferGeometry | null = null;

/** A soft dark spot that fades out to nothing at its edge. */
function blobTexture(): THREE.CanvasTexture {
  if (blobTex) return blobTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grad.addColorStop(0, 'rgba(20, 14, 30, 1)');
  grad.addColorStop(0.55, 'rgba(20, 14, 30, 0.55)');
  grad.addColorStop(1, 'rgba(20, 14, 30, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  blobTex = new THREE.CanvasTexture(c);
  return blobTex;
}

/** Every contact shadow shares this: not lit (it's a darkening, not a surface) and left out of the cartoon outline pass. */
function blobMaterial(): THREE.MeshBasicMaterial {
  if (blobMat) return blobMat;
  blobMat = new THREE.MeshBasicMaterial({ map: blobTexture(), vertexColors: true, transparent: true, opacity: 0.42, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  blobMat.userData.outlineParameters = { visible: false };
  return blobMat;
}

/** A unit square lying flat, with each vertex's alpha in its color (1 here: `alpha` scales it). */
function blobQuad(alpha: number): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const n = geo.attributes.position.count;
  const rgba = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) rgba.set([1, 1, 1, alpha], i * 4);
  geo.setAttribute('color', new THREE.BufferAttribute(rgba, 4));
  return geo;
}

/** A spot on the floor: its center, size (`w` along its own x, `d` along z), the turn it's had and how dark it is (0-1). */
export type Blob = [x: number, z: number, w: number, d: number, rotY?: number, alpha?: number];

/** All the spots in one mesh, `y` above the floor (over the rugs, which are 2 cm thick). */
export function blobShadows(spots: Blob[], y = 0.024): THREE.Mesh {
  const geos = spots.map(([x, z, w, d, rot = 0, alpha = 1]) => {
    const g = blobQuad(alpha);
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot), new THREE.Vector3(w, 1, d)));
    return g;
  });
  const mesh = new THREE.Mesh(mergeGeometries(geos)!, blobMaterial());
  mesh.renderOrder = 1;
  mesh.userData.blob = true;
  for (const g of geos) g.dispose();
  return mesh;
}

/** A spot that goes wherever its parent does (a person, a dog), `size` meters across. */
export function followShadow(size: number, y = 0.03): THREE.Mesh {
  blobGeo ??= blobQuad(1);
  const m = new THREE.Mesh(blobGeo, blobMaterial());
  m.scale.set(size, 1, size);
  m.position.y = y;
  m.renderOrder = 1;
  return m;
}

// ---- Pictures -----------------------------------------------------------------------------------

/** Pictures on the sheet: 4 across, 2 down, each this many pixels square. */
const CELL = 256;
export const ART_COUNT = 8;

/** The same picture every time: a small, fixed sequence of "random". */
function seeded(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** Abstract pictures, no words or logos in any of them. Each is drawn into (0, 0) - (CELL, CELL). */
const PAINT: ((g: CanvasRenderingContext2D, r: () => number) => void)[] = [
  // Sunset over hills.
  (g) => {
    const sky = g.createLinearGradient(0, 0, 0, CELL);
    sky.addColorStop(0, '#ffb997');
    sky.addColorStop(1, '#f67e7d');
    g.fillStyle = sky;
    g.fillRect(0, 0, CELL, CELL);
    g.fillStyle = '#ffe8a3';
    g.beginPath();
    g.arc(140, 120, 46, 0, Math.PI * 2);
    g.fill();
    ['#843b62', '#621940', '#3c1642'].forEach((c, i) => {
      g.fillStyle = c;
      g.beginPath();
      g.moveTo(0, CELL);
      for (let x = 0; x <= CELL; x += 8) g.lineTo(x, 150 + i * 32 + Math.sin(x / 40 + i * 2) * 18);
      g.lineTo(CELL, CELL);
      g.fill();
    });
  },
  // Arches and circles.
  (g) => {
    g.fillStyle = '#f4ead5';
    g.fillRect(0, 0, CELL, CELL);
    g.fillStyle = '#e07a5f';
    g.beginPath();
    g.arc(90, 150, 60, Math.PI, 0);
    g.fillRect(30, 150, 120, 80);
    g.fill();
    g.fillStyle = '#81b29a';
    g.beginPath();
    g.arc(180, 90, 42, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#f2cc8f';
    g.beginPath();
    g.arc(170, 190, 34, Math.PI, 0);
    g.fillRect(136, 190, 68, 40);
    g.fill();
    g.fillStyle = '#3d405b';
    g.fillRect(24, 226, 208, 6);
  },
  // Waves.
  (g) => {
    g.fillStyle = '#22355b';
    g.fillRect(0, 0, CELL, CELL);
    ['#3e6fa8', '#5aa0c8', '#8fd0e0', '#d8f3f0', '#f4ead5'].forEach((c, i) => {
      g.strokeStyle = c;
      g.lineWidth = 12;
      g.beginPath();
      for (let x = -4; x <= CELL + 4; x += 6) g.lineTo(x, 60 + i * 34 + Math.sin(x / 26 + i) * 14);
      g.stroke();
    });
  },
  // Rainbow arcs.
  (g) => {
    g.fillStyle = '#fbf3e4';
    g.fillRect(0, 0, CELL, CELL);
    ['#e76f51', '#f4a261', '#e9c46a', '#2a9d8f', '#457b9d', '#6d597a'].forEach((c, i) => {
      g.fillStyle = c;
      g.beginPath();
      g.arc(CELL / 2, 210, 120 - i * 18, Math.PI, 0);
      g.fill();
    });
    g.fillStyle = '#fbf3e4';
    g.beginPath();
    g.arc(CELL / 2, 210, 12, Math.PI, 0);
    g.fill();
  },
  // Blocks of color between black lines.
  (g) => {
    g.fillStyle = '#f7f4ec';
    g.fillRect(0, 0, CELL, CELL);
    g.fillStyle = '#d64545';
    g.fillRect(0, 0, 96, 110);
    g.fillStyle = '#2f5fa8';
    g.fillRect(170, 150, 86, 106);
    g.fillStyle = '#f0c93b';
    g.fillRect(96, 200, 74, 56);
    g.fillStyle = '#1d1d1d';
    for (const x of [96, 170]) g.fillRect(x - 3, 0, 6, CELL);
    for (const y of [110, 150, 200]) g.fillRect(0, y - 3, CELL, 6);
  },
  // Leaves.
  (g, r) => {
    g.fillStyle = '#f0e6d2';
    g.fillRect(0, 0, CELL, CELL);
    const greens = ['#2d6a4f', '#40916c', '#74c69d', '#95d5b2'];
    for (let i = 0; i < 9; i++) {
      const x = 30 + r() * 196;
      const y = 40 + r() * 180;
      g.save();
      g.translate(x, y);
      g.rotate(-0.6 + r() * 1.2 + (i % 2 ? Math.PI : 0));
      g.fillStyle = greens[i % 4];
      g.beginPath();
      g.ellipse(0, -34, 16, 40, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#1b4332';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(0, 6);
      g.lineTo(0, -70);
      g.stroke();
      g.restore();
    }
  },
  // Polka dots.
  (g, r) => {
    g.fillStyle = '#ef8354';
    g.fillRect(0, 0, CELL, CELL);
    g.fillStyle = '#fff1e0';
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        g.beginPath();
        g.arc(28 + x * 50 + (y % 2) * 12, 28 + y * 50, 8 + r() * 14, 0, Math.PI * 2);
        g.fill();
      }
    }
  },
  // Mountains over a lake.
  (g) => {
    const sky = g.createLinearGradient(0, 0, 0, CELL);
    sky.addColorStop(0, '#5f6caf');
    sky.addColorStop(0.6, '#f7b7a3');
    sky.addColorStop(1, '#ffe0c2');
    g.fillStyle = sky;
    g.fillRect(0, 0, CELL, CELL);
    const peak = (x: number, top: number, half: number, c: string) => {
      g.fillStyle = c;
      g.beginPath();
      g.moveTo(x - half, 150);
      g.lineTo(x, top);
      g.lineTo(x + half, 150);
      g.fill();
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.moveTo(x - half * 0.28, top + (150 - top) * 0.28);
      g.lineTo(x, top);
      g.lineTo(x + half * 0.28, top + (150 - top) * 0.28);
      g.fill();
    };
    peak(70, 70, 90, '#4a4e79');
    peak(170, 50, 100, '#39406a');
    g.fillStyle = '#7fa6c9';
    g.fillRect(0, 150, CELL, CELL - 150);
    g.fillStyle = 'rgba(255,255,255,0.25)';
    for (let i = 0; i < 6; i++) g.fillRect(30 + i * 30, 170 + i * 12, 60 - i * 6, 3);
  },
];

let atlas: THREE.CanvasTexture | null = null;

/** The pictures' sheet, painted the first time it's asked for. */
function artSheet(): THREE.CanvasTexture {
  if (atlas) return atlas;
  const c = document.createElement('canvas');
  c.width = CELL * 4;
  c.height = CELL * 2;
  const g = c.getContext('2d')!;
  PAINT.forEach((paint, i) => {
    g.save();
    g.translate((i % 4) * CELL, Math.floor(i / 4) * CELL);
    g.beginPath();
    g.rect(0, 0, CELL, CELL);
    g.clip();
    paint(g, seeded(11 + i * 7));
    g.restore();
  });
  atlas = new THREE.CanvasTexture(c);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = 4;
  return atlas;
}

/** A flat rectangle standing in the world (its own +z is the way it faces), with `uv` its corners on a sheet. */
function panel(w: number, h: number, at: THREE.Matrix4, uv?: [u0: number, v0: number, u1: number, v1: number]): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h);
  if (uv) {
    const t = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < t.count; i++) t.setXY(i, uv[0] + t.getX(i) * (uv[2] - uv[0]), uv[1] + t.getY(i) * (uv[3] - uv[1]));
  }
  return g.applyMatrix4(at);
}

/** Where something hung on a wall goes: `out` from the wall's face, turned to face `rotY`. */
export function onWallAt(x: number, y: number, z: number, rotY: number, out: number): THREE.Matrix4 {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
  const p = new THREE.Vector3(0, 0, out).applyQuaternion(q).add(new THREE.Vector3(x, y, z));
  return new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1));
}

export interface ArtItem {
  x: number;
  y: number;
  z: number;
  rotY: number;
  w: number;
  h: number;
  /** Which picture (0 to ART_COUNT - 1), and its frame's color. */
  art: number;
  frame: string;
}

/** The framed pictures, as two meshes: the frames (one color per vertex) and the pictures (one sheet). */
export function wallArt(items: ArtItem[]): THREE.Group {
  const out = new THREE.Group();
  const B = 0.07;
  const frames: THREE.BufferGeometry[] = [];
  const pics: THREE.BufferGeometry[] = [];
  const mat = new THREE.Matrix4();
  for (const it of items) {
    // A frame with a white mount round the picture, standing 6 cm off the wall.
    const box = (w: number, h: number, d: number, out: number, color: string) => {
      const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
      g.deleteAttribute('uv');
      g.applyMatrix4(onWallAt(it.x, it.y, it.z, it.rotY, out));
      const c = new THREE.Color(color);
      const n = g.attributes.position.count;
      const rgb = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) c.toArray(rgb, i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
      frames.push(g);
    };
    box(it.w + 2 * B, it.h + 2 * B, 0.05, 0.03, it.frame);
    box(it.w + 0.05, it.h + 0.05, 0.02, 0.05, '#fffaf0');
    const col = it.art % 4;
    const row = Math.floor(it.art / 4);
    // Sheet rows count up from the bottom.
    pics.push(panel(it.w, it.h, mat.copy(onWallAt(it.x, it.y, it.z, it.rotY, 0.062)), [col / 4, 1 - (row + 1) / 2, (col + 1) / 4, 1 - row / 2]));
  }
  const frameMesh = new THREE.Mesh(mergeGeometries(frames)!, new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap }));
  frameMesh.receiveShadow = true;
  const picMesh = new THREE.Mesh(mergeGeometries(pics)!, new THREE.MeshToonMaterial({ map: artSheet(), gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap }));
  picMesh.receiveShadow = true;
  out.add(frameMesh, picMesh);
  for (const g of [...frames, ...pics]) g.dispose();
  return out;
}

// ---- Blinds -------------------------------------------------------------------------------------

let blindTex: THREE.CanvasTexture | null = null;

/** Slats: a light one, a shaded one under it, over and over. */
function blindTexture(): THREE.CanvasTexture {
  if (blindTex) return blindTex;
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 32;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f6f1e7';
  g.fillRect(0, 0, 32, 32);
  const shade = g.createLinearGradient(0, 0, 0, 32);
  shade.addColorStop(0, 'rgba(120, 100, 80, 0)');
  shade.addColorStop(0.8, 'rgba(120, 100, 80, 0.28)');
  shade.addColorStop(1, 'rgba(90, 70, 50, 0.55)');
  g.fillStyle = shade;
  g.fillRect(0, 0, 32, 32);
  blindTex = new THREE.CanvasTexture(c);
  blindTex.colorSpace = THREE.SRGBColorSpace;
  blindTex.wrapS = blindTex.wrapT = THREE.RepeatWrapping;
  return blindTex;
}

export interface BlindItem {
  x: number;
  y: number;
  z: number;
  rotY: number;
  /** Width, and how far down from `y` (the window's top inside) it hangs. */
  w: number;
  drop: number;
}

/** Every window's blind in one mesh, hanging `drop` down from the top of the window. */
export function blinds(items: BlindItem[]): THREE.Mesh {
  const SLAT = 0.055;
  const geos = items.map((b) => {
    const g = panel(b.w, b.drop, onWallAt(b.x, b.y - b.drop / 2, b.z, b.rotY, 0));
    const t = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < t.count; i++) t.setY(i, (t.getY(i) * b.drop) / SLAT);
    return g;
  });
  const m = new THREE.Mesh(mergeGeometries(geos)!, new THREE.MeshToonMaterial({ map: blindTexture(), side: THREE.DoubleSide, gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap }));
  m.receiveShadow = true;
  for (const g of geos) g.dispose();
  return m;
}
