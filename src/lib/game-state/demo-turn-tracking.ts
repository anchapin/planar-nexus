/**
 * Demonstration script for multiplayer turn and round tracking
 * Issue #5: Phase 1.1 - Implement turn/round tracking for multiplayer
 *
 * Run with: npx tsx src/lib/game-state/demo-turn-tracking.ts
 */

import {
  createInitialGameState,
  startGame,
} from "./game-state";
import {
  createTurn,
  startNextTurn,
  createTurnOrder,
  getNextPlayerInTurnOrder,
  getPreviousPlayerInTurnOrder,
  getAttackableOpponents,
  isLeftNeighbor,
  isRightNeighbor,
  getTurnsUntilPlayerTurn,
  getRoundInfo,
  getPlayerSeats,
  initializeTurnOrder,
  getPhaseName,
} from "./turn-phases";

function printHeader(title: string) {
  console.log("\n" + "=".repeat(70));
  console.log(`  ${title}`);
  console.log("=".repeat(70));
}


function demoClockwiseTurnOrder() {
  printHeader("Demo 1: Clockwise Turn Order (4-Player Commander)");

  const state = createInitialGameState(
    ["Alice", "Bob", "Charlie", "Diana"],
    40,
    true,
    "clockwise"
  );

  console.log("\nTurn Order (Clockwise):");
  state.turn.turnOrder.forEach((playerId, index) => {
    const playerName = state.players.get(playerId)?.name || "Unknown";
    console.log(`  ${index + 1}. ${playerName}${index === 0 ? " (going first)" : ""}`);
  });

  const roundInfo = getRoundInfo(state.turn);
  console.log(`\nRound: ${roundInfo.roundNumber}`);
  console.log(`Turn: ${state.turn.turnNumber}`);
  console.log(`Active Player: ${state.players.get(state.turn.activePlayerId)?.name}`);
  console.log(`Phase: ${getPhaseName(state.turn.currentPhase)}`);
}

function demoRandomTurnOrder() {
  printHeader("Demo 2: Random Turn Order");

  const playerNames = ["Alice", "Bob", "Charlie", "Diana"];

  console.log("\nCreating 3 games with random turn order:");
  for (let gameNum = 1; gameNum <= 3; gameNum++) {
    const state = createInitialGameState(playerNames, 20, false, "random");
    console.log(`\nGame ${gameNum} turn order:`);
    state.turn.turnOrder.forEach((playerId, index) => {
      const player = state.players.get(playerId);
      console.log(`  ${index + 1}. ${player?.name || "Unknown"}`);
    });
  }
}

function demoRoundTracking() {
  printHeader("Demo 3: Round Tracking Through Multiple Turns");

  const state = createInitialGameState(["Alice", "Bob", "Charlie"], 20, false);
  let turn = state.turn;

  console.log("\nSimulating 8 turns:");
  console.log("Turn | Player    | Round | Player in Round");
  console.log("-----|-----------|-------|-----------------");

  for (let i = 0; i < 8; i++) {
    const playerName = state.players.get(turn.activePlayerId)?.name || "Unknown";
    const roundInfo = getRoundInfo(turn);
    console.log(
      `${String(turn.turnNumber).padStart(4)} | ${playerName.padEnd(9)} | ${String(roundInfo.roundNumber).padStart(5)} | ${roundInfo.currentPlayerInRound}/${roundInfo.turnsInRound}`
    );

    // Get next player
    const nextPlayerIndex = (turn.activePlayerIndex + 1) % turn.turnOrder.length;
    const nextPlayerId = turn.turnOrder[nextPlayerIndex];
    turn = startNextTurn(turn, nextPlayerId, false);
  }
}

function demoPlayerNeighbors() {
  printHeader("Demo 4: Player Neighbors (Attack Directions)");

  const state = createInitialGameState(
    ["Alice", "Bob", "Charlie", "Diana"],
    40,
    true
  );

  console.log("\nSeating arrangement (clockwise):");
  const seats = getPlayerSeats(state.turn);

  seats.forEach((seat) => {
    const playerName = state.players.get(seat.playerId)?.name || "Unknown";
    const leftNeighbor = state.players.get(seat.leftNeighborId || "")?.name || "None";
    const rightNeighbor = state.players.get(seat.rightNeighborId || "")?.name || "None";
    console.log(`  ${playerName}:`);
    console.log(`    Left (clockwise): ${leftNeighbor}`);
    console.log(`    Right (counter-clockwise): ${rightNeighbor}`);
  });

  // Show who can attack whom
  const activePlayer = state.players.get(state.turn.activePlayerId);
  const playerIds = Array.from(state.players.keys());
  const attackableOpponents = getAttackableOpponents(state.turn, playerIds);

  console.log(`\n${activePlayer?.name} can attack:`);
  attackableOpponents.forEach((opponentId) => {
    const opponent = state.players.get(opponentId);
    if (opponent) {
      const turnsUntil = getTurnsUntilPlayerTurn(state.turn, opponentId);
      const isLeft = isLeftNeighbor(state.turn, opponentId, state.turn.activePlayerId);
      const isRight = isRightNeighbor(state.turn, opponentId, state.turn.activePlayerId);
      const position = isLeft ? "left neighbor" : isRight ? "right neighbor" : "across the table";
      console.log(`  ${opponent.name} (${turnsUntil} turns away, ${position})`);
    }
  });
}

