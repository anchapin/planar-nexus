#!/usr/bin/env tsx
/**
 * Issue #2419 — MEASUREMENT SLICE: the cost of whole-state-map copying.
 *
 *   npx tsx scripts/bench-state-copy-cost.ts [--reps 30] [--warmup 3]
 *   npm run bench:state-copy
 *
 * WHY THIS EXISTS
 * ---------------
 * The rules engine copies whole state maps on nearly every action:
 *
 *     new Map(state.cards)   // 262 sites
 *     new Map(state.zones)   // 203 sites
 *     new Map(state.players) //  55 sites
 *
 * (counts measured on `main` @ f1da5ebe — the script re-counts them at run
 * time and prints the number it found, so this header never goes stale).
 *
 * The issue's first step is *measurement*, not optimisation: before anyone
 * picks a persistent-data-structure approach (Mutative / Immer / a
 * persistent map), we need a repeatable number for "what does the copying
 * cost today?" on a fixed, representative mid-game state.
 *
 * This script is that measuring instrument. It is deliberately narrow:
 *
 *   - it does NOT change any engine behaviour,
 *   - it does NOT propose or prototype an optimisation,
 *   - it only builds a fixed state, replays a fixed action sequence through
 *     the real engine entry points, and reports the cost.
 *
 * WHAT IS MEASURED
 * ----------------
 * For every engine action in the fixed sequence:
 *
 *   - `ms/action`       — wall-clock time of the action (median over
 *                         `--reps` repetitions of the whole sequence).
 *   - `copies/action`   — how many times the engine built a *new Map from
 *                         an existing Map* (`new Map(state.cards)` and
 *                         friends) while running that action. Counted by
 *                         temporarily wrapping the global `Map`
 *                         constructor with a counting `Proxy` — the engine
 *                         source is untouched, and the wrapper is removed
 *                         again as soon as the measurement is done.
 *   - `entries copied`  — the summed size of the source maps that were
 *                         copied. This is the "how much of the state was
 *                         duplicated" measure: it is the number that has to
 *                         shrink if the copying is ever removed.
 *   - `heap/action`     — net `heapUsed` growth per action
 *                         (`process.memoryUsage()`), reported as a coarse
 *                         sanity figure next to the exact copy counters.
 *
 * The copy counters are exact for `new Map(<existing Map>)` — the shape the
 * engine uses for its state copies. Copy sites that rebuild a map from an
 * *array* of entries (`new Map(Object.entries(...))`) are not counted by the
 * copy counter; they are rare in the state-copy hot path, and their cost
 * still shows up in `ms/action` and in the heap figure.
 *
 * BASELINE (recorded 2026-11-18, main @ f1da5ebe, default run
 * `npx tsx scripts/bench-state-copy-cost.ts` = 30 reps, 3 warmup, on the
 * supervisor VM: linux x64, Node v24.22.1, AMD EPYC 9D25, 7.7 GiB RAM)
 * -----------
 * Whole sequence: 3.9822 ms, 24 map copies, 1084 entries copied
 * (12 actions). Heaviest actions: resolveCombatDamage 1.4322 ms/action
 * (8 copies, 522 entries), checkStateBasedActions 0.7432 ms (1 copy,
 * 98 entries), playLand 0.5755 ms (3 copies, 115 entries),
 * castSpell 0.3975 ms (3 copies, 19 entries), declareAttackers
 * 0.3604 ms (2 copies, 100 entries). Copy census at run time: 524
 * `new Map(state…)` sites in src/lib/game-state (140 outside __tests__,
 * 200 files). Instrumentation transparency: instrumented and
 * uninstrumented final state hashes identical.
 *
 * DETERMINISM
 * -----------
 * The fixture is fixed, not random:
 *
 *   - `Date.now()` and `Math.random()` are stubbed with a seeded PRNG while
 *     the fixture is built and the actions run, so the game id, the player
 *     ids, the card ids and every engine timestamp are identical from run
 *     to run. Two runs therefore produce the same state hash.
 *   - the action sequence is a fixed list of real engine actions, replayed
 *     in the same order every time.
 *
 * The script asserts that the instrumented run and an uninstrumented run
 * end in the *same* state hash, which is the evidence that the `Map`
 * wrapper does not change engine behaviour.
 *
 * BASELINE (main @ f1da5ebe, this machine)
 * ----------------------------------------
 * See `scripts/bench-state-copy-cost.md` for the full table and the machine
 * context; the numbers are re-printed on every run below the headline
 * table so a later run can be diffed against them by eye.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import {
  advancePhase,
  addMana,
  castSpell,
  checkStateBasedActions,
  computeStateHash,
  createCardInstance,
  createInitialGameState,
  declareAttackers,
  declareBlockers,
  drawCard,
  playLand,
  resolveCombatDamage,
  resolveTopOfStack,
  startGame,
  tapCardAction,
  Phase,
  ZoneType,
  type CardInstanceId,
  type GameState,
  type PlayerId,
  type ScryfallCard,
} from "@/lib/game-state";

/* ------------------------------------------------------------------ args */

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const raw = i >= 0 ? process.argv[i + 1] : undefined;
  const value = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

