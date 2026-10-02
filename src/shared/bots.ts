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
  /** From first seeing someone to its first shot at them. */
  reaction: readonly [number, number];
  /** Its aim's error (standard deviation, each way) as it starts on someone, the best it settles to, and how fast (s). */
  sigma0: number;
  sigmaMin: number;
  tau: number;
  /** How far behind someone moving it aims (s): eyes trail a strafe. */
  trail: number;
  /** How fast it can turn (rad/s). */
  turn: number;
  /** Half the width of what it notices ahead, and how far off it hears a shot (m). */
  fov: number;
  hear: number;
  /** Shots in a burst, and the pause after one. */
  burst: readonly [number, number];
  pause: readonly [number, number];
  /** How much of the rifle's kick it pulls back down (0-1). */
  recoil: number;
  /** The share of its shots it puts at the head. */
  head: number;
  /** Health under which it breaks off for cover. */
  cover: number;
  /** Stands still to shoot, as a good player does, rather than spraying on the move. */
  plant: boolean;
}

const DEG = Math.PI / 180;

/**
 * Each level. From first sight of someone strafing at walking pace 15 m off (tests/arenabots.test.ts,
 * 30 duels each, median kill, against the judge's head ball and body column): easy hits 35% of its
 * shots and kills in about 3.35 s, normal 54% in 1.3 s, hard 75% in 0.8 s, insane 92% in 0.6 s.
 * Judged against people (Jev, from the near-same numbers before the judge changed): easy plays like
 * a beginner, normal an average player, hard a skilled one, insane a top player or better. What keeps insane beatable is that it has to see you
 * first, react and turn.
 */
export const SKILL: Record<BotLevel, BotSkill> = {
  easy: { reaction: [400, 550], sigma0: 0.049, sigmaMin: 0.027, tau: 0.7, trail: 0.12, turn: 5, fov: 55 * DEG, hear: 25, burst: [2, 4], pause: [500, 800], recoil: 0.3, head: 0, cover: 30, plant: false },
  normal: { reaction: [260, 380], sigma0: 0.042, sigmaMin: 0.0175, tau: 0.45, trail: 0.08, turn: 8, fov: 60 * DEG, hear: 40, burst: [3, 6], pause: [250, 450], recoil: 0.6, head: 0.1, cover: 45, plant: false },
  hard: { reaction: [200, 280], sigma0: 0.035, sigmaMin: 0.012, tau: 0.3, trail: 0.05, turn: 12, fov: 70 * DEG, hear: 60, burst: [5, 9], pause: [120, 250], recoil: 0.85, head: 0.3, cover: 50, plant: true },
  insane: { reaction: [170, 230], sigma0: 0.03, sigmaMin: 0.008, tau: 0.22, trail: 0.035, turn: 16, fov: 80 * DEG, hear: 80, burst: [6, 12], pause: [80, 160], recoil: 0.95, head: 0.4, cover: 50, plant: true },
};
