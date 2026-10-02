import test from 'node:test';
import assert from 'node:assert/strict';
import { ARENA, ARENA_BOXES, ARENA_CENTER as C, ARENA_HALF, BODY_R, EYE_Y, RULES, SPAWNS, type V3 } from '../src/shared/arena.js';
import { BOT_LEVELS, SKILL, isBot, type BotLevel } from '../src/shared/bots.js';
import { rng } from '../src/shared/city.js';
import { ArenaControl } from '../src/server/arena.js';
import { ArenaBots, arenaYard, sees } from '../src/server/arenabots.js';

/**
 * The arena with people standing (or moved about) where a test puts them and bots filled in, wired up
 * as server.ts does it: one shot path through ArenaControl.fire that the bots hear, bots back in where
 * the arena's tick says. A fake clock and a seeded random, so it plays out the same every time.
 */
function yard(people: Record<string, V3>, opts: { fill?: number; level?: BotLevel; seed?: number; justIn?: boolean } = {}) {
  let now = 1_000_000;
  let bots!: ArenaBots;
  const where = (id: string) => people[id] ?? bots.peer(id);
  const arena = new ArenaControl(where);
  // In a while already, so nobody's still safe from shots; unless they've `justIn`.
  for (const id of Object.keys(people)) arena.join(id, id.toUpperCase(), opts.justIn ? now : now - 5000);
  const shots: { by: string; o: V3; d: V3; at: number; hit?: string; refused?: boolean; inSight: boolean }[] = [];
  const moved: string[] = [];
  const shoot = (id: string, o: V3, d: V3, at: number) => {
    // Whether anyone alive was in sight of the eyes it left from, as it went.
    const inSight = arena.state().players.some((p) => p.id !== id && p.alive && sees(o, where(p.id)!));
    const r = arena.fire(id, o, d, at);
    shots.push({ by: id, o, d, at, hit: r?.hit, refused: !r, inSight });
    if (!r) return r;
    bots.heard(o, id, at);
    if (r.hit) bots.hurt(r.hit, o, id, at);
    return r;
  };
  bots = new ArenaBots(arena, where, { shoot, moved: (p) => moved.push(p.id), joined: () => {}, left: () => {} }, rng(opts.seed ?? 1));
  bots.set(opts.fill ?? 4, opts.level ?? 'normal', 'test', now);
  return {
    arena,
    bots,
    shots,
    moved,
    get now() {
      return now;
    },
    shoot,
    /** The clock on `ms`, 50 ms at a time: the arena's own tick every 250, `each` before the bots think. */
    run(ms: number, each?: (now: number) => void) {
      for (let t = 0; t < ms; t += 50) {
        now += 50;
        each?.(now);
        if (now % 250 === 0) for (const s of arena.tick(now).spawned) Object.assign(bots.peer(s.id) ?? {}, { x: s.x, y: 0, z: s.z, rotY: s.rotY });
        bots.tick(now);
      }
    },
  };
}

const alive = (a: ArenaControl, id: string) => a.state().players.find((p) => p.id === id)?.alive;

test('bots fill a match up for someone alone, make way as people come, and go when nobody is left', () => {
  const people: Record<string, V3> = { a: { x: C.x, y: 0, z: C.z + 29 } };
  const m = yard(people);
  let s = m.arena.state();
  // Four in all by default: you and three bots, and that's a live match.
  assert.equal(s.players.length, 4);
  assert.equal(s.phase, 'live');
  const peers = m.bots.peers();
  assert.ok(peers.every((p) => p.bot && p.floor === ARENA && isBot(p.id) && p.name.startsWith('🤖 ') && !p.voice));
  assert.equal(new Set(peers.map((p) => p.name)).size, 3, 'each its own name');
  // Someone else comes in: a bot makes way.
  people.b = { x: C.x + 5, y: 0, z: C.z + 29 };
  m.arena.join('b', 'B', m.now);
  m.bots.fill(m.now);
  assert.equal(m.bots.size, 2);
  // Asked for 6 at hard: four bots. Not again within the second, though (each change swaps bots for everyone).
  let t = m.now + 1000;
  assert.ok(m.bots.set(6, 'hard', 'B', t));
  assert.equal(m.bots.size, 4);
  assert.deepEqual(m.bots.settings, { fill: 6, level: 'hard', by: 'B' });
  assert.ok(!m.bots.set(1, 'easy', 'A', t + 999));
  assert.deepEqual(m.bots.settings, { fill: 6, level: 'hard', by: 'B' });
  assert.equal(m.bots.size, 4);
  // Never more than 8 in all; 1 sends them home.
  m.bots.set(20, 'hard', 'B', (t += 1000));
  assert.equal(m.arena.state().players.length, 8);
  m.bots.set(1, 'hard', 'B', (t += 1000));
  assert.equal(m.bots.size, 0);
  m.bots.set(4, 'normal', 'B', (t += 1000));
  // Everyone leaves: so do the bots, and it's warm-up.
  m.arena.leave('a', m.now);
  m.arena.leave('b', m.now);
  m.bots.fill(m.now);
  s = m.arena.state();
  assert.equal(m.bots.size, 0);
  assert.equal(s.players.length, 0);
  assert.equal(s.phase, 'warmup');
});

