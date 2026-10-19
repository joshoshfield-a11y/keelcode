# KeelCode `rs-core` — Wave 2b perf notes (desktop tier)

Date: 2026-10-19. Sandbox has **no GPU** — every number below is labeled
measured vs declared. The S25 150-draw-call budget is the web/three.js
number and does not apply here; this file declares the desktop tier's own
budgets per the Wave 2 brief.

## Dependency versions (rustc 1.99.0)

| crate | version | note |
|---|---|---|
| `wgpu` | **30.0.1** | latest on crates.io 2026-10-19 |
| `winit` | **0.30.13** | latest stable 0.30.x (0.31 is beta — avoided) |
| `bytemuck` | 1.25.2 | `Pod` derive for the instance struct |
| `pollster` | 1.0.1 | blocks on wgpu's async adapter/device requests |

`rapier3d =0.22.0` and all 2a deps untouched.

## Draw calls — declared budget: ≤ 8 per frame

The renderer issues draw calls by construction (see `src/render/renderer.rs`):

| pass | draw calls | condition |
|---|---|---|
| scene (all snapshot items, instanced) | **1** | every frame |
| overlay (fullscreen tint) | **1** | title / pause / game-over only |

So: **1 draw call during gameplay, 2 when an overlay is visible.**
Measured-on-GPU: not possible here (see below) — the count follows from the
code path, not from a GPU capture; verify with RenderDoc on real hardware.

Typical instance counts in that single scene draw (demo, seed 1337, t=0):
1 floor + 4 walls + 7 pillars + 1 player + 6 enemies + 3 pickups = **22
instances**; projectiles/pickup drops add instances as the sim runs. The
instance buffer is preallocated for 2048 (`MAX_INSTANCES`); per-frame upload
is one `queue.write_buffer` of ≤ 2048 × 80 B.

## Frame time — UNMEASURED on this box

No GPU in the sandbox (wgpu `request_adapter` finds no Vulkan ICD and no
EGL; the desktop binary stops cleanly at surface creation — see below), so
**no frame-time number is claimed**. On first real-hardware run, measure p95
frame time at 1280×720 vs the declared desktop budget **p95 ≤ 16.6 ms** and
record it here. The window title shows a live fps counter for a quick
sanity check on that run.

## Headless-run result (2026-10-19)

- No display: `keel-desktop` exits 3 with
  `cannot create event loop (no display?)` — clean, no panic.
- Under `xvfb-run`: winit window **creates successfully**, then
  `Renderer::new` fails at the first wgpu call —
  `wgpu: create surface: Failed to create surface for any enabled backend`
  — and the app exits the event loop gracefully. (winit's X11 backend
  needed `libxkbcommon-x11-0`, installed sandbox-locally via apt for the
  test; it is not a project dependency.)
- Everything up to the GPU boundary is exercised: arg parsing, `Demo::new`
  + `bind_phases`, winit window, wgpu instance creation. The snapshot →
  instance → camera-matrix path is additionally covered GPU-free by
  `tests/render.rs` (2 tests) and 5 unit tests in `src/render/mod.rs`.

## What the 2b screens are

`OverlayKind` (`src/render/window.rs`): `Title` (dark tint, sim bound but no
frames run, "press Enter" in the window title), `Paused` (Esc; sim frozen),
`GameOver` (red tint on player death; Enter rebuilds the demo and restarts).
No text rendering in 2b — the screen name lives in the window title, which
also shows live fps. Touch controls N/A on desktop (brief §Wave 2b).

## Open item

**Visual check on real hardware**: open `keel-desktop`, walk the arena
(WASD/arrows, Space, Shift, click), and confirm the scene reads correctly
(player blue box, red enemies, white projectiles, green pickups, gray
arena), the title/pause/game-over tints appear, and p95 frame time lands
under 16.6 ms at 1280×720. Do not claim the renderer verified until then.
