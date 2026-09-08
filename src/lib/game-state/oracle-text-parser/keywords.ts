/**
 * Keyword extraction from Oracle text into structured ParsedKeyword records.
 *
 * Mechanically extracted from oracle-text-parser.ts (issue #1725);
 * behavior pinned by the existing engine suites.
 */

/**
 * Keyword ability with its type
 */
export interface ParsedKeyword {
  keyword: string;
  type: "evergreen" | "mechanic" | "abilityWord";
  subType?: string;
  parameters?: Record<string, string | number>;
}

/**
 * Extract keywords from Oracle text and type line
 */
export function extractKeywords(
  oracleText: string,
  typeLine: string,
): ParsedKeyword[] {
  const keywords: ParsedKeyword[] = [];
  const combinedText = `${typeLine} ${oracleText}`.toLowerCase();

  // Evergreen keywords (CR 702)
  const evergreenKeywords = [
    "flying",
    "first strike",
    "double strike",
    "deathtouch",
    "defender",
    "enchant",
    "equip",
    "flash",
    "flying",
    "haste",
    "hexproof",
    "indestructible",
    "lifeline",
    "lifelink",
    "menace",
    "reach",
    "trample",
    "vigilance",
    "ward",
    "banding",
    "protection",
    "shadow",
    " phasing",
    "flanking",
    "fear",
    "intimidate",
    "landwalk",
    "lure",
    "provoke",
    "rampage",
    "reacher",
    "suffix",
    "swipe",
    "wither",
    "bestow",
    "crew",
    "crewmate",
    "fabricate",
    "fight",
    "fusillade",
    "hexproof from",
    "improvise",
    "infect",
    "mentor",
    "miracle",
    "morph",
    "mutate",
    "ninjutsu",
    "outlast",
    "overload",
    "prowess",
    "raid",
    "renown",
    "revolt",
    "splice",
    "split second",
    "storm",
    "support",
    "surge",
    "surveil",
    "transform",
    "tribute",
    "undaunted",
    "corpse",
  ];

  for (const keyword of evergreenKeywords) {
    if (combinedText.includes(keyword)) {
      keywords.push({
        keyword,
        type: "evergreen",
      });
    }
  }

  // Check for ability words (italicized keywords that don't have rules meaning)
  const abilityWords = [
    "landfall",
    "raid",
    "revolt",
    "metalcraft",
    "converge",
    "cohort",
    "join forces",
    "parley",
    "will of the council",
    "assemble",
    "battle cry",
    "bloodrush",
    "channel",
    "chroma",
    "domain",
    "eked",
    "fateful hour",
    "ferocious",
    "grandeur",
    "hellbent",
    "heroic",
    "inspired",
    "join forces",
    "kinfall",
    "landfall",
    "lieutenant",
    "might of the nations",
    "miracle",
    "morbid",
    "pack tactics",
    "radiance",
    "raid",
    "rally",
    "revolt",
    "shield",
    "soulbond",
    "strength in numbers",
    "tempting offer",
    "threshold",
    "underdog",
    "undergrowth",
  ];

  for (const word of abilityWords) {
    if (combinedText.includes(word)) {
      keywords.push({
        keyword: word,
        type: "abilityWord",
      });
    }
  }

  // Non-evergreen mechanic keywords (CR 702). These are deciduous and
  // set-specific mechanics recognized in Standard-legal oracle text.
  // Extended for Standard mechanic coverage (issue #1093). Detection is purely
  // additive substring matching, consistent with the lists above; results are
  // categorized as "mechanic".
  const nonEvergreenKeywords = [
    "prototype", // CR 702.152
    // Deciduous mechanics
    "cycling",
    "flashback",
    "foretell", // CR 702.142
    "kicker",
    "convoke",
    "proliferate",
    // Set-specific mechanics
    "explore",
    "investigate",
    "food",
    "learn",
    "disguise",
    "disguised",
    "plot",
    "offspring",
    "gift",
    "saddle",
    "descend",
    "craft",
    "suspect",
    "survival",
    "valiant",
    "bargain",
    "celebration",
    "connive",
    "casualty",
    "backup",
    "blitz",
    "incubate",
    "training",
    "compleated",
    "enlist",
    "reconfigure",
    "undying",
    "persist",
    "unleash",
    "cascade",
    "delirium",
    "decayed",
    "cloak",
    "eerie",
    "endure",
    "forage",
    "harmonize",
    "flurry",
    "manifest dread",
    "spree",
    "treasure",
    "adventure",
    "dash",
    "embalm",
    "escape",
    "evoke",
    "exert",
    "formidable",
    "hideaway",
    "meld",
    "modular",
    "populate",
    "rebound",
    "scavenge",
    "spectacle",
    "suspend",
    "totem armor",
    "myriad",
    "skulk",
    "frenzy",
    "goad",
    "haunt",
    "imprint",
    "living weapon",
    "offering",
    "sunburst",
    "strive",
    "vanishing",
    "dungeon",
    "affinity",
    "annihilator",
    "bloodthirst",
    "conspire",
    "devour",
    "level up",
    "soulbond",
    "extort",
    "dethrone",
    "hidden agenda",
    "delve",
    "exploit",
    "entwine",
    "transmute",
    "transfigure",
    "graft",
    "kinship",
    "fathomless descent",
    "start your engines",
    "max speed",
    "toxic",
    "read ahead",
    "role",
    "room",
    // Ability words that appear in Standard (detected as mechanics; the
    // category is not asserted by callers)
    "expend",
    "for miracle",
    "readiness",
    "slug",
    "magecraft",
    "solved",
    "coven",
  ];

  for (const keyword of nonEvergreenKeywords) {
    if (combinedText.includes(keyword.toLowerCase())) {
      keywords.push({
        keyword,
        type: "mechanic",
      });
    }
  }

  // Remove duplicates
  const uniqueKeywords = keywords.filter(
    (item, index, self) =>
      index === self.findIndex((t) => t.keyword === item.keyword),
  );

  return uniqueKeywords;
}

