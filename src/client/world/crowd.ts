import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// The people on the street (see streetlife.ts), part by part, and the dogs they walk. Each part is one
// geometry, its colors painted into the vertices and tinted by its instance's color (white takes the tint
// as it is, darker or lighter shades of it go below or above 1); the whole crowd is one BatchedMesh. A
// person is put together from a top (a T-shirt, a coat or a dress), a head with a face, maybe hair, maybe
// a hat, maybe a backpack or a bag, two arms with hands and two legs with shoes. Feet are at y = 0, the
// hips at 0.82, the shoulders at 1.36 (±0.28) and the neck at 1.5, for someone of height 1. Arms and
// legs hang from their joint at 0,0,0. A dog stands on y = 0, its nose toward +z.

type Part = [geo: THREE.BufferGeometry, color: THREE.ColorRepresentation];

const shade = (k: number) => new THREE.Color(k, k, k);

/** Parts as one indexed geometry (so shared vertices are shaded once), each painted its color. */
function paint(parts: Part[]): THREE.BufferGeometry {
  const geos = parts.map(([g, c]) => {
    const geo = g.index ? g : g.setIndex([...Array(g.attributes.position.count).keys()]);
    geo.deleteAttribute('uv');
    const rgb = new Float32Array(geo.attributes.position.count * 3);
    const col = new THREE.Color(c);
    for (let i = 0; i < rgb.length; i += 3) col.toArray(rgb, i);
    geo.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
    return geo;
  });
  return mergeGeometries(geos)!;
}

const ball = (r: number, x: number, y: number, z: number, s: [number, number, number] = [1, 1, 1], seg: [number, number] = [7, 5]) =>
  new THREE.SphereGeometry(r, seg[0], seg[1]).scale(...s).translate(x, y, z);
const ring = (r: number, tube: number, y: number) => new THREE.TorusGeometry(r, tube, 3, 9).rotateX(Math.PI / 2).translate(0, y, 0);

/** The top of the head as a cap of hair (or a hat's crown) on a head 0.19 round, tipped back to show the forehead. */
const crown = (r: number, to = 0.45, tip = -0.25) => new THREE.SphereGeometry(r, 9, 4, 0, Math.PI * 2, 0, Math.PI * to).rotateX(tip).translate(0, 1.66, -0.01);
/** Collar points or lapels: a flat triangle pointing down, lying on the chest. */
const point = (w: number, h: number, sx: number, y: number, z: number) => new THREE.ConeGeometry(w, h, 3).rotateY(Math.PI / 6).rotateZ(Math.PI).scale(1, 1, 0.3).rotateX(-0.25).rotateZ(sx * 0.45).translate(sx * 0.05, y, z);

const torso = (r = 0.2): Part => [new THREE.CapsuleGeometry(r, 0.3, 2, 8).translate(0, 1.12, 0), '#ffffff'];

