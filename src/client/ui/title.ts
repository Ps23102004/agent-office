import * as THREE from 'three';
import type { Theme } from '../../shared/protocol';
import { calendarTheme } from '../../shared/theme';
import { h, modalOpen, onModalChange } from './dom';

/*
 * The title screen: up once per page load, behind the loading screen and over the office itself, while
 * the camera flies slowly round the island past its landmarks. Any key (or a click) brings up the menu,
 * and that first touch is also what lets the office's sound start (OfficeSound unlocks on it). Play hands
 * the camera back to you with a short swoop as the lights dip; Controls has the keys for each way of
 * getting about; Settings opens the usual settings. Halloween and Christmas dress it up as the building
 * is (see world/holiday.ts).
 */

/** How the title dresses up: a holiday, or the plain arcade look. */
export type TitleLook = Theme | 'plain';

/**
 * The holiday the title wears. `active` is what the office has put up (null: none), or undefined before
 * it has said, when the calendar where you are decides, as the office's own `auto` would.
 */
export function titleLook(active: Theme | null | undefined, ms = Date.now(), utcOffset = -new Date(ms).getTimezoneOffset()): TitleLook {
  if (active === undefined) return calendarTheme(ms, utcOffset) ?? 'plain';
  return active ?? 'plain';
}

/** Whether to skip the title: asked to (?skipTitle), or the page was reloaded for a new version (see upgrade.ts). */
export function skipTitle(search: string, storage: Pick<Storage, 'getItem' | 'removeItem'> | null): boolean {
  let reloaded = false;
  try {
    reloaded = storage?.getItem(RELOADED_KEY) === '1';
    storage?.removeItem(RELOADED_KEY);
  } catch {
    // no storage: shown as usual
  }
  return reloaded || new URLSearchParams(search).has('skipTitle');
}
/** Set in sessionStorage just before the page reloads itself into a new version, so you go straight back in. */
export const RELOADED_KEY = 'agent-office.reloaded';

/** Reloads the page (into a new version of the office) straight back in, past the title. */
export function reloadPastTitle() {
  try {
    sessionStorage.setItem(RELOADED_KEY, '1');
  } catch {
    // no storage: the title shows again
  }
  location.reload();
}

/**
 * The flight round the island, street coordinates (y above the street): where the camera is and what it
 * looks at. Down the main road past the tower, between the café and the bar, up the street by the race
 * plaza's gates, east among downtown's towers to look out at the lighthouse, then up over the rooftops and
 * back down to the main road. Low, it keeps to the streets (the town's blocks are tall). It loops.
 */
export const FLYOVER: readonly { at: [number, number, number]; look: [number, number, number] }[] = [
  { at: [-40, 10, 27], look: [0, 10, 0] },
  { at: [20, 10, 27], look: [68, 3, 11] },
  { at: [56, 10, 27], look: [68, 3, 44] },
  { at: [84, 11, 18], look: [56, 4, -57] },
  { at: [84, 13, -40], look: [56, 3, -57] },
  { at: [84, 16, -120], look: [140, 20, -141] },
  { at: [102, 20, -141], look: [210, 40, -220] },
  { at: [170, 24, -141], look: [220, 60, -220] },
  { at: [196, 28, -146], look: [339, 18, -339] },
  { at: [196, 34, -215], look: [339, 18, -339] },
  { at: [200, 170, -240], look: [100, 10, -100] },
  { at: [140, 170, -170], look: [0, 10, 0] },
  { at: [60, 90, -40], look: [0, 10, 0] },
  { at: [-70, 20, 27], look: [0, 10, 0] },
];
/** Seconds for once round (about a kilometre): slow enough to take in, at 10 m/s or so. */
export const LOOP_S = 110;

const atCurve = new THREE.CatmullRomCurve3(FLYOVER.map((p) => new THREE.Vector3(...p.at)), true, 'centripetal');
const lookCurve = new THREE.CatmullRomCurve3(FLYOVER.map((p) => new THREE.Vector3(...p.look)), true, 'centripetal');

