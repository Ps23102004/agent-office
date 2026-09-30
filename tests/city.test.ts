import test from 'node:test';
import assert from 'node:assert/strict';
import { NEIGHBOURS, PERIOD, RADIUS, ROAD_W, STREET_X, STREET_Z, WALK, cityLayout, cityPaved, neighbourArea, citySolids, cityStreetscape, lightPhase, POST_RADIUS, PROP_RADIUS } from '../src/shared/city.js';
import { LOT, SIDE_LOT, paved } from '../src/shared/garage.js';
import { ROAD } from '../src/shared/layout.js';

test('roads, sidewalks and crossings are paved', () => {
  assert.ok(cityPaved(100, STREET_Z), 'along the garage street');
  assert.ok(cityPaved(STREET_X, 150), 'down a cross street');
  assert.ok(cityPaved(STREET_X + PERIOD * 2, STREET_Z + PERIOD * 3), 'an intersection');
  assert.ok(cityPaved(60, STREET_Z + ROAD_W / 2 + WALK - 0.1), 'out on the sidewalk');
  assert.ok(!cityPaved(60, STREET_Z + ROAD_W / 2 + WALK + 0.5), 'past it is a lot');
  assert.ok(!cityPaved(RADIUS + 5, STREET_Z), 'and nothing past the edge');
});

test('the garage street is paved for the whole office, garage lots included', () => {
  for (const z of [ROAD.minZ + 0.5, 27, ROAD.maxZ - 0.5]) assert.ok(cityPaved(0, z) && paved(0, z));
  // The lots out front are the garage's; the city hands over to them.
  assert.ok(paved((LOT.minX + LOT.maxX) / 2, (LOT.minZ + LOT.maxZ) / 2));
  assert.ok(paved((SIDE_LOT.minX + SIDE_LOT.maxX) / 2, 0));
  assert.ok(paved(150, 27), 'far down the street, the city takes over');
});

test('a building is no place for a car, and something stands in the way there', () => {
  const lot = cityLayout().lots.find((l) => !l.hand && l.kind !== 'gas');
  assert.ok(lot);
  assert.ok(!cityPaved(lot.x, lot.z));
  const near = citySolids(lot.x, lot.z, 3);
  assert.ok(near.some((a) => lot.x > a.minX && lot.x < a.maxX && lot.z > a.minZ && lot.z < a.maxZ));
  // Nowhere near anything, far out on a road's middle.
  assert.deepEqual(citySolids(STREET_X + PERIOD * 3, STREET_Z + 20, 1), []);
});

test('no building stands on a road or a sidewalk', () => {
  const { lots, parks } = cityLayout();
  assert.ok(lots.length > 100 && parks.length > 3);
  for (const l of lots) {
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) assert.ok(l.kind === 'gas' || !cityPaved(l.x + ((dx * l.w) / 2) * 0.98, l.z + ((dz * l.d) / 2) * 0.98), `${l.kind} at ${l.x},${l.z}`);
  }
});

test('the gas station is on a forecourt cars can drive onto, past its pumps', () => {
  const gas = cityLayout().gas;
  assert.ok(gas);
  const p = gas.plot;
  const out = { x: (p.minX + p.maxX) / 2 - gas.fx * 3, z: (p.minZ + p.maxZ) / 2 - gas.fz * 3 };
  assert.ok(cityPaved(gas.plot.minX + 0.5, gas.plot.minZ + 0.5));
  assert.ok(citySolids(out.x, out.z, 40).length > 0);
});

test('signals and the street furniture stand where the grid puts them', () => {
  const { intersections, poles, lamps } = cityStreetscape();
  assert.ok(intersections.some((i) => i.i === 0 && i.j === 0 && i.x === STREET_X && i.z === STREET_Z));
  assert.equal(poles.length, intersections.length * 4);
  // Everything is on the sidewalk, and the office's own lamps out front are left to it.
  for (const p of [...lamps, ...poles, ...cityStreetscape().props]) assert.ok(cityPaved(p.x, p.z), `${p.x},${p.z}`);
  assert.ok(lamps.some((l) => l.hand) && lamps.some((l) => !l.hand));
  assert.ok(citySolids(poles[0].x, poles[0].z, 0.5).length > 0);
});

test('the city is the same every time', () => {
  const a = cityLayout();
  assert.equal(cityLayout(), a);
  assert.deepEqual(a.lots[7], cityLayout().lots[7]);
  assert.deepEqual(citySolids(60, 60, 20), citySolids(60, 60, 20));
  assert.deepEqual(lightPhase(1234.5, { i: 2, j: -1 }), lightPhase(1234.5, { i: 2, j: -1 }));
  assert.deepEqual(lightPhase(50, { x: STREET_X + PERIOD * 2, z: STREET_Z - PERIOD }), lightPhase(50, { i: 2, j: -1 }));
});

test('the lights: never green both ways, and walking only while the cars across are stopped', () => {
  for (const at of [{ i: 0, j: 0 }, { i: 3, j: -2 }]) {
    let seenGreenX = false;
    let seenGreenZ = false;
    for (let t = -50; t < 200; t += 0.25) {
      const p = lightPhase(t, at);
      assert.ok(!(p.x !== 'red' && p.z !== 'red'), `both open at ${t}`);
      if (p.walkX) assert.equal(p.z, 'red');
      if (p.walkZ) assert.equal(p.x, 'red');
      seenGreenX ||= p.x === 'green';
      seenGreenZ ||= p.z === 'green';
    }
    assert.ok(seenGreenX && seenGreenZ);
  }
});

test('the hand-built neighbours stand clear of every road and sidewalk', () => {
  for (const n of NEIGHBOURS) {
    const a = neighbourArea(n);
    for (let x = a.minX; x <= a.maxX; x += 0.5) for (let z = a.minZ; z <= a.maxZ; z += 0.5) assert.ok(!cityPaved(x, z), `${n[0]},${n[1]} at ${x},${z}`);
  }
});

test('a car cannot drive into the gas station shop, its pumps, sign or a house-yard tree', () => {
  const { gas, lots } = cityLayout();
  const shop = lots.find((l) => l.kind === 'gas')!;
  const hit = (x: number, z: number) => citySolids(x, z, 0.1).length > 0;
  assert.ok(hit(shop.x, shop.z), 'the shop');
  assert.ok(hit(gas!.sign.x, gas!.sign.z), 'the sign pole');
  assert.ok(hit((gas!.pumps[0].minX + gas!.pumps[0].maxX) / 2, (gas!.pumps[0].minZ + gas!.pumps[0].maxZ) / 2), 'a pump');
  const yard = lots.find((l) => l.yard)!.yard!;
  assert.ok(hit(yard.x, yard.z), 'a yard tree');
});

test('drawn furniture is exactly what is solid', () => {
  const { props, lamps } = cityStreetscape();
  assert.ok(props.every((p) => Math.hypot(p.x, p.z) <= PROP_RADIUS));
  const far = lamps.find((l) => !l.hand && Math.hypot(l.x, l.z) > POST_RADIUS)!;
  assert.deepEqual(citySolids(far.x, far.z, 0.1), []);
});
