import * as THREE from 'three';
import { ARENA_BOXES, ARENA_CENTER, ARENA_GATE, ARENA_HALF, CITY_ARENA_GATE, WALL_H, type ArenaBox, type V3 } from '../../shared/arena';
import { RUNWAY_ARENA } from '../../shared/city';
import { gate, pulse } from './circuit';
import type { Collider, Interactable } from './office';
import { mergeColored, mesh, toon } from './toon';

// The arena (shared/arena.ts), drawn: a concrete container yard inside high walls striped yellow and
// black at the top, shipping containers in four paints with their ribs and doors, wooden crates,
// concrete barriers, floodlight masts in the corners, and stacks of containers outside the walls to
// look at. All of it merged into a couple of draw calls. Also the shots (tracers, sparks), the
// rifle you hold and the ones everyone else holds, and the arena's gate on the race plaza in the city.

const CONTAINER_PAINT = ['#c0392b', '#2e6f9e', '#3f8f5a', '#d9822b'];
const GROUND = '#8d9096';

export interface ArenaWorld {
  group: THREE.Group;
  colliders: Collider[];
  interactables: Interactable[];
  pickables: THREE.Object3D[];
  /** Each frame while you're there: the shots fading, the gate's shimmer. */
  update(dt: number, t: number): void;
  /** A shot from `o` to `end`: a streak of light, and sparks where it stopped (not on someone it `hit`). */
  shot(o: V3, end: V3, hit: boolean): void;
}

function block(into: THREE.Object3D, w: number, h: number, l: number, color: string, x: number, y: number, z: number, cast = true) {
  into.add(mesh(new THREE.BoxGeometry(w, h, l), toon(color), x, y + h / 2, z, cast));
}

/** A shipping container in box `b`: a body, ribs down its long sides, doors with their bars at one end. */
function container(into: THREE.Object3D, b: ArenaBox) {
  const color = CONTAINER_PAINT[b.paint % CONTAINER_PAINT.length];
  const dark = new THREE.Color(color).multiplyScalar(0.72).getStyle();
  const w = b.maxX - b.minX, l = b.maxZ - b.minZ, h = b.y1 - b.y0;
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  block(into, w, h, l, color, cx, b.y0, cz);
  const alongX = w > l;
  const len = alongX ? w : l, wid = alongX ? l : w;
  // Ribs, either side.
  for (let s = -len / 2 + 0.4; s <= len / 2 - 0.3; s += 0.5) for (const side of [-1, 1]) {
    const off = side * (wid / 2 + 0.03);
    if (alongX) block(into, 0.16, h - 0.2, 0.06, dark, cx + s, b.y0 + 0.1, cz + off, false);
    else block(into, 0.06, h - 0.2, 0.16, dark, cx + off, b.y0 + 0.1, cz + s, false);
  }
  // Frame round the top edge, and the door end's bars.
  if (alongX) block(into, w + 0.06, 0.14, l + 0.06, dark, cx, b.y1 - 0.14, cz, false);
  else block(into, w + 0.06, 0.14, l + 0.06, dark, cx, b.y1 - 0.14, cz, false);
  const end = len / 2 + 0.04;
  for (const k of [-0.6, -0.2, 0.2, 0.6]) {
    if (alongX) block(into, 0.05, h - 0.3, 0.07, '#d0d3d6', cx + end, b.y0 + 0.15, cz + k * wid * 0.5, false);
    else block(into, 0.07, h - 0.3, 0.05, '#d0d3d6', cx + k * wid * 0.5, b.y0 + 0.15, cz + end, false);
  }
}

