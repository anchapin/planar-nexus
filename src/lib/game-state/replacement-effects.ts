/**
 * Replacement and Prevention Effects System
 *
 * Implements MTG rules for replacement and prevention effects as described in CR 614-616.
 * - Replacement effects (CR 614.1): Modify how an event happens ("If X would happen, instead Y")
 * - Prevention effects (CR 614.2): Prevent damage, life loss, etc. from happening
 * - "As though" effects (CR 609): Allow players to ignore restrictions or follow different rules
 *
 * Key Rules:
 * - CR 614.5: Some effects replace damage with life loss or other outcomes
 * - CR 614.7: If an event is replaced, it never happens
 * - CR 614.9: Some effects say "instead" - these are replacement effects
 * - CR 614.10: Some effects say "prevent" - these are prevention effects
 * - CR 616: Multiple replacement/prevention effects use APNAP ordering
 *
 * @module replacement-effects
 */

import {
  CardInstanceId,
  PlayerId,
  GameState,
  WaitingChoice,
  ChoiceOption,
} from "./types";

/**
 * Types of replacement/prevention effects
 */
export type ReplacementEffectType =
  | "damage_replacement" // Replace damage with something else
  | "damage_prevention" // Prevent damage
  | "life_gain_replacement" // Modify life gain (e.g., double it)
  | "life_loss_replacement" // Modify life loss
  | "draw_replacement" // Replace card draw
  | "counter_movement" // Replace counter placement
  | "token_creation" // Modify token creation
  | "destroy_replacement" // Replace destruction (e.g., regenerate)
  | "exile_replacement" // Replace exile
  | "counters" // Add/remove counters
  | "as_though" // "As though" effects
  | "sacrifice_replacement" // Replace sacrifice
  | "command_zone_replacement"; // Commander redirect (CR 903.9)

/**
 * A replacement or prevention ability
 */
export interface ReplacementAbility {
  id: string;
  sourceCardId: CardInstanceId;
  controllerId: PlayerId;
  effectType: ReplacementEffectType;
  description: string;
  apply: (event: ReplacementEvent) => ReplacementResult;
  canApply: (event: ReplacementEvent) => boolean;
  layer: number;
  sublayer?: string;
  duration?: "until_end_of_turn" | "until_end_of_next_turn" | "permanent";
  preventionAmount?: number;
  timestamp: number;
  isSelfReplacement?: boolean;
  isInstead?: boolean;
}

/**
 * "As though" effect - allows a player to ignore restrictions or follow different rules
 * CR 609: "As Though"
 */
export interface AsThoughEffect {
  id: string;
  sourceCardId: CardInstanceId;
  controllerId: PlayerId;
  asThoughType: AsThoughType;
  description: string;
  condition?: (state: GameState, playerId: PlayerId) => boolean;
  duration?: "until_end_of_turn" | "permanent";
  timestamp: number;
}

export type AsThoughType =
  | "cast_flash"
  | "attack_haste"
  | "block_flying"
  | "play_land_anytime"
  | "spend_mana_any_color"
  | "target_anything"
  | "range_infinite"
  | "card_type_change";

export type ReplacementEventType =
  | "damage"
  | "life_gain"
  | "life_loss"
  | "draw_card"
  | "move_to_graveyard"
  | "exile"
  | "destroy"
  | "create_token"
  | "add_counter"
  | "remove_counter"
  | "sacrifice"
  | "tap"
  | "untap"
  | "put_into_hand" // CR 903.9a — commander bounced to hand
  | "put_into_library"; // CR 903.9a — commander shuffled into library

export interface ReplacementEvent {
  type: ReplacementEventType;
  timestamp: number;
  sourceId?: CardInstanceId;
  targetId?: CardInstanceId | PlayerId;
  amount: number;
  isCombatDamage?: boolean;
  damageTypes?: ("combat" | "noncombat" | "damage" | "lethal")[];
  hasLifelink?: boolean;
  hasDeathtouch?: boolean;
  context?: Record<string, unknown>;
}

export interface ReplacementResult {
  modified: boolean;
  modifiedEvent?: ReplacementEvent;
  description: string;
  instead?: boolean;
  skipEvent?: boolean;
}

export interface PreventionShield {
  sourceId: CardInstanceId;
  amount: number;
  damageTypes?: string[];
  expiresAt?: number;
  controllerId: PlayerId;
}

export interface APNAPOrder {
  activePlayerId: PlayerId;
  playerOrder: PlayerId[];
}

/** Waiting-choice discriminator for CR 616.1 replacement effect selection. */
export const REPLACEMENT_CHOICE_TYPE = "choose_replacement" as const;

