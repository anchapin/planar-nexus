/**
 * @fileOverview Shared utilities for decklist parsing and card operations
 *
 * These functions are shared between client and server card operations
 * to eliminate code duplication and ensure consistent behavior.
 */

import type { DeckCard } from "@/app/actions";
import { type Format } from "@/lib/game-rules";

/**
 * Decklist format types.
 *
 * Text-based formats are parsed directly from decklist text content:
 *  - "standard": free-form "Count Name" or just "Name"
 *  - "mtgo": "COUNT CARDNAME"
 *  - "json": serialized JSON card list
 *
 * URL-based formats are resolved through the /api/deck-import endpoint, which
 * fetches the deck and returns plain text that is re-parsed as "standard":
 *  - "moxfield": moxfield.com deck URLs
 *  - "archidekt": archidekt.com deck URLs
 *
 * The union is intentionally open: add a new site by extending this type and
 * registering a {@link DeckSiteInfo} entry in {@link DECK_SITES}.
 */
export type DecklistFormat =
  | "standard"
  | "mtgo"
  | "json"
  | "moxfield"
  | "archidekt";

/**
 * Formats that are parsed directly from decklist text content.
 */
export const TEXT_DECKLIST_FORMATS = ["standard", "mtgo", "json"] as const;

/**
 * Formats resolved through the deck-import API from a deck-hosting URL.
 */
export const URL_DECKLIST_FORMATS = ["moxfield", "archidekt"] as const;

/**
 * Shared contract for a format-specific decklist parser.
 *
 * Implement this interface to add support for a new text format. URL-based
 * formats register their site metadata through {@link DECK_SITES} instead,
 * since their parsing happens server-side.
 */
export interface DecklistParser {
  readonly format: DecklistFormat;
  parse: (input: string) => { name: string; quantity: number }[];
}

/**
 * Metadata describing a deck-hosting site, used by both the deck-import API
 * (for routing/fetching) and the import UI (for displaying supported sites).
 */
export interface DeckSiteInfo {
  readonly format: DecklistFormat;
  /** Human-readable site name shown in the UI. */
  readonly name: string;
  /** Hostname substring used to match the site (e.g. "moxfield.com"). */
  readonly host: string;
  /** Example URL shown as a placeholder in the import UI. */
  readonly exampleUrl: string;
  /** Extract the deck identifier from a supported URL, or null if unmatched. */
  extractId: (url: string) => string | null;
}

/**
 * Registry of supported deck-hosting sites. This is the single source of truth
 * consumed by both the import UI and the deck-import API route. Add a new site
 * by appending an entry here.
 */
