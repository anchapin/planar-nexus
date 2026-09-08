/**
 * Engine → AI game-state adapter.
 *
 * Extracted verbatim from `src/app/(app)/game/[id]/page.tsx` (issue #1715).
 *
 * `convertToAIGameState` maps the engine's `GameState` onto the unified
 * AI-evaluation format consumed by `GameStateEvaluator` and
 * `CombatDecisionTree`.
 *
 * NOTE: the engine also ships a canonical `engineToAIState()` converter
 * (`@/lib/game-state`, serialization module). Its output differs in a few
 * observable details (priority fallback, phase mapping via PHASE_MAPPING +
 * step, battlefield typing order). This adapter preserves the exact mapping
 * the single-player page used inline, per the behavior-preserving mandate of
 * #1715; unifying the two converters is deliberately left as follow-up work.
 */

import type { GameState } from "@/lib/game-state";
import type {
  GameState as AIGameState,
  PlayerState,
  TurnInfo,
} from "@/ai/game-state-evaluator";

/**
 * Convert engine GameState to AI-evaluable format
 */
export function convertToAIGameState(
  engineState: GameState,
  evaluatingPlayerId: string,
): AIGameState {
  const players: { [key: string]: PlayerState } = {};

  engineState.players.forEach((player, playerId) => {
    const battlefield = Array.from(engineState.cards.values())
      .filter((card) => {
        const zone = engineState.zones.get(`${playerId}-battlefield`);
        return zone?.cardIds.includes(card.id);
      })
      .map((card) => {
        const typeLine = card.cardData.type_line.toLowerCase();
        let permanentType:
          "creature" | "land" | "artifact" | "enchantment" | "planeswalker" =
          "creature";
        if (typeLine.includes("land")) permanentType = "land";
        else if (typeLine.includes("artifact")) permanentType = "artifact";
        else if (typeLine.includes("enchantment"))
          permanentType = "enchantment";
        else if (typeLine.includes("planeswalker"))
          permanentType = "planeswalker";
        else if (typeLine.includes("creature")) permanentType = "creature";

        return {
          id: card.id,
          cardInstanceId: card.id,
          name: card.cardData.name,
          type: permanentType,
          controller: card.controllerId,
          tapped: card.isTapped,
          power: card.cardData.power ? parseInt(card.cardData.power) : 0,
          toughness: card.cardData.toughness
            ? parseInt(card.cardData.toughness)
            : 0,
          manaValue: card.cardData.cmc,
        };
      });

    const handZone = engineState.zones.get(`${playerId}-hand`);
    const handCards =
      handZone?.cardIds.map((id) => {
        const card = engineState.cards.get(id);
        return {
          cardInstanceId: card?.id || "",
          name: card?.cardData.name || "Unknown",
          type: card?.cardData.type_line || "Unknown",
          manaValue: card?.cardData.cmc || 0,
        };
      }) || [];

    const graveyardZone = engineState.zones.get(`${playerId}-graveyard`);
    const libraryZone = engineState.zones.get(`${playerId}-library`);

    players[playerId] = {
      id: playerId,
      life: player.life,
      poisonCounters: player.poisonCounters,
      commanderDamage: Object.fromEntries(player.commanderDamage),
      hand: handCards,
      graveyard: graveyardZone?.cardIds || [],
      exile: [],
      library: libraryZone?.cardIds.length || 0,
      battlefield,
      manaPool: {
        W: player.manaPool.white,
        U: player.manaPool.blue,
        B: player.manaPool.black,
        R: player.manaPool.red,
        G: player.manaPool.green,
        C: player.manaPool.colorless,
      },
    };
  });

  // Convert combat state
  const combat = {
    inCombatPhase: engineState.combat.inCombatPhase,
    attackers: engineState.combat.attackers.map((a) => ({
      cardInstanceId: a.cardId,
      defenderId: a.defenderId,
      isAttackingPlaneswalker: a.isAttackingPlaneswalker,
      damageToDeal: a.damageToDeal,
      hasFirstStrike: a.hasFirstStrike,
      hasDoubleStrike: a.hasDoubleStrike,
    })),
    blockers: Object.fromEntries(
      Array.from(engineState.combat.blockers.entries()).map(
        ([attackerId, blockers]) => [
          attackerId,
          blockers.map((b) => ({
            cardInstanceId: b.cardId,
            attackerId: b.attackerId,
            damageToDeal: b.damageToDeal,
            blockerOrder: b.blockerOrder,
            hasFirstStrike: b.hasFirstStrike,
            hasDoubleStrike: b.hasDoubleStrike,
          })),
        ],
      ),
    ),
  };

  return {
    players,
    turnInfo: {
      currentTurn: engineState.turn.turnNumber,
      currentPlayer: engineState.turn.activePlayerId,
      phase: engineState.turn.currentPhase as TurnInfo["phase"],
      priority: engineState.priorityPlayerId || "",
    },
    stack: engineState.stack.map((s) => {
      const sourceCard = s.sourceCardId
        ? engineState.cards.get(s.sourceCardId)
        : null;
      return {
        id: s.id,
        cardInstanceId: s.sourceCardId || "",
        name: sourceCard?.cardData.name || s.name,
        controller: s.controllerId,
        type: s.type,
        manaValue: sourceCard?.cardData.cmc || 0,
      };
    }),
    combat,
  };
}