/**
 * Result of a replacement-effect-processing pass.
 *
 * When `requiresChoice` is true, the caller should present a
 * `WaitingChoice` of type {@link REPLACEMENT_CHOICE_TYPE} to the player
 * identified by `affectedPlayerId` (CR 616.1 — the affected player or the
 * controller of the affected permanent chooses which replacement/prevention
 * effect applies). After the player picks, call
 * {@link ReplacementEffectManager.resolveReplacementChoice} with the picked
 * effect id and `appliedEffectIds` to resume processing.
 *
 * When `requiresChoice` is false, the resolved event in `event` is final and
 * should be applied to the game state directly.
 */
export interface ReplacementProcessingOutcome {
  event: ReplacementEvent;
  appliedEffects: ReplacementAbility[];
  requiresChoice: boolean;
  candidates?: ReplacementAbility[];
  affectedPlayerId?: PlayerId;
  /** True when the caller requested auto-resolution via the AI heuristic. */
  autoResolved?: boolean;
}

export class ReplacementEffectManager {
  private effects: ReplacementAbility[] = [];
  private asThoughEffects: AsThoughEffect[] = [];
  private preventionShields: Map<string, PreventionShield[]> = new Map();
  private currentTurn: number = 0;

  setCurrentTurn(turn: number): void {
    this.currentTurn = turn;
  }

  registerEffect(effect: ReplacementAbility): void {
    this.effects.push(effect);
    this.sortEffects();
  }

  registerAsThoughEffect(effect: AsThoughEffect): void {
    this.asThoughEffects.push(effect);
  }

  removeEffectsFromSource(sourceCardId: CardInstanceId): void {
    this.effects = this.effects.filter((e) => e.sourceCardId !== sourceCardId);
    this.asThoughEffects = this.asThoughEffects.filter(
      (e) => e.sourceCardId !== sourceCardId,
    );
    for (const [key, shields] of Array.from(this.preventionShields.entries())) {
      const validShields = shields.filter((s) => s.sourceId !== sourceCardId);
      if (validShields.length === 0) {
        this.preventionShields.delete(key);
      } else {
        this.preventionShields.set(key, validShields);
      }
    }
  }

  resetExpiredEffects(currentTime: number, turnNumber: number): void {
    this.currentTurn = turnNumber;
    for (const [key, shields] of Array.from(this.preventionShields.entries())) {
      const validShields = shields.filter(
        (s) => !s.expiresAt || s.expiresAt > currentTime,
      );
      if (validShields.length === 0) {
        this.preventionShields.delete(key);
      } else {
        this.preventionShields.set(key, validShields);
      }
    }
    this.asThoughEffects = this.asThoughEffects.filter(
      (e) => e.duration !== "until_end_of_turn",
    );
  }

  getPreventionShields(targetId: string | PlayerId): PreventionShield[] {
    return this.preventionShields.get(String(targetId)) || [];
  }

  addPreventionShield(
    targetId: string | PlayerId,
    shield: PreventionShield,
  ): void {
    const key = String(targetId);
    const existing = this.preventionShields.get(key) || [];
    existing.push(shield);
    this.preventionShields.set(key, existing);
  }

  usePreventionShield(targetId: string | PlayerId, amount: number): number {
    const key = String(targetId);
    const shields = this.preventionShields.get(key);
    if (!shields || shields.length === 0) return 0;

    let remaining = amount;
    const validShields: PreventionShield[] = [];

    for (const shield of shields) {
      if (remaining <= 0) {
        validShields.push({ ...shield });
        continue;
      }
      if (shield.amount >= remaining) {
        const newShield = { ...shield, amount: shield.amount - remaining };
        remaining = 0;
        if (newShield.amount > 0) validShields.push(newShield);
      } else {
        remaining -= shield.amount;
      }
    }

    if (validShields.length === 0) {
      this.preventionShields.delete(key);
    } else {
      this.preventionShields.set(key, validShields);
    }
    return amount - remaining;
  }

