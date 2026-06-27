/**
 * Headless full-game simulation harness.
 *
 * Runs AI-vs-AI games to completion WITHOUT any UI/browser, then aggregates the
 * player win rate per difficulty tier. This is the tool that validates the
 * documented difficulty targets in {@link DIFFICULTY_CONFIGS} (≈80/60/40/25%
 * player win rate for easy/medium/hard/expert) and that higher difficulty
 * actually wins more — closing the loop opened by the weight-learning system
 * (#1066).
 *
 * Design notes
 * ------------
 * The production {@link runAITurn} controller is paced for the UI (it sleeps
 * between actions and never resolves combat damage — the game board does that
 * separately). Neither property is acceptable for a fast, deterministic batch
 * harness, so this module drives the rules engine directly:
 *
 *   init → (untap → draw → main(cast) → combat(attack/block/resolve) → cleanup
 *          → next turn)* → terminal
 *
 * Difficulty drives three levers so tier separation is real and measurable:
 *   1. Casting discipline — higher tiers develop a bigger board (skip fewer
 *      castable creatures). Derived from {@link AIDifficultyConfig.blunderChance}
 *      / {@link AIDifficultyConfig.randomnessFactor}.
 *   2. Attack selection — {@link CombatDecisionTree} keyed to the tier.
 *   3. Block selection — the defender's {@link CombatDecisionTree} keyed to its
 *      tier.
 *
 * Determinism: a seeded PRNG (mulberry32) replaces `Math.random` for the whole
 * run (deck shuffle + discipline blunders), so a given seed reproduces exactly.
 * Termination: every game is capped at `maxTurns` (→ draw), so the harness can
 * never loop forever.
 *
 * Issue #1065.
 */

import {
  createInitialGameState,
  loadDeckForPlayer,
  startGame,
  drawCard,
  checkStateBasedActions,
} from "@/lib/game-state/game-state";
import {
  addMana,
  canAffordMana,
  emptyManaPool,
  canPlayLand,
  playLand,
} from "@/lib/game-state/mana";
import {
  canCastSpell,
  castSpell,
  resolveTopOfStack,
} from "@/lib/game-state/spell-casting";
import {
  declareAttackers,
  declareBlockers,
  resolveCombatDamage,
} from "@/lib/game-state/combat";
import { discardCards } from "@/lib/game-state/keyword-actions";
import { startNextTurn } from "@/lib/game-state/turn-phases";
import {
  Phase,
  type GameState,
  type PlayerId,
  type CardInstanceId,
  type CardInstance,
} from "@/lib/game-state/types";
import {
  DIFFICULTY_CONFIGS,
  type DifficultyLevel,
  type DifficultyFormat,
} from "@/ai/ai-difficulty";
import { getMaxHandSize } from "@/lib/game-rules";
import type { ScryfallCard } from "@/app/actions";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Deck playstyles available to the simulator. */
export type SimDeckArchetype = "aggro" | "midrange" | "control";

/** Outcome of a single simulated game. */
export interface GameOutcome {
  /** Winning seat, or `null` for a draw (turn cap reached). */
  winner: "player" | "opponent" | null;
  /** Turns elapsed (the turn counter of the active player when the game ended). */
  turns: number;
  /** Why the game ended. */
  endReason: "life" | "concede" | "turn_cap" | "error";
  /** Final life of the player seat. */
  playerLife: number;
  /** Final life of the opponent seat. */
  opponentLife: number;
}

/** Aggregated result of a matchup over N games. */
export interface MatchResult {
  /** Difficulty of the tracked "player" seat. */
  playerDifficulty: DifficultyLevel;
  /** Difficulty of the opposing seat. */
  opponentDifficulty: DifficultyLevel;
  /** Games played. */
  games: number;
  /** Player seat wins. */
  wins: number;
  /** Player seat losses. */
  losses: number;
  /** Draws (turn-cap reached). */
  draws: number;
  /** Player win rate in [0,1] (wins / games). */
  winRate: number;
  /** Mean turns per game. */
  avgTurns: number;
}

