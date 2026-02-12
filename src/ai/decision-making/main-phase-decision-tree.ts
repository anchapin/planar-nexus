/**
 * @fileoverview AI Decision-Making System for Main Phase Actions
 *
 * This module provides a comprehensive decision tree framework for evaluating
 * and choosing actions during Magic: The Gathering main phases. It integrates
 * with the game state evaluator to make strategic decisions about:
 *
 * - Land selection and playing
 * - Creature spell evaluation
 * - Instant/sorcery decisions
 * - Equipment/aura attachment targets
 * - Activated ability usage
 * - When to pass priority
 *
 * The system uses a decision tree approach with weighted scoring to evaluate
 * potential actions based on strategic value, resource efficiency, and timing.
 */

import {
  GameState,
  Player,
  CardInstance,
  Phase,
  ManaPool,
  GameAction,
} from '@/lib/game-state/types';
import { GameStateEvaluator, DetailedEvaluation } from '../game-state-evaluator';

/**
 * Represents a possible action the AI can take
 */
export interface PossibleAction {
  /** Type of action */
  type: 'play_land' | 'cast_spell' | 'activate_ability' | 'pass_priority';
  /** Card ID if action involves a card */
  cardId?: string;
  /** Ability text if activating an ability */
  abilityText?: string;
  /** Target IDs if action requires targets */
  targetIds?: string[];
  /** Expected value of this action (higher is better) */
  value: number;
  /** Risk assessment (0-1, lower is safer) */
  risk: number;
  /** Mana cost to perform action */
  manaCost: ManaPool;
  /** Reasoning for this action */
  reasoning: string;
  /** Priority level */
  priority: 'critical' | 'high' | 'medium' | 'low';
}

/**
 * Result of decision tree evaluation
 */
export interface DecisionTreeResult {
  /** Best action to take */
  bestAction: PossibleAction | null;
  /** All evaluated actions ranked by value */
  rankedActions: PossibleAction[];
  /** Current game state evaluation */
  stateEvaluation: DetailedEvaluation;
  /** Whether to pass priority */
  shouldPassPriority: boolean;
  /** Confidence in decision (0-1) */
  confidence: number;
}

/**
 * Configuration for decision tree behavior
 */
export interface DecisionTreeConfig {
  /** Minimum value threshold for taking actions */
  minValueThreshold: number;
  /** Maximum acceptable risk for main phase actions */
  maxRiskThreshold: number;
  /** Weight for mana efficiency (0-1) */
  manaEfficiencyWeight: number;
  /** Weight for tempo (0-1) */
  tempoWeight: number;
  /** Weight for card advantage (0-1) */
  cardAdvantageWeight: number;
  /** Whether to hold up mana for instants */
  holdManaForInstants: boolean;
  /** Maximum lands to play in one turn */
  maxLandsPerTurn: number;
  /** Difficulty level */
  difficulty: 'easy' | 'medium' | 'hard';
}

/**
 * Default configurations by difficulty
 */
export const DefaultConfigs: Record<
  'easy' | 'medium' | 'hard',
  DecisionTreeConfig
> = {
  easy: {
    minValueThreshold: 0.2,
    maxRiskThreshold: 0.3,
    manaEfficiencyWeight: 0.3,
    tempoWeight: 0.3,
    cardAdvantageWeight: 0.4,
    holdManaForInstants: false,
    maxLandsPerTurn: 1,
    difficulty: 'easy',
  },
  medium: {
    minValueThreshold: 0.3,
    maxRiskThreshold: 0.4,
    manaEfficiencyWeight: 0.5,
    tempoWeight: 0.5,
    cardAdvantageWeight: 0.6,
    holdManaForInstants: true,
    maxLandsPerTurn: 1,
    difficulty: 'medium',
  },
  hard: {
    minValueThreshold: 0.4,
    maxRiskThreshold: 0.5,
    manaEfficiencyWeight: 0.7,
    tempoWeight: 0.7,
    cardAdvantageWeight: 0.8,
    holdManaForInstants: true,
    maxLandsPerTurn: 1,
    difficulty: 'hard',
  },
};

/**
 * Main Phase Decision Tree
 *
 * Evaluates possible actions during main phases and selects the best one
 * using a combination of game state evaluation, strategic heuristics, and
 * risk assessment.
 */
export class MainPhaseDecisionTree {
  private gameState: GameState;
  private playerId: string;
  private config: DecisionTreeConfig;
  private evaluator: GameStateEvaluator;

