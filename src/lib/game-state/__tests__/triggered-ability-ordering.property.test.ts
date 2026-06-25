/**
 * Property-based tests for triggered ability ordering determinism.
 * Issue #1014: Verify APNAP ordering (CR 603.3) is deterministic.
 *
 * Uses fast-check to generate scenarios with 2-5 simultaneous triggers across
 * 2-4 players and asserts:
 *  1. Identical scenarios produce identical ordering across 50+ runs.
 *  2. Same-player triggers resolve in ascending sourceCardTimestamp (CR 603.3b).
 *  3. APNAP ordering holds for multi-player scenarios (CR 603.3a).
 *
 * Trigger sources covered (per the issue): damage events, death events,
 * turn-based triggers, and combat triggers.
 *
 * Determinism note: `detectTriggeredAbilities` stamps each instance with a
 * non-deterministic `id` (Date.now + Math.random) and `timestamp` (Date.now).
 * These fields are intentionally excluded from every comparison signature — the
 * *ordering* of triggers (by controlling player and source-card timestamp) is
 * the deterministic invariant under test. Card placement timestamps are set
 * explicitly so ordering is independent of wall-clock `Date.now` collisions.
 */
import fc from "fast-check";
import {
  detectTriggeredAbilities,
  checkTriggeredAbilities,
  type TriggeredAbilityInstance,
  type TriggerEvent,
} from "../abilities";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import type { ScryfallCard } from "@/app/actions";
import type { GameState, PlayerId } from "../types";

/** Number of repeated resolutions per generated scenario (acceptance: ">50"). */
const RUNS = 60;
/** Distinct generated scenarios per property (fast-check numRuns). */
const SCENARIOS = 30;

/**
 * Catalog of the four trigger sources required by the issue. Each spec maps a
 * detectable TriggerEvent to an oracle phrase that the parser resolves to a
 * matching `trigger.event`, so `detectTriggeredAbilities` returns one trigger
 * per placed card.
 */
interface TriggerSpec {
  detectEvent: TriggerEvent;
  oracle: string;
  label: string;
}

