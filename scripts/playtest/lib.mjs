// The playtest harness's core: an office server of its own, a headless Chrome signed in to it, and
// the handful of helpers every scenario needs. It drives the REAL built game (dist/), never a mock,
// so `npm run build` first. It needs a GPU: headless Chrome draws with ANGLE on Metal here (30 fps on
// Battery, ~100 on Full); SwiftShader manages about 3 fps, too slow for anything that moves.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
/** The checkout whose built game is played: this one, or PLAYTEST_GAME (another branch's, built), to compare. */
export const GAME = path.resolve(process.env.PLAYTEST_GAME ?? REPO);

/**
 * Starts `bin/agent-office.js` on `port` with a fresh data dir of its own and the weather pinned (so
 * screenshots compare); resolves once /login answers. stop() takes it down, pty host and all.
 */
export async function startServer({ port = 4718, weather = 'clear' } = {}) {
  if (port === 4700) throw new Error('4700 is the real office: pick another PLAYTEST_PORT');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ao-playtest-'));
  // detached: its own process group, so stop() takes the pty host child down with it.
  const child = spawn(process.execPath, [path.join(GAME, 'bin/agent-office.js'), dir, '--port', String(port), '--password', 'dev', '--no-open', '--weather', weather], {
    cwd: GAME,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const url = `http://127.0.0.1:${port}`;
  const t0 = Date.now();
  for (;;) {
    if (child.exitCode !== null) throw new Error(`server exited:\n${log}`);
    try {
      if ((await fetch(`${url}/login`)).ok) break;
    } catch {}
    if (Date.now() - t0 > 20_000) throw new Error(`server not up after 20 s:\n${log}`);
    await sleep(200);
  }
  return {
    url,
    log: () => log,
    // SIGINT, not SIGTERM: SIGTERM is a restart (src/server/cli.ts) and leaves the pty host running.
    // Resolves once it's gone, so the port's free for the next.
    stop: async () => {
      const gone = child.exitCode !== null ? Promise.resolve() : new Promise((r) => child.once('exit', r));
      try {
        process.kill(-child.pid, 'SIGINT');
      } catch {}
      await Promise.race([gone, sleep(5000)]);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The Chrome playwright wants if it's downloaded, else the newest one it has (playwright-core can be ahead of `npx playwright install`). */
function chromePath() {
  if (existsSync(chromium.executablePath())) return undefined;
  const root = path.join(os.homedir(), 'Library/Caches/ms-playwright');
  const dirs = existsSync(root) ? readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => +b.split('-')[1] - +a.split('-')[1]) : [];
  for (const d of dirs) {
    const p = path.join(root, d, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
    if (existsSync(p)) return p;
  }
  throw new Error('No Chrome for playwright: run `npx playwright install chromium`');
}

export async function launch() {
  return chromium.launch({
    headless: true,
    executablePath: chromePath(),
    args: [
      '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist',
      // Keep a hidden or occluded headless page drawing: the game's frame loop sleeps while it's hidden.
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      '--autoplay-policy=no-user-gesture-required', '--mute-audio',
    ],
  });
}

const LOOK = { skin: 1, hair: 1, style: 1 };

/**
 * A signed-in page with the office loaded and you standing on a floor: past the login, the title,
 * the character select and the 2D-view offer. `graphics` is the Graphics setting (battery, balanced,
 * full). Every toast is logged in the page (window.__toasts: text, when, and which floor you were on).
 */
export async function openOffice(browser, server, { name = 'Playtest', width = 1280, height = 720, graphics = 'battery', view = 'first' } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  // On the context's own request client, so the session cookie lands in the context.
  const res = await context.request.post(`${server.url}/api/login`, { data: { name: '', password: 'dev' } });
  if (!res.ok()) throw new Error(`login ${res.status()}`);
  await context.addInitScript(([profile, settings]) => {
    try {
      localStorage.setItem('agent-office.settings', JSON.stringify(settings));
      localStorage.setItem('agent-office.profile', JSON.stringify(profile)); // else the character select holds the boot
      localStorage.setItem('agent-office.lite-declined', '1'); // the "running slowly, try 2D" offer covers screenshots
    } catch {}
    // A headless tab can say it's hidden, and the frame loop sleeps while it is.
    Object.defineProperty(Document.prototype, 'hidden', { get: () => false });
    Object.defineProperty(Document.prototype, 'visibilityState', { get: () => 'visible' });
  }, [{ name, color: '#4f86f7', look: LOOK }, { graphics, view }]);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const t0 = Date.now();
  await page.goto(`${server.url}/?skipTitle`);
  await page.waitForFunction(() => {
    const o = window.__office;
    const l = document.getElementById('loading');
    return o && o.store.floor && (!l || l.classList.contains('gone'));
  }, null, { timeout: 90_000, polling: 250 });
  await page.evaluate(() => {
    const o = window.__office;
    window.__toasts = [];
    new MutationObserver((ms) => {
      for (const m of ms) for (const n of m.addedNodes) window.__toasts.push({ t: Math.round(performance.now()), text: n.textContent, floor: o.store.floor });
    }).observe(document.getElementById('toasts'), { childList: true });
  });
  return { page, context, errors, bootMs: Date.now() - t0 };
}

/** A trip (the elevator, a gate) is over: the lights are up and you have the controls. */
export async function settled(page, timeout = 20_000) {
  await page.waitForFunction(() => !document.getElementById('fade')?.classList.contains('on') && window.__office.player.enabled, null, { timeout, polling: 100 });
}

/** Frames drawn per second over `ms`, and the longest gap between two: renders of the main scene (the outline pass draws it twice a frame). */
export async function measureFps(page, ms = 3000) {
  return page.evaluate((ms) => new Promise((resolve) => {
    const o = window.__office, r = o.renderer, orig = r.render;
    let frames = 0, worst = 0, last = performance.now();
    r.render = function (scene, cam) {
      if (scene === o.scene) {
        frames++;
        const now = performance.now();
        worst = Math.max(worst, now - last);
        last = now;
      }
      return orig.call(this, scene, cam);
    };
    setTimeout(() => {
      r.render = orig;
      resolve({ fps: +(frames / 2 / (ms / 1000)).toFixed(1), worstGapMs: Math.round(worst) });
    }, ms);
  }), ms);
}

/** Holds `codes` (KeyboardEvent.code) down for `ms`: real key presses, through playwright. */
export async function hold(page, codes, ms) {
  for (const c of codes) await page.keyboard.down(c);
  await page.waitForTimeout(ms);
  for (const c of codes) await page.keyboard.up(c);
}

/** Samples the car you're driving every `everyMs` in the page; stopTelemetry() returns the rows. */
export async function startTelemetry(page, everyMs = 50) {
  await page.evaluate((every) => {
    const o = window.__office;
    const rows = (window.__telemetry = []);
    const t0 = performance.now();
    const r = (n) => Math.round(n * 1000) / 1000;
    window.__telemetryTimer = setInterval(() => {
      const d = o.driver, p = d.pose;
      if (!p) return;
      rows.push({ t: r((performance.now() - t0) / 1000), x: r(p.x), z: r(p.z), rotY: r(p.rotY), speed: r(p.speed), slip: r(p.slip ?? 0), steer: r(p.steer ?? 0), yaw: r(p.yaw ?? 0), boost: r(d.boost), keys: ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'Space', 'ShiftLeft'].filter((k) => o.player.keys?.has?.(k)).join('') });
    }, every);
  }, everyMs);
}

export async function stopTelemetry(page) {
  return page.evaluate(() => {
    clearInterval(window.__telemetryTimer);
    return window.__telemetry;
  });
}

/**
 * Puts three.js on window.THREE (the same version the game is built with), for measuring in the page
 * with Raycaster and Box3: the game bundles its own copy and doesn't expose it.
 */
export async function withThree(page) {
  await page.route('**/__three/**', (r) => r.fulfill({ contentType: 'text/javascript', body: readFileSync(path.join(REPO, 'node_modules/three', r.request().url().split('/__three/')[1])) }));
  await page.addScriptTag({ type: 'module', content: "import * as T from '/__three/build/three.module.js'; window.THREE = T;" });
  await page.waitForFunction(() => window.THREE);
}

/**
 * A clear early afternoon with the holiday decorations down, so screenshots compare from run to run
 * (in October the office dresses up for Halloween, sky and all). Eases in over a couple of seconds.
 */
export async function daylight(page) {
  await page.evaluate(() => {
    const o = window.__office;
    o.net.send({ t: 'theme.set', pick: 'off' });
    o.sky.show({ hour: 13, weather: 'clear' });
  });
  await page.waitForTimeout(2000);
  // "… took the holiday decorations down": the harness's own doing, not something to judge.
  await page.evaluate(() => document.getElementById('toasts')?.replaceChildren());
}

/** Brightness spread, near-black and magenta (a missing texture) of a screenshot, decoded by the browser itself. */
export async function pixelStats(page, png) {
  return page.evaluate(async (b64) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height), g = c.getContext('2d');
    g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
    let sum = 0, sum2 = 0, black = 0, magenta = 0, n = 0;
    const colors = new Set();
    for (let i = 0; i < d.length; i += 4 * 7) {
      const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      n++;
      sum += l;
      sum2 += l * l;
      if (l < 8) black++;
      if (d[i] > 200 && d[i + 1] < 60 && d[i + 2] > 200) magenta++;
      colors.add(((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4));
    }
    const mean = sum / n;
    return { mean: +mean.toFixed(1), std: +Math.sqrt(sum2 / n - mean * mean).toFixed(1), pctBlack: +((100 * black) / n).toFixed(1), pctMagenta: +((100 * magenta) / n).toFixed(2), colors4bit: colors.size };
  }, png.toString('base64'));
}

/**
 * One call to Jev (TypeSafe's System One judge): `state` is text and numbers code has already put
 * into words, `questions` typed nouls, scores and choices. A question may carry `flag(answer)`, kept
 * here and not sent: true marks the answer for a person to look at. So does an unsure one (a noul
 * between 0.3 and 0.7, confidence under 0.5). Jev never fails a run; with no TYPESAFE_API_KEY it's skipped.
 */
export async function jev(state, questions) {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) return { skipped: 'TYPESAFE_API_KEY is not set' };
  const sent = Object.fromEntries(Object.entries(questions).map(([k, { flag, ...q }]) => [k, q]));
  const t0 = Date.now();
  let body;
  try {
    const res = await fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'jev-latest', state, questions: sent }),
    });
    body = await res.json().catch(() => ({}));
    if (!res.ok) return { error: `HTTP ${res.status}: ${JSON.stringify(body).slice(0, 300)}` };
  } catch (e) {
    return { error: String(e) };
  }
  const flags = [];
  for (const [k, a] of Object.entries(body.answers ?? {})) {
    if (questions[k]?.flag?.(a)) flags.push(`${k}: ${a.choice ?? a.score ?? a.noul}`);
    else if ((a.noul !== undefined && a.noul > 0.3 && a.noul < 0.7) || (a.confidence !== undefined && a.confidence < 0.5)) flags.push(`${k}: unsure (${a.choice ?? a.score ?? a.noul}, confidence ${a.confidence ?? '-'})`);
  }
  return { model: body.model, answers: body.answers, flags, usage: body.usage, ms: Date.now() - t0 };
}

/** Puts a number into words for Jev, which is weak at comparing numbers: `cuts` ascending, one more name than cuts. */
export function bucket(v, cuts, names) {
  const i = cuts.findIndex((c) => v < c);
  return names[i < 0 ? names.length - 1 : i];
}

export const save = (file, data) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data, null, 2));
};
