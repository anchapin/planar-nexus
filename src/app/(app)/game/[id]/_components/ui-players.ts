/**
 * Engine → UI player derivation with structural sharing (issue #2918).
 *
 * `GameBoardContent` used to re-derive the whole UI player list on every
 * render: a fresh `Array.from(...).map(...)` produced fresh player objects,
 * fresh zone arrays and fresh card-view objects each time, so the memoized
 * `PlayerArea` in `src/components/game-board.tsx` could never bail out
 * (its comparator compares zone array references).
 *
 * This module extracts that derivation into a pure helper,
 * `buildUiPlayers(state, previous)`, that reuses every reference whose
 * content did not change:
 *
 * - a card-view object is reused when its `card` (cardData) reference, id,
 *   zone, player id, `tapped` and `faceDown` flags are unchanged;
 * - a zone array is reused when every card-view in it is unchanged;
 * - a player object is reused when every scalar field, the `manaPool`
 *   reference and every zone array reference are unchanged;
 * - `commanderDamage` is ONE shared frozen empty object instead of a fresh
 *   `{}` per player per render.
 *
 * The output shape is byte-for-byte the same as the previous inline
 * derivation (same fields, same zone order, same card-view fields, local
 * player sorted last) — only the *identity* of unchanged parts is preserved.
 */

import type { CardInstance, GameState, ManaPool } from "@/lib/game-state";
import type { ScryfallCard } from "@/lib/card-database";
import type { ZoneType } from "@/types/game";

/** A single card as rendered by the board. */
export interface UiCardView {
  id: string;
  card: ScryfallCard;
  zone: ZoneType;
  playerId: string;
  tapped: boolean;
  faceDown: boolean;
}

/**
 * A player as rendered by the board. Mirrors the shape that
 * `GameBoardContent` used to build inline (and `PlayerState` in
 * `src/types/game.ts`, plus the extra `manaPool` the footer consumes).
 */
export interface UiPlayer {
  id: string;
  name: string;
  lifeTotal: number;
  poisonCounters: number;
  commanderDamage: { [playerId: string]: number };
  hand: UiCardView[];
  battlefield: UiCardView[];
  graveyard: UiCardView[];
  exile: UiCardView[];
  library: UiCardView[];
  commandZone: UiCardView[];
  isCurrentTurn: boolean;
  hasPriority: boolean;
  landsPlayedThisTurn: number;
  manaPool: ManaPool;
}

/** The engine zones that are derived into card views, in render order. */
type DerivedZone = "hand" | "battlefield" | "graveyard" | "exile" | "library";

/**
 * One shared, frozen, empty commander-damage map. The board only ever
 * reads it (`Object.entries`), and a single shared reference keeps the
 * `PlayerArea` comparator from seeing a change on every render.
 */
const EMPTY_COMMANDER_DAMAGE: { [playerId: string]: number } = Object.freeze(
  {},
);

/**
 * Build the card views of one zone, reusing the previous card-view objects
 * (and the previous array) when nothing changed.
 */
function buildZoneViews(
  state: GameState,
  playerId: string,
  zoneType: DerivedZone,
  previous: UiCardView[] | undefined,
): UiCardView[] {
  const zone = state.zones.get(`${playerId}-${zoneType}`);

  const instances: CardInstance[] = [];
  if (zone) {
    for (const cardId of zone.cardIds) {
      const card = state.cards.get(cardId);
      if (card) instances.push(card);
    }
  }

  if (previous && previous.length === instances.length) {
    const unchanged = instances.every((card, index) => {
      const prev = previous[index];
      return (
        prev.id === card.id &&
        prev.card === card.cardData &&
        prev.zone === zoneType &&
        prev.playerId === playerId &&
        prev.tapped === card.isTapped &&
        prev.faceDown === card.isFaceDown
      );
    });
    if (unchanged) return previous;
  }

  return instances.map((card) => ({
    id: card.id,
    card: card.cardData,
    zone: zoneType as ZoneType,
    playerId,
    tapped: card.isTapped,
    faceDown: card.isFaceDown,
  }));
}

