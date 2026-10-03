/**
 * Ability parsing: activated (cost: effect), triggered (when/whenever/at), static abilities, and stack eligibility.
 *
 * Mechanically extracted from oracle-text-parser.ts (issue #1725);
 * behavior pinned by the existing engine suites.
 */
import {
  DISCARD_NAMED_PREFIX,
  parseDiscardNamedCost,
} from "../keyword-actions/grandeur";
import type { ScryfallCard } from "../types";
import { AbilityType } from "./core";
import { ParsedManaCost, parseManaCost } from "./mana-cost";

/**
 * Target specification parsed from text
 */
export interface ParsedTarget {
  type:
    | "creature"
    | "player"
    | "permanent"
    | "planeswalker"
    | "artifact"
    | "enchantment"
    | "land"
    | "any"
    | "self";
  restrictions: string[];
  isOptional: boolean;
}

/**
 * Activated ability parsed from text
 */
export interface ParsedActivatedAbility {
  type: AbilityType.ACTIVATED;
  costs: {
    mana: ParsedManaCost | null;
    tap: boolean;
    sacrifice: boolean;
    exile: boolean;
    discard: boolean;
    payLife: number;
    additionalCosts: string[];
  };
  effect: string;
  effectType:
    | "damage"
    | "destroy"
    | "exile"
    | "draw"
    | "createToken"
    | "counter"
    | "gainLife"
    | "loseLife"
    | "tap"
    | "untap"
    | "buff"
    | "debuff"
    | "addCounter"
    | "removeCounter"
    | "gainControl"
    | "search"
    | "putIntoPlay"
    | "return"
    | "transform"
    | "generic";
  targets: ParsedTarget[];
  value?: number;
  duration?: "untilEndOfTurn" | "untilEndOfGame" | "permanent";
}

/**
 * Trigger condition for triggered abilities
 */
export interface TriggerCondition {
  event:
    | "landfall"
    | "entersBattlefield"
    | "leavesBattlefield"
    | "damageDealt"
    | "dies"
    | "attacked"
    | "blocked"
    | "cast"
    | "turnEnds"
    | "phaseEnds"
    | "upkeep"
    | "untapStep"
    | "turnBegins"
    | "drawStep"
    | "dealsCombatDamageToPlayer"
    | "combatDamageStepEnds"
    | "counterAdded"
    | "counterRemoved"
    | "lifeGain"
    | "lifeLost"
    | "spellCast"
    | "abilityActivated"
    | "beginningOfTurn"
    | "endOfTurn"
    | "cleanupStep"
    | "creatureDies"
    | "exploit"
    | "disturb"
    | "transform"
    | "unknown";
  /**
   * Enters-the-battlefield subject (CR 603.6a): "self" for "this creature" /
   * the card's own name, "another" for "another ..." / "other ...", "any"
   * for "a ..." / "one or more ...". Undefined on non-ETB triggers.
   */
  subject?: "self" | "another" | "any";
  /** Which entering permanents an "another"/"any" ETB trigger cares about. */
  enteringFilter?: {
    types: string[];
    controller?: "you" | "opponent";
    nontoken?: boolean;
  };
  condition?: string;
  target?: ParsedTarget;
  source?: string;
  amount?: number;
  comparison?: "greaterThan" | "lessThan" | "equalTo";
}

/**
 * Triggered ability parsed from text
 */
export interface ParsedTriggeredAbility {
  type: AbilityType.TRIGGERED;
  trigger: TriggerCondition;
  effect: string;
  effectType: string;
  targets: ParsedTarget[];
  value?: number;
  interveningIf?: string;
  /**
   * A "while <condition>" clause on the trigger event itself ("Whenever this
   * creature attacks while you control a creature with power 4 or greater").
   * Part of the trigger condition (CR 603.2): checked when the event happens,
   * not again on resolution, unlike an intervening "if" (CR 603.4).
   */
  whileCondition?: string;
}

/**
 * Static ability parsed from text
 */
export interface ParsedStaticAbility {
  type: AbilityType.STATIC;
  ability: "keyword" | "staticEffect";
  keywordType?: string;
  effect?: string;
  affects?:
    | "opponents"
    | "creatures"
    | "you"
    | "all"
    | "controlled"
    | "enchanted"
    | "equipped";
}

