/**
 * Stack resolution (CR 608): resolving the top stack object, spell/clone completion, copy handling, stack removal.
 *
 * Mechanically extracted from spell-casting.ts (issue #1725);
 * behavior pinned by the existing engine suites.
 */
import type { GameState, CardInstanceId, StackObject, Target } from '../types';
import { ZoneType } from '../types';
import { moveCardBetweenZones } from '../zones';
import { initializePlaneswalkerLoyalty } from '../card-instance';
import { checkTriggeredAbilities, evaluateInterveningIfClause } from '../abilities';
import { destroyCard, createTokenCard } from '../keyword-actions';
import { resolveStackObjectEffects, parseSpellEffects, getEffectsForChosenModes } from '../effect-resolution';
import { applyWardResolution } from '../ward-system';
import { applyMutate } from '../mutate';
import { destroysIndestructibleCreatures, executeBoardSweeper, isBoardSweeper } from './board-sweepers';
import { generateStackObjectId } from './cast';

/**
 * Copy a spell on the stack (CR 707.10).
 *
 * Foundational primitive used by Storm (CR 702.41) and by general "copy target
 * spell" effects (e.g. Twincast, Reverberate, Lithoform Engine). Creates a NEW
 * spell on the stack, on top of the original, sharing the original's
 * characteristics — name, oracle text, mana cost, chosen modes, X values,
 * controller, split second/storm markers, and structured effects — with no cost
 * paid (CR 707.10). The copy RETAINS the original's targets by default (CR
 * 707.10c); pass `newTargets` to reselect them (CR 707.10d).
 *
 * A copy is not "cast" (CR 707.10), so it does NOT increment the storm count
 * and does NOT trigger "when you cast" abilities — only `castSpell` does. On
 * resolution a permanent copy becomes a token and an instant/sorcery copy
 * ceases to exist (see `resolveCopyCompletion`).
 *
 * @returns the new copy's stack object id on success.
 */
export function copySpellOnStack(
  state: GameState,
  sourceStackObjectId: string,
  newTargets?: Target[],
): {
  success: boolean;
  state: GameState;
  copiedStackObjectId?: string;
  error?: string;
} {
  const sourceIndex = state.stack.findIndex(
    (o) => o.id === sourceStackObjectId,
  );
  if (sourceIndex === -1) {
    return {
      success: false,
      state,
      error: "Source spell not found on the stack.",
    };
  }
  const source = state.stack[sourceIndex];
  if (source.type !== "spell") {
    return {
      success: false,
      state,
      error: "Only spells (not abilities) can be copied (CR 707.10).",
    };
  }

  // CR 707.10 — copy the spell's characteristics. Targets default to the
  // original's (707.10c) and may be overridden (707.10d). `isCopy` marks the
  // object so resolution knows not to move a card and to create a token for
  // permanents instead. `manaCost` is a characteristic and is copied (the "no
  // cost paid" rule means only that the copy is never paid for, not that the
  // value differs). `sourceCardId` is retained so the copy's oracle text / type
  // line can still be looked up during effect resolution.
  //
  // CR 702.138 (Escape) — `alternativeCostsUsed` is copied verbatim, so a
  // copy of an escaped spell also records "escape". This is intentional for
  // introspection / replay, but it MUST NOT cause the copy to re-exile N
  // graveyard cards: cost payments happen only in `castSpell`, which this
  // function is not. Likewise, on resolution the copy goes through
  // `resolveCopyCompletion` (because `isCopy === true`) and simply ceases
  // to exist — no card is moved to exile, no second exile cost is assessed.
  const copy: StackObject = {
    id: generateStackObjectId(),
    type: "spell",
    sourceCardId: source.sourceCardId,
    controllerId: source.controllerId,
    name: source.name,
    text: source.text,
    manaCost: source.manaCost,
    targets: newTargets
      ? newTargets.map((t) => ({ ...t }))
      : source.targets.map((t) => ({ ...t })),
    chosenModes: [...source.chosenModes],
    variableValues: new Map(source.variableValues),
    isCountered: false,
    timestamp: Date.now(),
    alternativeCostsUsed: source.alternativeCostsUsed
      ? [...source.alternativeCostsUsed]
      : undefined,
    wasKicked: source.wasKicked,
    timesKicked: source.timesKicked,
    splitSecond: source.splitSecond,
    storm: source.storm,
    isCopy: true,
    effects: source.effects,
  };

  return {
    success: true,
    copiedStackObjectId: copy.id,
    state: {
      ...state,
      stack: [...state.stack, copy],
      lastModifiedAt: Date.now(),
    },
  };
}

