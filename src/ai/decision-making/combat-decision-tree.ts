/**
 * @fileoverview Combat AI Decision-Making System for Magic: The Gathering
 *
 * This module provides intelligent combat decision-making for AI opponents,
 * including attacker selection, blocking decisions, damage optimization, and
 * combat trick evaluation. It integrates with the game state evaluator to
 * make strategic combat decisions.
 *
 * Key components:
 * - Attacker selection: Determine which creatures to attack with
 * - Attack decisions: Attack opponent, go for face, or hold back
 * - Blocking decisions: Which creatures to block with
 * - Blocker assignment: Optimal blocker ordering for multi-blocks
 * - Combat trick evaluation: When to use pump spells and tricks
 * - Evasion consideration: Handle flying, unblockable, etc.
 * - Damage optimization: Trample, first strike, double strike
 * - Trade assessment: 2-for-1 evaluation
 */

import {
  GameState,
  Permanent,
  PlayerState,
} from '../game-state-evaluator';

/**
 * Represents an attack decision for a creature
 */
export interface AttackDecision {
  /** ID of the creature to attack with */
  creatureId: string;
  /** Whether to attack with this creature */
  shouldAttack: boolean;
  /** Target to attack (player ID or 'none' to hold back) */
  target: string | 'none';
  /** Reasoning for this decision */
  reasoning: string;
  /** Expected value of this attack (0-1 scale) */
  expectedValue: number;
  /** Risk level of this attack (0-1 scale) */
  riskLevel: number;
}

/**
 * Represents a blocking decision for a creature
 */
export interface BlockDecision {
  /** ID of the creature to block with */
  blockerId: string;
  /** ID of the attacker to block (or null to not block) */
  attackerId: string | null;
  /** Damage order if multiple blockers (0 = first) */
  damageOrder?: number;
  /** Reasoning for this decision */
  reasoning: string;
  /** Expected value of this block (0-1 scale) */
  expectedValue: number;
}

/**
 * Represents a complete combat plan
 */
export interface CombatPlan {
  /** Attack decisions */
  attacks: AttackDecision[];
  /** Blocking decisions */
  blocks: BlockDecision[];
  /** Overall combat strategy */
  strategy: 'aggressive' | 'moderate' | 'defensive';
  /** Total expected value of all combat decisions */
  totalExpectedValue: number;
  /** Recommended combat tricks (pump spells, etc.) */
  combatTricks: CombatTrick[];
}

/**
 * Represents a combat trick (instant-speed effect during combat)
 */
export interface CombatTrick {
  /** ID of the card to use (if in hand) */
  cardId?: string;
  /** Name of the trick */
  name: string;
  /** When to use the trick */
  timing: 'before_attackers' | 'before_blockers' | 'after_blockers' | 'damage';
  /** Target creature ID */
  targetId?: string;
  /** Expected value of using the trick */
  expectedValue: number;
  /** Reasoning for using the trick */
  reasoning: string;
}

/**
 * Combat AI configuration
 */
export interface CombatAIConfig {
  /** Aggression level (0 = defensive, 1 = aggressive) */
  aggression: number;
  /** Risk tolerance (0 = cautious, 1 = risky) */
  riskTolerance: number;
  /** Life threshold where AI becomes defensive */
  lifeThreshold: number;
  /** Value of card advantage vs life */
  cardAdvantageWeight: number;
  /** Whether to consider combat tricks */
  useCombatTricks: boolean;
}

/**
 * Default configurations for different difficulty levels
 */
export const DefaultCombatConfigs: Record<
  'easy' | 'medium' | 'hard',
  CombatAIConfig
> = {
  easy: {
    aggression: 0.3,
    riskTolerance: 0.2,
    lifeThreshold: 15,
    cardAdvantageWeight: 0.5,
    useCombatTricks: false,
  },
  medium: {
    aggression: 0.5,
    riskTolerance: 0.5,
    lifeThreshold: 10,
    cardAdvantageWeight: 1.0,
    useCombatTricks: true,
  },
  hard: {
    aggression: 0.7,
    riskTolerance: 0.7,
    lifeThreshold: 7,
    cardAdvantageWeight: 1.5,
    useCombatTricks: true,
  },
};

/**
 * Main combat AI decision maker
 */
export class CombatDecisionTree {
  private gameState: GameState;
  private aiPlayerId: string;
  private config: CombatAIConfig;

