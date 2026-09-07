/**
 * @fileOverview Heuristic metagame analysis for Magic: The Gathering
 *
 * This module provides offline metagame analysis using rule-based heuristics
 * and format-specific data instead of AI API calls.
 * Works entirely client-side for offline support.
 */

import type { DeckCard } from "@/lib/card-database";

// Output types matching the original AI meta analysis
export interface MetaAnalysisOutput {
  currentMeta: string;
  archetypes: Array<{
    name: string;
    prevalence: string;
    playstyle: string;
    keyCards: string[];
    weaknesses: string[];
  }>;
  recommendations: Array<{
    title: string;
    description: string;
    cardsToAdd: Array<{ name: string; quantity: number }>;
    cardsToRemove: Array<{ name: string; quantity: number }>;
    matchup: {
      against: string;
      strategy: string;
    };
  }>;
  /**
   * Optional structured result from the heuristic archetype-detection engine
   * (issue #1564). Always populated by the heuristic engine; LLM-enriched
   * outputs simply omit it because the LLM does not see this shape. The
   * meta-analysis display uses `confidence.level` to render a weak-signal
   * badge when the detection is uncertain.
   */
  deckArchetypeDetection?: ArchetypeDetectionResult;
}

// Format-specific metagame data
const FORMAT_META: Record<
  string,
  Array<{
    name: string;
    prevalence: string;
    playstyle: string;
    keyCards: string[];
    weaknesses: string[];
  }>