  processEvent(
    event: ReplacementEvent,
    apnapOrder?: APNAPOrder,
    maxIterations: number = 100,
  ): ReplacementEvent {
    let currentEvent = { ...event };
    const appliedEffectIds = new Set<string>();
    const eventTypeHistory: ReplacementEventType[] = [];
    let iterations = 0;
    let possibleEffects = this.getApplicableEffects(currentEvent);

    // CR 614.4: If replacement effects would create an infinite loop,
    // no effect of the replacement effect chain applies.
    // Detect cycles by checking if applying an effect would return us to
    // an event type we've already seen in this chain.
    while (possibleEffects.length > 0 && iterations < maxIterations) {
      iterations++;

      // Detect loop: check if any effect would change the event type back
      // to one we've already processed (creating a cycle)
      const loopDetected = this.wouldCreateLoop(
        possibleEffects,
        currentEvent,
        eventTypeHistory,
      );

      if (loopDetected) {
        // CR 614.4: No effects in this chain apply
        console.warn(
          `[ReplacementEffectManager] CR 614.4 loop detected after ${iterations} iterations. ` +
            `Event type history: ${eventTypeHistory.join(" -> ")}. ` +
            `Skipping all effects.`,
        );
        currentEvent.amount = 0;
        break;
      }

      const effectToApply = this.chooseBestEffect(
        possibleEffects,
        currentEvent,
        apnapOrder,
      );
      if (!effectToApply) break;

      // Record current event type before applying effect
      eventTypeHistory.push(currentEvent.type);

      const result = effectToApply.apply(currentEvent);
      if (result.modified && result.modifiedEvent) {
        currentEvent = { ...result.modifiedEvent };
        appliedEffectIds.add(effectToApply.id);
        if (result.skipEvent) {
          currentEvent.amount = 0;
          break;
        }
      }
      possibleEffects = this.getApplicableEffects(currentEvent).filter(
        (e) => !appliedEffectIds.has(e.id),
      );
    }

    if (iterations >= maxIterations) {
      console.warn(
        `[ReplacementEffectManager] Max iterations (${maxIterations}) reached in replacement effect processing. ` +
          `Event type history: ${eventTypeHistory.join(" -> ")}. ` +
          `This may indicate an undetected loop.`,
      );
    }

    if (
      currentEvent.type === "damage" &&
      currentEvent.amount > 0 &&
      currentEvent.targetId
    ) {
      const prevented = this.usePreventionShield(
        currentEvent.targetId,
        currentEvent.amount,
      );
      if (prevented > 0) currentEvent.amount -= prevented;
    }
    return currentEvent;
  }

  /**
   * CR 616.1 — Process a replacement event with explicit player choice.
   *
   * Mirrors {@link processEvent} but, whenever two or more non-self
   * replacement effects are simultaneously applicable, returns an
   * outcome with `requiresChoice = true` and a `candidates` list instead
   * of silently applying one. Self-replacement effects (CR 614.6 — the
   * source's own effects) are still applied without a choice because
   * they cannot meaningfully compete with each other on the same trigger.
   *
   * The caller is responsible for:
   *  - Building a {@link WaitingChoice} via
   *    {@link createReplacementWaitingChoice} when `requiresChoice`
   *    is true,
   *  - Either suspending until the affected player responds, or calling
   *    {@link autoResolveReplacementChoice} for AI / scripted controllers,
   *  - Resuming via {@link resolveReplacementChoice} with the picked
   *    effect id and the `appliedEffectIds` carried in
   *    `appliedEffects`.
   *
   * When the optional `context` argument carries a previously-applied
   * effect set (carried across a choice suspension), those effects are
   * excluded from the candidate pool so the chain resumes seamlessly.
   */
  processEventInteractive(
    event: ReplacementEvent,
    apnapOrder?: APNAPOrder,
    context?: {
      appliedEffectIds?: Set<string>;
      affectedPlayerId?: PlayerId;
      maxIterations?: number;
    },
  ): ReplacementProcessingOutcome {
    const appliedEffectIds = new Set<string>(
      context?.appliedEffectIds ?? new Set<string>(),
    );
    const affectedPlayerId =
      context?.affectedPlayerId ?? (event.targetId as PlayerId | undefined);
    const maxIterations = context?.maxIterations ?? 100;

    const appliedEffects: ReplacementAbility[] = [];
    let currentEvent = { ...event };
    const eventTypeHistory: ReplacementEventType[] = [];
    let iterations = 0;
    let possibleEffects = this.getApplicableEffects(currentEvent).filter(
      (e) => !appliedEffectIds.has(e.id),
    );

    while (possibleEffects.length > 0 && iterations < maxIterations) {
      iterations++;

      const loopDetected = this.wouldCreateLoop(
        possibleEffects,
        currentEvent,
        eventTypeHistory,
      );

      if (loopDetected) {
        console.warn(
          `[ReplacementEffectManager.processEventInteractive] CR 614.4 loop detected after ${iterations} iterations. ` +
            `Event type history: ${eventTypeHistory.join(" -> ")}. ` +
            `Skipping all effects.`,
        );
        currentEvent.amount = 0;
        break;
      }

      // Self-replacements always apply without prompting (CR 614.6).
      const selfEffects = possibleEffects.filter((e) => e.isSelfReplacement);
      const nonSelfEffects = possibleEffects.filter((e) => !e.isSelfReplacement);

      if (selfEffects.length > 0) {
        const selfSorted = [...selfEffects].sort(
          (a, b) => a.timestamp - b.timestamp,
        );
        for (const eff of selfSorted) {
          if (appliedEffectIds.has(eff.id)) continue;
          eventTypeHistory.push(currentEvent.type);
          const result = eff.apply(currentEvent);
          if (result.modified && result.modifiedEvent) {
            currentEvent = { ...result.modifiedEvent };
            appliedEffectIds.add(eff.id);
            appliedEffects.push(eff);
            if (result.skipEvent) {
              currentEvent.amount = 0;
              break;
            }
          }
        }
        possibleEffects = this.getApplicableEffects(currentEvent).filter(
          (e) => !appliedEffectIds.has(e.id),
        );
        continue;
      }

      // CR 616.1 — 2+ non-self replacement effects competing: surface
      // an interactive choice for the affected player / permanent
      // controller. Caller must present the WaitingChoice or call
      // autoResolveReplacementChoice, then resolveReplacementChoice.
      if (nonSelfEffects.length >= 2) {
        return {
          event: currentEvent,
          appliedEffects,
          requiresChoice: true,
          candidates: [...nonSelfEffects],
          affectedPlayerId,
        };
      }

      // Exactly one non-self effect — apply it and continue.
      const only = nonSelfEffects[0];
      eventTypeHistory.push(currentEvent.type);
      const result = only.apply(currentEvent);
      if (result.modified && result.modifiedEvent) {
        currentEvent = { ...result.modifiedEvent };
        appliedEffectIds.add(only.id);
        appliedEffects.push(only);
        if (result.skipEvent) {
          currentEvent.amount = 0;
          break;
        }
      }
      possibleEffects = this.getApplicableEffects(currentEvent).filter(
        (e) => !appliedEffectIds.has(e.id),
      );
    }

    if (iterations >= maxIterations) {
      console.warn(
        `[ReplacementEffectManager.processEventInteractive] Max iterations (${maxIterations}) reached. ` +
          `Event type history: ${eventTypeHistory.join(" -> ")}. ` +
          `This may indicate an undetected loop.`,
      );
    }

    if (
      currentEvent.type === "damage" &&
      currentEvent.amount > 0 &&
      currentEvent.targetId
    ) {
      const prevented = this.usePreventionShield(
        currentEvent.targetId,
        currentEvent.amount,
      );
      if (prevented > 0) currentEvent.amount -= prevented;
    }

    return {
      event: currentEvent,
      appliedEffects,
      requiresChoice: false,
      affectedPlayerId,
    };
  }