test('a bot sees nobody through cover: hidden, it holds fire; heard, it goes and looks; seen, it fights', () => {
  // Behind the middle block from the bot: the container 6 m long at (0, 1.3), 2.6 m tall.
  const people: Record<string, V3> = { a: { x: C.x, y: 0, z: C.z + 4 } };
  const m = yard(people, { fill: 2, level: 'hard' });
  const bot = m.bots.peers()[0];
  Object.assign(bot, { x: C.x, z: C.z - 4, rotY: 0 });
  assert.ok(!sees({ x: bot.x, y: EYE_Y, z: bot.z }, people.a), 'the block is between them');
  // Facing them through the block for a moment: nothing.
  m.run(400);
  assert.equal(m.shots.filter((s) => s.by === bot.id).length, 0);
  // They fire into the ground: the bot hears it, comes round and finds them.
  m.shoot('a', { x: people.a.x, y: EYE_Y, z: people.a.z }, { x: 0, y: -1, z: 0.1 }, m.now);
  m.run(6000);
  const fired = m.shots.filter((s) => s.by === bot.id);
  assert.ok(fired.length > 0, 'it found them');
  assert.ok(fired.some((s) => s.hit === 'a'));
  // Every shot it took, it could see them from where it fired.
  for (const s of fired) assert.ok(s.inSight, `shot at ${s.at} through cover`);
});

test('in a busy match bots keep to open ground, never fire through cover or get refused, and come back in at a spawn', () => {
  // Two people standing still in the open, and six bots at normal fighting it out for a minute.
  const people: Record<string, V3> = { a: { x: C.x - 20, y: 0, z: C.z + 16 }, b: { x: C.x + 20, y: 0, z: C.z - 16 } };
  const m = yard(people, { fill: 8, seed: 7 });
  assert.equal(m.bots.size, 6);
  const { nav } = arenaYard();
  const travelled = new Map<string, number>();
  const last = new Map<string, V3>();
  const was = new Map<string, boolean>();
  let respawns = 0;
  const solid = ARENA_BOXES.filter((b) => b.y0 < 1);
  m.run(60_000, () => {
    for (const p of m.bots.peers()) {
      const up = !!alive(m.arena, p.id);
      // Back in: at one of the spawns.
      if (up && was.get(p.id) === false) {
        respawns++;
        assert.ok(SPAWNS.some((s) => Math.hypot(s.x - p.x, s.z - p.z) < 1), `${p.name} back in at a spawn`);
      }
      was.set(p.id, up);
      assert.ok(nav.walkable(p.x, p.z), `${p.name} on open ground`);
      for (const b of solid) assert.ok(!(p.x > b.minX - BODY_R + 0.05 && p.x < b.maxX + BODY_R - 0.05 && p.z > b.minZ - BODY_R + 0.05 && p.z < b.maxZ + BODY_R - 0.05), `${p.name} inside a ${b.kind}`);
      const l = last.get(p.id);
      if (l) travelled.set(p.id, (travelled.get(p.id) ?? 0) + Math.hypot(p.x - l.x, p.z - l.z));
      last.set(p.id, { x: p.x, y: 0, z: p.z });
    }
  });
  const fired = m.shots.filter((s) => isBot(s.by));
  assert.ok(fired.length > 300, `a fight (${fired.length} shots)`);
  assert.equal(fired.filter((s) => s.refused).length, 0, 'the judge took every shot');
  // Each shot had someone alive in sight of the eyes it left from (whoever it was meant for).
  for (const s of fired) assert.ok(s.inSight, `a shot at ${s.at} with nobody in sight`);
  assert.ok(respawns > 3, `${respawns} back in`);
  for (const [id, d] of travelled) assert.ok(d > 60, `${id} got about (${d.toFixed(0)} m)`);
  const kills = m.arena.state().players.reduce((n, p) => n + p.kills, 0);
  assert.ok(kills > 5, `${kills} kills`);
});

