import type { RoadPoint } from '../../shared/route';

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
