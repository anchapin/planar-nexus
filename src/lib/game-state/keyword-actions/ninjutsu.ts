/**
 * Ninjutsu (CR 702.49), issue #2300: Kaito, Bane of Nightmares.
 *
 * "Ninjutsu {cost} ({cost}, Return an unblocked attacker you control to hand:
 * Put this card onto the battlefield from your hand tapped and attacking.)"
 *
 * Like `channelCard`, the ability resolves as soon as its costs are paid
 * instead of waiting on the stack. The ninja attacks the same player or
 * planeswalker the returned creature was attacking (CR 702.49c). It was never
 * declared as an attacker, so "whenever ~ attacks" triggers do not fire.
 *
 * Kaito is a planeswalker, so this file also handles his static ability:
 * "During your turn, as long as Kaito has one or more loyalty counters on him,
 * he's a 3/4 Ninja creature and has hexproof." Known gap: damage dealt to him
 * while he is both a creature and a planeswalker follows the existing damage
 * path rather than marking damage and removing loyalty separately.
 */
import type {
  GameState,
  CardInstance,
  CardInstanceId,
  PlayerId,
} from "../types";
import { Phase } from "../types";
import { spendMana } from "../mana";
import { parseManaCost } from "../oracle-text-parser/mana-cost";
import { isPriorityPlayer } from "../priority-guard";
import {
  getEffectivePower,
  hasFirstStrike,
  hasDoubleStrike,
} from "../evergreen-keywords";
import { moveCardToZone } from "./removal";
import { KeywordActionResult } from "./shared";

const NINJUTSU_RE = /^Ninjutsu\s+((?:\{[^}]+\})+)/im;

/** Mana cost of the card's ninjutsu ability, e.g. "{1}{U}{B}". */
export function parseNinjutsu(oracleText: string): string | null {
  if (!oracleText) return null;
  const m = oracleText.match(NINJUTSU_RE);
  return m ? m[1] : null;
}

export function hasNinjutsu(oracleText: string): boolean {
  return parseNinjutsu(oracleText) !== null;
}

export interface TurnCreatureForm {
  power: number;
  toughness: number;
  subtype: string;
  hexproof: boolean;
}

