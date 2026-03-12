#!/usr/bin/env tsx

/**
 * Script to fetch cards from Scryfall API for user's personal card database
 * 
 * IMPORTANT: This script is for personal use only. Users should run this themselves
 * to create their own card database. Do not distribute pre-generated card data.
 *
 * Usage:
 *   npx tsx scripts/fetch-cards-for-db.ts --format commander --limit 1000 --output ./my-cards.json
 *
 * Then import the JSON file via the app's Database Management page.
 */

import fs from 'fs';
import path from 'path';

interface ScryfallCard {
  id: string;
  oracle_id?: string;
  name: string;
  set?: string;
  collector_number?: string;
  cmc: number;
  type_line: string;
  oracle_text?: string;
  colors: string[];
  color_identity: string[];
  legalities: Record<string, string>;
  image_uris?: {
    small: string;
    normal: string;
    large: string;
    png: string;
    art_crop: string;
    border_crop: string;
  };
  mana_cost?: string;
  power?: string;
  toughness?: string;
  keywords?: string[];
  card_faces?: Array<{
    name: string;
    mana_cost?: string;
    type_line?: string;
    oracle_text?: string;
    power?: string;
    toughness?: string;
    image_uris?: {
      small: string;
      normal: string;
      large: string;
      png: string;
      art_crop: string;
      border_crop: string;
    };
  }>;
  layout?: string;
  loyalty?: string;
}

// Parse command line arguments
const args = process.argv.slice(2);
const format = args.find(arg => arg.startsWith('--format='))?.split('=')[1] || 'commander';
const limit = parseInt(args.find(arg => arg.startsWith('--limit='))?.split('=')[1] || '500', 10);
const outputFile = args.find(arg => arg.startsWith('--output='))?.split('=')[1] || './my-card-database.json';

console.log(`\n🃏 Card Database Import Tool`);
console.log(`================================`);
console.log(`Format: ${format}`);
console.log(`Limit: ${limit} cards`);
console.log(`Output: ${outputFile}`);
console.log(`\n⚠️  IMPORTANT: This is for personal use only. Do not distribute card data.`);
console.log(`\n📋 After running this script:`);
console.log(`   1. Open Planar Nexus app`);
console.log(`   2. Go to Settings → Database Management`);
console.log(`   3. Click "Import Card Database"`);
console.log(`   4. Select this JSON file: ${outputFile}\n`);

async function fetchAllCards(format: string, limit: number): Promise<ScryfallCard[]> {
  const allCards: ScryfallCard[] = [];
  let hasMore = true;
  let nextPage: string | null = `https://api.scryfall.com/cards/search?q=f:${format}+game:paper`;

  while (hasMore && allCards.length < limit) {
    console.log(`Fetching cards... (${allCards.length} fetched so far)`);

    try {
      const response = await fetch(nextPage!) as Response;
      if (!response.ok) {
        if (response.status === 404) {
          console.log('No more cards found.');
          break;
        }
        throw new Error(`Scryfall API error: ${response.status}`);
      }

      const data = await response.json() as any;

      if (data.data && Array.isArray(data.data)) {
        const cardsToAdd = data.data.slice(0, limit - allCards.length);
        allCards.push(...cardsToAdd);
      }

      hasMore = data.has_more || false;
      nextPage = data.next_page || null;

      // Rate limiting: wait 100ms between requests (Scryfall allows ~10 req/sec)
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.error('Error fetching cards:', error);
      break;
    }
  }

  console.log(`Fetched ${allCards.length} cards total.`);
  return allCards;
}

function normalizeCard(card: ScryfallCard): ScryfallCard {
  // Create a minimal card object with only necessary fields
  return {
    id: card.id,
    oracle_id: card.oracle_id,
    name: card.name,
    set: card.set,
    collector_number: card.collector_number,
    cmc: card.cmc || 0,
    type_line: card.type_line,
    oracle_text: card.oracle_text,
    colors: card.colors || [],
    color_identity: card.color_identity || [],
    legalities: card.legalities,
    image_uris: card.image_uris,
    mana_cost: card.mana_cost,
    power: card.power,
    toughness: card.toughness,
    keywords: card.keywords,
    card_faces: card.card_faces,
    layout: card.layout,
    loyalty: card.loyalty,
  };
}

async function main() {
  try {
    console.log('Starting card fetch...\n');
    const cards = await fetchAllCards(format, limit);

    if (cards.length === 0) {
      console.log('No cards found. Exiting.');
      return;
    }

    // Normalize cards
    const normalizedCards = cards.map(normalizeCard);

    // Write to JSON file
    const outputPath = path.resolve(process.cwd(), outputFile);
    const outputDir = path.dirname(outputPath);

    // Create directory if it doesn't exist
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, JSON.stringify(normalizedCards, null, 2));
    console.log(`\n✅ Successfully wrote ${normalizedCards.length} cards to ${outputPath}`);
    console.log(`\n📥 Next steps:`);
    console.log(`   1. Open Planar Nexus`);
    console.log(`   2. Navigate to Settings → Database Management`);
    console.log(`   3. Click "Import Card Database"`);
    console.log(`   4. Select: ${outputPath}`);
    console.log(`\n`);

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
