import * as THREE from 'three';
import { rng } from '../../shared/city';
import { gradientMap } from './toon';

// What the ground and the walls are made of, up close: the grain of asphalt and concrete, clumps in
// the grass, pebbles in gravel, stains and weathering. It's one small tile of noise (detailPixels),
// made here rather than downloaded, that sky.ts's lines on every lit material read in world space
// (so it needs no UVs, and merged meshes get it too): the ground in plan, walls in their own plane.
// A material asks for it with detail(material, grain), which says how much of each channel it
// takes and at what size. Centred on mid grey, so far off (its smallest mipmaps) it fades to the
// material's own color, and the toon look stays the toon look. Also the decals (decalAtlas): manhole
// covers, drains, cracks and patches on the city's roads, skid marks and grid numbers on the circuit,
// shipping lines' names on the arena's containers.

/**
 * How each surface takes the noise: `tile` metres to a repeat of it, how much of each channel
 * (r: fine grain, g: grass, b: pebbles, a: stains) and of the stains at large (`macro`), and the
 * extras sky.ts draws for it (SKY_DETAIL_<name>):
 * AUTO: one texture of several grounds (the city's): asphalt where it's dark, grass where it's green, else paving.
 * STRIPES: mown stripes this wide (m). JOINTS: slabs or panels this big (m), with dark joints between.
 * RIBS: a container's corrugations this far apart (m). RUST: how much rust. STREAKS: rain streaks down walls.
 * DIRT: grime at the foot of a wall, over the street. SHINGLES: rows of roof tiles this high (m).
 */
const GRAINS = {
  asphalt: { tile: 3, mix: [0.34, 0, 0.07, 0], macro: 0.22 },
  /** A run-off area's paler, smoother asphalt. */
  runoff: { tile: 3, mix: [0.22, 0, 0.04, 0], macro: 0.16 },
  concrete: { tile: 4, mix: [0.18, 0, 0.03, 0], macro: 0.24 },
  /** Concrete laid in slabs: a yard, a paddock. */
  slab: { tile: 4, mix: [0.2, 0, 0.03, 0], macro: 0.26, with: { JOINTS: 6 } },
  grass: { tile: 2.5, mix: [0.04, 0.44, 0, 0], macro: 0.26 },
  /** Grass mown in stripes. */
  lawn: { tile: 2.5, mix: [0.04, 0.4, 0, 0], macro: 0.2, with: { STRIPES: 12 } },
  gravel: { tile: 1.6, mix: [0.1, 0, 0.55, 0], macro: 0.1 },
  ground: { tile: 3, mix: [0, 0, 0, 0], macro: 0.2, with: { AUTO: 1 } },
  wall: { tile: 5, mix: [0.07, 0, 0, 0], macro: 0.16, with: { STREAKS: 0.12, DIRT: 0.16 } },
  /** Precast concrete panels. */
  panels: { tile: 4, mix: [0.16, 0, 0, 0], macro: 0.2, with: { JOINTS: 4, STREAKS: 0.16 } },
  /** A flat roof: gravel, and the weather on it. */
  roof: { tile: 2, mix: [0.12, 0, 0.3, 0], macro: 0.28 },
  shingles: { tile: 2, mix: [0.08, 0, 0.12, 0], macro: 0.2, with: { SHINGLES: 0.24 } },
  container: { tile: 3, mix: [0.05, 0, 0, 0], macro: 0.1, with: { RIBS: 0.3, RUST: 0.55, STREAKS: 0.12 } },
} as const satisfies Record<string, { tile: number; mix: readonly number[]; macro: number; with?: Record<string, number> }>;
export type Grain = keyof typeof GRAINS;

