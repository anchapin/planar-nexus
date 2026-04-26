/**
 * Game State Factory
 *
 * Provides factory functions for creating consistent test game state data.
 */

import type {
  CardInstance,
  Player,
  Zone,
  ZoneType,
  Counter,
  ScryfallCard,
} from "@/lib/game-state/types";
import { createCard } from "./card";

/**
 * Default player ID
 */
const DEFAULT_PLAYER_ID = "player-1";
const DEFAULT_OPPONENT_ID = "player-2";

/**
 * Options for creating a game state
 */
export interface CreateGameStateOptions {
  /**
   * Player ID
   */
  playerId?: string;
  /**
   * Opponent ID
   */
  opponentId?: string;
  /**
   * Player life total
   */
  playerLife?: number;
  /**
   * Opponent life total
   */
  opponentLife?: number;
  /**
   * Current turn number
   */
  turn?: number;
  /**
   * Current phase
   */
  phase?: string;
  /**
   * Current step
   */
  step?: string;
  /**
   * Active player ID
   */
  activePlayerId?: string;
  /**
   * Number of cards in player's hand
   */
  playerHandSize?: number;
  /**
   * Number of cards in opponent's hand
   */
  opponentHandSize?: number;
  /**
   * Number of cards in player's library
   */
  playerLibrarySize?: number;
  /**
   * Number of cards in opponent's library
   */
  opponentLibrarySize?: number;
  /**
   * Cards on battlefield
   */
  battlefieldCards?: CardInstance[];
  /**
   * Cards in player's graveyard
   */
  playerGraveyard?: CardInstance[];
  /**
   * Cards in opponent's graveyard
   */
  opponentGraveyard?: CardInstance[];
}

/**
 * Generate a unique ID
 */
let idCounter = 0;
function generateId(prefix: string = "id"): string {
  idCounter++;
  return `${prefix}-${idCounter.toString().padStart(4, "0")}`;
}

/**
 * Create a basic card instance
 */
export function createCardInstance(
  options: {
    name?: string;
    power?: string;
    toughness?: string;
    type_line?: string;
    controllerId?: string;
    ownerId?: string;
    isTapped?: boolean;
    hasSummoningSickness?: boolean;
    isToken?: boolean;
  } = {},
): CardInstance {
  const id = generateId("card");
  const cardData = createCard({
    name: options.name || "Test Card",
    power: options.power,
    toughness: options.toughness,
    type_line: options.type_line || "Creature",
  });

  return {
    id,
    oracleId: cardData.oracle_id || id,
    cardData: cardData as unknown as ScryfallCard,
    currentFaceIndex: 0,
    isFaceDown: false,
    controllerId: options.controllerId || DEFAULT_PLAYER_ID,
    ownerId: options.ownerId || DEFAULT_PLAYER_ID,
    isTapped: options.isTapped || false,
    isFlipped: false,
    isTurnedFaceUp: false,
    isPhasedOut: false,
    hasSummoningSickness: options.hasSummoningSickness ?? true,
    counters: [],
    damage: 0,
    toughnessModifier: 0,
    powerModifier: 0,
    attachedToId: null,
    attachedCardIds: [],
    enteredBattlefieldTimestamp: Date.now(),
    attachedTimestamp: null,
    chosenBasicLandType: null,
    isToken: options.isToken || false,
    tokenData: options.isToken ? (cardData as unknown as ScryfallCard) : null,
  };
}

/**
 * Create a creature card instance
 */
export function createCreature(
  options: {
    name?: string;
    power?: number;
    toughness?: number;
    controllerId?: string;
    ownerId?: string;
    isTapped?: boolean;
    hasSummoningSickness?: boolean;
    damage?: number;
  } = {},
): CardInstance {
  return createCardInstance({
    ...options,
    name: options.name || "Test Creature",
    power: String(options.power ?? 2),
    toughness: String(options.toughness ?? 2),
    type_line: "Creature — Bear",
  });
}

/**
 * Create a land card instance
 */
export function createLandInstance(
  options: {
    name?: string;
    controllerId?: string;
    ownerId?: string;
    isTapped?: boolean;
  } = {},
): CardInstance {
  return createCardInstance({
    ...options,
    name: options.name || "Test Land",
    type_line: "Land",
  });
}

/**
 * Create a player
 */
export function createPlayer(
  options: {
    id?: string;
    name?: string;
    life?: number;
    maxHandSize?: number;
    poisonCounters?: number;
    landsPlayedThisTurn?: number;
    maxLandsPerTurn?: number;
  } = {},
): Player {
  return {
    id: options.id || DEFAULT_PLAYER_ID,
    name: options.name || "Player",
    life: options.life ?? 40,
    poisonCounters: options.poisonCounters ?? 0,
    commanderDamage: new Map(),
    maxHandSize: options.maxHandSize ?? 7,
    currentHandSizeModifier: 0,
    hasLost: false,
    lossReason: null,
    landsPlayedThisTurn: options.landsPlayedThisTurn ?? 0,
    maxLandsPerTurn: options.maxLandsPerTurn ?? 1,
    manaPool: {
      white: 0,
      blue: 0,
      black: 0,
      red: 0,
      green: 0,
      colorless: 0,
      generic: 0,
    },
    isInCommandZone: false,
    experienceCounters: 0,
    commanderCastCount: 0,
    hasPassedPriority: false,
    hasActivatedManaAbility: false,
    additionalCombatPhase: false,
    additionalMainPhase: false,
    hasOfferedDraw: false,
    hasAcceptedDraw: false,
  };
}

