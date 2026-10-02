import {
  BODY_R,
  PRACTICE_DOWN,
  PRACTICE_TARGETS,
  RULES,
  SPAWNS,
  SWAP,
  WEAPONS,
  damageOf,
  eyeY,
  idleArena,
  rayPerson,
  rayWorld,
  targetAt,
  type ArenaPlayer,
  type ArenaState,
  type Body,
  type ShotResult,
  type V3,
  type WeaponId,
} from '../shared/arena.js';

export type { ShotResult } from '../shared/arena.js';

/** A shot's leaving point more than this far (m) from where the office has the shooter isn't theirs to take. */
const REACH = 2.5;
/** People are this much wider to hit than they are (m): even looked for where they were (see VIEW_LAG), the office has them a little off where the shooter saw them. */
const LAG_R = 0.15;
/**
 * A person fires at the others where their page showed them, which is where they were a moment ago:
 * their own round trip, plus about this long (ms) that a page draws everyone else behind (main.ts
 * sends where you are every 66 ms, and everyone else's bodies ease toward that at 12 a second). The
 * office looks that far back for them (see moved), up to MAX_REWIND, so nobody's shot long after
 * they're round a corner.
 */
const VIEW_LAG = 100;
const MAX_REWIND = 300;
/** How long (ms) the office keeps where everyone's been. */
const TRAIL = 1000;
/** Slack (ms) for shots and reloads bunched up on their way, half a gap between shots: the average rate still can't beat the gun's. */
const jitter = (w: WeaponId) => WEAPONS[w].every / 2;
/** How far (m) the eyes a shot leaves from can be off where the office has them, up or down: a step, a bob, a moment's lag. */
const REACH_Y = 0.7;
/**
 * Crouched this long (ms) on the same footing, someone's eyes are all the way down: a shot can leave
 * from no higher than EYE_SLACK (m: a bob, a frame of standing up) over them. Else a page could say
 * it's crouching, to be judged low behind a barrier, and fire over it from standing height.
 */
const CROUCHED = 300;
const EYE_SLACK = 0.15;
/** Kills kept in the feed. */
const FEED = 6;

/** Full guns, both of them. */
const fullMags = (): Record<WeaponId, number> => ({ rifle: WEAPONS.rifle.mag, smg: WEAPONS.smg.mag });

interface Gun {
  /** Rounds left in each gun (the one in their hands is ArenaPlayer.w). */
  ammo: Record<WeaponId, number>;
  /** When the next shot can go (epoch ms): after the last one, or the reload. */
  ready: number;
  /** When the reload's done, while reloading. */
  reloadAt?: number;
  /** When they were last hurt. */
  hurtAt: number;
}

/**
 * The arena's free-for-all, as the office keeps it: who's in, their health and guns, kills and deaths,
 * the match clock, and the practice targets while it's warm-up. Who a shot hits is worked out here,
 * from where the office has everyone (`where`) and where they've been (`moved`).
 *
 * For anyone else putting players in (bots, server/arenabots.ts): `where` has to say whether each is
 * crouching (they're lower to hit); every step a player takes goes to `moved`, or shots at them are
 * judged on where they are now, not where the shooter saw them; and `fire` takes the shooter's round
 * trip (undefined for a bot, which sees everyone where they are). Aim at a body's middle below
 * BODY_TOP, or at HEAD_C for the head, less CROUCH for someone crouching (shared/arena.ts).
 */
export class ArenaControl {
  private arena: ArenaState = idleArena();
  private guns = new Map<string, Gun>();
  /** Where each of them has been lately, oldest first (see moved). */
  private trails = new Map<string, (Body & { t: number })[]>();
  /** Each practice target's health, and when it's back up after being shot down (0: it's up). */
  private targetHp: number[] = Array(PRACTICE_TARGETS).fill(RULES.hp);
  private targetsDown: number[] = Array(PRACTICE_TARGETS).fill(0);
  /** When the clock last moved on. */
  private ticked = 0;

  constructor(private where: (id: string) => Required<Body> | undefined) {}

