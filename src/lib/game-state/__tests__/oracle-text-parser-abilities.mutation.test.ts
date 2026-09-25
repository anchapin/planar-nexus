/**
 * Targeted mutation suite for `src/lib/game-state/oracle-text-parser/abilities.ts` (#2186).
 *
 * Stryker mutates `abilities.ts` and these tests exist so each mutant can be
 * killed (or intentionally survived). Comprehensive parser coverage lives in
 * `src/lib/oracle-text-parser/__tests__/`.
 */
import { canGoOnStack } from "@/lib/game-state/oracle-text-parser/abilities";
import type { ScryfallCard } from "@/lib/game-state/types";

function makeCard(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: "test",
    name: "Test Card",
    type_line: "Creature",
    oracle_text: "",
    ...overrides,
  } as ScryfallCard;
}

describe("abilities — canGoOnStack", () => {
  it("returns true for instants", () => {
    expect(canGoOnStack(makeCard({ type_line: "Instant" }))).toBe(true);
  });

  it("returns true for sorceries", () => {
    expect(canGoOnStack(makeCard({ type_line: "Sorcery" }))).toBe(true);
  });

  it("returns true for cards with activated abilities (oracle text containing ':')", () => {
    expect(canGoOnStack(makeCard({ oracle_text: "{T}: Draw a card." }))).toBe(
      true,
    );
  });

  it("returns false for creatures without oracle text", () => {
    expect(
      canGoOnStack(makeCard({ type_line: "Creature", oracle_text: "" })),
    ).toBe(false);
  });
});
