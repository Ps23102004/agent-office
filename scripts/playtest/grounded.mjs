// Car grounded: every kind of car with its wheels on whatever is under them (city road, lots, the race
// plaza, the circuit's asphalt, kerb and grass), its fenders clear of its tyres parked and as it
// actually moves, and its steered front wheels inside its body. Pure geometry: code asserts, no Jev.
import { CARS } from '../../src/shared/garage.ts';
import { CIRCUIT_CARS, CITY_GATE, TRACK, pointAt } from '../../src/shared/circuit.ts';
import { withThree } from './lib.mjs';
import { toGarage, getInNearest, driveToCircuit } from './places.mjs';

export const title = 'Cars on the ground, wheels inside the body';

/** Ground contact must be this close (m): the critic's bar, a tyre's own facets included. */
const GAP = 0.01;
/** Front wheels steered may poke out of the body this far (m), and fenders must clear tyres by at least 0. */
const POKE = 0.005;

const CITY_SPOTS = {
  'city road': { x: 40, z: 27, rotY: Math.PI / 2 },
  'front lot': { x: 5, z: 17.6, rotY: 0 },
  'side lot': { x: 21, z: 0, rotY: Math.PI / 2 },
  'race plaza': { x: CITY_GATE.out.x, z: CITY_GATE.out.z, rotY: 0 },
};
/** Across the main straight (it runs east, z = -3000): + is to the driver's left (north). */
const across = (s, d) => {
  const p = pointAt(s);
  return { x: p.x + p.tz * d, z: p.z - p.tx * d, rotY: Math.atan2(p.tx, p.tz) };
};
const CIRCUIT_SPOTS = {
  asphalt: across(100, 0),
  // The car's right-hand wheels on the kerb, its left-hand ones on the asphalt.
  kerb: across(100, -(TRACK.width / 2 + TRACK.curb / 2 - 0.8)),
  grass: across(100, -(TRACK.width / 2 + 10)),
  'turn 1 run-off': across(500, TRACK.width / 2 + 12),
};