> = {
  commander: [
    {
      name: "Control",
      prevalence: "High",
      playstyle:
        "Slow the game and control the board with removal and counterspells",
      keyCards: [
        "Counterspell",
        "Force of Will",
        "Cyclonic Rift",
        "Teferi's Protection",
        "Mana Drain",
      ],
      weaknesses: ["Fast aggro", "Asymmetrical disruption", "Graveyard hate"],
    },
    {
      name: "Voltron",
      prevalence: "Medium",
      playstyle: "Equip the commander and attack quickly",
      keyCards: [
        "Swiftfoot Boots",
        "Whispersilk Cloak",
        "Hero's Blade",
        "Sword of the Animist",
        "Colossus Hammer",
      ],
      weaknesses: ["Creature removal", "Mass removal", "Tuck effects"],
    },
    {
      name: "Storm Combo",
      prevalence: "Medium",
      playstyle: "Generate massive mana and storm count to win",
      keyCards: [
        "Ad Nauseam",
        "Tendrils of Agony",
        "Mind's Desire",
        "Past in Flames",
        "Mana Crypt",
      ],
      weaknesses: ["Counterspells", "Graveyard hate", "Rule of Law effects"],
    },
    {
      name: "Stax",
      prevalence: "Medium",
      playstyle: "Tax and restrict opponents' resources",
      keyCards: [
        "Static Orb",
        "Stasis",
        "Armageddon",
        "Winter Orb",
        "Torpor Orb",
      ],
      weaknesses: ["Mana dorks", "Counterspells", "Artifact hate"],
    },
    {
      name: "Midrange Value",
      prevalence: "High",
      playstyle: "Play efficient threats and generate card advantage",
      keyCards: [
        "Rishkar's Expertise",
        "Eternal Witness",
        "Birthing Pod",
        "Meren of Clan Nel Toth",
        "Greenwarden of Murasa",
      ],
      weaknesses: ["Counterspells", "Combo decks", "Mass removal"],
    },
    {
      name: "Tokens",
      prevalence: "Medium",
      playstyle: "Create armies of creature tokens",
      keyCards: [
        "Anointed Procession",
        "Parallel Lives",
        "Intangible Virtue",
        "Secure the Wastes",
        "Avenger of Zendikar",
      ],
      weaknesses: ["Mass removal", "Flying", "Creature protection"],
    },
  ],
  modern: [
    {
      name: "Rakdos Scam",
      prevalence: "High",
      playstyle: "Cast huge threats early using Grief and Fury",
      keyCards: [
        "Grief",
        "Fury",
        "Pitch Spice",
        "Undying Evil",
        "Street Wraith",
      ],
      weaknesses: ["Graveyard hate", "Counterspells", "Direct removal"],
    },
    {
      name: "Burn",
      prevalence: "Medium",
      playstyle: "Deal 20 damage as fast as possible",
      keyCards: [
        "Lightning Bolt",
        "Boros Charm",
        "Goblin Guide",
        "Eidolon of the Great Revel",
        "Monastery Swiftspear",
      ],
      weaknesses: ["Lifegain", "Counterspells", "Aggressive creatures"],
    },
    {
      name: "Hammer Time",
      prevalence: "High",
      playstyle: "Equip Colossus Hammer and attack quickly",
      keyCards: [
        "Colossus Hammer",
        "Sigarda's Aid",
        "Urchin",
        "Emry, Lurker of the Loch",
        "Urza's Saga",
      ],
      weaknesses: ["Artifact hate", "Flying", "Mass removal"],
    },
    {
      name: "Izzet Tempo",
      prevalence: "Medium",
      playstyle: "Play efficient threats and counter spells",
      keyCards: [
        "Dragon's Rage Channeler",
        "Expressive Iteration",
        "Counterspell",
        "Lightning Bolt",
        "Galvanic Iteration",
      ],
      weaknesses: ["Graveyard hate", "Fast aggro", "Counterspells"],
    },
    {
      name: "Amulet Titan",
      prevalence: "Low",
      playstyle: "Primeval Titan with Amulet of Vigor",
      keyCards: [
        "Primeval Titan",
        "Amulet of Vigor",
        "Summer Bloom",
        "Sakura-Tribe Scout",
        "Azusa, Lost but Seeking",
      ],
      weaknesses: ["Land destruction", "Counterspells", "Graveyard hate"],
    },
    {
      name: "Tron",
      prevalence: "Medium",
      playstyle: "Tron lands for big mana threats",
      keyCards: [
        "Karn Liberated",
        "Ugin, the Spirit Dragon",
        "Wurmcoil Engine",
        "Pyroclasm",
        "Oblivion Stone",
      ],
      weaknesses: ["Land destruction", "Aggro", "Counterspells"],
    },
  ],
  standard: [
    {
      name: "Rakdos Midrange",
      prevalence: "High",
      playstyle: "Discard and destroy with efficient threats",
      keyCards: [
        "Thoughtseize",
        "Sheoldred, the Apocalypse",
        "Abrade",
        "Chandra, Torch of Defiance",
        "Fable of the Mirror-Breaker",
      ],
      weaknesses: ["Counterspells", "Graveyard hate", "Flying"],
    },
    {
      name: "Esper Legends",
      prevalence: "Medium",
      playstyle: "Play legendary permanents for value",
      keyCards: [
        "Kaito, Bane of Nightmares",
        "The Wandering Emperor",
        "Kaito Shizuki",
        "Lands",
        "Legends",
      ],
      weaknesses: ["Legend rule", "Artifact hate", "Counterspells"],
    },
    {
      name: "Azorius Control",
      prevalence: "High",
      playstyle: "Control the board and win with planeswalkers",
      keyCards: [
        "Teferi, Time Raveler",
        "Narset of the Ancient Way",
        "Absorb",
        "Deputy of Detention",
        "Settle the Wreckage",
      ],
      weaknesses: ["Hexproof", "Combo", "Aggro"],
    },
    {
      name: "Mono-Red Aggro",
      prevalence: "Medium",
      playstyle: "Fast red creatures with burn",
      keyCards: [
        "Phoenix",
        "Ritual of Soot",
        "Kumano Faces Kakkazan",
        "Reinforced Ronin",
        "Bonecrusher Giant",
      ],
      weaknesses: ["Lifegain", "Mass removal", "Counterspells"],
    },
    {
      name: "Bant Midrange",
      prevalence: "Medium",
      playstyle: "Green-white value with blue interaction",
      keyCards: [
        "Raffine, Scheming Seer",
        "Sheoldred's Edict",
        "March of Wretched Sorrow",
        "Lands",
        "Value engines",
      ],
      weaknesses: ["Aggro", "Combo", "Graveyard hate"],
    },
    {
      name: "Gruul Aggro",
      prevalence: "Medium",
      playstyle: "Fast green-red creatures",
      keyCards: [
        "Questing Beast",
        "Domri, Anarch of Bolas",
        "Cinder Glade",
        "Wrenn and Six",
        "Blast Zone",
      ],
      weaknesses: ["Counterspells", "Flying", "Mass removal"],
    },
  ],
  pioneer: [
    {
      name: "Mono-White Aggro",
      prevalence: "High",
      playstyle: "Fast white creatures with pump spells",
      keyCards: [
        "Kor Blademaster",
        "Gideon's Company",
        "Valiant Veteran",
        "Selfless Savior",
        "Mantle of the Ancients",
      ],
      weaknesses: ["Mass removal", "Flying", "Counterspells"],
    },
    {
      name: "Azorius Control",
      prevalence: "Medium",
      playstyle: "Control the board with counterspells and removal",
      keyCards: [
        "Control Magic",
        "Teferi, Time Raveler",
        "Memory Deluge",
        "Deputy of Detention",
        "Absorb",
      ],
      weaknesses: ["Hexproof", "Combo", "Fast aggro"],
    },
    {
      name: "Rakdos Midrange",
      prevalence: "High",
      playstyle: "Discard and destroy with efficient threats",
      keyCards: [
        "Sheoldred, the Apocalypse",
        "Thoughtseize",
        "Abrade",
        "Chandra, Torch of Defiance",
        "Fatal Push",
      ],
      weaknesses: ["Counterspells", "Graveyard hate", "Flying"],
    },
    {
      name: "Niv-Mizzet Paradox",
      prevalence: "Medium",
      playstyle: "Niv-Mizzet Reborn with Paradox Engine",
      keyCards: [
        "Niv-Mizzet Reborn",
        "Paradox Engine",
        "Wilderness Reclamation",
        "Karn, the Great Creator",
        "Ugin, the Spirit Dragon",
      ],
      weaknesses: ["Artifact hate", "Counterspells", "Graveyard hate"],
    },
    {
      name: "Abzan Midrange",
      prevalence: "Medium",
      playstyle: "Green-white-black value",
      keyCards: [
        "Vraska, Golgari Queen",
        "Vraska's Contempt",
        "Wildgrowth Walker",
        "Questing Beast",
        "Knight of the Ebon Legion",
      ],
      weaknesses: ["Aggro", "Combo", "Graveyard hate"],
    },
  ],
  legacy: [
    {
      name: "Sultai Control",
      prevalence: "High",
      playstyle: "Brainstorm and Ponder with value engines",
      keyCards: [
        "Brainstorm",
        "Ponder",
        "Force of Will",
        "Uro, Titan of Nature's Wrath",
        "Veil of Summer",
      ],
      weaknesses: ["Aggro", "Combo", "Graveyard hate"],
    },
    {
      name: "Delver",
      prevalence: "Medium",
      playstyle: "Delver of Secrets with efficient blue spells",
      keyCards: [
        "Delver of Secrets",
        "Brainstorm",
        "Ponder",
        "Force of Will",
        "Lightning Bolt",
      ],
      weaknesses: ["Mass removal", "Graveyard hate", "Counterspells"],
    },
    {
      name: "Storm",
      prevalence: "Medium",
      playstyle: "Generate massive storm count",
      keyCards: [
        "Brainstorm",
        "Ponder",
        "Lion's Eye Diamond",
        "Tendrils of Agony",
        "Past in Flames",
      ],
      weaknesses: ["Counterspells", "Graveyard hate", "Rule of Law effects"],
    },
    {
      name: "Reanimator",
      prevalence: "Medium",
      playstyle: "Reanimate big creatures quickly",
      keyCards: [
        "Entomb",
        "Animate Dead",
        "Griselbrand",
        "Ashen Rider",
        "Tidespout Tyrant",
      ],
      weaknesses: ["Graveyard hate", "Counterspells", "Exile effects"],
    },
    {
      name: "Elves",
      prevalence: "Medium",
      playstyle: "Elf tribal with massive board presence",
      keyCards: [
        "Elves of Deep Shadow",
        "Heritage Druid",
        "Elvish Archdruid",
        "Craterhoof Behemoth",
        "Wirewood Symbiote",
      ],
      weaknesses: ["Mass removal", "Graveyard hate", "Counterspells"],
    },
  ],
  vintage: [
    {
      name: "Paradoxical Outcome",
      prevalence: "High",
      playstyle: "Paradoxical Outcome with artifacts",
      keyCards: [
        "Paradoxical Outcome",
        "Moxen",
        "Black Lotus",
        "Ancestral Recall",
        "Time Walk",
      ],
      weaknesses: ["Artifact hate", "Graveyard hate", "Force of Will"],
    },
    {
      name: "Grixis Control",
      prevalence: "Medium",
      playstyle: "Powerful control with free counters",
      keyCards: [
        "Force of Will",
        "Mental Misstep",
        "Dack Fayden",
        "Snapcaster Mage",
        "Vampiric Tutor",
      ],
      weaknesses: ["Aggro", "Combo", "Graveyard hate"],
    },
    {
      name: "Bant Mentor",
      prevalence: "Medium",
      playstyle: "Monastery Mentor with power",
      keyCards: [
        "Monastery Mentor",
        "Moxen",
        "Ancestral Recall",
        "Time Walk",
        "Preordain",
      ],
      weaknesses: ["Artifact hate", "Graveyard hate", "Counterspells"],
    },
    {
      name: "Shops",
      prevalence: "Medium",
      playstyle: "Workshop artifacts with taxes",
      keyCards: [
        "Workshop",
        "Trinisphere",
        "Sphere of Resistance",
        "Chalice of the Void",
        "Metalworker",
      ],
      weaknesses: ["By Force", "Null Rod", "Shatterstorm", "Counterspells"],
    },
  ],
  pauper: [
    {
      name: "Mono-Blue Faeries",
      prevalence: "High",
      playstyle: "Blue fliers with counterspells",
      keyCards: [
        "Counterspell",
        "Spellstutter Sprite",
        "Ninja of the Deep Hours",
        "Brainstorm",
        "Preordain",
      ],
      weaknesses: ["Aggro", "Graveyard hate", "Mass removal"],
    },
    {
      name: "Burn",
      prevalence: "Medium",
      playstyle: "Burn spells for fast wins",
      keyCards: [
        "Lightning Bolt",
        "Chain Lightning",
        "Flame Slash",
        "Gitaxian Probe",
        "Goblin Guide",
      ],
      weaknesses: ["Lifegain", "Counterspells", "Aggressive creatures"],
    },
    {
      name: "Mono-White Heroic",
      prevalence: "Medium",
      playstyle: "Heroic creatures with pump spells",
      keyCards: [
        "Monastery Swiftspear",
        "Grapeshot",
        "Temur Battle Rage",
        "Assault Strobe",
        "Mutagenic Growth",
      ],
      weaknesses: ["Mass removal", "Counterspells", "Flying"],
    },
    {
      name: "Tron",
      prevalence: "Low",
      playstyle: "Tron lands for big mana",
      keyCards: [
        "Urza's Tower",
        "Urza's Mine",
        "Urza's Power Plant",
        "Rolling Thunder",
        "Ulamog's Crusher",
      ],
      weaknesses: ["Land destruction", "Aggro", "Counterspells"],
    },
    {
      name: "Affinity",
      prevalence: "Medium",
      playstyle: "Affinity artifacts for fast wins",
      keyCards: ["Myr Enforcer", "Frogmite", "Atog", "Flint", "Galvanic Blast"],
      weaknesses: ["Artifact hate", "Counterspells", "Flying"],
    },
  ],
};

