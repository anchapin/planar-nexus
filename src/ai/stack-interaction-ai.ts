/**
 * @fileoverview Stack Interaction AI for Magic: The Gathering
 *
 * This module provides AI decision-making for responding to spells and abilities
 * on the stack. It handles counterspell decisions, response timing, resource management,
 * and complex stack interaction scenarios.
 *
 * Key components:
 * - StackAction interface: Represents actions on the stack
 * - ResponseDecision interface: AI response decisions
 * - ResponseEvaluator: Evaluates whether to respond to stack actions
 * - CounterspellDecider: Determines when to use counterspells
 * - StackOrderOptimizer: Optimizes multiple response ordering
 * - ResourceManager: Manages holding vs. using mana
 *
 * This module now uses the unified AIGameState format from the engine.
 */

// Import unified types from engine
import type {
  AIGameState as GameState,
  AIStackObject,
} from "@/lib/game-state/types";
import {
  evaluateGameState,
  ThreatAssessment,
  DetailedEvaluation,
} from "./game-state-evaluator";
import {
  evaluateTriggerChain,
  shouldCounterToPreventTriggers,
  getHighestValueChain,
} from "./trigger-chain-evaluator";
import type { TriggerChain, BoardPermanent, CascadeContext } from "./trigger-chain-evaluator";
import { callAIProxy } from "@/lib/ai-proxy-client";
import { AIProvider } from "./providers/types";

// Re-export GameState for backward compatibility
export type { GameState };

/**
 * Represents a spell or ability on the stack
 */
export interface StackAction {
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
  isInstantSpeed: boolean;
  timestamp: number;
  // Multi-target support
  targetCount?: number;
  isMultiTarget?: boolean;
  // Variable cost support
  hasXCost?: boolean;
  kickerCost?: number;
  // Modal spell support
  modalChoices?: string[];
}

/**
 * Represents a response available to the AI
 */
export interface AvailableResponse {
  cardId: string;
  name: string;
  type: "instant" | "flash" | "ability";
  manaValue: number;
  manaCost: { [color: string]: number };
  canCounter: boolean;
  canTarget: string[];
  effect: ResponseEffect;
  // Multi-target support
  targetCount?: number;
  canTargetMultiple?: boolean;
  // Variable cost support
  variableCost?: boolean;
  hasXCost?: boolean;
  hasKicker?: boolean;
  // Modal spell support
  modalOptions?: string[];
}

/**
 * Represents the effect of a response
 */
export interface ResponseEffect {
  type:
    | "counter"
    | "destroy"
    | "bounce"
    | "exile"
    | "damage"
    | "draw"
    | "other";
  value: number; // Magnitude of effect (1-10)
  targets: string[];
}

/**
 * AI decision for stack interaction
 */
export interface ResponseDecision {
  shouldRespond: boolean;
  action: "pass" | "respond" | "hold_priority";
  responseCardId?: string;
  targetActionId?: string;
  reasoning: string;
  confidence: number; // 0-1
  expectedValue: number; // Expected game state improvement
  holdMana?: boolean;
  waitForBetterResponse?: boolean;
}

/**
 * Priority pass decision
 */
export interface PriorityPassDecision {
  shouldPass: boolean;
  reason: string;
  riskLevel: "low" | "medium" | "high";
}

/**
 * Stack ordering decision for multiple responses
 */
export interface StackOrderDecision {
  orderedActions: string[]; // Card IDs in order to cast
  reasoning: string;
  expectedValue: number;
}

/**
 * Resource management decision
 */
export interface ResourceDecision {
  useNow: boolean;
  holdFor: "end_step" | "opponent_turn" | "better_threat" | "bluff" | "nothing";
  manaToReserve: { [color: string]: number };
  reasoning: string;
}

/**
 * Deck archetype classification for bluffing decisions
 */
export type DeckArchetype =
  | "control"
  | "tempo"
  | "aggro"
  | "midrange"
  | "combo"
  | "unknown";

/**
 * Opponent behavioral history for bluffing decisions
 */
export interface OpponentHistory {
  /** Number of times opponent hesitated after AI held mana open */
  hesitationCount: number;
  /** Whether opponent has been previously baited into passing */
  wasBaited: boolean;
  /** Opponent's average plays per turn (lower = more cautious) */
  avgPlaysPerTurn: number;
  /** Whether opponent is known to play around open mana */
  playsAroundOpenMana: boolean;
}

/**
 * Bluff hold decision result
 */
export interface BluffHoldDecision {
  shouldBluff: boolean;
  reasoning: string;
  bluffStrength: number;
  isGenuineHold: boolean;
}

/**
 * Stack interaction context
 */
export interface StackContext {
  currentAction: StackAction;
  stackSize: number;
  actionsAbove: StackAction[]; // Actions above current that will resolve first
  availableMana: { [color: string]: number };
  availableResponses: AvailableResponse[];
  opponentsRemaining: string[]; // Opponents who haven't passed priority
  isMyTurn: boolean;
  phase: string;
  step: string;
  respondingToOpponent: boolean;
}

/**
 * Counterspell decision factors
 */
export interface CounterspellFactors {
  threatLevel: number;
  cardAdvantageImpact: number;
  tempoImpact: number;
  lifeImpact: number;
  winConditionDisruption: number;
  canBeRecurred: boolean;
  hasBackup: boolean; // Do we have other answers?
  opponentHasCounterspell: boolean; // Will they counter our counter?
}

/**
 * Response evaluation weights
 */
export interface ResponseWeights {
  // Core decision factors
  threatPrevention: number;
  cardAdvantage: number;
  tempo: number;
  resourceConservation: number;

  // Timing factors
  earlyGame: number;
  midGame: number;
  lateGame: number;

  // Strategic factors
  winConditionProtection: number;
  valuePlayProtection: number;
  bluffProtection: number;

  // Risk factors
  gettingCounterplayed: number;
  wastingRemoval: number;
  fallingBehind: number;

  // Stack complexity
  stackDepthPenalty: number;
  responseEfficiency: number;
}

/**
 * Default weights for different difficulty levels
 */
export const DefaultResponseWeights: Record<string, ResponseWeights> = {
  easy: {
    threatPrevention: 1.0,
    cardAdvantage: 0.5,
    tempo: 0.3,
    resourceConservation: 0.2,
    earlyGame: 1.0,
    midGame: 1.0,
    lateGame: 1.0,
    winConditionProtection: 0.5,
    valuePlayProtection: 0.3,
    bluffProtection: 0.1,
    gettingCounterplayed: 0.2,
    wastingRemoval: 0.5,
    fallingBehind: 0.3,
    stackDepthPenalty: 0.1,
    responseEfficiency: 0.3,
  },
  medium: {
    threatPrevention: 1.5,
    cardAdvantage: 1.0,
    tempo: 0.8,
    resourceConservation: 0.6,
    earlyGame: 0.8,
    midGame: 1.0,
    lateGame: 1.2,
    winConditionProtection: 1.0,
    valuePlayProtection: 0.6,
    bluffProtection: 0.3,
    gettingCounterplayed: 0.5,
    wastingRemoval: 0.8,
    fallingBehind: 0.6,
    stackDepthPenalty: 0.2,
    responseEfficiency: 0.6,
  },
  hard: {
    threatPrevention: 2.0,
    cardAdvantage: 1.5,
    tempo: 1.2,
    resourceConservation: 1.0,
    earlyGame: 0.6,
    midGame: 1.0,
    lateGame: 1.5,
    winConditionProtection: 1.5,
    valuePlayProtection: 1.0,
    bluffProtection: 0.5,
    gettingCounterplayed: 0.8,
    wastingRemoval: 1.0,
    fallingBehind: 1.0,
    stackDepthPenalty: 0.3,
    responseEfficiency: 1.0,
  },
  expert: {
    threatPrevention: 2.5,
    cardAdvantage: 2.0,
    tempo: 1.5,
    resourceConservation: 1.5,
    earlyGame: 0.5,
    midGame: 1.0,
    lateGame: 1.8,
    winConditionProtection: 2.0,
    valuePlayProtection: 1.5,
    bluffProtection: 0.8,
    gettingCounterplayed: 1.2,
    wastingRemoval: 1.5,
    fallingBehind: 1.5,
    stackDepthPenalty: 0.4,
    responseEfficiency: 1.5,
  },
};

export type DependencyType =
  | "counters"
  | "targets"
  | "protects"
  | "enables"
  | "prevents"
  | "depends_on_resolution";

export interface StackDependency {
  source_id: string;
  target_id: string;
  type: DependencyType;
  strength: number;
  description: string;
}

export interface StackItemAnalysis {
  action: StackAction;
  position: number;
  dependencies: StackDependency[];
  dependents: StackDependency[];
  critical_path: boolean;
  resolution_impact: number;
  suggested_action: "counter" | "allow" | "monitor";
  suggested_reasoning: string;
}

