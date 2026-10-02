// A gamepad for driving (the Gamepad API, in the standard layout an Xbox or PlayStation pad has):
// the left stick steers, the right trigger's the gas and the left one the brake (then reverse), A
// (Cross) the handbrake, X (Square) or RB the boost, LB or the right stick's click looks back; Y
// (Triangle) gets you out, B (Circle) puts you back on the track at the circuit, View (Select)
// swaps the camera and the left stick's click sounds the horn. Read once a frame (main.ts).

/** What the pad says this frame. */
export interface Pad {
  /** The left stick: +1 hard left to -1 hard right, as Pedals.turn. */
  turn: number;
  /** The triggers, 0 to 1. */
  gas: number;
  brake: number;
  handbrake: boolean;
  boost: boolean;
  lookBack: boolean;
  /** Pressed since the last frame. */
  tapped: Set<PadTap>;
}

export type PadTap = 'out' | 'reset' | 'view' | 'horn';

/** The standard layout's buttons. */
const B = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, view: 8, l3: 10, r3: 11 } as const;
const TAPS: [PadTap, number][] = [['out', B.y], ['reset', B.b], ['view', B.view], ['horn', B.l3]];
/** How far the stick moves before it steers (a worn stick doesn't sit quite in the middle), and how a nudge curves up to full lock. */
const DEAD = 0.12;
const CURVE = 1.5;

let held: boolean[] = [];

/** The stick past its dead zone, curved so small moves steer finely: -1 to 1. */
export function stick(x: number): number {
  const m = (Math.abs(x) - DEAD) / (1 - DEAD);
  return m <= 0 ? 0 : Math.sign(x) * Math.min(1, m) ** CURVE;
}

/** The first pad plugged in (one in the standard layout if there's a choice), or null. */
export function readPad(): Pad | null {
  const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? [...navigator.getGamepads()].filter((g): g is Gamepad => !!g?.connected) : [];
  const g = pads.find((p) => p.mapping === 'standard') ?? pads[0];
  if (!g) {
    held = [];
    return null;
  }
  const down = (i: number) => !!g.buttons[i]?.pressed;
  // A trigger at rest can read a hair off nothing.
  const trigger = (i: number) => ((g.buttons[i]?.value ?? 0) < 0.05 ? 0 : g.buttons[i].value);
  const tapped = new Set<PadTap>();
  for (const [tap, i] of TAPS) if (down(i) && !held[i]) tapped.add(tap);
  held = g.buttons.map((b) => b.pressed);
  return {
    turn: -stick(g.axes[0] ?? 0),
    gas: trigger(B.rt),
    brake: trigger(B.lt),
    handbrake: down(B.a),
    boost: down(B.x) || down(B.rb),
    lookBack: down(B.lb) || down(B.r3),
    tapped,
  };
}