// Generic metagame for formats without specific data
const GENERIC_META: Array<{
  name: string;
  prevalence: string;
  playstyle: string;
  keyCards: string[];
  weaknesses: string[];
}> = [
  {
    name: "Control",
    prevalence: "Medium",
    playstyle: "Control the board with removal and counterspells",
    keyCards: ["Counterspell", "Removal", "Card Draw", "Finisher"],
    weaknesses: ["Aggro", "Combo", "Graveyard hate"],
  },
  {
    name: "Aggro",
    prevalence: "High",
    playstyle: "Fast creatures and burn spells",
    keyCards: ["Cheap Creatures", "Burn", "Haste", "Pump"],
    weaknesses: ["Mass removal", "Lifegain", "Counterspells"],
  },
  {
    name: "Midrange",
    prevalence: "Medium",
    playstyle: "Efficient threats with value engines",
    keyCards: ["Value Creatures", "Removal", "Card Draw", "Finisher"],
    weaknesses: ["Combo", "Aggro", "Counterspells"],
  },
  {
    name: "Combo",
    prevalence: "Low",
    playstyle: "Assemble combo pieces for instant win",
    keyCards: ["Combo Pieces", "Card Draw", "Protection", "Tutors"],
    weaknesses: ["Counterspells", "Graveyard hate", "Rule of Law"],
  },
];

