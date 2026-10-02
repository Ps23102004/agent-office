// The arena: first a duel between two people (one stands still in the open, the other aims at them
// and holds the trigger): the rifle's rate of fire, how many shots land from the hip at 15 m, that
// damage and the kill add up, the kill feed and the respawn. Then, once the office has bots of its own
// (store.arena.bots, from shared/bots.ts), a test player who stands their ground in the open and shoots
// back at whatever bot they can see, a few rounds at each level, each round a match of its own (new
// bots, scores from 0, the test player on their feet and past their safe moment; back on their spot
// after each death): code checks the bots join, move, shoot, are never hit through cover, and play to
// their level's band (BANDS: how often they land a shot, how soon they first hit the test player), the
// levels ramping up from easy to insane; Jev reads the numbers in words and says whether each level
// plays like a person of that standard. Without bots that part says it's skipped.
import { ARENA_BOXES, ARENA_CENTER, EYE_Y, RULES, WEAPONS, inArena, rayWorld } from '../../src/shared/arena.ts';
import { bucket } from './lib.mjs';
import { toGarage, walkToArena } from './places.mjs';

export const title = 'Shooting: the rifle, a duel, and bots that play like people';

/**
 * Seconds a round, rounds a level, and how many bots (players in all, less one). One 40 s match is only
 * 70 to 165 bot shots and a handful of kills: a level's luck in it is as big as the step to the next
 * level, so each level is eight of them, added up (about 26 minutes in all).
 */
const PLAY_S = 45;
const ROUNDS = 8;
const FILL = 4;
/** What each level should play like (shared/bots.ts says so of its own levels). */
const LIKE = { easy: 'a beginner', normal: 'an average player', hard: 'a skilled player', insane: 'a top player' };
/**
 * What a person of each level manages in a real match (shared/bots.ts SKILL aims each level at it; this
 * yard's people are big to hit), held as hard bands (code, not Jev). `acc`: the share of all their
 * shots that land, 15-22% for a beginner, 25-32% average, 35-45% skilled and 50-60% at the top, each
 * widened by 2.5 standard deviations of the luck of ROUNDS rounds (0.013 to 0.025: 900 to 1250 shots,
 * in bursts), so a level that plays to its standard fails by chance about 1 run in 80; the top one's
 * ceiling is the aimbot line, nobody lands more in a moving match. `firstHit`: seconds from a round's
 * start to their first hit on the test player, at most (the middle round's). The levels ramp up: each
 * lands its first hit on the test player sooner than the one below, kills them more often, and is
 * killed by them less (each by more than its luck: tell the levels apart, or they're one level).
 */
// ponytail: rough bands from people in shooters generally, not this game's own players; tune them once some have played.
const BANDS = { easy: { acc: [0.11, 0.26], firstHit: 6 }, normal: { acc: [0.21, 0.36], firstHit: 4 }, hard: { acc: [0.28, 0.52], firstHit: 3 }, insane: { acc: [0.42, 0.68], firstHit: 2 } };
/** The bands each level aims for (BANDS without the luck), for the report. */
const AIM = { easy: [0.15, 0.22], normal: [0.25, 0.32], hard: [0.35, 0.45], insane: [0.5, 0.6] };

