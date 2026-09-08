/**
 * Modal and split-card parsing: modes, fuse, split halves, per-mode target requirements.
 *
 * Mechanically extracted from oracle-text-parser.ts (issue #1725);
 * behavior pinned by the existing engine suites.
 */
import type { ScryfallCard } from '../types';

/**
 * Check if a card is a modal spell (has "Choose one" / "Choose two" etc.)
 * CR 700.2: Modal spells have multiple modes
 */
export function isModalSpell(card: ScryfallCard): boolean {
  const oracleText = card.oracle_text || "";
  return parseModes(oracleText) !== null;
}

/**
 * Check if a card is a split card
 * CR 702.78: Split cards have two halves
 */
export function isSplitCard(card: ScryfallCard): boolean {
  return card.layout === "split";
}

/**
 * Check if a split card has the Fuse ability
 * CR 702.78: Fuse lets you cast both halves simultaneously
 */
export function hasFuse(card: ScryfallCard): boolean {
  if (!isSplitCard(card)) return false;
  const oracleText = card.oracle_text || "";
  return oracleText.toLowerCase().includes("fuse");
}

/**
 * Get the target types required for each mode of a modal spell
 * Used to validate targets based on selected mode
 */
export interface ModeTargetInfo {
  modeIndex: number;
  targetTypes: (
    "creature" | "player" | "planeswalker" | "artifact" | "enchantment" | "any"
  )[];
  description: string;
}

/**
 * Parse target requirements from a mode's text
 * Looks for patterns like "target creature", "target player", etc.
 */
function parseTargetsFromMode(
  modeText: string,
): (
  "creature" | "player" | "planeswalker" | "artifact" | "enchantment" | "any"
)[] {
  const targets: (
    "creature" | "player" | "planeswalker" | "artifact" | "enchantment" | "any"
  )[] = [];
  const lowerText = modeText.toLowerCase();

  if (lowerText.includes("target creature")) targets.push("creature");
  if (lowerText.includes("target player")) targets.push("player");
  if (lowerText.includes("target planeswalker")) targets.push("planeswalker");
  if (lowerText.includes("target artifact")) targets.push("artifact");
  if (lowerText.includes("target enchantment")) targets.push("enchantment");
  if (lowerText.includes("any target") || lowerText.includes("target any"))
    targets.push("any");

  // Default to "any" if no specific target found but effect needs one
  if (targets.length === 0 && lowerText.includes("target")) {
    targets.push("any");
  }

  return targets;
}

/**
 * Get target information for each mode of a modal spell
 * Returns mode index, valid target types, and description
 */
export function getModesForModalSpell(
  card: ScryfallCard,
): ModeTargetInfo[] | null {
  const modes = parseModes(card.oracle_text || "");
  if (!modes) return null;

  return modes.modes.map((modeText, index) => ({
    modeIndex: index,
    targetTypes: parseTargetsFromMode(modeText),
    description: modeText,
  }));
}

/**
 * Get the two halves of a split card
 * Returns { left: leftHalfText, right: rightHalfText } or null if not a split card
 */
export function getSplitCardHalves(
  card: ScryfallCard,
): { left: string; right: string } | null {
  if (!isSplitCard(card)) return null;

  const oracleText = card.oracle_text || "";
  const halves = oracleText.split("//").map((h) => h.trim());

  if (halves.length < 2) return null;

  return {
    left: halves[0],
    right: halves[1],
  };
}

/**
 * Check if a specific mode requires targeting
 * Returns true if the mode text mentions "target"
 */
export function modeRequiresTarget(modeText: string): boolean {
  return modeText.toLowerCase().includes("target");
}

/**
 * Result of parsing modes from modal spell text
 */
export interface ParsedModes {
  modeCount: 1 | 2 | 3 | 4;
  modes: string[];
}

/**
 * Parse modes from modal spell oracle text
 * Handles patterns like:
 * - "Choose one — [Effect A] / [Effect B]"
 * - "Choose two — [Effect A] / [Effect B] / [Effect C]"
 * - "Choose three — [A] / [B] / [C] / [D]"
 * - Modes separated by newlines with bullet points (•)
 */
export function parseModes(oracleText: string): ParsedModes | null {
  if (!oracleText) return null;

  // Match em dash (—) or regular dash (-) after "choose X"
  const chooseMatch = oracleText.match(
    /choose\s+(one|two|three|four)\s*[—–-]/i,
  );
  if (!chooseMatch) return null;

  const countMap: Record<string, 1 | 2 | 3 | 4> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
  };
  const modeCount = countMap[chooseMatch[1].toLowerCase()];

  // Find the dash character and get text after it
  const dashIndex = oracleText.search(/[—–-]/i);
  const afterDash = oracleText.substring(dashIndex + 1);

  // Split by bullet points (•) first, then by slashes if needed
  // This handles both "• Mode A\n• Mode B" and "Mode A / Mode B" formats
  const rawParts = afterDash
    .split("•")
    .map((m) => m.trim())
    .filter((m) => m.length > 0);

  // If we got multiple parts from bullet split, use those
  // Otherwise fall back to slash splitting
  let modeParts: string[];
  if (rawParts.length > 1) {
    modeParts = rawParts
      .map((m) => m.replace(/^[/\s]+/, "").trim())
      .filter((m) => m.length > 0);
  } else {
    modeParts = afterDash
      .split("/")
      .map((m) => m.trim())
      .filter((m) => m.length > 0);
  }

  // Verify we have at least modeCount modes to choose from
  if (modeParts.length < modeCount) {
    return null;
  }

  return {
    modeCount,
    modes: modeParts,
  };
}

