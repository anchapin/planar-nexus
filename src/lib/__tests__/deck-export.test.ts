/**
 * @fileOverview Tests for the MTGO and MTG Arena plaintext export module.
 *
 * Round-trip coverage for issue #1543: every export produced by the
 * formatters must round-trip cleanly through the matching parser, so
 * users can export → re-import without losing or duplicating cards.
 *
 * Coverage focus:
 *   - Basic mainboard + sideboard round-trip
 *   - Commander-style deck with no sideboard omits the Sideboard section
 *   - DFC / split-card names use ` // ` (matches parseMTGOLine)
 *   - Set codes / collector numbers are stripped from exports
 *   - Filename sanitization matches the existing JSON export behaviour
 *   - JSON format is intentionally rejected (callers must use the JSON
 *     path so the deck metadata stays attached)
 *   - Lenient parsing: blank lines, leading/trailing whitespace, mixed
 *     case section headers, and stray section markers all parse cleanly
 *     so a user who hand-edits the file can still re-import it.
 */

import { describe, it, expect } from "@jest/globals";
import {
  formatDeckAsMTGO,
  formatDeckAsArena,
  formatDeck,
  formatCardLine,
  normalizeCardNameForExport,
  parseMTGOExport,
  parseArenaExport,
  parsePlaintextDeckLine,
  getExportFilename,
  sanitizeExportFilename,
  triggerBrowserDownload,
  type DeckEntry,
  type DeckExportPayload,
} from "../deck-export";

// ---------------------------------------------------------------------------
// Fixtures — a Modern mainboard (60) + sideboard (15), a Commander deck
// (100, no sideboard), and a DFC-heavy deck to exercise the separator.
// ---------------------------------------------------------------------------

const modernMainboard: DeckEntry[] = [
  { name: "Lightning Bolt", quantity: 4 },
  { name: "Counterspell", quantity: 4 },
  { name: "Path to Exile", quantity: 4 },
  { name: "Snapcaster Mage", quantity: 4 },
  { name: "Mishra's Bauble", quantity: 4 },
  { name: "Opt", quantity: 4 },
  { name: "Thoughtseize", quantity: 3 },
  { name: "Inkmoth Nexus", quantity: 2 },
  { name: "Scalding Tarn", quantity: 4 },
  { name: "Polluted Delta", quantity: 4 },
  { name: "Flooded Strand", quantity: 2 },
  { name: "Island", quantity: 6 },
  { name: "Plains", quantity: 1 },
  { name: "Swamp", quantity: 2 },
  { name: "Steam Vents", quantity: 2 },
  { name: "Hallowed Fountain", quantity: 4 },
  { name: "Watery Grave", quantity: 4 },
  { name: "Godless Shrine", quantity: 2 },
];

const modernSideboard: DeckEntry[] = [
  { name: "Rest in Peace", quantity: 2 },
  { name: "Celestial Purge", quantity: 2 },
  { name: "Disdainful Stroke", quantity: 2 },
  { name: "Negate", quantity: 3 },
  { name: "Surgical Extraction", quantity: 2 },
  { name: "Wear // Tear", quantity: 2 },
  { name: "Engineered Explosives", quantity: 2 },
];

const commanderDeck: DeckEntry[] = Array.from({ length: 100 }, (_, i) => ({
  name: `Commander Card ${i + 1}`,
  quantity: 1,
}));

const dfcDeck: DeckEntry[] = [
  // Canonical stored form — the card database keeps DFC names with the
  // " // " separator, so the export round-trip should preserve it as-is.
  { name: "Delver of Secrets // Insectile Aberration", quantity: 4 },
  { name: "Eska, Cogwork Servant // Face of the World", quantity: 1 },
  { name: "Wear // Tear", quantity: 2 },
];

// ---------------------------------------------------------------------------
// formatCardLine + normalizeCardNameForExport
// ---------------------------------------------------------------------------

