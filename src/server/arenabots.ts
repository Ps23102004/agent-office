import { ARENA, ARENA_BOXES, ARENA_CENTER as C, ARENA_HALF, BODY_H, BODY_R, EYE_Y, HEAD_Y, RULES, rayWorld, type ArenaPlayer, type V3 } from '../shared/arena.js';
import { lookFromSeed } from '../shared/avatar.js';
import { BOTS, BOT_ID, BOT_NAMES, SKILL, isBot, type BotLevel, type BotSettings, type BotSkill } from '../shared/bots.js';
import { NavGrid, type Pt, type Rect } from '../shared/nav.js';
import type { PeerInfo } from '../shared/protocol.js';
import type { ArenaControl, ShotResult } from './arena.js';

// The arena's bots (shared/bots.ts): players the office runs itself, so someone alone still gets a
// match. Each is an ordinary peer in the arena and an ordinary player in its match. It only knows
// what it could know: who it can see from its eyes (the same rays as the shot judge, so not through
// cover), shots it hears, and where a shot that hit it came from. It walks at a person's pace round
// the cover on a grid, and fires through the office's one shot judge (io.shoot → ArenaControl.fire),
// with a person's spread and kick on top of its own aim error, so it can't do anything a page can't.

/** A person's pace walking and running (client/player.ts): bots go no faster. */
const WALK = 4.6;
const RUN = 7.5;
/** The rifle's cone and kick (rad), as a person's page has them (client/arena.ts SPREAD, KICK). */
const CONE = { hip: 0.012, move: 0.02, ads: 0.15, perShot: 0.006, maxBloom: 0.03, recover: 0.08 };
const KICK = { up: 0.012, settle: 9 };
/** Where on someone it aims, above their feet: the chest, or the middle of the head, as the shot judge shapes them. */
const CHEST = HEAD_Y * 0.75;
const HEAD = (HEAD_Y + BODY_H) / 2;
/** How long (ms) it remembers where someone was. */
const FORGET = 8000;
/** Colours for the bots' name tags. */
const COLORS = ['#e05050', '#e0a030', '#50b060', '#4fa0e0', '#a070e0', '#e070b0', '#40c0b0'];

/** What it knows of someone: where they were, when, and whether it can see them right now. */
interface Seen {
  x: number;
  y: number;
  z: number;
  /** When it last knew (saw, heard, or was hit from there). */
  at: number;
  /** When it last saw them (0: never). */
  seen: number;
  /** In sight right now. */
  eyes: boolean;
  /** When it can first shoot at them, this time it's seen them: its reaction. */
  ready: number;
  /** How fast they're going, as it sees it (m/s). */
  vx: number;
  vz: number;
}

type Mode = 'roam' | 'engage' | 'hunt' | 'cover';

interface Bot {
  peer: PeerInfo;
  alive: boolean;
  mode: Mode;
  /** The corners still to go on its way, the next first. */
  path: Pt[];
  /** When it gives up on what it's doing (a hunt, waiting in cover). */
  until: number;
  mem: Map<string, Seen>;
  target?: string;
  /** How long (s) it's been on its target: its aim settles as this grows. */
  tracked: number;
  /** Which way across its sights the target last strafed (-1, 0, 1). */
  side: number;
  /** The newest thing it knew of when it last set off to look (Seen.at). */
  chased: number;
  /** When it last looked for cover. */
  searched: number;
  ammo: number;
  reloadAt: number;
  nextShot: number;
  /** Shots left in this burst. */
  burst: number;
  bloom: number;
  /** How far its aim has kicked up and not come back down yet. */
  kick: number;
  /** Which way it's strafing, and till when. */
  strafe: number;
  strafeAt: number;
  hurtAt: number;
  hurtBy?: string;
  /** What everyone last heard of where it is. */
  sent: { x: number; z: number; rotY: number; moving: boolean };
}

/** What the bots need of the office. */
export interface BotIO {
  /** Fires through the office's shot judge, as anyone's shot (and everyone hears it). */
  shoot(id: string, o: V3, d: V3, now: number): ShotResult | undefined;
  /** A bot moved: everyone in the arena sees. */
  moved(peer: PeerInfo): void;
  /** A bot came in, or went: everyone hears. */
  joined(peer: PeerInfo): void;
  left(id: string): void;
}

