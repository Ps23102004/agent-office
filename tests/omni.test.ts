import test from 'node:test';
import assert from 'node:assert/strict';
import { agentProviders, configuredProvider, isValidOmniModel, omniLaunchArgs, validateWorkerEffort, validateWorkerModel } from '../src/server/agents.js';
import { createOmniModelCatalogue } from '../src/server/models.js';
import { usageOfMessage, addUsage, zeroUsage } from '../src/server/usage.js';
import { isAgentProvider, runsClaudeCode } from '../src/shared/protocol.js';

test('omni is its own provider that runs Claude Code', () => {
  assert.equal(configuredProvider('/Users/me/.local/bin/omni'), 'omni');
  assert.equal(isAgentProvider('omni'), true);
  assert.equal(runsClaudeCode('omni'), true);
  assert.equal(runsClaudeCode('claude'), true);
  assert.equal(runsClaudeCode('grok'), false);
});

test('omni is only offered when the command exists (or is the configured agent)', () => {
  assert.equal(agentProviders('claude').includes('omni'), false);
  assert.equal(agentProviders('claude', true).includes('omni'), true);
  assert.equal(agentProviders('omni').includes('omni'), true);
  assert.equal(agentProviders('custom', true).at(-1), 'custom');
});

test('the model goes before every flag, and is left out when none was chosen', () => {
  assert.deepEqual(omniLaunchArgs(['--settings', '/s.json', '--effort', 'high'], 'gpt-6-sol'), ['gpt-6-sol', '--settings', '/s.json', '--effort', 'high']);
  assert.deepEqual(omniLaunchArgs(['--settings', '/s.json'], undefined), ['--settings', '/s.json']);
});

test('agent args cannot override the probed model, and omni-only flags stay in front', () => {
  assert.deepEqual(omniLaunchArgs(['--model', 'gpt-6-sol', '--model=x', '--fast', '--verbose'], 'gemini-3.8-flash-high'), ['--fast', 'gemini-3.8-flash-high', '--verbose']);
  assert.deepEqual(omniLaunchArgs(['--full-context', '--fast'], undefined), ['--full-context']);
});

test('omni model ids reject flags and unsafe characters', () => {
  for (const ok of ['gpt-6-sol', 'gemini-3.8-flash-high', 'gemma4:e4b-mlx', 'gpt-6-sol[1m]']) assert.equal(isValidOmniModel(ok), true, ok);
  for (const bad of ['', '-p', '--model', 'a b', 'a;b', 'a\nb', '$(x)', 'x'.repeat(129), 5]) assert.equal(isValidOmniModel(bad), false, String(bad));
  assert.equal(validateWorkerModel('agent', 'omni', '--fast'), 'Invalid Omni model');
  assert.equal(validateWorkerModel('agent', 'omni', 'gpt-6-sol'), undefined);
  assert.equal(validateWorkerEffort('agent', 'omni', 'high'), undefined);
});

test('the model catalogue reads the proxy, caches, and rejects unsafe ids', async () => {
  let calls = 0;
  let now = 0;
  const fetcher = (async () => {
    calls++;
    return new Response(JSON.stringify({ data: [{ id: 'gpt-6-sol' }, { id: '--evil' }, { id: 'gpt-6-sol' }, { id: 'claude-sonnet-4-6' }] }));
  }) as typeof fetch;
  const catalogue = createOmniModelCatalogue(fetcher, () => now);
  assert.deepEqual(await catalogue.get(), ['gpt-6-sol', 'claude-sonnet-4-6']);
  await catalogue.get();
  assert.equal(calls, 1);
  now = 61_000;
  await catalogue.get();
  assert.equal(calls, 2);
  const down = createOmniModelCatalogue((async () => new Response('', { status: 500 })) as typeof fetch);
  await assert.rejects(down.get());
});

test('a non-Claude model is not priced as Opus', () => {
  const tokens = { input_tokens: 1000, output_tokens: 1000 };
  const gpt = usageOfMessage('gpt-6-sol[1m]', tokens);
  assert.equal(gpt.cost, 0);
  assert.equal(gpt.costKnown, false);
  assert.equal(addUsage(zeroUsage(), gpt).costKnown, false);
  const claude = usageOfMessage('claude-sonnet-4-6', tokens);
  assert.ok(claude.cost > 0);
  assert.equal(claude.costKnown, undefined);
  assert.ok(usageOfMessage('', tokens).cost > 0);
  assert.ok(usageOfMessage('anthropic/claude-sonnet-4-6[1m]', tokens).cost > 0);
  assert.equal(usageOfMessage('gpt-opus-local', tokens).costKnown, false);
  assert.equal(usageOfMessage('gpt-sonnet-x', tokens).cost, 0);
});

test('an unpriced message only marks a total partial once the flag is dropped for the ledger', () => {
  const known = usageOfMessage('claude-sonnet-4-6', { input_tokens: 1000 });
  const total = addUsage(known, usageOfMessage('gpt-6-sol', { input_tokens: 500 }));
  assert.equal(total.cost, known.cost);
  assert.equal(total.unpricedTokens, 500);
  const { costKnown: _c, ...ledgerSide } = total;
  assert.equal(addUsage(zeroUsage(), ledgerSide).costKnown, undefined);
});