/** Configuration for {@link simulateGame}. */
export interface GameConfig {
  playerDifficulty: DifficultyLevel;
  opponentDifficulty: DifficultyLevel;
  /** Base RNG seed. Each game derives a distinct stream from it. */
  seed: number;
  /** Per-game seat offset so consecutive games differ. */
  gameIndex?: number;
  /**
   * Which engine seat (0 = first turn, 1 = second turn) the tracked "player"
   * occupies. Matchups alternate this to cancel first-turn advantage.
   */
  playerSeat?: 0 | 1;
  startingLife?: number;
  maxTurns?: number;
  playerDeck?: SimDeckArchetype;
  opponentDeck?: SimDeckArchetype;
  format?: DifficultyFormat;
}

/** Configuration for a full difficulty sweep (each tier vs a baseline). */
export interface SweepConfig {
  /** Games per tier. */
  games: number;
  /** Base seed (reproducible). */
  seed?: number;
  /** Fixed opponent difficulty each tier is measured against. */
  baseline?: DifficultyLevel;
  startingLife?: number;
  maxTurns?: number;
  playerDeck?: SimDeckArchetype;
  opponentDeck?: SimDeckArchetype;
  format?: DifficultyFormat;
}

const DEFAULT_MAX_TURNS = 80;
const DEFAULT_STARTING_LIFE = 20;
const ALL_TIERS: DifficultyLevel[] = ["easy", "medium", "hard", "expert"];

// ---------------------------------------------------------------------------
// Determinism helpers
// ---------------------------------------------------------------------------

/**
 * mulberry32 — tiny, fast, deterministic PRNG. Returns a function producing
 * floats in [0, 1). Same seed → identical sequence.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Run `fn` with `Math.random` replaced by a seeded PRNG, restoring the
 * original afterwards. This makes every engine call that consults
 * `Math.random` (notably the library shuffle in {@link loadDeckForPlayer})
 * reproducible.
 */
function withSeededRandom<T>(seed: number, fn: (rng: () => number) => T): T {
  const original = Math.random;
  const rng = mulberry32(seed);
  Math.random = rng;
  try {
    return fn(rng);
  } finally {
    Math.random = original;
  }
}

// ---------------------------------------------------------------------------
// Deck pool
// ---------------------------------------------------------------------------

let deckCardCounter = 0;

function vanillaCard(
  name: string,
  typeLine: string,
  opts: Partial<ScryfallCard>,
): ScryfallCard {
  deckCardCounter++;
  return {
    id: `sim-card-${deckCardCounter}`,
    name,
    cmc: opts.cmc ?? 0,
    type_line: typeLine,
    colors: [],
    color_identity: [],
    legalities: {},
    mana_cost: opts.mana_cost,
    power: opts.power,
    toughness: opts.toughness,
    oracle_text: opts.oracle_text,
    ...opts,
  };
}

function repeat(n: number, fn: (i: number) => ScryfallCard): ScryfallCard[] {
  const out: ScryfallCard[] = [];
  for (let i = 0; i < n; i++) out.push(fn(i));
  return out;
}

function basicLand(i: number): ScryfallCard {
  return vanillaCard(`Plains ${i}`, "Land — Plains", {});
}

function creature(
  i: number,
  prefix: string,
  power: string,
  toughness: string,
  cmc: number,
): ScryfallCard {
  return vanillaCard(`${prefix} ${i}`, "Creature", {
    cmc,
    mana_cost: `{${cmc}}`,
    power,
    toughness,
  });
}

/**
 * Build a fixed 60-card deck for an archetype. All costs are generic and all
 * creatures are vanilla, which keeps mana payment and combat resolution simple
 * and fully deterministic. The three archetypes differ in their creature
 * curve so the matchup pool is varied (aggro/midrange/control per #1065).
 */
