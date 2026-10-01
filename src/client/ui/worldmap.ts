import { cityLayout, coastAt, NEIGHBOURS, neighbourArea, PIER, RACE_PLAZA, type LotKind } from '../../shared/city';
import { DISTRICT_LABELS, districtAt, places, type Place, type PlaceKind } from '../../shared/places';
import { VENUES } from '../../shared/venues';
import { FLOOR } from '../../shared/layout';
import { roadSegments, route, snapToRoad, type RoadPoint, type Route } from '../../shared/route';
import { focusDialog } from './dialog-focus';
import { h, modalOpen, openModal, type Modal } from './dom';
import { mapOffset, waypointIndicator } from './map-view';
import './map.css';

const ICONS: Record<PlaceKind, string> = { office: '▣', cafe: '☕', bar: '🍸', race: '🏁', arena: '⊕', gas: '⛽', parking: 'P', park: '♣', golf: '⚐', pier: '⚓', lighthouse: '✦' };
const COLORS: Record<LotKind, string> = { shop: '#e4ae66', house: '#cfbd95', glass: '#79afc4', block: '#82929c', walkup: '#ad9292', gas: '#ebcc68', deck: '#aaa5bc' };
const EXTENT = 550;
const SIZE = EXTENT * 2;
const text = (el: HTMLElement, value: string) => { if (el.textContent !== value) el.textContent = value; };

export interface MapPeer extends RoadPoint { name: string; color: string }
export interface MapFrame extends RoadPoint {
  /** The car or player's forward direction, and the camera's, where rotY 0 faces south. */
  heading: number;
  cameraHeading: number;
  speed: number;
  /** On this island rather than on the roof, at the circuit or in the arena. */
  onIsland: boolean;
}

/** The city is painted once. Both maps copy this image, then add their own small marks. */
function cityImage(): HTMLCanvasElement {
  const canvas = h('canvas', { width: SIZE * 2, height: SIZE * 2 });
  const c = canvas.getContext('2d')!;
  c.scale(2, 2); c.translate(EXTENT, EXTENT);
  c.fillStyle = '#142a38'; c.fillRect(-EXTENT, -EXTENT, SIZE, SIZE);
  const coast = (part: 'shore' | 'land', color: string) => {
    c.beginPath();
    for (let i = 0; i <= 240; i++) {
      const th = i / 240 * Math.PI * 2, r = coastAt(th)[part];
      if (!i) c.moveTo(Math.cos(th) * r, Math.sin(th) * r);
      else c.lineTo(Math.cos(th) * r, Math.sin(th) * r);
    }
    c.closePath(); c.fillStyle = color; c.fill();
  };
  coast('shore', '#807758'); coast('land', '#34483d');
  const area = (a: { minX: number; maxX: number; minZ: number; maxZ: number }, color: string) => {
    c.fillStyle = color; c.fillRect(a.minX, a.minZ, a.maxX - a.minX, a.maxZ - a.minZ);
  };
  const city = cityLayout();
  for (const park of city.parks) { c.fillStyle = '#568360'; c.fillRect(park.x - park.size / 2, park.z - park.size / 2, park.size, park.size); }
  area(RACE_PLAZA, '#647365');
  c.lineWidth = 12; c.strokeStyle = '#606b70'; c.beginPath();
  for (const { a, b } of roadSegments()) { c.moveTo(a.x, a.z); c.lineTo(b.x, b.z); }
  c.stroke(); c.lineWidth = 8; c.strokeStyle = '#29333a'; c.stroke();
  for (const l of city.lots) if (!l.hand) { c.fillStyle = COLORS[l.kind]; c.fillRect(l.x - l.w / 2, l.z - l.d / 2, l.w, l.d); }
  for (const n of NEIGHBOURS) area(neighbourArea(n), COLORS.block);
  if (city.gas) area(city.gas.canopy, COLORS.gas);
  for (const v of VENUES) area(v.box, COLORS.shop);
  // The office stands out even before its label is visible.
  area(FLOOR, '#f3f0dc');
  c.strokeStyle = '#edc658'; c.lineWidth = 2; c.strokeRect(FLOOR.minX - 1, FLOOR.minZ - 1, FLOOR.maxX - FLOOR.minX + 2, FLOOR.maxZ - FLOOR.minZ + 2);
  c.fillStyle = '#aa9067'; c.fillRect(PIER.x - PIER.width / 2, PIER.to, PIER.width, PIER.from - PIER.to);
  return canvas;
}