export interface StackDependencyAnalysis {
  items: StackItemAnalysis[];
  dependency_graph: StackDependency[];
  resolution_order: string[];
  critical_items: string[];
  has_cross_dependencies: boolean;
  summary: string;
}

export type ResolutionPriority =
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "irrelevant";

export interface DependencyChain {
  chain: string[];
  types: DependencyType[];
  total_strength: number;
  involves_counterwar: boolean;
}

export interface ResolutionAdvice {
  itemId: string;
  priority: ResolutionPriority;
  shouldCounter: boolean;
  shouldAllow: boolean;
  reasoning: string;
  dependencies_affected: string[];
}

export function analyzeStackDependencies(
  stack: StackAction[],
): StackDependencyAnalysis {
  if (stack.length === 0) {
    return {
      items: [],
      dependency_graph: [],
      resolution_order: [],
      critical_items: [],
      has_cross_dependencies: false,
      summary: "Empty stack - nothing to analyze",
    };
  }

  const items: StackItemAnalysis[] = stack.map((action, index) => ({
    action,
    position: index,
    dependencies: [],
    dependents: [],
    critical_path: false,
    resolution_impact: 0,
    suggested_action: "monitor" as const,
    suggested_reasoning: "",
  }));

  const allDependencies: StackDependency[] = [];

  for (let i = 0; i < items.length; i++) {
    for (let j = 0; j < items.length; j++) {
      if (i === j) continue;
      const deps = computeStackDependency(items[i].action, items[j].action);
      for (const dep of deps) {
        items[i].dependencies.push(dep);
        items[j].dependents.push(dep);
        allDependencies.push(dep);
      }
    }
  }

  for (const item of items) {
    item.resolution_impact = computeResolutionImpact(item);
  }
  const has_cross = detectCrossDependencies(allDependencies);
  markCriticalPaths(items);

  for (const item of items) {
    const s = computeSuggestedAction(item, items);
    item.suggested_action = s.action;
    item.suggested_reasoning = s.reasoning;
  }

  return {
    items,
    dependency_graph: allDependencies,
    resolution_order: computeResolutionOrder(items),
    critical_items: items
      .filter((i) => i.critical_path)
      .map((i) => i.action.id),
    has_cross_dependencies: has_cross,
    summary: generateAnalysisSummary(items, has_cross),
  };
}

function computeStackDependency(
  source: StackAction,
  target: StackAction,
): StackDependency[] {
  const deps: StackDependency[] = [];
  const lowerSource = source.name.toLowerCase();
  const lowerTarget = target.name.toLowerCase();
  const sourceIsCounter = lowerSource.includes("counter");
  const targetIsCounter = lowerTarget.includes("counter");

  if (sourceIsCounter && source.controller !== target.controller) {
    deps.push({
      source_id: source.id,
      target_id: target.id,
      type: "counters",
      strength: Math.min(
        1,
        targetIsCounter ? 0.9 : 0.5 + source.manaValue * 0.05,
      ),
      description: targetIsCounter
        ? `${source.name} counters ${target.name} (counterspell war)`
        : `${source.name} counters ${target.name}`,
    });
  }

  if (source.targets && target.targets) {
    const st = new Set(
      source.targets.flatMap((t) =>
        [t.playerId, t.permanentId, t.cardId].filter(Boolean),
      ),
    );
    const tt = new Set(
      target.targets.flatMap((t) =>
        [t.playerId, t.permanentId, t.cardId].filter(Boolean),
      ),
    );
    for (const t of st) {
      if (tt.has(t)) {
        deps.push({
          source_id: source.id,
          target_id: target.id,
          type: "targets",
          strength: 0.6,
          description: `${source.name} and ${target.name} share target ${t}`,
        });
        break;
      }
    }
  }

  if (
    source.controller !== target.controller &&
    lowerTarget.includes("destroy")
  ) {
    if (
      source.targets?.some((t) => t.playerId === source.controller) ||
      lowerSource.includes("creature")
    ) {
      deps.push({
        source_id: target.id,
        target_id: source.id,
        type: "prevents",
        strength: 0.7,
        description: `${target.name} threatens to remove ${source.name}`,
      });
    }
  }

  if (
    lowerSource.includes("protect") ||
    lowerSource.includes("save") ||
    lowerSource.includes("shield")
  ) {
    if (source.targets?.some((t) => t.playerId === source.controller)) {
      deps.push({
        source_id: source.id,
        target_id: target.id,
        type: "protects",
        strength: 0.65,
        description: `${source.name} may protect against ${target.name}`,
      });
    }
  }

  if (
    (lowerSource.includes("copy") ||
      lowerSource.includes("twincast") ||
      lowerSource.includes("reverberate")) &&
    source.controller !== target.controller
  ) {
    deps.push({
      source_id: source.id,
      target_id: target.id,
      type: "depends_on_resolution",
      strength: 0.8,
      description: `${source.name} copies ${target.name} - depends on resolution`,
    });
  }

  if (lowerSource.includes("redirect") || lowerSource.includes("deflect")) {
    deps.push({
      source_id: source.id,
      target_id: target.id,
      type: "targets",
      strength: 0.75,
      description: `${source.name} redirects ${target.name}`,
    });
  }

  if (lowerSource.includes("draw") && source.controller === target.controller) {
    deps.push({
      source_id: target.id,
      target_id: source.id,
      type: "enables",
      strength: 0.3,
      description: `${target.name} enabling condition for ${source.name}`,
    });
  }

  return deps;
}

function computeResolutionImpact(item: StackItemAnalysis): number {
  let impact = 0;
  const threatKeywords = [
    "destroy",
    "exile",
    "damage",
    "bolt",
    "shock",
    "blast",
    "counter",
    "win",
    "ultimatum",
  ];
  impact += threatKeywords.some((k) =>
    item.action.name.toLowerCase().includes(k),
  )
    ? 0.3
    : 0.1;
  impact += Math.min(0.3, item.action.manaValue * 0.04);
  impact += item.dependencies.length * 0.1;
  impact += item.dependents.length * 0.15;
  impact +=
    item.dependents.filter(
      (d) => d.type === "depends_on_resolution" || d.type === "enables",
    ).length * 0.2;
  return Math.min(1, impact);
}

function detectCrossDependencies(deps: StackDependency[]): boolean {
  const ids = new Set(deps.flatMap((d) => [d.source_id, d.target_id]));
  if (ids.size < 3) return false;
  const adj: Map<string, Set<string>> = new Map();
  for (const id of ids) adj.set(id, new Set());
  for (const dep of deps) adj.get(dep.source_id)?.add(dep.target_id);
  for (const src of ids) {
    const visited = new Set<string>();
    const stk = [src];
    while (stk.length > 0) {
      const cur = stk.pop()!;
      if (visited.has(cur)) return true;
      visited.add(cur);
      for (const n of adj.get(cur) || []) stk.push(n);
    }
  }
  return false;
}

function markCriticalPaths(items: StackItemAnalysis[]): void {
  for (const item of items) {
    const si = item.dependencies.filter((d) => d.strength >= 0.6);
    const so = item.dependents.filter((d) => d.strength >= 0.6);
    if (si.length > 0 && so.length > 0) {
      item.critical_path = true;
      continue;
    }
    if (item.resolution_impact > 0.5) {
      item.critical_path = true;
      continue;
    }
    if (
      item.dependencies.some((d) => d.type === "counters") &&
      item.dependents.some((d) => d.type === "counters")
    ) {
      item.critical_path = true;
      continue;
    }
    if (si.length >= 1 && item.dependents.length > 0) {
      item.critical_path = true;
    }
  }
}

function computeSuggestedAction(
  item: StackItemAnalysis,
  allItems: StackItemAnalysis[],
): { action: "counter" | "allow" | "monitor"; reasoning: string } {
  const deps = item.dependencies;
  const dependents = item.dependents;
  const isCountered = deps.some((d) => d.type === "counters");
  const isCounter = item.action.name.toLowerCase().includes("counter");
  const countersOther = dependents.some((d) => d.type === "counters");
  const countersCounterspell = deps.some(
    (d) => d.type === "counters" && d.strength >= 0.8,
  );

  if (isCounter && countersCounterspell)
    return {
      action: "counter",
      reasoning:
        "Counterspell targets our counterspell - recounter to protect original spell",
    };
  if (isCounter && countersOther)
    return {
      action: "counter",
      reasoning:
        "Counterwar detected - counter the counter to protect original spell",
    };

  if (isCountered) {
    const threatenedBelow = allItems.filter(
      (i) =>
        i.position < item.position &&
        i.dependents.some((d) => d.type === "prevents"),
    );
    if (threatenedBelow.length > 0 && isCounter)
      return {
        action: "counter",
        reasoning: `Counterspell is itself countered - recounter to protect items below from ${threatenedBelow.map((i) => i.action.name).join(", ")}`,
      };
    return {
      action: "monitor",
      reasoning:
        "This item is being countered - evaluate whether it needs protection",
    };
  }

  if (
    deps.some((d) => d.type === "prevents" && d.strength >= 0.5) &&
    item.resolution_impact > 0.4
  ) {
    return {
      action: "counter",
      reasoning: `${deps.find((d) => d.type === "prevents")!.description} - protect high-impact item`,
    };
  }

  if (item.resolution_impact > 0.6 && !isCountered)
    return {
      action: "monitor",
      reasoning: `High impact item (${item.resolution_impact.toFixed(2)}) - monitor for responses`,
    };

  const enablesBelow = dependents.filter(
    (d) => d.type === "enables" || d.type === "depends_on_resolution",
  );
  if (enablesBelow.length > 0)
    return {
      action: "allow",
      reasoning: `Letting this resolve enables ${enablesBelow.length} dependent item(s)`,
    };

  if (item.resolution_impact < 0.3 && deps.length === 0)
    return {
      action: "allow",
      reasoning: "Low impact with no dependencies - safe to resolve",
    };

  return {
    action: "monitor",
    reasoning: `Standard monitoring - impact ${item.resolution_impact.toFixed(2)}, ${deps.length} deps`,
  };
}

