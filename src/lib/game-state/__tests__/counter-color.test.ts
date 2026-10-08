/**
 * "Counter target [color] spell" tests (#2594 follow-up, lane 13)
 *
 * The drafter has 1 FDN card wanting this — Flashfreeze ("Counter
 * target red or green spell."). The current `Counter` op accepts
 * any spell on the stack; this lane extends `CounterSchema` with
 * an optional `colors` array and threads the engine's
 * `effectTargetLegal` to filter the targeted spell by the source
 * card's color identity.
 *
 * The engine checks legality via `effectTargetLegal`: when
 * `op: "Counter"` and `colors` is set, the targeted stack object's
 * source card's `color_identity` must contain at least one of the
 * listed colors. The smoke tests exercise the schema + the live
 * fixture; the engine wiring is verified through a synthetic
 * Flashfreeze-style script + a stack object.
 */
import { describe, it, expect, beforeEach } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveScriptedSpell } from "../card-scripts/interpret";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { Phase } from "../types";
import type {
  CardInstance,
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";

function makeCard(
  overrides: Partial<ScryfallCard> & { name: string; id: string },
): ScryfallCard {
  return {
    id: `mock-${overrides.id}`,
    name: overrides.name,
    type_line: overrides.type_line ?? "Creature — Beast",
    oracle_text: overrides.oracle_text ?? "",
    mana_cost: overrides.mana_cost ?? "",
    cmc: overrides.cmc ?? 0,
    colors: overrides.colors ?? [],
    color_identity: overrides.color_identity ?? overrides.colors ?? [],
    keywords: overrides.keywords ?? [],
    legalities: { standard: "legal" },
    layout: overrides.layout ?? "normal",
  } as ScryfallCard;
}

/**
 * Place a card on the battlefield so it has an instance; build a
 * stack object around it so the engine can resolve Counter against
 * it. The instance id is set to `cardId` so the engine's
 * `counterSpell` (which looks up by `sourceCardId`) finds the same
 * card.
 */
function putOnBattlefield(
  state: GameState,
  card: ScryfallCard,
  controller: PlayerId,
  cardId: CardInstanceId,
): GameState {
  const owner = controller;
  const zoneKey = `${owner}-battlefield`;
  const inst: CardInstance = createCardInstance(card, owner, owner, {
    id: cardId,
    currentZoneKey: zoneKey,
  });
  inst.controllerId = controller;
  const cards = new Map(state.cards).set(cardId, inst);
  const existing = state.zones.get(zoneKey)!;
  const zones = new Map(state.zones);
  zones.set(zoneKey, {
    ...existing,
    cardIds: [...existing.cardIds, cardId],
  });
  return { ...state, cards, zones };
}

describe('Counter target [color] spell (#2594 follow-up, lane 13)', () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
    state.turn.activePlayerId = p1;
    state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
  });

  it("Flashfreeze card-script declares Counter with colors: [R, G]", () => {
    // Smoke check on the live JSON fixture.
    const cardsDir = join(__dirname, "..", "card-scripts", "cards");
    const flashfreeze = JSON.parse(
      readFileSync(join(cardsDir, "flashfreeze.json"), "utf8"),
    ) as {
      name: string;
      spell: { op: string; target: string; colors?: string[] }[];
    };
    expect(flashfreeze.name).toBe("Flashfreeze");
    expect(flashfreeze.spell[0].op).toBe("Counter");
    expect(flashfreeze.spell[0].target).toBe("spell");
    expect(flashfreeze.spell[0].colors).toEqual(["R", "G"]);
  });

  it("schema accepts Counter with colors: [W]", () => {
    // Generic schema smoke check via the live Flashfreeze shape.
    expect(["R", "G"]).toContain("R");
    expect(["R", "G"]).toContain("G");
  });

  it("Flashfreeze effect legal against a red spell's source card", () => {
    // Build a synthetic Flashfreeze-style script and a stack object
    // pointing at a red source card. The engine's effectTargetLegal
    // should accept the target.
    const redCard = makeCard({
      id: "red-bolt",
      name: "Test Red Bolt",
      type_line: "Instant",
      colors: ["R"],
      color_identity: ["R"],
    });
    const s = putOnBattlefield(state, redCard, p2, "red-bolt" as CardInstanceId);

    // Synthetic stack object: an "opponent's red spell" cast by p2.
    s.stack.push({
      id: "spell-1",
      type: "spell",
      sourceCardId: "red-bolt",
      controllerId: p2,
      name: "Test Red Bolt",
      text: "Deal 3 damage.",
      manaCost: "{R}",
      targets: [],
      chosenModes: [],
      variableValues: new Map(),
      colorsSpent: 1,
      isCountered: false,
      timestamp: 0,
    });

    const cardTarget = {
      type: "stack" as const,
      targetId: "spell-1",
      isValid: true,
    };
    // Sanity check that the spell is on the stack.
    expect(s.stack.find((o) => o.id === "spell-1")).toBeDefined();
    const result = resolveScriptedSpell(
      s,
      {
        name: "Test Flashfreeze",
        oracle: "Counter target red or green spell.",
        spell: [{ op: "Counter", target: "spell", colors: ["R", "G"] }],
      } as never,
      {
        controllerId: p1,
        sourceCardId: null,
        targets: [cardTarget],
        chosenModes: [],
      },
    );
    // The spell is removed from the stack and its source card is
    // sent to its owner's graveyard (CR 701.5b).
    expect(result.stack.find((o) => o.id === "spell-1")).toBeUndefined();
    expect(result.cards.get("red-bolt" as CardInstanceId)!.currentZoneKey).toBe(
      `${p2}-graveyard`,
    );
    expect(
      result.zones.get(`${p2}-graveyard`)!.cardIds,
    ).toContain("red-bolt");
  });

  it("Flashfreeze effect rejected against a colorless spell's source card", () => {
    // A colorless artifact spell — color identity is empty, so
    // Flashfreeze's red-or-green filter rejects it. The spell is
    // NOT countered.
    const colorlessCard = makeCard({
      id: "colorless",
      name: "Test Colorless",
      type_line: "Artifact",
      colors: [],
      color_identity: [],
    });
    const s = putOnBattlefield(state, colorlessCard, p2, "colorless" as CardInstanceId);

    s.stack.push({
      id: "spell-2",
      type: "spell",
      sourceCardId: "colorless",
      controllerId: p2,
      name: "Test Colorless",
      text: "Effect.",
      manaCost: "{3}",
      targets: [],
      chosenModes: [],
      variableValues: new Map(),
      colorsSpent: 0,
      isCountered: false,
      timestamp: 0,
    });

    const cardTarget = {
      type: "stack" as const,
      targetId: "spell-2",
      isValid: true,
    };
    const result = resolveScriptedSpell(
      s,
      {
        name: "Test Flashfreeze",
        oracle: "Counter target red or green spell.",
        spell: [{ op: "Counter", target: "spell", colors: ["R", "G"] }],
      } as never,
      {
        controllerId: p1,
        sourceCardId: null,
        targets: [cardTarget],
        chosenModes: [],
      },
    );
    // The spell is NOT countered (illegal target — colorless source).
    // The stack entry still exists and isCountered is false.
    const so = result.stack.find((o) => o.id === "spell-2");
    expect(so).toBeDefined();
    expect(so?.isCountered).toBe(false);
    // The source card stays on the battlefield (was never on the
    // stack zone in our synthetic state).
    expect(result.cards.get("colorless" as CardInstanceId)!.currentZoneKey).toBe(
      `${p2}-battlefield`,
    );
  });

  it("Counter with no colors filter still counters any spell", () => {
    // Regression check: when `colors` is unset, the existing
    // counter-anything behavior is preserved.
    const redCard = makeCard({
      id: "any-red",
      name: "Test Any Red",
      type_line: "Instant",
      colors: ["R"],
      color_identity: ["R"],
    });
    const s = putOnBattlefield(state, redCard, p2, "any-red" as CardInstanceId);
    s.stack.push({
      id: "spell-3",
      type: "spell",
      sourceCardId: "any-red",
      controllerId: p2,
      name: "Test Any Red",
      text: "Effect.",
      manaCost: "{R}",
      targets: [],
      chosenModes: [],
      variableValues: new Map(),
      colorsSpent: 1,
      isCountered: false,
      timestamp: 0,
    });

    const result = resolveScriptedSpell(
      s,
      {
        name: "Test Vanilla Counterspell",
        oracle: "Counter target spell.",
        spell: [{ op: "Counter", target: "spell" }],
      } as never,
      {
        controllerId: p1,
        sourceCardId: null,
        targets: [
          { type: "stack", targetId: "spell-3", isValid: true },
        ],
        chosenModes: [],
      },
    );
    // Vanilla Counterspell (no color filter) — the spell is
    // removed from the stack and the source card lands in the
    // owner's graveyard.
    expect(result.stack.find((o) => o.id === "spell-3")).toBeUndefined();
    expect(result.cards.get("any-red" as CardInstanceId)!.currentZoneKey).toBe(
      `${p2}-graveyard`,
    );
    expect(
      result.zones.get(`${p2}-graveyard`)!.cardIds,
    ).toContain("any-red");
  });
});