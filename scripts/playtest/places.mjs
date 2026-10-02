// Getting places the way a player does (the elevator, the gates), and an in-page autopilot that
// steers by pressing keys, as a person at a keyboard would. Positions come from src/shared, so this
// runs under `node --import tsx` and never hard-codes the map.
import { CIRCUIT, CITY_GATE, track } from '../../src/shared/circuit.ts';
import { ARENA, CITY_ARENA_GATE } from '../../src/shared/arena.ts';
import { settled } from './lib.mjs';

/** The elevator down to the garage under your floor. */
export async function toGarage(page) {
  await page.evaluate(() => window.__office.ride('@garage'));
  await page.waitForFunction(() => window.__office.player.pos.y < -2, null, { timeout: 20_000 });
  await settled(page);
}

/** Behind the wheel of the nearest free car of `kind` (anything but a bicycle if none's given). */
export async function getInNearest(page, kind) {
  const car = await page.evaluate((kind) => {
    const o = window.__office, me = o.player.pos;
    const free = o.driver.fleet.cars.filter((v) => (kind ? v.def.kind === kind : v.def.kind !== 'bicycle') && !o.store.cars[v.index]?.driver && !o.store.cars[v.index]?.passenger);
    free.sort((a, b) => Math.hypot(a.pose.x - me.x, a.pose.z - me.z) - Math.hypot(b.pose.x - me.x, b.pose.z - me.z));
    if (!free.length) return null;
    o.getIn(free[0].index);
    return { index: free[0].index, kind: free[0].def.kind, name: free[0].def.name };
  }, kind);
  if (!car) throw new Error(`no free ${kind ?? 'car'}`);
  await page.waitForFunction(() => window.__office.driver.driving, null, { timeout: 5000 });
  return car;
}

/** The car you're driving onto the race plaza, in front of the city's gate: the one jump the office allows a city car (server/garage.ts plausible). */
export async function carToPlaza(page, rotY = 0) {
  await page.evaluate(([x, z, rotY]) => {
    const d = window.__office.driver;
    d.fleet.place(d.car, { x, z, rotY, speed: 0, steer: 0, slip: 0, yaw: 0 });
  }, [CITY_GATE.out.x, CITY_GATE.out.z, rotY]);
  await page.waitForTimeout(300);
}

/** Drives (W) north through the city's gate, `lane` metres east of its middle: out at the circuit, in one of its cars of the same kind. */
export async function driveToCircuit(page, lane = 0) {
  await carToPlaza(page, Math.PI);
  if (lane) {
    await page.waitForTimeout(1000); // the office's pace allowance covers a short hop after a second
    await page.evaluate(([x, z]) => {
      const d = window.__office.driver;
      d.fleet.place(d.car, { ...d.pose, x, z });
    }, [CITY_GATE.out.x + lane, CITY_GATE.out.z]);
  }
  await page.keyboard.down('KeyW');
  try {
    await page.waitForFunction((c) => window.__office.store.floor === c, CIRCUIT, { timeout: 15_000 });
  } catch (e) {
    // What's in the way: the cars near the gate, and where you got to.
    const near = await page.evaluate(([gx, gz]) => ({
      me: window.__office.driver.pose,
      cars: window.__office.driver.fleet.cars.filter((v) => Math.hypot(v.pose.x - gx, v.pose.z - gz) < 15).map((v) => ({ name: v.def.name, x: +v.pose.x.toFixed(2), z: +v.pose.z.toFixed(2), driver: window.__office.store.cars[v.index]?.driver ?? null })),
    }), [CITY_GATE.x, CITY_GATE.z]);
    throw new Error(`didn't get through the city gate: ${JSON.stringify(near)}`);
  } finally {
    await page.keyboard.up('KeyW');
  }
  await settled(page);
  await page.waitForFunction(() => window.__office.driver.driving, null, { timeout: 5000 }).catch(() => {});
}

