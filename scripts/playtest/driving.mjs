// Driving feel: scripted manoeuvres on the circuit in the Lambo (launch, braking, slalom, a lane
// change at speed, lifting off mid-corner, a handbrake turn), each from a set speed and spot. Code
// asserts the hard limits (it goes, stops, turns the way it's told and doesn't spin out); Jev reads the
// telemetry put into words and says whether it reads as confident, controllable arcade handling.
import { TRACK, nearestProgress, pointAt, track } from '../../src/shared/circuit.ts';
import { DRIVE_STEP } from '../../src/shared/garage.ts';
import { bucket } from './lib.mjs';
import { toCircuit } from './places.mjs';

export const title = 'Driving feel: manoeuvres on the circuit';

/** The bars, in one place to tune. */
const BAR = {
  launchS: 6, // 0-100 km/h, s
  stopM: 40, // 100-0 km/h, m
  straightDeg: 3, // heading drift going straight or braking
  lagS: 0.35, // slalom: from a steer input to the car turning that way
  slalomSlipDeg: 20,
  laneMinM: 1.5, // a quick flick left then right moves the car over at least this far
  laneSettleS: 1.0, // and it's done turning this soon after
  laneSlipDeg: 15,
  liftSlipDeg: 30, // lifting off mid-corner: the tail may step out, not round
  drift: { minSlipDeg: 10, spinDeg: 90, keep: 0.4 }, // a handbrake turn slides, comes out pointing the right way, keeps some speed
};
const EDGE = TRACK.width / 2 + TRACK.curb;
const KMH = 3.6;
const corner = (name) => track().corners.find((c) => c.name === name);
/** On the track `s` m round, `d` m to the driver's left of the centre line, facing the way round. */
const at = (s, d = 0) => {
  const p = pointAt(s);
  return { x: p.x + p.tz * d, z: p.z - p.tx * d, rotY: Math.atan2(p.tx, p.tz) };
};

