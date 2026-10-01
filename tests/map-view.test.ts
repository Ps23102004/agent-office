import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapOffset, waypointIndicator } from '../src/client/ui/map-view.ts';

test('the heading-up map puts forward above you and keeps a distant waypoint at the edge', () => {
  for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const p = mapOffset({ x: Math.sin(heading) * 10, z: Math.cos(heading) * 10 }, { x: 0, z: 0 }, heading, 2);
    assert.ok(Math.abs(p.x) < 1e-8);
    assert.ok(Math.abs(p.y + 20) < 1e-8);
  }
  const edge = waypointIndicator({ x: 300, y: 400 }, 80);
  assert.deepEqual({ x: edge.x, y: edge.y, offEdge: edge.offEdge }, { x: 48, y: 64, offEdge: true });
  assert.equal(waypointIndicator({ x: 0, y: 0 }, 80).offEdge, false);
});