  /**
   * CR 616.1 — Return the non-self replacement effects that are
   * currently competing to apply to `event`. The affected player /
   * permanent controller chooses between them via
   * {@link resolveReplacementChoice} (human) or
   * {@link autoResolveReplacementChoice} (AI).
   *
   * Exposed so callers can build the candidate list (e.g., for UI
   * prompts) without invoking the full processing pipeline.
   */
  getCompetingReplacementEffects(
    event: ReplacementEvent,
    appliedEffectIds: Set<string> = new Set(),
  ): ReplacementAbility[] {
    const applicable = this.getApplicableEffects(event).filter(
      (e) => !appliedEffectIds.has(e.id),
    );
    const nonSelf = applicable.filter((e) => !e.isSelfReplacement);
    return nonSelf.length >= 2 ? nonSelf : [];
  }

  /**
   * CR 616.1 — Apply the player-picked candidate and continue
   * processing the remaining chain without re-prompting for the same
   * event.
   *
   * The `applied` array must include every effect already applied on a
   * previous iteration of the same event (so the picked effect cannot
   * fire twice and previously-applied self-replacements remain
   * applied). The returned outcome marks `autoResolved: false` and
   * carries the resumed event.
   */
  resolveReplacementChoice(
    pickedEffectId: string,
    context: {
      event: ReplacementEvent;
      applied: string[];
      affectedPlayerId?: PlayerId;
      apnapOrder?: APNAPOrder;
      maxIterations?: number;
    },
  ): ReplacementProcessingOutcome {
    const appliedIds = new Set<string>(context.applied);

    const candidates = this.getApplicableEffects(context.event).filter(
      (e) => !appliedIds.has(e.id) && !e.isSelfReplacement,
    );

    if (candidates.length < 2) {
      // Caller invoked resolveReplacementChoice without an actual
      // competition — fall back to interactive processing so behaviour
      // remains well-defined (no silent skip, deterministic outcome).
      return this.processEventInteractive(context.event, context.apnapOrder, {
        appliedEffectIds: appliedIds,
        affectedPlayerId: context.affectedPlayerId,
        maxIterations: context.maxIterations,
      });
    }

    const picked = candidates.find((e) => e.id === pickedEffectId);
    if (!picked) {
      throw new Error(
        `[ReplacementEffectManager.resolveReplacementChoice] ${pickedEffectId} is not in the candidate set: ` +
          `${candidates.map((c) => c.id).join(", ")}`,
      );
    }

    const appliedEffects: ReplacementAbility[] = [];
    let currentEvent = { ...context.event };
    appliedIds.add(picked.id);
    appliedEffects.push(picked);

    const result = picked.apply(currentEvent);
    if (result.modified && result.modifiedEvent) {
      currentEvent = { ...result.modifiedEvent };
      if (result.skipEvent) currentEvent.amount = 0;
    }

    if (currentEvent.amount > 0) {
      const continuation = this.processEventInteractive(
        currentEvent,
        context.apnapOrder,
        {
          appliedEffectIds: appliedIds,
          affectedPlayerId: context.affectedPlayerId,
          maxIterations: context.maxIterations,
        },
      );
      appliedEffects.push(...continuation.appliedEffects);
      currentEvent = { ...continuation.event };
      return {
        event: currentEvent,
        appliedEffects,
        requiresChoice: continuation.requiresChoice,
        candidates: continuation.candidates,
        affectedPlayerId: continuation.affectedPlayerId,
        autoResolved: false,
      };
    }

    return {
      event: currentEvent,
      appliedEffects,
      requiresChoice: false,
      affectedPlayerId: context.affectedPlayerId,
      autoResolved: false,
    };
  }

