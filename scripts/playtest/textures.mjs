// Textures: a look round the street, the office's front, the circuit and the arena. Code measures how
// much of what's in view has any surface texture (a texture map, or the world-space detail layer: a
// material with a DETAIL define), finds broken textures and blank or magenta screenshots; Jev reads a
// description of what's in view that code writes, and says whether it reads as real-world surfaces.
// Jev can't see: the screenshots are for a person (or the lead) to look at.
import { CIRCUIT_CARS, pointAt } from '../../src/shared/circuit.ts';
import { bucket, pixelStats, withThree } from './lib.mjs';
import { toCircuit, toGarage, walkToArena } from './places.mjs';

export const title = 'Textures: real surfaces, not flat colour';

/** At least this share of the screen should be surfaces with some texture or detail. */
const TEXTURED = 0.6;

export default async function textures(t) {
  const { page } = await t.open({ view: 'third' });
  await withThree(page);
  const spots = [];
  const look = async (name, where) => {
    await page.waitForTimeout(1500); // a new place's shaders compile in its first second or so
    const png = await t.shot(page, name);
    const scene = await page.evaluate(sceneTextures);
    const pixels = await pixelStats(page, png);
    spots.push({ name, where, scene, pixels });
  };
  const stand = (x, z, rotY) => page.evaluate(([x, z, rotY]) => {
    const p = window.__office.player;
    p.pos.set(x, p.street, z);
    p.facing = rotY;
    p.camYaw = rotY + Math.PI;
    p.lookPitch = -0.08;
  }, [x, z, rotY]);

  await toGarage(page);
  await page.evaluate(() => window.__office.getOut(true));
  await stand(56, -27, -Math.PI / 2);
  await look('street', 'a city street with shops and apartment blocks, standing on the road looking along it');
  await stand(0, 42, Math.PI);
  await look('office-front', 'in front of the office building, looking at it across the street');
  await stand(56, -40, Math.PI);
  await look('race-plaza', 'the paved plaza with the arched gate to the race circuit');

  await toCircuit(page, { kind: 'lambo' });
  const s = pointAt(-60);
  await page.evaluate(([x, z]) => {
    const d = window.__office.driver;
    d.fleet.place(d.car, { x, z, rotY: Math.PI / 2, speed: 0, steer: 0, slip: 0, yaw: 0 });
  }, [s.x, s.z]);
  await look('circuit', 'a race circuit, behind a car on the main straight: asphalt, kerbs, grass, barriers, grandstands');
  const paddock = CIRCUIT_CARS[0];
  await page.evaluate(() => window.__office.getOut(true));
  await stand(paddock.x - 8, paddock.z + 6, Math.PI / 2);
  await look('paddock', 'the paddock behind the pit wall: pit garages and parked race cars');

  await page.evaluate(() => window.__office.ride('@garage'));
  await page.waitForFunction(() => window.__office.store.floor !== '@circuit' && window.__office.player.enabled, null, { timeout: 20_000 });
  await walkToArena(page);
  await look('arena', 'a shooting arena: a yard of shipping containers and crates on concrete, walled in');

  t.metric('spots', spots.map(({ name, scene, pixels }) => ({ name, texturedShare: scene.texturedShare, grain: scene.grain, texturedMeshes: `${scene.texturedMeshes}/${scene.meshes}`, broken: scene.broken, pixels, renderer: scene.renderer })));
  for (const { name, scene, pixels } of spots) {
    t.check(`${name}: at least ${TEXTURED * 100}% of the view has texture or surface detail`, scene.texturedShare >= TEXTURED, { texturedShare: scene.texturedShare, flat: scene.top.filter((x) => !x.textured).slice(0, 5) });
    t.check(`${name}: no broken textures (map with no image)`, scene.broken.length === 0, scene.broken);
    t.check(`${name}: the screenshot isn't blank, black or missing-texture magenta`, pixels.std > 15 && pixels.pctBlack < 40 && pixels.pctMagenta === 0, pixels);
  }

  // Jev: what's in view, in words code wrote (it can't see the screenshot).
  const state = Object.fromEntries(spots.map(({ name, where, scene }) => [name, {
    where,
    surfaces: scene.top.map((x) => `${x.color} ${x.what}, ${Math.round(x.share * 100)}% of the view: ${x.textured ? `has a texture (${x.textured})` : 'one flat colour, no texture'}, ${grainWords(x.grain)}`),
    summary: `${Math.round(scene.texturedShare * 100)}% of the view has a texture or surface detail (${bucket(scene.texturedShare, [0.2, 0.5, 0.8], ['almost none', 'some', 'most', 'nearly all'])}); overall the surfaces look ${grainWords(scene.grain)}`,
  }]));
  const questions = Object.fromEntries(spots.map(({ name }) => [name, {
    type: 'noul',
    instructions: `\`${name}\` describes the surfaces in view in a stylised 3D game. Would a player say these surfaces look like real-world materials (asphalt grain, grass, concrete, brick, painted markings, metal), rather than flat untextured colour?`,
    flag: (a) => a.noul < 0.5,
  }]));
  await t.judge('surfaces', state, questions);
}