export const CROWD = {
  /** A T-shirt: a ribbed neck and a hem. */
  tee: () => paint([torso(), [ring(0.12, 0.028, 1.46), shade(1.3)], [ring(0.2, 0.02, 0.83), shade(0.82)]]),
  /** A coat to the knees: collar points, a belt, a row of buttons. */
  coat: () =>
    paint([
      torso(0.215),
      [new THREE.CylinderGeometry(0.225, 0.28, 0.5, 8, 1, true).translate(0, 0.7, 0), '#ffffff'],
      [ring(0.13, 0.035, 1.46), shade(0.85)],
      ...[-1, 1].map((sx): Part => [point(0.07, 0.17, sx, 1.36, 0.17), shade(0.78)]),
      [ring(0.225, 0.025, 0.98), shade(0.65)],
      ...[1.22, 1.1, 0.84, 0.66].map((y): Part => [ball(0.016, 0, y, y > 1 ? 0.215 : 0.255 - (0.98 - y) * 0.1, [1, 1, 0.5], [4, 2]), shade(0.45)]),
    ]),
  /** A dress: a waist band and a skirt flared to the knees. */
  dress: () =>
    paint([
      torso(0.19),
      [new THREE.CylinderGeometry(0.2, 0.36, 0.48, 9, 1, true).translate(0, 0.7, 0), '#ffffff'],
      [ring(0.198, 0.022, 0.94), shade(1.35)],
      [ring(0.36, 0.02, 0.47), shade(0.85)],
      [ring(0.11, 0.025, 1.46), shade(1.3)],
    ]),
  /** The head, tinted with the skin: ears, a nose, eyes, rosy cheeks and a little smile. */
  head: () =>
    paint([
      [ball(0.19, 0, 1.65, 0, [1, 1, 1], [9, 7]), '#ffffff'],
      ...[-1, 1].flatMap((sx): Part[] => [
        [ball(0.045, sx * 0.188, 1.645, -0.01, [0.45, 0.85, 0.7], [4, 3]), shade(0.95)],
        [ball(0.026, sx * 0.068, 1.675, 0.172, [1, 1.25, 0.6], [5, 3]), '#2a2a2a'],
        [ball(0.03, sx * 0.11, 1.615, 0.15, [1, 0.75, 0.5], [5, 3]), '#ffb4a8'],
      ]),
      [ball(0.022, 0, 1.635, 0.19, [1.1, 0.8, 0.7], [4, 3]), shade(0.97)],
      [new THREE.TorusGeometry(0.035, 0.008, 3, 5, Math.PI).rotateZ(Math.PI).translate(0, 1.6, 0.178), '#5a2a2a'],
    ]),
  /** Short hair: a cap with a fringe swept to one side. */
  short: () => paint([[crown(0.2), '#ffffff'], [ball(0.07, -0.05, 1.77, 0.15, [1.4, 0.45, 0.6], [6, 4]), shade(1.1)]]),
  /** Long hair: a cap and a curtain down the back to the shoulders. */
  long: () =>
    paint([
      [crown(0.2), '#ffffff'],
      [new THREE.SphereGeometry(0.21, 8, 5, Math.PI * 0.93, Math.PI * 1.14, Math.PI * 0.3, Math.PI * 0.5).scale(1.02, 1.5, 1).translate(0, 1.6, -0.02), shade(0.92)],
    ]),
  /** Hair up in a bun, with a darker tie. */
  bun: () => paint([[crown(0.2), '#ffffff'], [ball(0.085, 0, 1.85, -0.12), shade(1.05)], [new THREE.TorusGeometry(0.04, 0.014, 3, 7).rotateX(0.9).translate(0, 1.8, -0.09), shade(0.5)]]),
  /** A baseball cap, its peak out front. */
  cap: () =>
    paint([
      [crown(0.205, 0.5, -0.1), '#ffffff'],
      [new THREE.CylinderGeometry(0.13, 0.13, 0.018, 6, 1, false, -Math.PI / 2, Math.PI).scale(1, 1, 1.2).translate(0, 1.74, 0.15), shade(0.8)],
      [ball(0.02, 0, 1.87, 0, [1, 0.6, 1], [4, 2]), shade(0.8)],
    ]),
  /** A woolly hat with a turned-up band and a bobble. */
  beanie: () => paint([[crown(0.21, 0.55, -0.15), '#ffffff'], [ring(0.2, 0.035, 1.71).rotateX(-0.15), shade(0.8)], [ball(0.055, 0, 1.9, -0.02, [1, 1, 1], [5, 4]), shade(1.25)]]),
  /** A sun hat: a round crown, a ribbon and a wide brim. */
  sunhat: () =>
    paint([
      [crown(0.205, 0.5, -0.1), '#ffffff'],
      [new THREE.CylinderGeometry(0.36, 0.38, 0.02, 12).rotateX(-0.1).translate(0, 1.75, 0), shade(0.95)],
      [ring(0.2, 0.025, 1.78).rotateX(-0.1), shade(0.55)],
    ]),
  /** A backpack: a pocket on the back, a flap and straps over the shoulders. */
  backpack: () =>
    paint([
      [new THREE.CapsuleGeometry(0.13, 0.16, 2, 6).scale(1.1, 1, 0.6).translate(0, 1.16, -0.26), '#ffffff'],
      [new THREE.BoxGeometry(0.2, 0.13, 0.05).translate(0, 1.06, -0.34), shade(1.15)],
      [ball(0.13, 0, 1.3, -0.27, [1.05, 0.5, 0.62], [6, 3]), shade(0.82)],
      ...[-1, 1].map((sx): Part => [new THREE.TorusGeometry(0.15, 0.018, 3, 6, Math.PI).rotateY(Math.PI / 2).scale(1, 1.2, 1.25).translate(sx * 0.11, 1.28, -0.02), shade(0.7)]),
    ]),
  /** A shoulder bag on the left hip (+x), its strap across the chest and back. */
  bag: () =>
    paint([
      [new THREE.BoxGeometry(0.08, 0.2, 0.26).translate(0.25, 0.86, 0.02), '#ffffff'],
      [new THREE.BoxGeometry(0.09, 0.08, 0.27).translate(0.252, 0.93, 0.02), shade(0.8)],
      ...[0.205, -0.205].map((z): Part => [new THREE.BoxGeometry(0.035, 0.62, 0.015).rotateZ(0.62).translate(0.03, 1.1, z), shade(0.7)]),
    ]),
  /** An arm in its sleeve, a cuff at the wrist (a shade lighter). */
  arm: () => paint([[new THREE.CapsuleGeometry(0.062, 0.4, 1, 6).translate(0, -0.23, 0), '#ffffff'], [ring(0.064, 0.016, -0.43), shade(1.2)]]),
  /** A hand at the end of an arm, its thumb forward. */
  hand: () => paint([[ball(0.058, 0, -0.5, 0, [0.85, 1.1, 1], [6, 4]), '#ffffff'], [new THREE.CapsuleGeometry(0.02, 0.03, 1, 4).rotateX(1.1).translate(0, -0.48, 0.045), '#ffffff']]),
  /** A leg in its trousers (or bare, under a dress), and a shoe with a pale sole. */
  leg: () =>
    paint([
      [new THREE.CapsuleGeometry(0.085, 0.6, 1, 6).translate(0, -0.4, 0), '#ffffff'],
      [ball(0.085, 0, -0.775, 0.05, [1.05, 0.55, 1.6], [6, 4]), '#383838'],
      [ball(0.085, 0, -0.81, 0.05, [1.1, 0.18, 1.65], [6, 2]), shade(2.2)],
    ]),
  /** A dog, tinted its coat: a round body, a paler muzzle, a black nose and eyes, floppy ears, a red collar and its tail up. */
  dog: () =>
    paint([
      [new THREE.CapsuleGeometry(0.12, 0.3, 2, 7).rotateX(Math.PI / 2).translate(0, 0.36, 0), '#ffffff'],
      [ball(0.11, 0, 0.52, 0.3, [1, 1, 1], [7, 5]), '#ffffff'],
      [ball(0.06, 0, 0.49, 0.4, [0.9, 0.75, 1.1], [5, 3]), '#f6eee2'],
      [ball(0.022, 0, 0.51, 0.465, [1, 1, 1], [4, 2]), '#1d1d1d'],
      ...[-1, 1].flatMap((sx): Part[] => [
        [ball(0.016, sx * 0.05, 0.56, 0.39, [1, 1, 1], [4, 2]), '#1d1d1d'],
        [new THREE.SphereGeometry(0.05, 4, 3).scale(0.45, 1.2, 0.8).rotateZ(sx * 0.35).translate(sx * 0.1, 0.5, 0.27), shade(0.6)],
      ]),
      [new THREE.TorusGeometry(0.085, 0.018, 3, 8).rotateX(Math.PI / 2 - 0.4).translate(0, 0.46, 0.22), '#e63946'],
      [new THREE.CapsuleGeometry(0.025, 0.16, 1, 4).rotateX(-0.7).translate(0, 0.5, -0.27), '#ffffff'],
      ...[[-1, 1], [1, 1], [-1, -1], [1, -1]].map(([sx, sz]): Part => [new THREE.CapsuleGeometry(0.035, 0.22, 1, 5).translate(sx * 0.07, 0.14, sz * 0.17), '#ffffff']),
    ]),
};