/** A wooden crate: planks round a frame. */
function crate(into: THREE.Object3D, b: ArenaBox) {
  const w = b.maxX - b.minX, h = b.y1 - b.y0, l = b.maxZ - b.minZ;
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  block(into, w, h, l, '#b07d46', cx, b.y0, cz);
  // The frame: darker edges on each face, and a diagonal brace's worth of contrast.
  for (const y of [b.y0, b.y1 - 0.1]) block(into, w + 0.04, 0.1, l + 0.04, '#7a5230', cx, y, cz, false);
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) block(into, 0.1, h, 0.1, '#7a5230', cx + (dx * (w - 0.08)) / 2, b.y0, cz + (dz * (l - 0.08)) / 2, false);
}

/** A concrete barrier with hazard stripes along its top. */
function barrier(into: THREE.Object3D, b: ArenaBox) {
  const w = b.maxX - b.minX, h = b.y1 - b.y0, l = b.maxZ - b.minZ;
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  block(into, w, h, l, '#b5b7b9', cx, b.y0, cz);
  const alongX = w > l;
  const len = alongX ? w : l;
  for (let s = -len / 2, k = 0; s < len / 2 - 0.01; s += 0.5, k++) {
    const c = k % 2 ? '#212529' : '#f4c430';
    if (alongX) block(into, 0.5, 0.18, l + 0.04, c, cx + s + 0.25, b.y1 - 0.2, cz, false);
    else block(into, w + 0.04, 0.18, 0.5, c, cx, b.y1 - 0.2, cz + s + 0.25, false);
  }
}

/** The yard's walls: concrete panels with pilasters, and a yellow-and-black band along the top. */
function wall(into: THREE.Object3D, b: ArenaBox) {
  const w = b.maxX - b.minX, l = b.maxZ - b.minZ;
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  block(into, w, WALL_H, l, '#a7a9ac', cx, 0, cz);
  const alongX = w > l;
  const len = alongX ? w : l;
  // Which side faces the yard.
  const inward = alongX ? -Math.sign(cz - ARENA_CENTER.z) : -Math.sign(cx - ARENA_CENTER.x);
  const face = (alongX ? l : w) / 2 + 0.03;
  for (let s = -len / 2 + 0.5, k = 0; s < len / 2 - 0.4; s += 1, k++) {
    const c = k % 2 ? '#212529' : '#f4c430';
    if (alongX) block(into, 1, 0.45, 0.06, c, cx + s, WALL_H - 0.7, cz + inward * face, false);
    else block(into, 0.06, 0.45, 1, c, cx + inward * face, WALL_H - 0.7, cz + s, false);
  }
  for (let s = -len / 2 + 4; s < len / 2 - 2; s += 8) {
    if (alongX) block(into, 0.6, WALL_H, 0.3, '#94969a', cx + s, 0, cz + inward * (face + 0.12));
    else block(into, 0.3, WALL_H, 0.6, '#94969a', cx + inward * (face + 0.12), 0, cz + s);
  }
}

/** A floodlight mast: a lattice pole and a bank of lamps, looking into the yard. */
function mast(into: THREE.Object3D, x: number, z: number) {
  block(into, 0.5, 16, 0.5, '#6c757d', x, 0, z);
  block(into, 3, 1.4, 0.4, '#343a40', x, 16, z);
  for (let i = 0; i < 3; i++) block(into, 0.8, 0.6, 0.15, '#fff3bf', x - 1 + i, 16.4, z + Math.sign(ARENA_CENTER.z - z) * 0.25, false);
}