/**
 * Where the camera is and looks at `u` of the way round (any number; it wraps), at an even speed
 * along the flight, with the street at `ground`.
 */
export function flyover(u: number, at: THREE.Vector3, look: THREE.Vector3, ground = 0) {
  const w = u - Math.floor(u);
  const t = atCurve.getUtoTmapping(w, 0);
  atCurve.getPoint(t, at).y += ground;
  lookCurve.getPoint(t, look).y += ground;
}

/**
 * How long Play takes to bring the camera back to you: it swoops toward you as the lights dip, and is
 * with you when they come up (a straight line from the street to your desk goes through walls).
 */
const BLEND_S = 0.5;

type Mode = 'Walking' | 'Driving' | 'Racing' | 'Arena';
const CONTROLS: Record<Mode, [keys: string[], what: string][]> = {
  Walking: [
    [['W', 'A', 'S', 'D'], 'Walk'],
    [['Shift'], 'Run'],
    [['Space'], 'Jump'],
    [['Mouse'], 'Look around (click the office first)'],
    [['E'], 'Use whatever you’re next to'],
    [['T'], 'Chat'],
    [['V'], 'Talk (hold)'],
    [['G'], 'Emotes (hold)'],
    [['M'], 'Map'],
  ],
  Driving: [
    [['W', 'S'], 'Gas and brake'],
    [['A', 'D'], 'Steer'],
    [['Space'], 'Handbrake'],
    [['Shift'], 'Boost (with the gas)'],
    [['Z'], 'Change camera'],
    [['X'], 'Look back'],
    [['H'], 'Honk'],
    [['M'], 'Map'],
    [['R'], 'Race'],
    [['E'], 'Get out'],
  ],
  Racing: [
    [['R'], 'Join the race, or say you’re ready'],
    [['W', 'S'], 'Gas and brake'],
    [['A', 'D'], 'Steer'],
    [['Space'], 'Handbrake round the hairpins'],
    [['Shift'], 'Boost (with the gas)'],
    [['Z'], 'Change camera'],
    [['X'], 'Look back'],
  ],
  Arena: [
    [['W', 'A', 'S', 'D'], 'Move'],
    [['Mouse'], 'Aim'],
    [['Click'], 'Fire'],
    [['Right click'], 'Aim down the sights'],
    [['R'], 'Reload'],
    [['Tab'], 'Scoreboard (hold)'],
    [['Space'], 'Jump'],
  ],
};

const TAGLINE: Record<TitleLook, string> = {
  halloween: 'The office after dark',
  christmas: 'Open all through the holidays',
  plain: 'Your team and its agents, on an island of their own',
};

/** A bat, for Halloween: wings out, 20 by 10. */
const BAT = 'M0 5C2 1.6 5 .8 7 3.6 7.8 2 8.8 1.6 10 3.2 11.2 1.6 12.2 2 13 3.6 15 .8 18 1.6 20 5 17.6 4.4 15.6 5.4 14.4 7.6 12.6 6.4 11.2 7.2 10 9.4 8.8 7.2 7.4 6.4 5.6 7.6 4.4 5.4 2.4 4.4 0 5Z';

export interface TitleHooks {
  /** Opens the office's settings over the title. */
  settings(): void;
  /** You chose Play and the camera is back with you: the office is yours. */
  entered(): void;
  /** Dips the lights (the office's fade between places), or brings them back up. */
  fade(on: boolean): void;
}

/**
 * The title screen, put up at once (under the loading screen until that comes down). While `active` it
 * owns the camera: call pose() each frame after the player has put the camera where it would be.
 */
export class TitleScreen {
  /** Up, or blending the camera back to you: the camera is the title's. */
  active = true;
  private el: HTMLElement;
  private logo: HTMLElement;
  private tag: HTMLElement;
  private menu: HTMLElement;
  private sheet: HTMLElement;
  private stage: 'press' | 'menu' | 'leaving' = 'press';
  private flown = 0;
  private leftFor = 0;
  private at = new THREE.Vector3();
  private look = new THREE.Vector3();
  private q = new THREE.Quaternion();
  private m = new THREE.Matrix4();
  /** Where the player put the camera this frame, while blending to it. */
  private toAt = new THREE.Vector3();
  private toQ = new THREE.Quaternion();
  private still: boolean;
  /** Settings was opened from here: focus comes back to it when it closes. */
  private inSettings = false;
  private stopHearing: () => void;

