import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PlayerController } from '../src/client/player.js';
import { Driver } from '../src/client/driving.js';
import { Fleet } from '../src/client/world/cars.js';
import type { Collider, Interactable } from '../src/client/world/office.js';
import { CAR, SEATS, SPECS, carPoint, contact, type CarPose } from '../src/shared/garage.js';
import { ROAD, STREET_Y } from '../src/shared/layout.js';

const G = STREET_Y;
const ROAD_Z = (ROAD.minZ + ROAD.maxZ) / 2;
/** The Blue Lambo, moved out onto the road for these. */
const BLUE = 8;

/** The street to stand and drive on, whatever else is there, and a driver in a car on it heading east. */
function street(t: TestContext, solids: Collider[] = [], ground?: (x: number, z: number) => boolean) {
  const win = new EventTarget();
  for (const [name, value] of [['window', win], ['document', new EventTarget()]] as const) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
  const colliders: Collider[] = [{ minX: -200, maxX: 200, minZ: -200, maxZ: 200, bottom: G - 1, top: G }, ...solids];
  const fleet = new Fleet(colliders, [] as Interactable[]);
  const player = new PlayerController(new THREE.PerspectiveCamera(), new EventTarget() as unknown as HTMLElement, colliders);
  player.view = 'third';
  const sent: CarPose[] = [];
  const bumps: number[] = [];
  const driver = new Driver(player, fleet, { moved: (_car, p) => sent.push({ ...p }), bump: (_at, speed) => bumps.push(speed), course: ground && (() => ({ ground })) });
  fleet.place(BLUE, { x: 0, z: ROAD_Z, rotY: Math.PI / 2, speed: 0, steer: 0 });
  const keys = (...codes: string[]) => {
    player.clearKeys();
    for (const code of codes) {
      const e = new Event('keydown');
      Object.defineProperty(e, 'code', { value: code });
      win.dispatchEvent(e);
    }
  };
  const frames = (n: number, dt = 1 / 60) => {
    for (let i = 0; i < n; i++) player.update(dt);
  };
  return { fleet, player, driver, sent, bumps, keys, frames, car: () => fleet.cars[BLUE].pose };
}

const box = (x: number, z: number, w: number, d: number): Collider => ({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, bottom: G, top: G + 3 });

test('behind the wheel, W drives off down the road, with you in your seat and the office told where', (t) => {
  const s = street(t);
  s.driver.enter(BLUE, 'driver');
  s.keys('KeyW');
  s.frames(90);
  const car = s.car();
  assert.ok(car.x > 5 && Math.abs(car.z - ROAD_Z) < 1e-6, `east along the road (x ${car.x.toFixed(1)})`);
  const seat = carPoint(car, SEATS.driver.x, SEATS.driver.z);
  assert.ok(Math.hypot(s.player.pos.x - seat.x, s.player.pos.z - seat.z) < 1e-6 && s.player.pos.y === G, 'sitting in it');
  assert.ok(s.sent.length > 5 && s.sent.length < 30, `a few times a second, not every frame (${s.sent.length} in 1.5 s)`);
});

test('a column in the way stops the car short with a crunch, and it backs away from it', (t) => {
  const s = street(t, [box(12, ROAD_Z, 0.5, 0.5)]);
  s.driver.enter(BLUE, 'driver');
  s.keys('KeyW');
  s.frames(240);
  assert.ok(s.car().x + CAR.length / 2 <= 11.75 + 1e-6, `stopped at the column (nose at ${(s.car().x + CAR.length / 2).toFixed(2)})`);
  assert.ok(s.bumps.length >= 1 && s.bumps[0] > 5, `a crunch at ${s.bumps[0]?.toFixed(1)} m/s`);
  s.keys('KeyS');
  s.frames(60);
  assert.ok(s.car().x < 8, 'reversing out of it');
});

