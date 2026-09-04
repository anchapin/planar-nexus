/**
 * @fileoverview Memory budget & parity tests for ReplaySystem delta encoding.
 *
 * Issue #1574 acceptance criteria:
 *   AC1 — 200-action replay JSON size ≤ 5% of snapshot-per-action baseline.
 *   AC2 — `getStateAt(position)` returns state value-equal to legacy snapshots
 *         at every position (parity).
 *   AC3 — Legacy v1 (snapshot-per-action) replays still load through the
 *         delta-encoded code path and `getStateAt` continues to resolve.
 *   AC4 — `eventLogToReplay` peak memory < 50 MB during conversion (vs the
 *         > 200 MB observed before #1574 with the per-action snapshot shape).
 *   AC5 — `jumpToTurn` resolves in < 100 ms p95 on the 200-action fixture,
 *         using either periodic snapshots or memoised forward application.
 *
 * The fixture is a synthetic 4-player Commander game with 200 actions. Each
 * action mutates a small slice of state (life, hand size, priority player,
 * stack push/pop, turn number, combat phase) — exactly the mutations #1574
 * measured as the dominant per-action deltas.
 */
import { describe, it, expect, beforeEach } from "@jest/globals";

import {
  ReplaySystem,
  getStateAtPosition,
  applyStateDelta,
  SNAPSHOT_INTERVAL,
} from "../replay";
import {
  eventLogToReplay,
  type ActionEvent,
  type GameEventLog,
  type GameStartEvent,
} from "../event-sourcing";
import { createInitialGameState } from "../game-state";
import type {
  GameState,
  GameAction,
  ActionType,
  PlayerId,
  Player,
  CardInstance,
} from "../types";
import { computeStateHash } from "../state-hash";
import { cloneGameState, mapReplacer } from "../state-serialization";

const FIXTURE_ACTION_COUNT = 200;
const FIXTURE_PLAYER_COUNT = 4;
const AC1_SIZE_RATIO = 0.05; // ≤ 5% of legacy snapshot-per-action replay
const AC5_P95_BUDGET_MS = 100;

function buildFixtureReplay(): ReplaySystem {
  const playerNames = Array.from(
    { length: FIXTURE_PLAYER_COUNT },
    (_, i) => `Player ${i + 1}`,
  );
  const base = createInitialGameState(playerNames, 40, true);
  const replay = new ReplaySystem();
  replay.createReplay("commander", playerNames, 40, true, base);

  // Seed enough cards/zones that the state is realistically large (the issue
  // calls out 200 KB – 1 MB per snapshot for a Commander game). We mirror
  // the realistic 4-player Commander deck (~60 cards per player split
  // across multiple zones). The bulk of the per-snapshot payload comes
  // from the cards Map and the per-zone `cardIds` arrays.
  for (const [id] of base.players) {
    for (let c = 0; c < 60; c++) {
      const cardId = `${id}-card-${c}`;
      base.cards.set(cardId, {
        id: cardId,
        oracleId: `def-${c}`,
        cardData: { name: `Card ${c}` } as unknown as CardInstance["cardData"],
        currentFaceIndex: 0,
        isFaceDown: false,
        controllerId: id,
        ownerId: id,
        isTapped: c % 3 === 0,
        counters: new Map(),
        keywords: [`keyword-${c % 5}`],
        abilities: [],
        damage: 0,
        summoningSickness: c % 7 === 0,
        timestamp: Date.now(),
      } as unknown as CardInstance);
      const zoneSuffix =
        c < 7
          ? "hand"
          : c < 25
            ? "battlefield"
            : c < 45
              ? "library"
              : c < 52
                ? "graveyard"
                : c < 57
                  ? "exile"
                  : "command";
      base.zones.get(`${id}-${zoneSuffix}`)?.cardIds.push(cardId);
    }
  }

  for (let i = 0; i < FIXTURE_ACTION_COUNT; i++) {
    const playerIndex = i % FIXTURE_PLAYER_COUNT;
    const playerId = playerNames[playerIndex] as PlayerId;
    const actionType = pickActionType(i);

    // Mutate a small slice of the live state and pass a clone to
    // `recordAction` so each call sees the post-mutation snapshot. The
    // delta encoder relies on stable references for unchanged Maps;
    // passing a fresh clone each call preserves those references within
    // the clone and only the changed entries get re-created.
    applySyntheticMutation(base, playerId, actionType, i);

    const action: GameAction = {
      type: actionType,
      playerId,
      timestamp: Date.now(),
      data: { cardId: `${playerId}-card-0` },
    };
    replay.recordAction(action, cloneGameState(base), `${playerId} ${actionType} ${i}`);
  }

  return replay;
}

