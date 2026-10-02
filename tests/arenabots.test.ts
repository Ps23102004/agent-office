import test from 'node:test';
import assert from 'node:assert/strict';
import { ARENA, ARENA_BOXES, ARENA_CENTER as C, ARENA_HALF, BODY_R, EYE_Y, RULES, SPAWNS, SWAP, WEAPONS, type Body, type V3 } from '../src/shared/arena.js';
import { BOT_LEVELS, SKILL, isBot, type BotLevel } from '../src/shared/bots.js';
import { rng } from '../src/shared/city.js';
import { ArenaControl } from '../src/server/arena.js';
import { ArenaBots, REACT_PRE, TICK, arenaYard, sees } from '../src/server/arenabots.js';

/**
 * The arena with people standing (or moved about) where a test puts them and bots filled in, wired up
 * as server.ts does it: one shot path through ArenaControl.fire that the bots hear, bots back in where
 * the arena's tick says. A fake clock and a seeded random, so it plays out the same every time.
 */
function yard(people: Record<string, Body>, opts: { fill?: number; level?: BotLevel; seed?: number; justIn?: boolean } = {}) {
  let now = 1_000_000;
  let bots!: ArenaBots;
  const where = (id: string) => {
    const p = people[id] ?? bots.peer(id);
    return p && { x: p.x, y: p.y, z: p.z, crouch: !!p.crouch };
  };
  const arena = new ArenaControl(where);
  // In a while already, so nobody's still safe from shots; unless they've `justIn`.
  for (const id of Object.keys(people)) arena.join(id, id.toUpperCase(), opts.justIn ? now : now - 5000);
  const shots: { by: string; o: V3; d: V3; at: number; hit?: string; w?: string; refused?: boolean; inSight: boolean }[] = [];
  const moved: string[] = [];
  const shoot = (id: string, o: V3, d: V3, at: number, rtt?: number) => {
    // Whether anyone alive was in sight of the eyes it left from, as it went.
    const inSight = arena.state().players.some((p) => p.id !== id && p.alive && sees(o, where(p.id)!));
    const r = arena.fire(id, o, d, at, rtt);
    shots.push({ by: id, o, d, at, hit: r?.hit, w: r?.w, refused: !r, inSight });
    if (!r) return r;
    bots.heard(o, id, at);
    if (r.hit) bots.hurt(r.hit, o, id, at);
    return r;
  };
  bots = new ArenaBots(arena, where, { shoot: (id, o, d, at) => shoot(id, o, d, at), moved: (p) => moved.push(p.id), changed: () => {}, joined: () => {}, left: () => {} }, rng(opts.seed ?? 1));
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
    /** The clock on `ms`, a bot tick at a time: the arena's own tick every 250, `each` before the bots think. */
    run(ms: number, each?: (now: number) => void) {
      for (let t = 0; t < ms; t += TICK) {
        now += TICK;
        each?.(now);
        if (now % 250 === 0) for (const s of arena.tick(now).spawned) Object.assign(bots.peer(s.id) ?? {}, { x: s.x, y: 0, z: s.z, rotY: s.rotY });
        bots.tick(now);
      }
    },
  };
}

const alive = (a: ArenaControl, id: string) => a.state().players.find((p) => p.id === id)?.alive;
/** The office's own record of `id` in the match: setting its health keeps them on their feet. */
const standing = (a: ArenaControl, id: string) => (a as unknown as { arena: { players: { id: string; hp: number }[] } }).arena.players.find((p) => p.id === id)!;

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

/**
 * One bot `dist` m from someone strafing across its sights at walking pace: shots, hits, and how long
 * to the kill. Up the open west lane, beside the barrier there: nothing between them 15 m apart.
 */
