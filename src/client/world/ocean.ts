import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GRID, LIGHTHOUSE, PIER, coastAt } from '../../shared/city';
import { bulb, type NightParts } from './outside';
import { mergeColored, mesh, toon, toonUnique } from './toon';
import { detail } from './surface';

// The island the city stands on (shared/city.ts coastAt): a verge of grass past the ring road, a
// beach all round, and the sea out to the horizon, with a pier off the south shore and a lighthouse
// on the point off the north-east corner. What's drawn here is what the physics say is underfoot.

/** The sea's surface, a little below the street: the beach runs down into it. */
const WATER_Y = -0.3;
/** How far out from the shore the sea's rings of vertices go (m): close together by the beach, far apart out to the horizon. */
const OUT = [-3, -1, 1, 3, 6, 10, 16, 25, 40, 60, 90, 140, 220, 350, 550, 900, 1400];

/** Round the island: evenly, and exactly at the streets' square's four corners (so the grass meets it with no gap). */
const ANGLES = (() => {
  const a: number[] = [];
  const n = 512;
  for (let i = 0; i < n; i++) a.push(-Math.PI + (2 * Math.PI * i) / n);
  for (const [x, z] of [
    [GRID.minX, GRID.minZ],
    [GRID.maxX, GRID.minZ],
    [GRID.maxX, GRID.maxZ],
    [GRID.minX, GRID.maxZ],
  ])
    a.push(Math.atan2(z, x));
  return a.sort((p, q) => p - q);
})();
const COAST = ANGLES.map(coastAt);

/** How far out along angle `th` the streets' square ends. */
function squareAt(th: number): number {
  const c = Math.cos(th);
  const s = Math.sin(th);
  return Math.min(Math.abs(c) > 1e-9 ? (c > 0 ? GRID.maxX : -GRID.minX) / Math.abs(c) : Infinity, Math.abs(s) > 1e-9 ? (s > 0 ? GRID.maxZ : -GRID.minZ) / Math.abs(s) : Infinity);
}

/**
 * A ring all round the island, `rows` vertices out along each angle: `at` says each one's distance
 * from the middle and height (and anything else, which `extra` collects). Faces up.
 */