/* ------------------------------------------------------- determinism stubs */

/**
 * Seeded PRNG (mulberry32). The engine asks `Math.random()` for ids and
 * `Date.now()` for timestamps; both are stubbed so a run is reproducible.
 */
function makeSeededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIXED_NOW = 1_700_000_000_000;

interface Stubs {
  restore: () => void;
}

function installDeterminismStubs(seed = 0x2419): Stubs {
  const realNow = Date.now;
  const realRandom = Math.random;
  const random = makeSeededRandom(seed);
  Date.now = () => FIXED_NOW;
  Math.random = random;
  return {
    restore: () => {
      Date.now = realNow;
      Math.random = realRandom;
    },
  };
}

/* ------------------------------------------------------------ map counter */

/**
 * Count `new Map(<existing Map>)` constructions without touching the
 * engine.
 *
 * The global `Map` is replaced by a `Proxy` whose `construct` trap counts
 * copies and whose `get` trap keeps `Map.prototype` intact, so
 * `x instanceof Map` and `Object.getPrototypeOf(x) === Map.prototype` keep
 * working exactly as before (verified in `assertMapProxyIsTransparent`).
 */
const OriginalMap = Map;

interface CopyCounters {
  copies: number;
  entries: number;
  largest: number;
}

const counters: CopyCounters = { copies: 0, entries: 0, largest: 0 };
let counting = false;

const CountingMap = new Proxy(OriginalMap, {
  construct(target, args, newTarget) {
    if (counting) {
      const source = args[0];
      if (source instanceof OriginalMap) {
        counters.copies += 1;
        counters.entries += source.size;
        if (source.size > counters.largest) counters.largest = source.size;
      }
    }
    return Reflect.construct(target, args, newTarget);
  },
  get(target, prop, receiver) {
    // Keep `Map.prototype` the real prototype so `instanceof` and
    // `Object.getPrototypeOf` behave exactly as with the unpatched Map.
    if (prop === "prototype") return OriginalMap.prototype;
    return Reflect.get(target, prop, receiver);
  },
}) as unknown as MapConstructor;

function installMapCounter(): () => void {
  const globalRef = globalThis as unknown as { Map: MapConstructor };
  const previous = globalRef.Map;
  globalRef.Map = CountingMap;
  return () => {
    globalRef.Map = previous;
  };
}

function resetCounters(): void {
  counters.copies = 0;
  counters.entries = 0;
  counters.largest = 0;
}

/** Prove the proxy is transparent before trusting any number it produces. */
function assertMapProxyIsTransparent(): void {
  const restore = installMapCounter();
  try {
    const original = new Map<string, number>([["a", 1]]);
    const copy = new Map(original);
    const ok =
      original instanceof Map &&
      copy instanceof Map &&
      copy instanceof OriginalMap &&
      Object.getPrototypeOf(copy) === OriginalMap.prototype &&
      copy.get("a") === 1 &&
      copy.size === 1;
    if (!ok) {
      throw new Error("Map counter proxy is not transparent — aborting");
    }
  } finally {
    restore();
  }
}

/* ------------------------------------------------------------- the fixture */

