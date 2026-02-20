/**
 * Spell Casting System
 * 
 * This module implements the spell casting system for Magic: The Gathering,
 * including cost validation, stack management, and timing restrictions.
 * 
 * Reference: CR 601 - Casting Spells
 */

import type { 
  GameState, 
  PlayerId, 
  CardInstanceId, 
  StackObject, 
  Target,
  WaitingChoice,
  ChoiceOption
} from "./types";
import { Phase } from "./types";
import { moveCardBetweenZones } from "./zones";
import { spendMana, getSpellManaCost } from "./mana";

/**
 * Generate a unique stack object ID
 */
function generateStackObjectId(): string {
  return `stack-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Check if a player can cast a spell from their hand
 */
export function canCastSpell(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId
): { canCast: boolean; reason?: string } {
  const player = state.players.get(playerId);
  if (!player) {
    return { canCast: false, reason: "Player not found" };
  }

  // Player must have priority
  if (state.priorityPlayerId !== playerId) {
    return { canCast: false, reason: "Player does not have priority" };
  }

  // Verify the card is in player's hand
  const handZone = state.zones.get(`hand-${playerId}`);
  if (!handZone || !handZone.cardIds.includes(cardId)) {
    return { canCast: false, reason: "Card not in hand" };
  }

  // Get the card
  const card = state.cards.get(cardId);
  if (!card) {
    return { canCast: false, reason: "Card not found" };
  }

  // Check phase/timing restrictions
  const currentPhase = state.turn.currentPhase;
  const isMainPhase = currentPhase === Phase.PRECOMBAT_MAIN || currentPhase === Phase.POSTCOMBAT_MAIN;
  const stackIsEmpty = state.stack.length === 0;
  const isActivePlayer = state.turn.activePlayerId === playerId;

  // Check if it's an instant
  const typeLine = card.cardData.type_line?.toLowerCase() || "";
  const isInstant = typeLine.includes("instant");
  
  // Check for cards that can be cast at any time (e.g., flash)
  // This must be checked BEFORE sorcery-speed restrictions since flash overrides them
  const oracleText = card.cardData.oracle_text || "";
  const hasFlash = oracleText.toLowerCase().includes("flash");
  
  // If it's not an instant and doesn't have flash, apply sorcery-speed restrictions
  if (!isInstant && !hasFlash) {
    // Can only cast during main phase with empty stack
    if (!stackIsEmpty) {
      return { canCast: false, reason: "Stack must be empty to cast sorcery-speed spells" };
    }
    
    if (!isMainPhase) {
      return { canCast: false, reason: "Can only cast sorcery-speed spells during main phase" };
    }
    
    // Can only cast on your own turn (never on opponent's turn)
    if (!isActivePlayer) {
      return { canCast: false, reason: "Can only cast sorcery-speed spells during your turn" };
    }
  }
  
  // Flash allows casting at any time - already checked above, but explicit return for clarity
  if (hasFlash) {
    return { canCast: true };
  }

  // For split cards, check both halves
  if (card.cardData.layout === "split") {
    // Split cards can be cast as either half during main phase
    if (!isMainPhase || !stackIsEmpty) {
      return { canCast: false, reason: "Split cards can only be cast during main phase with empty stack" };
    }
  }

  return { canCast: true };
}

/**
 * Cast a spell from hand and put it on the stack
 */
export function castSpell(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
  targets: Target[] = [],
  chosenModes: string[] = [],
  xValue: number = 0
): { success: boolean; state: GameState } {
  // Check if player can cast this spell
  const canCastResult = canCastSpell(state, playerId, cardId);
  if (!canCastResult.canCast) {
    return { success: false, state };
  }

  // Get the card
  const card = state.cards.get(cardId);
  if (!card) {
    return { success: false, state };
  }

  // Verify the card is in player's hand
  const handZone = state.zones.get(`hand-${playerId}`);
  if (!handZone || !handZone.cardIds.includes(cardId)) {
    return { success: false, state };
  }

  // Get the stack zone
  const stackZone = state.zones.get("stack");
  if (!stackZone) {
    return { success: false, state };
  }

  // Calculate and validate the mana cost
  const manaCost = getSpellManaCost(card.cardData);
  
  // Add X value to the cost if applicable
  const totalGeneric = manaCost.generic + xValue;
  const totalWhite = manaCost.white;
  const totalBlue = manaCost.blue;
  const totalBlack = manaCost.black;
  const totalRed = manaCost.red;
  const totalGreen = manaCost.green;
  
  // Check if player has enough mana to cast the spell
  const player = state.players.get(playerId);
  if (!player) {
    return { success: false, state };
  }
  
  const pool = player.manaPool;
  
  // Calculate total colored mana available for generic payment
  const totalColored = pool.white + pool.blue + pool.black + pool.red + pool.green;
  const availableForGeneric = pool.generic + totalColored + pool.colorless;
  
  if (
    pool.white < totalWhite ||
    pool.blue < totalBlue ||
    pool.black < totalBlack ||
    pool.red < totalRed ||
    pool.green < totalGreen ||
    availableForGeneric < totalGeneric
  ) {
    return { success: false, state: state, };
  }

  // Spend the mana
  const spendResult = spendMana(state, playerId, {
    white: totalWhite,
    blue: totalBlue,
    black: totalBlack,
    red: totalRed,
    green: totalGreen,
    generic: totalGeneric,
  });
  
  if (!spendResult.success) {
    return { success: false, state };
  }
  
  // Use the state with mana already spent
  const currentState = spendResult.state;

  // Create stack object
  const stackObject: StackObject = {
    id: generateStackObjectId(),
    type: "spell",
    sourceCardId: cardId,
    controllerId: playerId,
    name: card.cardData.name,
    text: card.cardData.oracle_text || "",
    manaCost: card.cardData.mana_cost ?? null,
    targets,
    chosenModes,
    variableValues: new Map([["X", xValue]]),
    isCountered: false,
    timestamp: Date.now(),
  };

  // Move card from hand to stack
  const moved = moveCardBetweenZones(handZone, stackZone, cardId);
  
  // Update zones using the state with mana spent
  const updatedZones = new Map(currentState.zones);
  updatedZones.set(`hand-${playerId}`, moved.from);
  updatedZones.set("stack", moved.to);

  // Add stack object to stack
  const updatedStack = [...currentState.stack, stackObject];

  // Reset the player's priority pass flag since they just cast something
  const updatedPlayer = currentState.players.get(playerId);
  const updatedPlayers = new Map(currentState.players);
  if (updatedPlayer) {
    updatedPlayers.set(playerId, {
      ...updatedPlayer,
      hasPassedPriority: false,
    });
  }

  // Pass priority to next player
  // Find the next player in APNAP order
  const activePlayerId = currentState.turn.activePlayerId;
  const playerIds = Array.from(currentState.players.keys());
  const currentIndex = playerIds.indexOf(activePlayerId);
  let nextIndex = (currentIndex + 1) % playerIds.length;
  
  // Skip players who have lost
  while (playerIds.length > 1 && nextIndex !== currentIndex) {
    const nextPlayerId = playerIds[nextIndex];
    const nextPlayer = currentState.players.get(nextPlayerId);
    if (nextPlayer && !nextPlayer.hasLost) {
      break;
    }
    nextIndex = (nextIndex + 1) % playerIds.length;
  }

  return {
    success: true,
    state: {
      ...currentState,
      zones: updatedZones,
      stack: updatedStack,
      players: updatedPlayers,
      priorityPlayerId: playerIds[nextIndex],
      consecutivePasses: 0,
      lastModifiedAt: Date.now(),
    },
  };
}

/**
 * Resolve the top object on the stack
 */
export function resolveTopOfStack(
  state: GameState
): GameState {
  if (state.stack.length === 0) {
    return state;
  }

  // Get the top object (last one added resolves first - LIFO)
  const stackObject = state.stack[state.stack.length - 1];
  
  // If it's countered, just remove it
  if (stackObject.isCountered) {
    return removeFromStack(state, stackObject.id);
  }

  // Get the card
  if (stackObject.sourceCardId) {
    const card = state.cards.get(stackObject.sourceCardId);
    if (card) {
      // Move card from stack to appropriate zone based on card type
      const typeLine = card.cardData.type_line?.toLowerCase() || "";
      
      let destinationZone: string;
      if (typeLine.includes("instant") || typeLine.includes("sorcery")) {
        // Instants and sorceries go to graveyard
        destinationZone = `graveyard-${card.controllerId}`;
      } else {
        // Permanents go to battlefield
        destinationZone = `battlefield-${card.controllerId}`;
      }

      const stackZone = state.zones.get("stack");
      const destZone = state.zones.get(destinationZone);

      if (stackZone && destZone) {
        const moved = moveCardBetweenZones(stackZone, destZone, stackObject.sourceCardId);
        
        const updatedZones = new Map(state.zones);
        updatedZones.set("stack", moved.from);
        updatedZones.set(destinationZone, moved.to);

        const updatedStack = state.stack.filter(obj => obj.id !== stackObject.id);

        return {
          ...state,
          zones: updatedZones,
          stack: updatedStack,
          lastModifiedAt: Date.now(),
        };
      }
    }
  }

  // Fallback: just remove from stack
  return removeFromStack(state, stackObject.id);
}

/**
 * Remove an object from the stack
 */
function removeFromStack(
  state: GameState,
  stackObjectId: string
): GameState {
  const updatedStack = state.stack.filter(obj => obj.id !== stackObjectId);

  return {
    ...state,
    stack: updatedStack,
    lastModifiedAt: Date.now(),
  };
}

// Note: counterSpell is already exported in keyword-actions.ts
// Re-export it here for convenience
// export { counterSpell } from "./keyword-actions";

/**
 * Check if a spell/ability can be targeted
 */
export function canTarget(
  targetType: Target["type"],
  targetId: string,
  state: GameState,
  _sourcePlayerId: PlayerId
): boolean {
  switch (targetType) {
    case "card": {
      // Check if card exists
      const card = state.cards.get(targetId);
      if (!card) return false;
      
      // Check if source player can see the card
      // (In reality, would check visibility rules)
      return true;
    }
    case "player": {
      // Check if player exists
      const player = state.players.get(targetId);
      return !!player;
    }
    case "stack": {
      // Check if target stack object exists
      return state.stack.some(obj => obj.id === targetId);
    }
    case "zone": {
      // Check if zone exists
      return state.zones.has(targetId);
    }
    default:
      return false;
  }
}

/**
 * Create a waiting choice for spell targeting
 */
export function createTargetingChoice(
  state: GameState,
  playerId: PlayerId,
  stackObjectId: string,
  spellName: string,
  targetType: Target["type"],
  validTargets: ChoiceOption[]
): WaitingChoice {
  return {
    type: "choose_targets",
    playerId,
    stackObjectId,
    prompt: `Choose target ${targetType} for ${spellName}:`,
    choices: validTargets,
    minChoices: 1,
    maxChoices: 1,
    presentedAt: Date.now(),
  };
}

/**
 * Create a waiting choice for choosing modes
 */
export function createModeChoice(
  state: GameState,
  playerId: PlayerId,
  stackObjectId: string,
  spellName: string,
  availableModes: string[]
): WaitingChoice {
  return {
    type: "choose_mode",
    playerId,
    stackObjectId,
    prompt: `Choose mode for ${spellName}:`,
    choices: availableModes.map(mode => ({
      label: mode,
      value: mode,
      isValid: true,
    })),
    minChoices: 1,
    maxChoices: 1,
    presentedAt: Date.now(),
  };
}

/**
 * Create a waiting choice for X value
 */
export function createXValueChoice(
  state: GameState,
  playerId: PlayerId,
  stackObjectId: string,
  spellName: string,
  maxX: number
): WaitingChoice {
  const choices: ChoiceOption[] = [];
  for (let i = 0; i <= maxX; i++) {
    choices.push({
      label: i.toString(),
      value: i,
      isValid: true,
    });
  }

  return {
    type: "choose_value",
    playerId,
    stackObjectId,
    prompt: `Choose value for X in ${spellName}:`,
    choices,
    minChoices: 1,
    maxChoices: 1,
    presentedAt: Date.now(),
  };
}

/**
 * Get valid targets for a spell based on its text
 */
export function getValidTargets(
  _stackObjectId: string,
  _state: GameState,
  _playerId: PlayerId
): ChoiceOption[] {
  // For now, return empty array
  // In a full implementation, this would parse the spell's text
  // to determine what kinds of targets are valid
  return [];
}

/**
 * Check if all required targets for a spell are valid
 */
export function validateSpellTargets(
  stackObject: StackObject,
  state: GameState
): boolean {
  // If no targets required, spell is valid
  if (stackObject.targets.length === 0) {
    return true;
  }

  // Check all targets are valid
  for (const target of stackObject.targets) {
    if (!target.isValid) {
      return false;
    }
  }

  return true;
}

/**
 * Get the mana value of a spell from its card data
 * Uses the card-instance's getManaValue for accurate mana value calculation
 */
export function getSpellManaValueFromCard(card: { mana_cost?: string; cmc?: number }): number {
  // Mana value is already available from card.cardData.cmc
  return card.cmc ?? 0;
}
