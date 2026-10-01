import { RULES, type ArenaState } from '../../shared/arena';
import { h } from './dom';
import './arena.css';

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

const text = (el: HTMLElement, value: string) => { if (el.textContent !== value) el.textContent = value; };
const toggle = (el: HTMLElement, name: string, on: boolean) => {
  if (el.classList.contains(name) !== on) el.classList.toggle(name, on);
};
const visible = (el: HTMLElement, on: boolean) => { if (el.hidden === on) el.hidden = !on; };
/** The last value each element was given for each property: the browser normalises what it reports back. */
const written = new WeakMap<HTMLElement, Map<string, string>>();
const style = (el: HTMLElement, name: string, value: string) => {
  let m = written.get(el);
  if (!m) written.set(el, (m = new Map()));
  if (m.get(name) === value) return;
  m.set(name, value);
  el.style.setProperty(name, value);
};
const clamp = (value: number, max = 1) => Math.min(max, Math.max(0, value));
const clock = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
const placing = (rank: number) => `${rank}${rank % 100 >= 11 && rank % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[rank % 10] ?? 'th')}`;

export class ArenaHUD {
  readonly el = h('div.arena-hud.hidden', { 'aria-hidden': 'true' });
  private readonly cross = h('div.arena-crosshair', { 'aria-hidden': 'true' },
    ...['top', 'right', 'bottom', 'left'].map((side) => h('i', { class: side })));
  private readonly marker = h('div.arena-hitmarker', { hidden: true, 'aria-hidden': 'true' },
    ...Array.from({ length: 4 }, () => h('i')));
  private readonly vignette = h('div.arena-vignette', { 'aria-hidden': 'true' });
  private readonly arc = h('div.arena-damage-arc', { hidden: true, 'aria-hidden': 'true' }, h('i'));
  private readonly rounds = h('strong.arena-rounds');
  private readonly capacity = h('span.arena-capacity');
  private readonly reloadLabel = h('span.arena-label');
  private readonly reloadFill = h('i');
  private readonly reloadBar = h('div.arena-track.arena-reload-track', { hidden: true, 'aria-hidden': 'true' }, this.reloadFill);
  private readonly ammo = h('section.arena-ammo', { 'aria-label': 'Ammunition' },
    h('div.arena-ammo-reading', {}, this.rounds, this.capacity), this.reloadLabel, this.reloadBar);
  private readonly hp = h('strong');
  private readonly hpFill = h('i');
  private readonly health = h('section.arena-health', { 'aria-label': 'Health' },
    h('div.arena-health-reading', {}, h('span.arena-label', {}, 'HEALTH'), this.hp),
    h('div.arena-track', { 'aria-hidden': 'true' }, this.hpFill));
  // Only meaningful status text is live; clocks and combat numbers are siblings.
  private readonly matchStatus = h('div.arena-match-status', { role: 'status', 'aria-live': 'polite' });
  private readonly myScore = h('strong');
  private readonly rivalScore = h('strong');
  private readonly rivalName = h('span.arena-label');
  private readonly scoreline = h('div.arena-match-scores', {},
    h('div', {}, this.myScore, h('span.arena-label', {}, 'YOU')),
    h('span.arena-score-divider', {}, '/'), h('div', {}, this.rivalScore, this.rivalName));
  private readonly matchDetail = h('span.arena-label');
  private readonly matchClock = h('strong.arena-clock');
  private readonly match = h('section.arena-match', { 'aria-label': 'Match' },
    this.matchStatus, this.scoreline, h('div.arena-match-meta', {}, this.matchDetail, this.matchClock));
  private readonly feedRows = Array.from({ length: 5 }, () => {
    const killer = h('span.arena-feed-name');
    const victim = h('span.arena-feed-name');
    const head = h('span.arena-feed-head', { hidden: true, 'aria-label': 'Headshot' }, 'HS');
    const el = h('li', { hidden: true }, killer, h('span.arena-feed-icon', { 'aria-label': 'killed' }, '⌖'), victim, head);
    return { el, killer, victim, head };
  });
  private readonly feed = h('ol.arena-feed', { 'aria-label': 'Kill feed' }, ...this.feedRows.map((row) => row.el));
  private readonly deathText = h('div.arena-death-text', { role: 'status', 'aria-live': 'polite' });
  private readonly respawn = h('p.arena-respawn');
  private readonly death = h('section.arena-death', { hidden: true, 'aria-label': 'Respawn' },
    h('div.arena-death-panel', {}, h('span.arena-label', {}, 'ELIMINATED'), this.deathText, this.respawn));
  private readonly boardPhase = h('span.arena-label');
  private readonly boardClock = h('strong.arena-clock');
  private readonly boardBody = h('tbody');
  private readonly board = h('section.arena-scoreboard', { hidden: true, 'aria-label': 'Scoreboard' },
    h('header', {}, h('div', {}, h('h2', {}, 'FREE-FOR-ALL'), this.boardPhase), this.boardClock),
    h('div.arena-table-wrap', {}, h('table', {},
      h('caption.arena-sr-only', {}, 'Arena standings'),
      h('thead', {}, h('tr', {}, ...['RANK', 'NAME', 'KILLS', 'DEATHS', 'K/D', 'STREAK'].map((label) => h('th', { scope: 'col' }, label)))), this.boardBody)),
    h('footer.arena-label', {}, `FIRST TO ${RULES.limit} · HOLD TAB FOR STANDINGS`));
  private readonly boardRows = new Map<string, { el: HTMLTableRowElement; cells: HTMLElement[] }>();
  private boardSignature = '';
  private readonly medals = Array.from({ length: 3 }, () => ({
    el: h('div.arena-medal', { hidden: true }), timer: undefined as ReturnType<typeof setTimeout> | undefined,
  }));
  private readonly medalStack = h('div.arena-medals', {}, ...this.medals.map((slot) => slot.el));
  private markerTimer?: ReturnType<typeof setTimeout>;
  private arcTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    this.el.append(this.vignette, this.death, this.cross, this.marker, this.arc,
      this.health, this.ammo, this.match, this.feed, this.medalStack, this.board);
  }

  show(on: boolean) {
    toggle(this.el, 'hidden', !on);
    const ariaHidden = String(!on);
    if (this.el.getAttribute('aria-hidden') !== ariaHidden) this.el.setAttribute('aria-hidden', ariaHidden);
    if (!on) {
      this.scoreboard(false);
      clearTimeout(this.markerTimer);
      clearTimeout(this.arcTimer);
      visible(this.marker, false);
      visible(this.arc, false);
      for (const slot of this.medals) { clearTimeout(slot.timer); visible(slot.el, false); }
    }
  }

  render(v: ArenaHudView) {
    const players = [...v.state.players].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    const me = players.find((p) => p.id === v.you);
    const dead = v.killedBy !== undefined || v.hp <= 0 || me?.alive === false;
    visible(this.cross, !v.ads && !dead);
    style(this.cross, '--spread', `${Math.max(0, v.spread).toFixed(2)}px`);
    const hp = clamp(v.hp, 100);
    text(this.hp, String(Math.round(hp)));
    style(this.hpFill, 'transform', `scaleX(${(hp / 100).toFixed(3)})`);
    toggle(this.health, 'danger', hp < 35);
    style(this.vignette, 'opacity', ((100 - hp) / 100).toFixed(3));
    text(this.rounds, String(v.ammo));
    text(this.capacity, `/ ${v.mag}`);
    toggle(this.ammo, 'low', v.ammo <= 6);
    toggle(this.ammo, 'empty', v.ammo === 0);
    const reloading = v.reloading !== null;
    text(this.reloadLabel, reloading ? 'RELOADING' : v.ammo === 0 ? 'R TO RELOAD' : 'ROUNDS');
    visible(this.reloadBar, reloading);
    if (v.reloading !== null) style(this.reloadFill, 'transform', `scaleX(${clamp(v.reloading).toFixed(3)})`);

    const phase = v.state.phase;
    const seconds = Math.max(0, Math.ceil(((v.state.endsAt ?? v.now) - v.now) / 1000));
    const rival = players.find((p) => p.id !== v.you);
    const rank = players.findIndex((p) => p.id === v.you) + 1;
    toggle(this.match, 'over', phase === 'over');
    visible(this.scoreline, phase === 'live');
    visible(this.matchDetail, phase !== 'warmup');
    visible(this.matchClock, phase !== 'warmup');
    text(this.matchClock, clock(seconds));
    text(this.matchStatus, phase === 'warmup' ? 'WARM-UP · waiting for another player' :
      phase === 'over' ? `${v.state.winner ?? players[0]?.name ?? 'NOBODY'} WINS` : 'FREE-FOR-ALL');
    text(this.myScore, String(me?.kills ?? 0));
    text(this.rivalScore, String(rival?.kills ?? 0));
    text(this.rivalName, rival?.name ?? 'LEADER');
    text(this.matchDetail, phase === 'over' ? `${rank ? `${placing(rank)} PLACE · ` : ''}NEXT MATCH IN` : `FIRST TO ${RULES.limit}`);

    const lines = v.state.feed.filter((line) => v.now - line.at < 6000).slice(-5);
    this.feedRows.forEach((row, i) => {
      const line = lines[i];
      visible(row.el, !!line);
      if (!line) return;
      text(row.killer, line.killer);
      text(row.victim, line.victim);
      visible(row.head, line.head);
      toggle(row.el, 'involved', !!me && (line.killer === me.name || line.victim === me.name));
      // Fade during the final second, in small steps rather than every frame.
      const opacity = Math.round(clamp((6000 - (v.now - line.at)) / 1000) * 20) / 20;
      style(row.el, 'opacity', String(opacity));
    });

    visible(this.death, v.killedBy !== undefined);
    if (v.killedBy !== undefined) {
      text(this.deathText, `KILLED BY ${v.killedBy}`);
      const left = me?.respawnAt === undefined ? 0 : Math.ceil((me.respawnAt - v.now) / 1000);
      text(this.respawn, left > 0 ? `Back in ${left}` : 'Respawning…');
    }
    text(this.boardPhase, phase === 'warmup' ? 'WARM-UP' : phase === 'over' ? 'MATCH OVER' : 'LIVE');
    text(this.boardClock, phase === 'warmup' ? '—' : clock(seconds));
    const signature = JSON.stringify([v.you, players.map((p) => [p.id, p.name, p.kills, p.deaths, p.streak])]);
    if (signature !== this.boardSignature) {
      this.boardSignature = signature;
      const ids = new Set(players.map((p) => p.id));
      for (const [id, row] of this.boardRows) if (!ids.has(id)) { row.el.remove(); this.boardRows.delete(id); }
      players.forEach((p, i) => {
        let row = this.boardRows.get(p.id);
        if (!row) {
          const cells = [h('td'), h('th', { scope: 'row' }), h('td'), h('td'), h('td'), h('td')];
          row = { el: h('tr', {}, ...cells), cells };
          this.boardRows.set(p.id, row);
        }
        [String(i + 1), p.name, String(p.kills), String(p.deaths), (p.kills / Math.max(1, p.deaths)).toFixed(2), String(p.streak)]
          .forEach((value, index) => text(row.cells[index], value));
        toggle(row.el, 'you', p.id === v.you);
        const current = this.boardBody.children[i];
        if (current !== row.el) this.boardBody.insertBefore(row.el, current ?? null);
      });
    }
  }

  /** You hit someone: in the body, the head, or that killed them. */
  hitmarker(kind: 'hit' | 'head' | 'kill') {
    clearTimeout(this.markerTimer);
    this.marker.dataset.kind = kind;
    visible(this.marker, true);
    this.markerTimer = setTimeout(() => visible(this.marker, false), 180);
  }

  /** You were hit, from `angle` (radians from where you're looking, + to the right). */
  hurt(angle: number) {
    clearTimeout(this.arcTimer);
    style(this.arc, '--damage-angle', `${angle}rad`);
    this.pulse(this.arc);
    visible(this.arc, true);
    this.arcTimer = setTimeout(() => visible(this.arc, false), 1000);
  }

  /** Tab held: the scoreboard. */
  scoreboard(open: boolean) {
    visible(this.board, open);
  }

  /** A word on the screen for a moment: "Headshot", "Double kill", "+1". */
  medal(value: string) {
    const slot = this.medals.find((slot) => slot.el.hidden) ?? this.medals[0];
    clearTimeout(slot.timer);
    // Move the reused slot to the bottom; the fourth medal replaces the oldest.
    this.medals.splice(this.medals.indexOf(slot), 1);
    this.medals.push(slot);
    this.medalStack.append(slot.el);
    text(slot.el, value);
    this.pulse(slot.el);
    visible(slot.el, true);
    slot.timer = setTimeout(() => visible(slot.el, false), 1400);
  }

  /** Alternate equivalent CSS animations to restart bursts without forced layout. */
  private pulse(el: HTMLElement) {
    el.dataset.pulse = el.dataset.pulse === 'a' ? 'b' : 'a';
  }
}
