import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SPECS, seatOffset } from '../src/shared/garage.js';
import { supercar } from '../src/client/world/cars.js';

// Without cars.glb (it didn't load), Kenney's kinds are drawn in code: as big as their specs (what you
// bump into), with a seat for each rider where they sit.
test('a Kenney car whose model never came is drawn its own size, with only the seats it has', () => {
  for (const kind of ['sedan-sports', 'suv', 'police', 'taxi', 'race', 'race-future'] as const) {
    const spec = SPECS[kind];
    const car = supercar(kind, '#123456');
    // Parked: the seats (taller than a single-seater) are out of sight.
    car.body.remove(car.open);
    const size = new THREE.Box3().setFromObject(car.root, true).getSize(new THREE.Vector3());
    assert.ok(Math.abs(size.z - spec.length) < 0.2, `${kind} is ${size.z} long, not ${spec.length}`);
    assert.ok(Math.abs(size.y - spec.roof) < 0.15, `${kind} is ${size.y} high, not ${spec.roof}`);
    assert.ok(size.x < spec.width + 0.4, `${kind} is ${size.x} wide`);
    // The seats are the open cabin's widest part (its windshield is narrower than two seats side by side, wider than one).
    const box = new THREE.Box3().setFromObject(car.open, true);
    if (spec.seats < 2) assert.ok(Math.abs(box.getCenter(new THREE.Vector3()).x) < 0.05 && box.max.x < seatOffset('lambo', 'driver').x + 0.2, `${kind}: one seat, in the middle`);
    else assert.ok(box.max.x > seatOffset(kind, 'driver').x && box.min.x < seatOffset(kind, 'passenger').x, `${kind}: two seats`);
  }
});
