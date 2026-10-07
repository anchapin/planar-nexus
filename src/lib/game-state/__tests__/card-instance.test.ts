/**
 * Tests for card-instance predicates added by issue #1715.
 *
 * `hasShocklandChoice` moved verbatim from the single-player game page into
 * the engine: it encodes a rule (shockland-style "pay 2 life or this land
 * enters tapped" ETB choice) and is exported via the game-state barrel.
 */

import {
  hasShocklandChoice,
  createCardInstance,
  typeLineHasCreatureType,
} from "../card-instance";
import type { ScryfallCard } from "../types";
import type { PlayerId } from "../types";

// Helper to create a mock card (style follows keyword-actions.test.ts)
function createMockCard(
  name: string,
  typeLine: string,
  oracleText: string = "",
): ScryfallCard {
  return {
    id: `mock-${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    type_line: typeLine,
    keywords: [],
    oracle_text: oracleText,
    mana_cost: "",
    cmc: 0,
    colors: [],
    color_identity: [],
    legalities: { standard: "legal", commander: "legal" },
    card_faces: undefined,
    layout: "normal",
    power: undefined,
    toughness: undefined,
  } as ScryfallCard;
}

const OWNER: PlayerId = "player-1";

/** Real shockland wording (Stomping Ground, Scryfall oracle text). */
const SHOCKLAND_TEXT =
  "({T}: Add {R} or {G}.) As Stomping Ground enters the battlefield, you may pay 2 life. If you don't, it enters tapped.";

describe("hasShocklandChoice", () => {
  it("is true for shockland wording (pay 2 life + enters + tapped)", () => {
    const card = createCardInstance(
      createMockCard(
        "Stomping Ground",
        "Land — Mountain Forest",
        SHOCKLAND_TEXT,
      ),
      OWNER,
      OWNER,
    );
    expect(hasShocklandChoice(card)).toBe(true);
  });

  it("is true regardless of casing in the oracle text", () => {
    const card = createCardInstance(
      createMockCard(
        "Loud Land",
        "Land",
        "As this enters, you may PAY 2 LIFE. If you don't, it enters TAPPED.",
      ),
      OWNER,
      OWNER,
    );
    expect(hasShocklandChoice(card)).toBe(true);
  });

  it("is false for a basic land with no ETB choice", () => {
    const card = createCardInstance(
      createMockCard("Forest", "Basic Land — Forest", "{T}: Add {G}."),
      OWNER,
      OWNER,
    );
    expect(hasShocklandChoice(card)).toBe(false);
  });

  it("is false for taplands (enters tapped, but no life payment)", () => {
    const card = createCardInstance(
      createMockCard(
        "Gateway Plaza",
        "Land",
        "Gateway Plaza enters the battlefield tapped.",
      ),
      OWNER,
      OWNER,
    );
    expect(hasShocklandChoice(card)).toBe(false);
  });

  it("is false when the life payment is not exactly 2", () => {
    const card = createCardInstance(
      createMockCard(
        "Pain land",
        "Land",
        "As this enters, you may pay 1 life. If you don't, it enters tapped.",
      ),
      OWNER,
      OWNER,
    );
    expect(hasShocklandChoice(card)).toBe(false);
  });

  it("is false when payment exists but there is no tapped clause", () => {
    const card = createCardInstance(
      createMockCard(
        "Phyrexian thing",
        "Creature",
        "You may pay 2 life as this enters the battlefield.",
      ),
      OWNER,
      OWNER,
    );
    expect(hasShocklandChoice(card)).toBe(false);
  });

  it("is false for undefined oracle text", () => {
    const cardData = createMockCard("Blank", "Land");
    cardData.oracle_text = undefined;
    const card = createCardInstance(cardData, OWNER, OWNER);
    expect(hasShocklandChoice(card)).toBe(false);
  });

  it("requires all three phrases together (pay 2 life AND enters AND tapped)", () => {
    const payOnly = createCardInstance(
      createMockCard("A", "Land", "pay 2 life"),
      OWNER,
      OWNER,
    );
    const entersOnly = createCardInstance(
      createMockCard("B", "Land", "enters"),
      OWNER,
      OWNER,
    );
    const tappedOnly = createCardInstance(
      createMockCard("C", "Land", "tapped"),
      OWNER,
      OWNER,
    );
    expect(hasShocklandChoice(payOnly)).toBe(false);
    expect(hasShocklandChoice(entersOnly)).toBe(false);
    expect(hasShocklandChoice(tappedOnly)).toBe(false);
  });
});

describe("typeLineHasCreatureType (#2349)", () => {
  it.each([
    ["Creature \u2014 Bear", true],
    ["Legendary Creature \u2014 Bird", true],
    ["Artifact Creature \u2014 Equipment", true],
    ["Enchantment Creature \u2014 God", true],
    ["Creature - Human Wizard", true],
    ["Artifact", false],
    ["Instant", false],
    ["Artifact \u2014 Vehicle", false],
    ["Sorcery // Creature \u2014 Elf", true],
    ["", false],
  ])("%s -> %s", (typeLine, expected) => {
    expect(typeLineHasCreatureType(typeLine)).toBe(expected);
  });

  it("fails closed on a missing type line", () => {
    expect(typeLineHasCreatureType(undefined)).toBe(false);
    expect(typeLineHasCreatureType(null)).toBe(false);
  });

  it("only searches the card-type half, not subtypes", () => {
    // A subtype word that merely contains the substring is not the type.
    expect(typeLineHasCreatureType("Artifact \u2014 Creatureling")).toBe(false);
    expect(typeLineHasCreatureType("Tribal Instant \u2014 Creatures")).toBe(
      false,
    );
  });
});

describe("createCardInstance honors options.currentZoneKey (#2595)", () => {
  // Regression: `createCardInstance` was returning `currentZoneKey: null`
  // regardless of the option. The test helper `put` and the engine's
  // `moveCard` path both pass `currentZoneKey` so the engine can skip the
  // fallback zone scan on the first read. Before this fix, the option
  // was silently dropped and the field always reset to `null`.
  const mkCard = (name: string) =>
    createMockCard(name, "Creature — Test", "") as ScryfallCard;

  it("defaults to null when options is empty", () => {
    const c = createCardInstance(mkCard("A"), OWNER, OWNER);
    expect(c.currentZoneKey).toBeNull();
  });

  it("defaults to null when options omits currentZoneKey", () => {
    const c = createCardInstance(mkCard("A"), OWNER, OWNER, {
      isToken: false,
    });
    expect(c.currentZoneKey).toBeNull();
  });

  it("preserves an explicit currentZoneKey from options", () => {
    const c = createCardInstance(mkCard("A"), OWNER, OWNER, {
      currentZoneKey: "player-1-battlefield",
    });
    expect(c.currentZoneKey).toBe("player-1-battlefield");
  });
});
