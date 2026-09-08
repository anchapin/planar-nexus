/**
 * Core parse surface: ability type enum, top-level parseOracleText, reminder-text stripping, PT/loyalty extraction.
 *
 * Mechanically extracted from oracle-text-parser.ts (issue #1725);
 * behavior pinned by the existing engine suites.
 */
import type { ScryfallCard } from '../types';
import { ParsedActivatedAbility, ParsedStaticAbility, ParsedTriggeredAbility, parseActivatedAbilities, parseStaticAbilities, parseTriggeredAbilities } from './abilities';
import { ParsedKeyword, extractKeywords } from './keywords';
import { ParsedManaCost, parseManaCost } from './mana-cost';

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
 * Complete parsed ability
 */
export type ParsedAbility =
  ParsedActivatedAbility | ParsedTriggeredAbility | ParsedStaticAbility;

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
function extractReminderText(text: string): {
  mainText: string;
  reminderText: string | null;
} {
  const reminderMatch = text.match(/\(([^)]+)\)/g);

  if (!reminderMatch) {
    return { mainText: text, reminderText: null };
  }

  // Combine all reminder text
  const reminderText = reminderMatch
    .map((m) => m.slice(1, -1)) // Remove parentheses
    .join(" ");

  // Remove reminder text from main text
  const mainText = text.replace(/\s*\([^)]+\)\s*/g, " ").trim();

  return { mainText, reminderText };
}

/**
 * Parse power/toughness from type line
 */
function parsePowerToughness(
  typeLine: string,
): { power: number; toughness: number; isVariable: boolean } | undefined {
  const ptMatch = typeLine.match(/(\d+)\/(\d+)/);

  if (!ptMatch) {
    // Check for variable power/toughness like "*/*" or "X/X"
    const variableMatch = typeLine.match(/\*\/(\d+)|(\d+)\/\*/);
    if (variableMatch) {
      const isPowerStar = typeLine.indexOf("*") === typeLine.indexOf("/") - 1;
      return {
        power: isPowerStar
          ? 0
          : parseInt(variableMatch[1] || variableMatch[2], 10),
        toughness: isPowerStar
          ? parseInt(variableMatch[1] || variableMatch[2], 10)
          : 0,
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
 * Get all abilities from a card
 */
export function getCardAbilities(card: ScryfallCard): ParsedOracleText {
  return parseOracleText(card);
}