const TURN_FORM_RE =
  /During your turn, as long as [^,]+? has one or more loyalty counters on (?:him|her|it|them), (?:he|she|it|they)(?:'s| is| are) an? (\d+)\/(\d+) (\w+) creature( and has hexproof)?/i;

export function parseTurnCreatureForm(
  oracleText: string,
): TurnCreatureForm | null {
  if (!oracleText) return null;
  const m = oracleText.match(TURN_FORM_RE);
  if (!m) return null;
  return {
    power: parseInt(m[1], 10),
    toughness: parseInt(m[2], 10),
    subtype: m[3],
    hexproof: Boolean(m[4]),
  };
}

function loyaltyCounters(card: CardInstance): number {
  return card.counters?.find((c) => c.type === "loyalty")?.count ?? 0;
}

function onBattlefield(state: GameState, cardId: CardInstanceId): boolean {
  for (const [key, zone] of state.zones) {
    if (key.endsWith("-battlefield") && zone.cardIds.includes(cardId)) {
      return true;
    }
  }
  return false;
}

/**
 * Recompute `turnCreatureForm` for every card. Returns the same state object
 * when nothing changed.
 */
export function refreshTurnCreatureForms(state: GameState): GameState {
  const activePlayerId = state.turn?.activePlayerId;
  let cards: GameState["cards"] | null = null;
  for (const [cardId, card] of state.cards) {
    const form = parseTurnCreatureForm(card.cardData.oracle_text ?? "");
    const active =
      form !== null &&
      card.controllerId === activePlayerId &&
      loyaltyCounters(card) > 0 &&
      onBattlefield(state, cardId);
    const next = active ? form : undefined;
    const prev = card.turnCreatureForm;
    if (!prev && !next) continue;
    if (
      prev &&
      next &&
      prev.power === next.power &&
      prev.toughness === next.toughness &&
      prev.subtype === next.subtype &&
      prev.hexproof === next.hexproof
    ) {
      continue;
    }
    cards ??= new Map(state.cards);
    const updated = { ...card };
    if (next) updated.turnCreatureForm = next;
    else delete updated.turnCreatureForm;
    cards.set(cardId, updated);
  }
  return cards ? { ...state, cards } : state;
}

/** Steps in which blockers have been declared and attackers are still in combat. */
const NINJUTSU_STEPS: ReadonlySet<Phase> = new Set([
  Phase.DECLARE_BLOCKERS,
  Phase.COMBAT_DAMAGE_FIRST_STRIKE,
  Phase.COMBAT_DAMAGE,
  Phase.END_COMBAT,
]);

/**
 * Activate `ninjaId`'s ninjutsu from `playerId`'s hand, returning the
 * unblocked attacker `attackerId` to its owner's hand.
 */
export function activateNinjutsu(
  state: GameState,
  playerId: PlayerId,
  ninjaId: CardInstanceId,
  attackerId: CardInstanceId,
): KeywordActionResult {
  const fail = (error: string): KeywordActionResult => ({
    success: false,
    state,
    description: "",
    error,
  });
  const ninja = state.cards.get(ninjaId);
  if (!ninja) return fail(`Card ${ninjaId} not found`);
  const cost = parseNinjutsu(ninja.cardData.oracle_text || "");
  if (!cost) return fail(`${ninja.cardData.name} does not have ninjutsu.`);
  const hand = state.zones.get(`${playerId}-hand`);
  if (!hand || !hand.cardIds.includes(ninjaId)) {
    return fail("Ninjutsu can only be activated from your hand.");
  }
  if (state.status !== "in_progress") {
    return fail("Ninjutsu can only be activated during an in-progress game.");
  }
  if (!isPriorityPlayer(state, playerId)) {
    return fail("You do not have priority.");
  }
  if (!NINJUTSU_STEPS.has(state.turn.currentPhase)) {
    return fail("Ninjutsu can only be activated after blockers are declared.");
  }
  const attackEntry = state.combat.attackers.find(
    (a) => a.cardId === attackerId,
  );
  const attacker = state.cards.get(attackerId);
  if (!attackEntry || !attacker) {
    return fail("That creature is not attacking.");
  }
  if (attacker.controllerId !== playerId) {
    return fail("You can only return an attacker you control.");
  }
  if ((state.combat.blockers.get(attackerId) ?? []).length > 0) {
    return fail("That attacker is blocked.");
  }

  let working = state;
  const mana = parseManaCost(cost);
  if (mana) {
    const spend = spendMana(working, playerId, {
      generic: mana.generic,
      colorless: mana.colorless,
      white: mana.white,
      blue: mana.blue,
      black: mana.black,
      red: mana.red,
      green: mana.green,
    });
    if (!spend.success) return fail("Not enough mana for ninjutsu.");
    working = spend.state;
  }

  const bounce = moveCardToZone(working, attackerId, "hand");
  if (!bounce.success) {
    return fail(bounce.error ?? "Failed to return the attacker to hand.");
  }
  working = bounce.state;

  const enter = moveCardToZone(working, ninjaId, "battlefield");
  if (!enter.success) {
    return fail(enter.error ?? "Failed to put the ninja onto the battlefield.");
  }
  working = enter.state;
  const entered = working.cards.get(ninjaId);
  if (entered) {
    const cards = new Map(working.cards);
    cards.set(ninjaId, { ...entered, isTapped: true });
    working = refreshTurnCreatureForms({ ...working, cards });
  }

  const ninjaCard = working.cards.get(ninjaId)!;
  const blockers = new Map(working.combat.blockers);
  blockers.delete(attackerId);
  const attackers = working.combat.attackers
    .filter((a) => a.cardId !== attackerId)
    .concat({
      cardId: ninjaId,
      defenderId: attackEntry.defenderId,
      isAttackingPlaneswalker: attackEntry.isAttackingPlaneswalker,
      damageToDeal: getEffectivePower(ninjaCard),
      hasFirstStrike: hasFirstStrike(ninjaCard),
      hasDoubleStrike: hasDoubleStrike(ninjaCard),
    });
  working = { ...working, combat: { ...working.combat, attackers, blockers } };

  return {
    success: true,
    state: working,
    description: `${ninja.cardData.name} ninjutsu: returned ${attacker.cardData.name} to hand and entered tapped and attacking.`,
    affectedCards: [ninjaId, attackerId],
  };
}