/**
 * Resolve the top object on the stack
 * CR 608 - Resolving Spells and Abilities
 */
export function resolveTopOfStack(state: GameState): GameState {
  if (state.stack.length === 0) {
    return state;
  }

  // Get the top object (last one added resolves first - LIFO)
  const stackObject = state.stack[state.stack.length - 1];

  // If it's countered, just remove it
  if (stackObject.isCountered) {
    return removeFromStack(state, stackObject.id);
  }

  // Ward (CR 702.21): if this spell/ability targets a warded permanent an
  // opponent controls and the ward cost was not paid, it is countered (removed
  // from the stack with no effect). This is enforced here, before resolution.
  const wardResult = applyWardResolution(state, stackObject);
  if (wardResult.countered) {
    return removeFromStack(state, stackObject.id);
  }

  // CR 603.4 — intervening "if" clause re-check at resolution. A triggered
  // ability ("When/Whenever/At X, if Y, Z") only triggers when Y is true at the
  // trigger event, AND when it would resolve Y is checked again: if it is no
  // longer true the ability is removed from the stack and does nothing. The
  // clause was carried onto the StackObject when the trigger was put on the
  // stack; re-evaluate it against the current (resolution-time) game state.
  if (stackObject.type === "ability" && stackObject.interveningIf) {
    const sourceCard = stackObject.sourceCardId
      ? state.cards.get(stackObject.sourceCardId)
      : undefined;
    if (
      !evaluateInterveningIfClause(
        stackObject.interveningIf,
        state,
        stackObject.controllerId,
        sourceCard,
      )
    ) {
      return removeFromStack(state, stackObject.id);
    }
  }

  let currentState = state;

  // CR 702.85 — number of additional effects owed to the kicker / multikicker
  // cost. Single-kicker stamps `timesKicked = 1` when paid; multikicker stamps
  // any non-negative integer. Non-kicker spells and spells cast without paying
  // the kicker cost leave `timesKicked` undefined / 0, so the bonus is a no-op.
  const kickerBonus = stackObject.timesKicked ?? 0;

  // Handle structured effects if present
  if (stackObject.effects && stackObject.effects.length > 0) {
    // Resolve each effect in order
    const result = resolveStackObjectEffects(
      state,
      stackObject.effects,
      stackObject.sourceCardId || undefined,
      stackObject.targets,
      kickerBonus,
    );
    currentState = result;
  }

  // Check if this is a board sweeper spell (legacy string-based check)
  if (stackObject.type === "spell" && stackObject.sourceCardId) {
    const sourceCard = currentState.cards.get(stackObject.sourceCardId);
    if (sourceCard) {
      const oracleText = sourceCard.cardData.oracle_text || "";

      // Handle board sweeper spells
      if (isBoardSweeper(oracleText)) {
        const ignoreIndestructible =
          destroysIndestructibleCreatures(oracleText);
        const stateAfterSweeper = executeBoardSweeper(
          currentState,
          stackObject.sourceCardId,
          ignoreIndestructible,
        );

        // Remove the stack object after resolution
        const updatedStack = stateAfterSweeper.stack.filter(
          (obj) => obj.id !== stackObject.id,
        );

        return {
          ...stateAfterSweeper,
          stack: updatedStack,
          consecutivePasses: 0,
          lastModifiedAt: Date.now(),
        };
      }

      // Parse effects from oracle text if no structured effects present
      if (!stackObject.effects || stackObject.effects.length === 0) {
        // CR 700.2: modal spells ("Choose one —", "Choose two —",
        // "Choose three —") resolve only the modes the controller chose.
        // When the stack object's chosenModes is populated, restrict the
        // parsed effects to those modes; otherwise parse the full oracle
        // text (legacy / choose-none-yet behavior — the modal choice is
        // expected to set chosenModes before resolution for the modal
        // branch to fire).
        const isModalWithChoice =
          stackObject.chosenModes && stackObject.chosenModes.length > 0;
        const parsedEffects = isModalWithChoice
          ? getEffectsForChosenModes(stackObject, currentState)
          : parseSpellEffects(oracleText, stackObject.variableValues);

        if (parsedEffects.length > 0) {
          // Apply effects with target information. CR 702.85 — pass the
          // kicker bonus so each scalable base effect (damage / card_draw
          // / token_creation) gets +N when the spell was kicked.
          const result = resolveStackObjectEffects(
            currentState,
            parsedEffects,
            stackObject.sourceCardId,
            stackObject.targets,
            kickerBonus,
          );
          currentState = result;
        }
      }
    }
  }

  // Move the card from stack to appropriate zone and handle post-resolution
  return resolveSpellCompletion(currentState, stackObject);
}

