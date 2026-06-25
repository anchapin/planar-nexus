import {
  parseDecklistLine,
  parseMTGOLine,
  parseJSONDecklist,
  parseDecklist,
  detectDecklistFormat,
  splitDecklist,
  sanitizeCardInput,
  detectDeckSite,
  isSupportedDeckUrl,
  getUnsupportedSiteSuggestion,
  DECK_SITES,
  type DecklistFormat,
} from "../decklist-utils";

describe("parseDecklistLine", () => {
  it("parses standard format with quantity", () => {
    expect(parseDecklistLine("4 Lightning Bolt")).toEqual({
      name: "Lightning Bolt",
      quantity: 4,
    });
  });

  it("parses without quantity (defaults to 1)", () => {
    expect(parseDecklistLine("Sol Ring")).toEqual({
      name: "Sol Ring",
      quantity: 1,
    });
  });

  it("parses with optional x separator", () => {
    expect(parseDecklistLine("4x Sol Ring")).toEqual({
      name: "Sol Ring",
      quantity: 4,
    });
  });

  it("strips set codes with collector numbers", () => {
    expect(parseDecklistLine("1 Sol Ring (CMR) 632")).toEqual({
      name: "Sol Ring",
      quantity: 1,
    });
  });

  it("strips set codes without collector numbers", () => {
    expect(parseDecklistLine("1 Sol Ring [CMR]")).toEqual({
      name: "Sol Ring",
      quantity: 1,
    });
  });

  it("skips comment lines", () => {
    expect(parseDecklistLine("// This is a comment")).toBeNull();
  });

  it("skips section headers", () => {
    expect(parseDecklistLine("Sideboard")).toBeNull();
    expect(parseDecklistLine("Mainboard")).toBeNull();
    expect(parseDecklistLine("Maybeboard")).toBeNull();
  });

  it("trims whitespace", () => {
    expect(parseDecklistLine("  4  Lightning Bolt  ")).toEqual({
      name: "Lightning Bolt",
      quantity: 4,
    });
  });

  it("handles empty lines", () => {
    expect(parseDecklistLine("")).toBeNull();
    expect(parseDecklistLine("   ")).toBeNull();
  });

  it("handles double-faced cards", () => {
    expect(parseDecklistLine("1 Serah Farron // Crystallized Serah")).toEqual({
      name: "Serah Farron // Crystallized Serah",
      quantity: 1,
    });
  });

  it("handles cards with apostrophes", () => {
    expect(parseDecklistLine("4 Ajani's Welcome")).toEqual({
      name: "Ajani's Welcome",
      quantity: 4,
    });
  });

  it("handles cards with commas", () => {
    expect(parseDecklistLine("3 Haliya, Guided by Light")).toEqual({
      name: "Haliya, Guided by Light",
      quantity: 3,
    });
  });

  it("translates Arena-only names to paper equivalents", () => {
    expect(parseDecklistLine("3 Zora, Spider Fancier")).toEqual({
      name: "Aunt May",
      quantity: 3,
    });
  });

  it("normalizes DFC separator from / to //", () => {
    expect(parseDecklistLine("4 Roaring Furnace/Steaming Sauna")).toEqual({
      name: "Roaring Furnace // Steaming Sauna",
      quantity: 4,
    });
  });

  it("normalizes DFC separator without spaces", () => {
    expect(parseDecklistLine("1 Roaring Furnace/Steaming Sauna")).toEqual({
      name: "Roaring Furnace // Steaming Sauna",
      quantity: 1,
    });
  });
});

describe("parseMTGOLine", () => {
  it("parses MTGO format", () => {
    expect(parseMTGOLine("4 Sol Ring")).toEqual({
      name: "Sol Ring",
      quantity: 4,
    });
  });

  it("parses MTGO format with x separator", () => {
    expect(parseMTGOLine("4x Sol Ring")).toEqual({
      name: "Sol Ring",
      quantity: 4,
    });
  });

  it("requires a quantity in MTGO format", () => {
    expect(parseMTGOLine("Sol Ring")).toBeNull();
  });

  it("strips set codes", () => {
    expect(parseMTGOLine("1 Sol Ring (CMR) 632")).toEqual({
      name: "Sol Ring",
      quantity: 1,
    });
  });
});

describe("parseJSONDecklist", () => {
  it("parses direct array format", () => {
    const json = JSON.stringify([
      { name: "Sol Ring", quantity: 4 },
      { name: "Command Tower", quantity: 1 },
    ]);
    expect(parseJSONDecklist(json)).toEqual([
      { name: "Sol Ring", quantity: 4 },
      { name: "Command Tower", quantity: 1 },
    ]);
  });

  it("parses object with cards array", () => {
    const json = JSON.stringify({
      cards: [{ name: "Sol Ring", quantity: 4 }],
    });
    expect(parseJSONDecklist(json)).toEqual([
      { name: "Sol Ring", quantity: 4 },
    ]);
  });

  it("returns empty array for invalid JSON", () => {
    expect(parseJSONDecklist("not json")).toEqual([]);
  });

  it("filters out invalid entries", () => {
    const json = JSON.stringify([
      { name: "Sol Ring", quantity: 4 },
      { name: "Bad", noQuantity: true },
    ]);
    expect(parseJSONDecklist(json)).toEqual([
      { name: "Sol Ring", quantity: 4 },
    ]);
  });
});

