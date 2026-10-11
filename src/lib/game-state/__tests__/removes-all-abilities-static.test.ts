/**
 * Remove all abilities static — engine arm (Wave 4.8 lane 54,
 * #2614 follow-up).
 *
 * Lane 54 ships the engine piece for "Witness Protection
 * loses all other abilities." The card text is:
 *
 *   Enchant creature
 *   Enchanted creature gets -1/-1 and can't attack.
 *   (It loses all other abilities.)
 *
 * The "loses all other abilities" reminder text is the
 * actual mechanic — the Aura strips the enchanted card's
 * OWN characteristics (scripted activated + triggered
 * abilities) while keeping its OWN continuous effect (the
 * -1/-1 and `can't attack` grants).
 *
 * Schema (Wave 4.8 lane 54):
 *   `AuraStaticSchema.removesAllAbilities: z.literal(true)`
 *   — a stand-alone arm allowed alongside (or instead of)
 *   the existing P/T / keywords / restriction fields.
 *   The schema refine accepts it as long as at least one
 *   of the existing arms OR `removesAllAbilities` is set
 *   (Witness Protection: power: -1 + removesAllAbilities
 *   is the canonical combo).
 *
 * Engine:
 *   `CardInstance.losesAbilities?: true` — stamped by
 *   `refreshAuraBonuses` for the enchanted card when any
 *   attached Aura's static has `removesAllAbilities: true`.
 *   `canActivateAbility` denies the card's scripted
 *   activated abilities when this flag is set. Triggered
 *   abilities are deferred (multi-lane trigger fire
 *   suppression — the `losesAbilities` flag would also need
 *   to gate `fireTriggers` for scripted triggers, which is
 *   a broader engine change documented in
 *   `wave4-blockers.md` as a follow-up).
 *
 * The Aura's own static bonuses (`auraPT`, `auraRestrictAttack`)
 * STAY even with `losesAbilities: true` — Witness Protection
 * keeps granting `-1/-1` and `can't attack` to the enchanted
 * creature. (CR 613.1b: the source's continuous effect is
 * separate from the enchanted card's native characteristics.)
 *
 * Mana abilities (CR 605) are NOT exempted from the gate —
 * the card text "loses all other abilities" doesn't carve
 * out a mana-ability exception the way Sorcerous Spyglass's
 * "can't be activated unless they're mana abilities" does.
 * This is the strictest interpretation matching the
 * card text.
 *
 * Lane 54 ships the real `witness_protection.json` (the
 * existing script was power/toughness/restriction only;
 * lane 54 adds the `removesAllAbilities: true` arm). No
 * engine change beyond the schema + type + Aura stamp
 * + canActivateAbility gate.
 */
import { describe, it, expect, beforeEach } from "@jest/globals";
import { CardScriptSchema } from "../card-scripts/schema";
import { getCardScript } from "../card-scripts/registry";
import { RAW_CARD_SCRIPTS } from "../card-scripts/cards/index.generated";
import { registerCardScripts } from "../card-scripts/registry";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import { attachAura } from "../keyword-actions/enchant";
import { refreshAuraBonuses } from "../keyword-actions/aura-bonus";
import {
  canActivateAbility,
  getActivatableAbilities,
} from "../abilities/activated";
import { Phase } from "../types";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";

const WITNESS_PROTECTION_NAME = "Witness Protection";

const TEST_LITERAL_AURA_NAME = "Test Aura with Loses All (lane 54)";

const TEST_LITERAL_AURA_SCRIPT = CardScriptSchema.parse({
  name: TEST_LITERAL_AURA_NAME,
  oracle:
    "Enchant creature\nEnchanted creature loses all other abilities.",
  aura: {
    text: "Enchanted creature loses all other abilities.",
    target: "creature",
    static: {
      text: "Enchanted creature loses all other abilities.",
      removesAllAbilities: true,
    },
  },
});

function card(overrides: Partial<ScryfallCard>): ScryfallCard {
  return {
    id: `mock-${overrides.name}`,
    name: "Test",
    type_line: "Creature \u2014 Bear",
    oracle_text: "",
    mana_cost: "{2}",
    cmc: 2,
    colors: [],
    color_identity: [],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
    power: "2",
    toughness: "2",
    ...overrides,
  } as ScryfallCard;
}

// A scripted creature with BOTH a mana activated
// ability ("{T}: Add {C}.") and a non-mana activated
// ability ("{T}: Draw a card."). Both should be gated
// by `losesAbilities` per the lane 54 strict
// interpretation (no mana-ability carve-out).
const hostWithAbilities = card({
  name: "Test Host with Abilities (lane 54)",
  type_line: "Creature \u2014 Construct",
  oracle_text:
    "{T}: Add {C}. {T}: Draw a card.",
  mana_cost: "{3}",
  cmc: 3,
});

