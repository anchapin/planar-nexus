/**
 * @fileoverview Direct unit tests for the zone primitives (src/lib/game-state/zones.ts).
 *
 * Issue #1718 — zones.ts was live production code (re-exported through the
 * engine barrel, consumed by src/ai/ai-action-executor.ts) with no direct
 * test coverage; zone-transition semantics were only asserted indirectly
 * through scenario suites. These tests pin the primitive layer directly:
 *
 * - zone creation (per-player zone set, shared stack, defaults/options)
 * - card add/remove/move including position semantics (top/bottom/index)
 * - legal transitions for every representative zone pair, plus the
 *   commander / replace-destination override path (the destination zone is
 *   swapped by the caller — battlefield→command instead of →graveyard —
 *   per CR 903.9a-style replacement effects)
 * - edge behavior: empty zones, single-card zones, many-card zones, moving
 *   a card that is not in the source zone (documented no-validation
 *   semantics of the primitive layer)
 * - query helpers (top/bottom/contains/position/count), reorder, shuffle
 * - visibility model (revealed / owner / visibleTo)
 * - composite operations: draw, mill, exile
 *
 * The primitive layer performs NO legality validation — higher layers
 * (state-based-actions, replacement-effects, keyword-actions) gate which
 * transitions are legal. "Illegal" below therefore means the documented
 * behavior of the primitives when handed degenerate input.
 */

import { describe, it, expect } from "@jest/globals";
import {
  addCardToZone,
  canPlayerSeeZone,
  countCards,
  createPlayerZones,
  createSharedZones,
  createZone,
  drawCards,
  exileCards,
  getBottomCard,
  getCardPosition,
  getForetoldCardIds,
  getTopCard,
  getTopCards,
  hideZone,
  isForetoldCard,
  millCards,
  moveCardBetweenZones,
  removeCardFromZone,
  reorderCards,
  revealZone,
  setZoneVisibility,
  shuffleZone,
  zoneContainsCard,
} from "../zones";
import { ZoneType, getZoneKey } from "../types";
import type { CardInstance, CardInstanceId, PlayerId, Zone } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PLAYER_A: PlayerId = "player-a";
const PLAYER_B: PlayerId = "player-b";

function ids(...values: string[]): CardInstanceId[] {
  return values;
}

function zone(
  type: ZoneType,
  playerId: PlayerId | null,
  cardIds: CardInstanceId[],
  extra: Partial<Zone> = {},
): Zone {
  return {
    type,
    playerId,
    cardIds,
    isRevealed: false,
    visibleTo: [],
    ...extra,
  };
}

/** Battlefield→graveyard-style zone preloaded with a full ramp. */
function stockedZone(type: ZoneType, playerId: PlayerId | null): Zone {
  return zone(type, playerId, ids("c1", "c2", "c3"));
}

// ---------------------------------------------------------------------------
// createZone
// ---------------------------------------------------------------------------

