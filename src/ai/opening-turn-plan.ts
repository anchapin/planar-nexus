/**
 * @fileoverview Difficulty-scaled opening-hand sequencing for the AI opponent
 * (issue #1416).
 *
 * Turns 1-3 ("the opening") are the most consequential turns in a Magic game.
 * Before this module the AI played every turn identically:
 * `playLandIfAvailable` picked the first land it found in hand, and
 * `castCreatures` dumped every affordable creature by CMC. There was no turn-1
 * vs turn-3 distinction and no per-tier policy — Easy and Expert opened
 * indistinguishably.
 *
 * This module produces a single per-turn {@link OpeningTurnPlan} for turns
 * 1-3 that scales with difficulty:
 *
 * - **easy**   — sloppy: random land pick (may choose a tapped land when an
 *                untapped basic is available); greedy spell pick that
 *                overreaches above curve and ignores color requirements
 *                (wasting turns on casts the engine will reject); sometimes
 *                randomly holds and does nothing.
 * - **medium** — on-curve: prefers an untapped basic that enables the hand's
 *                colored pips; leads with the cheapest on-curve, color-
 *                feasible creature; holds when the only plays are off-color
 *                so it can replay them next turn.
 * - **hard**   — 1-turn lookahead: leads with a T1 mana dork to accelerate;
 *                holds a 1-drop that would strand the T2 2-drop's only
 *                colored source; avoids tapped lands on T1/T2; sequences
 *                fetch lands for color fixing.
 * - **expert** — 2-turn plan: full basic → fetch → dual color sequencing;
 *                mana-dork-led acceleration into a T2 3-drop / T3 4-drop;
 *                holds the creature plan to lead with removal when the
 *                opponent's T1 board threatens lethal.
 *
 * The plan is PURE (no engine mutation, no I/O) and deterministic given a
 * fixed `rng`. The turn loop consults it only for turns 1-3 in the
 * pre-combat main phase and falls back to the existing difficulty-agnostic
 * main-phase logic afterwards ({@link OPENING_TURNS_MAX}).
 *
 * Integration lives in `ai-turn-loop.ts` and is intentionally minimal
 * (a plan computed once per turn, threaded into `playLandIfAvailable` and
 * `castCreatures`) so sibling issues #1413/#1414/#1415 — which also edit the
 * turn loop — rebase cleanly.
 */

import type {
  GameState as EngineGameState,
  PlayerId,
  CardInstanceId,
} from "@/lib/game-state/types";
import type { DifficultyLevel, DifficultyFormat } from "./ai-difficulty";

/** MTG color codes. */
export type ManaColor = "W" | "U" | "B" | "R" | "G";

/**
 * Maximum turn for which the opening plan applies. The turn loop passes
 * `turnNumber` to {@link chooseOpeningTurnPlan}; values above this return
 * `null` and the caller falls back to the legacy main-phase logic.
 */
export const OPENING_TURNS_MAX = 3;

/**
 * Per-color pip count from a Scryfall `mana_cost` string (e.g. `"{1}{G}{G}"`).
 * Generic and X pips are ignored — only colored pips gate color feasibility.
 */
export type PipCount = Record<ManaColor, number>;

/**
 * The AI's plan for a single opening turn (1-3).
 *
 * The turn loop plays `landToPlay` via `playLandIfAvailable` (instead of the
 * first land it finds) and consults `spellToCast` / `holdMana` in
 * `castCreatures` (instead of the legacy CMC-sort dump). When the plan is
 * present, `castCreatures` does NOT fall through to legacy — the plan is
 * authoritative for the opening.
 */
export interface OpeningTurnPlan {
  /** The land card to play this turn, or null if no land is available. */
  landToPlay: CardInstanceId | null;
  /** The creature spell to cast this turn, or null to cast no creature. */
  spellToCast: CardInstanceId | null;
  /**
   * When true, hold all creatures this turn even if some are affordable.
   * Used by Easy (random hold), Medium (off-curve replay), Hard (protect T2
   * curve), and Expert (lead with removal vs an opponent T1 threat).
   */
  holdMana: boolean;
  /** Per-tier reason surfaced via `config.onCommentary` for coaching. */
  reasoning: string;
}

