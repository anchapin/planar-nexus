/**
 * @fileoverview Difficulty-scaled cleanup-phase discard priority
 * (issue #1414).
 *
 * `runCleanupPhase` in `ai-turn-loop.ts` discards down to the max hand size
 * at the end of every turn. Before this module landed it called
 * `discardCards(state, playerId, count, true)` — the `random: true` path of
 * the engine helper, which ignores `count` and discards exactly one random
 * card. Every difficulty tier discarded identically, the AI frequently
 * dumped the wrong card (a removal spell it needed next turn, a land when
 * it was color-screwed), and the post-cleanup hand directly degraded the
 * next turn's mana-sequencing budget.
 *
 * This module is the thin ranking layer between the engine state the turn
 * loop already holds and the ordered candidate list passed to
 * `discardCards`. It is deliberately kept in a sibling file (mirroring
 * `opening-turn-plan.ts` from #1416 and `cast-sequencing.ts` from #1415)
 * so the only edit to `ai-turn-loop.ts` is the call site — sibling issues
 * that also touch the turn loop rebase cleanly.
 *
 * Per-tier behavior (matches the issue spec):
 *
 * - **easy**   — sort the whole hand by CMC descending and dump the biggest.
 *                Tie-breaks randomly via the injected rng. Models a beginner
 *                who looks at the cards in their hand and bins the
 *                scariest-looking one.
 * - **medium** — drop basic lands first (flooded), then off-color cards
 *                (worst-color: a color the AI has no source for), then
 *                lowest-CMC spells. The simplest "good-ish" heuristic —
 *                never great, never catastrophic.
 * - **hard**   — drop excess lands only (keeps a backup land for color
 *                fixing), then dead-color cards (same off-color test as
 *                Medium, named differently to match the issue's wording),
 *                then lowest-leverage threats (power/CMC ratio). Protects
 *                removal when the opponent has live threats on board.
 * - **expert** — minimize lost value. Drop excess lands, then cards the
 *                next-turn plan flags as zero-role (CMC well above the
 *                predicted available mana, so they will not be cast next
 *                turn), then lowest-leverage threats. Removal is locked
 *                when the opponent has any threat — Expert never bins the
 *                answer.
 *
 * The helper is pure: same inputs → same outputs. The only nondeterminism
 * is the Easy rng, injectable for tests. It never mutates the input state
 * and returns a fresh candidate array.
 *
 * Limited-format override: never propose discarding a card that would push
 * the post-cleanup hand below {@link LIMITED_MIN_HAND_SIZE} (default 7) — a
 * 40-card Limited deck cannot afford to discard into a mulligan-forced
 * state the way a 60-card Constructed deck can. The helper simply trims the
 * candidate list so a Limited AI leaves one extra card in hand when it
 * would otherwise drop below the floor.
 */

import type {
  GameState as EngineGameState,
  PlayerId,
  CardInstanceId,
} from "@/lib/game-state/types";
import type { DifficultyLevel, DifficultyFormat } from "./ai-difficulty";
import { isRemovalSpell } from "./ai-telegraph";

/** MTG color codes (re-declared locally to avoid a cross-module dependency). */
type ManaColor = "W" | "U" | "B" | "R" | "G";

/** All five MTG color codes. */
const ALL_COLORS: ManaColor[] = ["W", "U", "B", "R", "G"];

/** Map basic land names to the color they produce. */
const BASIC_LAND_COLOR: Record<string, ManaColor> = {
  Plains: "W",
  Island: "U",
  Swamp: "B",
  Mountain: "R",
  Forest: "G",
};

/**
 * In Limited formats the AI refuses to discard into a hand size below this
 * floor (issue #1414: "never discard a card that would push the deck below
 * 7 cards in hand for the next draw step"). 7 mirrors the starting hand
 * size and the cleanup max — going below it would force a mulligan next
 * turn if the library runs dry.
 */
export const LIMITED_MIN_HAND_SIZE = 7;

/**
 * Lands in hand beyond this count are "excess" and prioritized for
 * discard. 4 is the typical land-drop count by turn 4-5 in Limited /
 * Constructed; at or above it the AI is flooding and a land in hand is
 * board-impact-zero. Hard / Expert use this to separate "extra land"
 * (drop) from "kept land" (color-fixing insurance).
 */
export const EXCESS_LAND_BATTLEFIELD_THRESHOLD = 4;

/** Per-tier knobs threaded through the discard decision. */
export interface DiscardContext {
  difficulty: DifficultyLevel;
  format?: DifficultyFormat;
  /**
   * Deterministic randomness source for tests. Defaults to `Math.random`.
   * Consumed only by the Easy tier's CMC-tiebreak shuffle.
   */
  rng?: () => number;
}

