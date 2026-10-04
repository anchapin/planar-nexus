import type { ScryfallCard } from "../types";
import { parseOracleText } from "../oracle-text-parser";
import { AbilityType } from "../oracle-text-parser/core";
import { parseManaCost } from "../oracle-text-parser/mana-cost";
import { getCardScript } from "../card-scripts/registry";
import { isPermanentScript } from "../card-scripts/script-guards";
import type {
  CardScript,
  ScriptedActivated,
  ScriptedTrigger,
} from "../card-scripts/schema";
import type {
  ParsedActivatedAbility,
  ParsedTriggeredAbility,
} from "../oracle-text-parser";
import type {
  CastFilter,
  TriggerCondition,
} from "../oracle-text-parser/abilities";

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
    ...(a.limit && {
      activationLimit: a.limit === "once" ? "once" : "oncePerTurn",
    }),
    ...(a.timing === "sorcery" && { sorceryOnly: true }),
  };
}

const SUBJECT_EVENT = {
  etb: "entersBattlefield",
  dies: "dies",
  attacks: "attacked",
} as const;

const SPELL_FILTER: Record<string, Partial<CastFilter>> = {
  any: {},
  creature: { types: ["creature"] },
  noncreature: { excludeTypes: ["creature"] },
  instant_or_sorcery: { types: ["instant", "sorcery"] },
  artifact: { types: ["artifact"] },
  enchantment: { types: ["enchantment"] },
  multicolored: { multicolored: true },
};

function castFilterOf(t: ScriptedTrigger): CastFilter {
  return { caster: t.caster ?? "you", ...SPELL_FILTER[t.spell ?? "any"] };
}

function scriptedCondition(t: ScriptedTrigger): TriggerCondition {
  if (t.event === "landfall") return { event: "landfall" };
  if (t.event === "upkeep")
    return { event: "upkeep", upkeepOf: t.whose ?? "you" };
  if (t.event === "cast")
    return { event: "spellCast", castFilter: castFilterOf(t) };
  const condition: TriggerCondition = {
    event: SUBJECT_EVENT[t.event],
    subject: t.subject,
  };
  if (t.subject !== "self") {
    // Script subjects are creatures (CR 603.6a); ETB keeps its old any-permanent reading.
    condition.enteringFilter = {
      types: t.event === "etb" ? [] : ["creature"],
      ...(t.controller ? { controller: t.controller } : {}),
    };
  }
  if (t.event === "attacks" && t.once) condition.attackFilter = { once: true };
  return condition;
}

function scriptedTrigger(t: ScriptedTrigger): ParsedTriggeredAbility {
  return {
    type: AbilityType.TRIGGERED,
    trigger: scriptedCondition(t),
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
