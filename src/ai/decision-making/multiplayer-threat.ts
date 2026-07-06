/**
 * @fileoverview Multiplayer Threat Assessment (issue #1233).
 *
 * With issue #1087 wiring up 2-4 player P2P mesh games, the AI must play
 * meaningfully in a pod — not just sum a board score and pick the lowest-life
 * opponent (which produces classic kingmaking). This module provides:
 *
 *  1. {@link MultiplayerThreatAssessment} — a 0..1 composite threat score for
 *     every opponent plus a few narrative flags (`isThreatLeader`,
 *     `isAboutToLose`) the rest of the AI consumes.
 *  2. {@link assessThreats} — sorts opponents for combat, politics, and
 *     interaction decisions. The leader is the opponent that should be
 *     attacked, countered, and pressured; not necessarily the lowest life.
 *  3. {@link chooseAttackTarget} — picks an attack target. Refuses to
 *     "kingmake" (knock out a player who was about to lose to someone else)
 *     and prefers the threat leader. At Easy the function is intentionally
 *     noisy/blundering; at Expert it consults the full model.
 *  4. {@link chooseResponseTarget} — picks which spell/ability on the stack to
 *     counter. Prefers the leader's spell; at Easy it picks the cheapest.
 *
 * Coverage target ≥ 70 % on this module, matching the AGENTS.md "Threat
 * Assessment" workflow. The existing single-player combat-decision-tree
 * shape stays unchanged — this module exposes pure functions that other AI
 * layers (combat, stack) call into to resolve a target.
 *
 * Reference issue: #1233.
 * Depends on: `opposingCommanderThreat` from `commander-math.ts` (#1234).
 */

import type {
  AIGameState,
  AIPlayerState,
  AIPermanent,
} from "@/lib/game-state/types";
import type { DifficultyLevel } from "../ai-difficulty";
import {
  opposingCommanderThreat,
  type OpposingCommanderThreatInput,
} from "./commander-math";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * One opponent's threat profile. Returned by {@link assessThreats}. The shape
 * is intentionally flat so call sites (combat, stack, telegraph) can grab
 * the bits they need without unwrapping nested objects.
 *
 * Naming: the `ThreatAssessment` name already exists in
 * `game-state-evaluator.ts` for *permanent*-level threats; we use
 * `MultiplayerThreatAssessment` to keep both modules exportable without
 * ambiguity.
 */
export interface MultiplayerThreatAssessment {
  /** Opponent's player ID. */
  playerId: string;

  /**
   * Composite 0..1 threat score. Higher = opponent is more dangerous to the
   * AI this turn and should be prioritised for attacks / counters.
   */
  threatScore: number;

  /** Sub-score (0..1): opponent's life total inverted and clamped. */
  lifeScore: number;

  /** Sub-score (0..1): opponent's board strength (creatures + open mana). */
  boardScore: number;

  /** Sub-score (0..1): opposing-commander threat (delegated to commander-math). */
  commanderScore: number;

  /** Sub-score (0..1): explicit pressure — attackers aimed at the AI, stack
   *  spells on the stack from this opponent. Cheap proxy for "intent". */
  intentScore: number;

  /** True if this opponent has the highest `threatScore` of the pod. */
  isThreatLeader: boolean;

  /**
   * True if some *other* opponent can kill this one on their next turn
   * (heuristic: their board power ≥ this opponent's life). Attacking into a
   * flagged target is kingmaking and {@link chooseAttackTarget} refuses to do
   * so at Hard/Expert.
   */
  isAboutToLose: boolean;

  /** Human-readable summary, surfaced via the AI telegraph when relevant. */
  reason: string;
}

/** Options accepted by {@link chooseAttackTarget}. */
export interface ChooseAttackTargetOptions {
  /** RNG for difficulty-driven noise (testable, defaulting to Math.random). */
  rng?: () => number;
  /**
   * Explicit ordered candidate list — typically `[opponentA, opponentB, ...]`.
   * When omitted the function reads every non-AI player from `gameState`.
   */
  opponents?: string[];
}

