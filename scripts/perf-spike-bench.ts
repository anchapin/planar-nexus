/**
 * #2420 perf spike — measured benchmark of the current stack.
 *
 *   npx tsx scripts/perf-spike-bench.ts [--iterations 200] [--warmup 20]
 *
 * Measures, on this machine, with real numbers:
 *
 *   (a) the current TypeScript rules engine on the pre-seeded mid-game
 *       scenario (20 permanents per side): ms/action and actions/sec for a
 *       fixed sequence of representative engine actions (advance phase,
 *       cast a spell, resolve the stack, declare attackers, resolve combat
 *       damage), plus the cost of a whole-state copy
 *       (serialize + deserialize — exactly what the engine's
 *       `cloneGameState` does) per action.
 *
 *   (b) the board render path, headless: engine state -> UI view model
 *       (`convertEngineToUI`, the same conversion the app feeds to
 *       `<GameBoard>`) and then a React DOM *server* render of the real
 *       `<GameBoard>` component. The server render is a PROXY for browser
 *       rendering: it exercises the same component tree and the same
 *       view-model conversion, but it does no layout, no paint and no
 *       compositing, and it does not load card images.
 *
 * The scenario builder follows the pattern the repo's game-state tests use
 * (`createInitialGameState` + `startGame` + `createCardInstance` + zone
 * placement, see `src/lib/game-state/__tests__/dungeon-venture.test.ts`).
 *
 * Prints a results table to stdout and exits 0.
 */
import * as os from "node:os";
import React from "react";
import { renderToString } from "react-dom/server";
import {
  addMana,
  advancePhase,
  castSpell,
  createCardInstance,
  createInitialGameState,
  declareAttackers,
  loadCardScripts,
  resolveCombatDamage,
  resolveTopOfStack,
  startGame,
  Phase,
  type CardInstanceId,
  type GameState,
  type PlayerId,
  type ScryfallCard,
} from "@/lib/game-state";
import {
  deserializeGameStateString,
  serializeGameStateString,
} from "@/lib/game-state";
import { GameBoard } from "@/components/game-board";
import { convertEngineToUI } from "@/hooks/use-game-engine";

/* ------------------------------------------------------------------ args */

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
}

const ITERATIONS = arg("iterations", 200);
const WARMUP = arg("warmup", 20);
const PERMANENTS_PER_SIDE = arg("permanents", 20);
const ATTACKERS = arg("attackers", 10);

/* -------------------------------------------------------------- scenario */

function syntheticCard(
  overrides: Partial<ScryfallCard> & { id: string },
): ScryfallCard {
  return {
    name: "Test Card",
    type_line: "Creature",
    oracle_text: "",
    mana_cost: "",
    cmc: 0,
    colors: [],
    color_identity: [],
    legalities: { standard: "legal", commander: "legal" },
    layout: "normal",
    ...overrides,
  } as ScryfallCard;
}

/** Put one card instance into a player zone (the game-state test pattern). */
function placeCard(
  state: GameState,
  playerId: PlayerId,
  cardData: ScryfallCard,
  zone: string,
): { state: GameState; cardId: CardInstanceId } {
  const zoneKey = `${playerId}-${zone}`;
  const zoneState = state.zones.get(zoneKey);
  if (!zoneState) throw new Error(`zone ${zoneKey} missing`);
  const instance = createCardInstance(cardData, playerId, playerId, {
    id: `${cardData.id}-${state.cards.size}`,
  });
  const cards = new Map(state.cards);
  cards.set(instance.id, { ...instance, currentZoneKey: zoneKey });
  const zones = new Map(state.zones);
  zones.set(zoneKey, {
    ...zoneState,
    cardIds: [...zoneState.cardIds, instance.id],
  });
  return { state: { ...state, cards, zones }, cardId: instance.id };
}

interface Scenario {
  base: GameState;
  alice: PlayerId;
  bob: PlayerId;
  spellCardId: CardInstanceId;
  attackers: CardInstanceId[];
  permanentsPerSide: number;
}