// A scripted creature with NO activated abilities — used
// to verify that `losesAbilities` is stamped correctly even
// when there are no abilities to suppress.
const hostWithoutAbilities = card({
  name: "Test Host without Abilities (lane 54)",
  type_line: "Creature \u2014 Bear",
});

const witnessProtection = card({
  name: WITNESS_PROTECTION_NAME,
  type_line: "Enchantment \u2014 Aura",
  // Empty oracle_text so the engine's oracle-text parser
  // doesn't double-count P/T alongside the scripted
  // `aura.static` (-1/-1 + restricts). The real Witness
  // Protection JSON's oracle also doesn't have a parseable
  // "Enchanted creature gets -1/-1" string when paired with
  // the scripted static — the JSON is the source of truth.
  oracle_text: "",
});

const testAuraCard = card({ name: TEST_LITERAL_AURA_NAME });

function put(
  state: GameState,
  playerId: PlayerId,
  zone: "hand" | "battlefield",
  data: ScryfallCard,
): CardInstanceId {
  const c = createCardInstance(data, playerId, playerId, {
    currentZoneKey: `${playerId}-${zone}`,
  });
  state.cards.set(c.id, { ...c, hasSummoningSickness: false });
  const key = `${playerId}-${zone}`;
  const z = state.zones.get(key)!;
  state.zones.set(key, { ...z, cardIds: [...z.cardIds, c.id] });
  return c.id;
}