function computeResolutionOrder(items: StackItemAnalysis[]): string[] {
  return [...items]
    .sort((a, b) => {
      if (a.critical_path !== b.critical_path) return a.critical_path ? -1 : 1;
      const diff = b.resolution_impact - a.resolution_impact;
      if (Math.abs(diff) > 0.1) return diff;
      return a.position - b.position;
    })
    .map((i) => i.action.id);
}

function generateAnalysisSummary(
  items: StackItemAnalysis[],
  hasCrossDeps: boolean,
): string {
  const parts: string[] = [`Stack of ${items.length} item(s)`];
  const crit = items.filter((i) => i.critical_path);
  const counters = items.filter((i) =>
    i.action.name.toLowerCase().includes("counter"),
  );
  if (crit.length > 0) parts.push(`${crit.length} critical path item(s)`);
  if (counters.length > 0) parts.push(`${counters.length} counterspell(s)`);
  if (hasCrossDeps) parts.push("cross-dependencies detected");
  parts.push(
    `${items.reduce((s, i) => s + i.dependencies.length + i.dependents.length, 0) / 2} total dependency relationship(s)`,
  );
  return parts.join(" - ");
}

export class StackDependencyAnalyzer {
  private analysis: StackDependencyAnalysis;

  constructor(stack: StackAction[]) {
    this.analysis = analyzeStackDependencies(stack);
  }

  getAnalysis(): StackDependencyAnalysis {
    return this.analysis;
  }

  getDependencyChains(): DependencyChain[] {
    const chains: DependencyChain[] = [];
    const adj = new Map<
      string,
      { target: string; type: DependencyType; strength: number }[]
    >();

    for (const dep of this.analysis.dependency_graph) {
      if (!adj.has(dep.source_id)) adj.set(dep.source_id, []);
      adj.get(dep.source_id)!.push({
        target: dep.target_id,
        type: dep.type,
        strength: dep.strength,
      });
      if (!adj.has(dep.target_id)) adj.set(dep.target_id, []);
      adj.get(dep.target_id)!.push({
        target: dep.source_id,
        type: dep.type,
        strength: dep.strength,
      });
    }

    const visited = new Set<string>();

    for (const startId of this.analysis.resolution_order) {
      if (visited.has(startId)) continue;
      const chain = this.buildChain(startId, adj, visited);
      if (chain.chain.length >= 2) {
        chains.push(chain);
        for (const id of chain.chain) visited.add(id);
      }
    }

    return chains.sort((a, b) => b.total_strength - a.total_strength);
  }

  private buildChain(
    start: string,
    adj: Map<
      string,
      { target: string; type: DependencyType; strength: number }[]
    >,
    globalVisited: Set<string>,
  ): DependencyChain {
    const chain: string[] = [start];
    const types: DependencyType[] = [];
    let totalStrength = 0;
    let involvesCounterwar = false;
    const localVisited = new Set<string>([start]);
    const current = start;

    const neighbors = adj.get(current) || [];
    for (const edge of neighbors) {
      if (!localVisited.has(edge.target) && !globalVisited.has(edge.target)) {
        chain.push(edge.target);
        types.push(edge.type);
        totalStrength += edge.strength;
        if (edge.type === "counters") involvesCounterwar = true;

        const nextNeighbors = adj.get(edge.target) || [];
        for (const next of nextNeighbors) {
          if (
            !localVisited.has(next.target) &&
            !globalVisited.has(next.target)
          ) {
            chain.push(next.target);
            types.push(next.type);
            totalStrength += next.strength;
            if (next.type === "counters") involvesCounterwar = true;
            break;
          }
        }
        break;
      }
    }

    return {
      chain,
      types,
      total_strength: totalStrength,
      involves_counterwar: involvesCounterwar,
    };
  }

  getResolutionAdvice(): ResolutionAdvice[] {
    return this.analysis.items.map((item) => {
      const { action, priority, reason } = this.evaluateItem(item);
      return {
        itemId: item.action.id,
        priority,
        shouldCounter: action === "counter",
        shouldAllow: action === "allow",
        reasoning: reason,
        dependencies_affected: [
          ...item.dependencies.map((d) => d.target_id),
          ...item.dependents.map((d) => d.source_id),
        ],
      };
    });
  }

  private evaluateItem(item: StackItemAnalysis): {
    action: "counter" | "allow" | "monitor";
    priority: ResolutionPriority;
    reason: string;
  } {
    if (item.critical_path) {
      const counterDeps = item.dependencies.filter(
        (d) => d.type === "counters",
      );
      const counterDependents = item.dependents.filter(
        (d) => d.type === "counters",
      );

      if (counterDeps.length > 0 && counterDependents.length > 0) {
        return {
          action: "counter",
          priority: "critical",
          reason:
            "Counterwar escalation point - countering this resolves the chain",
        };
      }

      if (counterDeps.length > 0) {
        return {
          action: "counter",
          priority: "high",
          reason: "This item is being countered and sits on critical path",
        };
      }
    }

    const preventsDeps = item.dependencies.filter((d) => d.type === "prevents");
    if (preventsDeps.length > 0 && item.resolution_impact > 0.4) {
      return {
        action: "counter",
        priority: "high",
        reason: "Preventing a high-impact item from being removed",
      };
    }

    if (this.shouldAllowToPreventWorse(item)) {
      return {
        action: "allow",
        priority: "medium",
        reason: "Allowing this to resolve blocks a worse outcome below",
      };
    }

    if (item.resolution_impact > 0.6) {
      return {
        action: "monitor",
        priority: "high",
        reason: "High resolution impact - monitor for responses",
      };
    }

    if (item.resolution_impact > 0.3) {
      return {
        action: "monitor",
        priority: "medium",
        reason: "Moderate impact item",
      };
    }

    if (item.dependencies.length === 0 && item.dependents.length === 0) {
      return {
        action: "allow",
        priority: "low",
        reason: "No dependencies - safe to resolve",
      };
    }

    return {
      action: "monitor",
      priority: "medium",
      reason: "Standard monitoring",
    };
  }

  private shouldAllowToPreventWorse(item: StackItemAnalysis): boolean {
    const preventsDeps = item.dependents.filter(
      (d) => d.type === "prevents" && d.strength >= 0.5,
    );
    if (preventsDeps.length === 0) return false;

    const itemsBelow = this.analysis.items.filter(
      (i) => i.position < item.position,
    );
    const threatBelow = itemsBelow.some(
      (i) =>
        i.dependencies.some(
          (d) => d.type === "prevents" || d.type === "targets",
        ) && i.resolution_impact > 0.4,
    );

    return threatBelow;
  }

  findCounterwarEscalation(): {
    isCounterwar: boolean;
    depth: number;
    recommendedAction: string;
  } {
    const counters = this.analysis.items.filter((i) =>
      i.action.name.toLowerCase().includes("counter"),
    );
    if (counters.length < 2) {
      return { isCounterwar: false, depth: 0, recommendedAction: "none" };
    }

    const counterDeps = this.analysis.dependency_graph.filter(
      (d) => d.type === "counters",
    );
    const uniqueCounterItems = new Set(counterDeps.map((d) => d.source_id));

    if (uniqueCounterItems.size >= 2) {
      return {
        isCounterwar: true,
        depth: uniqueCounterItems.size,
        recommendedAction:
          uniqueCounterItems.size >= 3
            ? "resolve_original_and_hold"
            : "recounter_top",
      };
    }

    return {
      isCounterwar: true,
      depth: counters.length,
      recommendedAction: "evaluate_mana_efficiency",
    };
  }
}

/**
 * Main stack interaction AI class
 */