function duel(level: BotLevel, seed: number, dist = 15) {
  const person: V3 = { x: C.x - 20, y: 0, z: C.z - 8 + dist };
  const m = yard({ a: person }, { fill: 2, level, seed });
  const bot = m.bots.peers()[0];
  Object.assign(bot, { x: C.x - 20, z: C.z - 8, rotY: 0 });
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
      // Already facing them as they come into sight: a quicker reaction (REACT_PRE), but a reaction, and
      // never under a person's quickest (150 ms).
      assert.ok(d.first >= Math.max(150, SKILL[level].reaction[0] * REACT_PRE), `${level} fired ${d.first} ms after seeing them`);
    }
    kills.sort((a, b) => a - b);
    return { level, rate: hits / shots, kill: kills[15], killed: kills.filter((k) => k < Infinity).length };
  });
  // Measured (these 30 duels each): easy 16% and 4.5 s to the kill (18 of them dead within the 5 s),
  // normal 28% / 2.65 s, hard 41% / 1.6 s, insane 87% / 0.7 s. A walking strafe this slow is about as easy
  // as a moving target gets: in a match (scripts/playtest/arena.mjs) they land 15-22%, 25-32%, 35-45% and
  // 50-60% of all their shots.
  const bands: Record<BotLevel, [number, number, number, number]> = { easy: [0.08, 0.24, 3000, Infinity], normal: [0.2, 0.37, 1800, 3600], hard: [0.32, 0.54, 1000, 2200], insane: [0.78, 0.97, 450, 950] };
  for (const r of rows) {
    const [lo, hi, k0, k1] = bands[r.level];
    assert.ok(r.rate >= lo && r.rate <= hi, `${r.level} hits ${(r.rate * 100).toFixed(0)}%`);
    assert.ok(r.kill >= k0 && r.kill <= k1, `${r.level} kills in ${r.kill} ms`);
  }
  // A beginner is slow to the kill, but gets there: a third of these duels at least.
  assert.ok(rows[0].killed >= 10, `easy killed in ${rows[0].killed} of 30`);
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i].rate > rows[i - 1].rate && rows[i].kill <= rows[i - 1].kill, `${rows[i].level} beats ${rows[i - 1].level}`);
});

test('a bot takes its reaction before it does anything about someone it sees: no turn, no step, no shot', () => {
  // Someone in plain sight up the open west lane, 15 m off, half a radian off where the bot's facing.
  const a: V3 = { x: C.x - 20, y: 0, z: C.z + 7 };
  const m = yard({ a }, { fill: 2, level: 'hard' });
  const bot = m.bots.peers()[0];
  Object.assign(bot, { x: a.x, z: a.z - 15, rotY: 0.5 });
  m.run(SKILL.hard.reaction[0] - TICK);
  assert.deepEqual([bot.x, bot.z, bot.rotY], [a.x, a.z - 15, 0.5], 'still as it was');
  assert.equal(m.shots.length, 0);
  // Then it turns on them and fights (they're kept on their feet).
  m.run(1000, () => (standing(m.arena, 'a').hp = RULES.hp));
  const off = Math.abs(Math.atan2(Math.sin(Math.atan2(a.x - bot.x, a.z - bot.z) - bot.rotY), Math.cos(Math.atan2(a.x - bot.x, a.z - bot.z) - bot.rotY)));
  assert.ok(off < 0.15, `faces them (${off.toFixed(2)} rad off)`);
  assert.ok(m.shots.some((s) => s.by === bot.id));
});

test('a shot heard turns a bot to look, only within its hearing', () => {
  // A bot facing north, someone firing into the ground behind it to the south, further off than easy
  // hears and nearer than normal does; the same match played out with the shot and without.
  const far = (SKILL.easy.hear + SKILL.normal.hear) / 2;
  const play = (level: BotLevel, shot: boolean) => {
    const a: V3 = { x: C.x + 20, y: 0, z: C.z + 30 };
    const m = yard({ a }, { fill: 2, level });
    const bot = m.bots.peers()[0];
    Object.assign(bot, { x: C.x + 20, z: a.z - far, rotY: Math.PI });
    m.run(50);
    if (shot) m.shoot('a', { x: a.x, y: EYE_Y, z: a.z }, { x: 0, y: -1, z: 0.1 }, m.now);
    m.run(600);
    return { x: bot.x, z: bot.z, rotY: bot.rotY };
  };
  // Normal hears it: it turns round to look.
  assert.ok(Math.abs(play('normal', true).rotY) < 0.5, 'turned to look');
  // Easy doesn't: it carries on exactly as if there'd been no shot.
  assert.deepEqual(play('easy', true), play('easy', false));
});

