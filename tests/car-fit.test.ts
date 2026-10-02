import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { kitModel, setCarKit, type KitName } from '../src/client/world/carkit.js';
import { BODY, Fleet, TAIL_BRAKE, TAIL_NIGHT, profiles, springs, supercar } from '../src/client/world/cars.js';
import { CARS, SPECS, drive, parked, type CarKind, type CarPose } from '../src/shared/garage.js';
import { STREET_Y } from '../src/shared/layout.js';

// "The wheels come out of the car": tires through the hood, fenders coming down through them as the
// body moves on its springs, front tires swinging out past the sides when steered. All of it is
// geometry: these check it from the models themselves (cars.glb and the supercars' profiles).

before(async () => {
  const b = readFileSync(new URL('../src/client/models/cars.glb', import.meta.url));
  setCarKit((await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '')).scene);
});

const CLOSED = ['lambo', 'ferrari', 'sedan-sports', 'suv', 'police', 'taxi'] as const;
const down = new THREE.Vector3(0, -1, 0);

function meshesUnder(root: THREE.Object3D, skip: Set<THREE.Object3D>): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    for (let p: THREE.Object3D | null = o; p && p !== root; p = p.parent) if (!p.visible || skip.has(p)) return;
    out.push(o as THREE.Mesh);
  });
  return out;
}

test("a supercar's side profile never crosses itself (no hole in the hood), and each arch clears its tire", () => {
  for (const kind of ['lambo', 'ferrari'] as const) {
    const { body, axles } = profiles(kind);
    const pts = body.getPoints(24);
    const n = pts.length;
    const cross = (a: THREE.Vector2, b: THREE.Vector2, c: THREE.Vector2, d: THREE.Vector2) => {
      const o = (p: THREE.Vector2, q: THREE.Vector2, r: THREE.Vector2) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
      return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
    };
    for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      assert.ok(!cross(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n]), `${kind}'s outline crosses itself near x ${pts[i].x.toFixed(2)}`);
    }
    // The body's sides stand 5 cm out past the outline (its bevel), so its arches are 5 cm tighter there: still over the tire.
    for (const a of axles) assert.ok(a.arch - 0.05 - a.r >= 0.025, `${kind} arch at ${a.x} is ${((a.arch - 0.05 - a.r) * 100).toFixed(1)} cm over its tire`);
  }
});

test('every wheel is down on the road, however far it has turned', () => {
  for (const kind of Object.keys(SPECS) as CarKind[]) {
    const m = supercar(kind, '#3366cc');
    for (const w of m.wheels) {
      // Its bottom at each turn of the wheel (steps that aren't a multiple of a tire's sides, so a flat comes down too):
      // never sunk into the road, and never floating on a flat over it.
      let sunk = Infinity, float = -Infinity;
      for (let a = 0; a < Math.PI * 2; a += 0.07) {
        w.children[0].rotation.x = a;
        m.root.updateMatrixWorld(true);
        const low = new THREE.Box3().setFromObject(w, true).min.y;
        sunk = Math.min(sunk, low);
        float = Math.max(float, low);
      }
      assert.ok(sunk > -0.004, `${kind} tire ${(-sunk * 100).toFixed(1)} cm into the road`);
      assert.ok(float < 0.004, `${kind} tire ${(float * 100).toFixed(1)} cm over the road on a flat`);
    }
  }
});