describe("parseDecklist", () => {
  it("parses standard format decklist", () => {
    const decklist = "4 Sol Ring\n1 Command Tower\n\n2 Arcane Signet";
    expect(parseDecklist(decklist, "standard")).toEqual([
      { name: "Sol Ring", quantity: 4 },
      { name: "Command Tower", quantity: 1 },
      { name: "Arcane Signet", quantity: 2 },
    ]);
  });

  it("parses MTGO format decklist", () => {
    const decklist = "4 Sol Ring\n1 Command Tower";
    expect(parseDecklist(decklist, "mtgo")).toEqual([
      { name: "Sol Ring", quantity: 4 },
      { name: "Command Tower", quantity: 1 },
    ]);
  });

  it("parses JSON format decklist", () => {
    const json = JSON.stringify([{ name: "Sol Ring", quantity: 4 }]);
    expect(parseDecklist(json, "json")).toEqual([
      { name: "Sol Ring", quantity: 4 },
    ]);
  });

  it("handles a realistic Moxfield Standard deck export", () => {
    const decklist = `3 Aerith Gainsborough
4 Annie Joins Up
4 Bre of Clan Stoutarm
3 Case of the Uneaten Feast
4 Haliya, Guided by Light
4 Inspiring Vantage
3 Leonardo, Cutting Edge
4 Llanowar Elves
4 Multiversal Passage
1 Plains
3 Sally Pride, Lioness Leader
4 Serah Farron
4 Starting Town
4 Stomping Ground
4 Temple Garden
4 Virulent Emissary
3 Zora, Spider Fancier`;

    const result = parseDecklist(decklist, "standard");
    expect(result).toHaveLength(17);
    expect(result).toContainEqual({ name: "Aerith Gainsborough", quantity: 3 });
    expect(result).toContainEqual({ name: "Annie Joins Up", quantity: 4 });
    expect(result).toContainEqual({
      name: "Bre of Clan Stoutarm",
      quantity: 4,
    });
    expect(result).toContainEqual({
      name: "Case of the Uneaten Feast",
      quantity: 3,
    });
    expect(result).toContainEqual({
      name: "Haliya, Guided by Light",
      quantity: 4,
    });
    expect(result).toContainEqual({ name: "Inspiring Vantage", quantity: 4 });
    expect(result).toContainEqual({
      name: "Leonardo, Cutting Edge",
      quantity: 3,
    });
    expect(result).toContainEqual({ name: "Llanowar Elves", quantity: 4 });
    expect(result).toContainEqual({ name: "Multiversal Passage", quantity: 4 });
    expect(result).toContainEqual({ name: "Plains", quantity: 1 });
    expect(result).toContainEqual({
      name: "Sally Pride, Lioness Leader",
      quantity: 3,
    });
    expect(result).toContainEqual({ name: "Serah Farron", quantity: 4 });
    expect(result).toContainEqual({ name: "Starting Town", quantity: 4 });
    expect(result).toContainEqual({ name: "Stomping Ground", quantity: 4 });
    expect(result).toContainEqual({ name: "Temple Garden", quantity: 4 });
    expect(result).toContainEqual({ name: "Virulent Emissary", quantity: 4 });
    expect(result).toContainEqual({ name: "Aunt May", quantity: 3 });

    const totalCards = result.reduce((sum, c) => sum + c.quantity, 0);
    expect(totalCards).toBe(60);
  });
});

describe("detectDecklistFormat", () => {
  it("detects JSON format", () => {
    expect(detectDecklistFormat('[{"name":"Sol Ring","quantity":4}]')).toBe(
      "json",
    );
    expect(detectDecklistFormat('{"cards":[]}')).toBe("json");
  });

  it("detects MTGO format", () => {
    expect(detectDecklistFormat("4 Sol Ring\n4 Arcane Signet")).toBe("mtgo");
  });

  it("defaults to standard format", () => {
    expect(detectDecklistFormat("Sol Ring\nCommand Tower")).toBe("standard");
  });

  it("handles empty input", () => {
    expect(detectDecklistFormat("")).toBe("standard");
  });
});

describe("splitDecklist", () => {
  it("splits by newline and filters empty lines", () => {
    expect(splitDecklist("a\n\nb\n\nc")).toEqual(["a", "b", "c"]);
  });
});