/** A hand classified into the shape the ranker needs. */
export interface DiscardRecommendation {
  /** Ordered card-instance ids — first is the highest priority to discard. */
  candidates: CardInstanceId[];
  /** Human-readable per-tier reason surfaced via `config.onCommentary`. */
  reasoning: string;
}

/** Classified hand card used by all four tier rankers. */
interface ClassifiedCard {
  cardId: CardInstanceId;
  name: string;
  typeLine: string;
  cmc: number;
  colors: ManaColor[];
  isLand: boolean;
  isBasicLand: boolean;
  isCreature: boolean;
  isRemoval: boolean;
  power: number;
  /** power / max(1, cmc) — higher leverage = more board impact per mana. */
  leverage: number;
}

/** Minimal read-only shape the helper needs from a `CardInstance`. */
interface CardLike {
  cardData: {
    name?: string;
    type_line?: string;
    oracle_text?: string;
    mana_cost?: string;
    cmc?: number;
    colors?: string[];
    power?: string | number;
  };
  id: CardInstanceId;
}

/** Board context used by Medium / Hard / Expert to compute land-excess and dead-color. */
interface BoardContext {
  /** Count of lands the player controls. */
  landsOnBattlefield: number;
  /** Per-color count of mana sources the player controls. */
  availableColors: Record<ManaColor, number>;
}

/**
 * Compute the difficulty-scaled ordered discard candidate list for the
 * given player's hand. Pure, deterministic given an injected `rng`, never
 * mutates `state`.
 *
 * The returned list contains every card in hand the ranker considers
 * "safely discardable" given the (tier, format, board) context, ordered
 * most-discardable → least-discardable. The caller takes the first
 * `count = handSize - maxHandSize` of them; in Limited the helper already
 * trims the list so the caller never discards below
 * {@link LIMITED_MIN_HAND_SIZE}.
 *
 * When the hand is empty (or no zone is found) an empty candidate list
 * with a diagnostic reason is returned; the caller should fall back to
 * the engine default.
 */
export function pickDiscardCandidates(
  state: EngineGameState,
  playerId: PlayerId,
  context: DiscardContext,
): DiscardRecommendation {
  const handCards = readHandCards(state, playerId);
  if (handCards.length === 0) {
    return {
      candidates: [],
      reasoning: "Cleanup: empty hand, nothing to discard",
    };
  }

  const board = readBoardContext(state, playerId);
  const opponentThreats = countOpponentThreats(state, playerId);
  const classified = handCards.map((c) => classifyCard(c));

  let ordered: ClassifiedCard[];
  let reasoning: string;

  switch (context.difficulty) {
    case "easy":
      ordered = rankEasy(classified, context.rng ?? Math.random);
      reasoning = `Cleanup (easy): dump highest-CMC cards first (${ordered
        .slice(0, 2)
        .map((c) => `${c.name} cmc${c.cmc}`)
        .join(", ")})`;
      break;
    case "medium":
      ordered = rankMedium(classified, board);
      reasoning = `Cleanup (medium): drop basic lands → off-color → lowest-CMC (${ordered
        .slice(0, 2)
        .map((c) => c.name)
        .join(", ")})`;
      break;
    case "hard":
      ordered = rankHard(classified, board, opponentThreats);
      reasoning = `Cleanup (hard): drop excess lands → dead-color → lowest-leverage (${ordered
        .slice(0, 2)
        .map((c) => c.name)
        .join(", ")})`;
      break;
    case "expert":
      ordered = rankExpert(classified, board, opponentThreats);
      reasoning = `Cleanup (expert): minimize lost value (${ordered
        .slice(0, 2)
        .map((c) => c.name)
        .join(", ")})`;
      break;
  }

  // Limited-format override: never let the candidate list drop the
  // post-cleanup hand below the floor. The caller will still pass the
  // full maxHandSize-driven `count` to the engine, but the helper here
  // only "endorses" discarding the safe ones — if the engine has nothing
  // else to pick it will simply discard fewer cards (hand ends up above
  // max for one turn, which is the lesser evil vs a forced mulligan).
  if (context.format === "limited") {
    const safeCount = Math.max(0, handCards.length - LIMITED_MIN_HAND_SIZE);
    if (ordered.length > safeCount) {
      ordered = ordered.slice(0, safeCount);
    }
  }

  return {
    candidates: ordered.map((c) => c.cardId),
    reasoning,
  };
}

