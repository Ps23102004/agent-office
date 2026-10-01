import { CHECKPOINTS, CIRCUIT_CARS, checkpoint, crossed, gridPose, pastLine, resetSpots, track } from '../shared/circuit.js';
import { BOOST, SPECS } from '../shared/garage.js';
import { RACE, SECTORS, idleRace, type Practicer, type RaceState, type Racer, type Timing } from '../shared/race.js';

/** Further than this between two of a driver's reports (m) isn't driving: it's a jump, and crosses nothing. */
const JUMP = 60;
/** Faster than circuit car `car` goes on the boost, with a little room for a slide (m/s); the fastest kind for one there isn't. */
const fastest = (car: number) => (SPECS[CIRCUIT_CARS[car]?.kind]?.top ?? Math.max(...Object.values(SPECS).map((s) => s.top))) * BOOST.top * 1.15;
/** How far ahead of that pace (m, as seconds of it) a car's reports can get, bunched up by a laggy connection, before they're taken for not driving. */
const LAG = 1;
/** No lap in circuit car `car` is quicker than this (ms): flat out all the way round the centre line. */
const quickestLap = (car: number) => (track().length / fastest(car)) * 1000;
/** Nor any sector (ms), the same way. */
const quickestSector = (car: number, k: number) => (((SECTORS[k + 1] ?? CHECKPOINTS) - SECTORS[k]) / CHECKPOINTS) * quickestLap(car);
/** Practice bests kept by account, for coming back to the circuit: at most this many. */
const PRACTICE_BESTS = 500;
/** A race ends after this long whatever (ms a lap), or when nobody's got through a checkpoint for STALL. */
const LAP_CAP = 5 * 60_000;
const STALL = 3 * 60_000;
/** Held off from where they said they were this long (ms), a driver's car is taken to be where it now says, but that report crosses nothing. */
const REANCHOR = 3000;
/**
 * Less than this much of the way between two lines driven (by the centre line), and getting to the
 * next line was across the grass: it doesn't count. The tightest line round the track itself is over
 * 0.8 of it everywhere.
 */
const CUT = 0.7;

/**
 * The race at the circuit, as the office keeps it: who's on the grid, the countdown, and each
 * racer's laps and checkpoints from where their car is (car.drive), in order, the right way round,
 * so there's no cutting across. Positions and lap times are the office's, not the pages'.
 */
export class RaceControl {
  private race: RaceState = idleRace();
  /**
   * Where each racer's car was when they last said, and when. `jumped`: it got there some way other
   * than driving (a long gap in its reports), so the next move from there crosses no line.
   */
  private last = new Map<string, { x: number; z: number; at: number; jumped?: boolean; held?: number; budget?: number; driven?: number }>();
  /** The account of each person on practice laps, if they're signed in with one: only theirs are kept. */
  private accounts = new Map<string, string>();
  /** When the results come down, once it's finished. */
  private over = 0;
  /** When anyone last got through a checkpoint (or the lights went out). */
  private progressAt = 0;
  /** When someone first went through each checkpoint of the race (by laps × CHECKPOINTS + checkpoint), for the gaps. */
  private firstAt = new Map<number, number>();
  /** Everyone's best practice lap (ms), by name. */
  private practiceBests = new Map<string, number>();

  /** The race as it is now, for everyone. */
  state(): RaceState {
    const copy = <T extends Timing>(t: T): T => ({ ...t, ...(t.sectors ? { sectors: [...t.sectors] } : {}), ...(t.bestSectors ? { bestSectors: [...t.bestSectors] } : {}) });
    return { ...this.race, racers: this.race.racers.map(copy), practice: this.race.practice.map(copy) };
  }

  /** `id` lines up on the grid in circuit car `car`: while it's idle, lining up or counting down (or a finished one's results are up). Says whether they did. */
  join(id: string, name: string, car: number, now: number): boolean {
    this.tick(now);
    if (this.race.phase === 'finished') this.reset();
    const r = this.race;
    if (r.phase === 'racing' || r.racers.some((x) => x.id === id) || r.racers.length >= RACE.slots) return false;
    if (r.racers.some((x) => x.car === car)) return false;
    let slot = 0;
    while (r.racers.some((x) => x.slot === slot)) slot++;
    this.unpractice(id);
    r.racers.push({ id, name, car, slot, lap: 0, checkpoint: -1, position: 0 });
    if (r.phase === 'idle') r.phase = 'lobby';
    this.order();
    return true;
  }

