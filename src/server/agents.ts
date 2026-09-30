import path from 'node:path';
import { isAgentEffort, isClaudeModel, type AgentProvider } from '../shared/protocol.js';

export const OPEN_CODE_MODEL_MAX = 256;
export const GROK_MODEL_MAX = 64;
export const MUSE_MODEL_MAX = 128;
export const OMNI_MODEL_MAX = 128;

/**
 * Finds the provider represented by the configured executable.  Keep this deliberately based on
 * the final path component: --agent may be an absolute path, and Windows paths can be supplied
 * while the office itself is running under a POSIX shell.
 */
export function configuredProvider(command: string): AgentProvider {
  const base = path.basename(command.replaceAll('\\', '/')).toLowerCase().replace(/\.exe$/, '');
  if (base === 'claude') return 'claude';
  if (base === 'opencode') return 'opencode';
  if (base === 'codex') return 'codex';
  if (base === 'grok') return 'grok';
  if (base === 'muse') return 'muse';
  if (base === 'omni') return 'omni';
  return 'custom';
}

/** The providers an office started with `configured` can hire: the ones it knows, and a custom --agent only when that's what it was started with. */
export function agentProviders(configured: AgentProvider, omniAvailable = false): AgentProvider[] {
  const list: AgentProvider[] = ['claude', 'opencode', 'codex', 'grok', 'muse'];
  // Omni is a local wrapper script, so it is only offered where the `omni` command actually exists.
  if (omniAvailable || configured === 'omni') list.push('omni');
  if (configured === 'custom') list.push('custom');
  return list;
}

/** OpenCode model ids are argv values, so reject anything that could be ambiguous or unsafe. */
export function isValidOpenCodeModel(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > OPEN_CODE_MODEL_MAX) return false;
  if (/[\s\p{Cc}\p{Cf}]/u.test(value)) return false;
  const parts = value.split('/');
  return parts.length >= 2 && /^[A-Za-z0-9_.][A-Za-z0-9_.-]*$/.test(parts[0]) && parts.slice(1).every((part) => part.length > 0);
}

/** Grok model ids are argv values (`grok-4.6`), so reject anything that could be ambiguous or unsafe. */
export function isValidGrokModel(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > GROK_MODEL_MAX) return false;
  if (/[\s\p{Cc}\p{Cf}]/u.test(value)) return false;
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
}

/** Muse model ids are argv values (`muse-spark-1.3-contributor`), so reject anything ambiguous or unsafe. */
export function isValidMuseModel(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MUSE_MODEL_MAX) return false;
  if (/[\s\p{Cc}\p{Cf}]/u.test(value)) return false;
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
}

/**
 * Omni model ids are the first positional argument of `omni`, which only treats it as a model when
 * it doesn't start with '-'. Ids such as `gemma4:e4b-mlx` carry a colon, so allow that too.
 */
export function isValidOmniModel(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > OMNI_MODEL_MAX) return false;
  return /^[A-Za-z0-9][A-Za-z0-9._:\[\]-]*$/.test(value);
}

/**
 * Arranges argv for `omni`. It reads --fast/--full-context, then a model, only from the very front, so
 * those go first and the model right after. A `--model` in the office's agent args is dropped: omni
 * passes its own to Claude Code, and a stray one would override the model omni probed under OMNI_STRICT.
 */
export function omniLaunchArgs(args: string[], model: string | undefined): string[] {
  let window: string | undefined;
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--fast' || a === '--full-context') window ??= a;
    else if (a === '--model') i++;
    else if (!a.startsWith('--model=')) rest.push(a);
  }
  return [...(window ? [window] : []), ...(model ? [model] : []), ...rest];
}

export function validateWorkerModel(kind: 'agent' | 'shell', provider: AgentProvider | undefined, model: unknown): string | undefined {
  if (model === undefined) return undefined;
  if (kind === 'shell') return 'Shell workers do not have an agent model';
  if (provider === 'claude') return isClaudeModel(model) ? undefined : 'Invalid Claude model (expected fable, opus, sonnet or haiku)';
  if (provider === 'grok') return isValidGrokModel(model) ? undefined : 'Invalid Grok model';
  if (provider === 'muse') return isValidMuseModel(model) ? undefined : 'Invalid Muse model';
  if (provider === 'omni') return isValidOmniModel(model) ? undefined : 'Invalid Omni model';
  if (provider !== 'opencode') return 'Models can only be selected for Claude Code, OpenCode, Grok, Muse or Omni workers';
  if (!isValidOpenCodeModel(model)) return 'Invalid OpenCode model (expected provider/model without whitespace)';
  return undefined;
}

/** Claude Code, Grok, Muse and Omni reasoning-effort flags. */
export function validateWorkerEffort(kind: 'agent' | 'shell', provider: AgentProvider | undefined, effort: unknown): string | undefined {
  if (effort === undefined) return undefined;
  if (kind === 'shell') return 'Shell workers do not have a reasoning effort';
  if (provider !== 'claude' && provider !== 'grok' && provider !== 'muse' && provider !== 'omni') return 'Reasoning effort can only be selected for Claude Code, Grok, Muse or Omni workers';
  return isAgentEffort(effort) ? undefined : 'Invalid effort (expected low, medium, high, xhigh or max)';
}
