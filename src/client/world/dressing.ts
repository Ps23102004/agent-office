import * as THREE from 'three';
import { toon } from './toon';

// The trees' tops and the awnings' fringes, swaying in the wind: drawn by the city itself (world/city.ts), since they
// are the trees and awnings. They need no model files. The rest of the street's dressing (world/dressingModels.ts) is
// loaded after, and its materials share this file's sway and clock.

export interface Canopy { x: number; y: number; z: number; r: number; color: string }
export interface Fringe { x: number; y: number; z: number; yaw: number; w: number; color: string }

/** One clock for every sway, set each time anything of ours is drawn (the same for everyone: the office's). */
export const clock = { value: 0 };
export const tickClock = () => (clock.value = (Date.now() / 1000) % 3600);

/** Adds `body` after the vertex is placed (before the instance's matrix), with `uTime` and any `head` declarations at hand. */
export function windy<M extends THREE.Material>(mat: M, key: string, head: string, body: string): M {
  mat.customProgramCacheKey = () => key;
  // The outline pass (main.ts) ignores onBeforeCompile, so it would draw a hull where the sway isn't: no outline.
  mat.userData.outlineParameters = { visible: false };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = clock;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\nuniform float uTime;\n${head}`).replace('#include <begin_vertex>', `#include <begin_vertex>\n${body}`);
  };
  return mat;
}

export const PHASE = 'float ph = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.53;';
export const m4 = new THREE.Matrix4();
export const q = new THREE.Quaternion();
export const up = new THREE.Vector3(0, 1, 0);
export const one = new THREE.Vector3(1, 1, 1);
export const col = new THREE.Color();

/** An InstancedMesh with each instance's matrix and colour set from `at`. */
export function instances<T>(geo: THREE.BufferGeometry, mat: THREE.Material, list: T[], at: (t: T, m: THREE.Matrix4) => string | null): THREE.InstancedMesh {
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

/** The trees' tops and the awnings' fringes (city.ts lays them out) as one group, swaying. */
export function buildSway(canopyList: Canopy[], fringeList: Fringe[]): THREE.Group {
  const group = new THREE.Group();
  canopies(group, canopyList);
  fringes(group, fringeList);
  return group;
}

/** Where you are (you, or your car), set each frame by main.ts: the birds fly off from it. Not set, they stay put. */
export const focus = { x: 0, z: 0, on: false };
