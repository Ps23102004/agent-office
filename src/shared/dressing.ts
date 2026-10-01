// The street dressing: signs at the corners, parasols outside the shops, roadworks, flagpoles, and the
// birds on the sidewalks and the beach. Pure numbers and seeded, so everyone's city has the same ones;
// client/world/dressing.ts draws them, and the small solid ones (poles) are in citySolids (city.ts).
//
// What it needs of the city it gets by being handed `clear`, which says whether a disc of radius r at
// (x, z) has nothing solid in it yet (city.ts passes one over what it has put in its hash so far).

import { PERIOD, ROAD_W, WALK, PIER, RACE_PLAZA, STREET_X, STREET_Z, cityLayout, cityStreetscape, coastAt, keepClear, rng, surfaceAt, type Area } from './city.js';

/** Dressing is placed this far from the middle (m); past it the haze has it. */
export const DRESS_RADIUS = 170;

export type DressKind = 'streetSign' | 'warning' | 'parasol' | 'cone' | 'barrier' | 'flag';

export interface Dress {
  kind: DressKind;
  x: number;
  z: number;
  /** About the vertical; local +z faces the way it's read from. */
  rot: number;
  /** Which of a few looks (a parasol's two, a flag's colour). */
  v: number;
}

export interface Bird {
  kind: 'pigeon' | 'gull';
  /** Where it perches (ground), or the centre of its circle if it has an `orbit`. */
  x: number;
  z: number;
  /** Perched: it stands at y = 0 (the beach is a little lower, which doesn't show at this size). */
  rot: number;
  /** A gull wheeling over the water: a circle (m) about (x, z), the height it flies at, how fast round (rad/s) and where it starts. */
  orbit?: { r: number; y: number; w: number; a: number };
}

export interface Dressing {
  items: Dress[];
  birds: Bird[];
  /** Poles and tables that are in the way (add to the solids). */
  solids: { area: Area; h?: number }[];
}

const hash = (...n: number[]) => n.reduce((h, v) => Math.imul(h ^ (v + 0x9e3779b9), 0x85ebca6b) >>> 0, 2166136261);
const disc = (x: number, z: number, r: number): Area => ({ minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r });
/** The flag colours, which `v` indexes. */
export const FLAG_COLOURS = ['#e63946', '#2a9d8f', '#f4a261', '#457b9d', '#8e5bbf', '#e9c46a'];