describe("normalizeCardNameForExport", () => {
  it("trims whitespace and collapses internal runs of spaces", () => {
    expect(normalizeCardNameForExport("  Lightning   Bolt  ")).toBe(
      "Lightning Bolt",
    );
  });

  it("normalizes DFC / split separators to ' // '", () => {
    expect(
      normalizeCardNameForExport("Delver of Secrets / Insectile Aberration"),
    ).toBe("Delver of Secrets // Insectile Aberration");
    expect(
      normalizeCardNameForExport(
        "Eska, Cogwork Servant/  Face of the World",
      ),
    ).toBe("Eska, Cogwork Servant // Face of the World");
  });

  it("strips set codes with collector numbers", () => {
    expect(normalizeCardNameForExport("Sol Ring (CMR) 632")).toBe("Sol Ring");
    expect(normalizeCardNameForExport("Sol Ring [CMR] 632")).toBe("Sol Ring");
  });

  it("strips set codes without collector numbers", () => {
    expect(normalizeCardNameForExport("Sol Ring (CMR)")).toBe("Sol Ring");
    expect(normalizeCardNameForExport("Lightning Bolt [M21]")).toBe(
      "Lightning Bolt",
    );
  });

  it("returns empty string for empty / whitespace-only input", () => {
    expect(normalizeCardNameForExport("")).toBe("");
    expect(normalizeCardNameForExport("   ")).toBe("");
  });
});

describe("formatCardLine", () => {
  it("renders 'COUNT NAME'", () => {
    expect(formatCardLine({ name: "Lightning Bolt", quantity: 4 })).toBe(
      "4 Lightning Bolt",
    );
  });

  it("omits zero / negative quantities (returns empty)", () => {
    expect(formatCardLine({ name: "Lightning Bolt", quantity: 0 })).toBe("");
    expect(formatCardLine({ name: "Lightning Bolt", quantity: -1 })).toBe("");
  });

  it("normalizes DFC separators and strips set codes", () => {
    expect(
      formatCardLine({
        name: "Delver of Secrets / Insectile Aberration",
        quantity: 1,
      }),
    ).toBe("1 Delver of Secrets // Insectile Aberration");
    expect(
      formatCardLine({ name: "Sol Ring (CMR) 632", quantity: 4 }),
    ).toBe("4 Sol Ring");
  });
});

// ---------------------------------------------------------------------------
// formatDeckAsMTGO — emit
// ---------------------------------------------------------------------------

describe("formatDeckAsMTGO", () => {
  it("emits mainboard lines then 'Sideboard' header then sideboard lines", () => {
    const out = formatDeckAsMTGO({
      mainboard: [
        { name: "Sol Ring", quantity: 4 },
        { name: "Arcane Signet", quantity: 2 },
      ],
      sideboard: [{ name: "Counterspell", quantity: 1 }],
    });
    expect(out).toBe(
      "4 Sol Ring\n2 Arcane Signet\n\nSideboard\n1 Counterspell",
    );
  });

  it("omits the Sideboard section entirely when sideboard is empty", () => {
    const out = formatDeckAsMTGO({
      mainboard: [{ name: "Sol Ring", quantity: 4 }],
      sideboard: [],
    });
    expect(out).toBe("4 Sol Ring");
    expect(out).not.toContain("Sideboard");
  });

  it("omits the Sideboard section entirely when sideboard is omitted", () => {
    const out = formatDeckAsMTGO({
      mainboard: [{ name: "Sol Ring", quantity: 4 }],
    });
    expect(out).toBe("4 Sol Ring");
  });

  it("emits a 60-card Modern + 15-card sideboard with the right totals", () => {
    const out = formatDeckAsMTGO({
      mainboard: modernMainboard,
      sideboard: modernSideboard,
    });
    const lines = out.split("\n");
    const headerIdx = lines.findIndex((l) => l === "Sideboard");
    expect(headerIdx).toBeGreaterThan(0);
    expect(headerIdx).toBeLessThan(lines.length - 1);
    // No `Deck` header for MTGO — the importer treats the file as mainboard
    // until it sees the `Sideboard` token.
    expect(lines).not.toContain("Deck");
    expect(lines).not.toContain("Mainboard");
  });

  it("uses ' // ' for split / DFC names so MTGO recognises them", () => {
    const out = formatDeckAsMTGO({ mainboard: dfcDeck });
    expect(out).toContain("4 Delver of Secrets // Insectile Aberration");
    expect(out).toContain("1 Eska, Cogwork Servant // Face of the World");
    expect(out).toContain("2 Wear // Tear");
    // Defensive: no bare `/` separator remains.
    expect(out).not.toMatch(/ [^ ]\/[^ ]/);
  });
});

