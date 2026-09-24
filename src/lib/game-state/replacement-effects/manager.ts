import type {
  CardInstanceId,
  PlayerId,
  GameState,
  WaitingChoice,
  ChoiceOption,
} from "../types";
import {
  ReplacementEffectType,
  ReplacementAbility,
  AsThoughEffect,
  AsThoughType,
  ReplacementEventType,
  ReplacementEvent,
  PreventionShield,
  APNAPOrder,
  ReplacementProcessingOutcome,
  REPLACEMENT_CHOICE_TYPE,
} from "./types";
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
      const nonSelfEffects = possibleEffects.filter(
        (e) => !e.isSelfReplacement,
      );

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
      landEnterBattlefield: ["land_enter_replacement"],
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
