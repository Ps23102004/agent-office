import * as THREE from 'three';
import { ARENA, RULES, type V3 } from '../shared/arena';
import type { ClientMsg } from '../shared/protocol';
import type { PlayerController } from './player';
import type { OfficeSound } from './sound';
import { store } from './state';
import { ArenaHUD } from './ui/arena';
import { rifle, type ArenaWorld } from './world/arena';
import type { Hands } from './world/hands';

// Playing in the arena (shared/arena.ts): your rifle in first person, held down to fire (the office
// judges what each shot hits: server/arena.ts), the right button to aim down the sights, R to
// reload, Tab for the scoreboard. Shots kick the view up and spread wider moving or in the air.
// Killed, you watch the count down until the office puts you back in. main.ts wires it in.

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

/** How wide shots go (radians): standing still from the hip, and what moving, being in the air and aiming down the sights do to it. */
const SPREAD = { hip: 0.012, move: 0.02, air: 0.045, ads: 0.15, perShot: 0.006, maxBloom: 0.03 };
/** How far each shot kicks the view up (radians), and how quickly it settles. */
const KICK = { up: 0.012, side: 0.004, settle: 9 };
/** The view's width (degrees) aiming down the sights. */
const ADS_FOV = 48;
/** Where the rifle sits in front of you, from the hip and aiming down its sights. */
const HIP = new THREE.Vector3(0.17, -0.2, -0.52);
const ADS = new THREE.Vector3(0, -0.112, -0.38);
/** The rifle's size in your hands. */
const GUN_SCALE = 0.75;

const v = new THREE.Vector3();
const dir = new THREE.Vector3();
const eye = new THREE.Vector3();

export class ArenaPlay {
  readonly hud = new ArenaHUD();
  private gun = rifle();
  private flash: THREE.Mesh;
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
  private killedBy: string | undefined;
  /** The view you had before the arena put you in first person, to go back to. */
  private viewWas: ReturnType<() => PlayerController['view']> | null = null;
  /** Kills in quick succession, for the medals. */
  private recent: number[] = [];
  /** Guns in everyone else's hands, by peer id. */
  private held = new Map<string, THREE.Group>();

  constructor(private w: ArenaWiring) {
    this.gun.group.visible = false;
    this.gun.group.scale.setScalar(GUN_SCALE);
    w.hands.scene.add(this.gun.group);
    this.flash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.16, 0.16),
      new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    this.flash.visible = false;
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

