/**
 * End-of-turn cleanup for "granted keyword" effects (issue #2567).
 *
 * Mirrors `clearUntilEndOfTurnPT` (pt-until-end-of-turn.ts). The
 * `GrantKeyword` card-scripts op pushes a keyword (e.g. "indestructible")
 * onto `CardInstance.grantedKeywordsUntilEot` on resolution; this helper is
 * called at the cleanup step so the grant does not survive into the next
 * turn (CR 514.2).
 *
 * Kept as a separate field from `auraKeywords` / `equipmentKeywords` /
 * `scriptStaticKeywords` so the cleanup does not have to know which layer
 * the grant came from. The `hasKeyword` lookup in evergreen-keywords.ts
 * reads from all four arrays; removing the EoT array does not affect the
 * others.
 */
import type { GameState, CardInstanceId } from "../types";

/**
 * Add a keyword to a card's until-end-of-turn grant list. Idempotent: a
 * second call with the same keyword is a no-op. The keyword is stored
 * lower-case (matches the convention used by `auraKeywords` etc.).
 */
export function addGrantedKeywordUntilEot(
  state: GameState,
  cardId: CardInstanceId,
  keyword: string,
): GameState {
  const card = state.cards.get(cardId);
  if (!card) return state;
  const norm = keyword.toLowerCase();
  const prev = card.grantedKeywordsUntilEot ?? [];
  if (prev.includes(norm)) return state;
  const cards = new Map(state.cards);
  cards.set(cardId, {
    ...card,
    grantedKeywordsUntilEot: [...prev, norm],
  });
  return { ...state, cards };
}

/**
 * End-of-turn cleanup: drop every card's `grantedKeywordsUntilEot`. Returns
 * the same state object when nothing changed, mirroring
 * `clearUntilEndOfTurnPT`.
 */
export function clearGrantedKeywordsUntilEot(state: GameState): GameState {
  let cards: GameState["cards"] | null = null;
  for (const [id, card] of state.cards) {
    if (!card.grantedKeywordsUntilEot) continue;
    cards ??= new Map(state.cards);
    cards.set(id, { ...card, grantedKeywordsUntilEot: undefined });
  }
  return cards ? { ...state, cards } : state;
}