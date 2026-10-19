# Perf Report — ts-babylon backend (Wave 3, child C)

Measured 2026-10-19 via `tools/perf-harness/measure.mjs` against the production
preview (`npm run preview`, port 4174) in headless Chromium (SwiftShader
software GL). **All frame-time numbers are headless-only** and not comparable
to real hardware; they are recorded for regression tracking between runs.

## Method

- **Draw calls**: `engine._drawCalls` PerfCounter (the exact counter
  `BABYLON.SceneInstrumentation.drawCallsCounter` exposes), with a manual
  `fetchNewFrame()` before each `scene.render()` — manual renders bypass the
  rAF endFrame that normally resets the cumulative counter. Median over 120
  frames (min/max/median were identical: 65/65/65, stable).
- **Triangles**: sum over `scene.getActiveMeshes()` (post frustum-cull, what the
  renderer actually draws) of `getTotalIndices()/3`. Each InstancedMesh entry
  counts once.
- **DPR**: `1 / engine.getHardwareScalingLevel()`. Headless reports 1.
- **Frame time**: wall time of `loop.step()` + `scene.render()` over 120 frames;
  p50/p95/max. HEADLESS-ONLY.
- **Bundle**: sum of all files under `dist/` (JS + Havok WASM + assets).
- The harness fails (exit 1) on any console error or pageerror; this run had
  zero.

## Results vs ts-three (no-regression table)

| Metric | ts-babylon (measured) | ts-three (build report) | Budget | Verdict |
|---|---|---|---|---|
| Draw calls | **65** | 15–27 | 150 | **REGRESSION vs ts-three** (2.4–4.3×), but **under budget** (65 < 150). Disclosed, not waived. Likely cause: Babylon issues more draws per mesh (material/lighting passes) and batches less aggressively than the three.js backend. No Babylon-isms were introduced to chase this; neutral placeholder art unchanged. |
| Triangles (drawn) | **5,474** | ~10,000–12,000 | 300,000 | **IMPROVEMENT** (~2× fewer). Under budget by 55×. |
| DPR (headless) | 1 | 1 (vs 2.0 cap) | 2.0 / 1.5 | Same. Both run DPR 1 under headless SwiftShader. |
| Frame time p95 | **82.5 ms** | (not reported) | 33.3 ms | **HEADLESS-ONLY**. SwiftShader software rasterization; meaningless for real hardware. Recorded for run-to-run regression tracking only. Real-device (S25) measurement is still open. |
| Bundle size | **9,477,786 bytes (9.04 MB)** | 2.6 MB | — | **REGRESSION** (3.5×). Cause: Babylon core (~7.18 MB in `index-*.js`) + Havok WASM (~2.09 MB). Disclosed, not waived. This is the known cost of the Babylon/Havok stack; no action taken (would require dropping Havok or tree-shaking Babylon, out of scope for Wave 3). |
| Console errors | 0 | 0 | 0 | Clean. |

### measured.json

Full machine-readable results (including per-file bundle breakdown) are in
`tools/perf-harness/measured.json`.

## Notes

- The draw-call delta (65 vs 15–27) is the only rendering regression. It stays
  comfortably under the 150-call S25 budget. If a future wave needs to close
  the gap, the levers are mesh merging / stronger instancing in `src/game/gfx/`
  — not material or lighting changes (house rule: no Babylon-isms).
- Frame-time p95 on SwiftShader (82.5 ms) exceeds the 33.3 ms budget, but the
  budget targets real hardware; software-GL numbers cannot pass or fail it.
  The S25 measurement remains the binding check.
- Bundle: the 9.04 MB is dominated by two files — `index-*.js` (7.18 MB,
  Babylon core) and the Havok WASM (~2.09 MB). gzip would cut the JS ~4.4×
  (1.60 MB gzipped per the build report), but the served bytes are recorded
  here as built.
