
import { reviewDeck, DeckReviewInput } from "@/ai/flows/ai-deck-coach-review";
import { generateAIOpponentDeck, AIOpponentDeckGenerationInput } from "@/ai/flows/ai-opponent-deck-generation";
import {
  GenericCard,
  GenericDeckCard,
  GenericSavedDeck,
  genericCardToMinimalCard,
  minimalCardToGenericCard,
  GenericCardType,
  GenericColor,
  AbilityKeyword
} from "@/lib/card-database";

// ============================================================================
// SCRYFALL CARD TYPES (Legacy - maintained for backward compatibility)
// ============================================================================

export interface ScryfallCard {
  id: string;
  oracle_id?: string;
  name: string;
  set?: string;
  collector_number?: string;
  cmc?: number;
  power?: string;
  toughness?: string;
  keywords?: string[];
  image_uris?: {
    small: string;
    normal: string;
    large: string;
    png: string;
    art_crop: string;
    border_crop: string;
  };
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  colors?: string[];
  color_identity: string[];
  rarity?: string;
  legalities?: { [format: string]: string };
  // Card faces for double-faced/transform cards
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
  // Layout type (normal, transform, modal_dfc, etc.)
  layout?: string;
  // Whether this is a double-faced card
  faces?: number;
  // Loyalty for planeswalkers
  loyalty?: string;
}

export interface DeckCard extends ScryfallCard {
  count: number;
}