test('a fender never comes down through its tire, at the most the body ever pitches, rolls and bobs', () => {
  for (const kind of [...CLOSED, 'race-future'] as const) {
    const m = supercar(kind, '#3366cc');
    // A supercar's cabin is a solid of its own sunk into the body: its hidden floor isn't a fender.
    m.top.visible = false;
    const wheels = new Set<THREE.Object3D>(m.wheels);
    const body = meshesUnder(m.root, wheels);
    const sides = body.map((b) => (b.material as THREE.Material).side);
    // Both faces: a supercar's arch is the inside of a solid, met from behind coming down through the hood.
    for (const b of body) (b.material as THREE.Material).side = THREE.DoubleSide;
    const ray = new THREE.Raycaster();
    /** Each tire's top, sampled over its middle: the columns with a fender within 25 cm over it, parked. */
    const columns = m.wheels.map((w) => {
      m.root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(w, true);
      const c = box.getCenter(new THREE.Vector3());
      const out: THREE.Vector3[] = [];
      for (const i of [-0.4, -0.2, 0, 0.2, 0.4]) for (const j of [-0.25, 0, 0.25]) {
        const at = new THREE.Vector3(c.x + (box.max.x - box.min.x) * i, 5, c.z + (box.max.z - box.min.z) * j);
        ray.set(at, down);
        const tire = ray.intersectObject(w, true)[0];
        if (tire && ray.intersectObjects(body, false).some((h) => h.point.y >= tire.point.y - 0.005 && h.point.y < tire.point.y + 0.25)) out.push(at);
      }
      assert.ok(out.length >= 3, `${kind}: a fender over each tire`);
      return out;
    });
    for (const [pitch, roll, bob] of [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [1, 1, -1], [1, -1, -1], [-1, 1, -1], [-1, -1, -1]]) {
      springs(m, pitch * BODY.pitch, roll * BODY.roll, bob * BODY.bob);
      m.root.updateMatrixWorld(true);
      m.wheels.forEach((w, k) => {
        for (const at of columns[k]) {
          ray.set(at, down);
          const tire = ray.intersectObject(w, true)[0];
          if (!tire) continue;
          const gaps = ray.intersectObjects(body, false).map((h) => h.point.y - tire.point.y).filter((d) => d > -0.15 && d < 0.25);
          if (gaps.length) assert.ok(Math.min(...gaps) > -0.005, `${kind} pitch ${pitch} roll ${roll}: fender ${(Math.min(...gaps) * 100).toFixed(1)} cm into the tire`);
        }
      });
    }
    body.forEach((b, i) => ((b.material as THREE.Material).side = sides[i]));
    // Parked, there's a gap over each tire for the springs to use.
    springs(m, 0, 0, 0);
    for (const w of m.wheels) assert.ok(w.userData.clear >= 0.025, `${kind} ${w.userData.clear} m over its tire`);
  }
});

/** How far (m) a front tire sticks out past the body's side, slice by slice along the car, when steered `steer`. */
function outside(body: THREE.BufferGeometry[], tire: THREE.BufferGeometry[]): number {
  const tris = (geos: THREE.BufferGeometry[]) => geos.flatMap((g) => {
    const p = g.attributes.position, idx = g.index;
    const n = idx ? idx.count : p.count;
    const out: THREE.Vector3[][] = [];
    for (let i = 0; i + 2 < n; i += 3) out.push([0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(p, idx ? idx.getX(i + k) : i + k)));
    return out;
  });
  const slice = (list: THREE.Vector3[][], z: number, side: number) => {
    let best = -Infinity;
    for (const t of list) for (let a = 0; a < 3; a++) {
      const p = t[a], q = t[(a + 1) % 3];
      if ((p.z - z) * (q.z - z) > 0) continue;
      const k = Math.abs(q.z - p.z) < 1e-9 ? 0 : (z - p.z) / (q.z - p.z);
      best = Math.max(best, side * (p.x + (q.x - p.x) * k));
    }
    return best;
  };
  const b = tris(body), t = tris(tire);
  const side = Math.sign(t[0][0].x);
  const zs = t.flat().map((p) => p.z);
  let worst = -Infinity;
  for (let z = Math.min(...zs) + 0.005; z < Math.max(...zs); z += 0.01) worst = Math.max(worst, slice(t, z, side) - slice(b, z, side));
  return worst;
}

/** Every mesh's geometry under `root`, in `root`'s frame. */
function baked(root: THREE.Object3D, keep: (m: THREE.Mesh) => boolean): THREE.BufferGeometry[] {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const out: THREE.BufferGeometry[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    let shown = true;
    for (let p: THREE.Object3D | null = m; p && p !== root; p = p.parent) shown &&= p.visible;
    if (m.isMesh && shown && keep(m)) out.push(m.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld)));
  });
  return out;
}

test("steered as far as they're ever drawn, front tires stay inside a closed car's sides", () => {
  for (const kind of CLOSED) {
    const m = supercar(kind, '#3366cc');
    assert.ok(m.steer >= 0.3, `${kind} steers ${m.steer}`);
    for (const w of m.wheels.filter((w) => w.userData.front)) {
      w.rotation.y = m.steer * Math.sign(w.position.x);
      const inWheel = (o: THREE.Object3D) => { for (let p: THREE.Object3D | null = o; p; p = p.parent) if (m.wheels.includes(p)) return true; return false; };
      const gap = outside(baked(m.root, (o) => !inWheel(o)), baked(m.root, (o) => { for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === w) return true; return false; }));
      assert.ok(gap < 0.002, `${kind}: front tire ${(gap * 100).toFixed(1)} cm out past the body at ${m.steer} rad`);
      w.rotation.y = 0;
    }
  }
  // The street's traffic: Kenney's other models, their wheels placed and turned the same way (streetlife.ts writeVehicle).
  for (const name of ['sedan', 'hatchback-sports', 'suv-luxury', 'van', 'delivery', 'delivery-flat', 'truck', 'garbage-truck', 'ambulance', 'firetruck'] as KitName[]) {
    const m = kitModel(name)!;
    const body = [m.body, ...(m.paint ? [m.paint] : [])];
    for (const h of m.hubs.filter((h) => h.front)) {
      const left = h.x > 0;
      const turn = new THREE.Matrix4().compose(new THREE.Vector3(h.x, h.y, h.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), m.steer * Math.sign(h.x) + (left ? Math.PI : 0)), new THREE.Vector3(1, 1, 1));
      const gap = outside(body, [m.wheel.clone().applyMatrix4(turn)]);
      assert.ok(gap < 0.002, `${name}: front tire ${(gap * 100).toFixed(1)} cm out past the body at ${m.steer} rad`);
    }
  }
});

