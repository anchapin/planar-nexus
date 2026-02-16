/**
 * Oracle Text Parser
 * 
 * Parses Magic: The Gathering Oracle text into structured game mechanics.
 * Reference: CR 112 - Card Types, CR 113 - Abilities, CR 608 - Handling Spells and Abilities
 * 
 * This parser handles:
 * - Activated abilities (cost: effect format)
 * - Triggered abilities (when/whenever/at)
 * - Static abilities
 * - Keyword extraction from text
 * - Reminder text exclusion
 */

import type { ScryfallCard } from "@/app/actions";

/**
 * Types of abilities that can be parsed
 */
export enum AbilityType {
  ACTIVATED = "activated",
  TRIGGERED = "triggered",
  STATIC = "static",
  SPELL = "spell",
  FLASHBACK = "flashback",
  SPLIT = "split",
}

/**
 * Mana cost parsed from text
 */
export interface ParsedManaCost {
  generic: number;
  colorless: number;
  white: number;
  blue: number;
  black: number;
  red: number;
  green: number;
  X: number | null;
  snow: number;
}

/**
 * Target specification parsed from text
 */
export interface ParsedTarget {
  type: "creature" | "player" | "permanent" | "planeswalker" | "artifact" | "enchantment" | "land" | "any" | "self";
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
  effectType: "damage" | "destroy" | "exile" | "draw" | "createToken" | "counter" | "gainLife" | "loseLife" | "tap" | "untap" | "buff" | "debuff" | "addCounter" | "removeCounter" | "gainControl" | "search" | "putIntoPlay" | "return" | "transform" | "generic";
  targets: ParsedTarget[];
  value?: number;
  duration?: "untilEndOfTurn" | "untilEndOfGame" | "permanent";
}

/**
 * Trigger condition for triggered abilities
 */
export interface TriggerCondition {
  event: "entersBattlefield" | "leavesBattlefield" | "damageDealt" | "dies" | "attacked" | "blocked" | "cast" | "turnEnds" | "phaseEnds" | "upkeep" | "drawStep" | "combatDamageStepEnds" | "counterAdded" | "counterRemoved" | "lifeGain" | "lifeLost" | "spellCast" | "abilityActivated";
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
}

/**
 * Static ability parsed from text
 */
export interface ParsedStaticAbility {
  type: AbilityType.STATIC;
  ability: "keyword" | "staticEffect";
  keywordType?: string;
  effect?: string;
  affects?: "opponents" | "creatures" | "you" | "all" | "controlled" | "enchanted" | "equipped";
}

/**
 * Keyword ability with its type
 */
export interface ParsedKeyword {
  keyword: string;
  type: "evergreen" | "mechanic" | "abilityWord";
  subType?: string;
  parameters?: Record<string, string | number>;
}

/**
 * Complete parsed ability
 */
export type ParsedAbility = 
  | ParsedActivatedAbility 
  | ParsedTriggeredAbility 
  | ParsedStaticAbility;

/**
 * Result of parsing Oracle text
 */
export interface ParsedOracleText {
  /** Original Oracle text */
  originalText: string;
  /** Reminder text (in parentheses) */
  reminderText: string | null;
  /** All keywords found */
  keywords: ParsedKeyword[];
  /** Activated abilities */
  activatedAbilities: ParsedActivatedAbility[];
  /** Triggered abilities */
  triggeredAbilities: ParsedTriggeredAbility[];
  /** Static abilities */
  staticAbilities: ParsedStaticAbility[];
  /** Mana cost (for spells) */
  manaCost: ParsedManaCost | null;
  /** Power/toughness (for creatures) */
  powerToughness?: { power: number; toughness: number; isVariable: boolean };
  /** Loyalty (for planeswalkers) */
  loyalty?: number;
  /** Color indicator */
  colorIndicator?: string[];
}

/**
 * Parse a Scryfall card's Oracle text
 */
