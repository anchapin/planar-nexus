/**
 * State-Based Actions System
 * Implements MTG state-based actions (SBAs) as defined in Comprehensive Rules 704.
 * SBAs are checked continuously and performed automatically.
 *
 * Issue #267: State-based actions (SBA) system for the MTG rules engine
 */

import type {
  GameState,
  CardInstance,
  CardInstanceId,
  PlayerId,
} from "./types";
import { ZoneType, isOnBattlefield, parseZoneKey } from "./types";
import {
  isCreature,
  isPlaneswalker,
  getToughness,
  hasLethalDamage,
} from "./card-instance";
import { hasIndestructible, handlePersist } from "./keyword-actions";
import {
  destroyCard,
  exileCard,
  resolveBlitzDeathDraw,
  setMonarch,
  getMonarchId,
} from "./keyword-actions";
import { DEFAULT_COMMANDER_DAMAGE_THRESHOLD } from "./commander-damage";
import {
  findLegendaryViolations,
  hasPendingLegendaryChoice,
  createLegendaryWaitingChoice,
} from "./legendary-rule";
import { processCorpseOnDeath } from "./corpse-keyword";

// Helper functions to check card types
function isAura(card: CardInstance): boolean {
  return card.cardData.type_line?.toLowerCase().includes("aura") ?? false;
}

function isEquipment(card: CardInstance): boolean {
  return card.cardData.type_line?.toLowerCase().includes("equipment") ?? false;
}

/**
 * Result of state-based action checking
 */
export interface StateBasedActionResult {
  /** Whether any SBAs were performed */
  actionsPerformed: boolean;
  /** Updated game state */
  state: GameState;
  /** Descriptions of actions performed */
  descriptions: string[];
}

/**
 * Check and perform state-based actions
 * Called after any game event that could trigger SBAs
 * Issue #15: Handle state-based actions
 */
