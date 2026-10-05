/**
 * Card-script coverage and errata-drift helpers for the gameplay gap report
 * (#2492). Pure functions over a committed Scryfall snapshot, so the report
 * stays deterministic and runs offline. Refresh the snapshot with
 * `npx tsx scripts/refresh-card-script-oracle.ts`.
 */

/** The parts of a Scryfall card these helpers read. */
export interface ScryfallOracleCard {
  name: string;
  oracle_text?: string;
  card_faces?: { name?: string; oracle_text?: string }[];
}

/** Per scripted card: Standard legality and current oracle text. */
export interface ScriptOracleEntry {
  standard: boolean;
  /** Current Scryfall oracle text, or null when Scryfall had no match. */
  oracle: string | null;
}

export interface ScriptOracleSnapshot {
  generatedAt: string;
  standardCardCount: number;
  cards: Record<string, ScriptOracleEntry>;
}

/** A card script as the report needs it: just its name and oracle copy. */
export interface ScriptRef {
  name: string;
  oracle: string;
}

export interface DriftEntry {
  name: string;
  script: string;
  current: string;
}

export interface ScriptCoverage {
  scripts: number;
  standardCardCount: number;
  /** Scripted cards that are Standard-legal in the snapshot. */
  standardScripted: number;
  /** Scripted cards the snapshot knows but that are not Standard-legal. */
  nonStandard: string[];
  /** Scripted cards missing from the snapshot (refresh it). */
  missing: string[];
  /** Scripts whose `oracle` no longer matches Scryfall (errata drift). */
  drift: DriftEntry[];
}

/** Oracle text for a card, faces joined the way Scryfall prints them. */
export function scryfallOracle(card: ScryfallOracleCard): string {
  if (card.oracle_text !== undefined) return card.oracle_text;
  return (card.card_faces ?? []).map((f) => f.oracle_text ?? "").join("\n//\n");
}

/**
 * Normalise oracle text before comparing so formatting noise (line endings,
 * trailing spaces, curly quotes) is not reported as errata.
 */
export function normalizeOracle(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .split("\n")
    .map((line) => line.trim().replace(/\s+/g, " "))
    .join("\n")
    .trim();
}

/** Does a script's oracle copy still match the current oracle text? */
export function oracleMatches(script: string, current: string): boolean {
  return normalizeOracle(script) === normalizeOracle(current);
}

export function scriptCoverage(
  scripts: ScriptRef[],
  snapshot: ScriptOracleSnapshot,
): ScriptCoverage {
  const nonStandard: string[] = [];
  const missing: string[] = [];
  const drift: DriftEntry[] = [];
  let standardScripted = 0;

  for (const s of [...scripts].sort((a, b) => a.name.localeCompare(b.name))) {
    const entry = snapshot.cards[s.name];
    if (!entry || entry.oracle === null) {
      missing.push(s.name);
      continue;
    }
    if (entry.standard) standardScripted++;
    else nonStandard.push(s.name);
    if (!oracleMatches(s.oracle, entry.oracle)) {
      drift.push({ name: s.name, script: s.oracle, current: entry.oracle });
    }
  }

  return {
    scripts: scripts.length,
    standardCardCount: snapshot.standardCardCount,
    standardScripted,
    nonStandard,
    missing,
    drift,
  };
}