const angle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Whether the line from `a` to `b` is clear of the yard. */
function clear(a: V3, b: V3): boolean {
  const d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  if (d < 0.05) return true;
  return rayWorld(a, { x: (b.x - a.x) / d, y: (b.y - a.y) / d, z: (b.z - a.z) / d }, d) >= d - 0.05;
}

/** Whether eyes at `o` see someone standing at `p` (their feet): their head or their chest. */
export function sees(o: V3, p: V3): boolean {
  return clear(o, { x: p.x, y: p.y + 1.6, z: p.z }) || clear(o, { x: p.x, y: p.y + CHEST, z: p.z });
}

/**
 * The nearest of `cells` to `from`, within `r` m, that's `ok`: nearest first, so it's usually the
 * first ray or two. ponytail: a scan of the whole grid for the ones in reach (well under a
 * millisecond), only as a bot sets off somewhere; a spatial index if that ever shows up.
 */
function nearest(cells: Pt[], from: Pt, r: number, ok: (c: Pt) => boolean): Pt | undefined {
  const near: [number, Pt][] = [];
  for (const c of cells) {
    const d = Math.hypot(c[0] - from[0], c[1] - from[1]);
    if (d < r) near.push([d, c]);
  }
  return near.sort((a, b) => a[0] - b[0]).find(([, c]) => ok(c))?.[1];
}

interface Yard {
  nav: NavGrid;
  /** The middle of every cell a bot can stand in. */
  cells: Pt[];
  /** Those right beside cover taller than a head: containers and the tall crates. */
  cover: Pt[];
}
let yard: Yard | undefined;

/**
 * The yard on a half-metre grid, round its cover, made the first time a bot needs it (about 16 ms).
 * ponytail: bots keep to the ground, no climbing onto crates and containers; someone up there gets
 * hunted from wherever on the ground sees them. Add jump links if that turns out too easy to camp.
 */
export function arenaYard(): Yard {
  if (yard) return yard;
  // The grid keeps the middle of each cell 0.3 m off things; anywhere in a half-metre cell keeps a body (0.42 m round) clear.
  const m = BODY_R + 0.25 - 0.3;
  const bounds = { minX: C.x - ARENA_HALF + m, maxX: C.x + ARENA_HALF - m, minZ: C.z - ARENA_HALF + m, maxZ: C.z + ARENA_HALF - m };
  const solid = ARENA_BOXES.filter((b) => b.kind !== 'wall' && b.y0 < 1);
  const nav = new NavGrid(bounds, { rects: solid.map((b): Rect => [b.minX - m, b.maxX + m, b.minZ - m, b.maxZ + m]), circles: [] });
  const cells: Pt[] = [];
  for (let x = bounds.minX + 0.25; x < bounds.maxX; x += 0.5) for (let z = bounds.minZ + 0.25; z < bounds.maxZ; z += 0.5) if (nav.walkable(x, z)) cells.push([x, z]);
  const tall = solid.filter((b) => b.y1 >= 2.4);
  const cover = cells.filter(([x, z]) => tall.some((b) => x > b.minX - 1.2 && x < b.maxX + 1.2 && z > b.minZ - 1.2 && z < b.maxZ + 1.2));
  return (yard = { nav, cells, cover });
}

/**
 * The arena's bots: as many as its setting wants for the people in it, each seeing, deciding, moving
 * and firing on `tick` (every 50 ms while there are any). `now` and `rand` come in from outside, so a
 * test can play a match out the same way every time.
 */
export class ArenaBots {
  settings: BotSettings = { fill: BOTS.fill, level: BOTS.level };
  private bots = new Map<string, Bot>();
  private count = 0;
  private ticked = 0;
  /** Whoever a bot killed this tick, after the tick looked who was alive. */
  private downed = new Set<string>();

  constructor(
    private arena: ArenaControl,
    private where: (id: string) => V3 | undefined,
    private io: BotIO,
    private rand: () => number = Math.random,
  ) {}

  get size(): number {
    return this.bots.size;
  }

  /** A bot's peer (the office's own copy: moving it moves the bot). */
  peer(id: string): PeerInfo | undefined {
    return this.bots.get(id)?.peer;
  }

  peers(): PeerInfo[] {
    return [...this.bots.values()].map((b) => b.peer);
  }

  /** Someone in the arena changed the setting: how many players in all, and how good the bots are. */
  set(fill: number, level: BotLevel, by: string, now: number) {
    this.settings = { fill, level, by };
    this.fill(now);
  }