export default async function arena(t) {
  const a = await t.open({ name: 'Ann' });
  const b = await t.open({ name: 'Ben' });
  await toGarage(a.page);
  await walkToArena(a.page);
  const hasBots = await a.page.evaluate(() => window.__office.store.arena.bots !== undefined);
  // Just the two of them for the duel: any bots home before they've had a chance to shoot.
  if (hasBots) {
    await a.page.evaluate(() => window.__office.net.send({ t: 'arena.bots', fill: 1, level: 'normal' }));
    await a.page.waitForFunction(() => !window.__office.store.arena.players.some((p) => p.bot), null, { timeout: 10_000 });
  }
  await toGarage(b.page);
  await walkToArena(b.page);
  for (const c of [a, b]) await armShots(c.page);
  const ids = { a: await a.page.evaluate(() => window.__office.store.you), b: await b.page.evaluate(() => window.__office.store.you) };
  await a.page.waitForFunction(() => window.__office.store.arena.phase === 'live', null, { timeout: 10_000 }).catch(() => {});
  // Both on their feet (a death on the way in would put them back somewhere of the office's choosing).
  await a.page.waitForFunction((ids) => ids.every((id) => window.__office.store.arena.players.find((p) => p.id === id)?.alive), [ids.a, ids.b], { timeout: (RULES.respawn + 2) * 1000 });
  t.check('two people in the arena: the match is live', (await a.page.evaluate(() => window.__office.store.arena.phase)) === 'live');

  // ---- The duel: Ben stands in the open 15 m off, Ann holds the trigger on him ----
  const [from, to] = duelSpots();
  await standAt(a.page, from);
  await standAt(b.page, to);
  await a.page.waitForTimeout(RULES.safe * 1000 + 500); // past anyone's safe time, and both seen where they are
  await a.page.mouse.click(640, 360); // a click on the view: the pointer's locked, as a player's is
  await a.page.waitForTimeout(300);
  t.check('a click locks the pointer to the view', await a.page.evaluate(() => window.__office.player.locked));
  await a.page.evaluate((id) => window.aimAt(id), ids.b);
  await a.page.waitForTimeout(400);
  const t0 = await a.page.evaluate(() => {
    window.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
    return performance.now();
  });
  await t.shot(a.page, 'duel-firing');
  await a.page.waitForFunction(([id, t0]) => window.__shots.some((s) => s.kill && s.hit === id) || performance.now() - t0 > 4000, [ids.b, t0], { timeout: 6000, polling: 50 });
  await a.page.evaluate(() => {
    window.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
    clearInterval(window.__aim);
  });
  const mine = (await a.page.evaluate((id) => window.__shots.filter((s) => s.by === id), ids.a)).filter((s) => s.t >= t0);
  const killAt = mine.findIndex((s) => s.kill);
  const landed = mine.slice(0, killAt < 0 ? mine.length : killAt + 1);
  let dealt = 0, due = -1;
  for (const [i, s] of landed.entries()) if (s.hit === ids.b && (dealt += s.head ? RULES.head : RULES.body) >= RULES.hp && due < 0) due = i;
  const duel = {
    // Shots a second while held: from the time between them (it's over in well under a second).
    perSecond: mine.length > 1 ? +(((mine.length - 1) * 1000) / (mine.at(-1).t - mine[0].t)).toFixed(1) : null,
    hitShare: +(landed.filter((s) => s.hit === ids.b).length / Math.max(1, landed.length)).toFixed(2),
    heads: landed.filter((s) => s.head).length,
    shotsToKill: killAt < 0 ? null : killAt + 1,
    msToKill: killAt < 0 ? null : Math.round(mine[killAt].t - mine[0].t),
  };
  t.metric('duel', duel);
  t.check(`the rifle fires ${1000 / RULES.every} a second held down (8 to 11)`, duel.perSecond >= 8 && duel.perSecond <= 11, duel);
  t.check('from the hip at 15 m, standing, most shots land on a man standing still (60% or more)', duel.hitShare >= 0.6, duel);
  t.check('the kill comes on the shot that takes his health to 0, not before or after', killAt >= 0 && killAt === due, { killAt, due });
  const after = await a.page.evaluate(([x, y]) => {
    const s = window.__office.store.arena;
    return { a: s.players.find((p) => p.id === x), b: s.players.find((p) => p.id === y), feed: s.feed.at(-1) };
  }, [ids.a, ids.b]);
  t.check('the kill is counted (a kill for Ann, a death for Ben) and in the feed', after.a?.kills === 1 && after.b?.deaths === 1 && after.feed?.killer === 'Ann' && after.feed?.victim === 'Ben', after);
  await t.shot(a.page, 'duel-killed');
  const back = await b.page.waitForFunction((id) => window.__office.store.arena.players.find((p) => p.id === id)?.alive, ids.b, { timeout: (RULES.respawn + 2) * 1000 }).then(() => true, () => false);
  const hp = await b.page.evaluate((id) => window.__office.store.arena.players.find((p) => p.id === id)?.hp, ids.b);
  t.check(`Ben's back in within ${RULES.respawn + 2} s, at full health`, back && hp === RULES.hp, { back, hp });
  await t.shot(b.page, 'duel-respawned');

  // ---- Against the bots ----
  if (!hasBots) return t.skip('arena vs bots: bots not present (no store.arena.bots)');
  await b.context.close(); // Ann on her own with the bots
  const shared = await import('../../src/shared/bots.ts').catch(() => null);
  const levels = shared?.BOT_LEVELS ?? Object.keys(LIKE);
  const boxes = ARENA_BOXES.map((x) => [x.minX, x.maxX, x.y0, x.y1, x.minZ, x.maxZ]);
  const results = {};
  const spot = openSpot();
  for (const level of levels) {
    const rounds = [];
    for (let i = 0; i < ROUNDS; i++) {
      // Each round its own match: the last one's bots home first (the setting takes a change a second),
      // so new ones come in at spawns, the scores start at 0 and nobody's near the kill limit.
      if (await a.page.evaluate(() => window.__office.store.arena.players.some((p) => p.bot))) {
        await a.page.evaluate((level) => window.__office.net.send({ t: 'arena.bots', fill: 1, level }), level);
        await a.page.waitForFunction(() => !window.__office.store.arena.players.some((p) => p.bot), null, { timeout: 10_000 }).catch(() => {});
        await a.page.waitForTimeout((shared?.BOTS.every ?? 1000) + 200);
      }
      // On their feet and past their safe moment: killed late in the last round, they'd start this one
      // dead or safe from shots, and the bots' first hit would come late for nothing the bots did.
      const ready = () => {
        const s = window.__office.store, me = s.arena.players.find((p) => p.id === s.you);
        return me?.alive && !(me.safeUntil > s.officeNow());
      };
      await a.page.waitForFunction(ready, null, { timeout: (RULES.respawn + RULES.safe + 5) * 1000 }).catch(() => {});
      await standAt(a.page, spot);
      if (!(await a.page.evaluate(() => window.__office.player.locked))) await a.page.mouse.click(640, 360);
      await a.page.waitForTimeout(300); // the office has them there before the bots come in
      // The round's clock starts as they come in (the page's clock, which its shots go by; the match's
      // news of them comes up to a quarter of a second later).
      const t0 = await a.page.evaluate(([fill, level]) => {
        const n = window.__joins.length;
        window.__office.net.send({ t: 'arena.bots', fill, level });
        return new Promise((done) => {
          const t = setInterval(() => {
            if (window.__joins.length - n < fill - 1) return;
            clearInterval(t);
            done(window.__joins[n]);
          }, 10);
          setTimeout(() => (clearInterval(t), done(null)), 10_000);
        });
      }, [FILL, level]);
      if (t0 === null) break;
      rounds.push(await a.page.evaluate(play, { ms: PLAY_S * 1000, boxes, spot, t0 }));
    }
    t.check(`${level}: ${FILL - 1} bots join to make it ${FILL}, every round`, rounds.length === ROUNDS, { rounds: rounds.length });
    if (!rounds.length) continue;
    await t.shot(a.page, `bots-${level}`);
    const sum = (k) => rounds.reduce((n, r) => n + r[k], 0);
    const r2 = (n) => Math.round(n * 100) / 100;
    // A round without a hit on the test player counts as the whole round; the middle round's is the
    // level's (one round where the bots that see her first are busy with each other doesn't drag it out).
    const firsts = rounds.map((r) => r.firstHitS ?? PLAY_S);
    const sorted = [...firsts].sort((x, y) => x - y);
    const moves = rounds.flatMap((x) => x.bots.map((b) => b.moved));
    const r = {
      rounds: rounds.length,
      botShots: sum('botShots'),
      botAccuracy: r2(sum('botHits') / Math.max(1, sum('botShots'))),
      botHitsOnMe: sum('botHitsOnMe'),
      firstHitS: r2((sorted[(sorted.length - 1) >> 1] + sorted[sorted.length >> 1]) / 2),
      firstHits: firsts,
      myShots: sum('myShots'),
      myAccuracy: r2(sum('myHits') / Math.max(1, sum('myShots'))),
      myKills: sum('myKills'),
      myDeaths: sum('myDeaths'),
      // Metres each bot moved in a round, on average, and the least any did.
      moved: Math.round(moves.reduce((n, m) => n + m, 0) / moves.length),
      leastMoved: Math.min(...moves),
    };
    results[level] = r;
    // Every shot that hit someone, the office's word: never through a container or a wall.
    const through = rounds.flatMap((x) => x.hits).filter((s) => {
      const L = Math.hypot(s.end.x - s.o.x, s.end.y - s.o.y, s.end.z - s.o.z);
      return L > 0.1 && rayWorld(s.o, { x: (s.end.x - s.o.x) / L, y: (s.end.y - s.o.y) / L, z: (s.end.z - s.o.z) / L }) < L - 0.1;
    });
    t.check(`${level}: every bot moves about (10 m or more in each ${PLAY_S} s round)`, r.leastMoved >= 10, rounds.map((x) => x.bots));
    t.check(`${level}: the bots shoot, and land shots on the test player`, r.botShots > 0 && r.botHitsOnMe > 0, { botShots: r.botShots, botHitsOnMe: r.botHitsOnMe });
    t.check(`${level}: nobody is hit through cover`, !through.length, through.slice(0, 3));
    const band = BANDS[level];
    t.check(`${level}: the bots land ${band ? `${band.acc[0] * 100}% to ${band.acc[1] * 100}%` : '?'} of their shots, as people of that level do`, band && r.botAccuracy >= band.acc[0] && r.botAccuracy <= band.acc[1], band ? { botAccuracy: r.botAccuracy, botShots: r.botShots } : `no BANDS for ${level}: add one`);
    t.check(`${level}: a bot first hits the test player within ${band?.firstHit ?? '?'} s of a round's start (the middle round)`, band && r.firstHitS <= band.firstHit, { firstHitS: r.firstHitS, firstHits: r.firstHits });
  }
  t.metric('bots', results);
  // The ramp: each level a step up from the one below, by more than luck (kills are counts, so their
  // luck is about their square root).
  const ladder = Object.entries(results).map(([level, r]) => ({ level, first: r.firstHitS, kills: r.myDeaths, deaths: r.myKills, accuracy: r.botAccuracy }));
  for (const [i, x] of ladder.entries()) {
    if (!i) continue;
    const y = ladder[i - 1];
    t.check(`${x.level} is no easier than ${y.level}: it kills the test player no less often, and isn't killed by them more (not 2 SD of luck the wrong way)`, x.kills >= y.kills - 2 * Math.sqrt(x.kills + y.kills) && x.deaths <= y.deaths + 2 * Math.sqrt(x.deaths + y.deaths), ladder);
  }
  if (ladder.length > 1) {
    const [lo, hi] = [ladder[0], ladder.at(-1)];
    t.check(`${hi.level} is harder than ${lo.level}: a better aim, sooner on the test player, more kills on them and fewer deaths to them`, hi.accuracy > lo.accuracy && hi.first < lo.first && hi.kills > lo.kills && hi.deaths < lo.deaths, ladder);
  }
  // What the levels are meant to be (AIM, and each a step up from the one below, strictly): a note, not a check (luck).
  const strictly = (k, up) => ladder.every((x, i) => !i || (up ? x[k] > ladder[i - 1][k] : x[k] < ladder[i - 1][k]));
  t.metric('aim', {
    bands: Object.fromEntries(ladder.map((x) => [x.level, x.accuracy >= AIM[x.level][0] && x.accuracy <= AIM[x.level][1]])),
    firstHitFalls: strictly('first', false),
    killsRise: strictly('kills', true),
    deathsFall: strictly('deaths', false),
  });
  const words = (r) => `Over ${r.rounds} rounds of ${PLAY_S} s (each a new match) the test player hit ${Math.round(r.myAccuracy * 100)}% of their ${r.myShots} shots; the bots fired ${r.botShots} shots and hit ${Math.round(r.botAccuracy * 100)}% of them (${bucket(r.botAccuracy, [0.15, 0.3, 0.5, 0.7], ['wild', 'poor', 'fair', 'good', 'deadly'])}); they first hit the test player ${r.firstHitS} s into a round (the middle round's), killed them ${r.myDeaths} times and were killed ${r.myKills} times by them; each moved about ${r.moved} m a round.`;
  const state = {
    game: `A first-person arena shooter: a rifle (${WEAPONS.rifle.body} damage a body shot, ${WEAPONS.rifle.head} a head shot) and an SMG for close in (${WEAPONS.smg.body} and ${WEAPONS.smg.head}), ${RULES.hp} health, a container yard with cover.`,
    test_player: `A scripted test player who stands their ground in the open and shoots back at the nearest bot in sight after a quarter-second reaction, with a person's unsteady aim, while ${FILL - 1} bots play against them (and each other).`,
    levels: Object.fromEntries(Object.entries(results).map(([k, r]) => [k, words(r)])),
  };
  const questions = Object.fromEntries(Object.keys(results).map((k) => [k, {
    type: 'noul',
    instructions: `Does \`levels.${k}\` read like ${FILL - 1} human opponents who are each ${LIKE[k] ?? k}, rather than bots that are hopeless, or cheat with inhuman aim or knowledge?`,
    flag: (x) => x.noul < 0.5,
  }]));
  questions.ramp = { type: 'noul', instructions: 'Do the `levels` get harder in the order they are listed, each a clear step up from the one before?', flag: (x) => x.noul < 0.5 };
  await t.judge('bots', state, questions);
}