/**
 * Parse activated abilities from Oracle text
 *
 * Activated abilities follow the format: [cost]: [effect]
 */
export function parseActivatedAbilities(
  oracleText: string,
  _typeLine: string,
): ParsedActivatedAbility[] {
  const abilities: ParsedActivatedAbility[] = [];

  // Split by periods to find ability sentences
  const sentences = oracleText.split(/\.\s*/);

  for (const sentence of sentences) {
    // Look for the colon that separates cost from effect
    const colonIndex = sentence.indexOf(":");

    if (colonIndex === -1) {
      continue; // Not an activated ability
    }

    const costPart = sentence.slice(0, colonIndex).trim();
    const effectPart = sentence.slice(colonIndex + 1).trim();

    // Parse the cost
    const costs = parseAbilityCost(costPart);

    if (!costs) {
      continue;
    }

    // Parse the effect
    const effect = parseEffect(effectPart);

    if (!effect) {
      continue;
    }

    abilities.push({
      type: AbilityType.ACTIVATED,
      costs,
      effect: effectPart,
      effectType: effect.effectType as ParsedActivatedAbility["effectType"],
      targets: effect.targets,
      value: effect.value,
    });
  }

  return abilities;
}

/**
 * Parse ability cost string
 */
function parseAbilityCost(
  costString: string,
): ParsedActivatedAbility["costs"] | null {
  const costs: ParsedActivatedAbility["costs"] = {
    mana: null,
    tap: false,
    sacrifice: false,
    exile: false,
    discard: false,
    payLife: 0,
    additionalCosts: [],
  };

  const costLower = costString.toLowerCase();

  // Check for tap
  if (costLower.includes("tap") || costLower.includes("{t}")) {
    costs.tap = true;
  }

  // Check for sacrifice
  if (costLower.includes("sacrifice")) {
    costs.sacrifice = true;
  }

  // Check for exile from graveyard
  if (costLower.includes("exile") && costLower.includes("graveyard")) {
    costs.exile = true;
  }

  // Check for discard
  if (costLower.includes("discard")) {
    costs.discard = true;
  }

  // Check for pay life
  const lifeMatch = costLower.match(/pay\s+(\d+)\s+life/);
  if (lifeMatch) {
    costs.payLife = parseInt(lifeMatch[1], 10);
  }

  // Parse mana cost
  const manaMatch = costString.match(/{[^}]+}/g);
  if (manaMatch) {
    costs.mana = parseManaCost(manaMatch.join(""));
  }

  // Grandeur-style "discard another card named X" (issue #2300): a specific
  // card, not any card, so it's tracked apart from the generic discard flag.
  const namedDiscard = parseDiscardNamedCost(costString);
  if (namedDiscard) {
    costs.discard = false;
    costs.additionalCosts.push(`${DISCARD_NAMED_PREFIX}${namedDiscard}`);
  }

  // Check for additional costs like "sacrifice a creature"
  if (costLower.includes("sacrifice") && !costs.sacrifice) {
    costs.additionalCosts.push("sacrifice");
  }

  // If no costs parsed, it's not a valid activated ability
  if (
    !costs.tap &&
    !costs.sacrifice &&
    !costs.mana &&
    costs.payLife === 0 &&
    costs.additionalCosts.length === 0
  ) {
    return null;
  }

  return costs;
}

/**
 * Parse effect string to determine effect type
 */
