import type {
  AIPermanent as Permanent,
  AIPlayerState as PlayerState,
} from "@/lib/game-state/types";

export type OpponentArchetype =
  | "aggro"
  | "control"
  | "midrange"
  | "tempo"
  | "combo"
  | "unknown";

export interface BlockPrediction {
  attackerId: string;
  predictedBlockerIds: string[];
  blockProbability: number;
  predictionConfidence: number;
}

export interface BlockPredictionResult {
  predictions: BlockPrediction[];
  archetypeWeights: ArchetypeBlockWeights;
}

export interface ArchetypeBlockWeights {
  willingnessToBlock: number;
  chumpBlockThreshold: number;
  tradeAcceptance: number;
  multiBlockPreference: number;
  valueProtectionWeight: number;
  raceAggressionPenalty: number;
}

const ARCHETYPE_WEIGHTS: Record<OpponentArchetype, ArchetypeBlockWeights> = {
  aggro: {
    willingnessToBlock: 0.3,
    chumpBlockThreshold: 0.2,
    tradeAcceptance: 0.2,
    multiBlockPreference: 0.1,
    valueProtectionWeight: 0.3,
    raceAggressionPenalty: 0.4,
  },
  control: {
    willingnessToBlock: 0.8,
    chumpBlockThreshold: 0.6,
    tradeAcceptance: 0.7,
    multiBlockPreference: 0.6,
    valueProtectionWeight: 0.9,
    raceAggressionPenalty: 0.1,
  },
  midrange: {
    willingnessToBlock: 0.6,
    chumpBlockThreshold: 0.4,
    tradeAcceptance: 0.5,
    multiBlockPreference: 0.3,
    valueProtectionWeight: 0.7,
    raceAggressionPenalty: 0.3,
  },
  tempo: {
    willingnessToBlock: 0.5,
    chumpBlockThreshold: 0.3,
    tradeAcceptance: 0.4,
    multiBlockPreference: 0.2,
    valueProtectionWeight: 0.5,
    raceAggressionPenalty: 0.3,
  },
  combo: {
    willingnessToBlock: 0.4,
    chumpBlockThreshold: 0.5,
    tradeAcceptance: 0.3,
    multiBlockPreference: 0.4,
    valueProtectionWeight: 0.8,
    raceAggressionPenalty: 0.5,
  },
  unknown: {
    willingnessToBlock: 0.5,
    chumpBlockThreshold: 0.4,
    tradeAcceptance: 0.5,
    multiBlockPreference: 0.3,
    valueProtectionWeight: 0.6,
    raceAggressionPenalty: 0.3,
  },
};

function classifyCreatureRole(
  creature: Permanent,
): "threat" | "utility" | "token" {
  const mv = creature.manaValue || 0;
  const pow = creature.power || 0;
  const tou = creature.toughness || 0;

  if (mv >= 4 || pow >= 4) return "threat";
  if (mv <= 1 && pow <= 1 && tou <= 1) return "token";
  return "utility";
}