export default async function grounded(t) {
  const { page } = await t.open({ view: 'third' });
  await withThree(page);

  // ---- The city: the garage's fleet, each kind on each surface ----
  await toGarage(page);
  const city = await page.evaluate(groundSweep, { which: 'office', spots: CITY_SPOTS });
  const own = await page.evaluate(groundSweep, { which: 'office', spots: null }); // where each one's parked
  await shoot(t, page, 'office', 'lambo', CITY_SPOTS['city road'], 'ground-eye-city-road-lambo');
  await shoot(t, page, 'office', 'suv', CITY_SPOTS['city road'], 'ground-eye-city-road-suv');
  await shoot(t, page, 'office', 'lambo', CITY_SPOTS['race plaza'], 'ground-eye-plaza-lambo');

  // ---- The circuit: its fleet on each surface, then each kind driven hard for how its body moves ----
  await getInNearest(page, 'lambo');
  await driveToCircuit(page);
  await page.waitForTimeout(1500);
  const circuit = await page.evaluate(groundSweep, { which: 'driver', spots: CIRCUIT_SPOTS });
  await shoot(t, page, 'driver', 'sedan-sports', CIRCUIT_SPOTS.grass, 'ground-eye-grass-sedan');
  await shoot(t, page, 'driver', 'lambo', CIRCUIT_SPOTS.kerb, 'ground-eye-kerb-lambo');

  const ground = { ...own, ...merge(city, circuit) };
  t.metric('wheelGapCm', ground);
  for (const spot of Object.keys(ground)) {
    const bad = Object.entries(ground[spot]).filter(([, r]) => r.worstCm === null || Math.abs(r.worstCm) > GAP * 100);
    t.check(`every kind's wheels within ${GAP * 100} cm of the ${spot}`, !bad.length, Object.fromEntries(bad.map(([k, r]) => [k, `${r.worstCm} cm on ${r.hit}`])));
  }

  // How each kind's body moves when it's driven: launch, brake, swerve both ways (a car at a time on the straight).
  const motion = {};
  const kinds = [...new Set(CIRCUIT_CARS.map((c) => c.kind))];
  for (const [n, kind] of kinds.entries()) {
    const i = CIRCUIT_CARS.findIndex((c) => c.kind === kind);
    await switchCar(page, i);
    await page.evaluate(([i, start]) => window.__office.driver.fleet.place(i, { ...start, speed: 0, steer: 0, slip: 0, yaw: 0 }), [i, across(-140, n % 2 ? 3 : -3)]);
    await page.waitForTimeout(600);
    await page.evaluate(sampleBody, i);
    for (const [keys, ms, shot] of [[['KeyW'], 2200], [['KeyS'], 600], [['KeyW', 'KeyA'], 700, true], [['KeyW', 'KeyD'], 700], [['KeyS'], 900]]) {
      for (const k of keys) await page.keyboard.down(k);
      if (shot) t.shot(page, `drive-${kind}`); // not awaited: the keys stay down meanwhile
      await page.waitForTimeout(ms);
      for (const k of keys) await page.keyboard.up(k);
    }
    const rows = await page.evaluate(() => {
      clearInterval(window.__bodyTimer);
      return window.__body;
    });
    // Back to its spot in the paddock, so it's not in the next one's way.
    await page.evaluate(([i, def]) => {
      const o = window.__office;
      const pose = { x: def.x, z: def.z, rotY: def.rotY, speed: 0, steer: 0, slip: 0 };
      o.driver.fleet.place(i, pose);
      o.net.send({ t: 'car.drive', car: i, ...pose });
    }, [i, CIRCUIT_CARS[i]]);
    motion[kind] = envelope(rows);
  }
  await page.evaluate(() => window.__office.getOut(true));

  // Fenders and steered wheels, at rest and at the worst moments each kind's body reached driving.
  const body = {};
  for (const kind of kinds) body[kind] = await page.evaluate(bodyCheck, { which: 'driver', index: CIRCUIT_CARS.findIndex((c) => c.kind === kind), poses: motion[kind].poses, steer: motion[kind].steer });
  // The city's own kinds aren't at the circuit: measured in the garage with the Kenney sports car's motion (the same body code).
  await page.evaluate(() => window.__office.ride('@garage'));
  await page.waitForFunction(() => window.__office.store.floor !== '@circuit' && window.__office.player.enabled, null, { timeout: 20_000 });
  const kenney = motion['sedan-sports'];
  for (const kind of ['suv', 'police', 'taxi']) if (kenney) body[kind] = await page.evaluate(bodyCheck, { which: 'office', index: CARS.findIndex((c) => c.kind === kind), poses: kenney.poses, steer: kenney.steer, relative: true });
  t.metric('motion', Object.fromEntries(Object.entries(motion).map(([k, m]) => [k, { topSpeed: m.topSpeed, pitch: m.pitch, roll: m.roll, dipCm: m.dipCm, steer: m.steer }])));
  t.metric('body', body);

  const closed = Object.entries(body).filter(([, b]) => !b.bike && !b.openWheel);
  const list = (f) => Object.fromEntries(closed.filter(([, b]) => f(b)).map(([k, b]) => [k, b]));
  t.check('fenders clear the tyres parked', !Object.keys(list((b) => b.fenderRestCm < 0)).length, Object.fromEntries(closed.map(([k, b]) => [k, `${b.fenderRestCm} cm`])));
  t.check('fenders clear the tyres as the body pitches, rolls and dips driving', !Object.keys(list((b) => b.fenderMovingCm < 0)).length, Object.fromEntries(closed.map(([k, b]) => [k, `${b.fenderMovingCm} cm (${b.fenderWorstPose})`])));
  t.check(`front wheels inside the body at full steer (within ${POKE * 100} cm)`, !Object.keys(list((b) => b.steerPokeCm > POKE * 100)).length, Object.fromEntries(closed.map(([k, b]) => [k, `${b.steerPokeCm} cm at ${b.steer} rad`])));
  for (const [k, b] of Object.entries(body)) if (b.openWheel) t.note(`${k}: wheels stand ${b.restPokeCm} cm outside the body parked: an open-wheeler, by design (not checked for poking out)`);
}

/** Out of the car you're in and into car `i`, once the office has you out of the first (it won't seat you in a car it still has you driving). */
async function switchCar(page, i) {
  await page.evaluate(() => window.__office.getOut(true));
  await page.waitForFunction(() => !window.__office.store.cars.some((c) => c?.driver === window.__office.store.you), null, { timeout: 5000 });
  await page.evaluate((i) => window.__office.getIn(i), i);
  await page.waitForFunction(() => window.__office.driver.driving, null, { timeout: 5000 });
}

function merge(...sweeps) {
  return Object.assign({}, ...sweeps);
}

