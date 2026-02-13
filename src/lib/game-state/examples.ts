/**
 * Example usage and demonstrations of the game state module
 *
 * This file shows how to use the game state data structures
 * and can serve as the basis for unit tests.
 */

import type { CardInstance, PlayerId, Zone } from "./types";
import {
  createInitialGameState,
  loadDeckForPlayer,
  startGame,
  drawCard,
  passPriority,
  dealDamageToPlayer,
  gainLife,
  concede,
  getPlayerLibrary,
  getPlayerHand,
  getPlayerBattlefield,
} from "./game-state";
import {
  createCardInstance,
  createToken,
  tapCard,
  untapCard,
  addCounters,
  markDamage,
  resetDamage,
  attachCard,
  detachCard,
  changeController,
  isCreature,
  isLand,
  isPlaneswalker,
  isPermanent,
  getPower,
  getToughness,
  hasLethalDamage,
  canAttack,
  canBlock,
  isDoubleFaced,
  transformCard,
  setCardFace,
  getCurrentFaceName,
  phaseOut,
  phaseIn,
  addPowerModifier,
  addToughnessModifier,
  setPowerModifier,
  setToughnessModifier,
  clearSummoningSickness,
  hasCounter,
  getCounterCount,
  isAttached,
  hasAttachments,
} from "./card-instance";
import {
  createZone,
  createPlayerZones,
  addCardToZone,
  removeCardFromZone,
  moveCardBetweenZones,
  getTopCard,
  shuffleZone,
  countCards,
  drawCards,
  millCards,
  exileCards,
} from "./zones";
import {
  createTurn,
  advancePhase,
  isMainPhase,
  isCombatPhase,
  canCastSorcerySpeedSpells,
  getPhaseName,
  getPhaseShortName,
} from "./turn-phases";
import { ScryfallCard } from "@/app/actions";

/**
 * Example 1: Create a new game
 */
export function example1_createGame() {
  console.log("Example 1: Creating a new game");

  // Create a 2-player game
  // eslint-disable-next-line prefer-const -- state is returned, not reassigned
  let state = createInitialGameState(["Alice", "Bob"], 20, false);

  console.log(`Game ID: ${state.gameId}`);
  console.log(`Players: ${Array.from(state.players.values()).map((p) => p.name).join(", ")}`);
  console.log(`Starting life: ${Array.from(state.players.values())[0].life}`);
  console.log(`Turn: ${state.turn.turnNumber}`);
  console.log(`Current phase: ${getPhaseName(state.turn.currentPhase)}`);

  return state;
}

/**
 * Example 2: Load decks and start
 */
export async function example2_loadDecksAndStart() {
  console.log("\nExample 2: Loading decks and starting game");

  // Create game
  let state = createInitialGameState(["Alice", "Bob"], 20, false);

  // Get player IDs
  const playerIds = Array.from(state.players.keys());
  const [player1Id, player2Id] = playerIds;

  // Mock deck data (in real usage, this would come from Scryfall)
  const mockDeck: ScryfallCard[] = Array.from({ length: 60 }, (_, i) => ({
    id: `card-${i}`,
    name: `Mock Card ${i}`,
    type_line: i < 24 ? "Creature — Human Warrior" : "Land",
    cmc: i < 24 ? Math.floor(Math.random() * 5) + 1 : 0,
    color_identity: i < 24 ? ["W"] : [],
  })) as ScryfallCard[];

  // Load decks
  state = loadDeckForPlayer(state, player1Id, mockDeck);
  state = loadDeckForPlayer(state, player2Id, mockDeck);

  // Check library sizes
  const p1Library = getPlayerLibrary(state, player1Id);
  const p2Library = getPlayerLibrary(state, player2Id);

  console.log(`Player 1 library: ${p1Library?.cardIds.length || 0} cards`);
  console.log(`Player 2 library: ${p2Library?.cardIds.length || 0} cards`);

  // Start the game (draws opening hands)
  state = startGame(state);

  // Check hand sizes
  const p1Hand = getPlayerHand(state, player1Id);
  const p2Hand = getPlayerHand(state, player2Id);

  console.log(`Player 1 hand: ${p1Hand?.cardIds.length || 0} cards`);
  console.log(`Player 2 hand: ${p2Hand?.cardIds.length || 0} cards`);

  return state;
}

/**
 * Example 3: Card operations
 */
