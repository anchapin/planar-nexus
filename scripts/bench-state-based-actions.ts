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
 */
import {
  createInitialGameState,
  createCardInstance,
  checkStateBasedActions,
  moveCardToZone,
  ZoneType,
  type CardInstance,
  type GameState,
  type PlayerId,
  type ScryfallCard,
} from "@/lib/game-state";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function makeCard(partial: Partial<ScryfallCard> & { name: string }): ScryfallCard {
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
  makeCard({ name: "Giant Growth", type_line: "Enchantment", power: undefined, toughness: undefined }),
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
    oracle_text: "Whenever you cast a spell, this creature gets +1/+0 until end of turn.",
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
 * Build a fixed mid-game state: two players, a full-ish board, hands,
 * libraries and graveyards. Deterministic — no RNG, no wall-clock input.
 */
export function buildMidGameState(): {
  state: GameState;
  moverId: PlayerId;
} {
  let state = createInitialGameState(["Alice", "Bob"], 20, false);
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

    state.zones.set(battlefieldKey, { ...battlefield, cardIds: battlefieldIds });
    state.zones.set(handKey, { ...hand, cardIds: handIds });
    state.zones.set(libraryKey, { ...library, cardIds: libraryIds });
    state.zones.set(graveyardKey, { ...graveyard, cardIds: graveyardIds });
  }

  return { state, moverId: playerIds[0] };
}

/** Force the shared layer system into a clean state between measurements. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function bench(
  label: string,
  iterations: number,
  fn: () => void,
): number {
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

  console.log(`\nSummary: checkStateBasedActions = ${sbaMs.toFixed(4)} ms/action`);
}

if (process.argv[1]?.endsWith("bench-state-based-actions.ts")) {
  main();
}
