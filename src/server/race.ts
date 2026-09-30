import { CHECKPOINTS, checkpoint, crossed } from '../shared/circuit.js';
import { RACE, idleRace, type RaceState, type Racer } from '../shared/race.js';

/** Further than this between two of a driver's reports (m) isn't driving: it's a jump, and crosses nothing. */
const JUMP = 40;

/**
 * The race at the circuit, as the office keeps it: who's on the grid, the countdown, and each
 * racer's laps and checkpoints from where their car is (car.drive), in order, the right way round,
 * so there's no cutting across. Positions and lap times are the office's, not the pages'.
 */
export class RaceControl {
  private race: RaceState = idleRace();
  /** Where each racer's car was when they last said. */
  private last = new Map<string, { x: number; z: number }>();
  /** When the results come down, once it's finished. */
  private over = 0;

  /** The race as it is now, for everyone. */
  state(): RaceState {
    return { ...this.race, racers: this.race.racers.map((r) => ({ ...r })) };
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
    r.racers.push({ id, name, car, slot, lap: 0, checkpoint: -1, position: 0 });
    if (r.phase === 'idle') r.phase = 'lobby';
    this.order();
    return true;
  }

  /** `id` pulls out (or got out of the car, or left the circuit). Says whether they were in it. */
  leave(id: string, now = Date.now()): boolean {
    const r = this.race;
    const i = r.racers.findIndex((x) => x.id === id);
    if (i < 0) return false;
    r.racers.splice(i, 1);
    this.last.delete(id);
    if (!r.racers.length) this.reset();
    else {
      this.settle(now);
      this.order();
    }
    return true;
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
      for (const x of r.racers) Object.assign(x, { lap: 0, checkpoint: 0, lapStartedAt: r.startsAt });
      this.order();
      return true;
    }
    if (r.phase === 'racing' && r.firstHomeAt !== undefined && now >= r.firstHomeAt + RACE.grace * 1000) {
      this.finish(now);
      return true;
    }
    if (r.phase === 'finished' && now >= this.over) {
      this.reset();
      return true;
    }
    return false;
  }

  /** `id`'s car has got to (x, z): through their next checkpoint, if they crossed its line. Says whether the race changed. */
  drove(id: string, x: number, z: number, now: number): boolean {
    let changed = this.tick(now);
    const racer = this.race.racers.find((r) => r.id === id);
    if (!racer) return changed;
    const from = this.last.get(id);
    this.last.set(id, { x, z });
    if (this.race.phase !== 'racing' || racer.finishedAt !== undefined || !from || Math.hypot(x - from.x, z - from.z) > JUMP) return changed;
    const next = (racer.checkpoint + 1) % CHECKPOINTS;
    if (!crossed(next, from, { x, z })) {
      // Positions shift as people pass each other between the lines, too.
      return this.order() || changed;
    }
    racer.checkpoint = next;
    if (next === 0) this.lapped(racer, now);
    this.order();
    changed = true;
    return changed;
  }

  /** Over the line at the end of a lap. */
  private lapped(racer: Racer, now: number) {
    const r = this.race;
    const ms = now - (racer.lapStartedAt ?? now);
    racer.lap++;
    racer.lapStartedAt = now;
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
    const record = this.race.record;
    this.race = { ...idleRace(), ...(record ? { record } : {}) };
    this.last.clear();
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
