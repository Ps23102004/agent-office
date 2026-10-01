import test from 'node:test';
import assert from 'node:assert/strict';
import { GATE_PYLONS, RACE_PLAZA, atShopDoor, cityDressing, cityLayout, citySolids, cityStreetscape, shopModules, streetName, surfaceAt } from '../src/shared/city.js';
import { EXIT_STAIRS, OFFICE_TREES } from '../src/shared/layout.js';
import { CITY_GATE } from '../src/shared/circuit.js';
import { CITY_ARENA_GATE } from '../src/shared/arena.js';

const st = EXIT_STAIRS;
const stairsEnd = st.landingZ1 + st.steps * st.run;
/** Whether a disc at (x, z) of radius r reaches the exit stairs (and the landing in front of them). */
const onStairs = (x: number, z: number, r: number) => x > st.minX - r && x < st.maxX + r && z > st.landingZ0 - r && z < stairsEnd + r;

test('no tree round the office reaches the exit stairs (canopy, and the side ball)', () => {
  for (const [x, z, s] of OFFICE_TREES) {
    assert.ok(!onStairs(x, z, 1.6 * s), `tree at ${x}, ${z}`);
    assert.ok(!onStairs(x + 0.8 * s, z + 0.4 * s, 1.1 * s), `tree's side ball at ${x}, ${z}`);
    assert.ok(!onStairs(x - 0.7 * s, z - 0.3 * s, 1.0 * s), `tree's other ball at ${x}, ${z}`);
  }
});

test('every office tree is off the road and clear of the exit stairs and of what stands on the sidewalk', () => {
  for (const [x, z, s] of OFFICE_TREES) {
    assert.notEqual(surfaceAt(x, z), 'road', `tree at ${x}, ${z}`);
    assert.ok(!onStairs(x, z, 1.6 * s) && !onStairs(x + 0.8 * s, z, 1.1 * s), `tree at ${x}, ${z}`);
    const hit = citySolids(x, z, 0.3 * s + 0.1).filter((a) => x + 0.3 > a.minX && x - 0.3 < a.maxX && z + 0.3 > a.minZ && z - 0.3 < a.maxZ);
    assert.equal(hit.length, 0, `tree at ${x}, ${z} is in a bin or bench`);
  }
});

test('no street dressing stands on the stairs, in an office tree or in front of a shop door', () => {
  for (const d of cityDressing().items) {
    if (d.kind === 'flag') continue;
    assert.ok(!onStairs(d.x, d.z, 0.3), `${d.kind} at ${d.x.toFixed(1)}, ${d.z.toFixed(1)} is on the stairs`);
    assert.ok(!OFFICE_TREES.some(([x, z, s]) => Math.hypot(d.x - x, d.z - z) < 0.5 + 0.3 * s), `${d.kind} is in a tree`);
    if (d.kind === 'streetSign' || d.kind === 'parasol') assert.ok(!atShopDoor(d.x, d.z, 0.2), `${d.kind} at ${d.x.toFixed(1)}, ${d.z.toFixed(1)} is in front of a door`);
  }
});

test('benches, bins and hydrants stay off the shop doors, and off each other and the poles', () => {
  const props = cityStreetscape().props;
  assert.ok(props.length > 50);
  for (const p of props) {
    assert.ok(!atShopDoor(p.x, p.z, 0.2), `${p.kind} at ${p.x.toFixed(1)}, ${p.z.toFixed(1)} is in front of a door`);
    assert.equal(surfaceAt(p.x, p.z), 'walk', `${p.kind} at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`);
  }
  for (const p of props) {
    const hit = citySolids(p.x, p.z, 0.05).filter((a) => p.x > a.minX && p.x < a.maxX && p.z > a.minZ && p.z < a.maxZ);
    // Its own box is the only solid its middle is in.
    assert.equal(hit.length, 1, `${p.kind} at ${p.x.toFixed(1)}, ${p.z.toFixed(1)} is in ${hit.length} solids`);
  }
});