export function parseOracleText(card: ScryfallCard): ParsedOracleText {
  const oracleText = card.oracle_text || "";
  const typeLine = card.type_line || "";
  
  // Remove reminder text (text in parentheses)
  const { mainText, reminderText } = extractReminderText(oracleText);
  
  // Parse mana cost
  const manaCost = parseManaCost(card.mana_cost || "");
  
  // Parse power/toughness from type line
  const powerToughness = parsePowerToughness(typeLine);
  
  // Parse loyalty from type line
  const loyalty = parseLoyalty(typeLine);
  
  // Extract keywords
  const keywords = extractKeywords(mainText, typeLine);
  
  // Parse abilities
  const activatedAbilities = parseActivatedAbilities(mainText, typeLine);
  const triggeredAbilities = parseTriggeredAbilities(mainText);
  const staticAbilities = parseStaticAbilities(mainText, typeLine);
  
  return {
    originalText: oracleText,
    reminderText,
    keywords,
    activatedAbilities,
    triggeredAbilities,
    staticAbilities,
    manaCost,
    powerToughness,
    loyalty,
  };
}

/**
 * Extract reminder text from Oracle text
 */
function extractReminderText(text: string): { mainText: string; reminderText: string | null } {
  const reminderMatch = text.match(/\(([^)]+)\)/g);
  
  if (!reminderMatch) {
    return { mainText: text, reminderText: null };
  }
  
  // Combine all reminder text
  const reminderText = reminderMatch
    .map(m => m.slice(1, -1)) // Remove parentheses
    .join(" ");
  
  // Remove reminder text from main text
  const mainText = text.replace(/\s*\([^)]+\)\s*/g, " ").trim();
  
  return { mainText, reminderText };
}

/**
 * Parse mana cost string into structured format
 */
export function parseManaCost(costString: string): ParsedManaCost | null {
  if (!costString || costString === "") {
    return null;
  }
  
  const cost: ParsedManaCost = {
    generic: 0,
    colorless: 0,
    white: 0,
    blue: 0,
    black: 0,
    red: 0,
    green: 0,
    X: null,
    snow: 0,
  };
  
  // Match mana symbols
  const manaMatches = costString.match(/{[^}]+}/g) || [];
  
  for (const match of manaMatches) {
    const symbol = match.slice(1, -1); // Remove { and }
    
    // Handle generic mana
    if (/^\d+$/.test(symbol)) {
      cost.generic += parseInt(symbol, 10);
      continue;
    }
    
    // Handle X
    if (symbol === "X" || symbol === "x") {
      cost.X = 0;
      continue;
    }
    
    // Handle colorless
    if (symbol === "C") {
      cost.colorless += 1;
      continue;
    }
    
    // Handle colored mana
    switch (symbol) {
      case "W":
        cost.white += 1;
        break;
      case "U":
        cost.blue += 1;
        break;
      case "B":
        cost.black += 1;
        break;
      case "R":
        cost.red += 1;
        break;
      case "G":
        cost.green += 1;
        break;
      case "W/U":
      case "U/B":
      case "B/R":
      case "R/G":
      case "G/W":
      case "U/W":
      case "B/U":
      case "R/B":
      case "G/R":
      case "W/G":
        // Hybrid mana - add to both colors
        const colors = symbol.split("/");
        for (const color of colors) {
          switch (color) {
            case "W": cost.white += 0.5; break;
            case "U": cost.blue += 0.5; break;
            case "B": cost.black += 0.5; break;
            case "R": cost.red += 0.5; break;
            case "G": cost.green += 0.5; break;
          }
        }
        break;
      case "2/W":
      case "2/U":
      case "2/B":
      case "2/R":
      case "2/G":
        cost.generic += 2;
        break;
      case "S":
        cost.snow += 1;
        break;
      case "P":
        // Phyrexian mana - add generic cost
        cost.generic += 1;
        break;
    }
  }
  
  // If no mana symbols found, return null
  if (cost.generic === 0 && cost.colorless === 0 && cost.white === 0 && 
      cost.blue === 0 && cost.black === 0 && cost.red === 0 && 
      cost.green === 0 && cost.X === null && cost.snow === 0) {
    return null;
  }
  
  return cost;
}

/**
 * Parse power/toughness from type line
 */
function parsePowerToughness(typeLine: string): { power: number; toughness: number; isVariable: boolean } | undefined {
  const ptMatch = typeLine.match(/(\d+)\/(\d+)/);
  
  if (!ptMatch) {
    // Check for variable power/toughness like "*/*" or "X/X"
    const variableMatch = typeLine.match(/\*\/(\d+)|(\d+)\/\*/);
    if (variableMatch) {
      const isPowerStar = typeLine.indexOf("*") === typeLine.indexOf("/") - 1;
      return {
        power: isPowerStar ? 0 : parseInt(variableMatch[1] || variableMatch[2], 10),
        toughness: isPowerStar ? parseInt(variableMatch[1] || variableMatch[2], 10) : 0,
        isVariable: true,
      };
    }
    return undefined;
  }
  
  return {
    power: parseInt(ptMatch[1], 10),
    toughness: parseInt(ptMatch[2], 10),
    isVariable: false,
  };
}

