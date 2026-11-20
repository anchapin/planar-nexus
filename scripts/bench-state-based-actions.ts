/**
 * Issue #2419: micro-benchmark for the state-based-action (SBA) hot path.
 *
 *   npx tsx scripts/bench-state-based-actions.ts [--passes 200] [--trials 5]
 *
 * The engine copies whole state maps (`new Map(state.cards)`,
 * `new Map(state.players)`, ...) on every action, which is the main cost for
 * simulation-heavy use (AI lookahead, replays, differential testing). This
 * script measures one fixed mid-game state so before/after numbers are
 * directly comparable:
 *
 *   - run it on the current tree,
 *   - `git stash -u`, run it again on the unmodified code,
 *   - `git stash pop`.
 *
 * It prints ms/action (milliseconds per SBA pass) for:
 *   1. `checkStateBasedActions` on a fixed mid-game board (the hot path this
 *      slice optimises), and
 *   2. `moveCardToZone` (measured for reference only — this slice does not
 *      migrate `keyword-actions/removal.ts` copy sites).
 *
 * Issue #2919 adds a third section:
 *   3. `resolveCombatDamage` on a fixed combat state with several unblocked
 *      and blocked attackers (the hot path the combat-damage slice
 *      optimises: one working players map per resolution instead of one
 *      copy per player-affecting event).
 *
 * Issue #2927 adds a fourth section:
 *   4. `activateAbility` on a fixed mid-game state, activating a
 *      multi-cost ability ({2}{G}, {T}, once-per-turn) so every cost
 *      step runs (the hot path the activateAbility slice optimises: one
 *      working cards map and one working players map per activation
 *      instead of one copy per cost step).
 */
