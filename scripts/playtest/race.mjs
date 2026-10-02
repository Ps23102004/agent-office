// Racing: two players drive through the city's gate at the same spot one after the other (the first
// one's car must wait out of the second one's way), line up, and race on autopilot for a while. Code
// asserts the race's bookkeeping: the phases, positions 1..n, progress that never goes back, and no
// "missed checkpoint" for a car that didn't miss one. Then the same against the office's own racers,
// once it has some (see BOTS below); until then that part says it's skipped.
import { CHECKPOINTS, CITY_GATE } from '../../src/shared/circuit.ts';
import { RACE } from '../../src/shared/race.ts';
import { bucket } from './lib.mjs';
import { autopilot, driveToCircuit, getInNearest, toGarage } from './places.mjs';

export const title = 'Racing: the gate, the grid and a race, against people and bots';

const RACE_S = 25;
/** Checkpoints (CHECKPOINTS a lap, about 110 m apart) a car on autopilot gets through in RACE_S at least. */
const MIN_CHECKPOINTS = 4;

/**
 * The racing bots' hook, when there are some: `__office.race.addBot(level?)` puts one of the office's
 * own racers on the grid (at the game's default level without one), and a racer that's a bot has
 * `bot` set (or an id starting 'bot:', shared/bots.ts BOT_ID). Nothing else is assumed.
 */
const BOTS = 3;

export default async function race(t) {
  const a = await t.open({ name: 'Ann', view: 'third' });
  const b = await t.open({ name: 'Ben', view: 'third' });

  // ---- Through the gate, one after the other, at the same spot ----
  await toGarage(a.page);
  const mine = await getInNearest(a.page, 'lambo');
  await driveToCircuit(a.page);
  await toGarage(b.page);
  const left = await b.page.evaluate((i) => {
    const p = window.__office.office.cars.cars[i].pose;
    return { x: +p.x.toFixed(2), z: +p.z.toFixed(2), driver: window.__office.store.cars[i]?.driver ?? null };
  }, mine.index);
  t.metric('carLeftInTheCity', left);
  const inGate = Math.abs(left.x - CITY_GATE.x) < CITY_GATE.width / 2 + 1 && Math.abs(left.z - CITY_GATE.z) < 10;
  t.check("the car driven through the city's gate waits out of the next one's way", !inGate, left);
  await getInNearest(b.page, 'lambo');
  let through = true;
  try {
    await driveToCircuit(b.page);
  } catch (e) {
    through = false;
    t.note(String(e.message));
  }
  t.check('a second driver gets through the city gate at the same spot', through);

  // ---- A race, the two of them (or Ann alone, if Ben's stuck in the city) ----
  const r = await runRace(t, through ? [a, b] : [a], 'people');
  t.metric('people', r.summary);

  // ---- Against bots ----
  const hook = await a.page.evaluate(() => typeof window.__office.race?.addBot === 'function');
  if (!hook) return t.skip('race vs bots: bots not present (no __office.race.addBot)');
  await a.page.waitForFunction(() => ['idle', 'finished'].includes(window.__office.store.race.phase) || window.__office.store.race.racers.every((r) => r.finishedAt), null, { timeout: 5000 }).catch(() => {});
  for (const c of through ? [a, b] : [a]) await c.page.evaluate(() => window.__office.net.send({ t: 'race.leave' }));
  const withBots = await runRace(t, [a], 'bots', async () => {
    for (let i = 0; i < BOTS; i++) await a.page.evaluate(() => window.__office.race.addBot());
    await a.page.waitForFunction((n) => window.__office.store.race.racers.filter((r) => r.bot || r.id.startsWith('bot:')).length >= n, BOTS, { timeout: 10_000 });
  });
  t.metric('bots', withBots.summary);
  const bots = withBots.summary.racers.filter((x) => x.bot);
  t.check(`each bot gets through at least ${MIN_CHECKPOINTS} checkpoints in ${RACE_S} s`, bots.every((x) => x.through >= MIN_CHECKPOINTS), bots);
  const me = withBots.summary.racers.find((x) => !x.bot);
  await t.judge('bots', {
    game: 'An arcade racing game. A human-like test driver (an autopilot that follows the centre line, not the racing line, and lifts for corners) raced the game\'s bots.',
    race: bots.map((x) => `${x.name}: ${x.through} checkpoints in ${RACE_S} s, ${bucket(x.through - me.through, [-3, -1, 1, 3], ['well behind the test driver', 'a little behind', 'level with', 'a little ahead of', 'well ahead of'])} the test driver`).join('; '),
  }, {
    competitive: { type: 'noul', instructions: 'Does `race` describe bots a person would find a fair, competitive race against (neither parked nor untouchable)?', flag: (x) => x.noul < 0.5 },
  });
}

