import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CARS, SPECS, DRIVE_STEP, drive, impact, leanAngle, carFits, type CarPose, type CarKind, type Pedals } from '../src/shared/garage.js';
import { Garage } from '../src/server/garage.js';
import { Fleet, supercar } from '../src/client/world/cars.js';
import { STREET_Y } from '../src/shared/layout.js';

const still: CarPose = { x: 0, z: 0, rotY: 0, speed: 0, steer: 0 };
const gas: Pedals = { gas: 1, turn: 0, brake: false };
function run(p: CarPose, pedals: Pedals, steps: number, kind: CarKind = 'lambo'): CarPose {
  for (let i = 0; i < steps; i++) p = drive(p, pedals, DRIVE_STEP, kind);
  return p;
}

// These exercise the tire model without a scene or a server: the same input must give the same road.
test('tire steps are pure, repeatable, and agree across frame sizes', () => {
  const start = Object.freeze({ ...still, speed: 12 });
  const turn = { ...gas, turn: 0.7 };
  const fine = run(start, turn, 240);
  assert.deepEqual(run(start, turn, 240), fine);
  let coarse: CarPose = start;
  for (let i = 0; i < 60; i++) coarse = drive(coarse, turn, 1 / 30);
  assert.deepEqual(coarse, fine);
  assert.deepEqual(start, { ...still, speed: 12 });
  assert.deepEqual(drive(start, turn, 0), start);
  const right = run(start, { ...turn, turn: -turn.turn }, 240);
  assert.ok(Math.abs(fine.x + right.x) < 1e-10 && Math.abs(fine.rotY + right.rotY) < 1e-10);
  const long = run(fine, turn, 3600);
  assert.ok(Object.values(long).every(Number.isFinite));
  assert.ok(Math.abs(long.slip ?? 0) <= SPECS.lambo.top * 0.75);
});

test('a tug on the handbrake breaks rear grip, and the tires catch again when released', () => {
  const turning = { ...gas, turn: 1 };
  const corner = run({ ...still, speed: 18, steer: 0.2 }, turning, 120);
  const held = run(corner, turning, 24);
  const drifting = run(corner, { ...turning, brake: true }, 24);
  assert.ok(Math.abs(drifting.slip ?? 0) > Math.abs(held.slip ?? 0) + 1, 'the tail steps out');
  assert.ok((drifting.yaw ?? 0) > (held.yaw ?? 0) * 1.5, 'rear grip lets the nose turn faster');
  assert.ok(drifting.speed < held.speed, 'it still brakes');
  const caught = run(drifting, gas, 720);
  assert.ok(Math.abs(caught.slip ?? 0) < 0.05 && Math.abs(caught.yaw ?? 0) < 0.01, 'straight again');
});

test('bikes have no lateral drift, lean into the turn, and a bicycle pedals up to speed slowly', () => {
  for (const kind of ['motorbike', 'bicycle'] as const) {
    const p = run({ ...still, slip: 5 }, { ...gas, turn: 1 }, 240, kind);
    assert.equal(p.slip, 0);
    assert.ok(leanAngle(p, kind) > 0 && leanAngle(p, kind) <= 0.55);
    assert.equal(leanAngle(still, kind), 0);
    assert.equal(run(still, gas, 3600, kind).speed, SPECS[kind].top);
    const stopped = run(p, { ...gas, brake: true }, 240, kind);
    assert.equal(stopped.speed, 0);
    assert.equal(stopped.yaw, 0);
  }
  const pedal = run(still, gas, 120, 'bicycle');
  const motor = run(still, gas, 120, 'motorbike');
  assert.ok(pedal.speed < 2 && motor.speed > pedal.speed * 3);
});

test('a hit keeps the tangent, bounces off a wall, and loses more speed into a heavier vehicle', () => {
  const p = { ...still, speed: 10, slip: 3 };
  const wall = impact(p, 'lambo', 0, -1);
  assert.equal(wall.slip, 3, 'the motion along the wall survives');
  assert.ok(wall.speed < 0 && Math.abs(wall.speed) < p.speed);
  const light = impact(p, 'lambo', 0, -1, { mass: SPECS.bicycle.mass });
  const heavy = impact(p, 'lambo', 0, -1, { mass: SPECS.ferrari.mass });
  assert.ok(heavy.speed < light.speed);
  assert.deepEqual(impact(p, 'lambo', 0, 1), p, 'already going away');
  assert.ok(impact(p, 'lambo', 0, -1, { mass: 1450, vz: 10 }).speed === 10, 'no hit at the same speed');
});

test('a bike clears a gap a supercar cannot, and all four new spots are in the side lot', () => {
  const gap = [{ minX: 17, maxX: 19.55, minZ: -8, maxZ: 8 }, { minX: 20.45, maxX: 24, minZ: -8, maxZ: 8 }];
  const at = { ...still, x: 20 };
  assert.ok(carFits(at, gap, 'bicycle'));
  assert.ok(!carFits(at, gap, 'lambo'));
  assert.deepEqual(CARS.slice(9).map((c) => c.kind), ['motorbike', 'motorbike', 'bicycle', 'bicycle']);
});

