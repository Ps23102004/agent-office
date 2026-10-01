import { GRID, PERIOD, STREET_X, STREET_Z, surfaceAt } from './city.js';

export interface RoadPoint { x: number; z: number }
export interface RoadSegment { a: RoadPoint; b: RoadPoint }
export interface Route { points: RoadPoint[]; distance: number }

const distance = (a: RoadPoint, b: RoadPoint) => Math.hypot(a.x - b.x, a.z - b.z);
const lines = (origin: number, lo: number, hi: number) => {
  const out: number[] = [];
  for (let k = Math.ceil((lo - origin) / PERIOD); origin + k * PERIOD <= hi; k++) out.push(origin + k * PERIOD);
  return out;
};
const xs = lines(STREET_X, GRID.minX, GRID.maxX);
const zs = lines(STREET_Z, GRID.minZ, GRID.maxZ);
const roads: RoadSegment[] = [];
for (const x of xs) for (let j = 1; j < zs.length; j++) roads.push({ a: { x, z: zs[j - 1] }, b: { x, z: zs[j] } });
for (const z of zs) for (let i = 1; i < xs.length; i++) roads.push({ a: { x: xs[i - 1], z }, b: { x: xs[i], z } });

/** The city's road centres, including the ring road. No streets continue out into the sea. */
export function roadSegments(): readonly RoadSegment[] { return roads; }

function nearest(p: RoadPoint) {
  let best = { point: roads[0].a, edge: 0, distance: Infinity };
  roads.forEach(({ a, b }, edge) => {
    const dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz)));
    const point = { x: a.x + t * dx, z: a.z + t * dz };
    const d = distance(p, point);
    if (d < best.distance) best = { point, edge, distance: d };
  });
  return best;
}

/** The nearest place on a road, even when you picked a building or the beach. */
export function snapToRoad(p: RoadPoint): RoadPoint { return nearest(p).point; }

/**
 * The shortest drive between two spots, snapped to road centres. The ends are on the road:
 * reaching a building's door or a landmark past the ring road is a separate walk from there.
 */
export function route(from: RoadPoint, to: RoadPoint): Route | null {
  if (![from.x, from.z, to.x, to.z].every(Number.isFinite)) return null;
  const start = nearest(from), end = nearest(to);
  const nodes: RoadPoint[] = [];
  const ids = new Map<string, number>();
  const edges: { to: number; cost: number }[][] = [];
  const node = (p: RoadPoint) => {
    const key = `${p.x},${p.z}`;
    if (ids.has(key)) return ids.get(key)!;
    const id = nodes.length;
    ids.set(key, id); nodes.push(p); edges.push([]);
    return id;
  };
  const link = (a: number, b: number) => {
    const cost = distance(nodes[a], nodes[b]);
    edges[a].push({ to: b, cost }); edges[b].push({ to: a, cost });
  };
  roads.forEach(({ a, b }, i) => {
    // Split the road at your start and destination, so a short trip on one street doesn't detour.
    const points = [a, b, ...(start.edge === i ? [start.point] : []), ...(end.edge === i ? [end.point] : [])]
      .sort((p, q) => distance(a, p) - distance(a, q));
    for (let j = 1; j < points.length; j++) {
      const p = points[j - 1], q = points[j];
      if (surfaceAt((p.x + q.x) / 2, (p.z + q.z) / 2) === 'road') link(node(p), node(q));
    }
  });
  const a = node(start.point), b = node(end.point);
  const costs = nodes.map(() => Infinity), previous = nodes.map(() => -1);
  const open = new Set(nodes.map((_, i) => i));
  costs[a] = 0;
  while (open.size) {
    let next = -1;
    for (const i of open) if (next < 0 || costs[i] < costs[next]) next = i;
    if (!Number.isFinite(costs[next])) return null;
    if (next === b) break;
    open.delete(next);
    for (const edge of edges[next]) if (open.has(edge.to) && costs[next] + edge.cost < costs[edge.to]) {
      costs[edge.to] = costs[next] + edge.cost; previous[edge.to] = next;
    }
  }
  const points: RoadPoint[] = [];
  for (let i = b; i >= 0; i = previous[i]) points.unshift(nodes[i]);
  return { points, distance: costs[b] };
}