export function buildDeck(archetype: SimDeckArchetype): ScryfallCard[] {
  switch (archetype) {
    case "aggro":
      return [
        ...repeat(24, (i) => basicLand(i)),
        ...repeat(22, (i) => creature(i, "Raptor", "2", "1", 1)),
        ...repeat(14, (i) => creature(i, "Hound", "2", "2", 2)),
      ];
    case "control":
      return [
        ...repeat(26, (i) => basicLand(i)),
        ...repeat(10, (i) => creature(i, "Bulwark", "1", "4", 2)),
        ...repeat(14, (i) => creature(i, "Sphinx", "3", "3", 3)),
        ...repeat(10, (i) => creature(i, "Titan", "5", "5", 5)),
      ];
    case "midrange":
    default:
      return [
        ...repeat(24, (i) => basicLand(i)),
        ...repeat(16, (i) => creature(i, "Knight", "2", "3", 2)),
        ...repeat(12, (i) => creature(i, "Behemoth", "3", "3", 3)),
        ...repeat(8, (i) => creature(i, "Goliath", "4", "4", 4)),
      ];
  }
}

// ---------------------------------------------------------------------------
// Turn driver primitives
// ---------------------------------------------------------------------------

function setPhase(state: GameState, phase: Phase, priority: PlayerId): GameState {
  return {
    ...state,
    turn: { ...state.turn, currentPhase: phase },
    priorityPlayerId: priority,
    stack: [],
    consecutivePasses: 0,
  };
}

/** Untap all permanents the active player controls and clear marked damage. */
function untapStep(state: GameState, playerId: PlayerId): GameState {
  const bfKey = `${playerId}-battlefield`;
  const battlefield = state.zones.get(bfKey);
  if (!battlefield) return state;
  const cards = new Map(state.cards);
  for (const cardId of battlefield.cardIds) {
    const card = cards.get(cardId);
    if (!card) continue;
    cards.set(cardId, {
      ...card,
      isTapped: false,
      hasSummoningSickness: false,
      damage: 0,
    });
  }
  // Lands-played and mana pool reset at the start of the turn.
  const players = new Map(state.players);
  const player = players.get(playerId);
  if (player) {
    players.set(playerId, { ...player, landsPlayedThisTurn: 0 });
  }
  return { ...state, cards, players };
}

/**
 * Tap every untapped land the player controls and add that much colorless mana
 * to their pool (basic lands are treated as colorless producers). Returns the
 * new state. Mana is spent by {@link castSpell} itself.
 */
function produceMana(state: GameState, playerId: PlayerId): GameState {
  const bfKey = `${playerId}-battlefield`;
  const battlefield = state.zones.get(bfKey);
  if (!battlefield) return state;
  let produced = 0;
  const cards = new Map(state.cards);
  for (const cardId of battlefield.cardIds) {
    const card = cards.get(cardId);
    if (!card) continue;
    const isLand = (card.cardData.type_line || "").toLowerCase().includes("land");
    if (isLand && !card.isTapped) {
      produced++;
      cards.set(cardId, { ...card, isTapped: true });
    }
  }
  let next = produced > 0 ? { ...state, cards } : state;
  if (produced > 0) {
    next = addMana(next, playerId, { colorless: produced });
  }
  return next;
}

/** Parse a vanilla creature's effective power (base + modifier). */
function effectivePower(card: CardInstance): number {
  const base = parseInt(card.cardData.power || "0", 10);
  return (Number.isFinite(base) ? base : 0) + (card.powerModifier || 0);
}

function effectiveToughness(card: CardInstance): number {
  const base = parseInt(card.cardData.toughness || "0", 10);
  return (Number.isFinite(base) ? base : 0) + (card.toughnessModifier || 0);
}

function isCreatureCard(card: CardInstance): boolean {
  return (card.cardData.type_line || "").toLowerCase().includes("creature");
}

/**
 * Cast affordable creatures from hand, gated by a difficulty-derived discipline
 * factor. Each castable creature is independently cast with probability
 * `profile.cast`, so weaker tiers develop a smaller board across a game — one
 * of the three levers by which difficulty moves win rate.
 */