/** `m` with the surface `grain` on it (see GRAINS): `m` back, for chaining. Part of its shader's key, so give each grain its own material. */
export function detail<M extends THREE.Material>(m: M, grain: Grain): M {
  const g: { tile: number; mix: readonly number[]; macro: number; with?: Record<string, number> } = GRAINS[grain];
  const defines: Record<string, string> = {
    ...(m as { defines?: Record<string, string> }).defines,
    SKY_DETAIL: '',
    SKY_DETAIL_FREQ: (1 / g.tile).toFixed(4),
    SKY_DETAIL_MIX: `vec4( ${g.mix.map((k) => k.toFixed(3)).join(', ')} )`,
    SKY_DETAIL_MACRO: g.macro.toFixed(3),
  };
  for (const [k, v] of Object.entries(g.with ?? {})) defines[`SKY_DETAIL_${k}`] = v.toFixed(3);
  (m as { defines?: Record<string, string> }).defines = defines;
  return m;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * Value noise over a `size`-pixel square that wraps every `cells` cells (so the tile is seamless),
 * for octaves of [cells, weight], added into `out` (centred on 0).
 */
function noise(out: Float32Array, size: number, octaves: readonly (readonly [number, number])[], r: () => number) {
  for (const [cells, weight] of octaves) {
    const lat = new Float32Array(cells * cells);
    for (let i = 0; i < lat.length; i++) lat[i] = r() - 0.5;
    const k = cells / size;
    for (let y = 0; y < size; y++) {
      const fy = y * k;
      const y0 = Math.floor(fy);
      const ty = smooth(fy - y0);
      const j0 = (y0 % cells) * cells;
      const j1 = ((y0 + 1) % cells) * cells;
      for (let x = 0; x < size; x++) {
        const fx = x * k;
        const x0 = Math.floor(fx);
        const tx = smooth(fx - x0);
        const i0 = x0 % cells;
        const i1 = (x0 + 1) % cells;
        const a = lat[j0 + i0], b = lat[j0 + i1], c = lat[j1 + i0], d = lat[j1 + i1];
        out[y * size + x] += (a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty) * weight;
      }
    }
  }
}

/** A disc of `v` at (cx, cy), radius `rad` pixels, wrapping round the tile's edges; darker on its lower right, as if lit from the top left. */
function pebble(out: Float32Array, size: number, cx: number, cy: number, rad: number, v: number) {
  const r2 = rad * rad;
  for (let dy = -Math.ceil(rad); dy <= Math.ceil(rad); dy++) {
    for (let dx = -Math.ceil(rad); dx <= Math.ceil(rad); dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const shade = ((dx + dy) / (rad * 2)) * 0.18;
      const x = (((Math.round(cx) + dx) % size) + size) % size;
      const y = (((Math.round(cy) + dy) % size) + size) % size;
      out[y * size + x] = v - shade - (d2 > r2 * 0.6 ? 0.06 : 0);
    }
  }
}

/**
 * The detail tile's pixels, RGBA, `size` a side (a power of two): r the fine grain of asphalt and
 * concrete (aggregate, light and dark specks), g grass (clumps and blades), b pebbles, a stains and
 * weathering at large. Each centred on 128. The same every time (seeded), and seamless.
 */
export function detailPixels(size: number): Uint8Array {
  const r = rng(20261001);
  const px = size * size;
  const at = size / 512;
  const ch = [0, 1, 2, 3].map(() => new Float32Array(px));
  const [grain, grass, stones, stain] = ch;
  // Fine grain: three octaves, a speckle a pixel, and the odd light chip and dark pit.
  noise(grain, size, [[8, 0.2], [32, 0.22], [128, 0.26]], r);
  for (let i = 0; i < px; i++) {
    grain[i] += (r() - 0.5) * 0.24;
    const k = r();
    if (k < 0.014) grain[i] += 0.32;
    else if (k < 0.026) grain[i] -= 0.3;
  }
  // Grass: clumps, and blades lighter and darker a pixel or two at a time.
  noise(grass, size, [[16, 0.22], [64, 0.3], [256, 0.18]], r);
  for (let i = 0; i < px; i++) {
    grass[i] += (r() - 0.5) * 0.3;
    const k = r();
    if (k < 0.03) grass[i] -= 0.28;
    else if (k < 0.05) grass[i] += 0.24;
  }
  // Pebbles packed on a dark bed.
  noise(stones, size, [[64, 0.12]], r);
  for (let i = 0; i < px; i++) stones[i] -= 0.22;
  const n = Math.round(6500 * at * at);
  for (let k = 0; k < n; k++) pebble(stones, size, r() * size, r() * size, (1.4 + r() * 3.6) * at + 0.4, (r() - 0.5) * 0.6 + 0.08);
  // Stains: big soft blotches.
  noise(stain, size, [[4, 0.42], [8, 0.3], [16, 0.16], [64, 0.06]], r);
  const out = new Uint8Array(px * 4);
  ch.forEach((c, j) => {
    let mean = 0;
    for (let i = 0; i < px; i++) mean += c[i];
    mean /= px;
    for (let i = 0; i < px; i++) out[i * 4 + j] = Math.max(0, Math.min(255, Math.round(128 + (c[i] - mean) * 255)));
  });
  return out;
}

/** The detail tile as a texture, `size` a side: repeating, mipmapped, and data rather than color. */
export function detailTexture(size: number, anisotropy: number): THREE.DataTexture {
  const t = new THREE.DataTexture(detailPixels(size), size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = anisotropy;
  t.needsUpdate = true;
  return t;
}

// ---- Decals -------------------------------------------------------------------------------------

/** The decal atlas is CELLS × CELLS cells, each CELL pixels a side. */
const CELL = 64;
const CELLS = 8;
/** Where each decal is in the atlas: [column, row, cells across, cells down] (row 0 at the top). */
export const DECALS = {
  manhole: [0, 0, 1, 1],
  drain: [1, 0, 1, 1],
  patch: [2, 0, 1, 1],
  crack: [3, 0, 1, 1],
  oil: [4, 0, 1, 1],
  /** Seamless top to bottom, for laying end to end. */
  skid: [5, 0, 1, 1],
  /** Grid numbers 1 to 8: digit n is at column n - 1. */
  digit: [0, 1, 1, 1],
  pit: [0, 2, 4, 1],
  limit: [4, 2, 1, 1],
  /** A plate a container carries by its doors. */
  plate: [5, 2, 1, 1],
  /** Shipping lines' names, one in each of rows 3 to 6 (fictional), with their owner codes in the last cells of rows 3 to 6. */
  line: [0, 3, 6, 1],
  code: [6, 3, 2, 1],
} as const satisfies Record<string, readonly [number, number, number, number]>;
export type Decal = keyof typeof DECALS;
/** The shipping lines on the containers. */
const LINES: [name: string, ink: string, code: string][] = [
  ['ZOOMLINE', '#f8f9fa', 'ZMLU 418273 6'],
  ['OKAPI', '#ffd166', 'OKPU 902614 1'],
  ['NORDWAVE', '#f8f9fa', 'NWVU 330158 9'],
  ['TUNA-LINK', '#f1faee', 'TNLU 775201 4'],
];
export const LINE_COUNT = LINES.length;

/** UVs [u0, v0, u1, v1] of `decal` in the atlas (`k`: which digit, or which shipping line). */
export function decalUV(decal: Decal, k = 0): [number, number, number, number] {
  const [c, row, w, h] = DECALS[decal];
  const col = decal === 'digit' ? c + k : c;
  const r = decal === 'line' || decal === 'code' ? row + k : row;
  // Half a pixel in, so a cell never bleeds into its neighbour.
  const e = 0.5 / (CELL * CELLS);
  return [col / CELLS + e, 1 - (r + h) / CELLS + e, (col + w) / CELLS - e, 1 - r / CELLS - e];
}

let atlas: THREE.CanvasTexture | null = null;
/** Every decal on one canvas, on a clear background (sRGB color, alpha for its edges). */
export function decalAtlas(): THREE.CanvasTexture {
  if (atlas) return atlas;
  const S = CELL * CELLS;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const r = rng(424242);
  const cell = (d: Decal, k = 0) => {
    const [col, row, w, h] = DECALS[d];
    return { x: (d === 'digit' ? col + k : col) * CELL, y: (d === 'line' || d === 'code' ? row + k : row) * CELL, w: w * CELL, h: h * CELL };
  };
  // A manhole cover: an iron disc in its frame, with a cross-hatch.
  {
    const { x, y } = cell('manhole');
    const m = CELL / 2;
    g.fillStyle = '#5b5f68';
    g.beginPath();
    g.arc(x + m, y + m, 30, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#3c3f46';
    g.beginPath();
    g.arc(x + m, y + m, 26, 0, Math.PI * 2);
    g.fill();
    g.save();
    g.clip();
    g.strokeStyle = 'rgba(120,124,134,0.75)';
    g.lineWidth = 2;
    for (let k = -30; k <= 30; k += 6) {
      g.beginPath();
      g.moveTo(x + m + k - 30, y + m - 30);
      g.lineTo(x + m + k + 30, y + m + 30);
      g.moveTo(x + m + k + 30, y + m - 30);
      g.lineTo(x + m + k - 30, y + m + 30);
      g.stroke();
    }
    g.restore();
    g.strokeStyle = '#2a2c31';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(x + m, y + m, 26, 0, Math.PI * 2);
    g.stroke();
  }
  // A storm drain: a grate of bars in a frame.
  {
    const { x, y } = cell('drain');
    g.fillStyle = '#6c7079';
    g.fillRect(x + 4, y + 14, 56, 36);
    g.fillStyle = '#1f2126';
    for (let k = 0; k < 9; k++) g.fillRect(x + 9 + k * 5.6, y + 19, 3, 26);
  }
  // A patch: a darker, newer rectangle of asphalt with a sealed edge.
  {
    const { x, y } = cell('patch');
    g.fillStyle = 'rgba(28,30,36,0.55)';
    g.fillRect(x + 4, y + 6, 56, 52);
    g.strokeStyle = 'rgba(16,17,20,0.6)';
    g.lineWidth = 2;
    g.strokeRect(x + 4, y + 6, 56, 52);
  }
  // A crack, branching.
  {
    const { x, y } = cell('crack');
    g.strokeStyle = 'rgba(14,15,18,0.8)';
    g.lineCap = 'round';
    const branch = (px: number, py: number, a: number, len: number, w: number) => {
      g.lineWidth = w;
      g.beginPath();
      g.moveTo(px, py);
      for (let k = 0; k < len; k++) {
        a += (r() - 0.5) * 0.9;
        px += Math.cos(a) * 4;
        py += Math.sin(a) * 4;
        g.lineTo(px, py);
        if (w > 1 && r() < 0.18) {
          g.stroke();
          branch(px, py, a + (r() < 0.5 ? 1 : -1) * 0.9, len - k - 2, w * 0.6);
          g.lineWidth = w;
          g.beginPath();
          g.moveTo(px, py);
        }
      }
      g.stroke();
    };
    branch(x + 6, y + 30, 0.1, 13, 2);
  }
  // An oil stain: a soft dark blot.
  {
    const { x, y } = cell('oil');
    const grad = g.createRadialGradient(x + 32, y + 32, 2, x + 32, y + 32, 30);
    grad.addColorStop(0, 'rgba(10,10,14,0.55)');
    grad.addColorStop(0.6, 'rgba(10,10,14,0.3)');
    grad.addColorStop(1, 'rgba(10,10,14,0)');
    g.fillStyle = grad;
    g.fillRect(x, y, CELL, CELL);
  }
  // Skid marks: a tyre's black streak, wavering, as dark again where it's been laid twice. Seamless top to bottom.
  {
    const { x, y } = cell('skid');
    for (let row = 0; row < CELL; row++) {
      const k = 0.55 + 0.25 * Math.sin((row / CELL) * Math.PI * 2 * 3) + 0.2 * Math.sin((row / CELL) * Math.PI * 2 * 7);
      g.fillStyle = `rgba(12,12,14,${(0.35 + 0.35 * k).toFixed(3)})`;
      g.fillRect(x + 8, y + row, CELL - 16, 1);
      g.fillStyle = 'rgba(12,12,14,0.25)';
      g.fillRect(x + 2, y + row, 6, 1);
      g.fillRect(x + CELL - 8, y + row, 6, 1);
    }
  }
  // Grid numbers.
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let k = 0; k < 8; k++) {
    const { x, y } = cell('digit', k);
    g.fillStyle = '#f8f9fa';
    g.font = `900 52px system-ui, sans-serif`;
    g.fillText(String(k + 1), x + 32, y + 35);
  }
  // PIT LANE, and its speed limit.
  {
    const { x, y, w } = cell('pit');
    g.fillStyle = '#f8f9fa';
    g.font = '900 44px system-ui, sans-serif';
    g.fillText('PIT LANE', x + w / 2, y + 34);
    const l = cell('limit');
    g.fillStyle = '#f8f9fa';
    g.beginPath();
    g.arc(l.x + 32, l.y + 32, 30, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#e63946';
    g.beginPath();
    g.arc(l.x + 32, l.y + 32, 30, 0, Math.PI * 2);
    g.arc(l.x + 32, l.y + 32, 23, 0, Math.PI * 2, true);
    g.fill();
    g.fillStyle = '#212529';
    g.font = '900 26px system-ui, sans-serif';
    g.fillText('60', l.x + 32, l.y + 34);
  }
  // A container's safety-approval plate.
  {
    const { x, y } = cell('plate');
    g.fillStyle = '#d8dadd';
    g.fillRect(x + 6, y + 14, 52, 36);
    g.fillStyle = '#495057';
    for (let k = 0; k < 5; k++) g.fillRect(x + 10, y + 19 + k * 6, k ? 30 + ((k * 7) % 14) : 22, 2);
  }
  // Shipping lines: a name in big letters, a wave under it; their owner codes.
  LINES.forEach(([name, ink, code], k) => {
    const n = cell('line', k);
    g.fillStyle = ink;
    g.font = `900 40px system-ui, sans-serif`;
    g.fillText(name, n.x + n.w / 2, n.y + 28);
    g.fillRect(n.x + n.w * 0.2, n.y + 52, n.w * 0.6, 4);
    const cd = cell('code', k);
    g.fillStyle = '#f8f9fa';
    g.font = '800 17px ui-monospace, monospace';
    g.fillText(code, cd.x + cd.w / 2, cd.y + 22);
    g.font = '700 13px ui-monospace, monospace';
    g.fillText('45G1', cd.x + cd.w / 2, cd.y + 44);
  });
  atlas = new THREE.CanvasTexture(c);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = 4;
  return atlas;
}

/**
 * Quads lying on the ground or on walls, piling up to be one mesh of decals: each takes a cell of
 * the atlas. Drawn over what they lie on (polygonOffset), blended at their edges, never casting a shadow.
 */
export class Decals {
  private pos: number[] = [];
  private uv: number[] = [];
  private norm: number[] = [];

  /**
   * A decal lying flat at (x, y, z), `w` across and `l` long, its length turned `rotY` (0: along z):
   * its top toward rotY, so it reads the right way round to someone heading that way.
   */
  flat(uv: readonly number[], x: number, y: number, z: number, w: number, l: number, rotY = 0) {
    const c = Math.cos(rotY), s = Math.sin(rotY);
    // Along is (s, c); across, to the right of someone heading along, is (-c, s) (garage.ts: +x is a driver's left).
    const p = (a: number, b: number): [number, number, number] => [x - a * c + b * s, y, z + a * s + b * c];
    this.quad(p(-w / 2, -l / 2), p(w / 2, -l / 2), p(w / 2, l / 2), p(-w / 2, l / 2), uv, [0, 1, 0]);
  }

  /** A decal on a wall facing `n` (horizontal), centred at (x, y, z), `w` across and `h` high. */
  wall(uv: readonly number[], x: number, y: number, z: number, w: number, h: number, n: readonly [number, number]) {
    // Across, seen from in front: the wall's right.
    const ax = n[1], az = -n[0];
    const p = (a: number, b: number): [number, number, number] => [x + ax * a, y + b, z + az * a];
    this.quad(p(-w / 2, -h / 2), p(w / 2, -h / 2), p(w / 2, h / 2), p(-w / 2, h / 2), uv, [n[0], 0, n[1]]);
  }

  /** A quad a, b, c, d round its edge, facing `n`, from `uv` [u0, v0, u1, v1]: a gets (u0, v0), c (u1, v1). */
  quad(a: number[], b: number[], c: number[], d: number[], uv: readonly number[], n: readonly number[]) {
    const [u0, v0, u1, v1] = uv;
    // Wound so it faces `n`, whichever way round the corners came.
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const facing = (e1[1] * e2[2] - e1[2] * e2[1]) * n[0] + (e1[2] * e2[0] - e1[0] * e2[2]) * n[1] + (e1[0] * e2[1] - e1[1] * e2[0]) * n[2] >= 0;
    const tris = [[a, u0, v0], [b, u1, v0], [c, u1, v1], [a, u0, v0], [c, u1, v1], [d, u0, v1]] as const;
    for (const [p, u, v] of facing ? tris : [tris[0], tris[2], tris[1], tris[3], tris[5], tris[4]]) {
      this.pos.push(p[0], p[1], p[2]);
      this.uv.push(u, v);
      this.norm.push(n[0], n[1], n[2]);
    }
  }

  get empty(): boolean {
    return !this.pos.length;
  }

  mesh(): THREE.Mesh {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.norm, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, decalMaterial());
    m.receiveShadow = true;
    m.castShadow = false;
    return m;
  }
}

let decalMat: THREE.MeshToonMaterial | null = null;
/** The decals' one material: the atlas, lit like the ground under it, over it in the depth test. */
function decalMaterial(): THREE.MeshToonMaterial {
  if (decalMat) return decalMat;
  decalMat = new THREE.MeshToonMaterial({ map: decalAtlas(), gradientMap: gradientMap(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  decalMat.userData.outlineParameters = { visible: false };
  return decalMat;
}
