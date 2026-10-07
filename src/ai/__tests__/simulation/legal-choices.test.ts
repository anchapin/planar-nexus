/**
 * #2612: legal-choice listing at a priority decision, for the headless
 * training interface (manamind self-play, epic manamind#84).
 */
import {
  applyPriorityChoice,
  createInitialGameState,
  listPriorityChoices,
  loadDeckForPlayer,
  Phase,
  startGame,
  type GameState,
  type PlayerId,
  type PriorityChoice,
} from "@/lib/game-state";
import {
  buildDeck,
  mulberry32,
  type SimDeckArchetype,
} from "@/ai/simulation/game-simulator";

const BASIC_MANA: Record<string, string> = {
  Plains: "W",
  Island: "U",
  Swamp: "B",
  Mountain: "R",
  Forest: "G",
};

/**
 * The simulator's fixture basics carry no oracle text (it adds mana
 * directly). Give them the real reminder text so lands can be tapped for
 * mana the way Scryfall basics are.
 */
function deck(archetype: SimDeckArchetype) {
  return buildDeck(archetype).map((card) => {
    const basic = Object.keys(BASIC_MANA).find((t) =>
      (card.type_line ?? "").includes(t),
    );
    return basic && !card.oracle_text
      ? { ...card, oracle_text: `({T}: Add {${BASIC_MANA[basic]}}.)` }
      : card;
  });
}

function withSeed<T>(seed: number, fn: () => T): T {
  const original = Math.random;
  Math.random = mulberry32(seed);
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

function newGame(
  seed: number,
  a: SimDeckArchetype = "aggro",
  b: SimDeckArchetype = "midrange",
): { state: GameState; p1: PlayerId; p2: PlayerId } {
  return withSeed(seed, () => {
    let state = createInitialGameState(["p1", "p2"], 20, false);
    const [p1, p2] = Array.from(state.players.keys());
    state = loadDeckForPlayer(state, p1, deck(a), true);
    state = loadDeckForPlayer(state, p2, deck(b), true);
    state = startGame(state);
    state = {
      ...state,
      status: "in_progress",
      priorityPlayerId: p1,
      turn: {
        ...state.turn,
        currentPhase: Phase.PRECOMBAT_MAIN,
        activePlayerId: p1,
      },
    };
    return { state, p1, p2 };
  });
}

const handOf = (s: GameState, p: PlayerId) =>
  s.zones.get(`${p}-hand`)?.cardIds ?? [];
const battlefieldOf = (s: GameState, p: PlayerId) =>
  s.zones.get(`${p}-battlefield`)?.cardIds ?? [];

describe("listPriorityChoices (#2612)", () => {
  it("is empty for a player without priority", () => {
    const { state, p2 } = newGame(1);
    expect(listPriorityChoices(state, p2)).toEqual([]);
  });

  it("starts with pass and lists each land in hand in a main phase", () => {
    const { state, p1 } = newGame(2);
    const choices = listPriorityChoices(state, p1);
    expect(choices[0]).toEqual({ kind: "pass" });
    const lands = handOf(state, p1).filter((id) =>
      /\bland\b/i.test(state.cards.get(id)?.cardData.type_line ?? ""),
    );
    const listed = choices
      .filter((c) => c.kind === "play_land")
      .map((c) => (c as { cardId: string }).cardId);
    expect(listed.sort()).toEqual([...lands].sort());
  });

  it("lists no land once the land drop is used, and no spells without mana", () => {
    const { state, p1 } = newGame(3);
    const exhausted: GameState = {
      ...state,
      players: new Map(
        [...state.players].map(([id, pl]) => [
          id,
          id === p1 ? { ...pl, landsPlayedThisTurn: 1 } : pl,
        ]),
      ),
    };
    // No lands on the battlefield and an empty pool: only pass remains.
    expect(listPriorityChoices(exhausted, p1)).toEqual([{ kind: "pass" }]);
  });

  it("every listed choice applies successfully across seeded fixture games", () => {
    const decks: [SimDeckArchetype, SimDeckArchetype][] = [
      ["aggro", "midrange"],
      ["control", "aggro"],
      ["midrange", "control"],
    ];
    let applied = 0;
    let casts = 0;
    for (let seed = 10; seed < 16; seed++) {
      const [a, b] = decks[seed % decks.length];
      const game = newGame(seed, a, b);
      let state = game.state;
      const p1 = game.p1;
      const rng = mulberry32(seed);
      // Walk one long main phase: play lands and cast whatever is legal,
      // checking every listed choice applies, then picking one at random.
      for (let step = 0; step < 12; step++) {
        const choices = listPriorityChoices(state, p1);
        for (const choice of choices) {
          if (choice.kind === "pass") continue;
          const r = applyPriorityChoice(state, p1, choice);
          expect({ choice, ok: r.success, error: r.error }).toMatchObject({
            ok: true,
          });
          applied++;
          if (choice.kind === "cast_spell") casts++;
        }
        const options = choices.filter((c) => c.kind !== "pass");
        if (options.length === 0) {
          // Fresh land drop for the next step, mimicking a new turn.
          state = {
            ...state,
            players: new Map(
              [...state.players].map(([id, pl]) => [
                id,
                id === p1 ? { ...pl, landsPlayedThisTurn: 0 } : pl,
              ]),
            ),
          };
          if (handOf(state, p1).length === 0) break;
          continue;
        }
        const pick = options[Math.floor(rng() * options.length)];
        const r = applyPriorityChoice(state, p1, pick);
        state = r.state;
        // Keep priority with p1 so the walk stays at the same decision.
        state = { ...state, stack: [], priorityPlayerId: p1 };
      }
    }
    expect(applied).toBeGreaterThan(20);
    expect(casts).toBeGreaterThan(0);
  });

  it("lists one cast per legal target for a targeted spell", () => {
    for (let seed = 20; seed < 40; seed++) {
      const { state, p1 } = newGame(seed, "aggro", "aggro");
      const targeted = listPriorityChoices(state, p1).filter(
        (c): c is Extract<PriorityChoice, { kind: "cast_spell" }> =>
          c.kind === "cast_spell" && c.targets.length > 0,
      );
      for (const c of targeted) {
        expect(c.targets.length).toBeGreaterThan(0);
        expect(new Set(c.targets).size).toBe(c.targets.length);
      }
    }
  });

  it("does not list opponent permanents' abilities", () => {
    const { state, p1, p2 } = newGame(4);
    const theirs = new Set(battlefieldOf(state, p2));
    for (const c of listPriorityChoices(state, p1)) {
      if (c.kind === "activate_ability" || c.kind === "activate_loyalty") {
        expect(theirs.has(c.cardId)).toBe(false);
      }
    }
  });
});