export default async function driving(t) {
  // Full graphics: no frame is skipped to hold it to 30 a second (runScript's clock is a step a frame).
  const { page } = await t.open({ view: 'third', graphics: 'full' });
  const car = await toCircuit(page, { kind: 'lambo' });
  t.metric('car', car);
  await page.waitForTimeout(1500); // shaders for a new place compile in the first second or so
  const pts = track().points.map((p) => [Math.round(p.x * 10) / 10, Math.round(p.z * 10) / 10]);

  /** Puts the car at `pose` doing `speed`, runs `phases` (lib: runScript), and returns its telemetry with track position added. */
  const run = async (name, pose, speed, phases) => {
    const start = { ...pose, speed, steer: 0, slip: 0, yaw: 0 };
    await page.evaluate((start) => window.__office.driver.fleet.place(window.__office.driver.car, start), start);
    // The screenshot first, then the run from the start again (runScript puts it there): a screenshot stalls a frame or two.
    await t.shot(page, `${name}-start`);
    const rows = await page.evaluate(runScript, { phases, pts, start, step: DRIVE_STEP });
    await t.shot(page, `${name}-end`);
    return rows.map((r) => ({ ...r, d: nearestProgress(r.x, r.z).d }));
  };
  const m = {};

  // Launch: flat out from a standstill down the main straight.
  let rows = await run('launch', at(-140), 0, [{ ms: 5000, keys: ['KeyW'] }]);
  m.launch = { to100s: firstTime(rows, (r) => r.speed >= 100 / KMH), speedAt5s: last(rows).speed, headingDriftDeg: deg(turned(rows)) };
  t.check(`launch: 0-100 km/h within ${BAR.launchS} s`, m.launch.to100s !== null && m.launch.to100s <= BAR.launchS, m.launch);
  t.check(`launch: goes straight on W alone (within ${BAR.straightDeg}°)`, Math.abs(m.launch.headingDriftDeg) <= BAR.straightDeg, m.launch);

  // Braking: S from 100 km/h until it stops.
  rows = await run('braking', at(-140), 100 / KMH, [{ ms: 6000, keys: ['KeyS'], until: 'stopped' }]);
  m.braking = { stopM: round(travelled(rows)), stopS: round(last(rows).t), headingDriftDeg: deg(turned(rows)), maxSlipDeg: maxSlip(rows) };
  t.check(`braking: 100-0 km/h within ${BAR.stopM} m`, m.braking.stopM <= BAR.stopM, m.braking);
  t.check(`braking: stays straight (within ${BAR.straightDeg}°)`, Math.abs(m.braking.headingDriftDeg) <= BAR.straightDeg && m.braking.maxSlipDeg <= BAR.straightDeg, m.braking);

  // Slalom: left, right, left… half a second each at 80 km/h.
  // The first flick is half as long, so the car weaves about the line it started on rather than off to one side.
  const flicks = Array.from({ length: 8 }, (_, i) => ({ ms: i ? 500 : 250, steer: i % 2 ? 'right' : 'left', cruise: 22 }));
  rows = await run('slalom', at(-140), 22, [{ ms: 400, cruise: 22 }, ...flicks, { ms: 600, cruise: 22 }]);
  m.slalom = { lagS: responseLag(rows, flicks.length), headingSwingDeg: swing(rows), maxSlipDeg: maxSlip(rows), offTrack: offTrack(rows) };
  t.check(`slalom: turns the way it's steered within ${BAR.lagS} s`, m.slalom.lagS !== null && m.slalom.lagS <= BAR.lagS, m.slalom);
  t.check(`slalom: grips (body slip under ${BAR.slalomSlipDeg}°) and stays on the track`, m.slalom.maxSlipDeg <= BAR.slalomSlipDeg && !m.slalom.offTrack, m.slalom);

  // Lane change at 160 km/h: a flick left, a flick right, then hands off.
  rows = await run('lane-change', at(-140, -3), 45, [{ ms: 500, cruise: 45 }, { ms: 350, steer: 'left', cruise: 45 }, { ms: 350, steer: 'right', cruise: 45 }, { ms: 2500, cruise: 45 }]);
  const after = rows.filter((r) => r.phase === 3);
  m.laneChange = { movedM: round(last(rows).d - rows[0].d), settleS: settle(after), endHeadingDeg: deg(headingError(last(rows))), maxSlipDeg: maxSlip(rows), offTrack: offTrack(rows) };
  t.check(`lane change: moves over at least ${BAR.laneMinM} m to the left`, m.laneChange.movedM >= BAR.laneMinM, m.laneChange);
  t.check(`lane change: settles within ${BAR.laneSettleS} s, pointing down the straight (within 5°)`, m.laneChange.settleS !== null && m.laneChange.settleS <= BAR.laneSettleS && Math.abs(m.laneChange.endHeadingDeg) <= 5, m.laneChange);
  t.check(`lane change: no slide (body slip under ${BAR.laneSlipDeg}°), on the track`, m.laneChange.maxSlipDeg <= BAR.laneSlipDeg && !m.laneChange.offTrack, m.laneChange);

  // Lift-off mid-corner: round the Sweeper (r 110) near the limit, then off the gas halfway round, still steering.
  const sweeper = corner('Sweeper');
  const v = Math.sqrt(10 * sweeper.r);
  const toMid = (sweeper.s0 + sweeper.s1) / 2 - (sweeper.s0 - 40);
  rows = await run('lift-off', at(sweeper.s0 - 40), v, [{ ms: (toMid / v) * 1000, steer: 'line', cruise: v }, { ms: 2000, steer: 'line' }]);
  const lifted = rows.filter((r) => r.phase === 1);
  m.liftOff = { entryKmh: Math.round(v * KMH), slipBeforeDeg: maxSlip(rows.filter((r) => r.phase === 0)), slipAfterDeg: maxSlip(lifted), offTrack: offTrack(rows), speedAfterKmh: Math.round(last(rows).speed * KMH) };
  t.check(`lift-off in a corner: the tail may step out, not round (body slip under ${BAR.liftSlipDeg}°)`, m.liftOff.slipAfterDeg <= BAR.liftSlipDeg, m.liftOff);
  t.check('lift-off in a corner: stays on the track', !m.liftOff.offTrack, m.liftOff);

  // Handbrake turn: into Turn 1 (90°, r 30) at 80 km/h, a pull on the handbrake at the turn-in, on the gas through it.
  const t1 = corner('Turn 1');
  rows = await run('handbrake', at(t1.s0 - 36), 22, [{ ms: 1500, steer: 'line', cruise: 22 }, { ms: 450, steer: 'line', keys: ['Space', 'KeyW'] }, { ms: 2500, steer: 'line', keys: ['KeyW'] }]);
  const drift = rows.filter((r) => r.phase >= 1);
  m.handbrake = { peakSlipDeg: maxSlip(drift), slidingS: round(drift.reduce((s, r, i) => s + (i && slipDeg(r) >= 10 && slipDeg(r) <= 45 ? r.t - drift[i - 1].t : 0), 0)), endHeadingDeg: deg(headingError(last(rows))), keptSpeed: round(Math.min(...drift.map((r) => r.speed)) / 22), spun: drift.some((r) => slipDeg(r) >= BAR.drift.spinDeg) };
  t.check(`handbrake turn: the tail slides (body slip at least ${BAR.drift.minSlipDeg}°)`, m.handbrake.peakSlipDeg >= BAR.drift.minSlipDeg, m.handbrake);
  t.check('handbrake turn: comes out of the corner pointing the way round (within 45°), not spun', !m.handbrake.spun && Math.abs(m.handbrake.endHeadingDeg) <= 45, m.handbrake);
  t.check(`handbrake turn: never drops below ${BAR.drift.keep * 100}% of its entry speed`, m.handbrake.keptSpeed >= BAR.drift.keep, m.handbrake);
  t.metric('manoeuvres', m);

  // ---- Jev: the same runs in words ----
  const state = {
    game: 'An arcade driving game, keyboard controls (W gas, S brake, A/D steer, Space handbrake). The car is a Lamborghini-style supercar on a race circuit.',
    runs: {
      launch: `Flat out from a standstill: 0-100 km/h in ${m.launch.to100s ?? 'never'} s (${bucket(m.launch.to100s ?? 99, [3.5, 6, 9], ['quick', 'fair', 'slow', 'very slow'])}), drifting ${Math.abs(m.launch.headingDriftDeg)}° off straight.`,
      braking: `Braking from 100 km/h stopped in ${m.braking.stopM} m and ${m.braking.stopS} s (${bucket(m.braking.stopM, [25, 40, 60], ['strong', 'fair', 'weak', 'very weak'])}), turning ${Math.abs(m.braking.headingDriftDeg)}° while stopping.`,
      slalom: `Steering left and right every half second at 80 km/h: the car started turning the new way ${m.slalom.lagS === null ? 'never' : `${m.slalom.lagS} s`} after each input (${bucket(m.slalom.lagS ?? 9, [0.15, 0.3, 0.5], ['instant', 'prompt', 'sluggish', 'very sluggish'])}), swinging ${m.slalom.headingSwingDeg}° side to side, the body sliding at most ${m.slalom.maxSlipDeg}°${m.slalom.offTrack ? ', and it left the track' : ''}.`,
      lane_change: `At 160 km/h a quick flick left then right moved the car ${m.laneChange.movedM} m over; it ${m.laneChange.settleS === null ? 'kept turning and never settled' : `stopped turning ${m.laneChange.settleS} s after the inputs`}, ending ${Math.abs(m.laneChange.endHeadingDeg)}° off the straight, body sliding at most ${m.laneChange.maxSlipDeg}°${m.laneChange.offTrack ? ', and it left the track' : ''}.`,
      lift_off: `Cornering at ${m.liftOff.entryKmh} km/h round a long right-hander, then lifting off the gas mid-corner while still steering: body slip went from ${m.liftOff.slipBeforeDeg}° to ${m.liftOff.slipAfterDeg}° (${bucket(m.liftOff.slipAfterDeg, [8, 20, 45], ['stable', 'a little tail movement', 'a big slide', 'a spin'])})${m.liftOff.offTrack ? ', and it left the track' : ''}.`,
      handbrake: `Handbrake pulled at the turn-in of a 90° corner at 80 km/h while on the gas: the body slid up to ${m.handbrake.peakSlipDeg}° (${m.handbrake.slidingS} s between 10° and 45°), ${m.handbrake.spun ? 'and spun round' : `ended ${Math.abs(m.handbrake.endHeadingDeg)}° off the way round`}, never dropping below ${Math.round(m.handbrake.keptSpeed * 100)}% of its entry speed.`,
    },
  };
  const ok = (what) => ({ type: 'noul', instructions: `Does \`runs.${what}\` describe what a player of an arcade racing game would call good, controllable handling for that manoeuvre?`, flag: (a) => a.noul < 0.5 });
  await t.judge('handling', state, {
    launch: ok('launch'),
    braking: ok('braking'),
    slalom: ok('slalom'),
    lane_change: ok('lane_change'),
    lift_off: ok('lift_off'),
    handbrake: ok('handbrake'),
    feel: {
      type: 'score',
      instructions: 'Taken together, how does the handling described in `runs` feel for an arcade driving game?',
      criteria: ['Broken: the car does the wrong thing or nothing', 'Frustrating: sluggish, floaty or spins too easily', 'Fine: works, unremarkable', 'Great: confident, responsive and controllable, slides you can catch'],
      flag: (a) => a.score < 2,
    },
    verdict: {
      type: 'choice',
      instructions: 'Does this telemetry describe confident, controllable arcade handling?',
      criteria: { yes: 'Confident and controllable: responsive steering, strong brakes, slides that can be caught.', partly: 'Mostly, but some manoeuvre reads sluggish, twitchy or unstable.', no: 'No: the car is hard to control or does the wrong thing.' },
      flag: (a) => a.choice !== 'yes',
    },
  });
}