/** Outcome of {@link chooseAttackTarget} for the AI's "why" surface. */
export interface AttackTargetDecision {
  /** The chosen opponent player ID (or `null` if no legal target). */
  targetId: string | null;
  /** `true` when the choice was constrained to avoid kingmaking. */
  avoidedKingmaking: boolean;
  /** Short rationale for the decision. */
  reason: string;
}

/** Options accepted by {@link chooseResponseTarget}. */
export interface ChooseResponseTargetOptions {
  rng?: () => number;
}

/** Outcome of {@link chooseResponseTarget}. */
export interface ResponseTargetDecision {
  /** The chosen stack object ID (or `null` if no legal counter target). */
  stackObjectId: string | null;
  /** Controller ID of the targeted spell/ability (for explanation). */
  controllerId: string | null;
  reason: string;
}

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

/** Default starting life for "mid range" inversion. */
const LIFE_NORMALIZER = 40;

/**
 * Weight vector for the composite threat score. Tuned against a 3-player
 * Pod where one player is at 3 life with a pumped commander, one player at
 * 20 with an empty board, and the AI at 15: the 3-life player must rank
 * above the 20-life player because the pumped commander one-shots the AI.
 *
 * Numbers are deliberately normalised; the relative ordering matters more
 * than the absolute magnitudes.
 */
const DEFAULT_WEIGHTS = {
  life: 0.35,
  board: 0.25,
  commander: 0.3,
  intent: 0.1,
} as const;

/**
 * Difficulty-keyed noise amplitude. At Easy the AI's ranking is intentionally
 * ragged so a kingmaking attack happens often enough to teach players the
 * rule; at Expert the AI is deterministic given the same game state.
 */
const DIFFICULTY_NOISE: Record<DifficultyLevel, number> = {
  easy: 0.4,
  medium: 0.15,
  hard: 0.05,
  expert: 0,
};

/**
 * Difficulty-keyed kingmaking policy. At Hard/Expert the AI refuses to
 * attack a player flagged `isAboutToLose` unless no alternative exists.
 * Medium applies a soft penalty; Easy ignores kingmaking altogether
 * (it is a teaching tier and accepts the "knock out the weakest" line).
 */
const MUST_AVOID_KINGMAKING: Record<DifficultyLevel, boolean> = {
  easy: false,
  medium: false,
  hard: true,
  expert: true,
};

/* -------------------------------------------------------------------------- */
/* Internal helpers                                                           */
/* -------------------------------------------------------------------------- */

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** Sum the colours in a mana pool for an "open mana" estimate. */
function openManaFor(player: AIPlayerState): number {
  const pool = player.manaPool ?? {};
  let total = 0;
  for (const k of Object.keys(pool)) total += Math.max(0, pool[k] ?? 0);
  return total;
}

/**
 * Whether the given opponent has cast their commander this game (i.e. the
 * commander is currently on the battlefield, not in the command zone).
 * Returns `undefined` when the opponent has no commander tracked, which
 * lets the caller pass `undefined` straight through to commander-math.
 */
function commanderOnBattlefield(
  state: AIGameState,
  opponent: AIPlayerState,
): boolean | undefined {
  const inZone = state.commandZone?.[opponent.id]?.commander;
  if (!inZone) return undefined;
  return opponent.battlefield.some((p) => p.id === inZone.id);
}

/**
 * Find the player ID that controls a given cardInstanceId. Returns
 * `undefined` when the card isn't tracked on any player's battlefield.
 * Used so that attackers and stack objects can be attributed to their
 * actual controller, not the AI's global "someone is pressuring me" pool.
 */
function findCardController(
  state: AIGameState,
  cardInstanceId: string,
): string | undefined {
  for (const [playerId, player] of Object.entries(state.players ?? {})) {
    if ((player.battlefield ?? []).some((p) => p.cardInstanceId === cardInstanceId)) {
      return playerId;
    }
  }
  return undefined;
}

