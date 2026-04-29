import type { OpponentArchetype } from "./block-prediction";

export interface OpponentManaState {
  white: number;
  blue: number;
  black: number;
  red: number;
  green: number;
  colorless: number;
}

export interface CombatTrickEstimate {
  probability: number;
  estimatedTypes: CombatTrickType[];
  confidence: number;
  reasoning: string;
}

export type CombatTrickType =
  | "pump"
  | "removal"
  | "toughness_boost"
  | "damage_prevention"
  | "deathtouch_grant"
  | "indestructible"
  | "lifelink";

const ARCHETYPE_TRICK_WEIGHTS: Record<
  OpponentArchetype,
  {
    trickFrequency: number;
    pumpWeight: number;
    removalWeight: number;
    bluffWeight: number;
  }
> = {
  aggro: { trickFrequency: 0.6, pumpWeight: 0.8, removalWeight: 0.3, bluffWeight: 0.2 },
  control: {
    trickFrequency: 0.7,
    pumpWeight: 0.2,
    removalWeight: 0.9,
    bluffWeight: 0.6,
  },
  midrange: {
    trickFrequency: 0.5,
    pumpWeight: 0.5,
    removalWeight: 0.5,
    bluffWeight: 0.4,
  },
  tempo: {
    trickFrequency: 0.7,
    pumpWeight: 0.6,
    removalWeight: 0.7,
    bluffWeight: 0.5,
  },
  combo: {
    trickFrequency: 0.3,
    pumpWeight: 0.2,
    removalWeight: 0.4,
    bluffWeight: 0.1,
  },
  unknown: {
    trickFrequency: 0.5,
    pumpWeight: 0.5,
    removalWeight: 0.5,
    bluffWeight: 0.3,
  },
};

const COMMON_TRICK_CMC: Record<CombatTrickType, number> = {
  pump: 1,
  removal: 2,
  toughness_boost: 1,
  damage_prevention: 2,
  deathtouch_grant: 2,
  indestructible: 3,
  lifelink: 1,
};

function totalMana(mana: OpponentManaState): number {
  return (
    mana.white +
    mana.blue +
    mana.black +
    mana.red +
    mana.green +
    mana.colorless
  );
}

function hasColors(
  mana: OpponentManaState,
  colors: string[],
): boolean {
  for (const color of colors) {
    if (color === "white" && mana.white < 1) return false;
    if (color === "blue" && mana.blue < 1) return false;
    if (color === "black" && mana.black < 1) return false;
    if (color === "red" && mana.red < 1) return false;
    if (color === "green" && mana.green < 1) return false;
  }
  return true;
}

export function estimateCombatTrickProbability(
  opponentMana: OpponentManaState,
  opponentArchetype: OpponentArchetype,
  cardsInHand?: number,
  turnNumber?: number,
): CombatTrickEstimate {
  const total = totalMana(opponentMana);

  if (total === 0) {
    return {
      probability: 0,
      estimatedTypes: [],
      confidence: 0.9,
      reasoning: "No open mana — opponent cannot cast instants",
    };
  }

  const weights = ARCHETYPE_TRICK_WEIGHTS[opponentArchetype];

  const manaFactor = Math.min(1, total / 3);
  const archetypeFactor = weights.trickFrequency;

  let handFactor = 0.5;
  if (cardsInHand !== undefined) {
    handFactor = Math.min(1, cardsInHand / 5);
  }

  let turnFactor = 0.5;
  if (turnNumber !== undefined) {
    turnFactor = Math.min(1, turnNumber / 6);
  }

  const baseProbability =
    manaFactor * archetypeFactor * handFactor * turnFactor;

  const estimatedTypes: CombatTrickType[] = [];

  if (total >= COMMON_TRICK_CMC.pump) {
    if (weights.pumpWeight > 0.4) estimatedTypes.push("pump");
  }
  if (total >= COMMON_TRICK_CMC.removal) {
    if (weights.removalWeight > 0.4) estimatedTypes.push("removal");
  }
  if (total >= COMMON_TRICK_CMC.toughness_boost) {
    if (weights.pumpWeight > 0.3) estimatedTypes.push("toughness_boost");
  }
  if (total >= COMMON_TRICK_CMC.indestructible) {
    if (opponentArchetype === "control" || opponentArchetype === "midrange") {
      estimatedTypes.push("indestructible");
    }
  }

  const bluffBonus = weights.bluffWeight * (total >= 2 ? 0.1 : 0);
  const probability = Math.min(0.95, baseProbability + bluffBonus);

  const hasRedRemoval = hasColors(opponentMana, ["red"]) && total >= 2;
  if (hasRedRemoval && !estimatedTypes.includes("removal")) {
    estimatedTypes.push("removal");
  }

  const hasWhitePump = hasColors(opponentMana, ["white"]) && total >= 1;
  if (hasWhitePump && !estimatedTypes.includes("pump")) {
    estimatedTypes.push("pump");
  }

  const confidence =
    cardsInHand !== undefined
      ? 0.7 + handFactor * 0.2
      : 0.4 + turnFactor * 0.2;

  const colorReasons: string[] = [];
  if (hasRedRemoval) colorReasons.push("red mana suggests burn/removal");
  if (hasWhitePump) colorReasons.push("white mana suggests pump/protection");

  const reasoning = [
    `${total} open mana, archetype=${opponentArchetype}`,
    `base prob=${baseProbability.toFixed(3)}`,
    `expected tricks: [${estimatedTypes.join(", ") || "none"}]`,
    ...colorReasons,
  ].join("; ");

  return {
    probability,
    estimatedTypes,
    confidence: Math.min(0.95, confidence),
    reasoning,
  };
}

export function calculateCombatTrickDiscount(
  trickEstimate: CombatTrickEstimate,
  currentEV: number,
  creatureToughness?: number,
): { discountedEV: number; riskAdjustment: number } {
  if (trickEstimate.probability <= 0) {
    return { discountedEV: currentEV, riskAdjustment: 0 };
  }

  const prob = trickEstimate.probability;
  const conf = trickEstimate.confidence;

  const effectiveProb = prob * conf;

  const hasPump = trickEstimate.estimatedTypes.includes("pump");
  const hasRemoval = trickEstimate.estimatedTypes.includes("removal");

  let riskAdjustment = 0;

  if (hasRemoval) {
    riskAdjustment -= effectiveProb * 0.3;
  }

  if (hasPump && creatureToughness !== undefined) {
    const typicalPumpBoost = 2;
    if (creatureToughness <= typicalPumpBoost + 1) {
      riskAdjustment -= effectiveProb * 0.15;
    }
  }

  if (trickEstimate.estimatedTypes.includes("indestructible")) {
    riskAdjustment -= effectiveProb * 0.2;
  }

  const discountedEV = Math.max(-0.5, currentEV + riskAdjustment);

  return { discountedEV, riskAdjustment };
}
