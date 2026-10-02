import { isBot, type BotLevel } from '../shared/bots';
import type { ArenaState } from '../shared/arena';
import type { RaceState } from '../shared/race';

interface Names {
  peers: ReadonlyMap<string, { name: string }>;
  race: Pick<RaceState, 'racers' | 'practice'>;
  arena: Pick<ArenaState, 'players'>;
}

/** Race bots drive ordinary cars but aren't peers. Use the game's roster for their names. */
export function playerName(id: string, source: Names): string {
  if (isBot(id)) return [...source.race.racers, ...source.race.practice, ...source.arena.players]
    .find((p) => p.id === id)?.name ?? source.peers.get(id)?.name ?? '🤖 Bot';
  return source.peers.get(id)?.name ?? source.arena.players.find((p) => p.id === id)?.name ?? 'Someone';
}

export function botLabel(name: string): string {
  return name.startsWith('🤖') ? name : `🤖 ${name}`;
}

export function botName(name: string, level?: BotLevel): string {
  return `${botLabel(name)} · BOT${level ? ` · ${level}` : ''}`;
}