function parseEffect(
  effectString: string,
): { effectType: string; targets: ParsedTarget[]; value?: number } | null {
  const effect = effectString.toLowerCase();
  const targets: ParsedTarget[] = [];
  let value: number | undefined;

  // Extract numerical values
  const numberMatch = effect.match(/(\d+)/);
  if (numberMatch) {
    value = parseInt(numberMatch[1], 10);
  }

  // Determine effect type based on keywords
  // NOTE (issue #1098): real Oracle text is "deals N damage" (3rd person). The
  // original check only matched the imperative "deal ", so the damage branch
  // was never reached for any real card. Accept both forms.
  if (
    (effect.includes("deal ") || effect.includes("deals ")) &&
    effect.includes(" damage")
  ) {
    return { effectType: "damage" as const, targets, value };
  }

  if (effect.includes("destroy")) {
    return {
      effectType: "destroy" as const,
      targets: [{ type: "creature", restrictions: [], isOptional: false }],
      value,
    };
  }

  if (effect.includes("exile")) {
    return { effectType: "exile" as const, targets, value };
  }

  if (
    effect.includes("draw ") &&
    (effect.includes("card") || effect.includes("cards"))
  ) {
    return {
      effectType: "draw" as const,
      targets: [{ type: "player", restrictions: [], isOptional: false }],
      value,
    };
  }

  if (effect.includes("create ") && effect.includes("token")) {
    return { effectType: "createToken" as const, targets, value };
  }

  if (
    effect.includes("counter") &&
    (effect.includes("spell") || effect.includes("ability"))
  ) {
    return { effectType: "counter" as const, targets, value };
  }

  if (effect.includes("gain ") && effect.includes("life")) {
    return {
      effectType: "gainLife" as const,
      targets: [{ type: "player", restrictions: [], isOptional: false }],
      value,
    };
  }

  // NOTE (issue #1098): same verb-conjugation gap as damage above — real Oracle
  // text uses both "you lose N life" and "target player loses N life".
  if (
    (effect.includes("lose ") || effect.includes("loses ")) &&
    effect.includes("life")
  ) {
    return {
      effectType: "loseLife" as const,
      targets: [{ type: "player", restrictions: [], isOptional: false }],
      value,
    };
  }

  if (effect.includes("tap ") || effect.includes("untap ")) {
    const tapEffectType = effect.includes("tap ") ? "tap" : "untap";
    return { effectType: tapEffectType as "tap" | "untap", targets, value };
  }

  if (
    (effect.includes("+1/+1") || effect.includes("-1/-1")) &&
    effect.includes("counter")
  ) {
    return { effectType: "addCounter" as const, targets, value };
  }

  if (effect.includes("return ") && effect.includes(" to hand")) {
    return { effectType: "return" as const, targets, value };
  }

  if (effect.includes("search ") && effect.includes(" library")) {
    return {
      effectType: "search" as const,
      targets: [{ type: "player", restrictions: [], isOptional: false }],
      value,
    };
  }

  if (effect.includes("put ") && effect.includes(" into play")) {
    return { effectType: "putIntoPlay" as const, targets, value };
  }

  if (effect.includes("gain control")) {
    return {
      effectType: "gainControl" as const,
      targets: [{ type: "permanent", restrictions: [], isOptional: false }],
      value,
    };
  }

  // Generic effect if we can't determine type
  return { effectType: "generic" as const, targets, value };
}

/**
 * Parse triggered abilities from Oracle text
 *
 * Triggered abilities use "when", "whenever", or "at"
 */
/**
 * Extract a CR 603.4 intervening "if" clause from the start of an effect text.
 *
 * A triggered ability of the form "When/Whenever/At [trigger], if [condition],
 * [effect]" carries an intervening-if clause. The clause sits immediately after
 * the trigger condition's comma and is itself followed by a comma. This helper
 * splits a leading "if <condition>," off the effect text, returning the raw
 * condition (for evaluation at trigger time AND resolution time, per CR 603.4)
 * and the remaining effect.
 *
 * Returns `interveningIf: undefined` when the text does not begin with an
 * intervening-if, so ordinary triggers are unaffected.
 */
function extractInterveningIfClause(effectText: string): {
  interveningIf?: string;
  effect: string;
} {
  const match = effectText.match(/^\s*if\s+(.+?),\s*(.+)/i);
  if (match) {
    return { interveningIf: match[1].trim(), effect: match[2].trim() };
  }
  return { effect: effectText.trim() };
}

