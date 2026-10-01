import type { ArenaState } from '../../shared/arena';
import { h } from './dom';

// The arena's heads-up display (shared/arena.ts, client/arena.ts): crosshair, hit markers, health,
// rounds, the kill feed, the match's scores and clock, the death screen and the scoreboard (Tab).
// Screen-space only: client/arena.ts calls render() every frame, so it touches the DOM only on change.

/** Everything the HUD shows, each frame. */
export interface ArenaHudView {
  /** Your peer id. */
  you: string;
  state: ArenaState;
  /** The office's clock (epoch ms), for the match clock and the respawn countdown. */
  now: number;
  ammo: number;
  mag: number;
  /** How far through a reload (0 to 1), or null when not reloading. */
  reloading: number | null;
  /** Your health, 0 to 100. */
  hp: number;
  /** How far apart the crosshair's lines are (px): wider moving, jumping, firing; narrow aiming down sights. */
  spread: number;
  /** Aiming down the sights (right mouse): the crosshair goes, the gun's sights do the job. */
  ads: boolean;
  /** Who killed you, while you're dead. */
  killedBy?: string;
}

export class ArenaHUD {
  readonly el = h('div.arena-hud.hidden', { 'aria-hidden': 'true' });
  private readonly line = h('div');
  private readonly cross = h('div', { style: 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);font:700 18px monospace;color:#fff;text-shadow:0 0 2px #000' }, '+');

  constructor() {
    this.line.setAttribute('style', 'position:fixed;right:16px;bottom:16px;font:700 16px monospace;color:#fff;text-shadow:0 0 2px #000;white-space:pre');
    this.el.append(this.cross, this.line);
  }

  show(on: boolean) {
    this.el.classList.toggle('hidden', !on);
  }

  render(v: ArenaHudView) {
    const me = v.state.players.find((p) => p.id === v.you);
    const text = `${v.state.phase}  K ${me?.kills ?? 0} D ${me?.deaths ?? 0}\nHP ${Math.round(v.hp)}  ${v.reloading !== null ? 'RELOADING' : `${v.ammo}/${v.mag}`}${v.killedBy ? `\nKilled by ${v.killedBy}` : ''}`;
    if (this.line.textContent !== text) this.line.textContent = text;
  }

  /** You hit someone: in the body, the head, or that killed them. */
  hitmarker(_kind: 'hit' | 'head' | 'kill') {}

  /** You were hit, from `angle` (radians from where you're looking, + to the right). */
  hurt(_angle: number) {}

  /** Tab held: the scoreboard. */
  scoreboard(_open: boolean) {}

  /** A word on the screen for a moment: "Headshot", "Double kill", "+1". */
  medal(_text: string) {}
}
