import test from 'node:test';
import assert from 'node:assert/strict';
import { GRID, LIGHTHOUSE, PIER, ROAD_W, STREET_X, STREET_Z, WALK, cityLayout, citySolids, coastAt, shoreRespawn, shoreRespawns, surfaceAt } from '../src/shared/city.js';
import { CARS, GROUND, carFits, drive, paved, type CarPose, type Pedals } from '../src/shared/garage.js';
import { Garage } from '../src/server/garage.js';

const GAS: Pedals = { gas: 1, turn: 0, brake: false };
const still = (x = 0, z = 0, rotY = 0): CarPose => ({ x, z, rotY, speed: 0, steer: 0 });
const run = (p: CarPose, pedals: Pedals, seconds: number, surface?: Parameters<typeof drive>[4]) => {
  for (let t = 0; t < seconds; t += 1 / 60) p = drive(p, pedals, 1 / 60, 'lambo', surface);
  return p;
};

test('what is underfoot: roads, sidewalks, lawns and parks, the beach and the sea', () => {
  assert.equal(surfaceAt(100, STREET_Z), 'road');
  assert.equal(surfaceAt(100, STREET_Z + ROAD_W / 2 + WALK / 2), 'walk');
  assert.equal(surfaceAt(0, 0), 'walk', "the office's plaza");
  assert.equal(surfaceAt(60, STREET_Z + ROAD_W / 2 + WALK + 1), 'grass', 'a lawn');
  const park = cityLayout().parks[0];
  assert.equal(surfaceAt(park.x + 5, park.z + 5), 'grass', 'a park');
  assert.equal(surfaceAt(0, GRID.minZ - 5), 'grass', 'the verge past the ring road');
  const { land, shore } = coastAt(0);
  assert.equal(surfaceAt((land + shore) / 2, 0), 'sand');
  assert.equal(surfaceAt(shore + 1, 0), 'water');
  assert.equal(surfaceAt(2000, -2000), 'water', 'out to the horizon');
  assert.equal(surfaceAt(PIER.x, (PIER.from + PIER.to) / 2), 'walk', 'along the pier');
  assert.equal(surfaceAt(PIER.x, PIER.to - 1), 'water', 'and off the end of it');
  assert.equal(surfaceAt(LIGHTHOUSE.x, LIGHTHOUSE.z), 'sand', 'the lighthouse is on the beach');
});

test('the coast goes all the way round, past the ring road, with a beach everywhere', () => {
  for (let k = 0; k < 720; k++) {
    const th = (k / 720) * Math.PI * 2 - Math.PI;
    const { land, shore } = coastAt(th);
    assert.ok(shore - land >= 14, `a beach at ${th.toFixed(2)}`);
    // Along the ring road's outside edge, it's always the city's (never sand or sea).
    const c = Math.cos(th);
    const s = Math.sin(th);
    const r = Math.min(Math.abs(c) > 1e-9 ? (c > 0 ? GRID.maxX : -GRID.minX) / Math.abs(c) : Infinity, Math.abs(s) > 1e-9 ? (s > 0 ? GRID.maxZ : -GRID.minZ) / Math.abs(s) : Infinity);
    assert.ok(land > r + 10, `grass past the ring road at ${th.toFixed(2)}`);
    assert.ok(!['sand', 'water'].includes(surfaceAt(c * (r - 0.5), s * (r - 0.5))));
  }
  assert.deepEqual(coastAt(1), coastAt(1), 'the same every time');
});

test('out of the sea you come back on the nearest road, facing inland', () => {
  for (let k = 0; k < 64; k++) {
    const th = (k / 64) * Math.PI * 2;
    const r = coastAt(th).shore + 3 + (k % 5) * 20;
    const x = Math.cos(th) * r;
    const z = Math.sin(th) * r;
    assert.equal(surfaceAt(x, z), 'water');
    const at = shoreRespawn(x, z);
    assert.equal(surfaceAt(at.x, at.z), 'road', `${x.toFixed(0)},${z.toFixed(0)} → ${at.x},${at.z}`);
    assert.ok(Math.hypot(at.x - x, at.z - z) < 220, 'nearby');
    // Its nose points back toward the middle of the island.
    assert.ok(Math.sin(at.rotY) * at.x + Math.cos(at.rotY) * at.z < 0, 'facing inland');
    assert.ok(carFits(at, citySolids(at.x, at.z, 8)), 'with room for a car');
    // Every spot it might come back to is on a road with room for any of the cars and bikes.
    for (const spot of shoreRespawns(x, z)) {
      assert.equal(surfaceAt(spot.x, spot.z), 'road');
      for (const kind of ['lambo', 'ferrari', 'motorbike', 'bicycle'] as const) assert.ok(carFits(spot, citySolids(spot.x, spot.z, 8), kind));
    }
    // On foot, you're put back up the beach.
    const foot = shoreRespawn(x, z, true);
    assert.equal(surfaceAt(foot.x, foot.z), 'sand');
  }
});

