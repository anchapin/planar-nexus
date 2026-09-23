import type { ScryfallCard } from "../types";
import { parseOracleText } from "../oracle-text-parser";
import type {
  ParsedActivatedAbility,
  ParsedTriggeredAbility,
} from "../oracle-text-parser";

export function hasActivatedAbilities(card: { oracle_text?: string }): boolean {
  if (!card.oracle_text) return false;
  return card.oracle_text.includes(":");
}

export function getActivatedAbilities(
  card: ScryfallCard,
): ParsedActivatedAbility[] {
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
  if (!card.oracle_text) return [];
  return parseOracleText(card).triggeredAbilities;
}
