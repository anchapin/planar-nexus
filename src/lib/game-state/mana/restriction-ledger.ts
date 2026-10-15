/**
 * Wave 4.8 follow-up 21 lane 69 piece 1/N (#2614 follow-up):
 * per-mana restriction-tag ledger.
 *
 * The drafter list (#2614) flags a long tail of cards with
 * the "spend this mana only on [X]" pattern (Llawan, War Tax,
 * the "spend this mana only on creature spells" family). v1
 * ships the per-tag ledger + `resolveXspentOn` consult stub;
 * the spend-side enforcement (lane 69 piece 2/N) rides a
 * follow-up lane.
 *
 * The ledger parallels `player.manaPool`: it's keyed by
 * restriction tag (e.g. `"creature_spells"`) and the values
 * carry the same partial mana shape. The activated-ability
 * mana path reads the effect's `restriction` field (the new
 * `AddManaSchema.restriction?: string` arm) and routes the
 * produced mana into this ledger instead of the main pool.
 */
import type { GameState, ManaPool, PlayerId } from "../types";

/** Parallel pool keyed by restriction tag. */
export type RestrictionLedger = Record<string, Partial<ManaPool>>;

/**
 * Add mana to the named restriction ledger on the given player.
 * Map-based immutability (parallel to `addMana` in mana-pool.ts).
 */
export function addRestrictedMana(
  state: GameState,
  playerId: PlayerId,
  restriction: string,
  mana: Partial<ManaPool>,
): GameState {
  const player = state.players.get(playerId);
  if (!player) return state;

  const safeMana: Partial<ManaPool> = {
    colorless: Math.max(0, mana.colorless ?? 0),
    white: Math.max(0, mana.white ?? 0),
    blue: Math.max(0, mana.blue ?? 0),
    black: Math.max(0, mana.black ?? 0),
    red: Math.max(0, mana.red ?? 0),
    green: Math.max(0, mana.green ?? 0),
    generic: Math.max(0, mana.generic ?? 0),
  };

  const prev = player.restrictionLedger ?? {};
  const prevTag = (prev[restriction] ?? {}) as Partial<ManaPool>;

  const updatedPlayers = new Map(state.players);
  updatedPlayers.set(playerId, {
    ...player,
    restrictionLedger: {
      ...prev,
      [restriction]: {
        colorless: (prevTag.colorless ?? 0) + (safeMana.colorless ?? 0),
        white: (prevTag.white ?? 0) + (safeMana.white ?? 0),
        blue: (prevTag.blue ?? 0) + (safeMana.blue ?? 0),
        black: (prevTag.black ?? 0) + (safeMana.black ?? 0),
        red: (prevTag.red ?? 0) + (safeMana.red ?? 0),
        green: (prevTag.green ?? 0) + (safeMana.green ?? 0),
        generic: (prevTag.generic ?? 0) + (safeMana.generic ?? 0),
      },
    },
  });

  return {
    ...state,
    players: updatedPlayers,
    lastModifiedAt: Date.now(),
  };
}

/** Read the partial pool under a restriction tag. */
export function getRestrictedMana(
  state: GameState,
  playerId: PlayerId,
  restriction: string,
): Partial<ManaPool> {
  const player = state.players.get(playerId);
  if (!player) return {};
  const ledger = player.restrictionLedger ?? {};
  return ledger[restriction] ?? {};
}

/**
 * STUB consult — v1 returns true unconditionally so the
 * spend-side caller is non-blocking. The piece 2/N consult
 * reads the partial pool's colored mana and matches it
 * against the spell's restriction tag predicate. `restriction
 * === "any"` is the universal-passthrough sentinel (the spend
 * side reads this as "no restriction, always OK").
 */
export function resolveXspentOn(
  mana: Partial<ManaPool>,
  restriction: string,
): boolean {
  if (restriction === "any") return true;
  // v1 stub: the predicate (colored mana → restriction tag
  // match) is the multi-lane piece 2/N.
  void mana;
  return true;
}

/** Mirror `emptyAllManaPools` for end-of-turn cleanup. */
export function clearRestrictionLedger(
  state: GameState,
  playerId: PlayerId,
): GameState {
  const player = state.players.get(playerId);
  if (!player) return state;

  const updatedPlayers = new Map(state.players);
  updatedPlayers.set(playerId, {
    ...player,
    restrictionLedger: {},
  });

  return {
    ...state,
    players: updatedPlayers,
    lastModifiedAt: Date.now(),
  };
}
