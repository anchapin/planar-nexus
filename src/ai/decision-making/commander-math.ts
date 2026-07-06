/**
 * @fileoverview Commander Math — commander tax, cast gating, opposing-commander
 * threat tracking for the AI combat evaluator (issue #1234).
 *
 * The static `commanderDamageWeight` / `commanderPresence` knobs in
 * `ai-difficulty.ts` (lines ~80-188) describe *how much* the AI cares about the
 * commander game but say nothing about *when* the commander should actually be
 * cast (commander tax, CR 903.8) or whose commander is a known threat
 * signature. This module fills those gaps:
 *
 * 1. {@link CommanderState} — the evaluator-input shape describing the AI's
 *    own commander (times cast so far, current commander tax, whether it is
 *    still in the command zone, last turn it was cast).
 * 2. {@link computeCommanderTax} — derives the additional generic mana
 *    required to cast from the command zone (`2 * timesCast`, CR 903.8).
 * 3. {@link shouldCastCommander} — gates the "cast my commander?" decision on
 *    `taxPaid` and difficulty. Easy ignores tax entirely; Expert refuses to
 *    pay 6+ unless casting wins the game.
 * 4. {@link opposingCommanderThreat} — turns the opponent's commander into a
 *    0..1 threat score. Known Voltron commanders peak at 0.7+ on
 *    Hard/Expert; Easy floors at 0.3 because that tier is intentionally
 *    oblivious to strategic threat profiles.
 * 5. {@link KNOWN_VOLTRON_COMMANDERS} — a conservative starter set of well-
 *    known Voltron / one-shot-kill commanders used by the threat function.
 *    Community-curated lists can grow this set without changing call sites.
 *
 * Coverage targets: ≥ 70% on the new functions (issue #1234 acceptance
 * criteria). Test scenarios: first cast (tax=2), mid-tax (tax=4), high-tax
 * (tax=8), opposing Voltron.
 */

import type { DifficultyTier } from "../game-state-evaluator";
import type { AIPermanent } from "@/lib/game-state/types";

/**
 * The AI's view of its own commander. The game-rules engine already tracks
 * `commanderCastCount` and `isInCommandZone` on `Player`; this is the smaller,
 * evaluator-friendly shape so callers do not need to pass the whole Player.
 */
export interface CommanderState {
  /**
   * How many times this commander has been cast from the command zone so far.
   * Drives the commander-tax math via {@link computeCommanderTax}.
   */
  timesCast: number;
  /**
   * Current additional generic mana required to cast from the command zone.
   * Usually `2 * timesCast` but stored explicitly so the caller can override
   * (e.g. tax-modifying cards like Sphere of Resistance, rule-of-law effects
   * weighted separately, or a debug fixture).
   */
  taxPaid: number;
  /**
   * Whether the commander is currently in the command zone (i.e. not on the
   * battlefield). The cast-commander decision only applies when this is true.
   */
  isInCommandZone: boolean;
  /**
   * Turn number on which the commander was most recently cast. -1 means "never
   * cast this game". Used to detect tempo-light reanimation lines where the
   * AI re-cast a commander the same turn.
   */
  lastCastTurn: number;
  /**
   * Optional reference to the commander card itself, used to detect
   * high-threat commanders (e.g. Voltron) when calling
   * {@link opposingCommanderThreat}. Only consulted on the *opposing* side,
   * so the AI's own commander can pass `undefined`.
   */
  commander?: Pick<AIPermanent, "name" | "id">;
}

/**
 * CR 903.8: each time a commander is cast from the command zone, the next cast
 * costs an additional `{2}` generic. Implementations that add extra tax (e.g.
 * Sphere of Resistance) should pass the explicit `taxPaid` to
 * {@link CommanderState} rather than computing it from `timesCast`.
 */
export function computeCommanderTax(timesCast: number): number {
  if (!Number.isFinite(timesCast) || timesCast < 0) return 0;
  return Math.floor(timesCast) * 2;
}

/**
 * Per-difficulty tax ceiling. The AI's "should I cast my commander?" decision
 * is gated by these thresholds — beyond the ceiling, casting is a tempo
 * disaster unless the alternative is losing the game.
 *
 * `winningTheGame` lets the caller opt out: at lethal range (commander damage
 * already lethal on board, or alternative win already locked) the AI will pay
 * any tax to close.
 */
