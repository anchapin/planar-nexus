/**
 * #2612: headless training session over the real rules engine, for manamind
 * self-play (epic anchapin/manamind#84).
 *
 * A session plays one two-player game through full priority passes (no
 * shortcut driver). At every stop it reports one prompt, shaped like the
 * Forge bridge's decisions:
 *
 * - `priority`: pick one of `listPriorityChoices` by index.
 * - `attack`: declare attackers (any subset of `listAttackerOptions`).
 * - `block`: declare blockers (any subset of `listBlockerOptions`).
 * - `choice`: answer a pending decision (discard, offer, mode, trigger
 *   target) by index into `listDecisionAnswers`.
 * - `game_over`: the game has ended; `result()` has the outcome.
 *
 * Determinism: every engine call runs with `Math.random` swapped for a
 * seeded mulberry32 stream and `Date.now` for a counter, both owned by the
 * session, so the same seed and the same choices replay bit-identically.
 * `save()` captures that stream with the (immutable) game state, and
 * `restore()` rewinds to it, for search.
 */
import {
  applyAttackDeclaration,
  applyBlockDeclaration,
  applyDecisionAnswer,
  applyPriorityChoice,
  checkStateBasedActionsFromGameState as checkStateBasedActions,
  createInitialGameState,
  getPendingDecision,
  listAttackerOptions,
  listBlockerOptions,
  listDecisionAnswers,
  listPriorityChoices,
  loadDeckForPlayer,
  Phase,
  resolveCombatDamage,
  serializeGameState,
  startGame,
  type AttackAssignment,
  type AttackerOption,
  type BlockAssignment,
  type BlockerOption,
  type DecisionAnswer,
  type GameState,
  type PlayerId,
  type PriorityChoice,
} from "@/lib/game-state";
import { buildDeck, type SimDeckArchetype } from "./game-simulator";

type DeckList = ReturnType<typeof buildDeck>;

const BASIC_MANA: Record<string, string> = {
  Plains: "W",
  Island: "U",
  Swamp: "B",
  Mountain: "R",
  Forest: "G",
};

/**
 * A simulator deck whose basic lands carry their mana reminder text, so
 * they tap for mana through the real engine (the simulator adds mana
 * directly and leaves the fixture basics blank).
 */
export function trainingDeck(archetype: SimDeckArchetype): DeckList {
  return buildDeck(archetype).map((card) => {
    const basic = Object.keys(BASIC_MANA).find((t) =>
      (card.type_line ?? "").includes(t),
    );
    return basic && !card.oracle_text
      ? { ...card, oracle_text: `({T}: Add {${BASIC_MANA[basic]}}.)` }
      : card;
  });
}

export type TrainingPrompt =
  | { kind: "priority"; playerId: PlayerId; options: PriorityChoice[] }
  | { kind: "attack"; playerId: PlayerId; options: AttackerOption[] }
  | { kind: "block"; playerId: PlayerId; options: BlockerOption[] }
  | { kind: "choice"; playerId: PlayerId; options: DecisionAnswer[] }
  | { kind: "game_over"; result: TrainingResult };

export type TrainingAction =
  | { index: number }
  | { attacks: AttackAssignment[] }
  | { blocks: BlockAssignment[] };

export interface TrainingResult {
  done: boolean;
  /** Players still in the game when it ended; empty for a draw. */
  winners: PlayerId[];
  reason: "in_progress" | "game_over" | "turn_limit" | "step_limit";
  turns: number;
  steps: number;
}

export interface TrainingSessionOptions {
  /** End the game as a draw after this many turns (default 80). */
  maxTurns?: number;
  /** End the game as a stall after this many decisions (default 20,000). */
  maxSteps?: number;
}

/** A rules failure: the engine refused a listed choice. */
export class TrainingRulesError extends Error {}

interface Snapshot {
  state: GameState;
  rng: number;
  clock: number;
  /** Turn number whose attack / block declaration has been made. */
  attacksDone: number;
  blocksDone: number;
  /** `${turn}:${phase}` whose combat damage has been dealt. */
  damageDone: string;
  steps: number;
  limit: TrainingResult["reason"] | null;
}

/** One mulberry32 step: returns the next internal state and the float. */
function mulberryStep(a: number): [number, number] {
  const next = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(next ^ (next >>> 15), 1 | next);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return [next, ((t ^ (t >>> 14)) >>> 0) / 4294967296];
}

const COMBAT_DAMAGE_STEPS = new Set<string>([
  Phase.COMBAT_DAMAGE_FIRST_STRIKE,
  Phase.COMBAT_DAMAGE,
]);

