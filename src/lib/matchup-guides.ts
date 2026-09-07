/**
 * Matchup Strategy Guides
 *
 * Provides pre-game strategic advice, mulligan recommendations, and game plan
 * tips for specific deck archetype matchups.
 */

import { MagicFormat, ArchetypeCategory } from "./meta";

/**
 * Canonical list of every {@link ArchetypeCategory} value, in a stable order.
 *
 * Used by {@link getMatchupGuideCoverage} to compute the cartesian product of
 * `(playerArchetype, opponentArchetype)` pairs that *could* have a guide for a
 * given format. Keeping this list centralised (instead of relying on
 * `Object.keys` of a const-typed object) means new archetype categories land in
 * exactly one place — both the matchup-guides table and the coverage report
 * pick them up automatically.
 */
export const ARCHETYPE_CATEGORIES: readonly ArchetypeCategory[] = [
  "aggro",
  "control",
  "midrange",
  "combo",
  "tempo",
] as const;

export interface GamePlanTips {
  opening: string[];
  midGame: string[];
  lateGame: string[];
  generalStrategy: string;
}

export interface MulliganTips {
  keep: string[];
  mulligan: string[];
  consider: string[];
  notes: string;
}

export interface MatchupGuide {
  playerArchetype: ArchetypeCategory;
  playerArchetypeName: string;
  opponentArchetype: ArchetypeCategory;
  opponentArchetypeName: string;
  format: MagicFormat;
  winRate: number;
  gamePlan: GamePlanTips;
  mulliganGuide: MulliganTips;
  keyCards: string[];
  notes?: string;
}