function ring(rows: number, at: (i: number, row: number) => { r: number; y: number }): THREE.BufferGeometry {
  const n = ANGLES.length;
  const pos = new Float32Array(n * rows * 3);
  for (let i = 0; i < n; i++) {
    const c = Math.cos(ANGLES[i]);
    const s = Math.sin(ANGLES[i]);
    for (let j = 0; j < rows; j++) {
      const { r, y } = at(i, j);
      pos.set([c * r, y, s * r], (i * rows + j) * 3);
    }
  }
  const index: number[] = [];
  for (let i = 0; i < n; i++) {
    const k = (i + 1) % n;
    for (let j = 0; j < rows - 1; j++) {
      const a = i * rows + j;
      const b = a + 1;
      const c = k * rows + j;
      const d = c + 1;
      index.push(a, c, b, c, d, b);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

const flat = (m: THREE.Material) => {
  m.userData.outlineParameters = { visible: false };
  return m;
};

let sandMap: THREE.Texture | null = null;
/** The beach's sand (textures/sand.jpg, made with gpt-image-2), tiled every SAND m across (and its own shape's worth along). */
const SAND = 8;
/** The picture's height over its width (512 × 341), so the sand's grains stay round. */
const SAND_ASPECT = 341 / 512;
function sand(): THREE.Texture {
  if (sandMap) return sandMap;
  sandMap = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}textures/sand.jpg`);
  sandMap.colorSpace = THREE.SRGBColorSpace;
  sandMap.wrapS = sandMap.wrapT = THREE.RepeatWrapping;
  sandMap.anisotropy = 8;
  return sandMap;
}

/** The waves: long, slow swells running across each other, and a shorter chop. Height about ±1. */
const SWELL = /* glsl */ `
float swell(vec2 p, float t) {
  return sin(dot(p, vec2(0.021, 0.013)) + t * 0.9) * 0.5
    + sin(dot(p, vec2(-0.017, 0.029)) + t * 1.3) * 0.32
    + sin(dot(p, vec2(0.061, -0.047)) + t * 2.1) * 0.18;
}
`;

let seaMat: THREE.ShaderMaterial | null = null;
/**
 * The sea: toon bands of blue (deeper further out, a paler crest on each swell), the sky's color
 * catching it the lower you look across it, white foam lapping at the beach and a broken line of it
 * rolling in, glints of sun by day. It darkens with the sky at night. Its haze is the scene's fog,
 * but never quite all the way, so the horizon still reads against the sky on a clear day.
 */
function sea(): THREE.ShaderMaterial {
  if (seaMat) return seaMat;
  seaMat = new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uFar: { value: 320 },
        uDay: { value: 1 },
        uSky: { value: new THREE.Color('#bfe3ff') },
        uDeep: { value: new THREE.Color('#1f7fb8') },
        uShallow: { value: new THREE.Color('#46c3d6') },
        uCrest: { value: new THREE.Color('#7fdbe6') },
        uFoam: { value: new THREE.Color('#f4fbff') },
      },
    ]),
    vertexShader: /* glsl */ `
      attribute float shore;
      uniform float uTime;
      varying float vShore;
      varying vec3 vWorld;
      ${SWELL}
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        // Calmer by the beach, so the water's edge only laps up and down the sand.
        float calm = mix(0.35, 1.0, smoothstep(0.0, 30.0, shore));
        w.y += swell(w.xz, uTime) * 0.16 * calm;
        vShore = shore;
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uDay;
      uniform vec3 uSky;
      uniform vec3 uDeep;
      uniform vec3 uShallow;
      uniform vec3 uCrest;
      uniform vec3 uFoam;
      uniform vec3 fogColor;
      uniform float fogNear;
      uniform float fogFar;
      uniform float uFar;
      varying float vShore;
      varying vec3 vWorld;
      ${SWELL}
      void main() {
        float t = uTime;
        vec3 col = mix(uShallow, uDeep, step(12.0, vShore + sin(vWorld.x * 0.05 + vWorld.z * 0.04) * 4.0));
        // A paler band along each swell's crest (toon: stepped, not shaded).
        float h = swell(vWorld.xz, t);
        col = mix(col, uCrest, step(0.55, h) * 0.6);
        // The sky in it, the more the lower you look across it.
        vec3 view = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - clamp(view.y, 0.0, 1.0), 4.0);
        col = mix(col, uSky, fres * 0.55);
        // Darker at night: the sky's light, not the sun's, is on it.
        col *= mix(0.3, 1.0, uDay);
        // Foam: lapping at the beach, and a broken line of it rolling in to break there.
        float along = vWorld.x * 0.11 + vWorld.z * 0.13;
        float lap = 1.4 + 0.9 * sin(t * 0.8 + along * 0.4);
        float edge = 1.0 - step(lap, vShore);
        float roll = 7.0 - mod(t * 1.1 + sin(along) * 0.6, 7.0);
        float line = (1.0 - step(0.45, abs(vShore - roll))) * step(0.1, sin(along * 3.0 + t) + 0.6) * smoothstep(0.5, 3.0, roll);
        // Glints of the sun, now and then, by day.
        float glint = step(0.985, sin(vWorld.x * 1.3 + t * 1.7) * sin(vWorld.z * 1.1 - t * 1.3)) * uDay * (1.0 - fres);
        col = mix(col, uFoam * mix(0.4, 1.0, uDay), clamp(edge + line * 0.85 + glint, 0.0, 1.0));
        gl_FragColor = vec4(col, 1.0);
        // The haze, as the land's (world/sky.ts), but out here it never quite swallows the sea on a clear day.
        float d = length(cameraPosition - vWorld);
        float fog = max(smoothstep(fogNear, fogFar, d), smoothstep(135.0, 300.0, d));
        fog *= mix(1.0, 0.82, smoothstep(120.0, 240.0, fogFar));
        // All the way into the haze before the camera's far plane, so the sea never ends in an edge.
        fog = max(fog, smoothstep(uFar * 0.6, uFar * 0.95, d));
        gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fog);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  flat(seaMat);
  return seaMat;
}

/**
 * The island round the city, for the street's city group (y = 0 is the street): the grass out past the
 * ring road, the beach and the sea, the pier and the lighthouse. How dark it is comes from `night`'s
 * windows, which the sky lights up.
 */
export function buildIsland(night: NightParts): THREE.Group {
  const group = new THREE.Group();

  // Grass from the streets' square out to the beach, level with the street.
  const grass = new THREE.Mesh(
    ring(2, (i, j) => ({ r: j ? COAST[i].land : squareAt(ANGLES[i]), y: 0 })),
    flat(detail(toonUnique('#a7d98b'), 'grass')),
  );
  group.add(grass);

  // The beach, sloping down from the grass into the sea; darker and wetter toward the water.
  const beachGeo = ring(3, (i, j) => {
    const { land, shore } = COAST[i];
    const r = j === 0 ? land : j === 1 ? shore : shore + 5;
    return { r, y: (WATER_Y * (r - land)) / (shore - land) };
  });
  const bp = beachGeo.getAttribute('position') as THREE.BufferAttribute;
  const uv = new Float32Array(bp.count * 2);
  const tint = new Float32Array(bp.count * 3);
  for (let i = 0; i < bp.count; i++) {
    uv[i * 2] = bp.getX(i) / SAND;
    uv[i * 2 + 1] = bp.getZ(i) / (SAND * SAND_ASPECT);
    const wet = i % 3 === 0 ? 1 : 0.72;
    tint.set([wet, wet * 0.97, wet * 0.93], i * 3);
  }
  beachGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  beachGeo.setAttribute('color', new THREE.BufferAttribute(tint, 3));
  const beachMat = flat(new THREE.MeshToonMaterial({ map: sand(), vertexColors: true, gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap })) as THREE.MeshToonMaterial;
  group.add(new THREE.Mesh(beachGeo, beachMat));

  // The sea, from under the beach's edge out to past the horizon.
  const seaGeo = ring(OUT.length, (i, j) => ({ r: COAST[i].shore + OUT[j], y: WATER_Y }));
  const shore = new Float32Array(ANGLES.length * OUT.length);
  for (let i = 0; i < shore.length; i++) shore[i] = OUT[i % OUT.length];
  seaGeo.setAttribute('shore', new THREE.BufferAttribute(shore, 1));
  const water = new THREE.Mesh(seaGeo, sea());
  water.frustumCulled = false;
  const dark = () => Math.min(1, (night.windows[0]?.emissiveIntensity ?? 0) / 1.1);
  water.onBeforeRender = (_r, scene, camera) => {
    const u = (water.material as THREE.ShaderMaterial).uniforms;
    u.uFar.value = (camera as THREE.PerspectiveCamera).far;
    // Everyone's waves are in step: the office's clock, not the page's.
    u.uTime.value = (Date.now() / 1000) % 3600;
    u.uDay.value = 1 - dark();
    if (scene.background instanceof THREE.Color) u.uSky.value.copy(scene.background);
  };
  group.add(water);

  group.add(landmarks(night, dark));
  return group;
}

/** The pier and the lighthouse, with the lighthouse's light turning at night. */
function landmarks(night: NightParts, dark: () => number): THREE.Group {
  const out = new THREE.Group();
  const parts = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, color: string, x: number, y: number, z: number) => parts.add(mesh(geo, toon(color), x, y, z, false));

  // The pier: boards on posts, a rail down each side from where the water starts, open at the end.
  const len = PIER.from - PIER.to;
  const mid = (PIER.from + PIER.to) / 2;
  add(new THREE.BoxGeometry(PIER.width, 0.3, len), '#b98a5e', PIER.x, -0.13, mid);
  for (let z = PIER.from; z > PIER.to; z -= 1.2) add(new THREE.BoxGeometry(PIER.width + 0.02, 0.02, 0.06), '#8a6242', PIER.x, 0.025, z);
  const [r0, r1] = PIER.rails;
  for (let z = r0; z >= r1; z -= 5) {
    for (const s of [-1, 1]) {
      add(new THREE.CylinderGeometry(0.22, 0.22, 3.4, 8), '#7a5638', PIER.x + s * (PIER.width / 2 - 0.2), -1.8, z);
      add(new THREE.BoxGeometry(0.16, 1.1, 0.16), '#8a6242', PIER.x + s * (PIER.width / 2 - 0.1), 0.55, z);
    }
  }
  for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.14, 0.12, r0 - r1), '#f1e3c8', PIER.x + s * (PIER.width / 2 - 0.1), 1.1, (r0 + r1) / 2);

  // The lighthouse: rocks round its foot, a white tower with red bands, a gallery, the lantern and a red cap.
  const { x, z } = LIGHTHOUSE;
  const H = 15;
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + 0.4;
    const rock = mesh(new THREE.DodecahedronGeometry(1 + (k % 3) * 0.35), toon(k % 2 ? '#8d8f99' : '#a3a5ae'), x + Math.cos(a) * 3.1, 0.1, z + Math.sin(a) * 3.1, false);
    rock.scale.y = 0.6;
    parts.add(rock);
  }
  add(new THREE.CylinderGeometry(2.9, 3.1, 0.8, 16), '#d8d2c4', x, 0.4, z);
  const bands = 5;
  for (let k = 0; k < bands; k++) {
    const y0 = 0.8 + (k * (H - 0.8)) / bands;
    const y1 = 0.8 + ((k + 1) * (H - 0.8)) / bands;
    const r = (y: number) => 2.3 - (y / H) * 0.9;
    add(new THREE.CylinderGeometry(r(y1), r(y0), y1 - y0, 16), k % 2 ? '#e63946' : '#fbf8f0', x, (y0 + y1) / 2, z);
  }
  // Its door, facing the city.
  const door = mesh(new THREE.BoxGeometry(1.1, 2, 0.4), toon('#3d405b'), x - Math.SQRT1_2 * 2.1, 1.8, z + Math.SQRT1_2 * 2.1, false);
  door.rotation.y = -Math.PI / 4;
  parts.add(door);
  add(new THREE.CylinderGeometry(2.1, 2.1, 0.25, 16), '#3d405b', x, H + 0.12, z);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    add(new THREE.BoxGeometry(0.08, 0.8, 0.08), '#3d405b', x + Math.cos(a) * 1.95, H + 0.65, z + Math.sin(a) * 1.95);
  }
  add(new THREE.CylinderGeometry(1.25, 1.25, 0.25, 16), '#3d405b', x, H + 2.35, z);
  add(new THREE.ConeGeometry(1.45, 1.6, 16), '#e63946', x, H + 3.25, z);
  add(new THREE.SphereGeometry(0.22, 8, 6), '#3d405b', x, H + 4.1, z);
  out.add(mergeColored(parts));

  // The lantern glows by night (the sky turns it up), and two beams sweep round from it.
  const lamp = flat(bulb(night, '#fff1a8', 0.25)) as THREE.MeshToonMaterial;
  out.add(mesh(new THREE.CylinderGeometry(1.05, 1.05, 2.1, 12), lamp, x, H + 1.25, z, false));
  night.halos.push({ at: new THREE.Vector3(x, H + 1.3, z), size: 2.4, color: '#fff1a8', ground: true });
  const cone = new THREE.ConeGeometry(5, 70, 20, 1, true).translate(0, -35, 0).rotateZ(Math.PI / 2);
  const merged = mergeGeometries([cone, cone.clone().rotateY(Math.PI)])!;
  const p = merged.getAttribute('position').array as Float32Array;
  // Bright at the lantern, fading to nothing at the far end (it adds light: black adds none).
  const c = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) c.fill(Math.max(0, 1 - Math.abs(p[i]) / 70), i, i + 3);
  merged.setAttribute('color', new THREE.BufferAttribute(c, 3));
  const beamMat = flat(new THREE.MeshBasicMaterial({ color: '#fff4c2', vertexColors: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })) as THREE.MeshBasicMaterial;
  const beam = new THREE.Mesh(merged, beamMat);
  beam.position.set(x, H + 1.25, z);
  beam.frustumCulled = false;
  beam.onBeforeRender = () => {
    beamMat.opacity = dark() * 0.22;
    beam.rotation.y = ((Date.now() / 1000) % 12) * ((Math.PI * 2) / 12);
  };
  out.add(beam);
  return out;
}