// ---------------------------------------------------------------------------
// Card-shape accessors. The engine stores cards as `CardInstance` with a
// `cardData: ScryfallCard` payload. We touch only the minimal read-only
// fields used by the opener, so the helper is engine-agnostic and trivially
// testable with lightweight fixtures.
// ---------------------------------------------------------------------------

interface CardLike {
  cardData: {
    name?: string;
    type_line?: string;
    oracle_text?: string;
    mana_cost?: string;
    cmc?: number;
    colors?: string[];
    power?: string;
  };
  id: CardInstanceId;
}

/** Map basic land names to the color they produce. */
const BASIC_LAND_COLOR: Record<string, ManaColor> = {
  Plains: "W",
  Island: "U",
  Swamp: "B",
  Mountain: "R",
  Forest: "G",
};

/** Empty pip-count record (all colors zero). */
function emptyPips(): PipCount {
  return { W: 0, U: 0, B: 0, R: 0, G: 0 };
}

/**
 * Count colored pips in a Scryfall `mana_cost` string like `"{1}{G}{G}"`.
 * Generic (`{N}`/`{X}`) and hybrid pips are ignored — only the five colored
 * symbols gate color feasibility, matching the engine's cast validation.
 */
export function countColoredPips(manaCost: string | undefined): PipCount {
  const counts = emptyPips();
  if (!manaCost) return counts;
  for (const m of manaCost.matchAll(/\{([WUBRG])\}/gi)) {
    const c = m[1]!.toUpperCase() as ManaColor;
    counts[c]++;
  }
  return counts;
}

/** True if a land's oracle text says it enters the battlefield tapped. */
export function entersTapped(oracleText: string | undefined): boolean {
  return /enters the battlefield tapped/i.test(oracleText ?? "");
}

/**
 * Colors a land can directly produce, parsed from oracle text patterns such
 * as `"{T}: Add {G}."` or `"({T}: Add {G} or {U}.)"`. Falls back to inferring
 * from the basic-land type line when the oracle text has no `Add` clause
 * (defensive — handles missing oracle text on basic-land fixtures).
 */
export function producedColors(
  oracleText: string | undefined,
  typeLine: string | undefined,
): ManaColor[] {
  const text = oracleText ?? "";
  const colors = new Set<ManaColor>();
  for (const m of text.matchAll(/Add\s*((?:\{[WUBRG]\}\s*(?:or\s*)?)+)/gi)) {
    for (const c of m[1]!.matchAll(/\{([WUBRG])\}/gi)) {
      colors.add(c[1]!.toUpperCase() as ManaColor);
    }
  }
  if (colors.size === 0 && typeLine) {
    for (const [land, color] of Object.entries(BASIC_LAND_COLOR)) {
      if (RegExp(`\\b${land}\\b`, "i").test(typeLine)) {
        colors.add(color);
      }
    }
  }
  return Array.from(colors);
}

/**
 * True if a land is a fetch land — it sacrifices to search for a basic land
 * type. Detected via the "Search your library for a ... <Basic>" oracle
 * clause (e.g. Misty Rainforest, Windswept Heath).
 */
export function isFetchLand(oracleText: string | undefined): boolean {
  return /Search your library for.*?(Forest|Island|Swamp|Mountain|Plains)/i.test(
    oracleText ?? "",
  );
}

/**
 * Colors a fetch land can find, mapped from the basic land names it names.
 * E.g. `"Search ... for a Forest or Island card"` → `["G", "U"]`.
 */
export function fetchLandTargets(oracleText: string | undefined): ManaColor[] {
  const text = oracleText ?? "";
  const colors = new Set<ManaColor>();
  for (const [land, color] of Object.entries(BASIC_LAND_COLOR)) {
    if (RegExp(`\\b${land}\\b`).test(text)) {
      colors.add(color);
    }
  }
  return Array.from(colors);
}

/** True if a creature's oracle text declares a tap-to-add-mana ability. */
function isManaDork(oracleText: string | undefined): boolean {
  return /\{T\}.*?Add\s*(\{[WUBRGC]\}|one mana of any color)/i.test(
    oracleText ?? "",
  );
}

/** Parse a Scryfall power string ("2", "*", "1+") into a finite number. */
function parsePower(s: string | undefined): number {
  if (!s) return 0;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : 0;
}

// ---------------------------------------------------------------------------
// Classified card shapes used by the planner.
// ---------------------------------------------------------------------------

