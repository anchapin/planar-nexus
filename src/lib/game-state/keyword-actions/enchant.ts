/**
 * Enchant keyword (Comprehensive Rules 702.5 / 303.4).
 *
 * An Aura spell targets the object its "Enchant [quality]" line allows
 * (CR 303.4a). On resolution the target is re-checked: if it is illegal the
 * spell doesn't resolve and goes to its owner's graveyard (CR 608.3b);
 * otherwise the Aura enters the battlefield attached to it (CR 303.4f).
 * An Aura on the battlefield that is attached to nothing, or to an object it
 * can't legally enchant, is put into its owner's graveyard as a
 * state-based action (CR 704.5m).
 *
 * Supported "Enchant" qualities: permanent type words joined by "or" or
 * commas ("creature", "land", "artifact or creature", "creature or Vehicle"),
 * "non-" prefixes ("nonland permanent"), "you control" /
 * "an opponent controls", and "player". Auras that enchant a card in a
 * graveyard are recognised but not attached yet; they are left alone.
 *
 * An "Enchant player" Aura is attached to a player, not to a permanent:
 * its host id lives in the same `attachedToId` field the other Auras use
 * (the field holds a `PlayerId` in that case) and the Aura goes to its
 * owner's graveyard as soon as the enchanted player leaves the game
 * (CR 704.5m).
 *
 * Issue #2300 (Standard remainder slice), issue #2949 ("Enchant player").
 */
import type {
  GameState,
  CardInstance,
  CardInstanceId,
  PlayerId,
} from "../types";
import { ZoneType } from "../types";
import { canBeEnchantedBy } from "../evergreen-keywords";
import { KeywordActionResult } from "./shared";