/**
 * Water thrown up where something went into the sea: a burst of drops that fly up and fall back,
 * in one set of points, drawn only while there are drops in the air.
 */
export class Splashes {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private next = 0;
  private alive = 0;

  constructor(private count = 220) {
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    for (let i = 0; i < count; i++) this.pos[i * 3 + 1] = -1000;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    const mat = new THREE.PointsMaterial({ color: '#e8f7ff', size: 0.32, transparent: true, opacity: 0.9, depthWrite: false });
    flat(mat);
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.visible = false;
  }

  /** A splash at (x, y, z) on the water, as big as `size` (about 1 for a person, 3 for a car going fast). */
  burst(x: number, y: number, z: number, size: number) {
    const n = Math.min(this.count, Math.round(40 + size * 45));
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.count;
      const a = Math.random() * Math.PI * 2;
      const out = (0.5 + Math.random()) * (0.8 + size * 0.5);
      this.pos.set([x + Math.cos(a) * 0.6 * size, y, z + Math.sin(a) * 0.6 * size], i * 3);
      this.vel.set([Math.cos(a) * out, 2.5 + Math.random() * (2 + size * 1.6), Math.sin(a) * out], i * 3);
      this.life[i] = 0.7 + Math.random() * 0.8;
    }
    this.alive = Math.max(this.alive, 1.6);
    this.points.visible = true;
  }

  update(dt: number) {
    if (!this.points.visible) return;
    this.alive -= dt;
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      this.vel[i * 3 + 1] -= 9.8 * dt;
      for (let a = 0; a < 3; a++) this.pos[i * 3 + a] += this.vel[i * 3 + a] * dt;
      // Gone: back under (well out of sight).
      if (this.life[i] <= 0) this.pos[i * 3 + 1] = -1000;
    }
    this.points.geometry.getAttribute('position').needsUpdate = true;
    if (this.alive <= 0) this.points.visible = false;
  }
}