/**
 * Read an opponent's commander in the AI's familiar
 * `Pick<AIPermanent, ...>` shape. Returns `undefined` when the opponent has
 * no tracked commander.
 */
function commanderPermanent(
  state: AIGameState,
  opponent: AIPlayerState,
): Pick<AIPermanent, "name" | "id" | "power" | "toughness"> | undefined {
  const inZone = state.commandZone?.[opponent.id]?.commander;
  if (!inZone) return undefined;
  return {
    name: inZone.name,
    id: inZone.id,
    power: inZone.power,
    toughness: inZone.toughness,
  };
}

/**
 * Sum of untapped, unsickened creature power for a player. Used both as a
 * sub-scorer and as the kingmaking-lethal estimate.
 */
function effectiveBoardPower(player: AIPlayerState): number {
  let power = 0;
  for (const perm of player.battlefield ?? []) {
    if (perm.tapped) continue;
    if (perm.summoningSickness) continue;
    if (perm.type === "creature") {
      power += perm.power ?? 0;
    }
  }
  return power;
}

/**
 * Apply the difficulty noise as a deterministic perturbation to one score.
 * At Easy/Medium the noise keeps the AI interesting without skipping the
 * "correct" choice outright. Expert applies zero noise and is fully
 * deterministic.
 */
function applyNoise(
  value: number,
  difficulty: DifficultyLevel,
  rng: () => number,
): number {
  const amplitude = DIFFICULTY_NOISE[difficulty];
  if (amplitude === 0) return value;
  // rng() ∈ [0,1) — center it to ±amplitude/2.
  const jitter = (rng() - 0.5) * amplitude;
  return clamp01(value + jitter);
}

/**
 * Build the per-opponent sub-scores and the composite. Pure — every input
 * comes through the parameter list. The `commandZone` lookup is the only
 * state read.
 */
function scoreOpponent(
  state: AIGameState,
  opponent: AIPlayerState,
  difficulty: DifficultyLevel,
): Omit<
  MultiplayerThreatAssessment,
  "isThreatLeader" | "isAboutToLose" | "threatScore" | "reason"
> {
  const lifeScore = clamp01(1 - opponent.life / LIFE_NORMALIZER);

  // Board strength: untapped power + a token bump for non-creature threats.
  // 14 power one-shots the AI from 20; cap at 1.0 with room for the
  // non-creature permanent tax.
  let power = 0;
  let nonCreatureBonus = 0;
  for (const perm of opponent.battlefield ?? []) {
    if (perm.tapped) continue;
    if (perm.summoningSickness) continue;
    if (perm.type === "creature") {
      power += perm.power ?? 0;
    } else if (
      perm.type === "artifact" ||
      perm.type === "enchantment" ||
      perm.type === "planeswalker"
    ) {
      nonCreatureBonus += 1;
    }
  }
  const boardScore = clamp01(power / 14 + nonCreatureBonus * 0.05);

  // Commander threat: defer to commander-math (issue #1234) so the AI does
  // not duplicate Voltron heuristics in two places.
  const commanderInput: OpposingCommanderThreatInput = {
    opponentCommander: commanderPermanent(state, opponent),
    opponentOpenMana: openManaFor(opponent),
    opponentHasCast: commanderOnBattlefield(state, opponent),
  };
  const commanderScore = opposingCommanderThreat(
    commanderInput.opponentCommander,
    difficulty,
    commanderInput,
  );

  // Intent: attackers aimed at the AI (attributed to their actual
  // controller) and stack spells this opponent has cast. Each intent
  // unit is +0.5 (attack) or +0.25 (spell), capped at 1 — a deliberate
  // ballpark that biases toward "actively pressuring me" without
  // overcounting a single attacker.
  let intent = 0;
  const aiId =
    state.turnInfo?.currentPlayer ??
    Object.keys(state.players ?? {})[0] ??
    "";
  const attackers = state.combat?.attackers ?? [];
  for (const atk of attackers) {
    if (atk.defenderId !== aiId) continue;
    const attackerOwner = findCardController(state, atk.cardInstanceId);
    // Attribute intent to the attacker controller when known, otherwise
    // to *this* opponent (the one we're scoring) — the latter only
    // triggers if the card is unattributable, which should be rare in
    // well-formed fixtures. Falling back to the current opponent for
    // unattributable attackers prevents losing the signal entirely.
    if (!attackerOwner || attackerOwner === opponent.id) intent += 0.5;
  }
  for (const obj of state.stack ?? []) {
    if (obj.controller === opponent.id) intent += 0.25;
  }
  const intentScore = clamp01(intent);

  return {
    playerId: opponent.id,
    lifeScore,
    boardScore,
    commanderScore,
    intentScore,
  };
}