/** A land in hand, enriched with classification fields for sequencing. */
export interface LandChoice {
  cardId: CardInstanceId;
  name: string;
  isBasic: boolean;
  isFetch: boolean;
  isTapped: boolean;
  /** Colors the land can directly produce. */
  produced: ManaColor[];
  /** Colors a fetch land can find by cracking. Empty for non-fetches. */
  fetchTargets: ManaColor[];
}

/** A creature in hand, enriched with classification fields for sequencing. */
export interface CreatureChoice {
  cardId: CardInstanceId;
  name: string;
  cmc: number;
  pips: PipCount;
  /** Creature's own colors (from `colors`), upper-cased to ManaColor. */
  colors: ManaColor[];
  isManaDork: boolean;
  /** Parsed power; falls back to CMC as a board-impact proxy. */
  power: number;
  oracleText: string;
}

function isLandCard(c: CardLike): boolean {
  return String(c.cardData.type_line ?? "")
    .toLowerCase()
    .includes("land");
}

function isCreatureCard(c: CardLike): boolean {
  return String(c.cardData.type_line ?? "")
    .toLowerCase()
    .includes("creature");
}

function classifyLand(card: CardLike): LandChoice {
  const typeLine = card.cardData.type_line ?? "";
  const oracleText = card.cardData.oracle_text;
  return {
    cardId: card.id,
    name: card.cardData.name ?? "(unnamed land)",
    isBasic: /\bbasic\b/i.test(typeLine),
    isFetch: isFetchLand(oracleText),
    isTapped: entersTapped(oracleText),
    produced: producedColors(oracleText, typeLine),
    fetchTargets: isFetchLand(oracleText) ? fetchLandTargets(oracleText) : [],
  };
}

function classifyCreature(card: CardLike): CreatureChoice {
  const cmc = card.cardData.cmc ?? 0;
  const power = parsePower(card.cardData.power);
  return {
    cardId: card.id,
    name: card.cardData.name ?? "(unnamed creature)",
    cmc,
    pips: countColoredPips(card.cardData.mana_cost),
    colors: (card.cardData.colors ?? [])
      .map((c) => c.toUpperCase())
      .filter((c): c is ManaColor => "WUBRG".includes(c)),
    isManaDork: isManaDork(card.cardData.oracle_text),
    power: Number.isFinite(power) && power > 0 ? power : cmc,
    oracleText: card.cardData.oracle_text ?? "",
  };
}

// ---------------------------------------------------------------------------
// Hand / board extraction. Reads only zones + cards so the planner is
// engine-agnostic and trivially testable with lightweight fixtures.
// ---------------------------------------------------------------------------

function getHandCards(state: EngineGameState, playerId: PlayerId): CardLike[] {
  const zone = state.zones.get(`${playerId}-hand`);
  if (!zone) return [];
  const out: CardLike[] = [];
  for (const cardId of zone.cardIds) {
    const card = state.cards.get(cardId) as
      (CardLike & { [k: string]: unknown }) | undefined;
    if (card && card.cardData) out.push(card);
  }
  return out;
}

/**
 * Sum colored-pip demand across near-term creatures. Creatures on-curve
 * (cmc <= turnNumber) are weighted double — those are the pips the opener must
 * cover this turn and next. Farther-out spells (cmc <= turnNumber + 2) are
 * weighted single.
 */
function computeColorDemand(
  creatures: CreatureChoice[],
  turnNumber: number,
): PipCount {
  const demand = emptyPips();
  for (const c of creatures) {
    if (c.cmc > turnNumber + 2) continue;
    const weight = c.cmc <= turnNumber ? 2 : 1;
    (Object.keys(demand) as ManaColor[]).forEach((color) => {
      demand[color] += c.pips[color] * weight;
    });
  }
  return demand;
}

/**
 * Count colored sources available to cast with this turn or next: lands on the
 * battlefield already producing, plus untapped lands in hand we could play.
 * Fetch lands count once per color they can find (the planner assumes the AI
 * cracks them for the color it needs — the actual crack is handled by the
 * ability-activation step, not here).
 */
