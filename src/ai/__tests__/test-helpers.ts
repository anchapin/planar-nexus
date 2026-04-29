import type { AIGameState, AIPlayerState, AIPermanent } from "@/lib/game-state/types";

export function createMockPlayerState(
  id: string,
  life: number = 20,
  battlefield: AIPermanent[] = [],
): AIPlayerState {
  return {
    id,
    name: `Player ${id}`,
    life,
    poisonCounters: 0,
    hand: [],
    battlefield,
    graveyard: [],
    exile: [],
    library: 40,
    manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    commanderDamage: {},
    landsPlayedThisTurn: 0,
    hasPassedPriority: false,
  };
}

export function createMockPermanent(
  id: string,
  name: string,
  type: "creature" | "land" | "artifact" | "enchantment" | "planeswalker" = "creature",
  power?: number,
  toughness?: number,
  tapped: boolean = false,
  manaValue: number = 1,
  keywords: string[] = [],
): AIPermanent {
  return {
    id,
    cardInstanceId: id,
    name,
    type,
    controller: "player1",
    tapped,
    manaValue,
    power,
    toughness,
    keywords,
  };
}

export function createTestGameState(
  player1Life: number = 20,
  player2Life: number = 20,
  player1Battlefield: AIPermanent[] = [],
  player2Battlefield: AIPermanent[] = [],
  currentPlayer: string = "player1",
  phase: "beginning" | "precombat_main" | "combat" | "postcombat_main" | "end" = "precombat_main",
): AIGameState {
  return {
    players: {
      player1: createMockPlayerState("player1", player1Life, player1Battlefield),
      player2: createMockPlayerState("player2", player2Life, player2Battlefield),
    },
    turnInfo: {
      currentTurn: 1,
      currentPlayer,
      priority: currentPlayer,
      phase,
      step: phase.includes("combat") ? "combat" : "main",
    },
    stack: [],
    combat: {
      inCombatPhase: phase === "combat",
      attackers: [],
      blockers: {},
    },
  };
}
