import test from 'node:test';
import assert from 'node:assert/strict';
import { citySolids, cityDressing, surfaceAt } from '../src/shared/city.js';
import { DRESS_RADIUS } from '../src/shared/dressing.js';

const d = cityDressing();
const count = (k: string) => d.items.filter((i) => i.kind === k).length;

test('the city is dressed: signs, parasols, flags, birds', () => {
  for (const k of ['streetSign', 'warning', 'parasol', 'flag']) assert.ok(count(k) > 3, k);
  assert.ok(d.birds.some((b) => b.kind === 'pigeon') && d.birds.some((b) => b.kind === 'gull' && b.orbit));
});

test('the same every time, and all within reach of the middle', () => {
  assert.equal(cityDressing(), d);
  for (const i of d.items) if (i.kind !== 'flag') assert.ok(Math.hypot(i.x, i.z) < DRESS_RADIUS);
});

test('signs and parasols stand on a sidewalk, and their poles are solid', () => {
  for (const i of d.items) {
    if (i.kind === 'flag') continue;
    assert.equal(surfaceAt(i.x, i.z), 'walk', `${i.kind} at ${i.x.toFixed(1)}, ${i.z.toFixed(1)}`);
  }
  for (const s of d.solids) {
    const x = (s.area.minX + s.area.maxX) / 2;
    const z = (s.area.minZ + s.area.maxZ) / 2;
    assert.ok(citySolids(x, z, 0.5).includes(s.area));
  }
});

test('no two solids of the dressing sit on each other', () => {
  for (const s of d.solids) {
    const x = (s.area.minX + s.area.maxX) / 2;
    const z = (s.area.minZ + s.area.maxZ) / 2;
    const hit = citySolids(x, z, 0.1).filter((a) => a !== s.area && !d.solids.some((o) => o.area === a));
    assert.equal(hit.length, 0, `solid at ${x.toFixed(1)}, ${z.toFixed(1)} is in something`);
  }
});

test('birds stand on a sidewalk or the sand, never in a building', () => {
  for (const b of d.birds) {
    if (b.orbit) continue;
    assert.ok(['walk', 'sand'].includes(surfaceAt(b.x, b.z)), `${b.kind} at ${b.x.toFixed(1)}, ${b.z.toFixed(1)} on ${surfaceAt(b.x, b.z)}`);
  }
});