export type CrowdPart = keyof typeof CROWD;

export type Top = 'tee' | 'coat' | 'dress';
export type Hair = 'short' | 'long' | 'bun';
export type Hat = 'cap' | 'beanie' | 'sunhat';
export type Carry = 'backpack' | 'bag';

/** How someone on the street is put together. */
export interface PedLook {
  build: 'adult' | 'kid' | 'elder';
  top: Top;
  hair: Hair | null;
  hat: Hat | null;
  carry: Carry | null;
}

const of = <T>(r: () => number, list: readonly T[]): T => list[Math.floor(r() * list.length)];

/** A look dealt from `r`: the second of a pair (`pairSide` > 0) is now and then a kid, out with a grown-up. */
export function pickLook(r: () => number, pairSide: number): PedLook {
  const build = pairSide > 0 && r() < 0.35 ? 'kid' : r() < 0.15 ? 'elder' : 'adult';
  const top: Top = build === 'kid' ? (r() < 0.3 ? 'dress' : 'tee') : of(r, ['tee', 'tee', 'tee', 'coat', 'coat', 'dress'] as const);
  let hair: Hair | null = r() < (build === 'elder' ? 0.3 : 0.1) ? null : of(r, ['short', 'short', 'long', 'bun'] as const);
  const hat = r() < (build === 'elder' ? 0.45 : 0.22) ? of(r, ['cap', 'beanie', 'sunhat'] as const) : null;
  // A bun would poke through a hat.
  if (hat && hair === 'bun') hair = 'long';
  const carry = r() < (build === 'kid' ? 0.5 : 0.18) ? 'backpack' : build !== 'kid' && r() < 0.2 ? 'bag' : null;
  return { build, top, hair, hat, carry };
}