// ---- Where to stand ----
const C = ARENA_CENTER;
const free = (x, z) => inArena(x, z) && !ARENA_BOXES.some((b) => x > b.minX - 0.6 && x < b.maxX + 0.6 && z > b.minZ - 0.6 && z < b.maxZ + 0.6);
/** How many of 36 directions from (x, z) you can see 20 m or more along at eye height. */
const openness = (x, z) => Array.from({ length: 36 }, (_, k) => (k / 36) * Math.PI * 2).filter((a) => rayWorld({ x, y: EYE_Y, z }, { x: Math.sin(a), y: 0, z: Math.cos(a) }) >= 20).length;
/** The spot in the yard with the most open view round it (a 2 m grid). */
function openSpot() {
  let best = null;
  for (let x = -32; x <= 32; x += 2) for (let z = -32; z <= 32; z += 2) {
    const p = { x: C.x + x, z: C.z + z };
    if (free(p.x, p.z) && (!best || openness(p.x, p.z) > best.open)) best = { ...p, open: openness(p.x, p.z) };
  }
  return best;
}
/** Two open spots 15 m apart east-west, each in plain sight of the other's chest. */
function duelSpots() {
  const a = openSpot();
  for (const dx of [15, -15]) {
    const b = { x: a.x + dx, z: a.z };
    const d = { x: dx, y: 1.0 - EYE_Y, z: 0 }, L = Math.hypot(d.x, d.y);
    if (free(b.x, b.z) && rayWorld({ x: a.x, y: EYE_Y, z: a.z }, { x: d.x / L, y: d.y / L, z: 0 }) >= L) return [a, b];
  }
  throw new Error('no clear 15 m line in the yard');
}