  /** You're in the arena (or not): the rifle in your hands, first person, and the HUD. */
  setActive(on: boolean) {
    if (on === this.active) return;
    this.active = on;
    this.firing = this.aiming = false;
    this.adsK = this.kick = this.recoilZ = this.bloom = 0;
    this.gun.group.visible = on;
    this.w.hands.gunPose = on ? { right: new THREE.Vector3(), left: new THREE.Vector3() } : null;
    this.hud.show(on);
    this.hud.scoreboard(false);
    if (on) {
      this.ammo = RULES.mag;
      this.reloadAt = 0;
      this.killedBy = undefined;
      this.viewWas = this.w.player.view;
      this.w.player.setView('first');
    } else {
      for (const g of this.held.values()) g.removeFromParent();
      this.held.clear();
      if (!this.w.player.enabled && this.killedBy !== undefined) this.w.player.enabled = true;
      this.killedBy = undefined;
      if (this.viewWas) this.w.player.setView(this.viewWas);
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

  /** The arena's keys: R reloads, Tab holds up the scoreboard. True if it was one of them. */
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
    return false;
  }

  private reload() {
    if (this.reloadAt || this.ammo >= RULES.mag || !this.alive()) return;
    this.reloadAt = performance.now() + RULES.reload;
    this.w.send({ t: 'arena.reload' });
    this.w.sound.gun('reload');
  }

  /** The view's width for aiming down the sights, blended in; null to leave it alone. */
  fov(base: number): number {
    if (!this.active) return base;
    return base + (ADS_FOV - base) * this.adsK;
  }

  /** Each frame in the arena. */
  update(dt: number, t: number) {
    if (!this.active) return;
    const now = performance.now();
    const p = this.w.player;
    const alive = this.alive();
    // Back in some way other than arena.spawn (a reconnect while dead): on your feet again.
    if (alive && this.killedBy !== undefined) {
      this.killedBy = undefined;
      p.enabled = true;
    }
    if (this.reloadAt && now >= this.reloadAt) {
      this.reloadAt = 0;
      this.ammo = RULES.mag;
    }
    this.adsK += ((this.aiming && alive && !this.reloadAt ? 1 : 0) - this.adsK) * Math.min(1, dt * 14);
    this.bloom = Math.max(0, this.bloom - dt * 0.08);
    // The kick comes back down.
    const back = this.kick * Math.min(1, dt * KICK.settle);
    this.kick -= back;
    p.lookPitch -= back;
    this.recoilZ += (0 - this.recoilZ) * Math.min(1, dt * 18);

    if (this.firing && alive && this.w.locked()) {
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
    // Lowered while reloading.
    const r = this.reloadAt ? Math.sin(Math.min(1, 1 - (this.reloadAt - now) / RULES.reload) * Math.PI) : 0;
    v.y -= r * 0.12;
    g.position.copy(v);
    g.rotation.set(r * 0.6 + this.recoilZ * 1.5, 0, r * 0.3);
    // Hands on it: the right at the grip, the left under the handguard.
    const pose = this.w.hands.gunPose;
    if (pose) {
      pose.right.set(0.0, -0.09, 0.03).multiplyScalar(GUN_SCALE).applyEuler(g.rotation).add(g.position);
      pose.left.set(0.0, -0.03, -0.4).multiplyScalar(GUN_SCALE).applyEuler(g.rotation).add(g.position);
    }
    g.visible = alive;
    this.flashT -= dt;
    this.flash.visible = this.flashT > 0;
    if (this.flash.visible) this.flash.rotation.z = t * 40;

    const me = store.arena.players.find((x) => x.id === store.you);
    const speed = p.moving ? 1 : 0;
    const spread = this.spread(speed, p.grounded);
    this.hud.render({
      you: store.you,
      state: store.arena,
      now: store.officeNow(),
      ammo: this.ammo,
      mag: RULES.mag,
      reloading: this.reloadAt ? Math.min(1, 1 - (this.reloadAt - now) / RULES.reload) : null,
      hp: me?.hp ?? RULES.hp,
      spread: 10 + spread * 900,
      ads: this.adsK > 0.6,
      ...(this.killedBy !== undefined && !alive ? { killedBy: this.killedBy } : {}),
    });
    // Everyone else's rifles, in their hands; the dead out of sight.
    this.others();
  }

  private spread(moving: number, grounded: boolean): number {
    const base = SPREAD.hip + moving * SPREAD.move + (grounded ? 0 : SPREAD.air) + this.bloom;
    return base * (1 - this.adsK * (1 - SPREAD.ads));
  }

  private fire(now: number) {
    const p = this.w.player;
    this.nextShot = now + RULES.every;
    this.ammo--;
    const s = this.spread(p.moving ? 1 : 0, p.grounded);
    this.w.camera.getWorldPosition(eye);
    this.w.camera.getWorldDirection(dir);
    // A random point in a cone round where you're looking.
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * s;
    const up = v.set(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(dir, up).normalize();
    const upAxis = new THREE.Vector3().crossVectors(right, dir).normalize();
    dir.addScaledVector(right, Math.cos(a) * r).addScaledVector(upAxis, Math.sin(a) * r).normalize();
    const o: V3 = { x: eye.x, y: eye.y, z: eye.z };
    this.w.send({ t: 'arena.fire', o, d: { x: dir.x, y: dir.y, z: dir.z } });
    this.bloom = Math.min(SPREAD.maxBloom, this.bloom + SPREAD.perShot);
    const kick = KICK.up * (1 - this.adsK * 0.4);
    p.lookPitch += kick;
    this.kick += kick * 0.7;
    p.camYaw += (Math.random() - 0.5) * KICK.side;
    this.recoilZ = 0.05 * (1 - this.adsK * 0.5);
    this.flashT = 0.04;
    this.w.sound.gun('shot');
  }

  /** A shot somebody fired, the office's account of it: the streak, the sound, and what it did. */
  shot(m: { by: string; o: V3; end: V3; hit?: string; head?: boolean; kill?: boolean }) {
    if (!this.active) return;
    const mine = m.by === store.you;
    // Your own streak starts from the rifle's muzzle, not your eye.
    let o = m.o;
    if (mine) {
      this.gun.muzzle.getWorldPosition(v);
      // The muzzle's in the hands' own little scene, in the camera's frame: into the world's.
      v.applyMatrix4(this.w.camera.matrixWorld);
      o = { x: v.x, y: v.y + 0.12, z: v.z };
    }
    this.w.world().shot(o, m.end, !!m.hit);
    if (!mine) this.w.sound.gun('shot', m.o);
    if (mine && m.hit) {
      this.hud.hitmarker(m.kill ? 'kill' : m.head ? 'head' : 'hit');
      this.w.sound.gun(m.kill ? 'kill' : m.head ? 'head' : 'hit');
      if (m.kill) this.medals(!!m.head);
    }
    if (m.hit === store.you) {
      this.w.sound.gun('hurt');
      // Which way it came from, against where you're looking (+ to the right).
      const from = Math.atan2(m.o.x - this.w.player.pos.x, m.o.z - this.w.player.pos.z);
      const look = this.w.player.camYaw + Math.PI;
      this.hud.hurt(Math.atan2(Math.sin(look - from), Math.cos(look - from)));
      if (m.kill) this.died(m.by);
    }
  }

  private medals(head: boolean) {
    const now = performance.now();
    this.recent = this.recent.filter((t) => now - t < 4000);
    this.recent.push(now);
    const n = this.recent.length;
    const streak = store.arena.players.find((p) => p.id === store.you)?.streak ?? 0;
    this.hud.medal(n >= 3 ? 'TRIPLE KILL' : n === 2 ? 'DOUBLE KILL' : head ? 'HEADSHOT' : '+1 KILL');
    if (streak > 0 && streak % 5 === 0) this.hud.medal(`${streak} KILL STREAK`);
  }

  private died(by: string) {
    this.killedBy = store.peers.get(by)?.name ?? 'someone';
    this.firing = this.aiming = false;
    this.reloadAt = 0;
    const p = this.w.player;
    p.enabled = false;
    p.clearKeys();
  }

  /** The office has you back in, here. */
  spawned(at: { x: number; z: number; rotY: number }) {
    if (!this.active) return;
    this.killedBy = undefined;
    this.ammo = RULES.mag;
    this.reloadAt = 0;
    this.w.placeAt({ x: at.x, y: 0, z: at.z, rotY: at.rotY });
    this.w.player.enabled = true;
  }

  /** Remote people: a rifle in their hands while they're alive, and nobody to see while they're dead. */
  private roots: (id: string) => THREE.Object3D | undefined = () => undefined;
  setPeople(roots: (id: string) => THREE.Object3D | undefined) {
    this.roots = roots;
  }

  private others() {
    const players = store.arena.players;
    for (const pl of players) {
      if (pl.id === store.you) continue;
      const root = this.roots(pl.id);
      if (!root) continue;
      root.visible = pl.alive;
      let g = this.held.get(pl.id);
      if (!g) {
        g = rifle().group;
        // Its muzzle the way they face (+z), at chest height, a bit to their right.
        g.rotation.y = Math.PI;
        g.position.set(-0.22, 1.05, 0.3);
        g.scale.setScalar(1.3);
        this.held.set(pl.id, g);
      }
      if (g.parent !== root) root.add(g);
    }
    for (const [id, g] of this.held) {
      if (players.some((p) => p.id === id)) continue;
      g.removeFromParent();
      this.held.delete(id);
    }
  }
}

/** Whether you're in the arena. */
export function inArena(): boolean {
  return store.floor === ARENA;
}
