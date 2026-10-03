/**
 * Blitz end-step sacrifice (CR 702.152a, issue #2462): a creature cast for its
 * blitz cost is sacrificed when the next end step's trigger resolves.
 */
import { createInitialGameState, startGame, passPriority } from "../game-state";
import { createCardInstance } from "../card-instance";
import { Phase } from "../types";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";

const HENCHFIEND = {
  id: "mock-henchfiend",
  name: "Henchfiend",
  type_line: "Creature \u2014 Ogre Warrior",
  oracle_text: "Blitz {2}{R}",
  mana_cost: "{4}{R}{R}",
  cmc: 6,
  colors: ["R"],
  color_identity: ["R"],
  keywords: [],
  legalities: { standard: "legal" },
  layout: "normal",
  power: "5",
  toughness: "4",
} as unknown as ScryfallCard;

function setup(blitz: boolean): {
  state: GameState;
  p1: PlayerId;
  id: CardInstanceId;
} {
  const state = startGame(createInitialGameState(["Alice", "Bob"], 20, false));
  const [p1] = Array.from(state.players.keys());
  const key = `${p1}-battlefield`;
  const card = createCardInstance(HENCHFIEND, p1, p1, { currentZoneKey: key });
  card.blitz = blitz ? true : undefined;
  state.cards.set(card.id, card);
  const bf = state.zones.get(key)!;
  state.zones.set(key, { ...bf, cardIds: [...bf.cardIds, card.id] });
  state.status = "in_progress";
  state.turn.activePlayerId = p1;
  state.priorityPlayerId = p1;
  state.turn.currentPhase = Phase.POSTCOMBAT_MAIN;
  state.stack = [];
  return { state, p1, id: card.id };
}

/** Pass priority until the turn reaches cleanup (end step fully resolved). */
function runThroughEndStep(state: GameState): GameState {
  let s = state;
  for (let i = 0; i < 12 && s.turn.currentPhase !== Phase.CLEANUP; i++) {
    s = passPriority(s, s.priorityPlayerId!);
  }
  return s;
}

describe("blitz end-step sacrifice (#2462)", () => {
  it("sacrifices a blitzed creature at the beginning of the end step", () => {
    const { state, p1, id } = setup(true);
    const after = runThroughEndStep(state);
    expect(after.turn.currentPhase).toBe(Phase.CLEANUP);
    expect(after.zones.get(`${p1}-battlefield`)!.cardIds).not.toContain(id);
    expect(after.zones.get(`${p1}-graveyard`)!.cardIds).toContain(id);
  });

  it("leaves a creature that was not blitzed on the battlefield", () => {
    const { state, p1, id } = setup(false);
    const after = runThroughEndStep(state);
    expect(after.turn.currentPhase).toBe(Phase.CLEANUP);
    expect(after.zones.get(`${p1}-battlefield`)!.cardIds).toContain(id);
    expect(after.zones.get(`${p1}-graveyard`)!.cardIds).not.toContain(id);
  });
});