import {
  createInitialGameState,
  createCardInstance,
  createToken,
  checkStateBasedActions,
  moveCardToZone,
  declareAttackers,
  declareBlockers,
  resolveCombatDamage,
  activateAbility,
  addMana,
  Phase,
  ZoneType,
  type CardInstance,
  type CardInstanceId,
  type GameState,
  type PlayerId,
  type ScryfallCard,
} from "@/lib/game-state";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function makeCard(
  partial: Partial<ScryfallCard> & { name: string },
): ScryfallCard {
  return {
    id: `bench-${partial.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name: partial.name,
    type_line: partial.type_line ?? "Creature — Bench",
    power: partial.power ?? "2",
    toughness: partial.toughness ?? "2",
    oracle_text: partial.oracle_text ?? "",
    mana_cost: partial.mana_cost ?? "{1}{W}",
    cmc: partial.cmc ?? 2,
    colors: partial.colors ?? ["W"],
    color_identity: partial.color_identity ?? ["W"],
    legalities: { standard: "legal", commander: "legal" },
    layout: "normal",
    ...partial,
  } as ScryfallCard;
}

/** A handful of creature/enchantment shapes so the SBA scan has real work. */
const CREATURE_CARDS = [
  makeCard({ name: "Grizzly Bears", power: "2", toughness: "2" }),
  makeCard({ name: "Hill Giant", power: "3", toughness: "3" }),
  makeCard({
    name: "Giant Growth",
    type_line: "Enchantment",
    power: undefined,
    toughness: undefined,
  }),
  makeCard({
    name: "Banner of Kinship",
    type_line: "Enchantment — Aura",
    power: undefined,
    toughness: undefined,
    oracle_text: "Other creatures you control get +1/+1.",
  }),
  makeCard({
    name: "Swiftfoot Boots",
    type_line: "Artifact — Equipment",
    power: undefined,
    toughness: undefined,
    oracle_text: "Equipped creature has haste.",
  }),
  makeCard({
    name: "Serra Angel",
    type_line: "Legendary Creature — Angel",
    power: "4",
    toughness: "4",
    oracle_text: "Other creatures you control get +1/+1.",
  }),
  makeCard({
    name: "Tidewalker Mage",
    type_line: "Creature — Merfolk Wizard",
    power: "2",
    toughness: "3",
    oracle_text:
      "Whenever you cast a spell, this creature gets +1/+0 until end of turn.",
  }),
  makeCard({
    name: "Forest",
    type_line: "Land",
    power: undefined,
    toughness: undefined,
    oracle_text: "",
  }),
];

const LANDS = 6;
const CREATURES_PER_PLAYER = 10;

/**
 * The token shape put on the fixed board (issue #2936).
 *
 * The CR 704.5d token-cease block only runs when the board holds a token,
 * so the fixed mid-game board carries one per player: the block then
 * walks the token list on every SBA pass. Before #2936 that walk also
 * copied the whole cards map and the whole zones map.
 */
const TOKEN_CARD = makeCard({
  name: "Bench Soldier",
  type_line: "Token Creature — Soldier",
  power: "1",
  toughness: "1",
  mana_cost: "",
  cmc: 0,
});

/**
 * Build a fixed mid-game state: two players, a full-ish board, hands,
 * libraries and graveyards. Deterministic — no RNG, no wall-clock input.
 */
export function buildMidGameState(): {
  state: GameState;
  moverId: PlayerId;
} {
  const state = createInitialGameState(["Alice", "Bob"], 20, false);
  const playerIds = Array.from(state.players.keys());

  for (const playerId of playerIds) {
    const battlefieldKey = `${playerId}-${ZoneType.BATTLEFIELD}`;
    const handKey = `${playerId}-${ZoneType.HAND}`;
    const libraryKey = `${playerId}-${ZoneType.LIBRARY}`;
    const graveyardKey = `${playerId}-${ZoneType.GRAVEYARD}`;
    const battlefield = state.zones.get(battlefieldKey)!;
    const hand = state.zones.get(handKey)!;
    const library = state.zones.get(libraryKey)!;
    const graveyard = state.zones.get(graveyardKey)!;

    const battlefieldIds: string[] = [];
    const handIds: string[] = [];
    const libraryIds: string[] = [];
    const graveyardIds: string[] = [];

    for (let i = 0; i < LANDS; i++) {
      const land = createCardInstance(
        CREATURE_CARDS[CREATURE_CARDS.length - 1],
        playerId,
        playerId,
        { currentZoneKey: battlefieldKey },
      );
      state.cards.set(land.id, land);
      battlefieldIds.push(land.id);
    }

    for (let i = 0; i < CREATURES_PER_PLAYER; i++) {
      const cardData = CREATURE_CARDS[i % (CREATURE_CARDS.length - 1)];
      const creature = createCardInstance(cardData, playerId, playerId, {
        currentZoneKey: battlefieldKey,
        counters:
          i === 0
            ? [
                { type: "+1/+1", count: 2 },
                { type: "-1/-1", count: 1 },
              ]
            : [],
      });
      state.cards.set(creature.id, creature);
      battlefieldIds.push(creature.id);
    }

    // One battlefield token per player (issue #2936): the CR 704.5d
    // token-cease block only runs when the board holds a token.
    const token = {
      ...createToken(TOKEN_CARD, playerId, playerId),
      currentZoneKey: battlefieldKey,
    };
    state.cards.set(token.id, token);
    battlefieldIds.push(token.id);

    for (let i = 0; i < 5; i++) {
      const card = createCardInstance(
        CREATURE_CARDS[i % CREATURE_CARDS.length],
        playerId,
        playerId,
        { currentZoneKey: handKey },
      );
      state.cards.set(card.id, card);
      handIds.push(card.id);
    }

    for (let i = 0; i < 30; i++) {
      const card = createCardInstance(
        CREATURE_CARDS[i % CREATURE_CARDS.length],
        playerId,
        playerId,
        { currentZoneKey: libraryKey },
      );
      state.cards.set(card.id, card);
      libraryIds.push(card.id);
    }

    for (let i = 0; i < 3; i++) {
      const card = createCardInstance(
        CREATURE_CARDS[i % CREATURE_CARDS.length],
        playerId,
        playerId,
        { currentZoneKey: graveyardKey },
      );
      state.cards.set(card.id, card);
      graveyardIds.push(card.id);
    }

    state.zones.set(battlefieldKey, {
      ...battlefield,
      cardIds: battlefieldIds,
    });
    state.zones.set(handKey, { ...hand, cardIds: handIds });
    state.zones.set(libraryKey, { ...library, cardIds: libraryIds });
    state.zones.set(graveyardKey, { ...graveyard, cardIds: graveyardIds });
  }

  return { state, moverId: playerIds[0] };
}

/**
 * Creature shapes for the combat-damage measurement (issue #2919).
 *
 * They cover every player-affecting branch of `resolveCombatDamage`:
 * unblocked life loss, lifelink life gain, infect/toxic poison counters,
 * blocked damage, blocker lifelink and trample excess.
 */
const COMBAT_CARDS = [
  makeCard({ name: "Combat Bear", power: "3", toughness: "3" }),
  makeCard({
    name: "Combat Trampler",
    power: "4",
    toughness: "4",
    keywords: ["Trample"],
    oracle_text: "Trample",
  }),
  makeCard({
    name: "Combat Leech",
    power: "3",
    toughness: "3",
    keywords: ["Lifelink"],
    oracle_text: "Lifelink",
  }),
  makeCard({
    name: "Combat Plague",
    power: "2",
    toughness: "2",
    keywords: ["Infect", "Toxic"],
    oracle_text: "Infect. Toxic 1.",
  }),
  makeCard({ name: "Combat Grizzly", power: "2", toughness: "2" }),
  makeCard({
    name: "Combat Wall",
    power: "1",
    toughness: "1",
    keywords: ["Lifelink"],
    oracle_text: "Lifelink",
  }),
];

/**
 * Build a fixed combat state: Alice attacks Bob with six attackers, two of
 * which are blocked (one by a plain blocker, one by a lifelink blocker).
 * Deterministic — no RNG, no wall-clock input.
 */
export function buildCombatState(): { state: GameState } {
  let state = createInitialGameState(["Alice", "Bob"], 20, false);
  const playerIds = Array.from(state.players.keys());
  const aliceId = playerIds[0];
  const bobId = playerIds[1];

  const battlefieldKey = `${aliceId}-${ZoneType.BATTLEFIELD}`;
  const bobBattlefieldKey = `${bobId}-${ZoneType.BATTLEFIELD}`;

  const put = (
    cardData: ScryfallCard,
    ownerId: string,
    zoneKey: string,
  ): string => {
    const instance = createCardInstance(cardData, ownerId, ownerId, {
      currentZoneKey: zoneKey,
    });
    instance.hasSummoningSickness = false;
    state.cards.set(instance.id, instance);
    const battlefield = state.zones.get(zoneKey)!;
    state.zones.set(zoneKey, {
      ...battlefield,
      cardIds: [...battlefield.cardIds, instance.id],
    });
    return instance.id;
  };

  // Alice: four attackers (one per player-affecting branch) ...
  const bear = put(COMBAT_CARDS[0], aliceId, battlefieldKey);
  const trampler = put(COMBAT_CARDS[1], aliceId, battlefieldKey);
  const leech = put(COMBAT_CARDS[2], aliceId, battlefieldKey);
  const plague = put(COMBAT_CARDS[3], aliceId, battlefieldKey);
  // ... plus two attackers that will be blocked.
  const brawler = put(COMBAT_CARDS[0], aliceId, battlefieldKey);
  const bruiser = put(COMBAT_CARDS[0], aliceId, battlefieldKey);
  // Bob: one plain blocker and one lifelink blocker.
  const grizzly = put(COMBAT_CARDS[4], bobId, bobBattlefieldKey);
  const wall = put(COMBAT_CARDS[5], bobId, bobBattlefieldKey);

  state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
  const attackResult = declareAttackers(state, [
    { cardId: bear, defenderId: bobId },
    { cardId: trampler, defenderId: bobId },
    { cardId: leech, defenderId: bobId },
    { cardId: plague, defenderId: bobId },
    { cardId: brawler, defenderId: bobId },
    { cardId: bruiser, defenderId: bobId },
  ]);
  if (!attackResult.success) {
    throw new Error(`declareAttackers failed: ${attackResult.description}`);
  }
  state = attackResult.state;

  state.turn.currentPhase = Phase.DECLARE_BLOCKERS;
  const blockResult = declareBlockers(
    state,
    new Map([
      [trampler, [grizzly]],
      [brawler, [wall]],
    ]),
  );
  if (!blockResult.success) {
    throw new Error(`declareBlockers failed: ${blockResult.description}`);
  }
  state = blockResult.state;

  state.turn.currentPhase = Phase.COMBAT_DAMAGE;
  return { state };
}

/** Force the shared layer system into a clean state between measurements. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function bench(label: string, iterations: number, fn: () => void): number {
  // Warmup (JIT + lazy module init) — not measured.
  for (let i = 0; i < Math.max(1, Math.floor(iterations / 10)); i++) fn();

  const samples: number[] = [];
  for (let trial = 0; trial < 5; trial++) {
    const start = process.hrtime.bigint();
    for (let i = 0; i < iterations; i++) fn();
    const end = process.hrtime.bigint();
    samples.push(Number(end - start) / 1e6 / iterations);
  }
  const ms = median(samples);
  console.log(
    `${label}: ${ms.toFixed(4)} ms/action  (median of 5 trials x ${iterations} actions; samples: ${samples
      .map((s) => s.toFixed(4))
      .join(", ")})`,
  );
  return ms;
}

/**
 * Build the activation state for section 4 (issue #2927): a started game
 * whose first player controls a creature with a multi-cost activated
 * ability ({2}{G}, {T}, once-per-turn) and the mana to pay for it. The
 * same input state is activated repeatedly — the input is never mutated,
 * so every call pays the full cost path again.
 */
export function buildActivationState(): {
  state: GameState;
  playerId: PlayerId;
  cardId: CardInstanceId;
} {
  // Start from the fixed mid-game board so the cards/players maps the
  // activation used to copy per cost step are realistically sized.
  let { state } = buildMidGameState();
  const playerId = Array.from(state.players.keys())[0];
  const battlefieldKey = `${playerId}-${ZoneType.BATTLEFIELD}`;
  const cardData = makeCard({
    name: "Bench Multi Cat",
    type_line: "Creature — Cat",
    oracle_text:
      "{2}{G}, {T}: This creature gets +2/+2 until end of turn. Activate only once each turn.",
    mana_cost: "{2}{G}",
    cmc: 3,
  });
  const inst = createCardInstance(cardData, playerId, playerId, {
    currentZoneKey: battlefieldKey,
  });
  const cards = new Map(state.cards);
  cards.set(inst.id, { ...inst, hasSummoningSickness: false });
  const zones = new Map(state.zones);
  const zone = zones.get(battlefieldKey)!;
  zones.set(battlefieldKey, { ...zone, cardIds: [...zone.cardIds, inst.id] });
  state = {
    ...state,
    cards,
    zones,
    stack: [],
    priorityPlayerId: playerId,
    turn: {
      ...state.turn,
      activePlayerId: playerId,
      currentPhase: Phase.PRECOMBAT_MAIN,
    },
  };
  state = addMana(state, playerId, { green: 6 });
  return { state, playerId, cardId: inst.id };
}

function main(): void {
  const passes = Number(arg("passes", "200"));
  const { state, moverId } = buildMidGameState();

  console.log(
    `Fixed mid-game state: ${state.cards.size} cards, ${state.players.size} players, ${state.zones.size} zones`,
  );
  console.log(`SBA passes per measurement: ${passes}`);

  // 1. The hot path this slice optimises.
  const sbaMs = bench("checkStateBasedActions", passes, () => {
    const result = checkStateBasedActions(state);
    if (!result.state) throw new Error("no state returned");
  });

  // Sanity: the input state must not be mutated by an SBA pass.
  const before = state.cards.size;
  checkStateBasedActions(state);
  if (state.cards.size !== before) {
    throw new Error("input state was mutated by checkStateBasedActions");
  }

  // 2. Reference measurement (not optimised in this slice).
  const mover = Array.from(state.cards.values()).find(
    (c): c is CardInstance =>
      c.currentZoneKey?.endsWith(`-${ZoneType.BATTLEFIELD}`) === true &&
      c.cardData.type_line?.includes("Creature") === true,
  );
  if (mover) {
    bench("moveCardToZone (reference only)", passes, () => {
      const result = moveCardToZone(state, mover.id, "graveyard");
      if (!result.state) throw new Error("no state returned");
    });
  }

  console.log(
    `\nSummary: checkStateBasedActions = ${sbaMs.toFixed(4)} ms/action`,
  );

  // 3. The combat-damage hot path (issue #2919): one working players map
  //    per resolution instead of one copy per player-affecting event.
  const combatPasses = Number(arg("combat-passes", "100"));
  const { state: combatState } = buildCombatState();
  console.log(
    `Combat state: ${combatState.combat.attackers.length} attackers, ` +
      `${combatState.combat.blockers.size} blocked attackers`,
  );
  console.log(`Combat resolutions per measurement: ${combatPasses}`);

  const combatMs = bench("resolveCombatDamage", combatPasses, () => {
    const result = resolveCombatDamage(combatState);
    if (!result.state) throw new Error("no state returned");
  });

  // Sanity: the input state must not be mutated by a combat resolution.
  const beforeLife = combatState.players.get(
    Array.from(combatState.players.keys())[1],
  )!.life;
  resolveCombatDamage(combatState);
  const afterLife = combatState.players.get(
    Array.from(combatState.players.keys())[1],
  )!.life;
  if (afterLife !== beforeLife) {
    throw new Error("input state was mutated by resolveCombatDamage");
  }

  console.log(
    `\nSummary: checkStateBasedActions = ${sbaMs.toFixed(4)} ms/action, ` +
      `resolveCombatDamage = ${combatMs.toFixed(4)} ms/resolution`,
  );

  // 4. The activateAbility hot path (issue #2927): one working cards map
  //    and one working players map per activation instead of one copy
  //    per cost step.
  const activationPasses = Number(arg("activation-passes", "100"));
  const {
    state: activationState,
    playerId: activationPlayerId,
    cardId: activationCardId,
  } = buildActivationState();
  console.log(
    `Activation state: ${activationState.cards.size} cards, ` +
      `${activationState.players.size} players`,
  );
  console.log(`Activations per measurement: ${activationPasses}`);

  const activationMs = bench("activateAbility", activationPasses, () => {
    const result = activateAbility(
      activationState,
      activationPlayerId,
      activationCardId,
      0,
    );
    if (!result.success) throw new Error("activation failed");
  });

  // Sanity: the input state must not be mutated by an activation.
  if (activationState.cards.get(activationCardId)!.isTapped) {
    throw new Error("input state was mutated by activateAbility");
  }

  console.log(
    `\nSummary: checkStateBasedActions = ${sbaMs.toFixed(4)} ms/action, ` +
      `resolveCombatDamage = ${combatMs.toFixed(4)} ms/resolution, ` +
      `activateAbility = ${activationMs.toFixed(4)} ms/activation`,
  );
}

if (process.argv[1]?.endsWith("bench-state-based-actions.ts")) {
  main();
}