/**
 * Parse loyalty from type line
 */
function parseLoyalty(typeLine: string): number | undefined {
  const loyaltyMatch = typeLine.match(/\[(\d+)\]/);
  
  if (loyaltyMatch) {
    return parseInt(loyaltyMatch[1], 10);
  }
  
  return undefined;
}

/**
 * Extract keywords from Oracle text and type line
 */
export function extractKeywords(oracleText: string, typeLine: string): ParsedKeyword[] {
  const keywords: ParsedKeyword[] = [];
  const combinedText = `${typeLine} ${oracleText}`.toLowerCase();
  
  // Evergreen keywords (CR 702)
  const evergreenKeywords = [
    "flying",
    "first strike",
    "double strike",
    "deathtouch",
    "defender",
    "enchant",
    "equip",
    "flash",
    "flying",
    "haste",
    "hexproof",
    "indestructible",
    "lifeline",
    "lifelink",
    "menace",
    "reach",
    "trample",
    "vigilance",
    "banding",
    "protection",
    "shadow",
    " phasing",
    "flanking",
    "fear",
    "intimidate",
    "landwalk",
    "lure",
    "provoke",
    "rampage",
    "reacher",
    "suffix",
    "swipe",
    "wither",
    "bestow",
    "crew",
    "crewmate",
    "fabricate",
    "fight",
    "fusillade",
    "hexproof from",
    "improvise",
    "infect",
    "mentor",
    "miracle",
    "morph",
    "mutate",
    "ninjutsu",
    "outlast",
    "overload",
    "prowess",
    "raid",
    "renown",
    "revolt",
    "splice",
    "storm",
    "support",
    "surge",
    "surveil",
    "transform",
    "tribute",
    "undaunted",
  ];
  
  for (const keyword of evergreenKeywords) {
    if (combinedText.includes(keyword)) {
      keywords.push({
        keyword,
        type: "evergreen",
      });
    }
  }
  
  // Check for ability words (italicized keywords that don't have rules meaning)
  const abilityWords = [
    "landfall",
    "raid",
    "revolt",
    "metalcraft",
    "converge",
    "cohort",
    "join forces",
    "parley",
    "will of the council",
    "assemble",
    "battle cry",
    "bloodrush",
    "channel",
    "chroma",
    "domain",
    "eked",
    "fateful hour",
    "ferocious",
    "grandeur",
    "hellbent",
    "heroic",
    "inspired",
    "join forces",
    "kinfall",
    "landfall",
    "lieutenant",
    "might of the nations",
    "miracle",
    "morbid",
    "pack tactics",
    "radiance",
    "raid",
    "rally",
    "revolt",
    "shield",
    "soulbond",
    "strength in numbers",
    "tempting offer",
    "threshold",
    "underdog",
    "undergrowth",
  ];
  
  for (const word of abilityWords) {
    if (combinedText.includes(word)) {
      keywords.push({
        keyword: word,
        type: "abilityWord",
      });
    }
  }
  
  // Remove duplicates
  const uniqueKeywords = keywords.filter((item, index, self) => 
    index === self.findIndex((t) => t.keyword === item.keyword)
  );
  
  return uniqueKeywords;
}

/**
 * Parse activated abilities from Oracle text
 * 
 * Activated abilities follow the format: [cost]: [effect]
 */
export function parseActivatedAbilities(oracleText: string, typeLine: string): ParsedActivatedAbility[] {
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
      ...effect,
    });
  }
  
  return abilities;
}

/**
 * Parse ability cost string
 */
function parseAbilityCost(costString: string): ParsedActivatedAbility["costs"] | null {
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
  
  // Check for additional costs like "sacrifice a creature"
  if (costLower.includes("sacrifice") && !costs.sacrifice) {
    costs.additionalCosts.push("sacrifice");
  }
  
  // If no costs parsed, it's not a valid activated ability
  if (!costs.tap && !costs.sacrifice && !costs.mana && 
      costs.payLife === 0 && costs.additionalCosts.length === 0) {
    return null;
  }
  
  return costs;
}