// ---------------------------------------------------------------------------
// Card reading / classification.
// ---------------------------------------------------------------------------

/** Read only the cards in the player's hand zone (no mutation). */
function readHandCards(state: EngineGameState, playerId: PlayerId): CardLike[] {
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

/** Read lands + their produced colors from the battlefield. */
function readBoardContext(
  state: EngineGameState,
  playerId: PlayerId,
): BoardContext {
  const zone = state.zones.get(`${playerId}-battlefield`);
  const availableColors = emptyColors();
  let landsOnBattlefield = 0;
  if (!zone) return { landsOnBattlefield, availableColors };

  for (const cardId of zone.cardIds) {
    const card = state.cards.get(cardId) as
      (CardLike & { [k: string]: unknown }) | undefined;
    if (!card?.cardData) continue;
    const typeLine = String(card.cardData.type_line ?? "");
    if (!/land/i.test(typeLine)) continue;
    landsOnBattlefield++;
    for (const c of producedColors(card.cardData.oracle_text, typeLine)) {
      availableColors[c]++;
    }
  }
  return { landsOnBattlefield, availableColors };
}

/**
 * Count opponent threats on the battlefield. Used by Hard / Expert to
 * protect removal spells from being discarded. A threat is any creature
 * controlled by a non-`playerId` player with power >= 2.
 */
function countOpponentThreats(
  state: EngineGameState,
  playerId: PlayerId,
): number {
  let count = 0;
  for (const [zoneKey, zone] of state.zones.entries()) {
    if (zoneKey.startsWith(`${playerId}-`)) continue;
    if (!zoneKey.endsWith("-battlefield")) continue;
    for (const cardId of zone.cardIds) {
      const card = state.cards.get(cardId) as
        (CardLike & { [k: string]: unknown }) | undefined;
      if (!card?.cardData) continue;
      const typeLine = String(card.cardData.type_line ?? "");
      if (!/creature/i.test(typeLine)) continue;
      if (parsePower(card.cardData.power) >= 2) count++;
    }
  }
  return count;
}

/** Classify a single hand card into the ranker's working shape. */
function classifyCard(card: CardLike): ClassifiedCard {
  const typeLine = String(card.cardData.type_line ?? "");
  const oracleText = String(card.cardData.oracle_text ?? "");
  const cmcRaw = card.cardData.cmc;
  const cmc =
    typeof cmcRaw === "number" && Number.isFinite(cmcRaw) ? cmcRaw : 0;
  const isLand = /land/i.test(typeLine);
  const isBasicLand = /basic land/i.test(typeLine);
  const isCreature = /creature/i.test(typeLine);
  const isRemoval = !isLand && isRemovalSpell(typeLine, oracleText);
  const colors = readColors(card, typeLine);
  const power = isCreature ? parsePower(card.cardData.power) : 0;
  // Leverage is the ranker's per-card "value if cast" proxy:
  //   - lands: 0 (no direct board impact as a card; bucketed separately
  //     by `pickExcessLands` before leverage is consulted)
  //   - creatures: power / max(1, cmc) — the canonical rate-of-return
  //   - non-creature spells: a neutral 1.0 so they sort between
  //     bad-rate creatures (leverage < 1) and good-rate creatures
  //     (leverage > 1). A 1-mana removal spell and a 1-mana cantrip
  //     both have similar implicit value (1.0); a 7-mana 1/1 creature
  //     has clearly worse value (1/7 ≈ 0.143) and drops first.
  const leverage = isLand ? 0 : isCreature ? power / Math.max(1, cmc) : 1.0;
  return {
    cardId: card.id,
    name: String(card.cardData.name ?? card.id),
    typeLine,
    cmc,
    colors,
    isLand,
    isBasicLand,
    isCreature,
    isRemoval,
    power,
    leverage,
  };
}

/** Parse a Scryfall power string ("2", "*", "1+") into a finite number. */
function parsePower(s: string | number | undefined): number {
  if (typeof s === "number") return Number.isFinite(s) ? s : 0;
  if (!s) return 0;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : 0;
}

/** Read colors off a card — prefers `colors`, falls back to mana_cost pips. */
function readColors(card: CardLike, typeLine: string): ManaColor[] {
  const explicit = (card.cardData.colors ?? []).map((c) =>
    String(c).toUpperCase().charAt(0),
  );
  const fromColors = ALL_COLORS.filter((c) => explicit.includes(c));
  if (fromColors.length > 0) return fromColors;

  // Land color inference via the basic-land-type fallback or oracle text.
  if (/land/i.test(typeLine)) {
    const produced = producedColors(card.cardData.oracle_text, typeLine);
    if (produced.length > 0) return produced;
  }

  // mana_cost pip inference (e.g. "{1}{G}{G}" → ["G"]).
  const manaCost = card.cardData.mana_cost ?? "";
  const pipColors = new Set<ManaColor>();
  for (const m of manaCost.matchAll(/\{([WUBRG])\}/gi)) {
    pipColors.add(m[1]!.toUpperCase() as ManaColor);
  }
  return Array.from(pipColors);
}

/** Parse colors a land can produce from its oracle text + basic-land type. */
function producedColors(
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

/** Empty per-color record (all colors zero). */
function emptyColors(): Record<ManaColor, number> {
  return { W: 0, U: 0, B: 0, R: 0, G: 0 };
}

// ---------------------------------------------------------------------------
// Per-tier rankers. Each returns the full ordered candidate list (every
// card in hand, ordered most-discardable → least-discardable); the caller
// slices the first `count`. Tier-specific protection rules (e.g. removal
// when opponent has threats) drop protected cards to the very end so they
// are only discarded as a last resort.
// ---------------------------------------------------------------------------

/**
 * Easy: sort the whole hand by CMC descending, random tiebreak. Models a
 * beginner who looks at the biggest, scariest card and bins it without
 * consulting board state. The injected rng is consumed once per card as
 * a tiebreak salt so the ordering is deterministic given the rng but
 * unbiased across equal-CMC groups.
 */
function rankEasy(
  cards: ClassifiedCard[],
  rng: () => number,
): ClassifiedCard[] {
  const decorated = cards.map((c) => ({ card: c, salt: rng() }));
  decorated.sort((a, b) => {
    if (a.card.cmc !== b.card.cmc) return b.card.cmc - a.card.cmc;
    return a.salt - b.salt;
  });
  return decorated.map((d) => d.card);
}

/**
 * Medium: drop basic lands first, then off-color cards (a color the AI
 * has no source for on the battlefield — the "worst color" for this
 * hand), then lowest-CMC spells. Does not reason about opponent threats
 * or leverage — Medium is "good enough" but unsophisticated.
 */
function rankMedium(
  cards: ClassifiedCard[],
  board: BoardContext,
): ClassifiedCard[] {
  const basics = cards.filter((c) => c.isBasicLand).sort(byBasicLandStable);

  const offColor = cards.filter(
    (c) =>
      !c.isLand &&
      c.colors.length > 0 &&
      !c.colors.some((col) => board.availableColors[col] > 0),
  );

  const usedIds = new Set<CardInstanceId>([
    ...basics.map((c) => c.cardId),
    ...offColor.map((c) => c.cardId),
  ]);
  const rest = cards.filter((c) => !usedIds.has(c.cardId)).sort(byCmcAscending);

  return [...basics, ...offColor, ...rest];
}

/**
 * Hard: drop excess lands first (only lands beyond the flood threshold
 * — keeps one as color-fixing insurance when not flooding), then
 * dead-color cards (same off-color test as Medium), then lowest-leverage
 * threats. Protects removal when the opponent has live threats (drops
 * them to the very end so they are only discarded as a last resort).
 */
function rankHard(
  cards: ClassifiedCard[],
  board: BoardContext,
  opponentThreats: number,
): ClassifiedCard[] {
  const excessLands = pickExcessLands(cards, board);
  const deadColor = cards.filter(
    (c) =>
      !c.isLand &&
      c.colors.length > 0 &&
      !c.colors.some((col) => board.availableColors[col] > 0),
  );

  const usedIds = new Set<CardInstanceId>([
    ...excessLands.map((c) => c.cardId),
    ...deadColor.map((c) => c.cardId),
  ]);
  const lowestLeverage = cards
    .filter(
      (c) => !usedIds.has(c.cardId) && !protectedRemoval(c, opponentThreats),
    )
    .sort(byLeverageAscending);

  const protectedCards = cards.filter(
    (c) => !usedIds.has(c.cardId) && protectedRemoval(c, opponentThreats),
  );

  return [...excessLands, ...deadColor, ...lowestLeverage, ...protectedCards];
}

/**
 * Expert: minimize lost value. Drop excess lands, then zero-role cards
 * (spells that don't help the active plan — heuristic: CMC strictly
 * above next-turn available mana + 1, OR dead-color), then lowest-leverage
 * threats. Removal is locked whenever the opponent has any threat.
 *
 * The issue spec mentions consulting `getSequencingRecommendation` from
 * `mana-sequencing.ts`. We approximate that signal here with a local
 * CMC-vs-available-mana check so this module stays a pure leaf with no
 * cross-module coupling — the same pattern `cast-sequencing.ts` uses
 * where the orchestrator (the AI turn loop) is free to feed a richer
 * recommendation in if it has one. The approximation is conservative
 * (only flags clearly uncastable cards as zero-role), so Expert never
 * accidentally drops a card the recommendation would have kept.
 */
function rankExpert(
  cards: ClassifiedCard[],
  board: BoardContext,
  opponentThreats: number,
): ClassifiedCard[] {
  const excessLands = pickExcessLands(cards, board);
  const usedIds = new Set<CardInstanceId>(excessLands.map((c) => c.cardId));

  // Approximate next-turn available mana as current land count + 1 (the
  // natural land drop). Cards costing strictly more than that + 1 slack
  // are "zero-role" for the immediate plan — they will not be cast next
  // turn barring a mana dork / ritual. Dead-color cards (no source for
  // any of their colors) are always zero-role.
  const nextTurnMana = board.landsOnBattlefield + 1;
  const zeroRole = cards.filter((c) => {
    if (usedIds.has(c.cardId)) return false;
    if (c.isLand) return false;
    if (protectedRemoval(c, opponentThreats)) return false;
    if (
      c.colors.length > 0 &&
      !c.colors.some((col) => board.availableColors[col] > 0)
    ) {
      return true;
    }
    return c.cmc > nextTurnMana + 1;
  });
  // Sort zero-role by leverage ascending so the lowest-value cards drop
  // first — a 7-cmc 1/1 (leverage ≈ 0.14) before a 1-mana cantrip
  // (leverage = 1.0). Mirrors Hard's lowest-leverage bucket ordering.
  zeroRole.sort(byLeverageAscending);
  zeroRole.forEach((c) => usedIds.add(c.cardId));

  const lowestLeverage = cards
    .filter(
      (c) => !usedIds.has(c.cardId) && !protectedRemoval(c, opponentThreats),
    )
    .sort(byLeverageAscending);

  const protectedCards = cards.filter(
    (c) => !usedIds.has(c.cardId) && protectedRemoval(c, opponentThreats),
  );

  return [...excessLands, ...zeroRole, ...lowestLeverage, ...protectedCards];
}

/**
 * Pick the lands in hand that count as "excess" given the board: when the
 * AI already controls {@link EXCESS_LAND_BATTLEFIELD_THRESHOLD} or more
 * lands, every land in hand is excess (the AI is flooding); below that
 * threshold the AI keeps up to one land as color-fixing insurance and
 * only the rest are excess. Returns lands in a stable order (basic lands
 * first, then by cmc asc) so the test fixture is deterministic.
 */
function pickExcessLands(
  cards: ClassifiedCard[],
  board: BoardContext,
): ClassifiedCard[] {
  const lands = cards.filter((c) => c.isLand);
  if (lands.length === 0) return [];

  const sorted = [...lands].sort(byBasicLandStable);

  if (board.landsOnBattlefield >= EXCESS_LAND_BATTLEFIELD_THRESHOLD) {
    // Flooding: every land in hand is excess.
    return sorted;
  }

  // Below the flood threshold, only the SECOND-and-onward land in hand is
  // excess (keep one for color fixing).
  return sorted.slice(1);
}

/** True if this card is a removal spell the AI should protect this turn. */
function protectedRemoval(c: ClassifiedCard, opponentThreats: number): boolean {
  return c.isRemoval && opponentThreats > 0;
}

/** Comparator: basic lands first, then ascending CMC, stable on id. */
function byBasicLandStable(a: ClassifiedCard, b: ClassifiedCard): number {
  if (a.isBasicLand !== b.isBasicLand) {
    return a.isBasicLand ? -1 : 1;
  }
  return byCmcAscending(a, b);
}

/** Comparator: ascending CMC, stable tiebreak on cardId. */
function byCmcAscending(a: ClassifiedCard, b: ClassifiedCard): number {
  if (a.cmc !== b.cmc) return a.cmc - b.cmc;
  return String(a.cardId).localeCompare(String(b.cardId));
}

/** Comparator: ascending leverage (lowest leverage first = worst threat). */
function byLeverageAscending(a: ClassifiedCard, b: ClassifiedCard): number {
  if (a.leverage !== b.leverage) return a.leverage - b.leverage;
  // Tie-break by CMC ascending (cheaper spells are more flexible → keep).
  if (a.cmc !== b.cmc) return a.cmc - b.cmc;
  return String(a.cardId).localeCompare(String(b.cardId));
}