function computeBlockerScore(
  blocker: Permanent,
  attacker: Permanent,
  weights: ArchetypeBlockWeights,
  opponentLife: number,
  isLowLife: boolean,
): number {
  const blockerPower = blocker.power || 0;
  const blockerToughness = blocker.toughness || 0;
  const attackerPower = attacker.power || 0;
  const attackerToughness = attacker.toughness || 0;
  const blockerMv = blocker.manaValue || 0;
  const attackerMv = attacker.manaValue || 0;
  const blockerRole = classifyCreatureRole(blocker);

  const blockerHasDeathtouch =
    blocker.keywords?.includes("deathtouch") || false;
  const blockerIsIndestructible =
    blocker.keywords?.includes("indestructible") || false;
  const attackerHasDeathtouch =
    attacker.keywords?.includes("deathtouch") || false;
  const attackerIsIndestructible =
    attacker.keywords?.includes("indestructible") || false;

  const attackerDies =
    !attackerIsIndestructible &&
    (blockerHasDeathtouch
      ? blockerPower > 0
      : blockerPower >= attackerToughness);

  const blockerDies =
    !blockerIsIndestructible &&
    (attackerHasDeathtouch
      ? attackerPower > 0
      : attackerPower >= blockerToughness);

  let score = weights.willingnessToBlock;

  if (attackerDies && !blockerDies) {
    score += 0.4;
    score += weights.tradeAcceptance * 0.3;
  } else if (attackerDies && blockerDies) {
    const valueDiff = attackerMv - blockerMv;
    score += weights.tradeAcceptance * 0.3;
    if (valueDiff > 0) score += 0.2;
    else if (valueDiff < -1) score -= 0.25;
    if (blockerMv > attackerMv + 2) score -= 0.2;
  } else if (!attackerDies && blockerDies) {
    if (isLowLife && attackerPower >= 3) {
      score += weights.chumpBlockThreshold * 0.8;
    } else if (blockerRole === "token") {
      score += weights.chumpBlockThreshold * 0.5;
    } else {
      const chumpCost = blockerMv;
      const lifeSaved = attackerPower;
      if (lifeSaved > chumpCost && isLowLife) {
        score += weights.chumpBlockThreshold * 0.3;
      } else {
        score -= 0.35;
      }
    }
  } else if (!attackerDies && !blockerDies) {
    score += 0.1;
  }

  score -= weights.valueProtectionWeight * (blockerMv / 12);
  score += (blockerToughness / Math.max(1, attackerPower)) * 0.15;

  const attackerRole = classifyCreatureRole(attacker);
  if (attackerRole === "threat") {
    score += weights.valueProtectionWeight * 0.2;
  }

  if (attackerDies && blockerDies && blockerMv > attackerMv + 1) {
    score -= weights.valueProtectionWeight * 0.3;
  }

  const lifePressure = Math.max(0, 1 - opponentLife / 20);
  score -= lifePressure * weights.raceAggressionPenalty;

  return Math.max(0, Math.min(1, score));
}

function canBlockCheck(blocker: Permanent, attacker: Permanent): boolean {
  if (blocker.type !== "creature" || blocker.tapped) return false;
  if (blocker.summoningSickness) return false;

  const attackerKeywords = attacker.keywords || [];
  const blockerKeywords = blocker.keywords || [];

  if (
    attackerKeywords.includes("flying") &&
    !blockerKeywords.includes("flying") &&
    !blockerKeywords.includes("reach")
  ) {
    return false;
  }

  if (
    attackerKeywords.includes("intimidate") ||
    attackerKeywords.includes("fear")
  ) {
    return false;
  }

  if (attackerKeywords.includes("unblockable")) {
    return false;
  }

  if (
    attackerKeywords.includes("shadow") &&
    !blockerKeywords.includes("shadow")
  ) {
    return false;
  }

  return true;
}

export function predictOpponentBlocks(
  attackers: Permanent[],
  opponentCreatures: Permanent[],
  opponentLife: number,
  opponentArchetype: OpponentArchetype = "unknown",
): BlockPredictionResult {
  const weights = ARCHETYPE_WEIGHTS[opponentArchetype];
  const isLowLife = opponentLife <= 10;
  const eligibleBlockers = opponentCreatures.filter((c) =>
    canBlockCheck(c, attackers[0] ?? ({} as Permanent)),
  );

  const predictions: BlockPrediction[] = attackers.map((attacker) => {
    const validBlockers = eligibleBlockers.filter((b) =>
      canBlockCheck(b, attacker),
    );

    if (validBlockers.length === 0) {
      return {
        attackerId: attacker.id,
        predictedBlockerIds: [],
        blockProbability: 0,
        predictionConfidence: 0.9,
      };
    }

    const scoredBlockers = validBlockers.map((blocker) => ({
      blocker,
      score: computeBlockerScore(
        blocker,
        attacker,
        weights,
        opponentLife,
        isLowLife,
      ),
    }));

    scoredBlockers.sort((a, b) => b.score - a.score);

    const attackerHasMenace = attacker.keywords?.includes("menace") || false;
    const minBlockersNeeded = attackerHasMenace ? 2 : 1;

    const blockProbability = scoredBlockers[0].score;
    const threshold = 0.3;

    let predictedBlockers: typeof scoredBlockers;

    if (blockProbability < threshold) {
      predictedBlockers = [];
    } else {
      predictedBlockers = scoredBlockers.filter(
        (sb) => sb.score >= threshold * 0.6,
      );

      if (attackerHasMenace && predictedBlockers.length < minBlockersNeeded) {
        if (predictedBlockers.length === 0 && scoredBlockers.length >= 2) {
          predictedBlockers = scoredBlockers.slice(0, 2);
        } else if (predictedBlockers.length === 1) {
          const nextBest = scoredBlockers.find(
            (sb) => sb.blocker.id !== predictedBlockers[0].blocker.id,
          );
          if (nextBest) predictedBlockers.push(nextBest);
        }
      }
    }

    const predictionConfidence =
      predictedBlockers.length > 0
        ? 0.5 +
          blockProbability * 0.3 +
          (1 / Math.max(1, validBlockers.length)) * 0.2
        : 0.6 + (1 - blockProbability) * 0.3;

    return {
      attackerId: attacker.id,
      predictedBlockerIds: predictedBlockers.map((sb) => sb.blocker.id),
      blockProbability: Math.max(0, Math.min(1, blockProbability)),
      predictionConfidence: Math.max(0, Math.min(1, predictionConfidence)),
    };
  });

  return { predictions, archetypeWeights: weights };
}

