# Round 6 handoff (2026-10-02)

Working branch: `parth/round4` on the fork https://github.com/Ps23102004/agent-office (remote `fork`).
Never push to `origin` (AgentSystemLabs/agent-office): this account only has read access there.

## What the user asked for (round 6)

- Real textures and real-world detail (track, city, arena).
- Nothing out of place.
- Cars sitting on the ground, wheels never coming out of the body.
- Driving physics that feels great.
- A better shooting game (arena).
- Bots/AI opponents as good as people, for both the arena and the race.
- Improve anything else that can be improved.
- Test it all with **Jev** (TypeSafe's System One judge model), not "Java".

## Merged on parth/round4 (618 tests green at a2422ee)

| Area | Where | Status |
|---|---|---|
| Handling physics | `src/shared/garage.ts` (`advance`, `tireStep`, `steerLimit`, `gripAt`, `tankFill`), `src/client/driving.ts`, `src/client/gamepad.ts` | Grip/drift hybrid; safe lift and brake; holdable handbrake drifts; render interpolation; gamepad. Jev feel 2.94/3. |
| Car visuals | `src/client/world/cars.ts`, `streetlife.ts`, `outside.ts` | 0 cm wheel–ground gap on every surface; contact shadows; fenders never cut the tyres; lofted supercar hulls. |
| Textures | `src/client/world/surface.ts` + `sky.ts` hook, `circuit.ts`, `city.ts`, `world/arena.ts`, `golf.ts` | Detail reads at play distance on battery and full; pit garages; plaza carpet. |
| World placement | `src/shared/city.ts`, `dressing.ts`, `landmarks.ts`, `tests/placement.test.ts` | Out-of-place sweep. |
| Arena feel | `src/client/arena.ts`, `src/server/arena.ts`, `src/shared/arena.ts` | Lag compensation, head sphere, damage/HP in shots, climb, crouch, slide, SMG, death cam. |
| Arena bots | `src/server/arenabots.ts`, `src/shared/bots.ts` | Virtual peers going through the same shot judge; auto-fill when solo. |
| Race bots | `src/shared/racebot.ts`, `src/server/racebots.ts` | Same physics as people; fill/level; practice rabbit. |
| Playtest harness | `scripts/playtest/*`, run with `npm run playtest -- <scenarios>` | Jev is the semantic judge; code asserts are the gate. |

## Status at 2026-10-02 (end of the local session)

Everything is merged on `parth/round4`: physics, car visuals, supercars, textures, world, arena feel, arena bots (human-like pass), race bots, Sol's UI, and the final review fixes. 625 tests are green and the branch is pushed to the fork.

Full playtest on the merged build (`.playtest/2026-10-02T16-31-53`): all 7 scenarios PASS, 129/129 code asserts.

Jev scores:
- **Driving:** feel 2.93/3, verdict yes. Unsure on lift-off (0.64) and handbrake (0.68).
- **Arena bots** (does each level play like people): easy 0.34, normal 0.69, hard 0.44, insane 0.52. Difficulty ramp 0.92. Before round 6 these were 0.21–0.40, with ramp 0.14.
- **Race bots:** easy 0.77, normal 0.72, hard 0.40, insane 0.24. Ramp 0.96. Hard and insane read as strong against an average-pace autopilot.
- **Out-of-place screen text:** "unsure" on office (0.40) and plaza (0.39). These come from the screen-text check, not visuals.

## Remaining follow-ups (all low)

- Arena easy/hard human-likeness: a longer per-level playtest would cut noise before retuning.
- Arena bots dialog:
  - B doesn't close it.
  - Focus starts on the close button.
  - The race lobby has the same focus issue when Join is disabled.
- Rabbit practice button moves focus to an element with tabindex -1.
- `controls.ts` lists R (race) and pad B (reset) as if they always work; both only work at the circuit.
- Server:
  - The CROUCHED guard is easy to get around.
  - `arena.bots` and `race.bots` share one global cooldown with no per-sender limit.
  - Bots get the LAG_R hit widening. Accuracy is calibrated with it, so retune if you remove it.
- Remote `Person` objects, including race-bot drivers, are never disposed (geometry and label textures leak).
- Persist lap records.
- Live check of two-client multiplayer.

## Conventions

- Routing:
  - **Opus 5.5** plans, reviews, and builds world/car/game work.
  - **Sonnet 5.5** handles placement and motion.
  - **GPT-6.1 Sol** does UI only. It runs through a local proxy, so in the cloud use Claude for UI and say so.
  - The reviewer is never the implementer.
- One git worktree per builder and per fix round; merge into `parth/round4`.
- Car frame: local +x is the driver's LEFT, and rotY 0 faces +z. Street coordinates: -z is north, +x is east.
- Code style: plain-English doc comments in the code's own voice, small diffs, no new dependencies, and one runnable test per non-trivial logic change.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (Sonnet: `Claude Sonnet 5.5`).
- Jev: `POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer $TYPESAFE_API_KEY`, model `jev-latest`, with `noul`/`choice`/`score` questions. Without the key, the harness skips Jev and keeps the code asserts.
- Live checks: run your own server, `node bin/agent-office.js <tmpdir> --port <unique> --password dev --no-open`.
  - Headless Chrome needs `--use-angle=metal` on a Mac; in the cloud use swiftshader or the GPU you have. It is slow, so keep scenarios short.
  - `startServer` refuses a busy port.
