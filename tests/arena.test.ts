import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARENA_BOXES,
  ARENA_CENTER,
  ARENA_GATE,
  ARENA_HALF,
  BODY_R,
  CITY_ARENA_GATE,
  CROUCH,
  EYE_Y,
  HEAD_C,
  HEAD_R,
  PRACTICE_DOWN,
  PRACTICE_TARGETS,
  RULES,
  SPAWNS,
  nextShot,
  rayBox,
  rayPerson,
  rayWorld,
  spreadOf,
  targetAt,
  type V3,
} from '../src/shared/arena.js';
import { CITY_GATE, inGate } from '../src/shared/circuit.js';
import { RACE_PLAZA, cityPaved } from '../src/shared/city.js';
import { ArenaControl } from '../src/server/arena.js';

const C = ARENA_CENTER;
const inside = (b: (typeof ARENA_BOXES)[number], x: number, z: number, pad = 0) => x > b.minX - pad && x < b.maxX + pad && z > b.minZ - pad && z < b.maxZ + pad;

test('the yard: every spawn and the gate home are clear of cover, inside the walls', () => {
  for (const s of [...SPAWNS, ARENA_GATE.out]) {
    assert.ok(Math.abs(s.x - C.x) < ARENA_HALF - 1 && Math.abs(s.z - C.z) < ARENA_HALF - 1, `${s.x}, ${s.z} inside`);
    for (const b of ARENA_BOXES) assert.ok(!inside(b, s.x, s.z, 1), `${s.x}, ${s.z} clear of a ${b.kind}`);
  }
  // Each spawn looks toward the middle.
  for (const s of SPAWNS) {
    const fx = Math.sin(s.rotY), fz = Math.cos(s.rotY);
    assert.ok(fx * (C.x - s.x) + fz * (C.z - s.z) > 0);
  }
});

test('the city gate to the arena is on the race plaza, apart from the circuit gate, on paving', () => {
  const g = CITY_ARENA_GATE;
  assert.ok(g.x > RACE_PLAZA.minX && g.x < RACE_PLAZA.maxX && g.z > RACE_PLAZA.minZ && g.z < RACE_PLAZA.maxZ);
  assert.ok(cityPaved(g.out.x, g.out.z));
  assert.ok(inGate(g, g.x, g.z) && !inGate(CITY_GATE, g.x, g.z) && !inGate(g, CITY_GATE.x, CITY_GATE.z));
  assert.ok(!inGate(g, g.out.x, g.out.z) && !inGate(CITY_GATE, g.out.x, g.out.z), 'arriving back is out of both openings');
});

test('rays: boxes, the ground, and a person, head and body', () => {
  const o = { x: 0, y: 1, z: 0 };
  assert.equal(rayBox(o, { x: 1, y: 0, z: 0 }, { minX: 5, maxX: 6, minZ: -1, maxZ: 1, y0: 0, y1: 2 }), 5);
  assert.equal(rayBox(o, { x: 1, y: 0, z: 0 }, { minX: 5, maxX: 6, minZ: 2, maxZ: 3, y0: 0, y1: 2 }), Infinity);
  const feet = { x: 10, y: 0, z: 0 };
  const body = rayPerson({ x: 0, y: 0.8, z: 0 }, { x: 1, y: 0, z: 0 }, feet);
  assert.ok(body && !body.head && Math.abs(body.t - (10 - 0.42)) < 1e-6);
  const head = rayPerson({ x: 0, y: 1.65, z: 0 }, { x: 1, y: 0, z: 0 }, feet);
  assert.ok(head?.head);
  assert.equal(rayPerson({ x: 0, y: 2.5, z: 0 }, { x: 1, y: 0, z: 0 }, feet), undefined, 'over their head');
  assert.equal(rayPerson({ x: 0, y: 1, z: 0 }, { x: -1, y: 0, z: 0 }, feet), undefined, 'the other way');
  const down = Math.SQRT1_2;
  assert.ok(Math.abs(rayWorld({ x: C.x, y: 10, z: C.z + 20 }, { x: 0, y: -down, z: down }) - 10 / down) < 1e-6, 'into the ground');
});