test('at an angle into a wall, the car slides along it rather than stopping dead', (t) => {
  // A wall along the road's north edge; the car heads east, veering into it.
  const wall = { minX: -80, maxX: 80, minZ: ROAD.minZ - 1, maxZ: ROAD.minZ + 0.3, bottom: G, top: G + 3 };
  const s = street(t, [wall]);
  s.fleet.place(BLUE, { x: 0, z: ROAD.minZ + 2.5, rotY: Math.PI / 2 + 0.35, speed: 12, steer: 0 });
  s.driver.enter(BLUE, 'driver');
  s.keys('KeyW');
  s.frames(60);
  const car = s.car();
  assert.ok(car.x > 10 && car.speed > 10, `on along the wall (x ${car.x.toFixed(1)}, ${car.speed.toFixed(1)} m/s)`);
  // Scraping along it under power, the tires hold it a few degrees off true (grip, not a snap).
  assert.ok(Math.abs(car.rotY - Math.PI / 2) < 0.15, `turned to run along it (${car.rotY.toFixed(3)}, slip ${car.slip?.toFixed(3)})`);
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const c = carPoint(car, (sx * CAR.width) / 2, (sz * CAR.length) / 2);
    assert.ok(c.z >= wall.maxZ - 1e-6, 'not into it');
  }
});

test('E gets you out by your door, the car stopped; with no room anywhere round it, you stay in', (t) => {
  const s = street(t);
  s.driver.enter(BLUE, 'driver');
  s.keys('KeyW');
  s.frames(30);
  s.keys();
  assert.ok(s.driver.leave());
  assert.equal(s.driver.active, false);
  assert.equal(s.player.rig, null);
  assert.equal(s.sent.at(-1)?.speed, 0, 'parked where you left it');
  // The driver's side is the car's left: north, heading east.
  assert.ok(s.player.pos.z < s.car().z - CAR.width / 2 - 0.3, 'out on the driver’s side');
  // Hemmed in on every side.
  const c = s.car();
  const walls = [box(c.x, c.z - 1.85, 8, 0.6), box(c.x, c.z + 1.85, 8, 0.6), box(c.x - 3, c.z, 0.6, 4), box(c.x + 3, c.z, 0.6, 4)];
  s.player.colliders.push(...walls);
  s.driver.enter(BLUE, 'driver');
  assert.equal(s.driver.leave(), false, 'no room to open a door');
  assert.ok(s.driver.active);
  assert.ok(s.driver.leave(true), 'unless you have to (another floor, a desk)');
});

test("beside the driver, you ride along but don't drive", (t) => {
  const s = street(t);
  s.driver.enter(BLUE, 'passenger');
  s.keys('KeyW', 'KeyA');
  s.frames(60);
  assert.equal(s.car().x, 0);
  assert.equal(s.sent.length, 0);
  // Someone else drives it on: you go with it.
  s.fleet.place(BLUE, { ...s.car(), x: 10 });
  s.frames(1);
  const seat = carPoint(s.car(), SEATS.passenger.x, SEATS.passenger.z);
  assert.ok(Math.hypot(s.player.pos.x - seat.x, s.player.pos.z - seat.z) < 1e-6);
});


test('the fixed physics steps agree at 30, 60 and 144 frames a second', (t) => {
  const poses: CarPose[] = [];
  for (const fps of [30, 60, 144]) {
    const s = street(t);
    s.driver.enter(BLUE, 'driver');
    s.keys('KeyW');
    s.frames(fps, 1 / fps);
    poses.push({ ...s.car() });
  }
  for (const p of poses.slice(1)) {
    assert.ok(Math.abs(p.x - poses[0].x) < 1e-10);
    assert.ok(Math.abs(p.speed - poses[0].speed) < 1e-10);
  }
});

test('a bicycle rides and gets out beside its saddle, with no passenger seat', (t) => {
  const s = street(t);
  const bicycle = 11;
  s.fleet.place(bicycle, { x: 0, z: ROAD_Z, rotY: Math.PI / 2, speed: 0, steer: 0 });
  s.driver.enter(bicycle, 'passenger');
  assert.ok(!s.driver.active);
  s.driver.enter(bicycle, 'driver');
  s.keys('KeyW');
  s.frames(120);
  assert.ok(s.fleet.cars[bicycle].pose.x > 3);
  assert.equal(s.fleet.cars[bicycle].pose.slip, 0);
  assert.ok(s.driver.leave());
  assert.equal(s.sent.at(-1)?.speed, 0);
  assert.equal(s.sent.at(-1)?.slip, 0);
  assert.ok(s.player.pos.z < s.fleet.cars[bicycle].pose.z - 0.8);
});

