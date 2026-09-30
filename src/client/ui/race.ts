import { RACE } from '../../shared/race';
import { store } from '../state';
import { h, modalOpen, openModal, type Modal } from './dom';
import { focusDialog } from './dialog-focus';
import type { CircuitMap, RaceAdapter } from './race-adapter';
import { countdownLights, mapProjection, raceGap, raceOrder, raceTime, speedReading } from './race-view';

export interface DrivingGauge {
  name: string;
  /** Signed forward speed and the vehicle's top speed, in m/s. */
  speed: number;
  top: number;
  bicycle?: boolean;
  passenger?: boolean;
}

const text = (el: HTMLElement, value: string) => { if (el.textContent !== value) el.textContent = value; };
const svgEl = <K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] => document.createElementNS('http://www.w3.org/2000/svg', tag);

/** Screen-space only: no Three.js meshes, textures, draw calls or separate animation loop. */
export class RaceUI {
  private readonly status = h('span', { role: 'status', 'aria-live': 'polite' });
  private readonly open = h('button.btn', { type: 'button', onclick: () => this.openLobby() }, '🏁 Race lobby');
  private readonly position = h('strong');
  private readonly lap = h('strong');
  private readonly clock = h('strong');
  private readonly best = h('strong');
  private readonly gap = h('strong');
  private readonly live = h('dl.race-metrics', {}, ...[
    ['Position', this.position], ['Lap', this.lap], ['This lap', this.clock], ['Best lap', this.best], ['Gap to leader', this.gap],
  ].map(([label, value]) => h('div', {}, h('dt', {}, label as string), h('dd', {}, value as HTMLElement))));
  private readonly svg = svgEl('svg');
  private readonly path = svgEl('path');
  private readonly marks = new Map<string, SVGCircleElement>();
  private readonly mapNote = h('span.race-map-note', {}, 'Map unavailable');
  private readonly map = h('figure.race-map', {}, this.svg, h('figcaption', {}, 'Circuit · ', this.mapNote));
  private readonly hud = h('section.panel.race-hud.hidden', { 'aria-label': 'Race' }, h('div.race-hud-head', {}, this.open, this.status), this.live, this.map);
  private readonly lights = Array.from({ length: RACE.countdown }, () => h('i'));
  private readonly lightText = h('strong', { role: 'status', 'aria-live': 'assertive', 'aria-atomic': 'true' });
  private readonly countdown = h('div.race-countdown.hidden', { 'aria-label': 'Start lights' }, h('div.race-lights', { 'aria-hidden': 'true' }, ...this.lights), this.lightText);
  private readonly speed = h('strong');
  private readonly mode = h('span.speed-mode');
  private readonly vehicle = h('span.speed-vehicle');
  private readonly speedFill = h('span');
  private readonly gauge = h('section.panel.speed-gauge.hidden', { 'aria-label': 'Speedometer' },
    this.vehicle, h('div.speed-reading', {}, this.mode, this.speed, h('span', {}, 'km/h')),
    h('div.speed-track', { 'aria-hidden': 'true' }, this.speedFill));
  private modal: Modal | null = null;
  private refreshModal?: () => void;
  private lastUpdate = -Infinity;
  private previousPhase = '';
  private goUntil = 0;
  private measuredAt = -Infinity;

  constructor(private readonly root: HTMLElement, private readonly source: RaceAdapter) {
    this.svg.setAttribute('viewBox', '0 0 160 160');
    this.svg.setAttribute('role', 'img');
    this.svg.setAttribute('aria-label', 'Circuit outline and drivers. Your dot is larger and outlined.');
    this.path.setAttribute('class', 'race-map-track');
    this.svg.append(this.path);
    root.append(this.hud, this.countdown, this.gauge);
  }