  constructor(
    gameState: GameState,
    playerId: string,
    config?: Partial<DecisionTreeConfig>
  ) {
    this.gameState = gameState;
    this.playerId = playerId;
    this.config = {
      ...DefaultConfigs.medium,
      ...config,
    };
    this.evaluator = new GameStateEvaluator(
      this.convertToEvaluatorState(),
      playerId,
      this.config.difficulty
    );
  }

  /**
   * Main decision function - returns the best action to take
   */
  decide(): DecisionTreeResult {
    const stateEvaluation = this.evaluator.evaluate();

    // Get all possible actions
    const possibleActions = this.generatePossibleActions();

    // Rank actions by value
    const rankedActions = this.rankActions(possibleActions, stateEvaluation);

    // Determine if we should pass priority
    const shouldPassPriority = this.shouldPassPriority(
      rankedActions,
      stateEvaluation
    );

    // Select best action
    const bestAction = shouldPassPriority
      ? null
      : rankedActions.length > 0
      ? rankedActions[0]
      : null;

    // Calculate confidence
    const confidence = this.calculateConfidence(
      bestAction,
      rankedActions,
      stateEvaluation
    );

    return {
      bestAction,
      rankedActions,
      stateEvaluation,
      shouldPassPriority,
      confidence,
    };
  }

  /**
   * Generate all possible actions for current game state
   */
  private generatePossibleActions(): PossibleAction[] {
    const actions: PossibleAction[] = [];
    const player = this.getCurrentPlayer();
    const phase = this.gameState.turn.currentPhase;

    // Check if we're in a main phase
    const isMainPhase =
      phase === Phase.PRECOMBAT_MAIN || phase === Phase.POSTCOMBAT_MAIN;

    if (!isMainPhase) {
      return actions;
    }

    // Land play decisions
    const landActions = this.evaluateLandPlays(player);
    actions.push(...landActions);

    // Spell casting decisions
    const spellActions = this.evaluateSpellCasts(player);
    actions.push(...spellActions);

    // Activated ability decisions
    const abilityActions = this.evaluateActivatedAbilities(player);
    actions.push(...abilityActions);

    return actions;
  }

  /**
   * Evaluate land play options
   */
  private evaluateLandPlays(player: Player): PossibleAction[] {
    const actions: PossibleAction[] = [];

    // Check if we can play a land
    if (player.landsPlayedThisTurn >= this.config.maxLandsPerTurn) {
      return actions;
    }

    // Get lands in hand
    const landsInHand = this.getCardsInHand(player).filter(
      (card) =>
        card.cardData.type_line?.toLowerCase().includes('land') ||
        card.cardData.oracle_id?.includes('land')
    );

    if (landsInHand.length === 0) {
      return actions;
    }

    // Evaluate each land
    for (const land of landsInHand) {
      const action = this.evaluateLandPlay(land, player);
      if (action) {
        actions.push(action);
      }
    }

    return actions;
  }

  /**
   * Evaluate a single land play
   */
  private evaluateLandPlay(
    land: CardInstance,
    player: Player
  ): PossibleAction | null {
    // Basic value for playing a land
    let value = 0.5;

    // Check if we need mana
    const currentMana = this.getTotalMana(player.manaPool);
    const landsInPlay = this.getLandsInPlay(player);

    // Higher value if we're behind on mana
    if (landsInPlay.length < this.gameState.turn.turnNumber) {
      value += 0.3;
    }

    // Consider land type (basic vs dual/utility)
    const isBasic = land.cardData.type_line?.toLowerCase().includes('basic');
    const hasColorInName = /[WUBRG]/i.test(land.cardData.name || '');

    if (!isBasic || hasColorInName) {
      value += 0.2; // Dual lands and utility lands are valuable
    }

    // Check for land types we need
    const neededColors = this.getNeededManaColors(player);
    if (neededColors.size > 0) {
      const providesNeededColor = this.checkLandProvidesColor(
        land,
        neededColors
      );
      if (providesNeededColor) {
        value += 0.3;
      }
    }

    return {
      type: 'play_land',
      cardId: land.id,
      value: Math.min(1, value),
      risk: 0.0, // Land play is essentially risk-free
      manaCost: this.emptyManaPool(),
      reasoning: this.generateLandPlayReasoning(land, player, value),
      priority: value > 0.7 ? 'high' : 'medium',
    };
  }

