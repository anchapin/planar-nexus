/**
 * @fileoverview Cascade / Trigger-Chain Evaluation
 *
 * Evaluates secondary effects triggered by initial stack responses.
 * When a spell or ability resolves, it may trigger additional abilities
 * (ETB effects, "whenever you cast" triggers, Cascade keyword, etc.).
 * This module enumerates expected trigger chains so the AI can account
 * for the full downstream impact of each decision.
 *
 * Key components:
 * - TriggeredAbility: describes a triggered ability on a permanent
 * - TriggerChainStep: one hop in a cascade chain
 * - TriggerChain: ordered list of steps from resolution to terminal effect
 * - TriggerKnowledgeGraph: registry of known trigger patterns
 * - evaluateTriggerChain(): main entry point
 */

export type TriggerType =
  | "etb"
  | "cast_trigger"
  | "cascade"
  | "death_trigger"
  | "attack_trigger"
  | "life_change"
  | "draw_trigger"
  | "tap_trigger"
  | "enter_graveyard"
  | "generic";

export interface TriggeredAbility {
  readonly id: string;
  readonly sourceCardId: string;
  readonly sourceName: string;
  readonly controller: string;
  readonly triggerType: TriggerType;
  readonly triggerText: string;
  readonly effectType:
    | "draw"
    | "damage"
    | "token"
    | "buff"
    | "debuff"
    | "counter"
    | "search"
    | "life_gain"
    | "life_loss"
    | "exile"
    | "destroy"
    | "copy"
    | "ramp"
    | "other";
  readonly effectValue: number;
  readonly manaCostToActivate?: number;
  readonly isOptional: boolean;
  readonly targetRestriction?: "opponent" | "self" | "any" | "nonland";
  readonly copiesWithPanharmonicon?: boolean;
}

export interface TriggerChainStep {
  readonly ability: TriggeredAbility;
  readonly condition: string;
  readonly depth: number;
  readonly isOptional: boolean;
}

export interface TriggerChain {
  readonly originStackItem: string;
  readonly steps: TriggerChainStep[];
  readonly totalValue: number;
  readonly totalManaCost: number;
  readonly hasOptionalSteps: boolean;
  readonly controller: string;
  readonly description: string;
}

export interface BoardPermanent {
  readonly id: string;
  readonly cardId: string;
  readonly name: string;
  readonly controller: string;
  readonly type:
    | "creature"
    | "enchantment"
    | "artifact"
    | "planeswalker"
    | "land";
  readonly keywords?: string[];
  readonly manaValue?: number;
  readonly power?: number;
  readonly toughness?: number;
  readonly oracleText?: string;
}

export interface CascadeContext {
  readonly stackItem: {
    id: string;
    cardId: string;
    name: string;
    controller: string;
    type: "spell" | "ability";
    manaValue: number;
    colors?: string[];
    targets?: {
      playerId?: string;
      permanentId?: string;
      cardId?: string;
    }[];
  };
  readonly battlefield: BoardPermanent[];
  readonly graveyard?: { controller: string; cards: string[] }[];
  readonly opponentLife?: number;
  readonly ownLife?: number;
}

interface TriggerPattern {
  readonly namePatterns: RegExp[];
  readonly textPatterns: RegExp[];
  readonly triggerType: TriggerType;
  readonly effectType: TriggeredAbility["effectType"];
  readonly baseValue: number;
}