  /**
   * As many bots as the setting wants for the people in the arena, and none once there's nobody. A
   * person coming in takes the place of the bot doing worst.
   */
  fill(now: number) {
    const players = this.arena.state().players;
    const people = players.filter((p) => !isBot(p.id)).length;
    const want = people ? Math.max(0, Math.min(this.settings.fill, BOTS.players) - people) : 0;
    const worst = players.filter((p) => this.bots.has(p.id)).sort((a, b) => a.kills - b.kills || b.deaths - a.deaths);
    for (const p of worst.slice(0, Math.max(0, this.bots.size - want))) this.remove(p.id, now);
    while (this.bots.size < want) this.add(now);
  }

  private add(now: number) {
    const n = ++this.count;
    const id = `${BOT_ID}${n}`;
    const taken = new Set([...this.bots.values()].map((b) => b.peer.name));
    const name = `🤖 ${BOT_NAMES.find((x) => !taken.has(`🤖 ${x}`)) ?? n}`;
    const s = this.arena.spawnFor(id);
    const peer: PeerInfo = { id, name, color: COLORS[n % COLORS.length], look: lookFromSeed(id), x: s.x, y: 0, z: s.z, rotY: s.rotY, moving: false, voice: false, muted: true, sharing: false, floor: ARENA, bot: true };
    const b: Bot = { peer, alive: false, mode: 'roam', path: [], until: 0, mem: new Map(), tracked: 0, side: 0, chased: 0, searched: 0, ammo: RULES.mag, reloadAt: 0, nextShot: 0, burst: 0, bloom: 0, kick: 0, strafe: 1, strafeAt: 0, hurtAt: 0, sent: { x: s.x, z: s.z, rotY: s.rotY, moving: false } };
    this.bots.set(id, b);
    this.arena.join(id, name, now);
    this.io.joined(peer);
  }

  private remove(id: string, now: number) {
    this.bots.delete(id);
    this.arena.leave(id, now);
    this.io.left(id);
  }

  /** A shot from `o` by `by`: bots in earshot know roughly where from (a few metres out). */
  heard(o: V3, by: string, now: number) {
    const k = SKILL[this.settings.level];
    for (const b of this.bots.values()) {
      if (b.peer.id === by || !b.alive || Math.hypot(o.x - b.peer.x, o.z - b.peer.z) > k.hear) continue;
      const old = b.mem.get(by);
      if (old?.eyes) continue;
      const r = 2 + this.rand() * 2, a = this.rand() * Math.PI * 2;
      b.mem.set(by, { x: o.x + Math.cos(a) * r, y: Math.max(0, o.y - EYE_Y), z: o.z + Math.sin(a) * r, at: now, seen: old?.seen ?? 0, eyes: false, ready: old?.ready ?? 0, vx: 0, vz: 0 });
    }
  }

  /** Bot `id` was hit by a shot `by` fired from `o`: it knows which way it came from, as a person does. */
  hurt(id: string, o: V3, by: string, now: number) {
    const b = this.bots.get(id);
    if (!b) return;
    b.hurtAt = now;
    b.hurtBy = by;
    const old = b.mem.get(by);
    if (!old?.eyes) b.mem.set(by, { x: o.x, y: Math.max(0, o.y - EYE_Y), z: o.z, at: now, seen: old?.seen ?? 0, eyes: false, ready: old?.ready ?? 0, vx: 0, vz: 0 });
  }

  /** Every bot sees, decides, moves and fires. */
  tick(now: number) {
    const dt = Math.min(0.2, Math.max(0, (now - (this.ticked || now)) / 1000));
    this.ticked = now;
    const state = this.arena.state();
    const k = SKILL[this.settings.level];
    this.downed.clear();
    for (const b of this.bots.values()) {
      const me = state.players.find((p) => p.id === b.peer.id);
      if (!me?.alive || this.downed.has(b.peer.id)) {
        b.alive = false;
        b.peer.moving = false;
      } else {
        // Just back in: a clean slate, wherever the office put it.
        if (!b.alive) Object.assign(b, { alive: true, mode: 'roam', path: [], until: 0, target: undefined, tracked: 0, chased: now, ammo: RULES.mag, reloadAt: 0, burst: 0, bloom: 0, kick: 0, hurtAt: 0, hurtBy: undefined, mem: new Map() });
        if (state.phase === 'over') b.peer.moving = false;
        else {
          this.look(b, state.players, now, k, dt);
          this.think(b, me.hp, now, k);
          this.move(b, state.players, now, k, dt);
          this.fire(b, now, k, dt);
        }
      }
      const p = b.peer, s = b.sent;
      if (Math.abs(p.x - s.x) + Math.abs(p.z - s.z) > 0.01 || Math.abs(angle(p.rotY - s.rotY)) > 0.02 || p.moving !== s.moving) {
        b.sent = { x: p.x, z: p.z, rotY: p.rotY, moving: p.moving };
        this.io.moved(p);
      }
    }
  }

