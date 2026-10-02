import { BOTS, BOT_LEVELS, type BotLevel, type BotSettings } from '../../shared/bots';
import { h } from './dom';
import './bots.css';

const descriptions: Record<BotLevel, string> = {
  easy: 'Beginner · forgiving pace and aim',
  normal: 'Average player · a balanced challenge',
  hard: 'Skilled player · quick and precise',
  insane: 'Top player · the toughest challenge',
};
let nextId = 0;
const text = (el: HTMLElement, value: string) => { if (el.textContent !== value) el.textContent = value; };
const disabled = (el: HTMLButtonElement | HTMLSelectElement, value: boolean) => { if (el.disabled !== value) el.disabled = value; };

/** Shared segmented difficulty picker, also used for the practice rabbit. */
export class BotDifficulty {
  level: BotLevel;
  private readonly description = h('p.bot-description');
  private readonly buttons: HTMLButtonElement[];
  readonly el: HTMLElement;
  constructor(label: string, level: BotLevel = BOTS.level) {
    this.level = level;
    const id = `bot-difficulty-${++nextId}`;
    this.description.id = `${id}-description`;
    this.buttons = BOT_LEVELS.map((value) => h('button.btn', {
      type: 'button', 'aria-describedby': this.description.id,
      onclick: () => this.set(value),
    }, value[0].toUpperCase() + value.slice(1)));
    this.el = h('fieldset.bot-difficulty', {}, h('legend', {}, label),
      h('div.bot-segments', {}, ...this.buttons), this.description);
    this.set(level);
  }
  set(level: BotLevel) {
    this.level = level;
    this.buttons.forEach((button, i) => {
      const value = String(BOT_LEVELS[i] === level);
      if (button.getAttribute('aria-pressed') !== value) button.setAttribute('aria-pressed', value);
    });
    text(this.description, descriptions[level]);
  }
  enabled(on: boolean) { this.buttons.forEach((button) => disabled(button, !on)); }
}

/** Draft controls stay put while current settings are refreshed from the server. */
export class BotControls {
  readonly difficulty: BotDifficulty;
  private readonly fill: HTMLSelectElement;
  private readonly current = h('p.bot-current', { role: 'status', 'aria-live': 'polite' });
  private readonly apply: HTMLButtonElement;
  private sentAt = -Infinity;
  private available = false;
  readonly el: HTMLElement;
  constructor(settings: BotSettings | undefined, send: (fill: number, level: BotLevel) => void) {
    const initial = settings ?? BOTS;
    const id = `bot-fill-${++nextId}`;
    this.fill = h('select', { id }, ...Array.from({ length: BOTS.players }, (_, i) =>
      h('option', { value: i + 1 }, `${i + 1}${i === 0 ? ' · no bots' : ''}`)));
    this.fill.value = String(initial.fill);
    this.difficulty = new BotDifficulty('Bot difficulty', initial.level);
    this.apply = h('button.btn', { type: 'button', onclick: () => {
      if (!this.available || Date.now() - this.sentAt < BOTS.every) return;
      this.sentAt = Date.now();
      send(Number(this.fill.value), this.difficulty.level);
      this.apply.disabled = true;
    } }, 'Apply bot settings');
    this.el = h('section.bot-controls', { 'aria-label': 'Bot settings' },
      h('h3', {}, 'Play with bots'),
      h('label.bot-fill', { for: id }, 'Total players · people + bots ', this.fill),
      h('p.note', {}, 'Bots fill the spare places. People always keep their place; 1 sends all bots home.'),
      this.difficulty.el, this.current, this.apply);
  }
  update(settings: BotSettings | undefined, enabled: boolean) {
    const s: BotSettings = settings ?? BOTS;
    this.available = enabled;
    disabled(this.fill, !enabled);
    this.difficulty.enabled(enabled);
    disabled(this.apply, !enabled || Date.now() - this.sentAt < BOTS.every);
    text(this.current, `Current: ${s.fill} total · people + bots · ${s.level} · set by ${s.by ?? 'the office'}`);
  }
}