  /**
   * Evaluate spell casting options
   */
  private evaluateSpellCasts(player: Player): PossibleAction[] {
    const actions: PossibleAction[] = [];
    const availableMana = player.manaPool;

    // Get castable cards in hand
    const cardsInHand = this.getCardsInHand(player);
    const castableSpells = cardsInHand.filter((card) =>
      this.canCastSpell(card, availableMana)
    );

    for (const spell of castableSpells) {
      const action = this.evaluateSpellCast(spell, player);
      if (action && action.value >= this.config.minValueThreshold) {
        actions.push(action);
      }
    }

    return actions;
  }

  /**
   * Evaluate a single spell cast
   */
  private evaluateSpellCast(
    spell: CardInstance,
    player: Player
  ): PossibleAction | null {
    const cardType = spell.cardData.type_line?.toLowerCase() || '';
    const cmc = spell.cardData.cmc || 0;
    const manaCost = this.parseManaCost(spell.cardData.mana_cost || '');

    let value = 0.5; // Base value
    let risk = 0.2; // Base risk
    let reasoning = '';

    // Evaluate based on card type
    if (cardType.includes('creature')) {
      const creatureEval = this.evaluateCreatureSpell(spell, player);
      value = creatureEval.value;
      risk = creatureEval.risk;
      reasoning = creatureEval.reasoning;
    } else if (cardType.includes('instant')) {
      const instantEval = this.evaluateInstantSpell(spell, player);
      value = instantEval.value;
      risk = instantEval.risk;
      reasoning = instantEval.reasoning;

      // Consider holding for instant speed if configured
      if (this.config.holdManaForInstants) {
        const phase = this.gameState.turn.currentPhase;
        if (phase === Phase.PRECOMBAT_MAIN) {
          value *= 0.7; // Reduce value, prefer to hold until after combat
        }
      }
    } else if (cardType.includes('sorcery')) {
      const sorceryEval = this.evaluateSorcerySpell(spell, player);
      value = sorceryEval.value;
      risk = sorceryEval.risk;
      reasoning = sorceryEval.reasoning;
    } else if (cardType.includes('artifact')) {
      const artifactEval = this.evaluateArtifactSpell(spell, player);
      value = artifactEval.value;
      risk = artifactEval.risk;
      reasoning = artifactEval.reasoning;
    } else if (cardType.includes('enchantment')) {
      const enchantmentEval = this.evaluateEnchantmentSpell(spell, player);
      value = enchantmentEval.value;
      risk = enchantmentEval.risk;
      reasoning = enchantmentEval.reasoning;
    } else if (cardType.includes('planeswalker')) {
      const planeswalkerEval = this.evaluatePlaneswalkerSpell(spell, player);
      value = planeswalkerEval.value;
      risk = planeswalkerEval.risk;
      reasoning = planeswalkerEval.reasoning;
    }

    // Adjust for mana efficiency
    const manaEfficiency = this.calculateManaEfficiency(spell, manaCost);
    value *= 1 + (manaEfficiency - 0.5) * this.config.manaEfficiencyWeight;

    // Adjust for timing
    const timingScore = this.evaluateSpellTiming(spell, player);
    value *= 1 + (timingScore - 0.5) * this.config.tempoWeight;

    return {
      type: 'cast_spell',
      cardId: spell.id,
      value: Math.max(0, Math.min(1, value)),
      risk,
      manaCost,
      reasoning,
      priority: value > 0.7 ? 'high' : value > 0.5 ? 'medium' : 'low',
    };
  }

  /**
   * Evaluate creature spell
   */
  private evaluateCreatureSpell(
    spell: CardInstance,
    player: Player
  ): { value: number; risk: number; reasoning: string } {
    let value = 0.5;
    const cmc = spell.cardData.cmc || 0;
    const power = parseInt(spell.cardData.power || '0', 10);
    const toughness = parseInt(spell.cardData.toughness || '0', 10);

    // Efficiency: power/toughness vs mana cost
    const stats = power + toughness;
    const efficiency = stats / (cmc || 1);
    value += Math.min(0.3, (efficiency - 2) * 0.1);

    // Bonus for keywords
    const keywords = spell.cardData.keywords || [];
    const valuableKeywords = ['flying', 'haste', 'vigilance', 'trample', 'deathtouch'];
    const keywordBonus = keywords.filter((k) => valuableKeywords.includes(k.toLowerCase())).length * 0.1;
    value += Math.min(0.3, keywordBonus);

    // Check if we need board presence
    const ourCreatures = this.getCreaturesInPlay(player);
    const opponentCreatures = this.getOpponentCreatures();
    const needBoard = ourCreatures.length < opponentCreatures.length;

    if (needBoard) {
      value += 0.2;
    }

    // Risk assessment
    let risk = 0.2;
    if (opponentCreatures.length > ourCreatures.length) {
      risk += 0.2; // Risk of removal
    }

    const reasoning = `Creature (${power}/${toughness}, ${cmc} mana) - ${
      efficiency > 2.5 ? 'efficient' : 'standard'
    } stats${keywords.length > 0 ? ` with ${keywords.length} keywords` : ''}${
      needBoard ? ' - need board presence' : ''
    }`;

    return { value: Math.max(0, Math.min(1, value)), risk: Math.min(1, risk), reasoning };
  }