const ENCHANT_LINE = /^enchant ([a-z ,'-]+?)\s*(?:\(|$)/im;
/**
 * "Enchant player" — the only non-permanent Enchant quality the engine
 * attaches (#2949). "an opponent" / "another player" style lines stay
 * unsupported: the engine has no way to express "another", and guessing
 * would let an Aura enchant the wrong player.
 */
const PLAYER_QUALITY = /^(?:a|an)?\s*player$/;

export interface EnchantRestriction {
  /** The quality text after "Enchant", lowercased. */
  raw: string;
  /** Alternatives; each is a list of words that must all match. */
  alternatives: string[][];
  controller: "any" | "you" | "opponent";
  /**
   * What the Aura may enchant (CR 303.4a): a permanent for the usual
   * "Enchant creature"-style lines, a player for "Enchant player" lines
   * (#2949).
   */
  targetKind: "permanent" | "player";
  /**
   * True when the Aura enchants something the engine cannot attach to
   * (a card in a graveyard, and every non-player quality it cannot read).
   */
  unsupported: boolean;
}

export function isAuraCard(card: CardInstance): boolean {
  return (card.cardData.type_line ?? "").toLowerCase().includes("aura");
}

export function parseEnchantRestriction(
  oracleText: string | undefined,
): EnchantRestriction | null {
  const match = ENCHANT_LINE.exec((oracleText ?? "").toLowerCase());
  if (!match) return null;
  let raw = match[1].trim();
  const full = raw;
  let controller: EnchantRestriction["controller"] = "any";
  if (/\s+you control$/.test(raw)) {
    controller = "you";
    raw = raw.replace(/\s+you control$/, "");
  } else if (/\s+(?:an )?opponents? controls?$/.test(raw)) {
    controller = "opponent";
    raw = raw.replace(/\s+(?:an )?opponents? controls?$/, "");
  }
  const targetKind: EnchantRestriction["targetKind"] = PLAYER_QUALITY.test(
    raw,
  )
    ? "player"
    : "permanent";
  const unsupported =
    targetKind === "permanent" &&
    (/\b(player|opponent|graveyard)\b/.test(raw) || /\bcard\b/.test(raw));
  const alternatives = raw
    .split(/\s*,\s*(?:or\s+)?|\s+or\s+/)
    .map((alt) => alt.split(/\s+/).filter((w) => w.length > 0 && w !== "a"))
    .filter((words) => words.length > 0);
  return { raw: full, alternatives, controller, targetKind, unsupported };
}

function wordMatches(typeLine: string, word: string): boolean {
  if (word === "permanent") return true;
  if (word.startsWith("non") && word.length > 3) {
    const rest = word.replace(/^non-?/, "");
    return !typeLine.includes(rest);
  }
  return typeLine.includes(word);
}

function isOnBattlefield(state: GameState, card: CardInstance): boolean {
  if (card.currentZoneKey) {
    const zone = state.zones.get(card.currentZoneKey);
    if (zone)
      return (
        zone.type === ZoneType.BATTLEFIELD && zone.cardIds.includes(card.id)
      );
  }
  for (const zone of state.zones.values()) {
    if (zone.type === ZoneType.BATTLEFIELD && zone.cardIds.includes(card.id)) {
      return true;
    }
  }
  return false;
}

/**
 * Whether `aura` may enchant the player `targetId` (an "Enchant player"
 * Aura, #2949). A player who has left the game is not a legal target
 * (CR 608.2b / 704.5m).
 */
function canEnchantPlayer(
  state: GameState,
  aura: CardInstance,
  targetId: CardInstanceId | PlayerId,
): { canEnchant: boolean; reason?: string } {
  const player = state.players.get(targetId);
  if (!player) {
    return {
      canEnchant: false,
      reason: `${aura.cardData.name} can only enchant a player`,
    };
  }
  if (player.hasLost) {
    return {
      canEnchant: false,
      reason: `${player.name} has left the game`,
    };
  }
  return { canEnchant: true };
}

/**
 * Whether `aura` (controlled by `auraControllerId`) can legally enchant
 * `targetId` right now. Used at cast, at resolution and by the SBA check.
 *
 * `targetId` is the id of the object the Aura would attach to: a card id
 * for a permanent-hosting Aura, a player id for an "Enchant player" Aura
 * (#2949). The kind expected follows the Aura's own Enchant line, so a
 * permanent is never a legal target for a player Aura and the other way
 * around.
 */
export function canEnchantTarget(
  state: GameState,
  aura: CardInstance,
  targetId: CardInstanceId | PlayerId,
  auraControllerId: PlayerId = aura.controllerId,
): { canEnchant: boolean; reason?: string } {
  if (!isAuraCard(aura)) {
    return {
      canEnchant: false,
      reason: `${aura.cardData.name} is not an Aura`,
    };
  }
  const restriction = parseEnchantRestriction(aura.cardData.oracle_text);
  if (!restriction) {
    return {
      canEnchant: false,
      reason: `${aura.cardData.name} has no Enchant line`,
    };
  }
  if (restriction.unsupported) {
    return {
      canEnchant: false,
      reason: `Enchant ${restriction.raw} is not supported yet`,
    };
  }
  if (targetId === aura.id) {
    return { canEnchant: false, reason: "An Aura can't enchant itself" };
  }
  if (restriction.targetKind === "player") {
    return canEnchantPlayer(state, aura, targetId);
  }
  const target = state.cards.get(targetId);
  if (!target || !isOnBattlefield(state, target)) {
    return { canEnchant: false, reason: "Target is not on the battlefield" };
  }
  if (target.isPhasedOut) {
    return {
      canEnchant: false,
      reason: "Cannot enchant a phased-out permanent",
    };
  }
  const typeLine = (target.cardData.type_line ?? "").toLowerCase();
  const typeOk = restriction.alternatives.some((words) =>
    words.every((w) => wordMatches(typeLine, w)),
  );
  if (!typeOk) {
    return {
      canEnchant: false,
      reason: `${aura.cardData.name} can only enchant ${restriction.raw}`,
    };
  }
  if (
    restriction.controller === "you" &&
    target.controllerId !== auraControllerId
  ) {
    return {
      canEnchant: false,
      reason: `${aura.cardData.name} can only enchant ${restriction.raw}`,
    };
  }
  if (
    restriction.controller === "opponent" &&
    target.controllerId === auraControllerId
  ) {
    return {
      canEnchant: false,
      reason: `${aura.cardData.name} can only enchant ${restriction.raw}`,
    };
  }
  if (!canBeEnchantedBy(target, aura)) {
    return {
      canEnchant: false,
      reason: `${target.cardData.name} has protection from ${aura.cardData.name}`,
    };
  }
  return { canEnchant: true };
}

/**
 * Attach an Aura to a permanent or to a player, keeping both hosts'
 * `attachedCardIds` in sync. Does not re-check legality; callers do that
 * first.
 *
 * A player host has no `attachedCardIds` list (a player is not a card),
 * so only the Aura's own `attachedToId` is written for that host (#2949).
 */
export function attachAura(
  state: GameState,
  auraId: CardInstanceId,
  targetId: CardInstanceId | PlayerId,
): GameState {
  const aura = state.cards.get(auraId);
  if (!aura) return state;
  const cards = new Map(state.cards);
  const previousHostId = aura.attachedToId;
  if (previousHostId && previousHostId !== targetId) {
    const previousHost = cards.get(previousHostId);
    if (previousHost) {
      cards.set(previousHostId, {
        ...previousHost,
        attachedCardIds: previousHost.attachedCardIds.filter(
          (id) => id !== auraId,
        ),
      });
    }
  }
  cards.set(auraId, {
    ...aura,
    attachedToId: targetId,
    attachedTimestamp: Date.now(),
  });
  const host = cards.get(targetId);
  if (host) {
    cards.set(targetId, {
      ...host,
      attachedCardIds: [
        ...host.attachedCardIds.filter((id) => id !== auraId),
        auraId,
      ],
    });
  }
  return { ...state, cards, lastModifiedAt: Date.now() };
}

/**
 * The player an Aura is attached to, if any (#2949). An "Enchant player"
 * Aura keeps the player's id in the same `attachedToId` field the other
 * Auras use, so effects read the host player straight off the Aura's
 * instance state.
 */
export function getAuraHostPlayerId(
  state: GameState,
  aura: CardInstance,
): PlayerId | undefined {
  if (!aura.attachedToId) return undefined;
  const restriction = parseEnchantRestriction(aura.cardData.oracle_text);
  if (restriction?.targetKind !== "player") return undefined;
  return state.players.has(aura.attachedToId) ? aura.attachedToId : undefined;
}

/** First card target on an Aura spell, if any. */
export function getAuraSpellTarget(
  targets: { type: string; targetId: string }[] | undefined,
): CardInstanceId | undefined {
  return targets?.find((t) => t.type === "card")?.targetId as
    CardInstanceId | undefined;
}

/** First player target on an Aura spell, if any. */
export function getAuraPlayerTarget(
  targets: { type: string; targetId: string }[] | undefined,
): PlayerId | undefined {
  return targets?.find((t) => t.type === "player")?.targetId as
    PlayerId | undefined;
}

/**
 * The object an Aura spell will attach to. An "Enchant player" Aura takes
 * a player target, every other Aura takes a card target (CR 303.4a,
 * #2949).
 */
export function getAuraSpellHostId(
  aura: CardInstance,
  targets: { type: string; targetId: string }[] | undefined,
): CardInstanceId | PlayerId | undefined {
  const restriction = parseEnchantRestriction(aura.cardData.oracle_text);
  if (restriction?.targetKind === "player") {
    return getAuraPlayerTarget(targets);
  }
  return getAuraSpellTarget(targets);
}

/**
 * Cast-time check (CR 303.4a): an Aura spell needs a legal target. Bestow
 * is handled by its own path and skips this.
 *
 * `targetId` is the id of the chosen target: a card id for a
 * permanent-hosting Aura, a player id for an "Enchant player" Aura
 * (#2949). The kind expected comes from the Aura's own Enchant line, so a
 * player target is rejected for a permanent Aura and the other way round.
 */
export function validateAuraSpellTarget(
  state: GameState,
  aura: CardInstance,
  casterId: PlayerId,
  targetId: CardInstanceId | PlayerId | undefined,
): { valid: boolean; reason?: string } {
  const restriction = parseEnchantRestriction(aura.cardData.oracle_text);
  if (!restriction || restriction.unsupported) return { valid: true };
  if (!targetId) {
    return {
      valid: false,
      reason:
        restriction.targetKind === "player"
          ? `${aura.cardData.name} needs a player target to enchant`
          : `${aura.cardData.name} needs a target to enchant`,
    };
  }
  const check = canEnchantTarget(state, aura, targetId, casterId);
  return check.canEnchant
    ? { valid: true }
    : { valid: false, reason: check.reason };
}

/**
 * Whether an Aura on the battlefield should be put into the graveyard by
 * SBA 704.5m: attached to nothing, or to something it can't legally enchant.
 *
 * An "Enchant player" Aura (#2949) stays attached while the enchanted
 * player is in the game and goes to its owner's graveyard as soon as that
 * player leaves the game (704.5m). Auras with unsupported Enchant
 * qualities (graveyard cards) are never flagged, since the engine can't
 * attach them yet.
 */
export function isAuraIllegallyAttached(
  state: GameState,
  aura: CardInstance,
): { illegal: boolean; reason?: string } {
  if (!isAuraCard(aura)) return { illegal: false };
  const restriction = parseEnchantRestriction(aura.cardData.oracle_text);
  if (restriction?.targetKind === "player") {
    // CR 704.5m: an Aura attached to a player who is no longer in the
    // game is put into its owner's graveyard.
    if (!aura.attachedToId)
      return { illegal: true, reason: "enchanting nothing" };
    const host = state.players.get(aura.attachedToId);
    if (!host) return { illegal: true, reason: "enchanting nothing" };
    if (host.hasLost) {
      return {
        illegal: true,
        reason: "the enchanted player has left the game",
      };
    }
    return { illegal: false };
  }
  if (!restriction || restriction.unsupported) {
    // Keep the old rule for these: only a host that has left matters.
    if (!aura.attachedToId) return { illegal: false };
    const host = state.cards.get(aura.attachedToId);
    return host && isOnBattlefield(state, host)
      ? { illegal: false }
      : { illegal: true, reason: "enchanting nothing" };
  }
  if (!aura.attachedToId)
    return { illegal: true, reason: "enchanting nothing" };
  const check = canEnchantTarget(state, aura, aura.attachedToId);
  if (check.canEnchant) return { illegal: false };
  const host = state.cards.get(aura.attachedToId);
  if (!host || !isOnBattlefield(state, host)) {
    return { illegal: true, reason: "enchanting nothing" };
  }
  return { illegal: true, reason: check.reason };
}

export type { KeywordActionResult };