/** Build one UI player, reusing the previous player object when possible. */
function buildPlayer(
  state: GameState,
  playerId: string,
  previous: UiPlayer | undefined,
): UiPlayer {
  const enginePlayer = state.players.get(playerId);
  if (!enginePlayer) {
    throw new Error(`Unknown player ${playerId}`);
  }

  const hand = buildZoneViews(state, playerId, "hand", previous?.hand);
  const battlefield = buildZoneViews(
    state,
    playerId,
    "battlefield",
    previous?.battlefield,
  );
  const graveyard = buildZoneViews(
    state,
    playerId,
    "graveyard",
    previous?.graveyard,
  );
  const exile = buildZoneViews(state, playerId, "exile", previous?.exile);
  const library = buildZoneViews(state, playerId, "library", previous?.library);
  // The command zone is never derived from the engine state — it is always
  // empty — but the array reference is still kept stable across renders.
  const commandZone =
    previous && previous.commandZone.length === 0 ? previous.commandZone : [];

  const isCurrentTurn = playerId === state.turn.activePlayerId;
  const hasPriority = playerId === state.priorityPlayerId;

  if (
    previous &&
    previous.id === enginePlayer.id &&
    previous.name === enginePlayer.name &&
    previous.lifeTotal === enginePlayer.life &&
    previous.poisonCounters === enginePlayer.poisonCounters &&
    previous.isCurrentTurn === isCurrentTurn &&
    previous.hasPriority === hasPriority &&
    previous.landsPlayedThisTurn === enginePlayer.landsPlayedThisTurn &&
    previous.manaPool === enginePlayer.manaPool &&
    previous.hand === hand &&
    previous.battlefield === battlefield &&
    previous.graveyard === graveyard &&
    previous.exile === exile &&
    previous.library === library &&
    previous.commandZone === commandZone
  ) {
    return previous;
  }

  return {
    id: enginePlayer.id,
    name: enginePlayer.name,
    lifeTotal: enginePlayer.life,
    poisonCounters: enginePlayer.poisonCounters,
    commanderDamage: EMPTY_COMMANDER_DAMAGE,
    hand,
    battlefield,
    graveyard,
    exile,
    library,
    commandZone,
    isCurrentTurn,
    hasPriority,
    landsPlayedThisTurn: enginePlayer.landsPlayedThisTurn,
    manaPool: enginePlayer.manaPool,
  };
}

/**
 * Derive the UI players of an engine game state, reusing every unchanged
 * reference from `previous`.
 *
 * @param state The engine game state.
 * @param previous The result of the previous call (or `undefined`).
 * @param localPlayerName Name of the local player — it is sorted last, as
 *   the previous inline derivation did.
 * @returns The sorted UI player list (local player last).
 */
export function buildUiPlayers(
  state: GameState,
  previous: readonly UiPlayer[] | undefined,
  localPlayerName?: string,
): UiPlayer[] {
  const previousById = new Map<string, UiPlayer>();
  if (previous) {
    for (const player of previous) previousById.set(player.id, player);
  }

  const players: UiPlayer[] = [];
  for (const playerId of state.players.keys()) {
    players.push(buildPlayer(state, playerId, previousById.get(playerId)));
  }

  // Sort so the local player is at the bottom (index 1). The comparator is
  // the one the inline derivation used; `sort` is stable, so the order of
  // the remaining players is preserved. The input array is never mutated.
  const sorted = [...players].sort((a, b) => {
    if (localPlayerName !== undefined) {
      if (a.name === localPlayerName) return 1;
      if (b.name === localPlayerName) return -1;
    }
    return 0;
  });

  if (
    previous &&
    previous.length === sorted.length &&
    previous.every((player, index) => player === sorted[index])
  ) {
    return previous as UiPlayer[];
  }

  return sorted;
}

export default buildUiPlayers;