export function example3_cardOperations() {
  console.log("\nExample 3: Card operations");

  // Create a mock card
  const mockCard: ScryfallCard = {
    id: "test-creature",
    name: "Test Creature",
    type_line: "Creature — Human Warrior",
    cmc: 3,
    power: "3",
    toughness: "3",
    color_identity: ["W"],
    oracle_text: "First strike",
  } as ScryfallCard;

  // Create card instance
  let card = createCardInstance(mockCard, "player-1", "player-1");

  console.log(`Card: ${card.cardData.name}`);
  console.log(`Is creature: ${isCreature(card)}`);
  console.log(`Is permanent: ${isPermanent(card)}`);
  console.log(`Power: ${getPower(card)}`);
  console.log(`Toughness: ${getToughness(card)}`);
  console.log(`Can attack: ${canAttack(card)}`); // Should be false (summoning sickness)

  // Tap the card
  card = tapCard(card);
  console.log(`Is tapped: ${card.isTapped}`);

  // Untap the card
  card = untapCard(card);
  console.log(`Is tapped: ${card.isTapped}`);

  // Add counters
  card = addCounters(card, "+1/+1", 2);
  console.log(`+1/+1 counters: ${card.counters.find((c) => c.type === "+1/+1")?.count || 0}`);

  // Mark damage
  card = markDamage(card, 2);
  console.log(`Damage marked: ${card.damage}`);

  return card;
}

/**
 * Example 4: Zone operations
 */
export function example4_zoneOperations() {
  console.log("\nExample 4: Zone operations");

  // Create a zone
  let library = createZone("library", "player-1", {
    initialCards: ["card-1", "card-2", "card-3", "card-4", "card-5"],
  });

  console.log(`Library size: ${countCards(library)}`);
  console.log(`Top card: ${getTopCard(library)}`);

  // Draw a card
  const hand = createZone("hand", "player-1");
  const topCard = getTopCard(library);

  if (topCard) {
    const moved = moveCardBetweenZones(library, hand, topCard);
    library = moved.from;

    console.log(`Library size after draw: ${countCards(library)}`);
    console.log(`Hand size: ${countCards(moved.to)}`);
  }

  // Shuffle zone
  library = shuffleZone(library);
  console.log(`Library shuffled`);

  return { library, hand };
}

/**
 * Example 5: Turn phases
 */
export function example5_turnPhases() {
  console.log("\nExample 5: Turn phases");

  // Create a turn
  let turn = createTurn("player-1", 1, true);

  console.log(`Turn ${turn.turnNumber}`);
  console.log(`Active player: ${turn.activePlayerId}`);
  console.log(`Phase: ${getPhaseName(turn.currentPhase)}`);
  console.log(`Is main phase: ${isMainPhase(turn.currentPhase)}`);
  console.log(`Is combat phase: ${isCombatPhase(turn.currentPhase)}`);

  // Advance through phases
  for (let i = 0; i < 5; i++) {
    turn = advancePhase(turn);
    console.log(`\nAdvanced to: ${getPhaseShortName(turn.currentPhase)}`);

    if (isMainPhase(turn.currentPhase)) {
      console.log("  → Can cast sorcery-speed spells (if stack is empty)");
    }
  }

  return turn;
}

/**
 * Example 6: Combat and damage
 */
export function example6_combatAndDamage() {
  console.log("\nExample 6: Combat and damage");

  let state = createInitialGameState(["Alice", "Bob"], 20, false);
  state = startGame(state);

  const playerIds = Array.from(state.players.keys());
  const [player1Id, player2Id] = playerIds;

  console.log(`Player 1 life: ${state.players.get(player1Id)?.life}`);
  console.log(`Player 2 life: ${state.players.get(player2Id)?.life}`);

  // Deal damage to player 2
  state = dealDamageToPlayer(state, player2Id, 5);
  console.log(`Player 2 life after damage: ${state.players.get(player2Id)?.life}`);

  // Player 1 gains life
  state = gainLife(state, player1Id, 3);
  console.log(`Player 1 life after gain: ${state.players.get(player1Id)?.life}`);

  // Check win condition
  state = dealDamageToPlayer(state, player2Id, 20);
  console.log(`Player 2 life after lethal: ${state.players.get(player2Id)?.life}`);
  console.log(`Game status: ${state.status}`);
  console.log(`Winners: ${state.winners.length > 0 ? Array.from(state.players.values()).find((p) => p.id === state.winners[0])?.name : "None"}`);

  return state;
}

/**
 * Example 7: Tokens
 */