/**
 * Create a zone
 */
export function createZone(
  type: ZoneType,
  playerId: string | null = null,
  cardIds: CardInstance["id"][] = [],
  isRevealed: boolean = false,
): Zone {
  return {
    type,
    playerId,
    cardIds,
    isRevealed,
    visibleTo: [],
  };
}

/**
 * Game state interface (simplified for testing)
 */
export interface GameState {
  players: Player[];
  zones: Record<string, Zone>;
  turn: number;
  phase: string;
  step: string;
  activePlayerId: string;
  priorityPlayerId: string;
  stack: CardInstance[];
}

/**
 * Create a basic game state
 */
export function createGameState(
  options: CreateGameStateOptions = {},
): GameState {
  const playerId = options.playerId || DEFAULT_PLAYER_ID;
  const opponentId = options.opponentId || DEFAULT_OPPONENT_ID;

  // Generate card IDs for zones
  const playerHand = Array.from({ length: options.playerHandSize ?? 7 }, () =>
    generateId("card"),
  );
  const opponentHand = Array.from(
    { length: options.opponentHandSize ?? 7 },
    () => generateId("card"),
  );
  const playerLibrary = Array.from(
    { length: options.playerLibrarySize ?? 20 },
    () => generateId("card"),
  );
  const opponentLibrary = Array.from(
    { length: options.opponentLibrarySize ?? 20 },
    () => generateId("card"),
  );

  return {
    players: [
      createPlayer({
        id: playerId,
        name: "Player",
        life: options.playerLife ?? 40,
      }),
      createPlayer({
        id: opponentId,
        name: "Opponent",
        life: options.opponentLife ?? 40,
      }),
    ],
    zones: {
      [`${playerId}-library`]: createZone("library", playerId, playerLibrary),
      [`${playerId}-hand`]: createZone("hand", playerId, playerHand),
      [`${playerId}-graveyard`]: createZone(
        "graveyard",
        playerId,
        options.playerGraveyard?.map((c) => c.id) ?? [],
      ),
      [`${playerId}-battlefield`]: createZone(
        "battlefield",
        playerId,
        options.battlefieldCards?.map((c) => c.id) ?? [],
      ),
      [`${opponentId}-library`]: createZone(
        "library",
        opponentId,
        opponentLibrary,
      ),
      [`${opponentId}-hand`]: createZone("hand", opponentId, opponentHand),
      [`${opponentId}-graveyard`]: createZone(
        "graveyard",
        opponentId,
        options.opponentGraveyard?.map((c) => c.id) ?? [],
      ),
      [`${opponentId}-battlefield`]: createZone("battlefield", opponentId, []),
      stack: createZone("stack", null),
      command: createZone("command", null),
    },
    turn: options.turn ?? 1,
    phase: options.phase ?? "precombat_main",
    step: options.step ?? "begin",
    activePlayerId: options.activePlayerId ?? playerId,
    priorityPlayerId: playerId,
    stack: [],
  };
}

/**
 * Create a game state during mulligan phase
 */
export function createMulliganState(
  options: Partial<CreateGameStateOptions> = {},
): GameState {
  return createGameState({
    ...options,
    phase: "mulligan",
    step: "mulligan",
    playerHandSize: options.playerHandSize ?? 7,
    opponentHandSize: options.opponentHandSize ?? 7,
  });
}

/**
 * Create a game state during combat phase
 */
export function createCombatState(
  options: Partial<CreateGameStateOptions> = {},
): GameState {
  const playerId = options.playerId || DEFAULT_PLAYER_ID;
  const opponentId = options.opponentId || DEFAULT_OPPONENT_ID;

  // Create some creatures on the battlefield
  const playerCreatures: CardInstance[] = [
    createCreature({
      name: "Player Bear",
      power: 2,
      toughness: 2,
      controllerId: playerId,
      ownerId: playerId,
      isTapped: true, // Attacking
      hasSummoningSickness: false,
    }),
  ];

  const opponentCreatures: CardInstance[] = [
    createCreature({
      name: "Opponent Bear",
      power: 2,
      toughness: 2,
      controllerId: opponentId,
      ownerId: opponentId,
      isTapped: false,
      hasSummoningSickness: false,
    }),
  ];

  return createGameState({
    ...options,
    phase: "combat",
    step: "combat_damage",
    playerHandSize: options.playerHandSize ?? 4,
    opponentHandSize: options.opponentHandSize ?? 5,
    battlefieldCards: [...playerCreatures, ...opponentCreatures],
  });
}

/**
 * Create a game state during main phase
 */
export function createMainPhaseState(
  options: Partial<CreateGameStateOptions> = {},
): GameState {
  const playerId = options.playerId || DEFAULT_PLAYER_ID;

  return createGameState({
    ...options,
    phase: "precombat_main",
    step: "main",
    playerHandSize: options.playerHandSize ?? 5,
    opponentHandSize: options.opponentHandSize ?? 6,
  });
}

/**
 * Reset ID counter (useful for test isolation)
 */
export function resetIdCounter(): void {
  idCounter = 0;
}

export default {
  createCardInstance,
  createCreature,
  createLandInstance,
  createPlayer,
  createZone,
  createGameState,
  createMulliganState,
  createCombatState,
  createMainPhaseState,
  resetIdCounter,
};