/** Garage, a car, and through the gate to the circuit: where most driving scenarios start. Returns the car you got into in the city. */
export async function toCircuit(page, { kind = 'lambo', lane = 0 } = {}) {
  await toGarage(page);
  const car = await getInNearest(page, kind);
  await driveToCircuit(page, lane);
  return car;
}

/** On foot through the arena's gate on the plaza: stand outside it a moment (that arms the gate), then in it. */
export async function walkToArena(page) {
  const out = CITY_ARENA_GATE.out;
  await page.evaluate(() => window.__office.getOut(true));
  for (const [x, z] of [[out.x, out.z], [CITY_ARENA_GATE.x, CITY_ARENA_GATE.z]]) {
    await page.evaluate(([x, z]) => {
      const p = window.__office.player;
      p.pos.set(x, p.street, z);
    }, [x, z]);
    await page.waitForTimeout(400);
  }
  await page.waitForFunction((a) => window.__office.store.floor === a, ARENA, { timeout: 15_000 });
  await settled(page);
}

/** Back from wherever you are to the garage under the first floor (from the circuit or the arena, back through their gates). */
export async function backToGarage(page) {
  const from = await page.evaluate(() => window.__office.store.floor);
  await page.evaluate(() => window.__office.ride('@garage'));
  await page.waitForFunction((f) => window.__office.store.floor !== f, from, { timeout: 15_000 });
  await page.waitForFunction(() => window.__office.player.pos.y < -2 && window.__office.player.enabled, null, { timeout: 15_000 });
}

/**
 * An autopilot in the page: every 50 ms it aims at a point ahead on the track's centre line and holds
 * A or D (synthetic window key events: the game reads e.code), and W up to `maxSpeed`, braking (S)
 * into a corner that's too fast. `steerOnly` leaves the pedals to the scenario. A = left = rotY up.
 * `{ on: false }` lets go of everything.
 */
export async function autopilot(page, { on = true, lookahead = 14, maxSpeed = 30, steerOnly = false, offset = 0 } = {}) {
  const pts = on ? track().points.map((p) => [Math.round(p.x * 10) / 10, Math.round(p.z * 10) / 10, Math.round(p.tx * 1000) / 1000, Math.round(p.tz * 1000) / 1000]) : null;
  await page.evaluate(([pts, lookahead, maxSpeed, steerOnly, offset]) => {
    clearInterval(window.__autopilot);
    const keys = ['KeyW', 'KeyS', 'KeyA', 'KeyD'];
    const send = (code, down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code }));
    if (!pts) return keys.forEach((c) => send(c, false));
    const held = new Set();
    const set = (code, want) => {
      if (want !== held.has(code)) {
        send(code, want);
        want ? held.add(code) : held.delete(code);
      }
    };
    let near = 0;
    window.__autopilot = setInterval(() => {
      const p = window.__office.driver.pose;
      if (!p) return;
      // The nearest point, looked for round the last one (the car only gets a little further each tick).
      let best = Infinity;
      const look = (i) => {
        const d = (pts[i][0] - p.x) ** 2 + (pts[i][1] - p.z) ** 2;
        if (d < best) [best, near] = [d, i];
      };
      for (let k = -20; k < 60; k++) look((near + k + pts.length) % pts.length);
      if (best > 900) for (let i = 0; i < pts.length; i++) look(i);
      const a = pts[(near + Math.round((lookahead + Math.abs(p.speed) * 0.5) / 2)) % pts.length];
      // `offset` m to the driver's left of the centre line: (tz, -tx).
      const want = Math.atan2(a[0] + a[3] * offset - p.x, a[1] - a[2] * offset - p.z);
      const err = Math.atan2(Math.sin(want - p.rotY), Math.cos(want - p.rotY));
      set('KeyA', err > 0.04);
      set('KeyD', err < -0.04);
      if (steerOnly) return;
      const sharp = Math.abs(err) > 0.35;
      set('KeyW', p.speed < maxSpeed * (sharp ? 0.5 : 1));
      set('KeyS', sharp && p.speed > maxSpeed * 0.6);
    }, 50);
  }, [pts, lookahead, maxSpeed, steerOnly, offset]);
}
