import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { cityDressing, citySolids } from '../../shared/city';
import { FLAG_COLOURS, type Bird, type Dress } from '../../shared/dressing';
import { decorTicker } from '../quality';
import { toon } from './toon';
import { busStops } from './streetlife';
import { PHASE, clock, col, focus, instances, m4, one, q, tickClock, up, windy } from './dressing';
import signStreetUrl from '../models/dressing/road-sign-street.glb?url';
import signWarningUrl from '../models/dressing/road-sign-warning.glb?url';
import coneUrl from '../models/dressing/construction-cone.glb?url';
import barrierUrl from '../models/dressing/construction-barrier.glb?url';
import parasolAUrl from '../models/dressing/detail-parasol-a.glb?url';
import parasolBUrl from '../models/dressing/detail-parasol-b.glb?url';
import roadsMapUrl from '../models/dressing/roads-colormap.png?url';
import commercialMapUrl from '../models/dressing/commercial-colormap.png?url';

// The rest of the street's dressing, loaded once the city's up (its models come in as files, so this stays out of the
// first download and out of the tests): Kenney's signs, roadworks and parasols placed by shared/dressing.ts, bus-stop
// signs by the shelters, flags, and the birds: pigeons that flap off as you come near, and gulls on the beach and over the water.

const KIT: Record<Dress['kind'], { url: string | ((d: Dress) => string); scale: number; kit: 'roads' | 'commercial' } | null> = {
  streetSign: { url: signStreetUrl, scale: 5.2, kit: 'roads' },
  warning: { url: signWarningUrl, scale: 5.2, kit: 'roads' },
  cone: { url: coneUrl, scale: 8, kit: 'roads' },
  barrier: { url: barrierUrl, scale: 8, kit: 'roads' },
  parasol: { url: (d) => (d.v ? parasolBUrl : parasolAUrl), scale: 6, kit: 'commercial' },
  flag: null,
};

/** A 1-pixel image: the files' own atlases aren't decoded (each would be its own copy); the kit's is loaded once, below. */
const BLANK = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** Each file once: its meshes in one geometry (position, normal, uv). */
const files = new Map<string, Promise<THREE.BufferGeometry>>();
function piece(url: string): Promise<THREE.BufferGeometry> {
  let p = files.get(url);
  if (!p) {
    // The .glb files name their colour atlas as a file beside them (Textures/colormap.png).
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((u) => (u.endsWith('colormap.png') ? BLANK : u));
    p = new GLTFLoader(manager).loadAsync(url).then((gltf) => {
      gltf.scene.updateMatrixWorld(true);
      const parts: THREE.BufferGeometry[] = [];
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
        for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
        parts.push(g);
      });
      return mergeGeometries(parts)!;
    });
    files.set(url, p);
  }
  return p;
}

async function kenney(group: THREE.Group, items: Dress[]) {
  const urlOf = (d: Dress) => {
    const k = KIT[d.kind]!;
    return typeof k.url === 'function' ? k.url(d) : k.url;
  };
  const placed = items.filter((d) => KIT[d.kind]);
  // Every file at once, and each kit's atlas once (glTF's UVs want it unflipped).
  const geos = new Map(await Promise.all([...new Set(placed.map(urlOf))].map(async (u) => [u, await piece(u)] as const)));
  const atlas = (url: string) => {
    const t = new THREE.TextureLoader().load(url);
    t.flipY = false;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const maps = { roads: atlas(roadsMapUrl), commercial: atlas(commercialMapUrl) };
  const by = { roads: [] as THREE.BufferGeometry[], commercial: [] as THREE.BufferGeometry[] };
  for (const d of placed) {
    const k = KIT[d.kind]!;
    q.setFromAxisAngle(up, d.rot);
    m4.compose(new THREE.Vector3(d.x, 0, d.z), q, new THREE.Vector3(k.scale, k.scale, k.scale));
    by[k.kit].push(geos.get(urlOf(d))!.clone().applyMatrix4(m4));
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
  const plate = instances(new THREE.PlaneGeometry(0.6, 0.6), Object.assign(new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, toneMapped: false }), { userData: { outlineParameters: { visible: false } } }), stops, (s, m) => {
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

/** The street's name on a green blade above each street sign's pole, its face along the street it names so you read it coming up it. */
function nameplates(group: THREE.Group, list: Dress[]) {
  const named = list.filter((d) => d.kind === 'streetSign' && d.name);
  if (!named.length) return;
  const geo = new THREE.PlaneGeometry(2.2, 0.5);
  const mats = new Map<string, THREE.MeshBasicMaterial>();
  for (const d of named) {
    let mat = mats.get(d.name!);
    if (!mat) {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 116;
      const g = canvas.getContext('2d')!;
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, 512, 116);
      g.fillStyle = '#1b6b45';
      g.fillRect(8, 8, 496, 100);
      g.fillStyle = '#ffffff';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      let px = 56;
      g.font = `800 ${px}px Nunito, ui-rounded, system-ui, sans-serif`;
      const w = g.measureText(d.name!).width;
      if (w > 470) g.font = `800 ${(px = Math.floor((px * 470) / w))}px Nunito, ui-rounded, system-ui, sans-serif`;
      g.fillText(d.name!, 256, 60);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, toneMapped: false });
      mat.userData.outlineParameters = { visible: false };
      mats.set(d.name!, mat);
    }
    const plate = new THREE.Mesh(geo, mat);
    plate.position.set(d.x, 2.85, d.z);
    plate.rotation.y = d.rot + Math.PI / 2;
    group.add(plate);
  }
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

/** Pigeons and gulls: perched ones fly off (to come back a while after) when you come close; some gulls always wheel. */
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
  const step = (dt: number, cx: number, cz: number, t: number) => {
    busy = 0;
    for (const k of birdsNow) {
      const { b } = k;
      switch (k.s) {
        case enum_.perched: {
          const dx = k.x - cx;
          const dz = k.z - cz;
          // Horizontal: it's you (or your car) that scares them, however high the camera is.
          if (dx * dx + dz * dz > (b.kind === 'gull' ? 81 : 36)) break;
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
    // The city's x and z are the world's. Whoever main.ts says you are; the camera if it hasn't said.
    const c = camera.matrixWorld.elements;
    step(busy ? dt : due, focus.on ? focus.x : c[12], focus.on ? focus.z : c[14], clock.value);
  };
  group.add(mesh);
}


/** Everything but the trees and awnings (world/dressing.ts has those): the Kenney pieces come in a moment after, and go missing if they don't. */
export function buildDressing(): THREE.Group {
  const group = new THREE.Group();
  const { items, birds: flock } = cityDressing();
  flags(group, items.filter((i) => i.kind === 'flag'));
  busSigns(group);
  nameplates(group, items);
  birds(group, flock);
  kenney(group, items).catch((err: unknown) => console.error("the street dressing's models didn't load", err));
  return group;
}