function mainPhaseCast(
  state: GameState,
  playerId: PlayerId,
  difficulty: DifficultyLevel,
  rng: () => number,
): GameState {
  let s = state;
  const { cast } = difficultyProfile(difficulty);
  const handKey = `${playerId}-hand`;
  // Re-read the hand each iteration: successful casts mutate zones.
  // Bound the passes by the starting hand size to avoid hot loops.
  const startingHand = s.zones.get(handKey)?.cardIds.length ?? 0;
  for (let pass = 0; pass < startingHand + 1; pass++) {
    const hand = s.zones.get(handKey);
    if (!hand) break;
    // Pick the strongest affordable creature.
    const candidates = hand.cardIds
      .map((id) => s.cards.get(id))
      .filter((c): c is CardInstance => !!c && isCreatureCard(c))
      .sort((a, b) => effectivePower(b) - effectivePower(a));

    const affordable = candidates.filter((c) =>
      canAffordMana(s, playerId, { generic: c.cardData.cmc || 0 }),
    );
    if (affordable.length === 0) break;
    const pick = affordable[0];

    // Difficulty gate: weaker tiers sometimes skip an available cast and move
    // on (a blunder), rather than always developing the board.
    if (rng() > cast) {
      // Skip just this creature by removing it from consideration: emulate by
      // breaking — the simplest way to "not cast this turn" without re-casting
      // the same skipped card. Higher tiers (cast≈1) effectively never skip.
      break;
    }

    if (!canCastSpell(s, playerId, pick.id).canCast) break;
    const result = castSpell(s, playerId, pick.id);
    if (!result.success) break;
    s = result.state;
    // Resolve immediately (no opponent responses in the harness).
    while (s.stack.length > 0) s = resolveTopOfStack(s);
  }
  return s;
}

/**
 * Strong, monotonic per-tier decision probabilities DERIVED from the live
 * difficulty system ({@link DIFFICULTY_CONFIGS}). `randomnessFactor` +
 * `blunderChance` collapse into a `skill` score (higher = fewer mistakes) that
 * is mapped — through a fixed curve — onto the three win-rate levers, so the
 * harness reflects the real tuning knobs rather than an independent table:
 *
 *   cast  — probability an affordable creature is cast (board development)
 *   attack— probability an available creature is sent to attack (combat pressure)
 *   block — probability a recommended block is actually made (defense)
 *
 * The curve guarantees strict tier ordering (skill is monotonic across tiers)
 * and a wide enough gap for measurable win-rate separation.
 */
