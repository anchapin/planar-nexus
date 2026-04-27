/**
 * @fileoverview Stack Dependency Analyzer
 *
 * Models how responses on the stack interact with each other.
 * Critical for correct response sequencing in complex multi-spell scenarios.
 */

import type { StackAction, StackContext } from './stack-interaction-ai';

/**
 * Represents a dependency relationship between stack items
 */
export interface StackDependency {
  dependsOn: string; // Stack action ID this depends on
  dependent: string; // Stack action ID that depends on this
  dependencyType: 'counters' | 'protects' | 'enhances' | 'enables' | 'invalidates';
  reason: string;
  strength: number; // 0-1, how critical the dependency is
}

/**
 * Result of stack dependency analysis
 */
export interface DependencyAnalysis {
  dependencies: StackDependency[];
  criticalPath: string[]; // Stack action IDs in resolution order
  canBeCountered: { [actionId: string]: boolean };
  shouldBeProtected: { [actionId: string]: boolean };
  riskAnalysis: {
    actionId: string;
    riskLevel: 'low' | 'medium' | 'high';
    riskReason: string;
  }[];
}

/**
 * Stack item with additional metadata for dependency tracking
 */
interface StackItem {
  action: StackAction;
  position: number; // 0 = bottom of stack, higher = top
  isResponse: boolean;
  targets?: string[];
}

/**
 * Analyze dependencies between items on the stack
 */
export function analyzeStackDependencies(stack: StackAction[]): DependencyAnalysis {
  if (stack.length === 0) {
    return {
      dependencies: [],
      criticalPath: [],
      canBeCountered: {},
      shouldBeProtected: {},
      riskAnalysis: [],
    };
  }

  const stackItems: StackItem[] = stack.map((action, index) => ({
    action,
    position: index,
    isResponse: isResponseAction(action),
    targets: extractTargets(action),
  }));

  const dependencies: StackDependency[] = [];
  const canBeCountered: { [actionId: string]: boolean } = {};
  const shouldBeProtected: { [actionId: string]: boolean } = {};
  const riskAnalysis: DependencyAnalysis['riskAnalysis'] = [];

  // Analyze each item for dependencies
  for (let i = 0; i < stackItems.length; i++) {
    const item = stackItems[i];

    // Check dependencies on items below (that will resolve first)
    for (let j = 0; j < i; j++) {
      const belowItem = stackItems[j];
      const dep = findDependency(belowItem, item);
      if (dep) {
        dependencies.push(dep);
      }
    }

    // Check if this item counters something below
    if (isCounterspell(item.action)) {
      const targetId = item.action.targets?.[0]?.permanentId ||
                       item.action.targets?.[0]?.cardId;
      if (targetId) {
        dependencies.push({
          dependsOn: targetId,
          dependent: item.action.id,
          dependencyType: 'counters',
          reason: `${item.action.name} counters ${targetId}`,
          strength: 0.9,
        });
      }
    }

    // Determine if this can be countered
    canBeCountered[item.action.id] = canActionBeCountered(item, stackItems);

    // Determine if this should be protected
    shouldBeProtected[item.action.id] = shouldActionBeProtected(item, stackItems);

    // Risk analysis
    riskAnalysis.push(analyzeActionRisk(item, stackItems));
  }

  // Build critical path (resolution order with dependencies)
  const criticalPath = buildCriticalPath(stackItems, dependencies);

  return {
    dependencies,
    criticalPath,
    canBeCountered,
    shouldBeProtected,
    riskAnalysis,
  };
}

/**
 * Check if an action is a response (instant/ability vs sorcery)
 */
function isResponseAction(action: StackAction): boolean {
  return action.isInstantSpeed || action.type === 'ability';
}

/**
 * Extract target IDs from an action
 */
function extractTargets(action: StackAction): string[] {
  const targets: string[] = [];
  if (action.targets) {
    for (const target of action.targets) {
      if (target.permanentId) targets.push(target.permanentId);
      if (target.cardId) targets.push(target.cardId);
      if (target.playerId) targets.push(target.playerId);
    }
  }
  return targets;
}

/**
 * Check if an action is a counterspell
 */
function isCounterspell(action: StackAction): boolean {
  const lowerName = action.name.toLowerCase();
  return lowerName.includes('counter') ||
         lowerName.includes('cancel') ||
         lowerName.includes('negate') ||
         lowerName.includes('void');
}

/**
 * Find a dependency between two stack items
 */
