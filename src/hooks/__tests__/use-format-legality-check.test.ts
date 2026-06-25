/**
 * Tests for useFormatLegalityCheck hook and its pure helpers.
 *
 * Covers issue #999 acceptance criteria:
 *  - Banned card is flagged illegal
 *  - Commander card in a Standard deck is flagged illegal (not_legal)
 *  - Deck summary reports the legal/illegal split correctly
 */

import { renderHook } from "@testing-library/react";
import {
  useFormatLegalityCheck,
  normaliseLegality,
  describeLegality,
  checkCardLegality,
} from "../use-format-legality-check";
import type { DeckCard } from "@/app/actions";

/**
 * Build a minimal DeckCard with only the fields the legality logic reads.
 * Keeps the tests focused on legality rather than full Scryfall data.
 */
function makeCard(
  id: string,
  name: string,
  legalities: Record<string, string>,
  count = 1,
): DeckCard {
  return {
    id,
    name,
    cmc: 0,
    type_line: "",
    colors: [],
    color_identity: [],
    legalities,
    count,
  } as unknown as DeckCard;
}

describe("normaliseLegality", () => {
  it("maps 'legal' to legal", () => {
    expect(normaliseLegality("legal")).toBe("legal");
  });

  it("maps 'restricted' to restricted", () => {
    expect(normaliseLegality("restricted")).toBe("restricted");
  });

  it("maps 'banned' to banned", () => {
    expect(normaliseLegality("banned")).toBe("banned");
  });

  it("maps 'not_legal' to not_legal", () => {
    expect(normaliseLegality("not_legal")).toBe("not_legal");
  });

  it("treats undefined as not_legal (fail-safe)", () => {
    expect(normaliseLegality(undefined)).toBe("not_legal");
  });

  it("treats unknown strings as not_legal", () => {
    expect(normaliseLegality("future")).toBe("not_legal");
  });
});

describe("describeLegality", () => {
  it("mentions the card name and format", () => {
    const msg = describeLegality("banned", "Sol Ring", "Commander");
    expect(msg).toContain("Sol Ring");
    expect(msg).toContain("Commander");
    expect(msg).toContain("banned");
  });

  it("explains restricted limit", () => {
    const msg = describeLegality("restricted", "Brainstorm", "Vintage");
    expect(msg).toContain("restricted");
    expect(msg).toContain("1 copy");
  });
});

describe("checkCardLegality", () => {
  it("marks a legal card as not illegal", () => {
    const result = checkCardLegality(
      { id: "1", name: "Lightning Bolt", legalities: { modern: "legal" } },
      "modern",
    );
    expect(result.status).toBe("legal");
    expect(result.isIllegal).toBe(false);
  });

  it("marks a banned card as illegal", () => {
    const result = checkCardLegality(
      { id: "2", name: "Black Lotus", legalities: { legacy: "banned" } },
      "legacy",
    );
    expect(result.status).toBe("banned");
    expect(result.isIllegal).toBe(true);
  });

  it("marks a Commander-only card as illegal in Standard (not_legal)", () => {
    const result = checkCardLegality(
      {
        id: "3",
        name: "Sol Ring",
        legalities: { commander: "legal", standard: "not_legal" },
      },
      "standard",
    );
    expect(result.status).toBe("not_legal");
    expect(result.isIllegal).toBe(true);
  });

  it("treats restricted as legal (allowed with copy cap)", () => {
    const result = checkCardLegality(
      { id: "4", name: "Black Lotus", legalities: { vintage: "restricted" } },
      "vintage",
    );
    expect(result.status).toBe("restricted");
    expect(result.isIllegal).toBe(false);
  });

  it("missing legality data is treated as not_legal", () => {
    const result = checkCardLegality(
      { id: "5", name: "Mystery Card", legalities: {} },
      "standard",
    );
    expect(result.status).toBe("not_legal");
    expect(result.isIllegal).toBe(true);
  });
});

