/**
 * @fileoverview Mid- and late-game land selection (issue #1539).
 *
 * Before #1539, `playLandIfAvailable` (ai-turn-loop.ts) iterated `handZone.cardIds`
 * and played the FIRST land it found, gated only by the opening-turn plan's
 * `preferredLandId` (which is set exclusively for turns 1-3 — see
 * `opening-turn-plan.ts` {@link OPENING_TURNS_MAX}). Beyond turn 3, when the AI
 * held e.g. a basic Plains, a dual land, a fetchland, and a utility land (Castle
 * Locthwain, Radiant Fountain), it played whichever happened to sit first in the
 * zone array. The repository already had difficulty-scaled land-drop timing
 * (mana-sequencing.ts {@link evaluateLandDropTiming}) and cast sequencing
 * ({@link getSequencingRecommendation}) — but neither was consulted for
 * mid/late-game land CHOICE.
 *
 * This module closes that gap with a heuristic-only scoring pass over the lands
 * in hand, factoring:
 *
 * 1. **Color fixing** — produced colors that satisfy a colored-pip demand in
 *    hand or in upcoming turns.
 * 2. **Over-fixing penalty** — colors already saturated on the battlefield
 *    (so a tri-color splash isn't over-committed).
 * 3. **Basic bonus** — basics enable land-type-matters cards and never enter
 *    tapped or cost life (shock lands).
 * 4. **Tapped penalty** — a small discount in mid/late game (curve matters less
 *    than on turns 1-3, where the existing opening plan already penalises).
 * 5. **Fetch bonus** (Medium+) — fetch lands crack for the missing color the
 *    same turn; when color-screwed on a single missing color they outrank a
 *    tapped dual.
 * 6. **Late-game utility-ETB bonus** (Hard/Expert, turn ≥ 7) — life gain,
 *    card draw, scry, etc. on a land's ETB outranks a vanilla basic of the same
 *    color (acceptance criterion 3).
 *
 * Mid-game (turn 4-6) and late-game (turn 7+) differ in scoring weight: mid-game
 * emphasizes color fixing; late-game layers the utility-ETB bonus on top.
 *
 * Difficulty scaling mirrors the rest of the AI tier taxonomy (#990/#1069):
 * - **easy** — sloppy: random-pick blunder via a fixed-probability roll (the
 *   "misorderChance" knob in mana-sequencing.ts); even when it does call the
 *   scorer the Easy AI is expected to mis-order occasionally (acceptance
 *   criterion 4).
 * - **medium** — uses the scorer without the fetch-bonus short-circuit; no
 *   random blunder.
 * - **hard / expert** — full scorer with fetch + utility-ETB bonuses; no
 *   random blunder at any tier ≥ hard.
 *
 * The function is PURE (no engine mutation, no I/O). Tests drive the
 * `rng` argument for fully reproducible picks.
 *
 * Integration lives in `ai-turn-loop.ts` `playLandIfAvailable` and is
 * intentionally minimal — when an opening plan is present we still honour its
 * `landToPlay` (regression check on #1416); the early-game "first found" path
 * is preserved for turns 1-3 with no opening plan; the scorer only runs for
 * turn ≥ 4 OR when the opening plan was generated but its `landToPlay` is no
 * longer in hand.
 */

import type {
  GameState as EngineGameState,
  PlayerId,
  CardInstanceId,
} from "@/lib/game-state/types";
import type { DifficultyLevel, DifficultyFormat } from "./ai-difficulty";
import {
  countColoredPips,
  producedColors,
  isFetchLand,
  fetchLandTargets,
  entersTapped,
  OPENING_TURNS_MAX,
  type ManaColor,
  type PipCount,
} from "./opening-turn-plan";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** First turn on which the mid-game scoring branch applies (turns ≥ MID_GAME_TURN_MIN). */
export const MID_GAME_TURN_MIN = OPENING_TURNS_MAX + 1; // 4

/**
 **First turn on which the late-game scoring branch applies (turns ≥ LATE_GAME_TURN_MIN).
 * Late-game adds the utility-ETB bonus on top of the mid-game knobs. The
 * boundary mirrors the issue's "7+ lands on the battlefield" criterion
 * (acceptance criterion 3) — by turn 7 the AI is on ~7 lands assuming no
 * significant land destruction, which is when the ETB-vs-vanilla choice
 * becomes a real pick.
 */
export const LATE_GAME_TURN_MIN = 7;