export function parseTriggeredAbilities(
  oracleText: string,
): ParsedTriggeredAbility[] {
  const abilities: ParsedTriggeredAbility[] = [];

  // Split by periods and newlines
  const sentences = oracleText.split(/\.\s*/);

  for (let i = 0; i < sentences.length; i++) {
    let sentence = sentences[i];
    if (!sentence.trim()) continue;

    // CR 608.2c: a follow-on "Then ..." sentence is part of the same
    // ability's effect (Shoreline Looter: "draw a card. Then discard a card
    // unless ..."), so fold it back in rather than dropping it (issue #2428).
    while (
      i + 1 < sentences.length &&
      /^then\b/i.test(sentences[i + 1].trim())
    ) {
      sentence = `${sentence}. ${sentences[i + 1].trim()}`;
      i++;
    }

    // Look for triggered ability keywords
    // The trigger text is everything between "when/whenever" and the comma before the effect
    const whenMatch = sentence.match(/\b(when|whenever)\s+(.+?),?\s*,\s*(.+)/i);
    const atMatch = sentence.match(/\bat\s+(?:the\s+)?(.+?),?\s*,\s*(.+)/i);

    if (whenMatch) {
      const [, , rawTriggerText, rawEffect] = whenMatch;
      // Peel "while <condition>" off the trigger text (ferocious, issue #2300).
      const whileMatch = rawTriggerText.match(/^(.+?)\s+while\s+(.+)$/i);
      const triggerText = whileMatch ? whileMatch[1] : rawTriggerText;
      const whileCondition = whileMatch ? whileMatch[2].trim() : undefined;
      const trigger = parseTriggerText(triggerText);

      if (trigger) {
        // CR 603.4: peel a leading "if <condition>," off the effect so it can be
        // gated at trigger time and re-checked at resolution.
        const { interveningIf, effect: effectText } =
          extractInterveningIfClause(rawEffect);
        const effect = parseEffect(effectText);
        abilities.push({
          type: AbilityType.TRIGGERED,
          trigger,
          effect: effectText,
          effectType: effect?.effectType || "generic",
          targets: effect?.targets || [],
          value: effect?.value,
          interveningIf,
          ...(whileCondition ? { whileCondition } : {}),
        });
      }
    } else if (atMatch) {
      const [, triggerText, rawEffect] = atMatch;
      const trigger = parseTriggerText(triggerText);

      if (trigger) {
        const { interveningIf, effect: effectText } =
          extractInterveningIfClause(rawEffect);
        const effect = parseEffect(effectText);
        abilities.push({
          type: AbilityType.TRIGGERED,
          trigger,
          effect: effectText,
          effectType: effect?.effectType || "generic",
          targets: effect?.targets || [],
          value: effect?.value,
          interveningIf,
        });
      }
    }
  }

  return abilities;
}

const ETB_PERMANENT_TYPES = [
  "creature",
  "artifact",
  "enchantment",
  "land",
  "planeswalker",
  "battle",
] as const;

/**
 * Work out whose entry an ETB trigger watches (CR 603.6a). The subject is
 * everything before "enters": "this creature" or the card's own name is the
 * permanent itself, "another"/"other" excludes it, "a"/"one or more" includes it.
 */
function parseEntersTrigger(text: string): TriggerCondition {
  const subjectText = text
    .replace(/^(?:when|whenever)\s+/, "")
    .split(/\benters?\b/)[0]
    .trim();
  let subject: "self" | "another" | "any";
  if (/\b(?:another|other)\b/.test(subjectText)) {
    subject = "another";
  } else if (/^(?:a|an|one or more|each)\b/.test(subjectText)) {
    subject = "any";
  } else {
    subject = "self";
  }
  if (subject === "self") {
    return { event: "entersBattlefield", subject };
  }
  const types = ETB_PERMANENT_TYPES.filter((type) =>
    new RegExp(`\\b${type}s?\\b`).test(subjectText),
  );
  let controller: "you" | "opponent" | undefined;
  if (/\byou control\b/.test(subjectText)) controller = "you";
  else if (/\b(?:an opponent|your opponents) controls?\b/.test(subjectText))
    controller = "opponent";
  return {
    event: "entersBattlefield",
    subject,
    enteringFilter: {
      types: [...types],
      controller,
      nontoken: /\bnontoken\b/.test(subjectText) || undefined,
    },
  };
}

/**
 * Parse trigger text to extract trigger condition
 */