  constructor(
    gameState: GameState,
    aiPlayerId: string,
    difficulty: 'easy' | 'medium' | 'hard' = 'medium'
  ) {
    this.gameState = gameState;
    this.aiPlayerId = aiPlayerId;
    this.config = DefaultCombatConfigs[difficulty];
  }

  /**
   * Set custom combat AI configuration
   */
  setConfig(config: Partial<CombatAIConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Generate attack decisions for the current turn
   */
  generateAttackPlan(): CombatPlan {
    const aiPlayer = this.gameState.players[this.aiPlayerId];
    const opponents = this.getOpponents();

    const attackableCreatures = this.getAttackableCreatures(aiPlayer);
    const attackDecisions: AttackDecision[] = [];

    // Determine overall strategy
    const strategy = this.determineCombatStrategy(aiPlayer, opponents);

    for (const creature of attackableCreatures) {
      const decision = this.evaluateAttacker(creature, opponents, strategy);
      if (decision.shouldAttack) {
        attackDecisions.push(decision);
      }
    }

    // Consider combat tricks
    const combatTricks = this.config.useCombatTricks
      ? this.evaluateCombatTricks(aiPlayer, attackDecisions)
      : [];

    return {
      attacks: attackDecisions,
      blocks: [],
      strategy,
      totalExpectedValue: this.calculateTotalExpectedValue(attackDecisions),
      combatTricks,
    };
  }

  /**
   * Generate blocking decisions for opponent's attacks
   */
  generateBlockingPlan(attackers: Permanent[]): CombatPlan {
    const aiPlayer = this.gameState.players[this.aiPlayerId];
    const blockers = this.getBlockingCreatures(aiPlayer);

    const blockDecisions: BlockDecision[] = [];

    // Evaluate each attacker
    for (const attacker of attackers) {
      const blocks = this.evaluateBlocksForAttacker(attacker, blockers);
      blockDecisions.push(...blocks);
    }

    // Optimize blocker ordering for multi-blocks
    this.optimizeBlockerOrdering(blockDecisions);

    return {
      attacks: [],
      blocks: blockDecisions,
      strategy: 'defensive',
      totalExpectedValue: this.calculateTotalBlockValue(blockDecisions),
      combatTricks: [],
    };
  }

  /**
   * Get all creatures that can attack this turn
   */
  private getAttackableCreatures(player: PlayerState): Permanent[] {
    return player.battlefield.filter(
      (p) =>
        p.type === 'creature' &&
        !p.tapped &&
        (p.power || 0) > 0 &&
        !this.hasSummoningSickness(p)
    );
  }

  /**
   * Get all creatures that can block
   */
  private getBlockingCreatures(player: PlayerState): Permanent[] {
    return player.battlefield.filter(
      (p) => p.type === 'creature' && !p.tapped
    );
  }

  /**
   * Check if a creature has summoning sickness
   */
  private hasSummoningSickness(creature: Permanent): boolean {
    // In a real implementation, this would check when the creature entered
    // For now, assume creatures without haste have summoning sickness
    return !creature.keywords?.includes('haste');
  }

  /**
   * Determine overall combat strategy based on game state
   */
  private determineCombatStrategy(
    aiPlayer: PlayerState,
    opponents: PlayerState[]
  ): 'aggressive' | 'moderate' | 'defensive' {
    const minOpponentLife = Math.min(...opponents.map((o) => o.life));
    const lifeTotal = aiPlayer.life;
    const creatureCount = aiPlayer.battlefield.filter(
      (p) => p.type === 'creature'
    ).length;
    const avgOpponentCreatures =
      opponents.reduce(
        (sum, o) => sum + o.battlefield.filter((p) => p.type === 'creature').length,
        0
      ) / opponents.length;

    // Low life: play defensively
    if (lifeTotal <= this.config.lifeThreshold) {
      return 'defensive';
    }

    // Opponent low life: be aggressive
    if (minOpponentLife <= 10) {
      return 'aggressive';
    }

    // Board advantage: be moderate to aggressive
    if (creatureCount > avgOpponentCreatures + 1) {
      return this.config.aggression > 0.6 ? 'aggressive' : 'moderate';
    }

    // Board disadvantage: play defensively
    if (creatureCount < avgOpponentCreatures - 1) {
      return 'defensive';
    }

    // Even board: use configured aggression
    if (this.config.aggression > 0.6) return 'aggressive';
    if (this.config.aggression < 0.4) return 'defensive';
    return 'moderate';
  }

  /**
   * Evaluate whether a creature should attack
   */
  private evaluateAttacker(
    creature: Permanent,
    opponents: PlayerState[],
    strategy: 'aggressive' | 'moderate' | 'defensive'
  ): AttackDecision {
    let shouldAttack = false;
    let target: string | 'none' = 'none';
    let reasoning = '';
    let expectedValue = 0;
    let riskLevel = 0;

    const hasEvasion = this.hasEvasion(creature);

    // Get potential blockers for each opponent
    const opponentAnalyses = opponents.map((opponent) => {
      const potentialBlockers = this.getPotentialBlockers(opponent, creature);
      const canBlock = potentialBlockers.length > 0;

      return {
        opponent,
        potentialBlockers,
        canBlock,
        blocks: canBlock ? this.simulateBlocks(creature, potentialBlockers) : [],
      };
    });

    // Find best attack target
    let bestTarget: string | null = null;
    let bestTargetValue = -Infinity;

    for (const analysis of opponentAnalyses) {
      const targetValue = this.evaluateAttackTarget(
        creature,
        analysis.opponent,
        analysis.blocks,
        strategy
      );

      if (targetValue > bestTargetValue) {
        bestTargetValue = targetValue;
        bestTarget = analysis.opponent.id;
      }
    }

    // Decide whether to attack
    const attackThreshold =
      strategy === 'aggressive'
        ? 0.3
        : strategy === 'moderate'
        ? 0.5
        : 0.7;

    // Adjust for evasion (creatures with evasion are safer to attack with)
    const evasionBonus = hasEvasion ? 0.2 : 0;

    // Adjust for creature value (don't risk expensive creatures unnecessarily)
    const manaValue = creature.manaValue || 0;
    const creatureValuePenalty = Math.min(0.3, manaValue / 20);

    const adjustedValue = bestTargetValue + evasionBonus - creatureValuePenalty;

    if (adjustedValue >= attackThreshold) {
      shouldAttack = true;
      target = bestTarget!;
      expectedValue = Math.max(0, Math.min(1, adjustedValue));
      reasoning = this.generateAttackReasoning(
        creature,
        bestTarget!,
        expectedValue,
        hasEvasion
      );
      riskLevel = this.calculateAttackRisk(creature, opponentAnalyses);
    } else {
      shouldAttack = false;
      reasoning = this.generateHoldReasoning(creature, bestTargetValue);
    }

    return {
      creatureId: creature.id,
      shouldAttack,
      target,
      reasoning,
      expectedValue,
      riskLevel,
    };
  }

  /**
   * Check if a creature has evasion abilities
   */
  private hasEvasion(creature: Permanent): boolean {
    const evasionKeywords = [
      'flying',
      'menace',
      'intimidate',
      'fear',
      'unblockable',
      'shadow',
      'skulk',
      'prowl',
      'wither',
      'trample',
    ];
    return (
      creature.keywords?.some((k) => evasionKeywords.includes(k.toLowerCase())) ||
      false
    );
  }

  /**
   * Get potential blockers for an attacking creature
   */
  private getPotentialBlockers(
    opponent: PlayerState,
    attacker: Permanent
  ): Permanent[] {
    return opponent.battlefield.filter((blocker) => {
      if (blocker.type !== 'creature' || blocker.tapped) {
        return false;
      }

      // Check if blocker can block this attacker (evasion check)
      return this.canBlock(blocker, attacker);
    });
  }

  /**
   * Check if a blocker can block an attacker (considering evasion)
   */
  private canBlock(blocker: Permanent, attacker: Permanent): boolean {
    const attackerKeywords = attacker.keywords || [];
    const blockerKeywords = blocker.keywords || [];

    // Flying
    if (attackerKeywords.includes('flying') && !blockerKeywords.includes('flying')) {
      // Can't block unless blocker has reach
      if (!blockerKeywords.includes('reach')) {
        return false;
      }
    }

    // Menace - need 2+ blockers
    if (attackerKeywords.includes('menace')) {
      // This is handled at the block assignment level
    }

    // Intimidate/fear
    if (
      attackerKeywords.includes('intimidate') ||
      attackerKeywords.includes('fear')
    ) {
      // Can only be blocked by artifact creatures and/or creatures that share a color
      // This is a simplified check
      return false; // For now, assume can't block
    }

    // Unblockable
    if (attackerKeywords.includes('unblockable')) {
      return false;
    }

    return true;
  }

  /**
   * Simulate potential blocks for an attacker
   */
  private simulateBlocks(
    attacker: Permanent,
    potentialBlockers: Permanent[]
  ): Array<{ blocker: Permanent; trades: boolean; dies: boolean }> {
    return potentialBlockers.map((blocker) => {
      const attackerPower = attacker.power || 0;
      const attackerToughness = attacker.toughness || 0;
      const blockerPower = blocker.power || 0;
      const blockerToughness = blocker.toughness || 0;

      // Check if attacker dies
      const attackerDies = blockerPower >= attackerToughness;
      // Check if blocker dies
      const blockerDies = attackerPower >= blockerToughness;

      // Trade = both die
      const trades = attackerDies && blockerDies;

      return { blocker, trades, dies: blockerDies };
    });
  }

  /**
   * Evaluate the value of attacking a specific target
   */
  private evaluateAttackTarget(
    creature: Permanent,
    opponent: PlayerState,
    blocks: Array<{ blocker: Permanent; trades: boolean; dies: boolean }>,
    strategy: 'aggressive' | 'moderate' | 'defensive'
  ): number {
    const power = creature.power || 0;
    const toughness = creature.toughness || 0;
    const hasTrample = creature.keywords?.includes('trample') || false;

    // Base value = damage dealt
    let damageDealt = power;
    let creatureDies = false;
    let blockerDies = false;

    if (blocks.length > 0) {
      // Find the "best" block for the defender
      // Defender will choose the block that's worst for us
      const worstBlock = blocks.reduce((worst, block) => {
        if (block.trades) {
          // Trade is bad - we lose our creature
          return block;
        }
        if (block.dies && !worst?.dies) {
          // They lose their blocker - this is good
          return block;
        }
        return worst || block;
      }, blocks[0]);

      creatureDies = worstBlock.trades || worstBlock.blocker.power! >= toughness;
      blockerDies = worstBlock.dies;

      // Calculate damage through
      if (hasTrample && blockerDies) {
        const excessDamage = power - (worstBlock.blocker.toughness || 0);
        damageDealt = Math.max(0, excessDamage);
      } else if (!creatureDies) {
        damageDealt = power;
      } else {
        damageDealt = 0;
      }
    }

    // Calculate value based on damage and trades
    let value = 0;

    // Damage value (higher when opponent is low)
    const lifePercentage = opponent.life / 20;
    const damageValue = (damageDealt / 20) * (2 - lifePercentage);
    value += damageValue;

    // Trade assessment
    if (creatureDies && !blockerDies) {
      // Bad trade - we lose our creature for nothing
      value -= 0.5;
      // Even worse for expensive creatures
      value -= (creature.manaValue || 0) / 20;
    } else if (creatureDies && blockerDies) {
      // Even trade
      value -= 0.1;
      // Check mana value difference
      const creatureValue = creature.manaValue || 0;
      const blockerValue = blocks[0].blocker.manaValue || 0;
      value += (blockerValue - creatureValue) / 20;
    } else if (!creatureDies && blockerDies) {
      // Good trade - we kill their creature
      value += 0.3;
      value += (blocks[0].blocker.manaValue || 0) / 20;
    }

    // Strategy modifiers
    if (strategy === 'aggressive') {
      value += 0.1; // More willing to attack
    } else if (strategy === 'defensive') {
      value -= 0.2; // More cautious
    }

    return value;
  }

  /**
   * Calculate risk level of an attack
   */
  private calculateAttackRisk(
    creature: Permanent,
    opponentAnalyses: Array<{
      opponent: PlayerState;
      potentialBlockers: Permanent[];
      canBlock: boolean;
      blocks: Array<{ blocker: Permanent; trades: boolean; dies: boolean }>;
    }>
  ): number {
    let maxRisk = 0;

    for (const analysis of opponentAnalyses) {
      if (!analysis.canBlock) continue;

      for (const block of analysis.blocks) {
        if (block.trades || block.dies) {
          // Risk of trading or dying
          const risk = block.trades ? 0.7 : 0.3;
          maxRisk = Math.max(maxRisk, risk);
        }
      }
    }

    return Math.min(1, maxRisk);
  }

  /**
   * Generate reasoning for attack decision
   */
  private generateAttackReasoning(
    creature: Permanent,
    targetId: string,
    expectedValue: number,
    hasEvasion: boolean
  ): string {
    const power = creature.power || 0;
    const reasons: string[] = [];

    if (hasEvasion) {
      reasons.push('has evasion');
    }

    if (expectedValue > 0.7) {
      reasons.push('high value attack');
    } else if (expectedValue > 0.4) {
      reasons.push('good attack opportunity');
    } else {
      reasons.push('worthwhile attack');
    }

    return `${creature.name} (${power} power) - ${reasons.join(', ')}`;
  }

  /**
   * Generate reasoning for not attacking
   */
  private generateHoldReasoning(creature: Permanent, value: number): string {
    const power = creature.power || 0;
    const toughness = creature.toughness || 0;

    if (value < 0) {
      return `${creature.name} (${power}/${toughness}) - too risky, would likely die`;
    } else if (value < 0.3) {
      return `${creature.name} (${power}/${toughness}) - low value, hold for defense`;
    } else {
      return `${creature.name} (${power}/${toughness}) - not worth attacking`;
    }
  }

  /**
   * Evaluate blocking decisions for an attacker
   */
  private evaluateBlocksForAttacker(
    attacker: Permanent,
    availableBlockers: Permanent[]
  ): BlockDecision[] {
    const blocks: BlockDecision[] = [];

    if (availableBlockers.length === 0) {
      return blocks;
    }

    const attackerPower = attacker.power || 0;
    const attackerToughness = attacker.toughness || 0;

    // Sort blockers by effectiveness
    const sortedBlockers = [...availableBlockers].sort((a, b) => {
      // Prefer blockers that can kill the attacker
      const aKills = (a.power || 0) >= attackerToughness;
      const bKills = (b.power || 0) >= attackerToughness;

      if (aKills && !bKills) return -1;
      if (!aKills && bKills) return 1;

      // Prefer blockers that survive
      const aSurvives = attackerPower < (a.toughness || 0);
      const bSurvives = attackerPower < (b.toughness || 0);

      if (aSurvives && !bSurvives) return -1;
      if (!aSurvives && bSurvives) return 1;

      // Prefer cheaper blockers (chump blocks)
      const aValue = a.manaValue || 0;
      const bValue = b.manaValue || 0;

      return aValue - bValue;
    });

    // Decide whether to block
    const bestBlocker = sortedBlockers[0];
    const blockerPower = bestBlocker.power || 0;
    const blockerToughness = bestBlocker.toughness || 0;

    const attackerDies = blockerPower >= attackerToughness;
    const blockerDies = attackerPower >= blockerToughness;

    // Calculate block value
    let blockValue = 0;

    if (attackerDies && !blockerDies) {
      // Great block - kill attacker for free
      blockValue = 0.8;
    } else if (attackerDies && blockerDies) {
      // Trade - check mana values
      const attackerValue = attacker.manaValue || 0;
      const blockerValue = bestBlocker.manaValue || 0;
      blockValue = 0.4 + (blockerValue - attackerValue) / 10;
    } else if (!attackerDies && blockerDies) {
      // Chump block - check if worth it
      const lifeSaved = attackerPower;
      const blockerValue = bestBlocker.manaValue || 0;

      // Chump block if:
      // - Low life (prioritize survival)
      // - Blocker is cheap
      // - Attacker is big
      const aiPlayer = this.gameState.players[this.aiPlayerId];
      const isLowLife = aiPlayer.life <= this.config.lifeThreshold;

      if (isLowLife && lifeSaved >= 3) {
        blockValue = 0.5 - blockerValue / 20;
      } else if (blockerValue <= 2) {
        blockValue = 0.3 - blockerValue / 20;
      } else {
        blockValue = -0.2; // Not worth chumping with expensive creature
      }
    } else {
      // Blocker survives but attacker doesn't die
      // Only worth it if preventing significant damage
      const lifeSaved = attackerPower;
      blockValue = lifeSaved / 20 - 0.3;
    }

    // Adjust for first strike
    if (attacker.keywords?.includes('first strike') ||
        attacker.keywords?.includes('double strike')) {
      // First strike makes blocking worse for us
      blockValue -= 0.2;
    }

    if (bestBlocker.keywords?.includes('first strike') ||
        bestBlocker.keywords?.includes('double strike')) {
      // First strike makes blocking better for us
      blockValue += 0.2;
    }

    // Decide whether to block
    if (blockValue > 0) {
      blocks.push({
        blockerId: bestBlocker.id,
        attackerId: attacker.id,
        reasoning: this.generateBlockReasoning(
          bestBlocker,
          attacker,
          attackerDies,
          blockerDies,
          blockValue
        ),
        expectedValue: Math.max(0, Math.min(1, blockValue)),
      });
    }

    // Consider multi-block for menace
    if (attacker.keywords?.includes('menace') && sortedBlockers.length >= 2) {
      const secondBestBlocker = sortedBlockers[1];
      const secondBlockValue = blockValue * 0.6; // Reduced value for second blocker

      if (secondBlockValue > 0.2) {
        blocks.push({
          blockerId: secondBestBlocker.id,
          attackerId: attacker.id,
          damageOrder: 1,
          reasoning: `Second blocker for menace (expected value: ${secondBlockValue.toFixed(2)})`,
          expectedValue: secondBlockValue,
        });
      }
    }

    return blocks;
  }

  /**
   * Optimize blocker ordering for multi-block situations
   */
  private optimizeBlockerOrdering(blocks: BlockDecision[]): void {
    // Group blocks by attacker
    const blocksByAttacker = new Map<string, BlockDecision[]>();
    for (const block of blocks) {
      if (!block.attackerId) continue;
      if (!blocksByAttacker.has(block.attackerId)) {
        blocksByAttacker.set(block.attackerId, []);
      }
      blocksByAttacker.get(block.attackerId)!.push(block);
    }

    // For each multi-block, optimize damage order
    for (const [attackerId, blockerList] of blocksByAttacker) {
      if (blockerList.length <= 1) continue;

      // Sort by "worst first" - put creatures that will die anyway first
      blockerList.sort((a, b) => {
        const blockerA = this.findCreatureById(a.blockerId);
        const blockerB = this.findCreatureById(b.blockerId);

        if (!blockerA || !blockerB) return 0;

        const valueA = blockerA.manaValue || 0;
        const valueB = blockerB.manaValue || 0;

        // Put cheaper creatures first (they're more expendable)
        return valueA - valueB;
      });

      // Assign damage order
      blockerList.forEach((block, index) => {
        block.damageOrder = index;
      });
    }
  }

  /**
   * Generate reasoning for block decision
   */
  private generateBlockReasoning(
    blocker: Permanent,
    attacker: Permanent,
    attackerDies: boolean,
    blockerDies: boolean,
    value: number
  ): string {
    if (attackerDies && !blockerDies) {
      return `${blocker.name} kills ${attacker.name} and survives`;
    } else if (attackerDies && blockerDies) {
      return `${blocker.name} trades with ${attacker.name}`;
    } else if (!attackerDies && blockerDies) {
      return `${blocker.name} chump blocks ${attacker.name}`;
    } else {
      return `${blocker.name} blocks ${attacker.name} (both survive)`;
    }
  }

  /**
   * Find a creature by ID
   */
  private findCreatureById(id: string): Permanent | null {
    for (const player of Object.values(this.gameState.players)) {
      const creature = player.battlefield.find((c) => c.id === id);
      if (creature) return creature;
    }
    return null;
  }

  /**
   * Evaluate combat tricks (pump spells, etc.)
   */
  private evaluateCombatTricks(
    aiPlayer: PlayerState,
    attacks: AttackDecision[]
  ): CombatTrick[] {
    const tricks: CombatTrick[] = [];

    // This would analyze hand for pump spells, combat tricks
    // For now, return empty array
    // TODO: Implement when we have access to card data

    return tricks;
  }

  /**
   * Calculate total expected value of attack decisions
   */
  private calculateTotalExpectedValue(attacks: AttackDecision[]): number {
    if (attacks.length === 0) return 0;
    return attacks.reduce((sum, attack) => sum + attack.expectedValue, 0) / attacks.length;
  }

  /**
   * Calculate total value of block decisions
   */
  private calculateTotalBlockValue(blocks: BlockDecision[]): number {
    if (blocks.length === 0) return 0;
    return blocks.reduce((sum, block) => sum + block.expectedValue, 0) / blocks.length;
  }

  /**
   * Get all opponents
   */
  private getOpponents(): PlayerState[] {
    return Object.values(this.gameState.players).filter(
      (p) => p.id !== this.aiPlayerId
    );
  }
}

/**
 * Convenience function to generate attack decisions
 */
export function generateAttackDecisions(
  gameState: GameState,
  aiPlayerId: string,
  difficulty: 'easy' | 'medium' | 'hard' = 'medium'
): CombatPlan {
  const ai = new CombatDecisionTree(gameState, aiPlayerId, difficulty);
  return ai.generateAttackPlan();
}

/**
 * Convenience function to generate blocking decisions
 */
export function generateBlockingDecisions(
  gameState: GameState,
  aiPlayerId: string,
  attackers: Permanent[],
  difficulty: 'easy' | 'medium' | 'hard' = 'medium'
): CombatPlan {
  const ai = new CombatDecisionTree(gameState, aiPlayerId, difficulty);
  return ai.generateBlockingPlan(attackers);
}