/** Worst moments of a drive (body.position/rotation samples): the snapshots to measure clearance in, and the most the front wheels were turned. */
function envelope(rows) {
  const rest = rows[0];
  const by = (f, pick) => rows.reduce((a, b) => (pick(f(b), f(a)) ? b : a));
  const worst = [
    ['rest', rest],
    ['nose down', by((r) => r.r[0], (a, b) => a > b)],
    ['nose up', by((r) => r.r[0], (a, b) => a < b)],
    ['roll +', by((r) => r.r[2], (a, b) => a > b)],
    ['roll -', by((r) => r.r[2], (a, b) => a < b)],
    ['lowest', by((r) => r.p[1], (a, b) => a < b)],
  ];
  const r = (n) => Math.round(n * 1000) / 1000;
  return {
    poses: worst.map(([label, s]) => ({ label, p: s.p, r: s.r })),
    steer: r(Math.max(...rows.map((s) => s.steer))),
    topSpeed: r(Math.max(...rows.map((s) => s.speed))),
    pitch: [r(Math.min(...rows.map((s) => s.r[0]))), r(Math.max(...rows.map((s) => s.r[0])))],
    roll: [r(Math.min(...rows.map((s) => s.r[2]))), r(Math.max(...rows.map((s) => s.r[2])))],
    dipCm: r((rest.p[1] - Math.min(...rows.map((s) => s.p[1]))) * 100),
  };
}

/** A ground-level look at a car's front wheel at `spot`, rendered off-screen with a camera of its own. */
async function shoot(t, page, which, kind, spot, name) {
  const url = await page.evaluate(([which, kind, spot]) => {
    const T = window.THREE, o = window.__office, r = o.renderer;
    const fleet = which === 'office' ? o.office.cars : o.driver.fleet;
    const v = fleet.cars.find((c) => c.def.kind === kind);
    const saved = { ...v.pose };
    fleet.place(v.index, { ...spot, speed: 0, steer: 0, slip: 0, yaw: 0 });
    v.root.updateMatrixWorld(true);
    const size = new T.Vector2();
    r.getSize(size);
    const cam = new T.PerspectiveCamera(22, size.x / size.y, 0.02, 400);
    const ground = v.root.position.y;
    // The front wheel on the camera's side (+x, the driver's left): the other one is behind the body.
    const wheel = v.wheels.find((w) => w.userData.front && w.position.x > 0) ?? v.wheels[0];
    const at = new T.Vector3();
    wheel.getWorldPosition(at);
    // From the car's left side, 2.5 m out with the lens 6 cm off the ground, zoomed in on where the tyre meets it.
    const side = new T.Vector3(1, 0, 0).applyQuaternion(v.root.quaternion);
    cam.position.copy(at).addScaledVector(side, 2.5).setY(ground + 0.06);
    cam.lookAt(at.x, ground + 0.15, at.z);
    cam.updateMatrixWorld();
    r.shadowMap.needsUpdate = true;
    r.render(o.scene, cam);
    const url = r.domElement.toDataURL('image/png');
    fleet.place(v.index, saved);
    return url;
  }, [which, kind, spot]);
  t.image(name, Buffer.from(url.split(',')[1], 'base64'));
}

// ---- In the page (each runs on its own: page.evaluate sends its source) ----

/**
 * For the first car of each kind in a fleet: each wheel's lowest point against the ground straight
 * under it (the first thing a ray down from just above the tyre meets, cars and people aside), at each
 * of `spots`, or where the car's parked if `spots` is null. Returns { spot: { kind: { worstCm, wheelsCm, hit } } }.
 */