  /** Who it can see: ahead of it (or right beside it) with nothing in the way. Nobody else. */
  private look(b: Bot, players: ArenaPlayer[], now: number, k: BotSkill, dt: number) {
    const eye = { x: b.peer.x, y: b.peer.y + EYE_Y, z: b.peer.z };
    for (const p of players) {
      if (p.id === b.peer.id) continue;
      const old = b.mem.get(p.id);
      const at = p.alive ? this.where(p.id) : undefined;
      if (!at) {
        b.mem.delete(p.id);
        continue;
      }
      const dx = at.x - eye.x, dz = at.z - eye.z, dist = Math.hypot(dx, dz);
      if (dist > RULES.range || (dist > 3 && Math.abs(angle(Math.atan2(dx, dz) - b.peer.rotY)) > k.fov) || !sees(eye, at)) {
        if (old) old.eyes = false;
        continue;
      }
      // Seen again within half a second, it's still the same sighting: no new reaction to wait out.
      const same = !!old && now - old.seen < 500;
      const vx = old?.eyes && dt > 0 ? (old.vx + (at.x - old.x) / dt) / 2 : 0;
      const vz = old?.eyes && dt > 0 ? (old.vz + (at.z - old.z) / dt) / 2 : 0;
      const ready = same ? old.ready : now + k.reaction[0] + this.rand() * (k.reaction[1] - k.reaction[0]);
      b.mem.set(p.id, { x: at.x, y: at.y, z: at.z, at: now, seen: now, eyes: true, ready, vx, vz });
    }
    for (const [id, s] of b.mem) if (now - s.at > FORGET) b.mem.delete(id);
  }

  /** What to do: fight whoever it sees (or get to cover), else go and look where it last knew of someone, else wander. */
  private think(b: Bot, hp: number, now: number, k: BotSkill) {
    if (b.reloadAt && now >= b.reloadAt) {
      b.ammo = RULES.mag;
      b.reloadAt = 0;
    }
    // Whoever's nearest, sticking with the one it's on, and turning on whoever just shot it.
    let target: string | undefined, best = -Infinity;
    for (const [id, s] of b.mem) {
      if (!s.eyes) continue;
      const v = 10 / Math.max(1, Math.hypot(s.x - b.peer.x, s.z - b.peer.z)) + (id === b.target ? 0.3 : 0) + (id === b.hurtBy && now - b.hurtAt < 3000 ? 0.5 : 0);
      if (v > best) [best, target] = [v, id];
    }
    if (target !== b.target) b.tracked = 0;
    b.target = target;
    const low = hp < k.cover || b.reloadAt > 0 || b.ammo === 0;
    if (target) {
      if (low && b.mode !== 'cover' && now - b.searched > 1000) {
        b.searched = now;
        if (this.toCover(b, b.mem.get(target)!, now)) return;
      }
      // On its way to cover it shoots back as it goes; got there and still seen, it fights.
      if (b.mode === 'cover' && b.path.length) return;
      b.mode = 'engage';
      b.path = [];
      return;
    }
    // Nobody in sight. In cover, it waits till it's healed and reloaded.
    if (b.mode === 'cover' && now < b.until && (hp < 90 || b.ammo < RULES.mag)) {
      this.reload(b, now);
      return;
    }
    if (b.ammo < 15) this.reload(b, now);
    // Anything newer than it last went to look at: where it lost sight of someone, a shot it heard,
    // where it was shot from. It goes for a look (a peek first).
    let last: Seen | undefined;
    for (const s of b.mem.values()) if (!last || s.at > last.at) last = s;
    if (last && last.at > b.chased) {
      b.chased = last.at;
      return this.hunt(b, last, now);
    }
    if (b.mode === 'hunt' && b.path.length && now < b.until) return;
    if (b.mode !== 'roam' || !b.path.length) this.roam(b);
  }

