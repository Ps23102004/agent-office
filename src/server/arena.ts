import { BODY_R, EYE_Y, RULES, SPAWNS, idleArena, rayPerson, rayWorld, type ArenaPlayer, type ArenaState, type V3 } from '../shared/arena.js';

/** A shot's leaving point more than this far (m) from where the office has the shooter isn't theirs to take. */
const REACH = 2.5;
/** People are this much wider to hit than they are (m): where the office has them is a moment behind. */
const LAG_R = 0.25;
/** Kills kept in the feed. */
const FEED = 6;

/** What became of a shot: where it stopped, and who it hit. */
export interface ShotResult {
  end: V3;
  hit?: string;
  head?: boolean;
  kill?: boolean;
}

interface Gun {
  ammo: number;
  /** When the next shot can go (epoch ms): after the last one, or the reload. */
  ready: number;
  /** When the reload's done, while reloading. */
  reloadAt?: number;
  /** Shot nobody since they came back in (still safe). */
  safeUntil: number;
  /** When they were last hurt. */
  hurtAt: number;
}

/**
 * The arena's free-for-all, as the office keeps it: who's in, their health and guns, kills and deaths,
 * the match clock. Who a shot hits is worked out here, from where the office has everyone (`where`).
 */
export class ArenaControl {
  private arena: ArenaState = idleArena();
  private guns = new Map<string, Gun>();
  /** When the clock last moved on. */
  private ticked = 0;

  constructor(private where: (id: string) => V3 | undefined) {}

  state(): ArenaState {
    return { ...this.arena, players: this.arena.players.map((p) => ({ ...p })), feed: [...this.arena.feed] };
  }

  /** Whether `id` is in it. */
  has(id: string): boolean {
    return this.arena.players.some((p) => p.id === id);
  }

  /** `id` came into the arena: in, alive, and safe for a moment. */
  join(id: string, name: string, now: number) {
    if (this.has(id)) return;
    this.arena.players.push({ id, name, kills: 0, deaths: 0, streak: 0, hp: RULES.hp, alive: true });
    this.guns.set(id, { ammo: RULES.mag, ready: now, safeUntil: now + RULES.safe * 1000, hurtAt: 0 });
    this.settle(now);
  }

  /** `id` left (or lost their connection). Says whether they were in. */
  leave(id: string, now = Date.now()): boolean {
    const i = this.arena.players.findIndex((p) => p.id === id);
    if (i < 0) return false;
    this.arena.players.splice(i, 1);
    this.guns.delete(id);
    if (this.arena.phase === 'live' && this.arena.players.length < RULES.players) this.warmup();
    this.settle(now);
    return true;
  }

  /** `id` starts reloading. */
  reload(id: string, now: number): boolean {
    const g = this.guns.get(id);
    if (!g || g.reloadAt !== undefined || g.ammo >= RULES.mag) return false;
    g.reloadAt = now + RULES.reload;
    g.ready = Math.max(g.ready, g.reloadAt);
    return true;
  }

  /**
   * `id` fires from `o` along `d` at `now`: undefined if they can't (dead, out of rounds, too soon, or
   * not where they say they are), else what it hit. The office's word, not the page's.
   */
  fire(id: string, o: V3, d: V3, now: number): ShotResult | undefined {
    this.tick(now);
    const me = this.arena.players.find((p) => p.id === id);
    const g = this.guns.get(id);
    const at = this.where(id);
    if (!me || !g || !at || !me.alive || this.arena.phase === 'over') return undefined;
    if (g.reloadAt !== undefined || g.ammo <= 0 || now < g.ready - 15) return undefined;
    const len = Math.hypot(d.x, d.y, d.z);
    if (!(len > 0.5) || ![o.x, o.y, o.z].every(Number.isFinite)) return undefined;
    const dir = { x: d.x / len, y: d.y / len, z: d.z / len };
    if (Math.hypot(o.x - at.x, o.z - at.z) > REACH || Math.abs(o.y - (at.y + EYE_Y)) > REACH) return undefined;
    g.ammo--;
    g.ready = now + RULES.every;
    g.safeUntil = 0;
    let t = rayWorld(o, dir);
    let hit: { id: string; head: boolean } | undefined;
    for (const p of this.arena.players) {
      if (p.id === id || !p.alive) continue;
      const pos = this.where(p.id);
      const h = pos && rayPerson(o, dir, pos, BODY_R + LAG_R);
      if (h && h.t < t) {
        t = h.t;
        hit = { id: p.id, head: h.head };
      }
    }
    const end = { x: o.x + dir.x * t, y: o.y + dir.y * t, z: o.z + dir.z * t };
    if (!hit) return { end };
    const victim = this.arena.players.find((p) => p.id === hit.id)!;
    const vg = this.guns.get(victim.id)!;
    if (now < vg.safeUntil) return { end, hit: victim.id, head: hit.head };
    victim.hp -= hit.head ? RULES.head : RULES.body;
    vg.hurtAt = now;
    if (victim.hp > 0) return { end, hit: victim.id, head: hit.head };
    this.killed(me, victim, hit.head, now);
    return { end, hit: victim.id, head: hit.head, kill: true };
  }