/**
 * Parse effect string to determine effect type
 */
function parseEffect(effectString: string): { effectType: string; targets: ParsedTarget[]; value?: number } | null {
  const effect = effectString.toLowerCase();
  const targets: ParsedTarget[] = [];
  let value: number | undefined;
  
  // Extract numerical values
  const numberMatch = effect.match(/(\d+)/);
  if (numberMatch) {
    value = parseInt(numberMatch[1], 10);
  }
  
  // Determine effect type based on keywords
  if (effect.includes("deal ") && effect.includes(" damage")) {
    return { effectType: "damage" as const, targets, value };
  }
  
  if (effect.includes("destroy")) {
    return { effectType: "destroy" as const, targets: [{ type: "creature", restrictions: [], isOptional: false }], value };
  }
  
  if (effect.includes("exile")) {
    return { effectType: "exile" as const, targets, value };
  }
  
  if (effect.includes("draw ") && (effect.includes("card") || effect.includes("cards"))) {
    return { effectType: "draw" as const, targets: [{ type: "player", restrictions: [], isOptional: false }], value };
  }
  
  if (effect.includes("create ") && effect.includes("token")) {
    return { effectType: "createToken" as const, targets, value };
  }
  
  if (effect.includes("counter") && (effect.includes("spell") || effect.includes("ability"))) {
    return { effectType: "counter" as const, targets, value };
  }
  
  if (effect.includes("gain ") && effect.includes("life")) {
    return { effectType: "gainLife" as const, targets: [{ type: "player", restrictions: [], isOptional: false }], value };
  }
  
  if (effect.includes("lose ") && effect.includes("life")) {
    return { effectType: "loseLife" as const, targets: [{ type: "player", restrictions: [], isOptional: false }], value };
  }
  
  if (effect.includes("tap ") || effect.includes("untap ")) {
    return { effectType: (effect.includes("tap ") ? "tap" : "untap") as const, targets, value };
  }
  
  if (effect.includes("+1/+1") || effect.includes("-1/-1")) {
    return { effectType: "addCounter" as const, targets, value };
  }
  
  if (effect.includes("return ") && effect.includes(" to hand")) {
    return { effectType: "return" as const, targets, value };
  }
  
  if (effect.includes("search ") && effect.includes(" library")) {
    return { effectType: "search" as const, targets: [{ type: "player", restrictions: [], isOptional: false }], value };
  }
  
  if (effect.includes("put ") && effect.includes(" into play")) {
    return { effectType: "putIntoPlay" as const, targets, value };
  }
  
  if (effect.includes("gain control")) {
    return { effectType: "gainControl" as const, targets: [{ type: "permanent", restrictions: [], isOptional: false }], value };
  }
  
  // Generic effect if we can't determine type
  return { effectType: "generic" as const, targets, value };
}

/**
 * Parse triggered abilities from Oracle text
 * 
 * Triggered abilities use "when", "whenever", or "at"
 */
export function parseTriggeredAbilities(oracleText: string): ParsedTriggeredAbility[] {
  const abilities: ParsedTriggeredAbility[] = [];
  
  // Common triggered ability patterns
  const triggerPatterns = [
    // "When X..."
    { pattern: /\bwhen\s+([^,]+),?\s*(.+)/gi, triggerEvent: "entersBattlefield" },
    // "Whenever X..."
    { pattern: /\bwhenever\s+([^,]+),?\s*(.+)/gi, triggerEvent: "entersBattlefield" },
    // "At the beginning of..."
    { pattern: /\bat\s+the\s+beginning\s+of\s+([^,]+),?\s*(.+)/gi, triggerEvent: "phaseEnds" },
    // "At the end of..."
    { pattern: /\bat\s+the\s+end\s+of\s+([^,]+),?\s*(.+)/gi, triggerEvent: "phaseEnds" },
  ];
  
  // Split by periods and newlines
  const sentences = oracleText.split(/\.\s*/);
  
  for (const sentence of sentences) {
    // Look for triggered ability keywords
    const whenMatch = sentence.match(/\b(when|whenever)\s+(.+?),?\s+(.+)/i);
    const atMatch = sentence.match(/\bat\s+(?:the\s+)?(.+?),?\s+(.+)/i);
    
    if (whenMatch) {
      const [, , triggerText, effectText] = whenMatch;
      const trigger = parseTriggerText(triggerText);
      
      if (trigger) {
        const effect = parseEffect(effectText);
        abilities.push({
          type: AbilityType.TRIGGERED,
          trigger,
          effect: effectText,
          effectType: effect?.effectType || "generic",
          targets: effect?.targets || [],
          value: effect?.value,
        });
      }
    } else if (atMatch) {
      const [, triggerText, effectText] = atMatch;
      const trigger = parseTriggerText(triggerText);
      
      if (trigger) {
        const effect = parseEffect(effectText);
        abilities.push({
          type: AbilityType.TRIGGERED,
          trigger,
          effect: effectText,
          effectType: effect?.effectType || "generic",
          targets: effect?.targets || [],
          value: effect?.value,
        });
      }
    }
  }
  
  return abilities;
}

