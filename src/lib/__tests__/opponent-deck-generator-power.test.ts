/**
 * @fileOverview Tests for difficulty-scaled deck POWER (issue #992)
 *
 * The deck generator must produce measurably stronger decks as difficulty
 * rises: an "expert" opponent fields tighter, higher-quality decks than an
 * "easy" one. These tests lock in:
 *   - the deterministic card-strength score and deck-power metric
 *   - monotonic per-difficulty scaling (easy < medium < hard < expert)
 *   - legality preserved at every difficulty
 *   - composition with the sideboard work (#995) and per-format config (#1069)
 */

import {
  generateOpponentDeck,
  cardStrength,
  evaluateDeckPower,
  DIFFICULTY_POWER_TIERS,
  getDifficultyConfig,
  classifyCardRole,
} from "../opponent-deck-generator";
import type { DeckArchetype, DifficultyLevel } from "../opponent-deck-generator";
import { formatRules } from "../game-rules";

const DIFFICULTIES: DifficultyLevel[] = ["easy", "medium", "hard", "expert"];

/** Lands follow their own construction rules (basics are unlimited; the
 * generator stacks non-basic duals in Commander for mana smoothing). The #992
 * power work only touches NON-land slots, so copy-limit checks scope there. We
 * reuse the source's canonical role classifier so every dual land is recognised
 * (e.g. "City of Brass", "Reflecting Pool" have no "land" in their name). The
 * generator's "Unknown Spell" is a pre-existing emergency size-filler (not a
 * real card, unrelated to #992) and is likewise excluded from copy checks. */
function isRealCard(name: string): boolean {
  if (name === "Unknown Spell") return false;
  return classifyCardRole(name) !== "lands";
}

function totalCards(deck: {
  cards: Array<{ quantity: number }>;
}): number {
  return deck.cards.reduce((s, c) => s + c.quantity, 0);
}

