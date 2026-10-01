import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FLYOVER, flyover, skipTitle, titleLook, RELOADED_KEY } from '../src/client/ui/title.js';
import { cityLayout } from '../src/shared/city.js';

/** As tall as the office tower is likely to get above the street, a few floors up. */
const OFFICE_TOP = 30;

// The title screen (ui/title.ts): which holiday it wears, when it's skipped, and its flight round the island.

const OCT = Date.UTC(2026, 9, 1, 12);
const JUNE = Date.UTC(2026, 5, 1, 12);

test('the title wears what the office has up, or the calendar before the office has said', () => {
  assert.equal(titleLook(undefined, OCT, 0), 'halloween');
  assert.equal(titleLook(undefined, Date.UTC(2026, 11, 5), 0), 'christmas');
  assert.equal(titleLook(undefined, JUNE, 0), 'plain');
  // The office turned the holidays off, or picked one out of season.
  assert.equal(titleLook(null, OCT, 0), 'plain');
  assert.equal(titleLook('christmas', JUNE, 0), 'christmas');
});

test('the title is skipped when asked, or once after reloading into a new version', () => {
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, removeItem: (k: string) => void store.delete(k) };
  assert.equal(skipTitle('', storage), false);
  assert.equal(skipTitle('?skipTitle', storage), true);
  store.set(RELOADED_KEY, '1');
  assert.equal(skipTitle('', storage), true);
  assert.equal(skipTitle('', storage), false, 'only the once');
  assert.equal(skipTitle('', null), false);
});

test('the flight starts at its first spot, loops back to it, and keeps to the street height given', () => {
  const at = new THREE.Vector3();
  const look = new THREE.Vector3();
  flyover(0, at, look, -3.6);
  assert.ok(at.distanceTo(new THREE.Vector3(FLYOVER[0].at[0], FLYOVER[0].at[1] - 3.6, FLYOVER[0].at[2])) < 1e-6);
  assert.ok(look.distanceTo(new THREE.Vector3(FLYOVER[0].look[0], FLYOVER[0].look[1] - 3.6, FLYOVER[0].look[2])) < 1e-6);
  const end = new THREE.Vector3();
  flyover(0.9999, end, look, -3.6);
  assert.ok(end.distanceTo(at) < 1, 'nearly round is nearly back');
  flyover(2.25, end, look, -3.6);
  const quarter = new THREE.Vector3();
  flyover(0.25, quarter, look, -3.6);
  assert.ok(end.distanceTo(quarter) < 1e-6, 'it wraps');
  // Never down among the street's trees and lamps.
  for (let u = 0; u < 1; u += 0.01) {
    flyover(u, at, look, 0);
    assert.ok(at.y > 7, `over the trees at ${u}`);
  }
});

test('the flight clears every building in town, and the office tower', () => {
  const at = new THREE.Vector3();
  const look = new THREE.Vector3();
  const boxes = [...cityLayout().lots, { kind: 'office', x: 0, z: 0, w: 40, d: 30, h: OFFICE_TOP }];
  const near: string[] = [];
  for (let u = 0; u < 1; u += 0.002) {
    flyover(u, at, look, 0);
    for (const b of boxes) {
      const out = Math.max(Math.abs(at.x - b.x) - b.w / 2, Math.abs(at.z - b.z) - b.d / 2);
      if (Math.max(out, at.y - b.h) < 2) near.push(`${u.toFixed(3)}: ${b.kind} at (${Math.round(b.x)}, ${Math.round(b.z)}) ${Math.round(b.h)} m high, camera at ${at.toArray().map(Math.round)}`);
    }
  }
  assert.deepEqual(near, []);
});
