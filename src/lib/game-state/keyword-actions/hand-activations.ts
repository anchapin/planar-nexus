/**
 * Abilities activated from a card in hand (issue #2479, epic #2300).
 *
 * Channel (Action News Crew) and ninjutsu (Kaito, Bane of Nightmares) had
 * working engine entry points, `channelCard` and `activateNinjutsu`, but no
 * game action reached them. This module lists what a hand card can do right
 * now so the board and the AI opponent can offer and use it, and dispatches
 * the chosen option to the existing entry point, which re-checks every rule.
 */
import type { GameState, CardInstanceId, PlayerId } from "../types";
import { Phase } from "../types";
import { isPriorityPlayer } from "../priority-guard";
import { getEffectivePower } from "../evergreen-keywords";
import { channelCard, parseChannel, parseChannelEffect } from "./channel";
import {
  activateNinjutsu,
  parseNinjutsu,
  parseTurnCreatureForm,
} from "./ninjutsu";
import { KeywordActionResult } from "./shared";

export type HandActivation =
  | { kind: "channel"; cardId: CardInstanceId; label: string }
  | {
      kind: "ninjutsu";
      cardId: CardInstanceId;
      attackerId: CardInstanceId;
      label: string;
    };

const NINJUTSU_STEPS: ReadonlySet<Phase> = new Set([
  Phase.DECLARE_BLOCKERS,
  Phase.COMBAT_DAMAGE_FIRST_STRIKE,
  Phase.COMBAT_DAMAGE,
  Phase.END_COMBAT,
]);

/** Unblocked attackers `playerId` controls (candidates to return for ninjutsu). */
export function getUnblockedAttackers(
  state: GameState,
  playerId: PlayerId,
): CardInstanceId[] {
  return state.combat.attackers
    .map((a) => a.cardId)
    .filter((id) => {
      const c = state.cards.get(id);
      return (
        !!c &&
        c.controllerId === playerId &&
        (state.combat.blockers.get(id) ?? []).length === 0
      );
    });
}

/**
 * Options `playerId` has for a card in their hand right now. Mana is not
 * checked here; the entry point rejects an unaffordable activation.
 */
export function getHandActivations(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
): HandActivation[] {
  const card = state.cards.get(cardId);
  if (!card || state.status !== "in_progress") return [];
  const hand = state.zones.get(`${playerId}-hand`);
  if (!hand || !hand.cardIds.includes(cardId)) return [];
  if (!isPriorityPlayer(state, playerId)) return [];
  const text = card.cardData.oracle_text || "";
  const out: HandActivation[] = [];

  const channel = parseChannel(text);
  if (channel && parseChannelEffect(channel.effect)) {
    out.push({
      kind: "channel",
      cardId,
      label: `Channel ${channel.cost}: ${channel.effect}`,
    });
  }

  const ninjutsu = parseNinjutsu(text);
  if (ninjutsu && NINJUTSU_STEPS.has(state.turn.currentPhase)) {
    for (const attackerId of getUnblockedAttackers(state, playerId)) {
      const name = state.cards.get(attackerId)?.cardData.name ?? "attacker";
      out.push({
        kind: "ninjutsu",
        cardId,
        attackerId,
        label: `Ninjutsu ${ninjutsu}: return ${name} to hand`,
      });
    }
  }
  return out;
}

/** Carry out one option returned by `getHandActivations`. */
export function activateFromHand(
  state: GameState,
  playerId: PlayerId,
  option: HandActivation,
): KeywordActionResult {
  return option.kind === "channel"
    ? channelCard(state, playerId, option.cardId)
    : activateNinjutsu(state, playerId, option.cardId, option.attackerId);
}

/**
 * The AI's pick among its hand activations, or null. Ninjutsu swaps in the
 * ninja for the weakest unblocked attacker when the ninja hits harder.
 * Channel is used only when the card can't be cast this turn anyway (its
 * mana value exceeds the AI's lands), so the AI never trades a castable
 * threat for the cheaper channel effect.
 */
export function chooseAIHandActivation(
  state: GameState,
  playerId: PlayerId,
): HandActivation | null {
  const hand = state.zones.get(`${playerId}-hand`);
  if (!hand) return null;
  const lands = (state.zones.get(`${playerId}-battlefield`)?.cardIds ?? [])
    .map((id) => state.cards.get(id))
    .filter((c) => !!c && /\bland\b/i.test(c.cardData.type_line || "")).length;

  for (const cardId of hand.cardIds) {
    const options = getHandActivations(state, playerId, cardId);
    const ninjutsu = options.filter(
      (o): o is Extract<HandActivation, { kind: "ninjutsu" }> =>
        o.kind === "ninjutsu",
    );
    if (ninjutsu.length > 0) {
      const power = (id: CardInstanceId) => {
        const c = state.cards.get(id);
        return c ? getEffectivePower(c) : 0;
      };
      const weakest = [...ninjutsu].sort(
        (a, b) => power(a.attackerId) - power(b.attackerId),
      )[0];
      const ninja = state.cards.get(cardId);
      // Kaito is a planeswalker in hand; his power comes from his turn form.
      const ninjaPower =
        Number(ninja?.cardData.power ?? NaN) ||
        parseTurnCreatureForm(ninja?.cardData.oracle_text || "")?.power ||
        0;
      if (ninjaPower > power(weakest.attackerId)) return weakest;
    }
    const channel = options.find((o) => o.kind === "channel");
    const card = state.cards.get(cardId);
    if (channel && card && (card.cardData.cmc ?? 0) > lands) return channel;
  }
  return null;
}
