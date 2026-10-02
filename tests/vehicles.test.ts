import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { kitModel, setCarKit } from '../src/client/world/carkit.js';
import { buildStreetLife } from '../src/client/world/streetlife.js';
import { STREET_Z, citySolids, surfaceAt } from '../src/shared/city.js';
import { CIRCUIT_CARS } from '../src/shared/circuit.js';
import { MAX_SPIN, boostTop, CARS, SPECS, DRIVE_STEP, collide, contact, drive, leanAngle, carFits, overlaps, type CarPose, type CarKind, type Pedals } from '../src/shared/garage.js';
import { Garage } from '../src/server/garage.js';
import { Fleet, supercar } from '../src/client/world/cars.js';
import { STREET_Y } from '../src/shared/layout.js';

// Kenney's cars (cars.glb), in as they are once the page has loaded its models.
before(async () => {
  const b = readFileSync(new URL('../src/client/models/cars.glb', import.meta.url));
  setCarKit((await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '')).scene);
});

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
  // Square on, through its middle.
  const impact = (q: CarPose, kind: CarKind, nx: number, nz: number, other = {}) => collide(q, kind, { nx, nz, depth: 0, x: q.x, z: q.z }, other);
  const wall = impact(p, 'lambo', 0, -1);
  assert.equal(wall.slip, 3, 'the motion along the wall survives');
  assert.ok(wall.speed < 0 && Math.abs(wall.speed) < p.speed);
  const light = impact(p, 'lambo', 0, -1, { mass: SPECS.bicycle.mass });
  const heavy = impact(p, 'lambo', 0, -1, { mass: SPECS.ferrari.mass });
  assert.ok(heavy.speed < light.speed);
  assert.deepEqual(impact(p, 'lambo', 0, 1), p, 'already going away');
  assert.ok(impact(p, 'lambo', 0, -1, { mass: 1450, vz: 10 }).speed === 10, 'no hit at the same speed');
});

test('a turned car is a turned box: hit off-centre it spins, and the way out is the shortest', () => {
  // A car across the road ahead, turned 30°: its corner, not its bounding square, is what you meet.
  const other = { x: 0, z: 5, rotY: Math.PI / 6, hx: 1, hz: 2.3 };
  const s = Math.abs(Math.sin(other.rotY)), c = Math.abs(Math.cos(other.rotY));
  const ex = c * other.hx + s * other.hz, ez = s * other.hx + c * other.hz;
  const box = { minX: -ex, maxX: ex, minZ: 5 - ez, maxZ: 5 + ez, rotY: other.rotY, hx: other.hx, hz: other.hz, mass: 1500 };
  assert.equal(contact({ x: 2.6, z: 1.4, rotY: 0 }, box), null, 'inside its bounds but clear of it');
  const hit = contact({ x: 0.8, z: 0.6, rotY: 0 }, box)!;
  assert.ok(hit && hit.depth > 0 && hit.nz < 0, `in it, and back out the way it came (${JSON.stringify(hit)})`);
  // Nose-first at 20 m/s into a wall: square on, it bounces straight back; on the left front corner, most of the hit slews it round.
  const p: CarPose = { x: 0, z: 0, rotY: 0, speed: 20, steer: 0, slip: 0, yaw: 0 };
  const square = collide(p, 'lambo', { nx: 0, nz: -1, depth: 0.1, x: 0, z: 2.3 });
  assert.ok(square.speed < 0 && square.speed > -20 && square.yaw === 0, `bounced (${square.speed.toFixed(1)} m/s)`);
  const after = collide(p, 'lambo', { nx: 0, nz: -1, depth: 0.1, x: 0.9, z: 2.3 });
  assert.ok(after.speed > square.speed && after.speed < 10, `slowed (${after.speed.toFixed(1)} m/s)`);
  assert.ok(Math.abs(after.yaw ?? 0) > 0.5, `spun (${after.yaw?.toFixed(2)} rad/s)`);
  // Flat out into a corner, no wilder a spin than the tires can soon catch.
  assert.equal(Math.abs(collide({ ...p, speed: 100 }, 'race', { nx: 0, nz: -1, depth: 0.1, x: 0.8, z: 2.2 }).yaw ?? 0), MAX_SPIN);
  // Into a heavier car, less bounce: its mass takes less of the hit.
  assert.ok(collide(p, 'lambo', { nx: 0, nz: -1, depth: 0.1, x: 0, z: 2.3 }, { mass: 3000 }).speed < collide(p, 'lambo', { nx: 0, nz: -1, depth: 0.1, x: 0, z: 2.3 }, { mass: 500 }).speed);
});