// ---- Reading the telemetry ----
const round = (n) => Math.round(n * 100) / 100;
const last = (rows) => rows[rows.length - 1];
const deg = (rad) => Math.round((rad * 180) / Math.PI * 10) / 10;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const turned = (rows) => wrap(last(rows).rotY - rows[0].rotY);
const slipDeg = (r) => Math.abs(Math.atan2(Math.abs(r.slip), Math.abs(r.speed)) * 180) / Math.PI;
const maxSlip = (rows) => Math.round(Math.max(0, ...rows.filter((r) => Math.hypot(r.speed, r.slip) > 3).map(slipDeg)) * 10) / 10;
const travelled = (rows) => rows.slice(1).reduce((s, r, i) => s + Math.hypot(r.x - rows[i].x, r.z - rows[i].z), 0);
const firstTime = (rows, f) => rows.find(f)?.t ?? null;
const offTrack = (rows) => rows.some((r) => Math.abs(r.d) > EDGE);
/** How far the car's heading is off the track's direction where it is. */
const headingError = (r) => {
  const p = pointAt(nearestProgress(r.x, r.z).s);
  return wrap(r.rotY - Math.atan2(p.tx, p.tz));
};
/** Yaw rate (rad/s, + to the left) between samples. */
const yawRates = (rows) => rows.slice(1).map((r, i) => ({ t: r.t, phase: r.phase, w: wrap(r.rotY - rows[i].rotY) / Math.max(1e-3, r.t - rows[i].t) }));
/** Slalom: the mean time from each steer input to the car turning that way (null if it never did). */
function responseLag(rows, flicks) {
  const w = yawRates(rows);
  const lags = [];
  for (let k = 1; k <= flicks; k++) {
    const start = rows.find((r) => r.phase === k)?.t;
    if (start === undefined) return null;
    const left = k % 2 === 1;
    const hit = w.find((s) => s.t >= start && (left ? s.w > 0.05 : s.w < -0.05));
    if (!hit) return null;
    lags.push(hit.t - start);
  }
  return round(lags.reduce((a, b) => a + b, 0) / lags.length);
}
/** Slalom: peak-to-peak heading swing. */
const swing = (rows) => {
  const h = rows.map((r) => wrap(r.rotY - rows[0].rotY));
  return deg(Math.max(...h) - Math.min(...h));
};
/** Seconds into `rows` until the yaw rate stays under 0.05 rad/s (null if it never does). */
function settle(rows) {
  const w = yawRates(rows);
  const k = w.findLastIndex((s) => Math.abs(s.w) >= 0.05);
  if (k === w.length - 1) return null;
  return round((k < 0 ? rows[0].t : w[k].t) - rows[0].t);
}