// Archetype matchups
const MATCHUP_GUIDE: Record<
  string,
  {
    strength: string[];
    weakness: string[];
    strategy: string;
  }
> = {
  Control: {
    strength: ["Combo", "Midrange", "Slow decks"],
    weakness: ["Aggro", "Asymmetrical disruption", "Hexproof"],
    strategy:
      "Play slowly and protect your threats. Use countermagic strategically on key spells. Draw cards to find answers.",
  },
  Aggro: {
    strength: ["Combo", "Control", "Slow decks"],
    weakness: ["Midrange", "Mass removal", "Lifegain"],
    strategy:
      "Apply pressure early and often. Don't overextend into mass removal. Save burn for reach.",
  },
  Midrange: {
    strength: ["Aggro", "Control", "Combo"],
    weakness: ["Fast combo", "Graveyard hate", "Flying"],
    strategy:
      "Play value creatures and generate card advantage. Use removal efficiently. Be patient.",
  },
  Combo: {
    strength: ["Control", "Slow decks", "Unprepared opponents"],
    weakness: ["Aggro", "Counterspells", "Graveyard hate", "Rule of Law"],
    strategy:
      "Find combo pieces quickly with card draw and tutors. Protect combo with countermagic. Have backup plans.",
  },
  Ramp: {
    strength: ["Midrange", "Control", "Slow decks"],
    weakness: ["Aggro", "Combo", "Land destruction"],
    strategy:
      "Ramp early and play big threats. Use card draw to find bombs. Protect ramp with countermagic.",
  },
  Tribal: {
    strength: ["Midrange", "Unprepared opponents"],
    weakness: ["Mass removal", "Control", "Flying"],
    strategy:
      "Apply pressure with tribal synergies. Use lords and buffs to overwhelm. Have backup threats.",
  },
};