  /** Off to where it last knew of someone: first the nearest spot that sees there (a peek), then there itself. */
  private hunt(b: Bot, s: Seen, now: number) {
    const { nav } = arenaYard();
    const here: Pt = [b.peer.x, b.peer.z];
    const spot: Pt = [s.x, s.z];
    const peek = this.vantage(here, { x: s.x, y: s.y + CHEST, z: s.z }, s.y > 2 ? 20 : 10);
    b.path = peek ? [...nav.route(here, peek).slice(1), ...nav.route(peek, spot).slice(1)] : nav.route(here, spot).slice(1);
    b.mode = 'hunt';
    b.until = now + 6000 + this.rand() * 2000;
  }

  /** Somewhere new to wander to, across the yard. */
  private roam(b: Bot) {
    const { nav, cells } = arenaYard();
    let to = cells[Math.floor(this.rand() * cells.length)];
    for (let i = 0; i < 4 && Math.hypot(to[0] - b.peer.x, to[1] - b.peer.z) < 15; i++) to = cells[Math.floor(this.rand() * cells.length)];
    b.path = nav.route([b.peer.x, b.peer.z], to).slice(1);
    b.mode = 'roam';
  }

  /** Behind the nearest cover (12 m at most) where `s` can't see it. False if there's none. */
  private toCover(b: Bot, s: Seen, now: number): boolean {
    const eye = { x: s.x, y: s.y + EYE_Y, z: s.z };
    const spot = nearest(arenaYard().cover, [b.peer.x, b.peer.z], 12, (c) => !sees(eye, { x: c[0], y: 0, z: c[1] }));
    if (!spot) return false;
    b.path = arenaYard().nav.route([b.peer.x, b.peer.z], spot).slice(1);
    b.mode = 'cover';
    b.until = now + 8000;
    return true;
  }

  /** The nearest spot to `from` (within `r` m) a bot standing there could see `at` from. */
  private vantage(from: Pt, at: V3, r: number): Pt | undefined {
    return nearest(arenaYard().cells, from, r, (c) => clear({ x: c[0], y: EYE_Y, z: c[1] }, at));
  }

  /** In a fight it strafes (or stands to shoot, if it's good), else it follows its way; it faces whoever it's after. */
  private move(b: Bot, players: ArenaPlayer[], now: number, k: BotSkill, dt: number) {
    const p = b.peer;
    const { nav } = arenaYard();
    const seen = b.target ? b.mem.get(b.target) : undefined;
    let dx = 0, dz = 0, speed = 0;
    if (b.mode === 'engage' && seen) {
      const tx = seen.x - p.x, tz = seen.z - p.z, d = Math.hypot(tx, tz) || 1;
      if (now >= b.strafeAt) {
        b.strafe = this.rand() < 0.5 ? -1 : 1;
        b.strafeAt = now + 400 + this.rand() * 800;
      }
      // Across their line, closing in from far off (where neither can hit much) and backing off from close up.
      const along = d > 25 ? 1 : d < 6 ? -1 : 0;
      dx = (-tz / d) * b.strafe + (tx / d) * along;
      dz = (tx / d) * b.strafe + (tz / d) * along;
      // A good player stands to shoot in range; from further off it keeps coming.
      speed = k.plant && b.burst > 0 && !along ? 0 : WALK;
    } else if (b.path.length) {
      dx = b.path[0][0] - p.x;
      dz = b.path[0][1] - p.z;
      speed = RUN;
    }
    const len = Math.hypot(dx, dz);
    let moved = false;
    if (speed > 0 && len > 1e-6) {
      const step = Math.min(speed * dt, b.mode === 'engage' ? Infinity : len);
      const x = p.x + (dx / len) * step, z = p.z + (dz / len) * step;
      if (nav.walkable(x, z)) {
        p.x = x;
        p.z = z;
        moved = step > 0;
      } else if (b.mode === 'engage') {
        b.strafe = -b.strafe;
        b.strafeAt = now + 600;
      } else b.path = nav.route([p.x, p.z], b.path.at(-1)!).slice(1);
    }
    if (b.path.length && Math.hypot(b.path[0][0] - p.x, b.path[0][1] - p.z) < 0.05) b.path.shift();
    // Out of anyone's way, without stepping into cover.
    for (const o of players) {
      const at = o.id !== p.id && o.alive ? this.where(o.id) : undefined;
      const d = at ? Math.hypot(p.x - at.x, p.z - at.z) : Infinity;
      if (!at || d >= 0.8 || d < 1e-6) continue;
      const x = p.x + ((p.x - at.x) / d) * (0.8 - d) * 0.5, z = p.z + ((p.z - at.z) / d) * (0.8 - d) * 0.5;
      if (nav.walkable(x, z)) [p.x, p.z] = [x, z];
    }
    // Facing: whoever it's fighting; else somewhere it just heard or was shot from; else the way it's going.
    let face: number | undefined;
    if (seen?.eyes) face = Math.atan2(seen.x - p.x, seen.z - p.z);
    else {
      let last: Seen | undefined;
      for (const s of b.mem.values()) if (now - s.at < 2500 && (!last || s.at > last.at)) last = s;
      if (last) face = Math.atan2(last.x - p.x, last.z - p.z);
      else if (moved) face = Math.atan2(dx, dz);
    }
    if (face !== undefined) {
      const turn = k.turn * dt;
      p.rotY = angle(p.rotY + Math.max(-turn, Math.min(turn, angle(face - p.rotY))));
    }
    p.moving = moved;
  }