function groundSweep({ which, spots }) {
  const T = window.THREE, o = window.__office;
  const fleet = which === 'office' ? o.office.cars : o.driver.fleet;
  const skip = new Set([o.office.cars.group, o.driver.fleet.group]);
  o.scene.updateMatrixWorld(true);
  const ground = [];
  o.scene.traverse((m) => {
    if (!m.isMesh || m.isSkinnedMesh || m.isBatchedMesh) return;
    for (let p = m; p; p = p.parent) if (!p.visible || skip.has(p)) return;
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    if (mat && mat.transparent && !mat.depthWrite) return; // glows, shadows' blobs, effects
    ground.push({ m, box: new T.Box3().setFromObject(m) });
  });
  const ray = new T.Raycaster();
  const down = new T.Vector3(0, -1, 0);
  const under = (x, y, z) => {
    const near = ground.filter(({ box }) => x >= box.min.x - 0.01 && x <= box.max.x + 0.01 && z >= box.min.z - 0.01 && z <= box.max.z + 0.01 && box.min.y < y).map((g) => g.m);
    ray.set(new T.Vector3(x, y, z), down);
    ray.far = 3;
    const h = ray.intersectObjects(near, false)[0];
    if (!h) return null;
    // What it is, as far as the scene can say: merged meshes are nameless, so their colour there too.
    const mat = Array.isArray(h.object.material) ? h.object.material[0] : h.object.material;
    const vc = h.object.geometry.attributes.color;
    const col = vc && h.face ? new T.Color().fromBufferAttribute(vc, h.face.a) : mat?.color;
    return { y: h.point.y, what: `${h.object.name || h.object.geometry?.type || 'mesh'}${col ? ' #' + col.getHexString() : ''}` };
  };
  const out = {};
  const seen = new Set();
  for (const v of fleet.cars) {
    if (seen.has(v.def.kind)) continue;
    seen.add(v.def.kind);
    const saved = { ...v.pose };
    for (const [name, spot] of Object.entries(spots ?? { parked: { x: v.def.x, z: v.def.z, rotY: v.def.rotY } })) {
      fleet.place(v.index, { ...spot, speed: 0, steer: 0, slip: 0, yaw: 0 });
      v.root.updateMatrixWorld(true);
      const hits = [];
      const gaps = v.wheels.map((w) => {
        const bottom = new T.Box3().setFromObject(w, true).min.y;
        const hub = new T.Vector3();
        w.getWorldPosition(hub);
        const g = under(hub.x, bottom + 0.6, hub.z);
        if (g) hits.push(g.what);
        return g ? Math.round((bottom - g.y) * 1000) / 10 : null;
      });
      const known = gaps.filter((g) => g !== null);
      const key = spots ? name : `${which === 'office' ? 'garage' : 'paddock'} spot (parked)`;
      (out[key] ??= {})[v.def.kind] = { worstCm: known.length ? known.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a)) : null, wheelsCm: gaps, hit: [...new Set(hits)].join(', ') };
    }
    fleet.place(v.index, saved);
  }
  return out;
}

/** Every 50 ms, the body's pose (position, rotation) and the most the front wheels are turned, of car `i` in the fleet you're driving. */
function sampleBody(i) {
  const o = window.__office, v = o.driver.fleet.cars[i];
  window.__body = [];
  window.__bodyTimer = setInterval(() => {
    const b = v.body;
    window.__body.push({ p: b.position.toArray(), r: [b.rotation.x, b.rotation.y, b.rotation.z], steer: Math.max(0, ...v.wheels.filter((w) => w.userData.front).map((w) => Math.abs(w.rotation.y))), speed: Math.abs(v.pose.speed) });
  }, 50);
}

/**
 * Car `index`'s fenders against its tyres (rays straight down through each wheel arch: the body's
 * underside above the tyre's top, cm, below 0 is the tyre through the body) with its body posed as in
 * each of `poses`, and how far its front wheels poke out past the body's side seen from above at
 * `steer` (cm). `relative`: the poses are another car's, applied as moves from its rest pose.
 */