function findDependency(below: StackItem, above: StackItem): StackDependency | null {
  const belowAction = below.action;
  const aboveAction = above.action;

  // Above targets below's permanent/card/action ID
  if (above.targets?.includes(belowAction.id) ||
      above.targets?.includes(belowAction.cardId) ||
      above.action.targets?.some(t => t.cardId === belowAction.id || t.permanentId === belowAction.id)) {
    return {
      dependsOn: belowAction.id,
      dependent: aboveAction.id,
      dependencyType: 'targets',
      reason: `${aboveAction.name} targets ${belowAction.name}`,
      strength: 0.7,
    };
  }

  // Above protects below (e.g., Hexproof, Indestructible)
  if (isProtectiveSpell(aboveAction)) {
    // If the protection spell targets something below
    if (above.targets?.includes(belowAction.id) ||
        above.action.targets?.some(t => t.permanentId === belowAction.id)) {
      return {
        dependsOn: belowAction.id,
        dependent: aboveAction.id,
        dependencyType: 'protects',
        reason: `${aboveAction.name} protects ${belowAction.name}`,
        strength: 0.8,
      };
    }
  }

  // Above enhances below (e.g., +1/+1 counter, equipment)
  if (isEnhancementSpell(aboveAction)) {
    // If the enhancement targets something below
    if (above.targets?.includes(belowAction.id) ||
        above.action.targets?.some(t => t.permanentId === belowAction.id)) {
      return {
        dependsOn: belowAction.id,
        dependent: aboveAction.id,
        dependencyType: 'enhances',
        reason: `${aboveAction.name} enhances ${belowAction.name}`,
        strength: 0.5,
      };
    }
  }

  // Above enables below (e.g., untap, flash grant)
  if (isEnablingSpell(aboveAction)) {
    if (above.targets?.includes(belowAction.id) ||
        above.action.targets?.some(t => t.permanentId === belowAction.id)) {
      return {
        dependsOn: belowAction.id,
        dependent: aboveAction.id,
        dependencyType: 'enables',
        reason: `${aboveAction.name} enables ${belowAction.name}`,
        strength: 0.6,
      };
    }
  }

  return null;
}

/**
 * Check if a spell is protective
 */
function isProtectiveSpell(action: StackAction): boolean {
  const lowerName = action.name.toLowerCase();
  return lowerName.includes('hexproof') ||
         lowerName.includes('indestructible') ||
         lowerName.includes('protect') ||
         lowerName.includes('shield') ||
         lowerName.includes('ward') ||
         lowerName.includes('unscathed') ||
         lowerName.includes('blessing');
}

/**
 * Check if a spell is an enhancement
 */
function isEnhancementSpell(action: StackAction): boolean {
  const lowerName = action.name.toLowerCase();
  return lowerName.includes('+1/+1') ||
         lowerName.includes('equip') ||
         lowerName.includes('enchant') ||
         lowerName.includes('augment') ||
         lowerName.includes('boost') ||
         lowerName.includes('growth') ||
         lowerName.includes('giant') ||
         lowerName.includes('rancor');
}

/**
 * Check if a spell enables another
 */
function isEnablingSpell(action: StackAction): boolean {
  const lowerName = action.name.toLowerCase();
  return lowerName.includes('untap') ||
         lowerName.includes('flash') ||
         lowerName.includes('awaken') ||
         lowerName.includes('enable');
}

/**
 * Determine if an action can be countered
 */
function canActionBeCountered(item: StackItem, allItems: StackItem[]): boolean {
  // Counterspells can't be countered in many scenarios (especially if they're the top of stack)
  if (isCounterspell(item.action) && item.position === allItems.length - 1) {
    return false;
  }

  // Actions that have split second can't be responded to
  if (hasSplitSecond(item.action)) {
    return false;
  }

  // Actions with "can't be countered" in text
  if (isUncounterable(item.action)) {
    return false;
  }

  return true;
}

/**
 * Check if action has split second
 */
function hasSplitSecond(action: StackAction): boolean {
  const lowerName = action.name.toLowerCase();
  return lowerName.includes('split second');
}

/**
 * Check if action can't be countered
 */
function isUncounterable(action: StackAction): boolean {
  const lowerName = action.name.toLowerCase();
  return lowerName.includes("can't be countered") ||
         lowerName.includes('cannot be countered');
}

/**
 * Determine if an action should be protected
 */
function shouldActionBeProtected(item: StackItem, allItems: StackItem[]): boolean {
  // High mana value spells are worth protecting
  if (item.action.manaValue >= 5) {
    return true;
  }

  // Win conditions should be protected
  if (isWinCondition(item.action)) {
    return true;
  }

  // Spells that will be countered by something above should be protected
  const countersAbove = allItems.filter(other =>
    other.position > item.position && isCounterspell(other.action) &&
    other.targets?.includes(item.action.id)
  );
  if (countersAbove.length > 0) {
    return true;
  }

  return false;
}