export function integrateBlockPredictionIntoEV(
  baseExpectedValue: number,
  prediction: BlockPrediction,
  attacker: Permanent,
  allBlockers: Permanent[],
  opponentLife: number,
): number {
  if (prediction.predictedBlockerIds.length === 0) {
    const bonus = ((attacker.power || 0) / 20) * (1 - opponentLife / 20);
    return Math.min(1, baseExpectedValue + bonus);
  }

  const predictedBlockers = allBlockers.filter((b) =>
    prediction.predictedBlockerIds.includes(b.id),
  );

  let adjustedEV = baseExpectedValue;

  for (const blocker of predictedBlockers) {
    const blockerPower = blocker.power || 0;
    const blockerToughness = blocker.toughness || 0;
    const attackerPower = attacker.power || 0;
    const attackerToughness = attacker.toughness || 0;
    const blockerMv = blocker.manaValue || 0;
    const attackerMv = attacker.manaValue || 0;

    const blockerHasDeathtouch =
      blocker.keywords?.includes("deathtouch") || false;
    const attackerHasDeathtouch =
      attacker.keywords?.includes("deathtouch") || false;
    const attackerIsIndestructible =
      attacker.keywords?.includes("indestructible") || false;
    const blockerIsIndestructible =
      blocker.keywords?.includes("indestructible") || false;

    const attackerDies =
      !attackerIsIndestructible &&
      (blockerHasDeathtouch
        ? blockerPower > 0
        : blockerPower >= attackerToughness);
    const blockerDies =
      !blockerIsIndestructible &&
      (attackerHasDeathtouch
        ? attackerPower > 0
        : attackerPower >= blockerToughness);

    const hasTrample = attacker.keywords?.includes("trample") || false;

    if (attackerDies && !blockerDies) {
      adjustedEV -= 0.4 * prediction.blockProbability;
      adjustedEV -= (attackerMv / 20) * prediction.blockProbability * 0.5;
    } else if (attackerDies && blockerDies) {
      const valueDiff = blockerMv - attackerMv;
      adjustedEV += (valueDiff / 20) * prediction.blockProbability * 0.5;
      adjustedEV -= 0.1 * prediction.blockProbability;
    } else if (!attackerDies && blockerDies) {
      adjustedEV += 0.25 * prediction.blockProbability;
      adjustedEV += (blockerMv / 20) * prediction.blockProbability * 0.3;

      if (hasTrample) {
        const excess = attackerPower - blockerToughness;
        adjustedEV += (excess / 20) * prediction.blockProbability * 0.5;
      }
    } else {
      if (hasTrample) {
        adjustedEV -= 0.1 * prediction.blockProbability;
      }
    }
  }

  const confidenceFactor = 0.7 + prediction.predictionConfidence * 0.3;
  const blendedEV =
    baseExpectedValue * (1 - confidenceFactor) + adjustedEV * confidenceFactor;

  return Math.max(0, Math.min(1, blendedEV));
}

export function getArchetypeWeights(
  archetype: OpponentArchetype,
): ArchetypeBlockWeights {
  return { ...ARCHETYPE_WEIGHTS[archetype] };
}