/**
 * In the page: drives by a list of phases, `ms` each, pressing keys as a player would (synthetic key
 * events: the game reads e.code). A phase has `keys` held, `steer` ('left', 'right', or 'line': at the
 * track's centre line 14 m+ ahead), `cruise` (W whenever slower than that, m/s) and `until: 'stopped'`
 * (on to the next once the car has). The car is put at `start` first. It runs in the game's own frame
 * loop, on a clock of its own that the game runs on meanwhile: `step` s a frame (the car's physics
 * step), so a run is the same steps with the same keys every time, whatever the frame rate. It samples
 * the car each frame and resolves with the samples (`t`, s on that clock).
 */
function runScript({ phases, pts, start, step }) {
  const o = window.__office;
  const all = ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'Space', 'ShiftLeft'];
  const held = new Set();
  const set = (code, want) => {
    if (want === held.has(code)) return;
    window.dispatchEvent(new KeyboardEvent(want ? 'keydown' : 'keyup', { code }));
    want ? held.add(code) : held.delete(code);
  };
  let near = 0;
  const lineError = (p) => {
    let best = Infinity;
    for (let k = -20; k < 60; k++) {
      const i = (near + k + pts.length) % pts.length, d = (pts[i][0] - p.x) ** 2 + (pts[i][1] - p.z) ** 2;
      if (d < best) [best, near] = [d, i];
    }
    const a = pts[(near + Math.round((14 + Math.abs(p.speed) * 0.5) / 2)) % pts.length];
    const want = Math.atan2(a[0] - p.x, a[1] - p.z);
    return Math.atan2(Math.sin(want - p.rotY), Math.cos(want - p.rotY));
  };
  // The game's clock for the run: one physics step a frame however long the frame really took (and
  // never ahead of real time), so the car gets the same steps, and the keys at the same steps, every run.
  const raf = window.requestAnimationFrame;
  let real = null, clock = null;
  window.requestAnimationFrame = (cb) => raf((ts) => {
    if (ts !== real) [clock, real] = [clock === null ? ts : Math.min(clock + step * 1000, ts), ts];
    cb(clock);
  });
  return new Promise((resolve) => {
    const rows = [];
    let t0 = null, k = 0, from = 0;
    const frame = (ts) => {
      if (t0 === null) {
        o.driver.fleet.place(o.driver.car, start);
        t0 = ts;
      }
      const p = o.driver.pose, sim = ts - t0;
      while (k < phases.length && (sim - from >= phases[k].ms || (phases[k].until === 'stopped' && p && Math.abs(p.speed) < 0.3 && sim - from > 200))) [from, k] = [sim, k + 1];
      if (k >= phases.length || !p) {
        window.requestAnimationFrame = raf;
        all.forEach((c) => set(c, false));
        return resolve(rows);
      }
      window.requestAnimationFrame(frame);
      const ph = phases[k];
      const want = new Set(ph.keys ?? []);
      if (ph.cruise !== undefined && p.speed < ph.cruise) want.add('KeyW');
      const steer = ph.steer === 'line' ? lineError(p) : ph.steer === 'left' ? 1 : ph.steer === 'right' ? -1 : 0;
      if (steer > 0.04) want.add('KeyA');
      if (steer < -0.04) want.add('KeyD');
      all.forEach((c) => set(c, want.has(c)));
      const r = (n) => Math.round(n * 1000) / 1000;
      rows.push({ t: r(sim / 1000), phase: k, x: r(p.x), z: r(p.z), rotY: r(p.rotY), speed: r(p.speed), slip: r(p.slip ?? 0), steer: r(p.steer ?? 0), keys: [...held].join('') });
    };
    window.requestAnimationFrame(frame);
  });
}
