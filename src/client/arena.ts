import * as THREE from 'three';
import { ARENA, KICK, PRACTICE_TARGETS, RULES, SPREAD, nextShot, spreadOf, targetAt, type ShotResult, type V3 } from '../shared/arena';
import type { ClientMsg } from '../shared/protocol';
import type { PlayerController } from './player';
import type { OfficeSound } from './sound';
import { store } from './state';
import { ArenaHUD } from './ui/arena';
import { SIGHT_Y, rifle, type ArenaWorld } from './world/arena';
import type { Person } from './world/character';
import type { Hands } from './world/hands';
import { mesh, toon } from './world/toon';

// Playing in the arena (shared/arena.ts): your rifle in first person, held down to fire (the office
// judges what each shot hits: server/arena.ts), the right button to aim down the sights, R to
// reload, C to crouch (and slide, from a run), Space at a ledge to climb up, Tab for the scoreboard.
// Shots kick the view up and spread wider the faster you move, in the air, firing on. Killed, you
// watch whoever did it until the office puts you back in. Everyone else holds their rifle where they
// look, crouches, flashes when hit and falls when killed. main.ts wires it in.

export interface ArenaWiring {
  send(msg: ClientMsg): void;
  player: PlayerController;
  camera: THREE.PerspectiveCamera;
  hands: Hands;
  sound: OfficeSound;
  world(): ArenaWorld;
  /** Puts you at a spot (back in after being killed). */
  placeAt(at: { x: number; y: number; z: number; rotY: number }): void;
  /** Whether the pointer's locked to the view (you're playing, not clicking round the page). */
  locked(): boolean;
}

/**
 * Something that just happened to you in the arena, as it happens: on `window` as an 'arena' event
 * (a CustomEvent, this in its `detail`), for the HUD to show (damage numbers and the like) and for
 * tests to watch.
 * - `hit`: you hit someone (`victim`, their peer id) or a practice `target` (its index): `dmg` taken
 *   off, `hp` they have left, in the `head` or not, and whether that was a `kill`.
 * - `shielded`: you hit `victim` while they were still safe, just back in: no harm done.
 * - `hurt`: you were hit, `dmg` by `by`, from `angle` (radians from where you look, + to the right), with `hp` left.
 * - `died`: killed by `by` (`name`), who has `hp` left.
 */
export type ArenaEvent =
  | { t: 'hit'; victim?: string; target?: number; dmg: number; hp: number; head: boolean; kill: boolean }
  | { t: 'shielded'; victim: string }
  | { t: 'hurt'; by: string; dmg: number; hp: number; head: boolean; angle: number }
  | { t: 'died'; by: string; name: string; hp: number };

/** The view's width (degrees) aiming down the sights, and watching whoever killed you. */
const ADS_FOV = 48;
const DEAD_FOV = 40;
/** Where the rifle sits in front of you, from the hip and aiming down its sights (the sight's dot on the middle of the view). */
const HIP = new THREE.Vector3(0.17, -0.2, -0.52);
/** The rifle's size in your hands. */
const GUN_SCALE = 0.75;
// Close to the eye, as a cheek on the stock: the stock and the back of the rifle drop out of the bottom of the view.
const ADS = new THREE.Vector3(0, -SIGHT_Y * GUN_SCALE, -0.25);
/** The fastest you go (m/s) aiming down the sights, and firing from the hip: no running with the trigger down. */
const PACE = { ads: 2.8, firing: 4.6 };
/** Someone killed falls over in this long (s), and is gone from sight this long after (s), till they're back in. */
const FALL = 0.45;
const GONE = 2.4;
/** The rifle in everyone else's hands, a touch bigger than yours. */
const HELD_SCALE = 1.1;

const v = new THREE.Vector3();
const dir = new THREE.Vector3();
const eye = new THREE.Vector3();
const right = new THREE.Vector3();
const upAxis = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** A muzzle flash: a little four-pointed star of light, its own material so it can be shown and hidden on its own. */
function muzzleFlash(size: number): THREE.Mesh {
  const star = new THREE.Shape();
  for (let i = 0; i < 8; i++) {
    const r = (i % 2 ? 0.12 : 0.5) * size, a = (i * Math.PI) / 4;
    if (i) star.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    else star.moveTo(r, 0);
  }
  const m = new THREE.Mesh(
    new THREE.ShapeGeometry(star),
    new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
  );
  m.visible = false;
  return m;
}

