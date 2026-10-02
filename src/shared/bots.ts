// Bots: players the office runs itself (server/arenabots.ts), so someone on their own still gets a
// match. To everyone else a bot is an ordinary peer (PeerInfo.bot) and an ordinary arena player
// (ArenaPlayer.bot): it walks, aims and fires through the same rules and the same shot judge as a
// person, so it can't see or shoot through cover. How good it is comes from its level below.

/** How hard the bots are. */
export type BotLevel = 'easy' | 'normal' | 'hard' | 'insane';
export const BOT_LEVELS: readonly BotLevel[] = ['easy', 'normal', 'hard', 'insane'];
export const isBotLevel = (l: unknown): l is BotLevel => BOT_LEVELS.includes(l as BotLevel);

/** The arena's bot setting (ArenaState.bots): bots top it up to `fill` players, people included. */
export interface BotSettings {
  /** Players wanted in all, people and bots (1: no bots). */
  fill: number;
  level: BotLevel;
  /** Who last changed it, if anyone has. */
  by?: string;
}

/**
 * Bots top a match up to 4 at normal until someone says otherwise; never more than 8 in all. The
 * setting changes at most once a second (`every`, ms): a change sooner is refused with a warning.
 */
export const BOTS = { fill: 4, level: 'normal' as BotLevel, players: 8, every: 1000 } as const;

/** A bot's id starts with this; anything else is a person. */
export const BOT_ID = 'bot:';
export const isBot = (id: string) => id.startsWith(BOT_ID);

/** What they're called (each with a 🤖 in front, so nobody takes one for a person). */
export const BOT_NAMES = ['Rex', 'Nova', 'Bolt', 'Vex', 'Juno', 'Kilo', 'Ash', 'Moxie', 'Tank', 'Pip'] as const;

/** What a bot at one level is like. Angles in radians, times in ms unless they say otherwise. */
export interface BotSkill {
  /** From first seeing someone to its first shot at them (less, someone turning up where it was already aiming: see server/arenabots.ts PREAIM). */
  reaction: readonly [number, number];
  /** Its aim's error (standard deviation, each way) as it starts on someone, the best it settles to, and how fast (s). */
  sigma0: number;
  sigmaMin: number;
  tau: number;
  /**
   * How far behind someone moving it aims (s): eyes trail a strafe. Its hand wobbles as much again
   * round that, so the faster they cross its sights (close in), the wider it goes.
   */
  trail: number;
  /** How fast it can turn (rad/s): no snapping round. */
  turn: number;
  /** Half the width of what it notices ahead, and how far off it hears a shot (m). */
  fov: number;
  hear: number;
  /** Furthest (m) it opens fire from: further off, it closes in first. */
  reach: number;
  /** Furthest (m) it takes a shot at just the top of someone's head over something low: further off, it closes in first. */
  crown: number;
  /** How long it stands still before a burst (a counter-strafe: shots on the move go wide). */
  settle: number;
  /**
   * The share of its bursts it fires as it should: stood still, and no longer than the range calls for.
   * The rest it fires on the move and holds the trigger twice as long, as a beginner does.
   */
  discipline: number;
  /** Between bursts, how long it strafes (ADAD) before stopping to shoot again, and each way for how long. */
  pause: readonly [number, number];
  adad: readonly [number, number];
  /** The share of a fight it spends moving side to side; the rest it stands there flat-footed, as a beginner does. */
  strafe: number;
  /** How much of the gun's kick it pulls back down (0-1). */
  recoil: number;
  /** The share of its shots it puts at the head, once settled on someone slow enough to. */
  head: number;
  /**
   * The share of its fights it takes from round a corner where there's one a step or two away: out for a
   * burst, back out of sight between them (anyone shooting back has to find it again each time).
   */
  peek: number;
  /** Health under which it gets out of their sight (if that's a step or two away). */
  cover: number;
  /** Crouches to shoot (where it still sees them from down there). */
  crouch: boolean;
}

const DEG = Math.PI / 180;

/**
 * Each level: easy a beginner (slow to react and turn, wild, flat-footed half the time and spraying on
 * the move the rest), normal an average player, hard a skilled one (stops to shoot, taps at range,
 * crouches, takes fights from round a corner), insane a top player or better, but not an aimbot: it
 * still has to see you, react and turn, and it misses someone strafing across it close in.
 * Against the scripted test player standing in the open with three bots (scripts/playtest/arena.mjs,
 * 40 s a level), they land about 18%, 30%, 40% and 56% of all their shots (at anyone), kill the test
 * player about 2, 3.5, 4.5 and 5.5 times and are killed by them about 6, 4.5, 4 and 2.5 times; any one
 * 40 s match's hit rate is 4 to 7 points either side of that, and its kills a kill or two. One bot
 * against someone strafing 15 m off: tests/arenabots.test.ts.
 */
export const SKILL: Record<BotLevel, BotSkill> = {
  easy: { reaction: [600, 850], sigma0: 0.09, sigmaMin: 0.032, tau: 0.9, trail: 0.12, turn: 4, fov: 45 * DEG, hear: 55, reach: 30, crown: 10, settle: 200, discipline: 0.4, pause: [500, 800], adad: [500, 1000], strafe: 0.3, peek: 0, recoil: 0.3, head: 0, cover: 25, crouch: false },
  normal: { reaction: [330, 450], sigma0: 0.05, sigmaMin: 0.016, tau: 0.5, trail: 0.1, turn: 6, fov: 50 * DEG, hear: 60, reach: 38, crown: 14, settle: 150, discipline: 0.7, pause: [350, 600], adad: [350, 750], strafe: 0.6, peek: 0.2, recoil: 0.6, head: 0.1, cover: 35, crouch: false },
  hard: { reaction: [220, 290], sigma0: 0.032, sigmaMin: 0.012, tau: 0.3, trail: 0.06, turn: 8, fov: 55 * DEG, hear: 65, reach: 42, crown: 18, settle: 100, discipline: 0.92, pause: [150, 300], adad: [250, 550], strafe: 0.9, peek: 0.6, recoil: 0.85, head: 0.3, cover: 40, crouch: true },
  insane: { reaction: [160, 210], sigma0: 0.024, sigmaMin: 0.007, tau: 0.2, trail: 0.03, turn: 10, fov: 60 * DEG, hear: 75, reach: 55, crown: 22, settle: 50, discipline: 1, pause: [80, 180], adad: [200, 450], strafe: 1, peek: 0.8, recoil: 0.95, head: 0.45, cover: 40, crouch: true },
};