export function checkStateBasedActions(
  state: GameState,
): StateBasedActionResult {
  let updatedState = { ...state };
  const descriptions: string[] = [];
  let actionsPerformed = false;

  // Check each player for SBAs
  for (const [playerId, player] of updatedState.players) {
    // SBA 704.5a: A player with 0 or less life loses the game
    if (player.life <= 0) {
      updatedState = {
        ...updatedState,
        players: new Map(updatedState.players).set(playerId, {
          ...player,
          hasLost: true,
          lossReason: "Life total reached 0 or less",
        }),
      };
      descriptions.push(`${player.name} loses the game (0 or less life)`);
      actionsPerformed = true;
    }

    // SBA 704.5b: A player with 10 or more poison counters loses the game
    if (player.poisonCounters >= 10) {
      updatedState = {
        ...updatedState,
        players: new Map(updatedState.players).set(playerId, {
          ...player,
          hasLost: true,
          lossReason: "Accumulated 10 or more poison counters",
        }),
      };
      descriptions.push(`${player.name} loses the game (10+ poison counters)`);
      actionsPerformed = true;
    }

    // SBA 704.5c: A player attempting to draw from an empty library loses the game
    // This is tracked separately - for now, we check if library is empty
    const libraryKey = `${playerId}-${ZoneType.LIBRARY}`;
    const library = updatedState.zones.get(libraryKey);
    if (library && library.cardIds.length === 0) {
      // Player will lose on their next draw attempt
      // This is handled in the draw function
    }

    // Commander damage (CR 903.10a): A player who has been dealt 21 or more
    // combat damage by the same commander over the course of the game loses the game
    for (const [commanderId, damage] of player.commanderDamage) {
      if (damage >= DEFAULT_COMMANDER_DAMAGE_THRESHOLD) {
        const commander = updatedState.cards.get(commanderId);
        const commanderName = commander?.cardData.name || "Commander";
        updatedState = {
          ...updatedState,
          players: new Map(updatedState.players).set(playerId, {
            ...player,
            hasLost: true,
            lossReason: `${commanderName} has dealt ${damage} commander damage (21+)`,
          }),
        };
        descriptions.push(
          `${player.name} loses the game (${commanderName} dealt ${damage} commander damage)`,
        );
        actionsPerformed = true;
        break; // Only need to mark once per player
      }
    }
  }

  // SBA 704.5p: Monarchy transfer.
  //
  // "If a player has been dealt combat damage by the monarch and combat
  // damage has been dealt to the monarch, the player who dealt combat
  // damage to the monarch becomes the monarch."
  //
  // We resolve this with a per-player `lastCombatDamageFromPlayer` field
  // populated by `dealDamageToPlayer` whenever a creature source deals
  // combat damage to another player. The helper `setMonarch` performs the
  // canonical transition — clearing the old monarch, marking the new
  // monarch, and returning whether the flag actually changed.
  //
  // We iterate while the SBA fires so that back-to-back combat damage
  // events (a single attack chain that produces multiple events) all
  // eventually settle on the latest source.
  let safetyIterations = updatedState.players.size + 1;
  while (safetyIterations-- > 0) {
    const currentMonarchId = getMonarchId(updatedState);
    const pendingTransfers: Array<{
      targetId: PlayerId;
      sourceId: PlayerId;
    }> = [];

    if (currentMonarchId !== null) {
      const monarch = updatedState.players.get(currentMonarchId);
      if (
        monarch &&
        monarch.lastCombatDamageFromPlayer &&
        monarch.lastCombatDamageFromPlayer !== currentMonarchId
      ) {
        pendingTransfers.push({
          targetId: currentMonarchId,
          sourceId: monarch.lastCombatDamageFromPlayer,
        });
      }
    } else {
      // No monarch exists yet — the very first opponent to deal combat
      // damage to anyone becomes the first monarch. Players whose
      // `lastCombatDamageFromPlayer` is populated are queued; if more
      // than one candidate exists we still pick deterministically (the
      // first one iterated) since SBA convergence is order-independent
      // for the in-game-effect.
      for (const [candidateId, candidate] of updatedState.players) {
        const sourceId = candidate.lastCombatDamageFromPlayer;
        if (sourceId && sourceId !== candidateId) {
          pendingTransfers.push({ targetId: candidateId, sourceId });
          break;
        }
      }
    }

    if (pendingTransfers.length === 0) break;

    let progressed = false;
    for (const transfer of pendingTransfers) {
      const result = setMonarch(updatedState, transfer.sourceId);
      if (result.changed) {
        const next = result.state.players.get(transfer.sourceId);
        descriptions.push(
          `${next?.name ?? transfer.sourceId} becomes the monarch (CR 704.5p)`,
        );
        actionsPerformed = true;
        progressed = true;
        updatedState = result.state;
        break;
      }
    }
    if (!progressed) break;
  }

  // Check cards for SBAs
  const cardsToCheck = Array.from(updatedState.cards.values());
  const cardsToDestroy: CardInstanceId[] = [];
  const cardsToExile: CardInstanceId[] = [];

  for (const card of cardsToCheck) {
    // Use cached zone key for O(1) lookup, fallback to search for legacy cards
    let currentZoneKey = card.currentZoneKey;
    let zone = currentZoneKey ? updatedState.zones.get(currentZoneKey) : null;

    if (!zone) {
      // Fallback: search all zones (for cards created before cache existed)
      for (const [zk, z] of updatedState.zones) {
        if (z.cardIds.includes(card.id)) {
          zone = z;
          currentZoneKey = zk;
          break;
        }
      }
    }

    if (!currentZoneKey || !zone) continue;

    const isOnBf = zone.type === ZoneType.BATTLEFIELD;

    // SBAs 704.5f–704.5n only apply to permanents on the battlefield
    if (isOnBf) {
      // SBA 704.5f: A creature with lethal damage is destroyed
      // Indestructible creatures are not destroyed by lethal damage (CR 702.12)
      if (
        isCreature(card) &&
        hasLethalDamage(card) &&
        !hasIndestructible(card)
      ) {
        if (!cardsToDestroy.includes(card.id)) {
          cardsToDestroy.push(card.id);
          descriptions.push(
            `${card.cardData.name} is destroyed (lethal damage)`,
          );
          actionsPerformed = true;
        }
      }

      // SBA 704.5g: A creature with toughness 0 or less is destroyed
      if (isCreature(card)) {
        // Account for P/T counters (CR 613.8c). Infect damage manifests as
        // -1/-1 counters (CR 702.93b), so a creature can reach 0 toughness
        // via counters without any marked damage. The net counter bonus
        // (matching Layer 7c) is applied here so such creatures are destroyed.
        const plusOneCounters =
          card.counters?.find((c) => c.type === "+1/+1")?.count ?? 0;
        const minusOneCounters =
          card.counters?.find((c) => c.type === "-1/-1")?.count ?? 0;
        const effectiveToughness =
          getToughness(card) + plusOneCounters - minusOneCounters;
        if (effectiveToughness <= 0) {
          if (!cardsToDestroy.includes(card.id)) {
            cardsToDestroy.push(card.id);
          }
          descriptions.push(
            `${card.cardData.name} is destroyed (toughness 0 or less)`,
          );
          actionsPerformed = true;
        }
      }

      // SBA 704.5i: A planeswalker with 0 loyalty is exiled
      // Planeswalkers enter with loyalty counters equal to their loyalty field (CR 306.5b)
      if (isPlaneswalker(card)) {
        const loyaltyCounters = card.counters?.find(
          (c) => c.type === "loyalty",
        );
        const loyalty = loyaltyCounters?.count ?? 0;
        if (loyalty <= 0) {
          if (!cardsToExile.includes(card.id)) {
            cardsToExile.push(card.id);
          }
          descriptions.push(`${card.cardData.name} is exiled (0 loyalty)`);
          actionsPerformed = true;
        }
      }

      // SBA 704.5m: An Aura attached to an illegal object is put into its owner's graveyard
      if (isAura(card) && card.attachedToId) {
        const attachedTo = updatedState.cards.get(card.attachedToId);
        // Use cached zone key for O(1) lookup, fallback to search for legacy cards
        let attachedToOnBf = false;
        if (attachedTo && attachedTo.currentZoneKey) {
          const attachedZone = updatedState.zones.get(
            attachedTo.currentZoneKey,
          );
          attachedToOnBf = attachedZone?.type === ZoneType.BATTLEFIELD;
        } else if (attachedTo) {
          // Fallback: search all zones for legacy cards
          for (const [zk, z] of updatedState.zones) {
            if (
              z.cardIds.includes(attachedTo.id) &&
              z.type === ZoneType.BATTLEFIELD
            ) {
              attachedToOnBf = true;
              break;
            }
          }
        }
        if (!attachedToOnBf) {
          // Aura's target is gone - put aura in graveyard
          if (!cardsToDestroy.includes(card.id)) {
            cardsToDestroy.push(card.id);
          }
          descriptions.push(
            `${card.cardData.name} is destroyed (enchanting nothing)`,
          );
          actionsPerformed = true;
        }
      }

      // SBA 704.5n: An Equipment or Fortification attached to an illegal object is put in the graveyard
      // Equipment can only be attached to a creature on the battlefield
      if (isEquipment(card) && card.attachedToId) {
        const attachedTo = updatedState.cards.get(card.attachedToId);
        // Use cached zone key for O(1) lookup, fallback to search for legacy cards
        let attachedToOnBf = false;
        if (attachedTo && attachedTo.currentZoneKey) {
          const attachedZone = updatedState.zones.get(
            attachedTo.currentZoneKey,
          );
          attachedToOnBf = attachedZone?.type === ZoneType.BATTLEFIELD;
        } else if (attachedTo) {
          // Fallback: search all zones for legacy cards
          for (const [zk, z] of updatedState.zones) {
            if (
              z.cardIds.includes(attachedTo.id) &&
              z.type === ZoneType.BATTLEFIELD
            ) {
              attachedToOnBf = true;
              break;
            }
          }
        }
        // Equipment becomes unattached if the attached permanent leaves the battlefield
        // or if it's attached to a non-creature permanent
        if (!attachedToOnBf || (attachedTo && !isCreature(attachedTo))) {
          if (!cardsToDestroy.includes(card.id)) {
            cardsToDestroy.push(card.id);
          }
          const reason = !attachedToOnBf
            ? "attached permanent left battlefield"
            : "attached to non-creature";
          descriptions.push(`${card.cardData.name} is destroyed (${reason})`);
          actionsPerformed = true;
        }
      }
    }

    // SBA 704.5q: If a permanent has both +1/+1 and -1/-1 counters, remove N of each
    // where N is the smaller of the two counts
    if (isOnBf) {
      const plusOneCounters = card.counters.find((c) => c.type === "+1/+1");
      const minusOneCounters = card.counters.find((c) => c.type === "-1/-1");
      if (
        plusOneCounters &&
        minusOneCounters &&
        plusOneCounters.count > 0 &&
        minusOneCounters.count > 0
      ) {
        const removeCount = Math.min(
          plusOneCounters.count,
          minusOneCounters.count,
        );
        updatedState = {
          ...updatedState,
          cards: new Map(updatedState.cards).set(card.id, {
            ...card,
            counters: card.counters
              .map((c) => {
                if (c.type === "+1/+1") {
                  return { ...c, count: c.count - removeCount };
                }
                if (c.type === "-1/-1") {
                  return { ...c, count: c.count - removeCount };
                }
                return c;
              })
              .filter((c) => c.count > 0),
          }),
        };
        descriptions.push(
          `${card.cardData.name}: Removed ${removeCount} +1/+1 and ${removeCount} -1/-1 counters`,
        );
        actionsPerformed = true;
      }
    }
  }

  // Destroy all marked cards
  for (const cardId of cardsToDestroy) {
    // Persist's intervening-"if" (CR 702.78a / 603.4) must be evaluated against
    // the counters the creature had ON THE BATTLEFIELD when it died. destroyCard()
    // -> moveCardToZone() clears counters on the zone change to the graveyard, so
    // snapshot them now (before destruction) and hand them to handlePersist().
    const dyingCard = updatedState.cards.get(cardId);
    const countersAtDeath = dyingCard?.counters;

    const destroyResult = destroyCard(updatedState, cardId);
    if (destroyResult.success) {
      updatedState = destroyResult.state;
      const card = updatedState.cards.get(cardId);
      if (card) {
        descriptions.push(`Destroyed ${card?.cardData.name}`);
      }
      // Handle persist keyword (CR 702.78)
      // Persist triggers when a creature dies without a -1/-1 counter on it
      const persistResult = handlePersist(
        updatedState,
        cardId,
        countersAtDeath,
      );
      if (persistResult.persistedCards.length > 0) {
        updatedState = persistResult.state;
        descriptions.push(...persistResult.descriptions);
        actionsPerformed = true;
      }

      // CR 702.150a — Blitz dies-draw: a creature cast for its blitz cost that
      // dies (any cause) causes its controller to draw a card. This is the SBA
      // death path (lethal damage / 0 toughness); sacrifice-driven deaths are
      // handled by applyBlitzEndStepSacrifice which calls the same helper.
      const blitzDraw = resolveBlitzDeathDraw(updatedState, cardId);
      if (blitzDraw.applied) {
        updatedState = blitzDraw.state;
        const deadName =
          updatedState.cards.get(cardId)?.cardData.name ?? "Creature";
        descriptions.push(
          `${deadName} was cast for its blitz cost: controller draws a card`,
        );
        actionsPerformed = true;
      }

      // CR 702.168 — Corpse death trigger. The dead card is still in state.cards
      // (now in graveyard); processCorpseOnDeath queues a corpse_offer waiting
      // choice for the controller. The choice is surfaced one at a time
      // (mirroring the legendary-rule SBA), and any further queued offers are
      // surfaced automatically as each one resolves via resolveCorpseChoice.
      const corpseTrigger = processCorpseOnDeath(updatedState, cardId);
      if (corpseTrigger.applied) {
        updatedState = corpseTrigger.state;
        const deadName =
          updatedState.cards.get(cardId)?.cardData.name ?? "Creature";
        descriptions.push(
          `${deadName} died with a Corpse ability: offering pay/decline to controller`,
        );
        actionsPerformed = true;
      }
    }
  }

  // Exile all marked cards
  for (const cardId of cardsToExile) {
    const exileResult = exileCard(updatedState, cardId);
    if (exileResult.success) {
      updatedState = exileResult.state;
    }
  }

  // Legendary rule (SBA 704.5u): when a player controls two or more legendary
  // permanents with the same name, that player CHOOSES one to keep and the rest
  // are put into their owner's graveyard. Because the engine resolves SBAs
  // synchronously, the choice is surfaced as a pending `waitingChoice` (type
  // "choose_legend") that the UI or an automated controller resolves via
  // `resolveLegendaryChoice` / `autoResolveLegendaryChoice`.
  // Issue #919: do not auto-destroy; let the controller choose which to keep.
  if (!hasPendingLegendaryChoice(updatedState)) {
    const violations = findLegendaryViolations(updatedState);
    if (violations.length > 0) {
      // Surface one violation at a time. After it is resolved the duplicates
      // leave the battlefield, so the next SBA pass surfaces any remaining one.
      const violation = violations[0];
      updatedState = {
        ...updatedState,
        waitingChoice: createLegendaryWaitingChoice(violation, updatedState),
      };
      const legendName =
        updatedState.cards.get(violation.candidateIds[0])?.cardData.name ??
        "Legendary permanent";
      descriptions.push(
        `${legendName}: legendary rule triggered, awaiting controller choice`,
      );
      actionsPerformed = true;
    }
  }

  // Check for world rule (SBA 704.5k)
  // Two world permanents exist - destroy the older one
  const worldPermanents = cardsToCheck.filter((card) => {
    const isOnBf = isOnBattlefield(updatedState, card.id);
    return (
      isOnBf &&
      (card.cardData.type_line?.toLowerCase().includes("world") ?? false)
    );
  });

  const worldNameGroups = new Map<
    string,
    { card: CardInstance; timestamp: number }[]
  >();
  for (const card of worldPermanents) {
    const name = card.cardData.name.toLowerCase();
    const existing = worldNameGroups.get(name) || [];
    existing.push({ card, timestamp: card.enteredBattlefieldTimestamp });
    worldNameGroups.set(name, existing);
  }

  for (const cards of worldNameGroups.values()) {
    if (cards.length > 1) {
      // Sort by timestamp and keep the newest
      cards.sort((a, b) => b.timestamp - a.timestamp);
      for (let i = 1; i < cards.length; i++) {
        const destroyResult = destroyCard(updatedState, cards[i].card.id);
        if (destroyResult.success) {
          updatedState = destroyResult.state;
          descriptions.push(
            `Destroyed ${cards[i].card.cardData.name} (world rule)`,
          );
          actionsPerformed = true;
        }
      }
    }
  }

  // Check for planeswalker uniqueness (SBA 704.5j variant)
  // A player can only control one planeswalker of each type
  // Only check planeswalkers on the battlefield
  const planeswalkers = cardsToCheck.filter((card) => {
    // Check if card is on battlefield using the helper
    const isOnBf = isOnBattlefield(updatedState, card.id);
    return isOnBf && isPlaneswalker(card);
  });
  const pwTypeGroups = new Map<string, CardInstanceId[]>();

  for (const pw of planeswalkers) {
    // Extract planeswalker type from type line (e.g., "Jace" from "Legendary Planeswalker - Jace")
    const typeLine = pw.cardData.type_line || "";
    // Handle both em dash and regular hyphen
    const pwType = typeLine.replace(/Legendary Planeswalker [-—] /i, "").trim();

    const existing = pwTypeGroups.get(pwType) || [];
    existing.push(pw.id);
    pwTypeGroups.set(pwType, existing);
  }

  for (const cardIds of pwTypeGroups.values()) {
    if (cardIds.length > 1) {
      // Keep the first one, destroy the rest
      for (let i = 1; i < cardIds.length; i++) {
        const destroyResult = destroyCard(updatedState, cardIds[i]);
        if (destroyResult.success) {
          updatedState = destroyResult.state;
          const card = updatedState.cards.get(cardIds[i]);
          descriptions.push(
            `Destroyed ${card?.cardData.name} (planeswalker uniqueness)`,
          );
          actionsPerformed = true;
        }
      }
    }
  }

  // Check win condition after all SBAs
  // Always check win condition in case players were already marked as lost
  updatedState = checkWinCondition(updatedState);
  if (updatedState.status === "completed" && state.status !== "completed") {
    actionsPerformed = true;
  }

  return {
    actionsPerformed,
    state: updatedState,
    descriptions,
  };
}

