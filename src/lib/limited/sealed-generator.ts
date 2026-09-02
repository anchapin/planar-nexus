/**
 * Sealed Pool Generator
 *
 * Generates sealed pools with authentic Magic: The Gathering rarity distribution.
 * SEAL-01: Session creation with selected set
 * SEAL-02: 6 packs × 14 cards = 84 cards total, all revealed immediately
 *
 * Uses the card database to fetch cards by set and rarity.
 * Weighted random selection for rare/mythic slot (~1:8 mythic ratio).
 */

import type { MinimalCard } from "@/lib/card-database";
import { getAllCards, initializeCardDatabase } from "@/lib/card-database";
import type {
  PoolCard,
  LimitedSession,
  LimitedMode,
  CreateSealedSessionOptions,
} from "./types";
import { validateSetIsDraftable } from "./set-service";
import { resolveRng, type Rng, type RngOptions } from "./rng";

// ============================================================================
// Constants
// ============================================================================

/** Standard booster pack: 14 cards */
const CARDS_PER_PACK = 14;

/** Commons per pack */
const COMMONS_PER_PACK = 10;

/** Uncommons per pack */
const UNCOMMONS_PER_PACK = 3;

/** Sealed packs per session */
const PACKS_PER_SEALED = 6;

/** Mythic ratio (~1 in 8 packs) */
const MYTHIC_RATIO = 1 / 8;

/** Fallback card names for sets without enough cards in the database */
const FALLBACK_CARD_NAMES = {
  common: [
    "Plains",
    "Island",
    "Swamp",
    "Mountain",
    "Forest",
    "Silvercoat Lion",
    "Grizzly Bears",
    "Prowling Caracal",
    "Cancel",
    "Divination",
    "Giant Spider",
    "Warpath Jaguar",
    "Savannah Lions",
    "Order of the White Shield",
  ],
  uncommon: [
    "Shock",
    "Giant Growth",
    "Cancel",
    "Oblivion Ring",
    "Bloodrage Vampire",
    "Glacial Wall",
    "Serra Angel",
    "Nightmare",
    "Shivan Dragon",
    "Sengir Vampire",
  ],
  rare: [
    "Baneslayer Angel",
    "Day of Judgment",
    "Cruel Ultimatum",
    "Inferno Titan",
    "Jace, the Mind Sculptor",
  ],
  mythic: [
    "Liliana, the Last Hope",
    "Chandra, Torch of Defiance",
    "Nissa, Vital Force",
    "Gideon, Ally of Zendikar",
  ],
} as const;

const FALLBACK_COLORS: Record<string, string[][]> = {
  common: [
    ["W"],
    ["U"],
    ["B"],
    ["R"],
    ["G"],
    ["W", "W"],
    ["G", "G"],
    ["W", "G"],
    ["U", "U"],
    ["U", "B"],
  ],
  uncommon: [
    ["R"],
    ["G"],
    ["U", "U"],
    ["W", "W"],
    ["B", "R"],
    ["U"],
    ["W", "W"],
    ["B", "B"],
    ["R", "R"],
    ["B", "B"],
  ],
  rare: [
    ["W", "W"],
    ["W", "W"],
    ["U", "B", "R"],
    ["R", "R", "R"],
    ["U", "U"],
  ],
  mythic: [
    ["B", "B"],
    ["R", "R"],
    ["G", "G"],
    ["W", "W"],
  ],
};

// ============================================================================
// Types
// ============================================================================

/**
 * Rarity distribution in a pack
 */
interface PackContents {
  commons: MinimalCard[];
  uncommons: MinimalCard[];
  rareOrMythic: MinimalCard;
}

/**
 * Pool generation result
 */
interface PoolGenerationResult {
  pool: PoolCard[];
  packContents: PackContents[];
}

// ============================================================================
// Cached Data
// ============================================================================

/** Cache for cards by set and rarity */
const cardCache = new Map<string, Map<string, MinimalCard[]>>();

/**
 * Clear the card cache (useful for testing)
 */
export function clearCardCache(): void {
  cardCache.clear();
}

// ============================================================================
// Card Retrieval
// ============================================================================

/**
 * Get cards by set and rarity from the card database
 * Results are cached per set for performance
 */