/** A practice target: a cardboard figure on a sliding base, shaped as the office judges a person (shared/arena.ts rayPerson). */
function dummy(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.5, 0.55, 0.06, 18), toon('#3d4147'), 0, 0.03, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.4, 0.42, 1.0, 18), toon('#c9a26b'), 0, 0.5, 0));
  for (const [y, color] of [[0.55, '#d64545'], [0.75, '#f4f1ea']] as const) {
    g.add(mesh(new THREE.TorusGeometry(0.425, 0.028, 6, 24).rotateX(Math.PI / 2), toon(color), 0, y, 0, false));
  }
  g.add(mesh(new THREE.SphereGeometry(0.34, 18, 14), toon('#d8b98a'), 0, 1.32, 0));
  return g;
}

export class ArenaPlay {
  readonly hud = new ArenaHUD();
  /** Your shots this visit, and what they did: for accuracy and headshots on a results screen. */
  readonly stats = { shots: 0, hits: 0, heads: 0, kills: 0, damage: 0 };
  private gun = rifle();
  private flash = muzzleFlash(0.24);
  private active = false;
  private firing = false;
  private aiming = false;
  private adsK = 0;
  private ammo: number = RULES.mag;
  private reloadAt = 0;
  private nextShot = 0;
  private bloom = 0;
  private kick = 0;
  private recoilZ = 0;
  private flashT = 0;
  /** How fast you're going over the ground (m/s), smoothed: what spreads your shots. */
  private speed = 0;
  private last = new THREE.Vector3();
  /** Who killed you (their id and name), and 0 → 1 as the view closes in on them, while you're dead. */
  private killer: string | undefined;
  private killedBy: string | undefined;
  private deadK = 0;
  /** The view you had before the arena put you in first person, to go back to. */
  private viewWas: ReturnType<() => PlayerController['view']> | null = null;
  /** Kills in quick succession, for the medals. */
  private recent: number[] = [];
  /** Guns in everyone else's hands, by peer id, with their muzzles and flashes. */
  private held = new Map<string, { group: THREE.Group; muzzle: THREE.Object3D; flash: THREE.Mesh; flashT: number }>();
  /** When each of the others was killed (performance.now), while they're down. */
  private down = new Map<string, number>();
  /** Those who've fired since they came back in: no longer safe, whatever the office said last. */
  private unsafe = new Set<string>();
  /** A faint bubble round each of the others while they're safe, just back in. */
  private shells = new Map<string, THREE.Mesh>();
  private shellGeo = new THREE.SphereGeometry(0.95, 18, 12);
  private shellMat = new THREE.MeshBasicMaterial({ color: '#6ec6ff', transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending });
  /** The practice targets, built the first time there's warm-up to show them in, and how far each has fallen (0 → 1). */
  private targets: { root: THREE.Group; fall: number }[] = [];

  constructor(private w: ArenaWiring) {
    this.gun.group.visible = false;
    this.gun.group.scale.setScalar(GUN_SCALE);
    w.hands.scene.add(this.gun.group);
    this.gun.muzzle.add(this.flash);
    window.addEventListener('mousedown', (e) => this.mouse(e, true), true);
    window.addEventListener('mouseup', (e) => this.mouse(e, false), true);
    window.addEventListener('contextmenu', (e) => this.active && w.locked() && e.preventDefault());
    window.addEventListener('blur', () => {
      this.firing = false;
      this.aiming = false;
      this.hud.scoreboard(false);
    });
  }

  /** You're in the arena (or not): the rifle in your hands, first person, the arena's moves, and the HUD. */
  setActive(on: boolean) {
    if (on === this.active) return;
    this.active = on;
    this.firing = this.aiming = false;
    this.adsK = this.kick = this.recoilZ = this.bloom = this.deadK = 0;
    this.gun.group.visible = on;
    const p = this.w.player;
    this.w.hands.gunPose = on ? { right: new THREE.Vector3(), left: new THREE.Vector3() } : null;
    this.w.hands.scene.visible = true;
    p.arena = on;
    p.speedCap = Infinity;
    this.hud.show(on);
    this.hud.scoreboard(false);
    if (on) {
      this.ammo = RULES.mag;
      this.reloadAt = 0;
      this.killer = this.killedBy = undefined;
      Object.assign(this.stats, { shots: 0, hits: 0, heads: 0, kills: 0, damage: 0 });
      this.viewWas = p.view;
      p.setView('first');
      this.last.copy(p.pos);
    } else {
      for (const id of [...this.held.keys()]) this.putAway(id);
      for (const t of this.targets) t.root.visible = false;
      if (!p.enabled && this.killer !== undefined) p.enabled = true;
      this.killer = this.killedBy = undefined;
      if (this.viewWas) p.setView(this.viewWas);
      this.viewWas = null;
    }
  }

