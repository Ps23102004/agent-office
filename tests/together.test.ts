import test from 'node:test';
import assert from 'node:assert/strict';
import { CARS } from '../src/shared/garage.js';
import { CIRCUIT } from '../src/shared/circuit.js';
import { ROOF } from '../src/shared/rooftop.js';
import { MEET_SPOTS, isMeetSpot, pinFloor } from '../src/shared/meet.js';
import { Garage, OFFER_EVERY, OFFER_FOR } from '../src/server/garage.js';

test('a ride is offered by a driver with a free seat beside them, and taken only when they say yes', () => {
  const now = { t: 0 };
  const g = new Garage(() => now.t);
  assert.equal(g.offer('a', 'b'), undefined, 'not driving');
  assert.ok(g.enter('a', 0, 'driver'));
  assert.equal(g.offer('a', 'a'), undefined, 'not to yourself');
  assert.equal(g.answer('b', 'a', true), undefined, 'nothing offered yet');
  assert.equal(g.seatOf('b'), undefined);
  assert.equal(g.offer('a', 'b'), 0);
  assert.equal(g.seatOf('b'), undefined, 'offered is not seated');
  assert.equal(g.answer('b', 'someone', true), undefined, 'only the one who offered');
  assert.equal(g.answer('b', 'a', true), 0);
  assert.deepEqual(g.seatOf('b'), { car: 0, seat: 'passenger' });
  assert.equal(g.answer('b', 'a', true), undefined, 'an offer is good once');
  // Full now: nothing more to offer.
  now.t += OFFER_EVERY;
  assert.equal(g.offer('a', 'c'), undefined);
});

test('ride offers: now and then, not to someone in a car or on a one-seater, and no after no', () => {
  const now = { t: 0 };
  const g = new Garage(() => now.t);
  g.enter('a', 0, 'driver');
  assert.equal(g.offer('a', 'b'), 0);
  assert.equal(g.offer('a', 'c'), undefined, 'too soon after the last');
  now.t += OFFER_EVERY;
  // No: and the same driver can't keep asking.
  assert.equal(g.answer('b', 'a', false), undefined);
  assert.equal(g.seatOf('b'), undefined);
  assert.equal(g.offer('a', 'b'), undefined, 'they said no');
  assert.equal(g.offer('a', 'c'), 0, 'someone else, though');
  now.t += OFFER_EVERY;
  g.enter('d', 1, 'driver');
  assert.equal(g.offer('a', 'd'), undefined, 'already in a car');
  const bike = CARS.findIndex((c) => c.kind === 'bicycle');
  if (bike >= 0) {
    g.enter('e', bike, 'driver');
    assert.equal(g.offer('e', 'f'), undefined, 'nowhere to sit');
  }
});

test('a ride offer lapses: too late, the driver got out or into another car, or the seat went', () => {
  const now = { t: 0 };
  const g = new Garage(() => now.t);
  g.enter('a', 0, 'driver');
  g.offer('a', 'b');
  now.t += OFFER_FOR + 1;
  assert.equal(g.answer('b', 'a', true), undefined, 'too late');
  now.t += OFFER_EVERY;
  g.offer('a', 'b');
  g.leave('a');
  assert.equal(g.answer('b', 'a', true), undefined, 'nobody driving');
  g.enter('a', 0, 'driver');
  now.t += OFFER_EVERY;
  g.offer('a', 'b');
  now.t += OFFER_EVERY;
  assert.equal(g.offer('a', 'c'), 0);
  assert.equal(g.answer('c', 'a', true), 0);
  assert.equal(g.answer('b', 'a', true), undefined, 'someone took the seat');
  assert.equal(g.seatOf('b'), undefined);
  // Gone from the floor: the offer goes with them.
  g.leave('c');
  now.t += OFFER_EVERY;
  g.offer('a', 'b');
  g.leave('b');
  assert.equal(g.offerTo('b'), undefined);
});

test('meeting spots: only the ones there are, each on the right floor', () => {
  for (const bad of ['', 'nowhere', '__proto__', 'toString', 1, null, undefined]) assert.equal(isMeetSpot(bad), false, String(bad));
  for (const id of Object.keys(MEET_SPOTS)) assert.ok(isMeetSpot(id));
  assert.equal(pinFloor({ spot: 'firepit' }), ROOF);
  assert.equal(pinFloor({ spot: 'pits', floor: 'f1' }), CIRCUIT);
  assert.equal(pinFloor({ spot: 'lounge', floor: 'f1' }), 'f1');
  assert.equal(pinFloor({ spot: 'gate', floor: 'f1' }), 'f1');
});

test('nobody gets in beside a driver uninvited; an empty car’s passenger seat is anyone’s', () => {
  const g = new Garage(() => 0);
  assert.ok(g.enter('a', 0, 'passenger'), 'nobody driving');
  assert.ok(g.enter('b', 1, 'driver'));
  assert.equal(g.enter('c', 1, 'passenger'), false);
  assert.equal(g.seatOf('c'), undefined);
});

test('a pin to a spot there isn’t has no label, rather than breaking the chat', async () => {
  const { meetLabel } = await import('../src/client/together.js');
  assert.equal(meetLabel({ spot: 'nowhere' as never }), '');
  assert.equal(meetLabel({ spot: 'firepit' }), '🔥 the roof fire pit');
});