const TRIGGER_PATTERNS: TriggerPattern[] = [
  {
    namePatterns: [
      /\b(?:panharmonicon|strionic resonator|mirrorworks| Flameshadow Conjuring)\b/i,
    ],
    textPatterns: [/whenever.*enters.*under your control.*instead/i],
    triggerType: "etb",
    effectType: "copy",
    baseValue: 3,
  },
  {
    namePatterns: [/\b(?: solemn simulacrum| ministry of inquisition )\b/i],
    textPatterns: [/when.*enters.*(?:search your library)/i],
    triggerType: "etb",
    effectType: "search",
    baseValue: 4,
  },
  {
    namePatterns: [/\b(?:cloudblazer|solemn simulacrum| sylvan )\b/i],
    textPatterns: [/when.*enters.*(?:draw a card)/i],
    triggerType: "etb",
    effectType: "draw",
    baseValue: 3,
  },
  {
    namePatterns: [
      /\b(?:ravager of the fells| blood artist| zulaport cutthroat| forgemaster mephit| pawn of ulamog| solemn simulacrum )\b/i,
    ],
    textPatterns: [/when.*(?:another|a).*(?:dies|put into a graveyard)/i],
    triggerType: "death_trigger",
    effectType: "life_loss",
    baseValue: 2,
  },
  {
    namePatterns: [
      /\b(?:blood artist| zulaport cutthroat| butcher ghoul| piper of the swarm )\b/i,
    ],
    textPatterns: [/whenever.*(?:another|a).*(?:dies|put into.*graveyard)/i],
    triggerType: "death_trigger",
    effectType: "life_gain",
    baseValue: 2,
  },
  {
    namePatterns: [
      /\b(?:land tax| knight of the white orchid| dowsing device )\b/i,
    ],
    textPatterns: [/at the beginning of.*upkeep.*search/i],
    triggerType: "generic",
    effectType: "search",
    baseValue: 3,
  },
  {
    namePatterns: [
      /\b(?:soul warden| soul's attendant| suture priest| anointed procession| verdant calamity )\b/i,
    ],
    textPatterns: [/whenever.*(?:enters|a creature enters)/i],
    triggerType: "etb",
    effectType: "life_gain",
    baseValue: 1,
  },
  {
    namePatterns: [
      /\b(?:grim haruspex| bone miser| wall of omens| tracker| oracle of mul daya )\b/i,
    ],
    textPatterns: [/whenever.*(?:enters|a creature enters)/i],
    triggerType: "etb",
    effectType: "draw",
    baseValue: 2,
  },
  {
    namePatterns: [/\b(?: thuja commander| hydra broodmaster )\b/i],
    textPatterns: [/whenever.*enters.*create.*token/i],
    triggerType: "etb",
    effectType: "token",
    baseValue: 2,
  },
  {
    namePatterns: [
      /\b(?:torrential gearhulk| grove of the guardian| ambush commander )\b/i,
    ],
    textPatterns: [/when.*enters.*create.*token/i],
    triggerType: "etb",
    effectType: "token",
    baseValue: 3,
  },
  {
    namePatterns: [/\b(?:impact tremors| warstorm surge| pandemonium )\b/i],
    textPatterns: [/whenever.*(?:enters|a creature enters)/i],
    triggerType: "etb",
    effectType: "damage",
    baseValue: 2,
  },
  {
    namePatterns: [/\b(?:urza's factory )\b/i],
    textPatterns: [/whenever.*(?:cast|a spell)/i],
    triggerType: "cast_trigger",
    effectType: "token",
    baseValue: 1,
  },
  {
    namePatterns: [
      /\b(?:country|down|mountain|island|swamp|forest|plains)rush\b/i,
    ],
    textPatterns: [/whenever.*(?:cast|you cast).*(?:search)/i],
    triggerType: "cast_trigger",
    effectType: "search",
    baseValue: 3,
  },
  {
    namePatterns: [
      /\b(?:electrostatic field| purphoros| impact tremors| warstorm surge )\b/i,
    ],
    textPatterns: [/whenever.*(?:you cast|a player casts).*creature spell/i],
    triggerType: "cast_trigger",
    effectType: "damage",
    baseValue: 2,
  },
  {
    namePatterns: [/\b(?:cascade\b)/i],
    textPatterns: [/cascade\b/i],
    triggerType: "cascade",
    effectType: "search",
    baseValue: 4,
  },
  {
    namePatterns: [
      /\b(?:knight of the white orchid| dredge| sunscorch regent )\b/i,
    ],
    textPatterns: [/at the beginning of.*combat.*(?:trigger|ability)/i],
    triggerType: "attack_trigger",
    effectType: "buff",
    baseValue: 1,
  },
  {
    namePatterns: [/\b(?:dark confidant| bob| adjective nerd )\b/i],
    textPatterns: [/at the beginning of.*upkeep.*reveal/i],
    triggerType: "generic",
    effectType: "life_loss",
    baseValue: 2,
  },
  {
    namePatterns: [/\b(?:sylvan library| sensei's divining top )\b/i],
    textPatterns: [/at the beginning of.*draw.*(?:look|reveal|put)/i],
    triggerType: "draw_trigger",
    effectType: "search",
    baseValue: 2,
  },
];

const COPY_DOUBLERS = [
  /panharmonicon/i,
  /strionic resonator/i,
  /mirrorworks/i,
  / Flameshadow Conjuring/i,
  /kiki-jiki/i,
  /stromkirk occultist/i,
];

function matchesTriggerPattern(
  permanent: BoardPermanent,
  pattern: TriggerPattern,
): boolean {
  for (const re of pattern.namePatterns) {
    if (re.test(permanent.name)) return true;
  }
  if (permanent.oracleText) {
    for (const re of pattern.textPatterns) {
      if (re.test(permanent.oracleText)) return true;
    }
  }
  return false;
}

function classifyTrigger(permanent: BoardPermanent): TriggerPattern | null {
  for (const pattern of TRIGGER_PATTERNS) {
    if (matchesTriggerPattern(permanent, pattern)) {
      return pattern;
    }
  }
  return null;
}

function isCopyDoubler(permanent: BoardPermanent): boolean {
  return COPY_DOUBLERS.some((re) => re.test(permanent.name));
}

function detectCascadeKeyword(stackItem: CascadeContext["stackItem"]): boolean {
  const name = stackItem.name.toLowerCase();
  if (name.includes("cascade")) return true;
  return false;
}

function detectETBFromText(oracleText: string): {
  triggerType: TriggerType;
  effectType: TriggeredAbility["effectType"];
  baseValue: number;
} | null {
  const lower = oracleText.toLowerCase();
  if (lower.includes("when") && lower.includes("enters the battlefield")) {
    if (lower.includes("draw"))
      return { triggerType: "etb", effectType: "draw", baseValue: 3 };
    if (lower.includes("damage"))
      return { triggerType: "etb", effectType: "damage", baseValue: 3 };
    if (lower.includes("token"))
      return { triggerType: "etb", effectType: "token", baseValue: 2 };
    if (lower.includes("exile"))
      return { triggerType: "etb", effectType: "exile", baseValue: 4 };
    if (lower.includes("destroy"))
      return { triggerType: "etb", effectType: "destroy", baseValue: 4 };
    if (lower.includes("gain") && lower.includes("life"))
      return { triggerType: "etb", effectType: "life_gain", baseValue: 1 };
    if (lower.includes("search"))
      return { triggerType: "etb", effectType: "search", baseValue: 4 };
    if (lower.includes("counter"))
      return { triggerType: "etb", effectType: "counter", baseValue: 5 };
    if (lower.includes("copy") || lower.includes("create a copy"))
      return { triggerType: "etb", effectType: "copy", baseValue: 3 };
    if (lower.includes("scry"))
      return { triggerType: "etb", effectType: "search", baseValue: 2 };
    if (
      lower.includes("ramp") ||
      lower.includes("tap") ||
      lower.includes("untap")
    )
      return { triggerType: "etb", effectType: "ramp", baseValue: 2 };
    return { triggerType: "etb", effectType: "other", baseValue: 2 };
  }
  if (lower.includes("whenever") && lower.includes("enters")) {
    if (lower.includes("draw"))
      return { triggerType: "etb", effectType: "draw", baseValue: 3 };
    if (lower.includes("damage"))
      return { triggerType: "etb", effectType: "damage", baseValue: 2 };
    if (lower.includes("gain") && lower.includes("life"))
      return { triggerType: "etb", effectType: "life_gain", baseValue: 1 };
    return { triggerType: "etb", effectType: "other", baseValue: 1 };
  }
  if (lower.includes("whenever") && lower.includes("cast")) {
    if (lower.includes("damage"))
      return {
        triggerType: "cast_trigger",
        effectType: "damage",
        baseValue: 2,
      };
    if (lower.includes("draw"))
      return { triggerType: "cast_trigger", effectType: "draw", baseValue: 2 };
    if (lower.includes("token"))
      return { triggerType: "cast_trigger", effectType: "token", baseValue: 2 };
    if (lower.includes("life"))
      return {
        triggerType: "cast_trigger",
        effectType: "life_gain",
        baseValue: 1,
      };
    return { triggerType: "cast_trigger", effectType: "other", baseValue: 1 };
  }
  if (lower.includes("when") && lower.includes("dies")) {
    if (lower.includes("draw"))
      return { triggerType: "death_trigger", effectType: "draw", baseValue: 2 };
    if (lower.includes("damage"))
      return {
        triggerType: "death_trigger",
        effectType: "damage",
        baseValue: 2,
      };
    if (lower.includes("sacrifice") || lower.includes("exile"))
      return {
        triggerType: "death_trigger",
        effectType: "exile",
        baseValue: 3,
      };
    return { triggerType: "death_trigger", effectType: "other", baseValue: 1 };
  }
  return null;
}

function buildTriggeredAbility(
  permanent: BoardPermanent,
  pattern: TriggerPattern | null,
  oracleAnalysis: ReturnType<typeof detectETBFromText> | null,
): TriggeredAbility | null {
  const triggerType = pattern?.triggerType ?? oracleAnalysis?.triggerType;
  const effectType = pattern?.effectType ?? oracleAnalysis?.effectType;
  const effectValue = pattern?.baseValue ?? oracleAnalysis?.baseValue ?? 1;

  if (!triggerType || !effectType) return null;

  return {
    id: `trigger_${permanent.id}_${triggerType}`,
    sourceCardId: permanent.cardId,
    sourceName: permanent.name,
    controller: permanent.controller,
    triggerType,
    triggerText:
      pattern?.textPatterns[0]?.source ??
      (oracleAnalysis ? "detected from oracle text" : "detected from pattern"),
    effectType,
    effectValue,
    isOptional: true,
    copiesWithPanharmonicon:
      permanent.type === "creature" || permanent.type === "artifact",
  };
}

function countCopyDoublers(
  battlefield: BoardPermanent[],
  controller: string,
): number {
  return battlefield.filter(
    (p) => p.controller === controller && isCopyDoubler(p),
  ).length;
}

function collectETBTriggers(
  battlefield: BoardPermanent[],
  stackItem: CascadeContext["stackItem"],
): TriggeredAbility[] {
  const isCreature =
    stackItem.type === "spell" &&
    (stackItem.colors === undefined || stackItem.colors.length > 0);
  const triggers: TriggeredAbility[] = [];

  for (const permanent of battlefield) {
    const pattern = classifyTrigger(permanent);
    const oracleAnalysis = permanent.oracleText
      ? detectETBFromText(permanent.oracleText)
      : null;

    if (!pattern && !oracleAnalysis) continue;

    const triggerType = pattern?.triggerType ?? oracleAnalysis?.triggerType;

    if (triggerType === "etb" && isCreature) {
      const ability = buildTriggeredAbility(permanent, pattern, oracleAnalysis);
      if (ability) triggers.push(ability);
    }

    if (triggerType === "cast_trigger") {
      const isOpponentSpell = permanent.controller !== stackItem.controller;
      const matchesController =
        !isOpponentSpell ||
        stackItem.targets?.some((t) => t.playerId === permanent.controller);
      if (matchesController) {
        const ability = buildTriggeredAbility(
          permanent,
          pattern,
          oracleAnalysis,
        );
        if (ability) triggers.push(ability);
      }
    }

    if (triggerType === "draw_trigger" || triggerType === "generic") {
      if (pattern && permanent.controller === stackItem.controller) {
        const ability = buildTriggeredAbility(
          permanent,
          pattern,
          oracleAnalysis,
        );
        if (ability) triggers.push(ability);
      }
    }
  }

  return triggers;
}

function buildChainFromTrigger(
  trigger: TriggeredAbility,
  originStackItemId: string,
  depth: number,
  doublerCount: number,
): TriggerChainStep {
  const multiplier = trigger.copiesWithPanharmonicon
    ? Math.max(1, doublerCount)
    : 1;
  const effectiveValue = trigger.effectValue * multiplier;

  const multiAbility: TriggeredAbility = {
    ...trigger,
    effectValue: effectiveValue,
  };

  return {
    ability: multiAbility,
    condition: `After ${originStackItemId} resolves`,
    depth,
    isOptional: trigger.isOptional,
  };
}

function expandChainWithSecondaryTriggers(
  step: TriggerChainStep,
  battlefield: BoardPermanent[],
  visitedIds: Set<string>,
  maxDepth: number,
): TriggerChainStep[] {
  if (step.depth >= maxDepth) return [];
  if (
    step.ability.effectType !== "token" &&
    step.ability.effectType !== "draw" &&
    step.ability.effectType !== "search"
  ) {
    return [];
  }

  const secondarySteps: TriggerChainStep[] = [];

  for (const permanent of battlefield) {
    if (visitedIds.has(permanent.id)) continue;

    const pattern = classifyTrigger(permanent);
    const oracleAnalysis = permanent.oracleText
      ? detectETBFromText(permanent.oracleText)
      : null;

    if (!pattern && !oracleAnalysis) continue;

    const triggerType = pattern?.triggerType ?? oracleAnalysis?.triggerType;

    if (triggerType === "etb") {
      const ability = buildTriggeredAbility(permanent, pattern, oracleAnalysis);
      if (ability) {
        visitedIds.add(permanent.id);
        secondarySteps.push({
          ability,
          condition: `After ${step.ability.sourceName} creates token/draw`,
          depth: step.depth + 1,
          isOptional: true,
        });
      }
    } else if (
      triggerType === "death_trigger" &&
      (step.ability.effectType as string) === "destroy"
    ) {
      const ability = buildTriggeredAbility(permanent, pattern, oracleAnalysis);
      if (ability) {
        visitedIds.add(permanent.id);
        secondarySteps.push({
          ability,
          condition: `After ${step.ability.sourceName} destroys permanent`,
          depth: step.depth + 1,
          isOptional: true,
        });
      }
    }
  }

  return secondarySteps;
}

function generateCascadeChain(
  stackItem: CascadeContext["stackItem"],
  battlefield: BoardPermanent[],
): TriggerChain | null {
  const ownBattlefield = battlefield.filter(
    (p) => p.controller === stackItem.controller,
  );
  const cascadeMV = stackItem.manaValue - 1;

  let cascadeValue = 3;
  if (cascadeMV >= 5) cascadeValue = 5;
  else if (cascadeMV >= 3) cascadeValue = 4;

  const cascadeTrigger: TriggeredAbility = {
    id: `cascade_${stackItem.id}`,
    sourceCardId: stackItem.cardId,
    sourceName: stackItem.name,
    controller: stackItem.controller,
    triggerType: "cascade",
    triggerText: `Cascade for CMC < ${stackItem.manaValue}`,
    effectType: "search",
    effectValue: cascadeValue,
    isOptional: false,
    copiesWithPanharmonicon: false,
  };

  const step: TriggerChainStep = {
    ability: cascadeTrigger,
    condition: `When ${stackItem.name} resolves`,
    depth: 0,
    isOptional: false,
  };

  const cascadedPermanent: BoardPermanent = {
    id: `cascaded_${stackItem.id}`,
    cardId: `cascaded_${stackItem.cardId}`,
    name: "Cascaded Spell (unknown)",
    controller: stackItem.controller,
    type: "creature",
    manaValue: cascadeMV,
    oracleText: "",
  };

  const visitedIds = new Set<string>([stackItem.id, cascadedPermanent.id]);
  const secondarySteps = expandChainWithSecondaryTriggers(
    step,
    [...battlefield, cascadedPermanent],
    visitedIds,
    2,
  );

  const allSteps = [step, ...secondarySteps];
  const totalValue = allSteps.reduce(
    (sum, s) => sum + s.ability.effectValue,
    0,
  );

  return {
    originStackItem: stackItem.id,
    steps: allSteps,
    totalValue,
    totalManaCost: 0,
    hasOptionalSteps: allSteps.some((s) => s.isOptional),
    controller: stackItem.controller,
    description: `Cascade from ${stackItem.name}: search for CMC < ${stackItem.manaValue}`,
  };
}

export function evaluateTriggerChain(
  stackItem: CascadeContext["stackItem"],
  boardState: CascadeContext["battlefield"],
  maxDepth: number = 3,
): TriggerChain[] {
  const chains: TriggerChain[] = [];

  const isCascade = detectCascadeKeyword(stackItem);
  if (isCascade) {
    const cascadeChain = generateCascadeChain(stackItem, boardState);
    if (cascadeChain) chains.push(cascadeChain);
  }

  const etbTriggers = collectETBTriggers(boardState, stackItem);
  const controller = stackItem.controller;
  const doublerCount = countCopyDoublers(boardState, controller);
  const visitedIds = new Set<string>();

  for (const trigger of etbTriggers) {
    if (visitedIds.has(trigger.sourceCardId)) continue;
    visitedIds.add(trigger.sourceCardId);

    const step = buildChainFromTrigger(trigger, stackItem.id, 0, doublerCount);

    const secondarySteps = expandChainWithSecondaryTriggers(
      step,
      boardState,
      new Set([stackItem.id, trigger.sourceCardId]),
      maxDepth,
    );

    const allSteps = [step, ...secondarySteps];
    const totalValue = allSteps.reduce(
      (sum, s) => sum + s.ability.effectValue,
      0,
    );
    const totalManaCost = allSteps.reduce(
      (sum, s) => sum + (s.ability.manaCostToActivate ?? 0),
      0,
    );

    const effectDescriptions = allSteps
      .map(
        (s) =>
          `${s.ability.sourceName}: ${s.ability.effectType} (${s.ability.effectValue})`,
      )
      .join(" -> ");

    chains.push({
      originStackItem: stackItem.id,
      steps: allSteps,
      totalValue,
      totalManaCost,
      hasOptionalSteps: allSteps.some((s) => s.isOptional),
      controller: trigger.controller,
      description: effectDescriptions || `No triggers for ${stackItem.name}`,
    });
  }

  chains.sort((a, b) => b.totalValue - a.totalValue);
  return chains;
}

export function getTriggerChainSummary(chains: TriggerChain[]): string {
  if (chains.length === 0) return "No trigger chains detected";

  const parts: string[] = [];
  parts.push(`${chains.length} trigger chain(s) detected`);

  const totalValue = chains.reduce((sum, c) => sum + c.totalValue, 0);
  parts.push(`total cascade value: ${totalValue.toFixed(1)}`);

  const hasOptional = chains.some((c) => c.hasOptionalSteps);
  if (hasOptional) parts.push("some steps are optional");

  const hasCascade = chains.some((c) =>
    c.steps.some((s) => s.ability.triggerType === "cascade"),
  );
  if (hasCascade) parts.push("includes Cascade keyword");

  return parts.join("; ");
}

export function shouldCounterToPreventTriggers(
  chains: TriggerChain[],
  threshold: number = 4.0,
): boolean {
  const totalValue = chains.reduce((sum, c) => sum + c.totalValue, 0);
  return totalValue >= threshold;
}

export function getHighestValueChain(
  chains: TriggerChain[],
): TriggerChain | null {
  if (chains.length === 0) return null;
  return chains.reduce((best, current) =>
    current.totalValue > best.totalValue ? current : best,
  );
}