export class StackInteractionAI {
  private gameState: GameState;
  private playerId: string;
  private weights: ResponseWeights;

  constructor(
    gameState: GameState,
    playerId: string,
    difficulty: "easy" | "medium" | "hard" | "expert" = "medium",
  ) {
    this.gameState = gameState;
    this.playerId = playerId;
    // Default to medium if difficulty not recognized
    this.weights =
      DefaultResponseWeights[difficulty] || DefaultResponseWeights["medium"];
  }

  /**
   * Main decision point: Should I respond to this stack action?
   */
  evaluateResponse(context: StackContext): ResponseDecision {
    const currentEvaluation = evaluateGameState(
      this.gameState,
      this.playerId,
      "medium",
    );

    // Evaluate the threat level of the current action
    const threatLevel = this.assessActionThreat(context, currentEvaluation);

    // If no significant threat, pass priority
    if (threatLevel < 0.3) {
      return {
        shouldRespond: false,
        action: "pass",
        reasoning: "Threat level is low - conserve resources",
        confidence: 0.9,
        expectedValue: 0,
      };
    }

    // Check if we have valid responses available
    const validResponses = this.getValidResponses(context);
    if (validResponses.length === 0) {
      return {
        shouldRespond: false,
        action: "pass",
        reasoning: "No valid responses available",
        confidence: 1.0,
        expectedValue: 0,
      };
    }

    // Evaluate each possible response
    const responseEvaluations = validResponses.map((response) => ({
      response,
      evaluation: this.evaluateResponseOption(
        response,
        context,
        currentEvaluation,
      ),
    }));

    // Sort by expected value
    responseEvaluations.sort(
      (a, b) => b.evaluation.expectedValue - a.evaluation.expectedValue,
    );

    const bestResponse = responseEvaluations[0];

    // Decide if the best response is worth it
    const shouldUseResponse = this.shouldUseResponse(
      bestResponse.evaluation.expectedValue,
      context,
      currentEvaluation,
    );

    if (!shouldUseResponse) {
      // Consider holding mana for later
      const holdDecision = this.evaluateHoldingMana(context, currentEvaluation);
      return {
        shouldRespond: false,
        action: "pass",
        reasoning: holdDecision.reasoning,
        confidence: 0.8,
        expectedValue: 0,
        holdMana: holdDecision.holdMana,
        waitForBetterResponse: holdDecision.waitForBetter,
      };
    }

    return {
      shouldRespond: true,
      action: bestResponse.evaluation.holdPriority
        ? "hold_priority"
        : "respond",
      responseCardId: bestResponse.response.cardId,
      targetActionId: context.currentAction.id,
      reasoning: bestResponse.evaluation.reasoning,
      confidence: bestResponse.evaluation.confidence,
      expectedValue: bestResponse.evaluation.expectedValue,
    };
  }

  /**
   * Evaluate response using AI via proxy
   */
  async evaluateResponseAI(
    context: StackContext,
    provider: AIProvider = "zaic",
    model?: string,
  ): Promise<ResponseDecision> {
    try {
      const response = await callAIProxy<ResponseDecision>({
        provider,
        endpoint: "chat/completions",
        model: model || "default",
        body: {
          messages: [
            {
              role: "system",
              content:
                "You are a Magic: The Gathering AI. Determine if you should respond to the current stack action.",
            },
            {
              role: "user",
              content: JSON.stringify({
                gameState: this.gameState,
                context,
                playerId: this.playerId,
              }),
            },
          ],
          response_format: { type: "json_object" },
        },
      });

      if (response.success && response.data) {
        return response.data;
      }

      // Fallback to heuristic if AI fails
      return this.evaluateResponse(context);
    } catch (error) {
      console.error(
        "AI response evaluation failed, falling back to heuristic:",
        error,
      );
      return this.evaluateResponse(context);
    }
  }

  /**
   * Counterspell-specific decision making
   */
  decideCounterspell(
    context: StackContext,
    counterspell: AvailableResponse,
  ): ResponseDecision {
    const factors = this.evaluateCounterspellFactors(context, counterspell);
    const shouldCounter = this.shouldUseCounterspell(factors);

    if (!shouldCounter) {
      return {
        shouldRespond: false,
        action: "pass",
        reasoning: this.explainCounterspellPass(factors),
        confidence: 0.85,
        expectedValue: 0,
      };
    }

    const expectedValue = this.calculateCounterspellValue(factors);

    return {
      shouldRespond: true,
      action: "respond",
      responseCardId: counterspell.cardId,
      targetActionId: context.currentAction.id,
      reasoning: this.explainCounterspellUse(factors),
      confidence: this.calculateCounterspellConfidence(factors),
      expectedValue,
    };
  }

  /**
   * Evaluate multiple responses and determine optimal order
   */
  optimizeResponseOrder(
    context: StackContext,
    possibleResponses: AvailableResponse[],
  ): StackOrderDecision {
    // Filter responses we can actually afford
    const affordableResponses = possibleResponses.filter((response) =>
      this.canAffordResponse(response, context),
    );

    if (affordableResponses.length === 0) {
      return {
        orderedActions: [],
        reasoning: "No affordable responses available",
        expectedValue: 0,
      };
    }

    if (affordableResponses.length === 1) {
      const singleEval = this.evaluateResponseOption(
        affordableResponses[0],
        context,
        evaluateGameState(this.gameState, this.playerId, "medium"),
      );
      return {
        orderedActions: [affordableResponses[0].cardId],
        reasoning: `Single response: ${singleEval.reasoning}`,
        expectedValue: singleEval.expectedValue,
      };
    }

    // For multiple responses, we need to consider ordering
    // Generate possible orderings and evaluate each
    const orderings = this.generateResponseOrderings(affordableResponses);

    let bestOrdering = orderings[0];
    let bestValue = -Infinity;

    for (const ordering of orderings) {
      const value = this.evaluateOrderingValue(ordering, context);
      if (value > bestValue) {
        bestValue = value;
        bestOrdering = ordering;
      }
    }

    return {
      orderedActions: bestOrdering.map((r) => r.cardId),
      reasoning: `Optimal ordering of ${bestOrdering.length} responses for maximum value`,
      expectedValue: bestValue,
    };
  }

  /**
   * Decide whether to pass priority
   */
  decidePriorityPass(context: StackContext): PriorityPassDecision {
    const currentEvaluation = evaluateGameState(
      this.gameState,
      this.playerId,
      "medium",
    );
    const threatLevel = this.assessActionThreat(context, currentEvaluation);

    // Evaluate risk of passing
    const riskLevel = this.evaluatePassRisk(context, currentEvaluation);

    // Consider if opponents have more actions
    const opponentsCanRespond = context.opponentsRemaining.length > 0;

    let shouldPass = true;
    let reason = "No immediate threat, safe to pass";

    // High threat level suggests we should respond
    if (threatLevel > 0.7) {
      shouldPass = false;
      reason = "High threat action requires response";
    } else if (threatLevel > 0.5 && riskLevel !== "low") {
      shouldPass = false;
      reason = "Moderate threat with significant risk";
    }

    // If opponents might respond, consider holding priority
    if (shouldPass && opponentsCanRespond && riskLevel === "high") {
      shouldPass = false;
      reason = "Opponents may respond to our response - hold priority";
    }

    return {
      shouldPass,
      reason,
      riskLevel,
    };
  }

  /**
   * Resource management: hold mana vs use now
   */
  manageResources(context: StackContext): ResourceDecision {
    const currentEvaluation = evaluateGameState(
      this.gameState,
      this.playerId,
      "medium",
    );

    // Calculate total mana available

    // Check what instant-speed effects we have available
    const instantSpeedResponses = context.availableResponses.filter(
      (r) => r.type === "instant" || r.type === "flash",
    );

    // Evaluate if we should hold mana
    const holdForEndStep = this.shouldHoldForEndStep(
      context,
      currentEvaluation,
    );
    const holdForOpponentTurn = this.shouldHoldForOpponentTurn(
      context,
      currentEvaluation,
    );
    const holdForBetterThreat = this.shouldHoldForBetterThreat(
      context,
      currentEvaluation,
    );

    // Calculate mana to reserve
    let manaToReserve: { [color: string]: number } = {};

    if (holdForEndStep || holdForOpponentTurn) {
      // Reserve mana for our best instant
      const bestInstant = this.findBestInstantResponse(
        instantSpeedResponses,
        context,
      );
      if (bestInstant) {
        manaToReserve = { ...bestInstant.manaCost };
      }
    }

    const bluffDecision = this.shouldBluffHoldMana(context, currentEvaluation);

    let holdFor: ResourceDecision["holdFor"] = "nothing";
    let reasoning = "Use mana now - no better opportunity identified";

    if (holdForBetterThreat) {
      holdFor = "better_threat";
      reasoning = "Hold mana for a more threatening action expected soon";
    } else if (bluffDecision.shouldBluff && !bluffDecision.isGenuineHold) {
      holdFor = "bluff";
      reasoning = bluffDecision.reasoning;
      if (bluffDecision.bluffStrength > 0.5) {
        const bestInstant = this.findBestInstantResponse(
          instantSpeedResponses,
          context,
        );
        if (bestInstant) {
          manaToReserve = { ...bestInstant.manaCost };
        }
      }
    } else if (holdForEndStep) {
      holdFor = "end_step";
      reasoning = "Hold mana for end step to play around opponent's turn";
    } else if (holdForOpponentTurn) {
      holdFor = "opponent_turn";
      reasoning = "Hold mana for opponent's turn for interaction";
    }

    return {
      useNow: holdFor === "nothing",
      holdFor,
      manaToReserve,
      reasoning,
    };
  }

