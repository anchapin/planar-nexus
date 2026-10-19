/**
 * Issue #2565 (AddMana op, FDN cards) — Druid of the Cowl + Three Tree Mascot.
 *
 * AddMana op shipped (issue-2565 addmana op, #2487 follow-up).
 * The two cards below are the first-priority FDN cards whose blocker was
 * "add mana" per docs/card-scripts/drafts/fdn.md §7 (lines 71, 73).
 *
 *  - Druid of the Cowl: vanilla `{T}: Add {G}.` (CR 605.1a).
 *  - Three Tree Mascot: `{T}: Add one mana of any color.\nActivate only
 *    once each turn.` (CR 605.1a, CR 602.5b — activationLimit).
 *
 * Cultivator's Caravan (also line 71) ships in a follow-up because the
 * card has a second blocker (crew) that requires the unbuilt Crew op.
 *
 * Both cards route through `activateManaAbility` because they are mana
 * abilities (CR 605). Single-color abilities (Druid) proceed
 * automatically because `availableOptions.length === 1`. Multi-color
 * abilities (Three Tree Mascot) require a two-step pattern:
 *   1. `activateManaAbility(state, playerId, cardId, idx)` — returns
 *      `{ options: ManaAbilityOption[] }`.
 *   2. Pick one option and call
 *      `activateManaAbility(state, playerId, cardId, idx, chosenOption)`.
 * This pattern is shared with Heraldic Banner (lane 25) and Treasure
 * activation (issue #2544).
 */
import { describe, it, expect, beforeEach } from "@jest/globals";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { activateManaAbility } from "../mana";
import { Phase } from "../types";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";

const DRUID_OF_THE_COWL_ORACLE = "{T}: Add {G}.";

const THREE_TREE_MASCOT_ORACLE =
  "{T}: Add one mana of any color.\nActivate only once each turn.";

function card(overrides: Partial<ScryfallCard>): ScryfallCard {
  return {
    id: `mock-${overrides.name}`,
    name: "Test",
    type_line: "Creature",
    oracle_text: "",
    mana_cost: "{1}{G}",
    cmc: 2,
    colors: ["G"],
    color_identity: ["G"],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
    ...overrides,
  } as ScryfallCard;
}

const druidOfTheCowl = card({
  name: "Druid of the Cowl",
  oracle_text: DRUID_OF_THE_COWL_ORACLE,
});

const threeTreeMascot = card({
  name: "Three Tree Mascot",
  oracle_text: THREE_TREE_MASCOT_ORACLE,
  mana_cost: "{2}",
  cmc: 2,
  colors: [],
  color_identity: [],
  type_line: "Artifact Creature — Shapeshifter",
});

function put(
  state: GameState,
  playerId: PlayerId,
  zone: "hand" | "battlefield",
  data: ScryfallCard,
): CardInstanceId {
  const c = createCardInstance(data, playerId, playerId);
  state.cards.set(c.id, { ...c, hasSummoningSickness: false });
  const key = `${playerId}-${zone}`;
  const z = state.zones.get(key)!;
  state.zones.set(key, { ...z, cardIds: [...z.cardIds, c.id] });
  return c.id;
}

const pool = (s: GameState, playerId: PlayerId) =>
  s.players.get(playerId)!.manaPool;

function totalMana(s: GameState, playerId: PlayerId): number {
  const p = pool(s, playerId);
  return (
    (p.colorless ?? 0) +
    (p.white ?? 0) +
    (p.blue ?? 0) +
    (p.black ?? 0) +
    (p.red ?? 0) +
    (p.green ?? 0)
  );
}

describe("Issue #2565 — AddMana FDN cards (Druid of the Cowl + Three Tree Mascot)", () => {
  let state: GameState;
  let alice: PlayerId;

  beforeEach(() => {
    state = startGame(createInitialGameState(["Alice", "Bob"], 20, false));
    [alice] = Array.from(state.players.keys());
    state.status = "in_progress";
    state.turn.activePlayerId = alice;
    state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    state.priorityPlayerId = alice;
    state.stack = [];
  });

  it("Druid of the Cowl: {T} adds exactly 1 {G} (single-color auto-resolve)", () => {
    const druidId = put(state, alice, "battlefield", druidOfTheCowl);
    const before = totalMana(state, alice);
    const r = activateManaAbility(state, alice, druidId, 0);
    expect(r.success).toBe(true);
    expect(totalMana(r.state, alice) - before).toBe(1);
    expect(pool(r.state, alice).green).toBe(1);
    expect(pool(r.state, alice).white).toBe(0);
    expect(pool(r.state, alice).red).toBe(0);
  });

  it("Druid of the Cowl: activation taps the source (CR 302.6)", () => {
    const druidId = put(state, alice, "battlefield", druidOfTheCowl);
    const r = activateManaAbility(state, alice, druidId, 0);
    expect(r.success).toBe(true);
    expect(r.state.cards.get(druidId)?.isTapped).toBe(true);
  });

  it("Three Tree Mascot: {T} returns a multi-option choice set for any-color", () => {
    const mascotId = put(state, alice, "battlefield", threeTreeMascot);
    const r = activateManaAbility(state, alice, mascotId, 0);
    expect(r.success).toBe(true);
    expect(r.options).toBeDefined();
    expect(r.options!.length).toBeGreaterThan(1);
  });

  it("Three Tree Mascot: with chosenOption {red:1}, completes and adds 1 R", () => {
    const mascotId = put(state, alice, "battlefield", threeTreeMascot);
    const r1 = activateManaAbility(state, alice, mascotId, 0);
    expect(r1.success).toBe(true);
    const redOption = r1.options!.find((o) => o.mana.red === 1);
    expect(redOption).toBeDefined();
    const before = totalMana(r1.state, alice);
    const r2 = activateManaAbility(r1.state, alice, mascotId, 0, redOption);
    expect(r2.success).toBe(true);
    expect(totalMana(r2.state, alice) - before).toBe(1);
    expect(pool(r2.state, alice).red).toBe(1);
    expect(pool(r2.state, alice).green).toBe(0);
  });

  // NOTE: Three Tree Mascot's `limit: "once_per_turn"` is honored by
  // `activateAbility` (issue #2496, CR 602.5b) but NOT yet by
  // `activateManaAbility` (mana-production.ts has no activationLimit
  // gate — see schema.ts comments marking this as a future-lane item).
  // When the gate lands, this card will be enforced end-to-end via the
  // mana-ability path; until then, the JSON shape correctly declares
  // the intent and `activateAbility` users get the constraint.
});