/**
 * Mid-game state: each side holds `PERMANENTS_PER_SIDE` permanents
 * (creatures + lands), the active player holds a one-mana spell in hand and
 * one red mana, and it is the active player's precombat main phase.
 */
function buildScenario(): Scenario {
  let state = createInitialGameState(["Alice", "Bob"], 20, false);
  state = startGame(state);
  const [alice, bob] = Array.from(state.players.keys());

  const creaturesPerSide = Math.max(1, PERMANENTS_PER_SIDE - 5);
  for (const [playerId, prefix] of [
    [alice, "alice"],
    [bob, "bob"],
  ] as [PlayerId, string][]) {
    for (let i = 0; i < creaturesPerSide; i++) {
      state = placeCard(
        state,
        playerId,
        syntheticCard({
          id: `${prefix}-creature-${i}`,
          name: `${prefix === "alice" ? "Alice" : "Bob"} Bear ${i}`,
          type_line: "Creature — Bear",
          power: "1",
          toughness: "1",
        }),
        "battlefield",
      ).state;
    }
    for (let i = 0; i < PERMANENTS_PER_SIDE - creaturesPerSide; i++) {
      state = placeCard(
        state,
        playerId,
        syntheticCard({
          id: `${prefix}-land-${i}`,
          name: `${prefix === "alice" ? "Alice" : "Bob"} Forest ${i}`,
          type_line: "Land — Forest",
          oracle_text: "({T}: Add {G}.)",
        }),
        "battlefield",
      ).state;
    }
  }

  const spell = placeCard(
    state,
    alice,
    syntheticCard({
      id: "alice-spell",
      name: "Alice Bolt",
      type_line: "Instant",
      mana_cost: "{R}",
      cmc: 1,
    }),
    "hand",
  );
  state = spell.state;

  const attackers = (
    state.zones.get(`${alice}-battlefield`)?.cardIds ?? []
  ).slice(0, ATTACKERS);

  // The attackers have been on the battlefield since before this turn.
  const cards = new Map(state.cards);
  for (const id of attackers) {
    const card = cards.get(id);
    if (card) cards.set(id, { ...card, hasSummoningSickness: false });
  }

  state = {
    ...state,
    cards,
    turn: { ...state.turn, currentPhase: Phase.PRECOMBAT_MAIN },
    priorityPlayerId: alice,
    status: "in_progress",
  };
  state = addMana(state, alice, { red: 1 });

  return {
    base: state,
    alice,
    bob,
    spellCardId: spell.cardId,
    attackers,
    permanentsPerSide: PERMANENTS_PER_SIDE,
  };
}

/** The engine's canonical whole-state copy (serialize + deserialize). */
function copyState(state: GameState): GameState {
  return deserializeGameStateString(serializeGameStateString(state));
}

/* --------------------------------------------------------------- helpers */

function stats(samples: number[]): {
  mean: number;
  median: number;
  p90: number;
  min: number;
} {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  return {
    mean,
    median: at(0.5),
    p90: at(0.9),
    min: sorted[0],
  };
}

function fmt(n: number, digits = 3): string {
  return n.toFixed(digits);
}

/* ------------------------------------------------------------ engine run */

interface EngineMeasurement {
  perAction: Record<string, number[]>;
  sequenceMs: number[];
  copies: number[];
  actionsPerSecond: number;
  copyMsPerCopy: number;
  copyMsPerAction: number;
  copyShareOfAction: number;
}

