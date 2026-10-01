import test from 'node:test';
import assert from 'node:assert/strict';
import { idleRace, type Racer } from '../src/shared/race.js';
import { countdownLights, mapProjection, raceGap, raceOrder, raceTime, speedReading } from '../src/client/ui/race-view.js';

const racer = (id: string, extra: Partial<Racer> = {}): Racer => ({ id, name: id, car: 0, slot: 0, lap: 0, checkpoint: -1, position: 1, ...extra });

test('lap clocks handle minute boundaries, absent laps and bad durations', () => {
  assert.equal(raceTime(59_999), '0:59.99');
  assert.equal(raceTime(60_000), '1:00.00');
  assert.equal(raceTime(0), '0:00.00');
  for (const missing of [undefined, -1, NaN, Infinity]) assert.equal(raceTime(missing), '—');
});

test('a late countdown packet agrees with the office clock, and all reds go out at zero', () => {
  const start = 100_000;
  assert.deepEqual(countdownLights(start, start - 5000), { lit: 1, text: 'Start in 5' });
  assert.deepEqual(countdownLights(start, start - 1200), { lit: 4, text: 'Start in 2' });
  assert.deepEqual(countdownLights(start, start - 1), { lit: 5, text: 'Start in 1' });
  assert.deepEqual(countdownLights(start, start), { lit: 0, text: 'GO!' });
  assert.deepEqual(countdownLights(start, start + 9000), { lit: 0, text: 'GO!' });
  assert.deepEqual(countdownLights(undefined, start), { lit: 0, text: 'Getting ready' });
});

test('the leaderboard respects server positions without changing the shared roster', () => {
  const state = idleRace();
  state.racers = [racer('second', { position: 2 }), racer('first')];
  assert.deepEqual(raceOrder(state).map((r) => r.id), ['first', 'second']);
  assert.equal(state.racers[0].id, 'second');
  state.racers = [racer('back', { position: 0, slot: 4 }), racer('front', { position: 0, slot: 0 })];
  assert.equal(raceOrder(state)[0].id, 'front');
});

test('live gaps report verified progress; finish gaps use line-crossing timestamps', () => {
  const state = idleRace();
  const lead = racer('leader', { lap: 2, checkpoint: 4 });
  const me = racer('me', { position: 2, lap: 1, checkpoint: 7 });
  state.racers = [me, lead];
  assert.equal(raceGap(state, lead), 'Leading');
  assert.equal(raceGap(state, me), '+1 lap');
  me.lap = 2; me.checkpoint = 2;
  assert.equal(raceGap(state, me), '+2 checkpoints');
  me.checkpoint = 4;
  assert.equal(raceGap(state, me), 'Same checkpoint');
  me.gap = 1234;
  assert.equal(raceGap(state, me), '+1.23s', 'the office timed it at the line');
  lead.finishedAt = 100_000; me.finishedAt = 102_345;
  assert.equal(raceGap(state, me), '+2.35s');
});

test('the general gauge converts m/s and handles reverse, bicycles and invalid values', () => {
  assert.deepEqual(speedReading(10, 20), { kmh: 36, mode: 'D', fill: 0.5 });
  assert.deepEqual(speedReading(-5, 20), { kmh: 18, mode: 'R', fill: 0.25 });
  assert.equal(speedReading(4, 7, true).mode, 'PEDAL');
  assert.equal(speedReading(0.01, 20).mode, 'N');
  assert.equal(speedReading(100, 20).fill, 1);
  assert.deepEqual(speedReading(NaN, 0), { kmh: 0, mode: 'N', fill: 0 });
});

test('minimap projection preserves shape and rejects missing or corrupt outlines', () => {
  const project = mapProjection([{ x: -100, z: 0 }, { x: 100, z: 100 }])!;
  assert.deepEqual(project({ x: -100, z: 0 }), { x: 12, y: 46 });
  assert.deepEqual(project({ x: 100, z: 100 }), { x: 148, y: 114 });
  assert.deepEqual(project({ x: 0, z: 50 }), { x: 80, y: 80 });
  assert.equal(mapProjection([]), null);
  assert.equal(mapProjection([{ x: 0, z: 0 }, { x: 0, z: 0 }]), null);
  assert.equal(mapProjection([{ x: NaN, z: 0 }, { x: 1, z: 1 }]), null);
});
