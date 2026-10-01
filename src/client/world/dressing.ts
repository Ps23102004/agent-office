import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { cityDressing, citySolids } from '../../shared/city';
import { FLAG_COLOURS, type Bird, type Dress } from '../../shared/dressing';
import { decorTicker } from '../quality';
import { toon } from './toon';
import { busStops } from './streetlife';
import signStreetUrl from '../models/dressing/road-sign-street.glb?url';
import signWarningUrl from '../models/dressing/road-sign-warning.glb?url';
import coneUrl from '../models/dressing/construction-cone.glb?url';
import barrierUrl from '../models/dressing/construction-barrier.glb?url';
import parasolAUrl from '../models/dressing/detail-parasol-a.glb?url';
import parasolBUrl from '../models/dressing/detail-parasol-b.glb?url';
import roadsMapUrl from '../models/dressing/roads-colormap.png?url';
import commercialMapUrl from '../models/dressing/commercial-colormap.png?url';

// The street's finishing touches, drawn on top of the city (world/city.ts adds it once): Kenney's signs, roadworks
// and parasols placed by shared/dressing.ts, bus-stop signs by the shelters, flags and shop awnings' fringes that
// move in the wind, trees that rustle, and the birds: pigeons on the sidewalks that flap off as you come near, and
// gulls on the beach and wheeling over the water. All of it is instanced or merged (about eight draw calls) and the
// moving parts are done in the vertex shader, so only the birds ask anything of the CPU, and they do it at decorHz.

/** A tree's canopy (a ball), and an awning's fringe, as city.ts lays them out. */
export interface Canopy { x: number; y: number; z: number; r: number; color: string }
export interface Fringe { x: number; y: number; z: number; yaw: number; w: number; color: string }

/** One clock for every sway, set each time anything of ours is drawn (the same for everyone: the office's). */
const clock = { value: 0 };
const tickClock = () => (clock.value = (Date.now() / 1000) % 3600);

/** Adds `body` after the vertex is placed (before the instance's matrix), with `uTime` and any `head` declarations at hand. */
function windy<M extends THREE.Material>(mat: M, key: string, head: string, body: string): M {
  mat.customProgramCacheKey = () => key;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = clock;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\nuniform float uTime;\n${head}`).replace('#include <begin_vertex>', `#include <begin_vertex>\n${body}`);
  };
  return mat;
}

const PHASE = 'float ph = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.53;';
const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const up = new THREE.Vector3(0, 1, 0);
const one = new THREE.Vector3(1, 1, 1);
const col = new THREE.Color();

/** An InstancedMesh with each instance's matrix and colour set from `at`. */
function instances<T>(geo: THREE.BufferGeometry, mat: THREE.Material, list: T[], at: (t: T, m: THREE.Matrix4) => string | null): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  mesh.count = list.length;
  list.forEach((t, i) => {
    const c = at(t, m4);
    mesh.setMatrixAt(i, m4);
    if (c) mesh.setColorAt(i, col.set(c));
  });
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  return mesh;
}

// ---- Kenney's pieces, merged -----------------------------------------------------------------------------------

const KIT: Record<Dress['kind'], { url: string | ((d: Dress) => string); scale: number; kit: 'roads' | 'commercial' } | null> = {
  streetSign: { url: signStreetUrl, scale: 5.2, kit: 'roads' },
  warning: { url: signWarningUrl, scale: 5.2, kit: 'roads' },
  cone: { url: coneUrl, scale: 8, kit: 'roads' },
  barrier: { url: barrierUrl, scale: 8, kit: 'roads' },
  parasol: { url: (d) => (d.v ? parasolBUrl : parasolAUrl), scale: 6, kit: 'commercial' },
  flag: null,
};

/** Each file once: its meshes in one geometry (position, normal, uv) and its colour atlas. */
const files = new Map<string, Promise<{ geo: THREE.BufferGeometry; map: THREE.Texture | null }>>();
function piece(url: string, kit: 'roads' | 'commercial') {
  let p = files.get(url);
  if (!p) {
    // The .glb files name their colour atlas as a file beside them (Textures/colormap.png): the kit's own is given instead.
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((u) => (u.endsWith('colormap.png') ? (kit === 'roads' ? roadsMapUrl : commercialMapUrl) : u));
    p = new GLTFLoader(manager).loadAsync(url).then((gltf) => {
      gltf.scene.updateMatrixWorld(true);
      const parts: THREE.BufferGeometry[] = [];
      let map: THREE.Texture | null = null;
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
        for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
        parts.push(g);
        map ??= (m.material as THREE.MeshStandardMaterial).map;
      });
      return { geo: mergeGeometries(parts)!, map };
    });
    files.set(url, p);
  }
  return p;
}

