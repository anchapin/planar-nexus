/**
 * @fileOverview Per-matchup sideboard plan generation for the AI Coach.
 *
 * Issue #1076: for best-of-3 (sideboard) play the coach must emit a PER-MATCHUP
 * boarding plan — for each likely opponent archetype, which sideboard cards to
 * BOARD IN, which maindeck cards to BOARD OUT, and a one-line rationale.
 *
 * This is LOCAL-FIRST and HEURISTIC-GROUNDED: the plan is derived entirely from
 * the deck's detected archetype, each card's functional ROLE (reused verbatim
 * from `coach-deck-analysis#classifyRole` — no new taxonomy), and the opponent
 * archetype's threat profile (category from `archetype-signatures`). No LLM
 * call is required for the core plan; an optional LLM may refine it elsewhere.
 *
 * The output is deterministic for a given (mainDeck, sideboard, opponent)
 * tuple, which keeps it testable and offline-capable.
 */

import type { DeckCard } from "@/app/actions";
import { detectArchetype } from "@/ai/archetype-detector";
import { getArchetypeByName } from "@/ai/archetype-signatures";
import {
  classifyRole,
  type RoleDistribution,
} from "@/ai/flows/coach-deck-analysis";
import type { SideboardCard } from "@/lib/anti-meta";

/** The functional roles a card can fill (mirrors RoleDistribution keys). */
type RoleKey = keyof RoleDistribution;

/** A single opponent's boarding recommendation. */
export interface MatchupSideboardPlan {
  /** Opponent archetype name (e.g. "Burn"). */
  opponentArchetypeName: string;
  /** Opponent archetype category (aggro/control/midrange/combo/tribal/special). */
  opponentArchetypeCategory: string;
  /** Sideboard cards to bring in for this matchup. */
  boardIn: SideboardCard[];
  /** Maindeck cards to take out for this matchup. */
  boardOut: SideboardCard[];
  /** One-line strategic rationale tied to the archetype profile. */
  guidance: string;
}

/** The full coach output: player archetype + a plan per opponent archetype. */
export interface PerMatchupSideboardResult {
  /** Detected archetype of the player's maindeck. */
  playerArchetype: string;
  /** Category of the player's archetype. */
  playerArchetypeCategory: string;
  /** One boarding plan per relevant opponent archetype. */
  matchupPlans: MatchupSideboardPlan[];
}

/** Cap on cards boarded in for a single matchup (keeps plans realistic). */
const MAX_BOARD_IN_CARDS = 8;

/**
 * Threat profile for an archetype category: how valuable each functional role
 * is when facing that category (higher = more wanted in, lower = more cuttable).
 * These weights are grounded in established MTG sideboard heuristics.
 */
interface MatchupProfile {
  category: string;
  roleValue: Record<RoleKey, number>;
  /** Strategy guidance; `{player}` is substituted with the player archetype. */
  guidance: string;
}

const DEFAULT_PROFILE: MatchupProfile = {
  category: "midrange",
  roleValue: {
    threats: 1,
    ramp: 0,
    removal: 1,
    cardDraw: 1,
    disruption: 1,
    lands: 0,
    other: -1,
  },
  guidance:
    "Board in your most impactful cards and trim the narrowest ones for this matchup.",
};

