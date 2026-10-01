import { RACE, SECTORS, type Timing } from '../../shared/race';
import { store } from '../state';
import { isTyping } from '../player';
import { h, modalOpen, openModal, toast, type Modal } from './dom';
import { focusDialog } from './dialog-focus';
import type { CircuitMap, RaceAdapter } from './race-adapter';
import { checkpointHint, countdownLights, mapProjection, raceGap, raceOrder, raceTime, sectorDelta, sectorReadings } from './race-view';
import { DriveHUD, type DrivingGauge } from './drivehud';
import './social-race.css';

export type { DrivingGauge } from './drivehud';

const text = (el: HTMLElement, value: string) => { if (el.textContent !== value) el.textContent = value; };
const svgEl = <K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] => document.createElementNS('http://www.w3.org/2000/svg', tag);

/** Text changes only when the office reports a split; clock ticks don't trigger announcements. */
function renderSplit(el: HTMLElement, timing?: Timing) {
  const split = timing?.lastSplit;
  text(el, split ? `Last split · S${split.sector + 1} · ${raceTime(split.ms)} · ${sectorDelta(split.delta)}` : 'Cross sector lines for timed splits');
  el.dataset.trend = split?.delta === undefined || split.delta === 0 ? 'neutral' : split.delta < 0 ? 'quicker' : 'slower';
}