/**
 * Handle the completion of spell resolution - moving to zone and triggering effects
 * CR 608.2 - After the spell's effect(s) are applied, it moves to its destination zone
 */
function resolveSpellCompletion(
  state: GameState,
  stackObject: StackObject,
): GameState {
  // CR 707.10 — a copy of a spell is not backed by a card. Its effects were
  // already applied in resolveTopOfStack (which looks the source card up via
  // `sourceCardId` to parse oracle-text effects). On completion a permanent
  // copy becomes a token on the battlefield under its controller (CR 707.10d /
  // CR 111) and an instant/sorcery copy simply ceases to exist. No card is
  // moved because there is no card to move.
  if (stackObject.isCopy) {
    return resolveCopyCompletion(state, stackObject);
  }

  // Get the card
  if (stackObject.sourceCardId) {
    const card = state.cards.get(stackObject.sourceCardId);
    if (card) {
      // Move card from stack to appropriate zone based on card type
      const typeLine = card.cardData.type_line?.toLowerCase() || "";

      const oracleText = (card.cardData.oracle_text || "").toLowerCase();

      // Check if this is a board sweeper (destroy all creatures)
      const isBoardSweeper =
        typeLine.includes("sorcery") &&
        oracleText.includes("destroy") &&
        oracleText.includes("all creatures");

      if (isBoardSweeper) {
        // Execute board sweeper effect
        let updatedState = { ...state };
        const allCreatureIds: CardInstanceId[] = [];

        for (const [zoneKey, zone] of updatedState.zones) {
          if (zone.type === ZoneType.BATTLEFIELD) {
            for (const cId of zone.cardIds) {
              const c = updatedState.cards.get(cId);
              if (
                c &&
                c.cardData.type_line?.toLowerCase().includes("creature")
              ) {
                allCreatureIds.push(cId);
              }
            }
          }
        }

        for (const creatureId of allCreatureIds) {
          const result = destroyCard(updatedState, creatureId);
          if (result.success) {
            updatedState = result.state;
          }
        }

        // Move sweeper to graveyard
        const stackZone = updatedState.zones.get("stack");
        const graveZone = updatedState.zones.get(
          `${card.controllerId}-graveyard`,
        );
        if (stackZone && graveZone) {
          const moved = moveCardBetweenZones(
            stackZone,
            graveZone,
            stackObject.sourceCardId,
          );
          const updatedZones = new Map(updatedState.zones);
          updatedZones.set("stack", moved.from);
          updatedZones.set(`${card.controllerId}-graveyard`, moved.to);
          const updatedStack = updatedState.stack.filter(
            (o) => o.id !== stackObject.id,
          );

          return {
            ...updatedState,
            zones: updatedZones,
            stack: updatedStack,
            priorityPlayerId: updatedState.turn.activePlayerId,
            lastModifiedAt: Date.now(),
          };
        }
      }

      let destinationZone: string;
      if (typeLine.includes("instant") || typeLine.includes("sorcery")) {
        // Instants and sorceries go to graveyard — UNLESS they were cast
        // with Escape (CR 702.138c): "If a resolving spell cast with escape
        // would be put into a zone other than the stack or the battlefield,
        // exile it instead." Permanents cast with escape still enter the
        // battlefield normally (the same rule says "other than ... the
        // battlefield"); the exile-instead-of-graveyard replacement for
        // escaped permanents that later die is a separate replacement-effect
        // concern, not handled here.
        const wasEscaped =
          stackObject.alternativeCostsUsed?.includes("escape") ?? false;
        destinationZone = wasEscaped
          ? `${card.controllerId}-exile`
          : `${card.controllerId}-graveyard`;
      } else {
        // Permanents go to battlefield
        destinationZone = `${card.controllerId}-battlefield`;
      }

      const stackZone = state.zones.get("stack");
      const destZone = state.zones.get(destinationZone);

      if (stackZone && destZone) {
        const moved = moveCardBetweenZones(
          stackZone,
          destZone,
          stackObject.sourceCardId,
        );

        const updatedZones = new Map(state.zones);
        updatedZones.set("stack", moved.from);
        updatedZones.set(destinationZone, moved.to);

        const updatedStack = state.stack.filter(
          (obj) => obj.id !== stackObject.id,
        );

        // Initialize loyalty counters for planeswalkers entering the battlefield
        let updatedCards = state.cards;
        if (!typeLine.includes("instant") && !typeLine.includes("sorcery")) {
          const card = state.cards.get(stackObject.sourceCardId);
          if (card) {
            const initializedCard = initializePlaneswalkerLoyalty(card);
            if (initializedCard !== card) {
              updatedCards = new Map(state.cards);
              updatedCards.set(stackObject.sourceCardId, initializedCard);
            }
          }
        }

        // Reset priority passes for all players (CR 117.4)
        const updatedPlayers = new Map(state.players);
        updatedPlayers.forEach((player) => {
          updatedPlayers.set(player.id, {
            ...player,
            hasPassedPriority: false,
          });
        });

        let currentState: GameState = {
          ...state,
          zones: updatedZones,
          stack: updatedStack,
          cards: updatedCards,
          players: updatedPlayers,
          priorityPlayerId: state.turn.activePlayerId,
          consecutivePasses: 0,
          lastModifiedAt: Date.now(),
        };

        if (typeLine.includes("instant") || typeLine.includes("sorcery")) {
          // Instants and sorceries don't trigger ETB abilities
        } else {
          currentState = checkTriggeredAbilities(
            currentState,
            "entersBattlefield",
          ).state;
        }

        // CR 702.85 — the kicker additional effect (damage / card_draw /
        // token_creation bonus) is applied in `resolveTopOfStack` above,
        // where `stackObject.timesKicked` is forwarded to
        // `resolveStackObjectEffects` as the `kickerBonus` argument. By the
        // time we reach spell completion the kicker clause has already fired
        // and the effects list has been scaled; no extra work is needed here.
        // The conditional below is retained as a marker that kicker was paid
        // for downstream introspection / logs (e.g. game-replay serialization).
        if (stackObject.alternativeCostsUsed?.includes("kicker")) {
          // Kicker bonus already applied during effect resolution.
        }

        // CR 702.8 - Buyback: Return spell to hand instead of graveyard
        if (
          stackObject.alternativeCostsUsed?.includes("buyback") &&
          stackObject.buybackReturnZone
        ) {
          const spellCard = currentState.cards.get(stackObject.sourceCardId!);
          if (spellCard) {
            const battlefieldZone = currentState.zones.get(
              `${spellCard.controllerId}-battlefield`,
            );
            const handZone = currentState.zones.get(
              stackObject.buybackReturnZone,
            );
            if (battlefieldZone && handZone) {
              const moved = moveCardBetweenZones(
                battlefieldZone,
                handZone,
                stackObject.sourceCardId!,
              );
              const updatedZones2 = new Map(currentState.zones);
              updatedZones2.set(
                `${spellCard.controllerId}-battlefield`,
                moved.from,
              );
              updatedZones2.set(stackObject.buybackReturnZone!, moved.to);
              currentState = {
                ...currentState,
                zones: updatedZones2,
              };
            }
          }
        }

        // CR 702.99 - Bestow: Attach the aura to the target creature
        if (
          stackObject.alternativeCostsUsed?.includes("bestow") &&
          stackObject.bestowTarget
        ) {
          const auraCard = currentState.cards.get(stackObject.sourceCardId!);
          if (auraCard) {
            const updatedCards = new Map(currentState.cards);
            updatedCards.set(stackObject.sourceCardId!, {
              ...auraCard,
              attachedToId: stackObject.bestowTarget,
            });
            currentState = {
              ...currentState,
              cards: updatedCards,
            };
          }
        }

        // CR 702.140 - Mutate: the spell was already moved onto the
        // battlefield by the generic permanent-resolution path above (the
        // mutator is a creature permanent, so destinationZone was the
        // controller's battlefield). Now merge it onto the declared target.
        // If the target is no longer on the battlefield, CR 702.140f says
        // the mutator enters as a normal creature — which is exactly the
        // state we are already in (mutator on battlefield, no merge), so the
        // fallback is a no-op.
        if (
          stackObject.alternativeCostsUsed?.includes("mutate") &&
          stackObject.mutateTargetCreatureId
        ) {
          const targetId = stackObject.mutateTargetCreatureId;
          const targetCard = currentState.cards.get(targetId);
          // Target must still be on the battlefield for the merge to happen.
          const targetZoneKey = targetCard?.currentZoneKey;
          const targetZone = targetZoneKey
            ? currentState.zones.get(targetZoneKey)
            : undefined;
          const targetStillOnBattlefield =
            targetCard !== undefined &&
            targetZone !== undefined &&
            targetZone.type === ZoneType.BATTLEFIELD &&
            targetZone.cardIds.includes(targetId);
          if (targetStillOnBattlefield) {
            // Apply the merge. `applyMutate` records the merge relationship
            // (mutatedCardIds / mutateBaseId / isMutated /
            // highestCmcComponentId) per CR 702.140b — the top card's
            // characteristics control P/T/type/color while lower components'
            // text contributes.
            const mergeResult = applyMutate(
              currentState,
              stackObject.sourceCardId!,
              targetId,
            );
            if (mergeResult.success) {
              currentState = mergeResult.state;
            }
          }
          // else: CR 702.140f fallback — target gone. The mutator is
          // already on the battlefield as a normal creature (the generic
          // permanent-resolution path moved it there), which is exactly
          // what CR 702.140f prescribes. No further action needed.
        }

        // CR 702.150 - Blitz: a creature cast for its blitz cost gains haste
        // and is marked so the engine can apply the coupled "when this creature
        // dies, draw a card" trigger and the "sacrifice at the beginning of the
        // next end step" delayed trigger. Haste = no summoning sickness; the
        // marker is the single source of truth consumed by the trigger system.
        if (stackObject.alternativeCostsUsed?.includes("blitz")) {
          const blitzCard = currentState.cards.get(stackObject.sourceCardId!);
          if (blitzCard) {
            const updatedCards = new Map(currentState.cards);
            updatedCards.set(stackObject.sourceCardId!, {
              ...blitzCard,
              blitz: true,
              hasSummoningSickness: false,
            });
            currentState = {
              ...currentState,
              cards: updatedCards,
            };
          }
        }

        // CR 702.66 - Flashback: Card goes to exile instead of graveyard
        if (stackObject.alternativeCostsUsed?.includes("flashback")) {
          // Flashback spells resolve normally
        }

        return currentState;
      }
    }
  }

  // Fallback: just remove from stack
  return removeFromStack(state, stackObject.id);
}

