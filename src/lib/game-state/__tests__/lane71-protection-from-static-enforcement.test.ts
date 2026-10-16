/**
 * Wave 4.8 follow-up 22 lane 71 piece 1/N + Wave 4.8 follow-up 23
 * lane 71 piece 2/N (#2614 follow-up): protection-from static
 * enforcement at layer 6 / 7 (targeting-validation +
 * evergreen-keywords combat/enchant/equip/damage surfaces).
 *
 * The original lane 71 substrate shipped in follow-up 5
 * (`StaticSchema.protectionFrom: string[]` arm +
 * `hasProtectionFrom` consult in `evergreen-keywords.ts` + the
 * per-instance ledger stamped by `refreshScriptedStatics`).
 * v1 minimum for piece 1/N is the layer-6/7 enforcement
 * consult that flags matching effects in the target /
 * enchant / attach layers — i.e. the targeting-validation
 * path that drives `canBeTargetedBy` / `isProtectedFromSource`
 * / `getProtectionQualities`. Before this piece, that path
 * consulted only the oracle-text regex; it did NOT honor
 * the per-instance `protectionFrom` ledger, so a creature
 * granted protection via a static was stamped with the
 * field but the targeting-validation path did not actually
 * block the target. v1 consults the ledger first and falls
 * through to the oracle-text regex only when the ledger is
 * empty.
 *
 * Piece 2/N extends the symmetric bug fix to
 * `evergreen-keywords.isProtectedFromSource` (which is what
 * the combat-side, enchant-side, equip-side, and
 * damage-prevention consults delegate through). The
 * `evergreen-keywords` consult is shared by
 * `canBeTargetedBySource` (targeting-block), `canBeEnchantedBy`
 * (aura-enchant-block), `canBeEquippedBy` (equipment-block),
 * and `shouldPreventDamageToTarget` (damage-prevention) —
 * CR 702.16 enforcement. Before piece 2/N the consult went
 * through `getProtectionQualities` which missed the ledger,
 * so a creature granted protection via a static was stamped
 * but was NOT blocked from being targeted / enchanted /
 * equipped / damaged by the protected source.
 *
 * Out of scope (each a follow-up lane): per-source-quality
 * multi-cast enforcement (the consult shape currently flags
 * matching QUALITIES, not matching SOURCES), and the
 * Aura-shaped variant (lane 76 substrate, parallel
 * enforcement surface — the lane 71 piece 1/N docstring
 * scopes Aura enforcement to its own follow-up sub-piece 2b).
 */
import { describe, it, expect } from "@jest/globals";
import { createCardInstance } from "../card-instance";
import {
  canBeEnchantedBy,
  canBeEquippedBy,
  canBeTargetedBySource,
  getProtectionQualities,
  isProtectedFromSource,
  shouldPreventDamageToTarget,
} from "../evergreen-keywords";
import {
  canTargetCard,
  getProtectionQualities as getProtectionQualitiesTargeting,
  hasProtectionFromColor,
  isProtectedFromSource as isProtectedFromSourceTargeting,
} from "../targeting-validation";
import type { CardInstance, ScryfallCard } from "../types";

function makeCard(
  overrides: Partial<ScryfallCard> & { id: string; name?: string },
): CardInstance {
  const data = {
    id: `mock-${overrides.id}`,
    name: overrides.name ?? "Test Creature",
    type_line: overrides.type_line ?? "Creature — Shapeshifter",
    oracle_text: overrides.oracle_text ?? "",
    mana_cost: overrides.mana_cost ?? "{2}",
    cmc: overrides.cmc ?? 2,
    colors: overrides.colors ?? [],
    color_identity: overrides.color_identity ?? [],
    keywords: overrides.keywords ?? [],
    power: overrides.power ?? "2",
    toughness: overrides.toughness ?? "2",
    legalities: { standard: "legal" },
    layout: "normal",
  } as ScryfallCard;
  return createCardInstance(
    data,
    "player-a" as CardInstance["controllerId"],
    "player-a" as CardInstance["controllerId"],
  );
}

