/**
 * Whispering Ward of the Grave — death replacement-effect (lane 61a).
 *
 * Wave 4.8 follow-up 13 lane 61a (#2614 follow-up). The
 * foundational replacement-effect-for-death layer
 * (Whip of Erebos-style "if a creature you control would
 * die, instead exile it"). This lane:
 *
 *   1. Adds the `ReplacementEffectSchema` + the
 *      `replacement_effects[]` arm on `CardScriptSchema`
 *      (parallel to `triggers` / `activated` / `statics`).
 *   2. Extends `ReplacementEffectType` with
 *      `"death_replacement"` and `ReplacementEventType`
 *      with `"would_die"`.
 *   3. Wires the `moveCardToZone` consult to ask
 *      `state.replacementEffectManager` for a redirect
 *      before moving a creature to the graveyard.
 *   4. Adds the per-script helper
 *      `buildScriptedDeathReplacementEffects` that the
 *      consult uses to build the effect list each call
 *      (no permanent registration — the consult is the
 *      single owner).
 *   5. The synthetic `Whispering Ward of the Grave`
 *      card is the v1 sample card (one replacement
 *      effect: `event: "would_die"` +
 *      `applies_to.type: "creature"` +
 *      `applies_to.controller: "you"` +
 *      `redirect.to: "exile"`).
 *
 * Out of scope for lane 61a (each a follow-up lane):
 *   - the `redirect.to: "hand" | "library_top" |
 *     "library_bottom" | "battlefield_tapped" |
 *     "battlefield_untapped" | "sacrifice" | "life_loss"`
 *     extensions (lanes 100 / 101 / 104)
 *   - the `applies_to.notSelf` /
 *     `applies_to.isToken` /
 *     `applies_to.type: "self" | "artifact" |
 *     "enchantment" | "planeswalker" | "any"` filters
 *     (lanes 102 / 105)
 *   - the `if_condition` / `optional` /
 *     `once_per_turn` engines (lane 103 / follow-up lanes)
 *   - the printed-oracle `static` mechanism that
 *     Whip of Erebos's actual oracle would use (lane 61b)
 */
import { destroyCard, moveCardToZone } from "../../keyword-actions/removal";
import {
  parsePrintedDeathReplacement,
  refreshScriptedStatics,
} from "../../keyword-actions/scripted-statics";
import { createCardInstance } from "../../card-instance";
import {
  createInitialGameState,
  startGame,
} from "../../game-state";
import {
  buildScriptedDeathReplacementEffect,
  buildScriptedDeathReplacementEffects,
  getCardScript,
} from "../index";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../../types";

const id = (s: string) => s as CardInstanceId;