  /**
   * CR 616.1 — Deterministic AI heuristic for picking one replacement
   * effect from a competing candidate set.
   *
   * Tiebreaker order:
   *  1. Self-replacements (defensive — should not be in non-self set,
   *     but they're cheapest if a caller mis-classifies an effect).
   *  2. The affected player's own effects (the most natural CR 616.1
   *     interpretation: the player who is being targeted picks one of
   *     their own replacement effects first).
   *  3. APNAP order (active player last by default; both candidates
   *     already pass through this filter).
   *  4. Lower layer first (CR 614.5 — modification layer).
   *  5. Earliest timestamp first.
   *
   * The heuristic is purely deterministic so an AI controller reaches
   * the same decision every time on an identical game state, which
   * matters for replay determinism and event sourcing.
   */
  autoResolveReplacementChoice(
    candidates: ReplacementAbility[],
    affectedPlayerId: PlayerId,
    apnapOrder?: APNAPOrder,
  ): string {
    if (candidates.length === 0) {
      throw new Error(
        "[ReplacementEffectManager.autoResolveReplacementChoice] empty candidate set",
      );
    }
    const sorted = [...candidates].sort((a, b) => {
      if (a.isSelfReplacement && !b.isSelfReplacement) return -1;
      if (!a.isSelfReplacement && b.isSelfReplacement) return 1;
      if (
        a.controllerId === affectedPlayerId &&
        b.controllerId !== affectedPlayerId
      )
        return -1;
      if (
        b.controllerId === affectedPlayerId &&
        a.controllerId !== affectedPlayerId
      )
        return 1;
      if (apnapOrder) {
        const aIndex = apnapOrder.playerOrder.indexOf(a.controllerId);
        const bIndex = apnapOrder.playerOrder.indexOf(b.controllerId);
        if (aIndex !== -1 && bIndex !== -1 && aIndex !== bIndex)
          return aIndex - bIndex;
      }
      if (a.layer !== b.layer) return a.layer - b.layer;
      return a.timestamp - b.timestamp;
    });
    return sorted[0].id;
  }

  /**
   * Build a {@link WaitingChoice} prompting the affected player to
   * pick one of the supplied competing replacement effects.
   * Used by callers when {@link processEventInteractive} returns
   * `requiresChoice: true`.
   */
  createReplacementWaitingChoice(
    candidates: ReplacementAbility[],
    affectedPlayerId: PlayerId,
    prompt?: string,
  ): WaitingChoice {
    const options: ChoiceOption[] = candidates.map((effect) => ({
      label: effect.description,
      value: effect.id,
      isValid: true,
    }));
    return {
      type: REPLACEMENT_CHOICE_TYPE,
      playerId: affectedPlayerId,
      stackObjectId: null,
      prompt:
        prompt ??
        (candidates.length === 1
          ? `Apply replacement effect: ${candidates[0].description}?`
          : "Multiple replacement effects could apply. Choose one:"),
      choices: options,
      minChoices: 1,
      maxChoices: 1,
      presentedAt: Date.now(),
    };
  }

  /**
   * CR 614.4: Detect if applying any of the possible effects would create
   * an infinite replacement loop.
   *
   * A loop occurs when an effect changes the event type to one that
   * already exists in our event type history, creating a cycle.
   *
   * Example: destroy -> exile -> destroy (loop back to destroy)
   *
   * Note: Effects that don't change the event type (e.g., damage doubling)
   * do NOT create loops - only actual type changes cause loops.
   * The appliedEffectIds tracking and maxIterations cap handle other cases.
   */
  private wouldCreateLoop(
    possibleEffects: ReplacementAbility[],
    currentEvent: ReplacementEvent,
    eventTypeHistory: ReplacementEventType[],
  ): boolean {
    if (eventTypeHistory.length === 0) return false;

    const currentType = currentEvent.type;

    for (const effect of possibleEffects) {
      const result = effect.apply(currentEvent);

      if (result.modified && result.modifiedEvent) {
        const newType = result.modifiedEvent.type;

        if (newType !== currentType && eventTypeHistory.includes(newType)) {
          return true;
        }
      }
    }

    return false;
  }