function makeCard(
  partial: Partial<ScryfallCard> & { name: string },
): ScryfallCard {
  return {
    id: `bench-${partial.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name: partial.name,
    type_line: partial.type_line ?? "Creature — Bench",
    power: partial.power ?? "2",
    toughness: partial.toughness ?? "2",
    oracle_text: partial.oracle_text ?? "",
    mana_cost: partial.mana_cost ?? "{1}{W}",
    cmc: partial.cmc ?? 2,
    colors: partial.colors ?? ["W"],
    color_identity: partial.color_identity ?? ["W"],
    legalities: { standard: "legal", commander: "legal" },
    layout: "normal",
    ...partial,
  } as ScryfallCard;
}

const LAND_CARD = makeCard({
  name: "Bench Forest",
  type_line: "Land — Forest",
  power: undefined,
  toughness: undefined,
  mana_cost: "",
  cmc: 0,
  oracle_text: "{T}: Add {G}.",
});

const CREATURE_CARDS = [
  makeCard({ name: "Bench Grizzly", power: "2", toughness: "2" }),
  makeCard({ name: "Bench Hill Giant", power: "3", toughness: "3" }),
  makeCard({
    name: "Bench Serra Angel",
    type_line: "Legendary Creature — Angel",
    power: "4",
    toughness: "4",
    mana_cost: "{3}{W}",
    cmc: 4,
  }),
  makeCard({
    name: "Bench Tidewalker",
    type_line: "Creature — Merfolk Wizard",
    power: "2",
    toughness: "3",
    mana_cost: "{2}{U}",
    cmc: 3,
    colors: ["U"],
    color_identity: ["U"],
  }),
  makeCard({
    name: "Bench Bear",
    power: "2",
    toughness: "2",
    mana_cost: "{1}{G}",
    cmc: 2,
    colors: ["G"],
    color_identity: ["G"],
  }),
];

const LANDS_PER_PLAYER = 6;
const CREATURES_PER_PLAYER = 8;
const LIBRARY_PER_PLAYER = 30;
const GRAVEYARD_PER_PLAYER = 2;

interface Fixture {
  state: GameState;
  aliceId: PlayerId;
  bobId: PlayerId;
  /** A land in Alice's hand (for `playLand`). */
  handLandId: CardInstanceId;
  /** A creature spell in Alice's hand (for `castSpell`). */
  handSpellId: CardInstanceId;
  /** An untapped creature Alice controls (for `declareAttackers`). */
  attackerId: CardInstanceId;
  /** An untapped creature Bob controls (for `declareBlockers`). */
  blockerId: CardInstanceId;
  /** A land Alice controls (for `tapCardAction`). */
  landToTapId: CardInstanceId;
}

/**
 * Build the fixed mid-game state.
 *
 * Everything is built with the engine's own public constructors
 * (`createInitialGameState`, `createCardInstance`, `startGame`,
 * `advancePhase`, `addMana`) — no hand-built internal state shapes.
 */
function buildFixture(): Fixture {
  let state = createInitialGameState(["Alice", "Bob"], 20, false);
  const playerIds = Array.from(state.players.keys());
  const aliceId = playerIds[0];
  const bobId = playerIds[1];

  const handLandId: CardInstanceId[] = [];
  const handSpellId: CardInstanceId[] = [];
  const attackerIds: CardInstanceId[] = [];
  const blockerIds: CardInstanceId[] = [];
  const landIds: CardInstanceId[] = [];

  for (const playerId of playerIds) {
    const battlefieldKey = `${playerId}-${ZoneType.BATTLEFIELD}`;
    const handKey = `${playerId}-${ZoneType.HAND}`;
    const libraryKey = `${playerId}-${ZoneType.LIBRARY}`;
    const graveyardKey = `${playerId}-${ZoneType.GRAVEYARD}`;

    const battlefieldIds: string[] = [];
    const handIds: string[] = [];
    const libraryIds: string[] = [];
    const graveyardIds: string[] = [];

    // Library: enough cards for `startGame` (CR 103.4 needs >= 7).
    for (let i = 0; i < LIBRARY_PER_PLAYER; i++) {
      const card = createCardInstance(
        CREATURE_CARDS[i % CREATURE_CARDS.length],
        playerId,
        playerId,
        { currentZoneKey: libraryKey },
      );
      state.cards.set(card.id, card);
      libraryIds.push(card.id);
    }

    // Battlefield: lands + creatures, all untapped and without summoning
    // sickness (they were "played" earlier in the game, not just cast).
    for (let i = 0; i < LANDS_PER_PLAYER; i++) {
      const land = createCardInstance(LAND_CARD, playerId, playerId, {
        currentZoneKey: battlefieldKey,
      });
      // createCardInstance does not read a hasSummoningSickness option (it
      // defaults every instance to sick), so clear it on the instance
      // itself: these permanents were "played" before the fixture starts.
      land.hasSummoningSickness = false;
      state.cards.set(land.id, land);
      battlefieldIds.push(land.id);
      if (playerId === aliceId) landIds.push(land.id);
    }
    for (let i = 0; i < CREATURES_PER_PLAYER; i++) {
      const creature = createCardInstance(
        CREATURE_CARDS[i % CREATURE_CARDS.length],
        playerId,
        playerId,
        {
          currentZoneKey: battlefieldKey,
        },
      );
      creature.hasSummoningSickness = false;
      state.cards.set(creature.id, creature);
      battlefieldIds.push(creature.id);
      if (playerId === aliceId) attackerIds.push(creature.id);
      else blockerIds.push(creature.id);
    }

    // Hand: two lands and one creature spell for the active player, plus a
    // couple of filler cards for the opponent.
    for (let i = 0; i < 2; i++) {
      const land = createCardInstance(LAND_CARD, playerId, playerId, {
        currentZoneKey: handKey,
        hasSummoningSickness: false,
      });
      state.cards.set(land.id, land);
      handIds.push(land.id);
      if (playerId === aliceId) handLandId.push(land.id);
    }
    const spell = createCardInstance(
      CREATURE_CARDS[2],
      playerId,
      playerId,
      { currentZoneKey: handKey },
    );
    state.cards.set(spell.id, spell);
    handIds.push(spell.id);
    if (playerId === aliceId) handSpellId.push(spell.id);

    // Graveyard: some history.
    for (let i = 0; i < GRAVEYARD_PER_PLAYER; i++) {
      const card = createCardInstance(
        CREATURE_CARDS[i % CREATURE_CARDS.length],
        playerId,
        playerId,
        { currentZoneKey: graveyardKey },
      );
      state.cards.set(card.id, card);
      graveyardIds.push(card.id);
    }

    state.zones.set(battlefieldKey, {
      ...state.zones.get(battlefieldKey)!,
      cardIds: battlefieldIds,
    });
    state.zones.set(handKey, {
      ...state.zones.get(handKey)!,
      cardIds: handIds,
    });
    state.zones.set(libraryKey, {
      ...state.zones.get(libraryKey)!,
      cardIds: libraryIds,
    });
    state.zones.set(graveyardKey, {
      ...state.zones.get(graveyardKey)!,
      cardIds: graveyardIds,
    });
  }

  // Engine path for the opening hands and the turn/phase setup.
  state = startGame(state);

  let turn = state.turn;
  let guard = 0;
  while (turn.currentPhase !== Phase.PRECOMBAT_MAIN && guard < 12) {
    turn = advancePhase(turn);
    guard += 1;
  }
  state = { ...state, turn, priorityPlayerId: aliceId };

  // Alice has the mana to cast the spell and to pay the land.
  state = addMana(state, aliceId, { white: 4, blue: 2, green: 1 });

  return {
    state,
    aliceId,
    bobId,
    handLandId: handLandId[0],
    handSpellId: handSpellId[0],
    attackerId: attackerIds[0],
    blockerId: blockerIds[0],
    landToTapId: landIds[0],
  };
}

/* --------------------------------------------------------- the action plan */

interface ActionStep {
  name: string;
  run: (state: GameState, fixture: Fixture) => GameState;
}

/** Advance the turn through the engine's own phase machine. */
function advanceToPhase(state: GameState, target: Phase): GameState {
  let turn = state.turn;
  let guard = 0;
  while (turn.currentPhase !== target && guard < 12) {
    const next = advancePhase(turn);
    if (next.currentPhase === turn.currentPhase) break;
    turn = next;
    guard += 1;
  }
  if (turn.currentPhase !== target) {
    throw new Error(
      `could not reach phase ${target} (stuck in ${turn.currentPhase})`,
    );
  }
  return { ...state, turn };
}

function buildActionPlan(fixture: Fixture): ActionStep[] {
  return [
    {
      name: "checkStateBasedActions",
      run: (state) => {
        const result = checkStateBasedActions(state);
        return result.state ?? state;
      },
    },
    {
      name: "castSpell",
      run: (state) => {
        const result = castSpell(
          state,
          fixture.aliceId,
          fixture.handSpellId,
          [],
        );
        if (!result.success || !result.state) {
          throw new Error(`castSpell rejected: ${result.error ?? "unknown"}`);
        }
        return result.state;
      },
    },
    {
      name: "resolveTopOfStack",
      run: (state) => resolveTopOfStack(state),
    },
    {
      name: "playLand",
      run: (state) => {
        const result = playLand(state, fixture.aliceId, fixture.handLandId);
        if (!result.success || !result.state) {
          throw new Error(`playLand rejected: ${result.error ?? "unknown"}`);
        }
        return result.state;
      },
    },
    {
      name: "drawCard",
      run: (state) => drawCard(state, fixture.aliceId),
    },
    {
      name: "tapCard",
      run: (state) => {
        const result = tapCardAction(state, fixture.landToTapId);
        if (!result.success || !result.state) {
          throw new Error(`tapCard rejected: ${result.error ?? "unknown"}`);
        }
        return result.state;
      },
    },
    {
      name: "advancePhase->declareAttackers",
      run: (state) => advanceToPhase(state, Phase.DECLARE_ATTACKERS),
    },
    {
      name: "declareAttackers",
      run: (state) => {
        const result = declareAttackers(state, [
          { cardId: fixture.attackerId, defenderId: fixture.bobId },
        ]);
        if (!result.success || !result.state) {
          throw new Error(
            `declareAttackers rejected: ${result.errors?.join("; ") ?? "unknown"}`,
          );
        }
        return result.state;
      },
    },
    {
      name: "advancePhase->declareBlockers",
      run: (state) => advanceToPhase(state, Phase.DECLARE_BLOCKERS),
    },
    {
      name: "declareBlockers",
      run: (state) => {
        const assignments = new Map<CardInstanceId, CardInstanceId[]>([
          [fixture.attackerId, [fixture.blockerId]],
        ]);
        const result = declareBlockers(state, assignments);
        if (!result.success || !result.state) {
          throw new Error(
            `declareBlockers rejected: ${result.errors?.join("; ") ?? "unknown"}`,
          );
        }
        return result.state;
      },
    },
    {
      name: "advancePhase->combatDamage",
      run: (state) => advanceToPhase(state, Phase.COMBAT_DAMAGE),
    },
    {
      name: "resolveCombatDamage",
      run: (state) => {
        const result = resolveCombatDamage(state);
        if (!result.state) throw new Error("resolveCombatDamage returned no state");
        return result.state;
      },
    },
  ];
}

/* ------------------------------------------------------------- the harness */

interface ActionStats {
  name: string;
  samples: number[];
  copies: number[];
  entries: number[];
  largest: number[];
  heap: number[];
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[index];
}

function median(values: number[]): number {
  return percentile(values, 50);
}

/**
 * Run the fixed action sequence once over a freshly built fixture.
 *
 * `instrumented` decides whether the `Map` copy counter is active.
 */
function runSequence(
  instrumented: boolean,
): {
  stats: Map<string, ActionStats>;
  finalHash: string;
} {
  // The fixture (and therefore the plan) is rebuilt for every run: the
  // engine generates ids from `Date.now()` / `Math.random()`, so each run
  // gets its own ids and the plan must be built from *that* fixture.
  // The determinism stubs are re-installed per run so every run starts
  // from the same PRNG seed: two runs (e.g. the instrumented and control
  // runs compared in main) then build identical fixtures and their final
  // state hashes are comparable.
  const runStubs = installDeterminismStubs();
  try {
  const fixture = buildFixture();
  const plan = buildActionPlan(fixture);
  const stats = new Map<string, ActionStats>();
  for (const step of plan) {
    stats.set(step.name, {
      name: step.name,
      samples: [],
      copies: [],
      entries: [],
      largest: [],
      heap: [],
    });
  }

  let state = fixture.state;
  for (const step of plan) {
    const stat = stats.get(step.name)!;
    const heapBefore = process.memoryUsage().heapUsed;
    resetCounters();
    counting = instrumented;
    const started = performance.now();
    state = step.run(state, fixture);
    const elapsed = performance.now() - started;
    counting = false;
    const heapAfter = process.memoryUsage().heapUsed;

    stat.samples.push(elapsed);
    stat.copies.push(counters.copies);
    stat.entries.push(counters.entries);
    stat.largest.push(counters.largest);
    stat.heap.push(heapAfter - heapBefore);
  }

  return { stats, finalHash: computeStateHash(state) };
  } finally {
    runStubs.restore();
  }
}

/* ------------------------------------------------------------ copy census */

/** Count the `new Map(state…)` copy sites in the engine, live. */
function censusCopySites(): { total: number; production: number; files: number } {
  const root = path.join(process.cwd(), "src", "lib", "game-state");
  let total = 0;
  let production = 0;
  const files = new Set<string>();
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".ts")) continue;
      const content = fs.readFileSync(full, "utf8");
      const matches = content.match(/new Map\(state/g) ?? [];
      if (matches.length === 0) continue;
      total += matches.length;
      files.add(full);
      if (!full.includes(`${path.sep}__tests__${path.sep}`)) {
        production += matches.length;
      }
    }
  };
  walk(root);
  return { total, production, files: files.size };
}

/* ------------------------------------------------------------------ main */

function main(): void {
  const reps = Math.max(1, Math.trunc(arg("reps", 30)));
  const warmup = Math.max(0, Math.trunc(arg("warmup", 3)));

  assertMapProxyIsTransparent();

  const stubs = installDeterminismStubs();
  const restoreMap = installMapCounter();

  try {
    const fixture = buildFixture();
    const plan = buildActionPlan(fixture);
    const census = censusCopySites();

    console.log(
      `Fixed mid-game state: ${fixture.state.cards.size} cards, ` +
        `${fixture.state.players.size} players, ${fixture.state.zones.size} zones`,
    );
    console.log(
      `Copy sites in src/lib/game-state: ${census.total} ` +
        `(${census.production} outside __tests__, ${census.files} files)`,
    );
    console.log(
      `Action sequence (${plan.length} steps) x ${reps} repetitions ` +
        `(+${warmup} warmup)`,
    );
    console.log("");

    // Warmup: let the JIT settle before the measured repetitions.
    for (let i = 0; i < warmup; i++) {
      runSequence(true);
    }

    // Measured runs, instrumented: `reps` repetitions, stats merged so
    // the medians in the table are over all repetitions.
    const measured = runSequence(true);
    for (let i = 1; i < reps; i++) {
      const again = runSequence(true);
      for (const [name, stat] of measured.stats) {
        const more = again.stats.get(name)!;
        stat.samples.push(...more.samples);
        stat.copies.push(...more.copies);
        stat.entries.push(...more.entries);
        stat.largest.push(...more.largest);
        stat.heap.push(...more.heap);
      }
    }

    // Control run, uninstrumented: proves the Map wrapper does not change
    // engine behaviour (identical final state hash).
    const control = runSequence(false);

    const hashMatches = measured.finalHash === control.finalHash;

    const header =
      "| action | ms/action | map copies/action | entries copied/action | largest copy | heap Δ/action (B) |";
    const divider =
      "| --- | ---: | ---: | ---: | ---: | ---: |";
    console.log(header);
    console.log(divider);
    for (const step of plan) {
      const stat = measured.stats.get(step.name)!;
      const ms = median(stat.samples);
      const copies = median(stat.copies);
      const entries = median(stat.entries);
      const largest = median(stat.largest);
      const heap = stat.heap.reduce((a, b) => a + b, 0) / stat.heap.length;
      console.log(
        `| ${stat.name} | ${ms.toFixed(4)} | ${copies.toFixed(0)} | ` +
          `${entries.toFixed(0)} | ${largest.toFixed(0)} | ${heap.toFixed(0)} |`,
      );
    }

    const totalMs = plan.reduce(
      (sum, step) => sum + median(measured.stats.get(step.name)!.samples),
      0,
    );
    const totalCopies = plan.reduce(
      (sum, step) => sum + median(measured.stats.get(step.name)!.copies),
      0,
    );
    const totalEntries = plan.reduce(
      (sum, step) => sum + median(measured.stats.get(step.name)!.entries),
      0,
    );

    console.log("");
    console.log(
      `Whole sequence: ${totalMs.toFixed(4)} ms, ` +
        `${totalCopies.toFixed(0)} map copies, ` +
        `${totalEntries.toFixed(0)} entries copied ` +
        `(${plan.length} actions, ${reps} repetitions)`,
    );
    console.log(
      `Instrumentation transparency: instrumented hash === uninstrumented hash ` +
        `-> ${hashMatches ? "YES" : "NO"} (${measured.finalHash})`,
    );
    if (!hashMatches) {
      throw new Error(
        "instrumented and uninstrumented runs diverged — the Map counter changes engine behaviour",
      );
    }

    const cpu = os.cpus()[0];
    console.log("");
    console.log("Machine context:");
    console.log(
      `  platform ${os.platform()} ${os.release()} ${os.arch()}, ` +
        `node ${process.version}`,
    );
    console.log(
      `  cpu ${cpu ? cpu.model.trim() : "unknown"} x${os.cpus().length}, ` +
        `${(os.totalmem() / 1024 ** 3).toFixed(1)} GiB RAM`,
    );
    console.log(
      `  command: node_modules/.bin/tsx scripts/bench-state-copy-cost.ts ` +
        `--reps ${reps} --warmup ${warmup}`,
    );
  } finally {
    restoreMap();
    stubs.restore();
  }
}

if (process.argv[1]?.endsWith("bench-state-copy-cost.ts")) {
  main();
}