  get on(): boolean {
    return this.active;
  }

  /** Whether you're alive in there, as the office has it. */
  private alive(): boolean {
    return store.arena.players.find((p) => p.id === store.you)?.alive ?? true;
  }

  private mouse(e: MouseEvent, down: boolean) {
    if (!this.active) return;
    if (!down || this.w.locked()) {
      if (e.button === 0) this.firing = down;
      if (e.button === 2) this.aiming = down;
    }
  }

  /** The arena's keys: R reloads, Tab holds up the scoreboard, C crouches (player.ts reads it). True if it was one of them. */
  key(e: KeyboardEvent, down: boolean): boolean {
    if (!this.active) return false;
    if (e.code === 'Tab') {
      e.preventDefault();
      this.hud.scoreboard(down);
      return true;
    }
    if (e.code === 'KeyR' && down) {
      this.reload();
      return true;
    }
    return e.code === 'KeyC';
  }

  private reload() {
    if (this.reloadAt || this.ammo >= RULES.mag || !this.alive()) return;
    this.reloadAt = performance.now() + RULES.reload;
    this.w.send({ t: 'arena.reload' });
    this.w.sound.gun('reload');
  }

  /** The view's width: narrower aiming down the sights, and closing in on whoever killed you. */
  fov(base: number): number {
    if (!this.active) return base;
    const ads = base + (ADS_FOV - base) * this.adsK;
    return ads + (DEAD_FOV - ads) * this.deadK;
  }

  /** Each frame in the arena. */
  update(dt: number, t: number) {
    if (!this.active) return;
    const now = performance.now();
    const p = this.w.player;
    const alive = this.alive();
    // Back in some way other than arena.spawn (a reconnect while dead): on your feet again.
    if (alive && this.killer !== undefined) this.revive();
    if (this.reloadAt && now >= this.reloadAt) {
      this.reloadAt = 0;
      this.ammo = RULES.mag;
    }
    this.adsK += ((this.aiming && alive && !this.reloadAt && !p.climbing ? 1 : 0) - this.adsK) * Math.min(1, dt * 14);
    this.bloom = Math.max(0, this.bloom - dt * SPREAD.settle);
    // How fast you're going, over the ground: walking spreads shots less than running.
    if (dt > 0) this.speed += (Math.hypot(p.pos.x - this.last.x, p.pos.z - this.last.z) / dt - this.speed) * Math.min(1, dt * 12);
    this.last.copy(p.pos);
    // Down the sights you creep; with the trigger down you walk.
    p.speedCap = !alive ? Infinity : this.adsK > 0.5 ? PACE.ads : this.firing ? PACE.firing : Infinity;
    // The kick comes back down.
    const back = this.kick * Math.min(1, dt * KICK.settle);
    this.kick -= back;
    p.lookPitch -= back;
    this.recoilZ += (0 - this.recoilZ) * Math.min(1, dt * 18);

    if (this.firing && alive && this.w.locked() && !p.climbing) {
      if (this.reloadAt) {
        /* Reloading: wait. */
      } else if (this.ammo <= 0) {
        if (now >= this.nextShot) {
          this.w.sound.gun('empty');
          this.nextShot = now + 250;
          this.reload();
        }
      } else if (now >= this.nextShot) this.fire(now);
    }

    // The rifle: at the hip or up at your eye, bobbing as you walk, kicking back as it fires.
    const g = this.gun.group;
    v.copy(HIP).lerp(ADS, this.adsK);
    const bob = p.moving && p.grounded ? 1 - this.adsK * 0.8 : 0;
    v.x += Math.sin(p.walkPhase) * 0.008 * bob;
    v.y += Math.abs(Math.cos(p.walkPhase)) * 0.008 * bob + (p.grounded ? 0 : 0.02);
    v.z += this.recoilZ;
    // Lowered while reloading, and while you climb.
    const r = this.reloadAt ? Math.sin(Math.min(1, 1 - (this.reloadAt - now) / RULES.reload) * Math.PI) : p.climbing ? 0.6 : 0;
    v.y -= r * 0.12;
    g.position.copy(v);
    g.rotation.set(r * 0.6 + this.recoilZ * 1.5, 0, r * 0.3);
    // Hands on it: the right at the grip, the left under the handguard.
    const pose = this.w.hands.gunPose;
    if (pose) {
      pose.right.set(0.0, -0.09, 0.03).multiplyScalar(GUN_SCALE).applyEuler(g.rotation).add(g.position);
      pose.left.set(0.0, -0.03, -0.4).multiplyScalar(GUN_SCALE).applyEuler(g.rotation).add(g.position);
    }
    // Dead, nothing in your hands at all.
    g.visible = alive;
    this.w.hands.scene.visible = alive;
    this.flashT -= dt;
    this.flash.visible = this.flashT > 0;
    if (this.flash.visible) this.flash.rotation.z = t * 40;
    this.deathCam(dt, alive);

    const me = store.arena.players.find((x) => x.id === store.you);
    const killer = this.killer === undefined ? undefined : store.arena.players.find((x) => x.id === this.killer);
    this.hud.render({
      you: store.you,
      state: store.arena,
      now: store.officeNow(),
      ammo: this.ammo,
      mag: RULES.mag,
      reloading: this.reloadAt ? Math.min(1, 1 - (this.reloadAt - now) / RULES.reload) : null,
      hp: me?.hp ?? RULES.hp,
      spread: 10 + this.spread() * 900,
      ads: this.adsK > 0.6,
      ...(this.killedBy !== undefined && !alive ? { killedBy: this.killedBy, ...(killer ? { killerHp: killer.hp } : {}) } : {}),
    });
    // Everyone else: their rifles, how they hold them, crouching, falling, safe; and the practice targets.
    this.others(dt, now, t);
    this.practice(dt);
  }

