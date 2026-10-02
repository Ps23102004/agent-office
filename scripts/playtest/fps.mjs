// Frame rate: on each Graphics setting, the frames drawn a second and the worst stall, in the office,
// driving in the city, racing round the circuit and in the arena, with what the GPU was given to draw.
// Measured headless on this machine's GPU (lib.mjs launch), so it's this Mac's numbers, not a phone's.
import { autopilot, backToGarage, driveToCircuit, getInNearest, toGarage, walkToArena } from './places.mjs';
import { measureFps } from './lib.mjs';

export const title = 'Frame rate: Battery holds its 30, Full stays smooth';

/** Per setting: the least frames a second, and the longest a frame may take (ms). Battery is capped at 30. */
const BAR = { battery: { fps: 27, worstMs: 100 }, full: { fps: 50, worstMs: 100 } };

export default async function fps(t) {
  const rows = {};
  for (const graphics of Object.keys(BAR)) {
    const { page } = await t.open({ name: `fps-${graphics}`, graphics, view: 'third' });
    const at = async (place) => {
      await page.waitForTimeout(1500); // a new place's shaders compile in its first second or so
      const f = await measureFps(page, 3000);
      const info = await page.evaluate(() => {
        const r = window.__office.renderer.info;
        return { textures: r.memory.textures, geometries: r.memory.geometries };
      });
      (rows[graphics] ??= {})[place] = { ...f, ...info };
    };
    await at('office floor');
    await toGarage(page);
    await getInNearest(page, 'lambo');
    // West along the street north of the office, rolling at about 10 m/s, so the city's going by
    // (a jump the office won't take from a city car: only this page sees it, which is all this needs).
    await page.evaluate(() => {
      const d = window.__office.driver;
      d.fleet.place(d.car, { x: 56, z: -27, rotY: -Math.PI / 2, speed: 0, steer: 0, slip: 0, yaw: 0 });
    });
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(1200);
    await page.keyboard.up('KeyW');
    await at('city, driving');
    await driveToCircuit(page);
    await autopilot(page, { maxSpeed: 40 });
    await at('circuit, racing');
    await autopilot(page, { on: false });
    await t.shot(page, `circuit-${graphics}`);
    await backToGarage(page);
    await walkToArena(page);
    await at('arena');
  }
  t.metric('fps', rows);
  for (const [graphics, bar] of Object.entries(BAR)) {
    const r = rows[graphics];
    t.check(`${graphics}: at least ${bar.fps} frames a second everywhere`, Object.values(r).every((x) => x.fps >= bar.fps), Object.fromEntries(Object.entries(r).map(([k, x]) => [k, x.fps])));
    t.check(`${graphics}: no frame takes over ${bar.worstMs} ms`, Object.values(r).every((x) => x.worstGapMs <= bar.worstMs), Object.fromEntries(Object.entries(r).map(([k, x]) => [k, x.worstGapMs])));
  }
}