// Lowercase archetype keys emitted by `detectDeckArchetype`. Centralised so the
// exported result type, the score map below, and any future runner-up lookup
// stay in sync.
export type DeckArchetypeKey =
  | "control"
  | "aggro"
  | "midrange"
  | "combo"
  | "ramp"
  | "tribal";

/**
 * Discrete confidence level for a detected archetype.
 *
 *   - 'none'   — no keyword/type signals at all; `primary` falls back to
 *     'midrange' and `runnerUp` is null.
 *   - 'low'    — the top two scores differ by fewer than 2 points (a near-
 *     tie on a sparse sample).
 *   - 'medium' — top score exceeds the runner-up by 2-4 points (default
 *     band).
 *   - 'high'   — top score exceeds the runner-up by 5 or more points (clean
 *     signal).
 *
 * The bands are issue #1564's contract — see heuristic-meta-analysis.test.ts
 * for the pinning tests at the 2-point boundary.
 */
export type ConfidenceLevel = "none" | "low" | "medium" | "high";

/**
 * Structured result returned by {@link detectDeckArchetype}.
 *
 * `confidence.score` is a normalised [0, 1] margin: `1 - runnerUpScore /
 * topScore`, clamped. When there is no runner-up (single archetype or all
 * tied) the score is 1.0 (full confidence in whichever archetype scored
 * highest).
 *
 * `confidence.level` is the discrete band derived from the raw margin:
 *
 *   margin >= 5  -> 'high'
 *   margin >= 2  -> 'medium'
 *   margin <  2  -> 'low'
 *   totalHits 0  -> 'none' (primary falls back to 'midrange')
 */
export interface ArchetypeDetectionResult {
  primary: DeckArchetypeKey;
  runnerUp: DeckArchetypeKey | null;
  confidence: {
    level: ConfidenceLevel;
    /** Normalised margin in [0, 1]. See comment above. */
    score: number;
    /** Raw top score minus runner-up score. 0 when runnerUp is null. */
    margin: number;
  };
  /** Raw per-archetype scores. */
  scores: Record<DeckArchetypeKey, number>;
}

/**
 * Analyze a deck and return a structured archetype-detection result.
 *
 * Exported so downstream tests (issue #1564 acceptance criteria, runner-up
 * selection, 2-point boundary) can drive it directly without going through
 * `analyzeMetaHeuristic`. The function does not throw — it always returns a
 * fully-populated result; the caller decides how to surface the confidence.
 *
 * Backward compatibility: the original contract was "return the lowercase
 * archetype string". The single internal caller (`analyzeMetaHeuristic`)
 * reads `result.primary`; external code that consumed the bare string can be
 * updated to read `.primary` on the returned object.
 */