test('brake lights come on braking (not just rolling), reversing lamps backing up, and the tails at night with someone in', () => {
  const fleet = new Fleet([], []);
  const i = CARS.findIndex((c) => c.kind === 'suv');
  const v = fleet.cars[i];
  const eye = new THREE.Vector3(0, STREET_Y, 0);
  const cars = parked();
  let p: CarPose = { x: 0, z: 0, rotY: 0, speed: 30, steer: 0 };
  const go = (pedals: { gas: number; brake: boolean }, frames: number) => {
    for (let f = 0; f < frames; f++) {
      p = drive(p, { ...pedals, turn: 0 }, 1 / 30, 'suv');
      fleet.place(i, p);
      fleet.update(1 / 30, cars, [], 0, { car: i, driving: true }, eye);
    }
  };
  go({ gas: 1, brake: false }, 30);
  assert.equal(v.tails.visible, false, 'on the gas, by day: off');
  go({ gas: 0, brake: false }, 30);
  assert.equal(v.tails.visible, false, 'just rolling: off');
  go({ gas: -1, brake: false }, 10);
  assert.equal(v.tails.visible, true, 'braking: on');
  assert.ok(v.tails.material.color.equals(TAIL_BRAKE) && TAIL_BRAKE.r > TAIL_NIGHT.r, 'braking: bright');
  go({ gas: -1, brake: false }, 90);
  assert.ok(p.speed < -0.3 && v.reverse.visible, 'backing up: the white lamps');
  go({ gas: 1, brake: false }, 60);
  assert.ok(!v.reverse.visible, 'going forward again: off');
  fleet.lamps = 1;
  go({ gas: 1, brake: false }, 10);
  assert.ok(v.tails.visible && v.tails.material.color.equals(TAIL_NIGHT) && v.beam.visible, 'driven at night: tails and headlights on');
  // A parked car at night stays dark.
  const other = fleet.cars.find((c) => c.index !== i)!;
  assert.ok(!other.tails.visible && !other.beam.visible);
});

test("off the road with the gas held, the ground dragging a car down isn't braking: no brake lights", () => {
  const i = CARS.findIndex((c) => c.kind === 'suv');
  const eye = new THREE.Vector3(0, STREET_Y, 0);
  const cars = parked();
  // Like the circuit's grass (main.ts onGrass): down to 12 m/s at 16 m/s² on top of the grass's own drag.
  const bog = (q: CarPose, dt: number): CarPose => ({ ...q, speed: q.speed > 12 ? Math.max(12, q.speed - 16 * dt) : q.speed });
  for (const [under, surface] of [['grass', undefined], ['sand', undefined], ['grass', bog]] as const) {
    const fleet = new Fleet([], []);
    fleet.course = { surfaceAt: () => under, surface };
    const v = fleet.cars[i];
    let p: CarPose = { x: 0, z: 0, rotY: 0, speed: 40, steer: 0 };
    let lit = 0;
    const go = (gas: number, frames: number) => {
      lit = 0;
      for (let f = 0; f < frames; f++) {
        p = drive(p, { gas, turn: 0, brake: false }, 1 / 30, 'suv', under);
        if (surface) p = surface(p, 1 / 30);
        fleet.place(i, p);
        fleet.update(1 / 30, cars, [], 0, { car: i, driving: true }, eye);
        if (v.tails.visible) lit++;
      }
    };
    go(1, 60);
    assert.equal(lit, 0, `${under}${surface ? ', bogging down' : ''}: lit ${lit} of 60 frames on the gas`);
    // On the brakes there, they still come on.
    p = { ...p, speed: 20 };
    go(-1, 10);
    assert.ok(lit > 0, `${under}: on the brakes`);
  }
});