export function example7_tokens() {
  console.log("\nExample 7: Creating tokens");

  // Create a token definition
  const tokenData: ScryfallCard = {
    id: "token-goblin",
    name: "Goblin Token",
    type_line: "Creature — Goblin",
    cmc: 0,
    power: "1",
    toughness: "1",
    color_identity: ["R"],
  } as ScryfallCard;

  // Create token
  const token = createToken(tokenData, "player-1", "player-1");

  console.log(`Token: ${token.cardData.name}`);
  console.log(`Is token: ${token.isToken}`);
  console.log(`Power: ${getPower(token)}`);
  console.log(`Toughness: ${getToughness(token)}`);

  return token;
}

/**
 * Example 8: Priority passing
 */
export function example8_priorityPassing() {
  console.log("\nExample 8: Priority passing");

  let state = createInitialGameState(["Alice", "Bob"], 20, false);
  state = startGame(state);

  const playerIds = Array.from(state.players.keys());
  const [player1Id, player2Id] = playerIds;

  console.log(`Priority: ${state.players.get(state.priorityPlayerId!)?.name}`);
  console.log(`Consecutive passes: ${state.consecutivePasses}`);

  // Player 1 passes priority
  state = passPriority(state, player1Id);
  console.log(`\nPlayer 1 passed`);
  console.log(`Priority: ${state.players.get(state.priorityPlayerId!)?.name}`);
  console.log(`Consecutive passes: ${state.consecutivePasses}`);

  // Player 2 passes priority
  state = passPriority(state, player2Id);
  console.log(`\nPlayer 2 passed`);
  console.log(`Priority: ${state.players.get(state.priorityPlayerId!)?.name}`);
  console.log(`Consecutive passes: ${state.consecutivePasses}`);
  console.log(`Phase: ${getPhaseName(state.turn.currentPhase)}`);

  return state;
}

/**
 * Example 9: Full game simulation (simplified)
 */
export function example9_gameSimulation() {
  console.log("\nExample 9: Simplified game simulation");

  // Create and start game
  let state = createInitialGameState(["Alice", "Bob"], 20, false);

  const playerIds = Array.from(state.players.keys());
  const [player1Id, player2Id] = playerIds;

  // Load decks
  const mockDeck: ScryfallCard[] = Array.from({ length: 60 }, (_, i) => ({
    id: `card-${i}`,
    name: `Card ${i}`,
    type_line: i < 24 ? "Creature" : "Land",
    cmc: i < 24 ? Math.floor(Math.random() * 5) + 1 : 0,
    color_identity: [],
  })) as ScryfallCard[];

  state = loadDeckForPlayer(state, player1Id, mockDeck);
  state = loadDeckForPlayer(state, player2Id, mockDeck);
  state = startGame(state);

  console.log("=== Game Started ===");
  console.log(`Player 1 hand: ${getPlayerHand(state, player1Id)?.cardIds.length || 0} cards`);
  console.log(`Player 2 hand: ${getPlayerHand(state, player2Id)?.cardIds.length || 0} cards`);

  // Both players pass priority for a few phases
  console.log("\n=== Passing priority through phases ===");
  for (let i = 0; i < 3; i++) {
    state = passPriority(state, player1Id);
    state = passPriority(state, player2Id);
    console.log(`Phase: ${getPhaseShortName(state.turn.currentPhase)}`);
  }

  console.log("\n=== Simulation Complete ===");
  console.log(`Game status: ${state.status}`);

  return state;
}

/**
 * Example 10: Double-faced cards
 */
export function example10_doubleFacedCards() {
  console.log("\nExample 10: Double-faced card transformations");

  // Create a double-faced card (e.g., Delver of Secrets)
  const doubleFacedCard: ScryfallCard = {
    id: "delver-of-secrets",
    name: "Delver of Secrets",
    type_line: "Creature — Human Wizard",
    layout: "transform",
    cmc: 1,
    power: "1",
    toughness: "1",
    color_identity: ["U"],
    card_faces: [
      {
        name: "Delver of Secrets",
        type_line: "Creature — Human Wizard",
        power: "1",
        toughness: "1",
      },
      {
        name: "Insectile Aberration",
        type_line: "Creature — Human Insect",
        power: "3",
        toughness: "2",
      },
    ],
  } as ScryfallCard;

  let card = createCardInstance(doubleFacedCard, "player-1", "player-1");

  console.log(`Initial face: ${getCurrentFaceName(card)}`);
  console.log(`Power: ${getPower(card)}, Toughness: ${getToughness(card)}`);
  console.log(`Is double-faced: ${isDoubleFaced(card)}`);

  // Transform the card
  card = transformCard(card);
  console.log(`\nAfter transformation:`);
  console.log(`Current face: ${getCurrentFaceName(card)}`);
  console.log(`Power: ${getPower(card)}, Toughness: ${getToughness(card)}`);

  // Transform back
  card = transformCard(card);
  console.log(`\nAfter transforming back:`);
  console.log(`Current face: ${getCurrentFaceName(card)}`);
  console.log(`Power: ${getPower(card)}, Toughness: ${getToughness(card)}`);

  return card;
}