/** Someone at each of these spots, and the arena judging shots between them. */
function match(spots: Record<string, V3>) {
  const a = new ArenaControl((id) => spots[id]);
  let now = 1_000_000;
  for (const id of Object.keys(spots)) a.join(id, id.toUpperCase(), now);
  const eye = (id: string) => ({ ...spots[id], y: spots[id].y + EYE_Y });
  // At the chest (or `dy` up from it: 0.6 is the face).
  const at = (from: string, to: string, dy = 0) => {
    const o = eye(from), t = spots[to];
    const d = { x: t.x - o.x, y: t.y + 0.75 + dy - o.y, z: t.z - o.z };
    return { o, d };
  };
  return {
    a,
    get now() {
      return now;
    },
    wait(ms: number) {
      now += ms;
      return a.tick(now);
    },
    shoot(from: string, to: string, dy = 0) {
      now += RULES.every;
      const { o, d } = at(from, to, dy);
      return a.fire(from, o, d, now);
    },
  };
}

test('a match: two in makes it live; four body shots kill, head shots three; the dead come back', () => {
  const m = match({ a: { x: C.x - 20, y: 0, z: C.z - 30 }, b: { x: C.x - 10, y: 0, z: C.z - 30 } });
  assert.equal(m.a.state().phase, 'live');
  // Safe for a moment after coming in.
  assert.equal(m.a.state().players.find((p) => p.id === 'b')!.hp, RULES.hp);
  m.wait(RULES.safe * 1000);
  for (let i = 0; i < 3; i++) assert.equal(m.shoot('a', 'b')?.hit, 'b');
  assert.equal(m.a.state().players.find((p) => p.id === 'b')!.hp, RULES.hp - 3 * RULES.body);
  const last = m.shoot('a', 'b');
  assert.ok(last?.kill);
  let s = m.a.state();
  assert.equal(s.players.find((p) => p.id === 'a')!.kills, 1);
  assert.equal(s.players.find((p) => p.id === 'b')!.alive, false);
  assert.equal(s.feed.at(-1)?.victim, 'B');
  // The dead don't shoot.
  assert.equal(m.shoot('b', 'a'), undefined);
  const back = m.wait(RULES.respawn * 1000);
  assert.deepEqual(back.spawned.map((x) => x.id), ['b']);
  s = m.a.state();
  assert.ok(s.players.find((p) => p.id === 'b')!.alive);
  // Head shots: three.
  m.wait(RULES.safe * 1000);
  for (let i = 0; i < 2; i++) assert.ok(m.shoot('a', 'b', 0.6)?.head);
  assert.ok(m.shoot('a', 'b', 0.6)?.kill);
});

test('rounds run out, a reload fills them; the hurt heal; cover stops a shot; nobody fires from somewhere else', () => {
  const m = match({ a: { x: C.x - 20, y: 0, z: C.z - 30 }, b: { x: C.x + 20, y: 0, z: C.z - 30 } });
  m.wait(RULES.safe * 1000);
  // Into the ground, so nobody's hurt.
  const fireDown = () => m.a.fire('a', { x: C.x - 20, y: EYE_Y, z: C.z - 30 }, { x: 0, y: -1, z: 0.1 }, m.now);
  for (let i = 0; i < RULES.mag; i++) {
    m.wait(RULES.every);
    assert.ok(fireDown(), `round ${i + 1}`);
  }
  m.wait(RULES.every);
  assert.equal(fireDown(), undefined, 'empty');
  assert.ok(m.a.reload('a', m.now));
  m.wait(RULES.reload);
  assert.ok(fireDown(), 'reloaded');
  // Not from where they are.
  assert.equal(m.a.fire('a', { x: C.x, y: EYE_Y, z: C.z }, { x: 1, y: 0, z: 0 }, m.now + 500), undefined);
  // The middle block's between them at body height: the shot stops at it.
  const m2 = match({ a: { x: C.x - 8, y: 0, z: C.z + 1.3 }, b: { x: C.x + 8, y: 0, z: C.z + 1.3 } });
  m2.wait(RULES.safe * 1000);
  assert.equal(m2.shoot('a', 'b')?.hit, undefined);
  // Hurt, then left alone: healed.
  const m3 = match({ a: { x: C.x - 20, y: 0, z: C.z - 30 }, b: { x: C.x - 10, y: 0, z: C.z - 30 } });
  m3.wait(RULES.safe * 1000);
  m3.shoot('a', 'b');
  for (let i = 0; i < (RULES.healAfter + 2) * 4; i++) m3.wait(250);
  assert.equal(m3.a.state().players.find((p) => p.id === 'b')!.hp, RULES.hp);
});

