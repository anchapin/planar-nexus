import { DecisionRecordSchema } from "../types";

describe("DecisionRecordSchema", () => {
  const valid_record = {
    id: "dec-test-123",
    video_id: "vid-001",
    timestamp_ms: 15000,
    moment_type: "spell_cast",
    action: "Casts Lightning Bolt targeting opponent",
    reason: "To reduce opponent life total before combat",
    alternatives_considered: ["Hold for blocker", "Cast after combat"],
    outcome: "Opponent takes 3 damage",
    confidence: 0.85,
    transcript_window: "[00:10.000] He casts Lightning Bolt",
  };

  it("accepts a valid record", () => {
    const result = DecisionRecordSchema.safeParse(valid_record);
    expect(result.success).toBe(true);
  });

  it("rejects empty action", () => {
    const result = DecisionRecordSchema.safeParse({
      ...valid_record,
      action: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty reason", () => {
    const result = DecisionRecordSchema.safeParse({
      ...valid_record,
      reason: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty outcome", () => {
    const result = DecisionRecordSchema.safeParse({
      ...valid_record,
      outcome: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects confidence outside 0-1 range", () => {
    const result = DecisionRecordSchema.safeParse({
      ...valid_record,
      confidence: 1.5,
    });
    expect(result.success).toBe(false);
  });

  it("accepts empty alternatives_considered", () => {
    const result = DecisionRecordSchema.safeParse({
      ...valid_record,
      alternatives_considered: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid moment_type", () => {
    const result = DecisionRecordSchema.safeParse({
      ...valid_record,
      moment_type: "not_a_type",
    });
    expect(result.success).toBe(false);
  });

  it("accepts optional fields", () => {
    const result = DecisionRecordSchema.safeParse({
      ...valid_record,
      board_state_before: "2 creatures on board",
      board_state_after: "1 creature on board",
      player: "Player 1",
      turn_number: 5,
    });
    expect(result.success).toBe(true);
  });

  it("accepts all valid moment types", () => {
    const types = [
      "attack_declaration",
      "block_declaration",
      "spell_cast",
      "ability_activation",
      "priority_pass",
      "mulligan",
      "other",
    ];

    for (const type of types) {
      const result = DecisionRecordSchema.safeParse({
        ...valid_record,
        moment_type: type,
      });
      expect(result.success).toBe(true);
    }
  });
});