async function kenney(group: THREE.Group, items: Dress[]) {
  const by = { roads: [] as THREE.BufferGeometry[], commercial: [] as THREE.BufferGeometry[] };
  const maps: Record<string, THREE.Texture | null> = {};
  for (const d of items) {
    const k = KIT[d.kind];
    if (!k) continue;
    const { geo, map } = await piece(typeof k.url === 'function' ? k.url(d) : k.url, k.kit);
    maps[k.kit] ??= map;
    q.setFromAxisAngle(up, d.rot);
    m4.compose(new THREE.Vector3(d.x, 0, d.z), q, new THREE.Vector3(k.scale, k.scale, k.scale));
    by[k.kit].push(geo.clone().applyMatrix4(m4));
  }
  const gradient = (toon('#fff') as THREE.MeshToonMaterial).gradientMap;
  for (const kit of ['roads', 'commercial'] as const) {
    if (!by[kit].length) continue;
    const mat = new THREE.MeshToonMaterial({ map: maps[kit], gradientMap: gradient });
    const mesh = new THREE.Mesh(mergeGeometries(by[kit])!, mat);
    mesh.castShadow = false;
    group.add(mesh);
  }
}

// ---- The plain furniture of the street, in the wind --------------------------------------------------------------

/** A sign on a pole beside each bus shelter (streetlife.ts has the shelters, and a blue sign of its own at the other end). */
function busSigns(group: THREE.Group) {
  const stops = busStops().flatMap((b) => {
    const c = Math.cos(b.face);
    const s = Math.sin(b.face);
    const x = b.x - 2.1 * c + 0.2 * s;
    const z = b.z + 2.1 * s + 0.2 * c;
    return citySolids(x, z, 0.3).length ? [] : [{ x, z, rot: b.face + Math.PI / 2 }];
  });
  if (!stops.length) return;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#1f6fd6';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 6;
  g.strokeRect(5, 5, 118, 118);
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '800 46px Nunito, ui-rounded, system-ui, sans-serif';
  g.fillText('BUS', 64, 52);
  g.fillRect(34, 80, 60, 22);
  g.fillStyle = '#1f6fd6';
  g.fillRect(40, 85, 14, 9);
  g.fillRect(60, 85, 14, 9);
  g.fillRect(80, 85, 8, 9);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const plate = instances(new THREE.PlaneGeometry(0.6, 0.6), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, toneMapped: false }), stops, (s, m) => {
    m.compose(new THREE.Vector3(s.x, 2.45, s.z), q.setFromAxisAngle(up, s.rot), one);
    return null;
  });
  group.add(plate, poles(stops.map((s) => ({ x: s.x, z: s.z, h: 2.8 }))));
}

/** Thin grey poles, each of its own height. */
function poles(list: { x: number; z: number; h: number }[]): THREE.InstancedMesh {
  const geo = new THREE.CylinderGeometry(0.045, 0.06, 1, 6).translate(0, 0.5, 0);
  return instances(geo, toon('#b9bec9'), list, (p, m) => {
    m.compose(new THREE.Vector3(p.x, 0, p.z), q.identity(), new THREE.Vector3(1, p.h, 1));
    return null;
  });
}

function flags(group: THREE.Group, list: Dress[]) {
  if (!list.length) return;
  group.add(poles(list.map((f) => ({ x: f.x, z: f.z, h: 6.6 }))));
  const geo = new THREE.PlaneGeometry(1, 1, 8, 1).translate(0.5, -0.5, 0);
  const body = `${PHASE}
    transformed.z += sin(uTime * 4.0 - position.x * 7.0 + ph) * 0.2 * position.x;
    transformed.y += sin(uTime * 3.0 - position.x * 5.0 + ph) * 0.05 * position.x;`;
  const mat = windy(new THREE.MeshToonMaterial({ side: THREE.DoubleSide, gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap }), 'flag', '', body);
  const mesh = instances(geo, mat, list, (f, m) => {
    m.compose(new THREE.Vector3(f.x, 6.65, f.z), q.setFromAxisAngle(up, f.rot), new THREE.Vector3(2, 1.2, 1));
    return FLAG_COLOURS[f.v % FLAG_COLOURS.length];
  });
  mesh.onBeforeRender = tickClock;
  group.add(mesh);
}