/** One bot `dist` m from someone strafing across its sights at walking pace: shots, hits, and how long to the kill. */
function duel(level: BotLevel, seed: number, dist = 15) {
  const person: V3 = { x: C.x - 20, y: 0, z: C.z + 1 + dist };
  const m = yard({ a: person }, { fill: 2, level, seed });
  const bot = m.bots.peers()[0];
  Object.assign(bot, { x: C.x - 20, z: C.z + 1, rotY: 0 });
  const start = m.now;
  // Side to side across 10 m, from somewhere along it.
  const off = rng(seed * 7919)() * 10;
  let kill = Infinity;
  m.run(5000, (now) => {
    const ph = (((now - start) / 1000 + off / 4.6) % (20 / 4.6)) / (20 / 4.6);
    person.x = C.x - 20 + (ph < 0.5 ? -5 + 20 * ph : 15 - 20 * ph);
    if (kill === Infinity && !alive(m.arena, 'a')) kill = now - start;
  });
  const fired = m.shots.filter((s) => s.by === bot.id && (s.at <= start + kill));
  return { shots: fired.length, hits: fired.filter((s) => s.hit === 'a').length, first: fired.length ? fired[0].at - start : Infinity, kill };
}

test('each level aims as well as it should against someone strafing 15 m off, and waits out its reaction first', () => {
  const rows = BOT_LEVELS.map((level) => {
    let shots = 0, hits = 0;
    const kills: number[] = [];
    for (let seed = 1; seed <= 30; seed++) {
      const d = duel(level, seed);
      shots += d.shots;
      hits += d.hits;
      kills.push(d.kill);
      assert.ok(d.first >= SKILL[level].reaction[0], `${level} fired ${d.first} ms after seeing them`);
    }
    kills.sort((a, b) => a - b);
    return { level, rate: hits / shots, kill: kills[15] };
  });
  // Measured (these 30 duels each): easy 38% and 2.85 s to the kill, normal 56% / 1.1 s, hard 77% / 0.7 s, insane 90% / 0.55 s.
  const bands: Record<BotLevel, [number, number, number, number]> = { easy: [0.25, 0.5, 1500, 4000], normal: [0.45, 0.7, 700, 1600], hard: [0.65, 0.88, 450, 900], insane: [0.8, 0.97, 300, 700] };
  for (const r of rows) {
    const [lo, hi, k0, k1] = bands[r.level];
    assert.ok(r.rate >= lo && r.rate <= hi, `${r.level} hits ${(r.rate * 100).toFixed(0)}%`);
    assert.ok(r.kill >= k0 && r.kill <= k1, `${r.level} kills in ${r.kill} ms`);
  }
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i].rate > rows[i - 1].rate && rows[i].kill <= rows[i - 1].kill, `${rows[i].level} beats ${rows[i - 1].level}`);
});

test('a shot heard turns a bot to look, only within its hearing', () => {
  // A bot facing north, someone firing into the ground 30 m behind it to the south; the same match
  // played out with the shot and without.
  const play = (level: BotLevel, shot: boolean) => {
    const a: V3 = { x: C.x + 20, y: 0, z: C.z + 30 };
    const m = yard({ a }, { fill: 2, level });
    const bot = m.bots.peers()[0];
    Object.assign(bot, { x: C.x + 20, z: C.z, rotY: Math.PI });
    m.run(50);
    if (shot) m.shoot('a', { x: a.x, y: EYE_Y, z: a.z }, { x: 0, y: -1, z: 0.1 }, m.now);
    m.run(600);
    return { x: bot.x, z: bot.z, rotY: bot.rotY };
  };
  // Normal hears 40 m: it turns round to look.
  assert.ok(Math.abs(play('normal', true).rotY) < 0.5, 'turned to look');
  // Easy hears 25 m: it carries on exactly as if there'd been no shot.
  assert.deepEqual(play('easy', true), play('easy', false));
});