  private getApplicableEffects(event: ReplacementEvent): ReplacementAbility[] {
    return this.effects.filter((e) => {
      const typeMatches = this.effectTypeMatches(e.effectType, event.type);
      return typeMatches && e.canApply(event);
    });
  }

  private chooseBestEffect(
    effects: ReplacementAbility[],
    event: ReplacementEvent,
    apnapOrder?: APNAPOrder,
  ): ReplacementAbility | null {
    if (effects.length === 0) return null;
    const sorted = [...effects].sort((a, b) => {
      if (a.isSelfReplacement && !b.isSelfReplacement) return -1;
      if (!a.isSelfReplacement && b.isSelfReplacement) return 1;
      if (apnapOrder && event.targetId) {
        const aIndex = apnapOrder.playerOrder.indexOf(a.controllerId);
        const bIndex = apnapOrder.playerOrder.indexOf(b.controllerId);
        if (aIndex !== -1 && bIndex !== -1 && aIndex !== bIndex)
          return aIndex - bIndex;
      }
      if (a.layer !== b.layer) return a.layer - b.layer;
      return a.timestamp - b.timestamp;
    });
    return sorted[0];
  }

  private effectTypeMatches(
    effectType: ReplacementEffectType,
    eventType: ReplacementEventType,
  ): boolean {
    const mapping: Record<ReplacementEventType, ReplacementEffectType[]> = {
      damage: ["damage_replacement", "damage_prevention"],
      life_gain: ["life_gain_replacement"],
      life_loss: ["life_loss_replacement"],
      draw_card: ["draw_replacement"],
      move_to_graveyard: ["destroy_replacement", "command_zone_replacement"],
      exile: ["exile_replacement", "command_zone_replacement"],
      destroy: ["destroy_replacement", "command_zone_replacement"],
      create_token: ["token_creation"],
      add_counter: ["counter_movement", "counters"],
      remove_counter: ["counters"],
      sacrifice: ["sacrifice_replacement"],
      tap: [],
      untap: [],
      put_into_hand: ["command_zone_replacement"],
      put_into_library: ["command_zone_replacement"],
    };
    return mapping[eventType]?.includes(effectType) || false;
  }

  checkAsThoughEffect(
    playerId: PlayerId,
    asThoughType: AsThoughType,
    gameState: GameState,
  ): boolean {
    return this.asThoughEffects.some(
      (effect) =>
        effect.controllerId === playerId &&
        effect.asThoughType === asThoughType &&
        (!effect.condition || effect.condition(gameState, playerId)),
    );
  }

  getAsThoughEffects(
    playerId: PlayerId,
    gameState: GameState,
  ): AsThoughEffect[] {
    return this.asThoughEffects.filter(
      (effect) =>
        effect.controllerId === playerId &&
        (!effect.condition || effect.condition(gameState, playerId)),
    );
  }

  private sortEffects(): void {
    this.effects.sort((a, b) => {
      if (a.isSelfReplacement && !b.isSelfReplacement) return -1;
      if (!a.isSelfReplacement && b.isSelfReplacement) return 1;
      if (a.layer !== b.layer) return a.layer - b.layer;
      return a.timestamp - b.timestamp;
    });
  }

  createAPNAPOrder(
    activePlayerId: PlayerId,
    allPlayerIds: PlayerId[],
  ): APNAPOrder {
    const activeIndex = allPlayerIds.indexOf(activePlayerId);
    if (activeIndex === -1)
      return { activePlayerId, playerOrder: allPlayerIds };
    const playerOrder = [
      activePlayerId,
      ...allPlayerIds.slice(activeIndex + 1),
      ...allPlayerIds.slice(0, activeIndex),
    ];
    return { activePlayerId, playerOrder };
  }

  reset(): void {
    this.effects = [];
    this.asThoughEffects = [];
    this.preventionShields.clear();
    this.currentTurn = 0;
  }
}

// Factory Functions

