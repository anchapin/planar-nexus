/**
 * Shared card fixtures for integration tests.
 *
 * Builds objects satisfying the `DeckCard` / `MinimalCard` shape that the
 * deck-pipeline modules (decklist-utils, game-rules, deck-analyzer) read, so
 * tests can drive real cross-module workflows without hitting Scryfall.
 */

import type { DeckCard } from "@/app/actions";

export interface CardSpec {
  name: string;
  cmc?: number;
  colors?: string[];
  color_identity?: string[];
  type_line?: string;
  oracle_text?: string;
  count?: number;
}

/** Build a single DeckCard fixture with sensible defaults. */
export function makeCard(spec: CardSpec): DeckCard {
  const {
    name,
    cmc = 0,
    colors = [],
    color_identity = colors,
    type_line = "Creature",
    oracle_text = "",
    count = 1,
  } = spec;
  return {
    id: `card-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name,
    cmc,
    colors,
    color_identity,
    type_line,
    oracle_text,
    legalities: {},
    count,
  };
}

/** Build a DeckCard[] from "Quantity Name" lines, mapping names via a lookup. */
export function buildDeckFromLines(
  lines: string[],
  lookup: (name: string) => CardSpec,
): DeckCard[] {
  return lines.map((line) => {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    if (!match) throw new Error(`Bad decklist line: ${line}`);
    const quantity = parseInt(match[1], 10);
    return makeCard({ ...lookup(match[2]), count: quantity });
  });
}
