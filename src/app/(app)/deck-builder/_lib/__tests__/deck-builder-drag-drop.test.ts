/**
 * @fileOverview Unit tests for the deck-builder drag-and-drop reducer
 * (issue #1545). The reducer is the single source of truth for carry / drop
 * state transitions; the React hook binds it to DOM events.
 */

import {
  buildPickUpAnnouncement,
  buildTargetChangeAnnouncement,
  deckBuilderDragDropReducer,
  initialDeckBuilderDragDropState,
  type DeckBuilderDragDropState,
} from "../deck-builder-drag-drop";
import type { ScryfallCard } from "@/lib/card-database";

const bolt: ScryfallCard = {
  id: "bolt-1",
  name: "Lightning Bolt",
  set: "m21",
  collector_number: "162",
  cmc: 1,
  type_line: "Instant",
  oracle_text: "Lightning Bolt deals 3 damage to any target.",
  colors: ["R"],
  color_identity: ["R"],
  rarity: "common",
  legalities: { modern: "legal", standard: "legal" },
} as unknown as ScryfallCard;

const island: ScryfallCard = {
  id: "island-1",
  name: "Island",
  set: "m21",
  collector_number: "311",
  cmc: 0,
  type_line: "Basic Land — Island",
  oracle_text: "{T}: Add {U}.",
  colors: [],
  color_identity: ["U"],
  rarity: "common",
  legalities: { modern: "legal", standard: "legal" },
} as unknown as ScryfallCard;

describe("deckBuilderDragDropReducer — initial state", () => {
  it("starts idle with mainboard target and 1 copy", () => {
    expect(initialDeckBuilderDragDropState).toEqual({
      carriedCard: null,
      copies: 1,
      target: "mainboard",
    });
  });
});

describe("deckBuilderDragDropReducer — pickUp", () => {
  it("transitions from idle to carrying", () => {
    const next = deckBuilderDragDropReducer(initialDeckBuilderDragDropState, {
      type: "pickUp",
      card: bolt,
      copies: 1,
      defaultTarget: "mainboard",
    });
    expect(next.carriedCard).toBe(bolt);
    expect(next.copies).toBe(1);
    expect(next.target).toBe("mainboard");
  });

  it("records the requested copy count", () => {
    const next = deckBuilderDragDropReducer(initialDeckBuilderDragDropState, {
      type: "pickUp",
      card: bolt,
      copies: 4,
      defaultTarget: "mainboard",
    });
    expect(next.copies).toBe(4);
  });

  it("respects the requested default target", () => {
    const next = deckBuilderDragDropReducer(initialDeckBuilderDragDropState, {
      type: "pickUp",
      card: bolt,
      copies: 1,
      defaultTarget: "sideboard",
    });
    expect(next.target).toBe("sideboard");
  });

  it("replaces the carried card when picking up a different card", () => {
    const carrying = deckBuilderDragDropReducer(
      initialDeckBuilderDragDropState,
      { type: "pickUp", card: bolt, copies: 1, defaultTarget: "mainboard" },
    );
    const next = deckBuilderDragDropReducer(carrying, {
      type: "pickUp",
      card: island,
      copies: 1,
      defaultTarget: "mainboard",
    });
    expect(next.carriedCard).toBe(island);
  });

  it("is idempotent when picking up the same card with the same copy count", () => {
    const carrying = deckBuilderDragDropReducer(
      initialDeckBuilderDragDropState,
      { type: "pickUp", card: bolt, copies: 1, defaultTarget: "mainboard" },
    );
    const next = deckBuilderDragDropReducer(carrying, {
      type: "pickUp",
      card: bolt,
      copies: 1,
      defaultTarget: "mainboard",
    });
    // Same reference: the reducer returns the existing state object so
    // React.useReducer skips the re-render.
    expect(next).toBe(carrying);
  });
});

