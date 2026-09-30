import { execFile as nodeExecFile } from 'node:child_process';
import { isValidGrokModel, isValidOmniModel, isValidOpenCodeModel } from './agents.js';

export const MODEL_COMMAND_TIMEOUT_MS = 10_000;
export const MODEL_COMMAND_MAX_BUFFER = 1024 * 1024;
export const MODEL_CACHE_TTL_MS = 60_000;

export interface ModelCommandOptions {
  cwd: string;
  timeout: number;
  maxBuffer: number;
}

export type ModelCommandRunner = (
  file: string,
  args: string[],
  options: ModelCommandOptions,
) => Promise<{ stdout: string; stderr: string }>;

const runModelCommand: ModelCommandRunner = (file, args, options) => new Promise((resolve, reject) => {
  nodeExecFile(file, args, { ...options, encoding: 'utf8' }, (error, stdout, stderr) => {
    if (error) return reject(error);
    resolve({ stdout: String(stdout), stderr: String(stderr) });
  });
});

/** Run `opencode models` without a shell and return only safe, model-shaped lines. */
export async function fetchOpenCodeModels(command: string, cwd: string, runner: ModelCommandRunner = runModelCommand): Promise<string[]> {
  try {
    const result = await runner(command, ['models'], {
      cwd,
      timeout: MODEL_COMMAND_TIMEOUT_MS,
      maxBuffer: MODEL_COMMAND_MAX_BUFFER,
    });
    const models: string[] = [];
    const seen = new Set<string>();
    for (const raw of result.stdout.replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g, '').split(/\r?\n/)) {
      const model = raw.trim().replace(/^[-*]\s+/, '');
      if (isValidOpenCodeModel(model) && !seen.has(model)) {
        seen.add(model);
        models.push(model);
      }
    }
    return models;
  } catch {
    throw new Error('OpenCode model catalogue unavailable');
  }
}

export interface OpenCodeModelCatalogue {
  get(): Promise<string[]>;
}

/** Run `grok models` without a shell and return only safe model ids. */
export async function fetchGrokModels(command: string, cwd: string, runner: ModelCommandRunner = runModelCommand): Promise<string[]> {
  try {
    const result = await runner(command, ['models'], {
      cwd,
      timeout: MODEL_COMMAND_TIMEOUT_MS,
      maxBuffer: MODEL_COMMAND_MAX_BUFFER,
    });
    const models: string[] = [];
    const seen = new Set<string>();
    for (const raw of result.stdout.replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g, '').split(/\r?\n/)) {
      const model = raw.trim().replace(/^[-*]\s+/, '').replace(/\s*\(default\)\s*$/i, '').trim();
      if (isValidGrokModel(model) && !seen.has(model)) {
        seen.add(model);
        models.push(model);
      }
    }
    return models;
  } catch {
    throw new Error('Grok model catalogue unavailable');
  }
}

export interface GrokModelCatalogue {
  get(): Promise<string[]>;
}

export function createGrokModelCatalogue(
  command: string,
  cwd: string,
  runner: ModelCommandRunner = runModelCommand,
  now: () => number = Date.now,
): GrokModelCatalogue {
  let cached: { models: string[]; expiresAt: number } | undefined;
  let pending: Promise<string[]> | undefined;
  return {
    get() {
      const current = now();
      if (cached && current < cached.expiresAt) return Promise.resolve([...cached.models]);
      if (pending) return pending;
      pending = fetchGrokModels(command, cwd, runner).then((models) => {
        cached = { models, expiresAt: now() + MODEL_CACHE_TTL_MS };
        return [...models];
      }).finally(() => {
        pending = undefined;
      });
      return pending;
    },
  };
}

export function createOpenCodeModelCatalogue(
  command: string,
  cwd: string,
  runner: ModelCommandRunner = runModelCommand,
  now: () => number = Date.now,
): OpenCodeModelCatalogue {
  let cached: { models: string[]; expiresAt: number } | undefined;
  let pending: Promise<string[]> | undefined;
  return {
    get() {
      const current = now();
      if (cached && current < cached.expiresAt) return Promise.resolve([...cached.models]);
      if (pending) return pending;
      pending = fetchOpenCodeModels(command, cwd, runner).then((models) => {
        cached = { models, expiresAt: now() + MODEL_CACHE_TTL_MS };
        return [...models];
      }).finally(() => {
        pending = undefined;
      });
      return pending;
    },
  };
}

export const OMNI_PROXY_URL = 'http://127.0.0.1:8317';
const OMNI_MODELS_TIMEOUT_MS = 3_000;

/** The model ids the local proxy behind `omni` serves (GET /v1/models). */
export async function fetchOmniModels(fetcher: typeof fetch = fetch, url = OMNI_PROXY_URL): Promise<string[]> {
  try {
    const res = await fetcher(`${url}/v1/models`, { signal: AbortSignal.timeout(OMNI_MODELS_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { data?: unknown };
    const ids = Array.isArray(body.data) ? body.data.map((m: any) => m?.id) : [];
    return [...new Set(ids.filter(isValidOmniModel))];
  } catch {
    throw new Error('Omni model catalogue unavailable');
  }
}

export function createOmniModelCatalogue(fetcher: typeof fetch = fetch, now: () => number = Date.now, url = OMNI_PROXY_URL): GrokModelCatalogue {
  let cached: { models: string[]; expiresAt: number } | undefined;
  let pending: Promise<string[]> | undefined;
  return {
    get() {
      if (cached && now() < cached.expiresAt) return Promise.resolve([...cached.models]);
      if (pending) return pending;
      pending = fetchOmniModels(fetcher, url).then((models) => {
        cached = { models, expiresAt: now() + MODEL_CACHE_TTL_MS };
        return [...models];
      }).finally(() => {
        pending = undefined;
      });
      return pending;
    },
  };
}
