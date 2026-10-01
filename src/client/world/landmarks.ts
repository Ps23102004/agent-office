import * as THREE from 'three';
import { GATE_PYLONS, cityLayout } from '../../shared/city';
import { VENUES } from '../../shared/venues';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Venue } from '../../shared/venues';
import { mergeByMaterial, mesh, toon } from './toon';

// The tall lit signs that say where things are, seen from down the street and over the roofs: a pylon
// over each of the race plaza's two gates, the gas station's price sign, a big P on the parking deck, and
// a blade sign on the café's roof and the bar's. Boards are unlit paint (they read in daylight); at night
// each gets a soft glow (the same sprite the street lamps use), brighter with `dark`. Street level, y = 0.

/** A board's lettering: the text fitted to the width, on a coloured ground with a light border. */
function boardTexture(text: string, w: number, h: number, bg: string, ink: string, border: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = border;
  g.fillRect(0, 0, w, h);
  g.fillStyle = bg;
  g.fillRect(h * 0.06, h * 0.06, w - h * 0.12, h * 0.88);
  g.fillStyle = ink;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let px = h * 0.6;
  const font = (n: number) => `900 ${n}px Nunito, ui-rounded, system-ui, sans-serif`;
  g.font = font(px);
  const tw = g.measureText(text).width;
  if (tw > w * 0.86) g.font = font((px = Math.floor((px * w * 0.86) / tw)));
  g.fillText(text, w / 2, h / 2 + px * 0.05);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** One material per lettering (a board seen from both sides, or two of the same, share it). */
const mats = new Map<string, THREE.MeshBasicMaterial>();
function boardMat(text: string, w: number, h: number, bg: string, ink: string, border: string): THREE.MeshBasicMaterial {
  const key = [text, w, h, bg, ink, border].join('|');
  let m = mats.get(key);
  if (!m) {
    const px = Math.min(1024, Math.round(w * 100));
    m = new THREE.MeshBasicMaterial({ map: boardTexture(text, px, Math.round((px * h) / w), bg, ink, border), toneMapped: false });
    mats.set(key, m);
  }
  return m;
}

/** Boards gathered up to be one mesh per lettering: `add` a board `w` × `h` centred at (x, y, z), facing `yaw` (and the opposite way too if `both`), `off` m out from the middle. */
class Boards {
  private by = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(text: string, w: number, h: number, bg: string, ink: string, border: string, x: number, y: number, z: number, yaw: number, both = true, off = 0.06) {
    const mat = boardMat(text, w, h, bg, ink, border);
    for (const flip of both ? [0, Math.PI] : [0]) {
      const geo = new THREE.PlaneGeometry(w, h).rotateY(yaw + flip).translate(x + Math.sin(yaw + flip) * off, y, z + Math.cos(yaw + flip) * off);
      const list = this.by.get(mat) ?? [];
      list.push(geo);
      this.by.set(mat, list);
    }
  }
  into(group: THREE.Group) {
    for (const [mat, geos] of this.by) group.add(new THREE.Mesh(mergeGeometries(geos)!, mat));
  }
}

const post = (into: THREE.Group, x: number, y0: number, y1: number, z: number, r: number, color: string) => into.add(mesh(new THREE.CylinderGeometry(r, r, y1 - y0, 6), toon(color), x, (y0 + y1) / 2, z, false));

/**
 * The blade sign on a venue's roof (the café's, the bar's), crossed so it's seen from every street: venues.ts puts it
 * in the building's shell, which goes when you walk in (it'd float over the room).
 */
export function buildRoofSign(v: Venue): THREE.Group {
  const out = new THREE.Group();
  const x = (v.box.minX + v.box.maxX) / 2;
  const z = (v.box.minZ + v.box.maxZ) / 2;
  const cafe = v.id === 'cafe';
  const solid = new THREE.Group();
  post(solid, x - 1.8, v.height, v.height + 2.4, z, 0.1, '#2b2d42');
  post(solid, x + 1.8, v.height, v.height + 2.4, z, 0.1, '#2b2d42');
  out.add(mergeByMaterial(solid));
  const boards = new Boards();
  for (const yaw of [0, Math.PI / 2]) boards.add(cafe ? '☕ CAFE' : '🦉 BAR', 5.2, 1.7, cafe ? '#2f5d50' : '#1d1d2b', cafe ? '#fff3d6' : '#ffb347', cafe ? '#fff3d6' : '#ffb347', x, v.height + 2.6, z, yaw, true, 0.2);
  boards.into(out);
  return out;
}

/** `gasPoleHeight` is the price sign's pole (city.ts): its boards hang from the top of it. */
export function buildLandmarks(dark: () => number, gasPoleHeight: number): THREE.Group {
  const group = new THREE.Group();
  const solid = new THREE.Group();
  const boards = new Boards();
  const glowAt: number[] = [];
  const g = document.createElement('canvas');
  g.width = g.height = 64;
  const gx = g.getContext('2d')!;
  const grad = gx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  gx.fillStyle = grad;
  gx.fillRect(0, 0, 64, 64);
  const glowMap = new THREE.CanvasTexture(g);

  const stripes = (x: number, z: number, h: number, half: number, a: string, b: string) => {
    const n = 8;
    for (let k = 0; k < n; k++) solid.add(mesh(new THREE.BoxGeometry(half * 2, h / n, half * 2), toon(k % 2 ? b : a), x, ((k + 0.5) * h) / n, z, false));
  };

  // The gates' pylons: a striped shaft with a big board near the top, facing the street and the plaza, and a light on its tip.
  for (const p of GATE_PYLONS) {
    const race = p.id === 'race';
    stripes(p.x, p.z, p.h, p.half, race ? '#e63946' : '#3d4147', race ? '#f8f9fa' : '#f4c430');
    const by = p.h - 4;
    for (const yaw of [0, Math.PI / 2]) boards.add(race ? '🏁 RACE CIRCUIT' : '🎯 ARENA', 11, 3.4, race ? '#ffd166' : '#f4c430', '#2b2d42', '#212529', p.x, by, p.z, yaw, true, p.half + 0.06);
    solid.add(mesh(new THREE.SphereGeometry(0.5, 8, 6), toon(race ? '#ff4d4d' : '#ffe066', { emissive: race ? '#ff4d4d' : '#ffe066' }), p.x, p.h + 0.4, p.z, false));
    glowAt.push(p.x, by, p.z, p.x, p.h + 0.4, p.z);
  }

  // The gas station's price sign, hung from the top of its pole (the pole is city.ts's).
  const gas = cityLayout().gas;
  if (gas) {
    const yaw = Math.atan2(gas.fx, gas.fz);
    boards.add('⛽ GAS', 7.5, 2.8, '#e63946', '#ffffff', '#ffffff', gas.sign.x, gasPoleHeight - 1.4, gas.sign.z, yaw, true, 0.2);
    boards.add('1.89  2.09', 6, 1.4, '#1d2b3a', '#ffd166', '#ffffff', gas.sign.x, gasPoleHeight - 3.6, gas.sign.z, yaw, true, 0.2);
    glowAt.push(gas.sign.x, gasPoleHeight - 2, gas.sign.z);
    // The canopy's fascia says it too, on the street side.
    const c = gas.canopy;
    const cw = gas.fz ? c.maxX - c.minX : c.maxZ - c.minZ;
    boards.add('GAS', Math.min(cw, 6), 0.9, '#f4f1de', '#e63946', '#e63946', (c.minX + c.maxX) / 2 + gas.fx * ((c.maxX - c.minX) / 2 + 0.1), 4.5, (c.minZ + c.maxZ) / 2 + gas.fz * ((c.maxZ - c.minZ) / 2 + 0.1), yaw, false);
  }

  // A big P over the parking deck, crossed so it's seen from every street.
  const deck = cityLayout().lots.find((l) => l.kind === 'deck');
  if (deck) {
    const top = deck.h;
    post(solid, deck.x - 2, top, top + 7, deck.z, 0.18, '#3d405b');
    post(solid, deck.x + 2, top, top + 7, deck.z, 0.18, '#3d405b');
    for (const yaw of [0, Math.PI / 2]) boards.add('P', 6.5, 6.5, '#1f6fd6', '#ffffff', '#ffffff', deck.x, top + 8.2, deck.z, yaw, true, 0.2);
    glowAt.push(deck.x, top + 8.2, deck.z);
  }

  group.add(mergeByMaterial(solid));
  boards.into(group);

  // Their glow at night.
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(glowAt, 3));
  const glow = new THREE.Points(geo, new THREE.PointsMaterial({ size: 9, map: glowMap, color: '#ffd9a0', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.frustumCulled = false;
  glow.onBeforeRender = () => {
    (glow.material as THREE.PointsMaterial).opacity = dark() * 0.55;
  };
  group.add(glow);
  return group;
}
