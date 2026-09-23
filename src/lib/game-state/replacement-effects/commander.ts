import type { CardInstanceId, PlayerId, GameState } from "../types";
import type {
  ReplacementAbility,
  AsThoughEffect,
  AsThoughType,
  ReplacementEventType,
  ReplacementEvent,
} from "./types";
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
 * CR 614.1 — Creates a self-replacement effect that makes a land enter tapped.
 *
 * Used by the oracle text parser when encountering static abilities like
 * "enters the battlefield tapped" on lands. The replacement effect modifies
 * the landEnterBattlefield event so the land enters tapped instead of untapped.
 *
 * @param landCardId   - The card instance id of the land entering the battlefield
 * @param controllerId - The player who controls the land
 */
export function createLandEntersTappedReplacementEffect(
  landCardId: CardInstanceId,
  controllerId: PlayerId,
): ReplacementAbility {
  return {
    id: `land-enters-tapped-${landCardId}-${Date.now()}`,
    sourceCardId: landCardId,
    controllerId,
    effectType: "land_enter_replacement",
    description: "Land enters tapped instead of untapped (CR 614.1)",
    layer: 4, // Same layer as other replacement effects
    timestamp: Date.now(),
    isSelfReplacement: true,
    isInstead: true,
    canApply: (e) =>
      e.type === "landEnterBattlefield" && e.sourceId === landCardId,
    apply: (e) => ({
      modified: true,
      modifiedEvent: {
        ...e,
        entersTapped: true,
      },
      description: `Land ${landCardId} enters tapped instead of untapped`,
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
  const commanderCardId =
    (ctx.originalCardId as CardInstanceId) ??
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