test('flat out into a parked car, yours never ends up inside it: it stops and bounces back off', (t) => {
  const s = street(t);
  const lime = 0;
  s.fleet.place(lime, { x: 40, z: ROAD_Z, rotY: Math.PI / 2 + 0.3, speed: 0, steer: 0 });
  s.fleet.place(BLUE, { x: 0, z: ROAD_Z, rotY: Math.PI / 2, speed: 60, steer: 0 });
  s.driver.enter(BLUE, 'driver');
  s.keys('KeyW');
  const other = () => s.fleet.solids(BLUE).find((b) => b.rotY !== undefined && Math.abs((b.minX + b.maxX) / 2 - 40) < 0.01)!;
  for (let f = 0; f < 120; f++) {
    s.frames(1);
    assert.equal(contact(s.car(), other()), null, `frame ${f}: inside it at x ${s.car().x.toFixed(2)}`);
  }
  assert.ok(s.car().x < 40, 'still this side of it');
  assert.ok(s.bumps[0] > 30, `a big crunch (${s.bumps[0]?.toFixed(1)} m/s)`);
});

test('a car left on top of yours is pushed off it, not driven through', (t) => {
  const s = street(t);
  const lime = 0;
  s.fleet.place(lime, { x: 3.5, z: ROAD_Z + 0.4, rotY: Math.PI / 2, speed: 0, steer: 0 });
  s.driver.enter(BLUE, 'driver');
  s.keys('KeyW');
  const other = () => s.fleet.solids(BLUE).find((b) => b.rotY !== undefined && Math.abs((b.minX + b.maxX) / 2 - 3.5) < 0.01)!;
  assert.ok(contact(s.car(), other()), 'overlapping to start with');
  s.frames(1);
  assert.equal(contact(s.car(), other()), null, 'out of it after one frame');
  for (let f = 0; f < 60; f++) {
    s.frames(1);
    assert.equal(contact(s.car(), other()), null);
  }
});

test('Shift boosts you past top speed until the meter runs dry, and it fills back drifting', (t) => {
  const s = street(t);
  s.fleet.place(BLUE, { x: -80, z: ROAD_Z, rotY: Math.PI / 2, speed: SPECS.lambo.top, steer: 0 });
  s.driver.enter(BLUE, 'driver');
  s.keys('KeyW', 'ShiftLeft');
  s.frames(60);
  assert.ok(s.driver.boosting && s.car().speed > SPECS.lambo.top + 3, `boosting at ${s.car().speed.toFixed(1)} m/s`);
  assert.ok(Math.abs(s.driver.boost - (1 - 1 / 3.5)) < 0.02, `a second's worth gone (${s.driver.boost.toFixed(2)})`);
  assert.ok(s.sent.at(-1) && s.fleet.cars[BLUE].boosting, 'flames out the back');
  s.frames(180);
  assert.ok(s.driver.boost < 0.02, 'run dry (and only trickling back)');
  assert.equal(s.driver.boosting, false);
  const dry = s.driver.boost;
  s.fleet.place(BLUE, { ...s.car(), speed: 20, slip: 6 });
  s.keys('KeyW');
  s.frames(10);
  assert.ok(s.driver.boost > dry + 0.01, `a slide fills it (${s.driver.boost.toFixed(3)})`);
});

test("grazing a circuit's edge at speed, the car slides along it: speed kept, no slide sideways", (t) => {
  // A barrier along the north of a wide strip (the circuit's ground, whatever shape it is: only `where` is asked).
  const barrier = ROAD_Z - 4;
  const s = street(t, [], (_x, z) => z > barrier);
  s.fleet.place(BLUE, { x: -100, z: barrier + 2, rotY: Math.PI / 2 + (5 * Math.PI) / 180, speed: 70, steer: 0 });
  s.driver.enter(BLUE, 'driver');
  s.keys('KeyW');
  s.frames(30);
  const car = s.car();
  assert.ok(s.bumps.length >= 1, 'it touched');
  assert.ok(car.speed > 60, `speed mostly kept (${car.speed.toFixed(1)} m/s)`);
  assert.ok(Math.abs(car.slip ?? 0) < 6, `not sliding sideways (${car.slip?.toFixed(1)} m/s)`);
  assert.ok(car.x > -70, `on along it (x ${car.x.toFixed(1)})`);
});
