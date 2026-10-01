import test from 'node:test';
import assert from 'node:assert/strict';
import { NEIGHBOURS, RACE_PLAZA, cityLayout, citySolids, neighbourArea, surfaceAt } from '../src/shared/city.js';
import { SEATING_BY_ID, seatHere, seatPlace } from '../src/shared/layout.js';
import { VENUES, VENUE_SEATS, frontZ, venueAt, venueWalls, wallPieces } from '../src/shared/venues.js';

type Box = { minX: number; maxX: number; minZ: number; maxZ: number };
const overlaps = (a: Box, b: Box) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
/** Whether someone (a body 0.32 m round) standing at (x, z) is in a solid there. */
const blocked = (x: number, z: number) => citySolids(x, z, 2).some((c) => x > c.minX - 0.32 && x < c.maxX + 0.32 && z > c.minZ - 0.32 && z < c.maxZ + 0.32);

test('the café and the bar stand on lawn, off the roads and sidewalks, clear of the plaza, the neighbours and each other', () => {
  for (const v of VENUES) {
    for (const b of [v.box, v.terrace]) {
      for (let x = b.minX + 0.1; x < b.maxX; x += 0.5) for (let z = b.minZ + 0.1; z < b.maxZ; z += 0.5) assert.equal(surfaceAt(x, z), 'grass', `${v.id} at ${x}, ${z}`);
      assert.ok(!overlaps(b, RACE_PLAZA), `${v.id} clear of the race plaza`);
      for (const n of NEIGHBOURS) assert.ok(!overlaps(b, neighbourArea(n)), `${v.id} clear of the neighbour at ${n[0]}, ${n[1]}`);
    }
    // The terrace runs from the front wall out to the sidewalk.
    assert.equal(v.fz > 0 ? v.terrace.minZ : v.terrace.maxZ, frontZ(v));
    assert.equal(surfaceAt(v.door.x, frontZ(v) + v.fz * 5), 'walk', `${v.id}'s terrace comes out on the sidewalk`);
  }
  assert.ok(!overlaps(VENUES[0].box, VENUES[1].box));
});

test('the city leaves their lots to them: no building of its own drawn on them', () => {
  for (const l of cityLayout().lots) {
    if (VENUES.some((v) => overlaps(l.plot, v.box) || overlaps(l.plot, v.terrace))) assert.ok(l.hand, `the lot at ${l.x}, ${l.z} is left to the venue`);
  }
});

test("they're hollow: walls all round, the doorway open, room inside", () => {
  for (const v of VENUES) {
    const walls = venueWalls(v);
    assert.equal(walls.length, 5);
    const midX = (v.box.minX + v.box.maxX) / 2;
    const midZ = (v.box.minZ + v.box.maxZ) / 2;
    // Through the door, from the terrace into the room, nothing's in the way.
    for (let d = -1.5; d <= 1.5; d += 0.25) assert.ok(!blocked(v.door.x, frontZ(v) + v.fz * d), `${v.id}'s doorway at ${d}`);
    assert.ok(!blocked(midX, midZ), `${v.id} is open inside`);
    assert.equal(venueAt(midX, midZ), v);
    assert.equal(venueAt(v.door.x, frontZ(v) + v.fz * 2), null);
    // But the walls are solid: not through the front beside the door, the back or the sides.
    assert.ok(blocked(v.door.x + 2, frontZ(v)) && blocked(v.door.x - 1.2, frontZ(v)));
    assert.ok(blocked(midX, v.fz > 0 ? v.box.minZ : v.box.maxZ));
    assert.ok(blocked(v.box.minX, midZ) && blocked(v.box.maxX, midZ));
  }
});

test('every seat is somewhere you can sit, inside or out on the terrace, clear of the walls', () => {
  assert.ok(VENUE_SEATS.length >= 20);
  for (const s of VENUE_SEATS) {
    assert.equal(SEATING_BY_ID.get(s.id), s, `${s.id} is one of the office's seats`);
    assert.ok(s.street && !s.roof && (s.cafe || s.bar), `${s.id} is at the café or the bar`);
    for (let i = 0; i < s.places.length; i++) {
      const p = seatPlace(s, i);
      // The office takes it from someone on a floor (the street's yours from any), not on the roof.
      assert.ok(seatHere(p.key, false) && !seatHere(p.key, true), p.key);
      const v = VENUES.find((q) => q.id === (s.cafe ? 'cafe' : 'bar'))!;
      const inV = (b: Box, m = 0) => p.x > b.minX + m && p.x < b.maxX - m && p.z > b.minZ + m && p.z < b.maxZ - m;
      assert.ok(inV(v.box, 0.5) || inV(v.terrace, 0.3), `${p.key} is in ${v.id}`);
      assert.ok(!blocked(p.x, p.z), `${p.key} is clear of the walls`);
    }
  }
});

test('a front wall goes round its door and windows', () => {
  const pieces = wallPieces(0, 10, 0, 4, [
    { x0: 2, x1: 3, y0: 0, y1: 2.4 },
    { x0: 5, x1: 9, y0: 1, y1: 3 },
  ]);
  const area = pieces.reduce((a, p) => a + (p.x1 - p.x0) * (p.y1 - p.y0), 0);
  assert.ok(Math.abs(area - (40 - 2.4 - 8)) < 1e-9, 'the wall less its openings');
  // Nothing covers an opening.
  for (const p of pieces) {
    assert.ok(!(p.x0 < 3 && p.x1 > 2 && p.y0 < 2.4), 'not over the door');
    assert.ok(!(p.x0 < 9 && p.x1 > 5 && p.y0 < 3 && p.y1 > 1), 'not over the window');
  }
});