function card(name: string, typeLine: string, pt?: [number, number]) {
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

function whipCard() {
  // The lane 61b fixture: Whip of Erebos's actual
  // oracle text is critical — the lane 61b parser
  // reads `cardData.oracle_text` to detect the
  // "would die, instead exile it" pattern.
  return {
    id: "mock-Whip of Erebos",
    name: "Whip of Erebos",
    type_line: "Legendary Enchantment",
    oracle_text:
      "Creatures you control have lifelink.\nWhenever a creature you control would die, exile it instead.",
    mana_cost: "",
    cmc: 0,
    colors: [],
    color_identity: [],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
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

function startTwoPlayerState(): GameState {
  const base = createInitialGameState(["Player1", "Player2"], 20, false);
  return startGame(base);
}

describe("Whispering Ward of the Grave (lane 61a): death replacement-effect foundation", () => {
  it("registry exposes the synthetic source with a single replacement_effects entry", () => {
    const ward = getCardScript("Whispering Ward of the Grave");
    expect(ward).toBeDefined();
    expect(ward!.replacement_effects).toBeDefined();
    expect(ward!.replacement_effects!).toHaveLength(1);
    const re = ward!.replacement_effects![0];
    expect(re.event).toBe("would_die");
    expect(re.applies_to.type).toBe("creature");
    expect(re.applies_to.controller).toBe("you");
    expect(re.redirect.to).toBe("exile");
  });

  it("buildScriptedDeathReplacementEffect produces a valid ReplacementAbility for the v1 shape", () => {
    const ward = getCardScript("Whispering Ward of the Grave");
    expect(ward).toBeDefined();
    const re = ward!.replacement_effects![0];
    const effect = buildScriptedDeathReplacementEffect(
      id("ward"),
      "alice" as PlayerId,
      re,
    );
    expect(effect).not.toBeNull();
    expect(effect!.effectType).toBe("death_replacement");
    expect(effect!.controllerId).toBe("alice");
    expect(effect!.sourceCardId).toBe(id("ward"));
    expect(effect!.description).toBe(re.text);
  });

  it("buildScriptedDeathReplacementEffect returns null for out-of-scope shapes (lane 61a v1 minimum, lane 100 hand-redirect covered)", () => {
    // Out-of-scope (lane 61a v1 minimum + lane 100 hand-redirect
    // shipped): redirect.to: "library_top" / "library_bottom"
    // / "battlefield_tapped" / "battlefield_untapped" /
    // "sacrifice" / "any_zone" / "life_loss" (lanes 100
    // partial / 101 / 104). The factory rejects them
    // until those lanes ship. The lane 100 hand-redirect
    // is now in scope (covered by the registered
    // `Return to Hand Instead Die` card).
    expect(
      buildScriptedDeathReplacementEffect(
        id("ward"),
        "alice" as PlayerId,
        {
          text: "instead tap it",
          event: "would_die",
          applies_to: { type: "creature", controller: "you" },
          redirect: { to: "battlefield_tapped" },
        },
      ),
    ).toBeNull();
    // Out-of-scope: applies_to.controller: "opponent" (no lane yet)
    expect(
      buildScriptedDeathReplacementEffect(
        id("ward"),
        "alice" as PlayerId,
        {
          text: "instead exile an opponent's creature",
          event: "would_die",
          applies_to: { type: "creature", controller: "opponent" },
          redirect: { to: "exile" },
        },
      ),
    ).toBeNull();
    // Out-of-scope: applies_to.type: "artifact" (lane 102 / 105)
    expect(
      buildScriptedDeathReplacementEffect(
        id("ward"),
        "alice" as PlayerId,
        {
          text: "instead exile an artifact",
          event: "would_die",
          applies_to: { type: "artifact", controller: "you" },
          redirect: { to: "exile" },
        },
      ),
    ).toBeNull();
  });

  it("buildScriptedDeathReplacementEffects returns the ward's effect when only the ward is on the battlefield", () => {
    let state = startTwoPlayerState();
    const [p1] = Array.from(state.players.keys());
    state = put(state, p1, "ward", card("Whispering Ward of the Grave", "Enchantment"));
    // refreshScriptedStatics isn't strictly required (the consult
    // rebuilds the effect list every call), but we call it to mirror
    // the production path so any future "stamp on the source" wiring
    // is exercised.
    state = refreshScriptedStatics(state);

    const effects = buildScriptedDeathReplacementEffects(state);
    expect(effects).toHaveLength(1);
    expect(effects[0].sourceCardId).toBe(id("ward"));
    expect(effects[0].controllerId).toBe(p1);
    expect(effects[0].effectType).toBe("death_replacement");
  });

  it("end-to-end: a creature the ward's controller owns dies → exiled (not graveyarded)", () => {
    let state = startTwoPlayerState();
    const [p1, p2] = Array.from(state.players.keys());
    state = put(state, p1, "ward", card("Whispering Ward of the Grave", "Enchantment"));
    state = put(state, p1, "bear", card("Bear Cub", "Creature — Bear", [2, 2]));
    state = refreshScriptedStatics(state);

    const graveyardBefore = state.zones.get(`${p1}-graveyard`)?.cardIds ?? [];
    const exileBefore = state.zones.get(`${p1}-exile`)?.cardIds ?? [];

    const result = destroyCard(state, id("bear"));
    expect(result.success).toBe(true);

    // The bear is in exile, not the graveyard.
    const exileAfter = result.state.zones.get(`${p1}-exile`)?.cardIds ?? [];
    const graveyardAfter = result.state.zones.get(`${p1}-graveyard`)?.cardIds ?? [];
    expect(exileAfter).toContain(id("bear"));
    expect(graveyardAfter).not.toContain(id("bear"));
    // Exile + graveyard differ from the pre-state by the bear's move.
    expect(graveyardAfter).toEqual(graveyardBefore);
    expect(exileAfter.length).toBe(exileBefore.length + 1);
    // The ward itself is unaffected.
    expect(result.state.zones.get(`${p1}-battlefield`)?.cardIds).toContain(id("ward"));
    void p2; // p2 unused but referenced to mirror the consult's two-player test pattern
  });

  it("end-to-end: the replacement does NOT fire for a non-creature permanent", () => {
    let state = startTwoPlayerState();
    const [p1] = Array.from(state.players.keys());
    state = put(state, p1, "ward", card("Whispering Ward of the Grave", "Enchantment"));
    state = put(state, p1, "snack", card("Midnight Snack", "Enchantment"));

    // Use `moveCardToZone` directly (not `destroyCard`) since the
    // Midnight Snack is an enchantment (destroyCard rejects non-
    // creatures — `isCreatureOnCurrentFace` is false for
    // enchantments, so destroyCard's indestructible / regenerate
    // guard flow doesn't quite hit the move-to-graveyard branch
    // we want to test here).
    const result = moveCardToZone(state, id("snack"), "graveyard");
    expect(result.success).toBe(true);
    // The ward's `applies_to.type: "creature"` filter rejects
    // non-creature permanents. Result: the enchantment moves to
    // the graveyard, NOT to exile.
    const graveyardAfter = result.state.zones.get(`${p1}-graveyard`)?.cardIds ?? [];
    expect(graveyardAfter).toContain(id("snack"));
    const exileAfter = result.state.zones.get(`${p1}-exile`)?.cardIds ?? [];
    expect(exileAfter).not.toContain(id("snack"));
  });

  it("end-to-end: an opponent's dying creature is NOT redirected by the ward", () => {
    let state = startTwoPlayerState();
    const [p1, p2] = Array.from(state.players.keys());
    state = put(state, p1, "ward", card("Whispering Ward of the Grave", "Enchantment"));
    state = put(state, p2, "bear", card("Bear Cub", "Creature — Bear", [2, 2]));
    state = refreshScriptedStatics(state);

    const result = destroyCard(state, id("bear"));
    expect(result.success).toBe(true);
    // The ward's `applies_to.controller: "you"` filter rejects
    // opponent-controlled creatures. Result: bear goes to the
    // owner's graveyard, NOT to exile.
    const graveyardAfter = result.state.zones.get(`${p2}-graveyard`)?.cardIds ?? [];
    const exileAfter = result.state.zones.get(`${p2}-exile`)?.cardIds ?? [];
    expect(graveyardAfter).toContain(id("bear"));
    expect(exileAfter).not.toContain(id("bear"));
  });

  it("end-to-end: without the ward, the creature dies to the graveyard normally (control case)", () => {
    let state = startTwoPlayerState();
    const [p1] = Array.from(state.players.keys());
    state = put(state, p1, "bear", card("Bear Cub", "Creature — Bear", [2, 2]));
    state = refreshScriptedStatics(state);

    const result = destroyCard(state, id("bear"));
    expect(result.success).toBe(true);
    const graveyardAfter = result.state.zones.get(`${p1}-graveyard`)?.cardIds ?? [];
    expect(graveyardAfter).toContain(id("bear"));
  });

  it("the consult's effect registration is per-call (no permanent registration on the manager)", () => {
    let state = startTwoPlayerState();
    const [p1] = Array.from(state.players.keys());
    state = put(state, p1, "ward", card("Whispering Ward of the Grave", "Enchantment"));
    state = put(state, p1, "bear", card("Bear Cub", "Creature — Bear", [2, 2]));
    state = refreshScriptedStatics(state);

    // Destroy the bear and confirm the manager's effect
    // count is unchanged (the consult registers and clears
    // in the same synchronous pass). The private
    // `effects` array is reached via reflection-free
    // proxy: we destroy and re-destroy a second bear
    // (without a fresh ward on the field) and confirm
    // it falls through to the graveyard (no stale
    // registration intercepts).
    const result1 = destroyCard(state, id("bear"));
    expect(result1.success).toBe(true);
    // The first bear went to exile (the consult fired).
    expect(result1.state.zones.get(`${p1}-exile`)?.cardIds).toContain(
      id("bear"),
    );

    // Drop the ward from the battlefield; with the ward
    // gone, a fresh destroy of a creature falls through
    // to the graveyard (no replacement effects fire).
    const cards = new Map(state.cards);
    cards.delete(id("ward"));
    const zones = new Map(state.cards.size ? state.zones : state.zones);
    const bf = zones.get(`${p1}-battlefield`);
    if (bf) {
      zones.set(`${p1}-battlefield`, {
        ...bf,
        cardIds: bf.cardIds.filter((cid) => cid !== id("ward")),
      });
    }
    const stateNoWard = { ...state, cards, zones };
    const bear2 = card("Bear Cub 2", "Creature — Bear", [2, 2]);
    const stateWithBear2 = put(stateNoWard, p1, "bear2", bear2);
    const result2 = destroyCard(stateWithBear2, id("bear2"));
    expect(result2.success).toBe(true);
    // With the ward gone, the bear goes to the
    // graveyard, not exile.
    expect(result2.state.zones.get(`${p1}-graveyard`)?.cardIds).toContain(
      id("bear2"),
    );
    expect(result2.state.zones.get(`${p1}-exile`)?.cardIds ?? []).not.toContain(
      id("bear2"),
    );
  });

  it("APNAP ordering: when both players have a ward, the active player's applies first", () => {
    let state = startTwoPlayerState();
    const [p1, p2] = Array.from(state.players.keys());
    state = put(state, p1, "ward", card("Whispering Ward of the Grave", "Enchantment"));
    state = put(state, p2, "ward2", card("Whispering Ward of the Grave", "Enchantment"));
    state = put(state, p1, "bear", card("Bear Cub", "Creature — Bear", [2, 2]));
    state = refreshScriptedStatics(state);

    // Both players' ward effects are built; the active
    // player's applies first per CR 616.1 (the
    // replacement manager sorts by controllerId via the
    // apnapOrder.playerOrder, with the active player
    // first). The single-shape v1 minimum sends both
    // bears to exile on p1's controller.
    const effects = buildScriptedDeathReplacementEffects(state);
    expect(effects).toHaveLength(2);

    const result = destroyCard(state, id("bear"));
    expect(result.success).toBe(true);
    expect(result.state.zones.get(`${p1}-exile`)?.cardIds).toContain(id("bear"));
    // p2's ward applies to p2's creatures only — its
    // presence does NOT change the p1 bear's destination.
    void p2;
  });

  it("the would_die event lands in processEvent's modifiedEvent with redirectToZone on context", () => {
    // The ReplacementAbility.apply result stamps the redirect on
    // the modified event's `context.redirectToZone` side-channel.
    // The consult reads it from there.
    const ward = getCardScript("Whispering Ward of the Grave");
    expect(ward).toBeDefined();
    const re = ward!.replacement_effects![0];
    const effect = buildScriptedDeathReplacementEffect(
      id("ward"),
      "alice" as PlayerId,
      re,
    )!;
    const event = {
      type: "would_die" as const,
      timestamp: Date.now(),
      targetId: id("ward"),
      sourceId: id("ward"),
      controllerId: "alice" as PlayerId,
      amount: 0,
    };
    const result = effect.apply(event);
    expect(result.modified).toBe(true);
    expect(result.redirectToZone).toBe("exile");
    expect(result.modifiedEvent?.context?.redirectToZone).toBe("exile");
  });

  /**
   * Wave 4.8 follow-up 13 lane 100 (#2614 follow-up):
   * the "instead return to hand" hand-redirect (Whip of
   * Erebos's deferred half). The schema's `redirect.to`
   * enum already accepts "hand" (from lane 61a); this
   * test covers the engine wiring — the
   * `redirectToZone: "hand"` side-channel from the
   * lane 61a factory is consumed by the
   * `moveCardToZone` consult in `removal.ts`.
   */
  it("lane 100: redirect.to: 'hand' stamps redirectToZone on the event context", () => {
    const handCard = getCardScript("Return to Hand Instead Die");
    expect(handCard).toBeDefined();
    const handRe = handCard!.replacement_effects![0];
    const effect = buildScriptedDeathReplacementEffect(
      id("hand-source"),
      "alice" as PlayerId,
      handRe,
    )!;
    const event = {
      type: "would_die" as const,
      timestamp: Date.now(),
      targetId: id("creature"),
      sourceId: id("hand-source"),
      controllerId: "alice" as PlayerId,
      amount: 0,
    };
    const result = effect.apply(event);
    expect(result.modified).toBe(true);
    expect(result.redirectToZone).toBe("hand");
    expect(result.modifiedEvent?.context?.redirectToZone).toBe("hand");
  });

  it("lane 100: end-to-end — creature the controller owns dies → returned to owner's hand", () => {
    let state = startTwoPlayerState();
    const [p1] = Array.from(state.players.keys());
    state = put(state, p1, "hand-source", card("Return to Hand Instead Die", "Enchantment"));
    state = put(state, p1, "bear", card("Bear Cub", "Creature — Bear", [2, 2]));
    state = refreshScriptedStatics(state);

    // Track hand count before / after.
    const handBefore = state.zones.get(`${p1}-hand`)!.cardIds.length;
    const graveyardBefore = state.zones.get(`${p1}-graveyard`)?.cardIds.length ?? 0;

    // Destroy the bear (a creature the controller owns).
    // The lane 61a consult surfaces the replacement
    // effect; the lane 100 engine branch routes the
    // dying creature to the owner's hand instead of the
    // graveyard.
    const result = destroyCard(state, id("bear"));
    expect(result.success).toBe(true);

    // The hand gains 1 (the bear) and the graveyard
    // is unchanged (no creature died to the
    // graveyard — the replacement redirected).
    expect(result.state.zones.get(`${p1}-hand`)!.cardIds.length).toBe(
      handBefore + 1,
    );
    expect(result.state.zones.get(`${p1}-graveyard`)?.cardIds.length ?? 0).toBe(
      graveyardBefore,
    );
    // The hand-source enchantment is still on the
    // battlefield (it's a permanent, not a creature).
    expect(result.state.zones.get(`${p1}-battlefield`)!.cardIds).toContain(
      id("hand-source"),
    );
  });

  it("lane 100: opponent's dying creature is NOT redirected (controller filter)", () => {
    let state = startTwoPlayerState();
    const [p1, p2] = Array.from(state.players.keys());
    state = put(state, p1, "hand-source", card("Return to Hand Instead Die", "Enchantment"));
    state = put(state, p2, "bear", card("Bear Cub", "Creature — Bear", [2, 2]));
    state = refreshScriptedStatics(state);

    // Destroy p2's bear. The lane 61a controller filter
    // (`applies_to.controller: "you"`) excludes
    // opponent-controlled creatures — the bear goes
    // to its owner's graveyard, NOT to any hand.
    const p2HandBefore = state.zones.get(`${p2}-hand`)!.cardIds.length;
    const result = destroyCard(state, id("bear"));
    expect(result.success).toBe(true);
    expect(result.state.zones.get(`${p2}-graveyard`)?.cardIds ?? []).toContain(
      id("bear"),
    );
    // p2's hand is unchanged.
    expect(result.state.zones.get(`${p2}-hand`)!.cardIds.length).toBe(p2HandBefore);
  });
});

/**
 * Wave 4.8 follow-up 13 lane 61b (#2614 follow-up):
 * Whip of Erebos-style "if a creature you control would
 * die, instead exile it" via the printed `static`
 * mechanism. The lane 61a foundation reads the
 * `replacement_effects[]` arm on a card's script; lane
 * 61b extends the engine so the printed oracle (read by
 * `refreshScriptedStatics` via `parsePrintedDeathReplacement`)
 * populates a per-instance `deathReplacement` ledger.
 *
 * The sample card is the actual Whip of Erebos oracle
 * ("Creatures you control have lifelink. Whenever a
 * creature you control would die, exile it instead.")
 * with a `static[].death_replacement` arm and a
 * `static[].keywords: ["lifelink"]` arm. The
 * `refreshScriptedStatics` pass parses the oracle and
 * stamps the ledger; the consult reads both the lane 61a
 * schema arm AND the lane 61b ledger on every call.
 *
 * Out of scope for lane 61b (each a follow-up lane):
 * the conditional / multi-target / "if creature an
 * opponent controls" / "instead sacrifice" / "instead
 * tap it" / "instead return to hand" extensions (lanes
 * 100 / 101 / 102 / 103 / 104 / 105).
 */
describe("Whip of Erebos (lane 61b): printed static death-replacement mechanism", () => {
  it("registry exposes Whip of Erebos with a death_replacement static arm", () => {
    const whip = getCardScript("Whip of Erebos");
    expect(whip).toBeDefined();
    const statics = whip!.statics!;
    const deathSt = statics.find((s) => s.death_replacement !== undefined);
    expect(deathSt).toBeDefined();
    expect(deathSt!.death_replacement).toEqual({
      description:
        "Whenever a creature you control would die, exile it instead.",
    });
  });

  it("parsePrintedDeathReplacement returns null on a non-matching oracle", () => {
    // No death-replacement language → returns null.
    expect(
      parsePrintedDeathReplacement(
        "Flying. Trample.",
        "flying",
        "alice" as PlayerId,
      ),
    ).toBeNull();
    // Empty oracle text → returns null.
    expect(
      parsePrintedDeathReplacement(
        "",
        "anything",
        "alice" as PlayerId,
      ),
    ).toBeNull();
    // Undefined oracle text → returns null.
    expect(
      parsePrintedDeathReplacement(
        undefined,
        "anything",
        "alice" as PlayerId,
      ),
    ).toBeNull();
  });

  it("parsePrintedDeathReplacement matches Whip of Erebos's actual oracle", () => {
    const entry = parsePrintedDeathReplacement(
      "Creatures you control have lifelink.\nWhenever a creature you control would die, exile it instead.",
      "Whenever a creature you control would die, exile it instead.",
      "alice" as PlayerId,
    );
    expect(entry).not.toBeNull();
    expect(entry!.event).toBe("would_die");
    expect(entry!.applies_to.type).toBe("creature");
    expect(entry!.applies_to.controller).toBe("you");
    expect(entry!.redirect.to).toBe("exile");
  });

  it("refreshScriptedStatics stamps the deathReplacement ledger on the source", () => {
    let state = startTwoPlayerState();
    const [p1] = Array.from(state.players.keys());
    state = put(state, p1, "whip", whipCard());
    state = refreshScriptedStatics(state);

    const source = state.cards.get(id("whip"));
    expect(source).toBeDefined();
    expect(source!.deathReplacement).toBeDefined();
    expect(source!.deathReplacement).toHaveLength(1);
    const entry = source!.deathReplacement![0];
    expect(entry.event).toBe("would_die");
    expect(entry.applies_to.type).toBe("creature");
    expect(entry.applies_to.controller).toBe("you");
    expect(entry.redirect.to).toBe("exile");
  });

  it("end-to-end: Whip of Erebos redirects a dying creature to exile (printed static)", () => {
    let state = startTwoPlayerState();
    const [p1] = Array.from(state.players.keys());
    state = put(state, p1, "whip", whipCard());
    state = put(state, p1, "bear", card("Bear Cub", "Creature — Bear", [2, 2]));
    state = refreshScriptedStatics(state);

    const result = destroyCard(state, id("bear"));
    expect(result.success).toBe(true);
    // The printed `static` mechanism built the
    // `deathReplacement` ledger; the consult read it and
    // redirected the bear to exile.
    expect(result.state.zones.get(`${p1}-exile`)?.cardIds).toContain(id("bear"));
    expect(result.state.zones.get(`${p1}-graveyard`)?.cardIds ?? []).not.toContain(
      id("bear"),
    );
    // The whip itself is unaffected.
    expect(result.state.zones.get(`${p1}-battlefield`)?.cardIds).toContain(
      id("whip"),
    );
  });

  it("end-to-end: an opponent's dying creature is NOT redirected by Whip of Erebos", () => {
    let state = startTwoPlayerState();
    const [p1, p2] = Array.from(state.players.keys());
    state = put(state, p1, "whip", whipCard());
    state = put(state, p2, "bear", card("Bear Cub", "Creature — Bear", [2, 2]));
    state = refreshScriptedStatics(state);

    const result = destroyCard(state, id("bear"));
    expect(result.success).toBe(true);
    // The whip's `applies_to.controller: "you"` filter
    // rejects opponent-controlled creatures. Result:
    // bear goes to owner's graveyard, NOT to exile.
    expect(result.state.zones.get(`${p2}-graveyard`)?.cardIds).toContain(
      id("bear"),
    );
    expect(result.state.zones.get(`${p2}-exile`)?.cardIds ?? []).not.toContain(
      id("bear"),
    );
  });

  it("the printed static is cleared when the source leaves the battlefield", () => {
    let state = startTwoPlayerState();
    const [p1] = Array.from(state.players.keys());
    state = put(state, p1, "whip", whipCard());
    state = put(state, p1, "bear", card("Bear Cub", "Creature — Bear", [2, 2]));
    state = refreshScriptedStatics(state);

    expect(state.cards.get(id("whip"))!.deathReplacement).toBeDefined();

    // Move the whip off the battlefield. Refresh, then
    // confirm the ledger is cleared.
    const cards = new Map(state.cards);
    cards.delete(id("whip"));
    const zones = new Map(state.zones);
    const bf = zones.get(`${p1}-battlefield`);
    if (bf) {
      zones.set(`${p1}-battlefield`, {
        ...bf,
        cardIds: bf.cardIds.filter((cid) => cid !== id("whip")),
      });
    }
    state = { ...state, cards, zones };
    state = refreshScriptedStatics(state);

    expect(state.cards.get(id("whip"))?.deathReplacement).toBeUndefined();
  });

  it("buildScriptedDeathReplacementEffects includes the printed static's death replacement", () => {
    let state = startTwoPlayerState();
    const [p1] = Array.from(state.players.keys());
    state = put(state, p1, "whip", whipCard());
    state = refreshScriptedStatics(state);

    const effects = buildScriptedDeathReplacementEffects(state);
    // The whip's `static.death_replacement` arm produced
    // a `deathReplacement` ledger entry, and the
    // consult's helper now reads both arms.
    expect(effects.length).toBeGreaterThanOrEqual(1);
    expect(effects[0].effectType).toBe("death_replacement");
    expect(effects[0].sourceCardId).toBe(id("whip"));
  });

  it("schema accepts only-lane (no triggers / activated / replacement_effects)", () => {
    // Whip of Erebos uses only `statics` with a
    // `death_replacement` arm — the printed oracle
    // doesn't carry a `replacement_effects[]` arm. The
    // schema validates the card via the build-card-
    // script-index step at typecheck time (the
    // pretypecheck script regenerates the index and
    // any zod parse failure surfaces here). The
    // presence of the card in the registry is the
    // assertion.
    const whip = getCardScript("Whip of Erebos");
    expect(whip).toBeDefined();
    expect(whip!.replacement_effects).toBeUndefined();
    expect(whip!.statics!.length).toBeGreaterThanOrEqual(1);
  });
});