/**
 * Complete the resolution of a SPELL COPY (CR 707.10).
 *
 * Copies have no card backing them, so the normal "move card to graveyard /
 * battlefield" path does not apply. A copy of a permanent spell enters the
 * battlefield as a token under its controller (CR 707.10d → CR 111); a copy of
 * an instant/sorcery spell simply ceases to exist once its effects have
 * resolved. The copy is then removed from the stack.
 */
function resolveCopyCompletion(
  state: GameState,
  stackObject: StackObject,
): GameState {
  const sourceCard = stackObject.sourceCardId
    ? state.cards.get(stackObject.sourceCardId)
    : undefined;
  const typeLine = sourceCard?.cardData.type_line?.toLowerCase() ?? "";
  const isPermanent =
    typeLine.length > 0 &&
    !typeLine.includes("instant") &&
    !typeLine.includes("sorcery");

  let currentState = state;
  if (isPermanent && sourceCard) {
    // CR 707.10d — a copy of a permanent spell enters the battlefield as a
    // token owned and controlled by the copy's controller.
    const tokenResult = createTokenCard(
      currentState,
      sourceCard.cardData,
      stackObject.controllerId,
      stackObject.controllerId,
      1,
    );
    if (tokenResult.success) {
      currentState = tokenResult.state;
    }
  }

  return removeFromStack(currentState, stackObject.id);
}

/**
 * Remove an object from the stack
 */
function removeFromStack(state: GameState, stackObjectId: string): GameState {
  const updatedStack = state.stack.filter((obj) => obj.id !== stackObjectId);

  // Reset priority passes
  const updatedPlayers = new Map(state.players);
  updatedPlayers.forEach((player) => {
    updatedPlayers.set(player.id, { ...player, hasPassedPriority: false });
  });

  return {
    ...state,
    stack: updatedStack,
    players: updatedPlayers,
    priorityPlayerId: state.turn.activePlayerId,
    consecutivePasses: 0,
    lastModifiedAt: Date.now(),
  };
}

// Note: counterSpell is already exported in keyword-actions.ts
// Re-export it here for convenience
// export { counterSpell } from "./keyword-actions";