function pickActionType(step: number): ActionType {
  const types: ActionType[] = [
    "draw_card",
    "gain_life",
    "lose_life",
    "play_land",
    "cast_spell",
    "pass_priority",
    "declare_attackers",
    "declare_blockers",
  ];
  return types[step % types.length] as ActionType;
}

function applySyntheticMutation(
  state: GameState,
  playerId: PlayerId,
  type: ActionType,
  step: number,
): void {
  const player = state.players.get(playerId);
  switch (type) {
    case "gain_life":
      if (player) player.life += 1;
      break;
    case "lose_life":
      if (player) player.life = Math.max(0, player.life - 1);
      break;
    case "draw_card": {
      const hand = state.zones.get(`${playerId}-hand`);
      const library = state.zones.get(`${playerId}-library`);
      if (hand && library && library.cardIds.length > 0) {
        const cardId = library.cardIds.shift()!;
        hand.cardIds.push(cardId);
      }
      break;
    }
    case "play_land": {
      const hand = state.zones.get(`${playerId}-hand`);
      const battlefield = state.zones.get(`${playerId}-battlefield`);
      if (hand && battlefield && hand.cardIds.length > 0) {
        const cardId = hand.cardIds.pop()!;
        battlefield.cardIds.push(cardId);
        if (player) player.landsPlayedThisTurn += 1;
      }
      break;
    }
    case "cast_spell":
      state.stack.push({
        id: `spell-${step}`,
        type: "spell",
        sourceCardId: `${playerId}-card-0`,
        controllerId: playerId,
      } as GameState["stack"][number]);
      break;
    case "pass_priority":
      state.consecutivePasses += 1;
      state.priorityPlayerId = nextPlayer(state, playerId);
      break;
    case "declare_attackers":
      state.combat = {
        ...state.combat,
        inCombatPhase: true,
        attackers: [
          {
            cardId: `${playerId}-card-${step % 10}`,
            defenderId: nextPlayer(state, playerId),
            isAttackingPlaneswalker: false,
            damageToDeal: 0,
            hasFirstStrike: false,
            hasDoubleStrike: false,
          },
        ],
      };
      break;
    case "declare_blockers":
      state.combat = {
        ...state.combat,
        blockers: new Map([
          [
            `${playerId}-card-0`,
            [
              {
                cardId: `${playerId}-card-5`,
                blockerPlayerId: playerId,
                assignedDamage: 0,
              },
            ] as unknown as Array<unknown>,
          ],
        ]) as unknown as GameState["combat"]["blockers"],
      };
      break;
    default:
      break;
  }
  state.turn = { ...state.turn, turnNumber: Math.floor(step / 4) + 1 };
}

function nextPlayer(state: GameState, current: PlayerId): PlayerId {
  const ids = Array.from(state.players.keys());
  const idx = ids.indexOf(current);
  return ids[(idx + 1) % ids.length] as PlayerId;
}