export interface SavedDeck {
  id: string;
  name:string;
  format: string;
  cards: DeckCard[];
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// UNIFIED CARD TYPES (Unit 2: Original Card Data Schema)
// ============================================================================

/**
 * Unified card type that can represent either Scryfall cards or generic cards
 */
export type UnifiedCard = ScryfallCard | GenericCard;

/**
 * Unified deck card type
 */
export type UnifiedDeckCard =
  | (ScryfallCard & { quantity: number })
  | (GenericCard & { quantity: number });

/**
 * Unified saved deck type
 */
export type UnifiedSavedDeck =
  | Omit<SavedDeck, 'cards'> & { cards: Array<DeckCard> }
  | Omit<GenericSavedDeck, 'cards'> & { cards: Array<GenericDeckCard> };

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Check if a card is a GenericCard
 */
export function isGenericCard(card: UnifiedCard): card is GenericCard {
  return 'type' in card && typeof card.type === 'string';
}

/**
 * Check if a card is a ScryfallCard
 */
export function isScryfallCard(card: UnifiedCard): card is ScryfallCard {
  return 'type_line' in card && typeof card.type_line === 'string';
}

// ============================================================================
// CONVERSION FUNCTIONS
// ============================================================================

/**
 * Convert a ScryfallCard to GenericCard
 * This enables using Scryfall data with the generic card system
 */
export function scryfallToGenericCard(scryfallCard: ScryfallCard): GenericCard {

  // Parse type_line to determine card type
  const typeLine = (scryfallCard.type_line || '').toLowerCase();
  let type: GenericCardType;
  const subtypes: string[] = [];

  if (typeLine.includes('creature')) {
    type = GenericCardType.CREATURE;
    const match = scryfallCard.type_line?.match(/Creature\s*—?\s*(.+)/);
    if (match) {
      subtypes.push(...match[1].trim().split(' ').filter(s => s));
    }
  } else if (typeLine.includes('instant')) {
    type = GenericCardType.INSTANT;
  } else if (typeLine.includes('sorcery')) {
    type = GenericCardType.SORCERY;
  } else if (typeLine.includes('artifact')) {
    type = GenericCardType.ARTIFACT;
  } else if (typeLine.includes('enchantment')) {
    type = GenericCardType.ENCHANTMENT;
  } else if (typeLine.includes('land')) {
    type = GenericCardType.LAND;
  } else if (typeLine.includes('planeswalker')) {
    type = GenericCardType.PLANESWALKER;
  } else {
    type = GenericCardType.ARTIFACT;
  }

  // Map colors
  const colors = (scryfallCard.colors || []).map(c => c.toUpperCase() as GenericColor);
  const colorIdentity = (scryfallCard.color_identity || []).map(c => c.toUpperCase() as GenericColor);

  // Parse keywords
  const keywords: AbilityKeyword[] = [];
  const keywordPatterns: { keyword: AbilityKeyword; pattern: RegExp }[] = [
    { keyword: AbilityKeyword.FIRST_STRIKE, pattern: /first strike/i },
    { keyword: AbilityKeyword.DOUBLE_STRIKE, pattern: /double strike/i },
    { keyword: AbilityKeyword.DEATHTOUCH, pattern: /deathtouch/i },
    { keyword: AbilityKeyword.HEXPROOF, pattern: /hexproof/i },
    { keyword: AbilityKeyword.LIFELINK, pattern: /lifelink/i },
    { keyword: AbilityKeyword.FLYING, pattern: /flying/i },
    { keyword: AbilityKeyword.TRAMPLE, pattern: /trample/i },
    { keyword: AbilityKeyword.HASTE, pattern: /haste/i },
    { keyword: AbilityKeyword.VIGILANCE, pattern: /vigilance/i },
    { keyword: AbilityKeyword.REACH, pattern: /reach/i },
    { keyword: AbilityKeyword.MENACE, pattern: /menace/i },
    { keyword: AbilityKeyword.INDESTRUCTIBLE, pattern: /indestructible/i },
    { keyword: AbilityKeyword.PROTECTION, pattern: /protection from/i },
    { keyword: AbilityKeyword.SCRY, pattern: /scry/i },
  ];

  const text = scryfallCard.oracle_text || '';
  for (const { keyword, pattern } of keywordPatterns) {
    if (pattern.test(text)) {
      keywords.push(keyword);
    }
  }

  // Parse power/toughness for creatures
  let power: number | undefined;
  let toughness: number | undefined;
  if (type === GenericCardType.CREATURE) {
    power = scryfallCard.power ? parseInt(scryfallCard.power, 10) : undefined;
    toughness = scryfallCard.toughness ? parseInt(scryfallCard.toughness, 10) : undefined;
  }

  // Map legalities
  const legalities = {
    commander: (scryfallCard.legalities?.commander || 'legal') as "legal" | "banned" | "restricted",
    standard: (scryfallCard.legalities?.standard || 'legal') as "legal" | "banned" | "restricted",
    modern: (scryfallCard.legalities?.modern || 'legal') as "legal" | "banned" | "restricted",
    pioneer: (scryfallCard.legalities?.pioneer || 'legal') as "legal" | "banned" | "restricted",
    legacy: (scryfallCard.legalities?.legacy || 'legal') as "legal" | "banned" | "restricted",
    vintage: (scryfallCard.legalities?.vintage || 'legal') as "legal" | "banned" | "restricted",
    pauper: (scryfallCard.legalities?.pauper || 'legal') as "legal" | "banned" | "restricted"
  };

  const genericCard: GenericCard = {
    id: scryfallCard.id,
    name: scryfallCard.name,
    type: type,
    subtypes,
    manaCost: scryfallCard.mana_cost || '',
    cmc: scryfallCard.cmc || 0,
    colors,
    colorIdentity,
    text: scryfallCard.oracle_text || '',
    keywords,
    power,
    toughness,
    loyalty: scryfallCard.loyalty ? parseInt(scryfallCard.loyalty, 10) : undefined,
    legalities,
    imageUris: scryfallCard.image_uris ? {
      small: scryfallCard.image_uris.small,
      normal: scryfallCard.image_uris.normal,
      large: scryfallCard.image_uris.large
    } : undefined
  };

  return genericCard;
}

/**
 * Convert a GenericCard to ScryfallCard format
 * Useful for backward compatibility with existing code
 */
export function genericToScryfallCard(genericCard: GenericCard): ScryfallCard {
  // Construct type_line from type and subtypes
  const type_line = genericCard.type +
    (genericCard.subtypes.length > 0 ? ` — ${genericCard.subtypes.join(' ')}` : '');

  return {
    id: genericCard.id,
    name: genericCard.name,
    cmc: genericCard.cmc,
    type_line,
    oracle_text: genericCard.text,
    colors: genericCard.colors,
    color_identity: genericCard.colorIdentity,
    mana_cost: genericCard.manaCost,
    power: genericCard.power?.toString(),
    toughness: genericCard.toughness?.toString(),
    loyalty: genericCard.loyalty?.toString(),
    legalities: {
      commander: genericCard.legalities.commander,
      standard: genericCard.legalities.standard,
      modern: genericCard.legalities.modern,
      pioneer: genericCard.legalities.pioneer,
      legacy: genericCard.legalities.legacy,
      vintage: genericCard.legalities.vintage,
      pauper: genericCard.legalities.pauper
    },
    image_uris: genericCard.imageUris ? {
      small: genericCard.imageUris.small,
      normal: genericCard.imageUris.normal,
      large: genericCard.imageUris.large,
      png: genericCard.imageUris.large,
      art_crop: genericCard.imageUris.large,
      border_crop: genericCard.imageUris.normal
    } : undefined
  };
}


export async function searchScryfall(query: string): Promise<ScryfallCard[]> {
  if (!query || query.length < 3) {
    return [];
  }

  // Add type:commander to narrow down search for commander format relevant cards.
  const searchQuery = `${query} (game:paper)`;

  try {
    const res = await fetch(
      `https://api.scryfall.com/cards/search?q=${encodeURIComponent(
        searchQuery
      )}`
    );
    if (!res.ok) {
      if (res.status === 404) return []; // No cards found is a valid outcome
      console.error(`Scryfall API error: ${res.status} ${res.statusText}`);
      return [];
    }

    const data = await res.json();
    return data.data || [];
  } catch (error) {
    console.error("Failed to fetch from Scryfall API", error);
    return [];
  }
}

export async function searchCards(query: string, _format: string = "commander"): Promise<ScryfallCard[]> {
  return searchScryfall(query);
}

export async function getDeckReview(input: DeckReviewInput) {
  try {
    const review = await reviewDeck(input);
    return review;
  } catch (error) {
    console.error("Error getting deck review:", error);
    if (error instanceof Error) {
        throw new Error(error.message);
    }
    throw new Error("Failed to get deck review from AI.");
  }
}

export async function generateOpponent(input: AIOpponentDeckGenerationInput) {
    try {
        const opponent = await generateAIOpponentDeck(input);
        return opponent;
    } catch(error) {
        console.error("Error generating AI opponent:", error);
        throw new Error("Failed to generate AI opponent.");
    }
}

export async function validateCardLegality(
  cards: { name: string; quantity: number }[],
  format: string
): Promise<{ found: DeckCard[]; notFound: string[]; illegal: string[] }> {
  if (!cards || cards.length === 0) {
    return { found: [], notFound: [], illegal: [] };
  }

  // 1. Sanitize and aggregate input
  const cardRequestMap = new Map<string, { originalName: string; quantity: number }>();
  const malformedInputs: string[] = [];

  for (const card of cards) {
    if (!card || typeof card.name !== 'string' || card.name.trim() === '' || typeof card.quantity !== 'number' || card.quantity <= 0) {
      malformedInputs.push(card?.name || 'Malformed Input');
      continue;
    }
    const lowerCaseName = card.name.toLowerCase();
    const existing = cardRequestMap.get(lowerCaseName);
    if (existing) {
      existing.quantity += card.quantity;
    } else {
      cardRequestMap.set(lowerCaseName, { originalName: card.name, quantity: card.quantity });
    }
  }

  if (cardRequestMap.size === 0) {
    return { found: [], notFound: malformedInputs, illegal: [] };
  }
  
  // 2. Fetch from Scryfall
  const identifiersToFetch = Array.from(cardRequestMap.values()).map(c => ({ name: c.originalName }));

  try {
    const res = await fetch(`https://api.scryfall.com/cards/collection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers: identifiersToFetch }),
      next: { revalidate: 3600 * 24 },
    });

    if (!res.ok) {
      console.error(`Scryfall API error on collection fetch: ${res.status}`);
      return { found: [], notFound: identifiersToFetch.map(c => c.name), illegal: [] };
    }

    const collection = await res.json();
    
    // 3. Process response
    const found: DeckCard[] = [];
    const illegal: string[] = [];
    const notFoundNames = new Set(cardRequestMap.keys());

    if (collection?.data && Array.isArray(collection.data)) {
      for (const scryfallCard of collection.data as ScryfallCard[]) {
        // Super defensive check
        if (!scryfallCard || typeof scryfallCard.name !== 'string' || !scryfallCard.name) {
          continue;
        }

        const lowerCaseName = scryfallCard.name.toLowerCase();
        const requestDetails = cardRequestMap.get(lowerCaseName);

        if (requestDetails) {
          notFoundNames.delete(lowerCaseName);
          const isLegal = scryfallCard.legalities?.[format] === 'legal';
          if (isLegal) {
            found.push({ ...scryfallCard, count: requestDetails.quantity });
          } else {
            illegal.push(requestDetails.originalName);
          }
        }
      }
    }
    
    const notFound = Array.from(notFoundNames).map(name => cardRequestMap.get(name)!.originalName);
    
    return { found, notFound: [...notFound, ...malformedInputs], illegal };

  } catch (error) {
    console.error('Failed to fetch or process from Scryfall API', error);
    return { found: [], notFound: identifiersToFetch.map(c => c.name), illegal: [] };
  }
}

export async function importDecklist(
  decklist: string,
  format?: string
): Promise<{ found: DeckCard[]; notFound: string[]; illegal: string[] }> {
  const lines = decklist.split('\n').filter(line => line.trim() !== '');
  if (lines.length === 0) {
    return { found: [], notFound: [], illegal: [] };
  }

  const cardDetails: { name: string; quantity: number }[] = [];
  
  for (const line of lines) {
    // Improved regex to better handle various decklist formats
    const match = line.trim().match(/^(?:(\d+)\s*x?\s*)?(.+)/);
    if (match) {
      const name = match[2]?.trim();
      const count = parseInt(match[1] || '1', 10);
      // Ensure name is not just tokens like "Sideboard"
      if (name && !/^\/\//.test(name) && name.toLowerCase() !== 'sideboard') {
        cardDetails.push({ name, quantity: count });
      }
    }
  }

  if (cardDetails.length === 0) {
    // If no parsable card lines were found, return all original lines as "not found"
    return { found: [], notFound: lines, illegal: [] };
  }
  
  // `validateCardLegality` is now the single source of truth for validation.
  const { found, notFound, illegal } = await validateCardLegality(cardDetails, format || 'commander');

  // Aggregate found cards by their Scryfall ID to combine different prints of the same card.
  const aggregatedFound = Array.from(
      found.reduce((acc, card) => {
        const existing = acc.get(card.id);
        if(existing) {
            existing.count += card.count;
        } else {
            acc.set(card.id, {...card});
        }
        return acc;
      }, new Map<string, DeckCard>()).values()
  );

  return { found: aggregatedFound, notFound, illegal };
}