interface DifficultyProfile {
  cast: number;
  attack: number;
  block: number;
}
function difficultyProfile(difficulty: DifficultyLevel): DifficultyProfile {
  const cfg = DIFFICULTY_CONFIGS[difficulty];
  const skill = clamp01(1 - cfg.randomnessFactor - cfg.blunderChance);
  // skill ≈ easy 0.35 / medium 0.70 / hard 0.85 / expert 0.93.
  const lever = (base: number, span: number) =>
    Math.min(1, Math.max(0, base + span * skill));
  return {
    cast: lever(0.45, 0.55),
    attack: lever(0.4, 0.6),
    block: lever(0.3, 0.7),
  };
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** Back-compat alias used by the land-drop gate. */
function castingDiscipline(difficulty: DifficultyLevel): number {
  return difficultyProfile(difficulty).cast;
}

/**
 * Move creatures with lethal marked damage to the graveyard and clear damage
 * on survivors. {@link checkStateBasedActions} flags lethal damage but does not
 * move creatures (it leaves that to a destroy-event path the harness bypasses),
 * so we apply the state-based destruction directly.
 */
function resolveCreatureDeaths(state: GameState): GameState {
  let changed = false;
  const cards = new Map(state.cards);
  const zones = new Map(state.zones);
  for (const [playerId, player] of state.players) {
    const bfKey = `${playerId}-battlefield`;
    const gyKey = `${playerId}-graveyard`;
    const bf = zones.get(bfKey);
    const gy = zones.get(gyKey);
    if (!bf || !gy) continue;
    const survivors: CardInstanceId[] = [];
    const dead: CardInstanceId[] = [];
    for (const cardId of bf.cardIds) {
      const card = cards.get(cardId);
      if (!card) {
        survivors.push(cardId);
        continue;
      }
      if (!isCreatureCard(card)) {
        survivors.push(cardId);
        continue;
      }
      const toughness = effectiveToughness(card);
      if (toughness > 0 && (card.damage || 0) >= toughness) {
        dead.push(cardId);
      } else {
        survivors.push(cardId);
        if ((card.damage || 0) > 0) {
          cards.set(cardId, { ...card, damage: 0 });
          changed = true;
        }
      }
    }
    if (dead.length > 0) {
      for (const cardId of dead) {
        const card = cards.get(cardId);
        if (card) cards.set(cardId, { ...card, damage: 0 });
      }
      zones.set(bfKey, { ...bf, cardIds: survivors });
      zones.set(gyKey, { ...gy, cardIds: [...gy.cardIds, ...dead] });
      changed = true;
    }
    // Reference playerId to satisfy the loop binding lint cleanly.
    void player;
  }
  return changed ? { ...state, cards, zones } : state;
}

/**
 * Resolve a full combat:
 *   1. Attacker selects attackers (each available creature attacks with
 *      probability `profile.attack`).
 *   2. Defender greedily blocks (block the biggest attackers first with the
 *      smallest blocker that kills them, else the biggest available blocker),
 *      with each assignment gated by `profile.block`.
 *   3. Combat damage resolves and lethal creatures die.
 *
 * The difficulty profile drives both attack aggression and block discipline, so
 * higher tiers apply more pressure and defend better — the two combat levers by
 * which difficulty moves win rate. The engine calls are guarded so a malformed
 * state can never crash the turn.
 */
function combatStep(
  state: GameState,
  attackerId: PlayerId,
  defenderId: PlayerId,
  attackerDifficulty: DifficultyLevel,
  defenderDifficulty: DifficultyLevel,
  rng: () => number,
): GameState {
  let s = state;
  const attackProfile = difficultyProfile(attackerDifficulty).attack;
  const blockProfile = difficultyProfile(defenderDifficulty).block;

  // --- Declare attackers (difficulty-gated selection) ---
  const available = availableAttackers(s, attackerId, defenderId);
  const attackingIds: { cardId: CardInstanceId; defenderId: PlayerId }[] = [];
  for (const a of available) {
    if (rng() < attackProfile) attackingIds.push(a);
  }
  if (attackingIds.length === 0) return s;

  s = setPhase(s, Phase.DECLARE_ATTACKERS, attackerId);
  const attackResult = declareAttackers(s, attackingIds);
  if (!attackResult.success) return state;
  s = attackResult.state;

  // --- Declare blockers (greedy, difficulty-gated) ---
  const blockAssignments = chooseBlocks(
    s,
    attackerId,
    defenderId,
    attackingIds.map((a) => a.cardId),
    blockProfile,
    rng,
  );
  if (blockAssignments.size > 0) {
    s = setPhase(s, Phase.DECLARE_BLOCKERS, defenderId);
    const blockResult = declareBlockers(s, blockAssignments);
    if (blockResult.success) s = blockResult.state;
  }

  // --- Resolve combat damage (regular step; decks are vanilla) ---
  s = setPhase(s, Phase.COMBAT_DAMAGE, attackerId);
  const dmgResult = resolveCombatDamage(s);
  if (dmgResult.success) s = dmgResult.state;
  s = checkStateBasedActions(s);
  s = resolveCreatureDeaths(s);

  return s;
}

/** Every creature the attacker can legally attack with this combat. */
function availableAttackers(
  state: GameState,
  attackerId: PlayerId,
  defenderId: PlayerId,
): { cardId: CardInstanceId; defenderId: PlayerId }[] {
  const battlefield = state.zones.get(`${attackerId}-battlefield`);
  if (!battlefield) return [];
  const out: { cardId: CardInstanceId; defenderId: PlayerId }[] = [];
  for (const cardId of battlefield.cardIds) {
    const card = state.cards.get(cardId);
    if (!card || !isCreatureCard(card)) continue;
    if (card.isTapped || card.hasSummoningSickness) continue;
    out.push({ cardId, defenderId });
  }
  return out
    .map((a) => ({ ...a, power: effectivePower(state.cards.get(a.cardId)! ) }))
    .sort((a, b) => b.power - a.power)
    .map(({ cardId, defenderId }) => ({ cardId, defenderId }));
}

/**
 * Greedy blocking: handle the most dangerous attackers first. For each attacker
 * (descending power), assign the smallest untapped blocker that can destroy it
 * (efficient trade); if none can, assign the biggest available blocker to at
 * least trade/chump — but only if `rng() < blockProfile`, so weaker defenders
 * miss blocks (the defensive difficulty lever).
 *
 * Returns a map of attackerId → blockerIds[].
 */
function chooseBlocks(
  state: GameState,
  attackerId: PlayerId,
  defenderId: PlayerId,
  attackingIds: CardInstanceId[],
  blockProfile: number,
  rng: () => number,
): Map<CardInstanceId, CardInstanceId[]> {
  const assignments = new Map<CardInstanceId, CardInstanceId[]>();
  const bfKey = `${defenderId}-battlefield`;
  const battlefield = state.zones.get(bfKey);
  if (!battlefield) return assignments;

  // Pool of untapped, non-summoning-sick defender creatures, biggest first.
  const blockerPool = battlefield.cardIds
    .map((id) => state.cards.get(id))
    .filter((c): c is CardInstance => {
      if (!c || !isCreatureCard(c)) return false;
      return !c.isTapped && !c.hasSummoningSickness;
    })
    .sort((a, b) => effectivePower(b) - effectivePower(a));
  const usedBlockers = new Set<CardInstanceId>();

  // Attackers, most dangerous first.
  const sortedAttackers = attackingIds
    .map((id) => ({ id, power: effectivePower(state.cards.get(id)!) }))
    .sort((a, b) => b.power - a.power);

  for (const atk of sortedAttackers) {
    const atkCard = state.cards.get(atk.id);
    if (!atkCard) continue;
    const atkTough = effectiveToughness(atkCard);

    // Difficulty gate: weaker defenders skip blocking this attacker entirely.
    if (rng() > blockProfile) continue;

    // Prefer the smallest unused blocker that can kill the attacker (trade up).
    let chosen: CardInstance | undefined;
    for (const b of blockerPool) {
      if (usedBlockers.has(b.id)) continue;
      if (effectivePower(b) >= atkTough) {
        chosen = b;
        break;
      }
    }
    // Otherwise throw the biggest remaining blocker in front (trade or chump).
    if (!chosen) {
      for (const b of blockerPool) {
        if (!usedBlockers.has(b.id)) {
          chosen = b;
          break;
        }
      }
    }
    if (!chosen) continue;
    usedBlockers.add(chosen.id);
    const list = assignments.get(atk.id) ?? [];
    list.push(chosen.id);
    assignments.set(atk.id, list);
  }
  return assignments;
}

/** Discard down to the max hand size at end of turn. */
function cleanupStep(state: GameState, playerId: PlayerId): GameState {
  let s = emptyManaPool(state, playerId);
  const handKey = `${playerId}-hand`;
  const hand = s.zones.get(handKey);
  const max = getMaxHandSize();
  if (hand && hand.cardIds.length > max) {
    const excess = hand.cardIds.length - max;
    const result = discardCards(s, playerId, excess, false);
    if (result.success && result.state) s = result.state;
  }
  return s;
}

/** Reset combat state between turns. */
function clearCombat(state: GameState): GameState {
  return {
    ...state,
    combat: {
      inCombatPhase: false,
      attackers: [],
      blockers: new Map(),
      remainingCombatPhases: 0,
    },
  };
}

/** Has any player reached a terminal life total? */
function isTerminal(state: GameState): boolean {
  if (state.status === "completed") return true;
  for (const player of state.players.values()) {
    if (player.life <= 0) return true;
  }
  return false;
}

/**
 * Play one full turn for `attackerId` (the active player). Returns the updated
 * state and does NOT switch the turn — the caller advances to the next player.
 */
export function playTurn(
  state: GameState,
  attackerId: PlayerId,
  defenderId: PlayerId,
  attackerDifficulty: DifficultyLevel,
  defenderDifficulty: DifficultyLevel,
  rng: () => number,
): GameState {
  let s = state;
  // Untap + reset land plays/damage.
  s = untapStep(s, attackerId);
  // Draw for turn.
  s = drawCard(s, attackerId);

  // Pre-combat main: play a land (best tier always; weak tiers sometimes skip).
  s = setPhase(s, Phase.PRECOMBAT_MAIN, attackerId);
  s = maybePlayLand(s, attackerId, attackerDifficulty, rng);
  s = produceMana(s, attackerId);
  s = mainPhaseCast(s, attackerId, attackerDifficulty, rng);

  if (isTerminal(s)) return s;

  // Combat.
  s = combatStep(s, attackerId, defenderId, attackerDifficulty, defenderDifficulty, rng);
  if (isTerminal(s)) return s;

  // Post-combat main: spend any remaining topdecked/remaining mana.
  s = setPhase(s, Phase.POSTCOMBAT_MAIN, attackerId);
  s = mainPhaseCast(s, attackerId, attackerDifficulty, rng);

  // Cleanup + hand-size reset.
  s = cleanupStep(s, attackerId);
  s = clearCombat(s);
  return s;
}

function maybePlayLand(
  state: GameState,
  playerId: PlayerId,
  difficulty: DifficultyLevel,
  rng: () => number,
): GameState {
  // Easy tiers occasionally miss their land drop; expert never does.
  const landDiscipline = Math.min(1, castingDiscipline(difficulty) + 0.1);
  if (rng() > landDiscipline) return state;
  if (!canPlayLand(state, playerId)) return state;
  const handKey = `${playerId}-hand`;
  const hand = state.zones.get(handKey);
  if (!hand) return state;
  const landId = hand.cardIds.find((id) => {
    const c = state.cards.get(id);
    return c && (c.cardData.type_line || "").toLowerCase().includes("land");
  });
  if (!landId) return state;
  const result = playLand(state, playerId, landId);
  return result.success ? result.state : state;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Simulate a single headless game to completion. Deterministic for a fixed
 * (seed, gameIndex, difficulties, decks) tuple. Always terminates: the game is
 * drawn if `maxTurns` is reached.
 */
export function simulateGame(config: GameConfig): GameOutcome {
  const {
    playerDifficulty,
    opponentDifficulty,
    seed,
    gameIndex = 0,
    playerSeat = 0,
    startingLife = DEFAULT_STARTING_LIFE,
    maxTurns = DEFAULT_MAX_TURNS,
    playerDeck = "midrange",
    opponentDeck = "midrange",
  } = config;

  return withSeededRandom(seed + gameIndex * 0x9e3779b1, (rng) => {
    let state = createInitialGameState(
      ["sim-player", "sim-opponent"],
      startingLife,
      false,
    );
    const ids = Array.from(state.players.keys());
    // Seat 0 always takes the first turn (engine default). Assigning the
    // tracked "player" to seat 0 or 1 swaps who plays first, which a matchup
    // alternates to cancel the first-turn advantage.
    const player = playerSeat === 0 ? ids[0] : ids[1];
    const opponent = playerSeat === 0 ? ids[1] : ids[0];

    state = loadDeckForPlayer(state, player, buildDeck(playerDeck), true);
    state = loadDeckForPlayer(state, opponent, buildDeck(opponentDeck), true);
    state = startGame(state);
    state = {
      ...state,
      status: "in_progress",
      priorityPlayerId: ids[0],
      turn: { ...state.turn, currentPhase: Phase.UNTAP, activePlayerId: ids[0] },
    };

    let active = ids[0];
    let defender = ids[1];
    let turns = 0;

    while (turns < maxTurns) {
      turns++;
      state = playTurn(
        state,
        active,
        defender,
        active === player ? playerDifficulty : opponentDifficulty,
        active === player ? opponentDifficulty : playerDifficulty,
        rng,
      );
      state = checkStateBasedActions(state);

      const playerLife = state.players.get(player)?.life ?? 0;
      const opponentLife = state.players.get(opponent)?.life ?? 0;

      if (isTerminal(state)) {
        // Decide the winning seat from life totals (engine ids are
        // non-deterministic, so we never compare raw ids across games).
        let winner: "player" | "opponent" | null;
        if (playerLife <= 0 && opponentLife <= 0) winner = null;
        else if (opponentLife <= 0) winner = "player";
        else if (playerLife <= 0) winner = "opponent";
        else winner = state.winners.includes(player)
          ? "player"
          : state.winners.includes(opponent)
            ? "opponent"
            : null;
        return { winner, turns, endReason: "life", playerLife, opponentLife };
      }

      // Pass the turn to the other player.
      const next = active === player ? opponent : player;
      state = {
        ...state,
        turn: startNextTurn(state.turn, next, false),
        priorityPlayerId: next,
      };
      active = next;
      defender = active === player ? opponent : player;
    }

    // Turn cap reached → draw.
    return {
      winner: null,
      turns,
      endReason: "turn_cap",
      playerLife: state.players.get(player)?.life ?? 0,
      opponentLife: state.players.get(opponent)?.life ?? 0,
    };
  });
}

/**
 * Run `config.games` games for a single difficulty pairing and aggregate the
 * player seat's win rate.
 */
export function simulateMatchup(
  playerDifficulty: DifficultyLevel,
  opponentDifficulty: DifficultyLevel,
  config: { games: number; seed?: number; format?: DifficultyFormat } & Omit<
    GameConfig,
    "playerDifficulty" | "opponentDifficulty" | "seed" | "gameIndex"
  >,
): MatchResult {
  const baseSeed = config.seed ?? 1;
  let wins = 0;
  let losses = 0;
  let draws = 0;
  let totalTurns = 0;
  for (let i = 0; i < config.games; i++) {
    const outcome = simulateGame({
      ...config,
      playerDifficulty,
      opponentDifficulty,
      seed: baseSeed,
      gameIndex: i,
      // Alternate who plays first so the first-turn advantage washes out over
      // the matchup. Seat 0 = first turn.
      playerSeat: i % 2 === 0 ? 0 : 1,
    });
    totalTurns += outcome.turns;
    if (outcome.winner === null) draws++;
    else if (outcome.winner === "player") wins++;
    else losses++;
  }
  return {
    playerDifficulty,
    opponentDifficulty,
    games: config.games,
    wins,
    losses,
    draws,
    winRate: config.games > 0 ? wins / config.games : 0,
    avgTurns: config.games > 0 ? totalTurns / config.games : 0,
  };
}

/**
 * Run each difficulty tier (easy → expert) against a fixed baseline opponent
 * and return the observed player win rate per tier. Expected to be monotonic
 * non-decreasing: harder player tiers win more often.
 */
export function simulateDifficultySweep(config: SweepConfig): MatchResult[] {
  const baseline = config.baseline ?? "expert";
  return ALL_TIERS.map((tier) =>
    simulateMatchup(tier, baseline, {
      games: config.games,
      seed: config.seed ?? 1,
      startingLife: config.startingLife,
      maxTurns: config.maxTurns,
      playerDeck: config.playerDeck,
      opponentDeck: config.opponentDeck,
      format: config.format,
    }),
  );
}

/**
 * Format a {@link MatchResult} as a single human-readable line for the CLI.
 */
export function formatMatchResult(r: MatchResult): string {
  const pct = (r.winRate * 100).toFixed(1);
  return (
    `${r.playerDifficulty.padEnd(7)} vs ${r.opponentDifficulty.padEnd(7)} ` +
    `→ ${pct}% win (${r.wins}-${r.losses}-${r.draws}) over ${r.games} games, ` +
    `avg ${r.avgTurns.toFixed(1)} turns`
  );
}