export function detectDeckArchetype(
  deck: DeckCard[],
): ArchetypeDetectionResult {
  const deckText = deck.map((card) => card.name.toLowerCase()).join(" ");

  const keywordScores: Record<DeckArchetypeKey, number> = {
    control: 0,
    aggro: 0,
    midrange: 0,
    combo: 0,
    ramp: 0,
    tribal: 0,
  };

  const controlKeywords = [
    "counter",
    "draw",
    "wrath",
    "sweep",
    "control",
    "instant",
    "sorcery",
    "bounce",
    "removal",
  ];
  const aggroKeywords = [
    "attack",
    "haste",
    "battlefield",
    "damage",
    "fast",
    "aggressive",
    "burn",
    "pump",
    "warrior",
    "knight",
  ];
  const midrangeKeywords = [
    "value",
    "efficient",
    "threat",
    "mid",
    "versatile",
    "removal",
    "draw",
    "advantage",
  ];
  const comboKeywords = [
    "combo",
    "infinite",
    "loop",
    "assemble",
    "win condition",
    "pieces",
    "laboratory",
    "engine",
  ];
  // Issue #1445: the bare `'x'` keyword matched the substring `x` in a huge
  // fraction of card names (e.g. "explore", "expansion", "tax"), inflating the
  // ramp score arbitrarily. Drop it. Real ramp signals come from the longer
  // tokens below plus the type_line creature/instant ratio bonuses.
  const rampKeywords = [
    "mana",
    "ramp",
    "land",
    "forest",
    "island",
    "swamp",
    "mountain",
    "plains",
    "creatures",
    "mana value",
  ];
  const tribalKeywords = [
    "tribe",
    "lord",
    "goblin",
    "elf",
    "vampire",
    "warrior",
    "human",
    "knight",
    "soldier",
  ];

  controlKeywords.forEach((kw) => {
    const matches = (deckText.match(new RegExp(kw, "g")) || []).length;
    keywordScores.control += matches;
  });

  aggroKeywords.forEach((kw) => {
    const matches = (deckText.match(new RegExp(kw, "g")) || []).length;
    keywordScores.aggro += matches;
  });

  midrangeKeywords.forEach((kw) => {
    const matches = (deckText.match(new RegExp(kw, "g")) || []).length;
    keywordScores.midrange += matches;
  });

  comboKeywords.forEach((kw) => {
    const matches = (deckText.match(new RegExp(kw, "g")) || []).length;
    keywordScores.combo += matches;
  });

  rampKeywords.forEach((kw) => {
    const matches = (deckText.match(new RegExp(kw, "g")) || []).length;
    keywordScores.ramp += matches;
  });

  tribalKeywords.forEach((kw) => {
    const matches = (deckText.match(new RegExp(kw, "g")) || []).length;
    keywordScores.tribal += matches;
  });

  // Card type bonuses
  const totalCards = deck.reduce((sum, card) => sum + card.count, 0);
  const creatureCards = deck
    .filter((c) => c.type_line?.includes("Creature"))
    .reduce((sum, c) => sum + c.count, 0);
  const instantCards = deck
    .filter((c) => c.type_line?.includes("Instant"))
    .reduce((sum, c) => sum + c.count, 0);
  const creatureRatio = creatureCards / totalCards;
  const instantRatio = instantCards / totalCards;

  if (creatureRatio > 0.4) {
    keywordScores.aggro += 5;
    keywordScores.tribal += 3;
  }
  if (instantRatio > 0.15) {
    keywordScores.control += 5;
  }

  // Find highest + second-highest scoring archetypes. Sort descending by
  // score and break ties alphabetically on the archetype key so the result
  // is deterministic across runtimes (Object.entries is insertion-ordered
  // and Array.prototype.sort is stable in modern engines, but explicit
  // tiebreak removes any latent ambiguity).
  const sortedArchetypes = (
    Object.entries(keywordScores) as Array<[DeckArchetypeKey, number]>
  ).sort(([aKey, a], [bKey, b]) => {
    if (b !== a) return b - a;
    return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
  });

  const topEntry = sortedArchetypes[0];
  const runnerEntry = sortedArchetypes[1];

  // Issue #1564: when the runner-up is tied with the top scorer (margin =
  // 0) or the second archetype has zero hits, there is no meaningful
  // "second place" — return null rather than an arbitrary tied archetype.
  const totalHits = (Object.values(keywordScores) as number[]).reduce(
    (sum, s) => sum + s,
    0,
  );
  const hasRunnerUp =
    !!topEntry &&
    !!runnerEntry &&
    runnerEntry[1] > 0 &&
    runnerEntry[1] < topEntry[1];

  const primary: DeckArchetypeKey =
    topEntry && topEntry[1] > 0 ? topEntry[0] : "midrange";
  const runnerUp: DeckArchetypeKey | null = hasRunnerUp
    ? (runnerEntry as [DeckArchetypeKey, number])[0]
    : null;

  // Confidence — derived from the raw margin between top and runner-up.
  // When the top is tied with the runnerEntry (margin = 0), we still want
  // to report the actual gap (0) so the 'low' band fires per the issue AC.
  // When there is no runnerEntry OR the runnerEntry has zero hits (only
  // one archetype scored), the gap is effectively the full top score —
  // we treat that as 'high' confidence in the single winner.
  const topScore = topEntry ? topEntry[1] : 0;
  const runnerEntryScore = runnerEntry ? runnerEntry[1] : 0;
  let margin: number;
  if (hasRunnerUp) {
    margin = topScore - runnerEntryScore;
  } else if (topEntry && runnerEntry && runnerEntry[1] === topEntry[1]) {
    // Tied at the top — there IS a runnerEntry with the same score as top.
    margin = 0;
  } else {
    // Single-archetype signal: gap is the full top score (runner is 0).
    margin = topScore;
  }

  let level: ConfidenceLevel;
  if (totalHits === 0 || topScore === 0) {
    level = "none";
  } else if (margin < 2) {
    // Issue #1564 AC: "differ by fewer than 2 points" → 'low'. Strict <
    // means margin = 2 is NOT low.
    level = "low";
  } else if (margin >= 5) {
    // Issue #1564 AC: "exceeds the runner-up by 5 or more" → 'high'.
    level = "high";
  } else {
    // 2 <= margin <= 4 — the gap is real but not overwhelming.
    level = "medium";
  }

  // Normalised score in [0, 1]. When there's no runner-up the margin is
  // the full top score, so we report 1.0. When there IS a runner-up we use
  // the classic "1 - runnerUp / top" formulation so a tie yields 0 and a
  // clean win yields a number close to 1.
  const normalisedScore =
    topScore === 0
      ? 0
      : hasRunnerUp
        ? Math.max(0, Math.min(1, 1 - runnerEntryScore / topScore))
        : 1;

  return {
    primary,
    runnerUp,
    confidence: {
      level,
      score: normalisedScore,
      margin,
    },
    scores: keywordScores,
  };
}