  /**
   * Assess the threat level of a stack action
   */
  private assessActionThreat(
    context: StackContext,
    currentEvaluation: DetailedEvaluation,
  ): number {
    const action = context.currentAction;
    let threatLevel = 0;

    // High mana value spells are typically more threatening
    threatLevel += Math.min(0.4, action.manaValue * 0.05);

    // Check targets
    if (action.targets) {
      for (const target of action.targets) {
        // Targeting our stuff is bad
        if (target.playerId === this.playerId) {
          threatLevel += 0.3;
        }
        if (target.permanentId) {
          const permanent = this.findPermanent(target.permanentId);
          if (permanent && permanent.controller === this.playerId) {
            // More threat based on permanent importance
            threatLevel += this.getPermanentImportance(permanent) * 0.3;
          }
        }
      }
    }

    // Certain card types are more threatening
    const lowerName = action.name.toLowerCase();
    if (lowerName.includes("destroy") || lowerName.includes("exile")) {
      threatLevel += 0.2;
    }
    if (lowerName.includes("counter")) {
      threatLevel += 0.3;
    }
    if (lowerName.includes("draw") && action.controller !== this.playerId) {
      threatLevel += 0.15;
    }

    // Consider game state
    if (currentEvaluation.factors.lifeScore < -0.5) {
      // We're losing on life, threats are more critical
      threatLevel += 0.2;
    }

    if (currentEvaluation.threats.length > 0) {
      // We're already under pressure
      threatLevel += 0.1;
    }

    return Math.min(1, threatLevel);
  }

  /**
   * Get valid responses available in context
   */
  private getValidResponses(context: StackContext): AvailableResponse[] {
    return context.availableResponses.filter((response) =>
      this.canAffordResponse(response, context),
    );
  }

  /**
   * Check if we can afford a response
   */
  private canAffordResponse(
    response: AvailableResponse,
    context: StackContext,
  ): boolean {
    for (const [color, amount] of Object.entries(response.manaCost)) {
      if ((context.availableMana[color] || 0) < amount) {
        return false;
      }
    }
    return true;
  }

  /**
   * Evaluate a specific response option
   */
  private evaluateResponseOption(
    response: AvailableResponse,
    context: StackContext,
    currentEvaluation: DetailedEvaluation,
  ): {
    expectedValue: number;
    reasoning: string;
    confidence: number;
    holdPriority: boolean;
  } {
    let expectedValue = 0;
    let reasoning = "";
    const confidence = 0.7;

    // Base value from effect type
    expectedValue += response.effect.value * 0.5;

    // Bonus for efficient responses (low cost, high impact)
    const efficiency = response.effect.value / (response.manaValue + 1);
    expectedValue += efficiency * this.weights.responseEfficiency;

    // Threat prevention value
    const threatLevel = this.assessActionThreat(context, currentEvaluation);
    expectedValue += threatLevel * this.weights.threatPrevention;

    // Card advantage consideration
    if (response.effect.type === "counter") {
      // Countering is often a 2-for-1 (or better)
      expectedValue += this.weights.cardAdvantage * 0.5;
    } else if (
      response.effect.type === "destroy" ||
      response.effect.type === "exile"
    ) {
      // Removal is card parity if target has already been cast
      expectedValue += this.weights.cardAdvantage * 0.2;
    }

    // Tempo consideration
    expectedValue +=
      (context.currentAction.manaValue - response.manaValue) *
      0.05 *
      this.weights.tempo;

    // Stack depth penalty (responses deeper on stack are less valuable)
    const stackDepthPenalty =
      context.stackSize * this.weights.stackDepthPenalty;
    expectedValue -= stackDepthPenalty;

    // Resource conservation
    const manaRemaining = this.calculateManaRemaining(response, context);
    expectedValue += manaRemaining * 0.02 * this.weights.resourceConservation;

    // Win condition protection
    if (this.protectsWinCondition(response, context, currentEvaluation)) {
      expectedValue += this.weights.winConditionProtection;
    }

    reasoning = this.generateResponseReasoning(
      response,
      threatLevel,
      efficiency,
      expectedValue,
    );

    const holdPriority = this.shouldHoldPriority(
      response,
      context,
      currentEvaluation,
    );

    return {
      expectedValue,
      reasoning,
      confidence,
      holdPriority,
    };
  }

  /**
   * Decide if a response is worth using
   */
  private shouldUseResponse(
    expectedValue: number,
    context: StackContext,
    currentEvaluation: DetailedEvaluation,
  ): boolean {
    // Base threshold
    let threshold = 0.3;

    // Lower threshold if we're losing
    if (currentEvaluation.totalScore < 0) {
      threshold -= 0.2;
    }

    // Lower threshold for critical threats
    const threatLevel = this.assessActionThreat(context, currentEvaluation);
    if (threatLevel > 0.7) {
      threshold -= 0.3;
    }

    return expectedValue > threshold;
  }

  /**
   * Evaluate counterspell-specific factors
   */
  private evaluateCounterspellFactors(
    context: StackContext,
    counterspell: AvailableResponse,
  ): CounterspellFactors {
    const currentEvaluation = evaluateGameState(
      this.gameState,
      this.playerId,
      "medium",
    );

    return {
      threatLevel: this.assessActionThreat(context, currentEvaluation),
      cardAdvantageImpact: this.calculateCounterspellCardAdvantage(context),
      tempoImpact: this.calculateCounterspellTempo(context, counterspell),
      lifeImpact: this.calculateCounterspellLifeImpact(context),
      winConditionDisruption: this.calculateWinConditionDisruption(
        context,
        currentEvaluation,
      ),
      canBeRecurred: this.canCounterspellBeRecurred(counterspell),
      hasBackup: this.hasBackupCounterspells(context),
      opponentHasCounterspell: this.likelyOpponentCounterspell(context),
    };
  }

  /**
   * Decide if we should use a counterspell
   */
  private shouldUseCounterspell(factors: CounterspellFactors): boolean {
    let score = 0;

    // Threat level is most important
    score += factors.threatLevel * 3.0;

    // Card advantage impact
    score += factors.cardAdvantageImpact * 1.5;

    // Tempo
    score += factors.tempoImpact * 1.0;

    // Life impact
    score += factors.lifeImpact * 1.2;

    // Win condition disruption is critical
    score += factors.winConditionDisruption * 2.5;

    // Penalty if opponent can counter our counterspell
    if (factors.opponentHasCounterspell && !factors.hasBackup) {
      score -= 2.0;
    }

    // Bonus if we have backup
    if (factors.hasBackup) {
      score += 0.5;
    }

    // Bonus if it can be recurred
    if (factors.canBeRecurred) {
      score += 0.3;
    }

    return score > 2.0;
  }

  /**
   * Explain why we're passing on a counterspell
   */
  private explainCounterspellPass(factors: CounterspellFactors): string {
    const reasons = [];

    if (factors.threatLevel < 0.4) {
      reasons.push("threat is low");
    }
    if (factors.opponentHasCounterspell && !factors.hasBackup) {
      reasons.push("opponent likely has counterspell");
    }
    if (factors.cardAdvantageImpact < 0) {
      reasons.push("card disadvantage");
    }
    if (factors.canBeRecurred) {
      reasons.push("save for recasting");
    }

    return `Don't counter: ${reasons.join(", ")}`;
  }

  /**
   * Explain why we're using a counterspell
   */
  private explainCounterspellUse(factors: CounterspellFactors): string {
    const reasons = [];

    if (factors.threatLevel > 0.7) {
      reasons.push("major threat");
    }
    if (factors.winConditionDisruption > 0.5) {
      reasons.push("protects win condition");
    }
    if (factors.cardAdvantageImpact > 0.5) {
      reasons.push("card advantage");
    }
    if (factors.lifeImpact > 0.5) {
      reasons.push("prevents life loss");
    }

    return `Counter: ${reasons.join(", ")}`;
  }