function canopies(group: THREE.Group, list: Canopy[]) {
  if (!list.length) return;
  // The tree's top (a ball) takes the wind more the higher it is; a quicker, smaller shiver on top of the slow sway.
  const body = `${PHASE}
    float top = position.y + 1.0;
    transformed.x += (sin(uTime * 1.6 + ph) * 0.07 + sin(uTime * 5.0 + position.x * 4.0 + ph) * 0.02) * top;
    transformed.z += (cos(uTime * 1.3 + ph * 1.7) * 0.07 + sin(uTime * 4.3 + position.z * 4.0 + ph) * 0.02) * top;`;
  const mat = windy(new THREE.MeshToonMaterial({ gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap }), 'canopy', '', body);
  const mesh = instances(new THREE.SphereGeometry(1, 8, 6), mat, list, (c, m) => {
    m.compose(new THREE.Vector3(c.x, c.y, c.z), q.identity(), new THREE.Vector3(c.r, c.r, c.r));
    return c.color;
  });
  mesh.onBeforeRender = tickClock;
  group.add(mesh);
}

function fringes(group: THREE.Group, list: Fringe[]) {
  if (!list.length) return;
  const geo = new THREE.PlaneGeometry(1, 1, 1, 3).translate(0, -0.5, 0);
  const body = `${PHASE}
    float drop = -position.y;
    transformed.z += sin(uTime * 1.9 + ph) * 0.14 * drop * drop;`;
  const mat = windy(new THREE.MeshToonMaterial({ side: THREE.DoubleSide, gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap }), 'fringe', '', body);
  const mesh = instances(geo, mat, list, (f, m) => {
    m.compose(new THREE.Vector3(f.x, f.y, f.z), q.setFromAxisAngle(up, f.yaw), new THREE.Vector3(f.w, 0.28, 1));
    return f.color;
  });
  mesh.onBeforeRender = tickClock;
  group.add(mesh);
}

// ---- Birds ---------------------------------------------------------------------------------------------------------

function birdGeometry(): THREE.BufferGeometry {
  const part = (g: THREE.BufferGeometry, wing: number) => {
    g.setAttribute('aWing', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count).fill(wing), 1));
    return g;
  };
  return mergeGeometries([
    part(new THREE.SphereGeometry(1, 8, 6).scale(0.09, 0.08, 0.17).translate(0, 0.11, 0), 0),
    part(new THREE.SphereGeometry(1, 6, 5).scale(0.05, 0.05, 0.05).translate(0, 0.19, 0.15), 0),
    part(new THREE.BoxGeometry(0.07, 0.015, 0.1).translate(0, 0.12, -0.2), 0),
    part(new THREE.BoxGeometry(0.26, 0.015, 0.13).translate(0.15, 0.14, 0), 1),
    part(new THREE.BoxGeometry(0.26, 0.015, 0.13).translate(-0.15, 0.14, 0), 1),
  ])!;
}