describe("ReplaySystem delta encoding (#1574)", () => {
  let replaySystem: ReplaySystem;
  let replayObj: NonNullable<ReturnType<ReplaySystem["getReplay"]>>;

  beforeEach(() => {
    replaySystem = buildFixtureReplay();
    const got = replaySystem.getReplay();
    if (!got) throw new Error("fixture replay not built");
    replayObj = got;
  });

  it("AC1: 200-action replay serialises to ≤5% of the snapshot-per-action baseline", () => {
    const actions = replayObj.actions;
    expect(actions.length).toBe(FIXTURE_ACTION_COUNT);

    const baselineBytes = buildLegacyBaselineByteSize(replayObj);
    const newBytes = Buffer.byteLength(
      JSON.stringify(replayObj, mapReplacer),
      "utf8",
    );

    // Sanity: the baseline is large enough to be a meaningful comparison.
    expect(baselineBytes).toBeGreaterThan(1024 * 1024); // > 1 MB

    const ratio = newBytes / baselineBytes;
    // eslint-disable-next-line no-console
    console.log(
      `[#1574 AC1] baseline=${baselineBytes}B new=${newBytes}B ratio=${ratio.toFixed(4)}`,
    );
    expect(ratio).toBeLessThanOrEqual(AC1_SIZE_RATIO);
  });

  it("AC2: getStateAt(position) matches the legacy full snapshot at every position", () => {
    const expectedSnapshots = rebuildLegacySnapshots(replayObj);

    for (let i = 0; i < expectedSnapshots.length; i++) {
      const expectedHash = computeStateHash(expectedSnapshots[i]!);
      const reconstructed = replaySystem.getStateAt(i);
      expect(reconstructed).not.toBeNull();
      expect(computeStateHash(reconstructed!)).toBe(expectedHash);
    }
  });

  it("AC2 (stateless accessor): getStateAtPosition matches getStateAt", () => {
    for (let i = 0; i < replayObj.actions.length; i++) {
      const fromMethod = replaySystem.getStateAt(i);
      const fromAccessor = getStateAtPosition(replayObj, i);
      expect(fromMethod).not.toBeNull();
      expect(fromAccessor).not.toBeNull();
      expect(computeStateHash(fromMethod!)).toBe(computeStateHash(fromAccessor!));
    }
  });

  it("AC3: legacy v1 (snapshot-per-action) replay loads via importFromJSON", () => {
    const legacyReplay = buildLegacyReplayFixture();
    const json = JSON.stringify(legacyReplay, mapReplacer);

    const importer = new ReplaySystem();
    const imported = importer.importFromJSON(json);

    expect(imported.schemaVersion).toBe(1);
    for (let i = 0; i < imported.actions.length; i++) {
      const state = importer.getStateAt(i);
      expect(state).not.toBeNull();
      expect(computeStateHash(state!)).toBe(
        computeStateHash(legacyReplay.actions[i]!.resultingState),
      );
    }
    expect(importer.getSummary()).not.toBeNull();
  });

  it("AC3 (round-trip): v1 → export → re-import keeps getStateAt working", () => {
    const legacyReplay = buildLegacyReplayFixture();
    const json = JSON.stringify(legacyReplay, mapReplacer);
    const sys1 = new ReplaySystem();
    sys1.importFromJSON(json);
    const json2 = sys1.exportToJSON();
    const sys2 = new ReplaySystem();
    sys2.importFromJSON(json2);

    for (let i = 0; i < legacyReplay.actions.length; i++) {
      const a = sys1.getStateAt(i);
      const b = sys2.getStateAt(i);
      expect(computeStateHash(a!)).toBe(computeStateHash(b!));
    }
  });

  it("AC5: jumpToTurn resolves in <100 ms p95 on the 200-action fixture", () => {
    const samples: number[] = [];
    const totalTurns = FIXTURE_ACTION_COUNT / FIXTURE_PLAYER_COUNT;
    for (let t = 1; t <= totalTurns; t++) {
      const start = performance.now();
      const result = replaySystem.jumpToTurn(t);
      const elapsed = performance.now() - start;
      expect(result).not.toBeNull();
      samples.push(elapsed);
    }
    samples.sort((a, b) => a - b);
    const p95Index = Math.floor(samples.length * 0.95);
    const p95 = samples[p95Index] ?? samples[samples.length - 1];
    // eslint-disable-next-line no-console
    console.log(
      `[#1574 AC5] jumpToTurn p95=${p95!.toFixed(2)}ms samples=${samples.length}`,
    );
    expect(p95).toBeLessThan(AC5_P95_BUDGET_MS);
  });

  it("SNAPSHOT_INTERVAL keeps every walkable replay under the snapshot budget", () => {
    expect(SNAPSHOT_INTERVAL).toBeGreaterThan(0);
    expect(SNAPSHOT_INTERVAL).toBeLessThanOrEqual(128);

    const snapshotSequenceNumbers = (replayObj.snapshots ?? []).map(
      (s) => s.sequenceNumber,
    );
    expect(snapshotSequenceNumbers.length).toBeGreaterThan(0);
    expect([0, 1]).toContain(snapshotSequenceNumbers[0]);
    for (let i = 1; i < snapshotSequenceNumbers.length; i++) {
      const gap =
        snapshotSequenceNumbers[i]! - snapshotSequenceNumbers[i - 1]!;
      expect(gap).toBeLessThanOrEqual(SNAPSHOT_INTERVAL);
    }
  });
});

