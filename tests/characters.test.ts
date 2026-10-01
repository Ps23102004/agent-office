import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { HAIR_STYLES } from '../src/shared/avatar.js';
import { HIPS } from '../src/client/player.js';
import { handGeometry, hairGeometry, headGeometry, legGeometry } from '../src/client/world/character.js';
import { CROWD, pickLook } from '../src/client/world/crowd.js';
import { MAX_PEOPLE, buildStreetLife } from '../src/client/world/streetlife.js';
import { STREET_Z, rng } from '../src/shared/city.js';

const box = (g: THREE.BufferGeometry) => (g.computeBoundingBox(), g.boundingBox!);

test('every hair style is one painted geometry (one draw call, however curly), and bald is none', () => {
  for (const style of HAIR_STYLES) {
    const g = hairGeometry(style);
    if (style === 'Bald') {
      assert.equal(g, null);
      continue;
    }
    assert.ok(g?.attributes.color, `${style} has no colors`);
    // On the head (0.34 round, its center at 0,0,0), not floating off it.
    const b = box(g);
    assert.ok(b.max.y < 0.75 && b.min.y > -0.6 && Math.abs(b.max.x) < 0.5, `${style} ${JSON.stringify(b)}`);
  }
});

test("a person's feet stay on the floor, their hands where the props are held, and their head round", () => {
  // The sole's bottom is the floor, HIPS under the leg's pivot.
  assert.ok(Math.abs(box(legGeometry()).min.y + HIPS) < 0.015, `sole at ${box(legGeometry()).min.y}`);
  for (const side of [1, -1] as const) {
    const b = box(handGeometry(side));
    // The palm's middle is where the mug, the cigarette and the thumbs-up all hang (y -0.38 down the arm).
    assert.ok(Math.abs((b.min.y + b.max.y) / 2 + 0.38) < 0.03);
    // Its thumb is on the side toward the body.
    assert.ok(side > 0 ? b.max.x > -b.min.x : -b.min.x > b.max.x);
  }
  const h = box(headGeometry());
  assert.ok(h.max.z < 0.4 && Math.abs(h.max.x) < 0.38);
});

test('the crowd: every part paints, feet reach the ground, and a kid only ever walks with someone', () => {
  for (const [k, make] of Object.entries(CROWD)) assert.ok(make().attributes.color, k);
  // A leg hangs from the hip, 0.82 up for someone of height 1.
  assert.ok(Math.abs(box(CROWD.leg()).min.y + 0.82) < 0.02);
  const r = rng(7);
  const kids = { alone: 0, paired: 0 };
  for (let i = 0; i < 400; i++) {
    const side = i % 3 === 0 ? 0 : i % 3 === 1 ? -1 : 1;
    const look = pickLook(r, side);
    if (look.build === 'kid') kids[side > 0 ? 'paired' : 'alone']++;
    assert.ok(!(look.hat && look.hair === 'bun'), 'a bun under a hat');
  }
  assert.equal(kids.alone, 0);
  assert.ok(kids.paired > 10);
});

test('the whole crowd is one BatchedMesh (and its outline), only showing the people who are out', () => {
  const life = buildStreetLife();
  const batched = life.group.children.filter((o) => (o as THREE.BatchedMesh).isBatchedMesh && o.name.startsWith('crowd')) as THREE.BatchedMesh[];
  assert.equal(batched.length, 2);
  for (let i = 0; i < 30; i++) life.update(1000 + i / 30, 1 / 30, 0, { x: 0, z: STREET_Z }, [], 12);
  const out = life.people.filter((p) => p.on).length;
  assert.ok(out > 0);
  const [crowd] = batched;
  let heads = 0;
  for (let p = 0; p < MAX_PEOPLE; p++) if (crowd.getVisibleAt(p * 12 + 1)) heads++;
  // Someone gone in at a door is out but not shown.
  assert.ok(heads <= out && heads > out / 2, `${heads} heads for ${out} people`);
});
