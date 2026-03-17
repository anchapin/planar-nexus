import { MinimalCard } from "../card-database";

/**
 * Formats a card's data into a semantically rich string for embedding generation.
 * This structured format helps the transformer model capture card mechanics, 
 * synergies, and identity.
 * 
 * @param card The card data to format
 * @returns A structured string representation of the card
 */
export function formatCardForEmbedding(card: MinimalCard): string {
  const parts: string[] = [];

  // 1. Basic Identity
  parts.push(`Card: ${card.name}`);
  parts.push(`Type: ${card.type_line}`);

  // 2. Cost and Stats
  if (card.mana_cost) {
    parts.push(`Cost: ${card.mana_cost}`);
  } else if (card.cmc !== undefined) {
    parts.push(`Cost: ${card.cmc} CMC`);
  }

  if (card.power !== undefined && card.toughness !== undefined) {
    parts.push(`Stats: ${card.power}/${card.toughness}`);
  }

  if (card.loyalty) {
    parts.push(`Loyalty: ${card.loyalty}`);
  }

  // 3. Rules and Mechanics
  if (card.oracle_text) {
    // We keep the oracle text as is, as it contains the core mechanics
    parts.push(`Rules: ${card.oracle_text}`);
  }

  // 4. Keywords
  if (card.keywords && card.keywords.length > 0) {
    parts.push(`Keywords: ${card.keywords.join(", ")}`);
  }

  // 5. Card Faces (for double-faced/transform cards)
  if (card.card_faces && card.card_faces.length > 0) {
    card.card_faces.forEach((face, index) => {
      // Skip the first face if it's identical to the main card name (common in Scryfall data)
      if (index === 0 && face.name === card.name && !face.oracle_text) return;
      
      parts.push(`Face ${index + 1}: ${face.name}`);
      if (face.type_line) parts.push(`Face ${index + 1} Type: ${face.type_line}`);
      if (face.oracle_text) parts.push(`Face ${index + 1} Rules: ${face.oracle_text}`);
      if (face.power !== undefined && face.toughness !== undefined) {
        parts.push(`Face ${index + 1} Stats: ${face.power}/${face.toughness}`);
      }
    });
  }

  // Join parts with a period and space for natural language flow
  return parts.filter(Boolean).join(". ") + ".";
}
