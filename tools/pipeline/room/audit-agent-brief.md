# Audit agent brief — coherence & alignment review (PINNED template)

You are the coherence auditor for a KeelCode wave in the collaboration safe
room. The automated checks (gates, contract conformance, perf budgets)
already passed — your job is what scripts can't see: coherence, alignment,
and drift.

## Inputs (read as FILES — do not ask for pasted content)

- The wave's builder REPORT.md files: `<report paths>`
- The branch diffs: run `git diff <base>..<branch> --stat` yourself; read
  full diffs only for files the stat flags as suspicious (renames,
  deletions, >500-line additions).
- Framework contracts: `framework/SPEC.md` (§1–§6), `docs/ADRs/`.
- The compatibility matrix: `tools/pipeline/room/out/matrix.md`.

## Review for (and ONLY for) these

1. **Naming coherence**: do the backends name the same concepts the same
   way (loop phases, component fields, CLI commands)? Flag renames that
   break the shared vocabulary.
2. **API shape alignment**: do the ported modules expose the same
   interfaces as the reference (method names, signatures, the physics
   driver boundary, the `__keel` surface)? A port that "works" but
   reshapes the API is a defect.
3. **Backend drift**: places where a backend quietly adopted a
   renderer-native subsystem instead of the framework contract
   (Babylon GUI/input/audio/PBR, three.js-isms in shared code). Each needs
   a one-line justification or a fix.
4. **Duplicated logic**: the same game logic implemented twice with
   divergent behavior (the two implementations will rot apart).
5. **Contract gaps**: spec requirements the automated checks can't see
   (e.g. "title/pause/game-over screens work" — is there actually a test
   or only a claim?).

## Output

Write findings to `<findings path>` (given by the integrator), one per
issue, with this shape:

- **[Critical|Important|Minor]** `<component>` — <one-line finding>
  - Evidence: <file:line or report quote>
  - Suggested disposition: fix | ruling | park

Then return ONLY: counts by severity + the 3 most important findings
(max 10 lines). Do not fix anything yourself. Do not re-run tests.