/**
 * Parse trigger text to extract trigger condition
 */
function parseTriggerText(triggerText: string): TriggerCondition | null {
  const text = triggerText.toLowerCase();
  
  // Enter the battlefield
  if (text.includes("enters the battlefield") || text.includes("enter the battlefield")) {
    return { event: "entersBattlefield" };
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
  
  // Attacks
  if (text.includes("attacks")) {
    return { event: "attacked" };
  }
  
  // Becomes blocked
  if (text.includes("becomes blocked")) {
    return { event: "blocked" };
  }
  
  // Is cast / is spell
  if (text.includes("is cast") || text.includes("is played")) {
    return { event: "cast" };
  }
  
  // End of turn
  if (text.includes("end of turn")) {
    return { event: "turnEnds" };
  }
  
  // Upkeep
  if (text.includes("upkeep")) {
    return { event: "upkeep" };
  }
  
  // Draw step
  if (text.includes("beginning of your draw step")) {
    return { event: "drawStep" };
  }
  
  // Combat damage step ends
  if (text.includes("combat damage")) {
    return { event: "combatDamageStepEnds" };
  }
  
  // Counter added
  if (text.includes("counter") && (text.includes("put") || text.includes("placed"))) {
    return { event: "counterAdded" };
  }
  
  // Life gain
  if (text.includes("gain life")) {
    return { event: "lifeGain" };
  }
  
  // If we can't determine the trigger, return a generic one
  return { event: "entersBattlefield" };
}

/**
 * Parse static abilities from Oracle text
 */
export function parseStaticAbilities(oracleText: string, typeLine: string): ParsedStaticAbility[] {
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

/**
 * Get all abilities from a card
 */
export function getCardAbilities(card: ScryfallCard): ParsedOracleText {
  return parseOracleText(card);
}

/**
 * Format a mana cost for display
 */
export function formatManaCost(cost: ParsedManaCost | null): string {
  if (!cost) return "";
  
  let result = "";
  
  if (cost.X !== null) {
    result += "{X}";
  }
  
  if (cost.generic > 0) {
    result += `{${cost.generic}}`;
  }
  
  for (let i = 0; i < cost.white; i++) result += "{W}";
  for (let i = 0; i < cost.blue; i++) result += "{U}";
  for (let i = 0; i < cost.black; i++) result += "{B}";
  for (let i = 0; i < cost.red; i++) result += "{R}";
  for (let i = 0; i < cost.green; i++) result += "{G}";
  for (let i = 0; i < cost.colorless; i++) result += "{C}";
  for (let i = 0; i < cost.snow; i++) result += "{S}";
  
  return result;
}

/**
 * Compare two mana costs for equality
 */
export function manaCostsEqual(a: ParsedManaCost | null, b: ParsedManaCost | null): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  
  return (
    a.generic === b.generic &&
    a.colorless === b.colorless &&
    a.white === b.white &&
    a.blue === b.blue &&
    a.black === b.black &&
    a.red === b.red &&
    a.green === b.green &&
    a.X === b.X &&
    a.snow === b.snow
  );
}

/**
 * Get the total mana value of a cost
 */
export function getManaValue(cost: ParsedManaCost | null): number {
  if (!cost) return 0;
  
  let total = cost.generic;
  
  // Colored mana counts as 1 each
  total += Math.ceil(cost.white);
  total += Math.ceil(cost.blue);
  total += Math.ceil(cost.black);
  total += Math.ceil(cost.red);
  total += Math.ceil(cost.green);
  
  // X adds nothing to mana value until resolved
  // Snow is generic
  total += cost.snow;
  
  return total;
}