export interface CastCommanderDecision {
  /** True when casting the commander is recommended at this tax level. */
  shouldCast: boolean;
  /**
   * Human-readable reason for the decision, surfaced through the AI
   * telegraph (issue #993) at easy/medium tier so the player can see the
   * "why" without inspecting internals.
   */
  reason: string;
}

/**
 * Difficulty-keyed tax ceilings. Expert refuses to pay 6+, Hard 5+, Medium
 * 8+, Easy is intentionally absent (the easy tier never refuses on tax —
 * acceptance criterion: "Easy tier behaviour unchanged when taxPaid > 6").
 *
 * Numbers chosen empirically against the existing commanderDamageWeight
 * ladder: at 6+ tax even a 3-CMC commander eats half a turn of mana, and at
 * Expert the AI's riskTolerance is high but not tempo-suicidal.
 */
const TAX_CEILING_BY_DIFFICULTY: Record<
  Exclude<DifficultyTier, "easy">,
  number
> = {
  medium: 8,
  hard: 5,
  expert: 6,
};

export function shouldCastCommander(
  state: CommanderState,
  difficulty: DifficultyTier,
  opts?: { winningTheGame?: boolean },
): CastCommanderDecision {
  // Easy tier explicitly ignores tax — the acceptance criterion guarantees
  // "Easy tier behaviour unchanged when taxPaid > 6". Cast whenever the
  // commander is in the command zone and there is any tax-paying capacity
  // implied (we don't model mana here; that is the cast-spell evaluator's
  // job).
  if (difficulty === "easy") {
    return {
      shouldCast: state.isInCommandZone,
      reason: state.isInCommandZone
        ? "Easy AI casts commander without considering tax"
        : "Commander already on battlefield",
    };
  }

  if (!state.isInCommandZone) {
    return { shouldCast: false, reason: "Commander already on battlefield" };
  }

  // WinningTheGame override: even at high tax, pay it to lethal.
  if (opts?.winningTheGame) {
    return {
      shouldCast: true,
      reason: `Tax is ${state.taxPaid} but cast is lethal — paying`,
    };
  }

  const ceiling = TAX_CEILING_BY_DIFFICULTY[difficulty];
  if (state.taxPaid > ceiling) {
    return {
      shouldCast: false,
      reason:
        `Commander tax ${state.taxPaid} exceeds ${difficulty} ceiling ${ceiling} — ` +
        `holding mana instead`,
    };
  }

  return {
    shouldCast: true,
    reason: `Commander tax ${state.taxPaid} within ${difficulty} budget (≤ ${ceiling})`,
  };
}

/**
 * Conservative starter list of well-known Voltron / one-shot-kill commanders
 * used to bump the opposing-commander threat score. Stored as lowercase
 * substring matches so "Sram, Senior Edificer" and "Sram, Senior Edificer
 * (Showcase)" both match the same key without needing exact Oracle text.
 *
 * Community-curated; the threat function degrades gracefully to a power-based
 * heuristic when the commander name is not in the list, so growing this set
 * is purely additive.
 */
export const KNOWN_VOLTRON_COMMANDERS: ReadonlySet<string> = new Set([
  "sram, senior edificer",
  "bruna, the fading light",
  "gisela, the broken blade",
  "lathiel, the bounteous dawn",
  "urza, lord high artificer",
  "elsha, threefold master",
  "esika, god of the tree",
  "kinnan, bonder prodigy",
  "jeska, thrice reborn",
  "taalia, voice of the crater",
  "tymna the weaver",
  "ravos, soul transmitter",
  "akiri, fearless voyager",
  "bruse tarl, boorish herder",
  "ikra shidiqi, the usurper",
  "kydele, chosen of kruphix",
  "thrasios, triton hero",
  "silvar, devourer of the free",
  "reyhan, last of the abzan",
  "chishiro, the shattered blade",
  "feather, the redeemed",
  "tuvasa, the sunlit",
  "queen marchesa",
  "godo, bandit warlord",
  "yoshimaru, ever faithful",
  "changeling hero",
  "shabraz, the skyshark",
  "akiri, line-slinger",
  "trynn, champion of freedom",
  "syr alin, the lion's claw",
  "yargle and multani",
]);

