// Out of place: a tour of the city, the circuit and the arena looking for things that don't belong.
// Code takes the scene apart round each stop into its separate pieces (merged meshes split back into
// the parts they were made from) and finds the ones hanging in the air touching nothing; and checks
// no message from the place you've just left is still on screen when you arrive somewhere else. Jev
// reads each floating piece described in words, and all the text on screen at each stop, and says
// what looks out of place. The screenshots are for a person.
import { pointAt } from '../../src/shared/circuit.ts';
import { ARENA_CENTER } from '../../src/shared/arena.ts';
import { surfaceAt } from '../../src/shared/city.ts';
import { withThree } from './lib.mjs';
import { toCircuit, toGarage, walkToArena } from './places.mjs';

export const title = 'Out of place: floating things, and messages from somewhere else';

/** A piece this far (m) clear of the ground and of everything else is floating; one this far up is sky (a bird, a plane), not checked. */
const GAP = 0.05;
const SKY = 15;
/** Floating pieces allowed at a stop (there should be none). */
const MAX_FLOATING = 0;

export default async function oop(t) {
  const { page } = await t.open({ view: 'third' });
  await withThree(page);
  const stops = [];
  /** Looks round `r` m of where you are (or `at`): screenshot, the floating pieces, and what's on screen. */
  const stop = async (name, where, doing, r, at) => {
    await page.waitForTimeout(1500);
    await t.shot(page, name);
    const { floating, flat } = r ? await page.evaluate(floatingPieces, { r, gap: GAP, sky: SKY, at: at ?? null }) : { floating: [], flat: [] };
    const city = where.startsWith('the city');
    for (const f of floating) if (city) f.on = surfaceAt(f.x, f.z);
    // Slabs laid on the ground over the road (in the city, where shared/city.ts says what's road).
    const overRoad = city ? flat.map((f) => ({ ...f, roadM2: roadUnder(f.w) })).filter((f) => f.roadM2 >= 4) : [];
    // A close look at the first few, for a person to judge.
    for (const [i, f] of floating.slice(0, 6).entries()) t.image(`${name}-floating-${i + 1}`, Buffer.from((await page.evaluate(closeUp, f)).split(',')[1], 'base64'));
    const text = await page.evaluate(() => document.body.innerText.replace(/\s*\n\s*/g, ' | ').slice(0, 1200));
    stops.push({ name, where, doing, floating, overRoad, text });
  };
  /** Messages still up from before `since` (performance.now()): from the place you were. */
  const stale = (since) => page.evaluate((since) => {
    const shown = [...document.getElementById('toasts').children].map((n) => n.textContent);
    return window.__toasts.filter((x) => x.t < since && shown.includes(x.text)).map((x) => `${x.text} (from ${x.floor})`);
  }, since);

  await stop('office', 'inside the office, on a work floor', 'standing on foot', 0); // text only: lamps hang from its ceilings
  await toGarage(page);
  await page.evaluate(() => window.__office.getOut(true));
  const stand = (x, z, rotY) => page.evaluate(([x, z, rotY]) => {
    const p = window.__office.player;
    p.pos.set(x, p.street, z);
    p.facing = rotY;
    p.camYaw = rotY + Math.PI;
  }, [x, z, rotY]);
  await stand(22, 33, Math.PI * 0.75);
  await stop('crossing', 'the city: a street corner by the office, crossings and parked lots', 'standing on the sidewalk', 40);
  await stand(56, -38, Math.PI);
  await stop('plaza', 'the city: the race plaza with the gates to the circuit and the arena', 'standing on the plaza', 35);

  // To the circuit, a race started, and straight back: nothing said there may follow you home.
  await toCircuit(page, { kind: 'lambo' });
  await page.keyboard.press('KeyR'); // R in the car: line up on the grid
  await page.waitForFunction(() => window.__office.store.race.racers.some((r) => r.id === window.__office.store.you), null, { timeout: 5000 });
  await page.keyboard.press('KeyR'); // and again: start it
  await page.waitForFunction(() => window.__office.store.race.phase === 'racing', null, { timeout: 12_000 });
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1500);
  await page.keyboard.up('KeyW');
  const s = pointAt(-60);
  await stop('circuit', 'the race circuit: the main straight, grandstands, boards and barriers', 'racing alone in a 3-lap race that has just started', 70, { x: s.x, z: s.z });
  let since = await page.evaluate(() => performance.now());
  await page.evaluate(() => window.__office.ride('@garage'));
  await page.waitForFunction(() => window.__office.store.floor !== '@circuit' && window.__office.player.pos.y < -2 && window.__office.player.enabled, null, { timeout: 15_000 });
  const home = await stale(since);
  since = await page.evaluate(() => performance.now());
  await walkToArena(page);
  const arena = await stale(since);
  t.metric('staleMessages', { backInTheCity: home, inTheArena: arena });
  t.check('back in the city from the circuit, nothing said at the circuit is still up', !home.length, home);
  t.check('into the arena, nothing said in the city is still up', !arena.length, arena);
  await stop('arena', 'the arena: a walled yard of shipping containers and crates', 'on foot holding a rifle, alone, so the match is in warm-up', 40, { x: ARENA_CENTER.x, z: ARENA_CENTER.z });

  t.metric('floating', Object.fromEntries(stops.map((x) => [x.name, x.floating])));
  t.metric('overRoad', Object.fromEntries(stops.filter((x) => x.overRoad.length).map((x) => [x.name, x.overRoad])));
  for (const x of stops.filter((x) => x.where.startsWith('the city'))) t.check(`${x.name}: nothing laid over the road but the road and its markings`, !x.overRoad.length, x.overRoad.map((f) => `${f.words}, ${f.roadM2} m² of it over road`));
  for (const x of stops.filter((x) => x.name !== 'office')) t.check(`${x.name}: nothing floating in the air touching nothing (${x.floating.length} found)`, x.floating.length <= MAX_FLOATING, x.floating.slice(0, 12).map((f) => f.words));

  // ---- Jev: what's on screen, and each floating piece in words ----
  await t.judge('screen text', { stops: stops.map(({ where, doing, text }) => ({ where, doing, screen_text: text })) }, Object.fromEntries(stops.map((x, i) => [x.name, {
    type: 'noul',
    instructions: `\`stops[${i}].screen_text\` is all the text visible on a game screen while the player is at \`stops[${i}].where\`, \`stops[${i}].doing\`. Does any of it clearly belong to a different place or activity than this one?`,
    criteria: { true: 'Some visible text is for another place or activity (race standings in the office, driving keys while on foot, a shooting HUD while driving, a message from a place just left).', false: 'Every visible text fits this place and activity, or is general (the chat box, menu buttons, the place or district name, the map).' },
    flag: (a) => a.noul >= 0.7,
  }])));
  const pieces = stops.flatMap((x) => x.floating.slice(0, 8).map((f) => ({ where: x.where, piece: f.words })));
  if (pieces.length) {
    await t.judge('floating', { game: 'A stylised low-poly 3D city, race circuit and arena.', pieces }, Object.fromEntries(pieces.map((p, i) => [`piece_${i}`, {
      type: 'noul',
      instructions: `\`pieces[${i}]\` describes one solid piece of the scene at \`pieces[${i}].where\`, as measured. Would a player see it as out of place: hanging in the air or detached from what should hold it up?`,
      flag: (a) => a.noul >= 0.5,
    }])));
  }
}