function parseTriggerText(triggerText: string): TriggerCondition | null {
  const text = triggerText.toLowerCase();

  // Landfall (CR 207.2c ability word): "Whenever a land you control enters"
  // (current Oracle wording) or "Whenever a land enters the battlefield
  // under your control" (older wording). Checked before the generic
  // enters-the-battlefield case so it only fires for your lands.
  if (
    /^landfall\b/.test(text) ||
    /^(?:whenever\s+)?a land (?:you control )?enters\b/.test(text)
  ) {
    return { event: "landfall" };
  }

  // Enters the battlefield. Current Oracle wording drops "the battlefield"
  // ("When this creature enters"); older wording keeps it.
  if (/\benters?(?:\s+the\s+battlefield)?\b/.test(text)) {
    return parseEntersTrigger(text);
  }

  // Leaves the battlefield
  if (text.includes("leaves the battlefield")) {
    return { event: "leavesBattlefield" };
  }

  // Dies
  if (text.includes("dies")) {
    return { event: "dies" };
  }

  // Deals damage
  if (text.includes("deals damage")) {
    return { event: "damageDealt" };
  }

  // Attacks (covers "attacks", "you attack", "a creature attacks")
  if (text.includes("attack")) {
    return { event: "attacked" };
  }

  // Becomes blocked
  if (text.includes("becomes blocked")) {
    return { event: "blocked" };
  }

  // Spell cast triggers - "you cast a spell" returns spellCast event
  if (
    text.includes("you cast a spell") ||
    text.includes("you cast any spell")
  ) {
    return { event: "spellCast" };
  }

  // Spell cast triggers - specific patterns that return spellCast
  if (text.includes("a spell is cast") || text.includes("spell is cast")) {
    return { event: "spellCast" };
  }

  // Cast triggers - "you cast" followed by something other than "a spell"
  if (text.includes("you cast")) {
    return { event: "cast" };
  }

  // Is cast / is played / cast a spell (generic cast)
  if (text.includes("cast") || text.includes("is played")) {
    return { event: "cast" };
  }

  // End of turn
  if (text.includes("end of turn")) {
    return { event: "turnEnds" };
  }

  // Untap step — "At the beginning of your untap step" (CR 502.3)
  if (text.includes("untap step") || text.includes("beginning of your untap")) {
    return { event: "untapStep" };
  }

  // Upkeep
  if (text.includes("upkeep")) {
    return { event: "upkeep" };
  }

  // Draw step
  if (text.includes("beginning of your draw step")) {
    return { event: "drawStep" };
  }

  // Beginning of upkeep
  if (
    text.includes("beginning of your upkeep") ||
    text.includes("at the beginning of your upkeep")
  ) {
    return { event: "upkeep" };
  }

  // Beginning of end step - maps to phaseEnds (end step is part of the end
  // phase). Covers "the/your/each/next end step" phrasings, including the
  // CR 603.4 delayed-trigger wording "at the beginning of the next end step".
  // These must come BEFORE the generic "end of turn" checks
  if (/beginning of (?:the next|next|the|your|each) end step/.test(text)) {
    return { event: "phaseEnds" };
  }

  // End of turn triggers - check these BEFORE "phase ends" since "end of the turn" contains "phase ends"
  if (
    text.includes("at the end of the turn") ||
    text.includes("end of the turn")
  ) {
    return { event: "turnEnds" };
  }

  // Phase ends - generic phase end trigger - must check AFTER "end of turn" checks
  if (text.includes("phase ends")) {
    return { event: "phaseEnds" };
  }

  // End of turn triggers
  if (
    text.includes("at the end of the turn") ||
    text.includes("end of the turn") ||
    text.includes("beginning of the turn") ||
    text.includes("at the beginning of the turn")
  ) {
    return { event: "turnEnds" };
  }

  // Phase ends - generic phase end trigger
  if (text.includes("phase ends")) {
    return { event: "phaseEnds" };
  }

  // "Whenever this creature deals combat damage to a player" (issue #2428).
  // Only the self form is recognised here; "a creature you control" /
  // "equipped creature" subjects keep falling through to the generic case.
  const combatToPlayer = text.match(
    /^(.*?)\s*deals combat damage to (?:a|an) (?:player|opponent)\b/,
  );
  if (
    combatToPlayer &&
    !/^(?:a|an|one or more|another|each|equipped|enchanted|target)\b/.test(
      combatToPlayer[1].trim(),
    )
  ) {
    return { event: "dealsCombatDamageToPlayer", subject: "self" };
  }

  // Combat damage step ends
  if (text.includes("combat damage")) {
    return { event: "combatDamageStepEnds" };
  }

  // Counter added
  if (
    text.includes("counter") &&
    (text.includes("put") || text.includes("placed"))
  ) {
    return { event: "counterAdded" };
  }

  // Life gain (covers "gain life", "gains life", "you gain life")
  if (text.includes("gain life") || text.includes("gains life")) {
    return { event: "lifeGain" };
  }

  // Life lost
  if (text.includes("lose life") || text.includes("loses life")) {
    return { event: "lifeLost" };
  }

  // Spell cast
  if (text.includes("a spell is cast") || text.includes("spell cast")) {
    return { event: "spellCast" };
  }

  // Ability activated
  if (
    text.includes("activated an ability") ||
    text.includes("ability is activated")
  ) {
    return { event: "abilityActivated" };
  }

  // Card put into graveyard
  if (
    text.includes("put into a graveyard") ||
    text.includes("is put into a graveyard")
  ) {
    return { event: "dies" };
  }

  // Exploit - when a creature exploits another creature (modern MTG mechanic)
  if (text.includes("exploits a creature")) {
    return { event: "exploit" };
  }

  // Disturb - cast from graveyard transformed (modern MTG MDFC mechanic)
  if (text.includes("you may cast this card from your graveyard")) {
    return { event: "disturb" };
  }

  // Daybound/Nightbound - transform during day/night (modern MTG transform mechanic)
  if (text.includes("daybound") || text.includes("nightbound")) {
    return { event: "transform" };
  }

  // If we can't classify the trigger condition, return an "unknown" event.
  // Per CR 603.2 a triggered ability may only fire when its trigger condition
  // is actually met, so an unrecognised condition must NOT be assumed to be an
  // "enters the battlefield" trigger (issue #1157). Otherwise non-ETB triggers
  // (e.g. "Whenever CARDNAME deals combat damage to a player") that the parser
  // fails to classify would fire spuriously when the creature's spell resolves,
  // pushing a never-resolving object onto the stack and stalling the game.
  // "unknown" matches no detection switch case, so such abilities simply never
  // fire until a precise classification is added.
  return { event: "unknown" };
}

