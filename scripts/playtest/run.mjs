// npm run playtest [-- scenario ...]: plays the built game headless, one scenario per thing players
// complained about, and writes .playtest/<stamp>/<scenario>/ (report.json, screenshots). Code asserts
// decide the exit code; Jev's answers are notes for a person to read (see lib.mjs jev). Env:
// PLAYTEST_PORT (default 4718, never 4700), TYPESAFE_API_KEY (Jev; skipped without it), PLAYTEST_GAME
// (another checkout to play instead of this one, built: its game, these scenarios).
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { GAME, REPO, daylight, jev, launch, openOffice, save, startServer } from './lib.mjs';

const ALL = ['grounded', 'driving', 'textures', 'oop', 'arena', 'race', 'fps'];
const asked = process.argv.slice(2);
const unknown = asked.filter((n) => !ALL.includes(n));
if (unknown.length) {
  console.error(`No such scenario: ${unknown.join(', ')}. There are: ${ALL.join(', ')}`);
  process.exit(2);
}

// The game it plays is dist/: say so if src/ has changed since it was built.
const newest = (dir) => Math.max(...readdirSync(dir, { recursive: true }).map((f) => statSync(path.join(dir, f)).mtimeMs));
try {
  if (newest(path.join(GAME, 'src')) > newest(path.join(GAME, 'dist'))) console.warn('⚠️  src/ is newer than dist/: run `npm run build` first, or this plays the old game.\n');
} catch {
  console.error('No dist/: run `npm run build` first.');
  process.exit(2);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const root = path.join(REPO, '.playtest', stamp);
const browser = await launch();
const results = [];
try {
  for (const name of asked.length ? asked : ALL) {
    const mod = await import(`./${name}.mjs`);
    // An office of its own for each: what one scenario leaves behind (a parked car, a race, the bots) isn't the next one's start.
    const server = await startServer({ port: +(process.env.PLAYTEST_PORT ?? 4718) });
    const out = path.join(root, name);
    const r = { scenario: name, title: mod.title, status: '', asserts: [], skipped: [], metrics: {}, jev: {}, shots: [], notes: [], errors: [], ms: 0 };
    const pages = [];
    const image = (file, buf) => {
      save(path.join(out, `${file}.png`), buf);
      r.shots.push(`${name}/${file}.png`);
    };
    const t = {
      out,
      server,
      browser,
      /** A signed-in page of the office (lib.mjs openOffice) in daylight (lib.mjs daylight), closed after the scenario. */
      open: async (opts) => {
        const o = await openOffice(browser, server, opts);
        pages.push(o);
        await daylight(o.page);
        return o;
      },
      check: (what, ok, detail) => r.asserts.push({ name: what, ok: !!ok, detail }),
      metric: (k, v) => (r.metrics[k] = v),
      note: (s) => r.notes.push(s),
      /** A part of the scenario that couldn't run, and why (not a failure). */
      skip: (why) => r.skipped.push(why),
      shot: async (page, file) => {
        try {
          const buf = await page.screenshot();
          image(file, buf);
          return buf;
        } catch (e) {
          r.notes.push(`screenshot ${file} failed: ${e.message}`);
        }
      },
      image,
      /** Jev on `state` (code's words) and `questions`; kept in the report under `what`. */
      judge: async (what, state, questions) => (r.jev[what] = { ...(await jev(state, questions)), state }),
    };
    const t0 = Date.now();
    process.stdout.write(`▶ ${name}: ${mod.title}… `);
    try {
      await mod.default(t);
    } catch (e) {
      r.asserts.push({ name: 'ran to the end', ok: false, detail: String(e.stack ?? e).slice(0, 3000) });
    }
    for (const p of pages) {
      r.errors.push(...p.errors);
      await p.context.close().catch(() => {});
    }
    if (pages.length) r.asserts.push({ name: 'no errors in the page', ok: !r.errors.length, detail: r.errors.slice(0, 8) });
    r.ms = Date.now() - t0;
    await server.stop();
    r.status = r.asserts.some((a) => !a.ok) ? 'FAIL' : r.asserts.length > (pages.length ? 1 : 0) ? 'PASS' : 'SKIP';
    save(path.join(out, 'report.json'), r);
    results.push(r);
    console.log(`${r.status} (${(r.ms / 1000).toFixed(0)} s)`);
  }
} finally {
  await browser.close();
}

// ---- The summary: a line a scenario, then what failed and what Jev would have a person look at ----
const flags = (r) => Object.values(r.jev).flatMap((j) => j.flags ?? []);
const rows = results.map((r) => [r.scenario, r.status, `${r.asserts.filter((a) => a.ok).length}/${r.asserts.length}`, String(flags(r).length), r.skipped.length ? 'yes' : '', `${(r.ms / 1000).toFixed(0)} s`]);
const head = ['scenario', 'status', 'asserts', 'jev review', 'skipped', 'time'];
const w = head.map((h, i) => Math.max(h.length, ...rows.map((x) => x[i].length)));
const line = (x) => x.map((c, i) => c.padEnd(w[i])).join('  ');
let text = `\nPlaytest ${stamp} (.playtest/${stamp}): 1 pm, clear, holiday decorations down\n\n${line(head)}\n${w.map((n) => '-'.repeat(n)).join('  ')}\n${rows.map(line).join('\n')}\n`;
for (const r of results) {
  const failed = r.asserts.filter((a) => !a.ok);
  if (!failed.length && !flags(r).length && !r.skipped.length) continue;
  text += `\n${r.scenario}:\n`;
  for (const a of failed) text += `  ✗ ${a.name}${a.detail === undefined ? '' : `: ${JSON.stringify(a.detail).slice(0, 400)}`}\n`;
  for (const s of r.skipped) text += `  – skipped: ${s}\n`;
  for (const f of flags(r)) text += `  ? jev: ${f}\n`;
}
console.log(text);
save(path.join(root, 'summary.txt'), text);
save(path.join(root, 'summary.json'), results.map(({ scenario, status, asserts, skipped, jev: j, metrics }) => ({ scenario, status, asserts, skipped, jev: Object.fromEntries(Object.entries(j).map(([k, v]) => [k, { flags: v.flags, answers: v.answers, model: v.model, error: v.error, skipped: v.skipped }])), metrics })));
process.exitCode = results.some((r) => r.status === 'FAIL') ? 1 : 0;