function mean(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

describe("Issue #992 — difficulty-scaled deck power", () => {
  describe("card-strength score", () => {
    test("is deterministic for the same input", () => {
      expect(cardStrength("Lightning Bolt", "R_burn")).toBe(
        cardStrength("Lightning Bolt", "R_burn"),
      );
      expect(cardStrength("Healing Salve")).toBe(cardStrength("Healing Salve"));
    });

    test("is bounded in [0,1]", () => {
      for (const name of [
        "Lightning Bolt",
        "Healing Salve",
        "Counterspell",
        "Swords to Plowshares",
        "Unknown Spell",
      ]) {
        const s = cardStrength(name);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(1);
      }
    });

    test("premium interaction ranks above narrow lifegain", () => {
      // category-aware: removal/kill/draw tiers > lifegain tier
      expect(cardStrength("X", "W_removal")).toBeGreaterThan(
        cardStrength("X", "W_lifegain"),
      );
      expect(cardStrength("X", "B_kill")).toBeGreaterThan(
        cardStrength("X", "W_lifegain"),
      );
      expect(cardStrength("X", "U_draw")).toBeGreaterThan(
        cardStrength("X", "W_lifegain"),
      );
    });
  });

  describe("DIFFICULTY_POWER_TIERS are monotonic in skill", () => {
    test("curve tightens as difficulty rises (easy clunky, expert lean)", () => {
      const t = DIFFICULTIES.map((d) => DIFFICULTY_POWER_TIERS[d].curveTightness);
      for (let i = 0; i < t.length - 1; i++) {
        expect(t[i]).toBeGreaterThan(t[i + 1]);
      }
    });

    test("filler fraction shrinks as difficulty rises (expert = none)", () => {
      const f = DIFFICULTIES.map((d) => DIFFICULTY_POWER_TIERS[d].fillerFraction);
      for (let i = 0; i < f.length - 1; i++) {
        expect(f[i]).toBeGreaterThan(f[i + 1]);
      }
      expect(DIFFICULTY_POWER_TIERS.expert.fillerFraction).toBe(0);
    });

    test("land quality and commander land count rise with difficulty", () => {
      const q = DIFFICULTIES.map((d) => DIFFICULTY_POWER_TIERS[d].landQuality);
      const l = DIFFICULTIES.map(
        (d) => DIFFICULTY_POWER_TIERS[d].commanderLandDelta,
      );
      for (let i = 0; i < q.length - 1; i++) {
        expect(q[i]).toBeLessThanOrEqual(q[i + 1]);
        expect(l[i]).toBeLessThan(l[i + 1]);
      }
    });

    test("easy prefers weak picks; medium+ prefer strong picks", () => {
      expect(DIFFICULTY_POWER_TIERS.easy.preferStrong).toBe(false);
      for (const d of ["medium", "hard", "expert"] as DifficultyLevel[]) {
        expect(DIFFICULTY_POWER_TIERS[d].preferStrong).toBe(true);
      }
    });
  });

  describe("evaluateDeckPower metric", () => {
    test("is deterministic for a given card list", () => {
      const cards = [
        { name: "Lightning Bolt", quantity: 4 },
        { name: "Swords to Plowshares", quantity: 4 },
        { name: "Healing Salve", quantity: 4 },
        { name: "Mountain", quantity: 12 },
      ];
      expect(evaluateDeckPower(cards)).toBe(evaluateDeckPower(cards));
    });

    test("a strong card pool outscores a weak one", () => {
      const strong = [
        { name: "Swords to Plowshares", quantity: 4 },
        { name: "Lightning Bolt", quantity: 4 },
        { name: "Counterspell", quantity: 4 },
      ];
      const weak = [
        { name: "Healing Salve", quantity: 4 },
        { name: "Rest for the Weary", quantity: 4 },
        { name: "One with Nothing", quantity: 4 },
      ];
      expect(evaluateDeckPower(strong)).toBeGreaterThan(evaluateDeckPower(weak));
    });

    test("ignores lands (mana is not power)", () => {
      const spells = [{ name: "Lightning Bolt", quantity: 4 }];
      const withLands = [
        { name: "Lightning Bolt", quantity: 4 },
        { name: "Mountain", quantity: 20 },
        { name: "Volcanic Island", quantity: 4 },
      ];
      expect(evaluateDeckPower(withLands)).toBe(evaluateDeckPower(spells));
    });
  });

  describe("generated deck power scales with difficulty", () => {
    // Many samples are averaged because card selection is randomised; the
    // difficulty strength-bias is strong and deterministic, so the *mean*
    // power is monotonically ordered and stable.
    const SAMPLES = 40;
    const archetype: DeckArchetype = "midrange";
    const colorIdentity = ["U", "W"];

    function samplePower(difficulty: DifficultyLevel, format: string): number {
      const scores: number[] = [];
      for (let i = 0; i < SAMPLES; i++) {
        const deck = generateOpponentDeck({
          format: format as never,
          archetype,
          colorIdentity,
          difficulty,
        });
        scores.push(evaluateDeckPower(deck.cards));
      }
      return mean(scores);
    }

    test("expert deck is measurably stronger than easy deck (Commander)", () => {
      const easy = samplePower("easy", "legendary-commander");
      const expert = samplePower("expert", "legendary-commander");
      // Strong, non-flaky separation.
      expect(expert - easy).toBeGreaterThanOrEqual(3);
      expect(expert).toBeGreaterThan(easy);
    });

    test("power is monotonic across all four tiers (Commander)", () => {
      const powers = DIFFICULTIES.map((d) =>
        samplePower(d, "legendary-commander"),
      );
      for (let i = 0; i < powers.length - 1; i++) {
        expect(powers[i]).toBeLessThan(powers[i + 1]);
      }
    });

    test("scaling also holds for a constructed (60-card) format", () => {
      const easy = samplePower("easy", "constructed-core");
      const expert = samplePower("expert", "constructed-core");
      expect(expert).toBeGreaterThan(easy);
    });
  });

  describe("legality is preserved at every difficulty", () => {
    const formats = ["legendary-commander", "constructed-core"] as const;

    test.each(formats)("exact maindeck size for %s", (format) => {
      for (const difficulty of DIFFICULTIES) {
        const deck = generateOpponentDeck({
          format,
          archetype: "midrange",
          colorIdentity: ["R", "W"],
          difficulty,
        });
        expect(totalCards(deck)).toBe(formatRules[format].minCards);
      }
    });

    test.each(formats)("no real card exceeds its copy limit (%s)", (format) => {
      const maxCopies = formatRules[format].maxCopies;
      for (const difficulty of DIFFICULTIES) {
        const deck = generateOpponentDeck({
          format,
          archetype: "midrange",
          colorIdentity: ["W", "U", "B"],
          difficulty,
        });
        for (const card of deck.cards) {
          if (!isRealCard(card.name)) continue; // skip lands + emergency filler
          expect(card.quantity).toBeLessThanOrEqual(maxCopies);
        }
      }
    });

    test("Commander real cards stay singleton", () => {
      for (const difficulty of DIFFICULTIES) {
        const deck = generateOpponentDeck({
          format: "legendary-commander",
          archetype: "midrange",
          colorIdentity: ["W", "U", "B"],
          difficulty,
        });
        for (const card of deck.cards) {
          if (!isRealCard(card.name)) continue; // skip lands + emergency filler
          expect(card.quantity).toBe(1);
        }
      }
    });
  });

  describe("composition with sideboard (#995) and per-format config (#1069)", () => {
    test("constructed decks still produce a legal sideboard at every difficulty", () => {
      const max = formatRules["constructed-core"].sideboardSize;
      for (const difficulty of DIFFICULTIES) {
        const deck = generateOpponentDeck({
          format: "constructed-core",
          archetype: "midrange",
          colorIdentity: ["U", "B"],
          difficulty,
        });
        const sb = deck.sideboard ?? [];
        expect(sb.length).toBeGreaterThan(0);
        const sbTotal = sb.reduce((s, c) => s + c.quantity, 0);
        expect(sbTotal).toBeLessThanOrEqual(max);
        // no sideboard card duplicates a maindeck card
        const main = new Set(deck.cards.map((c) => c.name));
        for (const c of sb) expect(main.has(c.name)).toBe(false);
      }
    });

    test("commander decks remain sideboard-free (format-aware)", () => {
      const deck = generateOpponentDeck({
        format: "legendary-commander",
        archetype: "aggro",
        difficulty: "expert",
      });
      expect((deck.sideboard ?? []).length).toBe(0);
    });

    test("expert sideboard is at least as full as easy sideboard", () => {
      const easy = generateOpponentDeck({
        format: "constructed-core",
        archetype: "midrange",
        colorIdentity: ["R", "W"],
        difficulty: "easy",
      });
      const expert = generateOpponentDeck({
        format: "constructed-core",
        archetype: "midrange",
        colorIdentity: ["R", "W"],
        difficulty: "expert",
      });
      const easyTotal = (easy.sideboard ?? []).reduce(
        (s, c) => s + c.quantity,
        0,
      );
      const expertTotal = (expert.sideboard ?? []).reduce(
        (s, c) => s + c.quantity,
        0,
      );
      expect(expertTotal).toBeGreaterThanOrEqual(easyTotal);
    });

    test("getDifficultyConfig still resolves every tier (unified taxonomy)", () => {
      for (const difficulty of DIFFICULTIES) {
        expect(getDifficultyConfig(difficulty)).toBeDefined();
      }
    });
  });
});
