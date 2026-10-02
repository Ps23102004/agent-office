import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LOT_PAVING } from '../src/shared/garage.js';
import {
  GATE_PYLONS,
  NEIGHBOURS,
  OFFICE_BLOCK,
  PERIOD,
  RACE_PLAZA,
  RUNWAY_ARENA,
  RUNWAY_RACE,
  STOP_AT,
  STOP_LINE,
  STREET_X,
  STREET_Z,
  TREE_GAP,
  ZEBRA,
  atShopDoor,
  cityDressing,
  cityLayout,
  citySolids,
  cityStreetscape,
  footprint,
  neighbourArea,
  parkHedges,
  surfaceAt,
} from '../src/shared/city.js';
import { CITY_GATE } from '../src/shared/circuit.js';
import { CITY_ARENA_GATE } from '../src/shared/arena.js';
import { VENUES, frontZ } from '../src/shared/venues.js';
import { poleOnly } from '../src/client/world/dressing.js';
import { LAT, buildStreetLife, crossAt, nextCrossing } from '../src/client/world/streetlife.js';

// Where things are put in the city, and what it keeps clear: the garage's lots, the crossings, the parks, the lamps and the
// sidewalk furniture. Pure numbers (and one simulated minute of street life), no WebGL.

const touches = (a: { minX: number; maxX: number; minZ: number; maxZ: number }, b: typeof a) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;

test("the garage's lots are paved only on the office's own block, never over a road or the avenues' sidewalks", () => {
  assert.equal(LOT_PAVING.length, 2);
  for (const b of LOT_PAVING) {
    assert.ok(b.minX >= OFFICE_BLOCK.minX && b.maxX <= OFFICE_BLOCK.maxX && b.minZ >= OFFICE_BLOCK.minZ && b.maxZ <= OFFICE_BLOCK.maxZ, 'inside the block');
    assert.ok(b.maxX > b.minX && b.maxZ > b.minZ);
    for (let x = b.minX + 0.25; x < b.maxX; x += 0.5) for (let z = b.minZ + 0.25; z < b.maxZ; z += 0.5) assert.notEqual(surfaceAt(x, z), 'road', `paving over the road at ${x}, ${z}`);
  }
});

test('cars wait behind the stop line, which is behind the zebra the walkers cross on', () => {
  assert.ok(ZEBRA.from > 4 && ZEBRA.to > ZEBRA.from, 'the zebra starts outside the intersection');
  assert.ok(LAT > ZEBRA.from && LAT < ZEBRA.to, 'walkers cross on the zebra');
  assert.ok(STOP_LINE.from > ZEBRA.to && STOP_LINE.to > STOP_LINE.from, 'the stop line is behind the zebra');
  assert.ok(STOP_AT > STOP_LINE.to, 'the bumper stops short of the line');
});

test('in a minute and a half of street life no stopped car has its nose on a zebra', () => {
  const life = buildStreetLife();
  const near = { x: 0, z: STREET_Z };
  let t = 1000;
  let stopped = 0;
  let worst = Infinity;
  // Stopped is stopped in two looks half a second apart (a car just put on the road is at rest for a moment).
  const was = new Set<number>();
  for (let i = 0; i < 90 * 30; i++) {
    t += 1 / 30;
    life.update(t, 1 / 30, 0.2, near, [{ x: near.x, z: near.z, vx: 0, vz: 0 }], 12.5);
    if (i % 15) continue;
    const now = new Set<number>();
    for (const v of life.vehicles) {
      if (!v.on || v.v > 0.05 || v.path) continue;
      now.add(v.id);
      if (!was.has(v.id)) continue;
      // Its nose's distance from the middle of the crossing it's heading for.
      const o = v.axis === 'x' ? STREET_X : STREET_Z;
      const ahead = (crossAt(o, nextCrossing(v.s, v.dir, o)) - v.s) * v.dir - v.len / 2;
      if (ahead > 40) continue;
      stopped++;
      worst = Math.min(worst, ahead);
    }
    was.clear();
    for (const id of now) was.add(id);
  }
  assert.ok(stopped > 30, `${stopped} stopped cars seen`);
  assert.ok(worst >= ZEBRA.to - 0.05, `a car stopped with its nose ${worst.toFixed(2)} m from the crossing, on the zebra (${ZEBRA.to})`);
});