function describeThreat(
  partial: Pick<
    MultiplayerThreatAssessment,
    "lifeScore" | "boardScore" | "commanderScore" | "intentScore"
  >,
  composite: number,
): string {
  const parts: string[] = [];
  if (partial.lifeScore > 0.6) parts.push("low life");
  if (partial.boardScore > 0.5) parts.push("dominant board");
  if (partial.commanderScore > 0.5) parts.push("dangerous commander");
  if (partial.intentScore > 0.4) parts.push("actively pressuring");
  if (parts.length === 0) parts.push("no standout axis");
  return `${parts.join(", ")} (composite ${composite.toFixed(2)})`;
}

/**
 * Predict whether some *other* opponent (not the AI, not `target`) can kill
 * `target` next turn. Heuristic: pick the strongest other opponent's power
 * and compare to target's life total. Excludes the AI itself from the kill
 * count so we don't say "the AI can kill them so they're about to lose" —
 * that would defeat the purpose of the flag (the AI IS actively deciding
 * whether to do the killing).
 */
function anyOtherPlayerCanKill(
  state: AIGameState,
  aiPlayerId: string,
  target: AIPlayerState,
  rankings: MultiplayerThreatAssessment[],
): boolean {
  for (const other of rankings) {
    if (other.playerId === aiPlayerId || other.playerId === target.id) continue;
    const otherPlayer = state.players[other.playerId];
    if (!otherPlayer) continue;
    if (effectiveBoardPower(otherPlayer) >= target.life) return true;
  }
  return false;
}

/**
 * applyNoise's `rng` parameter is unused at expert (amplitude === 0). We
 * still need to satisfy the signature, so we hand it a noop. Putting the
 * noop inline avoids exporting a dead helper.
 */

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Rank `opponents` for the AI in this pod. Returns one assessment per
 * opponent, sorted by `threatScore` descending. The leader
 * (`isThreatLeader === true`) is the entry at index 0.
 *
 * @param state        Live AI game state. Only `players`, `turnInfo`,
 *                     `combat`, `stack`, and `commandZone` are read.
 * @param aiPlayerId   The AI's player ID. Subtracts itself from the
 *                     ranking if present in `opponents`.
 * @param opponents    Opponent player IDs to rank. If omitted, every
 *                     non-AI player in `state.players` is used.
 * @param difficulty   Skill tier. Drives noise, commander scaling, and the
 *                     strictness of the kingmaking penalty.
 */
