/**
 * Engine-owned card-data shape (issue #1724).
 *
 * `MinimalCard` / `ScryfallCard` describe the raw card record the rules
 * engine consumes (the shape of `CardInstance.cardData`). They previously
 * lived in `@/lib/card-database`, which forced every engine module that
 * touches a card to import outside the engine boundary. The definitions
 * moved here so the engine is self-contained; `@/lib/card-database`
 * RE-EXPORTS both types (issue #1593's "single canonical import site"
 * contract for app code is preserved — consumer imports keep resolving).
 *
 * The engine owns the shape it validates against; the card database owns
 * persistence/search. New members that affect rules-engine behavior
 * belong HERE first, then flow outward via the re-export.
 */

export interface MinimalCard {
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
  rarity?: string;
  legalities: Record<string, string>;
  name_lower?: string; // For case-insensitive indexing
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
  // Loyalty for planeswalkers
  loyalty?: string;
  // ISO-8601 release date of the card's set (e.g., "2024-02-09").
  // Used by Standard rotation validation (see src/lib/game-rules.ts).
  release_date?: string;
}

export interface ScryfallCard extends MinimalCard {
  // Whether this is a double-faced card
  faces?: number;
}
