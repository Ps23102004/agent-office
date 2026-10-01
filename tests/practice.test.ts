import test from 'node:test';
import assert from 'node:assert/strict';
import { CHECKPOINTS, gridPose, pointAt, surfaceAt, track } from '../src/shared/circuit.js';
import { RACE, SECTORS, sectorOf } from '../src/shared/race.js';
import { MEET_SPOTS } from '../src/shared/meet.js';
import { RaceControl } from '../src/server/race.js';

const L = track().length;
/** On the orange motorbike (the quickest), signed in. */
const WHO = { name: 'Pat', car: 4, account: 'acct-pat' };

/** Drives `id` round from `from`, `metres` on, a couple of metres every `ms`. */
function driveOn(race: RaceControl, id: string, from: number, metres: number, now: { t: number }, ms = 100, who?: { name: string; car: number; account?: string }) {
  for (let s = from; s <= from + metres; s += 2) {
    const p = pointAt(s);
    now.t += ms;
    race.drove(id, p.x, p.z, now.t, who);
  }
}
const practicer = (race: RaceControl, id = 'p') => race.state().practice.find((p) => p.id === id);

test('practice laps: on your own outside the race, timed from the first time over the line, with a best of their own', () => {
  const race = new RaceControl();
  const now = { t: 1_000_000 };
  driveOn(race, 'p', -60, 40, now, 100, WHO);
  let p = practicer(race)!;
  assert.deepEqual([p.name, p.car, p.laps, p.checkpoint, p.lapStartedAt], ['Pat', 4, 0, -1, undefined], 'not on a lap before the line');
  driveOn(race, 'p', -18, L + 20, now, 100, WHO);
  p = practicer(race)!;
  assert.equal(p.laps, 1);
  assert.ok(p.bestLap! > 60_000 && p.bestLap === p.lastLap);
  assert.deepEqual(race.state().practiceRecord, { name: 'Pat', ms: p.bestLap });
  assert.equal(race.state().record, undefined, 'the race record is the race’s');
  assert.equal(race.state().phase, 'idle');
  // A quicker second lap is the new best.
  driveOn(race, 'p', 4, L, now, 80, WHO);
  p = practicer(race)!;
  assert.equal(p.laps, 2);
  assert.ok(p.lastLap! < 70_000 && p.bestLap === p.lastLap);
});

test('practice laps answer to the same rules: no teleporting, no going backwards, no skipping a line', () => {
  const race = new RaceControl();
  const now = { t: 0 };
  driveOn(race, 'p', -30, 40, now, 100, WHO);
  // Hops from line to line.
  for (let k = 1; k <= CHECKPOINTS; k++) {
    const s = ((k % CHECKPOINTS) * L) / CHECKPOINTS;
    for (const q of [pointAt(s - 1), pointAt(s + 1)]) race.drove('p', q.x, q.z, (now.t += 16), WHO);
  }
  assert.equal(practicer(race)!.laps, 0);
  assert.equal(practicer(race)!.checkpoint, 0);
  // Round the wrong way.
  for (let s = 0; s > -L - 20; s -= 2) race.drove('p', pointAt(s).x, pointAt(s).z, (now.t += 100), WHO);
  assert.equal(practicer(race)!.laps, 0);
  // Round the right way, but across the infield past a few lines (after a pause, it's a jump): nothing counts until the line it missed.
  const p0 = practicer(race)!.checkpoint;
  const at = pointAt(((p0 + 1) * L) / CHECKPOINTS - 10);
  race.drove('p', at.x, at.z, (now.t += 100));
  race.drove('p', at.x, at.z, (now.t += 4000));
  driveOn(race, 'p', ((p0 + 4) * L) / CHECKPOINTS - 20, L, now, 100, WHO);
  assert.equal(practicer(race)!.laps, 0, 'a lap with a line missed is no lap');
  assert.equal(race.state().practiceRecord, undefined);
});

test('practice ends when you get out or line up for the race; your best is still yours when you come back', () => {
  const race = new RaceControl();
  const now = { t: 0 };
  driveOn(race, 'p', -10, L + 20, now, 100, WHO);
  const best = practicer(race)!.bestLap!;
  assert.ok(best);
  assert.ok(race.leave('p', now.t));
  assert.equal(practicer(race), undefined);
  driveOn(race, 'q', -40, 10, now, 100, { ...WHO, name: 'Patricia' });
  assert.equal(practicer(race, 'q')!.bestLap, best, 'by account, whatever the name');
  driveOn(race, 'q', -28, 4, now, 100, { ...WHO, name: 'Pat R' });
  assert.equal(practicer(race, 'q')!.name, 'Pat R', 'renamed');
  // A guest's best goes with them, and a guest can't take the record by taking a name.
  driveOn(race, 'g', -40, 10, now, 100, { name: 'Pat', car: 5 });
  assert.equal(practicer(race, 'g')!.bestLap, undefined);
  race.leave('g', now.t);
  assert.ok(race.join('q', 'Pat', 2, now.t));
  assert.equal(practicer(race, 'q'), undefined, 'racing now');
  // Someone driving with nobody to say who they are isn't practising.
  assert.equal(race.drove('z', 0, 0, now.t), false);
  assert.equal(race.state().practice.length, 0);
});