/**
 * Parse static abilities from Oracle text
 */
export function parseStaticAbilities(
  oracleText: string,
  typeLine: string,
): ParsedStaticAbility[] {
  const abilities: ParsedStaticAbility[] = [];
  const combinedText = `${typeLine} ${oracleText}`.toLowerCase();

  // Static abilities that provide keywords
  const keywordStatics = [
    "flying",
    "first strike",
    "double strike",
    "deathtouch",
    "defender",
    "hexproof",
    "indestructible",
    "lifelink",
    "menace",
    "reach",
    "trample",
    "vigilance",
    "haste",
    "flash",
    "protection",
  ];

  for (const keyword of keywordStatics) {
    if (combinedText.includes(keyword)) {
      abilities.push({
        type: AbilityType.STATIC,
        ability: "keyword",
        keywordType: keyword,
      });
    }
  }

  // Look for static effects like "Creatures you control get +1/+1"
  const staticPatterns = [
    // Static buffs
    { pattern: /(.+?)\s+get\s+\+(\d+)\/\+(\d+)/gi, effect: "buff" },
    { pattern: /(.+?)\s+gets?\s+\+(\d+)\/\+(\d+)/gi, effect: "buff" },
    // Static debuffs
    { pattern: /(.+?)\s+get\s+-\d+\/-\d+/gi, effect: "debuff" },
    // Additional keywords
    { pattern: /(.+?)\s+have\s+(.+?)(?:\.|,|$)/gi, effect: "keyword" },
  ];

  for (const { pattern } of staticPatterns) {
    let match;
    while ((match = pattern.exec(combinedText)) !== null) {
      abilities.push({
        type: AbilityType.STATIC,
        ability: "staticEffect",
        effect: match[0],
      });
    }
  }

  return abilities;
}

/**
 * Check if a card is a spell or ability that can go on the stack
 */
export function canGoOnStack(card: ScryfallCard): boolean {
  // Instants and sorceries always go on the stack
  const typeLine = card.type_line?.toLowerCase() || "";
  if (typeLine.includes("instant") || typeLine.includes("sorcery")) {
    return true;
  }

  // Cards with abilities that can be activated go on the stack
  if (card.oracle_text) {
    const hasActivatedAbility = card.oracle_text.includes(":");
    if (hasActivatedAbility) {
      return true;
    }
  }

  return false;
}