function runEngine(scenario: Scenario): EngineMeasurement {
  const { base, alice, bob, spellCardId, attackers } = scenario;

  const perAction: Record<string, number[]> = {
    "advance phase": [],
    "cast spell": [],
    "resolve stack": [],
    "declare attackers": [],
    "resolve combat damage": [],
  };
  const sequenceMs: number[] = [];
  const copies: number[] = [];

  const oneIteration = () => {
    // 1. whole-state copy (the per-action copy cost)
    const c0 = performance.now();
    let state = copyState(base);
    copies.push(performance.now() - c0);

    const seqStart = performance.now();

    // 2. advance the phase (precombat main -> begin combat)
    let t = performance.now();
    const turn = advancePhase(state.turn);
    state = {
      ...state,
      turn,
      priorityPlayerId: alice,
    };
    perAction["advance phase"].push(performance.now() - t);

    // 3. cast a spell
    t = performance.now();
    const cast = castSpell(state, alice, spellCardId);
    if (!cast.success) throw new Error(`cast failed: ${cast.error}`);
    state = cast.state;
    perAction["cast spell"].push(performance.now() - t);

    // 4. resolve the stack
    t = performance.now();
    state = resolveTopOfStack(state);
    perAction["resolve stack"].push(performance.now() - t);

    // 5. declare attackers
    t = performance.now();
    const declared = declareAttackers(
      state,
      attackers.map((cardId) => ({ cardId, defenderId: bob })),
    );
    if (!declared.success) {
      throw new Error(
        `declare attackers failed: ${declared.errors?.join(", ")}`,
      );
    }
    state = declared.state;
    perAction["declare attackers"].push(performance.now() - t);

    // 6. resolve combat damage
    t = performance.now();
    state = {
      ...state,
      turn: { ...state.turn, currentPhase: Phase.COMBAT_DAMAGE },
    };
    const damage = resolveCombatDamage(state);
    if (!damage.success) throw new Error(`combat damage failed`);
    state = damage.state;
    perAction["resolve combat damage"].push(performance.now() - t);

    sequenceMs.push(performance.now() - seqStart);
  };

  for (let i = 0; i < WARMUP; i++) oneIteration();
  for (const key of Object.keys(perAction)) perAction[key].length = 0;
  sequenceMs.length = 0;
  copies.length = 0;

  for (let i = 0; i < ITERATIONS; i++) oneIteration();

  const totalActionMs = Object.values(perAction).reduce(
    (sum, list) => sum + stats(list).mean * list.length,
    0,
  );
  const totalSequenceMs = sequenceMs.reduce((a, b) => a + b, 0);
  const copyStats = stats(copies);
  const actionCount = ITERATIONS * Object.keys(perAction).length;

  return {
    perAction,
    sequenceMs,
    copies,
    actionsPerSecond: actionCount / (totalSequenceMs / 1000),
    copyMsPerCopy: copyStats.mean,
    // A copy-per-action design pays the copy cost once per engine action.
    copyMsPerAction: copyStats.mean,
    copyShareOfAction:
      copyStats.mean / (totalActionMs / actionCount + copyStats.mean),
  };
}

/* ----------------------------------------------------------- board render */

interface RenderMeasurement {
  viewModelMs: number[];
  boardRenderMs: number[];
  serializeMs: number[];
  htmlBytes: number;
  serializedBytes: number;
  uiCards: number;
}

function runRender(scenario: Scenario): RenderMeasurement {
  const { base, alice, bob } = scenario;
  const viewModelMs: number[] = [];
  const boardRenderMs: number[] = [];
  const serializeMs: number[] = [];
  let htmlBytes = 0;
  let serializedBytes = 0;
  let uiCards = 0;

  const round = () => {
    let t = performance.now();
    const ui = convertEngineToUI(base);
    viewModelMs.push(performance.now() - t);
    uiCards = ui.players.reduce(
      (sum, p) =>
        sum +
        p.battlefield.length +
        p.hand.length +
        p.graveyard.length +
        p.exile.length +
        p.library.length,
      0,
    );

    t = performance.now();
    const html = renderToString(
      React.createElement(GameBoard, {
        players: ui.players,
        playerCount: 2,
        currentTurnIndex:
          base.players.get(alice) === base.turn.activePlayerId ? 0 : 1,
        localPlayerId: alice,
      }),
    );
    boardRenderMs.push(performance.now() - t);
    htmlBytes = html.length;

    t = performance.now();
    const json = serializeGameStateString(base);
    serializeMs.push(performance.now() - t);
    serializedBytes = json.length;
  };

  for (let i = 0; i < Math.max(3, Math.floor(WARMUP / 2)); i++) round();
  viewModelMs.length = 0;
  boardRenderMs.length = 0;
  serializeMs.length = 0;

  for (let i = 0; i < Math.max(10, Math.floor(ITERATIONS / 4)); i++) round();

  return {
    viewModelMs,
    boardRenderMs,
    serializeMs,
    htmlBytes,
    serializedBytes,
    uiCards,
  };
}