describe("createZone", () => {
  it("applies defaults for a player-owned zone", () => {
    const z = createZone(ZoneType.HAND, PLAYER_A);
    expect(z.type).toBe(ZoneType.HAND);
    expect(z.playerId).toBe(PLAYER_A);
    expect(z.cardIds).toEqual([]);
    expect(z.isRevealed).toBe(false);
    expect(z.visibleTo).toEqual([]);
  });

  it("honors initialCards, isRevealed, and visibleTo options", () => {
    const z = createZone(ZoneType.GRAVEYARD, PLAYER_A, {
      initialCards: ids("g1", "g2"),
      isRevealed: true,
      visibleTo: [PLAYER_B],
    });
    expect(z.cardIds).toEqual(["g1", "g2"]);
    expect(z.isRevealed).toBe(true);
    expect(z.visibleTo).toEqual([PLAYER_B]);
  });

  it("supports shared zones with null playerId", () => {
    const z = createZone(ZoneType.STACK, null);
    expect(z.playerId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// createPlayerZones / createSharedZones
// ---------------------------------------------------------------------------

describe("createPlayerZones", () => {
  const library = ids("l1", "l2", "l3", "l4");
  const zones = createPlayerZones(PLAYER_A, library);

  it("creates one zone of each owned zone type under getZoneKey keys", () => {
    const expectedTypes = [
      ZoneType.LIBRARY,
      ZoneType.HAND,
      ZoneType.BATTLEFIELD,
      ZoneType.GRAVEYARD,
      ZoneType.EXILE,
      ZoneType.COMMAND,
      ZoneType.SIDEBOARD,
    ];
    expect(zones.size).toBe(expectedTypes.length);
    for (const type of expectedTypes) {
      const z = zones.get(getZoneKey(PLAYER_A, type));
      expect(z).toBeDefined();
      expect(z!.type).toBe(type);
      expect(z!.playerId).toBe(PLAYER_A);
    }
  });

  it("seeds the library with the provided cards and leaves other zones empty", () => {
    expect(zones.get(getZoneKey(PLAYER_A, ZoneType.LIBRARY))!.cardIds).toEqual(
      library,
    );
    for (const type of [
      ZoneType.HAND,
      ZoneType.BATTLEFIELD,
      ZoneType.GRAVEYARD,
      ZoneType.EXILE,
      ZoneType.COMMAND,
      ZoneType.SIDEBOARD,
    ]) {
      expect(zones.get(getZoneKey(PLAYER_A, type))!.cardIds).toEqual([]);
    }
  });

  it("marks battlefield/graveyard/exile/command as revealed and library/hand/sideboard as hidden", () => {
    for (const type of [
      ZoneType.BATTLEFIELD,
      ZoneType.GRAVEYARD,
      ZoneType.EXILE,
      ZoneType.COMMAND,
    ]) {
      expect(zones.get(getZoneKey(PLAYER_A, type))!.isRevealed).toBe(true);
    }
    for (const type of [ZoneType.LIBRARY, ZoneType.HAND, ZoneType.SIDEBOARD]) {
      expect(zones.get(getZoneKey(PLAYER_A, type))!.isRevealed).toBe(false);
    }
  });
});

describe("createSharedZones", () => {
  it("creates a single shared, revealed stack keyed by the bare zone type", () => {
    const zones = createSharedZones();
    expect(zones.size).toBe(1);
    const stack = zones.get(ZoneType.STACK);
    expect(stack).toBeDefined();
    expect(stack!.type).toBe(ZoneType.STACK);
    expect(stack!.playerId).toBeNull();
    expect(stack!.isRevealed).toBe(true);
    expect(stack!.cardIds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// addCardToZone — position semantics
// ---------------------------------------------------------------------------

describe("addCardToZone", () => {
  it("defaults to adding on top (end of cardIds)", () => {
    const z = addCardToZone(stockedZone(ZoneType.LIBRARY, PLAYER_A), "new");
    expect(z.cardIds).toEqual(["c1", "c2", "c3", "new"]);
  });

  it('adds on top for explicit "top"', () => {
    const z = addCardToZone(
      stockedZone(ZoneType.LIBRARY, PLAYER_A),
      "new",
      "top",
    );
    expect(z.cardIds).toEqual(["c1", "c2", "c3", "new"]);
  });

  it('adds on bottom for "bottom"', () => {
    const z = addCardToZone(
      stockedZone(ZoneType.LIBRARY, PLAYER_A),
      "new",
      "bottom",
    );
    expect(z.cardIds).toEqual(["new", "c1", "c2", "c3"]);
  });

  it("inserts at an explicit numeric index", () => {
    const base = stockedZone(ZoneType.LIBRARY, PLAYER_A);
    const z = addCardToZone(base, "new", 1);
    expect(z.cardIds).toEqual(["c1", "new", "c2", "c3"]);
    // index 0 behaves like bottom
    expect(addCardToZone(base, "new", 0).cardIds).toEqual([
      "new",
      "c1",
      "c2",
      "c3",
    ]);
  });

  it("adds to an empty zone and does not mutate the input zone", () => {
    const empty = zone(ZoneType.HAND, PLAYER_A, []);
    const z = addCardToZone(empty, "only");
    expect(z.cardIds).toEqual(["only"]);
    expect(empty.cardIds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// removeCardFromZone
// ---------------------------------------------------------------------------

describe("removeCardFromZone", () => {
  it("removes only the matching card id", () => {
    const z = removeCardFromZone(
      stockedZone(ZoneType.GRAVEYARD, PLAYER_A),
      "c2",
    );
    expect(z.cardIds).toEqual(["c1", "c3"]);
  });

  it("is a no-op when the card is absent (illegal removal)", () => {
    const z = removeCardFromZone(
      stockedZone(ZoneType.GRAVEYARD, PLAYER_A),
      "zz",
    );
    expect(z.cardIds).toEqual(["c1", "c2", "c3"]);
  });

  it("handles an empty zone", () => {
    const z = removeCardFromZone(zone(ZoneType.GRAVEYARD, PLAYER_A, []), "c1");
    expect(z.cardIds).toEqual([]);
  });

  it("does not mutate the input zone", () => {
    const base = stockedZone(ZoneType.GRAVEYARD, PLAYER_A);
    removeCardFromZone(base, "c1");
    expect(base.cardIds).toEqual(["c1", "c2", "c3"]);
  });
});

// ---------------------------------------------------------------------------
// moveCardBetweenZones — legal transitions for representative zone pairs
// ---------------------------------------------------------------------------

describe("moveCardBetweenZones legal transitions", () => {
  // Representative legal MTG zone transitions (from → to). The primitive
  // itself accepts any pair; this table pins the transitions the rules
  // engine actually drives through it.
  const legalTransitions: Array<[ZoneType, ZoneType, string]> = [
    [ZoneType.LIBRARY, ZoneType.HAND, "draw"],
    [ZoneType.HAND, ZoneType.STACK, "cast"],
    [ZoneType.HAND, ZoneType.BATTLEFIELD, "play land / resolved permanent"],
    [ZoneType.HAND, ZoneType.GRAVEYARD, "discard"],
    [ZoneType.STACK, ZoneType.BATTLEFIELD, "resolve"],
    [ZoneType.STACK, ZoneType.GRAVEYARD, "counter"],
    [ZoneType.BATTLEFIELD, ZoneType.GRAVEYARD, "die / destroy"],
    [ZoneType.BATTLEFIELD, ZoneType.EXILE, "exile vs destroy"],
    [ZoneType.BATTLEFIELD, ZoneType.HAND, "bounce"],
    [ZoneType.BATTLEFIELD, ZoneType.LIBRARY, "put on/in library"],
    [ZoneType.BATTLEFIELD, ZoneType.COMMAND, "commander replacement"],
    [ZoneType.GRAVEYARD, ZoneType.BATTLEFIELD, "reanimate"],
    [ZoneType.GRAVEYARD, ZoneType.HAND, "regrow"],
    [ZoneType.GRAVEYARD, ZoneType.EXILE, "exile from graveyard"],
    [ZoneType.GRAVEYARD, ZoneType.LIBRARY, "shuffle back"],
    [ZoneType.GRAVEYARD, ZoneType.COMMAND, "commander replacement"],
    [ZoneType.LIBRARY, ZoneType.GRAVEYARD, "mill"],
    [ZoneType.LIBRARY, ZoneType.EXILE, "exile from library"],
    [ZoneType.EXILE, ZoneType.BATTLEFIELD, "return from exile"],
    [ZoneType.EXILE, ZoneType.GRAVEYARD, "exile → graveyard"],
    [ZoneType.EXILE, ZoneType.COMMAND, "commander replacement"],
    [ZoneType.COMMAND, ZoneType.BATTLEFIELD, "cast commander"],
  ];

  it.each(legalTransitions)(
    "%s → %s (%s) moves the card and preserves the rest",
    (from, to) => {
      const fromZone = stockedZone(from, PLAYER_A);
      const toZone = zone(to, PLAYER_A, ["t1"]);
      const result = moveCardBetweenZones(fromZone, toZone, "c2");

      expect(result.from.cardIds).toEqual(["c1", "c3"]);
      expect(result.to.cardIds).toEqual(["t1", "c2"]);
      // inputs untouched
      expect(fromZone.cardIds).toEqual(["c1", "c2", "c3"]);
      expect(toZone.cardIds).toEqual(["t1"]);
    },
  );

  it("moves into an empty destination zone (empty/single-card case)", () => {
    const result = moveCardBetweenZones(
      zone(ZoneType.BATTLEFIELD, PLAYER_A, ["only"]),
      zone(ZoneType.GRAVEYARD, PLAYER_A, []),
      "only",
    );
    expect(result.from.cardIds).toEqual([]);
    expect(result.to.cardIds).toEqual(["only"]);
  });

  it("supports position overrides on the destination (top/bottom/index)", () => {
    const from = stockedZone(ZoneType.BATTLEFIELD, PLAYER_A);
    const to = zone(ZoneType.LIBRARY, PLAYER_A, ["t1", "t2"]);

    expect(moveCardBetweenZones(from, to, "c1", "top").to.cardIds).toEqual([
      "t1",
      "t2",
      "c1",
    ]);
    expect(moveCardBetweenZones(from, to, "c1", "bottom").to.cardIds).toEqual([
      "c1",
      "t1",
      "t2",
    ]);
    expect(moveCardBetweenZones(from, to, "c1", 1).to.cardIds).toEqual([
      "t1",
      "c1",
      "t2",
    ]);
  });
});

describe("moveCardBetweenZones degenerate inputs (documented semantics)", () => {
  it("still appends to the destination when the card is NOT in the source zone", () => {
    // The primitive layer does not validate membership: removeCardFromZone
    // filters (no-op) and addCardToZone appends regardless. Higher layers
    // gate legality; this pins the primitive's actual behavior.
    const fromZone = stockedZone(ZoneType.BATTLEFIELD, PLAYER_A);
    const toZone = zone(ZoneType.GRAVEYARD, PLAYER_A, ["t1"]);
    const result = moveCardBetweenZones(fromZone, toZone, "ghost", "top");

    expect(result.from.cardIds).toEqual(["c1", "c2", "c3"]);
    expect(result.to.cardIds).toEqual(["t1", "ghost"]);
  });

  it("moving from an empty zone appends to the destination and leaves the source empty", () => {
    const result = moveCardBetweenZones(
      zone(ZoneType.LIBRARY, PLAYER_A, []),
      zone(ZoneType.HAND, PLAYER_A, []),
      "c1",
    );
    expect(result.from.cardIds).toEqual([]);
    expect(result.to.cardIds).toEqual(["c1"]);
  });
});

// ---------------------------------------------------------------------------
// Commander / replace-destination override semantics
// ---------------------------------------------------------------------------

describe("commander replace-destination overrides", () => {
  // CR 903.9a-style replacement: a commander that would be put into the
  // graveyard or exile from anywhere may be put into the command zone
  // instead. The primitive implements this by the caller swapping the
  // destination zone object; the move itself is identical.
  const deathSources: Array<[ZoneType, string]> = [
    [ZoneType.BATTLEFIELD, "dies"],
    [ZoneType.GRAVEYARD, "graveyard → exile"],
    [ZoneType.EXILE, "exile-bound"],
  ];

  it.each(deathSources)(
    "%s commander may be routed to the command zone instead (%s)",
    (sourceType) => {
      const commandZone = zone(ZoneType.COMMAND, PLAYER_A, []);
      const graveyard = zone(ZoneType.GRAVEYARD, PLAYER_A, ["g1"]);
      const source = zone(sourceType, PLAYER_A, ["cmd", "other"]);

      // Default destination: graveyard gets the card.
      const defaultDest = moveCardBetweenZones(source, graveyard, "cmd");
      expect(defaultDest.to.type).toBe(ZoneType.GRAVEYARD);
      expect(defaultDest.to.cardIds).toEqual(["g1", "cmd"]);

      // Replacement destination override: command zone gets the card,
      // graveyard untouched.
      const replaced = moveCardBetweenZones(source, commandZone, "cmd");
      expect(replaced.to.type).toBe(ZoneType.COMMAND);
      expect(replaced.to.cardIds).toEqual(["cmd"]);
      expect(replaced.from.cardIds).toEqual(["other"]);
      expect(graveyard.cardIds).toEqual(["g1"]);
    },
  );

  it("supports choosing top vs bottom of the command zone on re-entry", () => {
    const commandZone = zone(ZoneType.COMMAND, PLAYER_A, ["cmd-first"]);
    const source = zone(ZoneType.BATTLEFIELD, PLAYER_A, ["cmd-second"]);

    expect(
      moveCardBetweenZones(source, commandZone, "cmd-second", "top").to.cardIds,
    ).toEqual(["cmd-first", "cmd-second"]);
    expect(
      moveCardBetweenZones(source, commandZone, "cmd-second", "bottom").to
        .cardIds,
    ).toEqual(["cmd-second", "cmd-first"]);
  });
});

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

describe("getTopCard / getBottomCard", () => {
  it("return null for an empty zone", () => {
    const empty = zone(ZoneType.LIBRARY, PLAYER_A, []);
    expect(getTopCard(empty)).toBeNull();
    expect(getBottomCard(empty)).toBeNull();
  });

  it("return the same card for a single-card zone", () => {
    const single = zone(ZoneType.LIBRARY, PLAYER_A, ["only"]);
    expect(getTopCard(single)).toBe("only");
    expect(getBottomCard(single)).toBe("only");
  });

  it("return last/first card for a many-card zone", () => {
    const many = stockedZone(ZoneType.LIBRARY, PLAYER_A);
    expect(getTopCard(many)).toBe("c3");
    expect(getBottomCard(many)).toBe("c1");
  });
});

describe("getTopCards", () => {
  const many = stockedZone(ZoneType.LIBRARY, PLAYER_A);

  it("returns [] for non-positive counts", () => {
    expect(getTopCards(many, 0)).toEqual([]);
    expect(getTopCards(many, -2)).toEqual([]);
  });

  it("returns the top N cards in bottom-to-top order", () => {
    expect(getTopCards(many, 2)).toEqual(["c2", "c3"]);
  });

  it("returns every card when count exceeds the zone size", () => {
    expect(getTopCards(many, 99)).toEqual(["c1", "c2", "c3"]);
    expect(getTopCards(zone(ZoneType.LIBRARY, PLAYER_A, []), 3)).toEqual([]);
  });
});

describe("countCards / zoneContainsCard / getCardPosition", () => {
  const many = stockedZone(ZoneType.HAND, PLAYER_A);

  it("counts cards (empty / single / many)", () => {
    expect(countCards(zone(ZoneType.HAND, PLAYER_A, []))).toBe(0);
    expect(countCards(zone(ZoneType.HAND, PLAYER_A, ["a"]))).toBe(1);
    expect(countCards(many)).toBe(3);
  });

  it("reports containment", () => {
    expect(zoneContainsCard(many, "c2")).toBe(true);
    expect(zoneContainsCard(many, "zz")).toBe(false);
    expect(zoneContainsCard(zone(ZoneType.HAND, PLAYER_A, []), "c1")).toBe(
      false,
    );
  });

  it("reports position (-1 when absent)", () => {
    expect(getCardPosition(many, "c1")).toBe(0);
    expect(getCardPosition(many, "c3")).toBe(2);
    expect(getCardPosition(many, "zz")).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// reorderCards
// ---------------------------------------------------------------------------

describe("reorderCards", () => {
  it("reorders the zone to the requested order", () => {
    const z = reorderCards(stockedZone(ZoneType.LIBRARY, PLAYER_A), [
      "c3",
      "c1",
      "c2",
    ]);
    expect(z.cardIds).toEqual(["c3", "c1", "c2"]);
  });

  it("drops ids that are not in the zone (invalid reorder input)", () => {
    const z = reorderCards(stockedZone(ZoneType.LIBRARY, PLAYER_A), [
      "c2",
      "ghost",
      "c3",
    ]);
    expect(z.cardIds).toEqual(["c2", "c3"]);
  });

  it("shrinks to the intersection when the new order omits cards", () => {
    const z = reorderCards(stockedZone(ZoneType.LIBRARY, PLAYER_A), ["c1"]);
    expect(z.cardIds).toEqual(["c1"]);
  });

  it("does not mutate the input zone", () => {
    const base = stockedZone(ZoneType.LIBRARY, PLAYER_A);
    reorderCards(base, ["c3", "c2", "c1"]);
    expect(base.cardIds).toEqual(["c1", "c2", "c3"]);
  });
});

// ---------------------------------------------------------------------------
// shuffleZone
// ---------------------------------------------------------------------------

describe("shuffleZone", () => {
  it("preserves the exact multiset of card ids for a many-card zone", () => {
    const cards = ids(
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
      "g",
      "h",
      "i",
      "j",
      "k",
      "l",
    );
    const shuffled = shuffleZone(zone(ZoneType.LIBRARY, PLAYER_A, cards));
    expect([...shuffled.cardIds].sort()).toEqual([...cards].sort());
    expect(shuffled.cardIds).toHaveLength(cards.length);
  });

  it("handles empty and single-card zones without error", () => {
    expect(shuffleZone(zone(ZoneType.LIBRARY, PLAYER_A, [])).cardIds).toEqual(
      [],
    );
    expect(
      shuffleZone(zone(ZoneType.LIBRARY, PLAYER_A, ["a"])).cardIds,
    ).toEqual(["a"]);
  });

  it("does not mutate the input zone", () => {
    const base = stockedZone(ZoneType.LIBRARY, PLAYER_A);
    shuffleZone(base);
    expect(base.cardIds).toEqual(["c1", "c2", "c3"]);
  });
});

// ---------------------------------------------------------------------------
// Visibility model
// ---------------------------------------------------------------------------

describe("visibility (reveal/hide/setZoneVisibility/canPlayerSeeZone)", () => {
  it("revealZone marks the zone revealed and thus visible to anyone", () => {
    const hidden = zone(ZoneType.HAND, PLAYER_A, []);
    const revealed = revealZone(hidden);
    expect(revealed.isRevealed).toBe(true);
    expect(canPlayerSeeZone(revealed, PLAYER_B)).toBe(true);
  });

  it("hideZone clears isRevealed and visibleTo", () => {
    const revealed = zone(ZoneType.HAND, PLAYER_A, [], {
      isRevealed: true,
      visibleTo: [PLAYER_B],
    });
    const hidden = hideZone(revealed);
    expect(hidden.isRevealed).toBe(false);
    expect(hidden.visibleTo).toEqual([]);
  });

  it("setZoneVisibility restricts sight to the listed players", () => {
    const z = setZoneVisibility(zone(ZoneType.HAND, PLAYER_A, []), [PLAYER_B]);
    expect(z.isRevealed).toBe(false);
    expect(canPlayerSeeZone(z, PLAYER_B)).toBe(true);
    expect(canPlayerSeeZone(z, "player-c")).toBe(false);
  });

  it("the owner can always see their own hidden zone", () => {
    const z = hideZone(zone(ZoneType.HAND, PLAYER_A, []));
    expect(canPlayerSeeZone(z, PLAYER_A)).toBe(true);
    expect(canPlayerSeeZone(z, PLAYER_B)).toBe(false);
  });

  it("a hidden shared zone (null owner) is invisible to everyone", () => {
    const z = hideZone(zone(ZoneType.STACK, null, []));
    expect(canPlayerSeeZone(z, PLAYER_A)).toBe(false);
    expect(canPlayerSeeZone(z, PLAYER_B)).toBe(false);
  });

  it("does not mutate the input zone", () => {
    const base = zone(ZoneType.HAND, PLAYER_A, [], { isRevealed: false });
    revealZone(base);
    expect(base.isRevealed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Composite operations: draw / mill / exile
// ---------------------------------------------------------------------------

describe("drawCards", () => {
  it("draws nothing from an empty library", () => {
    const result = drawCards(
      zone(ZoneType.LIBRARY, PLAYER_A, []),
      zone(ZoneType.HAND, PLAYER_A, ["h1"]),
      1,
    );
    expect(result.drawnCards).toEqual([]);
    expect(result.library.cardIds).toEqual([]);
    expect(result.hand.cardIds).toEqual(["h1"]);
  });

  it("draws a single card from the top of the library into the hand", () => {
    const result = drawCards(
      zone(ZoneType.LIBRARY, PLAYER_A, ["l1", "l2", "l3"]),
      zone(ZoneType.HAND, PLAYER_A, []),
      1,
    );
    expect(result.drawnCards).toEqual(["l3"]);
    expect(result.library.cardIds).toEqual(["l1", "l2"]);
    expect(result.hand.cardIds).toEqual(["l3"]);
  });

  it("draws many cards in top-first order", () => {
    const result = drawCards(
      zone(ZoneType.LIBRARY, PLAYER_A, ["l1", "l2", "l3", "l4"]),
      zone(ZoneType.HAND, PLAYER_A, ["h1"]),
      3,
    );
    expect(result.drawnCards).toEqual(["l2", "l3", "l4"]);
    expect(result.library.cardIds).toEqual(["l1"]);
    expect(result.hand.cardIds).toEqual(["h1", "l2", "l3", "l4"]);
  });

  it("draws only the available cards when count exceeds the library size", () => {
    const result = drawCards(
      zone(ZoneType.LIBRARY, PLAYER_A, ["l1"]),
      zone(ZoneType.HAND, PLAYER_A, []),
      5,
    );
    expect(result.drawnCards).toEqual(["l1"]);
    expect(result.library.cardIds).toEqual([]);
    expect(result.hand.cardIds).toEqual(["l1"]);
  });
});

describe("millCards", () => {
  it("mills nothing from an empty library", () => {
    const result = millCards(
      zone(ZoneType.LIBRARY, PLAYER_A, []),
      zone(ZoneType.GRAVEYARD, PLAYER_A, ["g1"]),
      1,
    );
    expect(result.milledCards).toEqual([]);
    expect(result.library.cardIds).toEqual([]);
    expect(result.graveyard.cardIds).toEqual(["g1"]);
  });

  it("mills a single card from the library top into the graveyard", () => {
    const result = millCards(
      zone(ZoneType.LIBRARY, PLAYER_A, ["l1", "l2", "l3"]),
      zone(ZoneType.GRAVEYARD, PLAYER_A, []),
      1,
    );
    expect(result.milledCards).toEqual(["l3"]);
    expect(result.library.cardIds).toEqual(["l1", "l2"]);
    expect(result.graveyard.cardIds).toEqual(["l3"]);
  });

  it("mills many cards and caps at the available count", () => {
    const result = millCards(
      zone(ZoneType.LIBRARY, PLAYER_A, ["l1", "l2"]),
      zone(ZoneType.GRAVEYARD, PLAYER_A, ["g1"]),
      5,
    );
    expect(result.milledCards).toEqual(["l1", "l2"]);
    expect(result.library.cardIds).toEqual([]);
    expect(result.graveyard.cardIds).toEqual(["g1", "l1", "l2"]);
  });
});

describe("exileCards", () => {
  it("is a no-op for an empty id list", () => {
    const result = exileCards(
      stockedZone(ZoneType.BATTLEFIELD, PLAYER_A),
      zone(ZoneType.EXILE, PLAYER_A, []),
      [],
    );
    expect(result.exiledCards).toEqual([]);
    expect(result.from.cardIds).toEqual(["c1", "c2", "c3"]);
    expect(result.exile.cardIds).toEqual([]);
  });

  it("exiles a single card from the battlefield", () => {
    const result = exileCards(
      stockedZone(ZoneType.BATTLEFIELD, PLAYER_A),
      zone(ZoneType.EXILE, PLAYER_A, []),
      ["c2"],
    );
    expect(result.exiledCards).toEqual(["c2"]);
    expect(result.from.cardIds).toEqual(["c1", "c3"]);
    expect(result.exile.cardIds).toEqual(["c2"]);
  });

  it("exiles many cards in the given order (absent ids still appended — no membership validation)", () => {
    const result = exileCards(
      stockedZone(ZoneType.GRAVEYARD, PLAYER_A),
      zone(ZoneType.EXILE, PLAYER_A, ["x1"]),
      ["c3", "ghost", "c1"],
    );
    expect(result.exiledCards).toEqual(["c3", "ghost", "c1"]);
    expect(result.from.cardIds).toEqual(["c2"]);
    expect(result.exile.cardIds).toEqual(["x1", "c3", "ghost", "c1"]);
  });
});

// ---------------------------------------------------------------------------
// Foretell helpers (primary coverage in foretell.test.ts; pinned here
// because they live in zones.ts)
// ---------------------------------------------------------------------------

describe("foretell helpers", () => {
  const foretoldCard = {
    id: "f1",
    foretold: true,
    isFaceDown: true,
  } as unknown as CardInstance;
  const merelyExiled = {
    id: "f2",
    foretold: false,
    isFaceDown: true,
  } as unknown as CardInstance;
  const faceUpForetold = {
    id: "f3",
    foretold: true,
    isFaceDown: false,
  } as unknown as CardInstance;

  it("isForetoldCard requires both the flag and face-down state", () => {
    expect(isForetoldCard(foretoldCard)).toBe(true);
    expect(isForetoldCard(merelyExiled)).toBe(false);
    expect(isForetoldCard(faceUpForetold)).toBe(false);
    expect(isForetoldCard(undefined)).toBe(false);
  });

  it("getForetoldCardIds returns only foretold cards in the exile zone", () => {
    const cards = new Map<CardInstanceId, CardInstance>([
      ["f1", foretoldCard],
      ["f2", merelyExiled],
      ["f3", faceUpForetold],
    ]);
    const exileZone = zone(ZoneType.EXILE, PLAYER_A, ["f1", "f2", "f3"]);
    expect(getForetoldCardIds(exileZone, cards)).toEqual(["f1"]);
  });
});