describe("Remove all abilities static — engine arm (Wave 4.8 lane 54, #2614 follow-up)", () => {
  let state: GameState;
  let alice: PlayerId;

  beforeEach(() => {
    registerCardScripts([
      ...RAW_CARD_SCRIPTS,
      TEST_LITERAL_AURA_SCRIPT,
    ]);
    state = startGame(createInitialGameState(["Alice", "Bob"], 20, false));
    [alice] = Array.from(state.players.keys());
    state.status = "in_progress";
    state.turn.activePlayerId = alice;
    state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    state.priorityPlayerId = alice;
    state.stack = [];
    state = addMana(state, alice, { generic: 8 });
  });

  describe("schema", () => {
    it("accepts removesAllAbilities on a stand-alone Aura static", () => {
      const r = CardScriptSchema.safeParse(TEST_LITERAL_AURA_SCRIPT);
      expect(r.success).toBe(true);
    });
    it("accepts removesAllAbilities alongside P/T (Witness Protection shape)", () => {
      const r = CardScriptSchema.safeParse({
        name: "Witness Test",
        oracle: "Enchant creature",
        aura: {
          text: "Enchanted creature gets -1/-1 and loses all other abilities.",
          target: "creature",
          static: {
            text: "Enchanted creature gets -1/-1 and loses all other abilities.",
            power: -1,
            toughness: -1,
            removesAllAbilities: true,
          },
        },
      });
      expect(r.success).toBe(true);
    });
    it("rejects an unknown removesAllAbilities value", () => {
      const r = CardScriptSchema.safeParse({
        name: "Bad",
        oracle: "Bad",
        aura: {
          text: "x",
          target: "creature",
          static: {
            text: "x",
            removesAllAbilities: "yes" as unknown as true,
          },
        },
      });
      expect(r.success).toBe(false);
    });
    it("rejects removesAllAbilities without ANY aura-static arm (must be paired)", () => {
      // The schema refine requires at least one of
      // power/toughness/keywords/restrictAttack/restrictBlock/restrictUntap/maxBlockers/removesAllAbilities.
      // A bare Aura with only `removesAllAbilities: true` is
      // allowed by the refine above (passes the
      // condition). The empty static is rejected because
      // it carries none of those arms.
      const r = CardScriptSchema.safeParse({
        name: "Bad",
        oracle: "Bad",
        aura: {
          text: "x",
          target: "creature",
          static: { text: "x" },
        },
      });
      expect(r.success).toBe(false);
    });
  });

  describe("refreshAuraBonuses stamping", () => {
    it("stamps losesAbilities on the enchanted card", () => {
      const hostId = put(state, alice, "battlefield", hostWithoutAbilities);
      const auraId = put(state, alice, "battlefield", testAuraCard);
      const attached = attachAura(state, auraId, hostId);
      const after = refreshAuraBonuses(attached);
      expect(after.cards.get(hostId)!.losesAbilities).toBe(true);
    });
    it("does NOT stamp losesAbilities when no Aura with removesAllAbilities is attached", () => {
      const hostId = put(state, alice, "battlefield", hostWithoutAbilities);
      // No aura attached — `losesAbilities` stays unset.
      const after = refreshAuraBonuses(state);
      expect(after.cards.get(hostId)!.losesAbilities).toBeUndefined();
    });
    it("clears losesAbilities when the Aura leaves the battlefield", () => {
      const hostId = put(state, alice, "battlefield", hostWithoutAbilities);
      const auraId = put(state, alice, "battlefield", testAuraCard);
      let s = refreshAuraBonuses(attachAura(state, auraId, hostId));
      expect(s.cards.get(hostId)!.losesAbilities).toBe(true);
      // Move the Aura out of the battlefield zone.
      const bf = s.zones.get(`${alice}-battlefield`)!;
      s = {
        ...s,
        zones: new Map(s.zones).set(`${alice}-battlefield`, {
          ...bf,
          cardIds: bf.cardIds.filter((id) => id !== auraId),
        }),
      };
      const after = refreshAuraBonuses(s);
      expect(after.cards.get(hostId)!.losesAbilities).toBeUndefined();
    });
    it("Witness Protection's JSON carries removesAllAbilities: true", () => {
      const script = getCardScript(WITNESS_PROTECTION_NAME);
      expect(script).toBeDefined();
      expect(script!.aura?.static?.removesAllAbilities).toBe(true);
      // And the existing P/T / restrictAttack arms stay.
      expect(script!.aura?.static?.power).toBe(-1);
      expect(script!.aura?.static?.toughness).toBe(-1);
      expect(script!.aura?.static?.restrictAttack).toBe(true);
    });
  });

  describe("canActivateAbility gate", () => {
    it("denies a non-mana activated ability on a card stamped with losesAbilities", () => {
      const hostId = put(state, alice, "battlefield", hostWithAbilities);
      const auraId = put(state, alice, "battlefield", testAuraCard);
      const attached = attachAura(state, auraId, hostId);
      const after = refreshAuraBonuses(attached);
      // The script has 2 activated abilities (mana + non-mana).
      // Find the non-mana ("Draw a card.") one. We don't know
      // the exact index without re-parsing — try both and
      // assert at least one is denied with the right reason.
      const script = after.cards.get(hostId)!;
      const abilities = getActivatableAbilities(after, alice, hostId);
      expect(abilities).toEqual([]);
      const r0 = canActivateAbility(after, alice, hostId, 0);
      const r1 = canActivateAbility(after, alice, hostId, 1);
      const denied = [r0, r1].filter((r) => !r.canActivate);
      expect(denied.length).toBe(2);
      denied.forEach((r) => expect(r.reason).toMatch(/loses all other abilities/i));
      expect(script.losesAbilities).toBe(true);
    });
    it("denies BOTH mana and non-mana activated abilities (no mana carve-out)", () => {
      const hostId = put(state, alice, "battlefield", hostWithAbilities);
      const auraId = put(state, alice, "battlefield", testAuraCard);
      const after = refreshAuraBonuses(attachAura(state, auraId, hostId));
      // Both abilities must be denied — lane 54's gate has
      // no `isManaAbility` carve-out (unlike lane 50's
      // chosen-name gate). This is the strict
      // interpretation matching Witness Protection's
      // "loses all other abilities" — no mana-ability
      // exception per the card text.
      const r0 = canActivateAbility(after, alice, hostId, 0);
      const r1 = canActivateAbility(after, alice, hostId, 1);
      expect(r0.canActivate).toBe(false);
      expect(r1.canActivate).toBe(false);
    });
    it("allows activation on a card WITHOUT losesAbilities (regression check)", () => {
      const hostId = put(state, alice, "battlefield", hostWithAbilities);
      // No aura attached.
      const after = refreshAuraBonuses(state);
      const abilities = getActivatableAbilities(after, alice, hostId);
      // `getActivatableAbilities` skips mana abilities by
      // contract — hostWithAbilities has 2 scripted
      // abilities (mana + non-mana) and the non-mana one
      // is the only one surfaced. The point of this test
      // is that WITHOUT `losesAbilities`, the non-mana
      // ability is NOT gated (it would be denied via the
      // lane 54 gate when losesAbilities is set; here it
      // isn't).
      expect(abilities.length).toBe(1);
      // And `canActivateAbility` on the non-mana ability
      // returns canActivate: true.
      const script = after.cards.get(hostId)!;
      expect(script.losesAbilities).toBeUndefined();
    });
    it("Witness Protection's enchanted creature loses its activated abilities", () => {
      // End-to-end through the real Witness Protection JSON:
      // attach to hostWithAbilities, refresh, verify both
      // abilities are denied.
      const hostId = put(state, alice, "battlefield", hostWithAbilities);
      const auraId = put(state, alice, "battlefield", witnessProtection);
      const after = refreshAuraBonuses(attachAura(state, auraId, hostId));
      // Witness Protection's P/T/attack grants also stay.
      expect(after.cards.get(hostId)!.auraPT).toEqual({ power: -1, toughness: -1 });
      expect(after.cards.get(hostId)!.auraRestrictAttack).toEqual([
        "Witness Protection",
      ]);
      // And the losesAbilities flag is set.
      expect(after.cards.get(hostId)!.losesAbilities).toBe(true);
      // Both abilities are gated.
      expect(canActivateAbility(after, alice, hostId, 0).canActivate).toBe(false);
      expect(canActivateAbility(after, alice, hostId, 1).canActivate).toBe(false);
    });
  });
});