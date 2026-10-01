import { route, snapToRoad, type RoadPoint, type Route } from '../../shared/route';
import { FLOOR, inWing } from '../../shared/layout';
import { venueAt } from '../../shared/venues';
import { districtAt, type District } from '../../shared/places';
import { coastAt } from '../../shared/city';

/** Street +z is south; turn the map so the way you're looking is up the screen. */
export function mapOffset(at: RoadPoint, you: RoadPoint, heading: number, scale: number): { x: number; y: number } {
  const angle = heading + Math.PI;
  const x = (at.x - you.x) * scale, y = (at.z - you.z) * scale;
  return { x: x * Math.cos(angle) - y * Math.sin(angle), y: x * Math.sin(angle) + y * Math.cos(angle) };
}

/** Keep the waypoint inside the circular map, pointing toward it when it's out of view. */
export function waypointIndicator(offset: { x: number; y: number }, radius: number) {
  const distance = Math.hypot(offset.x, offset.y);
  const factor = distance > radius ? radius / distance : 1;
  return { x: offset.x * factor, y: offset.y * factor, offEdge: distance > radius, angle: Math.atan2(offset.y, offset.x) + Math.PI / 2 };
}

/** Firefox can send lines rather than pixels; a page is the height of the map. */
export function wheelPixels(delta: number, mode: number, height: number): number {
  return delta * (mode === 1 ? 16 : mode === 2 ? height : 1);
}

/** Keep some of the island in view, even after a long drag or zooming at an edge. */
export function clampMapCenter(center: RoadPoint, width: number, height: number, scale: number): RoadPoint {
  // Keep 50 m of land visible at the coast, with room to centre even the lighthouse when zoomed in.
  const limit = coastAt(Math.atan2(center.z, center.x)).land - 50 + Math.min(width, height) / (2 * scale);
  const distance = Math.hypot(center.x, center.z), factor = distance > limit ? limit / distance : 1;
  return { x: center.x * factor, z: center.z * factor };
}

/** The little map is for the street, not inside the office, its wing or a café. */
export function onCityStreet(at: RoadPoint, wing = 0): boolean {
  const office = at.x >= FLOOR.minX && at.x <= FLOOR.maxX && at.z >= FLOOR.minZ && at.z <= FLOOR.maxZ;
  return !office && !inWing(at.x, at.z, wing) && !venueAt(at.x, at.z);
}

/** Reach the last street along the road, then finish any dotted approach on foot. */
export function waypointArrival(at: RoadPoint, waypoint: RoadPoint, path: Route | null, approached = false) {
  const end = path?.points.at(-1);
  if (!approached && end && Math.hypot(at.x - end.x, at.z - end.z) <= 15) {
    const road = snapToRoad(at), offRoad = Math.hypot(at.x - road.x, at.z - road.z);
    if (offRoad <= 6) {
      const remaining = route(at, end);
      approached = !!remaining && remaining.distance + offRoad <= 15;
    }
  }
  return { approached, arrived: approached && Math.hypot(at.x - waypoint.x, at.z - waypoint.z) < 15 };
}

/** A boundary needs two seconds or 30 m in the new district; banners are five seconds apart. */
export class DistrictBanner {
  name: District | null = null;
  private pending: { name: District; since: number; at: RoadPoint } | null = null;
  private changed = -Infinity;

  update(now: number, at: RoadPoint): District | null {
    const name = districtAt(at.x, at.z);
    if (!this.name) { this.name = name; return null; }
    if (name === this.name) { this.pending = null; return null; }
    if (this.pending?.name !== name) this.pending = { name, since: now, at: { ...at } };
    const p = this.pending;
    if (now - this.changed < 5000 || (now - p.since < 2000 && Math.hypot(at.x - p.at.x, at.z - p.at.z) < 30)) return null;
    this.name = name; this.pending = null; this.changed = now;
    return name;
  }

  /** Time spent indoors or off the island doesn't count toward crossing a boundary. */
  pause() { this.pending = null; }
}

export interface MapLabel { id: string; x: number; y: number; width: number; priority: number }
export interface LabelBox { x: number; y: number; width: number; height: number }

/** Keep the important names first and leave out any that would cover another name or icon. */
export function mapLabels(labels: MapLabel[], width: number, height: number, reserved: LabelBox[] = []) {
  const boxes = [...reserved];
  const out: (MapLabel & { left: number; top: number })[] = [];
  for (const label of [...labels].sort((a, b) => b.priority - a.priority)) {
    for (const [left, top] of [[label.x + 15, label.y - 8], [label.x - label.width - 15, label.y - 8], [label.x - label.width / 2, label.y - 30], [label.x - label.width / 2, label.y + 15]]) {
      const box = { x: left - 3, y: top - 3, width: label.width + 6, height: 22 };
      if (box.x < 0 || box.y < 0 || box.x + box.width > width || box.y + box.height > height) continue;
      if (boxes.some((b) => box.x < b.x + b.width && box.x + box.width > b.x && box.y < b.y + b.height && box.y + box.height > b.y)) continue;
      boxes.push(box); out.push({ ...label, left, top }); break;
    }
  }
  return out;
}
