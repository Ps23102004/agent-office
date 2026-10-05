// Records the README media from the real built game: screenshots and one video per scene, in
// docs/media/raw (git-ignored). Same harness as `npm run playtest`: needs `npm run build` first and a GPU.
//   node scripts/media/capture.mjs
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { REPO, sleep, daylight, settled, launch } from '../playtest/lib.mjs';
import { toGarage, getInNearest, driveToCircuit, autopilot, backToGarage, walkToArena } from '../playtest/places.mjs';

const OUT = path.join(REPO, 'docs/media/raw');
mkdirSync(OUT, { recursive: true });
const W = 1280, H = 720;

// The server by hand, in a folder called "Agent Office": the top-left label is the folder's name.
const dir = path.join(OUT, '..', 'office-data', 'Agent Office');
mkdirSync(dir, { recursive: true });
const child = spawn(process.execPath, [path.join(REPO, 'bin/agent-office.js'), dir, '--port', '4731', '--password', 'dev', '--no-open', '--weather', 'clear'], { cwd: REPO, stdio: 'ignore', detached: true });
const server = { url: 'http://127.0.0.1:4731', stop: async () => { try { process.kill(-child.pid, 'SIGINT'); } catch {} await sleep(1500); } };
for (let i = 0; i < 100; i++) { if (await fetch(`${server.url}/login`).then((r) => r.ok, () => false)) break; await sleep(200); }
const browser = await launch();

/** One signed-in page that records video the whole time; scenes are cut from it by timestamp afterwards. */
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, recordVideo: { dir: OUT, size: { width: W, height: H } } });
const res = await context.request.post(`${server.url}/api/login`, { data: { name: '', password: 'dev' } });
if (!res.ok()) throw new Error(`login ${res.status()}`);
await context.addInitScript(([profile, settings]) => {
  localStorage.setItem('agent-office.settings', JSON.stringify(settings));
  localStorage.setItem('agent-office.profile', JSON.stringify(profile));
  localStorage.setItem('agent-office.lite-declined', '1');
  Object.defineProperty(Document.prototype, 'hidden', { get: () => false });
  Object.defineProperty(Document.prototype, 'visibilityState', { get: () => 'visible' });
}, [{ name: 'Parth', color: '#4f86f7', look: { skin: 1, hair: 1, style: 1 } }, { graphics: 'full', view: 'third' }]);
const page = await context.newPage();
const t0 = Date.now();
const marks = [];
const mark = (name) => marks.push({ name, at: +((Date.now() - t0) / 1000).toFixed(2) });
const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });

await page.goto(`${server.url}/?skipTitle`);
await page.waitForFunction(() => {
  const o = window.__office, l = document.getElementById('loading');
  return o && o.store.floor && (!l || l.classList.contains('gone'));
}, null, { timeout: 90_000, polling: 250 });
await settled(page);
await daylight(page);

// 1. The office floor: out of the elevator and across to the desks.
mark('office-start');
await sleep(1500);
await page.keyboard.down('KeyW');
await sleep(2500);
await page.keyboard.up('KeyW');
await page.keyboard.down('KeyD');
await sleep(1200);
await page.keyboard.up('KeyD');
await sleep(700);
await shot('01-office');
await page.keyboard.down('KeyW');
await sleep(2200);
await page.keyboard.up('KeyW');
await shot('02-office-floor');
await sleep(1200);
mark('office-end');

// 2. Down to the garage, into the Lambo, out onto the city street.
await toGarage(page);
await sleep(600);
await getInNearest(page, 'lambo');
mark('city-start');
await page.evaluate(() => {
  const d = window.__office.driver;
  d.fleet.place(d.car, { x: 56, z: -27, rotY: -Math.PI / 2, speed: 0, steer: 0, slip: 0, yaw: 0 });
});
await sleep(1500);
await page.keyboard.down('KeyW');
await sleep(4500);
await shot('03-city-drive');
await sleep(3000);
await page.keyboard.up('KeyW');
mark('city-end');

// 3. Through the gate to the circuit, lined up, racing on the autopilot.
await driveToCircuit(page);
mark('circuit-start');
await page.keyboard.press('KeyR'); // line up on the grid
await page.waitForFunction(() => window.__office.store.race.racers.some((r) => r.id === window.__office.store.you), null, { timeout: 8000 });
await page.keyboard.press('KeyR'); // start
await page.waitForFunction(() => window.__office.store.race.phase === 'racing', null, { timeout: 15_000 });
await autopilot(page, { maxSpeed: 42 });
await sleep(6000);
await shot('04-circuit');
await sleep(9000);
await shot('05-circuit-corner');
await autopilot(page, { on: false });
mark('circuit-end');

// 4. Back, and on foot into the arena.
await backToGarage(page);
await walkToArena(page);
mark('arena-start');
await sleep(2500);
await shot('06-arena');
await page.keyboard.down('KeyW');
await sleep(2500);
await page.keyboard.up('KeyW');
await sleep(1500);
mark('arena-end');

const video = page.video();
await context.close();
console.log(JSON.stringify({ video: await video.path(), marks }, null, 1));
await browser.close();
await server.stop();
