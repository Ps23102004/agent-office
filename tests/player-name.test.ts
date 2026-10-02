import test from 'node:test';
import assert from 'node:assert/strict';
import { playerName, botLabel, botName } from '../src/client/player-name.js';
import { idleRace } from '../src/shared/race.js';
import { idleArena } from '../src/shared/arena.js';

test('car labels find race and practice bots without inventing peers', () => {
  const source = { peers: new Map([['person', { name: 'Ann' }]]), race: idleRace(), arena: idleArena() };
  source.race.racers.push({ id: 'bot:race:1', name: '🤖 Nova', bot: 'hard', car: 0, slot: 0, position: 1, lap: 0, checkpoint: 0 });
  source.race.practice.push({ id: 'bot:race:2', name: '🤖 Rex', bot: 'easy', rabbitOf: 'person', car: 1, laps: 0, checkpoint: 0 });
  assert.equal(playerName('person', source), 'Ann');
  assert.equal(playerName('bot:race:1', source), '🤖 Nova');
  assert.equal(playerName('bot:race:2', source), '🤖 Rex');
  assert.equal(source.peers.size, 1);
  assert.equal(playerName('bot:missing', source), '🤖 Bot');
  assert.equal(playerName('missing', source), 'Someone');
});

test('arena bots resolve from the arena roster and tags never repeat the robot icon', () => {
  const source = { peers: new Map<string, { name: string }>(), race: idleRace(), arena: idleArena() };
  source.arena.players.push({ id: 'bot:arena:1', name: '🤖 Bolt', bot: true, kills: 0, deaths: 0, streak: 0, hp: 100, alive: true, w: 'rifle' });
  assert.equal(playerName('bot:arena:1', source), '🤖 Bolt');
  assert.equal(botName('🤖 Bolt', 'insane'), '🤖 Bolt · BOT · insane');
  assert.equal(botName('Bolt', 'easy'), '🤖 Bolt · BOT · easy');
  assert.equal(botLabel('Bolt'), '🤖 Bolt');
  assert.equal(botLabel('🤖 Bolt'), '🤖 Bolt');
});