  /**
   * Evaluate instant spell
   */
  private evaluateInstantSpell(
    spell: CardInstance,
    player: Player
  ): { value: number; risk: number; reasoning: string } {
    let value = 0.5;
    const cmc = spell.cardData.cmc || 0;
    const oracleText = spell.cardData.oracle_text?.toLowerCase() || '';

    // Instants are valuable for flexibility
    value += 0.2;

    // Check for interactive effects
    if (oracleText.includes('counter') || oracleText.includes('destroy') ||
        oracleText.includes('prevent') || oracleText.includes('protect')) {
      value += 0.3;

      // Even more valuable if there are threats
      const threats = this.evaluator.evaluate().threats;
      if (threats.length > 0) {
        value += 0.2;
      }
    }

    // Card draw is valuable
    if (oracleText.includes('draw')) {
      value += 0.2;
    }

    const reasoning = `Instant (${cmc} mana) - ${
      oracleText.includes('counter') || oracleText.includes('destroy') ?
      'interactive spell' : 'utility'
    } - flexible timing`;

    return { value: Math.max(0, Math.min(1, value)), risk: 0.3, reasoning };
  }

  /**
   * Evaluate sorcery spell
   */
  private evaluateSorcerySpell(
    spell: CardInstance,
    player: Player
  ): { value: number; risk: number; reasoning: string } {
    let value = 0.5;
    const cmc = spell.cardData.cmc || 0;
    const oracleText = spell.cardData.oracle_text?.toLowerCase() || '';

    // Card draw
    if (oracleText.includes('draw')) {
      const cardsDrawn = this.parseCardDrawCount(oracleText);
      value += Math.min(0.3, cardsDrawn * 0.1);
    }

    // Removal
    if (oracleText.includes('destroy') || oracleText.includes('exile')) {
      const opponentCreatures = this.getOpponentCreatures();
      if (opponentCreatures.length > 0) {
        value += 0.3;
      }
    }

    // Ramp effects
    if (oracleText.includes('search') && oracleText.includes('land')) {
      const landsInPlay = this.getLandsInPlay(player);
      if (landsInPlay.length < 5) {
        value += 0.3;
      }
    }

    const reasoning = `Sorcery (${cmc} mana) - ${
      oracleText.includes('draw') ? 'card draw' :
      oracleText.includes('destroy') ? 'removal' :
      'utility'
    }`;

    return { value: Math.max(0, Math.min(1, value)), risk: 0.2, reasoning };
  }

  /**
   * Evaluate artifact spell
   */
  private evaluateArtifactSpell(
    spell: CardInstance,
    player: Player
  ): { value: number; risk: number; reasoning: string } {
    let value = 0.5;
    const cmc = spell.cardData.cmc || 0;
    const oracleText = spell.cardData.oracle_text?.toLowerCase() || '';

    // Equipment
    if (oracleText.includes('equip')) {
      const creatures = this.getCreaturesInPlay(player);
      if (creatures.length > 0) {
        value += 0.3;
      }
    }

    // Mana rocks
    if (oracleText.includes('add') && oracleText.includes('mana')) {
      const landsInPlay = this.getLandsInPlay(player);
      if (landsInPlay.length < 5) {
        value += 0.3;
      }
    }

    const reasoning = `Artifact (${cmc} mana) - ${
      oracleText.includes('equip') ? 'equipment' :
      oracleText.includes('add') ? 'mana ramp' :
      'utility artifact'
    }`;

    return { value: Math.max(0, Math.min(1, value)), risk: 0.2, reasoning };
  }

