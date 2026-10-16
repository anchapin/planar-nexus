/**
 * Wave 4.8 follow-up 21 lane 69 (#2614 follow-up):
 * per-mana restriction-tag ledger.
 *
 * The drafter list (#2614) flags a long tail of cards with
 * the "spend this mana only on [X]" pattern (Llawan, War Tax,
 * the "spend this mana only on creature spells" family). The
 * module ships in two pieces:
 *
 * - Piece 1/N — per-tag ledger substrate (`addRestrictedMana`,
 *   `getRestrictedMana`, `clearRestrictionLedger`) + the
 *   `AddManaSchema.restriction?: string` schema arm.
 * - Piece 2/N (this commit) — `resolveXspentOn` consult
 *   predicate + single-tag cleanup helper
 *   (`clearRestrictionTag`).
 *
 * The ledger parallels `player.manaPool`: it's keyed by
 * restriction tag (e.g. `"creature_spells"`) and the values
 * carry the same partial mana shape. The activated-ability
 * mana path reads the effect's `restriction` field (the new
 * `AddManaSchema.restriction?: string` arm) and routes the
 * produced mana into this ledger instead of the main pool.
 * The spend-side caller consults the ledger through
 * `resolveXspentOn`. Per-color matching, generic reduction
 * across tags, and multi-tag routing ride later follow-up
 * pieces.
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
 * Wave 4.8 follow-up 21 lane 69 piece 2/N (#2614 follow-up):
 * consult predicate for the spend-side (`spendMana`,
 * `mana-payment.ts`). v1 is the "colored mana → restriction
 * tag match" half of the contract — we ask "does the player's
 * ledger under this restriction have enough tagged mana to
 * fund `mana`?" The matching key is the restriction tag
 * string itself: the same `AddManaSchema.restriction` value
 * stamps the ledger on production and stamps the consult on
 * consumption. v1 collapses to a total-quantity check on the
 * colored mana slots, which is the smallest predicate that
 * still gates the spend-side caller. Side lanes (per-color
 * matching, generic reduction across tags, multi-tag) ride
 * follow-up pieces.
 *
 * `restriction === "any"` is the universal-passthrough
 * sentinel (the spend side reads this as "no restriction,
 * always OK").
 */
export function resolveXspentOn(
  state: GameState,
  playerId: PlayerId,
  restriction: string,
  mana: Partial<ManaPool>,
): boolean {
  if (restriction === "any") return true;
  const player = state.players.get(playerId);
  if (!player) return false;
  const ledger = player.restrictionLedger ?? {};
  const entry = ledger[restriction];
  if (!entry) return false;
  // Total-quantity check. The ledger entry and the queried
  // `mana` both use the same 7-key partial-pool shape; we
  // sum the colored slots plus generic so that a {G: 1} spend
  // matches a ledger carrying {G: 1, color: anything}.
  return totalPartialMana(entry) >= totalPartialMana(mana);
}

/**
 * Sum the 7 partial-pool slots (colorless, white, blue,
 * black, red, green, generic). Local helper — `mana-pool.ts`
 * exports `getTotalMana(ManaPool)` but the ledger values are
 * `Partial<ManaPool>` so the seven-slot sum is duplicated in
 * this module rather than widening that signature. Keep in
 * sync with `getTotalMana` when adding a new color (#1710).
 */
function totalPartialMana(p: Partial<ManaPool>): number {
  return (
    (p.colorless ?? 0) +
    (p.white ?? 0) +
    (p.blue ?? 0) +
    (p.black ?? 0) +
    (p.red ?? 0) +
    (p.green ?? 0) +
    (p.generic ?? 0)
  );
}

/**
 * Wave 4.8 follow-up 21 lane 69 piece 2/N (#2614 follow-up):
 * remove a single restriction tag from the ledger without
 * disturbing the main pool or sibling tags. The spend-side
 * calls this once the tagged mana funds its target spell so
 * the ledger stays in sync with the mana it produced.
 */
export function clearRestrictionTag(
  state: GameState,
  playerId: PlayerId,
  restriction: string,
): GameState {
  const player = state.players.get(playerId);
  if (!player) return state;
  const ledger = player.restrictionLedger ?? {};
  if (!(restriction in ledger)) return state;
  const next: RestrictionLedger = { ...ledger };
  delete next[restriction];
  const updatedPlayers = new Map(state.players);
  updatedPlayers.set(playerId, {
    ...player,
    restrictionLedger: next,
  });
  return {
    ...state,
    players: updatedPlayers,
    lastModifiedAt: Date.now(),
  };
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