  /** From the menu, palette or circuit gate. The same window becomes the finish leaderboard. */
  openLobby() {
    if (this.modal) return this.modal.el.querySelector<HTMLElement>('button')?.focus();
    const heading = h('h2', {}, '🏁 Race lobby');
    const summary = h('p.race-summary', { role: 'status', 'aria-live': 'polite' });
    const list = h('div.race-roster');
    const record = h('p.race-record');
    const join = h('button.btn', { type: 'button', onclick: () => this.source.joinGrid() }, 'Join grid');
    const start = h('button.btn', { type: 'button', onclick: () => this.source.startRace() }, 'Start race');
    const leave = h('button.btn', { type: 'button', onclick: () => this.source.leaveRace() }, 'Leave race');
    const notice = h('p.note');
    const el = h('div.modal.race-window', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Race lobby and results' },
      h('header', {}, heading), h('div.body', {}, summary, notice, list, record),
      h('footer', {}, join, start, leave));
    let signature = '';
    const render = () => {
      const s = this.source.store.race;
      const mine = s.racers.find((r) => r.id === store.you);
      const at = this.source.atCircuit();
      const available = this.source.available();
      const liningUp = s.phase === 'idle' || s.phase === 'lobby';
      join.disabled = !available || !at || !liningUp || !!mine || s.racers.length >= RACE.slots;
      start.disabled = !available || !at || !liningUp || s.racers.length < 1;
      leave.disabled = !available || !mine;
      text(join, mine ? 'On the grid' : s.racers.length >= RACE.slots ? 'Grid full' : 'Join grid');
      const finished = s.phase === 'finished';
      const running = s.phase === 'racing';
      const phase = { idle: 'Ready to line up', lobby: 'Lining up', countdown: 'Getting ready', racing: 'Race in progress', finished: 'Finished' }[s.phase];
      text(heading, finished ? '🏁 Race results' : '🏁 Race lobby');
      text(summary, finished ? 'Everyone is in, or the finish window has closed.' : `${s.laps} laps · ${s.racers.length}/${RACE.slots} on the grid · ${phase}`);
      text(notice, !available ? 'The circuit is not ready yet.' : !at ? 'Head through the city’s circuit gate to join the grid.' : liningUp ? 'Join the grid, then anyone here can start the race. Five red lights, then go.' : s.phase === 'countdown' ? 'Get ready. The lights go out together.' : finished ? 'Best laps and the circuit record are below.' : 'The race is on. You can watch, or leave your race.');
      text(record, s.record ? `🏆 Circuit record · ${s.record.name} · ${raceTime(s.record.ms)}` : '🏆 Circuit record · No complete lap yet');
      const next = JSON.stringify([s, available, at, store.you]);
      if (signature === next) return;
      signature = next;
      const racers = finished || s.phase === 'racing' ? raceOrder(s) : [...s.racers].sort((a, b) => a.slot - b.slot);
      const table = h('table.race-table', {}, h('caption', {}, finished ? 'Finish leaderboard' : 'Drivers lined up and their cars'),
        h('thead', {}, h('tr', {}, ...[finished || running ? 'Place' : 'Grid', 'Driver / vehicle', 'Best lap', finished ? 'Finish' : 'Lap'].map((label) => h('th', { scope: 'col' }, label)))));
      table.append(h('tbody', {}, ...racers.map((r) => h('tr', { class: r.id === store.you ? 'race-you' : '' },
        h('td', {}, finished ? (r.finishedAt !== undefined ? String(r.position) : 'DNF') : running ? String(r.position || '—') : String(r.slot + 1)),
        h('th', { scope: 'row' }, r.name, r.id === store.you ? ' (you)' : '', h('small', {}, this.source.carName(r.car))),
        h('td', {}, raceTime(r.bestLap)),
        h('td', {}, finished ? r.finishedAt !== undefined ? raceGap(s, r) === 'Leading' ? 'Winner' : raceGap(s, r) : 'Did not finish' : `${Math.min(s.laps, r.lap + 1)}/${s.laps}`),
      ))));
      list.replaceChildren(racers.length ? table : h('p.empty', {}, 'Nobody lined up yet. Bring a friend, or run a lap on your own.'));
    };
    let releaseFocus = () => {};
    this.modal = openModal(el, { doing: '🏁 checking the race', onClose: () => { this.modal = null; this.refreshModal = undefined; releaseFocus(); } });
    this.refreshModal = render;
    render();
    releaseFocus = focusDialog(el, !join.disabled ? join : undefined);
  }