test('first to the limit wins; the results come down and a new match starts; one left is warm-up', () => {
  const m = match({ a: { x: C.x - 20, y: 0, z: C.z - 30 }, b: { x: C.x - 10, y: 0, z: C.z - 30 } });
  for (let k = 0; k < RULES.limit; k++) {
    m.wait(RULES.respawn * 1000);
    m.wait(RULES.safe * 1000);
    if (k % 6 === 5) m.a.reload('a', m.now), m.wait(RULES.reload);
    for (let i = 0; i < 4; i++) m.shoot('a', 'b');
  }
  let s = m.a.state();
  assert.equal(s.phase, 'over');
  assert.equal(s.winner, 'A');
  m.wait(RULES.results * 1000);
  s = m.a.state();
  assert.equal(s.phase, 'live');
  assert.ok(s.players.every((p) => p.kills === 0 && p.deaths === 0));
  m.a.leave('b', m.now);
  assert.equal(m.a.state().phase, 'warmup');
});

test('a shot after someone is due back leaves their respawn to the timer; late shots still count', () => {
  const m = match({ a: { x: C.x - 20, y: 0, z: C.z - 30 }, b: { x: C.x - 10, y: 0, z: C.z - 30 } });
  m.wait(RULES.safe * 1000);
  for (let i = 0; i < 4; i++) m.shoot('a', 'b');
  // Past b's respawn, a fires before the timer comes round: the timer still has b's spawn to tell.
  const at = m.now + RULES.respawn * 1000 + 50;
  m.a.fire('a', { x: C.x - 20, y: EYE_Y, z: C.z - 30 }, { x: 0, y: -1, z: 0.1 }, at);
  assert.deepEqual(m.a.tick(at + 10).spawned.map((s) => s.id), ['b']);
  // Shots 100 ms apart, the middle one 40 ms late: all three taken.
  const m2 = match({ a: { x: C.x - 20, y: 0, z: C.z - 30 }, b: { x: C.x - 10, y: 0, z: C.z - 30 } });
  const o = { x: C.x - 20, y: EYE_Y, z: C.z - 30 }, d = { x: 0, y: -1, z: 0.1 };
  const t0 = m2.now + 5000;
  assert.ok(m2.a.fire('a', o, d, t0));
  assert.ok(m2.a.fire('a', o, d, t0 + 140));
  assert.ok(m2.a.fire('a', o, d, t0 + 200));
  assert.equal(m2.a.fire('a', o, d, t0 + 210), undefined, 'but not faster than the rifle');
  // Nor from over the top of cover, out of their own eyes' sight.
  assert.equal(m2.a.fire('a', { ...o, y: o.y + 2 }, d, t0 + 1000), undefined);
});

test('the head is a ball where the Person draws it: low on the face counts, the shoulders beside it don\'t; crouching takes it down', () => {
  const feet = { x: 10, y: 0, z: 0 };
  const across = { x: 1, y: 0, z: 0 };
  // Straight at the face, from its chin up to the crown.
  for (const y of [1.05, 1.15, 1.25, 1.32, 1.5, 1.62]) assert.equal(rayPerson({ x: 0, y, z: 0 }, across, feet)?.head, true, `face at ${y}`);
  // Chest and belly: the body.
  for (const y of [0.3, 0.6, 0.9]) assert.equal(rayPerson({ x: 0, y, z: 0 }, across, feet)?.head, false, `body at ${y}`);
  // Beside the neck, over the shoulder: nothing there.
  assert.equal(rayPerson({ x: 0, y: 1.08, z: 0.38 }, across, feet), undefined);
  // Over the top of the head.
  assert.equal(rayPerson({ x: 0, y: HEAD_C + HEAD_R + 0.02, z: 0 }, across, feet), undefined);
  // Crouching, the head comes down: where the face was is clear, and the face is lower.
  const low = { ...feet, crouch: true };
  assert.equal(rayPerson({ x: 0, y: 1.6, z: 0 }, across, low), undefined);
  assert.equal(rayPerson({ x: 0, y: HEAD_C - CROUCH, z: 0 }, across, low)?.head, true);
  // From above, down onto the head: the head first.
  const down = rayPerson({ x: 10, y: 5, z: 0.05 }, { x: 0, y: -1, z: 0 }, feet);
  assert.ok(down?.head && Math.abs(down.t - (5 - HEAD_C - HEAD_R)) < 0.01);
});