/** On the yard's floor at `p` (the floor you're on: `street` is the city's, not the arena's). */
async function standAt(page, p) {
  await page.evaluate(([x, z]) => {
    const pl = window.__office.player;
    pl.pos.set(x, pl.pos.y, z);
  }, [p.x, p.z]);
}

// ---- In the page ----

/** Logs every shot the office tells this page about (who fired, what it hit, from where to where), and when bots come in. */
async function armShots(page) {
  await page.evaluate(() => {
    window.__shots = [];
    window.__joins = [];
    window.__office.net.onMessage((m) => {
      if (m.t === 'arena.shot') window.__shots.push({ t: performance.now(), by: m.by, hit: m.hit, head: !!m.head, kill: !!m.kill, o: m.o, end: m.end });
      if (m.t === 'peer.join' && m.peer.bot) window.__joins.push(performance.now());
    });
  });
  await page.addScriptTag({ content: `window.aimAt = ${aimAt.toString()};` });
}

/** Keeps the view on peer `id`'s chest as you see them, every 50 ms (as steady a hand as a person tracking someone). */
function aimAt(id) {
  const o = window.__office;
  clearInterval(window.__aim);
  window.__aim = setInterval(() => {
    const r = o.remotes.get(id)?.person.root.position, eye = o.camera.position;
    if (!r) return;
    const dx = r.x - eye.x, dy = r.y + 1.0 - eye.y, dz = r.z - eye.z;
    o.player.camYaw = Math.atan2(-dx, -dz);
    o.player.lookPitch = Math.atan2(dy, Math.hypot(dx, dz));
  }, 50);
}

