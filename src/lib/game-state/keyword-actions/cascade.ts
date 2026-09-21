/**
 * Cascade keyword (CR 702.84): when a spell with cascade resolves, the controller
 * reveals cards from the top of their library until they find a card with mana
 * value less than the original spell's mana value. That card is cast for free.
 * The rest of the revealed cards go to the graveyard.
 *
 * Mechanically extracted from the Cascade implementation plan (issue #1909).
 */
import type {
  GameState,
  CardInstanceId,
  PlayerId,
  StackObject,
} from "../types";
import { moveCardBetweenZones } from "../zones";
import { getManaValue } from "../card-instance";
import { generateStackObjectId } from "../spell-casting/cast";
import {
  parseCascade,
  CascadeInfo,
} from "../oracle-text-parser/casting-keywords";

export type { CascadeInfo };
export { parseCascade };

export function hasCascade(
  card: { cardData?: unknown } | { oracle_text?: string },
): boolean {
  const oracleText =
    "oracle_text" in card
      ? ((card as { oracle_text?: string }).oracle_text ?? "")
      : "cardData" in card
        ? ((card.cardData as { oracle_text?: string })?.oracle_text ?? "")
        : "";
  return parseCascade(oracleText).hasCascade;
}

export interface CascadeResult {
  success: boolean;
  state: GameState;
  exiledCardIds: CardInstanceId[];
  castCardId: CardInstanceId | null;
  graveyardCardIds: CardInstanceId[];
  description: string;
  error?: string;
}

function createCascadeStackObject(
  state: GameState,
  sourceCardId: CardInstanceId,
  controllerId: PlayerId,
): StackObject | null {
  const sourceCard = state.cards.get(sourceCardId);
  if (!sourceCard) return null;

  return {
    id: generateStackObjectId(),
    type: "spell",
    sourceCardId,
    controllerId,
    name: sourceCard.cardData.name,
    text: sourceCard.cardData.oracle_text || "",
    manaCost: sourceCard.cardData.mana_cost ?? null,
    targets: [],
    chosenModes: [],
    variableValues: new Map(),
    isCountered: false,
    timestamp: Date.now(),
    cascade: parseCascade(sourceCard.cardData.oracle_text || "").hasCascade,
  };
}

export function resolveCascade(
  state: GameState,
  originalSpellCardId: CardInstanceId,
): CascadeResult {
  const spellCard = state.cards.get(originalSpellCardId);
  if (!spellCard) {
    return {
      success: false,
      state,
      exiledCardIds: [],
      castCardId: null,
      graveyardCardIds: [],
      description: "",
      error: `Spell card ${originalSpellCardId} not found.`,
    };
  }

  const controllerId = spellCard.controllerId;
  const originalManaValue = getManaValue(spellCard);

  const libraryKey = `${controllerId}-library`;
  const libraryZone = state.zones.get(libraryKey);

  if (!libraryZone) {
    return {
      success: false,
      state,
      exiledCardIds: [],
      castCardId: null,
      graveyardCardIds: [],
      description: "",
      error: "Library zone not found.",
    };
  }

  const libraryCardIds = [...libraryZone.cardIds];
  const exiledCardIds: CardInstanceId[] = [];
  const graveyardCardIds: CardInstanceId[] = [];
  let castCardId: CardInstanceId | null = null;
  let currentState = state;

  for (const cardId of libraryCardIds) {
    const card = currentState.cards.get(cardId);
    if (!card) continue;

    const cardManaValue = getManaValue(card);

    if (cardManaValue < originalManaValue) {
      castCardId = cardId;
      break;
    }

    exiledCardIds.push(cardId);
  }

  const castCardIndex = castCardId ? libraryCardIds.indexOf(castCardId) : -1;
  const cardsToGraveyard =
    castCardIndex >= 0
      ? libraryCardIds.slice(exiledCardIds.length + 1)
      : libraryCardIds.slice(exiledCardIds.length);

  for (const cardId of exiledCardIds) {
    const card = currentState.cards.get(cardId);
    if (!card) continue;
    const cardCurrentZone = card.currentZoneKey;
    if (!cardCurrentZone) continue;
    const sourceZone = currentState.zones.get(cardCurrentZone);
    const exile = currentState.zones.get(`${controllerId}-exile`);

    if (sourceZone && exile) {
      const moved = moveCardBetweenZones(sourceZone, exile, cardId);
      const updatedZones = new Map(currentState.zones);
      updatedZones.set(cardCurrentZone, moved.from);
      updatedZones.set(`${controllerId}-exile`, moved.to);
      currentState = {
        ...currentState,
        zones: updatedZones,
        lastModifiedAt: Date.now(),
      };
    }
  }

  if (castCardId) {
    const cascadeCard = currentState.cards.get(castCardId);
    if (cascadeCard) {
      const castCardCurrentZone = cascadeCard.currentZoneKey;
      const castSourceZone = castCardCurrentZone
        ? currentState.zones.get(castCardCurrentZone)
        : undefined;
      const stackZone = currentState.zones.get("stack");

      if (castSourceZone && stackZone) {
        const moved = moveCardBetweenZones(
          castSourceZone,
          stackZone,
          castCardId,
        );
        const updatedZones = new Map(currentState.zones);
        updatedZones.set(castCardCurrentZone!, moved.from);
        updatedZones.set("stack", moved.to);

        const stackObject = createCascadeStackObject(
          currentState,
          castCardId,
          controllerId,
        );

        if (!stackObject) {
          return {
            success: false,
            state: currentState,
            exiledCardIds,
            castCardId: null,
            graveyardCardIds,
            description: "",
            error: "Failed to create stack object for cascaded spell.",
          };
        }

        const updatedStack = [...currentState.stack, stackObject];

        currentState = {
          ...currentState,
          zones: updatedZones,
          stack: updatedStack,
          lastModifiedAt: Date.now(),
        };
      }
    }
  }

  for (const cardId of cardsToGraveyard) {
    const card = currentState.cards.get(cardId);
    if (!card) continue;
    const cardCurrentZone = card.currentZoneKey;
    const sourceZone = cardCurrentZone
      ? currentState.zones.get(cardCurrentZone)
      : undefined;
    const graveyard = currentState.zones.get(`${controllerId}-graveyard`);

    if (sourceZone && graveyard) {
      const moved = moveCardBetweenZones(sourceZone, graveyard, cardId);
      const updatedZones = new Map(currentState.zones);
      updatedZones.set(cardCurrentZone!, moved.from);
      updatedZones.set(`${controllerId}-graveyard`, moved.to);
      currentState = {
        ...currentState,
        zones: updatedZones,
        lastModifiedAt: Date.now(),
      };
      graveyardCardIds.push(cardId);
    }
  }

  const castCard = castCardId ? currentState.cards.get(castCardId) : null;

  return {
    success: true,
    state: currentState,
    exiledCardIds,
    castCardId,
    graveyardCardIds,
    description:
      castCardId && castCard
        ? `Cascade: exiled ${exiledCardIds.length} card(s) (CMC > ${originalManaValue}), cast ${castCard.cardData.name} (CMC ${getManaValue(castCard)} < ${originalManaValue}) for free, put ${graveyardCardIds.length} card(s) in graveyard.`
        : `Cascade: no card found with CMC less than ${originalManaValue}. ${graveyardCardIds.length} card(s) went to graveyard.`,
  };
}