const MATCHUP_PROFILES: Record<string, MatchupProfile> = {
  aggro: {
    category: "aggro",
    roleValue: { threats: 0, ramp: -1, removal: 3, cardDraw: 1, disruption: 2, lands: 0, other: -2 },
    guidance:
      "{player} must stabilise early. Board in cheap removal and disruptive interaction; shave your slowest top-end threats and narrow cards that clog your hand.",
  },
  combo: {
    category: "combo",
    roleValue: { threats: 1, ramp: 0, removal: 0, cardDraw: 2, disruption: 3, lands: 0, other: -2 },
    guidance:
      "{player} needs to stop them going off. Board in hand disruption and countermagic plus draw to find them; cut creature-only removal that cannot interact with the combo.",
  },
  control: {
    category: "control",
    roleValue: { threats: 2, ramp: 0, removal: -1, cardDraw: 3, disruption: 2, lands: 0, other: -1 },
    guidance:
      "{player} plays the long game. Board in card draw, discard, and resilient must-answer threats; trim redundant removal and low-impact cards that trade poorly.",
  },
  midrange: {
    category: "midrange",
    roleValue: { threats: 2, ramp: 0, removal: 2, cardDraw: 2, disruption: 1, lands: 0, other: -1 },
    guidance:
      "{player} trades resources one-for-one. Board in efficient removal and card draw to pull ahead; cut narrow, situational cards.",
  },
  tribal: {
    category: "tribal",
    roleValue: { threats: 1, ramp: -1, removal: 3, cardDraw: 1, disruption: 2, lands: 0, other: -2 },
    guidance:
      "{player} faces a creature flood. Board in sweepers and point removal plus disruptive interaction; cut slow draw and non-interactive cards.",
  },
  special: {
    category: "special",
    roleValue: { threats: 1, ramp: 0, removal: 2, cardDraw: 2, disruption: 2, lands: 0, other: -1 },
    guidance:
      "{player} faces a unique engine. Board in flexible interaction and card draw; trim narrow cards that do not affect their plan.",
  },
};

/** One representative archetype per category, used when callers omit opponents. */
const REPRESENTATIVE_OPPONENTS: string[] = [
  "Burn", // aggro
  "Draw-Go", // control
  "Good Stuff", // midrange
  "Storm", // combo
  "Elves", // tribal
  "Superfriends", // special
];

function getMatchupProfile(category: string): MatchupProfile {
  return MATCHUP_PROFILES[category] ?? { ...DEFAULT_PROFILE, category };
}

function isLand(card: DeckCard): boolean {
  return (card.type_line || "").toLowerCase().includes("land");
}

function roleValueOf(role: RoleKey, profile: MatchupProfile): number {
  return profile.roleValue[role] ?? 0;
}

function reasonForBoardIn(role: RoleKey, profile: MatchupProfile): string {
  switch (role) {
    case "removal":
      return `Removal answers their key cards — strong vs ${profile.category}.`;
    case "disruption":
      return `Hand/counterspell pressure disrupts their ${profile.category} game plan.`;
    case "cardDraw":
      return "Extra draw finds your answers and keeps gas flowing.";
    case "threats":
      return "A resilient threat they must answer improves this matchup.";
    case "ramp":
      return "Ramp accelerates you past their pressure.";
    default:
      return `Flexible card that improves the ${profile.category} matchup.`;
  }
}

function reasonForBoardOut(
  role: RoleKey,
  profile: MatchupProfile,
  card: DeckCard,
): string {
  const fastMatchup =
    profile.category === "aggro" || profile.category === "tribal";
  if (fastMatchup && (card.cmc || 0) >= 4) {
    return `Too slow at CMC ${card.cmc} against a fast ${profile.category} deck.`;
  }
  switch (role) {
    case "removal":
      return profile.category === "control"
        ? "Redundant removal trades poorly against their few threats."
        : "Removal is low-impact in this matchup.";
    case "other":
      return "Narrow utility card with little impact here.";
    case "threats":
      return "Lower-impact threat that underperforms in this matchup.";
    case "ramp":
      return "Ramp is a liability when you need early interaction.";
    default:
      return "Lowest-value card in this matchup.";
  }
}

/** Sideboard cards to bring in, ranked by role value for the matchup. */
function computeBoardIn(
  sideboard: DeckCard[],
  profile: MatchupProfile,
): SideboardCard[] {
  if (sideboard.length === 0) return [];

  const scored = sideboard
    .filter((c) => !isLand(c))
    .map((c) => {
      const role = classifyRole(c);
      return { card: c, role, value: roleValueOf(role, profile) };
    })
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value || (a.card.cmc || 0) - (b.card.cmc || 0));

  const boardIn: SideboardCard[] = [];
  let total = 0;
  for (const s of scored) {
    if (total >= MAX_BOARD_IN_CARDS) break;
    const remaining = MAX_BOARD_IN_CARDS - total;
    const qty = Math.min(s.card.count, remaining);
    if (qty <= 0) break;
    boardIn.push({
      cardName: s.card.name,
      count: qty,
      reason: reasonForBoardIn(s.role, profile),
    });
    total += qty;
  }
  return boardIn;
}

