/**
 * Token creation keyword action (CR 701.6).
 *
 * Mechanically extracted from keyword-actions.ts (issue #1725);
 * behavior pinned by the existing engine suites.
 */
import type {
  GameState,
  CardInstanceId,
  PlayerId,
  ScryfallCard,
} from "../types";
import { createToken } from "../card-instance";
import { KeywordActionResult } from "./shared";
import { fireEntersTriggers } from "./enters";

/**
 * Create a token on the battlefield
 */
export function createTokenCard(
  state: GameState,
  tokenData: ScryfallCard,
  controllerId: PlayerId,
  ownerId: PlayerId,
  count: number = 1,
  /**
   * Wave 4.8 follow-up 4 lane 66 (#2614 follow-up): per-instance
   * keywords stamped on each created token. Routed into the
   * `embeddedStaticKeywords` field on the new `CardInstance`; read
   * by `hasKeyword` as an additional source of keywords alongside
   * `cardData.keywords`. The corresponding P/T (also part of the
   * embedded static) is folded into `cardData.power` /
   * `cardData.toughness` upstream in `resolveTokenCreationEffect`,
   * so the engine's `getPowerValue` / `getToughnessValue` pick it
   * up without a separate P/T ledger. Defaults to `undefined`
   * (no extra keywords) to keep the existing call sites
   * byte-compatible.
   */
  embeddedStaticKeywords?: string[],
): KeywordActionResult {
  const player = state.players.get(controllerId);

  if (!player) {
    return {
      success: false,
      state,
      description: "",
      error: `Player ${controllerId} not found`,
    };
  }

  const battlefieldZoneKey = `${controllerId}-battlefield`;
  const battlefield = state.zones.get(battlefieldZoneKey);

  if (!battlefield) {
    return {
      success: false,
      state,
      description: "",
      error: `Battlefield zone not found`,
    };
  }

  const tokenIds: CardInstanceId[] = [];
  const updatedCards = new Map(state.cards);

  for (let i = 0; i < count; i++) {
    // Wave 4.8 follow-up 4 lane 66 (#2614 follow-up): stamp the
    // embedded static keywords on the per-instance field. Only set
    // when `embeddedStaticKeywords` is non-empty so the per-card
    // shape stays as close to the lane 65 `grantedTriggers` pattern
    // (optional, dropped on a fresh token when not in use).
    // Lowercase the keywords before stamping so `hasKeyword`'s
    // `keyword.toLowerCase()` lookup (line 67 of
    // evergreen-keywords.ts) matches the ledger verbatim without
    // callers having to think about case. The script interpreter
    // also lowercases (the schema's enum is already lowercase, but
    // the script's spell array uses the schema's enum so it's
    // already lowercase at that point — this normalization is for
    // direct callers like the test harness).
    const normalizedKeywords = embeddedStaticKeywords?.length
      ? embeddedStaticKeywords.map((k) => k.toLowerCase())
      : undefined;
    const token = normalizedKeywords
      ? {
          ...createToken(tokenData, controllerId, ownerId),
          embeddedStaticKeywords: normalizedKeywords,
        }
      : createToken(tokenData, controllerId, ownerId);
    tokenIds.push(token.id);
    updatedCards.set(token.id, token);
  }

  const updatedBattlefield = {
    ...battlefield,
    cardIds: [...battlefield.cardIds, ...tokenIds],
  };

  const updatedZones = new Map(state.zones);
  updatedZones.set(battlefieldZoneKey, updatedBattlefield);

  // Each token entering raises its own ETB triggers (CR 603.6a, 111.1).
  let withTokens: GameState = {
    ...state,
    cards: updatedCards,
    zones: updatedZones,
    lastModifiedAt: Date.now(),
  };
  for (const tokenId of tokenIds) {
    withTokens = fireEntersTriggers(withTokens, tokenId);
  }

  return {
    success: true,
    state: withTokens,
    description: `Created ${count} ${tokenData.name} token${count !== 1 ? "s" : ""}`,
    affectedCards: tokenIds,
  };
}