function bodyCheck({ which, index, poses, steer, relative }) {
  const T = window.THREE, o = window.__office;
  const fleet = which === 'office' ? o.office.cars : o.driver.fleet;
  const v = fleet.cars[index];
  const bike = v.wheels[0] && v.wheels.every((w) => { for (let p = w.parent; p; p = p.parent) if (p === v.body) return true; return false; });
  if (bike) return { bike: true };
  const inv = new T.Matrix4();
  const v3 = new T.Vector3();
  const isWheel = (m) => { for (let p = m; p; p = p.parent) if (v.wheels.includes(p)) return p; return null; };
  const isFlame = (m) => { for (let p = m; p; p = p.parent) if (p === v.flames) return true; return false; };
  const visible = (m) => { for (let p = m; p && p !== v.root; p = p.parent) if (!p.visible) return false; return true; };
  /** Triangles of the meshes `keep` picks, in the car's own frame. */
  const tris = (keep) => {
    const list = [];
    v.root.updateMatrixWorld(true);
    inv.copy(v.root.matrixWorld).invert();
    v.root.traverse((m) => {
      if (!m.isMesh || !visible(m) || !keep(m)) return;
      const pos = m.geometry.attributes.position, idx = m.geometry.index;
      const mm = new T.Matrix4().multiplyMatrices(inv, m.matrixWorld);
      const n = idx ? idx.count : pos.count;
      const P = (i) => v3.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(mm).toArray();
      for (let i = 0; i + 2 < n; i += 3) list.push([P(i), P(i + 1), P(i + 2)]);
    });
    return list;
  };
  /** The furthest out (x * side) the triangles reach where the plane z = zs cuts them. */
  const sliceX = (list, zs, side) => {
    let best = -Infinity;
    for (const t of list) for (let a = 0; a < 3; a++) {
      const p = t[a], q = t[(a + 1) % 3];
      if ((p[2] - zs) * (q[2] - zs) > 0) continue;
      const d = q[2] - p[2];
      const k = Math.abs(d) < 1e-9 ? 0 : (zs - p[2]) / d;
      best = Math.max(best, side * (p[0] + (q[0] - p[0]) * k));
    }
    return best;
  };
  const saved = { p: v.body.position.clone(), r: v.body.rotation.clone(), steer: v.wheels.map((w) => w.rotation.y), top: v.top.visible, open: v.open.visible };
  v.top.visible = true;
  v.open.visible = false;
  const rest = relative ? { p: saved.p.toArray(), r: [saved.r.x, saved.r.y, saved.r.z] } : poses[0];
  const pose = (s) => {
    if (relative) v.body.position.set(rest.p[0] + s.p[0] - poses[0].p[0], rest.p[1] + s.p[1] - poses[0].p[1], rest.p[2] + s.p[2] - poses[0].p[2]);
    else v.body.position.fromArray(s.p);
    v.body.rotation.set(s.r[0], s.r[1], s.r[2]);
  };
  const turn = (a) => v.wheels.forEach((w) => (w.rotation.y = w.userData.front ? a : 0));
  const ray = new T.Raycaster();
  const down = new T.Vector3(0, -1, 0);
  const fender = () => {
    v.root.updateMatrixWorld(true);
    inv.copy(v.root.matrixWorld).invert();
    const body = [];
    v.root.traverse((m) => m.isMesh && visible(m) && !isWheel(m) && !isFlame(m) && body.push(m));
    let worst = Infinity;
    for (const w of v.wheels) {
      const tyre = [];
      w.traverse((m) => m.isMesh && tyre.push(m));
      const hub = new T.Vector3().setFromMatrixPosition(w.matrixWorld).applyMatrix4(inv);
      // Over the tyre's crown only, and only the arch up there: lower down, a bumper or sill beside the tyre isn't over it.
      for (const dx of [-0.1, 0, 0.1]) for (let dz = -0.15; dz <= 0.151; dz += 0.05) {
        ray.set(new T.Vector3(hub.x + dx, 3, hub.z + dz).applyMatrix4(v.root.matrixWorld), down);
        const top = ray.intersectObjects(tyre, false)[0];
        if (!top) continue;
        const tyreTop = top.point.clone().applyMatrix4(inv).y;
        const above = ray.intersectObjects(body, false).map((h) => h.point.clone().applyMatrix4(inv).y).filter((y) => y > hub.y + 0.2);
        if (above.length) worst = Math.min(worst, Math.min(...above) - tyreTop);
      }
    }
    return worst === Infinity ? null : Math.round(worst * 1000) / 10;
  };
  const poke = () => {
    const body = tris((m) => !isWheel(m) && !isFlame(m));
    let worst = -Infinity;
    for (const w of v.wheels.filter((w) => w.userData.front)) {
      const tyre = tris((m) => isWheel(m) === w);
      const hub = new T.Vector3().setFromMatrixPosition(w.matrixWorld).applyMatrix4(inv);
      const side = Math.sign(hub.x) || 1;
      const zs = tyre.flat().map((p) => p[2]);
      for (let z = Math.min(...zs) + 0.005; z < Math.max(...zs); z += 0.01) worst = Math.max(worst, sliceX(tyre, z, side) - sliceX(body, z, side));
    }
    return Math.round(worst * 1000) / 10;
  };
  const out = { fenderRestCm: null, fenderMovingCm: null, fenderWorstPose: null, steer };
  pose(poses[0]);
  turn(0);
  out.fenderRestCm = fender();
  out.restPokeCm = poke();
  // Wheels already out past the body parked: an open-wheeler, made that way.
  out.openWheel = out.fenderRestCm === null || out.restPokeCm > 2;
  for (const s of poses) {
    pose(s);
    const f = fender();
    if (f !== null && (out.fenderMovingCm === null || f < out.fenderMovingCm)) [out.fenderMovingCm, out.fenderWorstPose] = [f, s.label];
  }
  pose(poses[0]);
  turn(steer);
  out.steerPokeCm = poke();
  v.body.position.copy(saved.p);
  v.body.rotation.copy(saved.r);
  v.wheels.forEach((w, i) => (w.rotation.y = saved.steer[i]));
  v.top.visible = saved.top;
  v.open.visible = saved.open;
  return out;
}