  /**
   * `id` pulls out (or got out of the car, or left the circuit, or lost their connection: a
   * reconnect is a new PeerInfo id, so there's no keeping their place for them). Anyone who's
   * finished stays in the results, and the results stay up. Says whether anything changed.
   */
  leave(id: string, now = Date.now()): boolean {
    const r = this.race;
    const practising = this.unpractice(id);
    const i = r.racers.findIndex((x) => x.id === id);
    if (practising) this.last.delete(id);
    if (i < 0) return practising;
    this.last.delete(id);
    if (r.phase === 'finished' || r.racers[i].finishedAt !== undefined) return false;
    r.racers.splice(i, 1);
    if (!r.racers.length) this.reset();
    else {
      this.settle(now);
      this.order();
    }
    return true;
  }

  /** Whether `id`'s car at (x, z) is off their slot while the lights count down: the office doesn't take that move. */
  offGrid(id: string, x: number, z: number): boolean {
    const racer = this.race.racers.find((r) => r.id === id);
    if (this.race.phase !== 'countdown' || !racer) return false;
    const g = gridPose(racer.slot);
    return Math.hypot(x - g.x, z - g.z) > 2;
  }

  /** Someone on the grid starts the countdown. */
  start(id: string, now: number): boolean {
    const r = this.race;
    if (r.phase !== 'lobby' || !r.racers.some((x) => x.id === id)) return false;
    r.phase = 'countdown';
    r.startsAt = now + RACE.countdown * 1000;
    return true;
  }

  /** The clock moving on: the lights going out, the stragglers' time running out, the results coming down. Says whether anything changed. */
  tick(now: number): boolean {
    const r = this.race;
    if (r.phase === 'countdown' && now >= (r.startsAt ?? 0)) {
      r.phase = 'racing';
      // Over the line on the grid already counts as the first: from the lights going out, it's a lap.
      // Everyone starts from their slot: from anywhere else, the first move is a jump.
      this.firstAt.clear();
      for (const x of r.racers) {
        Object.assign(x, { lap: 0, checkpoint: 0, lapStartedAt: r.startsAt, sectors: [] });
        this.last.set(x.id, { ...gridPose(x.slot), at: r.startsAt! });
      }
      this.progressAt = now;
      this.order();
      return true;
    }
    // The winner's home and the rest have had their while; or it's gone on far too long, or nobody's getting anywhere.
    const capped = now >= (r.startsAt ?? 0) + r.laps * LAP_CAP || now >= this.progressAt + STALL;
    if (r.phase === 'racing' && ((r.firstHomeAt !== undefined && now >= r.firstHomeAt + RACE.grace * 1000) || capped)) {
      this.finish(now);
      return true;
    }
    if (r.phase === 'finished' && now >= this.over) {
      this.reset();
      return true;
    }
    return false;
  }

  /**
   * `id`'s car has got to (x, z): through their next checkpoint, if they crossed its line. Someone
   * not in the race (`who`: their name and circuit car) is on practice laps, timed the same way.
   * Says whether the race changed.
   */
  drove(id: string, x: number, z: number, now: number, who?: { name: string; car: number; account?: string }): boolean {
    let changed = this.tick(now);
    const racer = this.race.racers.find((r) => r.id === id);
    if (!racer) return this.practised(id, x, z, now, who) || changed;
    if (this.race.phase !== 'racing' || !this.last.has(id)) {
      this.last.set(id, { x, z, at: now });
      return changed;
    }
    if (racer.finishedAt !== undefined) return changed;
    const from = this.step(id, x, z, now, racer.car, racer);
    const next = (racer.checkpoint + 1) % CHECKPOINTS;
    if (!from || !crossed(next, from, { x, z }) || !this.fair(id, racer)) {
      // Positions shift as people pass each other between the lines, too.
      return this.order() || changed;
    }
    racer.checkpoint = next;
    this.progressAt = now;
    this.split(racer, next, now);
    if (next === 0) this.lapped(racer, now);
    const at = racer.lap * CHECKPOINTS + racer.checkpoint;
    if (!this.firstAt.has(at)) this.firstAt.set(at, now);
    racer.gap = now - this.firstAt.get(at)!;
    this.order();
    changed = true;
    return changed;
  }