function demoTurnDistance() {
  printHeader("Demo 5: Turns Until Each Player's Turn");

  const state = createInitialGameState(
    ["Alice", "Bob", "Charlie", "Diana", "Eve"],
    20,
    false
  );

  const activePlayer = state.players.get(state.turn.activePlayerId);
  console.log(`\nCurrent player: ${activePlayer?.name}`);
  console.log("\nTurns until each player's turn:");

  state.players.forEach((player, playerId) => {
    const turnsUntil = getTurnsUntilPlayerTurn(state.turn, playerId);
    const status = playerId === state.turn.activePlayerId ? " (now)" : "";
    console.log(`  ${player.name}: ${turnsUntil}${status}`);
  });
}

function demoTwoPlayerGame() {
  printHeader("Demo 6: Two-Player Game (Traditional)");

  const state = createInitialGameState(["Alice", "Bob"], 20, false);
  let turn = state.turn;

  console.log("\nSimulating 6 turns (3 rounds):");
  console.log("Turn | Player   | Round | Phase");
  console.log("-----|----------|-------|------------------");

  for (let i = 0; i < 6; i++) {
    const playerName = state.players.get(turn.activePlayerId)?.name || "Unknown";
    const phase = getPhaseName(turn.currentPhase);
    console.log(
      `${String(turn.turnNumber).padStart(4)} | ${playerName.padEnd(8)} | ${String(turn.roundNumber).padStart(5)} | ${phase}`
    );

    // Get next player
    const nextPlayerIndex = (turn.activePlayerIndex + 1) % turn.turnOrder.length;
    const nextPlayerId = turn.turnOrder[nextPlayerIndex];
    turn = startNextTurn(turn, nextPlayerId, false);
  }
}

function demoCustomStartingPlayer() {
  printHeader("Demo 7: Custom Starting Player");

  const playerIds = ["p1", "p2", "p3", "p4"];
  const turnOrder = initializeTurnOrder(playerIds, "custom", "p3");

  console.log("\nCustom turn order with p3 starting:");
  turnOrder.forEach((playerId, index) => {
    console.log(`  ${index + 1}. ${playerId}${index === 0 ? " (starting)" : ""}`);
  });

  // Create turn with this order
  const turn = createTurn("p3", 1, true, turnOrder, "custom");
  console.log(`\nActive player: ${turn.activePlayerId}`);
  console.log(`Round: ${turn.roundNumber}`);
  console.log(`Next player: ${getNextPlayerInTurnOrder(turn)}`);
  console.log(`Previous player: ${getPreviousPlayerInTurnOrder(turn)}`);
}

function demoCompleteGameCycle() {
  printHeader("Demo 8: Complete Round Cycle (3-Player Free-For-All)");

  const state = createInitialGameState(
    ["Alice", "Bob", "Charlie"],
    20,
    false
  );
  let turn = state.turn;

  console.log("\nStarting Round 1:");
  console.log("Turn | Player   | Round | Round Start | Round End");
  console.log("-----|----------|-------|-------------|-----------");

  for (let i = 0; i < 9; i++) {
    const playerName = state.players.get(turn.activePlayerId)?.name || "Unknown";
    const roundInfo = getRoundInfo(turn);

    const roundStart = roundInfo.isRoundStart ? "Yes" : "No";
    const roundEnd = roundInfo.isRoundEnd ? "Yes" : "No";

    console.log(
      `${String(turn.turnNumber).padStart(4)} | ${playerName.padEnd(8)} | ${String(roundInfo.roundNumber).padStart(5)} | ${roundStart.padStart(11)} | ${roundEnd.padStart(9)}`
    );

    const nextPlayerIndex = (turn.activePlayerIndex + 1) % turn.turnOrder.length;
    const nextPlayerId = turn.turnOrder[nextPlayerIndex];
    turn = startNextTurn(turn, nextPlayerId, false);
  }

  console.log("\nCompleted 3 full rounds!");
}

// Run all demos
function runAllDemos() {
  console.log("\n");
  console.log("╔══════════════════════════════════════════════════════════════════════╗");
  console.log("║  MULTIPLAYER TURN & ROUND TRACKING DEMONSTRATION                    ║");
  console.log("║  Issue #5: Phase 1.1 - Implement turn/round tracking for multiplayer ║");
  console.log("╚══════════════════════════════════════════════════════════════════════╝");

  demoClockwiseTurnOrder();
  demoRandomTurnOrder();
  demoRoundTracking();
  demoPlayerNeighbors();
  demoTurnDistance();
  demoTwoPlayerGame();
  demoCustomStartingPlayer();
  demoCompleteGameCycle();

  console.log("\n" + "=".repeat(70));
  console.log("  ALL DEMONSTRATIONS COMPLETE");
  console.log("=".repeat(70) + "\n");
}

// Run demos if this file is executed directly
runAllDemos();
