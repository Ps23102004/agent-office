import { route } from '../src/shared/route.ts';
import { coastAt } from '../src/shared/city.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampMapCenter, DistrictBanner, mapLabels, mapOffset, onCityStreet, waypointArrival, waypointIndicator, wheelPixels } from '../src/client/ui/map-view.ts';

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

test('wheel zoom treats pixels, lines and pages as the same distance', () => {
  assert.equal(wheelPixels(48, 0, 600), 48);
  assert.equal(wheelPixels(3, 1, 600), 48);
  assert.equal(wheelPixels(0.08, 2, 600), 48);
  assert.equal(wheelPixels(-3, 1, 600), -48);
});

test('panning keeps land visible at every zoom without pulling the player back home', () => {
  const at = { x: 339, z: -339 };
  assert.deepEqual(clampMapCenter(at, 800, 600, 4), at);
  for (const scale of [0.4, 1, 4]) for (const angle of [0, Math.PI / 4, Math.PI, -Math.PI / 2]) {
    const center = clampMapCenter({ x: Math.cos(angle) * 10000, z: Math.sin(angle) * 10000 }, 800, 600, scale);
    assert.ok(Math.hypot(center.x, center.z) - 300 / scale <= coastAt(angle).land - 49.99);
  }
  assert.deepEqual(clampMapCenter({ x: 0, z: 0 }, 800, 600, 1), { x: 0, z: 0 });
});

test('the minimap is for streets, including outside a venue but not inside the office or its wing', () => {
  assert.equal(onCityStreet({ x: 0, z: 0 }), false);
  assert.equal(onCityStreet({ x: 18, z: 0 }), false);
  assert.equal(onCityStreet({ x: 16, z: -16 }, 1), false);
  assert.equal(onCityStreet({ x: 16, z: -16 }, 0), true);
  assert.equal(onCityStreet({ x: 68, z: 11 }), false);
  assert.equal(onCityStreet({ x: 68, z: 19 }), true);
  assert.equal(onCityStreet({ x: 0, z: 27 }), true);
});

test('arrival needs the road approach, not a shortcut across a block, and keeps the walk to a landmark', () => {
  const destination = { x: 84, z: 0 }, path = route({ x: 0, z: 27 }, destination);
  assert.equal(waypointArrival({ x: 84, z: 10 }, destination, path).arrived, true);
  assert.equal(waypointArrival({ x: 84, z: 16 }, destination, path).arrived, false);
  assert.equal(waypointArrival({ x: 72, z: 0 }, destination, path).arrived, false, '12 m away through the block is not the road end');
  assert.equal(waypointArrival(destination, destination, null).arrived, false);
  const office = { x: 0, z: 0 }, officePath = route({ x: 0, z: 83 }, office);
  const approach = waypointArrival({ x: 0, z: 27 }, office, officePath);
  assert.deepEqual(approach, { approached: true, arrived: false }, 'the road end is not the office yet');
  assert.equal(waypointArrival({ x: 0, z: 13 }, office, officePath, approach.approached).arrived, true, 'finish the dotted walk to the office');
  assert.equal(waypointArrival({ x: 0, z: 13 }, office, officePath).arrived, false, 'being near the building alone does not clear it');
});

test('district banners wait for time or distance and cool down between crossings', () => {
  const banner = new DistrictBanner();
  assert.equal(banner.update(0, { x: 79, z: 0 }), null);
  assert.equal(banner.update(100, { x: 81, z: 0 }), null);
  assert.equal(banner.update(200, { x: 79, z: 0 }), null, 'a wobble cancels the candidate');
  assert.equal(banner.update(300, { x: 81, z: 0 }), null);
  assert.equal(banner.update(2299, { x: 82, z: 0 }), null);
  assert.equal(banner.update(2300, { x: 82, z: 0 }), 'Market Row');
  assert.equal(banner.update(2400, { x: 79, z: 0 }), null);
  assert.equal(banner.update(4400, { x: 78, z: 0 }), null, 'cooldown still holds');
  assert.equal(banner.update(7300, { x: 78, z: 0 }), 'Old Town');
  assert.equal(banner.update(12300, { x: 81, z: 0 }), null);
  assert.equal(banner.update(12400, { x: 111, z: 0 }), 'Market Row', '30 m into a district can commit sooner');
  assert.equal(banner.update(18000, { x: 231, z: 0 }), null);
  banner.pause();
  assert.equal(banner.update(22000, { x: 231, z: 0 }), null, 'time indoors does not count');
});

test('labels keep priority, avoid icons and each other, and reveal more as places spread apart', () => {
  const labels = [
    { id: 'park', x: 200, y: 200, width: 80, priority: 10 },
    { id: 'office', x: 200, y: 200, width: 80, priority: 90 },
    { id: 'race', x: 200, y: 200, width: 80, priority: 80 },
    { id: 'arena', x: 200, y: 200, width: 80, priority: 80 },
    { id: 'cafe', x: 200, y: 200, width: 80, priority: 60 },
  ];
  const icons = [{ x: 188, y: 188, width: 24, height: 24 }];
  const tight = mapLabels(labels, 800, 600, icons);
  assert.equal(tight[0].id, 'office');
  assert.ok(tight.length < labels.length);
  for (const [i, a] of tight.entries()) {
    for (const b of tight.slice(i + 1)) assert.ok(a.left + a.width <= b.left || b.left + b.width <= a.left || a.top + 16 <= b.top || b.top + 16 <= a.top);
    assert.ok(a.left + a.width <= 188 || a.left >= 212 || a.top + 16 <= 188 || a.top >= 212);
  }
  assert.equal(mapLabels(labels.map((l, i) => ({ ...l, x: 100 + i * 130 })), 800, 600).length, labels.length);
  assert.ok(mapLabels([{ ...labels[0], x: -300 }], 800, 600).length === 0, 'offscreen labels stay offscreen');
});