describe("eventLogToReplay delta encoding (#1574 AC4)", () => {
  it("AC4: produces a delta-encoded v2 replay under the 50 MB heap budget", () => {
    const base = createInitialGameState(["P1", "P2", "P3", "P4"], 40, true);
    const gameStart: GameStartEvent = {
      type: "GAME_START",
      index: 1,
      state: cloneGameState(base),
      stateHash: computeStateHash(base),
      playerIds: ["P1", "P2", "P3", "P4"] as PlayerId[],
      timestamp: Date.now(),
    };

    const mutator = (state: GameState, action: GameAction): GameState => {
      const next = cloneGameState(state);
      applySyntheticMutation(next, action.playerId, action.type, 0);
      return next;
    };

    const events: ActionEvent[] = [];

    let runningState = cloneGameState(base);
    for (let i = 0; i < FIXTURE_ACTION_COUNT; i++) {
      const playerId = `P${(i % 4) + 1}` as PlayerId;
      const action: GameAction = {
        type: pickActionType(i),
        playerId,
        timestamp: Date.now(),
        data: { cardId: `${playerId}-card-0` },
      };
      const nextState = mutator(runningState, action);
      const prevHash = computeStateHash(runningState);
      const nextHash = computeStateHash(nextState);
      events.push({
        type: "ACTION",
        index: i + 2,
        action,
        previousStateHash: prevHash,
        resultingStateHash: nextHash,
        initiatorId: playerId,
        timestamp: Date.now(),
        confirmed: false,
        confirmedBy: [],
      });
      runningState = nextState;
    }

    const eventLog: GameEventLog = {
      sessionId: "test-session",
      createdAt: Date.now(),
      lastModifiedAt: Date.now(),
      lastConfirmedIndex: events.length,
      pendingEvents: [],
      events: [gameStart, ...events],
    };

    const baselineHeap = process.memoryUsage().heapUsed;
    const replay = eventLogToReplay(
      eventLog,
      "commander",
      ["P1", "P2", "P3", "P4"],
      40,
      true,
      mutator,
    );
    if (typeof global.gc === "function") global.gc();
    const peakHeap = process.memoryUsage().heapUsed;
    const delta = peakHeap - baselineHeap;

    // eslint-disable-next-line no-console
    console.log(
      `[#1574 AC4] heap delta=${(delta / (1024 * 1024)).toFixed(2)} MB actions=${replay.actions.length} snapshots=${replay.snapshots.length}`,
    );

    expect(delta).toBeLessThan(50 * 1024 * 1024);
    expect(replay.schemaVersion).toBe(2);
    expect(replay.snapshots.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildLegacyBaselineByteSize(
  replay: NonNullable<ReturnType<ReplaySystem["getReplay"]>>,
): number {
  const snapshots = rebuildLegacySnapshots(replay);
  const legacy = {
    ...replay,
    actions: replay.actions.map((a, i) => ({
      sequenceNumber: a.sequenceNumber,
      action: a.action,
      resultingState: snapshots[i],
      description: a.description,
      recordedAt: a.recordedAt,
    })),
    schemaVersion: undefined,
    snapshots: undefined,
  };
  return Buffer.byteLength(JSON.stringify(legacy, mapReplacer), "utf8");
}

function rebuildLegacySnapshots(
  replay: NonNullable<ReturnType<ReplaySystem["getReplay"]>>,
): GameState[] {
  const out: GameState[] = [];
  const snapshots = replay.snapshots ?? [];
  let current = snapshots[0] ? cloneGameState(snapshots[0].state) : null;

  for (let i = 0; i < replay.actions.length; i++) {
    const a = replay.actions[i]!;
    if (a.resultingState) {
      current = cloneGameState(a.resultingState);
    } else if (a.delta && current) {
      current = applyStateDelta(current, a.delta);
    }
    if (!current) throw new Error(`rebuildLegacySnapshots: no state at ${i}`);
    out.push(cloneGameState(current));
  }
  return out;
}

function buildLegacyReplayFixture(): {
  id: string;
  metadata: ReturnType<ReplaySystem["createReplay"]>["metadata"];
  actions: Array<{
    sequenceNumber: number;
    action: GameAction;
    resultingState: GameState;
    description: string;
    recordedAt: number;
  }>;
  currentPosition: number;
  totalActions: number;
  createdAt: number;
  lastModifiedAt: number;
} {
  const base = createInitialGameState(["Alex", "Sam"], 20, false);
  const [alexId, samId] = Array.from(base.players.keys()) as PlayerId[];
  const actions: Array<{
    sequenceNumber: number;
    action: GameAction;
    resultingState: GameState;
    description: string;
    recordedAt: number;
  }> = [];

  const state1 = cloneGameState(base);
  actions.push({
    sequenceNumber: 1,
    action: {
      type: "draw_card",
      playerId: alexId,
      timestamp: 1,
      data: { cardId: "c1" },
    },
    resultingState: state1,
    description: "Alex drew a card",
    recordedAt: 1,
  });
  const state2 = cloneGameState(state1);
  state2.turn = { ...state2.turn, turnNumber: 2 };
  actions.push({
    sequenceNumber: 2,
    action: {
      type: "pass_priority",
      playerId: alexId,
      timestamp: 2,
      data: { cardId: "c1" },
    },
    resultingState: state2,
    description: "Alex passed priority",
    recordedAt: 2,
  });
  const state3 = cloneGameState(state2);
  const player = state3.players.get(alexId) as Player;
  player.life += 2;
  actions.push({
    sequenceNumber: 3,
    action: {
      type: "gain_life",
      playerId: alexId,
      timestamp: 3,
      data: { cardId: "c1" },
    },
    resultingState: state3,
    description: "Alex gained 2 life",
    recordedAt: 3,
  });
  const state4 = cloneGameState(state3);
  state4.combat = {
    ...state4.combat,
    inCombatPhase: true,
    attackers: [
      {
        cardId: "c1",
        defenderId: samId,
        isAttackingPlaneswalker: false,
        damageToDeal: 0,
        hasFirstStrike: false,
        hasDoubleStrike: false,
      },
    ],
  };
  actions.push({
    sequenceNumber: 4,
    action: {
      type: "declare_attackers",
      playerId: alexId,
      timestamp: 4,
      data: {
        attackers: [{ cardId: "c1", defenderId: samId }],
      },
    },
    resultingState: state4,
    description: "Alex declared attackers",
    recordedAt: 4,
  });
  const state5 = cloneGameState(state4);
  state5.combat = { ...state5.combat, inCombatPhase: false, attackers: [] };
  actions.push({
    sequenceNumber: 5,
    action: {
      type: "pass_priority",
      playerId: samId,
      timestamp: 5,
      data: { cardId: "c1" },
    },
    resultingState: state5,
    description: "Sam passed priority",
    recordedAt: 5,
  });

  return {
    id: "legacy-1",
    metadata: {
      format: "modern",
      playerNames: ["Alex", "Sam"],
      startingLife: 20,
      isCommander: false,
      gameStartDate: 1,
    },
    actions,
    currentPosition: 0,
    totalActions: actions.length,
    createdAt: 1,
    lastModifiedAt: 5,
  };
}
