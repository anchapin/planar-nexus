import {
  DECISION_EXTRACTION_SYSTEM_PROMPT,
  buildDecisionExtractionUserPrompt,
} from "../prompt";

describe("DECISION_EXTRACTION_SYSTEM_PROMPT", () => {
  it("is a non-empty string", () => {
    expect(typeof DECISION_EXTRACTION_SYSTEM_PROMPT).toBe("string");
    expect(DECISION_EXTRACTION_SYSTEM_PROMPT.length).toBeGreaterThan(0);
  });

  it("mentions all decision moment types", () => {
    const types = [
      "attack",
      "block",
      "spell",
      "ability",
      "priority",
      "mulligan",
    ];
    for (const type of types) {
      expect(DECISION_EXTRACTION_SYSTEM_PROMPT.toLowerCase()).toContain(type);
    }
  });

  it("specifies JSON output format", () => {
    expect(DECISION_EXTRACTION_SYSTEM_PROMPT).toContain("JSON");
  });
});

describe("buildDecisionExtractionUserPrompt", () => {
  it("includes the transcript text", () => {
    const prompt = buildDecisionExtractionUserPrompt(
      "He casts Lightning Bolt at the opponent",
      ["spell_cast"],
    );
    expect(prompt).toContain("He casts Lightning Bolt at the opponent");
  });

  it("includes detected moment types", () => {
    const prompt = buildDecisionExtractionUserPrompt("Some transcript text", [
      "spell_cast",
      "attack_declaration",
    ]);
    expect(prompt).toContain("spell_cast");
    expect(prompt).toContain("attack_declaration");
  });

  it("falls back to general when no types", () => {
    const prompt = buildDecisionExtractionUserPrompt("Some text", []);
    expect(prompt).toContain("general decision-making");
  });

  it("includes the JSON schema", () => {
    const prompt = buildDecisionExtractionUserPrompt("text", ["spell_cast"]);
    expect(prompt).toContain('"action"');
    expect(prompt).toContain('"reason"');
    expect(prompt).toContain('"outcome"');
  });
});