test('shots say what they did: damage and health left, the streak on a kill; someone just back in is shielded, unharmed', () => {
  const m = match({ a: { x: C.x - 20, y: 0, z: C.z - 30 }, b: { x: C.x - 10, y: 0, z: C.z - 30 } });
  // Safe just after coming in: shielded, no hit, no harm.
  const safe = m.shoot('a', 'b');
  assert.equal(safe?.shield, 'b');
  assert.equal(safe?.hit, undefined);
  assert.equal(m.a.state().players.find((p) => p.id === 'b')!.hp, RULES.hp);
  m.wait(RULES.safe * 1000);
  const first = m.shoot('a', 'b');
  assert.deepEqual([first?.hit, first?.dmg, first?.hp, first?.head], ['b', RULES.body, RULES.hp - RULES.body, false]);
  const head = m.shoot('a', 'b', 0.6);
  assert.deepEqual([head?.dmg, head?.hp, head?.head], [RULES.head, RULES.hp - RULES.body - RULES.head, true]);
  const kill = m.shoot('a', 'b', 0.6);
  assert.ok(kill?.kill);
  assert.equal(kill.hp, 0);
  assert.equal(kill.streak, 1, 'the streak counting this kill, before the state catches up');
  // Firing gives up your own safety straight away.
  const m2 = match({ a: { x: C.x - 20, y: 0, z: C.z - 30 }, b: { x: C.x - 10, y: 0, z: C.z - 30 } });
  m2.shoot('b', 'a');
  assert.equal(m2.a.state().players.find((p) => p.id === 'b')!.safeUntil, undefined);
  assert.equal(m2.shoot('a', 'b')?.hit, 'b');
});

test('lag: a shot at where the shooter saw someone running counts, looked for that far back; a bot (no round trip) is judged on now', () => {
  // b runs across a's view at 7.5 m/s, its moves reaching the office every 66 ms.
  const spots: Record<string, V3> = { a: { x: C.x - 20, y: 0, z: C.z - 30 }, b: { x: C.x - 10, y: 0, z: C.z - 26 } };
  const a = new ArenaControl((id) => spots[id]);
  let now = 2_000_000;
  a.join('a', 'A', now);
  a.join('b', 'B', now);
  now += RULES.safe * 1000;
  const run = 7.5;
  for (let i = 0; i < 20; i++) {
    now += 66;
    spots.b = { x: spots.b.x, y: 0, z: spots.b.z - run * 0.066 };
    a.moved('b', spots.b, now);
  }
  // a's page showed b where they were 100 ms (a's round trip) + the page's easing ago: 1.3 m back.
  const rtt = 100;
  const seen = { x: spots.b.x, y: 0, z: spots.b.z + run * (rtt + 100) / 1000 };
  const o = { x: spots.a.x, y: EYE_Y, z: spots.a.z };
  const d = { x: seen.x - o.x, y: 0.75 - EYE_Y, z: seen.z - o.z };
  assert.equal(a.fire('a', o, d, now, rtt)?.hit, 'b', 'rewound: a hit');
  assert.equal(a.fire('a', o, d, now + RULES.every)?.hit, undefined, 'judged on where b is now: a miss');
  // Never further back than 300 ms, however slow the connection.
  const long = { x: spots.b.x, y: 0, z: spots.b.z + run * 0.9 };
  assert.equal(a.fire('a', o, { x: long.x - o.x, y: 0.75 - EYE_Y, z: long.z - o.z }, now + 2 * RULES.every, 5000)?.hit, undefined);
});

test('fire rate: holding the trigger fires ten a second at any frame rate, and never two in a burst', () => {
  for (const fps of [24, 30, 60, 75, 144]) {
    let due = 0, shots = 0, s = 1;
    const jitter = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 0.6;
    for (let now = 0; now < 3000; now += 1000 / fps + jitter()) {
      if (now < due) continue;
      shots++;
      due = nextShot(due, now);
    }
    assert.ok(Math.abs(shots - 30) <= 1, `${fps} fps: ${shots} shots in 3 s`);
  }
  // Let go a while and pulled again: the next is a whole gap after.
  assert.equal(nextShot(100, 5000), 5000 + RULES.every);
});