async function getCardsBySetAndRarity(
  setCode: string,
  rarity: string,
): Promise<MinimalCard[]> {
  // Initialize cache for this set if needed
  if (!cardCache.has(setCode)) {
    cardCache.set(setCode, new Map());
  }

  const setCache = cardCache.get(setCode)!;

  // Return cached results if available
  if (setCache.has(rarity)) {
    return setCache.get(rarity)!;
  }

  // Initialize database if needed
  await initializeCardDatabase();

  // Get all cards and filter by set and rarity
  const allCards = await getAllCards();
  const filteredCards = allCards.filter(
    (card) =>
      card.set?.toLowerCase() === setCode.toLowerCase() &&
      card.rarity?.toLowerCase() === rarity.toLowerCase(),
  );

  // Cache and return
  setCache.set(rarity, filteredCards);
  return filteredCards;
}

/**
 * Weighted random selection from an array
 *
 * Issue #1559: randomness is drawn from the injected `rng` (seeded
 * mulberry32 when replaying, `Math.random` under the hood otherwise).
 */
function weightedRandom<T>(items: T[], rng: Rng): T {
  if (items.length === 0) {
    throw new Error("Cannot select from empty array");
  }
  return items[rng.int(items.length)];
}

function createFallbackCard(
  name: string,
  rarity: string,
  index: number,
  setCode: string,
): MinimalCard {
  const colorsForRarity = FALLBACK_COLORS[rarity] || [["C"]];
  const colors = colorsForRarity[index % colorsForRarity.length];
  return {
    id: `fallback-${setCode}-${rarity}-${index}`,
    name,
    set: setCode.toUpperCase(),
    collector_number: String(index + 1),
    cmc: colors.length > 0 ? colors.length : 0,
    type_line:
      rarity === "common" || rarity === "uncommon"
        ? "Creature — Human"
        : "Legendary Creature — Angel",
    colors,
    color_identity: colors,
    rarity,
    legalities: { standard: "legal" },
  };
}

function ensureEnoughCards(
  cards: MinimalCard[],
  needed: number,
  rarity: string,
  setCode: string,
): MinimalCard[] {
  if (cards.length >= needed) {
    return cards;
  }

  const names =
    FALLBACK_CARD_NAMES[rarity as keyof typeof FALLBACK_CARD_NAMES] ||
    FALLBACK_CARD_NAMES.common;
  const fallback: MinimalCard[] = [];

  for (let i = cards.length; i < needed; i++) {
    const nameIdx = i % names.length;
    fallback.push(
      createFallbackCard(`${names[nameIdx]} (${setCode})`, rarity, i, setCode),
    );
  }

  return [...cards, ...fallback];
}

/**
 * Shuffle an array in place (Fisher-Yates)
 *
 * Issue #1559: draws swap indices from the injected `rng` so seeded
 * callers shuffle deterministically.
 */
function shuffle<T>(array: T[], rng: Rng): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// ============================================================================
// Pack Generation
// ============================================================================

/**
 * Generate a single booster pack
 *
 * Standard distribution:
 * - 10 commons
 * - 3 uncommons
 * - 1 rare or mythic (~1:8 ratio)
 *
 * Issue #1559: pass `{ seed }` (or a pre-built `{ rng }`) to make the pack
 * reproducible. Unseeded calls behave exactly like the prior
 * `Math.random()` implementation.
 */
export async function generatePack(
  setCode: string,
  options?: RngOptions,
): Promise<PackContents> {
  const rng = resolveRng(options);

  // Get cards by rarity
  const commons = await getCardsBySetAndRarity(setCode, "common");
  const uncommons = await getCardsBySetAndRarity(setCode, "uncommon");
  const rares = await getCardsBySetAndRarity(setCode, "rare");
  const mythics = await getCardsBySetAndRarity(setCode, "mythic");

  const enoughCommons = ensureEnoughCards(
    commons,
    COMMONS_PER_PACK,
    "common",
    setCode,
  );
  const enoughUncommons = ensureEnoughCards(
    uncommons,
    UNCOMMONS_PER_PACK,
    "uncommon",
    setCode,
  );

  // Select commons (10 cards)
  const shuffledCommons = shuffle(enoughCommons, rng);
  const selectedCommons = shuffledCommons.slice(0, COMMONS_PER_PACK);

  const shuffledUncommons = shuffle(enoughUncommons, rng);
  const selectedUncommons = shuffledUncommons.slice(0, UNCOMMONS_PER_PACK);

  // Select rare or mythic (1 card)
  const isMythic = rng.next() < MYTHIC_RATIO;
  let rarePool = isMythic && mythics.length > 0 ? mythics : rares;

  if (rarePool.length === 0) {
    const fallbackRarity = isMythic ? "mythic" : "rare";
    const names = FALLBACK_CARD_NAMES[fallbackRarity];
    rarePool = [createFallbackCard(names[0], fallbackRarity, 0, setCode)];
  }

  const rareOrMythic = weightedRandom(rarePool, rng);

  return {
    commons: selectedCommons,
    uncommons: selectedUncommons,
    rareOrMythic,
  };
}

