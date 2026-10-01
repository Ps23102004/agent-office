import { RACE, type Racer, type RaceState } from '../../shared/race';

/** Race clocks use whole hundredths, so they never round up into the next minute. */
export function raceTime(ms?: number): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return '—';
  const ticks = Math.floor(ms / 10);
  return `${Math.floor(ticks / 6000)}:${String(Math.floor(ticks / 100) % 60).padStart(2, '0')}.${String(ticks % 100).padStart(2, '0')}`;
}

/** The office owns the order; a grid slot breaks ties before it has set positions. */
export function raceOrder(state: RaceState): Racer[] {
  return [...state.racers].sort((a, b) => (a.position || Infinity) - (b.position || Infinity) || a.slot - b.slot);
}

/** Laps behind, else the office-timed gap at the last line (Racer.gap), else checkpoints behind: never invented seconds. */
export function raceGap(state: RaceState, racer: Racer): string {
  const leader = raceOrder(state)[0];
  if (!leader) return '—';
  if (leader.id === racer.id) return 'Leading';
  if (leader.finishedAt !== undefined && racer.finishedAt !== undefined) {
    return `+${((Math.max(0, racer.finishedAt - leader.finishedAt)) / 1000).toFixed(2)}s`;
  }
  const laps = Math.max(0, leader.lap - racer.lap);
  if (laps) return `+${laps} lap${laps === 1 ? '' : 's'}`;
  // The office's own clock at the last line they went through: how long after the first one through it.
  if (racer.gap !== undefined && racer.gap > 0) return `+${(racer.gap / 1000).toFixed(2)}s`;
  const gates = Math.max(0, leader.checkpoint - racer.checkpoint);
  return gates ? `+${gates} checkpoint${gates === 1 ? '' : 's'}` : 'Same checkpoint';
}

/** Five reds build up, then go out together. Late messages use the same office clock. */
export function countdownLights(startsAt: number | undefined, now: number): { lit: number; text: string } {
  if (startsAt === undefined || !Number.isFinite(startsAt)) return { lit: 0, text: 'Getting ready' };
  const left = Math.ceil((startsAt - now) / 1000);
  if (left <= 0) return { lit: 0, text: 'GO!' };
  return { lit: Math.max(0, Math.min(RACE.countdown, RACE.countdown - left + 1)), text: `Start in ${left}` };
}

/** There are no simulated gears: D, N and R show direction, and bikes say PEDAL. */
export function speedReading(speed: number, top: number, bicycle = false) {
  const v = Number.isFinite(speed) ? speed : 0;
  return {
    kmh: Math.round(Math.abs(v) * 3.6),
    mode: Math.abs(v) < 0.15 ? 'N' : v < 0 ? 'R' : bicycle ? 'PEDAL' : 'D',
    fill: Number.isFinite(top) && top > 0 ? Math.min(1, Math.abs(v) / top) : 0,
  };
}

export interface MapPoint { x: number; z: number }

/** Keep the real outline's proportions inside a 160 px square, with room for dots at its edges. */
export function mapProjection(outline: readonly MapPoint[]): ((p: MapPoint) => { x: number; y: number }) | null {
  if (outline.length < 2 || outline.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.z))) return null;
  const minX = Math.min(...outline.map((p) => p.x));
  const maxX = Math.max(...outline.map((p) => p.x));
  const minZ = Math.min(...outline.map((p) => p.z));
  const maxZ = Math.max(...outline.map((p) => p.z));
  const span = Math.max(maxX - minX, maxZ - minZ);
  if (!span) return null;
  const scale = 136 / span;
  return (p) => ({ x: 80 + (p.x - (minX + maxX) / 2) * scale, y: 80 + (p.z - (minZ + maxZ) / 2) * scale });
}