test('the two gates\' runways across the race plaza lie on it and do not touch', () => {
  for (const r of [RUNWAY_RACE, RUNWAY_ARENA]) assert.ok(r.minX >= RACE_PLAZA.minX && r.maxX <= RACE_PLAZA.maxX && r.minZ >= RACE_PLAZA.minZ && r.maxZ <= RACE_PLAZA.maxZ);
  assert.ok(!touches(RUNWAY_RACE, RUNWAY_ARENA), 'the arena runway is laid over the red one');
  // Each still runs through its own gate.
  assert.ok(CITY_GATE.x > RUNWAY_RACE.minX && CITY_GATE.x < RUNWAY_RACE.maxX);
  assert.ok(CITY_ARENA_GATE.x > RUNWAY_ARENA.minX && CITY_ARENA_GATE.x < RUNWAY_ARENA.maxX && CITY_ARENA_GATE.z > RUNWAY_ARENA.minZ && CITY_ARENA_GATE.z < RUNWAY_ARENA.maxZ);
});

test('no park swallows a hand-built neighbour, and the neighbours stand clear of every hedge', () => {
  const { parks } = cityLayout();
  for (const p of parks) {
    const block = { minX: p.x - p.size / 2, maxX: p.x + p.size / 2, minZ: p.z - p.size / 2, maxZ: p.z + p.size / 2 };
    for (const n of NEIGHBOURS) {
      const a = neighbourArea(n);
      assert.ok(!touches(block, a), `park at ${p.x}, ${p.z} holds the neighbour at ${n[0]}, ${n[1]}`);
      for (const h of parkHedges(p)) assert.ok(!touches(h, a), `a hedge of the park at ${p.x}, ${p.z} runs through the neighbour at ${n[0]}, ${n[1]}`);
    }
  }
  // The block where the roll said "park" is built up like any other.
  assert.ok(!parks.some((p) => p.x === -56 && p.z === 55));
  assert.ok(cityLayout().lots.some((l) => Math.abs(l.x + 56) < 30 && Math.abs(l.z - 55) < 30 && !l.hand), 'lots on it');
});

test('park trees stand at least TREE_GAP apart', () => {
  for (const p of cityLayout().parks) {
    for (let a = 0; a < p.trees.length; a++) {
      for (let b = a + 1; b < p.trees.length; b++) assert.ok(Math.hypot(p.trees[a].x - p.trees[b].x, p.trees[a].z - p.trees[b].z) >= TREE_GAP, `park at ${p.x}, ${p.z}`);
    }
  }
});

test("street lamps stand clear of the crossings' landings, the signal poles and the venues' doors", () => {
  const { lamps, poles } = cityStreetscape();
  assert.ok(lamps.length > 500);
  for (const l of lamps) {
    // Along its own street: how far from the nearest cross street's middle.
    const [along, origin] = l.ax === 0 ? [l.x, STREET_X] : [l.z, STREET_Z];
    const m = (((along - origin) % PERIOD) + PERIOD) % PERIOD;
    assert.ok(Math.min(m, PERIOD - m) > 9, `lamp at ${l.x}, ${l.z} is by a crossing`);
  }
  for (const l of lamps) {
    if (Math.hypot(l.x, l.z) > 120) continue;
    for (const p of poles) assert.ok(Math.hypot(l.x - p.x, l.z - p.z) > 4, `lamp at ${l.x}, ${l.z} is by a signal pole`);
  }
  for (const v of VENUES) {
    for (const l of lamps) assert.ok(Math.abs(l.x - v.door.x) > 1.5 || Math.abs(l.z - frontZ(v)) > 8, `lamp at ${l.x}, ${l.z} stands on ${v.name}'s door`);
  }
});