test('a bike clears a gap a supercar cannot, and all four new spots are in the side lot', () => {
  const gap = [{ minX: 17, maxX: 19.55, minZ: -8, maxZ: 8 }, { minX: 20.45, maxX: 24, minZ: -8, maxZ: 8 }];
  const at = { ...still, x: 20 };
  assert.ok(carFits(at, gap, 'bicycle'));
  assert.ok(!carFits(at, gap, 'lambo'));
  assert.deepEqual(CARS.slice(9, 13).map((c) => c.kind), ['motorbike', 'motorbike', 'bicycle', 'bicycle']);
});

test('the office accepts old poses, clamps each kind, rejects nonsense slip, and checks bike seats', () => {
  for (const [i, def] of CARS.entries()) {
    const g = new Garage();
    assert.ok(g.enter('driver', i, 'driver'));
    const p = { ...still, x: def.x, z: def.z, speed: 999, slip: 999 };
    const checked = g.drive('driver', i, p)!;
    assert.equal(checked.speed, SPECS[def.kind].top * boostTop(def.kind), 'top speed, on the boost if it has one');
    assert.equal(checked.slip, SPECS[def.kind].width < 1 ? 0 : SPECS[def.kind].top * 0.75);
    assert.equal(g.drive('driver', i, { ...p, speed: -999 })?.speed, -SPECS[def.kind].reverse);
    assert.equal(g.drive('driver', i, { ...p, slip: NaN }), undefined);
    assert.equal(g.drive('driver', i, { ...p, slip: Infinity }), undefined);
    assert.equal(g.drive('driver', i, { ...p, slip: undefined })?.slip, 0);
    assert.equal(g.offer('driver', 'passenger') !== undefined && g.answer('passenger', 'driver', true) === i, SPECS[def.kind].seats > 1);
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

// A car's springs move its body, not its wheels: however it rolls, dives or bobs, the tires stay on the road,
// and the fenders never come down onto them.
test('every car tire stays on the ground at speed with steer, and under hard braking', () => {
  for (const kind of (Object.keys(SPECS) as CarKind[]).filter((k) => SPECS[k].width >= 1)) {
    const defs = CARS.some((c) => c.kind === kind) ? CARS : CIRCUIT_CARS;
    const i = defs.findIndex((c) => c.kind === kind);
    const fleet = new Fleet([], [], defs);
    const v = fleet.cars[i];
    const low = () => {
      v.root.updateMatrixWorld(true);
      return v.wheels.map((w) => {
        let min = Infinity;
        w.traverse((o) => {
          const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
          if (!g?.attributes.position) return;
          const p = g.attributes.position;
          for (let n = 0; n < p.count; n++) min = Math.min(min, new THREE.Vector3().fromBufferAttribute(p, n).applyMatrix4(o.matrixWorld).y);
        });
        return min - v.root.position.y;
      });
    };
    // The arch over each tire's outside edge, where the body has put it: never lower than the gap over the tire allows.
    const fenders = () => {
      v.body.updateMatrix();
      for (const w of v.wheels) {
        const top = w.position.y + w.userData.radius;
        const arch = new THREE.Vector3(w.position.x + Math.sign(w.position.x) * w.userData.tread, top, w.position.z).applyMatrix4(v.body.matrix);
        assert.ok(arch.y > top - w.userData.clear - 1e-6, `${kind} fender ${((top - w.userData.clear - arch.y) * 100).toFixed(1)} cm into its tire`);
      }
    };
    const step = (speed: number, steer: number, frames: number) => {
      for (let f = 0; f < frames; f++) {
        // Going round as its steer says, the way the physics would have it.
        fleet.place(i, { ...still, rotY: v.pose.rotY + (speed * Math.tan(steer)) / SPECS[kind].wheelbase / 30, speed, steer });
        fleet.update(1 / 30, [], [], 0, { car: i, driving: true }, new THREE.Vector3(0, STREET_Y, 0));
        for (const y of low()) assert.ok(Math.abs(y) < 0.01, `${kind} tire ${y} m off the road`);
        fenders();
      }
    };
    step(35, 0.4, 30);
    assert.ok(Math.abs(v.body.rotation.z) > 0.02, 'the body rolls');
    // Flat out to stopped in one step: a hard dive on the nose.
    step(0, 0, 1);
    assert.ok(Math.abs(v.body.rotation.x) > 0.01, 'the nose dives');
    step(0, 0, 10);
  }
});

test("Kenney's cars are drawn from their models, the size their specs say, with the cabin off when someone's in", () => {
  for (const kind of ['sedan-sports', 'suv', 'police', 'taxi', 'race', 'race-future'] as const) {
    const m = kitModel(kind);
    assert.ok(m, `${kind} is in cars.glb`);
    const spec = SPECS[kind];
    assert.ok(Math.abs(m.length - spec.length) < 0.05 && Math.abs(m.width - spec.width) < 0.05, `${kind} is ${m.length} x ${m.width}`);
    assert.ok(Math.abs(m.height - spec.roof) < 0.05, `${kind} roof ${m.height}`);
    const zs = m.hubs.map((h) => h.z);
    assert.ok(Math.abs(Math.max(...zs) - Math.min(...zs) - spec.wheelbase) < 0.05, `${kind} wheelbase`);
    const model = supercar(kind, '#123456');
    const box = new THREE.Box3().setFromObject(model.root);
    assert.ok(Math.abs(box.max.z - box.min.z - spec.length) < 0.1, `${kind} model length`);
    assert.ok(box.min.y > -0.01 && box.min.y < 0.01, `${kind} sits on the road`);
    if (spec.seats > 1) {
      // The cabin comes off whole: nothing of it is left above the beltline.
      model.top.visible = false;
      // (The two halves share their vertices: only the triangles drawn count.)
      const shell = (model.body.children[0] as THREE.Mesh).geometry;
      let high = 0;
      for (let n = 0; n < shell.index!.count; n++) high = Math.max(high, shell.attributes.position.getY(shell.index!.getX(n)));
      assert.ok(high < m.belt + 0.45, `${kind} body without its cabin is ${high} high`);
    }
  }
  // Parked off the road (traffic would drive into them), clear of the city's lamps, trees and buildings.
  const parked = CARS.filter((c) => c.kind !== 'lambo' && c.kind !== 'ferrari' && SPECS[c.kind].width >= 1);
  assert.ok(parked.length >= 5, 'Kenney cars parked by the garage');
  for (const c of parked) {
    assert.notEqual(surfaceAt(c.x, c.z), 'road', `${c.name} is off the road`);
    assert.ok(!citySolids(c.x, c.z, 6).some((b) => overlaps(c, b, c.kind)), `${c.name} is clear of the city`);
  }
});

test("the street's traffic is one batch of Kenney's models, wheels on the road through a minute of driving", () => {
  const life = buildStreetLife();
  let meshes = 0;
  let batch: THREE.BatchedMesh | undefined;
  life.group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes++;
    if ((o as THREE.BatchedMesh).isBatchedMesh && o.name === 'traffic') batch = o as THREE.BatchedMesh;
  });
  assert.ok(batch && meshes <= 16, `${meshes} draw calls`);
  const near = { x: 0, z: STREET_Z };
  let t = 1000;
  const pos = batch.geometry.attributes.position;
  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  let wheels = 0;
  for (let i = 0; i < 30 * 60; i++) {
    t += 1 / 30;
    life.update(t, 1 / 30, 1, near, [{ x: near.x, z: near.z, vx: 0, vz: 0 }], 17.5);
    if (i % 90) continue;
    for (let id = 0; id < batch.maxInstanceCount; id++) {
      if (!batch.getVisibleAt(id)) continue;
      const range = batch.getGeometryRangeAt(batch.getGeometryIdAt(id));
      batch.getMatrixAt(id, m);
      let low = Infinity;
      let local = Infinity;
      for (let n = range.vertexStart; n < range.vertexStart + range.vertexCount; n++) {
        v.fromBufferAttribute(pos, n);
        local = Math.min(local, v.y);
        low = Math.min(low, v.applyMatrix4(m).y);
      }
      // A wheel's mesh is about its hub (it goes below its origin); a body's sits on it.
      if (local < -0.1) {
        wheels++;
        assert.ok(Math.abs(low) < 0.01, `a wheel ${low} m off the road`);
      } else assert.ok(low > -0.03, `a body ${low} m into the road`);
    }
  }
  assert.ok(wheels > 40, `${wheels} wheels seen`);
});

test("a Kenney car's front wheel steers about its own middle, not its inner face", () => {
  for (const kind of ['sedan-sports', 'suv', 'police', 'taxi', 'race', 'race-future'] as const) {
    // The model's wheel is centred on its hub, so traffic (which places it the same way) turns it in place too.
    const c = new THREE.Box3().setFromBufferAttribute(kitModel(kind)!.wheel.attributes.position as THREE.BufferAttribute).getCenter(new THREE.Vector3());
    assert.ok(c.length() < 0.01, `${kind} wheel is ${c.length()} m off its hub`);
    const car = supercar(kind, '#123456');
    for (const w of car.wheels.filter((w) => w.userData.front)) {
      const middle = () => {
        car.root.updateMatrixWorld(true);
        return new THREE.Box3().setFromObject(w, true).getCenter(new THREE.Vector3());
      };
      const straight = middle();
      w.rotation.y = 0.5;
      assert.ok(middle().distanceTo(straight) < 0.01, `${kind} wheel moves ${middle().distanceTo(straight)} m on full lock`);
      // And it's inside the body's width, out at the side.
      assert.ok(Math.abs(straight.x) < SPECS[kind].width / 2 && Math.abs(straight.x) > SPECS[kind].width / 4, `${kind} wheel at x ${straight.x}`);
    }
  }
});