// Mock matchup data
const matchupGuides: MatchupGuide[] = [
  // Aggro vs Control
  {
    playerArchetype: "aggro",
    playerArchetypeName: "Aggro",
    opponentArchetype: "control",
    opponentArchetypeName: "Control",
    format: "standard",
    winRate: 45,
    gamePlan: {
      opening: [
        "Play threats on curve",
        "Apply pressure early",
        "Force opponent to have answers",
      ],
      midGame: [
        "Maintain board presence",
        "Attack when opponent taps out",
        "Save removal for bigger threats",
      ],
      lateGame: [
        "Topdeck wars - hope for reach",
        "Use burn spells as finishers",
        "Outlast with card advantage from burn",
      ],
      generalStrategy:
        "Aggressive start is critical. You cannot out-card-advantage control, so win through tempo and damage.",
    },
    mulliganGuide: {
      keep: [
        "One-drop creatures",
        "Quick burn spells",
        "Low mana cost threats",
      ],
      mulligan: [
        "High mana cost cards",
        "Slow two-drops without curve",
        "Cards that don't affect board early",
      ],
      consider: [
        "Card draw spells if you have early drops",
        "Reach/burn if you have creatures",
      ],
      notes:
        "Mull aggressively for curve. A hand with 3+ mana cost cards is usually a mulligan.",
    },
    keyCards: [
      "Monastery Swiftspear",
      "Eidolon of the Great Revel",
      "Lightning Strike",
    ],
    notes: "Play around sweepers - don't overcommit.",
  },
  // Control vs Aggro
  {
    playerArchetype: "control",
    playerArchetypeName: "Control",
    opponentArchetype: "aggro",
    opponentArchetypeName: "Aggro",
    format: "standard",
    winRate: 65,
    gamePlan: {
      opening: [
        "Survive the early assault",
        "Use removal efficiently",
        "Prioritize life gain",
      ],
      midGame: [
        "Establish board control",
        "Card advantage is key",
        "Use sweepers at optimal times",
      ],
      lateGame: [
        "Outvalue opponent",
        "Win through superior late game",
        "Lock out with planeswalkers",
      ],
      generalStrategy:
        "Survive early, dominate late. Every life point matters - don't take unnecessary damage.",
    },
    mulliganGuide: {
      keep: [
        "Sweepers",
        "Cheap removal",
        "Life gain cards",
        "Early interaction",
      ],
      mulligan: [
        "Late game cards",
        "High mana cost spells",
        "Cards that don't affect board until turn 4+",
      ],
      consider: [
        "Counterspells if you have early interaction",
        "Card draw if you can survive early",
      ],
      notes:
        "Keep hands that can interact on turns 1-3. A hand without early removal is usually a mulligan.",
    },
    keyCards: ["Sweepers", "Doom Blade", " Chemister's Insight"],
    notes: "Don't tap out on opponent's turn 4-5 (sweeper range).",
  },
  // Midrange vs Combo
  {
    playerArchetype: "midrange",
    playerArchetypeName: "Midrange",
    opponentArchetype: "combo",
    opponentArchetypeName: "Combo",
    format: "standard",
    winRate: 52,
    gamePlan: {
      opening: [
        "Apply moderate pressure",
        "Disrupt opponent's setup",
        "Keep opponent's life total low",
      ],
      midGame: [
        "Hand disruption is key",
        "Kill key combo pieces",
        "Pressure their life total",
      ],
      lateGame: [
        "Win through attrition",
        "Outvalue combo in long games",
        "Use planeswalkers to close",
      ],
      generalStrategy:
        "Disrupt and pressure. Use hand disruption to remove combo pieces before they can win.",
    },
    mulliganGuide: {
      keep: ["Hand disruption", "Removal for combo pieces", "Threats on curve"],
      mulligan: [
        "Cards that don't interact",
        "Slow hands",
        "Hands without disruption",
      ],
      consider: [
        "Counter spells if format allows",
        "Pressure if you have disruption",
      ],
      notes:
        "Thoughtseize/Inquisition are critical. Know the combo - kill the pieces that matter.",
    },
    keyCards: ["Thoughtseize", "Fatal Push", "Liliana of the Veil"],
    notes:
      "Learn the combo - some pieces are more important to remove than others.",
  },
  // Combo vs Midrange
  {
    playerArchetype: "combo",
    playerArchetypeName: "Combo",
    opponentArchetype: "midrange",
    opponentArchetypeName: "Midrange",
    format: "standard",
    winRate: 58,
    gamePlan: {
      opening: ["Protect your combo", "Draw cards", "Accelerate mana"],
      midGame: [
        "Set up combo pieces",
        "Use protection spells",
        "Win as soon as possible",
      ],
      lateGame: [
        "Outdraw midrange threats",
        "Win through combo",
        "Use win conditions as threats",
      ],
      generalStrategy:
        "Race to assemble combo. Use protection to ensure you can win before midrange outvalues you.",
    },
    mulliganGuide: {
      keep: [
        "Combo pieces",
        "Card draw",
        "Mana acceleration",
        "Protection spells",
      ],
      mulligan: [
        "Midrange-style cards",
        "Slow hands without combo",
        "Hands that can't win before turn 5",
      ],
      consider: ["Interaction if you have combo", "Redundant pieces"],
      notes: "It's okay to mulligan aggressively - you need a fast hand.",
    },
    keyCards: ["Combo pieces", "Protection spells", "Card draw"],
    notes:
      "Don't be afraid to win with alternate routes if primary combo is disrupted.",
  },
  // Tempo vs Control
  {
    playerArchetype: "tempo",
    playerArchetypeName: "Tempo",
    opponentArchetype: "control",
    opponentArchetypeName: "Control",
    format: "standard",
    winRate: 50,
    gamePlan: {
      opening: [
        "Establish early board",
        "Play threats that demand answers",
        "Use cheap interaction",
      ],
      midGame: [
        "Maintain card advantage through efficiency",
        "Attack on different axes",
        "Use counterspells strategically",
      ],
      lateGame: [
        "Win with card quality",
        "Use finishers",
        "Protect key threats",
      ],
      generalStrategy:
        "Stay ahead on mana. Every spell should provide card advantage or tempo advantage.",
    },
    mulliganGuide: {
      keep: [
        "Efficient threats",
        "Cheap interaction",
        "Card draw",
        "Finishers",
      ],
      mulligan: [
        "Slow hands",
        "Cards that lose to sweepers",
        "Hands without early plays",
      ],
      consider: ["Backup win conditions", "Mana sinks"],
      notes: "Hands with 2+ cards costing 4+ are usually too slow.",
    },
    keyCards: ["Snapcaster Mage", "Counterspell", "Archmage's Charm"],
    notes: "Play around sweeper range (usually turn 4-5).",
  },
  // Control vs Midrange
  {
    playerArchetype: "control",
    playerArchetypeName: "Control",
    opponentArchetype: "midrange",
    opponentArchetypeName: "Midrange",
    format: "standard",
    winRate: 55,
    gamePlan: {
      opening: [
        "Establish card advantage",
        "Remove threats efficiently",
        "Dont overextend",
      ],
      midGame: [
        "Outvalue with card draw",
        "Use sweepers strategically",
        "Lock the board with walkers",
      ],
      lateGame: [
        "Superior late game wins",
        "Use win conditions as threats",
        "Patient play wins",
      ],
      generalStrategy:
        "Card advantage wins games. Remove threats efficiently - don't use premium removal on small threats unless necessary.",
    },
    mulliganGuide: {
      keep: ["Card draw", "Removal", "Late game", "Win conditions"],
      mulligan: [
        "Too much removal",
        "No card draw",
        "Hands that can't beat another control deck",
      ],
      consider: ["Counterspells", "Hand disruption"],
      notes:
        "Know the matchup - some midrange decks require different answers than others.",
    },
    keyCards: [
      "Teferi, Hero of Dominaria",
      "Supreme Verdict",
      "Narset, Parter of Veils",
    ],
    notes: "Board stalls are good for you - you have better late game.",
  },
];