  /** How wide your next shot goes (radians), going as you are. */
  private spread(): number {
    const p = this.w.player;
    return spreadOf(this.speed, p.grounded, this.adsK, this.bloom, p.crouching);
  }

  private fire(now: number) {
    const p = this.w.player;
    this.nextShot = nextShot(this.nextShot, now);
    this.ammo--;
    this.stats.shots++;
    const s = this.spread();
    this.w.camera.getWorldPosition(eye);
    this.w.camera.getWorldDirection(dir);
    // A random point in a cone round where you're looking.
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * s;
    right.crossVectors(dir, UP).normalize();
    upAxis.crossVectors(right, dir).normalize();
    dir.addScaledVector(right, Math.cos(a) * r).addScaledVector(upAxis, Math.sin(a) * r).normalize();
    const o: V3 = { x: eye.x, y: eye.y, z: eye.z };
    this.w.send({ t: 'arena.fire', o, d: { x: dir.x, y: dir.y, z: dir.z } });
    this.bloom = Math.min(SPREAD.maxBloom, this.bloom + SPREAD.perShot);
    const kick = KICK.up * (1 - this.adsK * 0.4) * (p.crouching ? 0.75 : 1);
    p.lookPitch += kick;
    this.kick += kick * 0.7;
    p.camYaw += (Math.random() - 0.5) * KICK.side;
    this.recoilZ = 0.05 * (1 - this.adsK * 0.5);
    this.flashT = 0.04;
    this.w.sound.gun('shot');
  }

  /** Where your rifle's muzzle is, out in the world. */
  private muzzle(): V3 {
    this.gun.muzzle.getWorldPosition(v);
    // The muzzle's in the hands' own little scene, in the camera's frame: into the world's.
    v.applyMatrix4(this.w.camera.matrixWorld);
    return { x: v.x, y: v.y, z: v.z };
  }