  constructor(
    private hooks: TitleHooks,
    look: TitleLook,
    host: HTMLElement,
  ) {
    this.still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Each letter tipped a little its own way, as if cut out by hand.
    const letters = (word: string, from: number) =>
      h('span.title-word', {}, ...[...word].map((c, i) => h('span.title-letter', { style: `--i:${from + i};--tilt:${(((from + i) * 37) % 9) - 4}deg` }, c)));
    this.logo = h('h1.title-logo', { 'aria-label': 'Agent Office' }, letters('Agent', 0), letters('Office', 5));
    this.tag = h('p.title-tag');
    const button = (label: string, run: () => void) => h('button.title-item', { type: 'button', onclick: run }, label);
    this.menu = h(
      'nav.title-menu',
      { 'aria-label': 'Title', hidden: true },
      button('Play', () => this.play()),
      button('Controls', () => this.controls(true)),
      button('Settings', () => {
        this.inSettings = true;
        this.hooks.settings();
      }),
    );
    this.sheet = this.buildControls();
    this.el = h(
      'section.title',
      { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Agent Office', 'data-stage': 'press' },
      h('div.title-sky', { 'aria-hidden': 'true' }, h('span.title-moon'), ...[0, 1, 2, 3].map((i) => h('span.title-bat', { style: `--b:${i}` }, svgBat())), h('span.title-snow')),
      h('div.title-main', {}, this.logo, this.tag, this.menu),
      h('p.title-press', { role: 'status' }, h('span', {}, 'Press any key')),
      this.sheet,
    );
    this.setLook(look);
    host.append(this.el);
    document.body.classList.add('title-up');
    window.addEventListener('keydown', this.onKey, true);
    this.el.addEventListener('pointerdown', this.onPointer);
    // Back from Settings: on Settings again, to carry on from where you were.
    this.stopHearing = onModalChange((open) => {
      if (open || modalOpen() || !this.inSettings) return;
      this.inSettings = false;
      if (this.stage === 'menu' && this.sheet.hidden) (this.menu.children[2] as HTMLElement).focus();
    });
  }

  /** Dresses the title for a holiday, or takes it off. */
  setLook(look: TitleLook) {
    this.el.dataset.look = look;
    this.tag.textContent = TAGLINE[look];
  }

  /**
   * Puts the camera on the flight round the island, or on its way back to where the player has just put
   * it (after Play). `ground` is the street's height under the floor you're on.
   */
  pose(camera: THREE.PerspectiveCamera, dt: number, ground: number) {
    if (!this.active) return;
    if (!this.still) this.flown += dt / LOOP_S;
    flyover(this.flown, this.at, this.look, ground);
    this.q.setFromRotationMatrix(this.m.lookAt(this.at, this.look, camera.up));
    if (this.stage !== 'leaving') {
      camera.position.copy(this.at);
      camera.quaternion.copy(this.q);
      return;
    }
    this.leftFor += dt;
    const k = this.still ? 1 : Math.min(1, this.leftFor / BLEND_S);
    const e = k * k * (3 - 2 * k);
    // The player's pose, as it put the camera this frame, is where this blends to.
    this.toAt.copy(camera.position);
    this.toQ.copy(camera.quaternion);
    camera.position.lerpVectors(this.at, this.toAt, e);
    camera.quaternion.slerpQuaternions(this.q, this.toQ, e);
    if (k < 1) return;
    this.active = false;
    this.hooks.fade(false);
    this.hooks.entered();
  }

  private buildControls(): HTMLElement {
    const modes = Object.keys(CONTROLS) as Mode[];
    const list = h('dl.title-keys', { id: 'title-keys', role: 'tabpanel' });
    const tabs = modes.map((mode) => h('button.title-tab', { type: 'button', role: 'tab', id: `title-tab-${mode}`, 'aria-controls': 'title-keys', 'aria-selected': 'false', tabindex: -1, onclick: () => show(mode) }, mode));
    const show = (mode: Mode) => {
      // Roving: only the chosen tab is in the Tab order; the arrows move between them.
      tabs.forEach((t, i) => {
        t.setAttribute('aria-selected', String(modes[i] === mode));
        t.tabIndex = modes[i] === mode ? 0 : -1;
      });
      list.setAttribute('aria-labelledby', `title-tab-${mode}`);
      list.replaceChildren(...CONTROLS[mode].flatMap(([keys, what]) => [h('dt', {}, ...keys.map((k) => h('kbd', {}, k))), h('dd', {}, what)]));
    };
    show('Walking');
    return h(
      'div.title-sheet',
      { role: 'dialog', 'aria-label': 'Controls', hidden: true },
      h('h2', {}, 'Controls'),
      h('div.title-tabs', { role: 'tablist' }, ...tabs),
      list,
      h('button.title-item.title-back', { type: 'button', onclick: () => this.controls(false) }, 'Back'),
    );
  }

  private controls(open: boolean) {
    this.sheet.hidden = !open;
    this.menu.hidden = open;
    (open ? this.sheet.querySelector<HTMLElement>('[aria-selected="true"]') : this.menu.children[1] as HTMLElement)?.focus();
  }

  private toMenu() {
    if (this.stage !== 'press') return;
    this.stage = 'menu';
    this.el.dataset.stage = 'menu';
    this.menu.hidden = false;
    (this.menu.firstElementChild as HTMLElement).focus();
  }

  private play() {
    if (this.stage === 'leaving') return;
    this.stage = 'leaving';
    this.el.dataset.stage = 'leaving';
    window.removeEventListener('keydown', this.onKey, true);
    this.stopHearing();
    document.body.classList.remove('title-up');
    const gone = () => this.el.remove();
    if (this.still) gone();
    else {
      setTimeout(gone, 700);
      this.hooks.fade(true);
    }
  }

  /** The title's keys, before the game's: nothing reaches the office behind it while it's up. */
  private onKey = (e: KeyboardEvent) => {
    // Settings open over it: that has the keys.
    if (modalOpen()) return;
    e.stopPropagation();
    // Still loading, a browser shortcut or a function key (F5, F11): nothing for the title to do.
    if (document.getElementById('loading') || e.metaKey || e.ctrlKey || e.altKey || /^F\d+$/.test(e.key)) return;
    // A held key repeating: not a second choice.
    if (e.repeat) {
      e.preventDefault();
      return;
    }
    if (this.stage === 'press') {
      if (!['Shift', 'Tab', 'CapsLock'].includes(e.key)) {
        e.preventDefault();
        this.toMenu();
      }
      return;
    }
    const group = this.sheet.hidden ? [...this.menu.children] : [...this.sheet.querySelectorAll('.title-tab')];
    const at = group.indexOf(document.activeElement as Element);
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (step && (this.sheet.hidden ? e.key === 'ArrowDown' || e.key === 'ArrowUp' : e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      const next = group[(Math.max(at, 0) + (at < 0 ? 0 : step) + group.length) % group.length] as HTMLElement;
      next.focus();
      if (!this.sheet.hidden) next.click();
    } else if (e.key === 'Escape' && !this.sheet.hidden) {
      e.preventDefault();
      this.controls(false);
    } else if (e.key === 'Enter' && this.sheet.hidden && !(document.activeElement as Element)?.closest?.('.title')) {
      // Focus wandered off (a click on the scene behind): Enter still plays.
      e.preventDefault();
      this.play();
    }
  };

  private onPointer = () => {
    if (!document.getElementById('loading')) this.toMenu();
  };
}

function svgBat(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 20 10');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', BAT);
  svg.append(path);
  return svg;
}