  /**
   * The car has got to (x, z) at `now`: where it came from, if it got here by driving and can have
   * crossed a line on the way. Further than a car could have gone since is not driving: where it was
   * stands, unless it stays away a while (a bad connection), when it's taken to be here, but can't
   * cross a line from here. A jump back onto the track behind it, at the last checkpoint it went
   * through (`t`, its timing: shared/circuit.ts resetSpots) is a reset, which gains nothing: it's
   * there straight away. How far it's driven since its last line is kept, for fair().
   */
  private step(id: string, x: number, z: number, now: number, car: number, t: Timing & { lap?: number; slot?: number }): { x: number; z: number } | undefined {
    const max = fastest(car);
    const cap = max * LAG;
    const from = this.last.get(id);
    if (!from) {
      this.last.set(id, { x, z, at: now, budget: cap });
      return undefined;
    }
    // How far it could have gone since, at that car's pace, less how far it went: what's left of a second's lead.
    const far = Math.hypot(x - from.x, z - from.z);
    const budget = Math.min(cap, (from.budget ?? cap) + (max * Math.max(0, now - from.at)) / 1000 - far);
    if (far > JUMP || budget < 0) {
      // Put back on the track: onto one of its spots for where it's got to, and no further round than it was.
      const reset = resetSpots(t).some((r) => Math.hypot(x - r.x, z - r.z) < 1);
      if (reset && pastLine(t.checkpoint, x, z) <= pastLine(t.checkpoint, from.x, from.z) + 1) {
        this.last.set(id, { x, z, at: now, budget: 0, driven: 0 });
        return undefined;
      }
      const held = from.held ?? now;
      // Taken to be here after all: owing the time it saved (up to a few seconds' worth), so a jump ahead gains nothing.
      this.last.set(id, now - held >= REANCHOR ? { x, z, at: now, jumped: true, budget: Math.max(-3 * cap, Math.min(0, budget)), driven: 0 } : { ...from, held });
      return undefined;
    }
    this.last.set(id, { x, z, at: now, budget, driven: (from.driven ?? 0) + far });
    return from.jumped ? undefined : from;
  }

  /**
   * Whether `id` drove round the track to the line they've just gone over, rather than across the
   * grass to it (CUT): far enough since their last one. The first time over the start line on practice
   * laps is from wherever. Counting it starts them on the next.
   */
  private fair(id: string, t: Timing): boolean {
    const at = this.last.get(id);
    if (!at || (t.checkpoint >= 0 && (at.driven ?? 0) < (CUT * track().length) / CHECKPOINTS)) return false;
    at.driven = 0;
    return true;
  }

  /** Practice laps: the same checkpoints in the same order, from the first time over the start line. */
  private practised(id: string, x: number, z: number, now: number, who?: { name: string; car: number; account?: string }): boolean {
    const list = this.race.practice;
    let p = list.find((q) => q.id === id);
    let changed = false;
    if (!p) {
      if (!who) return false;
      const best = who.account === undefined ? undefined : this.practiceBests.get(who.account);
      p = { id, name: who.name, car: who.car, laps: 0, checkpoint: -1, ...(best !== undefined ? { bestLap: best } : {}) };
      list.push(p);
      if (who.account !== undefined) this.accounts.set(id, who.account);
      changed = true;
    }
    // Renamed since.
    if (who && who.name !== p.name) {
      p.name = who.name;
      changed = true;
    }
    const from = this.step(id, x, z, now, p.car, p);
    const next = (p.checkpoint + 1) % CHECKPOINTS;
    if (!from || !crossed(next, from, { x, z }) || !this.fair(id, p)) return changed;
    p.checkpoint = next;
    this.split(p, next, now);
    if (next !== 0) return true;
    const ms = p.lapStartedAt === undefined ? 0 : now - p.lapStartedAt;
    Object.assign(p, { lapStartedAt: now, sectors: [] });
    if (ms < quickestLap(p.car)) return true;
    p.laps++;
    p.lastLap = ms;
    if (p.bestLap === undefined || ms < p.bestLap) p.bestLap = ms;
    // Kept, and on the record, only for someone signed in with their own account: a name anyone can take.
    const account = this.accounts.get(id);
    if (account === undefined) return true;
    if (ms <= (this.practiceBests.get(account) ?? Infinity)) {
      this.practiceBests.delete(account);
      this.practiceBests.set(account, ms);
      if (this.practiceBests.size > PRACTICE_BESTS) this.practiceBests.delete(this.practiceBests.keys().next().value!);
    }
    if (!this.race.practiceRecord || ms < this.race.practiceRecord.ms) this.race.practiceRecord = { name: p.name, ms };
    return true;
  }