// ---------------------------------------------------------------------------
// formatDeckAsArena — emit
// ---------------------------------------------------------------------------

describe("formatDeckAsArena", () => {
  it("emits literal 'Deck' header, mainboard, blank line, 'Sideboard' header, sideboard", () => {
    const out = formatDeckAsArena({
      mainboard: [
        { name: "Sol Ring", quantity: 4 },
        { name: "Arcane Signet", quantity: 2 },
      ],
      sideboard: [{ name: "Counterspell", quantity: 1 }],
    });
    expect(out).toBe(
      "Deck\n4 Sol Ring\n2 Arcane Signet\n\nSideboard\n1 Counterspell",
    );
  });

  it("omits the Sideboard section entirely for Commander (no sideboard)", () => {
    const out = formatDeckAsArena({
      mainboard: commanderDeck,
    });
    expect(out.startsWith("Deck\n")).toBe(true);
    expect(out).not.toContain("Sideboard");
  });

  it("always emits the 'Deck' header (Arena rejects decks without it)", () => {
    const out = formatDeckAsArena({
      mainboard: [{ name: "Sol Ring", quantity: 4 }],
    });
    const firstLine = out.split("\n")[0];
    expect(firstLine).toBe("Deck");
  });
});

// ---------------------------------------------------------------------------
// formatDeck — dispatcher
// ---------------------------------------------------------------------------

describe("formatDeck", () => {
  it("dispatches to MTGO for 'mtgo'", () => {
    expect(
      formatDeck("mtgo", {
        mainboard: [{ name: "Sol Ring", quantity: 1 }],
      }),
    ).toBe("1 Sol Ring");
  });

  it("dispatches to Arena for 'arena'", () => {
    expect(
      formatDeck("arena", {
        mainboard: [{ name: "Sol Ring", quantity: 1 }],
      }),
    ).toBe("Deck\n1 Sol Ring");
  });

  it("rejects 'json' (callers must use the JSON path so metadata is preserved)", () => {
    expect(() =>
      formatDeck("json", {
        mainboard: [{ name: "Sol Ring", quantity: 1 }],
      }),
    ).toThrow(/JSON/);
  });

  it("rejects unknown formats with an exhaustive-check error", () => {
    expect(() =>
      formatDeck("unknown" as any, {
        mainboard: [{ name: "Sol Ring", quantity: 1 }],
      }),
    ).toThrow(/Unsupported deck export format/);
  });
});

// ---------------------------------------------------------------------------
// parsePlaintextDeckLine — single line parser
// ---------------------------------------------------------------------------