  state(): ArenaState {
    const a = this.arena;
    return {
      ...a,
      players: a.players.map((p) => ({ ...p })),
      feed: [...a.feed],
      ...(a.phase === 'warmup' ? { targets: [...this.targetsDown] } : {}),
    };
  }

  /** Whether `id` is in it. */
  has(id: string): boolean {
    return this.arena.players.some((p) => p.id === id);
  }

  /** `id` came into the arena: in, alive, and safe for a moment. */
  join(id: string, name: string, now: number) {
    if (this.has(id)) return;
    this.arena.players.push({ id, name, kills: 0, deaths: 0, streak: 0, hp: RULES.hp, alive: true, safeUntil: now + RULES.safe * 1000, w: 'rifle' });
    this.guns.set(id, { ammo: fullMags(), ready: now, hurtAt: 0 });
    this.settle(now);
  }

  /** `id` left (or lost their connection). Says whether they were in. */
  leave(id: string, now = Date.now()): boolean {
    const i = this.arena.players.findIndex((p) => p.id === id);
    if (i < 0) return false;
    this.arena.players.splice(i, 1);
    this.guns.delete(id);
    this.trails.delete(id);
    if (this.arena.phase === 'live' && this.arena.players.length < RULES.players) this.warmup();
    this.settle(now);
    return true;
  }

  /**
   * `id` is at `at` as of `now`: tell it every move (a person's 'move', a bot's step), so a shot from
   * someone who saw them a moment ago is judged against where they were then (see fire).
   */
  moved(id: string, at: Body, now: number) {
    if (!this.has(id)) return;
    let trail = this.trails.get(id);
    if (!trail) this.trails.set(id, (trail = []));
    trail.push({ t: now, x: at.x, y: at.y, z: at.z, crouch: at.crouch });
    while (trail.length > 2 && trail[1].t < now - TRAIL) trail.shift();
  }