export function createPreventionShield(
  sourceCardId: CardInstanceId,
  controllerId: PlayerId,
  targetId: string | PlayerId,
  amount: number,
  description: string,
  duration?: "until_end_of_turn" | "until_end_of_next_turn" | "permanent",
  damageTypes?: string[],
): { ability: ReplacementAbility; shield: PreventionShield } {
  const timestamp = Date.now();
  const ability: ReplacementAbility = {
    id: `prevent-${sourceCardId}-${timestamp}`,
    sourceCardId,
    controllerId,
    effectType: "damage_prevention",
    description,
    layer: 1,
    timestamp,
    duration,
    preventionAmount: amount,
    canApply: (e) =>
      e.type === "damage" &&
      e.targetId === targetId &&
      (!damageTypes ||
        !e.damageTypes ||
        e.damageTypes.some((t) => damageTypes.includes(t))),
    apply: () => ({
      modified: false,
      description: "Prevention shield will apply",
    }),
  };
  const shield: PreventionShield = {
    sourceId: sourceCardId,
    amount,
    damageTypes,
    controllerId,
    expiresAt:
      duration === "until_end_of_turn" ? timestamp + 300000 : undefined,
  };
  return { ability, shield };
}

export function createDamageReplacementEffect(
  sourceCardId: CardInstanceId,
  controllerId: PlayerId,
  description: string,
  replacementFn: (amount: number, event: ReplacementEvent) => number,
  layer: number = 5,
  isSelfReplacement: boolean = false,
): ReplacementAbility {
  return {
    id: `dmg-replace-${sourceCardId}-${Date.now()}`,
    sourceCardId,
    controllerId,
    effectType: "damage_replacement",
    description,
    layer,
    timestamp: Date.now(),
    isSelfReplacement,
    isInstead: true,
    canApply: (e) => e.type === "damage",
    apply: (e) => ({
      modified: true,
      modifiedEvent: { ...e, amount: replacementFn(e.amount, e) },
      description,
      instead: true,
    }),
  };
}

export function createLifeGainReplacementEffect(
  sourceCardId: CardInstanceId,
  controllerId: PlayerId,
  description: string,
  replacementFn: (amount: number, event: ReplacementEvent) => number,
  targetFilter?: (targetId: PlayerId | CardInstanceId | undefined) => boolean,
): ReplacementAbility {
  return {
    id: `life-replace-${sourceCardId}-${Date.now()}`,
    sourceCardId,
    controllerId,
    effectType: "life_gain_replacement",
    description,
    layer: 5,
    timestamp: Date.now(),
    isInstead: true,
    canApply: (e) =>
      e.type === "life_gain" && (!targetFilter || targetFilter(e.targetId)),
    apply: (e) => ({
      modified: true,
      modifiedEvent: { ...e, amount: replacementFn(e.amount, e) },
      description,
      instead: true,
    }),
  };
}

export function createLifeLossReplacementEffect(
  sourceCardId: CardInstanceId,
  controllerId: PlayerId,
  description: string,
  replacementFn: (amount: number, event: ReplacementEvent) => number,
  targetFilter?: (targetId: PlayerId | CardInstanceId | undefined) => boolean,
): ReplacementAbility {
  return {
    id: `loss-replace-${sourceCardId}-${Date.now()}`,
    sourceCardId,
    controllerId,
    effectType: "life_loss_replacement",
    description,
    layer: 5,
    timestamp: Date.now(),
    isInstead: true,
    canApply: (e) =>
      e.type === "life_loss" && (!targetFilter || targetFilter(e.targetId)),
    apply: (e) => ({
      modified: true,
      modifiedEvent: { ...e, amount: replacementFn(e.amount, e) },
      description,
      instead: true,
    }),
  };
}

export function createDrawReplacementEffect(
  sourceCardId: CardInstanceId,
  controllerId: PlayerId,
  description: string,
  replacementFn: (amount: number, event: ReplacementEvent) => number,
): ReplacementAbility {
  return {
    id: `draw-replace-${sourceCardId}-${Date.now()}`,
    sourceCardId,
    controllerId,
    effectType: "draw_replacement",
    description,
    layer: 5,
    timestamp: Date.now(),
    isInstead: true,
    canApply: (e) => e.type === "draw_card",
    apply: (e) => ({
      modified: true,
      modifiedEvent: { ...e, amount: replacementFn(e.amount, e) },
      description,
      instead: true,
    }),
  };
}

export function createDestroyReplacementEffect(
  sourceCardId: CardInstanceId,
  controllerId: PlayerId,
  description: string,
  replacementFn: (event: ReplacementEvent) => ReplacementEvent | null,
  targetFilter?: (targetId: PlayerId | CardInstanceId | undefined) => boolean,
): ReplacementAbility {
  return {
    id: `destroy-replace-${sourceCardId}-${Date.now()}`,
    sourceCardId,
    controllerId,
    effectType: "destroy_replacement",
    description,
    layer: 3,
    timestamp: Date.now(),
    isInstead: true,
    canApply: (e) =>
      (e.type === "destroy" || e.type === "move_to_graveyard") &&
      (!targetFilter || targetFilter(e.targetId)),
    apply: (e) => {
      const modified = replacementFn(e);
      return modified
        ? {
            modified: true,
            modifiedEvent: modified,
            description,
            instead: true,
          }
        : { modified: false, description: "Cannot apply" };
    },
  };
}