/** Grain (mean brightness step between neighbouring pixels of a surface, 0-255) in words. */
const grainWords = (g) => bucket(g, [1, 3, 6], ['perfectly smooth (no visible grain or pattern)', 'nearly smooth (faint pattern)', 'lightly grained', 'clearly grained or patterned']);

/**
 * In the page: what share of the screen shows surfaces with any texture (a map of any kind, or the
 * world-space detail layer: a material with a DETAIL define). Counted exactly: the view is drawn once
 * more with every mesh in a flat colour of its own (an id), read back, and each pixel put down to the
 * mesh it shows. The sky and anything a few km across (the sky dome, the sea) don't count.
 */
function sceneTextures() {
  const T = window.THREE, o = window.__office, r = o.renderer, scene = o.scene, cam = o.camera;
  const MAPS = ['map', 'normalMap', 'bumpMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'displacementMap'];
  const texture = (mat) => {
    const map = MAPS.find((k) => mat[k]);
    if (map) return `${map} ${mat[map].image?.width ?? '?'}×${mat[map].image?.height ?? '?'}`;
    if (Object.keys(mat.defines ?? {}).some((k) => k.startsWith('DETAIL')) || mat.userData?.detail) return 'detail layer';
    return null;
  };
  const colorOf = (m, mat) => {
    const c = mat.color ? mat.color.clone() : new T.Color(1, 1, 1);
    const vc = m.geometry.attributes.color;
    if (vc) {
      const avg = new T.Color(0, 0, 0), step = Math.max(1, Math.floor(vc.count / 64));
      let n = 0;
      for (let i = 0; i < vc.count; i += step, n++) avg.r += vc.getX(i), avg.g += vc.getY(i), avg.b += vc.getZ(i);
      c.multiply(avg.multiplyScalar(1 / n));
    }
    const hsl = c.getHSL({});
    const name = hsl.s < 0.15 ? (hsl.l < 0.2 ? 'black' : hsl.l > 0.8 ? 'white' : 'grey') : ['red', 'orange', 'yellow', 'green', 'green', 'teal', 'blue', 'blue', 'purple', 'pink', 'red'][Math.round(hsl.h * 10)];
    return `${name} #${c.getHexString()}`;
  };
  // The view as it's drawn (outlines aside), for how much grain each surface shows.
  const gl = r.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const rgb = new Uint8Array(w * h * 4);
  r.setRenderTarget(null);
  r.render(scene, cam);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, rgb);
  // Every mesh drawn in its own colour (4 bits a channel, so a little rounding doesn't matter); the rest hidden.
  const ids = [null], hidden = [], swapped = [], broken = [];
  scene.updateMatrixWorld(true);
  scene.traverse((m) => {
    if (!m.visible) return;
    if (m.isPoints || m.isLine || m.isSprite) return hidden.push(m);
    if (!m.isMesh) return;
    const mats = [].concat(m.material).filter(Boolean);
    for (const mat of mats) for (const k of MAPS) if (mat[k] && !mat[k].isRenderTargetTexture && !mat[k].isDataTexture && !(mat[k].image?.width > 0 || mat[k].image?.videoWidth > 0)) broken.push(`${m.name || m.geometry.type}: ${k}`);
    if (!mats.length || mats.every((x) => x.transparent && !x.depthWrite) || ids.length >= 4095) return hidden.push(m);
    const box = new T.Box3().setFromObject(m);
    const size = box.getSize(new T.Vector3());
    const k = ids.length;
    ids.push({ textured: mats.map(texture).find(Boolean) ?? null, color: colorOf(m, mats[0]), what: m.name || (m.isInstancedMesh ? 'instanced' : m.geometry.type), backdrop: Math.max(size.x, size.z) > 4000 });
    const flat = new T.MeshBasicMaterial({ color: new T.Color(((k & 15) * 16 + 8) / 255, (((k >> 4) & 15) * 16 + 8) / 255, (((k >> 8) & 15) * 16 + 8) / 255), toneMapped: false, fog: false, side: mats[0].side });
    swapped.push([m, m.material, m.onBeforeRender]);
    m.material = flat;
    m.onBeforeRender = () => {}; // some set their own material's uniforms here
  });
  for (const m of hidden) m.visible = false;
  const saved = { fog: scene.fog, background: scene.background, space: r.outputColorSpace };
  scene.fog = null;
  scene.background = new T.Color(0, 0, 0);
  r.outputColorSpace = 'srgb-linear';
  const px = new Uint8Array(w * h * 4);
  try {
    r.render(scene, cam);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  } finally {
    for (const [m, mat, before] of swapped) {
      m.material.dispose();
      m.material = mat;
      m.onBeforeRender = before;
    }
    for (const m of hidden) m.visible = true;
    Object.assign(scene, { fog: saved.fog, background: saved.background });
    r.outputColorSpace = saved.space;
  }
  // Each pixel to its mesh (every 3rd row and column), and its grain: how much its brightness differs
  // from the pixels right of and above it on the same mesh (0-255). Flat colour is about 0; asphalt grain, grass and brick aren't.
  const id = (i) => (px[i] >> 4) | ((px[i + 1] >> 4) << 4) | ((px[i + 2] >> 4) << 8);
  const lum = (i) => 0.2126 * rgb[i] + 0.7152 * rgb[i + 1] + 0.0722 * rgb[i + 2];
  const count = new Map(), grain = new Map();
  let sky = 0, n = 0;
  for (let y = 0; y < h - 1; y += 3) for (let x = 0; x < w - 1; x += 3) {
    n++;
    const i = (y * w + x) * 4, k = id(i);
    if (!k || !ids[k] || ids[k].backdrop) {
      sky++;
      continue;
    }
    count.set(k, (count.get(k) ?? 0) + 1);
    const right = i + 4, up = i + w * 4;
    if (id(right) === k && id(up) === k) grain.set(k, (grain.get(k) ?? 0) + Math.abs(lum(i) - lum(right)) + Math.abs(lum(i) - lum(up)));
  }
  const solid = Math.max(1, n - sky);
  const looks = new Map();
  let textured = 0, grains = 0;
  for (const [k, c] of count) {
    const m = ids[k];
    if (m.textured) textured += c;
    grains += grain.get(k) ?? 0;
    const key = `${m.textured ?? ''}|${m.color}|${m.what}`;
    const l = looks.get(key) ?? { textured: m.textured, color: m.color, what: m.what, share: 0, grain: 0 };
    l.share += c / solid;
    l.grain += (grain.get(k) ?? 0) / solid;
    looks.set(key, l);
  }
  const r3 = (x) => Math.round(x * 1000) / 1000;
  const top = [...looks.values()].sort((a, b) => b.share - a.share).slice(0, 10).map((l) => ({ ...l, share: r3(l.share), grain: r3(l.grain / l.share) }));
  const info = r.info;
  return { meshes: ids.length - 1, texturedMeshes: ids.filter((x) => x?.textured).length, skyShare: r3(sky / n), texturedShare: r3(textured / solid), grain: r3(grains / solid), top, broken: [...new Set(broken)].slice(0, 20), renderer: { textures: info.memory.textures, geometries: info.memory.geometries } };
}