  /**
   * Calculate counterspell confidence
   */
  private calculateCounterspellConfidence(
    factors: CounterspellFactors,
  ): number {
    let confidence = 0.5;

    if (factors.threatLevel > 0.7) confidence += 0.2;
    if (!factors.opponentHasCounterspell) confidence += 0.1;
    if (factors.hasBackup) confidence += 0.1;
    if (factors.winConditionDisruption > 0.5) confidence += 0.1;

    // High confidence for lethal threats - preventing game loss is critical
    if (factors.lifeImpact > 0.5) confidence += 0.3;

    // Extra confidence for high threat level (which includes targeting us with low life)
    if (factors.threatLevel > 0.5) confidence += 0.15;

    return Math.min(1, confidence);
  }

  /**
   * Calculate the value of using a counterspell
   */
  private calculateCounterspellValue(factors: CounterspellFactors): number {
    return (
      factors.threatLevel * 2.0 +
      factors.cardAdvantageImpact * 1.0 +
      factors.tempoImpact * 0.5 +
      factors.lifeImpact * 0.8 +
      factors.winConditionDisruption * 1.5
    );
  }

  /**
   * Evaluate holding mana decision
   */
  private evaluateHoldingMana(
    context: StackContext,
    currentEvaluation: DetailedEvaluation,
  ): {
    holdMana: boolean;
    waitForBetter: boolean;
    reasoning: string;
  } {
    const instantOptions = context.availableResponses.filter(
      (r) => r.type === "instant" || r.type === "flash",
    );

    if (instantOptions.length === 0) {
      const bluffDecision = this.shouldBluffHoldMana(
        context,
        currentEvaluation,
      );
      if (bluffDecision.shouldBluff) {
        return {
          holdMana: true,
          waitForBetter: false,
          reasoning: bluffDecision.reasoning,
        };
      }
      return {
        holdMana: false,
        waitForBetter: false,
        reasoning: "No instant-speed options to hold for",
      };
    }

    if (currentEvaluation.totalScore > 2.0) {
      return {
        holdMana: false,
        waitForBetter: false,
        reasoning: "Winning, no need to hold interaction",
      };
    }

    if (!context.isMyTurn && instantOptions.length > 0) {
      return {
        holdMana: true,
        waitForBetter: true,
        reasoning: "Opponent's turn - hold mana for interaction",
      };
    }

    const bluffDecision = this.shouldBluffHoldMana(context, currentEvaluation);
    if (bluffDecision.shouldBluff && !bluffDecision.isGenuineHold) {
      return {
        holdMana: true,
        waitForBetter: false,
        reasoning: bluffDecision.reasoning,
      };
    }

    return {
      holdMana: false,
      waitForBetter: false,
      reasoning: "No clear benefit to holding mana",
    };
  }

  shouldBluffHoldMana(
    context: StackContext,
    currentEvaluation: DetailedEvaluation,
    opponentHistory?: OpponentHistory,
  ): BluffHoldDecision {
    const totalMana = Object.values(context.availableMana).reduce(
      (sum, m) => sum + m,
      0,
    );

    if (totalMana < 2) {
      return {
        shouldBluff: false,
        reasoning: "Insufficient mana open to bluff",
        bluffStrength: 0,
        isGenuineHold: false,
      };
    }

    const phase = this.gameState.turnInfo?.phase;
    if (phase === "end" || phase === "combat") {
      return {
        shouldBluff: false,
        reasoning: "Bluffing not appropriate in this phase",
        bluffStrength: 0,
        isGenuineHold: false,
      };
    }

    if (currentEvaluation.factors.lifeScore < -1.0) {
      return {
        shouldBluff: false,
        reasoning: "Too low on life to bluff - need actual interaction",
        bluffStrength: 0,
        isGenuineHold: false,
      };
    }

    if (this.gameState.turnInfo && this.gameState.turnInfo.currentTurn <= 3) {
      return {
        shouldBluff: false,
        reasoning: "Too early in the game for effective bluffing",
        bluffStrength: 0,
        isGenuineHold: false,
      };
    }

    if (currentEvaluation.totalScore < -2.0) {
      return {
        shouldBluff: false,
        reasoning: "Too far behind - need to develop board not bluff",
        bluffStrength: 0,
        isGenuineHold: false,
      };
    }

    const immediateThreats = currentEvaluation.threats.filter(
      (t: ThreatAssessment) => t.urgency === "immediate",
    );
    if (immediateThreats.length > 0) {
      return {
        shouldBluff: true,
        reasoning: "Holding mana against immediate threats",
        bluffStrength: 0.2,
        isGenuineHold: true,
      };
    }

    const archetype = this.detectArchetype(currentEvaluation);
    const archetypeBonus =
      archetype === "control" ? 0.3 : archetype === "tempo" ? 0.2 : 0;

    let bluffStrength = 0.1;

    bluffStrength += Math.min(0.3, totalMana * 0.04);

    if (currentEvaluation.totalScore > 0.5) {
      bluffStrength += 0.2;
    }

    if (currentEvaluation.totalScore < -0.5) {
      bluffStrength -= 0.15;
    }

    const instantResponses = context.availableResponses.filter(
      (r) => r.type === "instant" || r.type === "flash",
    );
    if (instantResponses.length > 0) {
      bluffStrength += 0.15;
    }

    const player = this.gameState.players[this.playerId];
    const handSize = player ? player.hand.length : 0;
    bluffStrength += Math.min(0.2, handSize * 0.04);

    bluffStrength += archetypeBonus;

    if (opponentHistory) {
      if (opponentHistory.playsAroundOpenMana) {
        bluffStrength += 0.25;
      }
      if (opponentHistory.hesitationCount > 2) {
        bluffStrength += 0.15;
      }
      if (opponentHistory.avgPlaysPerTurn < 1.5) {
        bluffStrength += 0.1;
      }
    }

    bluffStrength = Math.min(1, Math.max(0, bluffStrength));

    const threshold = opponentHistory?.wasBaited ? 0.45 : 0.35;
    const shouldBluff = bluffStrength >= threshold;

    if (shouldBluff) {
      const isGenuineHold = instantResponses.length > 0 && bluffStrength < 0.5;
      const reasons: string[] = [];
      if (archetype === "control") reasons.push("control archetype pressure");
      if (archetype === "tempo") reasons.push("tempo disruption");
      if (totalMana >= 4) reasons.push("significant mana open");
      if (currentEvaluation.totalScore > 0.5)
        reasons.push("favorable board state");
      if (opponentHistory?.playsAroundOpenMana)
        reasons.push("opponent respects open mana");

      return {
        shouldBluff: true,
        reasoning: isGenuineHold
          ? "Holding mana with legitimate interaction options"
          : `Bluffing with open mana: ${reasons.join(", ")}`,
        bluffStrength,
        isGenuineHold,
      };
    }

    return {
      shouldBluff: false,
      reasoning: "Conditions not favorable for bluffing",
      bluffStrength,
      isGenuineHold: false,
    };
  }

  /**
   * Detect deck archetype from game state evaluation patterns
   */
  private detectArchetype(
    currentEvaluation: DetailedEvaluation,
  ): DeckArchetype {
    const factors = currentEvaluation.factors;

    if (
      factors.cardAdvantage > 0.5 &&
      factors.tempoAdvantage < 0 &&
      factors.creatureCount < 3
    ) {
      return "control";
    }

    if (
      factors.tempoAdvantage > 0.3 &&
      factors.cardAdvantage < 0.3 &&
      factors.creatureCount >= 1 &&
      factors.creatureCount <= 4
    ) {
      return "tempo";
    }

    if (factors.creatureCount >= 5 && factors.tempoAdvantage > 0) {
      return "aggro";
    }

    if (factors.creatureCount >= 3 && factors.cardAdvantage >= 0) {
      return "midrange";
    }

    if (factors.winConditionProgress > 0.5) {
      return "combo";
    }

    return "unknown";
  }

  /**
   * Evaluate risk of passing priority
   */
  private evaluatePassRisk(
    context: StackContext,
    currentEvaluation: DetailedEvaluation,
  ): "low" | "medium" | "high" {
    let risk = 0;

    // Risk increases with threat level
    risk += this.assessActionThreat(context, currentEvaluation) * 0.4;

    // Risk if we're low on life
    if (currentEvaluation.factors.lifeScore < -0.5) {
      risk += 0.3;
    }

    // Risk if opponents have cards in hand
    const opponents = Object.values(this.gameState.players).filter(
      (p) => p.id !== this.playerId,
    );
    const avgOpponentHand =
      opponents.reduce((sum, p) => sum + p.hand.length, 0) / opponents.length;
    risk += avgOpponentHand * 0.05;

    // Risk if we're low on resources
    if (currentEvaluation.factors.cardAdvantage < -0.5) {
      risk += 0.2;
    }

    if (risk > 0.6) return "high";
    if (risk > 0.3) return "medium";
    return "low";
  }