export class TrainingSession {
  private cur: Snapshot | null = null;
  private readonly maxTurns: number;
  private readonly maxSteps: number;
  private readonly saved = new Map<string, Snapshot>();
  private nextHandle = 1;

  constructor(options: TrainingSessionOptions = {}) {
    this.maxTurns = options.maxTurns ?? 80;
    this.maxSteps = options.maxSteps ?? 20_000;
  }

  /** Start a new seeded game. Returns the player ids in seat order. */
  reset(seed: number, deckA: DeckList, deckB: DeckList): PlayerId[] {
    this.cur = {
      state: null as unknown as GameState,
      rng: seed >>> 0,
      clock: 0,
      attacksDone: -1,
      blocksDone: -1,
      damageDone: "",
      steps: 0,
      limit: null,
    };
    const state = this.engine(() => {
      let s = createInitialGameState(["p1", "p2"], 20, false);
      const [p1, p2] = Array.from(s.players.keys());
      s = loadDeckForPlayer(s, p1, deckA, true);
      s = loadDeckForPlayer(s, p2, deckB, true);
      return startGame(s);
    });
    this.cur.state = state;
    this.saved.clear();
    return Array.from(state.players.keys());
  }

  /** The current game state (read-only; do not mutate). */
  get state(): GameState {
    return this.snapshot().state;
  }

  /** The decision the game is waiting on. */
  legalChoices(): TrainingPrompt {
    this.settle();
    return this.prompt();
  }

  /** Answer the current prompt. Throws TrainingRulesError on a refusal. */
  step(action: TrainingAction): TrainingPrompt {
    const prompt = this.legalChoices();
    const snap = this.snapshot();
    const s = snap.state;
    const turn = s.turn.turnNumber;
    let next: GameState;

    if (prompt.kind === "game_over") {
      throw new TrainingRulesError("The game is over");
    } else if (prompt.kind === "attack") {
      if (!("attacks" in action))
        throw new TrainingRulesError("Expected attacks");
      next = this.apply(() => applyAttackDeclaration(s, action.attacks));
      snap.attacksDone = turn;
    } else if (prompt.kind === "block") {
      if (!("blocks" in action))
        throw new TrainingRulesError("Expected blocks");
      next = this.apply(() => applyBlockDeclaration(s, action.blocks));
      snap.blocksDone = turn;
    } else {
      if (!("index" in action))
        throw new TrainingRulesError("Expected an index");
      const option = prompt.options[action.index];
      if (option === undefined) {
        throw new TrainingRulesError(`No option ${action.index}`);
      }
      next =
        prompt.kind === "priority"
          ? this.apply(() =>
              applyPriorityChoice(s, prompt.playerId, option as PriorityChoice),
            )
          : this.apply(() =>
              applyDecisionAnswer(s, prompt.playerId, option as DecisionAnswer),
            );
    }

    snap.state = this.engine(() => checkStateBasedActions(next));
    snap.steps += 1;
    if (snap.steps >= this.maxSteps) snap.limit = "step_limit";
    return this.legalChoices();
  }

  /** Save the game (state and RNG) and return a handle for `restore`. */
  save(): string {
    const handle = `h${this.nextHandle++}`;
    this.saved.set(handle, { ...this.snapshot() });
    return handle;
  }

  /** Rewind to a saved handle. The handle stays valid. */
  restore(handle: string): void {
    const snap = this.saved.get(handle);
    if (!snap) throw new TrainingRulesError(`Unknown handle ${handle}`);
    this.cur = { ...snap };
  }

  /** Forget a saved handle. */
  release(handle: string): void {
    this.saved.delete(handle);
  }

  result(): TrainingResult {
    const snap = this.snapshot();
    const s = snap.state;
    const alive = Array.from(s.players.values())
      .filter((p) => !p.hasLost && p.life > 0)
      .map((p) => p.id);
    const over = s.status === "completed" || alive.length < s.players.size;
    const reason: TrainingResult["reason"] = over
      ? "game_over"
      : (snap.limit ?? "in_progress");
    return {
      done: reason !== "in_progress",
      winners: over ? alive : [],
      reason,
      turns: s.turn.turnNumber,
      steps: snap.steps,
    };
  }

  /** Deterministic fingerprint of the whole game, for replay checks. */
  fingerprint(): string {
    const snap = this.snapshot();
    return `${snap.rng}|${snap.clock}|${serializeGameState(snap.state)}`;
  }

  private snapshot(): Snapshot {
    if (!this.cur) throw new TrainingRulesError("Call reset() first");
    return this.cur;
  }