/**
 * CR 903.9a — Commander Zone Replacement Effect
 *
 * Builds a self-replacement effect (CR 614.6) that fires whenever the named
 * commander would be put into its owner's hand, graveyard, exile, or library.
 * The affected owner decides whether to let the effect fire (CR 903.9a — "that
 * player may instead put it into the command zone"), and the replacement is
 * applied with APNAP ordering in favour of the commander owner
 * (`isSelfReplacement: true` makes CR 614.6 route the owner's effect through
 * before any competing non-self replacement can run).
 *
 * IMPORTANT — the effect carries the redirection intent via the event's
 * `context.replacedToCommandZone = true` flag and stamps `commandZoneOwnerId`
 * so callers can move the card to the command zone instead of performing the
 * original zone change. The ReplacementEffectManager itself does NOT mutate
 * game zones (it only rewrites the event); the integrator (state-based
 * actions, moveCardToZone, destroyCard, etc.) is responsible for honouring the
 * flag. See {@link resolveCommanderZoneRedirect} for the helper that performs
 * the actual move.
 */
export function createCommandZoneReplacementEffect(
  commanderCardId: CardInstanceId,
  ownerId: PlayerId,
  fromZone?: string,
): ReplacementAbility {
  const eventTypes: ReplacementEventType[] = [
    "destroy",
    "move_to_graveyard",
    "exile",
    "put_into_hand",
    "put_into_library",
  ];
  return {
    id: `cmdr-zone-replace-${commanderCardId}-${Date.now()}`,
    sourceCardId: commanderCardId,
    controllerId: ownerId,
    effectType: "command_zone_replacement",
    description: "Commander redirects to command zone (CR 903.9)",
    layer: 3,
    timestamp: Date.now(),
    isSelfReplacement: true,
    isInstead: true,
    canApply: (e) =>
      eventTypes.includes(e.type) &&
      (e.sourceId === commanderCardId || e.targetId === commanderCardId) &&
      (!fromZone ||
        (typeof e.context?.fromZone === "string" &&
          e.context.fromZone === fromZone)),
    apply: (e) => ({
      modified: true,
      modifiedEvent: {
        ...e,
        amount: 0,
        type: "tap",
        context: {
          ...(e.context ?? {}),
          replacedToCommandZone: true,
          commandZoneOwnerId: ownerId,
          originalCardId: commanderCardId,
          originalEventType: e.type,
        },
      },
      description: `Commander ${commanderCardId} redirected to command zone (CR 903.9)`,
      instead: true,
    }),
  };
}

/**
 * CR 903.9a — Helper for downstream callers (state-based-actions, destroyCard,
 * moveCardToZone, etc.). Inspects the processed {@link ReplacementEvent} and,
 * if the commander zone replacement redirected the event, performs the
 * commander-zone move and returns the new state. Returns `null` when no
 * commander redirect applies so callers fall through to the original zone
 * change.
 *
 * The caller must supply the active {@link GameState} and a `moveFn` capable
 * of moving the card to the command zone (e.g. `moveCardToZone`). This shape
 * keeps the replacement-effect module free of zone-mutation logic.
 */
export interface CommanderZoneRedirectOutcome {
  state: GameState;
  redirected: true;
  originalEventType: ReplacementEventType;
  ownerId: PlayerId;
  originalCardId: CardInstanceId;
}

export function resolveCommanderZoneRedirect<
  T extends { state: GameState; success?: boolean },
>(
  event: ReplacementEvent,
  state: GameState,
  moveFn: (state: GameState, cardId: CardInstanceId) => T,
): CommanderZoneRedirectOutcome | null {
  const ctx = event.context as Record<string, unknown> | undefined;
  if (!ctx || ctx.replacedToCommandZone !== true) return null;
  const commanderCardId = (ctx.originalCardId as CardInstanceId) ??
    (event.sourceId as CardInstanceId) ??
    (event.targetId as CardInstanceId);
  const ownerId = ctx.commandZoneOwnerId as PlayerId;
  const originalEventType = ctx.originalEventType as ReplacementEventType;
  if (!commanderCardId || !ownerId) return null;
  const result = moveFn(state, commanderCardId);
  return {
    state: result.state,
    redirected: true,
    originalEventType,
    ownerId,
    originalCardId: commanderCardId,
  };
}

export function createAsThoughEffect(
  sourceCardId: CardInstanceId,
  controllerId: PlayerId,
  asThoughType: AsThoughType,
  description: string,
  condition?: (state: GameState, playerId: PlayerId) => boolean,
  duration?: "until_end_of_turn" | "permanent",
): AsThoughEffect {
  return {
    id: `as-though-${sourceCardId}-${Date.now()}`,
    sourceCardId,
    controllerId,
    asThoughType,
    description,
    condition,
    duration,
    timestamp: Date.now(),
  };
}