  /**
   * Evaluate enchantment spell
   */
  private evaluateEnchantmentSpell(
    spell: CardInstance,
    player: Player
  ): { value: number; risk: number; reasoning: string } {
    let value = 0.5;
    const cmc = spell.cardData.cmc || 0;
    const oracleText = spell.cardData.oracle_text?.toLowerCase() || '';

    // Auras
    if (spell.cardData.type_line?.toLowerCase().includes('aura')) {
      const creatures = this.getCreaturesInPlay(player);
      if (creatures.length > 0) {
        value += 0.3;
      }
    }

    // Enchantment removal (like Detention Sphere)
    if (oracleText.includes('exile') || oracleText.includes('destroy')) {
      const opponentPermanents = this.getOpponentPermanents();
      if (opponentPermanents.length > 0) {
        value += 0.3;
      }
    }

    const reasoning = `Enchantment (${cmc} mana) - ${
      spell.cardData.type_line?.toLowerCase().includes('aura') ? 'aura' :
      oracleText.includes('exile') ? 'removal' :
      'global effect'
    }`;

    return { value: Math.max(0, Math.min(1, value)), risk: 0.3, reasoning };
  }

  /**
   * Evaluate planeswalker spell
   */
  private evaluatePlaneswalkerSpell(
    spell: CardInstance,
    player: Player
  ): { value: number; risk: number; reasoning: string } {
    let value = 0.6; // Planeswalkers are inherently valuable
    const cmc = spell.cardData.cmc || 0;

    // Check if we have board protection
    const creatures = this.getCreaturesInPlay(player);
    if (creatures.length > 0) {
      value += 0.2;
    }

    // Higher value later in game
    const turnNumber = this.gameState.turn.turnNumber;
    if (turnNumber >= 5) {
      value += 0.2;
    }

    const reasoning = `Planeswalker (${cmc} mana) - high value threat`;

    return { value: Math.max(0, Math.min(1, value)), risk: 0.3, reasoning };
  }

  /**
   * Evaluate activated ability options
   */
  private evaluateActivatedAbilities(player: Player): PossibleAction[] {
    const actions: PossibleAction[] = [];
    const battlefield = this.getCardsInPlay(player);

    for (const permanent of battlefield) {
      const abilities = this.extractActivatedAbilities(permanent);
      for (const ability of abilities) {
        const action = this.evaluateActivatedAbility(permanent, ability, player);
        if (action && action.value >= this.config.minValueThreshold) {
          actions.push(action);
        }
      }
    }

    return actions;
  }

  /**
   * Evaluate a single activated ability
   */
  private evaluateActivatedAbility(
    permanent: CardInstance,
    ability: string,
    player: Player
  ): PossibleAction | null {
    let value = 0.3;
    const abilityLower = ability.toLowerCase();

    // Mana abilities are usually low priority
    if (abilityLower.includes('add') && abilityLower.includes('mana')) {
      return null; // Handle mana abilities separately
    }

    // Card draw
    if (abilityLower.includes('draw')) {
      value += 0.4;
    }

    // Creature pump
    if (abilityLower.includes('gets') &&
        (abilityLower.includes('+1/+1') || abilityLower.includes('+2/+2'))) {
      value += 0.3;
    }

    // Removal
    if (abilityLower.includes('destroy') || abilityLower.includes('damage')) {
      const opponentCreatures = this.getOpponentCreatures();
      if (opponentCreatures.length > 0) {
        value += 0.4;
      }
    }

    return {
      type: 'activate_ability',
      cardId: permanent.id,
      abilityText: ability,
      value: Math.min(1, value),
      risk: 0.3,
      manaCost: this.parseAbilityManaCost(ability),
      reasoning: `Activated ability: ${ability.substring(0, 50)}...`,
      priority: value > 0.6 ? 'high' : 'medium',
    };
  }

