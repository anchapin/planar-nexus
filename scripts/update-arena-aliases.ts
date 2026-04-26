#!/usr/bin/env tsx

/**
 * Fetch Arena-to-paper name aliases from Scryfall's Omenpaths sets.
 *
 * Wizards renames Universes Beyond cards for MTG Arena when they don't have
 * digital IP rights. Scryfall stores these renames in the `printed_name`
 * field (Arena name) while `name` contains the paper name.
 *
 * This script queries Scryfall for all cards in Omenpaths sets (OM1, etc.)
 * where printed_name differs from name, and generates the TypeScript alias map.
 *
 * Usage:
 *   npx tsx scripts/update-arena-aliases.ts
 *
 * Then copy the output into src/lib/decklist-utils.ts and scripts/verify-deck-in-db.ts
 */

interface ScryfallCard {
  name: string;
  printed_name?: string;
  collector_number: string;
  set: string;
}

interface ScryfallSearchResponse {
  object: string;
  total_cards: number;
  has_more: boolean;
  data: ScryfallCard[];
}

const OMENPATHS_SETS = ["om1"];

async function fetchSetRenames(
  setCode: string,
): Promise<{ arena: string; paper: string }[]> {
  const renames: { arena: string; paper: string }[] = [];
  let hasMore = true;
  let page = 1;

  while (hasMore && page <= 20) {
    const url = `https://api.scryfall.com/cards/search?q=e%3A${setCode}&unique=prints&format=json&page=${page}`;
    console.error(`Fetching ${setCode} page ${page}...`);

    const resp = await fetch(url);
    const data: ScryfallSearchResponse = await resp.json();

    if (data.object === "error") {
      console.error(`Error fetching ${setCode}:`, (data as any).details);
      break;
    }

    for (const card of data.data || []) {
      if (card.printed_name && card.printed_name !== card.name) {
        renames.push({ arena: card.printed_name, paper: card.name });
      }
    }

    hasMore = data.has_more;
    page++;

    // Rate limit: Scryfall asks for ~100ms between requests
    if (hasMore) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  return renames;
}

function escapeString(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function generateAliasMap(renames: { arena: string; paper: string }[]): string {
  // Sort alphabetically by arena name for consistency
  renames.sort((a, b) => a.arena.localeCompare(b.arena));

  const lines: string[] = [];
  lines.push("/**");
  lines.push(" * Arena-to-paper name aliases from Through the Omenpaths (OM1)");
  lines.push(" * Generated from Scryfall API");
  lines.push(
    " * When Wizards does not have digital rights for Universes Beyond cards,",
  );
  lines.push(" * they rename them for Arena using Omenpaths flavor.");
  lines.push(
    " * Scryfall stores the Arena name in printed_name and the paper name in name.",
  );
  lines.push(" */");
  lines.push("const ARENA_NAME_ALIASES: Record<string, string> = {");

  for (const r of renames) {
    const arena = escapeString(r.arena);
    const paper = escapeString(r.paper);
    lines.push(`  '${arena}': '${paper}',`);
  }

  lines.push("};");
  return lines.join("\n");
}

async function main() {
  console.error("🔍 Fetching Arena name aliases from Scryfall...\n");

  const allRenames: { arena: string; paper: string }[] = [];

  for (const setCode of OMENPATHS_SETS) {
    const renames = await fetchSetRenames(setCode);
    console.error(
      `Found ${renames.length} renames in ${setCode.toUpperCase()}`,
    );
    allRenames.push(...renames);
  }

  console.error(`\n✅ Total aliases: ${allRenames.length}\n`);

  const output = generateAliasMap(allRenames);
  console.log(output);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