/** Square metres of road (shared/city.ts surfaceAt) under the box `w`, on a 0.5 m grid. */
function roadUnder(w) {
  let n = 0;
  for (let x = w[0] + 0.25; x < w[3]; x += 0.5) for (let z = w[2] + 0.25; z < w[5]; z += 0.5) if (surfaceAt(x, z) === 'road') n++;
  return n / 4;
}

/**
 * In the page: the scene's solid pieces within `r` m of `at` (or you), each merged or instanced mesh
 * split back into the parts it was made of (triangles sharing corners), and the ones whose bottom is
 * more than `gap` above the ground you stand on, below `sky`, and that touch (within `gap`) no other
 * piece. Each comes with its size, colour, height and the nearest piece to it, in words.
 */
function floatingPieces({ r, gap, sky, at }) {
  const o = window.__office, me = at ?? o.player.pos;
  // The ground: under your feet, or under the car you're driving.
  const g0 = o.driver.driving ? o.driver.fleet.cars[o.driver.car].root.position.y : o.player.pos.y;
  o.scene.updateMatrixWorld(true);
  const shown = (m) => { for (let p = m; p; p = p.parent) if (!p.visible) return false; return true; };
  const pieces = [];
  const corner = (e, x, y, z) => [e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]];
  const M = o.camera.matrixWorld.constructor;
  o.scene.traverse((m) => {
    if (!m.isMesh || m.isSkinnedMesh || m.isBatchedMesh || !shown(m)) return;
    // Street life is posed in its shaders (cars and people batched): their lamps beside them aren't where they're drawn.
    if (m.parent?.children.some((c) => c.isBatchedMesh)) return;
    const mat = [].concat(m.material)[0];
    if (!mat || (mat.transparent && !mat.depthWrite) || mat.visible === false) return;
    const pos = m.geometry.attributes.position;
    if (!pos) return;
    if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
    // Quick out: the whole mesh (its instances aside) nowhere near.
    if (!m.isInstancedMesh) {
      const c = m.geometry.boundingSphere.center.clone().applyMatrix4(m.matrixWorld);
      if (Math.hypot(c.x - me.x, c.z - me.z) > r + 5 + m.geometry.boundingSphere.radius * m.matrixWorld.getMaxScaleOnAxis()) return;
    }
    // Corners welded at 2 mm, triangles joined into parts.
    const n = pos.count, idx = m.geometry.index, key = new Map(), rep = new Int32Array(n), par = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const k = `${Math.round(pos.getX(i) * 500)},${Math.round(pos.getY(i) * 500)},${Math.round(pos.getZ(i) * 500)}`;
      rep[i] = key.get(k) ?? (key.set(k, i), i);
      par[i] = rep[i];
    }
    const find = (a) => { while (par[a] !== a) a = par[a] = par[par[a]]; return a; };
    const tris = idx ? idx.count / 3 : n / 3;
    const v = (k) => rep[idx ? idx.getX(k) : k];
    for (let k = 0; k < tris; k++) {
      const a = find(v(3 * k));
      for (const b of [find(v(3 * k + 1)), find(v(3 * k + 2))]) if (a !== b) par[b] = a;
    }
    const parts = new Map();
    for (let k = 0; k < tris * 3; k++) {
      const i = idx ? idx.getX(k) : k, root = find(rep[i]);
      const b = parts.get(root) ?? parts.set(root, [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]).get(root);
      const p = [pos.getX(i), pos.getY(i), pos.getZ(i)];
      for (let q = 0; q < 3; q++) [b[q], b[q + 3]] = [Math.min(b[q], p[q]), Math.max(b[q + 3], p[q])];
    }
    const color = mat.color ? `#${mat.color.getHexString()}` : '';
    // Road paint (white, yellow) and anything textured (the road itself) may lie on the road.
    const hsl = mat.color?.getHSL({}) ?? { h: 0, s: 0, l: 1 };
    const paint = !!mat.map || (hsl.s < 0.15 && hsl.l > 0.8) || (hsl.h > 0.1 && hsl.h < 0.18 && hsl.s > 0.5);
    const placements = [];
    if (m.isInstancedMesh) {
      const im = new M(), w = new M();
      for (let k = 0; k < m.count; k++) {
        m.getMatrixAt(k, im);
        if (Math.abs(im.elements[0]) + Math.abs(im.elements[1]) + Math.abs(im.elements[2]) < 1e-4) continue; // a hidden one
        placements.push(w.multiplyMatrices(m.matrixWorld, im).elements.slice());
      }
    } else placements.push(m.matrixWorld.elements);
    for (const e of placements) for (const b of parts.values()) {
      const w = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      for (const x of [b[0], b[3]]) for (const y of [b[1], b[4]]) for (const z of [b[2], b[5]]) {
        const c = corner(e, x, y, z);
        for (let q = 0; q < 3; q++) [w[q], w[q + 3]] = [Math.min(w[q], c[q]), Math.max(w[q + 3], c[q])];
      }
      // Everything reaching to within 5 m of the circle, for what touches what; only those whose middle is in it are looked at.
      const cx = (w[0] + w[3]) / 2, cz = (w[2] + w[5]) / 2;
      const out = Math.hypot(Math.max(0, w[0] - me.x, me.x - w[3]), Math.max(0, w[2] - me.z, me.z - w[5]));
      if (out <= r + 5) pieces.push({ w, color, mesh: m.name || m.geometry.type, inside: Math.hypot(cx - me.x, cz - me.z) <= r, paint });
    }
  });
  // Touching: boxes within `gap` of each other (a grid of 4 m cells to find neighbours).
  const cells = new Map(), cell = (x, z) => `${Math.floor(x / 4)},${Math.floor(z / 4)}`;
  pieces.forEach((p, i) => {
    for (let x = Math.floor(p.w[0] / 4); x <= Math.floor(p.w[3] / 4); x++) for (let z = Math.floor(p.w[2] / 4); z <= Math.floor(p.w[5] / 4); z++) {
      const k = `${x},${z}`;
      (cells.get(k) ?? cells.set(k, []).get(k)).push(i);
    }
  });
  const touch = (a, b, e) => a[0] - e <= b[3] && a[3] + e >= b[0] && a[1] - e <= b[4] && a[4] + e >= b[1] && a[2] - e <= b[5] && a[5] + e >= b[2];
  const size = (w) => `${(w[3] - w[0]).toFixed(2)} × ${(w[4] - w[1]).toFixed(2)} × ${(w[5] - w[2]).toFixed(2)} m`;
  const out = [];
  pieces.forEach((p, i) => {
    const up = p.w[1] - g0;
    if (!p.inside || up <= gap || up > sky) return;
    const near = new Set();
    for (let x = Math.floor((p.w[0] - 1) / 4); x <= Math.floor((p.w[3] + 1) / 4); x++) for (let z = Math.floor((p.w[2] - 1) / 4); z <= Math.floor((p.w[5] + 1) / 4); z++) for (const j of cells.get(`${x},${z}`) ?? []) if (j !== i) near.add(j);
    if ([...near].some((j) => touch(p.w, pieces[j].w, gap))) return;
    // The nearest other piece, and how far off.
    let best = null;
    for (const j of near) {
      const q = pieces[j].w, d = Math.hypot(Math.max(0, q[0] - p.w[3], p.w[0] - q[3]), Math.max(0, q[1] - p.w[4], p.w[1] - q[4]), Math.max(0, q[2] - p.w[5], p.w[2] - q[5]));
      if (!best || d < best.d) best = { d, q, color: pieces[j].color };
    }
    const nearest = best ? `${best.d.toFixed(2)} m from the nearest other piece (${best.color}, ${size(best.q)}, its top ${(best.q[4] - g0).toFixed(2)} m up)` : 'nothing else within a metre';
    out.push({
      x: +((p.w[0] + p.w[3]) / 2).toFixed(2), y: +p.w[1].toFixed(2), z: +((p.w[2] + p.w[5]) / 2).toFixed(2), top: +p.w[4].toFixed(2),
      words: `a ${p.color} ${p.mesh} piece ${size(p.w)}, its bottom ${up.toFixed(2)} m above the ground, touching nothing: ${nearest}`,
    });
  });
  // Unpainted slabs lying flat on the ground, 4 m² or more.
  const flat = pieces.filter((p) => p.inside && !p.paint && p.w[4] - p.w[1] < 0.03 && Math.abs(p.w[1] - g0) < 0.1 && (p.w[3] - p.w[0]) * (p.w[5] - p.w[2]) >= 4)
    .map((p) => ({ w: p.w.map((v) => +v.toFixed(2)), words: `a flat ${p.color} ${p.mesh} slab ${size(p.w)} on the ground` }));
  return { floating: out.sort((a, b) => b.y - a.y), flat };
}

/** A piece seen from 3 m off (from the side the player's on), drawn with a camera of its own: a data URL. */
function closeUp(f) {
  const T = window.THREE, o = window.__office, r = o.renderer;
  const size = new T.Vector2();
  r.getSize(size);
  const cam = new T.PerspectiveCamera(40, size.x / size.y, 0.05, 500);
  const mid = new T.Vector3(f.x, (f.y + f.top) / 2, f.z);
  const away = new T.Vector3(o.camera.position.x - f.x, 0, o.camera.position.z - f.z).normalize();
  cam.position.copy(mid).addScaledVector(away, 3).setY(mid.y + 0.6);
  cam.lookAt(mid);
  cam.updateMatrixWorld();
  r.render(o.scene, cam);
  return r.domElement.toDataURL('image/png');
}