export function placeDressing(clear: (x: number, z: number, r: number) => boolean): Dressing {
  const items: Dress[] = [];
  const solids: Dressing['solids'] = [];
  const birds: Bird[] = [];
  const inPlaza = (x: number, z: number) => x > RACE_PLAZA.minX - 1 && x < RACE_PLAZA.maxX + 1 && z > RACE_PLAZA.minZ - 1 && z < RACE_PLAZA.maxZ + 1;
  const ok = (x: number, z: number, r: number) => !keepClear(x, z) && Math.hypot(x, z) < DRESS_RADIUS && clear(x, z, r);
  const cone = (x: number, z: number, rot: number) => {
    items.push({ kind: 'cone', x, z, rot, v: 0 });
    solids.push({ area: disc(x, z, 0.2), h: 0.3 });
  };
  const put = (kind: DressKind, x: number, z: number, rot: number, v = 0, solid = 0) => {
    items.push({ kind, x, z, rot, v });
    if (solid) solids.push({ area: disc(x, z, solid) });
  };

  // Signs and roadworks on the corners, now and then.
  for (const it of cityStreetscape().intersections) {
    if (Math.hypot(it.x, it.z) > DRESS_RADIUS) continue;
    const r = rng(hash(it.i, it.j, 4001));
    const sx = r() < 0.5 ? -1 : 1;
    const sz = r() < 0.5 ? -1 : 1;
    // A pole on the sidewalk just past the signal pole, along one street or the other, facing the road.
    const alongX = r() < 0.5;
    const x = it.x + sx * (alongX ? 8.5 : 5);
    const z = it.z + sz * (alongX ? 5 : 8.5);
    const rot = alongX ? (sz < 0 ? 0 : Math.PI) : -sx * (Math.PI / 2);
    const roll = r();
    if (roll < 0.5) {
      if (ok(x, z, 0.5)) put('streetSign', x, z, rot, 0, 0.15);
    } else if (roll < 0.72) {
      if (ok(x, z, 0.5)) put('warning', x, z, rot, 0, 0.15);
    }
    // Roadworks at a few: a barrier along the kerb, and cones round it.
    if (r() < 0.12 && !inPlaza(it.x, it.z)) {
      const bx = it.x + sx * (alongX ? 12 : 5.4);
      const bz = it.z + sz * (alongX ? 5.4 : 12);
      if (ok(bx, bz, 1.2) && ok(x, z, 0.5)) {
        // The barrier's long side (its model's z) runs along the kerb; low enough to hop, like the cones.
        put('barrier', bx, bz, alongX ? Math.PI / 2 : 0);
        solids.push({ area: { minX: bx - (alongX ? 0.9 : 0.55), maxX: bx + (alongX ? 0.9 : 0.55), minZ: bz - (alongX ? 0.55 : 0.9), maxZ: bz + (alongX ? 0.55 : 0.9) }, h: 0.5 });
        for (const o of [-1.4, 1.4]) cone(bx + (alongX ? o : 0), bz + (alongX ? 0 : o), r() * 6.28);
        cone(bx + (alongX ? 0 : -sx * 0.9), bz + (alongX ? -sz * 0.9 : 0), r() * 6.28);
      }
    }
  }

  // A parasol outside some shops, on the outer edge of the sidewalk.
  for (const l of cityLayout().lots) {
    if (l.hand || l.kind !== 'shop' || Math.hypot(l.x, l.z) > DRESS_RADIUS) continue;
    const r = rng(hash(Math.round(l.x), Math.round(l.z), 4002));
    if (r() > 0.6) continue;
    const off = (r() - 0.5) * l.w * 0.5;
    let x: number, z: number;
    // The street it faces, if it's right there (a front on the block's inside has no street by it); the parasol stands on the road side of the sidewalk's middle, clear of where people walk (streetlife LAT).
    const near = ROAD_W / 2 + WALK + 5; // fronts on a street stand 7 to 10 m from its middle; ones on the block's inside, 23 and more
    if (l.fz) {
      const dz = l.z + l.fz * (l.d / 2 + 0.15);
      const street = STREET_Z + PERIOD * Math.round((dz - STREET_Z) / PERIOD);
      if (Math.abs(dz - street) > near) continue;
      z = street - l.fz * 4.9;
      x = l.x + off;
    } else {
      const dx = l.x + l.fx * (l.w / 2 + 0.15);
      const street = STREET_X + PERIOD * Math.round((dx - STREET_X) / PERIOD);
      if (Math.abs(dx - street) > near) continue;
      x = street - l.fx * 4.9;
      z = l.z + off;
    }
    if (!inPlaza(x, z) && ok(x, z, 1.2)) put('parasol', x, z, r() * 6.28, r() < 0.5 ? 0 : 1, 0.35);
  }

  // Flags: a pole in each park's corner, at the corners of the race plaza, and at the end of the pier.
  const pole = (x: number, z: number, v: number, rot: number) => {
    if (ok(x, z, 0.8)) put('flag', x, z, rot, v, 0.12);
  };
  let k = 0;
  for (const p of cityLayout().parks) {
    const r = rng(hash(Math.round(p.x), Math.round(p.z), 4003));
    const h = p.size / 2 - 1.8;
    pole(p.x + (r() < 0.5 ? -h : h), p.z + (r() < 0.5 ? -h : h), k++ % FLAG_COLOURS.length, (r() - 0.5) * 0.6);
  }
  for (const [x, z] of [
    [RACE_PLAZA.minX + 1.5, RACE_PLAZA.minZ + 1.5],
    [RACE_PLAZA.maxX - 1.5, RACE_PLAZA.minZ + 1.5],
    [RACE_PLAZA.minX + 1.5, RACE_PLAZA.maxZ - 1.5],
    [RACE_PLAZA.maxX - 1.5, RACE_PLAZA.maxZ - 1.5],
  ])
    pole(x, z, 0, 0);
  // The pier is outside DRESS_RADIUS, so this one doesn't go through `ok`.
  items.push({ kind: 'flag', x: PIER.x + 2.5, z: PIER.to + 1.5, rot: 0, v: 3 });
  solids.push({ area: disc(PIER.x + 2.5, PIER.to + 1.5, 0.12) });

  // Pigeons, in little flocks on the sidewalks.
  const pr = rng(4004);
  for (let tries = 0, flocks = 0; tries < 400 && flocks < 14; tries++) {
    const i = Math.floor((pr() - 0.5) * 6);
    const j = Math.floor((pr() - 0.5) * 6);
    const alongX = pr() < 0.5;
    const side = pr() < 0.5 ? -1 : 1;
    const along = (pr() - 0.5) * PERIOD * 0.7;
    const x = alongX ? STREET_X + PERIOD * (i + 0.5) + along : STREET_X + PERIOD * i + side * 5.3;
    const z = alongX ? STREET_Z + PERIOD * j + side * 5.3 : STREET_Z + PERIOD * (j + 0.5) + along;
    if (surfaceAt(x, z) !== 'walk' || !ok(x, z, 1.5) || inPlaza(x, z)) continue;
    flocks++;
    for (let b = 0, n = 2 + Math.floor(pr() * 3); b < n; b++) birds.push({ kind: 'pigeon', x: x + (pr() - 0.5) * (alongX ? 2.2 : 0.7), z: z + (pr() - 0.5) * (alongX ? 0.7 : 2.2), rot: pr() * 6.28 });
  }

  // Gulls: a few standing on the sand, and some wheeling over the water.
  const gr = rng(4005);
  for (let tries = 0, stood = 0; tries < 200 && stood < 10; tries++) {
    const th = gr() * Math.PI * 2;
    const { land, shore } = coastAt(th);
    const rr = land + (shore - land) * (0.35 + gr() * 0.3);
    const x = Math.cos(th) * rr;
    const z = Math.sin(th) * rr;
    if (surfaceAt(x, z) !== 'sand' || Math.abs(x - PIER.x) < 6 || Math.hypot(x, z) > 330) continue;
    stood++;
    birds.push({ kind: 'gull', x, z, rot: gr() * 6.28 });
  }
  for (let n = 0; n < 12; n++) {
    const th = gr() * Math.PI * 2;
    const { shore } = coastAt(th);
    const rr = shore + 6 + gr() * 24;
    birds.push({ kind: 'gull', x: Math.cos(th) * rr, z: Math.sin(th) * rr, rot: 0, orbit: { r: 6 + gr() * 14, y: 9 + gr() * 12, w: (0.25 + gr() * 0.25) * (gr() < 0.5 ? -1 : 1), a: gr() * 6.28 } });
  }
  return { items, birds, solids };
}