describe("deckBuilderDragDropReducer — switchTarget", () => {
  const carryingMainboard: DeckBuilderDragDropState = {
    carriedCard: bolt,
    copies: 1,
    target: "mainboard",
  };
  const carryingSideboard: DeckBuilderDragDropState = {
    ...carryingMainboard,
    target: "sideboard",
  };

  it("cycles mainboard → sideboard in the 'next' direction", () => {
    const next = deckBuilderDragDropReducer(carryingMainboard, {
      type: "switchTarget",
      direction: "next",
    });
    expect(next.target).toBe("sideboard");
  });

  it("cycles sideboard → mainboard in the 'next' direction", () => {
    const next = deckBuilderDragDropReducer(carryingSideboard, {
      type: "switchTarget",
      direction: "next",
    });
    expect(next.target).toBe("mainboard");
  });

  it("cycles sideboard → mainboard in the 'previous' direction", () => {
    const next = deckBuilderDragDropReducer(carryingSideboard, {
      type: "switchTarget",
      direction: "previous",
    });
    expect(next.target).toBe("mainboard");
  });

  it("cycles mainboard → sideboard in the 'previous' direction", () => {
    const next = deckBuilderDragDropReducer(carryingMainboard, {
      type: "switchTarget",
      direction: "previous",
    });
    expect(next.target).toBe("sideboard");
  });

  it("is a no-op when not carrying", () => {
    const next = deckBuilderDragDropReducer(initialDeckBuilderDragDropState, {
      type: "switchTarget",
      direction: "next",
    });
    expect(next).toBe(initialDeckBuilderDragDropState);
  });

  it("preserves the carried card and copies across switches", () => {
    const next = deckBuilderDragDropReducer(carryingMainboard, {
      type: "switchTarget",
      direction: "next",
    });
    expect(next.carriedCard).toBe(bolt);
    expect(next.copies).toBe(1);
  });
});

describe("deckBuilderDragDropReducer — drop and cancel", () => {
  const carrying: DeckBuilderDragDropState = {
    carriedCard: bolt,
    copies: 4,
    target: "sideboard",
  };

  it("drop resets to the initial state", () => {
    const next = deckBuilderDragDropReducer(carrying, { type: "drop" });
    expect(next).toBe(initialDeckBuilderDragDropState);
  });

  it("cancel resets to the initial state", () => {
    const next = deckBuilderDragDropReducer(carrying, { type: "cancel" });
    expect(next).toBe(initialDeckBuilderDragDropState);
  });

  it("drop from idle is a no-op", () => {
    const next = deckBuilderDragDropReducer(initialDeckBuilderDragDropState, {
      type: "drop",
    });
    expect(next).toBe(initialDeckBuilderDragDropState);
  });

  it("cancel from idle is a no-op", () => {
    const next = deckBuilderDragDropReducer(initialDeckBuilderDragDropState, {
      type: "cancel",
    });
    expect(next).toBe(initialDeckBuilderDragDropState);
  });
});

describe("buildPickUpAnnouncement", () => {
  it("names the card and the default target", () => {
    const text = buildPickUpAnnouncement(bolt, 1, "Mainboard");
    expect(text).toContain("Lightning Bolt");
    expect(text).toContain("Mainboard");
    expect(text).toContain("Arrow");
    expect(text).toContain("Enter");
    expect(text).toContain("Escape");
  });

  it("appends the copy count when more than one", () => {
    const text = buildPickUpAnnouncement(bolt, 4, "Mainboard");
    expect(text).toContain("(4 copies)");
  });

  it("omits the copy count for a single copy", () => {
    const text = buildPickUpAnnouncement(bolt, 1, "Mainboard");
    expect(text).not.toContain("copies");
  });
});

describe("buildTargetChangeAnnouncement", () => {
  it("labels the new target", () => {
    expect(buildTargetChangeAnnouncement("Sideboard")).toBe(
      "Target: Sideboard.",
    );
    expect(buildTargetChangeAnnouncement("Mainboard")).toBe(
      "Target: Mainboard.",
    );
  });
});