/**
 * Check if action is a win condition
 */
function isWinCondition(action: StackAction): boolean {
  const lowerName = action.name.toLowerCase();
  return lowerName.includes('approach of the second sun') ||
         lowerName.includes('helix pinnacle') ||
         lowerName.includes('biovisionary') ||
         lowerName.includes('alternate win') ||
         lowerName.includes('lab maniac');
}

/**
 * Analyze risk level for an action
 */
function analyzeActionRisk(
  item: StackItem,
  allItems: StackItem[]
): DependencyAnalysis['riskAnalysis'][0] {
  let riskLevel: 'low' | 'medium' | 'high' = 'low';
  const reasons: string[] = [];

  // Check if it's being targeted above
  const targetingAbove = allItems.filter(other =>
    other.position > item.position &&
    other.targets?.includes(item.action.id)
  );
  if (targetingAbove.length > 0) {
    riskLevel = 'high';
    reasons.push(`targeted by ${targetingAbove.length} actions above`);
  }

  // Check if it's being countered
  const countersAbove = allItems.filter(other =>
    other.position > item.position &&
    isCounterspell(other.action) &&
    other.targets?.includes(item.action.id)
  );
  if (countersAbove.length > 0) {
    riskLevel = 'high';
    reasons.push('will be countered');
  }

  // High mana value without protection is risky
  if (item.action.manaValue >= 5 && !isUncounterable(item.action)) {
    if (riskLevel !== 'high') {
      riskLevel = 'medium';
    }
    reasons.push('high mana value, can be countered');
  }

  return {
    actionId: item.action.id,
    riskLevel,
    riskReason: reasons.join('; ') || 'no significant risk',
  };
}

/**
 * Build the critical path (optimal resolution order considering dependencies)
 */
function buildCriticalPath(
  items: StackItem[],
  dependencies: StackDependency[]
): string[] {
  // Create a dependency graph
  const graph: { [id: string]: string[] } = {};
  const inDegree: { [id: string]: number } = {};

  for (const item of items) {
    graph[item.action.id] = [];
    inDegree[item.action.id] = 0;
  }

  for (const dep of dependencies) {
    // dep.dependent depends on dep.dependsOn
    // So edge from dependsOn -> dependent
    if (graph[dep.dependsOn] && !graph[dep.dependsOn].includes(dep.dependent)) {
      graph[dep.dependsOn].push(dep.dependent);
      inDegree[dep.dependent]++;
    }
  }

  // Topological sort to find critical path
  const queue: string[] = [];
  for (const item of items) {
    if (inDegree[item.action.id] === 0) {
      queue.push(item.action.id);
    }
  }

  const criticalPath: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    criticalPath.push(current);

    for (const neighbor of graph[current] || []) {
      inDegree[neighbor]--;
      if (inDegree[neighbor] === 0) {
        queue.push(neighbor);
      }
    }
  }

  return criticalPath;
}

/**
 * Get recommended response action based on stack dependencies
 */
export function getRecommendedResponse(
  context: StackContext,
  dependencies: DependencyAnalysis
): {
  shouldRespond: boolean;
  targetActionId?: string;
  responseStrategy: 'counter_top' | 'counter_threat' | 'protect_own' | 'pass';
  reasoning: string;
} {
  const { currentAction, stackSize, actionsAbove } = context;

  // If there's a high-risk action we can counter
  const highRiskAction = dependencies.riskAnalysis.find(
    r => r.riskLevel === 'high' && dependencies.canBeCountered[r.actionId]
  );

  if (highRiskAction) {
    return {
      shouldRespond: true,
      targetActionId: highRiskAction.actionId,
      responseStrategy: 'counter_threat',
      reasoning: `Counter high-risk action: ${highRiskAction.riskReason}`,
    };
  }

  // If our action is being countered above
  const ourActionThreatened = dependencies.riskAnalysis.find(
    r => r.actionId === currentAction.id && r.riskLevel === 'high'
  );

  if (ourActionThreatened) {
    return {
      shouldRespond: true,
      responseStrategy: 'protect_own',
      reasoning: 'Our action is threatened, should respond to protect it',
    };
  }

  // If stack is deep and top action is a threat
  if (stackSize > 2 && actionsAbove.length > 0) {
    const topAction = actionsAbove[actionsAbove.length - 1];
    if (dependencies.canBeCountered[topAction.id]) {
      return {
        shouldRespond: true,
        targetActionId: topAction.id,
        responseStrategy: 'counter_top',
        reasoning: 'Counter top of stack to prevent it from resolving',
      };
    }
  }

  return {
    shouldRespond: false,
    responseStrategy: 'pass',
    reasoning: 'No immediate threat requiring response',
  };
}