function arrow(c: CanvasRenderingContext2D, x: number, y: number, angle: number, color = '#fff') {
  c.save(); c.translate(x, y); c.rotate(angle); c.beginPath();
  c.moveTo(0, -9); c.lineTo(6, 7); c.lineTo(0, 4); c.lineTo(-6, 7); c.closePath();
  c.fillStyle = color; c.strokeStyle = '#142029'; c.lineWidth = 2; c.fill(); c.stroke(); c.restore();
}

function icon(c: CanvasRenderingContext2D, p: Place, x: number, y: number, label: boolean) {
  c.fillStyle = p.kind === 'office' ? '#edc658' : '#e8efed'; c.strokeStyle = '#19262d'; c.lineWidth = 2;
  c.beginPath(); c.arc(x, y, 10, 0, Math.PI * 2); c.fill(); c.stroke();
  c.font = 'bold 13px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#13232b'; c.fillText(ICONS[p.kind], x, y);
  if (label) {
    c.font = '600 12px system-ui'; c.textAlign = 'left'; c.strokeStyle = '#142029'; c.lineWidth = 4;
    c.strokeText(p.name, x + 15, y); c.fillStyle = '#fff'; c.fillText(p.name, x + 15, y);
  }
}

function routeLine(c: CanvasRenderingContext2D, r: Route | null, point: (p: RoadPoint) => { x: number; y: number }) {
  if (!r?.points.length) return;
  c.beginPath(); r.points.forEach((p, i) => { const q = point(p); if (!i) c.moveTo(q.x, q.y); else c.lineTo(q.x, q.y); });
  c.lineJoin = 'round'; c.lineCap = 'round'; c.strokeStyle = '#15212b'; c.lineWidth = 7; c.stroke();
  c.strokeStyle = '#f4cc54'; c.lineWidth = 4; c.stroke();
}

/** World map and the small heading-up map share one waypoint and one city image. */
export class WorldMap {
  private readonly image = cityImage();
  private readonly canvas = h('canvas', { tabindex: '0', role: 'img', 'aria-label': 'North-up island map. Drag or use arrow keys to pan, scroll or plus and minus to zoom. Choose a destination from the places list, click a road, or press Enter to pick the road at the centre.' });
  private readonly small = h('canvas', { width: 360, height: 360, role: 'img', 'aria-label': 'Heading-up street minimap. The white arrow is you.' });
  private readonly note = h('p.map-location', { role: 'status', 'aria-live': 'polite' });
  private readonly destination = h('p.map-destination', { role: 'status', 'aria-live': 'polite' }, 'Pick a place to see what to do there.');
  private readonly distance = h('span.map-distance');
  private readonly district = h('div.map-district', { role: 'status', 'aria-live': 'polite', hidden: true });
  private readonly mini = h('section.city-minimap', { hidden: true, 'aria-label': 'Street map' }, this.small,
    h('div.map-chips', {}, h('button', { type: 'button', onclick: () => this.toggle(), 'aria-label': 'Open world map (M)' }, 'M Map'),
      h('button', { type: 'button', onclick: () => this.controls(), 'aria-label': 'Open controls (?)' }, '? Keys')), this.distance);
  private modal: Modal | null = null;
  private frame: MapFrame = { x: 0, z: 0, heading: 0, cameraHeading: Math.PI, speed: 0, onIsland: true };
  private waypoint: (RoadPoint & { name: string; blurb: string }) | null = null;
  private path: Route | null = null;
  private routedFrom: RoadPoint | null = null;
  private lastRoute = -Infinity;
  private lastUpdate = -Infinity;
  private visible = false;
  private districtName = '';
  private districtUntil = 0;
  private zoom = 1;
  private center: RoadPoint = { x: 0, z: 0 };
  private width = 800;
  private height = 600;
  private peers: MapPeer[] = [];
  private drag: { x: number; y: number; center: RoadPoint; moved: boolean; id: number } | null = null;
  private readonly resize = new ResizeObserver(([entry]) => {
    this.width = entry.contentRect.width; this.height = entry.contentRect.height;
    const dpr = Math.min(2, devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.round(this.width * dpr)); this.canvas.height = Math.max(1, Math.round(this.height * dpr));
    this.drawWorld();
  });

