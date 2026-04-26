/**
 * Game Board Page - Single Player Implementation
 * Displays the active game board for single-player games against AI or self-play
 *
 * Issue #521: Connect single-player UI to game engine (implement playable game)
 */

"use client";

import {
  useState,
  useEffect,
  useCallback,
  Suspense,
  useRef,
  Fragment,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  ArrowLeft,
  Heart,
  Clock,
  Info,
  RotateCcw,
  Play,
  Pause,
  SkipForward,
  Hand,
  Sparkles,
  Shuffle,
  CheckCircle2,
  ChevronRight,
  Flag,
} from "lucide-react";
import Image from "next/image";
import { GameBoard } from "@/components/game-board";
import type { PlayerCount, ZoneType } from "@/types/game";
import { useToast } from "@/hooks/use-toast";
import type { ScryfallCard, SavedDeck } from "@/app/actions";
import type { Permanent, HandCard } from "@/ai/game-state-evaluator";
import { gameLogger } from "@/lib/logger";
import { GameTutorial } from "@/components/game-tutorial";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

// Game engine imports
import {
  createInitialGameState,
  loadDeckForPlayer,
  startGame,
  drawCard,
  passPriority,
  checkStateBasedActions,
  concede,
  serializeGameState,
  deserializeGameState,
  playLand,
  castSpell,
  activateManaAbility,
  formatManaPool,
  type ManaAbilityOption,
  isLand,
  isCreature,
  tapCard,
  untapCard,
  declareAttackers,
  declareBlockers,
  resolveCombatDamage,
  gainLife,
  dealDamageToPlayer,
  offerDraw,
  acceptDraw,
  declineDraw,
  emptyManaPool,
  getTotalMana,
  canCastSpell,
  canPlayLand,
  type GameState,
  type Player,
  type CardInstance,
  type Phase,
} from "@/lib/game-state";

import { ValidationService } from "@/lib/validation-service";
import {
  parseModes,
  parseXCost,
  parseKicker,
  parseAttraction,
} from "@/lib/game-state/oracle-text-parser";

// AI imports
import {
  GameStateEvaluator,
  type GameState as AIGameState,
  type PlayerState,
  type TurnInfo,
} from "@/ai/game-state-evaluator";
import { getDifficultyConfig, type DifficultyLevel } from "@/ai/ai-difficulty";
import { CombatDecisionTree } from "@/ai/decision-making";

// Local storage for active games
import { savedGamesManager, createSavedGame } from "@/lib/saved-games";

// Sample basic lands for deck generation
const BASIC_LANDS = ["Plains", "Island", "Swamp", "Mountain", "Forest"];

/**
 * Generate a simple deck for testing/demo purposes
 * In a real implementation, this would use the player's actual deck
 */
function generateSimpleDeck(): ScryfallCard[] {
  const deck: ScryfallCard[] = [];

  // 24 basic lands (even distribution)
  for (let i = 0; i < 24; i++) {
    const landName = BASIC_LANDS[i % 5];
    deck.push({
      id: `land-${i}`,
      name: landName,
      type_line: "Basic Land",
      mana_cost: "",
      oracle_text:
        landName === "Plains"
          ? "{T}: Add {W}"
          : landName === "Island"
            ? "{T}: Add {U}"
            : landName === "Swamp"
              ? "{T}: Add {B}"
              : landName === "Mountain"
                ? "{T}: Add {R}"
                : "{T}: Add {G}",
      colors: [],
      color_identity: [
        landName === "Plains"
          ? "W"
          : landName === "Island"
            ? "U"
            : landName === "Swamp"
              ? "B"
              : landName === "Mountain"
                ? "R"
                : "G",
      ],
      legalities: { standard: "legal", modern: "legal", commander: "legal" },
      images: { normal: "", art_crop: "" },
      cmc: 0,
      power: undefined,
      toughness: undefined,
    } as ScryfallCard);
  }

  // 36 creature spells (simple bears for demo)
  for (let i = 0; i < 36; i++) {
    const isGrizzly = i % 2 === 0;
    deck.push({
      id: `creature-${i}`,
      name: isGrizzly ? "Grizzly Bears" : "Balduvian Bears",
      type_line: "Creature — Bear",
      mana_cost: "{1}{G}",
      oracle_text: "",
      colors: ["G"],
      color_identity: ["G"],
      legalities: { standard: "legal", modern: "legal", commander: "legal" },
      images: { normal: "", art_crop: "" },
      cmc: 2,
      power: "2",
      toughness: "2",
    } as ScryfallCard);
  }

  return deck;
}

/**
 * Helper to create a basic land card
 */
function createLandCard(
  name: string,
  color: string,
  index: number,
): ScryfallCard {
  return {
    id: `land-${name}-${index}`,
    name,
    type_line: "Basic Land",
    mana_cost: "",
    oracle_text: `{T}: Add {${color}}`,
    colors: [],
    color_identity: [color],
    legalities: { standard: "legal", modern: "legal", commander: "legal" },
    images: { normal: "", art_crop: "" },
    cmc: 0,
    power: undefined,
    toughness: undefined,
  } as ScryfallCard;
}

/**
 * Helper to create a creature card
 */
function createCreatureCard(
  name: string,
  manaCost: string,
  power: number,
  toughness: number,
  colors: string[],
  index: number,
): ScryfallCard {
  // Simple CMC calculation from mana cost
  let cmc = 0;
  const matches = manaCost.match(/\{([^}]+)\}/g);
  if (matches) {
    for (const m of matches) {
      const symbol = m.slice(1, -1);
      const num = parseInt(symbol, 10);
      cmc += isNaN(num) ? 1 : num;
    }
  }

  return {
    id: `creature-${name.replace(/\s+/g, "-")}-${index}`,
    name,
    type_line: "Creature",
    mana_cost: manaCost,
    oracle_text: "",
    colors,
    color_identity: colors,
    legalities: { standard: "legal", modern: "legal", commander: "legal" },
    images: { normal: "", art_crop: "" },
    cmc,
    power: power.toString(),
    toughness: toughness.toString(),
  } as ScryfallCard;
}

/**
 * Generate a themed starter deck based on deck ID
 */
function generateStarterDeck(deckId: string): ScryfallCard[] {
  const deck: ScryfallCard[] = [];

  if (deckId === "starter-aggro") {
    // 24 lands: 12 Mountain, 12 Forest
    for (let i = 0; i < 12; i++) deck.push(createLandCard("Mountain", "R", i));
    for (let i = 0; i < 12; i++) deck.push(createLandCard("Forest", "G", i));
    // 36 aggressive creatures
    for (let i = 0; i < 12; i++)
      deck.push(createCreatureCard("Goblin Guide", "{R}", 2, 2, ["R"], i));
    for (let i = 0; i < 12; i++)
      deck.push(
        createCreatureCard(
          "Burning-Tree Emissary",
          "{R}{G}",
          2,
          2,
          ["R", "G"],
          i,
        ),
      );
    for (let i = 0; i < 12; i++)
      deck.push(createCreatureCard("Kird Ape", "{R}", 1, 1, ["R"], i));
  } else if (deckId === "starter-control") {
    // 24 lands: 12 Island, 12 Plains
    for (let i = 0; i < 12; i++) deck.push(createLandCard("Island", "U", i));
    for (let i = 0; i < 12; i++) deck.push(createLandCard("Plains", "W", i));
    // 36 control creatures
    for (let i = 0; i < 12; i++)
      deck.push(createCreatureCard("Cloudfin Raptor", "{U}", 0, 1, ["U"], i));
    for (let i = 0; i < 12; i++)
      deck.push(createCreatureCard("Wall of Omens", "{1}{W}", 0, 4, ["W"], i));
    for (let i = 0; i < 12; i++)
      deck.push(createCreatureCard("Serra Angel", "{3}{W}{W}", 4, 4, ["W"], i));
  } else if (deckId === "starter-test") {
    // Bulk filler cards first (drawn after opening hand)
    for (let i = 0; i < 10; i++) deck.push(createLandCard("Mountain", "R", i));
    for (let i = 0; i < 10; i++) deck.push(createLandCard("Island", "U", i));
    for (let i = 0; i < 10; i++) deck.push(createLandCard("Forest", "G", i));
    for (let i = 0; i < 10; i++)
      deck.push(createCreatureCard("Goblin Guide", "{R}", 2, 2, ["R"], i));
    for (let i = 0; i < 10; i++)
      deck.push(createCreatureCard("Memnite", "{0}", 1, 1, [], i));
    for (let i = 0; i < 10; i++)
      deck.push(createCreatureCard("Counterspell", "{U}{U}", 0, 0, ["U"], i));
    for (let i = 0; i < 10; i++)
      deck.push(createCreatureCard("Lightning Bolt", "{R}", 3, 0, ["R"], i));
    // Test-specific cards last (opening hand = last 7 of array, drawn from end)
    // Arrange so last 7 cards are: Forest, Island, Mountain, Ward Beetle, Cycling Drake, Flashback Bolt, Convoke Angel
    for (let i = 0; i < 9; i++)
      deck.push(createCreatureCard("Ward Beetle", "{1}{G}", 2, 3, ["G"], i));
    for (let i = 0; i < 9; i++)
      deck.push(createCreatureCard("Cycling Drake", "{3}{U}", 2, 4, ["U"], i));
    for (let i = 0; i < 9; i++)
      deck.push(createCreatureCard("Explore Ranger", "{1}{G}", 2, 2, ["G"], i));
    for (let i = 0; i < 9; i++)
      deck.push(createCreatureCard("Convoke Angel", "{3}{W}", 3, 3, ["W"], i));
    for (let i = 0; i < 9; i++)
      deck.push(createCreatureCard("Flashback Bolt", "{1}{R}", 2, 1, ["R"], i));
    // Ensure opening hand: Forest, Island, Mountain, Ward Beetle, Cycling Drake, Flashback Bolt, Convoke Angel
    deck.push(createLandCard("Forest", "G", 99));
    deck.push(createLandCard("Island", "U", 99));
    deck.push(createLandCard("Mountain", "R", 99));
    deck.push(createCreatureCard("Ward Beetle", "{1}{G}", 2, 3, ["G"], 99));
    deck.push(createCreatureCard("Cycling Drake", "{3}{U}", 2, 4, ["U"], 99));
    deck.push(createCreatureCard("Flashback Bolt", "{1}{R}", 2, 1, ["R"], 99));
    deck.push(createCreatureCard("Convoke Angel", "{3}{W}", 3, 3, ["W"], 99));
  } else {
    // starter-midrange: 12 Swamp, 12 Forest
    for (let i = 0; i < 12; i++) deck.push(createLandCard("Swamp", "B", i));
    for (let i = 0; i < 12; i++) deck.push(createLandCard("Forest", "G", i));
    // 36 midrange creatures
    for (let i = 0; i < 12; i++)
      deck.push(createCreatureCard("Llanowar Elves", "{G}", 1, 1, ["G"], i));
    for (let i = 0; i < 12; i++)
      deck.push(
        createCreatureCard("Balduvian Bears", "{1}{G}", 2, 2, ["G"], i),
      );
    for (let i = 0; i < 12; i++)
      deck.push(
        createCreatureCard("Golgari Brownscale", "{1}{G}{G}", 2, 3, ["G"], i),
      );
  }

  return deck;
}

/**
 * Generate an AI deck based on theme and difficulty
 */
function generateAIDeck(
  theme: string,
  _difficulty: DifficultyLevel,
): ScryfallCard[] {
  const lowerTheme = theme.toLowerCase();
  if (
    lowerTheme.includes("aggro") ||
    lowerTheme.includes("red") ||
    lowerTheme.includes("aggressive")
  ) {
    return generateStarterDeck("starter-aggro");
  }
  if (lowerTheme.includes("control") || lowerTheme.includes("blue")) {
    return generateStarterDeck("starter-control");
  }
  if (lowerTheme.includes("midrange") || lowerTheme.includes("green")) {
    return generateStarterDeck("starter-midrange");
  }
  return generateSimpleDeck();
}

/**
 * Expand DeckCard[] (with count) into individual ScryfallCard[] for the engine
 */
function expandDeckCards(deckCards: SavedDeck["cards"]): ScryfallCard[] {
  const expanded: ScryfallCard[] = [];
  for (const card of deckCards) {
    for (let i = 0; i < card.count; i++) {
      // Create a unique ID for each copy
      const copy: ScryfallCard = {
        ...card,
        id: `${card.id}-${i}`,
      };
      expanded.push(copy);
    }
  }
  return expanded;
}

/**
 * Convert engine GameState to AI-evaluable format
 */