/** The arena's gate on the race plaza, in the city: put the group at the street's height, `street`. Its colliders stand from `street`. */
export function buildArenaCityGate(street: number): { group: THREE.Group; colliders: Collider[]; update(t: number): void } {
  const group = new THREE.Group();
  const colliders: Collider[] = [];
  const solid = new THREE.Group();
  const g = CITY_ARENA_GATE;
  // A dark runway up to it across the plaza's paving, hazard-striped at its edges.
  // It stops short of the circuit gate's red runway (RUNWAY_RACE), not over it.
  const r = RUNWAY_ARENA;
  const len = r.maxX - r.minX;
  block(solid, len, 0.04, g.width, '#3d4147', (r.minX + r.maxX) / 2, 0.02, g.z, false);
  for (const side of [-1, 1]) for (let k = 0; k < len; k++) block(solid, 1, 0.045, 0.3, k % 2 ? '#212529' : '#f4c430', r.minX + k + 0.5, 0.02, g.z + side * (g.width / 2 - 0.15), false);
  const { sign, shimmer } = gate(g, '🎯 Arena', solid, colliders, street, ['#3d4147', '#f4c430']);
  sign.position.y -= street;
  shimmer.position.y -= street;
  (shimmer.material as THREE.MeshBasicMaterial).color.set('#ff6b6b');
  // Sandbags either side.
  for (const side of [-1, 1]) for (let k = 0; k < 3; k++) block(solid, 0.9, 0.4, 0.5, '#c2a878', g.x - 2, k * 0.4, g.z + side * (g.width / 2 + 2.4) + (k % 2) * 0.2);
  group.add(mergeColored(solid), sign, shimmer);
  return { group, colliders, update: (t) => pulse(shimmer, t) };
}

/** The tracers and sparks in flight. */
interface Fx {
  mesh: THREE.Mesh;
  life: number;
  max: number;
}

export function buildArena(): ArenaWorld {
  const group = new THREE.Group();
  const colliders: Collider[] = [];
  const solid = new THREE.Group();
  const C = ARENA_CENTER;

  // The ground: concrete, with painted bays and lanes.
  const ground = mesh(new THREE.PlaneGeometry(600, 600).rotateX(-Math.PI / 2), toon(GROUND), C.x, 0, C.z, false);
  group.add(ground);
  // Something to stand on: the street's far below, out here.
  colliders.push({ minX: C.x - 300, maxX: C.x + 300, minZ: C.z - 300, maxZ: C.z + 300, bottom: -1, top: 0 });
  for (let i = -3; i <= 3; i++) {
    block(solid, 0.18, 0.012, ARENA_HALF * 2 - 2, '#e9ecef', C.x + i * 10, 0.002, C.z, false);
    block(solid, ARENA_HALF * 2 - 2, 0.012, 0.18, '#d8dadd', C.x, 0.002, C.z + i * 10, false);
  }
  block(solid, 8, 0.014, 8, '#f4c430', C.x, 0.003, C.z, false);
  block(solid, 7.4, 0.016, 7.4, GROUND, C.x, 0.004, C.z, false);

  for (const b of ARENA_BOXES) {
    if (b.kind === 'container') container(solid, b);
    else if (b.kind === 'crate') crate(solid, b);
    else if (b.kind === 'barrier') barrier(solid, b);
    else wall(solid, b);
    colliders.push({ minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ, bottom: b.y0, top: b.y1 });
  }
  const m = ARENA_HALF - 2;
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) mast(solid, C.x + dx * m, C.z + dz * m);
  // Stacks of containers outside, all round, to look over the walls at.
  let k = 0;
  for (let s = -ARENA_HALF - 10; s <= ARENA_HALF + 10; s += 14) for (const side of [-1, 1]) for (const along of [true, false]) {
    const high = 1 + ((k * 7) % 3);
    const out = side * (ARENA_HALF + 9);
    for (let y = 0; y < high; y++) {
      const b: ArenaBox = along
        ? { minX: C.x + s - 6, maxX: C.x + s + 6, minZ: C.z + out - 1.25, maxZ: C.z + out + 1.25, y0: y * 2.6, y1: (y + 1) * 2.6, kind: 'container', paint: k + y }
        : { minX: C.x + out - 1.25, maxX: C.x + out + 1.25, minZ: C.z + s - 6, maxZ: C.z + s + 6, y0: y * 2.6, y1: (y + 1) * 2.6, kind: 'container', paint: k + y + 1 };
      container(solid, b);
    }
    k++;
  }
  const home = gate(ARENA_GATE, '🏙️ Back to the city', solid, colliders, 0, ['#3d4147', '#f4c430']);
  (home.shimmer.material as THREE.MeshBasicMaterial).color.set('#ff6b6b');
  group.add(mergeColored(solid), home.sign, home.shimmer);

  // Shots: a pool of streaks and sparks.
  const fx: Fx[] = [];
  const streak = new THREE.CylinderGeometry(0.02, 0.02, 1, 5, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);
  const spark = new THREE.SphereGeometry(0.09, 6, 4);
  const pool = (geo: THREE.BufferGeometry, color: string, n: number, max: number) => {
    const list: Fx[] = [];
    for (let i = 0; i < n; i++) {
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending });
      const mm = new THREE.Mesh(geo, mat);
      mm.visible = false;
      mm.frustumCulled = false;
      group.add(mm);
      list.push({ mesh: mm, life: 0, max });
    }
    return list;
  };
  const tracers = pool(streak, '#ffe08a', 24, 0.07);
  const sparks = pool(spark, '#ffd27a', 24, 0.18);
  fx.push(...tracers, ...sparks);
  let ti = 0, si = 0;
  const from = new THREE.Vector3(), to = new THREE.Vector3();

  return {
    group,
    colliders,
    interactables: [],
    pickables: [],
    update(dt, t) {
      pulse(home.shimmer, t);
      for (const f of fx) {
        if (f.life <= 0) continue;
        f.life -= dt;
        const k = Math.max(0, f.life / f.max);
        (f.mesh.material as THREE.MeshBasicMaterial).opacity = k;
        if (f.mesh.geometry === spark) f.mesh.scale.setScalar(0.6 + (1 - k) * 1.4);
        f.mesh.visible = f.life > 0;
      }
    },
    shot(o, end, hit) {
      from.set(o.x, o.y - 0.12, o.z);
      to.set(end.x, end.y, end.z);
      const len = from.distanceTo(to);
      if (len > 0.5) {
        const tr = tracers[ti++ % tracers.length];
        tr.mesh.position.copy(from);
        tr.mesh.lookAt(to);
        tr.mesh.scale.set(1, 1, len);
        tr.life = tr.max;
        tr.mesh.visible = true;
      }
      if (hit) return;
      const sp = sparks[si++ % sparks.length];
      sp.mesh.position.copy(to);
      sp.life = sp.max;
      sp.mesh.visible = true;
    },
  };
}

