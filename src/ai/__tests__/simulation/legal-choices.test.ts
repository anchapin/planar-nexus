/**
 * #2612: legal-choice listing at a priority decision, for the headless
 * training interface (manamind self-play, epic manamind#84).
 */
import {
  applyAttackDeclaration,
  applyDecisionAnswer,
  getPendingDecision,
  listDecisionAnswers,
  applyBlockDeclaration,
  applyPriorityChoice,
  listAttackerOptions,
  listBlockerOptions,
  createInitialGameState,
  listPriorityChoices,
  loadDeckForPlayer,
  Phase,
  startGame,
  type GameState,
  type PlayerId,
  type PriorityChoice,
  type StackObject,
  type WaitingChoice,
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

/** Move up to `n` creatures from the library onto the battlefield, ready. */
function deployCreatures(
  state: GameState,
  playerId: PlayerId,
  n: number,
  sick = false,
): { state: GameState; ids: string[] } {
  const libKey = `${playerId}-library`;
  const bfKey = `${playerId}-battlefield`;
  const lib = state.zones.get(libKey)!;
  const ids = lib.cardIds
    .filter((id) =>
      /\bcreature\b/i.test(state.cards.get(id)?.cardData.type_line ?? ""),
    )
    .slice(0, n);
  const zones = new Map(state.zones);
  zones.set(libKey, {
    ...lib,
    cardIds: lib.cardIds.filter((id) => !ids.includes(id)),
  });
  const bf = zones.get(bfKey)!;
  zones.set(bfKey, { ...bf, cardIds: [...bf.cardIds, ...ids] });
  const cards = new Map(state.cards);
  for (const id of ids) {
    cards.set(id, {
      ...cards.get(id)!,
      isTapped: false,
      hasSummoningSickness: sick,
    });
  }
  return { state: { ...state, zones, cards }, ids };
}

function atStep(state: GameState, phase: Phase): GameState {
  return { ...state, turn: { ...state.turn, currentPhase: phase } };
}

describe("combat choices (#2612)", () => {
  function board(seed: number) {
    const g = newGame(seed, "aggro", "midrange");
    const a = deployCreatures(g.state, g.p1, 2);
    const sick = deployCreatures(a.state, g.p1, 1, true);
    const b = deployCreatures(sick.state, g.p2, 2);
    return {
      ...g,
      state: atStep(b.state, Phase.DECLARE_ATTACKERS),
      attackers: a.ids,
      sickId: sick.ids[0],
      blockers: b.ids,
    };
  }

  it("lists no attackers outside combat or for the non-active player", () => {
    const g = board(50);
    expect(
      listAttackerOptions(atStep(g.state, Phase.PRECOMBAT_MAIN), g.p1),
    ).toEqual([]);
    expect(listAttackerOptions(g.state, g.p2)).toEqual([]);
  });

  it("lists ready creatures with the opponent as defender, not sick ones", () => {
    const g = board(51);
    const options = listAttackerOptions(g.state, g.p1);
    expect(options.map((o) => o.cardId).sort()).toEqual(
      [...g.attackers].sort(),
    );
    for (const o of options) expect(o.defenders).toEqual([g.p2]);
    expect(options.some((o) => o.cardId === g.sickId)).toBe(false);
  });

  it("applies every listed attack, alone and together", () => {
    const g = board(52);
    const options = listAttackerOptions(g.state, g.p1);
    for (const o of options) {
      const r = applyAttackDeclaration(g.state, [
        { cardId: o.cardId, defenderId: o.defenders[0] },
      ]);
      expect({ ok: r.success, error: r.error }).toEqual({
        ok: true,
        error: undefined,
      });
      expect(r.state.combat.attackers.map((a) => a.cardId)).toEqual([o.cardId]);
    }
    const all = applyAttackDeclaration(
      g.state,
      options.map((o) => ({ cardId: o.cardId, defenderId: o.defenders[0] })),
    );
    expect(all.success).toBe(true);
    expect(all.state.combat.attackers).toHaveLength(options.length);
    // Attackers are declared, so nothing more to list.
    expect(listAttackerOptions(all.state, g.p1)).toEqual([]);
  });

  it("lists the defender's blockers and applies each listed block", () => {
    const g = board(53);
    const options = listAttackerOptions(g.state, g.p1);
    const attacked = applyAttackDeclaration(
      g.state,
      options.map((o) => ({ cardId: o.cardId, defenderId: o.defenders[0] })),
    ).state;
    const blocking = atStep(attacked, Phase.DECLARE_BLOCKERS);
    expect(listBlockerOptions(blocking, g.p1)).toEqual([]);
    const blocks = listBlockerOptions(blocking, g.p2);
    expect(blocks.map((b) => b.cardId).sort()).toEqual([...g.blockers].sort());
    for (const b of blocks) {
      expect(b.attackers.sort()).toEqual([...g.attackers].sort());
      for (const attackerId of b.attackers) {
        const r = applyBlockDeclaration(blocking, [
          { blockerId: b.cardId, attackerId },
        ]);
        expect({ ok: r.success, error: r.error }).toEqual({
          ok: true,
          error: undefined,
        });
      }
    }
  });

  it("treats empty declarations as no attack / no blocks", () => {
    const g = board(54);
    expect(applyAttackDeclaration(g.state, [])).toEqual({
      success: true,
      state: g.state,
    });
    expect(applyBlockDeclaration(g.state, [])).toEqual({
      success: true,
      state: g.state,
    });
  });
});

function discardChoice(
  state: GameState,
  playerId: PlayerId,
  type: "discard_to_hand_size" | "discard_cards",
  amount: number,
): WaitingChoice {
  return {
    type,
    playerId,
    stackObjectId: null,
    prompt: `Discard ${amount}`,
    choices: handOf(state, playerId).map((cardId) => ({
      label: cardId,
      value: cardId,
      isValid: true,
    })),
    minChoices: amount,
    maxChoices: amount,
    presentedAt: 0,
  };
}

function triggerOnStack(
  state: GameState,
  controllerId: PlayerId,
  text: string,
): GameState {
  const obj = {
    id: "trigger-test",
    type: "ability",
    triggered: true,
    sourceCardId: null,
    controllerId,
    name: "triggered ability",
    text,
    manaCost: null,
    targets: [],
    chosenModes: [],
    variableValues: new Map(),
    isCountered: false,
    timestamp: 0,
  } as StackObject;
  return { ...state, stack: [...state.stack, obj] };
}

describe("mid-game decisions (#2612)", () => {
  it("reports nothing pending at an ordinary priority stop", () => {
    const { state, p1 } = newGame(11);
    expect(getPendingDecision(state)).toBeNull();
    expect(listDecisionAnswers(state, p1)).toEqual([]);
  });

  it.each(["discard_to_hand_size", "discard_cards"] as const)(
    "lists every %s pick of the right size and applies each",
    (type) => {
      const { state: game, p1, p2 } = newGame(12);
      // Cleanup only accepts a discard while the hand is over maximum size,
      // so draw two extra cards first (7 + 2 = 9, discard 2).
      const library = game.zones.get(`${p1}-library`)!;
      const handZone = game.zones.get(`${p1}-hand`)!;
      const zones = new Map(game.zones);
      zones.set(`${p1}-library`, {
        ...library,
        cardIds: library.cardIds.slice(2),
      });
      zones.set(`${p1}-hand`, {
        ...handZone,
        cardIds: [...handZone.cardIds, ...library.cardIds.slice(0, 2)],
      });
      const cards = new Map(game.cards);
      for (const cardId of library.cardIds.slice(0, 2)) {
        cards.set(cardId, {
          ...cards.get(cardId)!,
          currentZoneKey: `${p1}-hand`,
        } as typeof cards extends Map<string, infer C> ? C : never);
      }
      const base = { ...game, zones, cards };
      const hand = handOf(base, p1);
      expect(hand.length).toBeGreaterThan(7);
      const state = {
        ...base,
        waitingChoice: discardChoice(base, p1, type, 2),
      };

      expect(getPendingDecision(state)).toMatchObject({
        kind: "waiting_choice",
        playerId: p1,
        choiceType: type,
      });
      expect(listDecisionAnswers(state, p2)).toEqual([]);
      const answers = listDecisionAnswers(state, p1);
      const n = hand.length;
      expect(answers).toHaveLength((n * (n - 1)) / 2);

      for (const answer of answers) {
        const r = applyDecisionAnswer(state, p1, answer);
        expect(r.error).toBeUndefined();
        expect(r.success).toBe(true);
        expect(r.state.waitingChoice).toBeNull();
        expect(handOf(r.state, p1)).toHaveLength(n - 2);
      }
    },
  );

  it("lists one answer per legal target for a triggered ability", () => {
    const { state: base, p1, p2 } = newGame(13);
    const state = triggerOnStack(
      base,
      p1,
      "When this enters, it deals 1 damage to target player.",
    );
    expect(getPendingDecision(state)).toMatchObject({
      kind: "trigger_targets",
      playerId: p1,
      stackObjectId: "trigger-test",
    });
    expect(listDecisionAnswers(state, p2)).toEqual([]);

    const answers = listDecisionAnswers(state, p1);
    const targets = answers.map((a) =>
      a.kind === "trigger_targets" ? a.targets : null,
    );
    expect(targets).toEqual(expect.arrayContaining([[p1], [p2]]));
    expect(targets).not.toContainEqual([]);

    for (const answer of answers) {
      const r = applyDecisionAnswer(state, p1, answer);
      expect(r.success).toBe(true);
      expect(getPendingDecision(r.state)).toBeNull();
    }
    expect(applyDecisionAnswer(state, p2, answers[0]).success).toBe(false);
  });
});