export const DECK_SITES: readonly DeckSiteInfo[] = [
  {
    format: "standard",
    name: "MTGGoldfish",
    host: "mtggoldfish.com",
    exampleUrl: "https://www.mtggoldfish.com/deck/12345678",
    extractId: (url: string): string | null => {
      const match = url.match(/\/deck\/([^/?#]+)/i);
      return match ? match[1] : null;
    },
  },
  {
    format: "standard",
    name: "TappedOut",
    host: "tappedout.net",
    exampleUrl: "https://tappedout.net/mtg-decks/example-deck/",
    extractId: (url: string): string | null => {
      const match = url.match(/\/mtg-decks\/([^/?#]+)/i);
      return match ? match[1] : null;
    },
  },
  {
    format: "moxfield",
    name: "Moxfield",
    host: "moxfield.com",
    exampleUrl: "https://www.moxfield.com/decks/AbCdEfGhIjKl",
    extractId: (url: string): string | null => {
      // Handles /decks/{id}, /deck/{id}, and /deck/anonymous/{id}
      const match = url.match(
        /\/decks?\/(?:anonymous\/)?([A-Za-z0-9_-]+)/i,
      );
      return match ? match[1] : null;
    },
  },
  {
    format: "archidekt",
    name: "Archidekt",
    host: "archidekt.com",
    exampleUrl: "https://archidekt.com/decks/12345678",
    extractId: (url: string): string | null => {
      const match = url.match(/\/decks\/(\d+)/i);
      return match ? match[1] : null;
    },
  },
] as const;

/**
 * Detect which supported deck-hosting site a URL belongs to, if any.
 */
export function detectDeckSite(url: string): DeckSiteInfo | null {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    hostname = url.toLowerCase();
  }
  return DECK_SITES.find((site) => hostname.includes(site.host)) ?? null;
}

/**
 * Whether a URL points to a supported deck-hosting site.
 */
export function isSupportedDeckUrl(url: string): boolean {
  return detectDeckSite(url) !== null;
}

/**
 * Build a helpful suggestion message for an unsupported deck URL, recommending
 * the user export the decklist as text and use the Text/Clipboard import.
 */
export function getUnsupportedSiteSuggestion(url: string): string {
  const supported = DECK_SITES.map((s) => s.name).join(", ");
  const detected = detectDeckSite(url);
  if (detected) {
    // The host is known but we could not extract/parse the deck. Guide the user
    // to the text-export fallback.
    return `Could not parse the deck from ${detected.name}. Try exporting the decklist as text from the site and using the Text/Clipboard import option instead. Supported sites: ${supported}.`;
  }
  return `This site is not directly supported. Try exporting the decklist as text and using the Text/Clipboard import option instead. Directly supported sites: ${supported}.`;
}

/**
 * Error codes that can occur during decklist import.
 *
 * Structural codes (MALFORMED_LINE, INVALID_QUANTITY) are produced while
 * parsing text. Card-level codes (UNKNOWN_CARD, ILLEGAL_CARD) are produced
 * when resolving parsed names against the card database.
 */
export type ImportErrorCode =
  | "MALFORMED_LINE"
  | "INVALID_QUANTITY"
  | "UNKNOWN_CARD"
  | "ILLEGAL_CARD";

/**
 * Human-readable descriptions for each error code.
 */
export const IMPORT_ERROR_MESSAGES: Record<ImportErrorCode, string> = {
  MALFORMED_LINE: "Line could not be parsed",
  INVALID_QUANTITY: "Invalid or missing quantity",
  UNKNOWN_CARD: "Card not found in database",
  ILLEGAL_CARD: "Card is not legal in the selected format",
};

/**
 * A single import error tied to a specific decklist line.
 */
export interface ImportError {
  /** 1-based line number within the source decklist (0 if not line-specific). */
  line: number;
  /** The original, unmodified line content. */
  content: string;
  /** Machine-readable error code. */
  error: ImportErrorCode;
  /** Parsed card name, when one could be extracted. */
  cardName?: string;
  /** A suggested fix, e.g. "Did you mean: Lightning Bolt?". */
  suggestion?: string;
}

/**
 * A card name extracted from a decklist, annotated with its source location.
 */
export interface ParsedCardWithLine {
  name: string;
  quantity: number;
  /** 1-based line number within the source decklist. */
  line: number;
  /** The original, unmodified line content. */
  content: string;
}

/**
 * Outcome of parsing a single decklist line.
 * - `card`    : a valid card entry was extracted
 * - `skipped` : intentionally ignored (blank line, comment, section header)
 * - `error`   : the line looked like a card entry but could not be parsed
 */
export type LineParseOutcome =
  | { status: "card"; name: string; quantity: number }
  | { status: "skipped" }
  | { status: "error"; code: ImportErrorCode; reason: string };

/**
 * Arena-to-paper name aliases from Through the Omenpaths (OM1)
 * Generated from Scryfall API
 * When Wizards does not have digital rights for Universes Beyond cards,
 * they rename them for Arena using Omenpaths flavor.
 * Scryfall stores the Arena name in printed_name and the paper name in name.
 */
const ARENA_NAME_ALIASES: Record<string, string> = {
  "A Most Helpful Weaver": "Origin of Spider-Man",
  "A Trail of Teacups": "Kraven's Last Hunt",
  "Ademi of the Silkchutes": "Spectacular Spider-Man",
  "Aggressive Symbiosis": "Alien Symbiosis",
  "Alenni, Brood Recruiter": "Silk, Web Weaver",
  "Alessos and Pras, Acrobats": "Spider-Man India",
  "Ancestral Carvings": "Pictures of Spider-Man",
  "Angler's Shield": "Biorganic Carapace",
  Arachnomania: "Spider-Verse",
  "Arala, Hedron Scaler": "Beetle, Legacy Criminal",
  "Archangler's Skyrod": "Web-Shooters",
  "Argyr, Tidal Spinner": "Spider-Byte, Web Warden",
  "Bane-Marked Leonin": "Venomized Cat",
  "Basil, Cabaretti Loudmouth": "Flash Thompson, Spider-Fan",
  "Bayo, Irritable Instructor": "Electro, Assaulting Battery",
  "Belion, the Parched": "Hydro-Man, Fluid Felon",
  "Borys, the Spider Rider": "Scarlet Spider, Ben Reilly",
  "Brako, Heartless Hunter": "Kraven the Hunter",
  "Cactarantula Saddle": "Spider-Suit",
  "Caldaia Brawlers": "Inner Demons Gangsters",
  "Cam and Farrik, Havoc Duo": "Hobgoblin, Mantled Marauder",
  "Carlo, Suave Schemer": "Prowler, Clawed Thief",
  "Carriage of Dreams": "Passenger Ferry",
  "Chizak, Apex Arachnosaur": "Spider-Rex, Daring Dino",
  "Chosen by Valgavoth": "With Great Power . . .",
  "Cirina Bargainspinner": "Sun-Spider, Nimble Webber",
  "Clandestine Work": "Risky Research",
  "Confessor's Bindings": "Rent Is Due",
  "Crash, Reckless Endrider": "Shriek, Treblemaker",
  "Crime-Scene Instructor": "Selfless Police Captain",
  "Cruel Caracals": "Kraven's Cats",
  "Damning Caress": "Venom's Hunger",
  "Darval, Whose Web Protects": "Spider-Man, Web-Slinger",
  "Data Scrubber": "Mechanical Mobster",
  "Deathflame Burst": "Electro's Bolt",
  "Demera, Soul of a Spider": "Mary Jane Watson",
  "Desecrex, Gift of Servitude": "Carnage, Crimson Chaos",
  "Detect Intrusion": "Spider-Sense",
  "Diligent Webkeepers": "Web-Warriors",
  "Dreadfang, Loathed by Fans": "Kraven, Proud Predator",
  "Drix Interception": "Amazing Acrobatics",
  "Druneth, Reviver of the Hive": "Jackal, Genius Geneticist",
  "Duskmourn's Claim": "Parker Luck",
  "Eccentric Arachnologist": "Guy in the Chair",
  "Egrix the Bile Bulwark": "Gwenom, Remorseless",
  "Error-9, Viral Node": "Living Brain, Mechanical Marvel",
  "Exclusive Nightclub": "Oscorp Industries",
  "Eztli of the Thousand Moons": "Starling, Aerial Ally",
  Fateweaver: "Radioactive Spider",
  "Favored Fighter": "Professional Wrestler",
  "Fearsome Ridgeline": "Daily Bugle Building",
  "Fire-Brained Scheme": "Heroes' Hangout",
  "Fizik, Etherium Mechanic": "Iron Spider, Stark Upgrade",
  "Freestrider Aces": "Wild Pack Squad",
  "Full-Throttle Fanatic": "Taxi Driver",
  "Galvanized Workforce": "Angry Rabble",
  "Generous Betty Wray": "Silver Sable, Mercenary Leader",
  "Giantcraft Helm": "Doc Ock's Tentacles",
  "Gloria, the Great Armorer": "Araña, Heart of the Spider",
  "Goro Rel, Scourge to Spiders": "Spider-Slayer, Hatred Honed",
  "Hex of Undeath": "Behold the Sinister Six!",
  "Hide in Mundanity": "Spider-Man No More",
  "Janai and Hoppy, Roofskippers": "Spider-Girl, Legacy Hero",
  "Kavaero, Mind-Bitten": "Superior Spider-Man",
  "Kazuo, Ruthless Rival": "Shocker, Unshakable",
  "Kephon, Rage Incubator": "Stegron the Dinosaur Man",
  "King of the Coldblood Curse": "Lizard, Connors's Curse",
  "Kivni, Orb Weaver": "Scarlet Spider, Kaine",
  "Knife Trick": "Pumpkin Bombardment",
  "Kraza, the Swarm as One": "Spider-Punk",
  "Kroble, Envoy of the Bog": "Spider-Man Noir",
  "Kumonosu, the Watchful": "SP//dr, Piloted by Peni",
  "Lavaborn Goblins": "Raging Goblinoids",
  "Lavabrink Repels the Magmaloth": "Maximum Carnage",
  "Lazlo, Enthusiastic Accuser": "J. Jonah Jameson",
  "Leyline Weaver": "Spider Manifestation",
  "Lively Leap": "Thwip!",
  "Lost in Littjara": "The Clone Saga",
  "Luis, Pompous Pillager": "Morlun, Devourer of Spiders",
  "Makdee and Itla, Skysnarers": "Spider-Woman, Stunning Savior",
  "Margot, On the Case": "Wraith, Vicious Vigilante",
  "Merata, Neuron Hacker": "Lady Octopus, Inspired Inventor",
  "Miasmic Mist": "Sandman's Quicksand",
  "Mothwing Shroud": "Web Up",
  "Neach, Pinnacle Pariah": "Doctor Octopus, Master Planner",
  "Nill, Vessel of Valgavoth": "Tombstone, Career Criminal",
  "Nu and Sumi, Career Criminals": "Green Goblin, Revenant",
  "Obscura Alleylurkers": "Doc Ock's Henchmen",
  "Olx, Mouth to Many Eyes": "Madame Web, Clairvoyant",
  "Opulent Valet": "News Helicopter",
  "Orris, Last of the Web Lords": "Ezekiel Sims, Spider-Totem",
  "Outsmart the Amateur": "School Daze",
  "Ozor, Chronicler of Collapse": "Doc Ock, Sinister Scientist",
  "Perfected Pastry": "Bagel and Schmear",
  "Perilous Lunge": "Kapow!",
  "Phantasmal Vision": "Mysterio's Phantasm",
  "Phenomena Recorder": "Peter Parker's Camera",
  "Pinnacle Research Team": "Oscorp Research Team",
  "Principled Referee": "Daily Bugle Reporters",
  "Qoneus, Horizon Splicer": "The Spot, Living Portal",
  "Quint's Insight": "Shadow of the Goblin",
  "Reality Fulcrum": "Interdimensional Web Watch",
  "Remarkable Readings": "Friendly Neighborhood",
  "Remorseless Coup": "The Spot's Portal",
  "Restless Razorkin": "Superior Foes of Spider-Man",
  "Rhilex the Accursed": "Agent Venom",
  "Rishei, Getaway Accomplice": "Vulture, Scheming Scavenger",
  "Rizna, the Spider-Crowned": "Spinneret and Spiderling",
  "Rouse the Swarm": "Wall Crawl",
  "Ruzic, Booed but Victorious": "Ultimate Green Goblin",
  "Sadistic String-Puller": "Spider-Islanders",
  "Sarn of the Silken Throne": "Spider-UK",
  "Scions of the Ur-Spider": "Cosmic Spider-Man",
  "Scorvus Ames, Crimelord": "Scorpion, Seething Striker",
  "Scuttling Spidercoach": "Spider-Mobile",
  "Selesnya Archivist": "Damage Control Crew",
  "Skittering Kitten": "Masked Meower",
  "Skv'x the Augmenter": "Symbiote Spider-Man",
  "Snatch Back": "Whoosh!",
  "Spectral Restitching": "Hide on the Ceiling",
  "Steelweb Surveyor": "Spider-Bot",
  "Stitcher's Wings": "Rocket-Powered Goblin Glider",
  "Tarantusk, Unwisely Awoken": "Spider-Ham, Peter Porker",
  "Tearle, Entropic Hunger": "Morbius the Living Vampire",
  "Temple Trap": "Steel Wrecking Ball",
  "Tethex, Gift of Malice": "Venom, Evil Unleashed",
  "The Clutter Cluster": "Spiders-Man, Heroic Horde",
  "The House Grows Hungry": "The Death of Gwen Stacy",
  "The Infernus": "Molten Man, Inferno Incarnate",
  "The Scouring Stormsoul": "Sandman, Shifting Scoundrel",
  "The Terminus of Return": "The Soul Stone",
  "The Watcher on the Road": "Mysterio, Master of Illusion",
  "Through the Omenpath": "Web of Life and Destiny",
  "Treat Trolley": "Hot Dog Cart",
  "Uharis, the Stormspinner": "Spider-Man 2099",
  "Vazin, Two-Faced Trickster": "Chameleon, Master of Disguise",
  "Verilax the Havenskin": "Anti-Venom, Horrifying Healer",
  "Vexed Bots": "Flying Octobot",
  "Vinewoven Chariot": "Subway Train",
  "Wardens of Silverweb Summit": "Spider-Gwen, Free Spirit",
  "Wekhdu, Midnight Hunter": "Swarm, Being of Bees",
  "Withar, Cocoon Keeper": "Mister Negative",
  "Wonderweave Aerialist": "Skyward Spider",
  "Wrench, Speedway Saboteur": "Black Cat, Cunning Thief",
  "Xecau, Predation's Shadow": "Rhino, Barreling Brute",
  "Yera and Oski, Weaver and Guide": "Arachne, Psionic Weaver",
  "Zan, Tunnelweb Explorer": "Spider-Man, Brooklyn Visionary",
  "Zora, Spider Fancier": "Aunt May",
};

/**
 * Parse a single line from a decklist
 * Handles formats like "4 Lightning Bolt" or just "Lightning Bolt"
 */
export function parseDecklistLine(
  line: string,
): { name: string; quantity: number } | null {
  const trimmedLine = line.trim();
  if (!trimmedLine) return null;

  // Pattern for "Quantity Name" or just "Name"
  const match = trimmedLine.match(/^(?:(\d+)\s*x?\s*)?(.+)/);
  if (!match) return null;

  const skipHeaders = [
    "sideboard",
    "deck",
    "about",
    "name",
    "mainboard",
    "maybeboard",
  ];
  let name = match[2]?.trim();
  if (!name || /^\/\//.test(name) || skipHeaders.includes(name.toLowerCase())) {
    return null;
  }

  // Strip set codes and collector numbers like "Sol Ring (CMR) 632" or "Sol Ring [CMR] 632"
  // This is common in Moxfield and Arena exports
  name = name.replace(/\s*[([][A-Z0-9]{3,4}[)\]]\s*\d+.*$/i, "").trim();

  // Also handle cases without collector number like "Sol Ring (CMR)"
  name = name.replace(/\s*[([][A-Z0-9]{3,4}[)\]]\s*$/i, "").trim();

  // Normalize DFC separators: some exports use "/" instead of " // "
  // e.g., "Roaring Furnace/Steaming Sauna" -> "Roaring Furnace // Steaming Sauna"
  if (name.includes("/") && !name.includes(" // ")) {
    name = name.replace(/\s*\/\s*/g, " // ");
  }

  // Translate Arena-only names to their paper equivalents
  if (ARENA_NAME_ALIASES[name]) {
    name = ARENA_NAME_ALIASES[name];
  }

  const count = parseInt(match[1] || "1", 10);
  return { name, quantity: count };
}

/**
 * Parse a single decklist line, distinguishing *why* a line was skipped.
 *
 * Unlike {@link parseDecklistLine} (which collapses every non-card line into
 * `null`), this returns a structured outcome so callers can report
 * structural errors (e.g. invalid quantities) to the user.
 *
 * Section headers, comments, and blank lines report `skipped` (not an error).
 */
export function parseDecklistLineWithErrors(line: string): LineParseOutcome {
  const trimmedLine = line.trim();
  if (!trimmedLine) return { status: "skipped" };

  const match = trimmedLine.match(/^(?:(\d+)\s*x?\s*)?(.+)/);
  if (!match) return { status: "error", code: "MALFORMED_LINE", reason: "Unrecognized line format" };

  const skipHeaders = [
    "sideboard",
    "deck",
    "about",
    "name",
    "mainboard",
    "maybeboard",
  ];
  let name = match[2]?.trim();
  if (!name) {
    return { status: "error", code: "MALFORMED_LINE", reason: "No card name" };
  }
  if (/^\/\//.test(name) || skipHeaders.includes(name.toLowerCase())) {
    return { status: "skipped" };
  }

  // Validate quantity before mutating the name so an invalid count is reported
  // against the original spelling.
  const rawCount = match[1];
  if (rawCount !== undefined) {
    const parsed = Number(rawCount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return {
        status: "error",
        code: "INVALID_QUANTITY",
        reason: `Quantity "${rawCount}" is not a positive integer`,
      };
    }
  }

  // Strip set codes and collector numbers like "Sol Ring (CMR) 632" or "Sol Ring [CMR] 632"
  // This is common in Moxfield and Arena exports
  name = name.replace(/\s*[([][A-Z0-9]{3,4}[)\]]\s*\d+.*$/i, "").trim();

  // Also handle cases without collector number like "Sol Ring (CMR)"
  name = name.replace(/\s*[([][A-Z0-9]{3,4}[)\]]\s*$/i, "").trim();

  if (!name) {
    return { status: "error", code: "MALFORMED_LINE", reason: "Line reduced to empty after stripping set codes" };
  }

  // Normalize DFC separators: some exports use "/" instead of " // "
  if (name.includes("/") && !name.includes(" // ")) {
    name = name.replace(/\s*\/\s*/g, " // ");
  }

  // Translate Arena-only names to their paper equivalents
  if (ARENA_NAME_ALIASES[name]) {
    name = ARENA_NAME_ALIASES[name];
  }

  const count = parseInt(match[1] || "1", 10);
  return { status: "card", name, quantity: count };
}

/**
 * Parse MTGO format line
 * MTGO format: "COUNT CARDNAME" (e.g., "4 Sol Ring" or "4x Sol Ring")
 */
export function parseMTGOLine(
  line: string,
): { name: string; quantity: number } | null {
  const trimmedLine = line.trim();
  if (!trimmedLine) return null;

  // MTGO format: "4 Sol Ring" or "4x Sol Ring"
  const match = trimmedLine.match(/^(\d+)(?:x)?\s+(.+)/);
  if (!match) return null;

  let name = match[2]?.trim();
  if (!name) return null;

  // Strip set codes and collector numbers
  name = name.replace(/\s*[([][A-Z0-9]{3,4}[)\]]\s*\d+.*$/i, "").trim();
  name = name.replace(/\s*[([][A-Z0-9]{3,4}[)\]]\s*$/i, "").trim();

  // Normalize DFC separators
  if (name.includes("/") && !name.includes(" // ")) {
    name = name.replace(/\s*\/\s*/g, " // ");
  }

  // Translate Arena-only names to their paper equivalents
  if (ARENA_NAME_ALIASES[name]) {
    name = ARENA_NAME_ALIASES[name];
  }

  const count = parseInt(match[1], 10);
  return { name, quantity: count };
}

/**
 * Parse JSON decklist
 */
export function parseJSONDecklist(
  json: string,
): { name: string; quantity: number }[] {
  try {
    const data = JSON.parse(json);

    // Handle different JSON structures
    if (Array.isArray(data)) {
      // Direct array: [{"name": "Sol Ring", "quantity": 4}]
      return data
        .filter((card) => card?.name && typeof card.quantity === "number")
        .map((card) => ({ name: card.name, quantity: card.quantity }));
    }

    if (data?.cards && Array.isArray(data.cards)) {
      // Object with cards array: {"cards": [...]}
      return data.cards
        .filter((card: any) => card?.name && typeof card.quantity === "number")
        .map((card: any) => ({ name: card.name, quantity: card.quantity }));
    }

    return [];
  } catch (error) {
    return [];
  }
}

/**
 * Split decklist into non-empty lines
 * @returns Array of non-empty lines
 */
export function splitDecklist(decklist: string): string[] {
  return decklist.split("\n").filter((line) => line.trim() !== "");
}

/**
 * Sanitize and aggregate card input for validation
 * @returns Map of normalized card names to aggregated quantities, plus any malformed inputs
 */
export function sanitizeCardInput(
  cards: Array<{ name: string; quantity: number }>,
): {
  cardMap: Map<string, { originalName: string; quantity: number }>;
  malformedInputs: string[];
} {
  const cardRequestMap = new Map<
    string,
    { originalName: string; quantity: number }
  >();
  const malformedInputs: string[] = [];

  for (const card of cards) {
    if (
      !card ||
      typeof card.name !== "string" ||
      card.name.trim() === "" ||
      typeof card.quantity !== "number" ||
      card.quantity <= 0
    ) {
      malformedInputs.push(card?.name || "Malformed Input");
      continue;
    }
    const lowerCaseName = card.name.toLowerCase();
    const existing = cardRequestMap.get(lowerCaseName);
    if (existing) {
      existing.quantity += card.quantity;
    } else {
      cardRequestMap.set(lowerCaseName, {
        originalName: card.name,
        quantity: card.quantity,
      });
    }
  }

  return { cardMap: cardRequestMap, malformedInputs };
}

/**
 * Aggregate cards by their ID to combine different prints of same card
 */
export function aggregateCardsById<T extends { id: string; count: number }>(
  cards: T[],
): T[] {
  return Array.from(
    cards
      .reduce((acc, card) => {
        const existing = acc.get(card.id);
        if (existing) {
          existing.count += card.count;
        } else {
          acc.set(card.id, { ...card });
        }
        return acc;
      }, new Map<string, T>())
      .values(),
  );
}

/**
 * Parse decklist string into card details with format detection
 * @returns Array of parsed card details
 */
export function parseDecklist(
  decklist: string,
  format: DecklistFormat = "standard",
): { name: string; quantity: number }[] {
  if (format === "json") {
    return parseJSONDecklist(decklist);
  }

  // URL-based formats ("moxfield", "archidekt") are resolved by the
  // deck-import API into plain "Count Name" text before reaching this parser,
  // so their text content is parsed as standard text. This keeps the format
  // union extensible without breaking the text parser for callers that pass a
  // resolved decklist.
  const lines = splitDecklist(decklist);
  if (lines.length === 0) {
    return [];
  }

  const cardDetails: { name: string; quantity: number }[] = [];
  const parseFn = format === "mtgo" ? parseMTGOLine : parseDecklistLine;

  for (const line of lines) {
    const parsed = parseFn(line);
    if (parsed) {
      cardDetails.push(parsed);
    }
  }

  return cardDetails;
}

/**
 * Detect decklist format from content
 */
export function detectDecklistFormat(decklist: string): DecklistFormat {
  const trimmed = decklist.trim();

  // Try JSON first
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      JSON.parse(trimmed);
      return "json";
    } catch {
      // Not valid JSON, continue detection
    }
  }

  // Check for MTGO format (lines starting with number followed by card name)
  const lines = splitDecklist(decklist);
  const mtgoPattern = /^\d+x?\s+[A-Z]/i;
  const mtgoLines = lines.filter((line) => mtgoPattern.test(line));

  if (mtgoLines.length > lines.length * 0.5) {
    return "mtgo";
  }

  return "standard";
}

/**
 * Parse a decklist into cards (with source line numbers) and structural errors.
 *
 * JSON input cannot produce line-level errors and is returned with `line: 0`
 * entries; structural errors are only reported for text formats.
 *
 * @returns parsed cards annotated with line numbers, plus any structural errors
 */
export function parseDecklistWithErrors(
  decklist: string,
  format: DecklistFormat = "standard",
): { cards: ParsedCardWithLine[]; errors: ImportError[] } {
  if (format === "json") {
    const jsonCards = parseJSONDecklist(decklist);
    const cards: ParsedCardWithLine[] = jsonCards.map((card, index) => ({
      name: card.name,
      quantity: card.quantity,
      line: index + 1,
      content: `${card.quantity} ${card.name}`,
    }));
    return { cards, errors: [] };
  }

  const lines = decklist.split("\n");
  const cards: ParsedCardWithLine[] = [];
  const errors: ImportError[] = [];

  lines.forEach((line, index) => {
    if (line.trim() === "") return; // preserve original line numbering only for non-blank lines
    const outcome = parseDecklistLineWithErrors(line);
    const lineNumber = index + 1;

    if (outcome.status === "card") {
      cards.push({
        name: outcome.name,
        quantity: outcome.quantity,
        line: lineNumber,
        content: line,
      });
    } else if (outcome.status === "error") {
      errors.push({
        line: lineNumber,
        content: line,
        error: outcome.code,
        suggestion: outcome.reason,
      });
    }
    // `skipped` outcomes (comments, headers, blanks) produce no output
  });

  return { cards, errors };
}

/**
 * Compute the Levenshtein edit distance between two strings.
 * Used to power "Did you mean?" suggestions without a database dependency.
 */
export function levenshteinDistance(a: string, b: string): number {
  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();
  const m = aLower.length;
  const n = bLower.length;

  if (m === 0) return n;
  if (n === 0) return m;

  const previousRow = Array.from({ length: n + 1 }, (_, i) => i);
  const currentRow = new Array<number>(n + 1);

  for (let i = 1; i <= m; i++) {
    currentRow[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = aLower[i - 1] === bLower[j - 1] ? 0 : 1;
      currentRow[j] = Math.min(
        previousRow[j] + 1, // deletion
        currentRow[j - 1] + 1, // insertion
        previousRow[j - 1] + cost, // substitution
      );
    }
    previousRow.splice(0, n + 1, ...currentRow);
  }

  return previousRow[n];
}

/**
 * Find the closest matching card name from a list of known names.
 *
 * Returns the best candidate whose normalized edit distance is within
 * `maxDistanceRatio` (default 0.34) of the input length, or `undefined`
 * when nothing is close enough. This is a pure, database-independent
 * fallback used to build "Did you mean?" suggestions.
 *
 * @param name        The misspelled / unknown card name
 * @param candidates  Known card names to search among
 * @param maxDistanceRatio  Maximum edit distance as a fraction of `name.length`
 */
export function findClosestNameMatch(
  name: string,
  candidates: string[],
  maxDistanceRatio = 0.34,
): string | undefined {
  if (!name || candidates.length === 0) return undefined;

  let bestName: string | undefined;
  let bestDistance = Infinity;
  const threshold = Math.max(1, Math.ceil(name.length * maxDistanceRatio));

  for (const candidate of candidates) {
    const distance = levenshteinDistance(name, candidate);
    if (
      distance < bestDistance ||
      (distance === bestDistance && candidate.length < (bestName?.length ?? Infinity))
    ) {
      bestDistance = distance;
      bestName = candidate;
    }
  }

  if (!bestName || bestDistance > threshold) return undefined;
  return bestName;
}

/**
 * Build a human-readable "Did you mean?" suggestion string.
 * Returns `undefined` when no suggestion is available.
 */
export function buildSuggestion(match?: string): string | undefined {
  return match ? `Did you mean: ${match}?` : undefined;
}
