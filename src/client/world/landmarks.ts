import * as THREE from 'three';
import { GATE_PYLONS, cityLayout } from '../../shared/city';
import { VENUES } from '../../shared/venues';
import { mesh, toon } from './toon';

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

const unlit = { toneMapped: false, fog: true } as const;

export function buildLandmarks(dark: () => number, gasPoleHeight: number): THREE.Group {
  const group = new THREE.Group();
  const glowAt: number[] = [];
  const glowSize: number[] = [];
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

  /** A board `w` × `h` centred at (x, y, z), facing `yaw` (and the opposite way too if `both`), `off` m out from the middle, glowing at night. */
  const board = (text: string, w: number, h: number, bg: string, ink: string, border: string, x: number, y: number, z: number, yaw: number, both = true, off = 0.06) => {
    const tex = boardTexture(text, 1024, Math.round((1024 * h) / w), bg, ink, border);
    const mat = new THREE.MeshBasicMaterial({ map: tex, ...unlit });
    for (const flip of both ? [0, Math.PI] : [0]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      // Just off the face, so the two sides don't fight over one plane.
      m.position.set(x + Math.sin(yaw + flip) * off, y, z + Math.cos(yaw + flip) * off);
      m.rotation.y = yaw + flip;
      group.add(m);
    }
    glowAt.push(x, y, z);
    glowSize.push(Math.max(w, h) * 2.4);
  };
  const post = (x: number, y0: number, y1: number, z: number, r: number, color: string) => group.add(mesh(new THREE.CylinderGeometry(r, r, y1 - y0, 6), toon(color), x, (y0 + y1) / 2, z, false));
  const stripes = (x: number, z: number, h: number, half: number, a: string, b: string) => {
    const n = 8;
    for (let k = 0; k < n; k++) group.add(mesh(new THREE.BoxGeometry(half * 2, h / n, half * 2), toon(k % 2 ? b : a), x, ((k + 0.5) * h) / n, z, false));
  };

  // The gates' pylons: a striped shaft with a big board near the top, facing the street and the plaza, and a light on its tip.
  for (const p of GATE_PYLONS) {
    const race = p.id === 'race';
    stripes(p.x, p.z, p.h, p.half, race ? '#e63946' : '#3d4147', race ? '#f8f9fa' : '#f4c430');
    const by = p.h - 4;
    board(race ? '🏁 RACE CIRCUIT' : '🎯 ARENA', 11, 3.4, race ? '#ffd166' : '#f4c430', '#2b2d42', '#212529', p.x, by, p.z, 0, true, p.half + 0.06);
    board(race ? '🏁 RACE CIRCUIT' : '🎯 ARENA', 11, 3.4, race ? '#ffd166' : '#f4c430', '#2b2d42', '#212529', p.x, by, p.z, Math.PI / 2, true, p.half + 0.06);
    group.add(mesh(new THREE.SphereGeometry(0.5, 8, 6), new THREE.MeshBasicMaterial({ color: race ? '#ff4d4d' : '#ffe066' }), p.x, p.h + 0.4, p.z, false));
    glowAt.push(p.x, p.h + 0.4, p.z);
    glowSize.push(10);
  }

  // The gas station's price sign, up on its pole (the pole is city.ts's).
  const gas = cityLayout().gas;
  if (gas) {
    const yaw = Math.atan2(gas.fx, gas.fz);
    board('⛽ GAS', 7.5, 2.8, '#e63946', '#ffffff', '#ffffff', gas.sign.x, gasPoleHeight + 1.2, gas.sign.z, yaw, true, 0.2);
    board('1.89  2.09', 6, 1.4, '#1d2b3a', '#ffd166', '#ffffff', gas.sign.x, gasPoleHeight - 1.0, gas.sign.z, yaw, true, 0.2);
    // The canopy's fascia says it too, on the street side.
    const c = gas.canopy;
    const cw = gas.fz ? c.maxX - c.minX : c.maxZ - c.minZ;
    board('GAS', Math.min(cw, 6), 0.9, '#f4f1de', '#e63946', '#e63946', (c.minX + c.maxX) / 2 + gas.fx * ((c.maxX - c.minX) / 2 + 0.1), 4.5, (c.minZ + c.maxZ) / 2 + gas.fz * ((c.maxZ - c.minZ) / 2 + 0.1), yaw, false);
  }

  // A big P over the parking deck, crossed so it's seen from every street.
  const deck = cityLayout().lots.find((l) => l.kind === 'deck');
  if (deck) {
    const top = deck.h;
    post(deck.x - 2, top, top + 7, deck.z, 0.18, '#3d405b');
    post(deck.x + 2, top, top + 7, deck.z, 0.18, '#3d405b');
    for (const yaw of [0, Math.PI / 2]) board('P', 6.5, 6.5, '#1f6fd6', '#ffffff', '#ffffff', deck.x, top + 8.2, deck.z, yaw, true, 0.2);
  }

  // Blade signs on the café's and the bar's roofs, crossed.
  for (const v of VENUES) {
    const x = (v.box.minX + v.box.maxX) / 2;
    const z = (v.box.minZ + v.box.maxZ) / 2;
    const cafe = v.id === 'cafe';
    post(x - 1.8, v.height, v.height + 2.4, z, 0.1, '#2b2d42');
    post(x + 1.8, v.height, v.height + 2.4, z, 0.1, '#2b2d42');
    for (const yaw of [0, Math.PI / 2]) board(cafe ? '☕ CAFE' : '🦉 BAR', 5.2, 1.7, cafe ? '#2f5d50' : '#1d1d2b', cafe ? '#fff3d6' : '#ffb347', cafe ? '#fff3d6' : '#ffb347', x, v.height + 2.6, z, yaw, true, 0.2);
  }

  // Their glow at night.
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(glowAt, 3));
  // One size for the lot (a Points material has one): the middle of them.
  const size = glowSize.sort((a, b) => a - b)[Math.floor(glowSize.length / 2)] ?? 10;
  const glow = new THREE.Points(geo, new THREE.PointsMaterial({ size, map: glowMap, color: '#ffd9a0', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.frustumCulled = false;
  glow.onBeforeRender = () => {
    const d = dark();
    (glow.material as THREE.PointsMaterial).opacity = d * 0.55;
  };
  group.add(glow);
  return group;
}