  /** Off practice laps. Says whether they were on them. */
  private unpractice(id: string): boolean {
    const list = this.race.practice;
    const i = list.findIndex((p) => p.id === id);
    if (i >= 0) list.splice(i, 1);
    this.accounts.delete(id);
    return i >= 0;
  }

  /** Through checkpoint `next` on a lap: the end of a sector, if it's where the next starts. Timed by the office's clock. */
  private split(t: Timing & { car: number }, next: number, now: number) {
    const k = SECTORS.indexOf(next as (typeof SECTORS)[number]);
    if (k < 0 || t.lapStartedAt === undefined) return;
    const done = (k + SECTORS.length - 1) % SECTORS.length;
    const sectors = (t.sectors ??= []);
    // Not from the start of this lap's sectors (on a lap since before they were timed): nothing to time.
    if (sectors.length !== done) return;
    const ms = now - t.lapStartedAt - sectors.reduce((a, b) => a + b, 0);
    sectors.push(ms);
    if (ms < quickestSector(t.car, done)) {
      delete t.lastSplit;
      return;
    }
    const best = t.bestSectors?.[done] ?? null;
    t.lastSplit = { sector: done, ms, ...(best !== null ? { delta: ms - best } : {}) };
    if (best === null || ms < best) (t.bestSectors ??= SECTORS.map(() => null))[done] = ms;
  }

  /** Over the line at the end of a lap. */
  private lapped(racer: Racer, now: number) {
    const r = this.race;
    const ms = now - (racer.lapStartedAt ?? now);
    racer.lapStartedAt = now;
    racer.sectors = [];
    // Quicker than a car can go round: not a lap.
    if (ms < quickestLap(racer.car)) return;
    racer.lap++;
    racer.lastLap = ms;
    if (ms > 0 && (racer.bestLap === undefined || ms < racer.bestLap)) racer.bestLap = ms;
    if (ms > 0 && (!r.record || ms < r.record.ms)) r.record = { name: racer.name, ms };
    if (racer.lap < r.laps) return;
    racer.finishedAt = now;
    r.firstHomeAt ??= now;
    this.settle(now);
  }

  /** Everyone still in has finished: it's over. */
  private settle(now: number) {
    const r = this.race;
    if (r.phase === 'racing' && r.racers.every((x) => x.finishedAt !== undefined)) this.finish(now);
  }

  private finish(now: number) {
    this.race.phase = 'finished';
    this.over = now + RACE.results * 1000;
  }

  /** Back to nobody lined up; the record stays. */
  private reset() {
    this.progressAt = 0;
    const { record, practice, practiceRecord } = this.race;
    this.race = { ...idleRace(), practice, ...(record ? { record } : {}), ...(practiceRecord ? { practiceRecord } : {}) };
    // Those on practice laps carry on from where they are.
    for (const id of this.last.keys()) if (!practice.some((p) => p.id === id)) this.last.delete(id);
    this.firstAt.clear();
  }

  /**
   * Who's where: home first, in the order they got there; then the most laps and checkpoints; then
   * whoever's nearest their next line. Before the start, the grid's order. Says whether it changed.
   */
  private order(): boolean {
    const r = this.race;
    const toGo = (x: Racer) => {
      const at = this.last.get(x.id);
      if (!at) return Infinity;
      const c = checkpoint((x.checkpoint + 1) % CHECKPOINTS);
      return Math.hypot(at.x - c.x, at.z - c.z);
    };
    const ranked = [...r.racers].sort((a, b) => {
      if (r.phase === 'idle' || r.phase === 'lobby' || r.phase === 'countdown') return a.slot - b.slot;
      if (a.finishedAt !== undefined || b.finishedAt !== undefined) return (a.finishedAt ?? Infinity) - (b.finishedAt ?? Infinity);
      return b.lap - a.lap || b.checkpoint - a.checkpoint || toGo(a) - toGo(b);
    });
    let changed = false;
    ranked.forEach((x, i) => {
      if (x.position !== i + 1) changed = true;
      x.position = i + 1;
    });
    return changed;
  }
}