function gatherAvailableColors(
  landsInHand: LandChoice[],
  state: EngineGameState,
  playerId: PlayerId,
): PipCount {
  const counts = emptyPips();
  const battlefield = state.zones.get(`${playerId}-battlefield`);
  if (battlefield) {
    for (const id of battlefield.cardIds) {
      const card = state.cards.get(id) as
        (CardLike & { [k: string]: unknown }) | undefined;
      if (
        card &&
        card.cardData &&
        String(card.cardData.type_line ?? "")
          .toLowerCase()
          .includes("land")
      ) {
        for (const c of producedColors(
          card.cardData.oracle_text,
          card.cardData.type_line,
        )) {
          counts[c]++;
        }
      }
    }
  }
  for (const l of landsInHand) {
    if (l.isTapped) continue; // a tapped land in hand can't help this turn
    for (const c of l.produced) counts[c]++;
    if (l.isFetch) for (const c of l.fetchTargets) counts[c]++;
  }
  return counts;
}

/** True if `available` covers every colored pip the creature needs. */
function colorsFeasible(c: CreatureChoice, available: PipCount): boolean {
  return (Object.keys(c.pips) as ManaColor[]).every(
    (color) => available[color] >= c.pips[color],
  );
}

/** First color two creatures both need (used to detect curve conflicts). */
function findSharedColor(
  a: CreatureChoice,
  b: CreatureChoice,
): ManaColor | null {
  return (
    (Object.keys(a.pips) as ManaColor[]).find(
      (c) => a.pips[c] > 0 && b.pips[c] > 0,
    ) ?? null
  );
}

/**
 * Comparator that "curves out": prefers a creature whose CMC equals this turn
 * (uses all available mana), then the highest CMC at or below turnNumber
 * (uses as much mana as possible), then higher power. This is the
 * on-curve sort shared by Medium / Hard / Expert — each tier layers its own
 * policy on top (lookahead, threat detection, acceleration) before falling
 * back to this order.
 */
function onCurveComparator(
  turnNumber: number,
): (a: CreatureChoice, b: CreatureChoice) => number {
  return (a, b) => {
    const aCurve = a.cmc === turnNumber ? 0 : 1;
    const bCurve = b.cmc === turnNumber ? 0 : 1;
    if (aCurve !== bCurve) return aCurve - bCurve;
    if (b.cmc !== a.cmc) return b.cmc - a.cmc;
    return b.power - a.power;
  };
}

/**
 * Detect an opponent threat on the board that justifies leading with removal
 * instead of developing a creature. Returns true if any non-self player has a
 * creature with power >= 2 on the battlefield (a meaningful T1/T2 threat).
 */