test('the office takes a drive, and the jump back out of the sea, but no teleports', () => {
  let now = 1_000_000;
  const g = new Garage(() => (now += 1000));
  const blue = CARS.findIndex((c) => c.name === 'Blue Lambo');
  assert.ok(g.enter('ann', blue, 'driver'));
  const at = (x: number, z: number) => ({ ...still(x, z, Math.PI / 2), speed: 15 });
  // Into a building, however near: no.
  const lot = cityLayout().lots.find((l) => !l.hand && l.kind !== 'gas' && Math.hypot(l.x, l.z) < 200)!;
  assert.ok(!g.drive('ann', blue, at(lot.x, lot.z)), 'not inside a building');
  // Down the street east to the beach, 20 m a second.
  assert.ok(g.drive('ann', blue, at(9, 27)));
  assert.ok(!g.drive('ann', blue, at(200, 27)), 'not across town in a second');
  let x = 9;
  while (surfaceAt(x + 20, 27) !== 'water') assert.ok(g.drive('ann', blue, at((x += 20), 27)), `x ${x}`);
  while (surfaceAt(x + 1, 27) !== 'water') x += 1;
  assert.ok(g.drive('ann', blue, at(x, 27)), 'on the beach, by the water');
  assert.ok(!g.drive('ann', blue, at(x + 4, 27)), 'never in the water');
  // Back on the road out of the sea: one of the spots for the water it went into, not just anywhere.
  assert.ok(!g.drive('ann', blue, { ...shoreRespawns(0, -600)[0], speed: 0, steer: 0 }), 'not a respawn from another shore');
  assert.ok(g.drive('ann', blue, { ...shoreRespawns(x + 6, 27)[1], speed: 0, steer: 0 }), 'the jump back to the road');
});

test('a bicycle creeps across the sand from a standstill', () => {
  let p = still(coastAt(0).land + 3, 0, Math.PI / 2);
  for (let i = 0; i < 1200; i++) p = drive(p, GAS, 1 / 120, 'bicycle', 'sand');
  assert.ok(p.speed > 0.5 && p.x > coastAt(0).land + 6, `${p.speed.toFixed(2)} m/s`);
});

test('the beach is sand right into the corners, where the coast comes nearest the ring road', () => {
  for (let k = 0; k < 4000; k++) {
    const th = (k / 4000) * Math.PI * 2;
    const { land, shore } = coastAt(th);
    const pier = (r: number) => Math.abs(Math.cos(th) * r - PIER.x) < PIER.width;
    for (const r of [land + 0.5, (land + shore) / 2, shore - 0.5]) if (!pier(r)) assert.equal(surfaceAt(Math.cos(th) * r, Math.sin(th) * r), 'sand', `${th.toFixed(3)} ${r.toFixed(1)}`);
    assert.equal(surfaceAt(Math.cos(th) * (land - 0.5), Math.sin(th) * (land - 0.5)) === 'sand', false);
  }
});

test('off-road the tires grip less and the ground drags: grass is slippery, sand bogs you down', () => {
  const top = (surface?: Parameters<typeof drive>[4]) => run(still(), GAS, 12, surface).speed;
  assert.equal(top(), top('road'), 'a road unless said');
  assert.ok(Math.abs(top('road') - 20) < 1e-9);
  assert.ok(top('grass') < top('road') && top('sand') < top('grass'), `grass ${top('grass').toFixed(1)}, sand ${top('sand').toFixed(1)}`);
  // Onto the sand at speed, it bogs down to what the sand allows (not a dead stop).
  const bogged = run({ ...still(), speed: 20 }, GAS, 0.5, 'sand');
  assert.ok(bogged.speed > GROUND.sand.top * 20 && bogged.speed < 18);
  // A hard turn at speed on grass: the tires let go sooner, so it turns less sharply.
  const turn = (surface: Parameters<typeof drive>[4]) => run({ ...still(), speed: 12 }, { gas: 0, turn: 1, brake: false }, 0.8, surface).rotY;
  assert.ok(turn('grass') < turn('road'), `grass ${turn('grass').toFixed(2)} vs road ${turn('road').toFixed(2)}`);
  // Anywhere on the island a car can be; not in the sea.
  assert.ok(paved(60, STREET_Z + 10) && paved(coastAt(0).land + 3, 0) && !paved(coastAt(0).shore + 5, 0));
});

test("a park's hedge is open where its paths come out, wide enough to drive in", () => {
  for (const p of cityLayout().parks) {
    const edge = { x: p.x, z: p.z + p.size / 2, rotY: 0 };
    assert.ok(carFits(edge, citySolids(edge.x, edge.z, 6)), `into the park at ${p.x},${p.z}`);
    assert.ok(citySolids(p.x + p.size / 4, p.z + p.size / 2 - 0.25, 0.1).length > 0, 'hedge either side');
  }
  assert.ok(citySolids(STREET_X, STREET_Z, 1).length === 0);
});
