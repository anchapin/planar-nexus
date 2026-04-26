#!/usr/bin/env node
/**
 * Quick test to verify mana pool emptying behavior
 */

import { createInitialGameState, startGame } from "../src/lib/game-state/game-state";
import { playLand, activateManaAbility } from "../src/lib/game-state/mana";
import { passPriority } from "../src/lib/game-state/index";
import { Phase } from "../src/lib/game-state/types";

const state = startGame(createInitialGameState(["Alice", "Bob"], 20, false));
const playerIds = Array.from(state.players.keys());
const aliceId = playerIds[0];
const bobId = playerIds[1];

// Put a Mountain on Alice's battlefield
const mountainData = {
  id: "mock-mountain",
  name: "Mountain",
  type_line: "Land — Mountain",
  keywords: [],
  oracle_text: "{T}: Add {R}.",
  mana_cost: "",
  cmc: 0,
  colors: [],
  legalities: { standard: "legal", commander: "legal" },
  color_identity: ["R"],
  card_faces: undefined,
  layout: "normal",
};

import { createCardInstance } from "../src/lib/game-state/card-instance";
const mountain = createCardInstance(mountainData as any, aliceId, aliceId);
state.cards.set(mountain.id, mountain);
const bf = state.zones.get(`${aliceId}-battlefield`)!;
state.zones.set(`${aliceId}-battlefield`, { ...bf, cardIds: [...bf.cardIds, mountain.id] });

state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
state.priorityPlayerId = aliceId;

// Tap mountain for mana
const activateResult = activateManaAbility(state, aliceId, mountain.id, 0);
if (!activateResult.success) {
  console.log("❌ Failed to activate mana ability:", activateResult.error);
  process.exit(1);
}
let newState = activateResult.state;
console.log("Mana after activation:", JSON.stringify(newState.players.get(aliceId)?.manaPool));

// Both players pass priority → phase should advance → mana should empty
newState = passPriority(newState, bobId);
console.log("After Bob passes - phase:", newState.turn.currentPhase, "mana:", JSON.stringify(newState.players.get(aliceId)?.manaPool));

newState = passPriority(newState, aliceId);
console.log("After Alice passes - phase:", newState.turn.currentPhase, "mana:", JSON.stringify(newState.players.get(aliceId)?.manaPool));

const finalMana = newState.players.get(aliceId)?.manaPool;
if (finalMana?.red === 0) {
  console.log("✅ Mana pool correctly emptied at phase transition");
} else {
  console.log("❌ Mana pool NOT emptied! Remaining mana:", JSON.stringify(finalMana));
}
