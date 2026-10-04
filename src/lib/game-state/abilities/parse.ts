import type { ScryfallCard } from "../types";
import { parseOracleText } from "../oracle-text-parser";
import { AbilityType } from "../oracle-text-parser/core";
import { parseManaCost } from "../oracle-text-parser/mana-cost";
import { getCardScript } from "../card-scripts/registry";
import {
  isPermanentScript,
  type CardScript,
  type ScriptedActivated,
  type ScriptedTrigger,
} from "../card-scripts/schema";
import type {
  ParsedActivatedAbility,
  ParsedTriggeredAbility,
} from "../oracle-text-parser";

export function hasActivatedAbilities(card: { oracle_text?: string }): boolean {
  if (!card.oracle_text) return false;
  return card.oracle_text.includes(":");
}

/** The card's permanent script, when its abilities come from a script. */
function permanentScript(card: ScryfallCard): CardScript | undefined {
  const script = getCardScript(card.name);
  return script && isPermanentScript(script) ? script : undefined;
}

function scriptedActivated(a: ScriptedActivated): ParsedActivatedAbility {
  return {
    type: AbilityType.ACTIVATED,
    costs: {
      mana: a.cost.mana ? parseManaCost(a.cost.mana) : null,
      tap: a.cost.tap,
      sacrifice: a.cost.sacrifice,
      exile: false,
      discard: false,
      payLife: 0,
      additionalCosts: [],
    },
    effect: a.text,
    effectType: "generic",
    targets: [],
  };
}

function scriptedTrigger(t: ScriptedTrigger): ParsedTriggeredAbility {
  return {
    type: AbilityType.TRIGGERED,
    trigger: { event: "entersBattlefield", subject: t.subject },
    effect: t.text,
    effectType: "generic",
    targets: [],
  };
}

/**
 * Triggered abilities from a card's script (card-scripts, #2490), or
 * undefined when the card isn't a scripted permanent.
 */
export function getScriptedTriggeredAbilities(
  card: ScryfallCard,
): ParsedTriggeredAbility[] | undefined {
  const script = permanentScript(card);
  return script ? (script.triggers ?? []).map(scriptedTrigger) : undefined;
}

export function getActivatedAbilities(
  card: ScryfallCard,
): ParsedActivatedAbility[] {
  const script = permanentScript(card);
  if (script) return (script.activated ?? []).map(scriptedActivated);
  if (!card.oracle_text) return [];
  return parseOracleText(card).activatedAbilities;
}

export function hasTriggeredAbilities(card: { oracle_text?: string }): boolean {
  if (!card.oracle_text) return false;
  const text = card.oracle_text.toLowerCase();
  return (
    text.includes("when ") || text.includes("whenever ") || text.includes("at ")
  );
}

export function getTriggeredAbilities(
  card: ScryfallCard,
): ParsedTriggeredAbility[] {
  const scripted = getScriptedTriggeredAbilities(card);
  if (scripted) return scripted;
  if (!card.oracle_text) return [];
  return parseOracleText(card).triggeredAbilities;
}