/**
 * The test player for `ms` from `t0` (the page's clock): standing at `spot` (back there after each
 * death), they pick the nearest bot they can see (`boxes` are the yard's cover: [minX, maxX, y0, y1,
 * minZ, maxZ]), turn to it over a quarter of a second, and hold the trigger while it's on them.
 * Resolves with what happened.
 */
function play({ ms, boxes, spot, t0 }) {
  const o = window.__office, me = o.store.you;
  const sees = (p, q) => {
    const d = [q.x - p.x, q.y - p.y, q.z - p.z], L = Math.hypot(...d);
    for (const b of boxes) {
      let near = 0, far = L;
      for (let k = 0; k < 3; k++) {
        const s = [p.x, p.y, p.z][k], v = d[k] / L, lo = b[k * 2], hi = b[k * 2 + 1];
        if (Math.abs(v) < 1e-9) {
          if (s < lo || s > hi) { near = Infinity; break; }
          continue;
        }
        const t0 = (lo - s) / v, t1 = (hi - s) / v;
        near = Math.max(near, Math.min(t0, t1));
        far = Math.min(far, Math.max(t0, t1));
      }
      if (near < far) return false;
    }
    return true;
  };
  const stats = (id) => o.store.arena.players.find((p) => p.id === id);
  const from = window.__shots.findLastIndex((s) => s.t < t0) + 1;
  const trail = new Map();
  let target = null, since = 0, firing = false, wobble = { yaw: 0, pitch: 0, at: 0 };
  // A person's hand: aim off by about 0.025 rad (37 cm at 15 m), a fresh error every 200 ms.
  const gauss = () => Math.sqrt(-2 * Math.log(Math.random() || 1e-9)) * Math.cos(2 * Math.PI * Math.random());
  const trigger = (down) => {
    if (down === firing) return;
    firing = down;
    window.dispatchEvent(new MouseEvent(down ? 'mousedown' : 'mouseup', { button: 0 }));
  };
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      const now = performance.now();
      const bots = o.store.arena.players.filter((p) => p.bot);
      for (const p of bots) {
        const r = o.remotes.get(p.id)?.person.root.position;
        if (!r) continue;
        const was = trail.get(p.id), step = was ? Math.hypot(r.x - was.x, r.z - was.z) : 0;
        // Back in somewhere else after being killed is a jump, not a walk.
        trail.set(p.id, { x: r.x, z: r.z, moved: (was?.moved ?? 0) + (step < 2 ? step : 0) });
      }
      if (now - t0 >= ms) {
        clearInterval(timer);
        trigger(false);
        const shots = window.__shots.slice(from);
        // All from the shots the office reported in this time: a new match zeroes the scoreboard.
        const byBots = shots.filter((s) => bots.some((p) => p.id === s.by));
        const onMe = byBots.filter((s) => s.hit === me);
        const mine = shots.filter((s) => s.by === me);
        const r = (n) => Math.round(n * 100) / 100;
        return resolve({
          botShots: byBots.length,
          botHits: byBots.filter((s) => s.hit).length,
          botHitsOnMe: onMe.length,
          firstHitS: onMe.length ? r((onMe[0].t - t0) / 1000) : null,
          myShots: mine.length,
          myHits: mine.filter((s) => s.hit).length,
          myKills: mine.filter((s) => s.kill).length,
          myDeaths: onMe.filter((s) => s.kill).length,
          bots: bots.map((p) => ({ name: p.name, moved: Math.round(trail.get(p.id)?.moved ?? 0), kills: shots.filter((s) => s.by === p.id && s.kill).length, deaths: shots.filter((s) => s.hit === p.id && s.kill).length })),
          hits: shots.filter((s) => s.hit).map((s) => ({ o: s.o, end: s.end })),
        });
      }
      if (!stats(me)?.alive) return trigger(false);
      // Back in at a spawn after being killed: back to their spot in the open.
      const pos = o.player.pos;
      if (Math.hypot(pos.x - spot.x, pos.z - spot.z) > 1) pos.set(spot.x, pos.y, spot.z);
      // The nearest bot in sight, alive.
      const eyeAt = o.camera.position;
      const p0 = { x: eyeAt.x, y: eyeAt.y, z: eyeAt.z };
      let best = null;
      for (const p of bots) {
        const r = p.alive && o.remotes.get(p.id)?.person.root.position;
        if (!r) continue;
        const q = { x: r.x, y: r.y + 1.0, z: r.z }, d = Math.hypot(q.x - p0.x, q.z - p0.z);
        if (d < 60 && sees(p0, q) && (!best || d < best.d)) best = { id: p.id, q, d };
      }
      if (best?.id !== target) [target, since] = [best?.id ?? null, now];
      if (!best) return trigger(false);
      const dx = best.q.x - p0.x, dy = best.q.y - p0.y, dz = best.q.z - p0.z;
      const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(dy, Math.hypot(dx, dz));
      // A quarter of a second to react, then the view swings onto them over a few frames.
      if (now - since < 250) return trigger(false);
      const err = Math.atan2(Math.sin(yaw - o.player.camYaw), Math.cos(yaw - o.player.camYaw));
      if (now - wobble.at > 200) wobble = { yaw: gauss() * 0.025, pitch: gauss() * 0.025, at: now };
      o.player.camYaw += (err + wobble.yaw) * 0.5;
      o.player.lookPitch += (pitch + wobble.pitch - o.player.lookPitch) * 0.5;
      trigger(Math.abs(err) < 0.06);
    }, 50);
  });
}