  constructor(root: HTMLElement, private readonly readPeers: () => MapPeer[]) {
    root.append(this.mini, this.district);
    this.resize.observe(this.canvas);
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.canvas.setPointerCapture(e.pointerId);
      this.drag = { x: e.offsetX, y: e.offsetY, center: { ...this.center }, moved: false, id: e.pointerId };
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.drag || this.drag.id !== e.pointerId) return;
      const dx = e.offsetX - this.drag.x, dy = e.offsetY - this.drag.y;
      if (Math.hypot(dx, dy) > 4) this.drag.moved = true;
      this.center = { x: this.drag.center.x - dx / this.scale(), z: this.drag.center.z - dy / this.scale() };
      this.drawWorld();
    });
    this.canvas.addEventListener('pointerup', (e) => {
      if (!this.drag || this.drag.id !== e.pointerId) return;
      if (!this.drag.moved) this.pick(this.unproject(e.offsetX, e.offsetY));
      this.drag = null;
      this.canvas.releasePointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointercancel', () => { this.drag = null; });
    this.canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); this.clear(); });
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault(); this.zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.001));
    }, { passive: false });
  }

  private scale() { return Math.min(this.width, this.height) / SIZE * this.zoom; }
  private project = (p: RoadPoint) => ({ x: this.width / 2 + (p.x - this.center.x) * this.scale(), y: this.height / 2 + (p.z - this.center.z) * this.scale() });
  private unproject(x: number, y: number): RoadPoint { return { x: this.center.x + (x - this.width / 2) / this.scale(), z: this.center.z + (y - this.height / 2) / this.scale() }; }
  private zoomAt(x: number, y: number, factor: number) {
    const at = this.unproject(x, y); this.zoom = Math.max(0.7, Math.min(8, this.zoom * factor));
    const after = this.unproject(x, y); this.center.x += at.x - after.x; this.center.z += at.z - after.z;
    this.drawWorld();
  }

  /** M toggles even while the map has focus; other office windows keep their own keys. */
  key(e: KeyboardEvent): boolean {
    if (this.modal && this.modal.backdrop === document.querySelector('#modal-root > .backdrop:last-child')) {
      if (e.code === 'KeyM' && !e.shiftKey) { if (!e.repeat) this.modal.close(); }
      else if (e.code === 'Backspace') this.clear();
      else if (e.key === '+' || e.key === '=') this.zoomAt(this.width / 2, this.height / 2, 1.25);
      else if (e.key === '-') this.zoomAt(this.width / 2, this.height / 2, 0.8);
      else if (e.target === this.canvas && e.key === 'Enter') this.pick(this.center);
      else if (e.target === this.canvas && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        this.center.x += (e.key === 'ArrowRight' ? 60 : e.key === 'ArrowLeft' ? -60 : 0) / this.scale();
        this.center.z += (e.key === 'ArrowDown' ? 60 : e.key === 'ArrowUp' ? -60 : 0) / this.scale(); this.drawWorld();
      } else return false;
      return true;
    }
    return false;
  }

  toggle() {
    if (this.modal) return this.modal.close();
    if (modalOpen()) return;
    this.center = { x: 0, z: 0 }; this.zoom = 1;
    const list = h('div.map-places', {}, ...places().map((p) => h('button', { type: 'button', title: p.blurb, onclick: () => this.setWaypoint(p) },
      h('span', { 'aria-hidden': 'true' }, ICONS[p.kind]), h('span', {}, p.name, h('small', {}, p.blurb)))));
    const legend = h('div.map-buildings', { 'aria-label': 'Building colours' }, ...Object.entries(COLORS).map(([kind, color]) => h('span', {}, h('i', { style: `background:${color}` }), kind)));
    const el = h('section.modal.worldmap', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'World map' },
      h('header', {}, h('div', {}, h('h2', {}, 'World map'), this.note), h('button', { type: 'button', onclick: () => this.modal?.close() }, 'Close · M / Esc')),
      h('div.map-body', {}, h('div.map-viewport', {}, this.canvas, h('span.map-north', { 'aria-hidden': 'true' }, '↑ N'),
        h('div.map-tools', {}, h('button', { type: 'button', 'aria-label': 'Zoom in', onclick: () => this.zoomAt(this.width / 2, this.height / 2, 1.25) }, '+'),
          h('button', { type: 'button', 'aria-label': 'Zoom out', onclick: () => this.zoomAt(this.width / 2, this.height / 2, 0.8) }, '−'),
          h('button', { type: 'button', onclick: () => { this.center = { x: this.frame.x, z: this.frame.z }; this.drawWorld(); } }, 'Find me'))),
        h('aside', {}, h('h3', {}, 'Places & things to do'), this.destination, h('button', { type: 'button', onclick: () => this.clear() }, 'Clear waypoint'), list, legend)),
      h('footer', {}, 'Drag to pan · scroll or + / − to zoom · click a place or road to navigate · right-click / Backspace to clear'));
    let release = () => {};
    this.modal = openModal(el, { closeButton: false, backdropCloses: false, onClose: () => { this.modal = null; this.drag = null; release(); } });
    this.modal.backdrop.classList.add('worldmap-backdrop');
    release = focusDialog(el);
    this.drawWorld();
  }

  controls() {
    if (modalOpen()) return;
    const groups = [
      ['Walking', [['W / S · A / D', 'Move'], ['Shift · Space', 'Run · jump'], ['Mouse / drag', 'Look / orbit camera'], ['Settings', 'First / third person'], ['E', 'Use / interact']]],
      ['Driving', [['W / S · A / D', 'Accelerate / brake · steer'], ['Space · Shift', 'Handbrake · boost'], ['Q · H · E', 'Camera · horn · get out']]],
      ['Race circuit', [['R', 'Join grid / start race'], ['W / S · A / D', 'Drive; follow the checkpoints'], ['E', 'Use the gate to return to the city']]],
      ['Arena', [['Mouse · left / right click', 'Look · fire / aim'], ['R · Tab', 'Reload · hold scoreboard'], ['W / S · A / D · Space', 'Move · jump']]],
      ['Everywhere', [['M · ? · Esc', 'Map · controls · close'], ['T / Enter · V', 'Chat · hold to talk'], ['Shift + M', 'Mute / unmute voice']]],
    ] as const;
    const el = h('section.modal.map-controls', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Game controls' }, h('header', {}, h('h2', {}, 'Controls')),
      h('div.body', {}, ...groups.map(([name, rows]) => h('section', {}, h('h3', {}, name), h('dl', {}, ...rows.map(([key, action]) => h('div', {}, h('dt', {}, key), h('dd', {}, action))))))));
    let release = () => {};
    openModal(el, { onClose: () => release() });
    release = focusDialog(el);
  }

  private pick(at: RoadPoint) {
    const near = [...places()].sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z))[0];
    if (Math.hypot(near.x - at.x, near.z - at.z) * this.scale() <= 18) this.setWaypoint(near);
    else {
      const road = snapToRoad(at);
      if (Math.hypot(road.x - at.x, road.z - at.z) <= 6) this.setWaypoint({ ...road, name: 'Road waypoint', blurb: 'Follow the marked streets.' });
    }
  }
  private setWaypoint(at: RoadPoint & { name: string; blurb: string }) {
    this.waypoint = at; this.routedFrom = null; this.refreshRoute();
    text(this.destination, `${at.name} · ${at.blurb} Follow the gold streets; the dotted end is the approach on foot.`);
    this.drawWorld();
  }
  private clear() { this.waypoint = null; this.path = null; this.routedFrom = null; text(this.destination, 'Waypoint cleared. Pick a place or road.'); text(this.distance, ''); this.drawWorld(); }
  private refreshRoute() {
    if (!this.waypoint) return;
    this.path = route(this.frame, this.waypoint); this.routedFrom = { x: this.frame.x, z: this.frame.z };
  }

  private drawRoute(c: CanvasRenderingContext2D, point: (p: RoadPoint) => { x: number; y: number }) {
    routeLine(c, this.path, point);
    const end = this.path?.points.at(-1);
    if (!end || !this.waypoint) return;
    const a = point(end), b = point(this.waypoint);
    c.beginPath(); c.setLineDash([4, 5]); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y);
    c.strokeStyle = '#f4cc54'; c.lineWidth = 2; c.stroke(); c.setLineDash([]);
  }

  /** main.ts decides whether you're down on the city street. */
  setVisible(visible: boolean) {
    this.visible = visible;
    const hidden = !visible || modalOpen();
    if (this.mini.hidden !== hidden) this.mini.hidden = hidden;
  }

  /** Uses the game's frame loop, capped at 10 Hz; routes only change after you've moved a little. */
  update(now: number, frame: MapFrame) {
    if (now - this.lastUpdate < 100) return;
    this.lastUpdate = now;
    if (frame.onIsland) this.frame = frame;
    this.mini.hidden = !this.visible || modalOpen();
    const district = districtAt(this.frame.x, this.frame.z);
    text(this.note, frame.onIsland ? `You are in ${district}` : `Island map · last city position in ${district}`);
    if (this.visible && district !== this.districtName) {
      if (this.districtName) { text(this.district, `Entering ${district}`); this.districtUntil = now + 3000; }
      this.districtName = district;
    }
    this.district.hidden = !this.visible || modalOpen() || now >= this.districtUntil;
    if (this.waypoint && frame.onIsland && Math.hypot(frame.x - this.waypoint.x, frame.z - this.waypoint.z) < 15) {
      const name = this.waypoint.name; this.clear(); text(this.destination, `Arrived at ${name}.`);
    }
    if (this.waypoint && frame.onIsland && now - this.lastRoute >= 1000 && (!this.routedFrom || Math.hypot(frame.x - this.routedFrom.x, frame.z - this.routedFrom.z) > 5)) {
      this.refreshRoute(); this.lastRoute = now;
    }
    if (this.mini.hidden && !this.modal) return;
    this.peers = frame.onIsland ? this.readPeers() : [];
    if (this.modal) this.drawWorld();
    if (!this.mini.hidden) this.drawMini();
  }

  private drawWorld() {
    if (!this.modal || !this.width || !this.height) return;
    const c = this.canvas.getContext('2d')!;
    c.setTransform(this.canvas.width / this.width, 0, 0, this.canvas.height / this.height, 0, 0);
    c.fillStyle = '#142a38'; c.fillRect(0, 0, this.width, this.height);
    const corner = this.project({ x: -EXTENT, z: -EXTENT });
    c.drawImage(this.image, corner.x, corner.y, SIZE * this.scale(), SIZE * this.scale());
    c.font = '700 15px system-ui'; c.textAlign = 'center'; c.fillStyle = '#c4d3cc';
    for (const d of DISTRICT_LABELS) { const q = this.project(d); c.fillText(d.name.toUpperCase(), q.x, q.y); }
    this.drawRoute(c, this.project);
    if (this.waypoint) {
      const q = this.project(this.waypoint);
      c.beginPath(); c.arc(q.x, q.y, 16, 0, Math.PI * 2); c.strokeStyle = '#f4cc54'; c.lineWidth = 3; c.stroke();
    }
    for (const p of places()) { const q = this.project(p); icon(c, p, q.x, q.y, p.kind !== 'park' || this.zoom > 1.8 || p.id === 'plaza'); }
    for (const peer of this.peers) { const q = this.project(peer); c.beginPath(); c.arc(q.x, q.y, 4, 0, Math.PI * 2); c.fillStyle = peer.color; c.fill(); c.strokeStyle = '#fff'; c.lineWidth = 1; c.stroke(); c.font = '11px system-ui'; c.fillStyle = '#fff'; c.fillText(peer.name, q.x, q.y - 10); }
    const you = this.project(this.frame); arrow(c, you.x, you.y, Math.PI - this.frame.heading);
  }

  private drawMini() {
    const c = this.small.getContext('2d')!;
    const heading = this.frame.cameraHeading;
    const scale = 0.85 / (1 + Math.min(Math.abs(this.frame.speed), 75) / 45);
    const point = (p: RoadPoint) => { const q = mapOffset(p, this.frame, heading, scale); return { x: 90 + q.x, y: 90 + q.y }; };
    c.setTransform(2, 0, 0, 2, 0, 0); c.clearRect(0, 0, 180, 180);
    c.save(); c.beginPath(); c.arc(90, 90, 88, 0, Math.PI * 2); c.clip();
    c.fillStyle = '#142a38'; c.fillRect(0, 0, 180, 180);
    c.save(); c.translate(90, 90); c.rotate(heading + Math.PI); c.scale(scale, scale); c.translate(-this.frame.x, -this.frame.z);
    c.drawImage(this.image, -EXTENT, -EXTENT, SIZE, SIZE); c.restore();
    this.drawRoute(c, point);
    for (const p of places()) { const q = point(p); if (Math.hypot(q.x - 90, q.y - 90) < 80) icon(c, p, q.x, q.y, false); }
    for (const peer of this.peers) { const q = point(peer); c.fillStyle = peer.color; c.beginPath(); c.arc(q.x, q.y, 3, 0, Math.PI * 2); c.fill(); }
    if (this.waypoint) {
      const q = waypointIndicator(mapOffset(this.waypoint, this.frame, heading, scale), 76);
      if (q.offEdge) arrow(c, 90 + q.x, 90 + q.y, q.angle, '#f4cc54');
      else { c.fillStyle = '#f4cc54'; c.beginPath(); c.arc(90 + q.x, 90 + q.y, 5, 0, Math.PI * 2); c.fill(); }
      const end = this.path?.points.at(-1);
      const start = this.path?.points[0];
      const distance = (this.path?.distance ?? 0) + (end ? Math.hypot(this.waypoint.x - end.x, this.waypoint.z - end.z) : 0)
        + (start ? Math.hypot(this.frame.x - start.x, this.frame.z - start.z) : 0);
      text(this.distance, `${this.waypoint.name} · ${Math.round(distance)} m`);
    } else text(this.distance, districtAt(this.frame.x, this.frame.z));
    arrow(c, 90, 90, heading - this.frame.heading);
    const north = point({ x: this.frame.x, z: this.frame.z - 100 / scale });
    const n = waypointIndicator({ x: north.x - 90, y: north.y - 90 }, 75);
    c.font = 'bold 11px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#fff'; c.fillText('N', 90 + n.x, 90 + n.y);
    c.restore();
  }
}