/**
 * Check if the game has ended
 */
function checkWinCondition(state: GameState): GameState {
  const activePlayers = Array.from(state.players.values()).filter(
    (p) => !p.hasLost,
  );

  if (activePlayers.length === 1) {
    return {
      ...state,
      status: "completed" as const,
      winners: [activePlayers[0].id],
      endReason: "All other players have lost the game",
      lastModifiedAt: Date.now(),
    };
  }

  if (activePlayers.length === 0) {
    // Draw game
    return {
      ...state,
      status: "completed" as const,
      winners: [],
      endReason: "All players lost the game simultaneously",
      lastModifiedAt: Date.now(),
    };
  }

  return state;
}

/**
 * Check if a player can draw (has cards in library)
 */
export function canDraw(state: GameState, playerId: PlayerId): boolean {
  const libraryKey = `${playerId}-library`;
  const library = state.zones.get(libraryKey);
  return library !== undefined && library.cardIds.length > 0;
}

/**
 * Process a draw action with SBA checking
 * If library is empty, player loses
 */
export function drawWithSBAChecking(
  state: GameState,
  playerId: PlayerId,
): { success: boolean; state: GameState; description: string } {
  const libraryKey = `${playerId}-library`;
  const library = state.zones.get(libraryKey);
  const player = state.players.get(playerId);

  if (!library || !player) {
    return {
      success: false,
      state,
      description: "Player or library not found",
    };
  }

  if (library.cardIds.length === 0) {
    // Player loses for trying to draw from empty library (SBA 704.5c)
    const updatedState = {
      ...state,
      players: new Map(state.players).set(playerId, {
        ...player,
        hasLost: true,
        lossReason: "Attempted to draw from empty library",
      }),
    };

    return {
      success: false,
      state: checkWinCondition(updatedState),
      description: `${player.name} loses - attempted to draw from empty library`,
    };
  }

  // Normal draw - handled by drawCards in keyword-actions
  return { success: true, state, description: "Draw available" };
}