/**
 * Get matchup guide for specific archetypes
 */
export function getMatchupGuide(
  playerArchetype: ArchetypeCategory,
  opponentArchetype: ArchetypeCategory,
  format: MagicFormat,
): MatchupGuide | null {
  return (
    matchupGuides.find(
      (g) =>
        g.playerArchetype === playerArchetype &&
        g.opponentArchetype === opponentArchetype &&
        g.format === format,
    ) || null
  );
}

/**
 * Get all matchup guides for a format
 */
export function getAllMatchupGuides(format: MagicFormat): MatchupGuide[] {
  return matchupGuides.filter((g) => g.format === format);
}

/**
 * Get mulligan guide for a specific matchup
 */
export function getMulliganGuide(
  playerArchetype: ArchetypeCategory,
  opponentArchetype: ArchetypeCategory,
  format: MagicFormat,
): MulliganTips | null {
  const guide = getMatchupGuide(playerArchetype, opponentArchetype, format);
  return guide?.mulliganGuide || null;
}

/**
 * Get general strategy for an archetype (vs any opponent)
 */
export function getGeneralStrategy(
  playerArchetype: ArchetypeCategory,
  format: MagicFormat,
): GamePlanTips | null {
  // Find any guide for this archetype
  const guide = matchupGuides.find(
    (g) => g.playerArchetype === playerArchetype && g.format === format,
  );
  return guide?.gamePlan || null;
}

/**
 * One `(playerArchetype, opponentArchetype)` pairing that has no authored guide
 * for the requested format. Returned by {@link getMatchupGuideCoverage}.
 */
export interface MissingMatchup {
  playerArchetype: ArchetypeCategory;
  opponentArchetype: ArchetypeCategory;
}

/**
 * Coverage report for a single {@link MagicFormat}.
 *
 * - `total` is `archetypes.length ** 2` (cartesian product of
 *   {@link ArchetypeCategory} × itself, including self-pairs).
 * - `covered` is the number of `(player, opponent, format)` triples that have
 *   an entry in the `matchupGuides` table.
 * - `missing` is the sorted list of `(player, opponent)` pairs that have *no*
 *   guide. The list is sorted by `playerArchetype` then `opponentArchetype` so
 *   the UI and snapshot tests get a deterministic order.
 */
