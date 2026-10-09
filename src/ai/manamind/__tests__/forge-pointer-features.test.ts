/**
 * anchapin/manamind#86: the Forge-pointer input builder matches manamind's
 * `forge_pointer_onnx.pack` exactly. The fixture is `pack` run on
 * manamind's own test decisions (tests/unit/test_forge_pointer.py), plus an
 * empty decision and one with an unknown phase, a hybrid cost, and a
 * non-ASCII card name.
 */
import fixture from "./fixtures/forge_pointer_v1_pack.json";
import {
  CARD_FEATURES,
  FORGE_POINTER_INPUTS,
  FORGE_POINTER_SCHEMA_VERSION,
  GLOBAL_FEATURES,
  nameBucket,
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