/** How thick the cartoon outline is, the same on screen near or far (see main.ts's OutlineEffect). */
const OUTLINE = 0.0032;

/**
 * The cartoon outline the rest of the world gets from OutlineEffect, which can't draw a BatchedMesh:
 * drawn with the crowd's parts again, their back faces pushed out OUTLINE on screen.
 */
export function outlineMaterial(): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.17, 0.18, 0.26), side: THREE.BackSide });
  m.userData.outlineParameters = { visible: false };
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      #ifdef USE_BATCHING
        vec4 outlineAt = batchingMatrix * vec4( transformed, 1.0 );
        vec3 outlineIn = mat3( batchingMatrix ) * normal;
      #else
        vec4 outlineAt = vec4( transformed, 1.0 );
        vec3 outlineIn = normal;
      #endif
      vec4 outlineIn4 = projectionMatrix * modelViewMatrix * vec4( outlineAt.xyz - outlineIn, 1.0 );
      gl_Position += normalize( gl_Position - outlineIn4 ) * ${OUTLINE} * gl_Position.w;`,
    );
  };
  return m;
}

/** The crowd's own toon material (vertex colors), which OutlineEffect leaves alone: see outlineMaterial. */
export function crowdMaterial(gradientMap: THREE.Texture | null): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({ color: '#ffffff', vertexColors: true, gradientMap });
  m.userData.outlineParameters = { visible: false };
  return m;
}
