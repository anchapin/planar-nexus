/**
 * anchapin/manamind#86: the Forge-pointer input builder matches manamind's
 * `forge_pointer_onnx.pack` exactly. The v2 fixture is that `pack` (schema
 * v2) run on manamind's own test decisions, plus an empty decision and one
 * with an unknown phase, a hybrid cost, and a non-ASCII card name; the
 * priority case carries deck identity (deck "red" / opp_deck "green",
 * manamind #96). The v3 fixture (manamind #44) is the schema v3 pack on a
 * priority decision carrying an `OpponentHistorySummary`; decisions without
 * history pack unchanged, so the v2 cases still match input for input.
 */
import v2fixture from "./fixtures/forge_pointer_v2_pack.json";
import v3fixture from "./fixtures/forge_pointer_v3_pack.json";
import {
  CARD_FEATURES,
  deckBucket,
  FORGE_POINTER_INPUTS,
  FORGE_POINTER_SCHEMA_VERSION,
  GLOBAL_FEATURES,
  nameBucket,
  HISTORY_FEATURES,
  historyFeatures,
  packDecision,
  type ForgeDecision,
  type ForgePointerInputName,
  type PackedInput,
} from "../forge-pointer-features";
import { playerView } from "@/ai/simulation/player-view";
import {
  TrainingSession,
  trainingDeck,
} from "@/ai/simulation/training-session";

type FixtureCase = {
  name: string;
  decision: ForgeDecision;
  inputs: Record<string, { dims: number[]; data: number[] }>;
};

function expectParity(
  packed: Record<ForgePointerInputName, PackedInput>,
  want: FixtureCase["inputs"],
  names: readonly string[],
) {
  for (const name of names) {
    const got = packed[name as ForgePointerInputName];
    const expected = want[name];
    expect([name, got.dims]).toEqual([name, expected.dims]);
    const values = Array.from(got.data, Number);
    expect(values).toHaveLength(expected.data.length);
    values.forEach((v, i) => expect(v).toBeCloseTo(expected.data[i], 6));
  }
}

describe("forge pointer features", () => {
  it("uses manamind's schema version and input order", () => {
    expect(v3fixture.schema_version).toBe(FORGE_POINTER_SCHEMA_VERSION);
    expect(v3fixture.input_names).toEqual([...FORGE_POINTER_INPUTS]);
  });

  it("hashes card names into the same buckets", () => {
    for (const [name, bucket] of Object.entries(v3fixture.name_buckets)) {
      expect(nameBucket(name)).toBe(bucket);
    }
  });

  it("hashes deck names into the same buckets", () => {
    for (const [name, bucket] of Object.entries(v3fixture.deck_buckets)) {
      expect(deckBucket(name)).toBe(bucket);
    }
  });

  it.each(v2fixture.cases.map((c) => [c.name, c] as const))(
    "packs the %s decision exactly like manamind",
    (_name, c) => {
      const packed = packDecision(c.decision as ForgeDecision);
      // The v2 fixture predates the hist input (manamind #44): compare
      // every input it carries, all of which pack unchanged at schema v3.
      expectParity(packed, c.inputs, Object.keys(c.inputs));
    },
  );

  it("packs the history decision exactly like manamind", () => {
    const c = v3fixture.cases[0];
    const packed = packDecision(c.decision as unknown as ForgeDecision);
    expectParity(packed, c.inputs, FORGE_POINTER_INPUTS);
  });

  it("flattens a missing history to zeros at the v3 width", () => {
    const packed = packDecision({ t: "priority", options: [] });
    expect(packed.hist.dims).toEqual([HISTORY_FEATURES]);
    expect(Array.from(packed.hist.data, Number)).toEqual(
      new Array(HISTORY_FEATURES).fill(0),
    );
  });

  it("packs history the way the fixture's summary reads", () => {
    const summary = v3fixture.cases[0].decision.opp_history;
    expect(summary).toBeDefined();
    const feats = historyFeatures({ opp_history: summary });
    expect(feats).toHaveLength(HISTORY_FEATURES);
    // Bucket 0: 2 lands /10, 1 creature /10, 1 to graveyard /10, hand 9
    // over 2 samples /7, 2 samples /16.
    expect(feats.slice(0, 7)).toEqual([0.2, 0.1, 0, 0, 0.1, 9 / 2 / 7, 2 / 16]);
    // Totals' observations /200, then the mana pool /10.
    expect(feats[28]).toBeCloseTo(47 / 200, 6);
    expect(feats.slice(29, 36)).toEqual([0, 0.2, 0.1, 0, 0.3, 0, 0.1]);
    // Live combat counts and graveyard size.
    expect(feats.slice(36)).toEqual([0.2, 0.1, 9 / 20]);
  });

  it("packs a live Planar Nexus view with the right widths", () => {
    const session = new TrainingSession();
    const [me] = session.reset(
      2,
      trainingDeck("aggro"),
      trainingDeck("control"),
    );
    const packed = packDecision({
      ...playerView(session.state, me),
      t: "priority",
      options: [],
    });
    expect(packed.hand_x.dims).toEqual([7, CARD_FEATURES]);
    expect(packed.glob.dims).toEqual([GLOBAL_FEATURES]);
    expect(packed.hist.dims).toEqual([HISTORY_FEATURES]);
    expect(packed.pri_flags.dims).toEqual([1, 2]);
  });
});