/**
 **Probability the Easy AI picks a random land instead of the scored pick
 * (acceptance criterion 4). Modelled after the `misorderChance` knob in
 * `mana-sequencing.ts` (issue #990) so the existing tier-separation intuition
 * extends naturally to mid-game land picks. Easy's mana-sequencing `misorder
 * Chance` is 0.30; we use 0.35 here to surface Easy blunders slightly more
 * often in the smaller candidate space (a 5-card hand of lands is easier to
 * mis-pick than a full cast-order optimisation).
 */
export const EASY_MISORDER_CHANCE = 0.35;

// ---------------------------------------------------------------------------
// Card-shape accessors (re-implemented locally; do not modify the existing
// `opening-turn-plan.ts` surface to avoid regressing #1416).
// ---------------------------------------------------------------------------

interface CardLike {
  cardData: {
    name?: string;
    type_line?: string;
    oracle_text?: string;
    mana_cost?: string;
    cmc?: number;
    colors?: string[];
  };
  id: CardInstanceId;
}

function isLandCard(c: CardLike): boolean {
  return String(c.cardData.type_line ?? "")
    .toLowerCase()
    .includes("land");
}

function isSpellLike(c: CardLike): boolean {
  const tl = String(c.cardData.type_line ?? "").toLowerCase();
  // Anything that costs mana — creatures, sorceries, instants, artifacts with
  // a mana cost, enchantments, planeswalkers. We exclude lands via isLandCard
  // (already filtered above).
  return !tl.includes("land") && Boolean(c.cardData.mana_cost);
}

function emptyPips(): PipCount {
  return { W: 0, U: 0, B: 0, R: 0, G: 0 };
}

/**
 * Detect an ETB effect with real utility value: life gain, card draw, scry,
 * or counter placement. Used to identify utility lands like Radiant Fountain
 * (gain 1 life ETB) for the late-game utility-ETB bonus (acceptance criterion 3).
 *
 * The regex is intentionally narrow: only effects that materially affect the
 * game state (life, hand size, library top, counters on permanents). Lands
 * with conditional ETBs (e.g. "If you control an artifact, …") are still
 * detected because the ETB clause is present.
 */
function hasUtilityEtb(oracleText: string | undefined): boolean {
  if (!oracleText) return false;
  const lower = oracleText.toLowerCase();
  if (!lower.includes("enters the battlefield")) return false;
  return (
    /\bgain[s]? \d+ life\b/.test(lower) ||
    /\bdraw[s]? a card\b/.test(lower) ||
    /\bscry \d+/.test(lower) ||
    /\bput[s]? a ([a-z]+\+?1|\w+ )counter\b/.test(lower)
  );
}

/**
 * Classify a land card into the shape the scorer consumes.
 *
 * Mirrors `opening-turn-plan.ts`'s `classifyLand` (private) and adds
 * `hasUtilityEtb` (new for #1539). Kept local to keep `opening-turn-plan.ts`
 * unchanged for the #1416 regression test surface.
 */
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
  /** True for lands with a meaningful ETB effect (life, draw, scry, counters). */
  hasUtilityEtb: boolean;
}

function classifyLand(card: CardLike): LandChoice {
  const typeLine = card.cardData.type_line ?? "";
  const oracleText = card.cardData.oracle_text;
  const fetch = isFetchLand(oracleText);
  return {
    cardId: card.id,
    name: card.cardData.name ?? "(unnamed land)",
    isBasic: /\bbasic\b/i.test(typeLine),
    isFetch: fetch,
    isTapped: entersTapped(oracleText),
    produced: producedColors(oracleText, typeLine),
    fetchTargets: fetch ? fetchLandTargets(oracleText) : [],
    hasUtilityEtb: hasUtilityEtb(oracleText),
  };
}

/**
 * Minimal spell shape used to compute color demand. Mirrors
 * `CreatureChoice.pips/cmc` from `opening-turn-plan.ts` but is spell-agnostic
 * (no `colors`, no `power`).
 */
interface SpellLike {
  pips: PipCount;
  cmc: number;
}