  /** Where `id` was at `t`: between the two moves the office heard either side of it, or where they are now after the last. */
  private was(id: string, t: number): Body | undefined {
    const now = this.where(id);
    const trail = this.trails.get(id);
    if (!now || !trail?.length || t >= trail[trail.length - 1].t) return now;
    let i = trail.length - 1;
    while (i > 0 && trail[i - 1].t > t) i--;
    if (i === 0) return trail[0];
    const a = trail[i - 1], b = trail[i];
    const k = (t - a.t) / Math.max(1, b.t - a.t);
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k, crouch: k < 0.5 ? a.crouch : b.crouch };
  }

  /**
   * A reload that's done (or as good as: see jitter) fills gun `w`. First thing whenever someone does
   * anything with their gun, so it's never lost to a swap or the like before the timer (tick) gets to it.
   */
  private reloaded(g: Gun, w: WeaponId, now: number) {
    if (g.reloadAt === undefined || now < g.reloadAt - jitter(w)) return;
    g.ammo[w] = WEAPONS[w].mag;
    delete g.reloadAt;
  }

  /** Whether `id` has been crouching at least CROUCHED ms without going up or down (no jump, no step): their eyes are all the way down. */
  private crouched(id: string, now: number): boolean {
    const trail = this.trails.get(id);
    if (!trail?.length) return false;
    // From the last move before that long ago (where they were then) on.
    let i = trail.length - 1;
    while (i > 0 && trail[i].t > now - CROUCHED) i--;
    if (trail[i].t > now - CROUCHED) return false;
    const y = trail[trail.length - 1].y;
    for (; i < trail.length; i++) if (!trail[i].crouch || Math.abs(trail[i].y - y) > 0.02) return false;
    return true;
  }

  /** `id` starts reloading the gun in their hands. */
  reload(id: string, now: number): boolean {
    const g = this.guns.get(id);
    const w = this.arena.players.find((p) => p.id === id)?.w;
    if (!g || !w) return false;
    this.reloaded(g, w, now);
    if (g.reloadAt !== undefined || g.ammo[w] >= WEAPONS[w].mag) return false;
    g.reloadAt = now + WEAPONS[w].reload;
    g.ready = Math.max(g.ready, g.reloadAt);
    return true;
  }

  /**
   * `id` swaps to gun `w`: a reload under way is dropped (the rounds stay as they were), and there's no
   * firing for SWAP ms. Says whether they did (everyone should hear: it's in their hands).
   */
  weapon(id: string, w: WeaponId, now: number): boolean {
    const me = this.arena.players.find((p) => p.id === id);
    const g = this.guns.get(id);
    if (!me || !g || !me.alive || me.w === w || !WEAPONS[w]) return false;
    this.reloaded(g, me.w, now);
    me.w = w;
    delete g.reloadAt;
    // Longer than any gun's gap between shots, so it never fires sooner than it could have.
    g.ready = now + SWAP;
    return true;
  }

  /**
   * `id` fires from `o` along `d` at `now`: undefined if they can't (dead, out of rounds, too soon, or
   * not where they say they are), else what it hit. The office's word, not the page's. `rtt` is a
   * person's round trip to the office (ms): everyone's judged where that person's page showed them a
   * moment ago. A bot passes undefined: it sees everyone where they are. (Not optional, so nobody
   * wiring in another kind of shooter forgets to pass a person's.)
   */
  fire(id: string, o: V3, d: V3, now: number, rtt: number | undefined): ShotResult | undefined {
    const g = this.guns.get(id);
    const me = this.arena.players.find((p) => p.id === id);
    const at = this.where(id);
    if (!me || !g || !at) return undefined;
    const w = me.w, gun = WEAPONS[w];
    // Only the reload: respawns, healing and the match clock are the timer's (tick), which tells everyone.
    this.reloaded(g, w, now);
    if (!me.alive || this.arena.phase === 'over') return undefined;
    if (g.reloadAt !== undefined || g.ammo[w] <= 0 || now < g.ready - jitter(w)) return undefined;
    const len = Math.hypot(d.x, d.y, d.z);
    if (!(len > 0.5) || ![o.x, o.y, o.z].every(Number.isFinite)) return undefined;
    const dir = { x: d.x / len, y: d.y / len, z: d.z / len };
    const eye = { x: at.x, y: eyeY(at), z: at.z };
    if (Math.hypot(o.x - at.x, o.z - at.z) > REACH || Math.abs(o.y - eye.y) > REACH_Y) return undefined;
    if (o.y > eye.y + EYE_SLACK && at.crouch && this.crouched(id, now)) return undefined;
    // Not round a corner or over cover from behind it: the eyes have to see where the shot leaves from.
    const gap = Math.hypot(o.x - eye.x, o.y - eye.y, o.z - eye.z);
    if (gap > 0.05 && rayWorld(eye, { x: (o.x - eye.x) / gap, y: (o.y - eye.y) / gap, z: (o.z - eye.z) / gap }, gap) < gap - 0.05) return undefined;
    g.ammo[w]--;
    // From the last shot's slot, not when this one got here: a late one doesn't push the next back.
    g.ready = Math.max(g.ready, now - jitter(w)) + gun.every;
    // Firing gives up being safe.
    delete me.safeUntil;
    const back = rtt === undefined ? 0 : Math.min(MAX_REWIND, Math.max(0, rtt) + VIEW_LAG);
    let t = rayWorld(o, dir);
    let near: { id?: string; target?: number; head: boolean } | undefined;
    for (const p of this.arena.players) {
      if (p.id === id || !p.alive) continue;
      const pos = this.was(p.id, now - back);
      const h = pos && rayPerson(o, dir, pos, BODY_R + LAG_R);
      if (h && h.t < t) [t, near] = [h.t, { id: p.id, head: h.head }];
    }
    // The practice targets go by the office's clock, which the shooter's page had half a round trip ago.
    if (this.arena.phase === 'warmup') {
      for (let i = 0; i < PRACTICE_TARGETS; i++) {
        if (this.targetsDown[i]) continue;
        const h = rayPerson(o, dir, targetAt(i, now - (rtt ?? 0) / 2), BODY_R + LAG_R);
        if (h && h.t < t) [t, near] = [h.t, { target: i, head: h.head }];
      }
    }
    const end = { x: o.x + dir.x * t, y: o.y + dir.y * t, z: o.z + dir.z * t };
    if (!near) return { w, end };
    const { head } = near;
    const dmg = damageOf(gun, head, t);
    if (near.target !== undefined) {
      const i = near.target;
      this.targetHp[i] -= dmg;
      if (this.targetHp[i] > 0) return { w, end, target: i, head, dmg, hp: this.targetHp[i] };
      this.targetHp[i] = RULES.hp;
      this.targetsDown[i] = now + PRACTICE_DOWN * 1000;
      return { w, end, target: i, head, dmg, hp: 0, kill: true };
    }
    const victim = this.arena.players.find((p) => p.id === near.id)!;
    if (now < (victim.safeUntil ?? 0)) return { w, end, shield: victim.id };
    victim.hp = Math.max(0, victim.hp - dmg);
    this.guns.get(victim.id)!.hurtAt = now;
    if (victim.hp > 0) return { w, end, hit: victim.id, head, dmg, hp: victim.hp };
    this.killed(me, victim, head, now);
    return { w, end, hit: victim.id, head, dmg, hp: 0, kill: true, streak: me.streak };
  }

  /**
   * The clock moving on: guns reloaded, the hurt healing, the dead back in (returned, with where they
   * come back in), practice targets back up, the match starting, running out or its results coming
   * down. `changed`: anything everyone should hear.
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
        g.ammo[p.w] = WEAPONS[p.w].mag;
        delete g.reloadAt;
      }
      if (!p.alive && now >= (p.respawnAt ?? 0) && a.phase !== 'over') {
        const s = this.spawnFor(p.id);
        Object.assign(p, { alive: true, hp: RULES.hp, safeUntil: now + RULES.safe * 1000 });
        delete p.respawnAt;
        Object.assign(g, { ammo: fullMags(), ready: now, hurtAt: 0 });
        delete g.reloadAt;
        this.trails.delete(p.id);
        spawned.push({ id: p.id, ...s });
        changed = true;
      } else if (p.alive && p.hp < RULES.hp && now - g.hurtAt >= RULES.healAfter * 1000) {
        p.hp = Math.min(RULES.hp, p.hp + RULES.heal * dt);
        changed = true;
      }
    }
    for (let i = 0; i < PRACTICE_TARGETS; i++) {
      if (!this.targetsDown[i] || now < this.targetsDown[i]) continue;
      this.targetsDown[i] = 0;
      changed = true;
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

  /** Where `id` should come back in: a spawn nobody alive can see, the furthest from them; else just the furthest. */
  spawnFor(id: string): { x: number; z: number; rotY: number } {
    const others = this.arena.players.filter((p) => p.id !== id && p.alive).map((p) => this.where(p.id)).filter((p): p is Required<Body> => !!p);
    let best = SPAWNS[Math.floor(Math.random() * SPAWNS.length)];
    let score = -Infinity;
    for (const s of SPAWNS) {
      const near = others.length ? Math.min(...others.map((o) => Math.hypot(o.x - s.x, o.z - s.z))) : Math.random();
      const v = near - (others.some((o) => sees(o, s)) ? 1000 : 0);
      if (v > score) [score, best] = [v, s];
    }
    return best;
  }

  private killed(killer: ArenaPlayer, victim: ArenaPlayer, head: boolean, now: number) {
    const a = this.arena;
    Object.assign(victim, { hp: 0, alive: false, respawnAt: now + RULES.respawn * 1000, streak: 0 });
    this.trails.delete(victim.id);
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

/** Whether someone standing at `o` can see a person coming in at spawn `s` (their eyes to the newcomer's chest). */
function sees(o: Body, s: { x: number; z: number }): boolean {
  const eye = { x: o.x, y: eyeY(o), z: o.z };
  const dx = s.x - eye.x, dy = 1.1 - eye.y, dz = s.z - eye.z;
  const len = Math.hypot(dx, dy, dz);
  return rayWorld(eye, { x: dx / len, y: dy / len, z: dz / len }, len) >= len - 0.1;
}
