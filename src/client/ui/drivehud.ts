import { h, modalOpen } from './dom';
import { boostAvailable, speedReading } from './race-view';
import './map.css';

export interface DrivingGauge {
  name: string;
  /** Signed forward speed and the vehicle's top speed, in m/s. */
  speed: number;
  top: number;
  bicycle?: boolean;
  passenger?: boolean;
  /** Only the driver of a car can use the boost. */
  boost?: number;
  boosting?: boolean;
}

const text = (el: HTMLElement, value: string) => { if (el.textContent !== value) el.textContent = value; };

/** One gauge for the city and the circuit, updated by RaceUI's existing 10 Hz HUD loop. */
export class DriveHUD {
  private readonly speed = h('strong');
  private readonly vehicle = h('span.drive-vehicle');
  private readonly fill = h('i');
  private readonly meter = h('div.drive-boost-track', { role: 'meter', 'aria-label': 'Boost remaining', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 0 }, this.fill);
  private readonly boostLabel = h('span');
  private readonly arc = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  readonly effect = h('div.drive-rush', { hidden: true, 'aria-hidden': 'true' });
  readonly el = h('section.drive-hud', { hidden: true, 'aria-label': 'Driving speed and boost' }, this.vehicle,
    h('div.drive-dial', {}, h('div.drive-reading', {}, this.speed, h('span', {}, 'km/h'))),
    h('div.drive-boost-label', {}, h('strong', {}, 'BOOST'), this.boostLabel), this.meter);

  constructor() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 180 115'); svg.setAttribute('aria-hidden', 'true');
    const track = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    for (const path of [track, this.arc]) {
      path.setAttribute('d', 'M 22 99 A 72 72 0 1 1 158 99'); path.setAttribute('pathLength', '100');
      path.setAttribute('fill', 'none'); path.setAttribute('stroke-width', '5');
    }
    track.setAttribute('stroke', '#ffffff30'); this.arc.setAttribute('stroke', '#f4cc54');
    this.arc.setAttribute('stroke-dasharray', '100'); svg.append(track, this.arc);
    this.el.querySelector('.drive-dial')!.prepend(svg);
  }

  update(driving: DrivingGauge | null) {
    const visible = !!driving && !modalOpen();
    this.el.hidden = !visible;
    const canBoost = boostAvailable(driving);
    const boosting = canBoost && !!driving?.boosting;
    this.effect.hidden = !visible || !boosting;
    if (!driving || !visible) return;
    const reading = speedReading(driving.speed, driving.top, driving.bicycle);
    text(this.speed, String(reading.kmh));
    text(this.vehicle, `${driving.name}${driving.passenger ? ' · Passenger' : driving.speed < -0.5 ? ' · Reverse' : ''}`);
    this.arc.setAttribute('stroke-dashoffset', String(100 * (1 - reading.fill)));
    const boost = Number.isFinite(driving.boost) ? Math.max(0, Math.min(1, driving.boost!)) : 0;
    this.fill.style.transform = `scaleX(${boost})`;
    this.meter.setAttribute('aria-valuenow', String(Math.round(boost * 100)));
    this.meter.hidden = !canBoost;
    text(this.boostLabel, !canBoost ? 'Unavailable' : boosting ? 'Active' : `${Math.round(boost * 100)}% · Shift`);
    this.el.classList.toggle('boosting', boosting);
  }
}