  /** Call from the existing frame loop. DOM work is capped at 10 Hz, including at Battery's 30 fps. */
  update(frameMs: number, driving: DrivingGauge | null = null) {
    if (frameMs - this.lastUpdate < 100) return;
    this.lastUpdate = frameMs;
    if (frameMs - this.measuredAt >= 1000) {
      this.measuredAt = frameMs;
      const bar = this.root.querySelector('.topbar')?.getBoundingClientRect();
      const coffee = this.root.querySelector('.caffeine:not(.hidden)')?.getBoundingClientRect();
      this.hud.style.setProperty('--race-hud-top', `${Math.max(72, bar?.bottom ?? 0, coffee?.bottom ?? 0) + 12}px`);
    }
    const s = this.source.store.race;
    const now = this.source.now();
    const here = this.source.available() && this.source.atCircuit();
    const mine = s.racers.find((r) => r.id === store.you);
    if (s.phase !== this.previousPhase) {
      if (s.phase === 'countdown' && here) this.modal?.close();
      if (s.phase === 'racing' && this.previousPhase === 'countdown') this.goUntil = now + 900;
      if (s.phase === 'finished' && here && !modalOpen()) this.openLobby();
      this.previousPhase = s.phase;
    }
    this.refreshModal?.();
    this.hud.classList.toggle('hidden', !here || modalOpen());
    this.live.classList.toggle('hidden', !mine || s.phase === 'idle' || s.phase === 'lobby');
    text(this.open, s.phase === 'finished' ? '🏁 Results' : '🏁 Race lobby');
    text(this.status, mine ? s.phase === 'finished' ? mine.finishedAt === undefined ? 'Did not finish' : 'Finished' : s.phase === 'racing' ? 'Racing' : 'On the grid' : s.phase === 'racing' ? 'Watching' : 'Circuit');
    if (mine) {
      text(this.position, `${mine.position || '—'} / ${s.racers.length}`);
      text(this.lap, `${Math.min(s.laps, mine.lap + 1)} / ${s.laps}`);
      const stop = mine.finishedAt ?? now;
      text(this.clock, s.phase === 'countdown' || mine.lapStartedAt === undefined || (s.phase === 'finished' && mine.finishedAt === undefined) ? '—' : raceTime(Math.max(0, stop - mine.lapStartedAt)));
      text(this.best, raceTime(mine.bestLap));
      text(this.gap, raceGap(s, mine));
    }
    if (here) this.updateMap(this.source.map());
    const counting = s.phase === 'countdown';
    const go = s.phase === 'racing' && now < this.goUntil;
    this.countdown.classList.toggle('hidden', !here || modalOpen() || (!counting && !go));
    if (here && (counting || go)) {
      const lights = counting ? countdownLights(s.startsAt, now) : { lit: 0, text: 'GO!' };
      this.lights.forEach((light, i) => light.classList.toggle('lit', i < lights.lit));
      text(this.lightText, lights.text);
      this.countdown.classList.toggle('go', lights.text === 'GO!');
    }
    this.gauge.classList.toggle('hidden', !driving || modalOpen());
    if (driving) {
      const read = speedReading(driving.speed, driving.top, driving.bicycle);
      text(this.speed, String(read.kmh));
      text(this.mode, read.mode);
      this.mode.setAttribute('aria-label', read.mode === 'R' ? 'Reverse' : read.mode === 'N' ? 'Neutral' : read.mode === 'PEDAL' ? 'Pedaling' : 'Drive');
      text(this.vehicle, `${driving.name}${driving.passenger ? ' · Passenger' : ''}`);
      this.speedFill.style.width = `${read.fill * 100}%`;
    }
  }

  private updateMap(map: CircuitMap | null) {
    const project = map && mapProjection(map.outline);
    this.svg.classList.toggle('hidden', !project);
    text(this.mapNote, project ? '◎ you · ● drivers' : 'Map unavailable');
    if (!project || !map) return;
    const d = `${map.outline.map((p, i) => { const q = project(p); return `${i ? 'L' : 'M'}${q.x.toFixed(1)},${q.y.toFixed(1)}`; }).join(' ')} Z`;
    if (this.path.getAttribute('d') !== d) this.path.setAttribute('d', d);
    const seen = new Set<string>();
    for (const dot of map.dots) {
      if (!Number.isFinite(dot.x) || !Number.isFinite(dot.z)) continue;
      seen.add(dot.id);
      let mark = this.marks.get(dot.id);
      if (!mark) { mark = svgEl('circle'); mark.setAttribute('r', '4'); mark.append(svgEl('title')); this.svg.append(mark); this.marks.set(dot.id, mark); }
      const q = project(dot);
      mark.setAttribute('cx', String(q.x));
      mark.setAttribute('cy', String(q.y));
      mark.setAttribute('class', dot.id === store.you ? 'race-map-dot you' : 'race-map-dot');
      mark.setAttribute('r', dot.id === store.you ? '6' : '4');
      mark.firstChild!.textContent = `${dot.name}${dot.id === store.you ? ' (you)' : ''}`;
    }
    for (const [id, mark] of this.marks) if (!seen.has(id)) { mark.remove(); this.marks.delete(id); }
  }

  dispose() {
    this.modal?.close();
    this.hud.remove();
    this.countdown.remove();
    this.gauge.remove();
  }
}