describe("parsePlaintextDeckLine", () => {
  it("parses 'COUNT NAME'", () => {
    expect(parsePlaintextDeckLine("4 Lightning Bolt")).toEqual({
      name: "Lightning Bolt",
      quantity: 4,
    });
  });

  it("defaults to quantity 1 when no count is given", () => {
    expect(parsePlaintextDeckLine("Sol Ring")).toEqual({
      name: "Sol Ring",
      quantity: 1,
    });
  });

  it("accepts the 'Nx NAME' form", () => {
    expect(parsePlaintextDeckLine("4x Sol Ring")).toEqual({
      name: "Sol Ring",
      quantity: 4,
    });
  });

  it("returns null for blank / whitespace-only lines", () => {
    expect(parsePlaintextDeckLine("")).toBeNull();
    expect(parsePlaintextDeckLine("   ")).toBeNull();
  });

  it("returns null for section headers", () => {
    expect(parsePlaintextDeckLine("Sideboard")).toBeNull();
    expect(parsePlaintextDeckLine("Deck")).toBeNull();
    expect(parsePlaintextDeckLine("Mainboard")).toBeNull();
    expect(parsePlaintextDeckLine("Maybeboard")).toBeNull();
    // Case-insensitive header recognition (handles user edits)
    expect(parsePlaintextDeckLine("SIDEBOARD")).toBeNull();
  });

  it("strips set codes and normalizes DFC separators on parse", () => {
    expect(
      parsePlaintextDeckLine("1 Delver of Secrets / Insectile Aberration"),
    ).toEqual({
      name: "Delver of Secrets // Insectile Aberration",
      quantity: 1,
    });
    expect(parsePlaintextDeckLine("1 Sol Ring (CMR) 632")).toEqual({
      name: "Sol Ring",
      quantity: 1,
    });
  });

  it("rejects zero quantities (malformed line)", () => {
    // The card database always stores positive integers, so a `0` prefix
    // is almost certainly a typo. Reject it explicitly.
    expect(parsePlaintextDeckLine("0 Lightning Bolt")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Round-trip — MTGO and Arena exports must re-import cleanly
// ---------------------------------------------------------------------------

describe("MTGO round-trip (issue #1543)", () => {
  it("Modern mainboard + sideboard survives deck → text → parseMTGOExport", () => {
    const payload: DeckExportPayload = {
      mainboard: modernMainboard,
      sideboard: modernSideboard,
    };
    const text = formatDeckAsMTGO(payload);
    const parsed = parseMTGOExport(text);

    // Every mainboard entry re-imports with the original quantity and name.
    expect(parsed.mainboard).toHaveLength(modernMainboard.length);
    for (let i = 0; i < modernMainboard.length; i++) {
      expect(parsed.mainboard[i]).toEqual(modernMainboard[i]);
    }
    // Sideboard: same length, same order, same names + quantities.
    expect(parsed.sideboard).toBeDefined();
    expect(parsed.sideboard!).toHaveLength(modernSideboard.length);
    for (let i = 0; i < modernSideboard.length; i++) {
      expect(parsed.sideboard![i]).toEqual(modernSideboard[i]);
    }
    // No cards leaked between sections.
    const allParsed = [
      ...parsed.mainboard.map((c) => `${c.quantity} ${c.name}`),
      ...(parsed.sideboard ?? []).map((c) => `${c.quantity} ${c.name}`),
    ];
    const allOriginal = [
      ...modernMainboard.map((c) => `${c.quantity} ${c.name}`),
      ...modernSideboard.map((c) => `${c.quantity} ${c.name}`),
    ];
    expect(allParsed.sort()).toEqual(allOriginal.sort());
  });

  it("Commander deck (no sideboard) round-trips with sideboard omitted", () => {
    const text = formatDeckAsMTGO({ mainboard: commanderDeck });
    const parsed = parseMTGOExport(text);
    expect(parsed.sideboard).toBeUndefined();
    expect(parsed.mainboard).toHaveLength(commanderDeck.length);
    // Order is preserved (caller controls the order; neither MTGO nor Arena
    // requires a particular sort).
    for (let i = 0; i < commanderDeck.length; i++) {
      expect(parsed.mainboard[i]).toEqual(commanderDeck[i]);
    }
  });

  it("DFC / split-card names use ' // ' so MTGO recognises them on re-import", () => {
    const text = formatDeckAsMTGO({ mainboard: dfcDeck });
    const parsed = parseMTGOExport(text);
    expect(parsed.mainboard).toEqual(dfcDeck);
  });

  it("tolerates user edits: leading blank lines, trailing whitespace, mixed-case header", () => {
    const original = formatDeckAsMTGO({
      mainboard: [{ name: "Sol Ring", quantity: 4 }],
      sideboard: [{ name: "Counterspell", quantity: 1 }],
    });
    const edited = `\n\n  ${original.replace("Sideboard", "SIDEBOARD")}  \n\n`;
    const parsed = parseMTGOExport(edited);
    expect(parsed.mainboard).toEqual([
      { name: "Sol Ring", quantity: 4 },
    ]);
    expect(parsed.sideboard).toEqual([
      { name: "Counterspell", quantity: 1 },
    ]);
  });

  it("returns empty payload for blank input", () => {
    const parsed = parseMTGOExport("");
    expect(parsed.mainboard).toEqual([]);
    expect(parsed.sideboard).toBeUndefined();
  });

  it("strips set codes on parse so user-added suffixes don't pollute re-import", () => {
    const userEdited = [
      "4 Lightning Bolt",
      "1 Sol Ring (CMR) 632",
      "",
      "Sideboard",
      "2 Rest in Peace",
    ].join("\n");
    const parsed = parseMTGOExport(userEdited);
    expect(parsed.mainboard).toEqual([
      { name: "Lightning Bolt", quantity: 4 },
      { name: "Sol Ring", quantity: 1 },
    ]);
    expect(parsed.sideboard).toEqual([
      { name: "Rest in Peace", quantity: 2 },
    ]);
  });

  it("tolerates a stray 'Deck' header in an MTGO file (some exporters leak Arena format)", () => {
    // MTGO's importer doesn't expect a `Deck` header; if one appears it
    // should be ignored (not treated as a sideboard reset) so the
    // mainboard stays intact.
    const parsed = parseMTGOExport(
      "Deck\n4 Sol Ring\n\nSideboard\n1 Counterspell",
    );
    expect(parsed.mainboard).toEqual([{ name: "Sol Ring", quantity: 4 }]);
    expect(parsed.sideboard).toEqual([{ name: "Counterspell", quantity: 1 }]);
  });
});

describe("Arena round-trip (issue #1543)", () => {
  it("Modern mainboard + sideboard survives deck → text → parseArenaExport", () => {
    const text = formatDeckAsArena({
      mainboard: modernMainboard,
      sideboard: modernSideboard,
    });
    const parsed = parseArenaExport(text);

    expect(parsed.mainboard).toHaveLength(modernMainboard.length);
    for (let i = 0; i < modernMainboard.length; i++) {
      expect(parsed.mainboard[i]).toEqual(modernMainboard[i]);
    }
    expect(parsed.sideboard).toHaveLength(modernSideboard.length);
    for (let i = 0; i < modernSideboard.length; i++) {
      expect(parsed.sideboard![i]).toEqual(modernSideboard[i]);
    }
  });

  it("Commander deck (no sideboard) round-trips with no Sideboard section", () => {
    const text = formatDeckAsArena({ mainboard: commanderDeck });
    expect(text).not.toContain("Sideboard");
    const parsed = parseArenaExport(text);
    expect(parsed.sideboard).toBeUndefined();
    expect(parsed.mainboard).toHaveLength(commanderDeck.length);
  });

  it("DFC / split-card names use ' // ' so Arena recognises them on re-import", () => {
    const text = formatDeckAsArena({ mainboard: dfcDeck });
    const parsed = parseArenaExport(text);
    expect(parsed.mainboard).toEqual(dfcDeck);
  });

  it("files missing the 'Deck' header still parse (lenient — matches MTGO importer behaviour)", () => {
    // A file that's just "4 Sol Ring" with no `Deck` header — the MTGO
    // importer treats it as mainboard; the Arena importer would actually
    // fail, but our parser is lenient so a partial export doesn't
    // crash the re-import UI.
    const parsed = parseArenaExport("4 Sol Ring");
    expect(parsed.mainboard).toEqual([{ name: "Sol Ring", quantity: 4 }]);
  });

  it("blank input produces an empty payload", () => {
    expect(parseArenaExport("")).toEqual({ mainboard: [] });
  });
});

// ---------------------------------------------------------------------------
// Filename helpers
// ---------------------------------------------------------------------------

describe("getExportFilename", () => {
  it("uses .json for json", () => {
    expect(getExportFilename("My Deck", "json")).toBe("My-Deck.json");
  });

  it("uses .dec for mtgo", () => {
    expect(getExportFilename("My Deck", "mtgo")).toBe("My-Deck.dec");
  });

  it("uses .txt for arena", () => {
    expect(getExportFilename("My Deck", "arena")).toBe("My-Deck.txt");
  });

  it("falls back to 'deck' when name is missing / empty", () => {
    expect(getExportFilename(undefined, "mtgo")).toBe("deck.dec");
    expect(getExportFilename("", "arena")).toBe("deck.txt");
  });

  it("strips Windows-illegal characters and trims trailing dashes/dots", () => {
    // Trailing dash is trimmed by the sanitizer (Windows forbids names
    // that end in `.` or ` ` — `-` is legal but looks ugly, so we drop it).
    expect(getExportFilename('My Deck / Modern: 2026 "Main"', "mtgo")).toBe(
      "My-Deck-Modern-2026-Main.dec",
    );
  });
});

describe("sanitizeExportFilename", () => {
  it("replaces non [A-Za-z0-9._-] with dashes and collapses runs", () => {
    expect(sanitizeExportFilename("My  Deck!!")).toBe("My-Deck");
    expect(sanitizeExportFilename("abc/def\\ghi")).toBe("abc-def-ghi");
  });

  it("trims leading and trailing dashes / dots", () => {
    expect(sanitizeExportFilename("---weird---")).toBe("weird");
    expect(sanitizeExportFilename(".hidden.")).toBe("hidden");
  });

  it("falls back to 'deck' when the result would be empty", () => {
    expect(sanitizeExportFilename("")).toBe("deck");
    expect(sanitizeExportFilename("!!!!")).toBe("deck");
    expect(sanitizeExportFilename(undefined)).toBe("deck");
  });
});

// ---------------------------------------------------------------------------
// Browser download helper — no-op in non-browser environments so server
// tests / SSR don't crash. The menu only invokes it from a "use client"
// component, but defending here keeps the helper reusable.
// ---------------------------------------------------------------------------

describe("triggerBrowserDownload", () => {
  it("is a no-op in non-browser environments (no window)", () => {
    const originalWindow = (global as any).window;
    delete (global as any).window;
    try {
      expect(() =>
        triggerBrowserDownload("body", "deck.dec", "text/plain"),
      ).not.toThrow();
    } finally {
      (global as any).window = originalWindow;
    }
  });

  it("is a no-op when URL.createObjectURL is unavailable", () => {
    const originalCreate = URL.createObjectURL;
    URL.createObjectURL = undefined as any;
    try {
      expect(() =>
        triggerBrowserDownload("body", "deck.dec", "text/plain"),
      ).not.toThrow();
    } finally {
      URL.createObjectURL = originalCreate;
    }
  });

  it("creates a Blob, builds an anchor, clicks it, and revokes the URL", () => {
    // jsdom does not implement URL.createObjectURL / revokeObjectURL — stub
    // them and verify the happy-path side effects (Blob constructor
    // receives the content; anchor is appended/clicked/removed).
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    let createdUrl: string | undefined;
    let revokedUrl: string | undefined;
    URL.createObjectURL = jest.fn(() => {
      createdUrl = "blob:mock";
      return "blob:mock";
    }) as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = jest.fn((url: string) => {
      revokedUrl = url;
    }) as unknown as typeof URL.revokeObjectURL;

    const blobSpy = jest
      .spyOn(global, "Blob")
      .mockImplementation(((parts: any, opts: any) => ({
        size: parts[0].length,
        type: opts?.type ?? "text/plain",
      })) as any);

    const appendSpy = jest.spyOn(document.body, "appendChild");
    const removeSpy = jest.spyOn(document.body, "removeChild");
    const clickSpy = jest.fn();

    // Patch HTMLAnchorElement.click to capture the download trigger.
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      clickSpy();
    };

    try {
      triggerBrowserDownload(
        "4 Sol Ring\n2 Arcane Signet",
        "Test-Deck.dec",
        "text/plain;charset=utf-8",
      );

      expect(createdUrl).toBe("blob:mock");
      expect(revokedUrl).toBe("blob:mock");
      expect(appendSpy).toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(removeSpy).toHaveBeenCalled();
    } finally {
      HTMLAnchorElement.prototype.click = originalClick;
      blobSpy.mockRestore();
      appendSpy.mockRestore();
      removeSpy.mockRestore();
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });
});