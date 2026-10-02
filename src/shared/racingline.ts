import { TRACK, track } from './circuit.js';

// The line a quick car takes round the circuit: out wide before a corner, in to its apex, out wide
// again after it, crossing the track down the straights in between. The circuit draws the rubber
// laid down along it (darker asphalt) and the skid marks into the corners you brake for.

/** How far in from the edge of the asphalt the line runs at its widest (m). */
const MARGIN = 1.8;
/**
 * The least straight between two corners (m) for the line to go out wide between them. Closer than
 * that (a chicane, the esses, the complex) it runs from one apex straight to the next: going out
 * wide for the one and in again for the other in a few metres would swerve across the track.
 */
const LINK = 150;
/** How far before a corner the line turns in from out wide, and how far after it it's out wide again, at most (m). */
const REACH = 70;

let keys: { s: number; d: number }[] | null = null;

/** Where the line is at each corner's turn-in, apex and exit, in order round the lap. */
function lineKeys(): { s: number; d: number }[] {
  if (keys) return keys;
  const { corners, length: L } = track();
  const wide = TRACK.width / 2 - MARGIN;
  const out: { s: number; d: number }[] = [];
  corners.forEach((c, i) => {
    // A gentle kink hardly moves it; a corner of 60° or more takes the whole width.
    const k = Math.min(1, Math.abs(c.turn) / 60) * wide;
    // + is the driver's left: a right turn's inside is to the right.
    const inside = c.turn > 0 ? -k : k;
    // The straights either side of it (round the lap's end for the first and last corners).
    const prev = corners[(i - 1 + corners.length) % corners.length], next = corners[(i + 1) % corners.length];
    const before = (c.s0 - prev.s1 + L) % L, after = (next.s0 - c.s1 + L) % L;
    if (before >= LINK) out.push({ s: c.s0 - Math.min(REACH, before / 2.5), d: -inside });
    out.push({ s: (c.s0 + c.s1) / 2, d: inside });
    if (after >= LINK) out.push({ s: c.s1 + Math.min(REACH, after / 2.5), d: -inside });
  });
  // Round the lap's end, so the line joins up over the start.
  const sorted = out.map((p) => ({ s: ((p.s % L) + L) % L, d: p.d })).sort((a, b) => a.s - b.s);
  return (keys = sorted);
}

/** How far off the centre line (m, + to a driver's left) the racing line is `s` metres round the lap. */
export function racingLine(s: number): number {
  const L = track().length;
  const k = lineKeys();
  const u = ((s % L) + L) % L;
  let i = k.findIndex((p) => p.s > u);
  if (i < 0) i = 0;
  const b = k[i];
  const a = k[(i - 1 + k.length) % k.length];
  const span = (b.s - a.s + L) % L || L;
  const t = ((u - a.s + L) % L) / span;
  const e = t * t * (3 - 2 * t);
  return a.d + (b.d - a.d) * e;
}

/** How much rubber is down `s` metres round, `d` off the centre line: 0 to 1, most along the racing line. */
export function rubber(s: number, d: number): number {
  const off = (d - racingLine(s)) / 1.7;
  return Math.exp(-off * off);
}