test('park trees stand off the paths across their park, and yard trees are on their own lawn, not the sidewalk or the house', () => {
  const { parks, lots } = cityLayout();
  for (const p of parks) {
    for (const t of p.trees) {
      assert.ok(Math.abs(t.x - p.x) >= 2.2 - 1e-9 && Math.abs(t.z - p.z) >= 2.2 - 1e-9, `park tree at ${t.x.toFixed(1)}, ${t.z.toFixed(1)}`);
      assert.equal(surfaceAt(t.x, t.z), 'grass');
    }
  }
  const yards = lots.filter((l) => l.yard);
  assert.ok(yards.length > 3);
  for (const l of yards) {
    const y = l.yard!;
    assert.equal(surfaceAt(y.x, y.z), 'grass', `yard tree at ${y.x.toFixed(1)}, ${y.z.toFixed(1)}`);
    assert.ok(Math.abs(y.x - l.x) > l.w / 2 + 0.3 || Math.abs(y.z - l.z) > l.d / 2 + 0.3, 'its trunk is in the house');
    // Its canopy (1.9 m a side at scale 1) doesn't hang past the plot's edge by more than a hand.
    const p = l.plot;
    assert.ok(y.x - 1.9 * y.s > p.minX - 0.5 && y.x + 1.9 * y.s < p.maxX + 0.5 && y.z - 1.9 * y.s > p.minZ - 0.5 && y.z + 1.9 * y.s < p.maxZ + 0.5);
  }
});

test('the gate pylons are on the plaza, clear of the gates, and solid', () => {
  for (const p of GATE_PYLONS) {
    assert.ok(p.x > RACE_PLAZA.minX && p.x < RACE_PLAZA.maxX && p.z > RACE_PLAZA.minZ && p.z < RACE_PLAZA.maxZ);
    // Nor on the straight way from the street's corner to a gate.
    const near = (a: readonly [number, number], b: readonly [number, number]) => {
      const t = Math.max(0, Math.min(1, ((p.x - a[0]) * (b[0] - a[0]) + (p.z - a[1]) * (b[1] - a[1])) / ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2)));
      return Math.hypot(p.x - (a[0] + t * (b[0] - a[0])), p.z - (a[1] + t * (b[1] - a[1])));
    };
    for (const [a, g] of [[[28, -29], CITY_GATE], [[56, -29], CITY_GATE], [[83, -29], CITY_ARENA_GATE]] as const) assert.ok(near(a, [g.x, g.z]) > 4, `pylon ${p.id} is on the way to a gate`);
    for (const g of [CITY_GATE, CITY_ARENA_GATE]) {
      // Not within the gate's width of its opening or its runway.
      assert.ok(Math.hypot(p.x - g.x, p.z - g.z) > g.width / 2 + 3, `pylon ${p.id} is by the gate`);
    }
    assert.ok(citySolids(p.x, p.z, 0.1).some((a) => p.x > a.minX && p.x < a.maxX && p.z > a.minZ && p.z < a.maxZ));
  }
});

test('shop fronts come as one door each, and the street names are the same for everyone, and different', () => {
  for (const l of cityLayout().lots.filter((l) => l.kind === 'shop' && !l.hand)) {
    const mods = shopModules(l);
    assert.ok(mods.length >= 1);
    const span = l.fz ? l.w : l.d;
    assert.ok(Math.abs(mods.reduce((s, m) => s + Math.hypot(...m.u), 0) - span) < 1e-6);
  }
  // Every street the city has a crossing of is named, not counted.
  const names = new Set<string>();
  for (const it of cityStreetscape().intersections) {
    for (const n of [streetName('x', it.i), streetName('z', it.j)]) {
      assert.ok(!/^\d+(st|nd|rd|th) /.test(n), n);
      names.add(n);
    }
  }
  assert.ok(names.size >= 22);
  assert.equal(streetName('z', 0), 'Main Street');
  assert.equal(streetName('x', 9), '10th Avenue');
});

test('every building faces out of its block, onto a street', async () => {
  const { cityLayout, STREET_X, STREET_Z, PERIOD } = await import('../src/shared/city.ts');
  for (const l of cityLayout().lots) {
    if (l.fx === 0 && l.fz === 0) continue;
    // The block's middle: the front points away from it (or it's the only plot, dead centre).
    const bx = STREET_X - PERIOD / 2 + PERIOD * Math.round((l.x - STREET_X + PERIOD / 2) / PERIOD);
    const bz = STREET_Z - PERIOD / 2 + PERIOD * Math.round((l.z - STREET_Z + PERIOD / 2) / PERIOD);
    const out = (l.x - bx) * l.fx + (l.z - bz) * l.fz;
    assert.ok(out >= -0.01, `lot at ${l.x.toFixed(1)},${l.z.toFixed(1)} faces into its block`);
  }
});