// Capitalize the first letter of a lowercase archetype key so it matches the
// MATCHUP_GUIDE lookup keys. Returns the input unchanged when empty.
function capitalizeArchetype(archetype: string): string {
  if (!archetype) return archetype;
  return archetype.charAt(0).toUpperCase() + archetype.slice(1);
}

// Generate recommendations based on metagame
function generateMetaRecommendations(
  deckArchetype: string,
  deck: DeckCard[],
  format: string,
  focusArchetype?: string,
): MetaAnalysisOutput["recommendations"] {
  const recommendations: MetaAnalysisOutput["recommendations"] = [];
  const formatMeta = FORMAT_META[format] || GENERIC_META;

  // If focus archetype specified, prioritize those matchups
  let targetArchetypes = formatMeta;
  if (focusArchetype) {
    targetArchetypes = formatMeta.filter((archetype) =>
      archetype.name.toLowerCase().includes(focusArchetype.toLowerCase()),
    );

    if (targetArchetypes.length === 0) {
      targetArchetypes = formatMeta;
    }
  }

  // Issue #1445: `detectDeckArchetype` returns a lowercase key
  // (`'control'`, `'aggro'`, ...) but MATCHUP_GUIDE is keyed with capitalized
  // names. Look up via the capitalized form so the strategy text reflects
  // the actual detected archetype instead of silently falling through to
  // Midrange for every deck.
  const deckArchetypeDisplay = capitalizeArchetype(deckArchetype);

  // Generate matchup-specific recommendations
  targetArchetypes.slice(0, 3).forEach((targetArchetype) => {
    if (targetArchetype.name.toLowerCase() === deckArchetype.toLowerCase()) {
      return; // Skip mirror matchups
    }

    const matchup =
      MATCHUP_GUIDE[deckArchetypeDisplay] || MATCHUP_GUIDE["Midrange"];
    const isStrongAgainst = matchup.strength.includes(targetArchetype.name);

    const cardsToAdd: Array<{ name: string; quantity: number }> = [];
    const cardsToRemove: Array<{ name: string; quantity: number }> = [];

    if (isStrongAgainst) {
      // Enhance strengths
      cardsToAdd.push(
        { name: matchup.strength[0], quantity: 2 },
        { name: formatMeta[0]?.keyCards[0] || "Generic Answer", quantity: 2 },
      );
    } else {
      // Address weaknesses
      targetArchetype.weaknesses.slice(0, 2).forEach((weakness) => {
        if (weakness === "Aggro") {
          cardsToAdd.push({ name: "Mass Removal", quantity: 2 });
          cardsToAdd.push({ name: "Lifegain", quantity: 2 });
        } else if (weakness === "Control") {
          cardsToAdd.push({ name: "Uncounterable Threat", quantity: 2 });
          cardsToAdd.push({ name: "Hand Disruption", quantity: 2 });
        } else if (weakness === "Combo") {
          cardsToAdd.push({ name: "Graveyard Hate", quantity: 2 });
          cardsToAdd.push({ name: "Rule of Law", quantity: 1 });
        } else if (weakness === "Graveyard hate") {
          cardsToAdd.push({ name: "Graveyard Protection", quantity: 2 });
        } else if (weakness === "Mass removal") {
          cardsToAdd.push({ name: "Hexproof", quantity: 2 });
          cardsToAdd.push({ name: "Indestructible", quantity: 2 });
        }
      });

      // Remove cards weak against this archetype
      if (targetArchetype.weaknesses.includes("Flying")) {
        const nonFlying = deck
          .filter((c) => c.type_line?.includes("Creature") && c.count > 0)
          .slice(0, 2)
          .map((c) => ({ name: c.name, quantity: Math.min(c.count, 1) }));
        cardsToRemove.push(...nonFlying);
      }
    }

    // Format-specific additions
    if (format === "commander") {
      cardsToAdd.push({ name: "Command Tower", quantity: 1 });
      cardsToAdd.push({ name: "Sol Ring", quantity: 1 });
    } else if (format === "modern" || format === "legacy") {
      cardsToAdd.push({ name: "Thoughtseize", quantity: 2 });
    } else if (format === "standard") {
      cardsToAdd.push({ name: "Value Engine", quantity: 2 });
    }

    recommendations.push({
      title: `Improve ${targetArchetype.name} Matchup`,
      description: isStrongAgainst
        ? `Your ${deckArchetypeDisplay} deck is naturally strong against ${targetArchetype.name}. Enhance this advantage.`
        : `Your ${deckArchetypeDisplay} deck struggles against ${targetArchetype.name}. Address these weaknesses.`,
      cardsToAdd: cardsToAdd.slice(0, 5),
      cardsToRemove: cardsToRemove.slice(0, 3),
      matchup: {
        against: targetArchetype.name,
        strategy: matchup.strategy,
      },
    });
  });

  return recommendations.slice(0, 3);
}

