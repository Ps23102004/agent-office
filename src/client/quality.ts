// How much the 3D office draws, for a computer that has better things to do than heat up (⚙️ Settings, Graphics).

export type Graphics = 'battery' | 'balanced' | 'full';
export const GRAPHICS: Graphics[] = ['battery', 'balanced', 'full'];

export interface Quality {
  /** The most frames drawn a second (Infinity: as many as the screen shows). */
  fps: number;
  /** The most the canvas draws per CSS pixel; a screen with fewer than that gets what it has. */
  pixelRatio: number;
  /** The sun's shadow map, in pixels a side. */
  shadowSize: number;
  /** Shadows are only redrawn when the sun or someone near you moved, and at least this often (ms); 0 redraws them every frame. */
  shadowEvery: number;
  /** Something moving redraws them no more often than this (ms), so a car at speed doesn't mean every frame. */
  shadowMoveEvery: number;
  /** The dog, the holiday's bats and lights and the city's cars update this many times a second; 0 is every frame. */
  decorHz: number;
  /** How much of the rain and snow is drawn. */
  weather: number;
  /** How often (ms) a laptop screen is repainted when it's near, in between and far off. */
  laptopMs: [near: number, mid: number, far: number];
  /** The ground's and walls' grain up close (world/surface.ts): pixels a side of its tile. */
  detail: 256 | 512;
}

export const QUALITY: Record<Graphics, Quality> = {
  battery: { fps: 30, pixelRatio: 1.25, shadowSize: 1024, shadowEvery: 500, shadowMoveEvery: 100, decorHz: 15, weather: 0.5, laptopMs: [500, 500, 3000], detail: 256 },
  balanced: { fps: 60, pixelRatio: 1.5, shadowSize: 2048, shadowEvery: 250, shadowMoveEvery: 50, decorHz: 0, weather: 1, laptopMs: [150, 600, 2000], detail: 512 },
  full: { fps: Infinity, pixelRatio: 2, shadowSize: 2048, shadowEvery: 0, shadowMoveEvery: 0, decorHz: 0, weather: 1, laptopMs: [150, 600, 2000], detail: 512 },
};

/** The level in force. One object that's changed in place, so what reads it always sees the current one. */
export const quality: Quality = { ...QUALITY.battery };

export function setGraphics(g: Graphics) {
  Object.assign(quality, QUALITY[g]);
}

/** What the canvas draws per CSS pixel on a screen of this density. */
export const pixelRatioFor = (q: Quality, dpr: number) => Math.min(dpr, q.pixelRatio);

/**
 * For things that only need updating `decorHz` times a second: each call gives the time to
 * update by (all that's gone by since the last update), or 0 when it's not time yet.
 */
export function decorTicker(): (dt: number) => number {
  let owed = 0;
  return (dt) => {
    owed += dt;
    if (quality.decorHz && owed < 1 / quality.decorHz) return 0;
    const due = owed;
    owed = 0;
    return due;
  };
}

/** Whether a frame at `now` (ms) is too soon after the last one drawn to keep to `fps`. A little slack, for a screen whose refresh doesn't divide evenly. */
export const tooSoon = (now: number, last: number, fps: number) => now - last < 1000 / fps - 2;

/**
 * How long (ms) after the last shadow redraw something moving may redraw them again. A car fast enough
 * to outrun its shadow gets them up to 30 times a second, never more, and on battery no sooner at all.
 */
export const shadowMoveGap = (q: Quality, carFast: boolean) => (carFast && q.fps > 30 ? Math.min(q.shadowMoveEvery, 33) : q.shadowMoveEvery);