  /** A shot somebody fired, the office's account of it: the streak, the sound, the puff, and what it did. */
  shot(m: { by: string; o: V3 } & ShotResult) {
    if (!this.active) return;
    const mine = m.by === store.you;
    const theirs = this.held.get(m.by);
    // The streak starts from the gun's muzzle: yours in your hands, theirs in theirs.
    let o = m.o;
    if (mine) o = this.muzzle();
    else if (theirs) {
      theirs.muzzle.getWorldPosition(v);
      o = { x: v.x, y: v.y, z: v.z };
      theirs.flashT = 0.05;
    }
    const struck = m.hit !== undefined || m.target !== undefined;
    this.w.world().shot(o, m.end, m.shield ? 'shield' : struck ? (m.head ? 'head' : 'body') : undefined);
    if (!mine) {
      this.w.sound.gun('shot', m.o);
      this.unsafe.add(m.by);
    }
    // Their health as the office has it now, not at its next word.
    const victim = m.hit === undefined ? undefined : store.arena.players.find((p) => p.id === m.hit);
    if (victim && m.hp !== undefined) victim.hp = m.hp;
    if (m.hit && m.hit !== store.you) this.person(m.hit)?.flash();
    if (mine && struck) {
      const kind = m.kill ? 'kill' : m.head ? 'head' : 'hit';
      this.hud.hitmarker(kind);
      this.w.sound.gun(kind);
      this.stats.hits++;
      if (m.head) this.stats.heads++;
      this.stats.damage += m.dmg ?? 0;
      if (m.kill && m.hit) {
        this.stats.kills++;
        this.medals(!!m.head, m.streak ?? 0);
      }
      this.event({ t: 'hit', ...(m.hit ? { victim: m.hit } : { target: m.target }), dmg: m.dmg ?? 0, hp: m.hp ?? 0, head: !!m.head, kill: !!m.kill });
    }
    if (mine && m.shield) this.event({ t: 'shielded', victim: m.shield });
    if (m.kill && m.hit && m.hit !== store.you) this.fell(m.hit, m.o);
    if (m.hit === store.you) {
      this.w.sound.gun('hurt');
      // Which way it came from, against where you're looking (+ to the right).
      const from = Math.atan2(m.o.x - this.w.player.pos.x, m.o.z - this.w.player.pos.z);
      const look = this.w.player.camYaw + Math.PI;
      const angle = Math.atan2(Math.sin(look - from), Math.cos(look - from));
      this.hud.hurt(angle);
      this.event({ t: 'hurt', by: m.by, dmg: m.dmg ?? 0, hp: m.hp ?? 0, head: !!m.head, angle });
      if (m.kill) this.died(m.by);
    }
  }

  private event(e: ArenaEvent) {
    window.dispatchEvent(new CustomEvent<ArenaEvent>('arena', { detail: e }));
  }

  /** A word or two for a kill of yours: a multi-kill, a headshot, and every fifth in a row (`streak`, counting this one). */
  private medals(head: boolean, streak: number) {
    const now = performance.now();
    this.recent = this.recent.filter((t) => now - t < 4000);
    this.recent.push(now);
    const n = this.recent.length;
    this.hud.medal(n >= 3 ? 'TRIPLE KILL' : n === 2 ? 'DOUBLE KILL' : head ? 'HEADSHOT' : '+1 KILL');
    if (streak > 0 && streak % 5 === 0) this.hud.medal(`${streak} KILL STREAK`);
  }

  private died(by: string) {
    this.killer = by;
    this.killedBy = store.peers.get(by)?.name ?? 'someone';
    this.firing = this.aiming = false;
    this.reloadAt = 0;
    const p = this.w.player;
    p.enabled = false;
    p.clearKeys();
    const killer = store.arena.players.find((x) => x.id === by);
    this.event({ t: 'died', by, name: this.killedBy, hp: killer?.hp ?? 0 });
  }

  /** On your feet again, the view your own. */
  private revive() {
    this.killer = this.killedBy = undefined;
    this.w.player.enabled = true;
  }

  /** Dead: the view turns to whoever killed you and closes in on them, till you're back in. */
  private deathCam(dt: number, alive: boolean) {
    this.deadK += ((!alive && this.killer !== undefined ? 1 : 0) - this.deadK) * Math.min(1, dt * 3);
    const them = !alive && this.killer !== undefined ? this.person(this.killer)?.root : undefined;
    if (!them) return;
    const p = this.w.player;
    this.w.camera.getWorldPosition(eye);
    const dx = them.position.x - eye.x, dz = them.position.z - eye.z;
    const yaw = Math.atan2(-dx, -dz);
    const pitch = Math.atan2(them.position.y + 1.2 - eye.y, Math.hypot(dx, dz));
    const k = Math.min(1, dt * 4);
    p.camYaw += Math.atan2(Math.sin(yaw - p.camYaw), Math.cos(yaw - p.camYaw)) * k;
    p.lookPitch += (pitch - p.lookPitch) * k;
  }

  /** The office has you back in, here. */
  spawned(at: { x: number; z: number; rotY: number }) {
    if (!this.active) return;
    this.revive();
    this.ammo = RULES.mag;
    this.reloadAt = 0;
    this.nextShot = 0;
    this.w.placeAt({ x: at.x, y: 0, z: at.z, rotY: at.rotY });
    this.last.copy(this.w.player.pos);
  }