const practiceScope = () => store.me.account ? 'Account bests are kept while this office is running. Sector bests are from this time out.' : 'Guest laps and bests are only from this time out; they aren’t kept when you leave practice.';

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
  private readonly practiceLaps = h('strong');
  private readonly practiceClock = h('strong');
  private readonly practiceLast = h('strong');
  private readonly practiceBest = h('strong');
  private readonly practiceBestLabel = h('dt', {}, 'Practice best');
  private readonly practice = h('dl.race-metrics.hidden', { 'aria-label': 'Your practice laps' },
    h('div', {}, h('dt', {}, 'Laps completed'), h('dd', {}, this.practiceLaps)),
    h('div', {}, h('dt', {}, 'This lap'), h('dd', {}, this.practiceClock)),
    h('div', {}, h('dt', {}, 'Last lap'), h('dd', {}, this.practiceLast)),
    h('div', {}, this.practiceBestLabel, h('dd', {}, this.practiceBest)));
  private readonly coach = h('p.race-coach', { role: 'status', 'aria-live': 'polite' });
  private readonly split = h('p.race-split', { role: 'status', 'aria-live': 'polite' });
  private readonly sectorTimes = SECTORS.map(() => h('li'));
  private readonly sectors = h('ul.race-sectors', { 'aria-label': 'Sector times and bests' }, ...this.sectorTimes);
  private readonly timing = h('div', {}, this.coach, this.split, this.sectors);
  private readonly svg = svgEl('svg');
  private readonly path = svgEl('path');
  private readonly marks = new Map<string, SVGCircleElement>();
  private readonly mapNote = h('span.race-map-note', {}, 'Map unavailable');
  private readonly map = h('figure.race-map', {}, this.svg, h('figcaption', {}, 'Circuit · ', this.mapNote));
  private readonly hud = h('section.panel.race-hud.hidden', { 'aria-label': 'Race and practice' }, h('div.race-hud-head', {}, this.open, this.status), h('div.race-hud-details', {}, this.live, this.practice, this.timing, this.map));
  private readonly lights = Array.from({ length: RACE.countdown }, () => h('i'));
  private readonly lightText = h('strong', { role: 'status', 'aria-live': 'assertive', 'aria-atomic': 'true' });
  private readonly countdown = h('div.race-countdown.hidden', { 'aria-label': 'Start lights' }, h('div.race-lights', { 'aria-hidden': 'true' }, ...this.lights), this.lightText);
  private readonly driveHud = new DriveHUD();
  private modal: Modal | null = null;
  private refreshModal?: () => void;
  private lastUpdate = -Infinity;
  private previousPhase = '';
  private goUntil = 0;
  private measuredAt = -Infinity;
  private mapOutline?: CircuitMap['outline'];
  private project: ReturnType<typeof mapProjection> = null;

  constructor(private readonly root: HTMLElement, private readonly source: RaceAdapter) {
    this.svg.setAttribute('viewBox', '0 0 160 160');
    this.svg.setAttribute('role', 'img');
    this.svg.setAttribute('aria-label', 'Circuit outline and drivers. Your dot is larger and outlined.');
    this.path.setAttribute('class', 'race-map-track');
    this.svg.append(this.path);
    root.append(this.hud, this.countdown, this.driveHud.el, this.driveHud.effect);
  }

  /** From the menu, palette or circuit gate. The same window becomes the finish leaderboard. */
  openLobby() {
    if (this.modal) return this.modal.el.querySelector<HTMLElement>('button')?.focus();
    const heading = h('h2', {}, '🏁 Race lobby');
    const summary = h('p.race-summary', { role: 'status', 'aria-live': 'polite' });
    const list = h('div.race-roster');
    const record = h('p.race-record');
    const practiceSummary = h('p');
    const practiceRecord = h('p.race-record');
    const practiceHelp = h('p.note');
    const practiceSplit = h('p.race-split', { role: 'status', 'aria-live': 'polite' });
    const practiceSectors = SECTORS.map(() => h('li'));
    const practicePanel = h('section.race-practice', { 'aria-label': 'Practice laps' }, h('h3', {}, '⏱ Practice laps'), practiceSummary, practiceSplit,
      h('ul.race-sectors', { 'aria-label': 'Your practice sector times' }, ...practiceSectors), practiceRecord, practiceHelp);
    const join = h('button.btn', { type: 'button', onclick: () => this.source.joinGrid() }, 'Join grid');
    const start = h('button.btn', { type: 'button', onclick: () => this.source.startRace() }, 'Start race');
    const leave = h('button.btn', { type: 'button', onclick: () => this.source.leaveRace() }, 'Leave race');
    const notice = h('p.note');
    const el = h('div.modal.race-window', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Race lobby and results' },
      h('header', {}, heading), h('div.body', {}, summary, notice, list, record, practicePanel),
      h('footer', {}, join, start, leave));
    let signature = '';
    const render = () => {
      const s = this.source.store.race;
      const mine = s.racers.find((r) => r.id === store.you);
      const at = this.source.atCircuit();
      const available = this.source.available();
      const liningUp = s.phase === 'idle' || s.phase === 'lobby';
      join.disabled = !available || !at || !liningUp || !!mine || s.racers.length >= RACE.slots;
      start.disabled = !available || !at || s.phase !== 'lobby' || !mine;
      leave.disabled = !available || !mine || s.phase === 'finished' || mine.finishedAt !== undefined;
      text(join, mine ? 'On the grid' : s.racers.length >= RACE.slots ? 'Grid full' : 'Join grid');
      const finished = s.phase === 'finished';
      const running = s.phase === 'racing';
      const phase = { idle: 'Ready to line up', lobby: 'Lining up', countdown: 'Getting ready', racing: 'Race in progress', finished: 'Finished' }[s.phase];
      text(heading, finished ? '🏁 Race results' : '🏁 Race lobby');
      text(summary, finished ? 'Everyone is in, or the finish window has closed.' : `${s.laps} laps · ${s.racers.length}/${RACE.slots} on the grid · ${phase}`);
      text(notice, !available ? 'The circuit is not ready yet.' : !at ? 'Head through the city’s circuit gate to join the grid.' : finished ? 'Best laps and the circuit record are below. The grid opens again when these results clear.' : liningUp ? 'Join the grid, then anyone on the grid can start the race. Five red lights, then go.' : s.phase === 'countdown' ? 'Get ready. The lights go out together.' : 'The race is on. You can watch, or leave your race.');
      text(record, s.record ? `🏆 Circuit record · ${s.record.name} · ${raceTime(s.record.ms)}` : '🏆 Circuit record · No complete lap yet');
      const p = s.practice.find((p) => p.id === store.you);
      text(practiceSummary, p ? `${p.laps} completed · last ${raceTime(p.lastLap)} · ${store.me.account ? 'account' : 'session'} best ${raceTime(p.bestLap)} · ${checkpointHint(p)}` : !available ? 'The circuit is not ready yet.' : mine ? 'Leave the race, then drive through the start line to practise.' : 'Drive a circuit car through the start line to begin. Follow the checkpoints in order; practice laps start automatically outside your race.');
      renderSplit(practiceSplit, p);
      practiceSplit.classList.toggle('hidden', !p);
      const readings = sectorReadings(p);
      practiceSectors.forEach((el, i) => { text(el, readings[i]); el.classList.toggle('hidden', !p); });
      text(practiceRecord, s.practiceRecord ? `Practice record · ${s.practiceRecord.name} · ${raceTime(s.practiceRecord.ms)}` : 'Practice record · No account lap yet');
      text(practiceHelp, practiceScope());
      const next = JSON.stringify([s.phase, s.laps, s.racers, available, at, store.you]);
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
    const s = this.source.store.race;
    const now = this.source.now();
    const here = this.source.available() && this.source.atCircuit();
    if (s.phase !== this.previousPhase) {
      if (s.phase === 'countdown' && here) this.modal?.close();
      if (s.phase === 'racing' && this.previousPhase === 'countdown') this.goUntil = now + 900;
      // Not over the title screen: the results wait in the lobby for you.
      if (s.phase === 'finished' && here && !modalOpen() && !document.body.classList.contains('title-up')) {
        if (isTyping()) toast('🏁 Results are in — open the race lobby');
        else this.openLobby();
      }
      this.previousPhase = s.phase;
    }
    this.refreshModal?.();
    const showHud = here && !modalOpen();
    this.hud.classList.toggle('hidden', !showHud);
    if (!showHud) this.measuredAt = -Infinity;
    if (showHud) {
      if (frameMs - this.measuredAt >= 1000) {
        this.measuredAt = frameMs;
        const bar = this.root.querySelector('.topbar')?.getBoundingClientRect();
        const coffee = this.root.querySelector('.caffeine:not(.hidden)')?.getBoundingClientRect();
        this.hud.style.setProperty('--race-hud-top', `${Math.max(72, bar?.bottom ?? 0, coffee?.bottom ?? 0) + 12}px`);
      }
      const mine = s.racers.find((r) => r.id === store.you);
      const p = !mine ? s.practice.find((p) => p.id === store.you) : undefined;
      const activeTiming = mine ? s.phase === 'racing' && mine.finishedAt === undefined ? mine : undefined : p;
      this.live.classList.toggle('hidden', !mine || s.phase === 'idle' || s.phase === 'lobby');
      text(this.open, s.phase === 'finished' ? '🏁 Results' : '🏁 Race lobby');
      text(this.status, mine ? s.phase === 'finished' ? mine.finishedAt === undefined ? 'Did not finish' : 'Finished' : s.phase === 'racing' ? mine.finishedAt === undefined ? 'Racing' : 'Finished' : 'On the grid' : p ? 'Practice' : s.phase === 'racing' ? 'Watching' : 'Circuit');
      if (mine) {
        text(this.position, `${mine.position || '—'} / ${s.racers.length}`);
        text(this.lap, `${Math.min(s.laps, mine.lap + 1)} / ${s.laps}`);
        const stop = mine.finishedAt ?? now;
        text(this.clock, s.phase !== 'racing' || mine.finishedAt !== undefined || mine.lapStartedAt === undefined ? '—' : raceTime(Math.max(0, stop - mine.lapStartedAt)));
        text(this.best, raceTime(mine.bestLap));
        text(this.gap, raceGap(s, mine));
      }
      this.practice.classList.toggle('hidden', !p);
      if (p) {
        text(this.practiceLaps, String(p.laps));
        text(this.practiceClock, p.lapStartedAt === undefined ? '—' : raceTime(Math.max(0, now - p.lapStartedAt)));
        text(this.practiceLast, raceTime(p.lastLap));
        text(this.practiceBest, raceTime(p.bestLap));
        text(this.practiceBestLabel, store.me.account ? 'Account practice best' : 'Session practice best');
      }
      // Live from your own page (store.raceLive): going the wrong way, or about to be put back on the track, comes first.
      const live = store.raceLive;
      const warn = live.wrongWay ? '⚠️ Wrong way: turn round' : live.resetIn !== null ? `Back on track in ${Math.max(1, Math.ceil(live.resetIn))}… (⌫ now)` : null;
      text(this.coach, warn ?? (activeTiming ? checkpointHint(activeTiming) : mine ? 'Checkpoints count in order when the race starts' : checkpointHint()));
      this.coach.classList.toggle('warn', !!warn);
      this.coach.classList.toggle('hidden', !warn && !!mine && !activeTiming);
      if (mine && live.position !== null && s.phase === 'racing' && mine.finishedAt === undefined) text(this.position, `${live.position} / ${live.racers}`);
      renderSplit(this.split, mine ?? p);
      this.split.classList.toggle('hidden', !mine && !p);
      this.sectors.classList.toggle('hidden', !mine && !p);
      const readings = sectorReadings(mine ?? p);
      this.sectorTimes.forEach((el, i) => text(el, readings[i]));
      this.updateMap(this.source.map());
    }
    const counting = s.phase === 'countdown';
    const go = s.phase === 'racing' && now < this.goUntil;
    this.countdown.classList.toggle('hidden', !here || modalOpen() || (!counting && !go));
    if (here && (counting || go)) {
      const lights = counting ? countdownLights(s.startsAt, now) : { lit: 0, text: 'GO!' };
      this.lights.forEach((light, i) => light.classList.toggle('lit', i < lights.lit));
      text(this.lightText, lights.text);
      this.countdown.classList.toggle('go', lights.text === 'GO!');
    }
    this.driveHud.update(driving);
  }

  private updateMap(map: CircuitMap | null) {
    if (map?.outline !== this.mapOutline) {
      this.mapOutline = map?.outline;
      this.project = map ? mapProjection(map.outline) : null;
      if (map && this.project) {
        const project = this.project;
        const d = `${map.outline.map((p, i) => { const q = project(p); return `${i ? 'L' : 'M'}${q.x.toFixed(1)},${q.y.toFixed(1)}`; }).join(' ')} Z`;
        this.path.setAttribute('d', d);
      }
    }
    const project = this.project;
    this.svg.classList.toggle('hidden', !project);
    text(this.mapNote, project ? '◎ you · ● drivers' : 'Map unavailable');
    if (!project || !map) return;
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
      const title = `${dot.name}${dot.id === store.you ? ' (you)' : ''}`;
      if (mark.firstChild!.textContent !== title) mark.firstChild!.textContent = title;
    }
    for (const [id, mark] of this.marks) if (!seen.has(id)) { mark.remove(); this.marks.delete(id); }
  }

  dispose() {
    this.modal?.close();
    this.hud.remove();
    this.countdown.remove();
    this.driveHud.el.remove();
    this.driveHud.effect.remove();
  }
}