  /**
   * The clock moving on: guns reloaded, the hurt healing, the dead back in (returned, with where they
   * come back in), the match starting, running out or its results coming down. `changed`: anything
   * everyone should hear.
   */
  tick(now: number): { changed: boolean; spawned: { id: string; x: number; z: number; rotY: number }[] } {
    const a = this.arena;
    let changed = false;
    const spawned: { id: string; x: number; z: number; rotY: number }[] = [];
    const dt = Math.min(1, Math.max(0, (now - (this.ticked || now)) / 1000));
    this.ticked = now;
    for (const p of a.players) {
      const g = this.guns.get(p.id)!;
      if (g.reloadAt !== undefined && now >= g.reloadAt) {
        g.ammo = RULES.mag;
        delete g.reloadAt;
      }
      if (!p.alive && now >= (p.respawnAt ?? 0) && a.phase !== 'over') {
        const s = this.spawnFor(p.id);
        Object.assign(p, { alive: true, hp: RULES.hp });
        delete p.respawnAt;
        Object.assign(g, { ammo: RULES.mag, ready: now, safeUntil: now + RULES.safe * 1000, hurtAt: 0 });
        delete g.reloadAt;
        spawned.push({ id: p.id, ...s });
        changed = true;
      } else if (p.alive && p.hp < RULES.hp && now - g.hurtAt >= RULES.healAfter * 1000) {
        p.hp = Math.min(RULES.hp, p.hp + RULES.heal * dt);
        changed = true;
      }
    }
    if (a.phase === 'live' && now >= (a.endsAt ?? Infinity)) {
      this.over(now);
      changed = true;
    } else if (a.phase === 'over' && now >= (a.endsAt ?? 0)) {
      this.warmup();
      this.settle(now);
      changed = true;
      // Everyone back in fresh for the next one.
      for (const p of a.players) if (!p.alive) p.respawnAt = now;
    }
    return { changed, spawned };
  }

  /** Where `id` should come back in: the spawn furthest from anyone alive to shoot them. */
  spawnFor(id: string): { x: number; z: number; rotY: number } {
    const others = this.arena.players.filter((p) => p.id !== id && p.alive).map((p) => this.where(p.id)).filter((p): p is V3 => !!p);
    let best = SPAWNS[Math.floor(Math.random() * SPAWNS.length)];
    let far = -1;
    for (const s of SPAWNS) {
      const near = others.length ? Math.min(...others.map((o) => Math.hypot(o.x - s.x, o.z - s.z))) : Math.random();
      if (near > far) [far, best] = [near, s];
    }
    return best;
  }

  private killed(killer: ArenaPlayer, victim: ArenaPlayer, head: boolean, now: number) {
    const a = this.arena;
    Object.assign(victim, { hp: 0, alive: false, respawnAt: now + RULES.respawn * 1000, streak: 0 });
    a.feed.push({ at: now, killer: killer.name, victim: victim.name, head });
    if (a.feed.length > FEED) a.feed.shift();
    if (a.phase !== 'live') return;
    killer.kills++;
    killer.streak++;
    victim.deaths++;
    if (killer.kills >= RULES.limit) this.over(now, killer.name);
  }

  /** Enough people in to play for real: a live match from nothing, everyone's score cleared. */
  private settle(now: number): boolean {
    const a = this.arena;
    if (a.phase !== 'warmup' || a.players.length < RULES.players) return false;
    a.phase = 'live';
    a.endsAt = now + RULES.minutes * 60_000;
    delete a.winner;
    for (const p of a.players) Object.assign(p, { kills: 0, deaths: 0, streak: 0 });
    return true;
  }

  private over(now: number, winner?: string) {
    const a = this.arena;
    a.phase = 'over';
    a.endsAt = now + RULES.results * 1000;
    const top = [...a.players].sort((x, y) => y.kills - x.kills || x.deaths - y.deaths)[0];
    a.winner = winner ?? top?.name;
  }

  private warmup() {
    this.arena.phase = 'warmup';
    delete this.arena.endsAt;
    delete this.arena.winner;
  }
}