describe("Lane 71 piece 1/N (follow-up 22) — protection-from static enforcement consult", () => {
  describe("targeting-validation.hasProtectionFromColor consults per-instance protectionFrom", () => {
    it("returns true when the per-instance ledger matches the queried color (the static-stamped consult)", () => {
      // The lane 71 substrate stamps the field via
      // `refreshScriptedStatics`. Pre-piece 1/N, this
      // consult only saw the oracle-text regex and would
      // miss the static-stamped field. v1 consults the
      // ledger first.
      const card = makeCard({ id: "target-with-ledger" });
      const stamped = { ...card, protectionFrom: ["red"] };
      expect(hasProtectionFromColor(stamped, "red")).toBe(true);
    });

    it("returns false for a non-matching ledger entry (the cross-color isolation)", () => {
      const card = makeCard({ id: "target-ledger-blue" });
      const stamped = { ...card, protectionFrom: ["blue"] };
      // Ledger says blue; consult asks for red. False.
      expect(hasProtectionFromColor(stamped, "red")).toBe(false);
    });

    it("returns false when the ledger is unset (regression guard for cards without static-grant protection)", () => {
      // A vanilla creature with NO protection keywords and
      // NO static grant must NOT be protected. The new
      // consult must NOT silently widen the substrate.
      const card = makeCard({ id: "vanilla-no-protection" });
      expect(card.protectionFrom).toBeUndefined();
      expect(hasProtectionFromColor(card, "red")).toBe(false);
    });

    it("falls back to the oracle-text regex when the ledger is empty (printed protection still resolves)", () => {
      // A card with a printed "protection from red" oracle
      // tag and NO static-stamped ledger must still resolve
      // via the legacy oracle-text regex path. This is the
      // regression guard for the lane 71 fallback.
      const card = makeCard({
        id: "printed-protection",
        oracle_text: "protection from red",
      });
      expect(hasProtectionFromColor(card, "red")).toBe(true);
    });
  });

  describe("targeting-validation.getProtectionQualities union includes the per-instance ledger", () => {
    it("returns the per-instance ledger when it has entries (the static-stamped source wins)", () => {
      const card = makeCard({ id: "ledger-source" });
      const stamped = { ...card, protectionFrom: ["red", "blue"] };
      const got = getProtectionQualities(stamped);
      expect(got).toEqual(["red", "blue"]);
    });

    it("falls through to the strict parsed-keyword path when the ledger is empty", () => {
      const card = makeCard({
        id: "parsed-keyword-source",
        keywords: ["protection from green"],
      });
      const got = getProtectionQualities(card);
      expect(got).toContain("green");
    });

    it("falls through to the oracle-text regex when both ledger and parsed-keywords are empty", () => {
      const card = makeCard({
        id: "oracle-text-source",
        oracle_text: "protection from black",
      });
      const got = getProtectionQualities(card);
      expect(got).toContain("black");
    });
  });

  describe("end-to-end — canBeTargetedBy / isProtectedFromSource honor static-stamped protection", () => {
    it("canTargetCard returns protection-blocked when the target has a static-stamped protectionFrom ledger", () => {
      // The full targeting-validation path: a red source
      // attempting to target a creature whose
      // `protectionFrom: ["red"]` ledger was stamped by
      // `refreshScriptedStatics` from a "Creatures you
      // control have protection from red" anthem. The
      // targeting is BLOCKED because the ledger is honored
      // by `hasProtectionFromColor` (which is what
      // `isProtectedFromSource` delegates through
      // `getProtectionQualities`).
      const target = makeCard({ id: "protected-target" });
      const stamped = { ...target, protectionFrom: ["red"] };
      const source = makeCard({
        id: "red-source",
        name: "Red Lightning",
        colors: ["R"],
        color_identity: ["R"],
      });
      const result = canTargetCard(stamped, source, "player-a" as CardInstance["controllerId"]);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("protection");
    });

    it("isProtectedFromSource returns true when the target has a static-stamped protectionFrom ledger matching the source's color", () => {
      // Direct consult check: a red source vs a target
      // whose ledger says `["red"]`. v1 returns true via
      // the `getProtectionQualities` consult cascading
      // through `hasProtectionFromColor`.
      const target = makeCard({ id: "protected-target-direct" });
      const stamped = { ...target, protectionFrom: ["red"] };
      const source = makeCard({
        id: "red-source-direct",
        name: "Red Bolt",
        colors: ["R"],
        color_identity: ["R"],
      });
      expect(isProtectedFromSource(stamped, source)).toBe(true);
    });

    it("isProtectedFromSource returns false when the source's color is not in the target's ledger (cross-color isolation)", () => {
      // The same red source vs a target whose ledger says
      // `["blue"]` — the protection only blocks RED sources,
      // not blue ones. Cross-color isolation.
      const target = makeCard({ id: "protected-blue-only" });
      const stamped = { ...target, protectionFrom: ["blue"] };
      const source = makeCard({
        id: "red-source-vs-blue",
        name: "Red Bolt vs Blue",
        colors: ["R"],
        color_identity: ["R"],
      });
      expect(isProtectedFromSource(stamped, source)).toBe(false);
    });
  });

  // ---- Wave 4.8 follow-up 23 lane 71 piece 2/N ----
  // The evergreen-keywords consult path is the symmetric
  // enforcement surface for CR 702.16's targeting-block,
  // enchant-block, equip-block, and damage-prevention
  // clauses (the targeting-validation path was already
  // fixed in piece 1/N). Before piece 2/N
  // `getProtectionQualities` in evergreen-keywords
  // consulted only the oracle-text regex, so a creature
  // granted protection via a static was stamped with
  // `protectionFrom` but was NOT actually blocked at the
  // enchant, equip, or damage surfaces. Piece 2/N widens
  // `getProtectionQualities` to consult the ledger first,
  // matching the targeting-validation fix shape.
  describe("piece 2/N — evergreen-keywords.getProtectionQualities consults the per-instance ledger", () => {
    it("returns the per-instance ledger contents when present (the static-stamped consult)", () => {
      // Pre-piece-2/N: this consult fell through to the
      // oracle-text regex (empty oracle_text → empty
      // qualities). v1 consults the ledger first and
      // returns the stamped qualities verbatim.
      const card = makeCard({ id: "evergreen-ledger-direct" });
      const stamped = { ...card, protectionFrom: ["red", "blue"] };
      expect(getProtectionQualities(stamped)).toEqual(["red", "blue"]);
    });

    it("falls through to the oracle-text regex when the ledger is unset (printed-protection regression guard)", () => {
      // Regression guard: a card whose printed
      // `cardData.keywords` carries a `protection from X`
      // tag (lane 76 substrate) must still resolve via
      // the strict + oracle-text path when no
      // `protectionFrom` ledger is stamped. v1 doesn't
      // break lane 76's substrate.
      const card = makeCard({
        id: "evergreen-printed-only",
        keywords: ["protection from red"],
      });
      expect(getProtectionQualities(card)).toContain("red");
    });
  });

  describe("piece 2/N — canBeEnchantedBy / canBeEquippedBy / shouldPreventDamageToTarget honor the ledger", () => {
    // Each test exercises a CR 702.16 consult delegate
    // through the evergreen-keywords.isProtectedFromSource
    // path. Pre-piece-2/N these consults went through the
    // oracle-text-regex-only `getProtectionQualities` and
    // missed the ledger — so a creature granted protection
    // via a static was stamped but NOT actually blocked.
    function redSource(): CardInstance {
      return makeCard({
        id: "red-source-evergreen",
        name: "Red Bolt Evergreen",
        colors: ["R"],
        color_identity: ["R"],
      });
    }

    it("canBeTargetedBySource returns false when the target's per-instance ledger matches the source's color", () => {
      // CR 702.16a — protection prevents targeting.
      const stamped = {
        ...makeCard({ id: "led-blocked-target-evergreen" }),
        protectionFrom: ["red"],
      };
      expect(canBeTargetedBySource(stamped, redSource())).toBe(false);
    });

    it("canBeEnchantedBy returns false when the source is an aura and the target's ledger matches the source's color", () => {
      // CR 702.16b — protection prevents enchanting.
      const aura = makeCard({
        id: "led-blocked-aura-source",
        type_line: "Enchantment — Aura",
        colors: ["R"],
        color_identity: ["R"],
      });
      const stamped = {
        ...makeCard({ id: "led-blocked-enchant-target-evergreen" }),
        protectionFrom: ["red"],
      };
      expect(canBeEnchantedBy(stamped, aura)).toBe(false);
    });

    it("shouldPreventDamageToTarget returns true when the dealer's color is in the target's ledger", () => {
      // CR 702.16c — protection prevents damage.
      const stamped = {
        ...makeCard({ id: "led-damage-target-evergreen" }),
        protectionFrom: ["red"],
      };
      expect(shouldPreventDamageToTarget(stamped, redSource())).toBe(true);
    });
  });
});