  /** Run engine code on the session's own RNG stream and clock. */
  private engine<T>(fn: () => T): T {
    const snap = this.snapshot();
    const random = Math.random;
    const now = Date.now;
    Math.random = () => {
      const [a, v] = mulberryStep(snap.rng);
      snap.rng = a;
      return v;
    };
    Date.now = () => ++snap.clock;
    try {
      return fn();
    } finally {
      Math.random = random;
      Date.now = now;
    }
  }

  /**
   * Run read-only listing code without advancing the session's stream, so
   * asking for the legal choices never changes the game.
   */
  private peek<T>(fn: () => T): T {
    const snap = this.snapshot();
    const saved = { rng: snap.rng, clock: snap.clock };
    try {
      return this.engine(fn);
    } finally {
      snap.rng = saved.rng;
      snap.clock = saved.clock;
    }
  }

  private apply(
    fn: () => { success: boolean; state: GameState; error?: string },
  ): GameState {
    const r = this.engine(fn);
    if (!r.success) {
      throw new TrainingRulesError(r.error ?? "The engine refused the choice");
    }
    return r.state;
  }

  /** Turn-based actions the session performs itself (combat damage). */
  private settle(): void {
    const snap = this.snapshot();
    for (let guard = 0; guard < 8; guard++) {
      if (this.result().done) return;
      const s = snap.state;
      const turn = s.turn.turnNumber;
      if (turn > this.maxTurns) {
        snap.limit = "turn_limit";
        return;
      }
      const phase = s.turn.currentPhase;
      const key = `${turn}:${phase}`;
      if (COMBAT_DAMAGE_STEPS.has(phase) && snap.damageDone !== key) {
        snap.damageDone = key;
        if (s.combat.attackers.length > 0) {
          snap.state = this.engine(() => {
            const r = resolveCombatDamage(s);
            const after = r.success ? r.state : s;
            return checkStateBasedActions(after);
          });
        }
        continue;
      }
      return;
    }
  }

  private prompt(): TrainingPrompt {
    const snap = this.snapshot();
    const result = this.result();
    if (result.done) return { kind: "game_over", result };
    const s = snap.state;
    const turn = s.turn.turnNumber;
    const phase = s.turn.currentPhase;
    const active = s.turn.activePlayerId;

    if (phase === Phase.DECLARE_ATTACKERS && snap.attacksDone !== turn) {
      const options = this.peek(() => listAttackerOptions(s, active));
      if (options.length > 0) {
        return { kind: "attack", playerId: active, options };
      }
      snap.attacksDone = turn;
    }

    if (
      phase === Phase.DECLARE_BLOCKERS &&
      snap.blocksDone !== turn &&
      s.combat.attackers.length > 0
    ) {
      snap.blocksDone = turn;
      for (const id of s.players.keys()) {
        if (id === active) continue;
        const options = this.peek(() => listBlockerOptions(s, id));
        if (options.length > 0) {
          snap.blocksDone = -1;
          return { kind: "block", playerId: id, options };
        }
      }
    }

    const pending = getPendingDecision(s);
    if (pending) {
      const options = this.peek(() => listDecisionAnswers(s, pending.playerId));
      if (options.length > 0) {
        return { kind: "choice", playerId: pending.playerId, options };
      }
      if (pending.kind === "waiting_choice") {
        throw new TrainingRulesError(
          `No legal answer to ${pending.choiceType}`,
        );
      }
      // A trigger with no legal target is removed when it would resolve;
      // play continues with priority.
    }

    const holder = s.priorityPlayerId;
    if (!holder) throw new TrainingRulesError("Nobody holds priority");
    const options = this.peek(() => listPriorityChoices(s, holder));
    if (options.length === 0) {
      throw new TrainingRulesError(`No priority choices for ${holder}`);
    }
    return { kind: "priority", playerId: holder, options };
  }
}

/**
 * A uniformly random legal action for `prompt`: the baseline agent for
 * smoke runs. Attacks and blocks with each available creature on a coin
 * flip.
 */
export function randomAction(
  prompt: TrainingPrompt,
  random: () => number,
): TrainingAction {
  const pickOne = <T>(items: T[]): T =>
    items[Math.floor(random() * items.length)];
  switch (prompt.kind) {
    case "attack":
      return {
        attacks: prompt.options
          .filter(() => random() < 0.5)
          .map((o) => ({ cardId: o.cardId, defenderId: pickOne(o.defenders) })),
      };
    case "block":
      return {
        blocks: prompt.options
          .filter(() => random() < 0.5)
          .map((o) => ({
            blockerId: o.cardId,
            attackerId: pickOne(o.attackers),
          })),
      };
    case "game_over":
      throw new TrainingRulesError("The game is over");
    default:
      return { index: Math.floor(random() * prompt.options.length) };
  }
}
