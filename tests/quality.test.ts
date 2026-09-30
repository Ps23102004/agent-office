import test from 'node:test';
import assert from 'node:assert/strict';
import { decorTicker, pixelRatioFor, QUALITY, quality, setGraphics, tooSoon } from '../src/client/quality.js';

// The Graphics setting's levels (quality.ts): how sharp, how fast, and how much moves.

test('the canvas is never drawn sharper than the screen or the level', () => {
  assert.equal(pixelRatioFor(QUALITY.battery, 2), 1.25);
  assert.equal(pixelRatioFor(QUALITY.balanced, 2), 1.5);
  assert.equal(pixelRatioFor(QUALITY.full, 3), 2);
  assert.equal(pixelRatioFor(QUALITY.battery, 1), 1);
});

test('a 30 fps cap draws every other frame on a 60 Hz screen and every fourth on 120 Hz', () => {
  for (const [hz, every] of [[60, 2], [120, 4]] as const) {
    let last = 0;
    let drawn = 0;
    for (let i = 1; i <= hz; i++) {
      const now = (i * 1000) / hz;
      if (tooSoon(now, last, 30)) continue;
      last = now;
      drawn++;
    }
    assert.equal(drawn, hz / every, `${hz} Hz`);
  }
  assert.equal(tooSoon(1, 0, Infinity), false);
});

test('decorations update at their own rate with all the time they missed', () => {
  setGraphics('battery');
  const tick = decorTicker();
  let updates = 0;
  let total = 0;
  for (let i = 0; i < 60; i++) {
    const dt = tick(1 / 60);
    if (dt) {
      updates++;
      total += dt;
    }
  }
  assert.ok(updates >= 14 && updates <= 15, `${updates} updates`);
  assert.ok(Math.abs(total - 1) < 1 / 15);
  setGraphics('full');
  assert.equal(quality.decorHz, 0);
  assert.equal(tick(0.01), 0.01);
});

test('service discovery is every 4 s while a worker works, and every 15 s otherwise', async () => {
  const { scanDue } = await import('../src/server/services.js');
  assert.equal(scanDue(4000, 0, true), true);
  assert.equal(scanDue(4000, 0, false), false);
  assert.equal(scanDue(15_000, 0, false), true);
});

test('a level redraws shadows for movement no faster than its own minimum', () => {
  assert.ok(QUALITY.battery.shadowMoveEvery >= 100 && QUALITY.battery.shadowMoveEvery < QUALITY.battery.shadowEvery);
  assert.ok(QUALITY.balanced.shadowMoveEvery >= 50 && QUALITY.balanced.shadowMoveEvery < QUALITY.balanced.shadowEvery);
});