// Generate metagame summary
function generateMetaSummary(format: string): string {
  const formatMeta = FORMAT_META[format] || GENERIC_META;

  const topArchetype = formatMeta[0];
  const mostCommon = formatMeta
    .filter((a) => a.prevalence === "High")
    .map((a) => a.name)
    .join(", ");

  return (
    `The ${format} metagame is currently dominated by ${topArchetype?.name || "various strategies"}. ` +
    `The most prevalent archetypes are: ${mostCommon || topArchetype?.name || "Control, Aggro, Midrange, and Combo"}. ` +
    `${topArchetype?.playstyle || "Meta decks focus on efficient threats and powerful interactions."} ` +
    `To succeed, prepare your deck with the right answers and strategies for these common archetypes.`
  );
}

/**
 * Main function to analyze the metagame and generate recommendations
 *
 * @param decklist - The deck list as text (e.g., "1 Sol Ring\n2 Lightning Bolt...")
 * @param format - The format (e.g., "commander", "modern", "standard")
 * @param cards - Parsed card data for the deck
 * @param focusArchetype - Optional archetype to focus recommendations on
 * @returns Metagame analysis with archetypes, recommendations, and matchup information
 */
export function analyzeMetaHeuristic(
  decklist: string,
  format: string,
  cards: DeckCard[],
  focusArchetype?: string,
): MetaAnalysisOutput {
  const archetypeDetection = detectDeckArchetype(cards);
  const currentMeta = generateMetaSummary(format);
  const archetypes = FORMAT_META[format] || GENERIC_META;
  const recommendations = generateMetaRecommendations(
    archetypeDetection.primary,
    cards,
    format,
    focusArchetype,
  );

  return {
    currentMeta,
    archetypes,
    recommendations,
    // Issue #1564: surface the structured detection result so the UI can
    // show a weak-signal badge when the heuristic is unsure.
    deckArchetypeDetection: archetypeDetection,
  };
}
