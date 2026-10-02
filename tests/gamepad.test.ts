import test from 'node:test';
import assert from 'node:assert/strict';
import { readPad, stick } from '../src/client/gamepad.js';

// A pad in the standard layout: the left stick steers, the triggers are the pedals, and a button
// press counts once (a tap), not every frame it's held.

const pad = (axes: number[], pressed: Record<number, number> = {}) => ({
  connected: true,
  mapping: 'standard',
  axes,
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: (pressed[i] ?? 0) > 0.5, value: pressed[i] ?? 0 })),
});

function plugIn(t: { after: (fn: () => void) => void }, pads: () => unknown[]) {
  const was = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: pads }, configurable: true });
  t.after(() => (was ? Object.defineProperty(globalThis, 'navigator', was) : delete (globalThis as { navigator?: unknown }).navigator));
}

test('the stick ignores a worn middle, steers finely near it, and reaches full lock', () => {
  assert.equal(stick(0.1), 0);
  assert.equal(stick(-0.1), 0);
  assert.equal(stick(1), 1);
  assert.equal(stick(-1), -1);
  assert.ok(stick(0.5) > 0 && stick(0.5) < 0.5, `half way is a gentle ${stick(0.5).toFixed(2)}`);
  assert.ok(stick(0.6) > stick(0.5), 'and it only grows');
});

test('the triggers are the pedals, the stick the wheel (left is +), and a button taps once while held', (t) => {
  let now = [pad([-1, 0], { 7: 0.8, 6: 0.02, 0: 1, 3: 1 })];
  plugIn(t, () => now);
  const a = readPad()!;
  assert.equal(a.turn, 1, 'stick hard left: full lock left');
  assert.equal(a.gas, 0.8);
  assert.equal(a.brake, 0, 'a trigger at rest is nothing');
  assert.equal(a.handbrake, true);
  assert.ok(a.tapped.has('out'));
  assert.equal(readPad()!.tapped.size, 0, 'still held: no second tap');
  now = [pad([0, 0])];
  readPad();
  now = [pad([0, 0], { 3: 1 })];
  assert.ok(readPad()!.tapped.has('out'), 'let go and pressed again: another');
  now = [];
  assert.equal(readPad(), null, 'unplugged');
});