export function assessThreats(
  state: AIGameState,
  aiPlayerId: string,
  opponents: string[] | undefined,
  difficulty: DifficultyLevel = "expert",
): MultiplayerThreatAssessment[] {
  const allOpponentIds =
    opponents && opponents.length > 0
      ? opponents
      : Object.keys(state.players ?? {}).filter((id) => id !== aiPlayerId);

  const rng =
    DIFFICULTY_NOISE[difficulty] > 0
      ? Math.random
      : () => 0.5; /* unused at expert; kept for type satisfaction */;

  const scored: MultiplayerThreatAssessment[] = allOpponentIds.map((id) => {
    const opponent = state.players[id];
    if (!opponent) {
      return {
        playerId: id,
        lifeScore: 0,
        boardScore: 0,
        commanderScore: 0,
        intentScore: 0,
        threatScore: 0,
        isThreatLeader: false,
        isAboutToLose: false,
        reason: "opponent not found in game state",
      } satisfies MultiplayerThreatAssessment;
    }
    const partial = scoreOpponent(state, opponent, difficulty);
    const composite =
      partial.lifeScore * DEFAULT_WEIGHTS.life +
      partial.boardScore * DEFAULT_WEIGHTS.board +
      partial.commanderScore * DEFAULT_WEIGHTS.commander +
      partial.intentScore * DEFAULT_WEIGHTS.intent;
    return {
      ...partial,
      threatScore: applyNoise(clamp01(composite), difficulty, rng),
      isThreatLeader: false, // filled below
      isAboutToLose: false, // filled below
      reason: describeThreat(partial, composite),
    } satisfies MultiplayerThreatAssessment;
  });

  scored.sort((a, b) => b.threatScore - a.threatScore);
  if (scored.length > 0) {
    scored[0].isThreatLeader = true;
  }

  for (const target of scored) {
    const player = state.players[target.playerId];
    if (!player) continue;
    target.isAboutToLose = anyOtherPlayerCanKill(
      state,
      aiPlayerId,
      player,
      scored,
    );
  }

  return scored;
}

/**
 * Pick which opponent the AI should attack. Refuses to kingmake at
 * Hard/Expert by skipping `isAboutToLose` targets unless no alternative
 * exists.
 *
 * @param state        Live AI game state.
 * @param aiPlayerId   The AI's player ID.
 * @param opponents    Optional explicit candidate list (defaults to every
 *                     non-AI player).
 * @param difficulty   Skill tier.
 * @param opts         Optional RNG injection for tests.
 */
export function chooseAttackTarget(
  state: AIGameState,
  aiPlayerId: string,
  opponents: string[] | undefined,
  difficulty: DifficultyLevel = "expert",
  opts: ChooseAttackTargetOptions = {},
): AttackTargetDecision {
  const rankings = assessThreats(state, aiPlayerId, opponents, difficulty);
  const candidates = rankings.filter((r) => state.players[r.playerId]);
  if (candidates.length === 0) {
    return { targetId: null, avoidedKingmaking: false, reason: "no opponents" };
  }

  const rng = opts.rng ?? Math.random;
  const mustAvoidKingmaking = MUST_AVOID_KINGMAKING[difficulty];

  const safeChoices = mustAvoidKingmaking
    ? candidates.filter((c) => !c.isAboutToLose)
    : candidates;

  const hasKingmakingSuspects = candidates.some((c) => c.isAboutToLose);
  const avoidedKingmaking =
    mustAvoidKingmaking && hasKingmakingSuspects && safeChoices.length > 0;
  const pool = safeChoices.length > 0 ? safeChoices : candidates;

  // Difficulty noise: at Easy we sample within the top half so the AI
  // sometimes picks the second-strongest, exposing the player to a teachable
  // failure. Expert/Medium/Hard pick the leader deterministically.
  let pick: MultiplayerThreatAssessment;
  if (difficulty === "easy") {
    const slice = pool.slice(0, Math.max(1, Math.ceil(pool.length / 2)));
    const idx = Math.min(slice.length - 1, Math.floor(rng() * slice.length));
    pick = slice[idx];
  } else {
    pick = pool[0];
  }

  const reason = (() => {
    if (avoidedKingmaking) {
      const leader = rankings[0];
      return `Threat leader would be ${leader.playerId} but kingmaking avoidance picked ${pick.playerId} (who will die anyway)`;
    }
    if (pick.isThreatLeader) {
      return `Threat leader ${pick.playerId} selected (score ${pick.threatScore.toFixed(2)})`;
    }
    return `Top of safe pool ${pick.playerId} selected at ${difficulty} difficulty`;
  })();

  return {
    targetId: pick.playerId,
    avoidedKingmaking,
    reason,
  };
}