/**
 * Example 11: Power and toughness modifiers
 */
export function example11_powerToughnessModifiers() {
  console.log("\nExample 11: Power and toughness modifications");

  const mockCard: ScryfallCard = {
    id: "test-creature",
    name: "Test Creature",
    type_line: "Creature — Human Warrior",
    cmc: 3,
    power: "2",
    toughness: "2",
    color_identity: ["W"],
  } as ScryfallCard;

  let card = createCardInstance(mockCard, "player-1", "player-1");

  console.log(`Initial: ${getPower(card)}/${getToughness(card)}`);

  // Add +1/+1 counter (simulated via modifier for simplicity)
  card = addPowerModifier(card, 1);
  card = addToughnessModifier(card, 1);
  console.log(`After +1/+1: ${getPower(card)}/${getToughness(card)}`);

  // Add another +2/+2
  card = addPowerModifier(card, 2);
  card = addToughnessModifier(card, 2);
  console.log(`After +2/+2: ${getPower(card)}/${getToughness(card)}`);

  // Set specific values
  card = setPowerModifier(card, 5);
  card = setToughnessModifier(card, 5);
  console.log(`Set to +5/+5: ${getPower(card)}/${getToughness(card)}`);

  return card;
}

/**
 * Example 12: Advanced card state
 */
export function example12_advancedCardState() {
  console.log("\nExample 12: Advanced card state operations");

  const mockCard: ScryfallCard = {
    id: "advanced-creature",
    name: "Advanced Creature",
    type_line: "Creature — Human Warrior",
    cmc: 3,
    power: "3",
    toughness: "3",
    color_identity: ["W"],
  } as ScryfallCard;

  let card = createCardInstance(mockCard, "player-1", "player-1");

  // Clear summoning sickness
  card = clearSummoningSickness(card);
  console.log(`Summoning sickness cleared: ${!card.hasSummoningSickness}`);

  // Add various counters
  card = addCounters(card, "+1/+1", 3);
  card = addCounters(card, "charge", 2);
  console.log(`+1/+1 counters: ${getCounterCount(card, "+1/+1")}`);
  console.log(`Charge counters: ${getCounterCount(card, "charge")}`);
  console.log(`Has +1/+1 counters: ${hasCounter(card, "+1/+1")}`);
  console.log(`Has verse counters: ${hasCounter(card, "verse")}`);

  // Phase out
  card = phaseOut(card);
  console.log(`Phased out: ${card.isPhasedOut}`);

  // Phase in
  card = phaseIn(card);
  console.log(`Phased in: ${!card.isPhasedOut}`);

  // Attach to another card
  card = attachCard(card, "target-card-id");
  console.log(`Is attached: ${isAttached(card)}`);
  console.log(`Attached to: ${card.attachedToId}`);

  // Detach
  card = detachCard(card);
  console.log(`After detach - Is attached: ${isAttached(card)}`);

  return card;
}

/**
 * Run all examples
 */
export function runAllExamples() {
  console.log("=".repeat(60));
  console.log("GAME STATE MODULE EXAMPLES");
  console.log("=".repeat(60));

  example1_createGame();
  example2_loadDecksAndStart();
  example3_cardOperations();
  example4_zoneOperations();
  example5_turnPhases();
  example6_combatAndDamage();
  example7_tokens();
  example8_priorityPassing();
  example9_gameSimulation();
  example10_doubleFacedCards();
  example11_powerToughnessModifiers();
  example12_advancedCardState();

  console.log("\n" + "=".repeat(60));
  console.log("ALL EXAMPLES COMPLETE");
  console.log("=".repeat(60));
}

// Export all examples for individual testing
export default {
  example1_createGame,
  example2_loadDecksAndStart,
  example3_cardOperations,
  example4_zoneOperations,
  example5_turnPhases,
  example6_combatAndDamage,
  example7_tokens,
  example8_priorityPassing,
  example9_gameSimulation,
  example10_doubleFacedCards,
  example11_powerToughnessModifiers,
  example12_advancedCardState,
  runAllExamples,
};