export interface MatchupGuideCoverage {
  format: MagicFormat;
  total: number;
  covered: number;
  missing: MissingMatchup[];
}

/**
 * Coverage status for a specific triple. Returned by
 * {@link getMatchupGuideStatus} so the UI can distinguish "no guide yet" from
 * "loading" / "empty data" (the original {@link getMatchupGuide} returns `null`
 * for both reasons, which is the back-compat behaviour we keep).
 */
export type MatchupGuideStatus = "covered" | "missing";

/**
 * Compute the coverage report for a single format.
 *
 * The total number of possible `(player, opponent)` pairs is the cartesian
 * product of {@link ARCHETYPE_CATEGORIES} with itself (5 × 5 = 25 with the
 * current 5-category roster). Self-pairs (e.g. Aggro vs Aggro) are included
 * intentionally — they are valid data points once mirror matches become a
 * tracked scenario.
 *
 * The `archetypes` parameter is exposed so test fixtures can scope the report
 * to a subset of categories; production code should leave it defaulted.
 *
 * @example
 *   getMatchupGuideCoverage('standard')
 *   // => {
 *   //   format: 'standard',
 *   //   total: 25,
 *   //   covered: 6,
 *   //   missing: [
 *   //     { playerArchetype: 'aggro',    opponentArchetype: 'aggro'    },
 *   //     { playerArchetype: 'aggro',    opponentArchetype: 'combo'    },
 *   //     ...
 *   //   ],
 *   // }
 */
export function getMatchupGuideCoverage(
  format: MagicFormat,
  archetypes: readonly ArchetypeCategory[] = ARCHETYPE_CATEGORIES,
): MatchupGuideCoverage {
  return computeMatchupGuideCoverage(matchupGuides, format, archetypes);
}

/**
 * Pure coverage-report computation. Same shape as
 * {@link getMatchupGuideCoverage}, but takes the guides array explicitly so
 * tests can exercise the empty / full / partial coverage cases without
 * reaching for jest.mock on the closed-over `matchupGuides` constant.
 */
export function computeMatchupGuideCoverage(
  guides: readonly MatchupGuide[],
  format: MagicFormat,
  archetypes: readonly ArchetypeCategory[] = ARCHETYPE_CATEGORIES,
): MatchupGuideCoverage {
  const coveredSet = new Set<string>();
  for (const guide of guides) {
    if (guide.format === format) {
      coveredSet.add(`${guide.playerArchetype}|${guide.opponentArchetype}`);
    }
  }

  const missing: MissingMatchup[] = [];
  for (const player of archetypes) {
    for (const opponent of archetypes) {
      if (!coveredSet.has(`${player}|${opponent}`)) {
        missing.push({ playerArchetype: player, opponentArchetype: opponent });
      }
    }
  }

  const total = archetypes.length * archetypes.length;
  return {
    format,
    total,
    covered: total - missing.length,
    missing,
  };
}

/**
 * Coverage status for a specific `(player, opponent, format)` triple.
 *
 * Returns `'covered'` when a guide is present in the matchup-guides table and
 * `'missing'` otherwise. This is a thin helper around
 * {@link getMatchupGuide} that lets the UI render a distinct empty-state for
 * "no guide yet" (status === 'missing') without changing the back-compat
 * `null` return of {@link getMatchupGuide}.
 */
export function getMatchupGuideStatus(
  playerArchetype: ArchetypeCategory,
  opponentArchetype: ArchetypeCategory,
  format: MagicFormat,
): MatchupGuideStatus {
  return getMatchupGuide(playerArchetype, opponentArchetype, format) !== null
    ? "covered"
    : "missing";
}
