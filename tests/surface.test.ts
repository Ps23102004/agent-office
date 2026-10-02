import test from 'node:test';
import assert from 'node:assert/strict';
import { DECALS, LINE_COUNT, decalUV, detailPixels } from '../src/client/world/surface.js';
import { racingLine } from '../src/shared/racingline.js';
import { TRACK, track } from '../src/shared/circuit.js';
import { LOT, SIDE_LOT } from '../src/shared/garage.js';
import { roadDecals } from '../src/client/world/city.js';
import { PERIOD, ROAD_W, STREET_X, STREET_Z } from '../src/shared/city.js';

// What the world's surfaces are made of (world/surface.ts): the grain's tile, the decals, the racing line's rubber.

test('the grain tile is the same every time, centred on mid grey, and seamless where it repeats', () => {
  const S = 64;
  const px = detailPixels(S);
  assert.deepEqual(px, detailPixels(S));
  for (let ch = 0; ch < 4; ch++) {
    let mean = 0;
    for (let i = 0; i < S * S; i++) mean += px[i * 4 + ch];
    mean /= S * S;
    // Far off (its smallest mipmap) it must leave a surface its own color.
    assert.ok(Math.abs(mean - 128) < 4, `channel ${ch} mean ${mean}`);
    // The step from one edge to the other, where it wraps, is no bigger than a step inside it.
    let seam = 0, inside = 0;
    for (let y = 0; y < S; y++) {
      seam += Math.abs(px[(y * S + S - 1) * 4 + ch] - px[y * S * 4 + ch]);
      inside += Math.abs(px[(y * S + S / 2) * 4 + ch] - px[(y * S + S / 2 - 1) * 4 + ch]);
    }
    assert.ok(seam < inside * 1.6 + S, `channel ${ch}: seam ${seam} vs inside ${inside}`);
  }
});

test('every decal has a cell of its own in the atlas', () => {
  const taken = new Set<string>();
  for (const [name, [c, r, w, h]] of Object.entries(DECALS)) {
    const many = name === 'digit' ? 8 : name === 'line' || name === 'code' ? LINE_COUNT : 1;
    for (let k = 0; k < many; k++) {
      for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) {
        const cell = name === 'digit' ? `${c + k + i},${r + j}` : name === 'line' || name === 'code' ? `${c + i},${r + k + j}` : `${c + i},${r + j}`;
        assert.ok(!taken.has(cell), `${name} ${k} overlaps at ${cell}`);
        taken.add(cell);
        const [x, y] = cell.split(',').map(Number);
        assert.ok(x < 8 && y < 8, `${name} ${k} is off the atlas`);
      }
      const [u0, v0, u1, v1] = decalUV(name as keyof typeof DECALS, k);
      assert.ok(u0 >= 0 && v0 >= 0 && u1 <= 1 && v1 <= 1 && u0 < u1 && v0 < v1, name);
    }
  }
});

test('the racing line stays on the asphalt, joins up over the start, and takes the inside at the apexes', () => {
  const { length: L, corners } = track();
  for (let s = 0; s < L; s += 1) assert.ok(Math.abs(racingLine(s)) <= TRACK.width / 2 - 1.7, `at ${s}`);
  assert.ok(Math.abs(racingLine(L - 0.5) - racingLine(0.5)) < 0.2);
  for (const c of corners) {
    if (Math.abs(c.turn) < 60) continue;
    // + is a driver's left, and a corner's turn is + to the right: its inside is the other way.
    const apex = racingLine((c.s0 + c.s1) / 2);
    assert.equal(Math.sign(apex), -Math.sign(c.turn), `${c.name} at ${c.s0}`);
  }
});

test('the racing line eases across the track, never swerving from side to side between corners close together', () => {
  const { length: L } = track();
  for (let s = 0; s < L; s += 1) {
    const across = Math.abs(racingLine(s + 1) - racingLine(s));
    assert.ok(across < 0.2, `${across.toFixed(2)} m across in the metre from ${s}`);
  }
});

test('the roads\' decals lie on the roads, clear of the crossings and of the garage lots laid over them', () => {
  const list = roadDecals();
  assert.ok(list.length > 200);
  const mod = (v: number) => ((v % PERIOD) + PERIOD) % PERIOD;
  for (const d of list) {
    // On a road: within its width of a street's centre line one way or the other...
    const offX = Math.min(mod(d.x - STREET_X), PERIOD - mod(d.x - STREET_X));
    const offZ = Math.min(mod(d.z - STREET_Z), PERIOD - mod(d.z - STREET_Z));
    assert.ok(Math.min(offX, offZ) < ROAD_W / 2, `${d.decal} at ${d.x}, ${d.z}`);
    // ...and not in an intersection or on its crossings.
    assert.ok(Math.max(offX, offZ) > 9, `${d.decal} at ${d.x}, ${d.z} is in a crossing`);
    for (const b of [LOT, SIDE_LOT]) assert.ok(!(d.x > b.minX && d.x < b.maxX && d.z > b.minZ && d.z < b.maxZ), `${d.decal} under a lot`);
  }
  // Arrows point the way their lane's traffic goes: right-hand traffic, so the lane's on the right of the arrow.
  const arrows = list.filter((d) => d.decal === 'arrow');
  assert.ok(arrows.length > 50);
  for (const a of arrows) {
    const hx = Math.sin(a.rotY), hz = Math.cos(a.rotY);
    const ox = Math.abs(hx) > 0.5 ? 0 : a.x - (STREET_X + Math.round((a.x - STREET_X) / PERIOD) * PERIOD);
    const oz = Math.abs(hx) > 0.5 ? a.z - (STREET_Z + Math.round((a.z - STREET_Z) / PERIOD) * PERIOD) : 0;
    // Facing (hx, hz) with -z north, the right is (-hz, hx).
    assert.ok(ox * -hz + oz * hx > 1, `arrow at ${a.x}, ${a.z} heading ${a.rotY}`);
  }
});