  /**
   * Determine if we should pass priority
   */
  private shouldPassPriority(
    actions: PossibleAction[],
    evaluation: DetailedEvaluation
  ): boolean {
    // Pass if no actions available
    if (actions.length === 0) {
      return true;
    }

    // Pass if best action is below threshold
    const bestAction = actions[0];
    if (bestAction.value < this.config.minValueThreshold) {
      return true;
    }

    // Pass if best action is too risky
    if (bestAction.risk > this.config.maxRiskThreshold) {
      return true;
    }

    // Consider holding mana for instant-speed interaction
    if (this.config.holdManaForInstants) {
      const hasInstants = this.hasInstantsInHand();
      const phase = this.gameState.turn.currentPhase;

      if (hasInstants && phase === Phase.PRECOMBAT_MAIN) {
        // Hold mana if we have instants and it's precombat main
        const manaRemaining = this.getTotalMana(this.getCurrentPlayer().manaPool);
        if (manaRemaining >= 2) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Rank actions by value
   */
  private rankActions(
    actions: PossibleAction[],
    evaluation: DetailedEvaluation
  ): PossibleAction[] {
    return actions
      .map((action) => {
        // Adjust value based on game state evaluation
        let adjustedValue = action.value;

        // Boost actions that address threats
        if (evaluation.threats.length > 0) {
          const isRemoval = action.reasoning.toLowerCase().includes('removal') ||
                           action.reasoning.toLowerCase().includes('destroy');
          if (isRemoval) {
            adjustedValue += 0.2;
          }
        }

        // Boost card advantage actions
        const isCardDraw = action.reasoning.toLowerCase().includes('draw');
        if (isCardDraw && evaluation.factors.cardAdvantage < 0) {
          adjustedValue += 0.3;
        }

        return { ...action, value: Math.min(1, adjustedValue) };
      })
      .sort((a, b) => {
        // Sort by priority first, then value
        const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
        if (priorityDiff !== 0) return priorityDiff;

        // Then sort by value (descending)
        return b.value - a.value;

        // Finally sort by risk (ascending)
      })
      .sort((a, b) => {
        if (Math.abs(a.value - b.value) < 0.1) {
          return a.risk - b.risk;
        }
        return 0;
      });
  }

  /**
   * Calculate confidence in decision
   */
  private calculateConfidence(
    bestAction: PossibleAction | null,
    rankedActions: PossibleAction[],
    evaluation: DetailedEvaluation
  ): number {
    if (!bestAction) {
      return 0.9; // High confidence in passing
    }

    let confidence = 0.5;

    // Higher confidence if best action is much better than second best
    if (rankedActions.length >= 2) {
      const valueDiff = bestAction.value - rankedActions[1].value;
      confidence += Math.min(0.3, valueDiff * 0.5);
    }

    // Higher confidence if best action is low risk
    if (bestAction.risk < 0.3) {
      confidence += 0.2;
    }

    // Adjust based on game state clarity
    if (Math.abs(evaluation.totalScore) > 5) {
      confidence += 0.2; // Clear winning or losing
    }

    return Math.min(1, confidence);
  }

  // Helper methods

  private getCurrentPlayer(): Player {
    return this.gameState.players.get(this.playerId)!;
  }

  private getCardsInHand(player: Player): CardInstance[] {
    const handZone = [...this.gameState.zones.values()].find(
      (zone) => zone.type === 'hand' && zone.playerId === player.id
    );
    if (!handZone) return [];

    return handZone.cardIds
      .map((id) => this.gameState.cards.get(id))
      .filter((card): card is CardInstance => card !== undefined);
  }

  private getCardsInPlay(player: Player): CardInstance[] {
    const battlefieldZone = [...this.gameState.zones.values()].find(
      (zone) => zone.type === 'battlefield' && zone.playerId === player.id
    );
    if (!battlefieldZone) return [];

    return battlefieldZone.cardIds
      .map((id) => this.gameState.cards.get(id))
      .filter((card): card is CardInstance => card !== undefined);
  }

  private getCreaturesInPlay(player: Player): CardInstance[] {
    return this.getCardsInPlay(player).filter((card) =>
      card.cardData.type_line?.toLowerCase().includes('creature')
    );
  }

  private getLandsInPlay(player: Player): CardInstance[] {
    return this.getCardsInPlay(player).filter((card) =>
      card.cardData.type_line?.toLowerCase().includes('land')
    );
  }

  private getOpponentCreatures(): CardInstance[] {
    const creatures: CardInstance[] = [];
    for (const [playerId, player] of this.gameState.players) {
      if (playerId !== this.playerId) {
        creatures.push(...this.getCreaturesInPlay(player));
      }
    }
    return creatures;
  }

  private getOpponentPermanents(): CardInstance[] {
    const permanents: CardInstance[] = [];
    for (const [playerId, player] of this.gameState.players) {
      if (playerId !== this.playerId) {
        permanents.push(...this.getCardsInPlay(player));
      }
    }
    return permanents;
  }

  private canCastSpell(card: CardInstance, manaPool: ManaPool): boolean {
    const cost = card.cardData.mana_cost;
    if (!cost) return false;

    // Simplified check - in reality would need full mana cost parsing
    const cmc = card.cardData.cmc || 0;
    const totalMana = this.getTotalMana(manaPool);
    return totalMana >= cmc;
  }

  private getTotalMana(manaPool: ManaPool): number {
    return (
      manaPool.colorless +
      manaPool.white +
      manaPool.blue +
      manaPool.black +
      manaPool.red +
      manaPool.green +
      manaPool.generic
    );
  }

  private parseManaCost(cost: string): ManaPool {
    const result = this.emptyManaPool();

    // Parse mana cost string (e.g., "{2}{W}{U}")
    const matches = cost.match(/\{([^}]+)\}/g);
    if (matches) {
      for (const match of matches) {
        const symbol = match.slice(1, -1);
        if (symbol === 'W') result.white++;
        else if (symbol === 'U') result.blue++;
        else if (symbol === 'B') result.black++;
        else if (symbol === 'R') result.red++;
        else if (symbol === 'G') result.green++;
        else if (!isNaN(parseInt(symbol))) result.colorless += parseInt(symbol);
      }
    }

    return result;
  }

  private parseAbilityManaCost(ability: string): ManaPool {
    const result = this.emptyManaPool();

    // Look for mana cost in ability text (e.g., "{1}{W}, Tap:")
    const costMatch = ability.match(/^([{}WUBRG0-9,\s]+)(?:,|$)/);
    if (costMatch) {
      return this.parseManaCost(costMatch[1]);
    }

    return result;
  }

  private emptyManaPool(): ManaPool {
    return {
      colorless: 0,
      white: 0,
      blue: 0,
      black: 0,
      red: 0,
      green: 0,
      generic: 0,
    };
  }

  private getNeededManaColors(player: Player): Set<string> {
    // Check cards in hand to see what colors we need
    const cardsInHand = this.getCardsInHand(player);
    const neededColors = new Set<string>();

    for (const card of cardsInHand) {
      const colors = card.cardData.colors || [];
      for (const color of colors) {
        const colorMap: Record<string, string> = {
          W: 'white',
          U: 'blue',
          B: 'black',
          R: 'red',
          G: 'green',
        };
        neededColors.add(colorMap[color]);
      }
    }

    return neededColors;
  }

  private checkLandProvidesColor(
    land: CardInstance,
    neededColors: Set<string>
  ): boolean {
    const oracleText = land.cardData.oracle_text?.toLowerCase() || '';

    for (const color of neededColors) {
      if (oracleText.includes(`adds ${color}`) ||
          oracleText.includes(`add ${color}`) ||
          oracleText.includes(`tap: ${color}`)) {
        return true;
      }
    }

    return false;
  }

  private extractActivatedAbilities(permanent: CardInstance): string[] {
    const oracleText = permanent.cardData.oracle_text || '';
    const abilities: string[] = [];

    // Split by colon and look for costs
    const lines = oracleText.split('\n');
    for (const line of lines) {
      if (line.includes(':') && (line.includes('{') || line.includes('Tap'))) {
        abilities.push(line.trim());
      }
    }

    return abilities;
  }

  private calculateManaEfficiency(
    spell: CardInstance,
    cost: ManaPool
  ): number {
    const cmc = spell.cardData.cmc || 1;
    const totalCost = this.getTotalMana(cost);

    if (totalCost === 0) return 1;

    // Check if we have enough colored mana
    const player = this.getCurrentPlayer();
    const hasCorrectColors =
      (cost.white === 0 || player.manaPool.white >= cost.white) &&
      (cost.blue === 0 || player.manaPool.blue >= cost.blue) &&
      (cost.black === 0 || player.manaPool.black >= cost.black) &&
      (cost.red === 0 || player.manaPool.red >= cost.red) &&
      (cost.green === 0 || player.manaPool.green >= cost.green);

    return hasCorrectColors ? 1 : 0.5;
  }

  private evaluateSpellTiming(spell: CardInstance, player: Player): number {
    let score = 0.5;
    const turnNumber = this.gameState.turn.turnNumber;
    const cmc = spell.cardData.cmc || 0;

    // Low-cost spells are better early
    if (cmc <= 2 && turnNumber <= 3) {
      score += 0.3;
    }

    // High-cost spells are better later
    if (cmc >= 4 && turnNumber >= 5) {
      score += 0.3;
    }

    return Math.min(1, score);
  }

  private parseCardDrawCount(oracleText: string): number {
    const match = oracleText.match(/draw\s+(\d+)/);
    if (match) {
      return parseInt(match[1]);
    }
    // Default assumption
    return 1;
  }

  private hasInstantsInHand(): boolean {
    const player = this.getCurrentPlayer();
    const cardsInHand = this.getCardsInHand(player);

    return cardsInHand.some(
      (card) => card.cardData.type_line?.toLowerCase().includes('instant')
    );
  }

  private generateLandPlayReasoning(
    land: CardInstance,
    player: Player,
    value: number
  ): string {
    const landName = land.cardData.name || 'Land';
    const landsInPlay = this.getLandsInPlay(player).length;
    const turnNumber = this.gameState.turn.turnNumber;

    let reasoning = `Play ${landName}`;

    if (landsInPlay < turnNumber) {
      reasoning += ' - behind on mana development';
    }

    if (value > 0.7) {
      reasoning += ' - high priority';
    }

    return reasoning;
  }

  /**
   * Convert game state to evaluator state format
   * This bridges the two different game state representations
   */
  private convertToEvaluatorState(): import('../game-state-evaluator').GameState {
    const players: Record<string, import('../game-state-evaluator').PlayerState> = {};

    for (const [playerId, player] of this.gameState.players) {
      const handCards = this.getCardsInHand(player).map((card) => ({
        cardId: card.oracleId,
        name: card.cardData.name || '',
        type: card.cardData.type_line || '',
        manaValue: card.cardData.cmc || 0,
        colors: card.cardData.colors || [],
      }));

      const battlefield = this.getCardsInPlay(player).map((card) => {
        const base = {
          id: card.id,
          cardId: card.oracleId,
          name: card.cardData.name || '',
          controller: playerId,
          tapped: card.isTapped,
          manaValue: card.cardData.cmc || 0,
        };

        const type = card.cardData.type_line?.toLowerCase() || '';
        if (type.includes('creature')) {
          return {
            ...base,
            type: 'creature' as const,
            power: parseInt(card.cardData.power || '0'),
            toughness: parseInt(card.cardData.toughness || '0'),
            keywords: card.cardData.keywords || [],
          };
        } else if (type.includes('land')) {
          return {
            ...base,
            type: 'land' as const,
          };
        } else if (type.includes('artifact')) {
          return {
            ...base,
            type: 'artifact' as const,
          };
        } else if (type.includes('enchantment')) {
          return {
            ...base,
            type: 'enchantment' as const,
          };
        } else if (type.includes('planeswalker')) {
          return {
            ...base,
            type: 'planeswalker' as const,
            loyalty: 0, // Would need to track counters
          };
        }
        return { ...base, type: 'artifact' as const }; // Default fallback
      });

      players[playerId] = {
        id: playerId,
        life: player.life,
        poisonCounters: player.poisonCounters,
        commanderDamage: Object.fromEntries(player.commanderDamage),
        hand: handCards,
        graveyard: [],
        exile: [],
        library: 30, // Placeholder
        battlefield,
        manaPool: {
          colorless: player.manaPool.colorless,
          white: player.manaPool.white,
          blue: player.manaPool.blue,
          black: player.manaPool.black,
          red: player.manaPool.red,
          green: player.manaPool.green,
        },
      };
    }

    return {
      players,
      turnInfo: {
        currentTurn: this.gameState.turn.turnNumber,
        currentPlayer: this.gameState.turn.activePlayerId,
        phase: this.convertPhase(this.gameState.turn.currentPhase),
        priority: this.gameState.priorityPlayerId || '',
      },
      stack: [],
    };
  }

  private convertPhase(
    phase: Phase
  ): 'beginning' | 'precombat_main' | 'combat' | 'postcombat_main' | 'end' {
    switch (phase) {
      case Phase.PRECOMBAT_MAIN:
        return 'precombat_main';
      case Phase.POSTCOMBAT_MAIN:
        return 'postcombat_main';
      case Phase.BEGIN_COMBAT:
      case Phase.DECLARE_ATTACKERS:
      case Phase.DECLARE_BLOCKERS:
      case Phase.COMBAT_DAMAGE_FIRST_STRIKE:
      case Phase.COMBAT_DAMAGE:
      case Phase.END_COMBAT:
        return 'combat';
      case Phase.END:
      case Phase.CLEANUP:
        return 'end';
      default:
        return 'beginning';
    }
  }
}

/**
 * Convenience function to get the best main phase action
 */
export function getBestMainPhaseAction(
  gameState: GameState,
  playerId: string,
  config?: Partial<DecisionTreeConfig>
): DecisionTreeResult {
  const decisionTree = new MainPhaseDecisionTree(gameState, playerId, config);
  return decisionTree.decide();
}