test('spread: still is tightest, running spreads more than walking, the sights and crouching tighten it', () => {
  const still = spreadOf(0, true, 0, 0), walk = spreadOf(4.6, true, 0, 0), run = spreadOf(7.5, true, 0, 0);
  assert.ok(still < walk && walk < run);
  assert.ok(spreadOf(0, true, 1, 0) < still * 0.2);
  // Down the sights you still can't run and gun: moving keeps half its spread.
  assert.ok(spreadOf(4.6, true, 1, 0) > spreadOf(0, true, 1, 0) * 3);
  assert.ok(spreadOf(4.6, true, 0, 0, true) < walk);
});

test('practice targets: in warm-up alone, shot down in four, back up after a while; gone once it\'s a match', () => {
  // Every lane clear of the cover, inside the walls.
  for (let i = 0; i < PRACTICE_TARGETS; i++) {
    for (let k = 0; k <= 40; k++) {
      const p = targetAt(i, k * 400);
      assert.ok(Math.abs(p.x - C.x) < ARENA_HALF - 1 && Math.abs(p.z - C.z) < ARENA_HALF - 1);
      for (const b of ARENA_BOXES) assert.ok(!inside(b, p.x, p.z, BODY_R), `target ${i} into a ${b.kind}`);
    }
  }
  const me = { x: C.x - 19, y: 0, z: C.z - 20 };
  const a = new ArenaControl((id) => (id === 'a' ? me : undefined));
  let now = 3_000_000;
  a.join('a', 'A', now);
  assert.equal(a.state().phase, 'warmup');
  assert.deepEqual(a.state().targets, [0, 0, 0, 0]);
  const o = { x: me.x, y: EYE_Y, z: me.z };
  const shoot = () => {
    now += RULES.every;
    const t = targetAt(1, now);
    return a.fire('a', o, { x: t.x - o.x, y: 0.75 - EYE_Y, z: t.z - o.z }, now, 0);
  };
  for (let i = 0; i < 3; i++) assert.equal(shoot()?.target, 1);
  const down = shoot();
  assert.ok(down?.kill && down.target === 1 && down.hp === 0);
  assert.ok(a.state().targets![1] > now);
  assert.equal(shoot()?.target, undefined, 'down, it can\'t be hit');
  now += PRACTICE_DOWN * 1000;
  assert.ok(a.tick(now).changed);
  assert.equal(a.state().targets![1], 0, 'back up');
  // Someone else in: a match, and no targets.
  a.join('b', 'B', now);
  assert.equal(a.state().phase, 'live');
  assert.equal(a.state().targets, undefined);
});

test('coming back in: a spawn out of everyone\'s sight, even when the furthest one is in it', () => {
  const spots: Record<string, V3> = { a: { x: C.x - 30, y: 0, z: C.z - 30 }, c: { x: C.x - 30, y: 0, z: C.z + 12 } };
  const a = new ArenaControl((id) => spots[id]);
  for (const id of ['a', 'b', 'c']) a.join(id, id, 0);
  const sees = (from: V3, s: { x: number; z: number }) => {
    const eye = { x: from.x, y: EYE_Y, z: from.z };
    const dx = s.x - eye.x, dy = 1.1 - eye.y, dz = s.z - eye.z, len = Math.hypot(dx, dy, dz);
    return rayWorld(eye, { x: dx / len, y: dy / len, z: dz / len }, len) >= len - 0.1;
  };
  const near = (s: { x: number; z: number }) => Math.min(...Object.values(spots).map((o) => Math.hypot(o.x - s.x, o.z - s.z)));
  const furthest = [...SPAWNS].sort((p, q) => near(q) - near(p))[0];
  assert.ok(sees(spots.a, furthest) || sees(spots.c, furthest), 'the furthest spawn is in sight');
  const s = a.spawnFor('b');
  assert.ok(!sees(spots.a, s) && !sees(spots.c, s), `spawn ${s.x - C.x}, ${s.z - C.z} out of sight`);
});