describe("sanitizeCardInput", () => {
  it("aggregates duplicate cards by name", () => {
    const cards = [
      { name: "Sol Ring", quantity: 4 },
      { name: "sol ring", quantity: 1 },
      { name: "Command Tower", quantity: 2 },
    ];
    const { cardMap, malformedInputs } = sanitizeCardInput(cards);
    expect(cardMap.get("sol ring")?.quantity).toBe(5);
    expect(cardMap.get("command tower")?.quantity).toBe(2);
    expect(malformedInputs).toEqual([]);
  });

  it("collects malformed inputs", () => {
    const cards = [
      { name: "", quantity: 4 },
      { name: "Sol Ring", quantity: -1 },
      { name: "Good Card", quantity: 1 },
    ];
    const { cardMap, malformedInputs } = sanitizeCardInput(cards);
    expect(cardMap.size).toBe(1);
    expect(malformedInputs.length).toBe(2);
  });
});

describe("DecklistFormat extensibility", () => {
  it("includes the URL-based formats moxfield and archidekt", () => {
    const format: DecklistFormat = "moxfield";
    expect(format).toBe("moxfield");
    const archidekt: DecklistFormat = "archidekt";
    expect(archidekt).toBe("archidekt");
  });

  it("treats URL-based formats as standard text in parseDecklist", () => {
    const decklist = "4 Sol Ring\n1 Command Tower";
    expect(parseDecklist(decklist, "moxfield")).toEqual([
      { name: "Sol Ring", quantity: 4 },
      { name: "Command Tower", quantity: 1 },
    ]);
    expect(parseDecklist(decklist, "archidekt")).toEqual([
      { name: "Sol Ring", quantity: 4 },
      { name: "Command Tower", quantity: 1 },
    ]);
  });
});

describe("DECK_SITES registry", () => {
  it("includes Moxfield and Archidekt alongside the original sites", () => {
    const names = DECK_SITES.map((s) => s.name);
    expect(names).toContain("MTGGoldfish");
    expect(names).toContain("TappedOut");
    expect(names).toContain("Moxfield");
    expect(names).toContain("Archidekt");
  });

  it("every site has a non-empty host and example URL", () => {
    for (const site of DECK_SITES) {
      expect(site.host.length).toBeGreaterThan(0);
      expect(site.exampleUrl.startsWith("http")).toBe(true);
    }
  });

  it("extracts a Moxfield id from /decks/{id}, /deck/{id}, and /deck/anonymous/{id}", () => {
    const moxfield = DECK_SITES.find((s) => s.name === "Moxfield")!;
    expect(moxfield.extractId("https://www.moxfield.com/decks/AbCdEf123")).toBe(
      "AbCdEf123",
    );
    expect(moxfield.extractId("https://moxfield.com/deck/AbCdEf123")).toBe(
      "AbCdEf123",
    );
    expect(
      moxfield.extractId("https://moxfield.com/deck/anonymous/AbCdEf123"),
    ).toBe("AbCdEf123");
    expect(moxfield.extractId("https://moxfield.com/other/path")).toBeNull();
  });

  it("extracts a numeric Archidekt id from /decks/{id}", () => {
    const archidekt = DECK_SITES.find((s) => s.name === "Archidekt")!;
    expect(archidekt.extractId("https://archidekt.com/decks/12345678")).toBe(
      "12345678",
    );
    expect(
      archidekt.extractId("https://www.archidekt.com/decks/12345678/"),
    ).toBe("12345678");
    expect(archidekt.extractId("https://archidekt.com/decks/abc")).toBeNull();
  });
});

describe("detectDeckSite", () => {
  it("detects each supported site by hostname", () => {
    expect(detectDeckSite("https://www.moxfield.com/decks/abc")?.name).toBe(
      "Moxfield",
    );
    expect(detectDeckSite("https://archidekt.com/decks/123")?.name).toBe(
      "Archidekt",
    );
    expect(
      detectDeckSite("https://www.mtggoldfish.com/deck/123")?.name,
    ).toBe("MTGGoldfish");
    expect(detectDeckSite("https://tappedout.net/mtg-decks/foo/")?.name).toBe(
      "TappedOut",
    );
  });

  it("returns null for unsupported sites", () => {
    expect(detectDeckSite("https://example.com/deck/123")).toBeNull();
  });

  it("returns null for invalid input", () => {
    expect(detectDeckSite("not a url")).toBeNull();
  });
});

describe("isSupportedDeckUrl", () => {
  it("returns true for supported sites and false otherwise", () => {
    expect(isSupportedDeckUrl("https://www.moxfield.com/decks/abc")).toBe(true);
    expect(isSupportedDeckUrl("https://archidekt.com/decks/123")).toBe(true);
    expect(isSupportedDeckUrl("https://example.com/deck/123")).toBe(false);
  });
});

describe("getUnsupportedSiteSuggestion", () => {
  it("mentions the text-export fallback and lists supported sites", () => {
    const suggestion = getUnsupportedSiteSuggestion(
      "https://example.com/deck/123",
    );
    expect(suggestion.toLowerCase()).toContain("text");
    expect(suggestion).toContain("Moxfield");
    expect(suggestion).toContain("Archidekt");
  });

  it("names the detected site when the host is known", () => {
    const suggestion = getUnsupportedSiteSuggestion(
      "https://archidekt.com/decks/123",
    );
    expect(suggestion).toContain("Archidekt");
  });
});
