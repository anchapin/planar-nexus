/**
 * Self-play records for ForgePointerNet (manamind#87, step 1).
 *
 * Plays a TrainingSession game with `forgeSearch` on both seats and records,
 * for every decision the net has a head for, the bridge decision plus the
 * search's improved policy folded onto that head:
 *
 * - priority: `pi` over the options then pass (the `priority` logits).
 * - attack: `pi[i]` = search probability that creature i attacks
 *   (a Bernoulli target for the `attack` logits).
 * - block: `pi[b]` = per blocker, search probability over the attackers then
 *   no block (the `block` rows).
 *
 * Engine `choice` prompts are searched and played but not recorded: the net
 * has no head for them. `returns[i]` is the game result from that
 * decision's seat (+1 win, -1 loss, 0 draw or turn limit), so a game line
 * has the same `decisions` / `returns` shape as manamind's imitation data.
 *
 * With `opponent: "expert"` (manamind#96) only seat `netSeat` searches; the
 * other seat plays `expertAction`. By default only the net's decisions are
 * recorded; with `expertRecord: "both"` (manamind#96) the Expert AI's are
 * too, as one-hot targets with `source: "expert"`. Mixing these games into
 * the buffer keeps self-play training tied to an outside opponent.
 */

import {
  TrainingSession,
  type trainingDeck,
  type TrainingAction,
  type TrainingPrompt,
} from "@/ai/simulation/training-session";
import { expertAction } from "@/ai/simulation/expert-agent";
import type { ForgeDecision } from "./forge-pointer-features";
import type { ForgePointerModel } from "./forge-pointer-model";
import {
  blockAttackers,
  forgeDecision,
  forgeSearch,
  type ForgeSearchResult,
} from "./forge-search";

type Live = Exclude<TrainingPrompt, { kind: "game_over" }>;
/** A deck as `TrainingSession.reset` takes it. */
type DeckList = ReturnType<typeof trainingDeck>;

export type SearchTarget = number[] | number[][];

export interface SelfPlayDecision extends ForgeDecision {
  /** Seat that decided: 0 or 1, in `reset` order. */
  seat: number;
  /** Which seat's brain produced the action: the net or the Expert AI. */
  source: "net" | "expert";
  pi: SearchTarget;
}

export interface SelfPlayGame {
  seed: number;
  decisions: SelfPlayDecision[];
  returns: number[];
  /** Winning seat, or null for a draw / limit. */
  winner: number | null;
  reason: string;
  turns: number;
  steps: number;
  /**
   * Attack prompts the searching seat(s) answered, and creatures offered and
   * declared across them (manamind#96: is the net turning passive?).
   */
  attack: { prompts: number; offered: number; declared: number };
}

export interface SelfPlayOptions {
  seed: number;
  deckA: DeckList;
  deckB: DeckList;
  /**
   * Names recorded as deck identity (manamind #96). Default: a stable hash
   * name of the deck list, so ad-hoc decks still get consistent ids.
   */
  deckAName?: string;
  deckBName?: string;
  simulations?: number;
  /**
   * Sample the move from the search policy for this many decisions with
   * more than one candidate (default: the whole game). Greedy play from a
   * cold-start network passes every turn and draws at the turn limit.
   */
  exploreMoves?: number;
  /**
   * How an exploring decision picks its move: draw from the search policy
   * (`"sample"`, default) or play the search's pick under Gumbel root noise
   * (`"gumbel"`, manamind#96). Later decisions play the noise-free pick.
   */
  pick?: "sample" | "gumbel";
  /**
   * `forgeSearch`'s cScale (default 1). Lower values soften the
   * completed-Q policy target so a few noisy samples can't make it
   * near one-hot (manamind#96).
   */
  cScale?: number;
  maxTurns?: number;
  /** Who plays the other seat: the net itself (default) or the Expert AI. */
  opponent?: "self" | "expert";
  /** The net's seat when `opponent` is `"expert"` (default 0). */
  netSeat?: 0 | 1;
  /**
   * When `opponent` is `"expert"`: record only the net's decisions
   * (`"net"`, default) or the Expert AI's too (`"both"`, manamind#96).
   */
  expertRecord?: "net" | "both";
}

/**
 * Fold the search's target policy over candidates onto the net's head for
 * `prompt`. The target is the net's raw prior plus Q (no exploration floor,
 * manamind#96); older results without one fall back to the search policy.
 */
export function searchTarget(
  prompt: Live,
  result: ForgeSearchResult,
): SearchTarget | null {
  const { candidates } = result;
  const policy = result.target ?? result.policy;
  switch (prompt.kind) {
    case "priority": {
      const column: number[] = [];
      let next = 0;
      for (const o of prompt.options)
        column.push(o.kind === "pass" ? -1 : next++);
      const pi = new Array<number>(next + 1).fill(0);
      candidates.forEach((c, i) => {
        const idx = "index" in c.action ? c.action.index : -1;
        const col = column[idx];
        pi[col === undefined || col < 0 ? next : col] += policy[i];
      });
      return pi;
    }
    case "attack": {
      const ids = prompt.options.map((o) => o.cardId);
      const pi = new Array<number>(ids.length).fill(0);
      candidates.forEach((c, i) => {
        if (!("attacks" in c.action)) return;
        for (const a of c.action.attacks) {
          const k = ids.indexOf(a.cardId);
          if (k >= 0) pi[k] += policy[i];
        }
      });
      return pi;
    }
    case "block": {
      const attackers = blockAttackers(prompt);
      const none = attackers.length;
      const pi = prompt.options.map(() => new Array<number>(none + 1).fill(0));
      candidates.forEach((c, i) => {
        if (!("blocks" in c.action)) return;
        prompt.options.forEach((o, b) => {
          const blk = (
            c.action as { blocks: { blockerId: string; attackerId: string }[] }
          ).blocks.find((x) => x.blockerId === o.cardId);
          const col = blk ? attackers.indexOf(blk.attackerId) : none;
          pi[b][col < 0 ? none : col] += policy[i];
        });
      });
      return pi;
    }
    case "choice":
      return null;
  }
}