function convertToAIGameState(
  engineState: GameState,
  evaluatingPlayerId: string,
): AIGameState {
  const players: { [key: string]: PlayerState } = {};

  engineState.players.forEach((player, playerId) => {
    const battlefield = Array.from(engineState.cards.values())
      .filter((card) => {
        const zone = engineState.zones.get(`${playerId}-battlefield`);
        return zone?.cardIds.includes(card.id);
      })
      .map((card) => {
        const typeLine = card.cardData.type_line.toLowerCase();
        let permanentType:
          | "creature"
          | "land"
          | "artifact"
          | "enchantment"
          | "planeswalker" = "creature";
        if (typeLine.includes("land")) permanentType = "land";
        else if (typeLine.includes("artifact")) permanentType = "artifact";
        else if (typeLine.includes("enchantment"))
          permanentType = "enchantment";
        else if (typeLine.includes("planeswalker"))
          permanentType = "planeswalker";
        else if (typeLine.includes("creature")) permanentType = "creature";

        return {
          id: card.id,
          cardInstanceId: card.id,
          name: card.cardData.name,
          type: permanentType,
          controller: card.controllerId,
          tapped: card.isTapped,
          power: card.cardData.power ? parseInt(card.cardData.power) : 0,
          toughness: card.cardData.toughness
            ? parseInt(card.cardData.toughness)
            : 0,
          manaValue: card.cardData.cmc,
        };
      });

    const handZone = engineState.zones.get(`${playerId}-hand`);
    const handCards =
      handZone?.cardIds.map((id) => {
        const card = engineState.cards.get(id);
        return {
          cardInstanceId: card?.id || "",
          name: card?.cardData.name || "Unknown",
          type: card?.cardData.type_line || "Unknown",
          manaValue: card?.cardData.cmc || 0,
        };
      }) || [];

    const graveyardZone = engineState.zones.get(`${playerId}-graveyard`);
    const libraryZone = engineState.zones.get(`${playerId}-library`);

    players[playerId] = {
      id: playerId,
      life: player.life,
      poisonCounters: player.poisonCounters,
      commanderDamage: Object.fromEntries(player.commanderDamage),
      hand: handCards,
      graveyard: graveyardZone?.cardIds || [],
      exile: [],
      library: libraryZone?.cardIds.length || 0,
      battlefield,
      manaPool: {
        W: player.manaPool.white,
        U: player.manaPool.blue,
        B: player.manaPool.black,
        R: player.manaPool.red,
        G: player.manaPool.green,
        C: player.manaPool.colorless,
      },
    };
  });

  // Convert combat state
  const combat = {
    inCombatPhase: engineState.combat.inCombatPhase,
    attackers: engineState.combat.attackers.map((a) => ({
      cardInstanceId: a.cardId,
      defenderId: a.defenderId,
      isAttackingPlaneswalker: a.isAttackingPlaneswalker,
      damageToDeal: a.damageToDeal,
      hasFirstStrike: a.hasFirstStrike,
      hasDoubleStrike: a.hasDoubleStrike,
    })),
    blockers: Object.fromEntries(
      Array.from(engineState.combat.blockers.entries()).map(
        ([attackerId, blockers]) => [
          attackerId,
          blockers.map((b) => ({
            cardInstanceId: b.cardId,
            attackerId: b.attackerId,
            damageToDeal: b.damageToDeal,
            blockerOrder: b.blockerOrder,
            hasFirstStrike: b.hasFirstStrike,
            hasDoubleStrike: b.hasDoubleStrike,
          })),
        ],
      ),
    ),
  };

  return {
    players,
    turnInfo: {
      currentTurn: engineState.turn.turnNumber,
      currentPlayer: engineState.turn.activePlayerId,
      phase: engineState.turn.currentPhase as TurnInfo["phase"],
      priority: engineState.priorityPlayerId || "",
    },
    stack: engineState.stack.map((s) => {
      const sourceCard = s.sourceCardId
        ? engineState.cards.get(s.sourceCardId)
        : null;
      return {
        id: s.id,
        cardInstanceId: s.sourceCardId || "",
        name: sourceCard?.cardData.name || s.name,
        controller: s.controllerId,
        type: s.type,
        manaValue: sourceCard?.cardData.cmc || 0,
      };
    }),
    combat,
  };
}

/**
 * AI Opponent class for single-player games
 */
class AIOpponent {
  private difficulty: DifficultyLevel;
  private evaluator: GameStateEvaluator | null = null;
  private combatDecider: CombatDecisionTree | null = null;

  constructor(difficulty: DifficultyLevel = "medium") {
    this.difficulty = difficulty;
  }

  /**
   * Evaluate the current game state from AI's perspective
   */
  evaluateState(
    gameState: GameState,
    aiPlayerId: string,
  ): { score: number; recommendations: string[] } {
    try {
      const aiState = convertToAIGameState(gameState, aiPlayerId);
      this.evaluator = new GameStateEvaluator(
        aiState,
        aiPlayerId,
        this.difficulty,
      );
      const evaluation = this.evaluator.evaluate();

      return {
        score: evaluation.totalScore,
        recommendations: evaluation.recommendedActions,
      };
    } catch (error) {
      gameLogger.error("AI evaluation error:", error);
      return { score: 0, recommendations: [] };
    }
  }

  /**
   * Decide whether to attack
   */
  shouldAttack(gameState: GameState, aiPlayerId: string): boolean {
    const aiState = convertToAIGameState(gameState, aiPlayerId);
    this.combatDecider = new CombatDecisionTree(
      aiState,
      aiPlayerId,
      this.difficulty,
    );

    const attackPlan = this.combatDecider.generateAttackPlan();
    return attackPlan.attacks.length > 0;
  }

  /**
   * Decide which creatures to attack with
   */
  getAttackers(gameState: GameState, aiPlayerId: string): string[] {
    const aiState = convertToAIGameState(gameState, aiPlayerId);
    this.combatDecider = new CombatDecisionTree(
      aiState,
      aiPlayerId,
      this.difficulty,
    );

    const attackPlan = this.combatDecider.generateAttackPlan();
    return attackPlan.attacks.map((a) => a.creatureId);
  }

  /**
   * Decide whether to block and with what
   */
  getBlockers(
    gameState: GameState,
    aiPlayerId: string,
    _attackerIds: string[],
  ): { [attackerId: string]: string[] } {
    const aiState = convertToAIGameState(gameState, aiPlayerId);
    this.combatDecider = new CombatDecisionTree(
      aiState,
      aiPlayerId,
      this.difficulty,
    );

    // Convert real engine attackers to Permanent objects for the combat decider
    const attackers: Permanent[] = [];
    for (const a of gameState.combat.attackers) {
      const card = gameState.cards.get(a.cardId);
      if (!card) continue;
      const typeLine = card.cardData.type_line.toLowerCase();
      let permanentType: Permanent["type"] = "creature";
      if (typeLine.includes("land")) permanentType = "land";
      else if (typeLine.includes("artifact")) permanentType = "artifact";
      else if (typeLine.includes("enchantment")) permanentType = "enchantment";
      else if (typeLine.includes("planeswalker"))
        permanentType = "planeswalker";
      else if (typeLine.includes("creature")) permanentType = "creature";

      attackers.push({
        id: card.id,
        cardInstanceId: card.id,
        name: card.cardData.name,
        type: permanentType,
        controller: card.controllerId,
        tapped: card.isTapped,
        power: card.cardData.power ? parseInt(card.cardData.power) : 0,
        toughness: card.cardData.toughness
          ? parseInt(card.cardData.toughness)
          : 0,
        manaValue: card.cardData.cmc,
      } as Permanent);
    }

    const blockPlan = this.combatDecider.generateBlockingPlan(attackers);

    const assignments: { [attackerId: string]: string[] } = {};
    blockPlan.blocks.forEach((b) => {
      if (b.attackerId && b.blockerId) {
        if (!assignments[b.attackerId]) assignments[b.attackerId] = [];
        assignments[b.attackerId].push(b.blockerId);
      }
    });

    return assignments;
  }

  /**
   * Make a decision for the AI's turn
   */
  makeDecision(
    gameState: GameState,
    aiPlayerId: string,
  ): {
    action:
      | "play_land"
      | "cast_spell"
      | "attack"
      | "block"
      | "pass"
      | "tap_mana";
    data?: AIDecisionData;
  } {
    const config = getDifficultyConfig(this.difficulty);

    // Apply randomness based on difficulty
    if (Math.random() < config.randomnessFactor) {
      // Make a random/silly move
      return { action: "pass" };
    }

    // Phase-specific decisions
    if (gameState.turn.currentPhase === "declare_attackers") {
      const attackers = this.getAttackers(gameState, aiPlayerId);
      if (attackers.length > 0) {
        return { action: "attack", data: { attackers } as AttackDecisionData };
      }
      return { action: "pass" };
    }

    if (gameState.turn.currentPhase === "declare_blockers") {
      return { action: "block" };
    }

    const evaluation = this.evaluateState(gameState, aiPlayerId);

    // Simple decision logic based on evaluation
    if (evaluation.score > 0.5) {
      // Ahead - play aggressively
      return { action: "play_land" };
    } else if (evaluation.score < -0.5) {
      // Behind - play defensively
      return { action: "pass" };
    }

    // Default: play lands and develop board
    return { action: "play_land" };
  }
}

/**
 * AI decision data types
 */
interface AttackDecisionData {
  attackers: string[];
}

interface BlockDecisionData {
  blockers: { [attackerId: string]: string[] };
}

interface ManaDecisionData {
  cardId: string;
}

type AIDecisionData =
  | AttackDecisionData
  | BlockDecisionData
  | ManaDecisionData
  | undefined;

/**
 * Get or create active game from storage
 */
async function getOrCreateActiveGame(
  gameId: string,
  playerName: string,
  mode: "ai" | "self-play",
  difficulty: DifficultyLevel,
  playerDeckCards?: ScryfallCard[] | null,
  playerDeckName?: string,
  deckId?: string | null,
  aiTheme?: string,
): Promise<{ gameState: GameState; isNew: boolean; loadedDeckName?: string }> {
  // Try to load from saved games
  const savedGame = await savedGamesManager.getSavedGame(gameId);

  if (savedGame) {
    try {
      const gameState = JSON.parse(savedGame.gameStateJson) as GameState;
      return { gameState, isNew: false };
    } catch (error) {
      gameLogger.error("Failed to parse saved game state:", error);
    }
  }

  // Create new game
  const opponentName =
    mode === "ai"
      ? `AI (${getDifficultyConfig(difficulty).displayName})`
      : "You (Self Play)";
  const gameState = createInitialGameState(
    [playerName, opponentName],
    20,
    false,
  );

  const player = Array.from(gameState.players.values())[0];
  const opponent = Array.from(gameState.players.values())[1];

  // Determine player deck
  let playerDeck: ScryfallCard[];
  let loadedDeckName: string;
  if (playerDeckCards && playerDeckCards.length > 0) {
    playerDeck = playerDeckCards;
    loadedDeckName = playerDeckName || "Custom Deck";
  } else if (deckId && deckId.startsWith("starter-")) {
    playerDeck = generateStarterDeck(deckId);
    loadedDeckName = playerDeckName || deckId;
  } else {
    playerDeck = generateSimpleDeck();
    loadedDeckName = playerDeckName || "Simple Deck";
  }

  // Determine AI opponent deck
  const opponentDeck =
    mode === "ai"
      ? generateAIDeck(aiTheme || "aggressive", difficulty)
      : generateSimpleDeck();

  const shouldShuffle = deckId !== "starter-test";
  let updatedState = loadDeckForPlayer(
    gameState,
    player.id,
    playerDeck,
    shouldShuffle,
  );
  updatedState = loadDeckForPlayer(updatedState, opponent.id, opponentDeck);

  // Note: We don't call startGame here anymore - mulligan is handled in the component
  updatedState.status = "not_started";

  return { gameState: updatedState, isNew: true, loadedDeckName };
}

/**
 * Save game state to storage
 */
async function saveActiveGame(gameState: GameState): Promise<void> {
  try {
    await savedGamesManager.saveToAutoSave(gameState, null, 0);
  } catch (error) {
    gameLogger.error("Failed to save game state:", error);
  }
}

/**
 * Visual phase tracker showing current turn phase
 */
