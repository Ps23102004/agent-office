import * as THREE from 'three';
import { toonVertex } from './toon';

// Kenney's Car Kit (CC0, see CREDITS.md), as blender/scripts/build_cars.py wrote it into cars.glb: each
// model's body, the paint to tint, one wheel and where the four go, and where its lights are. models.ts
// hands the loaded file over (setCarKit) before the world is built; until then, or if it didn't load,
// kitModel() is null and the street and the garage draw their own cars in code instead.

export type KitName =
  | 'sedan' | 'sedan-sports' | 'hatchback-sports' | 'suv' | 'suv-luxury' | 'taxi' | 'police' | 'van' | 'delivery'
  | 'delivery-flat' | 'truck' | 'garbage-truck' | 'ambulance' | 'firetruck' | 'race' | 'race-future';

type V3 = [number, number, number];

/** One model, in metres: nose to +z, its left +x, wheels on y = 0. */
export interface KitModel {
  /** What keeps its own colors (glass, trim, lights, grey bits). */
  body: THREE.BufferGeometry;
  /** The bodywork in its main color, white-ish (just its shading) for tinting; null if it has none (the police car). */
  paint: THREE.BufferGeometry | null;
  /** The color it came painted. */
  paintColor: string | null;
  /** One wheel, its hub at the origin facing -x (as on the right side). */
  wheel: THREE.BufferGeometry;
  /** Where the wheels' hubs are; +x is the left side. */
  hubs: { x: number; y: number; z: number; front: boolean }[];
  radius: number;
  head: V3[];
  tail: V3[];
  beacons: { at: V3; color: 'red' | 'blue' }[];
  length: number;
  width: number;
  height: number;
  /** Where the windows start: up from here is the cabin, off with someone in it. */
  belt: number;
  /** The cabin's glass, back to front (z). */
  cabin: [number, number];
}

let kit: Map<KitName, KitModel> | null = null;

/** Every geometry the same shape of attributes (float position, normal, rgb color, indexed), so they batch together. */
function plain(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', geo.attributes.position.clone());
  out.setAttribute('normal', geo.attributes.normal.clone());
  const c = geo.attributes.color;
  const n = geo.attributes.position.count;
  const rgb = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) rgb.set([c.getX(i), c.getY(i), c.getZ(i)], i * 3);
  out.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
  out.setIndex(geo.index!.clone());
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

/** Takes the loaded cars.glb's scene. */
export function setCarKit(scene: THREE.Object3D) {
  const out = new Map<KitName, KitModel>();
  const geos = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
  const geo = (o: THREE.Object3D | undefined) => {
    const g = (o as THREE.Mesh | undefined)?.geometry;
    if (!g) return null;
    if (!geos.has(g)) geos.set(g, plain(g));
    return geos.get(g)!;
  };
  for (const node of scene.children) {
    const name = node.name as KitName;
    const x = node.userData as { length: number; width: number; height: number; belt: number; cabin: [number, number]; radius: number; wheels: V3[]; head: V3[]; tail: V3[]; beacons: [number, number, number, 'red' | 'blue'][]; paint: string | null };
    const body = geo(node.getObjectByName(`${name}_body`));
    const wheel = geo(node.getObjectByName(`${name}_wheel`));
    if (!body || !wheel || !x.wheels) continue;
    const hubs = x.wheels.map(([hx, hy, hz]) => ({ x: hx, y: hy, z: hz, front: hz > 0 }));
    out.set(name, {
      body, wheel, hubs,
      paint: geo(node.getObjectByName(`${name}_paint`)),
      paintColor: x.paint,
      radius: x.radius,
      head: x.head,
      tail: x.tail,
      beacons: x.beacons.map(([bx, by, bz, color]) => ({ at: [bx, by, bz], color })),
      length: x.length,
      width: x.width,
      height: x.height,
      belt: x.belt,
      cabin: x.cabin,
    });
  }
  kit = out;
}

/** A Kenney model by name, once cars.glb is in; null before (or if it never loaded). */
export function kitModel(name: KitName): KitModel | null {
  return kit?.get(name) ?? null;
}

let material: THREE.MeshToonMaterial | null = null;

/** The toon material every Kenney vehicle shares: colors by vertex, both sides (some of their panels are single faces). */
export function kitMaterial(): THREE.MeshToonMaterial {
  if (!material) {
    material = toonVertex().clone();
    material.side = THREE.DoubleSide;
  }
  return material;
}