function classifySpell(card: CardLike): SpellLike | null {
  if (!card.cardData.mana_cost) return null;
  return {
    pips: countColoredPips(card.cardData.mana_cost),
    cmc: card.cardData.cmc ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Hand / board extraction.
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

function getHandLands(
  state: EngineGameState,
  playerId: PlayerId,
): LandChoice[] {
  return getHandCards(state, playerId).filter(isLandCard).map(classifyLand);
}

function getHandSpells(
  state: EngineGameState,
  playerId: PlayerId,
): SpellLike[] {
  const out: SpellLike[] = [];
  for (const card of getHandCards(state, playerId)) {
    if (!isSpellLike(card)) continue;
    const spell = classifySpell(card);
    if (spell) out.push(spell);
  }
  return out;
}

/**
 * Count colored sources already on the battlefield. A battlefield land that
 * produces both G and U increments both `counts.G` and `counts.U`. Fetch lands
 * on the battlefield count as 0 — the AI is assumed to have cracked them
 * already, leaving the tutored basic in play. (This is conservative: it
 * favours a fresh fixing source in hand when an unresolved demand exists,
 * which is the correct direction for the mid/late-game pick.)
 */
function gatherBattlefieldColors(
  state: EngineGameState,
  playerId: PlayerId,
): PipCount {
  const counts = emptyPips();
  const battlefield = state.zones.get(`${playerId}-battlefield`);
  if (!battlefield) return counts;
  for (const id of battlefield.cardIds) {
    const card = state.cards.get(id) as
      (CardLike & { [k: string]: unknown }) | undefined;
    if (!card || !card.cardData) continue;
    if (
      !String(card.cardData.type_line ?? "")
        .toLowerCase()
        .includes("land")
    ) {
      continue;
    }
    for (const c of producedColors(
      card.cardData.oracle_text,
      card.cardData.type_line,
    )) {
      counts[c]++;
    }
  }
  return counts;
}

function countBattlefieldLands(
  state: EngineGameState,
  playerId: PlayerId,
): number {
  const battlefield = state.zones.get(`${playerId}-battlefield`);
  if (!battlefield) return 0;
  let n = 0;
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
      n++;
    }
  }
  return n;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Inputs for the mid/late-game scorer. Built by {@link chooseMidLateLand} from
 * the engine game state; exported so tests can construct contexts directly
 * without an engine.
 */
export interface MidLateLandContext {
  /** All lands in the AI's hand this turn. */
  handLands: LandChoice[];
  /** All mana-bearing non-ces in the AI's hand (used to derive demand). */
  handSpells: SpellLike[];
  /** Colored sources already on the battlefield, keyed by color. */
  battlefieldColors: PipCount;
  /** Current turn number (1-based). */
  turnNumber: number;
  /** Skill tier of the AI producing the pick. */
  difficulty: DifficultyLevel;
  /** Active format family (reserved for future per-format tuning). */
  format?: DifficultyFormat;
  /** Total land count on the battlefield. Used for the late-game utility gate. */
  landsOnBattlefield: number;
}

/**
 * Sum colored-pip demand across near-term spells. Spells on-curve
 * (cmc <= turnNumber) are weighted double — those are the pips the AI must
 * cover this turn and next. Farther-out spells (cmc <= turnNumber + 2) are
 * weighted single. Spells with cmc > turnNumber + 2 are ignored (the land
 * pick this turn should not pre-commit to a turn-5+ spell's color needs).
 */
function computeColorDemand(spells: SpellLike[], turnNumber: number): PipCount {
  const demand = emptyPips();
  for (const s of spells) {
    if (s.cmc > turnNumber + 2) continue;
    const weight = s.cmc <= turnNumber ? 2 : 1;
    (Object.keys(demand) as ManaColor[]).forEach((color) => {
      demand[color] += s.pips[color] * weight;
    });
  }
  return demand;
}

/**
 * Score a candidate land for mid/late-game play. Higher is better.
 *
 * Knobs (all monotonic in skill — see the per-tier notes):
 * - **Color fixing** +3 per effectively-producible color that satisfies unmet
 *   demand. For fetch lands, "effectively producible" includes their
 *   `fetchTargets` (cracking the fetch puts one of those basics onto the
 *   battlefield). For non-fetches, it's just `produced`.
 * - **Over-fixing penalty** −1.5 per produced color that is already saturated
 *   (battlefield has ≥ demand + 2 for that color). Only applied to colors the
 *   AI actively demands (so a vanilla basic in a mono-color deck isn't
 *   penalised for not producing a colour it's not asked for).
 * - **Basic bonus** +0.5 — basics enable land-type-matters cards and never
 *   cost life or enter tapped.
 * - **Tapped penalty** −0.5 — small in mid/late game (curve is established);
 *   the opening plan already penalises hard for turns 1-3.
 * - **Fetch bonus** (Medium+): +1.5 per fetch target that satisfies unmet
 *   demand. Models "crack this turn for the missing color" on top of the
 *   generic fixing bonus (acceptance criterion 2).
 * - **Late-game utility-ETB bonus** (Hard/Expert, ≥ 7 lands on battlefield):
 *   +2 when the land has a real ETB effect. Acceptance criterion 3 — the
 *   battlefield gate mirrors the issue's "7+ lands on the battlefield"
 *   wording exactly.
 */
export function scoreMidLateLand(
  land: LandChoice,
  context: MidLateLandContext,
): number {
  let score = 0;
  const demand = computeColorDemand(context.handSpells, context.turnNumber);

  // Fetch lands effectively produce their fetch targets (they fix by
  // cracking). Non-fetch lands just produce what they say.
  const effectivelyProduces = land.isFetch
    ? Array.from(new Set([...land.produced, ...land.fetchTargets]))
    : land.produced;

  // Color fixing: +3 per produced color the AI still needs (and the
  // battlefield doesn't already cover).
  for (const color of effectivelyProduces) {
    if (demand[color] > 0 && context.battlefieldColors[color] < demand[color]) {
      score += 3;
    }
  }

  // Over-fixing penalty: -1.5 per produced color that is already over-supplied.
  // We only penalise colors the AI actively demands (otherwise the AI would
  // be punished for playing a dual land in a mono-color deck, which is fine).
  for (const color of land.produced) {
    if (
      demand[color] > 0 &&
      context.battlefieldColors[color] >= demand[color] + 2
    ) {
      score -= 1.5;
    }
  }

  // Basic bonus — small but positive.
  if (land.isBasic) score += 0.5;

  // Tapped penalty — small in mid/late game (the curve has been established).
  if (land.isTapped) score -= 0.5;

  // Fetch bonus (Medium+). Stacks on top of the fix bonus for fetch lands:
  // the +3 fix covers "this land can give me the color"; the +1.5 fetch bonus
  // covers "cracking it this turn finds the missing color now". This is the
  // scoring margin that lets the fetch outrank a tapped dual in the
  // acceptance criterion 2 scenario (fetch fixes +1.5 vs dual's −0.5 tapped).
  if (land.isFetch && context.difficulty !== "easy") {
    for (const target of land.fetchTargets) {
      if (
        demand[target] > 0 &&
        context.battlefieldColors[target] < demand[target]
      ) {
        score += 1.5;
      }
    }
  }

  // Late-game utility-ETB bonus (Hard/Expert, ≥ 7 lands on battlefield).
  // The battlefield gate mirrors the issue's "7+ lands on the battlefield"
  // wording — if the AI is starved for lands, color fixing outranks the
  // utility ETB.
  const isLateGame = context.landsOnBattlefield >= LATE_GAME_TURN_MIN;
  if (
    isLateGame &&
    land.hasUtilityEtb &&
    (context.difficulty === "hard" || context.difficulty === "expert")
  ) {
    score += 2;
  }

  return score;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * The discriminator returned by {@link chooseMidLateLand}. Callers (the turn
 * loop) use this for telemetry / debug logs; tests assert on it to verify the
 * branch was reached.
 *
 * - `"opener"` — the opening-turn plan chose the land (regression check on
 *   #1416; same code path as before for turns 1-3).
 * - `"early_first"` — turn ≤ 3 with no opening plan → first-found (cheap;
 *   curve matters less). Preserves legacy behaviour for turns 1-3 when the
 *   opener is null.
 * - `"scored"` — turn ≥ 4 (or opening plan was null/missing) → scorer picks.
 *     Easy occasionally picks a random land instead of the scored pick
 *     (acceptance criterion 4); the source is still `"scored"` so callers can
 *     tell the branch ran, but the choice may be sub-optimal by design.
 * - `"none"` — no lands in hand; the caller should skip the land drop.
 */
export type MidLateLandSource = "opener" | "early_first" | "scored" | "none";

export interface MidLateLandResult {
  /** The chosen land, or null if no land is in hand. */
  choice: LandChoice | null;
  /** Which branch produced the pick (for telemetry + tests). */
  source: MidLateLandSource;
  /** Score of the chosen land, when `source === "scored"`. Undefined otherwise. */
  score?: number;
  /** Difficulty-tier-appropriate reasoning surfaced via the AI commentary. */
  reasoning: string;
}

/**
 * Minimal shape of the opening plan needed to honour the regression check on
 * #1416. Kept narrow (only `landToPlay`) so callers can pass the full
 * `OpeningTurnPlan | null | undefined` and TypeScript will structurally match.
 */
export interface MinimalOpeningPlan {
  landToPlay: CardInstanceId | null;
}

/**
 * Choose a land to play for the current turn.
 *
 * Branches, in order:
 * 1. **No lands in hand** → `choice: null`, `source: "none"`.
 * 2. **Opening plan with `landToPlay` set** (regression on #1416) → play that
 *    land if it's still in hand; otherwise fall through to (4).
 * 3. **Turn ≤ OPENING_TURNS_MAX with no usable opener pick** → first-found.
 *    (The original early-game behaviour; preserves legacy behaviour for turns
 *    1-3 when no opener ran, e.g. no creatures in hand.)
 * 4. **Mid/late game (turn ≥ MID_GAME_TURN_MIN or opener skipped)** → scored.
 *    Easy adds a {@link EASY_MISORDER_CHANCE} random blunder.
 *
 * Determinism: the only nondeterministic input is `rng` (used only by Easy
 * for the blunder roll and to pick the random fallback). Tests pass a seeded
 * `() => number` for fully reproducible picks. Expert / Hard / Medium tiers
 * are deterministic even with `Math.random`.
 */
export function chooseMidLateLand(
  state: EngineGameState,
  playerId: PlayerId,
  difficulty: DifficultyLevel,
  turnNumber: number,
  openingPlan: MinimalOpeningPlan | null | undefined,
  format: DifficultyFormat | undefined,
  rng: () => number = Math.random,
): MidLateLandResult {
  const handLands = getHandLands(state, playerId);

  // (1) No lands in hand.
  if (handLands.length === 0) {
    return { choice: null, source: "none", reasoning: "No lands in hand" };
  }

  // (2) Opening plan: regression check on #1416. If the opener named a land
  // and that land is still in hand, play it exactly as before. If the opener
  // named a land that's no longer in hand (hand changed since the plan was
  // computed), fall through to the SCORED branch — not to early_first — so
  // the AI gets a thoughtful pick instead of a blind first-found when its
  // plan's preferred land was discarded/drawn/etc.
  let fallbackFromOpener = false;
  if (openingPlan && openingPlan.landToPlay !== null) {
    const planned = handLands.find((l) => l.cardId === openingPlan.landToPlay);
    if (planned) {
      return {
        choice: planned,
        source: "opener",
        reasoning: `Opening plan: play ${planned.name}`,
      };
    }
    // Planned land not in hand — flag for scored fall-through below.
    fallbackFromOpener = true;
  }

  // (3) Early game: turns 1-3 with no opener-driven fallback. Preserves the
  // legacy first-found behaviour for opener-empty hands (e.g. no creatures
  // in hand → opener didn't pick a spell/land → no landToPlay → first-found).
  // When the opener DID pick a land but that land is missing, we skip this
  // branch (above flag) and fall through to the scored pick — better to
  // reason about the choice than blindly play the first card.
  if (
    !fallbackFromOpener &&
    turnNumber >= 1 &&
    turnNumber <= OPENING_TURNS_MAX
  ) {
    const first = handLands[0]!;
    return {
      choice: first,
      source: "early_first",
      reasoning: `Early turn ${turnNumber}: first-found ${first.name}`,
    };
  }

  // (4) Mid/late-game scoring. Build the context once.
  const handSpells = getHandSpells(state, playerId);
  const battlefieldColors = gatherBattlefieldColors(state, playerId);
  const landsOnBattlefield = countBattlefieldLands(state, playerId);

  // `format` is currently used only for documentation — it is reserved for
  // future per-format mid/late tuning and is threaded through so the
  // signature matches the rest of the AI's difficulty/format-aware helpers.
  const context: MidLateLandContext = {
    handLands,
    handSpells,
    battlefieldColors,
    turnNumber,
    difficulty,
    format,
    landsOnBattlefield,
  };

  // Easy blunder (acceptance criterion 4): a fixed-probability random pick.
  // Modelled after mana-sequencing.ts's misorderChance — the AI occasionally
  // picks the wrong land even when a better one is available. We only roll
  // the blunder when there's actually a choice to make (≥ 2 lands).
  if (difficulty === "easy" && handLands.length > 1) {
    if (rng() < EASY_MISORDER_CHANCE) {
      const idx = Math.floor(rng() * handLands.length);
      const blunder = handLands[Math.min(idx, handLands.length - 1)]!;
      return {
        choice: blunder,
        source: "scored",
        reasoning: `Easy blunder: random pick ${blunder.name}`,
      };
    }
  }

  // Scored pick. Stable on ties (preserves insertion order in `handLands`,
  // which itself preserves the engine's hand-zone order).
  let best = handLands[0]!;
  let bestScore = scoreMidLateLand(best, context);
  for (const land of handLands) {
    const s = scoreMidLateLand(land, context);
    if (s > bestScore) {
      bestScore = s;
      best = land;
    }
  }

  return {
    choice: best,
    source: "scored",
    score: bestScore,
    reasoning: `${difficulty} (turn ${turnNumber}): scored ${best.name} (${bestScore.toFixed(1)})`,
  };
}