function PhaseTracker({
  currentPhase,
  isPlayerTurn,
}: {
  currentPhase: Phase;
  isPlayerTurn: boolean;
}) {
  const phases: { key: Phase; label: string }[] = [
    { key: "untap" as Phase, label: "Untap" },
    { key: "upkeep" as Phase, label: "Upkeep" },
    { key: "draw" as Phase, label: "Draw" },
    { key: "precombat_main" as Phase, label: "Main 1" },
    { key: "begin_combat" as Phase, label: "Combat" },
    { key: "declare_attackers" as Phase, label: "Attack" },
    { key: "declare_blockers" as Phase, label: "Block" },
    { key: "combat_damage_first_strike" as Phase, label: "First Strike" },
    { key: "combat_damage" as Phase, label: "Damage" },
    { key: "end_combat" as Phase, label: "End Combat" },
    { key: "postcombat_main" as Phase, label: "Main 2" },
    { key: "end" as Phase, label: "End" },
    { key: "cleanup" as Phase, label: "Cleanup" },
  ];

  const currentIndex = phases.findIndex((p) => p.key === currentPhase);

  return (
    <div className="flex items-center gap-1 px-4 py-1.5 bg-background/80 border-b overflow-x-auto">
      {phases.map((phase, idx) => {
        const isCurrent = idx === currentIndex;
        const isPast = idx < currentIndex;
        return (
          <Fragment key={phase.key}>
            <div
              className={`
                px-2 py-0.5 rounded text-[10px] font-medium whitespace-nowrap transition-colors
                ${isCurrent ? "bg-primary text-primary-foreground" : ""}
                ${isPast ? "text-muted-foreground/60" : "text-muted-foreground"}
              `}
              title={
                isCurrent
                  ? "Current phase — you can take actions here"
                  : phase.label
              }
            >
              {phase.label}
            </div>
            {idx < phases.length - 1 && (
              <ChevronRight
                className={`h-3 w-3 flex-shrink-0 ${isPast ? "text-muted-foreground/30" : "text-muted-foreground/50"}`}
              />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

/**
 * Check if a land has a shockland-style ETB choice
 * (enters tapped unless you pay 2 life)
 */
function hasShocklandChoice(card: CardInstance): boolean {
  const text = card.cardData.oracle_text?.toLowerCase() || "";
  return (
    text.includes("pay 2 life") &&
    text.includes("enters") &&
    text.includes("tapped")
  );
}

function GameBoardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  const [gameState, setGameState] = useState<GameState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playerName, setPlayerName] = useState<string>("Player");
  const [isAIThinking, setIsAIThinking] = useState(false);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(true);

  // State for actions requiring targeting
  const [pendingAction, setPendingAction] = useState<{
    type: "cast" | "activate" | "target" | "attack" | "block";
    cardId?: string;
    abilityIndex?: number;
    attackerId?: string; // For blocking
    spellRequiresTarget?: boolean;
    targetCount?: number; // Number of targets needed
  } | null>(null);

  // Combat state
  const [declaredAttackers, setDeclaredAttackers] = useState<
    { cardId: string; defenderId: string }[]
  >([]);
  const [declaredBlockers, setDeclaredBlockers] = useState<
    Map<string, string[]>
  >(new Map());

  // Mulligan state
  const [showMulligan, setShowMulligan] = useState(false);
  const [mulliganCount, setMulliganCount] = useState(0);
  const [playerHandCards, setPlayerHandCards] = useState<CardInstance[]>([]);
  const [isGameStarted, setIsGameStarted] = useState(false);
  const [playerDeckName, setPlayerDeckName] = useState("Your Deck");

  // Shockland ETB choice state
  const [shocklandChoice, setShocklandChoice] = useState<{
    cardId: string;
    cardName: string;
    chosenLandType?: string;
  } | null>(null);

  // Mana ability choice state
  const [manaAbilityChoice, setManaAbilityChoice] = useState<{
    cardId: string;
    cardName: string;
    options: ManaAbilityOption[];
  } | null>(null);

  // Basic land type choice state (for cards like Multiversal Passage)
  const [basicLandTypeChoice, setBasicLandTypeChoice] = useState<{
    cardId: string;
    cardName: string;
    targetCardId?: string;
  } | null>(null);

  // Modal spell mode choice state (for Choose One/Two spells like Abrade)
  const [spellModeChoice, setSpellModeChoice] = useState<{
    cardId: string;
    cardName: string;
    modes: string[];
    modeCount: number;
  } | null>(null);

  // X-Cost spell state (for spells like Alchemist's Torrent)
  const [xCostChoice, setXCostChoice] = useState<{
    cardId: string;
    cardName: string;
    maxX: number;
    description: string;
  } | null>(null);

  // Kicker spell state (for spells like Burst Lightning)
  const [kickerChoice, setKickerChoice] = useState<{
    cardId: string;
    cardName: string;
    kickerCost: string;
    description: string;
  } | null>(null);

  // Attraction spell state (for Unfinity Attraction cards)
  const [attractionChoice, setAttractionChoice] = useState<{
    cardId: string;
    cardName: string;
    spinResult: number;
    revealedCards: string[];
  } | null>(null);

  // Zone viewer state
  const [viewingZone, setViewingZone] = useState<{
    zone: ZoneType;
    playerId: string;
    cards: CardInstance[];
  } | null>(null);

  const aiOpponentRef = useRef<AIOpponent | null>(null);
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const aiExecutionRef = useRef(false);
  const gameStateRef = useRef<GameState | null>(null);

  // Keep gameStateRef in sync to avoid stale closures in async AI logic
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  // Get game parameters from URL
  const gameId = searchParams.get("id");
  const mode = (searchParams.get("mode") as "ai" | "self-play") || "ai";
  const difficulty =
    (searchParams.get("difficulty") as DifficultyLevel) || "medium";
  const deckId = searchParams.get("deckId");
  const aiTheme = searchParams.get("theme") || "aggressive";

  // Initialize AI opponent
  useEffect(() => {
    if (mode === "ai") {
      aiOpponentRef.current = new AIOpponent(difficulty);
    }
  }, [mode, difficulty]);

  // Guard to ensure game initialization only runs once
  const hasInitializedRef = useRef(false);

  // Load or create game
  useEffect(() => {
    if (hasInitializedRef.current) return;
    hasInitializedRef.current = true;

    const initializeGame = async () => {
      try {
        setIsLoading(true);

        // Get player name from localStorage
        const storedName =
          localStorage.getItem("planar_nexus_player_name") || "Player";
        setPlayerName(storedName);

        // Look up the selected deck from sessionStorage (set by single-player page)
        let playerDeckCards: ScryfallCard[] | null = null;
        let selectedDeckName: string | undefined;

        if (deckId) {
          try {
            const sessionDeck = sessionStorage.getItem(
              "planar_nexus_selected_deck",
            );
            if (sessionDeck) {
              const parsed = JSON.parse(sessionDeck) as SavedDeck;
              if (parsed.id === deckId && parsed.cards.length > 0) {
                playerDeckCards = expandDeckCards(parsed.cards);
                selectedDeckName = parsed.name;
              }
            }
          } catch (e) {
            // Ignore sessionStorage errors
          }

          if (!playerDeckCards && deckId.startsWith("starter-")) {
            selectedDeckName =
              deckId === "starter-aggro"
                ? "Starter Aggro"
                : deckId === "starter-control"
                  ? "Starter Control"
                  : "Starter Midrange";
          }
        }

        if (gameId) {
          const {
            gameState: loadedState,
            isNew,
            loadedDeckName,
          } = await getOrCreateActiveGame(
            gameId,
            storedName,
            mode,
            difficulty,
            playerDeckCards,
            selectedDeckName,
            deckId,
            aiTheme,
          );

          if (loadedDeckName) {
            setPlayerDeckName(loadedDeckName);
          }

          if (isNew) {
            // Draw opening hand for player and show mulligan
            const player = Array.from(loadedState.players.values())[0];
            let stateWithHand = loadedState;

            // Draw 7 cards for player
            for (let i = 0; i < 7; i++) {
              stateWithHand = drawCard(stateWithHand, player.id);
            }

            // Get player's hand cards for display
            const handZone = stateWithHand.zones.get(`${player.id}-hand`);
            const handCards =
              handZone?.cardIds
                .map((id) => stateWithHand.cards.get(id))
                .filter((c): c is CardInstance => c !== undefined) || [];
            setPlayerHandCards(handCards);
            setShowMulligan(true);
            setMulliganCount(0);
            setIsGameStarted(false);

            setGameState(stateWithHand);
            await saveActiveGame(stateWithHand);

            toast({
              title: "Game Started",
              description: `Review your opening hand. You can keep or mulligan.`,
            });
          } else {
            // Loading existing game - check if it's already in progress
            setGameState(loadedState);

            if (loadedState.status === "not_started") {
              // Player refreshed during mulligan - resume it
              const player = Array.from(loadedState.players.values()).find(
                (p) => p.name === storedName,
              );
              if (player) {
                const handZone = loadedState.zones.get(`${player.id}-hand`);
                const handCards =
                  handZone?.cardIds
                    .map((id) => loadedState.cards.get(id))
                    .filter((c): c is CardInstance => c !== undefined) || [];
                if (handCards.length > 0) {
                  setPlayerHandCards(handCards);
                  setShowMulligan(true);
                  setIsGameStarted(false);
                } else {
                  // No hand somehow - just start the game
                  setIsGameStarted(true);
                }
              } else {
                setIsGameStarted(true);
              }
            } else {
              setIsGameStarted(loadedState.status === "in_progress");
            }
          }
        } else {
          // Create new game with new ID
          const newGameId = `GAME-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
          const { gameState: newState, loadedDeckName } =
            await getOrCreateActiveGame(
              newGameId,
              storedName,
              mode,
              difficulty,
              playerDeckCards,
              selectedDeckName,
              deckId,
              aiTheme,
            );

          if (loadedDeckName) {
            setPlayerDeckName(loadedDeckName);
          }

          // Draw opening hand for player and show mulligan
          const player = Array.from(newState.players.values())[0];
          let stateWithHand = newState;

          // Draw 7 cards for player
          for (let i = 0; i < 7; i++) {
            stateWithHand = drawCard(stateWithHand, player.id);
          }

          // Get player's hand cards for display
          const handZone = stateWithHand.zones.get(`${player.id}-hand`);
          const handCards =
            handZone?.cardIds
              .map((id) => stateWithHand.cards.get(id))
              .filter((c): c is CardInstance => c !== undefined) || [];
          setPlayerHandCards(handCards);
          setShowMulligan(true);
          setMulliganCount(0);
          setIsGameStarted(false);

          setGameState(stateWithHand);
          await saveActiveGame(stateWithHand);

          // Update URL with game ID
          router.replace(
            `/game/${newGameId}?id=${newGameId}&mode=${mode}&difficulty=${difficulty}&deckId=${deckId || ""}`,
          );

          toast({
            title: "Game Started",
            description: `Review your opening hand. You can keep or mulligan.`,
          });
        }

        setError(null);
      } catch (err) {
        gameLogger.error("Failed to initialize game:", err);
        setError("Failed to load game. Please try again.");
        toast({
          title: "Error",
          description: "Failed to initialize game state.",
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };

    initializeGame();
  }, []);

  // Auto-save game state periodically
  useEffect(() => {
    if (autoSaveEnabled && gameState && gameState.status === "in_progress") {
      autoSaveTimerRef.current = setInterval(async () => {
        if (gameId) {
          await saveActiveGame(gameState);
        }
      }, 30000); // Save every 30 seconds
    }

    return () => {
      if (autoSaveTimerRef.current) {
        clearInterval(autoSaveTimerRef.current);
      }
    };
  }, [autoSaveEnabled, gameState, gameId]);

  // Execute AI action when it has priority
  useEffect(() => {
    if (!gameState || mode !== "ai") return;
    if (gameState.status !== "in_progress" || isAIThinking) return;
    if (aiExecutionRef.current) return;

    const aiPlayer = Array.from(gameState.players.values()).find((p) =>
      p.name.includes("AI"),
    );

    if (!aiPlayer || gameState.priorityPlayerId !== aiPlayer.id) return;

    aiExecutionRef.current = true;

    const executeAITurn = async () => {
      setIsAIThinking(true);

      // Simulate thinking time based on difficulty
      const config = getDifficultyConfig(difficulty);
      const thinkTime = 800 + config.lookaheadDepth * 400;

      await new Promise((resolve) => setTimeout(resolve, thinkTime));

      // Read latest state from ref to avoid stale closure
      const latestState = gameStateRef.current;
      if (!latestState) return;

      // Verify AI still has priority in latest state
      const currentAIPlayer = Array.from(latestState.players.values()).find(
        (p) => p.name.includes("AI"),
      );
      if (
        !currentAIPlayer ||
        latestState.priorityPlayerId !== currentAIPlayer.id
      )
        return;

      // Get AI decision (fallback if ref not initialized)
      let decision;
      if (aiOpponentRef.current) {
        decision = aiOpponentRef.current.makeDecision(
          latestState,
          currentAIPlayer.id,
        );
      } else {
        decision = { action: "pass" };
      }

      // Execute the decision on latest state
      let newState = { ...latestState };

      switch (decision.action) {
        case "pass":
          // Auto-resolve combat if entering damage phase
          if (newState.turn.currentPhase === "combat_damage") {
            const combatResult = resolveCombatDamage(newState);
            if (combatResult.success) {
              newState = combatResult.state;
              toast({
                title: "Combat Resolved",
                description: combatResult.description,
              });
            }
          }
          newState = passPriority(newState, currentAIPlayer.id);
          toast({
            title: "AI Action",
            description: "AI opponent passed priority",
          });
          break;

        case "attack":
          if (newState.turn.currentPhase === "declare_attackers") {
            const attackData = decision.data as AttackDecisionData | undefined;
            const attackers = attackData?.attackers || [];
            const player = Array.from(newState.players.values()).find(
              (p) => p.name === playerName,
            );
            if (player && attackers.length > 0) {
              const attackResult = declareAttackers(
                newState,
                attackers.map((id: string) => ({
                  cardId: id,
                  defenderId: player.id,
                })),
              );
              if (attackResult.success) {
                newState = attackResult.state;
                toast({
                  title: "AI Action",
                  description: `AI is attacking with ${attackers.length} creatures!`,
                });
              } else {
                newState = passPriority(newState, currentAIPlayer.id);
              }
            } else {
              newState = passPriority(newState, currentAIPlayer.id);
            }
          } else {
            newState = passPriority(newState, currentAIPlayer.id);
          }
          break;

        case "block":
          if (newState.turn.currentPhase === "declare_blockers") {
            // AI blocking logic
            const player = Array.from(newState.players.values()).find(
              (p) => p.name === playerName,
            );
            if (player && newState.combat.attackers.length > 0) {
              const attackerIds = newState.combat.attackers.map(
                (a) => a.cardId,
              );
              const assignments =
                aiOpponentRef.current?.getBlockers(
                  newState,
                  currentAIPlayer.id,
                  attackerIds,
                ) || {};
              const blockerMap = new Map<string, string[]>();

              Object.entries(assignments).forEach(
                ([attackerId, blockerIds]) => {
                  blockerMap.set(attackerId, blockerIds);
                },
              );

              if (blockerMap.size > 0) {
                const blockResult = declareBlockers(newState, blockerMap);
                if (blockResult.success) {
                  newState = blockResult.state;
                  toast({
                    title: "AI Action",
                    description: `AI blocked with ${Array.from(blockerMap.values()).flat().length} creatures`,
                  });
                } else {
                  newState = passPriority(newState, currentAIPlayer.id);
                }
              } else {
                newState = passPriority(newState, currentAIPlayer.id);
              }
            } else {
              newState = passPriority(newState, currentAIPlayer.id);
            }
          } else {
            newState = passPriority(newState, currentAIPlayer.id);
          }
          break;

        case "play_land": {
          // AI simple land play logic
          const handZone = newState.zones.get(`${currentAIPlayer.id}-hand`);
          const landId = handZone?.cardIds.find((id) =>
            isLand(newState.cards.get(id)!),
          );
          if (
            landId &&
            ValidationService.canPlayLand(newState, currentAIPlayer.id, landId)
              .isValid
          ) {
            const result = playLand(newState, currentAIPlayer.id, landId);
            if (result.success) {
              newState = result.state;
              toast({
                title: "AI Action",
                description: "AI played a land",
              });
            }
          }
          newState = passPriority(newState, currentAIPlayer.id);
          break;
        }

        default:
          // Default: pass priority
          newState = passPriority(newState, currentAIPlayer.id);
          break;
      }

      // Check state-based actions
      const result = checkStateBasedActions(newState);
      newState = result.state;

      // Save updated state
      setGameState(newState);
      if (autoSaveEnabled) {
        await saveActiveGame(newState);
      }
    };

    executeAITurn()
      .catch((error) => {
        console.error("AI turn failed:", error);
        toast({
          title: "AI Error",
          description: "The AI encountered an error. Please refresh.",
          variant: "destructive",
        });
      })
      .finally(() => {
        aiExecutionRef.current = false;
        setIsAIThinking(false);
      });
  }, [
    gameState?.priorityPlayerId,
    mode,
    difficulty,
    toast,
    isAIThinking,
    autoSaveEnabled,
  ]);

  // Auto-pass for human during AI's turn (so user doesn't have to babysit every phase)
  useEffect(() => {
    if (!gameState || mode !== "ai") return;
    if (gameState.status !== "in_progress") return;
    if (isAIThinking) return;

    const humanPlayer = Array.from(gameState.players.values()).find(
      (p) => p.name === playerName,
    );
    const aiPlayer = Array.from(gameState.players.values()).find((p) =>
      p.name.includes("AI"),
    );
    if (!humanPlayer || !aiPlayer) return;

    // Only auto-pass when it's the AI's turn and human has priority
    const isAITurn = gameState.turn.activePlayerId === aiPlayer.id;
    const humanHasPriority = gameState.priorityPlayerId === humanPlayer.id;

    if (!isAITurn || !humanHasPriority) return;

    // Don't auto-pass during combat phases where human might want to act
    const combatPhases = [
      "declare_attackers",
      "declare_blockers",
      "combat_damage",
    ];
    if (combatPhases.includes(gameState.turn.currentPhase)) return;

    // Short delay so user can see the phase change
    const timer = setTimeout(() => {
      // Use ref to get latest state and avoid stale closure
      const latestState = gameStateRef.current;
      if (!latestState) return;
      if (aiExecutionRef.current) return; // Don't auto-pass while AI is executing

      const currentHuman = Array.from(latestState.players.values()).find(
        (p) => p.name === playerName,
      );
      const currentAI = Array.from(latestState.players.values()).find((p) =>
        p.name.includes("AI"),
      );
      if (!currentHuman || !currentAI) return;

      // Re-validate conditions with latest state
      if (latestState.turn.activePlayerId !== currentAI.id) return;
      if (latestState.priorityPlayerId !== currentHuman.id) return;
      if (combatPhases.includes(latestState.turn.currentPhase)) return;

      const result = passPriority(latestState, currentHuman.id);
      if (result) {
        const sba = checkStateBasedActions(result);
        setGameState(sba.state);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [
    gameState?.priorityPlayerId,
    gameState?.turn.activePlayerId,
    gameState?.turn.currentPhase,
    mode,
    isAIThinking,
    playerName,
  ]);

  // Check for game end
  useEffect(() => {
    if (!gameState) return;

    if (gameState.status === "completed" && gameState.winners.length > 0) {
      const winner = gameState.players.get(gameState.winners[0]);
      toast({
        title: "Game Over",
        description: `${winner?.name} wins!`,
      });
    } else if (
      gameState.status === "completed" &&
      gameState.winners.length === 0
    ) {
      toast({
        title: "Game Over",
        description: "The game ended in a draw",
      });
    }
  }, [gameState?.status, gameState?.winners, toast]);

  // Handle card click - Main interaction handler for all card clicks
  const handleCardClick = useCallback(
    (cardId: string, zone: string) => {
      if (!gameState) return;

      const player = Array.from(gameState.players.values()).find(
        (p) => p.name === playerName,
      );
      if (!player) return;

      const card = gameState.cards.get(cardId);
      if (!card) return;

      const hasPriority = gameState.priorityPlayerId === player.id;

      // ==========================================
      // TARGETING MODE: Handle spell/ability targets
      // ==========================================
      if (
        pendingAction?.type === "target" ||
        pendingAction?.type === "cast" ||
        pendingAction?.type === "activate"
      ) {
        // Check if this card is a valid target
        const isOpponent = card.controllerId !== player.id;
        const isCreatureOnBattlefield =
          zone === "battlefield" && isCreature(card);

        // For now, allow targeting any creature or player
        // In a full implementation, this would check spell requirements
        if (zone === "battlefield" && isCreatureOnBattlefield) {
          // Target selected - complete the action
          if (pendingAction.type === "cast") {
            // Cast spell with target
            const validation = ValidationService.canCastSpell(
              gameState,
              player.id,
              pendingAction.cardId!,
            );
            if (validation.isValid) {
              try {
                // Note: Full targeting would require parsing spell text
                // For now, cast without explicit targets (works for non-targeted spells)
                const result = castSpell(
                  gameState,
                  player.id,
                  pendingAction.cardId!,
                );
                if (result.success) {
                  // Auto-pass priority after casting in single-player to resolve the spell
                  // The AI opponent will get priority, then pass it back, allowing the spell to resolve
                  let resolvedState = checkStateBasedActions(
                    result.state,
                  ).state;

                  // Get the AI opponent (find by name like other places in this file)
                  const aiPlayer = Array.from(
                    resolvedState.players.values(),
                  ).find((p) => p.name.includes("AI"));
                  if (aiPlayer && resolvedState.stack.length > 0) {
                    // Pass priority to AI, then AI passes back to resolve the spell
                    resolvedState = passPriority(resolvedState, aiPlayer.id);
                    resolvedState = passPriority(resolvedState, player.id);
                  }

                  setGameState(resolvedState);
                  toast({
                    title: "Spell cast",
                    description: `Cast ${card.cardData.name}`,
                  });
                } else {
                  toast({
                    title: "Error casting spell",
                    description:
                      result.error || "Not enough mana or invalid targets.",
                    variant: "destructive",
                  });
                }
              } catch (error) {
                const errorMessage =
                  error instanceof Error
                    ? error.message
                    : "An unexpected error occurred";
                gameLogger.error("Error casting spell:", errorMessage);
                toast({
                  title: "Error casting spell",
                  description: errorMessage,
                  variant: "destructive",
                });
              }
            }
          }
          setPendingAction(null);
          return;
        }

        // Clicking the same card again cancels targeting
        if (pendingAction.cardId === cardId) {
          setPendingAction(null);
          toast({
            title: "Targeting cancelled",
            description: "Action cancelled.",
          });
        }
        return;
      }

      // ==========================================
      // HAND ZONE: Play lands or cast spells
      // ==========================================
      if (zone === "hand" && card.controllerId === player.id && hasPriority) {
        if (isLand(card)) {
          // Check for basic land type choice FIRST (e.g., Multiversal Passage)
          // This must happen before shockland choice because some lands have both
          if (requiresBasicLandTypeChoice(card)) {
            setBasicLandTypeChoice({
              cardId,
              cardName: card.cardData.name,
            });
            return;
          }

          // Check for shockland-style ETB choice
          if (hasShocklandChoice(card)) {
            setShocklandChoice({ cardId, cardName: card.cardData.name });
            return;
          }

          // Play land
          const validation = ValidationService.canPlayLand(
            gameState,
            player.id,
            cardId,
          );
          if (validation.isValid) {
            const result = playLand(gameState, player.id, cardId);
            if (result.success) {
              const newState = checkStateBasedActions(result.state).state;
              setGameState(newState);
              const playedCard = newState.cards.get(cardId);
              if (playedCard && requiresBasicLandTypeChoice(playedCard)) {
                setBasicLandTypeChoice({
                  cardId,
                  cardName: playedCard.cardData.name,
                });
              } else {
                toast({
                  title: "Land played",
                  description: `Played ${card.cardData.name}`,
                });
              }
            } else {
              toast({
                title: "Cannot play land",
                description: result.error || "Action not allowed.",
                variant: "destructive",
              });
            }
          } else {
            toast({
              title: "Cannot play land",
              description: validation.message || "Action not allowed.",
              variant: "destructive",
            });
          }
        } else {
          // Cast spell - check if it requires targets or has modes
          const validation = ValidationService.canCastSpell(
            gameState,
            player.id,
            cardId,
          );
          if (validation.isValid) {
            // Check for X-cost spell first
            const xCostInfo = parseXCost(card.cardData, 10);
            if (xCostInfo.hasX) {
              setXCostChoice({
                cardId,
                cardName: card.cardData.name,
                maxX: xCostInfo.maxX,
                description: xCostInfo.description,
              });
              return;
            }

            // Check for kicker (optional additional cost)
            const kickerInfo = parseKicker(card.cardData.oracle_text || "");
            if (kickerInfo.hasKicker) {
              setKickerChoice({
                cardId,
                cardName: card.cardData.name,
                kickerCost: kickerInfo.description,
                description: kickerInfo.description,
              });
              return;
            }

            // Check for Attraction (Unfinity mechanic)
            const attractionInfo = parseAttraction(
              card.cardData.oracle_text || "",
            );
            if (attractionInfo.hasAttraction) {
              setAttractionChoice({
                cardId,
                cardName: card.cardData.name,
                spinResult: 0,
                revealedCards: [],
              });
              return;
            }

            // Check for modal spell (Choose One/Two)
            const oracleText = card.cardData.oracle_text || "";
            const parsed = parseModes(oracleText);

            if (parsed && parsed.modeCount > 1) {
              // Modal spell - open mode selection dialog
              setSpellModeChoice({
                cardId,
                cardName: card.cardData.name,
                modes: parsed.modes,
                modeCount: parsed.modeCount,
              });
              return;
            }

            // Check if spell has targets (simplified check)
            const lowerOracleText = oracleText.toLowerCase();
            const typeLine = card.cardData.type_line?.toLowerCase() || "";
            const hasTarget =
              lowerOracleText.includes("target") || typeLine.includes("aura");

            if (hasTarget && !isCreature(card)) {
              // Enter targeting mode for spells with targets
              setPendingAction({
                type: "cast",
                cardId,
                spellRequiresTarget: true,
                targetCount: 1,
              });
              toast({
                title: "Select target",
                description: `Choose a target for ${card.cardData.name}`,
              });
            } else {
              // Cast spell without targeting
              try {
                const result = castSpell(gameState, player.id, cardId);
                if (result.success) {
                  // Auto-pass priority after casting in single-player to resolve the spell
                  let newState = checkStateBasedActions(result.state).state;
                  const aiPlayer = Array.from(newState.players.values()).find(
                    (p) => p.name.includes("AI"),
                  );
                  if (aiPlayer && newState.stack.length > 0) {
                    newState = passPriority(newState, aiPlayer.id);
                    newState = passPriority(newState, player.id);
                  }
                  setGameState(newState);
                  toast({
                    title: "Spell cast",
                    description: `Cast ${card.cardData.name}`,
                  });
                } else {
                  toast({
                    title: "Error casting spell",
                    description:
                      result.error || "Not enough mana or invalid targets.",
                    variant: "destructive",
                  });
                }
              } catch (error) {
                const errorMessage =
                  error instanceof Error
                    ? error.message
                    : "An unexpected error occurred";
                gameLogger.error("Error casting spell:", errorMessage);
                toast({
                  title: "Error casting spell",
                  description: errorMessage,
                  variant: "destructive",
                });
              }
            }
          } else {
            toast({
              title: "Cannot cast spell",
              description: validation.message || "Action not allowed.",
              variant: "destructive",
            });
          }
        }
        return;
      }

      // ==========================================
      // BATTLEFIELD ZONE: Combat, abilities, tap/untap
      // ==========================================
      if (zone === "battlefield") {
        // ----- COMBAT: Declare attackers -----
        if (
          gameState.turn.currentPhase === "declare_attackers" &&
          hasPriority
        ) {
          if (isCreature(card) && card.controllerId === player.id) {
            const alreadyAttacking = declaredAttackers.find(
              (a) => a.cardId === cardId,
            );
            if (alreadyAttacking) {
              // Remove from attackers
              setDeclaredAttackers((prev) =>
                prev.filter((a) => a.cardId !== cardId),
              );
              toast({
                title: "Attacker removed",
                description: `${card.cardData.name} is no longer attacking.`,
              });
            } else {
              // Add to attackers
              const opponentId = Array.from(gameState.players.values()).find(
                (p) => p.id !== player.id,
              )?.id;
              if (opponentId) {
                setDeclaredAttackers((prev) => [
                  ...prev,
                  { cardId, defenderId: opponentId },
                ]);
                toast({
                  title: "Attacker declared",
                  description: `${card.cardData.name} is attacking.`,
                });
              }
            }
            return;
          }
        }

        // ----- COMBAT: Declare blockers -----
        if (gameState.turn.currentPhase === "declare_blockers" && hasPriority) {
          if (isCreature(card) && card.controllerId === player.id) {
            // Clicked own creature - use as blocker if in blocking mode
            if (pendingAction?.type === "block" && pendingAction.attackerId) {
              const attackerId = pendingAction.attackerId;
              setDeclaredBlockers((prev) => {
                const next = new Map(prev);
                const current = next.get(attackerId) || [];
                if (!current.includes(cardId)) {
                  next.set(attackerId, [...current, cardId]);
                }
                return next;
              });
              toast({
                title: "Blocker declared",
                description: `${card.cardData.name} is blocking.`,
              });
              setPendingAction(null);
            }
            return;
          } else if (isCreature(card) && card.controllerId !== player.id) {
            // Clicked opponent's attacking creature - enter blocking mode
            if (gameState.combat.attackers.some((a) => a.cardId === cardId)) {
              setPendingAction({ type: "block", attackerId: cardId });
              toast({
                title: "Select blocker",
                description: "Choose a creature to block with",
              });
            } else {
              toast({
                title: "Not attacking",
                description: "This creature is not attacking.",
                variant: "destructive",
              });
            }
            return;
          }
        }

        // ----- ACTIVATION: Tap lands for mana -----
        if (hasPriority && card.controllerId === player.id) {
          if (isLand(card) && !card.isTapped) {
            // Check if this land has an ability requiring basic land type choice (e.g., Multiversal Passage)
            if (requiresBasicLandTypeChoice(card)) {
              setBasicLandTypeChoice({
                cardId,
                cardName: card.cardData.name,
              });
              return;
            }
            // Try to activate mana ability
            try {
              const result = activateManaAbility(
                gameState,
                player.id,
                cardId,
                0,
              );
              if (result.success) {
                if (result.options && result.options.length > 1) {
                  // Multi-option land — show choice dialog
                  setManaAbilityChoice({
                    cardId,
                    cardName: card.cardData.name,
                    options: result.options,
                  });
                  return;
                }
                // Single option — mana already added, land already tapped
                const newState = checkStateBasedActions(result.state).state;
                setGameState(newState);
                const produced = result.options?.[0]
                  ? formatManaPool({
                      colorless: 0,
                      white: 0,
                      blue: 0,
                      black: 0,
                      red: 0,
                      green: 0,
                      generic: 0,
                      ...result.options[0].mana,
                    })
                  : "mana";
                toast({
                  title: "Mana ability activated",
                  description: `Tapped ${card.cardData.name} for ${produced}`,
                });
                return;
              }
            } catch (_error) {
              // Mana ability activation failed, fall through to manual tap
            }
          }

          // Default: Toggle tap/untap
          const result = card.isTapped
            ? untapCard(gameState, cardId)
            : tapCard(gameState, cardId);
          if (result.success) {
            const newState = checkStateBasedActions(result.state).state;
            setGameState(newState);
            toast({
              title: card.isTapped ? "Untapped" : "Tapped",
              description: `${card.cardData.name} ${card.isTapped ? "untapped" : "tapped"}.`,
            });
          }
        }
      }
    },
    [gameState, playerName, pendingAction, declaredAttackers, toast],
  );

  // Handle zone click - For targeting zones or zone-specific actions
  const handleZoneClick = useCallback(
    (zone: string, zonePlayerId: string) => {
      if (!gameState) return;

      const player = Array.from(gameState.players.values()).find(
        (p) => p.name === playerName,
      );
      if (!player) return;

      const hasPriority = gameState.priorityPlayerId === player.id;

      // ==========================================
      // TARGETING MODE: Target a player (via their zone)
      // ==========================================
      if (
        pendingAction?.type === "target" ||
        pendingAction?.type === "cast" ||
        pendingAction?.type === "activate"
      ) {
        // Targeting a player by clicking their zone
        const targetPlayer = gameState.players.get(zonePlayerId);
        if (targetPlayer) {
          if (pendingAction.type === "cast") {
            // Cast spell targeting player
            const validation = ValidationService.canCastSpell(
              gameState,
              player.id,
              pendingAction.cardId!,
            );
            if (validation.isValid) {
              try {
                const result = castSpell(
                  gameState,
                  player.id,
                  pendingAction.cardId!,
                );
                if (result.success) {
                  // Auto-pass priority after casting in single-player to resolve the spell
                  let newState = checkStateBasedActions(result.state).state;
                  const aiPlayer = Array.from(newState.players.values()).find(
                    (p) => p.name.includes("AI"),
                  );
                  if (aiPlayer && newState.stack.length > 0) {
                    newState = passPriority(newState, aiPlayer.id);
                    newState = passPriority(newState, player.id);
                  }
                  setGameState(newState);
                  toast({
                    title: "Spell cast",
                    description: `Cast ${gameState.cards.get(pendingAction.cardId!)?.cardData.name || "spell"} targeting ${targetPlayer.name}`,
                  });
                } else {
                  toast({
                    title: "Error casting spell",
                    description:
                      result.error || "Not enough mana or invalid targets.",
                    variant: "destructive",
                  });
                }
              } catch (error) {
                const errorMessage =
                  error instanceof Error
                    ? error.message
                    : "An unexpected error occurred";
                gameLogger.error("Error casting spell:", errorMessage);
                toast({
                  title: "Error casting spell",
                  description: errorMessage,
                  variant: "destructive",
                });
              }
            }
          }
          setPendingAction(null);
          return;
        }
      }

      // ==========================================
      // LIBRARY: Draw card (for self-play debugging)
      // ==========================================
      if (
        zone === "library" &&
        zonePlayerId === player.id &&
        hasPriority &&
        mode === "self-play"
      ) {
        const library = gameState.zones.get(`${player.id}-library`);
        if (library && library.cardIds.length > 0) {
          const newState = drawCard(gameState, player.id);
          setGameState(checkStateBasedActions(newState).state);
          toast({
            title: "Card drawn",
            description: "Drew a card from library",
          });
        } else {
          toast({
            title: "Empty library",
            description: "Your library has no cards.",
            variant: "destructive",
          });
        }
        return;
      }

      // ==========================================
      // GRAVEYARD: View graveyard cards
      // ==========================================
      if (zone === "graveyard") {
        const graveyardZone = gameState.zones.get(`${zonePlayerId}-graveyard`);
        if (graveyardZone) {
          const cards = graveyardZone.cardIds
            .map((id) => gameState.cards.get(id))
            .filter((c): c is CardInstance => c !== undefined);
          setViewingZone({ zone: "graveyard", playerId: zonePlayerId, cards });
        }
        return;
      }

      // ==========================================
      // EXILE: View exile cards
      // ==========================================
      if (zone === "exile") {
        const exileZone = gameState.zones.get(`${zonePlayerId}-exile`);
        if (exileZone) {
          const cards = exileZone.cardIds
            .map((id) => gameState.cards.get(id))
            .filter((c): c is CardInstance => c !== undefined);
          setViewingZone({ zone: "exile", playerId: zonePlayerId, cards });
        }
        return;
      }

      // ==========================================
      // HAND: View hand info (own hand shows count, opponent shows unknown)
      // ==========================================
      if (zone === "hand") {
        const handZone = gameState.zones.get(`${zonePlayerId}-hand`);
        if (handZone) {
          const cardCount = handZone.cardIds.length;
          const isOwnHand = zonePlayerId === player.id;
          toast({
            title: isOwnHand ? "Your Hand" : "Opponent's Hand",
            description: isOwnHand
              ? `You have ${cardCount} cards in hand.`
              : `Opponent has ${cardCount} cards in hand.`,
          });
        }
        return;
      }
    },
    [gameState, playerName, pendingAction, mode, toast],
  );

  // Handle concede
  const handleConcede = useCallback(async () => {
    if (!gameState) return;

    if (confirm("Are you sure you want to concede?")) {
      const player = Array.from(gameState.players.values()).find(
        (p) => p.name === playerName,
      );
      if (player) {
        const newState = concede(gameState, player.id);
        setGameState(newState);
        await saveActiveGame(newState);

        toast({
          title: "Game Over",
          description: "You conceded the game.",
        });

        // Navigate back after a delay
        setTimeout(() => {
          router.push("/single-player");
        }, 2000);
      }
    }
  }, [gameState, playerName, router, toast]);

  // Handle draw offer - Use engine function
  const handleOfferDraw = useCallback(async () => {
    if (!gameState) return;

    const player = Array.from(gameState.players.values()).find(
      (p) => p.name === playerName,
    );
    if (!player) return;

    const newState = offerDraw(gameState, player.id);
    setGameState(newState);
    await saveActiveGame(newState);

    toast({
      title: "Draw Offered",
      description: "Draw offer sent to opponent.",
    });
  }, [gameState, playerName, toast]);

  const handleAcceptDraw = useCallback(async () => {
    if (!gameState) return;

    const player = Array.from(gameState.players.values()).find(
      (p) => p.name === playerName,
    );
    if (!player) return;

    const newState = acceptDraw(gameState, player.id);
    setGameState(newState);
    await saveActiveGame(newState);

    toast({
      title: "Draw Accepted",
      description: "The game ended in a draw.",
    });

    // Navigate back after a delay
    setTimeout(() => {
      router.push("/single-player");
    }, 2000);
  }, [gameState, playerName, router, toast]);

  const handleDeclineDraw = useCallback(async () => {
    if (!gameState) return;

    const player = Array.from(gameState.players.values()).find(
      (p) => p.name === playerName,
    );
    if (!player) return;

    const newState = declineDraw(gameState, player.id);
    setGameState(newState);
    await saveActiveGame(newState);

    toast({
      title: "Draw Declined",
      description: "The game continues.",
    });
  }, [gameState, playerName, toast]);

  // Handle shockland choice — enter tapped
  const handleShocklandEnterTapped = useCallback(async () => {
    if (!gameState || !shocklandChoice) return;

    const player = Array.from(gameState.players.values()).find(
      (p) => p.name === playerName,
    );
    if (!player) return;

    const result = playLand(gameState, player.id, shocklandChoice.cardId);
    if (result.success) {
      // Update the card with the chosen basic land type if applicable
      let newState = result.state;
      if (shocklandChoice.chosenLandType) {
        const updatedCards = new Map(result.state.cards);
        const playedCard = updatedCards.get(shocklandChoice.cardId);
        if (playedCard) {
          updatedCards.set(shocklandChoice.cardId, {
            ...playedCard,
            chosenBasicLandType: shocklandChoice.chosenLandType,
          });
          newState = { ...newState, cards: updatedCards };
        }
      }
      // Tap the land
      const tapResult = tapCard(newState, shocklandChoice.cardId);
      newState = tapResult.success ? tapResult.state : newState;
      newState = checkStateBasedActions(newState).state;
      setGameState(newState);
      await saveActiveGame(newState);
      toast({
        title: "Land played",
        description: `${shocklandChoice.cardName} entered tapped.`,
      });
    }
    setShocklandChoice(null);
  }, [gameState, shocklandChoice, playerName, toast]);

  // Handle shockland choice — pay 2 life
  const handleShocklandPayLife = useCallback(async () => {
    if (!gameState || !shocklandChoice) return;

    const player = Array.from(gameState.players.values()).find(
      (p) => p.name === playerName,
    );
    if (!player) return;

    const result = playLand(gameState, player.id, shocklandChoice.cardId);
    if (result.success) {
      // Update the card with the chosen basic land type if applicable
      let newState = result.state;
      if (shocklandChoice.chosenLandType) {
        const updatedCards = new Map(result.state.cards);
        const playedCard = updatedCards.get(shocklandChoice.cardId);
        if (playedCard) {
          updatedCards.set(shocklandChoice.cardId, {
            ...playedCard,
            chosenBasicLandType: shocklandChoice.chosenLandType,
          });
          newState = { ...newState, cards: updatedCards };
        }
      }
      newState = dealDamageToPlayer(
        newState,
        player.id,
        2,
        false,
        shocklandChoice.cardId,
      );
      newState = checkStateBasedActions(newState).state;
      setGameState(newState);
      await saveActiveGame(newState);
      toast({
        title: "Land played",
        description: `${shocklandChoice.cardName} entered untapped. You paid 2 life.`,
      });
    }
    setShocklandChoice(null);
  }, [gameState, shocklandChoice, playerName, toast]);

  // Handle mana ability choice
  const handleManaChoice = useCallback(
    async (option: ManaAbilityOption) => {
      if (!gameState || !manaAbilityChoice) return;

      const player = Array.from(gameState.players.values()).find(
        (p) => p.name === playerName,
      );
      if (!player) return;

      const result = activateManaAbility(
        gameState,
        player.id,
        manaAbilityChoice.cardId,
        0,
        option,
      );
      if (result.success) {
        const newState = checkStateBasedActions(result.state).state;
        setGameState(newState);
        if (autoSaveEnabled) await saveActiveGame(newState);
        const produced = formatManaPool({
          colorless: 0,
          white: 0,
          blue: 0,
          black: 0,
          red: 0,
          green: 0,
          generic: 0,
          ...option.mana,
        });
        toast({
          title: "Mana ability activated",
          description: `Tapped ${manaAbilityChoice.cardName} for ${produced}`,
        });
      }
      setManaAbilityChoice(null);
    },
    [gameState, manaAbilityChoice, playerName, toast, autoSaveEnabled],
  );

  // Handle modal spell mode selection
  const handleModeSelect = useCallback(
    async (modeIndex: number) => {
      if (!gameState || !spellModeChoice) return;

      const player = Array.from(gameState.players.values()).find(
        (p) => p.name === playerName,
      );
      if (!player) return;

      const chosenMode = spellModeChoice.modes[modeIndex];
      const result = castSpell(
        gameState,
        player.id,
        spellModeChoice.cardId,
        [],
        [chosenMode],
      );

      if (result.success) {
        // Auto-pass priority after casting in single-player to resolve the spell
        let newState = checkStateBasedActions(result.state).state;
        const aiPlayer = Array.from(newState.players.values()).find((p) =>
          p.name.includes("AI"),
        );
        if (aiPlayer && newState.stack.length > 0) {
          newState = passPriority(newState, aiPlayer.id);
          newState = passPriority(newState, player.id);
        }
        setGameState(newState);
        if (autoSaveEnabled) await saveActiveGame(newState);
        toast({
          title: "Spell cast",
          description: `${spellModeChoice.cardName}: ${chosenMode.substring(0, 40)}${chosenMode.length > 40 ? "..." : ""}`,
        });
      } else {
        toast({
          title: "Error casting spell",
          description:
            result.error || "Could not cast spell with selected mode.",
          variant: "destructive",
        });
      }
      setSpellModeChoice(null);
    },
    [gameState, spellModeChoice, playerName, toast, autoSaveEnabled],
  );

  // Handle X-cost spell value selection
  const handleXValueSelect = useCallback(
    async (xValue: number) => {
      if (!gameState || !xCostChoice) return;

      const player = Array.from(gameState.players.values()).find(
        (p) => p.name === playerName,
      );
      if (!player) return;

      const result = castSpell(
        gameState,
        player.id,
        xCostChoice.cardId,
        [],
        [],
        xValue,
      );

      if (result.success) {
        // Auto-pass priority after casting in single-player to resolve the spell
        let newState = checkStateBasedActions(result.state).state;
        const aiPlayer = Array.from(newState.players.values()).find((p) =>
          p.name.includes("AI"),
        );
        if (aiPlayer && newState.stack.length > 0) {
          newState = passPriority(newState, aiPlayer.id);
          newState = passPriority(newState, player.id);
        }
        setGameState(newState);
        if (autoSaveEnabled) await saveActiveGame(newState);
        toast({
          title: "Spell cast",
          description: `${xCostChoice.cardName} (X=${xValue})`,
        });
      } else {
        toast({
          title: "Error casting spell",
          description: result.error || "Could not cast spell with X value.",
          variant: "destructive",
        });
      }
      setXCostChoice(null);
    },
    [gameState, xCostChoice, playerName, toast, autoSaveEnabled],
  );

  // Handle kicker spell - cast with or without kicker
  const handleKickerSelect = useCallback(
    async (withKicker: boolean) => {
      if (!gameState || !kickerChoice) return;

      const player = Array.from(gameState.players.values()).find(
        (p) => p.name === playerName,
      );
      if (!player) return;

      const result = castSpell(
        gameState,
        player.id,
        kickerChoice.cardId,
        [],
        [],
        0,
        withKicker,
      );

      if (result.success) {
        // Auto-pass priority after casting in single-player to resolve the spell
        let newState = checkStateBasedActions(result.state).state;
        const aiPlayer = Array.from(newState.players.values()).find((p) =>
          p.name.includes("AI"),
        );
        if (aiPlayer && newState.stack.length > 0) {
          newState = passPriority(newState, aiPlayer.id);
          newState = passPriority(newState, player.id);
        }
        setGameState(newState);
        if (autoSaveEnabled) await saveActiveGame(newState);
        toast({
          title: "Spell cast",
          description: `${kickerChoice.cardName}${withKicker ? " (kicked)" : ""}`,
        });
      } else {
        toast({
          title: "Error casting spell",
          description: result.error || "Could not cast spell.",
          variant: "destructive",
        });
      }
      setKickerChoice(null);
    },
    [gameState, kickerChoice, playerName, toast, autoSaveEnabled],
  );

  // Handle Attraction spin - roll a die and reveal cards
  const handleAttractionSpin = useCallback(async () => {
    if (!gameState || !attractionChoice) return;

    const player = Array.from(gameState.players.values()).find(
      (p) => p.name === playerName,
    );
    if (!player) return;

    // Roll a d6 (Attraction uses 1-6)
    const spinResult = Math.floor(Math.random() * 6) + 1;

    // Get top cards from library to reveal
    const libraryZone = gameState.zones.get(`${player.id}-library`);
    const revealCount = Math.min(5, libraryZone?.cardIds.length || 0);
    const revealedCardIds = libraryZone?.cardIds.slice(0, revealCount) || [];
    const revealedCardNames = revealedCardIds
      .map((id) => gameState.cards.get(id)?.cardData.name || "Unknown")
      .slice(0, spinResult);

    setAttractionChoice((prev) =>
      prev
        ? {
            ...prev,
            spinResult,
            revealedCards: revealedCardNames,
          }
        : null,
    );
  }, [gameState, attractionChoice, playerName]);

  // Handle Attraction spin and cast
  const handleAttractionSpinAndCast = useCallback(async () => {
    if (!gameState || !attractionChoice) return;

    const player = Array.from(gameState.players.values()).find(
      (p) => p.name === playerName,
    );
    if (!player) return;

    // Roll a d6
    const spinResult = Math.floor(Math.random() * 6) + 1;

    // Cast the attraction spell
    const result = castSpell(gameState, player.id, attractionChoice.cardId);

    if (result.success) {
      // Auto-pass priority after casting in single-player to resolve the spell
      let newState = checkStateBasedActions(result.state).state;
      const aiPlayer = Array.from(newState.players.values()).find((p) =>
        p.name.includes("AI"),
      );
      if (aiPlayer && newState.stack.length > 0) {
        newState = passPriority(newState, aiPlayer.id);
        newState = passPriority(newState, player.id);
      }
      setGameState(newState);
      if (autoSaveEnabled) await saveActiveGame(newState);
      toast({
        title: "Attraction revealed",
        description: `Rolled ${spinResult} with ${attractionChoice.cardName}`,
      });
    } else {
      toast({
        title: "Error casting Attraction",
        description: result.error || "Could not cast Attraction.",
        variant: "destructive",
      });
    }
    setAttractionChoice(null);
  }, [gameState, attractionChoice, playerName, toast, autoSaveEnabled]);

  // Helper to get description for basic land types
  const getBasicLandTypeDescription = (landType: string): string => {
    const descriptions: Record<string, string> = {
      Plains: "Produces white mana",
      Island: "Produces blue mana",
      Swamp: "Produces black mana",
      Mountain: "Produces red mana",
      Forest: "Produces green mana",
    };
    return descriptions[landType] || "";
  };

  // Check if a card's ability requires choosing a basic land type
  const requiresBasicLandTypeChoice = (card: CardInstance): boolean => {
    // Already chosen - don't ask again
    if (card.chosenBasicLandType) return false;

    const text = card.cardData.oracle_text?.toLowerCase() || "";
    return (
      text.includes("choose a basic land type") ||
      text.includes("choose one of the five basic land types")
    );
  };

  // Handle basic land type choice
  const handleBasicLandTypeChoice = useCallback(
    async (landType: string) => {
      if (!gameState || !basicLandTypeChoice) return;

      const player = Array.from(gameState.players.values()).find(
        (p) => p.name === playerName,
      );
      if (!player) return;

      const card = gameState.cards.get(basicLandTypeChoice.cardId);
      if (!card) return;

      setBasicLandTypeChoice(null);

      // Check if this card also has a shockland-style choice
      if (hasShocklandChoice(card)) {
        setShocklandChoice({
          cardId: basicLandTypeChoice.cardId,
          cardName: card.cardData.name,
          chosenLandType: landType,
        });
        return;
      }

      // No shockland choice - play the land directly
      const validation = ValidationService.canPlayLand(
        gameState,
        player.id,
        basicLandTypeChoice.cardId,
      );
      if (validation.isValid) {
        const result = playLand(
          gameState,
          player.id,
          basicLandTypeChoice.cardId,
        );
        if (result.success) {
          // Update the card with the chosen basic land type
          const updatedCards = new Map(result.state.cards);
          const playedCard = updatedCards.get(basicLandTypeChoice.cardId);
          if (playedCard) {
            updatedCards.set(basicLandTypeChoice.cardId, {
              ...playedCard,
              chosenBasicLandType: landType,
            });
          }
          const newState = checkStateBasedActions({
            ...result.state,
            cards: updatedCards,
          }).state;
          setGameState(newState);
          toast({
            title: "Land played",
            description: `Played ${card.cardData.name} (${landType})`,
          });
        }
      }
    },
    [gameState, basicLandTypeChoice, playerName, toast],
  );

  // Handle end turn — pass through all remaining phases
  const handleEndTurn = useCallback(async () => {
    if (!gameState) return;

    const player = Array.from(gameState.players.values()).find(
      (p) => p.name === playerName,
    );
    if (!player) return;

    const startingTurn = gameState.turn.turnNumber;
    const startingActivePlayer = gameState.turn.activePlayerId;

    let newState = gameState;
    let passCount = 0;
    const maxPasses = 40;

    while (passCount < maxPasses) {
      // Stop if turn changed or game ended
      if (
        newState.turn.turnNumber !== startingTurn ||
        newState.turn.activePlayerId !== startingActivePlayer
      ) {
        break;
      }
      if (newState.status === "completed") break;

      // Pass for whoever has priority
      const priorityPlayer = newState.players.get(newState.priorityPlayerId!);
      if (!priorityPlayer) break;

      newState = passPriority(newState, priorityPlayer.id);
      passCount++;

      // Check state-based actions
      const sba = checkStateBasedActions(newState);
      newState = sba.state;
    }

    setGameState(newState);
    if (autoSaveEnabled) {
      await saveActiveGame(newState);
    }

    const turnEnded =
      newState.turn.activePlayerId !== startingActivePlayer ||
      newState.turn.turnNumber !== startingTurn;
    toast({
      title: turnEnded ? "Turn ended" : "Priority passed",
      description: turnEnded
        ? `Passed to ${newState.turn.activePlayerId === player.id ? "your" : "opponent's"} turn.`
        : "Advanced through phases.",
    });
  }, [gameState, playerName, autoSaveEnabled, toast]);

  // Handle mulligan
  const handleMulligan = useCallback(async () => {
    if (!gameState) return;

    const player = Array.from(gameState.players.values()).find(
      (p) => p.name === playerName,
    );
    if (!player) return;

    const newMulliganCount = mulliganCount + 1;
    setMulliganCount(newMulliganCount);

    // Return all hand cards to library
    const handZone = gameState.zones.get(`${player.id}-hand`);
    const libraryZone = gameState.zones.get(`${player.id}-library`);

    if (!handZone || !libraryZone) return;

    const handCardIds = [...handZone.cardIds];
    const newLibraryCardIds = [...libraryZone.cardIds, ...handCardIds];

    // Shuffle library
    for (let i = newLibraryCardIds.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [newLibraryCardIds[i], newLibraryCardIds[j]] = [
        newLibraryCardIds[j],
        newLibraryCardIds[i],
      ];
    }

    const updatedZones = new Map(gameState.zones);
    updatedZones.set(`${player.id}-hand`, { ...handZone, cardIds: [] });
    updatedZones.set(`${player.id}-library`, {
      ...libraryZone,
      cardIds: newLibraryCardIds,
    });

    let newState: GameState = {
      ...gameState,
      zones: updatedZones,
    };

    // Draw new hand (7 - mulligan count)
    const cardsToDraw = Math.max(1, 7 - newMulliganCount);
    for (let i = 0; i < cardsToDraw; i++) {
      newState = drawCard(newState, player.id);
    }

    // Get updated hand for display
    const updatedHandZone = newState.zones.get(`${player.id}-hand`);
    const handCards =
      updatedHandZone?.cardIds
        .map((id) => newState.cards.get(id))
        .filter((c): c is CardInstance => c !== undefined) || [];
    setPlayerHandCards(handCards);
    setGameState(newState);
    await saveActiveGame(newState);

    toast({
      title: "Mulligan",
      description: `Drew ${cardsToDraw} cards. ${newMulliganCount < 6 ? "You can mulligan again." : "This is your minimum hand size."}`,
    });
  }, [gameState, playerName, mulliganCount, toast]);

  // Handle keep hand and start game
  const handleKeepHand = useCallback(async () => {
    if (!gameState) return;

    const player = Array.from(gameState.players.values()).find(
      (p) => p.name === playerName,
    );
    const opponent = Array.from(gameState.players.values()).find(
      (p) => p.name !== playerName,
    );

    if (!player || !opponent) return;

    setShowMulligan(false);

    // Draw 7 for opponent (AI always keeps for simplicity)
    let newState = gameState;
    for (let i = 0; i < 7; i++) {
      newState = drawCard(newState, opponent.id);
    }

    // Set game status to in_progress
    newState = {
      ...newState,
      status: "in_progress",
      turn: {
        ...newState.turn,
        turnNumber: 1,
      },
    };

    // Auto-advance through untap, upkeep, and draw to precombat_main
    // so the player can immediately take actions
    for (let i = 0; i < 3; i++) {
      const activeId = newState.turn.activePlayerId;
      const otherPlayer = Array.from(newState.players.values()).find(
        (p) => p.id !== activeId,
      );
      newState = passPriority(newState, activeId);
      if (otherPlayer) {
        newState = passPriority(newState, otherPlayer.id);
      }
    }

    setGameState(newState);
    setIsGameStarted(true);
    await saveActiveGame(newState);

    toast({
      title: "Game On!",
      description: `Good luck! It's ${newState.turn.activePlayerId === player.id ? "your" : "the opponent's"} turn.`,
    });
  }, [gameState, playerName, toast]);

  // Handle pass priority - Core priority loop implementation
  const handlePassPriority = useCallback(async () => {
    if (!gameState) return;

    const player = Array.from(gameState.players.values()).find(
      (p) => p.name === playerName,
    );
    if (!player) return;

    const validation = ValidationService.canPassPriority(gameState, player.id);
    if (!validation.isValid) {
      toast({
        title: "Cannot pass priority",
        description: validation.reason || "Action not allowed.",
        variant: "destructive",
      });
      return;
    }

    let newState = passPriority(gameState, player.id);

    // If we're passing in declare_attackers, apply declarations
    if (gameState.turn.currentPhase === "declare_attackers") {
      if (declaredAttackers.length > 0) {
        const result = declareAttackers(gameState, declaredAttackers);
        if (result.success) {
          newState = passPriority(result.state, player.id);
          toast({
            title: "Attackers declared",
            description: `${declaredAttackers.length} creature(s) attacking.`,
          });
        } else {
          toast({
            title: "Attack declaration failed",
            description:
              result.errors?.join(", ") || "Could not declare attackers.",
            variant: "destructive",
          });
        }
        setDeclaredAttackers([]);
      }
    }

    // If we're passing in declare_blockers, apply declarations
    if (gameState.turn.currentPhase === "declare_blockers") {
      if (declaredBlockers.size > 0) {
        const result = declareBlockers(gameState, declaredBlockers);
        if (result.success) {
          newState = passPriority(result.state, player.id);
          const totalBlockers = Array.from(declaredBlockers.values()).flat()
            .length;
          toast({
            title: "Blockers declared",
            description: `${totalBlockers} creature(s) blocking.`,
          });
        } else {
          toast({
            title: "Block declaration failed",
            description:
              result.errors?.join(", ") || "Could not declare blockers.",
            variant: "destructive",
          });
        }
        setDeclaredBlockers(new Map());
      }
    }

    // Auto-resolve combat if entering damage phase
    if (newState.turn.currentPhase === "combat_damage") {
      const combatResult = resolveCombatDamage(newState);
      if (combatResult.success) {
        newState = combatResult.state;
        toast({
          title: "Combat Resolved",
          description: combatResult.description,
        });
      }
    }

    // Check state-based actions
    const sbaResult = checkStateBasedActions(newState);
    newState = sbaResult.state;

    // Show SBA descriptions
    if (sbaResult.descriptions.length > 0) {
      sbaResult.descriptions.forEach((desc) => {
        toast({
          title: "State Action",
          description: desc,
        });
      });
    }

    setGameState(newState);

    if (autoSaveEnabled) {
      await saveActiveGame(newState);
    }
  }, [
    gameState,
    playerName,
    declaredAttackers,
    declaredBlockers,
    autoSaveEnabled,
    toast,
  ]);

  // Handle advance phase (for self-play debugging)
  const handleAdvancePhase = useCallback(async () => {
    if (!gameState) return;

    // Force advance to next phase by passing priority multiple times
    let newState = { ...gameState };
    const maxPasses = 10;

    for (let i = 0; i < maxPasses; i++) {
      const currentPlayer = newState.players.get(newState.priorityPlayerId!);
      if (!currentPlayer) break;

      newState = passPriority(newState, currentPlayer.id);
      const result = checkStateBasedActions(newState);
      newState = result.state;

      // Check if phase changed
      if (newState.turn.currentPhase !== gameState.turn.currentPhase) {
        break;
      }
    }

    setGameState(newState);
    if (autoSaveEnabled) {
      await saveActiveGame(newState);
    }
  }, [gameState, autoSaveEnabled]);

  if (isLoading) {
    return (
      <div className="flex-1 p-4 md:p-6 flex items-center justify-center">
        <Card className="max-w-md w-full">
          <CardContent className="p-6 text-center space-y-4">
            <div className="animate-pulse space-y-2">
              <div className="h-4 bg-muted rounded"></div>
              <div className="h-4 bg-muted rounded w-3/4"></div>
              <div className="h-4 bg-muted rounded w-1/2"></div>
            </div>
            <p className="text-muted-foreground">Initializing game...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !gameState) {
    return (
      <div className="flex-1 p-4 md:p-6">
        <Button
          variant="ghost"
          onClick={() => router.push("/single-player")}
          className="mb-4"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
        <Card className="max-w-md mx-auto">
          <CardContent className="p-6">
            <Alert variant="destructive">
              <AlertDescription>{error || "Game not found"}</AlertDescription>
            </Alert>
            <Button
              onClick={() => router.push("/single-player")}
              className="mt-4 w-full"
            >
              Return to Menu
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const currentPlayer = gameState.players.get(gameState.turn.activePlayerId);
  const isPlayerTurn = currentPlayer?.name === playerName;
  const isGameEnded = gameState.status === "completed";

  // Convert game state players to UI format
  const uiPlayers = Array.from(gameState.players.values()).map((player) => {
    // Get cards in each zone
    const getCardsInZone = (zoneType: string) => {
      const zone = gameState.zones.get(`${player.id}-${zoneType}`);
      if (!zone) return [];

      return zone.cardIds
        .map((id) => gameState.cards.get(id))
        .filter((card): card is CardInstance => card !== undefined)
        .map((card) => ({
          id: card.id,
          card: card.cardData,
          zone: zoneType as ZoneType,
          playerId: player.id,
          tapped: card.isTapped,
          faceDown: card.isFaceDown,
        }));
    };

    return {
      id: player.id,
      name: player.name,
      lifeTotal: player.life,
      poisonCounters: player.poisonCounters,
      commanderDamage: {},
      hand: getCardsInZone("hand"),
      battlefield: getCardsInZone("battlefield"),
      graveyard: getCardsInZone("graveyard"),
      exile: getCardsInZone("exile"),
      library: getCardsInZone("library"),
      commandZone: [],
      isCurrentTurn: player.id === gameState.turn.activePlayerId,
      hasPriority: player.id === gameState.priorityPlayerId,
      landsPlayedThisTurn: player.landsPlayedThisTurn,
      manaPool: player.manaPool,
    };
  });

  // Sort so player is at bottom (index 1)
  const sortedPlayers = uiPlayers.sort((a, b) => {
    if (a.name === playerName) return 1;
    if (b.name === playerName) return -1;
    return 0;
  });

  const currentTurnIndex = sortedPlayers.findIndex((p) => p.isCurrentTurn);

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Header */}
      <header
        className="flex-shrink-0 bg-background/95 backdrop-blur border-b"
        data-tutorial="phase-info"
      >
        <div className="flex items-center justify-between p-4">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              onClick={() => router.push("/single-player")}
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <h1 className="font-headline text-lg font-bold">
                Single Player Game
              </h1>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Badge variant="outline">Game {gameId}</Badge>
                <span>Turn {gameState.turn.turnNumber}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-sm font-medium flex items-center gap-2">
                {currentPlayer?.name}&apos;s Turn
                {isAIThinking && (
                  <Badge variant="secondary" className="animate-pulse">
                    AI Thinking...
                  </Badge>
                )}
              </div>
              <div className="text-xs text-muted-foreground capitalize">
                {gameState.turn.currentPhase.replace("_", " ")}
              </div>
            </div>
            <Badge variant={mode === "ai" ? "default" : "secondary"}>
              {mode === "ai" ? `vs AI (${difficulty})` : "Self Play"}
            </Badge>
          </div>
        </div>
      </header>

      {/* Phase Tracker */}
      <div className="flex-shrink-0">
        <PhaseTracker
          currentPhase={gameState.turn.currentPhase}
          isPlayerTurn={isPlayerTurn}
        />
      </div>

      {/* Game Board */}
      <main
        className="flex-1 min-h-0 overflow-hidden"
        data-tutorial="battlefield"
      >
        <div className="h-full w-full p-4">
          <GameBoard
            players={sortedPlayers}
            playerCount={gameState.players.size as PlayerCount}
            currentTurnIndex={currentTurnIndex}
            onCardClick={handleCardClick}
            onZoneClick={handleZoneClick}
            onConcede={handleConcede}
            onOfferDraw={handleOfferDraw}
            onAcceptDraw={handleAcceptDraw}
            onDeclineDraw={handleDeclineDraw}
          />
        </div>
      </main>

      {/* Game Controls Footer */}
      <footer
        className="flex-shrink-0 bg-background/95 backdrop-blur border-t p-2"
        data-tutorial="actions"
      >
        <div className="flex items-center justify-between">
          <div
            className="flex items-center gap-4 text-xs text-muted-foreground"
            data-tutorial="life-total"
          >
            <span className="flex items-center gap-1">
              <Heart className="w-3 h-3" />
              {playerName}:{" "}
              {uiPlayers.find((p) => p.name === playerName)?.lifeTotal || 20}
            </span>
            {uiPlayers.find((p) => p.name !== playerName) && (
              <span className="flex items-center gap-1">
                <Heart className="w-3 h-3" />
                {uiPlayers.find((p) => p.name !== playerName)?.name}:{" "}
                {uiPlayers.find((p) => p.name !== playerName)?.lifeTotal || 20}
              </span>
            )}
            {/* Mana Pool Display */}
            {(() => {
              const pool = uiPlayers.find(
                (p) => p.name === playerName,
              )?.manaPool;
              if (!pool || getTotalMana(pool) === 0) return null;
              return (
                <span className="flex items-center gap-1 ml-2 border-l pl-2 border-border">
                  {pool.white > 0 && (
                    <Badge
                      variant="outline"
                      className="text-[10px] h-4 px-1 bg-yellow-500/20 text-yellow-700 border-yellow-500/30"
                    >
                      {pool.white}W
                    </Badge>
                  )}
                  {pool.blue > 0 && (
                    <Badge
                      variant="outline"
                      className="text-[10px] h-4 px-1 bg-blue-500/20 text-blue-700 border-blue-500/30"
                    >
                      {pool.blue}U
                    </Badge>
                  )}
                  {pool.black > 0 && (
                    <Badge
                      variant="outline"
                      className="text-[10px] h-4 px-1 bg-gray-800/40 text-gray-300 border-gray-500/30"
                    >
                      {pool.black}B
                    </Badge>
                  )}
                  {pool.red > 0 && (
                    <Badge
                      variant="outline"
                      className="text-[10px] h-4 px-1 bg-red-500/20 text-red-700 border-red-500/30"
                    >
                      {pool.red}R
                    </Badge>
                  )}
                  {pool.green > 0 && (
                    <Badge
                      variant="outline"
                      className="text-[10px] h-4 px-1 bg-green-500/20 text-green-700 border-green-500/30"
                    >
                      {pool.green}G
                    </Badge>
                  )}
                  {pool.colorless > 0 && (
                    <Badge
                      variant="outline"
                      className="text-[10px] h-4 px-1 bg-gray-500/20 text-gray-600 border-gray-500/30"
                    >
                      {pool.colorless}C
                    </Badge>
                  )}
                  {pool.generic > 0 && (
                    <Badge
                      variant="outline"
                      className="text-[10px] h-4 px-1 bg-muted"
                    >
                      {pool.generic}
                    </Badge>
                  )}
                </span>
              );
            })()}
          </div>

          <div className="flex items-center gap-2">
            {/* Current phase badge */}
            <Badge
              variant={isPlayerTurn ? "default" : "outline"}
              className="text-[10px] capitalize hidden sm:inline-flex"
            >
              {gameState.turn.currentPhase.replace("_", " ")}
            </Badge>

            {/* Pass Priority — available in both modes */}
            <Button
              variant="outline"
              size="sm"
              onClick={handlePassPriority}
              disabled={isGameEnded}
              title={
                mode === "ai"
                  ? "Advance to the next phase"
                  : "Pass priority to opponent"
              }
            >
              <SkipForward className="w-3 h-3 mr-1" />
              {mode === "ai" ? "Next Phase" : "Pass Priority"}
            </Button>

            {/* End Turn */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleEndTurn}
              disabled={isGameEnded || !isPlayerTurn}
              title="Pass through all remaining phases to end your turn"
            >
              <Flag className="w-3 h-3 mr-1" />
              End Turn
            </Button>

            {/* Self-play-only controls */}
            {mode === "self-play" && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleAdvancePhase}
                disabled={isGameEnded}
              >
                <Play className="w-3 h-3 mr-1" />
                Advance Phase
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={handleConcede}
              disabled={isGameEnded}
            >
              Concede
            </Button>

            <Button
              variant={autoSaveEnabled ? "default" : "outline"}
              size="sm"
              onClick={() => setAutoSaveEnabled(!autoSaveEnabled)}
              title={
                autoSaveEnabled ? "Auto-save enabled" : "Auto-save disabled"
              }
            >
              {autoSaveEnabled ? (
                <RotateCcw className="w-3 h-3" />
              ) : (
                <Pause className="w-3 h-3" />
              )}
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                toast({
                  title: "Game State",
                  description: `Turn ${gameState.turn.turnNumber}, Phase: ${gameState.turn.currentPhase}, Status: ${gameState.status}`,
                });
              }}
            >
              <Info className="w-3 h-3" />
            </Button>
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="w-3 h-3" />
            <span>
              {gameState.status === "completed"
                ? "Game Ended"
                : "Game in Progress"}
            </span>
          </div>
        </div>
      </footer>

      {/* Mulligan Dialog */}
      <Dialog open={showMulligan} onOpenChange={setShowMulligan}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Hand className="h-5 w-5 text-primary" />
              Opening Hand
              {mulliganCount > 0 && (
                <Badge variant="secondary">Mulligan {mulliganCount}</Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              Review your opening hand. You can keep it or take a mulligan to
              draw a new hand with one fewer card.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            {playerHandCards.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                <Sparkles className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>Your hand is empty</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3">
                {playerHandCards.map((card) => (
                  <div
                    key={card.id}
                    className="relative aspect-[5/7] rounded-lg border border-border/50 bg-gradient-to-br from-primary/10 to-primary/5 overflow-hidden group cursor-pointer hover:border-primary/50 hover:shadow-xl hover:scale-110 hover:z-10 transition-all duration-200"
                    title={`${card.cardData.name}${card.cardData.mana_cost ? ` — ${card.cardData.mana_cost}` : ""}`}
                  >
                    {card.cardData.image_uris?.normal ? (
                      <Image
                        src={card.cardData.image_uris.normal}
                        alt={card.cardData.name}
                        fill
                        sizes="(max-width: 768px) 50vw, 140px"
                        className="object-cover rounded-lg"
                        loading="eager"
                      />
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center p-2 text-center">
                        <p className="text-xs font-medium line-clamp-2">
                          {card.cardData.name}
                        </p>
                        {card.cardData.mana_cost && (
                          <p className="text-[10px] text-muted-foreground mt-1">
                            {card.cardData.mana_cost}
                          </p>
                        )}
                        <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2">
                          {card.cardData.type_line}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <Info className="h-3 w-3" />
              {mulliganCount === 0
                ? "First mulligan: draw 6 cards"
                : `Next mulligan: draw ${Math.max(1, 7 - mulliganCount - 1)} cards`}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handleMulligan}
                disabled={mulliganCount >= 6}
                className="gap-1"
              >
                <Shuffle className="h-4 w-4" />
                Mulligan
              </Button>
              <Button
                onClick={handleKeepHand}
                className="gap-1"
                data-testid="keep-hand-button"
              >
                <CheckCircle2 className="h-4 w-4" />
                Keep Hand
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Shockland ETB Choice Dialog */}
      <Dialog
        open={!!shocklandChoice}
        onOpenChange={() => setShocklandChoice(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Enter the Battlefield</DialogTitle>
            <DialogDescription>
              {shocklandChoice?.cardName} can enter tapped or you can pay 2 life
              to have it enter untapped.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-4">
            <Button
              variant="outline"
              onClick={handleShocklandEnterTapped}
              className="justify-start h-auto py-3 px-4"
            >
              <div className="text-left">
                <div className="font-medium">Enter Tapped</div>
                <div className="text-xs text-muted-foreground">
                  No life loss
                </div>
              </div>
            </Button>
            <Button
              variant="outline"
              onClick={handleShocklandPayLife}
              className="justify-start h-auto py-3 px-4"
            >
              <div className="text-left">
                <div className="font-medium">Pay 2 Life</div>
                <div className="text-xs text-muted-foreground">
                  Enters untapped
                </div>
              </div>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Mana Ability Choice Dialog */}
      <Dialog
        open={!!manaAbilityChoice}
        onOpenChange={() => setManaAbilityChoice(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Choose Mana</DialogTitle>
            <DialogDescription>
              {manaAbilityChoice?.cardName} can produce different colors of
              mana. Choose one.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-4">
            {manaAbilityChoice?.options.map((option, idx) => (
              <Button
                key={idx}
                variant="outline"
                onClick={() => handleManaChoice(option)}
                className="justify-start h-auto py-3 px-4"
              >
                <div className="text-left">
                  <div className="font-medium">{option.description}</div>
                  <div className="text-xs text-muted-foreground">
                    Add{" "}
                    {formatManaPool({
                      colorless: 0,
                      white: 0,
                      blue: 0,
                      black: 0,
                      red: 0,
                      green: 0,
                      generic: 0,
                      ...option.mana,
                    })}{" "}
                    to your mana pool
                  </div>
                </div>
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Basic Land Type Choice Dialog */}
      <Dialog
        open={!!basicLandTypeChoice}
        onOpenChange={() => setBasicLandTypeChoice(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Choose Basic Land Type</DialogTitle>
            <DialogDescription>
              {basicLandTypeChoice?.cardName} allows you to choose a basic land
              type. Select one.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-2 py-4">
            {["Plains", "Island", "Swamp", "Mountain", "Forest"].map(
              (landType) => (
                <Button
                  key={landType}
                  variant="outline"
                  onClick={() => handleBasicLandTypeChoice(landType)}
                  className="justify-start h-auto py-3 px-4"
                >
                  <div className="text-left">
                    <div className="font-medium">{landType}</div>
                    <div className="text-xs text-muted-foreground">
                      {getBasicLandTypeDescription(landType)}
                    </div>
                  </div>
                </Button>
              ),
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal Spell Mode Choice Dialog */}
      <Dialog
        open={!!spellModeChoice}
        onOpenChange={() => setSpellModeChoice(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Choose Mode</DialogTitle>
            <DialogDescription>
              {spellModeChoice?.cardName} has multiple modes. Choose one.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-4">
            {spellModeChoice?.modes.map((mode, idx) => (
              <Button
                key={idx}
                variant="outline"
                onClick={() => handleModeSelect(idx)}
                className="justify-start h-auto py-3 px-4 text-left"
              >
                <div className="text-left">
                  <div className="font-medium">Mode {idx + 1}</div>
                  <div className="text-xs text-muted-foreground line-clamp-3 mt-1">
                    {mode}
                  </div>
                </div>
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* X-Cost Spell Dialog */}
      <Dialog open={!!xCostChoice} onOpenChange={() => setXCostChoice(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Choose X Value</DialogTitle>
            <DialogDescription>
              {xCostChoice?.description ||
                `Choose a value for ${xCostChoice?.cardName}`}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-6">
            <div className="flex items-center gap-6">
              <Button
                variant="outline"
                size="icon"
                onClick={() =>
                  setXCostChoice((prev) =>
                    prev ? { ...prev, maxX: Math.max(0, prev.maxX - 1) } : null,
                  )
                }
                disabled={xCostChoice ? xCostChoice.maxX <= 0 : true}
              >
                <span className="text-xl">−</span>
              </Button>
              <div className="text-5xl font-bold tabular-nums min-w-[80px] text-center">
                {xCostChoice?.maxX || 0}
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={() =>
                  setXCostChoice((prev) =>
                    prev ? { ...prev, maxX: prev.maxX + 1 } : null,
                  )
                }
              >
                <span className="text-xl">+</span>
              </Button>
            </div>
            <div className="text-sm text-muted-foreground">
              Max: {xCostChoice?.maxX || 0}
            </div>
            <div className="flex gap-2 mt-2">
              {[0, 1, 2, 3].map((n) => (
                <Button
                  key={n}
                  variant={xCostChoice?.maxX === n ? "default" : "outline"}
                  size="sm"
                  onClick={() =>
                    setXCostChoice((prev) =>
                      prev ? { ...prev, maxX: n } : null,
                    )
                  }
                  disabled={n > (xCostChoice?.maxX || 0)}
                >
                  {n}
                </Button>
              ))}
              {(xCostChoice?.maxX || 0) > 3 && (
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => handleXValueSelect(xCostChoice?.maxX || 0)}
                >
                  Cast X={xCostChoice?.maxX || 0}
                </Button>
              )}
            </div>
          </div>
          <DialogFooter className="flex-row gap-2 sm:flex-col">
            <Button variant="outline" onClick={() => setXCostChoice(null)}>
              Cancel
            </Button>
            <Button onClick={() => handleXValueSelect(xCostChoice?.maxX || 0)}>
              Cast with X={xCostChoice?.maxX || 0}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Kicker Spell Dialog */}
      <Dialog open={!!kickerChoice} onOpenChange={() => setKickerChoice(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Kicker Option</DialogTitle>
            <DialogDescription>
              {kickerChoice?.cardName} has an optional kicker cost.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-4">
            <Button
              variant="outline"
              onClick={() => handleKickerSelect(false)}
              className="justify-start h-auto py-3 px-4"
            >
              <div className="text-left">
                <div className="font-medium">Cast without kicker</div>
                <div className="text-xs text-muted-foreground">
                  Pay only the base mana cost
                </div>
              </div>
            </Button>
            <Button
              variant="default"
              onClick={() => handleKickerSelect(true)}
              className="justify-start h-auto py-3 px-4"
            >
              <div className="text-left">
                <div className="font-medium">Cast with kicker</div>
                <div className="text-xs text-muted-foreground">
                  {kickerChoice?.description ||
                    "Pay extra cost for additional effect"}
                </div>
              </div>
            </Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setKickerChoice(null)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Attraction Spell Dialog (Unfinity) */}
      <Dialog
        open={!!attractionChoice}
        onOpenChange={() => setAttractionChoice(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Attraction!</DialogTitle>
            <DialogDescription>
              {attractionChoice?.cardName} - Spin the die to reveal cards
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-6">
            {attractionChoice?.spinResult ? (
              <>
                <div className="text-6xl font-bold">
                  {attractionChoice.spinResult}
                </div>
                <div className="text-sm text-muted-foreground">Rolled!</div>
                {attractionChoice.revealedCards.length > 0 && (
                  <div className="text-sm text-center">
                    <div className="font-medium">Revealed cards:</div>
                    <div className="text-xs text-muted-foreground">
                      {attractionChoice.revealedCards.join(", ")}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="text-4xl">🎲</div>
                <div className="text-sm text-muted-foreground text-center">
                  Spin the Attraction die to determine the result
                </div>
              </>
            )}
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            {!attractionChoice?.spinResult ? (
              <Button onClick={handleAttractionSpinAndCast} className="w-full">
                Spin & Cast
              </Button>
            ) : (
              <Button
                onClick={() => setAttractionChoice(null)}
                className="w-full"
              >
                Done
              </Button>
            )}
            <Button variant="outline" onClick={() => setAttractionChoice(null)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Zone Viewer Dialog */}
      <Dialog open={!!viewingZone} onOpenChange={() => setViewingZone(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="capitalize">
              {viewingZone?.playerId ===
              Array.from(gameState?.players.values() || []).find(
                (p) => p.name === playerName,
              )?.id
                ? "Your"
                : "Opponent's"}{" "}
              {viewingZone?.zone}
            </DialogTitle>
            <DialogDescription>
              {viewingZone?.cards.length || 0} cards
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3 py-4">
            {viewingZone?.cards.map((card) => (
              <div
                key={card.id}
                className="relative aspect-[5/7] rounded-lg overflow-hidden shadow-md bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/30"
              >
                {card.cardData.image_uris?.normal ? (
                  <Image
                    src={card.cardData.image_uris.normal}
                    alt={card.cardData.name}
                    fill
                    sizes="120px"
                    className="object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center p-2">
                    <p className="text-center text-xs font-medium line-clamp-3">
                      {card.cardData.name}
                    </p>
                    {card.cardData.mana_cost && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {card.cardData.mana_cost}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
            {(viewingZone?.cards.length || 0) === 0 && (
              <p className="col-span-full text-center text-muted-foreground text-sm py-8">
                No cards in {viewingZone?.zone}
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Tutorial */}
      {isGameStarted && <GameTutorial />}
    </div>
  );
}

function GameLoading() {
  return (
    <div className="flex-1 p-4 md:p-6 flex items-center justify-center">
      <Card className="max-w-md w-full">
        <CardContent className="p-6 text-center space-y-4">
          <div className="animate-pulse space-y-2">
            <div className="h-4 bg-muted rounded"></div>
            <div className="h-4 bg-muted rounded w-3/4"></div>
            <div className="h-4 bg-muted rounded w-1/2"></div>
          </div>
          <p className="text-muted-foreground">Loading game...</p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function GamePage() {
  return (
    <Suspense fallback={<GameLoading />}>
      <GameBoardContent />
    </Suspense>
  );
}