  /**
   * Check if we should hold priority
   */
  private shouldHoldPriority(
    _response: AvailableResponse,
    context: StackContext,
    _currentEvaluation: DetailedEvaluation,
  ): boolean {
    // Hold priority if we might want to add more to the stack
    const hasOtherResponses = context.availableResponses.length > 1;

    // Hold if opponents might counter
    const opponentLikelyHasCounter = this.likelyOpponentCounterspell(context);

    // Hold if we're responding to a response (stack is building)
    const stackIsBuilding = context.stackSize > 2;

    return hasOtherResponses || opponentLikelyHasCounter || stackIsBuilding;
  }

  /**
   * Calculate mana remaining after using a response
   */
  private calculateManaRemaining(
    response: AvailableResponse,
    context: StackContext,
  ): number {
    let remaining = 0;

    for (const [color, amount] of Object.entries(context.availableMana)) {
      const cost = response.manaCost[color] || 0;
      remaining += Math.max(0, amount - cost);
    }

    return remaining;
  }

  /**
   * Check if response protects win condition
   */
  private protectsWinCondition(
    response: AvailableResponse,
    context: StackContext,
    currentEvaluation: DetailedEvaluation,
  ): boolean {
    // Check if the current action threatens our win condition
    const action = context.currentAction;
    const lowerName = action.name.toLowerCase();

    // If we're close to winning
    if (currentEvaluation.factors.winConditionProgress > 0.7) {
      // And the action disrupts that
      if (
        lowerName.includes("destroy") ||
        lowerName.includes("exile") ||
        lowerName.includes("counter")
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Find a permanent by ID
   */
  private findPermanent(permanentId: string): {
    id: string;
    controller: string;
    type: string;
    power?: number;
    keywords?: string[];
  } | null {
    for (const player of Object.values(this.gameState.players)) {
      const permanent = player.battlefield.find((p) => p.id === permanentId);
      if (permanent) return permanent;
    }
    return null;
  }

  /**
   * Get permanent importance (0-1)
   */
  private getPermanentImportance(permanent: {
    type: string;
    power?: number;
    keywords?: string[];
  }): number {
    let importance = 0.5;

    if (permanent.type === "planeswalker") importance += 0.3;
    if (permanent.type === "creature") {
      const power = permanent.power || 0;
      importance += Math.min(0.3, power / 10);
    }
    if (permanent.keywords && permanent.keywords.includes("hexproof"))
      importance += 0.1;

    return Math.min(1, importance);
  }

  /**
   * Calculate counterspell card advantage impact
   */
  private calculateCounterspellCardAdvantage(context: StackContext): number {
    const action = context.currentAction;
    const lowerName = action.name.toLowerCase();

    // Countering card draw is good
    if (lowerName.includes("draw")) return 0.5;

    // Countering threats is card advantage
    if (action.manaValue >= 4) return 0.3;

    return 0.1;
  }

  /**
   * Calculate counterspell tempo impact
   */
  private calculateCounterspellTempo(
    context: StackContext,
    counterspell: AvailableResponse,
  ): number {
    // Positive if we spend less than opponent spent
    return context.currentAction.manaValue - counterspell.manaValue;
  }

  /**
   * Calculate counterspell life impact
   */
  private calculateCounterspellLifeImpact(context: StackContext): number {
    const action = context.currentAction;
    const lowerName = action.name.toLowerCase();
    const player = this.gameState.players[this.playerId];

    // Check if this action targets us
    const targetsUs = action.targets?.some((t) => t.playerId === this.playerId);

    if (!targetsUs) {
      return 0;
    }

    // Preventing damage to ourselves - check for common damage spell patterns
    const isDamageSpell =
      lowerName.includes("damage") ||
      lowerName.includes("destroy") ||
      lowerName.includes("bolt") ||
      lowerName.includes("shock") ||
      lowerName.includes("strike") ||
      lowerName.includes("blast") ||
      lowerName.includes("burn") ||
      action.colors?.includes("red"); // Red spells often deal damage

    if (isDamageSpell) {
      // Higher impact if we're at low life (lethal threat)
      if (player && player.life <= 5) {
        return 1.0; // Lethal threat
      }
      return 0.5;
    }

    return 0;
  }

  /**
   * Calculate win condition disruption
   */
  private calculateWinConditionDisruption(
    context: StackContext,
    _currentEvaluation: DetailedEvaluation,
  ): number {
    const action = context.currentAction;

    // If action targets our important permanents
    if (action.targets) {
      for (const target of action.targets) {
        if (target.permanentId) {
          const permanent = this.findPermanent(target.permanentId);
          if (permanent && permanent.controller === this.playerId) {
            const importance = this.getPermanentImportance(permanent);
            if (importance > 0.7) return 0.8;
          }
        }
      }
    }

    return 0;
  }

  /**
   * Check if counterspell can be recurred
   */
  private canCounterspellBeRecurred(counterspell: AvailableResponse): boolean {
    const lowerName = counterspell.name.toLowerCase();
    return (
      lowerName.includes("snapcaster") ||
      lowerName.includes("recursion") ||
      lowerName.includes("flashback")
    );
  }

  /**
   * Check if we have backup counterspells
   */
  private hasBackupCounterspells(context: StackContext): boolean {
    const counterCount = context.availableResponses.filter((r) =>
      r.name.toLowerCase().includes("counter"),
    ).length;

    return counterCount > 1;
  }

  /**
   * Check if opponent likely has a counterspell
   */
  private likelyOpponentCounterspell(_context: StackContext): boolean {
    const opponents = Object.values(this.gameState.players).filter(
      (p) => p.id !== this.playerId,
    );

    for (const opponent of opponents) {
      // Check if opponent has cards in hand (uncertain what they are)
      if (opponent.hand.length > 2) {
        // In real game, we'd have more info here
        // For now, assume some chance
        return true;
      }
    }

    return false;
  }

  /**
   * Generate reasoning for response decision
   */
  private generateResponseReasoning(
    response: AvailableResponse,
    threatLevel: number,
    efficiency: number,
    expectedValue: number,
  ): string {
    const parts = [];

    parts.push(`${response.name} (efficiency: ${efficiency.toFixed(2)})`);

    if (threatLevel > 0.5) {
      parts.push("addresses significant threat");
    }

    if (expectedValue > 0.5) {
      parts.push("high expected value");
    }

    return parts.join("; ");
  }

  /**
   * Generate possible orderings of responses
   */
  private generateResponseOrderings(
    responses: AvailableResponse[],
  ): AvailableResponse[][] {
    // For now, just return a simple ordering
    // In a full implementation, we'd generate permutations
    return [responses];
  }

  /**
   * Evaluate the value of a specific ordering
   */
  private evaluateOrderingValue(
    ordering: AvailableResponse[],
    _context: StackContext | undefined,
  ): number {
    let totalValue = 0;
    let position = 0;

    for (const response of ordering) {
      const positionMultiplier = 1 - position * 0.1; // Earlier responses are worth more
      totalValue += response.effect.value * positionMultiplier;
      position++;
    }

    return totalValue;
  }

  /**
   * Check if we should hold for end step
   */
  private shouldHoldForEndStep(
    context: StackContext,
    _currentEvaluation: DetailedEvaluation,
  ): boolean {
    // Hold for end step if we have good instant-speed effects
    const goodInstants = context.availableResponses.filter(
      (r) =>
        (r.type === "instant" || r.type === "flash") && r.effect.value >= 5,
    );

    return goodInstants.length > 0 && context.isMyTurn;
  }

  /**
   * Check if we should hold for opponent's turn
   */
  private shouldHoldForOpponentTurn(
    context: StackContext,
    _currentEvaluation: DetailedEvaluation,
  ): boolean {
    // Hold interaction for opponent's turn when it's our turn
    // (after we pass, it becomes opponent's turn)
    const hasInteraction = context.availableResponses.some(
      (r) => r.type === "instant" || r.type === "flash",
    );

    // Hold for opponent's turn when it's currently our turn and we have opponents remaining
    return (
      hasInteraction &&
      context.isMyTurn &&
      context.opponentsRemaining.length > 0
    );
  }

  /**
   * Check if we should hold for a better threat
   */
  private shouldHoldForBetterThreat(
    context: StackContext,
    currentEvaluation: DetailedEvaluation,
  ): boolean {
    // If we're not under immediate pressure, hold for better targets
    const immediateThreats = currentEvaluation.threats.filter(
      (t: ThreatAssessment) => t.urgency === "immediate",
    );

    return (
      immediateThreats.length === 0 && context.availableResponses.length > 1
    );
  }

  /**
   * Find best instant response
   */
  private findBestInstantResponse(
    instants: AvailableResponse[],
    _context: StackContext,
  ): AvailableResponse | null {
    if (instants.length === 0) return null;

    // Sort by effect value
    instants.sort((a, b) => b.effect.value - a.effect.value);
    return instants[0];
  }

  /**
   * Evaluate optimal targets for multi-target spells
   * Evaluates which targets provide the best value for multi-target spells
   */
  evaluateMultiTargetResponse(
    response: AvailableResponse,
    context: StackContext,
  ): string[] {
    const availableTargets = response.canTarget || [];
    const maxTargets = response.targetCount || availableTargets.length;

    // Score each target by importance
    const scoredTargets = availableTargets.map((targetId) => ({
      targetId,
      score: this.scoreTarget(targetId),
    }));

    // Sort by score descending
    scoredTargets.sort((a, b) => b.score - a.score);

    // Return top N targets
    return scoredTargets.slice(0, maxTargets).map((t) => t.targetId);
  }

  /**
   * Score a target based on priority
   */
  private scoreTarget(targetId: string): number {
    const battlefield = (this.gameState as any).battlefield || [];
    const permanent = battlefield.find((p: any) => p.id === targetId);
    if (!permanent) return 0.3; // Player target or unknown

    let score = 0.5;

    // Creatures - higher score for threats
    if (permanent.type === "creature") {
      const power = permanent.power || 0;
      score += Math.min(0.4, power / 5);
      if (permanent.keywords?.includes("flying")) score += 0.1;
      if (permanent.keywords?.includes("trample")) score += 0.1;
    }

    // Planeswalkers - high priority
    if (permanent.type === "planeswalker") {
      score += 0.5;
      const loyalty = permanent.loyalty || 0;
      score += Math.min(0.2, loyalty / 5);
    }

    // Artifacts/Enchantments - moderate priority
    if (permanent.type === "artifact" || permanent.type === "enchantment") {
      score += 0.2;
    }

    return Math.min(1, score);
  }

  /**
   * Evaluate optimal X value or whether to kick a spell
   * Determines optimal cost for variable cost abilities (X spells, kicker)
   */
  evaluateVariableCost(
    response: AvailableResponse,
    context: StackContext,
  ): { xValue?: number; shouldKick?: boolean; recommendedCost: number } {
    const currentEvaluation = evaluateGameState(
      this.gameState,
      this.playerId,
      "medium",
    );
    const manaAvailable = this.calculateAvailableMana(context);

    // Default recommendations
    let recommendedCost = response.manaValue;
    let xValue: number | undefined;
    let shouldKick: boolean | undefined;

    // Handle X-cost spells
    if (response.hasXCost && manaAvailable > response.manaValue) {
      // Calculate optimal X based on threat level
      const threatLevel = this.assessActionThreat(context, currentEvaluation);

      // More X for higher threats
      const extraMana = manaAvailable - response.manaValue;
      xValue = Math.min(extraMana, Math.floor(threatLevel * 5));
      recommendedCost = response.manaValue + (xValue || 0);
    }

    // Handle kicker
    if (response.hasKicker && manaAvailable > response.manaValue + 1) {
      const threatLevel = this.assessActionThreat(context, currentEvaluation);
      // Kick for high threats or when we're winning
      shouldKick = threatLevel > 0.5 || currentEvaluation.totalScore > 1;
      if (shouldKick) {
        recommendedCost = response.manaValue + 1;
      }
    }

    return { xValue, shouldKick, recommendedCost };
  }

  /**
   * Calculate available mana for variable cost decisions
   */
  private calculateAvailableMana(context: StackContext): number {
    // Simplified mana calculation - in real implementation would check actual mana pool
    const player = this.gameState.players[this.playerId];
    return player ? (player as any).manaAvailable || 7 : 7;
  }

  /**
   * Evaluate which mode to choose for modal spells
   * Returns the recommended mode based on game state
   */
  evaluateModalChoice(
    response: AvailableResponse,
    choice: string,
    context: StackContext,
  ): number {
    const currentEvaluation = evaluateGameState(
      this.gameState,
      this.playerId,
      "medium",
    );

    // Score the choice based on game state
    let score = 0.5;

    const lowerChoice = choice.toLowerCase();
    const lowerName = response.name.toLowerCase();

    // "Destroy target creature" - good when we have creature threats
    if (lowerChoice.includes("destroy") && lowerChoice.includes("creature")) {
      const threats = currentEvaluation.threats.filter(
        (t: any) => t.type === "creature" && t.source === "opponent",
      );
      score += Math.min(0.4, threats.length * 0.15);
    }

    // "Counter target spell" - good for high threat spells
    if (lowerChoice.includes("counter")) {
      const threatLevel = this.assessActionThreat(context, currentEvaluation);
      score += threatLevel * 0.3;
    }

    // "Draw cards" - good when behind
    if (lowerChoice.includes("draw")) {
      if (currentEvaluation.factors.cardAdvantage < 0) {
        score += 0.3;
      }
    }

    // "Gain life" - good when at low life
    if (lowerChoice.includes("life") || lowerChoice.includes("life")) {
      const player = this.gameState.players[this.playerId];
      if (player && player.life <= 10) {
        score += 0.4;
      }
    }

    return Math.min(1, Math.max(0, score));
  }

  evaluateTriggerChains(context: StackContext): {
    chains: TriggerChain[];
    summary: string;
    shouldCounterToPrevent: boolean;
  } {
    const stackItem: CascadeContext["stackItem"] = {
      id: context.currentAction.id,
      name: context.currentAction.name,
      manaValue: context.currentAction.manaValue,
      controller: context.currentAction.controller,
      type: context.currentAction.type || "spell",
      colors: context.currentAction.colors || [],
      targets: context.currentAction.targets,
    };

    const board: BoardPermanent[] = [];

    for (const [pid, player] of Object.entries(this.gameState.players)) {
      if (player.battlefield) {
        for (const perm of player.battlefield) {
          board.push({
            id: perm.id || perm.cardInstanceId,
            name: perm.name,
            type: perm.type,
            controller: perm.controller || pid,
            oracleText: (perm as Record<string, unknown>).oracleText as string | undefined,
          });
        }
      }
    }

    const chains = evaluateTriggerChain(stackItem, board);
    const shouldCounter = shouldCounterToPreventTriggers(
      chains,
      context.currentAction.controller === this.playerId,
    );

    const highChain = getHighestValueChain(chains);
    let summary: string;
    if (chains.length === 0) {
      summary = "No trigger chains detected";
    } else {
      summary = `Detected ${chains.length} trigger chain(s)`;
      if (highChain) {
        summary += ` (highest value: ${highChain.totalValue.toFixed(1)} - ${highChain.steps.map(s => s.ability.abilityName).join(" → ")})`;
      }
    }

    return { chains, summary, shouldCounterToPrevent: shouldCounter };
  }

  assessActionThreatWithTriggers(context: StackContext): number {
    const currentEvaluation = evaluateGameState(
      this.gameState,
      this.playerId,
      "medium",
    );

    const baseThreat = this.assessActionThreat(context, currentEvaluation);

    const { chains, shouldCounterToPrevent } = this.evaluateTriggerChains(context);

    if (chains.length === 0) {
      return baseThreat;
    }

    const highChain = getHighestValueChain(chains);
    const cascadeThreatBonus = Math.min(0.5, (highChain?.totalValue || 0) * 0.1);

    const opponentController = context.currentAction.controller !== this.playerId;
    if (!opponentController) {
      return baseThreat;
    }

    const adjustedThreat = baseThreat + cascadeThreatBonus;
    return Math.min(1, adjustedThreat);
  }
}

/**
 * Convenience function to evaluate a stack response decision
 */
export function evaluateStackResponse(
  gameState: GameState,
  playerId: string,
  context: StackContext,
  difficulty: "easy" | "medium" | "hard" = "medium",
): ResponseDecision {
  const ai = new StackInteractionAI(gameState, playerId, difficulty);
  return ai.evaluateResponse(context);
}

/**
 * Convenience function to decide on a counterspell
 */
export function decideCounterspell(
  gameState: GameState,
  playerId: string,
  context: StackContext,
  counterspell: AvailableResponse,
  difficulty: "easy" | "medium" | "hard" = "medium",
): ResponseDecision {
  const ai = new StackInteractionAI(gameState, playerId, difficulty);
  return ai.decideCounterspell(context, counterspell);
}

/**
 * Convenience function to manage resources
 */
export function manageResponseResources(
  gameState: GameState,
  playerId: string,
  context: StackContext,
  difficulty: "easy" | "medium" | "hard" = "medium",
): ResourceDecision {
  const ai = new StackInteractionAI(gameState, playerId, difficulty);
  return ai.manageResources(context);
}

/**
 * Convenience function to evaluate a bluff hold decision
 */
export function shouldBluffHoldMana(
  gameState: GameState,
  playerId: string,
  context: StackContext,
  opponentHistory?: OpponentHistory,
  difficulty: "easy" | "medium" | "hard" = "medium",
): BluffHoldDecision {
  const ai = new StackInteractionAI(gameState, playerId, difficulty);
  const currentEvaluation = evaluateGameState(gameState, playerId, "medium");
  return ai.shouldBluffHoldMana(context, currentEvaluation, opponentHistory);
}