/** Pigeons and gulls: perched ones fly off (to come back a while after) when the camera comes close; some gulls always wheel. */
function birds(group: THREE.Group, list: Bird[]) {
  if (!list.length) return;
  const geo = birdGeometry();
  const fly = new THREE.InstancedBufferAttribute(new Float32Array(list.length), 1);
  geo.setAttribute('aFly', fly);
  const head = 'attribute float aWing; attribute float aFly;';
  const body = `${PHASE}
    float flap = sin(uTime * 18.0 + ph) * aFly;
    transformed.y += aWing * max(abs(position.x) - 0.03, 0.0) * flap * 1.6;
    transformed.x *= 1.0 - aWing * (1.0 - aFly) * 0.5;`;
  const mat = windy(new THREE.MeshToonMaterial({ gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap }), 'bird', head, body);
  const PIGEONS = ['#8d93a0', '#a7adb8', '#6d7480', '#b9a99a'];
  const mesh = new THREE.InstancedMesh(geo, mat, list.length);
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  // Perched, fleeing, wheeling, away (waiting to come back), coming back in.
  const enum_ = { perched: 0, fleeing: 1, wheeling: 2, away: 3, landing: 4 };
  const birdsNow = list.map((b, i) => {
    const r = ((i * 2654435761) >>> 0) / 4294967296;
    mesh.setColorAt(i, col.set(b.kind === 'gull' ? '#f4f4f0' : PIGEONS[Math.floor(r * PIGEONS.length)]));
    return { b, i, s: b.orbit ? enum_.wheeling : enum_.perched, t: 0, wait: 0, x: b.x, y: 0, z: b.z, yaw: b.rot, vx: 0, vz: 0, from: [0, 0, 0], scale: b.kind === 'gull' ? 1.7 : 1, r };
  });
  const e = new THREE.Euler();
  const pos = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const place = (k: (typeof birdsNow)[number], pitch = 0, roll = 0) => {
    const s = k.s === enum_.away ? 0 : k.scale;
    m4.compose(pos.set(k.x, k.y, k.z), q.setFromEuler(e.set(pitch, k.yaw, roll, 'YXZ')), sc.set(s, s, s));
    mesh.setMatrixAt(k.i, m4);
  };
  const smooth = (u: number) => u * u * (3 - 2 * u);
  const tick = decorTicker();
  let last = performance.now();
  let busy = 0;
  const step = (dt: number, cx: number, cy: number, cz: number, t: number) => {
    busy = 0;
    for (const k of birdsNow) {
      const { b } = k;
      switch (k.s) {
        case enum_.perched: {
          const dx = k.x - cx;
          const dz = k.z - cz;
          const dy = k.y - cy;
          if (dx * dx + dy * dy + dz * dz > (b.kind === 'gull' ? 64 : 30)) break;
          // Up and away from whoever came close, a little to one side.
          const away = Math.atan2(dx, dz) + (k.r - 0.5) * 1.2;
          k.vx = Math.sin(away) * (5 + k.r * 3);
          k.vz = Math.cos(away) * (5 + k.r * 3);
          k.yaw = away;
          k.s = enum_.fleeing;
          k.t = 0;
          fly.setX(k.i, 1);
          fly.needsUpdate = true;
          break;
        }
        case enum_.fleeing:
          k.t += dt;
          k.x += k.vx * dt;
          k.z += k.vz * dt;
          k.y += (4.5 - k.t * 0.5) * dt;
          place(k, -0.35);
          busy = 1;
          if (k.t > 3.5) {
            k.s = enum_.away;
            k.wait = 18 + k.r * 14;
            place(k);
          }
          break;
        case enum_.away: {
          k.wait -= dt;
          const dx = b.x - cx;
          const dz = b.z - cz;
          if (k.wait > 0 || dx * dx + dz * dz < 400) break;
          // Back in from a way off and above, gliding down onto where it was.
          const a = k.r * 40;
          k.from = [b.x + Math.cos(a) * 14, 9, b.z + Math.sin(a) * 14];
          k.yaw = Math.atan2(b.x - k.from[0], b.z - k.from[2]);
          k.s = enum_.landing;
          k.t = 0;
          fly.setX(k.i, 1);
          fly.needsUpdate = true;
          break;
        }
        case enum_.landing: {
          k.t += dt;
          const u = Math.min(1, k.t / 2.4);
          const w = smooth(u);
          k.x = k.from[0] + (b.x - k.from[0]) * w;
          k.z = k.from[2] + (b.z - k.from[2]) * w;
          k.y = k.from[1] * (1 - w);
          busy = 1;
          if (u >= 1) {
            k.s = enum_.perched;
            k.yaw = b.rot;
            k.x = b.x;
            k.y = 0;
            k.z = b.z;
            fly.setX(k.i, 0);
            fly.needsUpdate = true;
            place(k);
          } else place(k, 0.25 * (1 - u));
          break;
        }
        default: {
          // Wheeling over the water: round its circle, bobbing, banked into the turn.
          const o = b.orbit!;
          const a = o.a + o.w * t;
          k.x = b.x + Math.cos(a) * o.r;
          k.z = b.z + Math.sin(a) * o.r;
          k.y = o.y + Math.sin(t * 0.7 + o.a) * 1.2;
          const d = Math.sign(o.w);
          k.yaw = Math.atan2(-Math.sin(a) * d, Math.cos(a) * d);
          place(k, 0, -0.35 * d);
        }
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
  };
  // Perched ones are set down once; the rest are placed as they move.
  for (const k of birdsNow) {
    if (k.s === enum_.perched) place(k);
    else fly.setX(k.i, 1);
  }
  fly.needsUpdate = true;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.onBeforeRender = (_r, _s, camera) => {
    tickClock();
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const due = tick(dt);
    if (!busy && !due) return;
    // The city sits below the world's origin (the office is floors up), so the camera goes into its frame.
    const at = mesh.worldToLocal(pos.setFromMatrixPosition(camera.matrixWorld));
    step(busy ? dt : due, at.x, at.y, at.z, clock.value);
  };
  group.add(mesh);
}

/**
 * Everything the street is dressed with, as one group for the city to hold (world/city.ts adds it): `canopies` are the
 * trees' tops and `fringes` the awnings' hanging edges that city.ts lays out, which sway here; the rest comes from
 * shared/dressing.ts (the same for everyone). The Kenney pieces load a moment after, and go missing if they don't.
 */
export function buildDressing(canopyList: Canopy[], fringeList: Fringe[]): THREE.Group {
  const group = new THREE.Group();
  const { items, birds: flock } = cityDressing();
  canopies(group, canopyList);
  fringes(group, fringeList);
  flags(group, items.filter((i) => i.kind === 'flag'));
  busSigns(group);
  birds(group, flock);
  kenney(group, items).catch((err: unknown) => console.error("the street dressing's models didn't load", err));
  return group;
}
