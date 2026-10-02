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
 * "non-" prefixes ("nonland permanent"), and "you control" /
 * "an opponent controls". Auras that enchant a player or a card in a
 * graveyard are recognised but not attached yet; they are left alone.
 *
 * Issue #2300 (Standard remainder slice).
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

export interface EnchantRestriction {
  /** The quality text after "Enchant", lowercased. */
  raw: string;
  /** Alternatives; each is a list of words that must all match. */
  alternatives: string[][];
  controller: "any" | "you" | "opponent";
  /** True when the Aura enchants something other than a permanent. */
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
  const unsupported =
    /\b(player|opponent|graveyard)\b/.test(raw) || /\bcard\b/.test(raw);
  const alternatives = raw
    .split(/\s*,\s*(?:or\s+)?|\s+or\s+/)
    .map((alt) => alt.split(/\s+/).filter((w) => w.length > 0 && w !== "a"))
    .filter((words) => words.length > 0);
  return { raw: full, alternatives, controller, unsupported };
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
 * Whether `aura` (controlled by `auraControllerId`) can legally enchant
 * `targetId` right now. Used at cast, at resolution and by the SBA check.
 */
export function canEnchantTarget(
  state: GameState,
  aura: CardInstance,
  targetId: CardInstanceId,
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
 * Attach an Aura to a permanent, keeping both hosts' `attachedCardIds` in
 * sync. Does not re-check legality; callers do that first.
 */
export function attachAura(
  state: GameState,
  auraId: CardInstanceId,
  targetId: CardInstanceId,
): GameState {
  const aura = state.cards.get(auraId);
  const target = state.cards.get(targetId);
  if (!aura || !target) return state;
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
  const host = cards.get(targetId)!;
  cards.set(targetId, {
    ...host,
    attachedCardIds: [
      ...host.attachedCardIds.filter((id) => id !== auraId),
      auraId,
    ],
  });
  return { ...state, cards, lastModifiedAt: Date.now() };
}

/** First card target on an Aura spell, if any. */
export function getAuraSpellTarget(
  targets: { type: string; targetId: string }[] | undefined,
): CardInstanceId | undefined {
  return targets?.find((t) => t.type === "card")?.targetId as
    CardInstanceId | undefined;
}

/**
 * Cast-time check (CR 303.4a): an Aura spell needs a legal target. Bestow
 * is handled by its own path and skips this.
 */
export function validateAuraSpellTarget(
  state: GameState,
  aura: CardInstance,
  casterId: PlayerId,
  targetId: CardInstanceId | undefined,
): { valid: boolean; reason?: string } {
  const restriction = parseEnchantRestriction(aura.cardData.oracle_text);
  if (!restriction || restriction.unsupported) return { valid: true };
  if (!targetId) {
    return {
      valid: false,
      reason: `${aura.cardData.name} needs a target to enchant`,
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
 * Auras with unsupported Enchant qualities (players, graveyard cards) are
 * never flagged, since the engine can't attach them yet.
 */
export function isAuraIllegallyAttached(
  state: GameState,
  aura: CardInstance,
): { illegal: boolean; reason?: string } {
  if (!isAuraCard(aura)) return { illegal: false };
  const restriction = parseEnchantRestriction(aura.cardData.oracle_text);
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
