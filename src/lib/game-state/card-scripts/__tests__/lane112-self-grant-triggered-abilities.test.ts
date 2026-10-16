/**
 * Lane 112 — Static-shape self-grant triggered abilities
 * (CR 603.2 grant semantics).
 *
 * Wave 4.8 follow-up 18 lane 112 (#2614 follow-up). The
 * schema arm `StaticSchema.grants.triggers` mirrors the
 * lane 65 Aura-shaped variant (`AuraStaticSchema.grants.triggers`)
 * but routes the grant onto the SOURCE itself, not the
 * enchanted card. The engine consumer lives in
 * `refreshScriptedStatics` (this file's only minted
 * diff surface) — the trigger fire path
 * (`detectTriggeredAbilities` in `abilities/triggered.ts`)
 * consumes the existing `card.grantedTriggers` field
 * stamped by lane 65 and merges in the lane 112 self-grants
 * for the same field. v1 minimum supports a single
 * `event: "dies"` arm; multi-event grants
 * (`["dies" | "etb" | "attacks"]`) ride future lanes.
 *
 * Sample card: `self_grant_draw_on_die.json` — a synthetic
 * "when this creature dies, draw a card" card whose
 * trigger is delivered via the static `grants.triggers`
 * arm (the card has no `triggers` field; the trigger is
 * wholly self-granted by the static).
 *
 * Test cases verify:
 *   1. Registry exposes the self-grant card with a
 *      `statics[].grants.triggers` arm and the `dies`
 *      event.
 *   2. `refreshScriptedStatics` stamps the
 *      `card.grantedTriggers` field with the source's
 *      own self-grant triggers.
 *   3. The `detectTriggeredAbilities` fire path picks
 *      up the self-granted trigger when the source dies
 *      and routes its `Draw` effect to the dying card's
 *      controller (parallel to the lane 65
 *      `subjectMatches` path).
 *
 * Out of scope for lane 112 (each a follow-up lane):
 *   - Multi-event grants (`["dies" | "etb" | "attacks"]`)
 *   - Grants that reference the source's controller
 *     vs the source's controller at fire time
 *   - Non-self grants (the lane 65 Aura-shaped variant
 *     is the existing path; lane 112 is the self-grant
 *     path)
 */
import { detectTriggeredAbilities } from "../../abilities/triggered";
import { refreshScriptedStatics } from "../../keyword-actions/scripted-statics";
import { createCardInstance } from "../../card-instance";
import {
  createInitialGameState,
  startGame,
} from "../../game-state";
import { getCardScript } from "../index";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../../types";

const id = (s: string) => s as CardInstanceId;

function card(name: string, typeLine: string, pt?: [number, number]): ScryfallCard {
  return {
    id: `mock-${name}`,
    name,
    type_line: typeLine,
    oracle_text: "",
    mana_cost: "",
    cmc: 0,
    colors: [],
    color_identity: [],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
    power: pt ? String(pt[0]) : undefined,
    toughness: pt ? String(pt[1]) : undefined,
  } as unknown as ScryfallCard;
}

function put(
  state: GameState,
  playerId: PlayerId,
  cardId: string,
  data: ScryfallCard,
  zone: "battlefield" | "library" | "hand" | "graveyard" = "battlefield",
): GameState {
  const canonicalKey = `${playerId}-${zone}`;
  const cards = new Map(state.cards);
  cards.set(
    id(cardId),
    createCardInstance(data, playerId, playerId, {
      id: id(cardId),
      currentZoneKey: canonicalKey,
    }),
  );
  const zones = new Map(state.zones);
  const z = zones.get(canonicalKey);
  if (!z) return state;
  zones.set(canonicalKey, { ...z, cardIds: [...z.cardIds, id(cardId)] });
  return { ...state, cards, zones };
}