function opponentHasEarlyThreat(
  state: EngineGameState,
  playerId: PlayerId,
): boolean {
  for (const [zoneKey, zone] of state.zones.entries()) {
    if (zoneKey.startsWith(`${playerId}-`)) continue;
    if (!zoneKey.endsWith("-battlefield")) continue;
    for (const id of zone.cardIds) {
      const card = state.cards.get(id) as
        (CardLike & { [k: string]: unknown }) | undefined;
      if (
        card &&
        card.cardData &&
        /creature/i.test(card.cardData.type_line ?? "")
      ) {
        if (parsePower(card.cardData.power) >= 2) return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Per-tier land picker.
// ---------------------------------------------------------------------------

/**
 * Score a candidate land for the opening. Higher is better. Scoring knobs:
 *
 * - Untapped bonus (+2) vs tapped penalty (scaled; larger early).
 * - Produced-color bonus (+3 per demanded color the land makes).
 * - Basic bonus (+1) — basics enable land-type-matters cards and never cost
 *   life (shock) or enter tapped (check lands).
 * - Fetch bonus (+2 per demanded target) — only for tiers that think to crack
 *   fetches for fixing (Hard/Expert). Medium does not get this, modelling a
 *   real skill gap. Expert gets a small extra flexibility bonus.
 */
function scoreLand(
  land: LandChoice,
  demand: PipCount,
  turnNumber: number,
  difficulty: DifficultyLevel,
): number {
  const tappedPenalty = turnNumber <= 2 ? 2 : 0.5;
  let score = 0;
  score += land.isTapped ? -tappedPenalty : 2;
  score += land.produced.filter((c) => demand[c] > 0).length * 3;
  if (land.isBasic) score += 1;
  if (land.isFetch && (difficulty === "hard" || difficulty === "expert")) {
    score += land.fetchTargets.filter((c) => demand[c] > 0).length * 2;
    if (difficulty === "expert") score += 0.5; // option-value of on-color crack
  }
  return score;
}

function pickOpeningLand(
  lands: LandChoice[],
  difficulty: DifficultyLevel,
  demand: PipCount,
  turnNumber: number,
  rng: () => number,
): LandChoice | null {
  if (lands.length === 0) return null;
  if (difficulty === "easy") {
    // Sloppy: random land from hand. Deterministic via the supplied rng.
    const idx = Math.floor(rng() * lands.length);
    return lands[Math.min(idx, lands.length - 1)] ?? lands[0]!;
  }
  // Medium / Hard / Expert: pick the highest-scoring land (stable order on
  // ties — preserves hand order, which is itself insertion-stable).
  let best = lands[0]!;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const l of lands) {
    const s = scoreLand(l, demand, turnNumber, difficulty);
    if (s > bestScore) {
      bestScore = s;
      best = l;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Per-tier creature picker.
// ---------------------------------------------------------------------------

interface SpellDecision {
  spellId: CardInstanceId | null;
  holdMana: boolean;
  reasoning: string;
}

function pickOpeningSpell(
  creatures: CreatureChoice[],
  lands: LandChoice[],
  difficulty: DifficultyLevel,
  turnNumber: number,
  state: EngineGameState,
  playerId: PlayerId,
  rng: () => number,
): SpellDecision {
  if (creatures.length === 0) {
    return {
      spellId: null,
      holdMana: false,
      reasoning: "No creatures in hand",
    };
  }
  const available = gatherAvailableColors(lands, state, playerId);

  // --- Easy: sloppy ------------------------------------------------------
  if (difficulty === "easy") {
    // Sometimes just do nothing (sloppy). 25% mirrors the historical skip
    // gate for low tiers and is deterministic via rng.
    if (rng() < 0.25) {
      return {
        spellId: null,
        holdMana: true,
        reasoning: "Easy: randomly holds",
      };
    }
    // Greedy: attempt the highest-CMC creature within reach (turnNumber + 2),
    // IGNORING color requirements. Above-curve picks will fail the engine's
    // cast validation and waste the turn — the documented Easy blunder.
    const reach = creatures
      .filter((c) => c.cmc <= turnNumber + 2)
      .sort((a, b) => b.cmc - a.cmc || b.power - a.power);
    const pick = reach[0];
    if (!pick) {
      return {
        spellId: null,
        holdMana: false,
        reasoning: "Easy: nothing in reach",
      };
    }
    return {
      spellId: pick.cardId,
      holdMana: false,
      reasoning: `Easy: greedy attempt ${pick.name} (cmc ${pick.cmc})`,
    };
  }

  // --- Medium: on-curve --------------------------------------------------
  if (difficulty === "medium") {
    const onCurve = creatures
      .filter((c) => c.cmc <= turnNumber && colorsFeasible(c, available))
      .sort(onCurveComparator(turnNumber));
    if (onCurve.length > 0) {
      const pick = onCurve[0]!;
      return {
        spellId: pick.cardId,
        holdMana: false,
        reasoning: `Medium: on-curve ${pick.name} (cmc ${pick.cmc})`,
      };
    }
    // Color-mismatched or above-curve: hold and replay next turn.
    return {
      spellId: null,
      holdMana: true,
      reasoning: "Medium: off-curve / off-color, hold to replay next turn",
    };
  }

  // --- Hard: 1-turn lookahead -------------------------------------------
  if (difficulty === "hard") {
    // T1: lead with a mana dork to accelerate the T2/T3 curve.
    if (turnNumber === 1) {
      const dork = creatures.find(
        (c) =>
          c.isManaDork && c.cmc <= turnNumber && colorsFeasible(c, available),
      );
      if (dork) {
        return {
          spellId: dork.cardId,
          holdMana: false,
          reasoning: `Hard: lead mana dork ${dork.name} to accelerate`,
        };
      }
      // Hold a 1-drop that would strand the T2 2-drop's only colored source.
      const oneDrops = creatures.filter((c) => c.cmc === 1);
      const twoDrops = creatures.filter((c) => c.cmc === 2);
      if (oneDrops.length > 0 && twoDrops.length > 0) {
        const shared = findSharedColor(oneDrops[0]!, twoDrops[0]!);
        if (shared && available[shared] <= 1) {
          return {
            spellId: null,
            holdMana: true,
            reasoning: `Hard: hold 1-drop to protect T2 ${shared} source`,
          };
        }
      }
    }
    const onCurve = creatures
      .filter((c) => c.cmc <= turnNumber && colorsFeasible(c, available))
      .sort(onCurveComparator(turnNumber));
    if (onCurve.length > 0) {
      const pick = onCurve[0]!;
      return {
        spellId: pick.cardId,
        holdMana: false,
        reasoning: `Hard: curve ${pick.name} (cmc ${pick.cmc}, power ${pick.power})`,
      };
    }
    return {
      spellId: null,
      holdMana: true,
      reasoning: "Hard: off-curve, hold for sequencing",
    };
  }

  // --- Expert: 2-turn plan ----------------------------------------------
  // Lead with removal iff the opponent's T1 board threatens lethal.
  if (opponentHasEarlyThreat(state, playerId)) {
    return {
      spellId: null,
      holdMana: true,
      reasoning: "Expert: hold creature to lead removal vs opponent threat",
    };
  }
  // T1: mana-dork acceleration if it ramps out a T2 3-drop or T3 4-drop.
  if (turnNumber === 1) {
    const dork = creatures.find(
      (c) =>
        c.isManaDork && c.cmc <= turnNumber && colorsFeasible(c, available),
    );
    const hasAcceleratedTarget = creatures.some(
      (c) => c.cmc === 3 || c.cmc === 4,
    );
    if (dork && hasAcceleratedTarget) {
      return {
        spellId: dork.cardId,
        holdMana: false,
        reasoning: `Expert: accelerate ${dork.name} into T2/T3 curve`,
      };
    }
  }
  // Highest-impact on-curve creature (curve out, then highest power).
  const onCurve = creatures
    .filter((c) => c.cmc <= turnNumber && colorsFeasible(c, available))
    .sort(onCurveComparator(turnNumber));
  if (onCurve.length > 0) {
    const pick = onCurve[0]!;
    return {
      spellId: pick.cardId,
      holdMana: false,
      reasoning: `Expert: ${pick.name} (cmc ${pick.cmc}, power ${pick.power})`,
    };
  }
  return {
    spellId: null,
    holdMana: true,
    reasoning: "Expert: hold for 2-turn sequencing",
  };
}

// ---------------------------------------------------------------------------
// Public entry point.
// ---------------------------------------------------------------------------

/**
 * Compute the opening-turn plan for the given (player, turn).
 *
 * @returns The plan for turns 1-3 ({@link OPENING_TURNS_MAX}); `null` outside
 *          that range, signalling the caller to use legacy main-phase logic.
 *
 * Determinism: the only nondeterministic input is `rng` (used only by Easy).
 * Tests pass a seeded `() => number` for fully reproducible plans.
 */
export function chooseOpeningTurnPlan(
  state: EngineGameState,
  playerId: PlayerId,
  difficulty: DifficultyLevel,
  format: DifficultyFormat | undefined,
  turnNumber: number,
  rng: () => number = Math.random,
): OpeningTurnPlan | null {
  if (turnNumber < 1 || turnNumber > OPENING_TURNS_MAX) return null;

  const handCards = getHandCards(state, playerId);
  const lands = handCards.filter(isLandCard).map(classifyLand);
  const creatures = handCards.filter(isCreatureCard).map(classifyCreature);
  const demand = computeColorDemand(creatures, turnNumber);

  const land = pickOpeningLand(lands, difficulty, demand, turnNumber, rng);
  const spell = pickOpeningSpell(
    creatures,
    lands,
    difficulty,
    turnNumber,
    state,
    playerId,
    rng,
  );

  // `format` is currently used only for documentation — it is reserved for
  // future per-format opening tuning (e.g. Limited vs Constructed openers)
  // and is threaded through so the signature matches the rest of the AI's
  // difficulty/format-aware helpers. Referencing it keeps the param
  // intentional rather than silently dead.
  void format;

  return {
    landToPlay: land?.cardId ?? null,
    spellToCast: spell.spellId,
    holdMana: spell.holdMana,
    reasoning: spell.reasoning,
  };
}