test('the office accepts old poses, clamps each kind, rejects nonsense slip, and checks bike seats', () => {
  for (const [i, def] of CARS.entries()) {
    const g = new Garage();
    assert.ok(g.enter('driver', i, 'driver'));
    const p = { ...still, x: def.x, z: def.z, speed: 999, slip: 999 };
    const checked = g.drive('driver', i, p)!;
    assert.equal(checked.speed, SPECS[def.kind].top);
    assert.equal(checked.slip, SPECS[def.kind].width < 1 ? 0 : SPECS[def.kind].top * 0.75);
    assert.equal(g.drive('driver', i, { ...p, speed: -999 })?.speed, -SPECS[def.kind].reverse);
    assert.equal(g.drive('driver', i, { ...p, slip: NaN }), undefined);
    assert.equal(g.drive('driver', i, { ...p, slip: Infinity }), undefined);
    assert.equal(g.drive('driver', i, { ...p, slip: undefined })?.slip, 0);
    assert.equal(g.enter('passenger', i, 'passenger'), SPECS[def.kind].seats > 1);
    g.leave('driver');
    assert.equal(g.state()[i].slip, 0);
  }
});

test('merged models stay within eight scene draw calls, occupied or parked', () => {
  for (const kind of Object.keys(SPECS) as CarKind[]) {
    const model = supercar(kind, '#00b4d8');
    for (const occupied of [false, true]) {
      model.top.visible = !occupied;
      model.open.visible = occupied;
      let calls = 0;
      model.root.traverseVisible((o) => { if ((o as THREE.Mesh).isMesh) calls++; });
      assert.ok(calls <= 8, `${kind}, ${occupied ? 'occupied' : 'parked'}: ${calls} calls`);
    }
    assert.equal(model.wheels.length, SPECS[kind].width < 1 ? 2 : 4);
  }
});

test('the fleet spins both axles, steers only the front, and puts models on their current street', () => {
  const fleet = new Fleet([], []);
  fleet.setStreet(STREET_Y - 8);
  assert.equal(fleet.cars[0].root.position.y, STREET_Y - 8);
  fleet.place(0, { ...still, speed: 10, steer: 0.2 });
  fleet.update(1 / 30, [], [], 0, { car: 0, driving: true }, new THREE.Vector3(0, STREET_Y, 0));
  for (const w of fleet.cars[0].wheels) {
    assert.ok(w.children[0].rotation.x > 0);
    assert.equal(w.rotation.y, w.userData.front ? 0.2 : 0);
  }
  assert.equal(fleet.seatAt(11, 'passenger'), undefined);
  assert.ok(fleet.seatAt(9, 'passenger'));
});

test('a car stopped by the handbrake mid-slide drives off again on the gas', () => {
  // Left over from a drift: all but no speed, a crumb of slip and turn that used to keep it braking forever.
  let p: CarPose = { x: 0, z: 0, rotY: -2.46, speed: -1.5e-26, steer: 0, slip: -2.3e-10, yaw: 8e-15 };
  for (let i = 0; i < 60; i++) p = drive(p, { gas: 1, turn: 0, brake: false }, 1 / 30);
  assert.ok(p.speed > 5, `speed ${p.speed}`);
});

test('a motorbike flat out on full lock turns no tighter than its tires hold', () => {
  let p: CarPose = { x: 0, z: 0, rotY: 0, speed: SPECS.motorbike.top, steer: 0, slip: 0, yaw: 0 };
  for (let i = 0; i < 30; i++) p = drive(p, { gas: 1, turn: 1, brake: false }, 1 / 30, 'motorbike');
  assert.ok(Math.abs(p.speed * (p.yaw ?? 0)) <= SPECS.motorbike.grip * 9.81 + 1e-6, `lateral ${p.speed * (p.yaw ?? 0)}`);
});

// "The tires come out": the frame rolled about the ground but the wheels rolled about their hubs, and the rider about their hips.
test('at full lean a bike\'s wheels stay on its axles and its rider stays on the saddle', async () => {
  const { Person } = await import('../src/client/world/character.js');
  const { HIPS } = await import('../src/client/player.js');
    for (const kind of ['motorbike', 'bicycle'] as const) {
    const i = CARS.findIndex((c) => c.kind === kind);
    const fleet = new Fleet([], []);
    const v = fleet.cars[i];
    const spec = SPECS[kind];
    for (const steer of [0.5, -0.5]) {
      fleet.place(i, { ...still, speed: 14, steer });
      for (let f = 0; f < 60; f++) fleet.update(1 / 30, [], [], 0, { car: i, driving: true }, new THREE.Vector3(0, STREET_Y, 0));
      assert.ok(Math.abs(v.body.rotation.z) > 0.3, `${kind} leans ${v.body.rotation.z}`);
      // A Person needs a canvas; its ride pose only touches body and limbs, so stand in for those.
      const limb = () => new THREE.Group();
      const rider = { root: new THREE.Group(), body: new THREE.Group(), armL: limb(), armR: limb(), legL: limb(), legR: limb(), ride: Person.prototype.ride };
      rider.root.add(rider.body);
      fleet.poseRider(rider as never, i, 'driver');
      v.root.updateMatrixWorld(true);
      // Each hub is exactly where the frame's axle is (the frame leans about the ground line).
      for (const w of v.wheels) {
        const axle = new THREE.Vector3(0, w.position.y, w.userData.front ? spec.wheelbase / 2 : -spec.wheelbase / 2);
        const want = v.body.localToWorld(axle);
        const got = w.getWorldPosition(new THREE.Vector3());
        assert.ok(got.distanceTo(want) < 0.02, `${kind} hub ${got.distanceTo(want)} off`);
      }
      // The rider's hips sit over the saddle, not out to the side.
      rider.root.position.copy(v.root.position);
      rider.root.rotation.y = v.root.rotation.y;
      rider.root.updateMatrixWorld(true);
      const hips = rider.body.localToWorld(new THREE.Vector3(0, HIPS, 0));
      const seat = v.body.localToWorld(new THREE.Vector3(0, 0.82, 0));
      assert.ok(Math.abs(hips.x - seat.x) < 0.05, `${kind} rider ${hips.x - seat.x} m off the saddle`);
    }
  }
});