test("nothing on the sidewalk stands in the café's or the bar's doorway", () => {
  for (const v of VENUES) {
    assert.ok(atShopDoor(v.door.x, frontZ(v) + v.fz * 2, 0.2), `${v.name}'s door counts as a door`);
    for (const p of cityStreetscape().props) assert.ok(!atShopDoor(p.x, p.z, 0.2), `${p.kind} at ${p.x}, ${p.z}`);
    for (const d of cityDressing().items) if (d.kind !== 'flag') assert.ok(Math.abs(d.x - v.door.x) > 0.8 || Math.abs(d.z - frontZ(v)) > 5, `${d.kind} at ${d.x}, ${d.z} is in ${v.name}'s doorway`);
  }
});

test('the new street furniture: meters at the kerb, newspaper boxes, bike racks and bags, on shopping streets, clear of everything', () => {
  const { props, lamps, poles } = cityStreetscape();
  const kinds = new Set(props.map((p) => p.kind));
  for (const k of ['meter', 'paper', 'rack', 'bags'] as const) assert.ok(kinds.has(k), `no ${k} anywhere`);
  for (const p of props) {
    assert.equal(surfaceAt(p.x, p.z), 'walk', `${p.kind} at ${p.x}, ${p.z}`);
    // Not inside a lamp post or a signal pole.
    for (const l of lamps) assert.ok(Math.hypot(l.x - p.x, l.z - p.z) > 0.5, `${p.kind} is in a lamp`);
    for (const q of poles) assert.ok(Math.hypot(q.x - p.x, q.z - p.z) > 0.5, `${p.kind} is in a signal pole`);
  }
  // Nothing sits on another prop: their footprints don't overlap.
  const fresh = new Set(['meter', 'paper', 'rack', 'bags']);
  for (let a = 0; a < props.length; a++) {
    for (let b = a + 1; b < props.length; b++) {
      if (!fresh.has(props[a].kind) && !fresh.has(props[b].kind)) continue;
      if (Math.abs(props[a].x - props[b].x) > 3 || Math.abs(props[a].z - props[b].z) > 3) continue;
      assert.ok(!touches(footprint(props[a]), footprint(props[b])), `${props[a].kind} and ${props[b].kind} overlap at ${props[a].x.toFixed(1)}, ${props[a].z.toFixed(1)}`);
    }
  }
  // They're solid, at their own height.
  for (const p of props.filter((p) => p.kind === 'meter' || p.kind === 'rack')) assert.ok(citySolids(p.x, p.z, 0.05).length >= 1, `${p.kind} is solid`);
});

test("a sign's pole keeps its collars and loses what reaches out of it or stands above it", () => {
  // A pole 2 m tall (0.1 wide) and a blade 0.8 m out from it at the top, each a quad of two triangles on its own vertices.
  const pos: number[] = [];
  const idx: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]) => {
    const n = pos.length / 3;
    pos.push(...a, ...b, ...c, ...d);
    idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
  };
  quad([-0.05, 0, 0.05], [0.05, 0, 0.05], [0.05, 2, 0.05], [-0.05, 2, 0.05]);
  quad([0, 1.9, 0.05], [0, 1.9, 0.8], [0, 2.2, 0.8], [0, 2.2, 0.05]);
  quad([-0.05, 2.4, 0.05], [0.05, 2.4, 0.05], [0.05, 2.5, 0.05], [-0.05, 2.5, 0.05]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const out = poleOnly(g, 1, 0.14, 2.38);
  assert.equal(out.index!.count, 6, 'only the pole stays');
  assert.equal(g.index!.count, 18, 'the model itself is untouched');
});

test('the gate pylons and the runways do not overlap', () => {
  for (const p of GATE_PYLONS) for (const r of [RUNWAY_RACE, RUNWAY_ARENA]) assert.ok(!touches({ minX: p.x - p.half, maxX: p.x + p.half, minZ: p.z - p.half, maxZ: p.z + p.half }, r), `pylon ${p.id} stands on a runway`);
});