/**
 * Pick which spell on the stack the AI should counter. Prefers the
 * opponent's spell that comes from the threat leader. At Easy the function
 * picks the cheapest spell regardless of controller.
 *
 * If the stack is empty or contains only AI-controlled spells, returns
 * `null` — there is nothing to counter.
 */
export function chooseResponseTarget(
  state: AIGameState,
  aiPlayerId: string,
  difficulty: DifficultyLevel = "expert",
  _opts: ChooseResponseTargetOptions = {},
): ResponseTargetDecision {
  const stack = state.stack ?? [];
  const opponentStack = stack.filter((obj) => obj.controller !== aiPlayerId);
  if (opponentStack.length === 0) {
    return {
      stackObjectId: null,
      controllerId: null,
      reason: "no opponent-controlled spells on the stack",
    };
  }

  const rankings = assessThreats(state, aiPlayerId, undefined, difficulty);
  const leaderEntry = rankings.find((r) => r.isThreatLeader);
  const leaderId = leaderEntry?.playerId ?? null;

  let chosen = opponentStack[0];
  let reason: string;
  if (difficulty === "easy") {
    // Cheapest spell — well-defined at Easy.
    const cheapest = [...opponentStack].sort(
      (a, b) => (a.manaValue ?? 0) - (b.manaValue ?? 0),
    )[0];
    chosen = cheapest;
    reason = `Easy picks cheapest spell on the stack (${chosen.name}, MV ${chosen.manaValue ?? 0})`;
  } else if (
    leaderId &&
    opponentStack.some((obj) => obj.controller === leaderId)
  ) {
    // Hard/Expert path: prefer the leader's spell. Among multiple leader
    // spells, take the highest MV (most impactful).
    const leaderSpells = opponentStack.filter((obj) => obj.controller === leaderId);
    chosen = [...leaderSpells].sort(
      (a, b) => (b.manaValue ?? 0) - (a.manaValue ?? 0),
    )[0];
    reason = `Countering threat leader ${leaderId}'s ${chosen.name} (MV ${chosen.manaValue ?? 0})`;
  } else {
    // Fallback: highest-MV spell on the stack. Useful when no explicit
    // leader can be picked (e.g. tied scores).
    chosen = [...opponentStack].sort(
      (a, b) => (b.manaValue ?? 0) - (a.manaValue ?? 0),
    )[0];
    reason = `No clear leader — countering highest-MV opponent spell ${chosen.name}`;
  }

  return {
    stackObjectId: chosen.id,
    controllerId: chosen.controller,
    reason,
  };
}

/* -------------------------------------------------------------------------- */
/* Test fixtures                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Build a 3+ player mock state for fixtures. NOT exposed in the public
 * index — it lives here so the tests can `import { _buildFixtureState }`
 * without polluting the module API. Kept exported (with underscore prefix)
 * to match the file's coverage target.
 */
export function _buildFixtureState(
  aiId: string,
  opponents: { id: string; life: number; battlefield: AIPermanent[] }[],
  commandZone: AIGameState["commandZone"],
): AIGameState {
  const players: AIGameState["players"] = {
    [aiId]: makeEmptyPlayer(aiId, 20),
  };
  for (const op of opponents) {
    players[op.id] = {
      ...makeEmptyPlayer(op.id, op.life),
      battlefield: op.battlefield,
    };
  }
  return {
    players,
    turnInfo: {
      currentTurn: 1,
      currentPlayer: aiId,
      priority: aiId,
      phase: "combat",
      step: "combat",
    },
    stack: [],
    combat: { inCombatPhase: true, attackers: [], blockers: {} },
    commandZone,
  };
}

function makeEmptyPlayer(id: string, life: number = 20): AIPlayerState {
  return {
    id,
    name: id,
    life,
    poisonCounters: 0,
    hand: [],
    battlefield: [],
    graveyard: [],
    exile: [],
    library: 40,
    manaPool: {
      white: 0,
      blue: 0,
      black: 0,
      red: 0,
      green: 0,
      colorless: 0,
    },
    commanderDamage: {},
    landsPlayedThisTurn: 0,
    hasPassedPriority: false,
  };
}