const TRIGGER_SPECS: TriggerSpec[] = [
  {
    detectEvent: "damageDealt",
    oracle: "When this creature deals damage, draw a card.",
    label: "damage events (damageDealt)",
  },
  {
    detectEvent: "dies",
    oracle: "When this creature dies, draw a card.",
    label: "death events (dies)",
  },
  {
    detectEvent: "beginningOfTurn",
    oracle: "At the beginning of your upkeep, draw a card.",
    label: "turn-based triggers (upkeep / beginningOfTurn)",
  },
  {
    detectEvent: "attacked",
    oracle: "Whenever you attack, create a 1/1 white Soldier token.",
    label: "combat triggers (attacked)",
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockCard(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: `mock-${Math.random().toString(36).slice(2, 11)}`,
    name: overrides.name || "Test Card",
    type_line: overrides.type_line || "Creature — Human",
    oracle_text: overrides.oracle_text || "",
    mana_cost: overrides.mana_cost || "{1}{W}",
    cmc: 2,
    colors: overrides.colors || ["W"],
    color_identity: overrides.color_identity || ["W"],
    legalities: { standard: "legal", commander: "legal" },
    layout: "normal",
    ...overrides,
  } as ScryfallCard;
}

/** Build a fresh game with the requested number of players (zones included). */
function buildGame(playerCount: number): {
  state: GameState;
  playerIds: PlayerId[];
} {
  const names = ["Alice", "Bob", "Carol", "Diana"].slice(0, playerCount);
  let state = createInitialGameState(names, 20, false);
  state = startGame(state);
  const playerIds = Array.from(state.players.keys());
  return { state, playerIds };
}

/**
 * Place a trigger card on a player's battlefield with an EXPLICIT
 * `enteredBattlefieldTimestamp` so CR 603.3b ordering is deterministic and
 * decoupled from the wall clock. Returns the placed card id.
 */
function placeTriggerCard(
  state: GameState,
  playerId: PlayerId,
  oracle: string,
  ts: number,
): string {
  const card = createCardInstance(
    createMockCard({ oracle_text: oracle }),
    playerId,
    playerId,
  );
  card.hasSummoningSickness = false;
  card.enteredBattlefieldTimestamp = ts;
  const bf = state.zones.get(`${playerId}-battlefield`)!;
  state.zones.set(`${playerId}-battlefield`, {
    ...bf,
    cardIds: [...bf.cardIds, card.id],
  });
  state.cards.set(card.id, card);
  return card.id;
}

/**
 * Deterministic projection of an ordered trigger list — the "state hash" for
 * ordering. Maps each resolved trigger to its controlling player INDEX (stable
 * across independent game constructions, since player insertion order follows
 * the names array), its source-card timestamp, and its condition. Excludes the
 * non-deterministic `id`/`timestamp` instance fields entirely.
 */
function orderSignature(
  triggers: TriggeredAbilityInstance[],
  playerIds: PlayerId[],
): string {
  return triggers
    .map((t) => {
      const idx = playerIds.indexOf(t.triggeringPlayerId);
      return `P${idx}:t${t.sourceCardTimestamp}:${t.triggerCondition}`;
    })
    .join(" > ");
}

/**
 * Assert full APNAP conformance (CR 603.3a + 603.3b) for a resolved trigger
 * list: active-player group first, non-active groups in turn order (no
 * interleaving/repeats), and ascending sourceCardTimestamp within each player.
 */
function assertAPNAP(
  triggers: TriggeredAbilityInstance[],
  playerIds: PlayerId[],
  activeIdx: number,
): void {
  const n = playerIds.length;

  // Group consecutive triggers by controlling player index.
  const groups: number[] = [];
  let last = -1;
  for (const t of triggers) {
    const idx = playerIds.indexOf(t.triggeringPlayerId);
    if (idx !== last) {
      groups.push(idx);
      last = idx;
    }
  }

  // (a) Active player's group must come first and not be split.
  const activeGroupCount = groups.filter((g) => g === activeIdx).length;
  if (activeGroupCount > 0) {
    expect(groups[0]).toBe(activeIdx);
    expect(activeGroupCount).toBe(1);
  }

  // (a) Non-active groups must appear in turn order with no repeats.
  const expectedNonActive: number[] = [];
  for (let step = 1; step < n; step++) {
    expectedNonActive.push((activeIdx + step) % n);
  }
  const actualNonActive = groups.filter((g) => g !== activeIdx);
  expect(new Set(actualNonActive).size).toBe(actualNonActive.length);
  let ei = 0;
  for (const g of actualNonActive) {
    while (ei < expectedNonActive.length && expectedNonActive[ei] !== g) ei++;
    expect(ei).toBeLessThan(expectedNonActive.length);
    ei++;
  }

  // (b) Within each player's group, timestamps are non-decreasing.
  const byPlayer = new Map<number, number[]>();
  for (const t of triggers) {
    const idx = playerIds.indexOf(t.triggeringPlayerId);
    if (!byPlayer.has(idx)) byPlayer.set(idx, []);
    byPlayer.get(idx)!.push(t.sourceCardTimestamp);
  }
  for (const tsList of byPlayer.values()) {
    const sorted = [...tsList].sort((a, b) => a - b);
    expect(tsList).toEqual(sorted);
  }
}

// ---------------------------------------------------------------------------
// Scenario generator
// ---------------------------------------------------------------------------

/**
 * A generated simultaneous-trigger scenario: a board with `cards.length`
 * triggers (2-5) distributed across `playerCount` players, with an explicit
 * active player and per-card owner + source timestamp.
 */
const scenarioArb = fc.record({
  playerCount: fc.constantFrom(2, 3, 4),
  activeOffset: fc.integer({ min: 0, max: 3 }),
  cards: fc.array(
    fc.record({
      ownerOffset: fc.integer({ min: 0, max: 3 }),
      ts: fc.integer({ min: 1, max: 1_000_000 }),
    }),
    { minLength: 2, maxLength: 5 },
  ),
});

/** Concrete value type generated by {@link scenarioArb}. */
type Scenario = (typeof scenarioArb) extends fc.Arbitrary<infer V> ? V : never;

/** Construct a concrete game state from a scenario descriptor + trigger spec. */
function buildScenario(
  scn: Scenario,
  spec: TriggerSpec,
): { state: GameState; playerIds: PlayerId[]; activeIdx: number } {
  const n = scn.playerCount;
  const { state, playerIds } = buildGame(n);
  const activeIdx = scn.activeOffset % n;
  state.turn.activePlayerId = playerIds[activeIdx];
  for (const c of scn.cards) {
    const owner = playerIds[c.ownerOffset % n];
    placeTriggerCard(state, owner, spec.oracle, c.ts);
  }
  return { state, playerIds, activeIdx };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Property-based: triggered ability ordering determinism (#1014)", () => {
  describe.each(TRIGGER_SPECS)(
    "$label",
    (spec: TriggerSpec) => {
      it("produces identical ordering across 50+ repeated resolutions of the same scenario", () => {
        fc.assert(
          fc.property(scenarioArb, (scn) => {
            const { state, playerIds } = buildScenario(scn, spec);
            const ref = detectTriggeredAbilities(state, spec.detectEvent);
            const refSig = orderSignature(ref, playerIds);

            // 60 repeated resolutions on identical state -> identical order.
            for (let i = 0; i < RUNS; i++) {
              const again = detectTriggeredAbilities(state, spec.detectEvent);
              expect(orderSignature(again, playerIds)).toBe(refSig);
              expect(again.length).toBe(ref.length);
            }

            // Cross-construction determinism: rebuild the same scenario from
            // its descriptor and compare the stable projection. Player ids and
            // card ids differ across rebuilds, but the index+timestamp order
            // signature must be identical.
            for (let i = 0; i < 5; i++) {
              const rb = buildScenario(scn, spec);
              const again = detectTriggeredAbilities(
                rb.state,
                spec.detectEvent,
              );
              expect(orderSignature(again, rb.playerIds)).toBe(refSig);
            }
          }),
          { numRuns: SCENARIOS },
        );
      });

      it("orders same-player triggers by ascending sourceCardTimestamp (CR 603.3b)", () => {
        fc.assert(
          fc.property(
            fc.uniqueArray(fc.integer({ min: 1, max: 100_000 }), {
              minLength: 2,
              maxLength: 5,
            }),
            (timestamps) => {
              const { state, playerIds } = buildGame(2);
              state.turn.activePlayerId = playerIds[0];
              for (const ts of timestamps) {
                placeTriggerCard(state, playerIds[0], spec.oracle, ts);
              }
              const result = detectTriggeredAbilities(state, spec.detectEvent);
              expect(result.length).toBe(timestamps.length);
              const resolved = result.map((t) => t.sourceCardTimestamp);
              const sorted = [...resolved].sort((a, b) => a - b);
              expect(resolved).toEqual(sorted);
            },
          ),
          { numRuns: 50 },
        );
      });

      it("enforces APNAP ordering for multi-player triggers (CR 603.3a)", () => {
        fc.assert(
          fc.property(scenarioArb, (scn) => {
            const { state, playerIds, activeIdx } = buildScenario(scn, spec);
            const result = detectTriggeredAbilities(state, spec.detectEvent);
            expect(result.length).toBe(scn.cards.length);
            assertAPNAP(result, playerIds, activeIdx);
          }),
          { numRuns: SCENARIOS },
        );
      });
    },
  );

  it("checkTriggeredAbilities stack order is deterministic and matches detect order across 50+ runs", () => {
    const spec = TRIGGER_SPECS[0];
    // Ordering key shared by both projections: player index + source timestamp.
    // The stack object's `type` is always "ability" and the detected instance
    // carries the condition name, so only the P{idx}:t{ts} prefix is compared.
    const key = (idx: number, ts: number) => `P${idx}:t${ts}`;
    fc.assert(
      fc.property(scenarioArb, (scn) => {
        const { state, playerIds } = buildScenario(scn, spec);
        const detected = detectTriggeredAbilities(state, spec.detectEvent);
        const refOrder = detected
          .map((t) =>
            key(playerIds.indexOf(t.triggeringPlayerId), t.sourceCardTimestamp),
          )
          .join(" > ");

        for (let i = 0; i < RUNS; i++) {
          // checkTriggeredAbilities returns a new state with triggers pushed
          // onto the stack in detect order. Project the stack to the same
          // index+timestamp key and compare.
          const { state: after } = checkTriggeredAbilities(
            state,
            spec.detectEvent,
          );
          const stackSig = after.stack
            .map((s) => {
              const card = state.cards.get(s.sourceCardId ?? "");
              const ts = card ? card.enteredBattlefieldTimestamp : -1;
              return key(playerIds.indexOf(s.controllerId), ts);
            })
            .join(" > ");
          expect(stackSig).toBe(refOrder);
          expect(after.stack.length).toBe(detected.length);
        }
      }),
      { numRuns: SCENARIOS },
    );
  });
});