// ============================================================================
// Pool Generation
// ============================================================================

/**
 * Convert pack contents to pool cards
 */
function packToPoolCards(
  packContents: PackContents,
  packId: number,
): PoolCard[] {
  const poolCards: PoolCard[] = [];
  const now = new Date().toISOString();

  // Add commons
  packContents.commons.forEach((card, slot) => {
    poolCards.push({
      ...card,
      packId,
      packSlot: slot,
      addedAt: now,
    });
  });

  // Add uncommons
  packContents.uncommons.forEach((card, slot) => {
    poolCards.push({
      ...card,
      packId,
      packSlot: COMMONS_PER_PACK + slot,
      addedAt: now,
    });
  });

  // Add rare/mythic
  poolCards.push({
    ...packContents.rareOrMythic,
    packId,
    packSlot: COMMONS_PER_PACK + UNCOMMONS_PER_PACK,
    addedAt: now,
  });

  return poolCards;
}

/**
 * Generate a complete sealed pool (6 packs × 14 cards = 84 cards)
 *
 * Issue #1559: one `Rng` stream drives all 6 packs so a supplied seed
 * reproduces the whole pool.
 */
export async function generateSealedPool(
  setCode: string,
  options?: RngOptions,
): Promise<PoolCard[]> {
  // One PRNG stream for the whole session (not per-pack) so the seed
  // fully determines the pool.
  const rng = resolveRng(options);
  const packContents: PackContents[] = [];

  // Generate 6 packs
  for (let i = 0; i < PACKS_PER_SEALED; i++) {
    const pack = await generatePack(setCode, { rng });
    packContents.push(pack);
  }

  // Convert all packs to pool cards
  const allPoolCards: PoolCard[] = [];
  packContents.forEach((pack, packId) => {
    const poolCards = packToPoolCards(pack, packId);
    allPoolCards.push(...poolCards);
  });

  return allPoolCards;
}

/**
 * Generate pool with detailed pack information
 * Useful for showing pack-by-pack opening experience
 *
 * Issue #1559: one `Rng` stream drives all 6 packs (see generateSealedPool).
 */
export async function generateSealedPoolWithPacks(
  setCode: string,
  options?: RngOptions,
): Promise<PoolGenerationResult> {
  const rng = resolveRng(options);
  const packContents: PackContents[] = [];

  // Generate 6 packs
  for (let i = 0; i < PACKS_PER_SEALED; i++) {
    const pack = await generatePack(setCode, { rng });
    packContents.push(pack);
  }

  // Convert all packs to pool cards
  const pool: PoolCard[] = [];
  packContents.forEach((pack, packId) => {
    const poolCards = packToPoolCards(pack, packId);
    pool.push(...poolCards);
  });

  return { pool, packContents };
}

// ============================================================================
// Session Creation
// ============================================================================

/**
 * Create a new sealed session with pool
 *
 * Issue #1559: `options.seed` makes the 84-card pool reproducible and is
 * persisted on the session (`session.seed`) so it can be replayed later.
 */
export async function createSealedSession(
  setCode: string,
  setName: string,
  options?: CreateSealedSessionOptions,
): Promise<LimitedSession> {
  // Issue #1557: refuse non-draftable set types (commander precons,
  // planechase, reprint products) — sealing them yields malformed pools.
  await validateSetIsDraftable(setCode);

  // Generate the pool (one PRNG stream per session — issue #1559)
  const pool = await generateSealedPool(setCode, { seed: options?.seed });

  // Create session
  const session: LimitedSession = {
    id: crypto.randomUUID(),
    setCode,
    setName,
    mode: "sealed" as LimitedMode,
    status: "in_progress",
    pool,
    deck: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    // Issue #1559: persist the seed only when supplied so unseeded rows
    // keep their pre-#1559 shape.
    ...(options?.seed !== undefined ? { seed: options.seed } : {}),
  };

  return session;
}

/**
 * Generate a draft pack (same as sealed pack for now)
 * Phase 15 will add draft-specific logic
 *
 * Issue #1559: accepts `{ seed }` / `{ rng }` for reproducible packs.
 */
export async function generateDraftPack(
  setCode: string,
  options?: RngOptions,
): Promise<PoolCard[]> {
  const pack = await generatePack(setCode, options);
  return packToPoolCards(pack, 0);
}

// ============================================================================
// Exports
// ============================================================================

export {
  CARDS_PER_PACK,
  PACKS_PER_SEALED,
  COMMONS_PER_PACK,
  UNCOMMONS_PER_PACK,
};