test('a bot goes for the head of someone behind something low, and holds fire at someone still safe', () => {
  // Standing still just behind the barrier across the east lane (1.3 m: only the top of the head over
  // it), a bot 15 m off in the open. Measured (these 20): aiming at the chest, hard hits 11% (its rolled
  // headshots); at what shows of the head, 37%.
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
  assert.ok(hits / shots > 0.3, `hard hits ${((hits / shots) * 100).toFixed(0)}% over the barrier`);
  // Someone just in, in plain sight (up the open west lane): nothing till their safe moment's up, then it's straight on them.
  const a: V3 = { x: C.x - 20, y: 0, z: C.z + 7 };
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

test("people's shots at a moving bot are judged where their page showed it: every step of its goes to the judge", () => {
  // Someone up the open west lane, a bot 10 m off strafing as it squares up to them (both just in, so
  // neither's hurt till the safe moment's up), shot at once that's up and it's on the move (it stops to
  // shoot, so not every moment; they're kept on their feet meanwhile).
  const a: V3 = { x: C.x - 20, y: 0, z: C.z + 7 };
  const m = yard({ a }, { fill: 2, level: 'hard', seed: 5, justIn: true });
  const bot = m.bots.peers()[0];
  Object.assign(bot, { x: a.x, z: a.z - 10, rotY: 0 });
  const track: { t: number; x: number; z: number }[] = [];
  // Where it was 200 ms ago (a 100 ms round trip, and the 100 ms a page draws everyone behind), well off where it is now.
  const then = () => track.find((p) => p.t === m.now - 200)!;
  for (let i = 0; i < 60 && (i <= 31 || Math.hypot(then().x - bot.x, then().z - bot.z) <= 0.7); i++) {
    m.run(50, () => (standing(m.arena, 'a').hp = RULES.hp));
    track.push({ t: m.now, x: bot.x, z: bot.z });
  }
  assert.ok(alive(m.arena, 'a') && alive(m.arena, bot.id));
  assert.ok(Math.hypot(then().x - bot.x, then().z - bot.z) > 0.7, 'it moved');
  const o = { x: a.x, y: EYE_Y, z: a.z };
  const to = { x: then().x - o.x, y: 0.6 - o.y, z: then().z - o.z };
  const len = Math.hypot(to.x, to.y, to.z);
  const shot = m.arena.fire('a', o, { x: to.x / len, y: to.y / len, z: to.z / len }, m.now, 100);
  assert.equal(shot?.hit, bot.id);
  assert.ok(shot.dmg! > 0 && shot.hp! < RULES.hp, 'and it hurt');
});

test('a bot has the SMG out close in and the rifle further off, and a good one crouches to shoot where it still sees them', () => {
  const play = (dist: number) => {
    const a: V3 = { x: C.x - 20, y: 0, z: C.z + 7 };
    const m = yard({ a }, { fill: 2, level: 'hard', seed: 2 });
    const bot = m.bots.peers()[0];
    Object.assign(bot, { x: a.x, z: a.z - dist, rotY: 0 });
    const start = m.now;
    let crouched = 0;
    m.run(2500, () => (crouched += bot.crouch ? 1 : 0));
    return { fired: m.shots.filter((s) => s.by === bot.id), crouched, start };
  };
  const near = play(6), far = play(15);
  assert.ok(near.fired.length > 0 && near.fired.every((s) => s.w === 'smg'), `close in: ${near.fired.map((s) => s.w)}`);
  assert.ok(far.fired.length > 0 && far.fired.every((s) => s.w === 'rifle'), `further off: ${far.fired.map((s) => s.w)}`);
  // It swaps (from the rifle every life starts with) while it's still reacting, not after: the first
  // shot a swap after it first sees them (the first tick) and its stop to shoot (it strafes meanwhile),
  // not a reaction and then a swap (750 ms).
  assert.ok(near.fired[0].at - near.start <= TICK + SWAP + SKILL.hard.settle, `first SMG shot ${near.fired[0].at - near.start} ms in`);
  // And fires it as fast as the gun goes (65 ms a shot, on whichever tick is nearest), not a tick
  // slower: before, every shot in a burst came 100 ms apart, slower close in than the rifle it put away.
  const gaps = near.fired.slice(1).map((s, i) => s.at - near.fired[i].at).filter((g) => g <= 100);
  const mean = gaps.reduce((n, g) => n + g, 0) / gaps.length;
  assert.ok(gaps.length >= 3 && Math.abs(mean - WEAPONS.smg.every) < 12, `SMG shots ${gaps} ms apart`);
  assert.ok(near.fired.every((s) => !s.refused));
  // Crouched for some of it, and its shots left from crouched eyes then (the judge took every one).
  assert.ok(far.crouched > 0 && far.fired.some((s) => s.o.y < EYE_Y - 0.3));
  assert.ok(far.fired.every((s) => !s.refused));
});

test('a good bot fights from round a corner and stops to shoot; a beginner stands out in the open and sprays on the move', () => {
  // Someone out in the open 23 m off, a bot beside the corner of a container (the one 12 m east of the
  // middle): kept on their feet (full health every tick), so what's measured is how it fights, not the kill.
  const play = (level: BotLevel, seed: number) => {
    const a: V3 = { x: C.x + 30, y: 0, z: C.z - 10 };
    const m = yard({ a }, { fill: 2, level, seed });
    const bot = m.bots.peers()[0];
    Object.assign(bot, { x: C.x + 10, z: C.z + 2, rotY: Math.atan2(a.x - C.x - 10, a.z - C.z - 2) });
    // Whether it was on the move each tick (as it fired, for a shot that tick), and out of their sight.
    const moving = new Map<number, boolean>();
    let hidden = 0;
    m.run(4000, (now) => {
      standing(m.arena, 'a').hp = RULES.hp;
      moving.set(now - TICK, bot.moving);
      if (!sees({ x: a.x, y: EYE_Y, z: a.z }, bot)) hidden++;
    });
    const fired = m.shots.filter((s) => s.by === bot.id);
    return { hidden: hidden / (4000 / TICK), fired, onTheMove: fired.filter((s) => moving.get(s.at)).length };
  };
  const runs = (level: BotLevel) => Array.from({ length: 10 }, (_, i) => play(level, i + 1));
  const sum = (xs: number[]) => xs.reduce((n, x) => n + x, 0);
  const top = runs('insane'), low = runs('easy');
  const hidden = (r: ReturnType<typeof runs>) => sum(r.map((x) => x.hidden)) / r.length;
  // The good one ducks back out of their sight between bursts (before: never, strafing out in the open):
  // a fifth of the time here. The beginner's out there all along, bar a strafe behind it now and then.
  assert.ok(hidden(top) > 0.15, `insane out of sight ${hidden(top).toFixed(2)} of the time`);
  assert.ok(hidden(low) < 0.1, `easy out of sight ${hidden(low).toFixed(2)} of the time`);
  // It stops for every shot (a counter-strafe), and lands most of them; the beginner fires some on the move.
  const fired = top.flatMap((r) => r.fired);
  assert.equal(sum(top.map((r) => r.onTheMove)), 0, 'insane fired on the move');
  assert.ok(fired.filter((s) => s.hit === 'a').length > fired.length / 2, `insane hits ${fired.filter((s) => s.hit === 'a').length} of ${fired.length}`);
  assert.ok(sum(low.map((r) => r.onTheMove)) > 0, 'easy never fired on the move');
});

test('a bot that runs one gun dry (or is reloading it) fights on with the other, and reloads the empty one once nobody is in sight', () => {
  // A hard bot 15 m off someone up the open west lane, down to its last two rifle rounds (or, every
  // other seed, ten and reloading), its SMG full. Before, it broke off for cover as soon as the rifle
  // was empty or reloading (never mind the SMG it had), and never reloaded the rifle again while it
  // lived: it only ever reloaded the gun in its hands.
  let ran = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const a: V3 = { x: C.x - 20, y: 0, z: C.z + 7 };
    const m = yard({ a }, { fill: 2, level: 'hard', seed });
    const bot = m.bots.peers()[0];
    Object.assign(bot, { x: a.x, z: a.z - 15, rotY: 0 });
    Object.assign(m.arena.gun(bot.id, m.now)!.ammo, { rifle: seed % 2 ? 2 : 10 });
    if (!(seed % 2)) assert.ok(m.arena.reload(bot.id, m.now));
    // It stands its ground while they're up (a good bot plants itself, or strafes at a walk, 0.23 m a
    // tick), not running off for cover.
    let was = { x: bot.x, z: bot.z };
    m.run(2000, () => {
      if (alive(m.arena, 'a') && Math.hypot(bot.x - was.x, bot.z - was.z) > 0.3) ran++;
      was = { x: bot.x, z: bot.z };
    });
    const fired = m.shots.filter((s) => s.by === bot.id);
    assert.ok(fired.some((s) => s.w === 'smg'), `seed ${seed}: on with the SMG (${fired.map((s) => s.w)})`);
    // They go: nobody in sight, it gets the rifle out and reloads it (after the SMG, if that's low).
    m.arena.leave('a', m.now);
    m.run(4500);
    const gun = m.arena.gun(bot.id, m.now)!;
    assert.equal(gun.ammo.rifle, WEAPONS.rifle.mag, `seed ${seed}: rifle reloaded`);
    assert.ok(gun.ammo.smg >= WEAPONS.smg.mag / 2, `seed ${seed}: SMG ${gun.ammo.smg}`);
  }
  assert.equal(ran, 0, `ran ${ran} ticks`);
});

test('seven bots think in well under a millisecond a tick, and no tick piles up much more', () => {
  // A busy match; then someone the bots can never see, behind the east wall, firing away (every bot off
  // to find somewhere to peek at them from: the dearest thing a bot works out). Before, the mean was
  // fine, but now and then one tick did that for a few bots at once: up to five or six routes worked
  // out in a tick, 6 ms a tick at the 99th percentile, 8 at worst.
  const { nav } = arenaYard();
  const route = nav.route;
  let routes = 0, most = 0;
  nav.route = (from, to) => (routes++, route.call(nav, from, to));
  const play = () => {
    const ticks: number[] = [];
    for (const [a, firing] of [[{ x: C.x - 20, y: 0, z: C.z + 16 }, false], [{ x: C.x + ARENA_HALF + 1.5, y: 0, z: C.z + 10 }, true]] as const) {
      const m = yard({ a }, { fill: 8, level: 'insane', seed: 3 });
      m.run(2000);
      const tick = m.bots.tick.bind(m.bots);
      m.bots.tick = (now) => {
        routes = 0;
        const t0 = performance.now();
        tick(now);
        ticks.push(performance.now() - t0);
        most = Math.max(most, routes);
      };
      m.run(10_000, (now) => {
        if (firing && now % 100 === 0 && !m.shoot('a', { x: a.x, y: EYE_Y, z: a.z }, { x: 0, y: 1, z: 0.01 }, now)) m.arena.reload('a', now);
      });
    }
    return ticks;
  };
  // Played out three times, the same each time, keeping each tick's quickest: what it costs, not what
  // other tests running alongside (or a garbage collection) happened to add to it.
  let runs: number[][];
  try {
    runs = [play(), play(), play()];
  } finally {
    nav.route = route;
  }
  // One bot a tick works out where to go (a hunt's two legs, to a peek and on), whatever the rest want.
  assert.ok(most <= 2, `${most} routes in a tick`);
  const ticks = runs[0].map((_, i) => Math.min(...runs.map((r) => r[i]))).sort((x, y) => x - y);
  const mean = ticks.reduce((n, t) => n + t, 0) / ticks.length, p99 = ticks[Math.floor(ticks.length * 0.99)];
  // About 0.2 ms and 1.5 here (twice that with the machine twice over busy): the clock only catches a
  // gross slip, the route count above is what holds the spikes down.
  assert.ok(mean < 1, `${mean.toFixed(2)} ms a tick`);
  assert.ok(p99 < 5, `${p99.toFixed(2)} ms a tick at the 99th percentile`);
});