describe("Lane 112: Static self-grant triggered abilities (CR 603.2 grant semantics)", () => {
  it("registry exposes the self-grant card with a statics[].grants.triggers arm and the 'dies' event", () => {
    const sample = getCardScript("Self-Grant Draw on Die");
    expect(sample).toBeDefined();
    expect(sample!.statics).toBeDefined();
    expect(sample!.statics).toHaveLength(1);
    const stat = sample!.statics![0];
    expect(stat.text).toBe("When this creature dies, draw a card.");
    expect(stat.grants).toBeDefined();
    expect(stat.grants!.triggers).toBeDefined();
    expect(stat.grants!.triggers).toHaveLength(1);
    const grantedTrig = stat.grants!.triggers![0];
    expect(grantedTrig.event).toBe("dies");
    expect(grantedTrig.effects).toHaveLength(1);
    expect(grantedTrig.effects![0].op).toBe("Draw");
    // The card itself has NO `triggers` field — the
    // self-grant is the only path to the trigger.
    expect(sample!.triggers ?? []).toEqual([]);
  });

  it("refreshScriptedStatics stamps card.grantedTriggers with the source's self-grant (single source / single grant)", () => {
    let state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [p1] = Array.from(state.players.keys());
    state = put(
      state,
      p1,
      "self_grant",
      card("Self-Grant Draw on Die", "Creature — Spirit", [1, 1]),
    );

    // The source is on the battlefield. The refresh
    // pass should pick up the static's grants.triggers
    // arm and stamp the granted trigger onto the
    // SOURCE itself (not an enchanted card, not a leaf).
    const refreshed = refreshScriptedStatics(state);
    const sourceCard = refreshed.cards.get(id("self_grant"))!;
    expect(sourceCard.grantedTriggers ?? []).toHaveLength(1);
    const granted = sourceCard.grantedTriggers![0];
    expect(granted.event).toBe("dies");
    // `from` is the source itself (parallel to the lane
    // 65 Aura variant where `from` is the Aura's id).
    expect(granted.from).toBe(id("self_grant"));
    expect(granted.sourceControllerId).toBe(p1);
    expect(granted.effects).toHaveLength(1);
    expect(granted.effects[0].op).toBe("Draw");
  });

  it("detectTriggeredAbilities fires the self-granted 'dies' trigger when the source dies (parallel to lane 65 Aura path)", () => {
    let state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [p1] = Array.from(state.players.keys());
    state = put(
      state,
      p1,
      "self_grant",
      card("Self-Grant Draw on Die", "Creature — Spirit", [1, 1]),
    );

    // Refresh to stamp the granted trigger on the source.
    state = refreshScriptedStatics(state);
    const card_before = state.cards.get(id("self_grant"))!;

    const detected = detectTriggeredAbilities(state, "dies", {
      dyingCardId: card_before.id,
    });
    const fired = detected.filter(
      (t) => t.sourceCardId === id("self_grant"),
    );

    // A single self-grant trigger should fire when the
    // source dies (parallel to the lane 65 Aura path,
    // which fires the granted dies trigger on the
    // enchanted card's death).
    expect(fired).toHaveLength(1);
    expect(fired[0].effect).toContain("dies");
    expect(fired[0].effect).toContain("draw 1 card");
    // The granted-effects bag carries the raw effect
    // ops for the resolver's consumption.
    expect(fired[0].grantedEffects).toBeDefined();
    expect(fired[0].grantedEffects).toHaveLength(1);
    expect(fired[0].grantedEffects![0].op).toBe("Draw");
    expect(fired[0].grantedSourceControllerId).toBe(p1);
  });

  it("refreshScriptedStatics is idempotent on the self-grant (re-refresh keeps the granted list stable)", () => {
    let state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [p1] = Array.from(state.players.keys());
    state = put(
      state,
      p1,
      "self_grant",
      card("Self-Grant Draw on Die", "Creature — Spirit", [1, 1]),
    );
    state = refreshScriptedStatics(state);
    const firstRefresh = state.cards.get(id("self_grant"))!.grantedTriggers ?? [];
    expect(firstRefresh).toHaveLength(1);

    // A second refresh pass should produce the same
    // field — no append, no churn. The
    // `sameSelfGrantedTriggers` diff guards against
    // spurious re-stamps.
    state = refreshScriptedStatics(state);
    const secondRefresh = state.cards.get(id("self_grant"))!.grantedTriggers ?? [];
    expect(secondRefresh).toHaveLength(1);
    expect(JSON.stringify(secondRefresh)).toBe(JSON.stringify(firstRefresh));
  });
});