/**
 * Fold the Expert AI's point action onto the net's head for `prompt` as a
 * one-hot target (manamind#96). Priority with a single option is a forced
 * pass and returns null, like the net's single-candidate skip; `choice`
 * prompts have no head and return null.
 */
export function expertTarget(
  prompt: Live,
  action: TrainingAction,
): SearchTarget | null {
  switch (prompt.kind) {
    case "priority": {
      if (prompt.options.length <= 1) return null;
      const column: number[] = [];
      let next = 0;
      for (const o of prompt.options)
        column.push(o.kind === "pass" ? -1 : next++);
      const pi = new Array<number>(next + 1).fill(0);
      const idx = "index" in action ? action.index : -1;
      const col = column[idx];
      pi[col === undefined || col < 0 ? next : col] = 1;
      return pi;
    }
    case "attack": {
      const ids = prompt.options.map((o) => o.cardId);
      const pi = new Array<number>(ids.length).fill(0);
      if ("attacks" in action)
        for (const a of action.attacks) {
          const k = ids.indexOf(a.cardId);
          if (k >= 0) pi[k] = 1;
        }
      return pi;
    }
    case "block": {
      const attackers = blockAttackers(prompt);
      const none = attackers.length;
      const pi = prompt.options.map(() => new Array<number>(none + 1).fill(0));
      if ("blocks" in action)
        for (const blk of action.blocks) {
          const b = prompt.options.findIndex((o) => o.cardId === blk.blockerId);
          if (b >= 0) {
            const col = attackers.indexOf(blk.attackerId);
            pi[b][col < 0 ? none : col] = 1;
          }
        }
      return pi;
    }
    case "choice":
      return null;
  }
}

/** fnv1a over the sorted card multiset, for decks recorded without a name. */
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Stable hash name of a deck list (`deck-<fnv1a % 1e9>`), manamind #96. */
export function deckName(list: DeckList): string {
  const counts = new Map<string, number>();
  for (const card of list) {
    const name = String(card.name ?? "");
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const pairs = [...counts.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, count]) => `${name}:${count}`);
  return `deck-${fnv1a(pairs.join("|")) % 1_000_000_000}`;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Play one self-play game and return its training records. */
export async function playSelfPlayGame(
  model: ForgePointerModel,
  options: SelfPlayOptions,
): Promise<SelfPlayGame> {
  const {
    seed,
    deckA,
    deckB,
    deckAName,
    deckBName,
    simulations = 16,
    exploreMoves = Number.POSITIVE_INFINITY,
    maxTurns,
    opponent = "self",
    netSeat = 0,
    expertRecord = "net",
    pick = "sample",
    cScale,
  } = options;
  const session = new TrainingSession({ maxTurns });
  const seats = session.reset(seed, deckA, deckB);
  const deckNames = [
    deckAName ?? deckName(deckA),
    deckBName ?? deckName(deckB),
  ] as const;
  const random = mulberry32(seed ^ 0x5eed);
  const decisions: SelfPlayDecision[] = [];
  let prompt = session.legalChoices();
  let move = 0;
  // Exploration counts real choices only; forced passes would use it up
  // in the first turn.
  let choices = 0;
  const attack = { prompts: 0, offered: 0, declared: 0 };
  while (prompt.kind !== "game_over") {
    if (opponent === "expert" && seats.indexOf(prompt.playerId) !== netSeat) {
      move++;
      const action = expertAction(session, prompt);
      if (expertRecord === "both") {
        const pi = expertTarget(prompt, action);
        if (pi)
          decisions.push({
            ...forgeDecision(session, prompt, deckNames),
            seat: seats.indexOf(prompt.playerId),
            source: "expert",
            pi,
          });
      }
      prompt = session.step(action);
      continue;
    }
    const exploring = choices < exploreMoves;
    const result = await forgeSearch(session, model, {
      simulations,
      seed: (seed * 7919 + move) >>> 0,
      gumbel: pick === "gumbel" && exploring,
      ...(cScale === undefined ? {} : { cScale }),
      deckNames,
    });
    const pi = searchTarget(prompt, result);
    if (pi && result.candidates.length > 1) {
      decisions.push({
        ...forgeDecision(session, prompt, deckNames),
        seat: seats.indexOf(prompt.playerId),
        source: "net",
        pi,
      });
    }
    let action: TrainingAction = result.action;
    const real = result.candidates.length > 1;
    if (real && choices++ < exploreMoves && pick === "sample") {
      let r = random();
      for (let i = 0; i < result.policy.length; i++) {
        r -= result.policy[i];
        if (r <= 0) {
          action = result.candidates[i].action;
          break;
        }
      }
    }
    if (prompt.kind === "attack") {
      attack.prompts++;
      attack.offered += prompt.options.length;
      attack.declared += "attacks" in action ? action.attacks.length : 0;
    }
    move++;
    prompt = session.step(action);
  }
  const res = prompt.result;
  const winner =
    res.winners.length === 1 ? seats.indexOf(res.winners[0]) : null;
  return {
    seed,
    decisions,
    returns: decisions.map((d) =>
      winner === null ? 0 : d.seat === winner ? 1 : -1,
    ),
    winner,
    reason: res.reason,
    turns: res.turns,
    steps: res.steps,
    attack,
  };
}
