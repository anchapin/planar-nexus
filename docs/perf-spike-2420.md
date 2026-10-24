# Perf spike (#2420): current stack vs rust/wasm engine core vs canvas board rendering

Spike for issue #2420. Deliverable: a runnable benchmark of the **current**
stack with real measured numbers (`scripts/perf-spike-bench.ts`), an honest
statement of what could not be measured in this environment, and a
recommendation with decision criteria.

## How to reproduce

```bash
npx tsx scripts/perf-spike-bench.ts --iterations 100 --warmup 10
```

Scenario (pre-seeded, follows the repo's game-state test pattern —
`createInitialGameState` + `startGame` + `createCardInstance` + zone
placement): mid-game state, 20 permanents per side (15 creatures + 5 lands),
a spell in hand, 1 red mana, precombat main phase. Each iteration runs a
fixed sequence of representative engine actions: advance phase, cast spell,
resolve stack, declare attackers, resolve combat damage.

## Measured results (this run)

Environment: node v24.22.1, linux/x64, AMD EPYC 9D25 (VM, 2 vCPU visible to
the process). 100 iterations, 10 warmup. Absolute numbers are
machine-specific; the **ratios** are the decision-relevant part.

### A. TypeScript rules engine

| action                |  ms/action | median |    p90 |
| --------------------- | ---------: | -----: | -----: |
| advance phase         |      0.027 |  0.012 |  0.020 |
| cast spell            |      1.559 |  0.488 |  3.687 |
| resolve stack         |      0.302 |  0.057 |  0.265 |
| declare attackers     |      3.939 |  3.256 |  7.544 |
| resolve combat damage |      6.863 |  4.672 | 13.706 |
| **sequence total**    | **12.701** |  9.338 | 27.690 |

- Engine throughput: **393.7 actions/sec** (5 actions/iteration).
- Whole-state copy (serialize + deserialize — what `cloneGameState` does):
  **6.929 ms/copy** (median 4.909, p90 14.699). Copying the state before
  every action would consume **73.2% of an action's total cost** at this
  board size.

### B. Board render path (headless)

| stage                                              | median ms |  p90 ms |
| -------------------------------------------------- | --------: | ------: |
| engine state → UI view model (`convertEngineToUI`) |     0.096 |   0.625 |
| `<GameBoard>` React DOM **server** render (PROXY)  |    92.737 | 136.991 |
| engine state serialization (save/sync path)        |     0.539 |   3.050 |

View model: 41 cards; board HTML 38,590 bytes; serialized state 60,608 bytes.

The server render is a **proxy** for browser rendering: it exercises the
same component tree and the same view-model conversion, but does no layout,
no paint, no compositing, and loads no card images. Browser frame cost will
differ; the proxy still shows the React tree itself is the expensive stage,
not the view-model conversion (0.096 ms median).

## What was NOT measured, and why

- **Rust/wasm engine core:** no wasm target/toolchain is set up in this
  repo or in the benchmark environment, and there is no Rust port of the
  rules engine to measure. Any number here would be fabricated, so none is
  given. Estimating it requires first standing up a minimal wasm build of
  one engine slice (e.g. combat damage) — that is a separate, larger spike.
- **Canvas board rendering:** canvas cost is dominated by layout/paint in a
  real browser, which a headless node process cannot reproduce. The React
  server-render proxy above is the closest honest headless signal.

## Comparison on the measured evidence

| option                                  | evidence                                                                                                                                                                                                                                    | integration cost                                                                                                                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current stack (TS engine + React board) | Engine actions are 0.03–6.9 ms; the dominant costs are (1) whole-state copying at 6.9 ms/copy (73% overhead if done per action) and (2) the React board tree at ~93 ms median per full render (proxy). View-model conversion is negligible. | Zero — it is the shipping stack.                                                                                                                                                                      |
| Rust/wasm engine core                   | Unmeasured. Would only pay off if engine compute (not copying, not rendering) were the bottleneck; at 12.7 ms per 5-action sequence it is not, except combat-heavy tails (p90 27.7 ms/sequence).                                            | Very high: port or bridge the entire rules engine, re-test correctness against the TS engine, new build pipeline.                                                                                     |
| Canvas board rendering                  | Unmeasured directly, but the proxy points at the render tree as the largest single cost (~93 ms median for a full-board render at 41 cards). A canvas renderer attacks exactly this cost.                                                   | High: reimplement the board's interaction model (targeting, drag, accessibility) outside React. A cheaper intermediate step is reducing full-board re-renders (see #2418, per-slice store selectors). |

## Recommendation

1. **Do not start a rust/wasm engine port on performance grounds.** The
   measured bottleneck is state copying and rendering, not engine compute.
   Revisit only if profiling a real workload shows engine compute dominating
   after the copy/render costs are fixed, or if a non-performance goal
   (e.g. a shared core with another client) justifies it.
2. **Attack the whole-state copy first** (structural sharing / avoiding a
   clone per action — the #2419 direction): it is worth up to ~73% of
   per-action cost at this board size and needs no new platform.
3. **Attack full-board re-renders second** (per-slice selectors — the
   #2418 direction) before considering canvas: the conversion layer is
   already cheap, so narrowing what re-renders captures most of the win
   while keeping React's interaction and accessibility model. Canvas stays
   on the table only if a browser-profiled 40+ permanent board still cannot
   hold frame budget after (2) and (3).

## Decision criteria (for closing this spike)

- If a future browser profile shows engine compute > 50% of frame time on
  representative boards **after** copy and re-render fixes, reopen the
  wasm question with a one-slice wasm prototype benchmark.
- If React re-render narrowing cannot hold ~16 ms frames on a 40-permanent
  board in a real browser profile, prototype the canvas board as a
  rendering-layer swap behind the same view model.

---

_Supervisor completion note: the worker (MiniMax-M2.5-highspeed, cheap tier)
wrote `scripts/perf-spike-bench.ts` and hit its 60-step cap before the
write-up. The supervisor exported `convertEngineToUI` from
`src/hooks/use-game-engine.ts` (it existed but was not exported, so the
bench could not import it), ran the bench, and wrote this document from
that run's actual output. Scratch files from the worker's exploration were
removed._