test('a bot goes for the head of someone behind something low, and holds fire at someone still safe', () => {
  // Standing still just behind the barrier across the east lane (1.15 m: head and shoulders over it), a
  // bot 15 m off in the open. Aiming at the chest, hard put about a third of its shots into the barrier.
  let shots = 0, hits = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const a: V3 = { x: C.x + 23, y: 0, z: C.z + 10 };
    const m = yard({ a }, { fill: 2, level: 'hard', seed });
    const bot = m.bots.peers()[0];
    Object.assign(bot, { x: a.x - 15, z: a.z, rotY: Math.PI / 2 });
    m.run(3000);
    const fired = m.shots.filter((s) => s.by === bot.id);
    shots += fired.length;
    hits += fired.filter((s) => s.hit === 'a').length;
  }
  assert.ok(hits / shots > 0.45, `hard hits ${((hits / shots) * 100).toFixed(0)}% over the barrier`);
  // Someone just in, in plain sight: nothing till their safe moment's up, then it's straight on them.
  const a: V3 = { x: C.x - 20, y: 0, z: C.z + 16 };
  const m = yard({ a }, { fill: 2, level: 'insane', justIn: true });
  const bot = m.bots.peers()[0];
  Object.assign(bot, { x: a.x, z: a.z - 15, rotY: 0 });
  const t0 = m.now;
  m.run(2500);
  const fired = m.shots.filter((s) => s.by === bot.id);
  assert.ok(fired.length > 0 && fired[0].at >= t0 + RULES.safe * 1000, `first shot ${fired[0]?.at - t0} ms after they came in`);
  assert.ok(fired[0].at < t0 + RULES.safe * 1000 + 300, 'and straight after');
});

test('a bot looks up at someone up on a container, and its rifle goes back level after', () => {
  // On top of the middle container (2.6 m), the bot on the ground 9 m off.
  const a: V3 = { x: C.x, y: 2.6, z: C.z + 1.3 };
  const m = yard({ a }, { fill: 2, level: 'hard' });
  const bot = m.bots.peers()[0];
  Object.assign(bot, { x: C.x, z: C.z - 8, rotY: 0 });
  let up = 0;
  m.run(1500, () => (up = Math.max(up, bot.pitch ?? 0)));
  assert.ok(up > 0.15, `looked up ${up.toFixed(2)} rad`);
  // Gone (killed, or out of sight): level again.
  m.arena.leave('a', m.now);
  m.run(200);
  assert.equal(bot.pitch, 0);
});

test('a bot that hears someone it can never see firing away keeps on its way, not finding a new one every shot', () => {
  // Behind the yard's east wall (somewhere no spot in it sees), firing into the air ten times a second.
  // Before, the bot worked out a peek and a way for every shot: about 75 ways in these 10 s.
  const a: V3 = { x: C.x + ARENA_HALF + 1.5, y: 0, z: C.z + 10 };
  const m = yard({ a }, { fill: 2, level: 'insane' });
  const { nav } = arenaYard();
  const route = nav.route;
  let routes = 0;
  nav.route = (from, to) => (routes++, route.call(nav, from, to));
  try {
    m.run(10_000, (now) => {
      if (now % 100 === 0 && !m.shoot('a', { x: a.x, y: EYE_Y, z: a.z }, { x: 0, y: 1, z: 0.01 }, now)) m.arena.reload('a', now);
    });
  } finally {
    nav.route = route;
  }
  const bot = m.bots.peers()[0];
  assert.ok(routes <= 10, `${routes} ways worked out`);
  // And it did go to look: across the yard, to the east wall.
  assert.ok(bot.x > C.x + 15, `got to ${(bot.x - C.x).toFixed(0)} m east`);
});

test('seven bots think in well under a millisecond or two a tick', () => {
  const m = yard({ a: { x: C.x - 20, y: 0, z: C.z + 16 } }, { fill: 8, seed: 3 });
  m.run(2000);
  const t0 = performance.now();
  m.run(10_000);
  const per = (performance.now() - t0) / 200;
  assert.ok(per < 3, `${per.toFixed(2)} ms a tick`);
});