/* ------------------------------------------------------------------ main */

async function main(): Promise<void> {
  await loadCardScripts();

  const scenario = buildScenario();
  const engine = runEngine(scenario);
  const render = runRender(scenario);

  const cpus = os.cpus();
  const lines: string[] = [];
  const push = (line = "") => lines.push(line);

  push("=".repeat(78));
  push("#2420 perf spike — current stack (TypeScript engine + React board)");
  push("=".repeat(78));
  push(
    `node            ${process.version} (${process.platform}/${process.arch})`,
  );
  push(`cpu             ${cpus[0]?.model ?? "unknown"} x${cpus.length}`);
  push(`iterations      ${ITERATIONS} (warmup ${WARMUP})`);
  push(
    `scenario        ${scenario.permanentsPerSide} permanents per side ` +
      `(${scenario.permanentsPerSide - 5} creatures + 5 lands), ` +
      `spell in hand, 1 red mana, precombat main`,
  );
  push("");

  push("A. TypeScript rules engine (fixed action sequence per iteration)");
  push("-".repeat(78));
  push(
    "action".padEnd(26) +
      "ms/action".padStart(12) +
      "median".padStart(10) +
      "p90".padStart(10) +
      "ms/iter".padStart(11),
  );
  for (const [name, samples] of Object.entries(engine.perAction)) {
    const s = stats(samples);
    push(
      name.padEnd(26) +
        fmt(s.mean).padStart(12) +
        fmt(s.median).padStart(10) +
        fmt(s.p90).padStart(10) +
        fmt(s.mean * samples.length).padStart(11),
    );
  }
  const seq = stats(engine.sequenceMs);
  push("-".repeat(78));
  push(
    "sequence total".padEnd(26) +
      fmt(seq.mean).padStart(12) +
      fmt(seq.median).padStart(10) +
      fmt(seq.p90).padStart(10) +
      "",
  );
  push(
    `engine actions/sec          ${fmt(engine.actionsPerSecond, 1)} ` +
      `(${Object.keys(engine.perAction).length} actions/iteration, ` +
      `${fmt(seq.mean)} ms/iteration)`,
  );
  const copy = stats(engine.copies);
  push(
    `whole-state copy (serialize+deserialize)  ${fmt(copy.mean)} ms/copy ` +
      `(median ${fmt(copy.median)}, p90 ${fmt(copy.p90)})`,
  );
  push(
    `copy per action              ${fmt(engine.copyMsPerAction)} ms ` +
      `-> ${fmt(engine.copyShareOfAction * 100, 1)}% of an action's total cost ` +
      `when the state is copied before every action`,
  );
  push("");

  push("B. Board render path (headless)");
  push("-".repeat(78));
  const vm = stats(render.viewModelMs);
  const br = stats(render.boardRenderMs);
  const se = stats(render.serializeMs);
  push("stage".padEnd(46) + "median ms".padStart(12) + "p90 ms".padStart(10));
  push(
    "engine state -> UI view model (convertEngineToUI)".padEnd(46) +
      fmt(vm.median).padStart(12) +
      fmt(vm.p90).padStart(10),
  );
  push(
    "<GameBoard> React DOM server render (PROXY)".padEnd(46) +
      fmt(br.median).padStart(12) +
      fmt(br.p90).padStart(10),
  );
  push(
    "engine state serialization (save/sync path)".padEnd(46) +
      fmt(se.median).padStart(12) +
      fmt(se.p90).padStart(10),
  );
  push(
    `view model size: ${render.uiCards} cards, board HTML ${render.htmlBytes} bytes, ` +
      `serialized state ${render.serializedBytes} bytes`,
  );
  push("");

  process.stdout.write(`${lines.join("\n")}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
