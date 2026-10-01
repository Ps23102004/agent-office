import { cityLayout, LIGHTHOUSE, PIER, RACE_PLAZA } from './city.js';

// The streets' names (for the map's labels and the signs at the corners) are city.ts's: `streetName('z' | 'x', index)`.
export { streetName } from './city.js';
import { VENUES } from './venues.js';
import { CITY_GATE } from './circuit.js';
import { CITY_ARENA_GATE } from './arena.js';
import { GOLF_HOLE } from './layout.js';

// The island's places worth finding, for the world map, the minimap and the landmarks on the street
// (plain numbers, no three.js). Street coordinates: the office is at the middle, +z south toward the
// main road out front, downtown off to the north-east.

export type PlaceKind = 'office' | 'cafe' | 'bar' | 'race' | 'arena' | 'gas' | 'parking' | 'park' | 'golf' | 'pier' | 'lighthouse';

export interface Place {
  id: string;
  kind: PlaceKind;
  name: string;
  x: number;
  z: number;
  /** One line for the map's legend and tooltip. */
  blurb: string;
}

let cached: Place[] | null = null;

/** Every place on the island, the same on every page. */
export function places(): readonly Place[] {
  if (cached) return cached;
  const city = cityLayout();
  const out: Place[] = [
    { id: 'office', kind: 'office', name: 'Agent Office', x: 0, z: 0, blurb: 'Home: desks, garage and the rooftop bar' },
    ...VENUES.map((v) => ({ id: v.id, kind: v.id as PlaceKind, name: v.name, x: (v.box.minX + v.box.maxX) / 2, z: (v.box.minZ + v.box.maxZ) / 2, blurb: v.id === 'cafe' ? 'Coffee, lunch and a terrace' : 'Drinks, darts and pool' })),
    { id: 'race', kind: 'race', name: 'Race Circuit', x: CITY_GATE.x, z: CITY_GATE.z, blurb: 'Gate to the circuit: lap races and practice' },
    { id: 'arena', kind: 'arena', name: 'Arena', x: CITY_ARENA_GATE.x, z: CITY_ARENA_GATE.z, blurb: 'Gate to the free-for-all container yard' },
    { id: 'plaza', kind: 'park', name: 'Race Plaza', x: (RACE_PLAZA.minX + RACE_PLAZA.maxX) / 2, z: (RACE_PLAZA.minZ + RACE_PLAZA.maxZ) / 2, blurb: 'Where the circuit and arena gates stand' },
    { id: 'golf', kind: 'golf', name: 'Golf Hole', x: GOLF_HOLE.x, z: GOLF_HOLE.z, blurb: 'One hole, out front' },
    { id: 'pier', kind: 'pier', name: 'Pier', x: PIER.x, z: (PIER.from + PIER.to) / 2, blurb: 'Boards out over the sea' },
    { id: 'lighthouse', kind: 'lighthouse', name: 'Lighthouse', x: LIGHTHOUSE.x, z: LIGHTHOUSE.z, blurb: 'On the north-east point' },
  ];
  if (city.gas) {
    const p = city.gas.plot;
    out.push({ id: 'gas', kind: 'gas', name: 'Gas Station', x: (p.minX + p.maxX) / 2, z: (p.minZ + p.maxZ) / 2, blurb: 'Pumps and a shop' });
  }
  const deck = city.lots.find((l) => l.kind === 'deck');
  if (deck) out.push({ id: 'parking', kind: 'parking', name: 'Parking Deck', x: deck.x, z: deck.z, blurb: 'Multi-storey car park' });
  city.parks.forEach((p, i) => out.push({ id: `park-${i}`, kind: 'park', name: 'Park', x: p.x, z: p.z, blurb: 'Trees and paths' }));
  return (cached = out);
}

export type District = 'Downtown' | 'Old Town' | 'Market Row' | 'Suburbs' | 'Waterfront';

/** Which part of the island (x, z) is in, for the map's labels and the "entering" toast. */
export function districtAt(x: number, z: number): District {
  const r = Math.hypot(x, z);
  if (Math.hypot(x - 210, z + 220) < 150) return 'Downtown';
  if (r > 330) return 'Waterfront';
  if (r > 230) return 'Suburbs';
  if (r < 80) return 'Old Town';
  return 'Market Row';
}

/** Where to write each district's name on the map. */
export const DISTRICT_LABELS: readonly { name: District; x: number; z: number }[] = [
  { name: 'Old Town', x: -30, z: -40 },
  { name: 'Downtown', x: 210, z: -220 },
  { name: 'Market Row', x: -150, z: 120 },
  { name: 'Suburbs', x: -250, z: -200 },
  { name: 'Waterfront', x: 0, z: 360 },
];