/**
 * A rifle, its muzzle pointing along -z (as in camera space; turn it round to point a character's +z),
 * its grip at the origin. `muzzle`: where the flash goes.
 */
export function rifle(): { group: THREE.Group; muzzle: THREE.Object3D } {
  const parts = new THREE.Group();
  const metal = '#2b2f33', tan = '#a8875a', light = '#4a5056';
  block(parts, 0.07, 0.09, 0.42, metal, 0, 0.02, -0.12); // receiver
  block(parts, 0.06, 0.05, 0.3, tan, 0, 0.03, -0.42); // handguard
  parts.add(mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.22, 8).rotateX(Math.PI / 2), toon(metal), 0, 0.075, -0.66, false)); // barrel
  block(parts, 0.04, 0.03, 0.06, light, 0, 0.065, -0.76); // muzzle brake
  block(parts, 0.045, 0.16, 0.07, metal, 0, -0.12, -0.17); // magazine
  block(parts, 0.04, 0.11, 0.05, tan, 0, -0.08, 0.02); // grip
  block(parts, 0.05, 0.08, 0.2, tan, 0, 0.01, 0.17); // stock
  block(parts, 0.025, 0.035, 0.12, light, 0, 0.11, -0.12); // sight rail
  block(parts, 0.03, 0.04, 0.03, '#e03131', 0, 0.13, -0.16); // red dot
  const group = mergeColored(parts);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.075, -0.8);
  group.add(muzzle);
  return { group, muzzle };
}
