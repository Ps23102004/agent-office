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

## In flight (branches pushed to the fork; review and merge them)

- **`parth/r6-ui`** (GPT-6.1 Sol): bot lobbies for the arena (B key or button) and the circuit (fill/level, rabbit), arena hit feedback (damage numbers, hitmarkers, death card), bot names everywhere, and `ui/controls.ts`.
  - Committed `fd5eaed`; a Sonnet review and a Sol fix round may have added commits.
  - Next: check its tests, review it, merge into `parth/round4`.
- **`parth/r6-botsfeel`**: arena bots that play like people (counter-strafe, peek, a ramped difficulty).
  - Committed `3f31655`. The builder notes that per-run hit-rate bands are noisy at 40 s per level and that only the mean holds.
  - Next: review it, then merge. On `src/shared/bots.ts`, `parth/round4` already took the post-integration SKILL table; this branch changes it again, so keep this branch's tuned values.
  - Acceptance: Jev rates the arena levels human-like (it gave 0.21–0.40 before) and the difficulty ramp sensible (0.14 before).

## Remaining plan

1. Merge `parth/r6-ui` and `parth/r6-botsfeel`, fixing any conflicts. `npm test` and `npm run typecheck` must be green, then `npm run build`.
2. Full QA: `PLAYTEST_PORT=4799 npm run playtest`. Fix every failed code assert. Read each Jev flag and act on the real ones.
   - Last QA: grounded failed only on a probe artefact, which is now fixed.
   - Jev was "unsure" on handbrake (0.61–0.69), lift-off (0.63) and the oop screen text.
   - The arena bots scored low; `parth/r6-botsfeel` addresses that.
   - Race bots: easy/normal fair, hard/insane possibly too strong for average people.
3. Look at the screenshots yourself (`.playtest/<stamp>/*/*.png`): textures, cars, out-of-place, arena, race with bots.
4. Final cross-branch integration review by a fresh reviewer, never the implementer. Then fix what it finds.
5. Open follow-ups from the reports:
   - Persist lap records.
   - Check multiplayer edge cases live with two clients.
   - Traffic cars cast no sun shadow (deliberate, for battery cost).
   - Bots never use the handbrake.
   - Remote `Person` objects are never disposed (geometry and label textures leak).
6. Push to the fork after every merge: `git push fork parth/round4`.

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