describe("useFormatLegalityCheck", () => {
  it("returns an empty summary for an empty deck", () => {
    const { result } = renderHook(() =>
      useFormatLegalityCheck([], "commander"),
    );
    expect(result.current.legalCardCount).toBe(0);
    expect(result.current.illegalCardCount).toBe(0);
    expect(result.current.isDeckLegal).toBe(true);
    expect(result.current.cards.size).toBe(0);
  });

  it("counts a fully legal deck as legal", () => {
    const deck: DeckCard[] = [
      makeCard("1", "Lightning Bolt", { modern: "legal" }, 4),
      makeCard("2", "Mountain", { modern: "legal" }, 20),
    ];
    const { result } = renderHook(() =>
      useFormatLegalityCheck(deck, "modern"),
    );
    expect(result.current.legalCardCount).toBe(24);
    expect(result.current.illegalCardCount).toBe(0);
    expect(result.current.isDeckLegal).toBe(true);
    expect(result.current.bannedCardNames).toEqual([]);
  });

  it("flags a banned card and splits the counts", () => {
    // Issue acceptance: Adding a Banned card to a deck shows immediate warning.
    const deck: DeckCard[] = [
      makeCard("1", "Lightning Bolt", { legacy: "legal" }, 4),
      makeCard("2", "Black Lotus", { legacy: "banned" }, 1),
    ];
    const { result } = renderHook(() => useFormatLegalityCheck(deck, "legacy"));
    expect(result.current.legalCardCount).toBe(4);
    expect(result.current.illegalCardCount).toBe(1);
    expect(result.current.isDeckLegal).toBe(false);
    expect(result.current.bannedCardNames).toEqual(["Black Lotus"]);
    expect(result.current.illegalCardNames).toEqual(["Black Lotus"]);

    const lotus = result.current.cards.get("2");
    expect(lotus?.status).toBe("banned");
    expect(lotus?.isIllegal).toBe(true);
  });

  it("flags a Commander card added to a Standard deck (yellow warning)", () => {
    // Issue acceptance: Adding a Commander card to Standard deck shows yellow warning.
    const deck: DeckCard[] = [
      makeCard("1", "Sol Ring", { commander: "legal", standard: "not_legal" }),
    ];
    const { result } = renderHook(() =>
      useFormatLegalityCheck(deck, "standard"),
    );
    expect(result.current.illegalCardCount).toBe(1);
    expect(result.current.isDeckLegal).toBe(false);
    const solRing = result.current.cards.get("1");
    expect(solRing?.status).toBe("not_legal");
    // not_legal is the yellow-warning class, distinct from banned.
    expect(solRing?.status).not.toBe("banned");
    expect(result.current.bannedCardNames).toEqual([]);
  });

  it("recomputes when the format changes", () => {
    const deck: DeckCard[] = [
      makeCard("1", "Sol Ring", { commander: "legal", standard: "not_legal" }),
    ];
    const { result, rerender } = renderHook(
      ({ format }) => useFormatLegalityCheck(deck, format),
      { initialProps: { format: "commander" as string } },
    );
    expect(result.current.isDeckLegal).toBe(true);

    rerender({ format: "standard" });
    expect(result.current.isDeckLegal).toBe(false);
    expect(result.current.illegalCardCount).toBe(1);
  });

  it("summary reports 'X legal, Y illegal' as required by acceptance criteria", () => {
    // Acceptance: Deck stats panel shows 'X format-legal cards, Y illegal' summary.
    const deck: DeckCard[] = [
      makeCard("1", "Legal A", { modern: "legal" }, 3),
      makeCard("2", "Legal B", { modern: "legal" }, 2),
      makeCard("3", "Banned C", { modern: "banned" }, 1),
    ];
    const { result } = renderHook(() =>
      useFormatLegalityCheck(deck, "modern"),
    );
    // 5 legal, 1 illegal — matches the 'X legal, Y illegal' summary copy.
    expect(result.current.legalCardCount).toBe(5);
    expect(result.current.illegalCardCount).toBe(1);
  });
});