/**
 * Everyone in `players` lines up, the first starts it, and they race on autopilot for RACE_S (each a
 * little slower than the last, so there's an order). `before` runs once they're on the grid. Checks
 * as it goes, under `label`, and returns how each racer got on.
 */
async function runRace(t, players, label, before) {
  const [a] = players;
  for (const c of players) {
    await c.page.keyboard.press('KeyR'); // R in the car: line up on the grid
    await c.page.waitForFunction(() => window.__office.store.race.racers.some((r) => r.id === window.__office.store.you), null, { timeout: 5000 });
  }
  if (before) await before();
  await a.page.waitForTimeout(500);
  const phases = [await a.page.evaluate(() => window.__office.store.race.phase)];
  await a.page.keyboard.press('KeyR'); // and again: start it
  await a.page.waitForFunction(() => window.__office.store.race.phase === 'countdown', null, { timeout: 5000 });
  phases.push('countdown');
  await t.shot(a.page, `${label}-grid`);
  await a.page.waitForFunction(() => window.__office.store.race.phase === 'racing', null, { timeout: (RACE.countdown + 5) * 1000 });
  phases.push('racing');
  const go = await a.page.evaluate(() => performance.now());
  for (const [i, c] of players.entries()) await autopilot(c.page, { maxSpeed: 34 - i * 3 });
  const samples = [];
  for (let s = 0; s < RACE_S * 2; s++) {
    await a.page.waitForTimeout(500);
    samples.push(await a.page.evaluate(() => window.__office.store.race.racers.map((r) => ({ id: r.id, name: r.name, bot: !!(r.bot || r.id.startsWith('bot:')), lap: r.lap, checkpoint: r.checkpoint, position: r.position }))));
    if (s === RACE_S) await t.shot(a.page, `${label}-racing`);
  }
  for (const c of players) await autopilot(c.page, { on: false });
  const missed = [];
  for (const c of players) missed.push(...(await c.page.evaluate((go) => window.__toasts.filter((x) => x.t > go && /missed checkpoint/i.test(x.text)).map((x) => x.text), go)));
  const exitPhase = await a.page.evaluate(() => window.__office.store.race.phase);

  t.check(`${label}: lined up, counted down, raced`, phases.join(' → ') === 'lobby → countdown → racing', phases);
  const badOrder = samples.find((row) => row.map((x) => x.position).sort((p, q) => p - q).join() !== row.map((_, i) => i + 1).join());
  t.check(`${label}: positions are always 1 to ${samples[0].length}, one each`, !badOrder, badOrder);
  const back = [];
  for (let i = 1; i < samples.length; i++) for (const x of samples[i]) {
    const was = samples[i - 1].find((y) => y.id === x.id);
    if (was && x.lap * CHECKPOINTS + x.checkpoint < was.lap * CHECKPOINTS + was.checkpoint) back.push({ name: x.name, from: [was.lap, was.checkpoint], to: [x.lap, x.checkpoint] });
  }
  t.check(`${label}: nobody's progress ever goes back`, !back.length, back.slice(0, 5));
  t.check(`${label}: no "missed checkpoint" for a car on autopilot round the line`, !missed.length, missed);
  const end = samples.at(-1);
  const racers = end.map((x) => ({ name: x.name, bot: x.bot, position: x.position, through: x.lap * CHECKPOINTS + x.checkpoint }));
  const humans = racers.filter((x) => !x.bot);
  t.check(`${label}: every player on autopilot gets through at least ${MIN_CHECKPOINTS} checkpoints in ${RACE_S} s`, humans.every((x) => x.through >= MIN_CHECKPOINTS), humans);
  return { summary: { racers, phaseAfter: exitPhase } };
}
