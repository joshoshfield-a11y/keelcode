# KeelCode perf report — ts-three reference backend

- Date: 2026-10-20T13:54:45.011Z
- Tier: desktop · URL: http://localhost:4173 · frames sampled: 300
- Renderer: ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)
- Budgets: tools/perf-harness/budgets.json

| Check | Measured | Budget | Verdict |
|---|---|---|---|
| draw calls (max over run) | 27 | 150 | PASS |
| triangles (max over run) | 12242 | 300000 | PASS |
| device pixel ratio (desktop cap) | 1 | 2 | PASS |
| frame time p95 | 416.70 ms | 33.3 ms | SKIP — software GL (ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)): frame times are not representative of real GPUs; enforce on hardware |

## Frame-time distribution (ms)
- mean 362.08, p50 366.6, p95 416.7, p99 483.3
- triangles/frame: mean 12211, max 12242
- console errors during run: 0

Binding rule (framework/SPEC.md §4): any FAIL above blocks the wave unless the regression is measured, disclosed, and explicitly waived by the user.
