import { test } from 'node:test';
import assert from 'node:assert/strict';
import { places, districtAt } from '../src/shared/places.ts';

test('places: unique ids, finite spots, the landmarks are there', () => {
  const all = places();
  assert.equal(new Set(all.map((p) => p.id)).size, all.length);
  for (const p of all) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z), p.id);
  for (const id of ['office', 'cafe', 'bar', 'race', 'arena', 'gas', 'parking']) assert.ok(all.some((p) => p.id === id), id);
  assert.equal(districtAt(0, 0), 'Old Town');
  assert.equal(districtAt(210, -220), 'Downtown');
});
