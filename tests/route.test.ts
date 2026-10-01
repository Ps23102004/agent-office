import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GRID, surfaceAt } from '../src/shared/city.ts';
import { places } from '../src/shared/places.ts';
import { route, snapToRoad } from '../src/shared/route.ts';

test('the route takes the shortest streets, snaps its ends and stays on the island', () => {
  assert.equal(route({ x: 5, z: 27 }, { x: 15, z: 27 })?.distance, 10);
  assert.equal(route({ x: 28, z: 5 }, { x: 84, z: 83 })?.distance, 134);
  assert.equal(route({ x: 28, z: 0 }, { x: 84, z: 0 })?.distance, 110, 'parallel streets need a detour to the nearest cross street');
  assert.equal(route({ x: 28, z: 27 }, { x: 28, z: 27 })?.distance, 0);
  assert.equal(route({ x: NaN, z: 0 }, { x: 0, z: 0 }), null);
  for (const place of places()) {
    const r = route({ x: 0, z: 0 }, place)!;
    assert.ok(r);
    assert.deepEqual(r.points[0], snapToRoad({ x: 0, z: 0 }));
    assert.deepEqual(r.points.at(-1), snapToRoad(place));
    let length = 0;
    r.points.forEach((p, i) => {
      assert.ok(p.x >= GRID.minX && p.x <= GRID.maxX && p.z >= GRID.minZ && p.z <= GRID.maxZ);
      assert.equal(surfaceAt(p.x, p.z), 'road');
      if (!i) return;
      const a = r.points[i - 1];
      assert.ok(a.x === p.x || a.z === p.z);
      length += Math.hypot(p.x - a.x, p.z - a.z);
    });
    assert.equal(length, r.distance);
  }
});