test('sector splits: three of them, timed by the office, adding up to the lap, with deltas against your best', () => {
  assert.equal(SECTORS.length, 3);
  assert.deepEqual([sectorOf(0), sectorOf(4), sectorOf(5), sectorOf(13)], [0, 0, 1, 2]);
  const race = new RaceControl();
  const now = { t: 0 };
  ['a', 'b'].forEach((id, i) => race.join(id, id.toUpperCase(), i, now.t));
  race.start('a', now.t);
  race.drove('a', gridPose(0).x, gridPose(0).z, now.t);
  race.drove('b', gridPose(1).x, gridPose(1).z, now.t);
  now.t += RACE.countdown * 1000;
  race.tick(now.t);
  // Both drive the first lap side by side, b a second behind a at every line.
  for (let s = -7; s <= L + 10; s += 2) {
    const p = pointAt(s);
    now.t += 100;
    race.drove('a', p.x, p.z, now.t);
    race.drove('b', p.x, p.z, now.t + 1000);
  }
  now.t += 1000;
  let a = race.state().racers.find((r) => r.id === 'a')!;
  let b = race.state().racers.find((r) => r.id === 'b')!;
  assert.equal(a.lap, 1);
  assert.deepEqual(a.sectors, [], 'a new lap, no sectors yet');
  assert.equal(a.bestSectors!.length, 3);
  assert.equal(a.bestSectors!.reduce((x, y) => x! + y!, 0), a.bestLap, 'the sectors add up to the lap');
  assert.equal(a.lastSplit!.sector, 2);
  assert.equal(a.gap, 0, 'first through the line');
  assert.equal(b.gap, 1000, 'a second behind');
  // Slower through the first sector of the second lap: a delta to show it.
  driveOn(race, 'a', 12, (SECTORS[1] * L) / CHECKPOINTS, now, 150);
  a = race.state().racers.find((r) => r.id === 'a')!;
  assert.equal(a.sectors!.length, 1);
  assert.equal(a.lastSplit!.sector, 0);
  assert.ok(a.lastSplit!.delta! > 0, 'slower than its best');
  // b goes through the same lines later: the gap is to whoever went through first.
  driveOn(race, 'b', 12, (SECTORS[1] * L) / CHECKPOINTS, now, 100);
  b = race.state().racers.find((r) => r.id === 'b')!;
  assert.ok(b.gap! > 0);
});

test('practice laps have sector splits too', () => {
  const race = new RaceControl();
  const now = { t: 0 };
  driveOn(race, 'p', -10, L + 20, now, 100, WHO);
  const p = practicer(race)!;
  assert.ok(p.bestSectors!.every((x) => x! > 0));
  assert.equal(p.bestSectors!.reduce((x, y) => x! + y!, 0), p.bestLap);
});

test('the meeting spots are somewhere to stand', () => {
  assert.equal(surfaceAt(MEET_SPOTS.pits.x, MEET_SPOTS.pits.z), 'paddock');
});

test('the checkpoint coach: the next line, and the one you missed going through a later one first', async () => {
  const { store } = await import('../src/client/state.js');
  const { missedCheckpoint, nextCheckpoint } = await import('../src/client/race.js');
  const { CIRCUIT } = await import('../src/shared/circuit.js');
  store.you = 'me';
  store.floor = CIRCUIT;
  store.race = { ...store.race, practice: [{ id: 'me', name: 'Me', car: 0, laps: 0, checkpoint: 2 }] };
  assert.equal(nextCheckpoint(), 3);
  const over = (k: number) => [pointAt((k * L) / CHECKPOINTS - 1), pointAt((k * L) / CHECKPOINTS + 1)] as const;
  assert.equal(missedCheckpoint(...over(3)), undefined, 'the right one');
  assert.equal(missedCheckpoint(...over(4)), undefined, 'and the one after, before the office has said');
  assert.equal(missedCheckpoint(...over(7)), 5, 'past 5 and 6: 5 is the one to go back for');
  // Before the first time over the line, nothing's missed.
  store.race = { ...store.race, practice: [{ id: 'me', name: 'Me', car: 0, laps: 0, checkpoint: -1 }] };
  assert.equal(nextCheckpoint(), 0);
  assert.equal(missedCheckpoint(...over(7)), undefined);
  store.floor = null;
  assert.equal(nextCheckpoint(), null);
});

test('practice laps go no quicker than the car can: a spoofed fast lap takes nothing', () => {
  const lambo = { name: 'Cheat', car: 0, account: 'acct-cheat' };
  // About 47 s a lap in a Lambo (top 20 m/s: nearer 75 s flat out), reports bunched 70 ms apart.
  const race = new RaceControl();
  let t = 1_000_000;
  const dt = 47_000 / (L / 2.2);
  for (let s = -30; s < 2.1 * L; s += 2.2) race.drove('x', pointAt(s).x, pointAt(s).z, (t += dt), lambo);
  assert.equal(practicer(race, 'x')!.laps, 0);
  assert.equal(race.state().practiceRecord, undefined);
  // Flat out at its top speed is fine, and so is a second's lag bunching the reports up.
  const fair = new RaceControl();
  const now = { t: 0 };
  driveOn(fair, 'y', -20, 300, now, 100, lambo);
  now.t += 900;
  for (let s = 282; s < 300; s += 2) fair.drove('y', pointAt(s).x, pointAt(s).z, (now.t += 1), lambo);
  driveOn(fair, 'y', 300, L, now, 100, lambo);
  assert.equal(practicer(fair, 'y')!.laps, 1);
  // A guest's lap is theirs, but not the record.
  const guest = new RaceControl();
  driveOn(guest, 'g', -20, L + 40, { t: 0 }, 100, { name: 'Guest', car: 4 });
  assert.equal(practicer(guest, 'g')!.laps, 1);
  assert.equal(guest.state().practiceRecord, undefined);
});
