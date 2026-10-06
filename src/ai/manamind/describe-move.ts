/**
 * Plain-language labels for simple-ruleset moves, for the simple-mode screen
 * (#2557). Labels name cards rather than battlefield indices.
 */
import type { SimpleGameState, SimpleMove } from "./simple-rules";

function names(
  state: SimpleGameState,
  player: 0 | 1,
  indices: number[],
): string {
  return indices
    .map((i) => state.players[player].battlefield[i]?.name ?? `#${i}`)
    .join(", ");
}

export function describeSimpleMove(
  state: SimpleGameState,
  move: SimpleMove,
): string {
  switch (move.type) {
    case "play_land":
      return `Play ${move.card}`;
    case "cast_spell": {
      const card = state.players[move.player].hand.find(
        (c) => c.name === move.card,
      );
      return card
        ? `Cast ${card.name} (${card.cmc} mana, ${card.power}/${card.toughness})`
        : `Cast ${move.card}`;
    }
    case "declare_attackers":
      return move.attackers.length === 0
        ? "Don't attack"
        : `Attack with ${names(state, move.player, move.attackers)}`;
    case "declare_blockers": {
      const attacker = state.activePlayer;
      const pairs = Object.entries(move.blockers);
      if (pairs.length === 0) return "No blocks";
      return pairs
        .map(
          ([a, bs]) =>
            `Block ${names(state, attacker, [Number(a)])} with ${names(state, move.player, bs)}`,
        )
        .join("; ");
    }
    case "pass_priority":
      if (state.phase === "combat" && move.player !== state.activePlayer) {
        return "No blocks";
      }
      return state.phase === "combat" ? "Don't attack" : "Pass";
  }
}