  /** Remote people's characters, by peer id (main.ts's). */
  private person: (id: string) => Person | undefined = () => undefined;
  setPeople(people: (id: string) => Person | undefined) {
    this.person = people;
  }

  /** Someone else killed, by a shot from `from`: over they go, away from it. */
  private fell(id: string, from: V3) {
    const them = this.person(id);
    if (!them) return;
    this.down.set(id, performance.now());
    const r = them.root;
    them.fallDir = Math.sin(r.rotation.y) * (from.x - r.position.x) + Math.cos(r.rotation.y) * (from.z - r.position.z) >= 0 ? 1 : -1;
  }

  /** Everyone else in the arena: a rifle in their hands where they look, crouching, safe or not, falling when they're killed. */
  private others(dt: number, now: number, t: number) {
    const players = store.arena.players;
    const officeNow = store.officeNow();
    for (const pl of players) {
      if (pl.id === store.you) continue;
      const them = this.person(pl.id);
      if (!them) continue;
      const peer = store.peers.get(pl.id);
      let held = this.held.get(pl.id);
      if (!held) {
        const gun = rifle();
        gun.group.scale.setScalar(HELD_SCALE);
        const flash = muzzleFlash(0.3);
        gun.muzzle.add(flash);
        held = { group: gun.group, muzzle: gun.muzzle, flash, flashT: 0 };
        this.held.set(pl.id, held);
      }
      them.holdRifle(held.group);
      // Killed, they let go of it.
      held.group.visible = pl.alive;
      held.flashT -= dt;
      held.flash.visible = held.flashT > 0;
      if (held.flash.visible) held.flash.rotation.z = t * 40;
      const ease = Math.min(1, dt * 12);
      them.aimPitch += ((peer?.pitch ?? 0) - them.aimPitch) * ease;
      them.crouchK += ((peer?.crouch ? 1 : 0) - them.crouchK) * ease;
      // Killed: over they go, and a moment later out of sight till they're back in.
      if (pl.alive) {
        this.down.delete(pl.id);
        them.fallen = 0;
        them.root.visible = true;
      } else {
        if (!this.down.has(pl.id)) this.down.set(pl.id, now);
        const since = (now - this.down.get(pl.id)!) / 1000;
        them.fallen = Math.min(1, since / FALL);
        them.root.visible = since < GONE;
      }
      if (pl.alive && (pl.safeUntil ?? 0) < officeNow) this.unsafe.delete(pl.id);
      const safe = pl.alive && (pl.safeUntil ?? 0) > officeNow && !this.unsafe.has(pl.id);
      let shell = this.shells.get(pl.id);
      if (safe && !shell) {
        shell = new THREE.Mesh(this.shellGeo, this.shellMat);
        shell.position.y = 0.95;
        shell.scale.y = 1.05;
        this.shells.set(pl.id, shell);
      }
      if (shell) {
        if (shell.parent !== them.root) them.root.add(shell);
        shell.visible = safe;
      }
    }
    for (const id of [...this.held.keys()]) if (!players.some((p) => p.id === id)) this.putAway(id);
  }

  /** `id` is out of the arena (or you are): their rifle away, on their feet, no bubble. */
  private putAway(id: string) {
    const them = this.person(id);
    if (them) {
      them.holdRifle(null);
      them.fallen = them.crouchK = them.aimPitch = 0;
      them.root.visible = true;
    }
    this.shells.get(id)?.removeFromParent();
    this.shells.delete(id);
    this.held.delete(id);
    this.down.delete(id);
    this.unsafe.delete(id);
  }

  /** The practice targets, in warm-up: sliding along their lanes as the office's clock has them, falling when shot down. */
  private practice(dt: number) {
    const up = store.arena.targets;
    if (!up && !this.targets.length) return;
    if (!this.targets.length) {
      const group = this.w.world().group;
      for (let i = 0; i < PRACTICE_TARGETS; i++) {
        const root = dummy();
        group.add(root);
        this.targets.push({ root, fall: 0 });
      }
    }
    const now = store.officeNow();
    this.targets.forEach((tg, i) => {
      tg.root.visible = !!up;
      if (!up) return;
      const at = targetAt(i, now);
      tg.root.position.set(at.x, at.y, at.z);
      tg.fall += ((up[i] ? 1 : 0) - tg.fall) * Math.min(1, dt * (up[i] ? 9 : 5));
      tg.root.rotation.x = -tg.fall * Math.PI * 0.48;
    });
  }
}

/** Whether you're in the arena. */
export function inArena(): boolean {
  return store.floor === ARENA;
}