/** Maindeck cards to take out, ranked by how cuttable they are. */
function computeBoardOut(
  mainDeck: DeckCard[],
  profile: MatchupProfile,
  target: number,
): SideboardCard[] {
  if (target <= 0) return [];

  const scored = mainDeck
    .filter((c) => !isLand(c))
    .map((c) => {
      const role = classifyRole(c);
      let cut = -roleValueOf(role, profile);
      if (profile.category === "aggro" || profile.category === "tribal") {
        cut += (c.cmc || 0) * 0.5;
      }
      if (profile.category === "control" && role === "removal") cut += 1.0;
      return { card: c, role, cut };
    })
    .sort((a, b) => b.cut - a.cut || (b.card.cmc || 0) - (a.card.cmc || 0));

  const boardOut: SideboardCard[] = [];
  let total = 0;
  for (const s of scored) {
    if (total >= target) break;
    const remaining = target - total;
    const qty = Math.min(s.card.count, remaining);
    if (qty <= 0) break;
    boardOut.push({
      cardName: s.card.name,
      count: qty,
      reason: reasonForBoardOut(s.role, profile, s.card),
    });
    total += qty;
  }
  return boardOut;
}

/** Resolve the opponent list, defaulting to one representative per category. */
function resolveOpponents(names?: string[]): string[] {
  if (names && names.length) {
    const valid = names.filter((n) => !!getArchetypeByName(n));
    if (valid.length) return valid;
  }
  return REPRESENTATIVE_OPPONENTS.filter((n) => !!getArchetypeByName(n));
}

function buildPlan(
  mainDeck: DeckCard[],
  sideboard: DeckCard[],
  opponentName: string,
  playerArchetype: string,
): MatchupSideboardPlan {
  const sig = getArchetypeByName(opponentName);
  const category = sig?.category ?? "midrange";
  const profile = getMatchupProfile(category);

  const boardIn = computeBoardIn(sideboard, profile);
  const inCount = boardIn.reduce((sum, c) => sum + c.count, 0);
  const boardOut = computeBoardOut(mainDeck, profile, inCount);

  return {
    opponentArchetypeName: opponentName,
    opponentArchetypeCategory: category,
    boardIn,
    boardOut,
    guidance: profile.guidance.replace("{player}", playerArchetype),
  };
}

/**
 * Generate a per-matchup sideboard plan for each likely opponent archetype.
 *
 * Pure and deterministic: the same inputs always yield the same output, with no
 * network or LLM dependency. Cards are scored by their functional role against
 * the opponent archetype's threat profile (category).
 *
 * @param mainDeck         The player's maindeck cards.
 * @param sideboard        The player's sideboard cards.
 * @param opponentArchetypes Optional list of opponent archetype names. Defaults
 *                           to one representative archetype per category.
 */
export function generatePerMatchupSideboardPlans(
  mainDeck: DeckCard[],
  sideboard: DeckCard[],
  opponentArchetypes?: string[],
): PerMatchupSideboardResult {
  const safeMain = Array.isArray(mainDeck) ? mainDeck : [];
  const safeSide = Array.isArray(sideboard) ? sideboard : [];

  const detected = detectArchetype(safeMain);
  const playerArchetype = detected?.primary || "Unknown";
  const playerCategory =
    getArchetypeByName(playerArchetype)?.category ?? "midrange";

  const opponents = resolveOpponents(opponentArchetypes);

  const matchupPlans = opponents.map((name) =>
    buildPlan(safeMain, safeSide, name, playerArchetype),
  );

  return {
    playerArchetype,
    playerArchetypeCategory: playerCategory,
    matchupPlans,
  };
}
