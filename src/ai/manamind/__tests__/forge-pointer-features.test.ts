/**
 * anchapin/manamind#86: the Forge-pointer input builder matches manamind's
 * `forge_pointer_onnx.pack` exactly. The fixture is `pack` run on
 * manamind's own test decisions (tests/unit/test_forge_pointer.py), plus an
 * empty decision and one with an unknown phase, a hybrid cost, and a
 * non-ASCII card name; the priority case carries deck identity
 * (deck "red" / opp_deck "green", manamind #96).
 */
import fixture from "./fixtures/forge_pointer_v3_pack.json";
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
} from "../forge-pointer-features";
import { playerView } from "@/ai/simulation/player-view";
import {
  TrainingSession,
  trainingDeck,
} from "@/ai/simulation/training-session";

describe("forge pointer features", () => {
  it("uses manamind's schema version and input order", () => {
    expect(fixture.schema_version).toBe(FORGE_POINTER_SCHEMA_VERSION);
    expect(fixture.input_names).toEqual([...FORGE_POINTER_INPUTS]);
  });

  it("hashes card names into the same buckets", () => {
    for (const [name, bucket] of Object.entries(fixture.name_buckets)) {
      expect(nameBucket(name)).toBe(bucket);
    }
  });

  it("hashes deck names into the same buckets", () => {
    for (const [name, bucket] of Object.entries(fixture.deck_buckets)) {
      expect(deckBucket(name)).toBe(bucket);
    }
  });

  it.each(fixture.cases.map((c) => [c.name, c] as const))(
    "packs the %s decision exactly like manamind",
    (_name, c) => {
      const packed = packDecision(c.decision as ForgeDecision);
      const want = c.inputs as Record<
        string,
        { dims: number[]; data: number[] }
      >;
      for (const name of FORGE_POINTER_INPUTS) {
        const got = packed[name];
        expect([name, got.dims]).toEqual([name, want[name].dims]);
        const values = Array.from(got.data, Number);
        expect(values).toHaveLength(want[name].data.length);
        values.forEach((v, i) => expect(v).toBeCloseTo(want[name].data[i], 6));
      }
    },
  );

  it("flattens a missing history to zeros at the v3 width", () => {
    const packed = packDecision({ t: "priority", options: [] });
    expect(packed.hist.dims).toEqual([HISTORY_FEATURES]);
    expect(Array.from(packed.hist.data, Number)).toEqual(
      new Array(HISTORY_FEATURES).fill(0),
    );
  });

  it("packs history the way the fixture's summary reads", () => {
    const summary = fixture.cases.find((c) => c.name === "history")?.decision
      .opp_history;
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
    expect(packed.pri_flags.dims).toEqual([1, 2]);
  });
});