  /** Fires at its target once it's had time to react and is facing them, in bursts, with its level's aim. */
  private fire(b: Bot, now: number, k: BotSkill, dt: number) {
    b.bloom = Math.max(0, b.bloom - CONE.recover * dt);
    b.kick *= Math.exp(-KICK.settle * dt);
    const s = b.target ? b.mem.get(b.target) : undefined;
    if (!s?.eyes) return;
    const p = b.peer;
    b.tracked += dt;
    // A strafe the other way throws its aim off again, as it would anyone's.
    const side = Math.sign(s.vx * (s.z - p.z) - s.vz * (s.x - p.x));
    if (side && side === -b.side) b.tracked /= 2;
    if (side) b.side = side;
    if (now < s.ready || b.reloadAt || now < b.nextShot) return;
    if (b.ammo <= 0) return this.reload(b, now);
    const eye = { x: p.x, y: p.y + EYE_Y, z: p.z };
    // Stepped out of sight of them since it looked, or someone else just killed them: it holds its fire.
    const at = this.where(b.target!);
    if (!at || this.downed.has(b.target!) || !sees(eye, at)) return;
    // Where they were a moment ago: its eyes trail them.
    const ax = s.x - s.vx * k.trail, az = s.z - s.vz * k.trail;
    const h = Math.hypot(ax - eye.x, az - eye.z);
    let yaw = Math.atan2(ax - eye.x, az - eye.z);
    if (Math.abs(angle(yaw - p.rotY)) > 0.15) return; // still turning onto them
    if (!b.burst) b.burst = k.burst[0] + Math.floor(this.rand() * (k.burst[1] - k.burst[0] + 1));
    let pitch = Math.atan2(s.y + (this.rand() < k.head ? HEAD : CHEST) - eye.y, h);
    // Its own error, settling the longer it tracks them, and the kick it hasn't pulled back down.
    const sigma = k.sigmaMin + (k.sigma0 - k.sigmaMin) * Math.exp(-b.tracked / k.tau);
    yaw += this.gauss() * sigma;
    pitch += this.gauss() * sigma + b.kick;
    // Then the rifle's cone, as anyone's: wider on the move and as it heats up, tight down the sights standing still.
    const cone = (CONE.hip + (p.moving ? CONE.move : 0) + b.bloom) * (!p.moving && h > 12 ? CONE.ads : 1);
    const a = this.rand() * Math.PI * 2, r = Math.sqrt(this.rand()) * cone;
    yaw += Math.cos(a) * r;
    pitch += Math.sin(a) * r;
    const d = { x: Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: Math.cos(yaw) * Math.cos(pitch) };
    b.nextShot = now + RULES.every;
    const shot = this.io.shoot(p.id, eye, d, now);
    if (!shot) return;
    if (shot.kill && shot.hit) this.downed.add(shot.hit);
    b.ammo--;
    b.bloom = Math.min(CONE.maxBloom, b.bloom + CONE.perShot);
    b.kick += KICK.up * (1 - k.recoil);
    if (--b.burst <= 0) {
      b.burst = 0;
      b.nextShot = now + k.pause[0] + this.rand() * (k.pause[1] - k.pause[0]);
    }
  }

  private reload(b: Bot, now: number) {
    if (!b.reloadAt && b.ammo < RULES.mag && this.arena.reload(b.peer.id, now)) b.reloadAt = now + RULES.reload;
  }

  /** A normally distributed number (mean 0, deviation 1). */
  private gauss(): number {
    return Math.sqrt(-2 * Math.log(1 - this.rand())) * Math.cos(2 * Math.PI * this.rand());
  }
}
