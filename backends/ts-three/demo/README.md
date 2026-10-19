# KeelCode — Wave 1 arena slice (demo)

A small playable 3D arena game on the TS/three.js reference backend: the
vertical slice that proves the framework loop, input, physics, AI, and
rendering contracts end to end.

**Art note:** neutral placeholder art only — clean primitives, good
lighting and materials. No art direction is mandated yet (user decision
2026-10-18).

## What it is

- 40x40 arena: grid ground, 4 walls, 7 pillars, seeded prop dressing
- Third-person player: capsule character, camera-relative movement, jump
  (coyote time + input buffer), sprint with FOV kick
- One enemy type with an FSM brain (idle / patrol / chase / windup /
  strike / recover), telegraphed melee attacks, HP, death drops
- Pooled projectiles (64), pooled health pickups, pooled particles
- HUD (health, score, enemies, seed, mute, save), title / pause /
  game-over screens, touch controls
- Save/load via pause menu or HUD (engine save slots, `keelcode:save:slot0`)
- Perf: flat scene graph, shared materials/geometries, instanced props
  and projectiles, Rapier physics stepped at fixed 60 Hz, DPR capped
  1.5 mobile / 2.0 desktop, zero per-frame allocation in update paths —
  well under 150 draw calls (est. ~40)

## Controls

| Input | Action |
|---|---|
| W A S D / arrows | move (camera-relative) |
| Mouse | look (click canvas for pointer lock; drag works without it) |
| Click | shoot |
| Space | jump |
| Shift | sprint |
| Esc / P | pause |
| Touch | left stick moves, drag right side to look, FIRE / JUMP buttons |

## How to run

```sh
cd backends/ts-three
npm install   # once
npm run dev   # vite dev server with hot reload, open the browser
npm run build # tsc --noEmit + vite production build
npm test      # vitest unit tests (engine)
```

Or with the keel CLI (tools/keel-cli):

```sh
keel dev
keel build
```

Click the title screen to start (this resumes the AudioContext). Debug
hook for automated tests: `window.__keel = { world, loop, input, playerId }`.
