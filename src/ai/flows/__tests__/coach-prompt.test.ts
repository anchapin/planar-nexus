import { buildCoachSystemPrompt } from "../context-builder";

describe("buildCoachSystemPrompt — structured analysis (issue #923)", () => {
  const rawDeckList = [
    "### Creatures",
    "4x Llanowar Elves (G)",
    "4x Elvish Mystic (G)",
    "3x Elvish Archdruid (1GG)",
  ].join("\n");

  const structuredAnalysis = [
    "### Structured Deck Analysis",
    "**Archetype**: Elves — confidence 90%",
    "**Mana Curve**: 0cmc:0  1cmc:8",
    "**Role Mix**: Threats 6 · Ramp 8 · Removal 0",
    "**Synergy Clusters**:",
    "- _Elves Tribal_ (tribal, score 80): Llanowar Elves, Elvish Mystic",
    "**Gaps / Improvement Targets**:",
    "- Low removal density.",
  ].join("\n");

  it("prefers structured analysis and omits the raw card-by-card list", () => {
    const prompt = buildCoachSystemPrompt(
      "commander",
      rawDeckList,
      undefined,
      undefined,
      undefined,
      structuredAnalysis,
    );

    // Structured content is included...
    expect(prompt).toContain("### Structured Deck Analysis");
    expect(prompt).toContain("**Archetype**: Elves");
    expect(prompt).toContain("Synergy Clusters");
    // ...and the raw per-card list is NOT (no "4x ... (G)" lines).
    expect(prompt).not.toContain("4x Llanowar Elves (G)");
    expect(prompt).not.toContain("### Creatures");
  });

  it("falls back to the raw decklist when no structured analysis is provided", () => {
    const prompt = buildCoachSystemPrompt(
      "commander",
      rawDeckList,
      undefined,
      undefined,
      undefined,
      undefined,
    );

    expect(prompt).not.toContain("### Structured Deck Analysis");
    expect(prompt).toContain("4x Llanowar Elves (G)");
  });

  it("still renders coach intent guidance", () => {
    const prompt = buildCoachSystemPrompt(
      "commander",
      "",
      undefined,
      undefined,
      undefined,
      structuredAnalysis,
    );
    expect(prompt).toContain("expert Magic: The Gathering coach");
    expect(prompt).toContain("Wincon");
  });
});