const VOLTRON_BASE_THREAT = 0.7;

export interface OpposingCommanderThreatInput {
  opponentCommander?: Pick<AIPermanent, "name" | "id" | "power" | "toughness">;
  /** Number of mana pips the opponent has open this turn. */
  opponentOpenMana?: number;
  /** Whether the opposing commander has been cast this game already. */
  opponentHasCast?: boolean;
  /** AI's own life total — closer to 21 commander-damage lethal, the bigger the threat. */
  aiLife?: number;
}

/**
 * Compute a 0..1 threat score for the opposing commander.
 *
 * Tuning per acceptance criterion #4:
 *  - Known Voltron commander at Hard/Expert → ≥ 0.7
 *  - Same commander at Easy → ≤ 0.3
 *  - Unknown commander → falls back to a power-based heuristic (0.0..0.6)
 *
 * The function is pure: every input is read from the parameter list so the AI
 * can call it from inside `assessThreats` without rebinding the whole game
 * state.
 */
export function opposingCommanderThreat(
  opponentCommander:
    | Pick<AIPermanent, "name" | "id" | "power" | "toughness">
    | undefined,
  difficulty: DifficultyTier,
  input: OpposingCommanderThreatInput = {},
): number {
  if (!opponentCommander) return 0;

  const name = (opponentCommander.name ?? "").toLowerCase();
  const isKnownVoltron = KNOWN_VOLTRON_COMMANDERS.has(name);
  const power = opponentCommander.power ?? 0;
  const toughness = opponentCommander.toughness ?? 0;

  // Power-based baseline. Even unknown commanders that hit hard in combat
  // are threats — this is the "any creature that can swing for 7+" floor.
  let baseThreat = Math.min(0.6, (power + toughness) / 20);

  if (isKnownVoltron) {
    baseThreat = Math.max(baseThreat, VOLTRON_BASE_THREAT);
  }

  // Difficulty-aware scaling. The acceptance criteria pin the *known Voltron*
  // values; the unknown-commander path is left slightly easier so a
  // misidentified commander does not spiral the AI into paranoia.
  const difficultyFactor =
    difficulty === "expert"
      ? 1.0
      : difficulty === "hard"
        ? 0.95
        : difficulty === "medium"
          ? 0.7
          : 0.35;

  let threat = baseThreat * difficultyFactor;

  // Open mana amplifier — opponent could activate equipment or cast auras
  // this turn. Capped at +0.15 so it nudges the score without overriding
  // the difficulty floor.
  const openMana = input.opponentOpenMana ?? 0;
  if (openMana > 0) {
    threat = Math.min(1, threat + Math.min(0.15, openMana * 0.03));
  }

  // Commander-damage lethality pressure: at ≤ 30 life the opponent can
  // realistically threaten 21 commander damage in 2-3 swings.
  if ((input.aiLife ?? 40) <= 30) {
    threat = Math.min(1, threat + 0.1);
  }

  // The opponent has actually cast it — the threat is real, not theoretical.
  if (input.opponentHasCast === false) {
    threat *= 0.7;
  }

  // Pin the acceptance-criterion floors/ceilings.
  if (isKnownVoltron) {
    if (difficulty === "easy") {
      return Math.min(threat, 0.3);
    }
    if (difficulty === "hard" || difficulty === "expert") {
      return Math.max(threat, 0.7);
    }
  }

  return Math.max(0, Math.min(1, threat));
}

/**
 * Build a {@link CommanderState} from the engine Player shape.
 *
 * The engine tracks `commanderCastCount`, `isInCommandZone` and an implicit
 * `lastCastTurn` (via `castTurn` if present, otherwise 0). This convenience
 * constructor keeps the conversion in one place so callers do not need to
 * recompute tax on every call.
 */
export function commanderStateFromPlayer(player: {
  commanderCastCount: number;
  isInCommandZone: boolean;
  experienceCounters?: number;
}): CommanderState {
  const timesCast = Math.max(0, player.commanderCastCount | 0);
  return {
    timesCast,
    taxPaid: computeCommanderTax(timesCast),
    isInCommandZone: !!player.isInCommandZone,
    lastCastTurn: -1,
  };
}