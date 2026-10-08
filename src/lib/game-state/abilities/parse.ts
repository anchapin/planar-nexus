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
import { EQUIPMENT_ATTACH_ON_ENTER_TEXT } from "../card-scripts/schema";
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
  return {
    caster: t.caster ?? "you",
    ...SPELL_FILTER[t.spell ?? "any"],
    ...(t.targets === "single" ? { singleTarget: true } : {}),
  };
}

function scriptedCondition(t: ScriptedTrigger): TriggerCondition {
  if (t.event === "landfall") return { event: "landfall" };
  if (t.event === "upkeep")
    return { event: "upkeep", upkeepOf: t.whose ?? "you" };
  if (t.event === "cast")
    return { event: "spellCast", castFilter: castFilterOf(t) };
  // phaseEnds: "at the beginning of your end step" — the engine's
  // `phaseEnds` covers both the CR 603.4 delayed-trigger and the
  // phase-end tick (see `abilities/triggered.ts`). subject is unused
  // because the trigger fires on a global phase boundary, not on a
  // creature event.
  if (t.event === "phaseEnds") return { event: "phaseEnds" };
  // lifeGain: "whenever you gain life" (CR 118) — the engine's
  // `lifeGain` case in `abilities/triggered.ts` fires the trigger for
  // any life gain by the controller. subject="self" is the standard
  // shape for "this creature gets +1/+1 counters" cards (Ajani's
  // Pridemate); subject="another" / "any" is supported but uncommon
  // for the v1 sample cards.
  if (t.event === "lifeGain") return { event: "lifeGain" };
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
  if (!script) return undefined;
  const out = (script.triggers ?? []).map(scriptedTrigger);
  // Equipment with `attachOnEnter: true` (#2561): a synthetic ETB trigger
  // attaches it to a creature the controller picks. The text matches the
  // interpreter's `getScriptedAbility`, so the resolver recognizes the
  // stack object as scripted and routes the `AttachEquipment` op.
  if (script.equipment?.attachOnEnter) {
    out.push(
      scriptedTrigger({
        text: EQUIPMENT_ATTACH_ON_ENTER_TEXT,
        event: "etb",
        subject: "self",
        effects: [
          { op: "AttachEquipment", target: "creature", controller: "you" },
        ],
      }),
    );
  }
  return out;
}

export function getActivatedAbilities(
  card: ScryfallCard,
): ParsedActivatedAbility[] {
  const script = permanentScript(card);
  if (script) {
    const out: ParsedActivatedAbility[] = (script.activated ?? []).map(
      scriptedActivated,
    );
    // #2566: when a card script has `cycling`, synthesize a parsed
    // activated ability for the cycling keyword so the engine / UI can
    // see the ability (legal-targets, hand-only, sorcery-speed). The
    // ability's `effect` is a canonical "Cycling {cost}." / "[Type]cycling
    // {cost}." / "Landcycling {cost}." / "Basic landcycling {cost}."
    // string that `parseCycling` recognizes from the synthesized text.
    // Resolution flows through the engine's `cycleCard` (which still
    // reads the cost from the card's oracle text today; the lane
    // documents this as a v1 limitation).
    if (script.cycling) {
      out.push(scriptedCycling(script));
    }
    return out;
  }
  if (!card.oracle_text) return [];
  return parseOracleText(card).activatedAbilities;
}

/**
 * Build a `ParsedActivatedAbility` from a card script's `cycling` field
 * (#2566). The synthesized ability has:
 *  - `costs.mana` = the printed cycling cost
 *  - `costs.discard` = true (CR 702.30a: discard the card is part of
 *    the cost, paid as part of the activated ability)
 *  - `effect` = the canonical cycling text for the variant
 *  - `effectType` = "generic" (the engine doesn't have a dedicated
 *    cycling effectType; `cycleCard` short-circuits on the cycling
 *    variant text)
 *
 * The cycling ability is sorcery-speed (CR 117.1a — main phase, empty
 * stack, priority, active player) and from-hand only (the existing
 * `canCycleCard` / `cycleCard` checks enforce this; the synthesized
 * `effect` text is the signal).
 */
function scriptedCycling(script: CardScript): ParsedActivatedAbility {
  const cyc = script.cycling!;
  const variant: "cycling" | "typecycling" | "landcycling" | "basic_landcycling" =
    cyc.variant ?? "cycling";
  const effectText = cyclingEffectText({ ...cyc, variant });
  return {
    type: AbilityType.ACTIVATED,
    costs: {
      mana: parseManaCost(cyc.cost),
      tap: false,
      sacrifice: false,
      exile: false,
      discard: true,
      payLife: 0,
      additionalCosts: [],
    },
    effect: effectText,
    effectType: "generic",
    targets: [],
    sorceryOnly: true,
  };
}

/**
 * Canonical cycling effect text for a `cycling` script field, matching
 * the strings the engine's `parseCycling` recognizes. Mirrors the
 * "Cycling {cost}." / "[Type]cycling {cost}." / "Landcycling {cost}."
 * / "Basic landcycling {cost}." patterns.
 */
function cyclingEffectText(cyc: {
  cost: string;
  variant?:
    | "cycling"
    | "typecycling"
    | "landcycling"
    | "basic_landcycling";
  type?: string;
  basicLandType?: string;
}): string {
  switch (cyc.variant ?? "cycling") {
    case "cycling":
      return `Cycling ${cyc.cost}.`;
    case "typecycling":
      // "[Type]cycling {cost}." — e.g. "Wizardcycling {2}."
      return `${cyc.type ?? "Unknown"}cycling ${cyc.cost}.`;
    case "landcycling":
      // "Landcycling {cost}." or "[Type] landcycling {cost}."
      return cyc.basicLandType
        ? `${cyc.basicLandType} landcycling ${cyc.cost}.`
        : `Landcycling ${cyc.cost}.`;
    case "basic_landcycling":
      return `Basic landcycling ${cyc.cost}.`;
  }
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
