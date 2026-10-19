# KeelCode perf report — ts-three reference backend

- Date: 2026-10-19T07:04:19.922Z
- Tier: desktop · URL: http://localhost:4173 · frames sampled: 300
- Renderer: ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)
- Budgets: tools/perf-harness/budgets.json

| Check | Measured | Budget | Verdict |
|---|---|---|---|
| draw calls (max over run) | 15 | 150 | PASS |
| triangles (max over run) | 10278 | 300000 | PASS |
| device pixel ratio (desktop cap) | 1 | 2 | PASS |
| frame time p95 | 1150.00 ms | 33.3 ms | SKIP — software GL (ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)): frame times are not representative of real GPUs; enforce on hardware |

## Frame-time distribution (ms)
- mean 844.78, p50 816.7, p95 1150, p99 1266.7
- triangles/frame: mean 10278, max 10278
- console errors during run: 0

Binding rule (framework/SPEC.md §4): any FAIL above blocks the wave unless the regression is measured, disclosed, and explicitly waived by the user.
