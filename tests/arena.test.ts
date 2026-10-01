import test from 'node:test';
import assert from 'node:assert/strict';
import { ARENA_BOXES, ARENA_CENTER, ARENA_GATE, ARENA_HALF, CITY_ARENA_GATE, EYE_Y, RULES, SPAWNS, rayBox, rayPerson, rayWorld, type V3 } from '../src/shared/arena.js';
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
  const body = rayPerson({ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, feet);
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
  const at = (from: string, to: string, dy = 0) => {
    const o = eye(from), t = spots[to];
    const d = { x: t.x - o.x, y: t.y + 1.0 + dy - o.y, z: t.z - o.z };
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

test('a match: two in makes it live; four body shots kill, a head shot is two; the dead come back', () => {
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
  // Head shots: two.
  m.wait(RULES.safe * 1000);
  assert.ok(m.shoot('a', 'b', 0.6)?.head);
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
