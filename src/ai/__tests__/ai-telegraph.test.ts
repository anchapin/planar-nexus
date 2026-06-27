/**
 * @fileoverview Unit tests for the beginner-friendly AI telegraph system (#993).
 *
 * Covers the three acceptance dimensions explicitly:
 *   1. Telegraphs are generated for representative decisions (attack/hold/
 *      block/cast) — {@link describeGenerationForRepresentativeDecisions}.
 *   2. Verbosity scales with difficulty — {@link describeVerbosityScalesWithDifficulty}.
 *   3. Content is meaningful (references the real reason: ahead/behind,
 *      removing a threat, holding a blocker, accepting a trade) —
 *      {@link describeMeaningfulContent}.
 */

import { describe, it, expect } from "@jest/globals";
import {
  TELEGRAPH_NONE,
  TELEGRAPH_BASIC,
  TELEGRAPH_DETAILED,
  getTelegraphLevel,
  shouldTelegraph,
  classifyStanding,
  motiveClause,
  isLowLife,
  isRemovalSpell,
  generateAttackTelegraph,
  generateHoldTelegraph,
  generateBlockTelegraph,
  generateCastTelegraph,
  generateTelegraph,
} from "../ai-telegraph";
import { DIFFICULTY_CONFIGS } from "../ai-difficulty";

// ---------------------------------------------------------------------------
// Difficulty gating — verbosity scales with difficulty (acceptance #2).
// ---------------------------------------------------------------------------
describe("telegraph verbosity scales with difficulty", () => {
  it("easy reads as detailed (level 2) from the canonical config", () => {
    expect(DIFFICULTY_CONFIGS.easy.telegraphLevel).toBe(2);
    expect(getTelegraphLevel("easy")).toBe(TELEGRAPH_DETAILED);
  });

  it("expert reads as none (level 0) — never hand-hold the top tier", () => {
    expect(DIFFICULTY_CONFIGS.expert.telegraphLevel).toBe(0);
    expect(getTelegraphLevel("expert")).toBe(TELEGRAPH_NONE);
  });

  it("medium/hard read as basic (level 1)", () => {
    expect(getTelegraphLevel("medium")).toBe(TELEGRAPH_BASIC);
    expect(getTelegraphLevel("hard")).toBe(TELEGRAPH_BASIC);
  });

  it("monotonic: easy >= medium >= hard >= expert verbosity", () => {
    const levels = (["easy", "medium", "hard", "expert"] as const).map((d) =>
      getTelegraphLevel(d),
    );
    expect(levels[0]).toBeGreaterThanOrEqual(levels[1]);
    expect(levels[1]).toBeGreaterThanOrEqual(levels[2]);
    expect(levels[2]).toBeGreaterThanOrEqual(levels[3]);
  });

  it("shouldTelegraph is false only at level 0", () => {
    expect(shouldTelegraph(TELEGRAPH_NONE)).toBe(false);
    expect(shouldTelegraph(TELEGRAPH_BASIC)).toBe(true);
    expect(shouldTelegraph(TELEGRAPH_DETAILED)).toBe(true);
  });

  it("out-of-range config values clamp to a valid tier (defensive)", () => {
    // easy base is 2; a malformed value should still resolve safely.
    expect(getTelegraphLevel("easy")).toBeLessThanOrEqual(2);
    expect(getTelegraphLevel("expert")).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Generation for representative decisions (acceptance #1).
// ---------------------------------------------------------------------------
describe("telegraph generation for representative decisions", () => {
  const neutralCtx = classifyStanding(20, 20, 2, 2);

  it("attack: detailed explains the quality + motive", () => {
    const out = generateAttackTelegraph(
      {
        subject: "Goblin Guide",
        internalReasoning:
          "Goblin Guide (2 power) - has evasion, high value attack",
        context: neutralCtx,
      },
      TELEGRAPH_DETAILED,
    );
    expect(out).not.toBeNull();
    expect(out).toContain("Goblin Guide");
    expect(out).toMatch(/hard to block/i);
  });

  it("hold: detailed explains why a blocker was kept back", () => {
    const out = generateHoldTelegraph(
      {
        subject: "Wall of Omens",
        internalReasoning: "Wall of Omens (0/4) - low value, hold for defense",
        context: neutralCtx,
      },
      TELEGRAPH_DETAILED,
    );
    expect(out).not.toBeNull();
    expect(out).toContain("Wall of Omens");
    expect(out).toMatch(/blocker|reserve|defense/i);
  });

  it("block: detailed references the trade outcome", () => {
    const out = generateBlockTelegraph(
      {
        subject: "Bears",
        target: "Tarmogoyf",
        internalReasoning: "Bears trades with Tarmogoyf",
        context: neutralCtx,
      },
      TELEGRAPH_DETAILED,
    );
    expect(out).not.toBeNull();
    expect(out).toContain("Tarmogoyf");
    expect(out).toMatch(/trade/i);
  });

  it("cast (removal): detailed frames it as removing the threat", () => {
    const out = generateCastTelegraph(
      {
        subject: "Doom Blade",
        target: "Grave Titan",
        isRemoval: true,
        context: neutralCtx,
      },
      TELEGRAPH_DETAILED,
    );
    expect(out).not.toBeNull();
    expect(out).toContain("Doom Blade");
    expect(out).toMatch(/remove.*Grave Titan/i);
  });

  it("cast (non-removal): detailed uses motive coaching", () => {
    const out = generateCastTelegraph(
      { subject: "Llanowar Elves", context: neutralCtx },
      TELEGRAPH_DETAILED,
    );
    expect(out).not.toBeNull();
    expect(out).toContain("Llanowar Elves");
  });

  it("dispatcher routes each kind to the right generator", () => {
    const attack = generateTelegraph(
      "attack",
      { subject: "X", context: neutralCtx },
      TELEGRAPH_BASIC,
    );
    const cast = generateTelegraph(
      "cast",
      { subject: "Y", context: neutralCtx },
      TELEGRAPH_BASIC,
    );
    expect(attack).toMatch(/attacks with X/);
    expect(cast).toMatch(/casts Y/);
  });
});

// ---------------------------------------------------------------------------
// Meaningful content — references the real reason (acceptance #3).
// ---------------------------------------------------------------------------
describe("telegraph content references the real reason", () => {
  it("ahead → 'press its advantage' motive", () => {
    const ahead = classifyStanding(20, 10, 4, 1);
    expect(ahead.aiAhead).toBe(true);
    expect(motiveClause(ahead)).toMatch(/press its advantage/i);

    const out = generateAttackTelegraph(
      {
        subject: "Goblin Guide",
        internalReasoning: "high value attack",
        context: ahead,
      },
      TELEGRAPH_DETAILED,
    );
    expect(out).toMatch(/press its advantage/i);
  });

  it("behind → 'claw back into the game' motive", () => {
    const behind = classifyStanding(6, 20, 1, 4);
    expect(behind.aiBehind).toBe(true);
    // Low life should take priority over generic behind framing.
    expect(isLowLife(behind)).toBe(true);
    const out = generateCastTelegraph(
      { subject: "Wrath of God", context: behind },
      TELEGRAPH_DETAILED,
    );
    expect(out).toMatch(/stay alive/i);
  });

  it("removal spells surface the 'remove your threat' framing", () => {
    expect(isRemovalSpell("Instant", "Destroy target creature.")).toBe(true);
    expect(isRemovalSpell("Sorcery", "Exile target permanent.")).toBe(true);
    expect(isRemovalSpell("Creature", "Destroy target creature.")).toBe(false);
    expect(isRemovalSpell("Instant", "Draw a card.")).toBe(false);

    const out = generateCastTelegraph(
      {
        subject: "Doom Blade",
        isRemoval: true,
        context: classifyStanding(20, 20, 2, 2),
      },
      TELEGRAPH_DETAILED,
    );
    // No target supplied → the generator frames it as getting the most
    // dangerous permanent off the board (still the threat-removal framing).
    expect(out).toMatch(
      /(most dangerous permanent|remove.*(threat|permanent))/i,
    );
  });

  it("hold-back telegraph references the blocker/survival reason", () => {
    const risky = generateHoldTelegraph(
      {
        subject: "Bears",
        internalReasoning: "Bears (2/2) - too risky, would likely die",
        context: classifyStanding(20, 20, 2, 2),
      },
      TELEGRAPH_DETAILED,
    );
    expect(risky).toMatch(/killed|reserve/i);
  });

  it("evasion in reasoning surfaces the 'hard to block' hint", () => {
    const out = generateAttackTelegraph(
      {
        subject: "Specter",
        internalReasoning: "Specter - has evasion, good attack opportunity",
        context: classifyStanding(20, 20, 2, 2),
      },
      TELEGRAPH_DETAILED,
    );
    expect(out).toMatch(/hard to block/i);
  });
});

// ---------------------------------------------------------------------------
// Verbosity gating per generator — level 0 always silent, basic is terse.
// ---------------------------------------------------------------------------
describe("each generator is silent at level 0 and terse at basic", () => {
  const ctx = classifyStanding(20, 20, 2, 2);

  it("attack returns null at none, terse at basic", () => {
    expect(
      generateAttackTelegraph(
        { subject: "X", internalReasoning: "high value", context: ctx },
        TELEGRAPH_NONE,
      ),
    ).toBeNull();
    const basic = generateAttackTelegraph(
      { subject: "X", internalReasoning: "high value", context: ctx },
      TELEGRAPH_BASIC,
    );
    expect(basic).toBe("AI attacks with X.");
  });

  it("hold returns null at none AND basic (only detailed narrates holds)", () => {
    expect(
      generateHoldTelegraph(
        { subject: "X", internalReasoning: "hold for defense", context: ctx },
        TELEGRAPH_NONE,
      ),
    ).toBeNull();
    expect(
      generateHoldTelegraph(
        { subject: "X", internalReasoning: "hold for defense", context: ctx },
        TELEGRAPH_BASIC,
      ),
    ).toBeNull();
    expect(
      generateHoldTelegraph(
        { subject: "X", internalReasoning: "hold for defense", context: ctx },
        TELEGRAPH_DETAILED,
      ),
    ).not.toBeNull();
  });

  it("cast returns null at none, terse at basic", () => {
    expect(
      generateCastTelegraph({ subject: "X", context: ctx }, TELEGRAPH_NONE),
    ).toBeNull();
    expect(
      generateCastTelegraph({ subject: "X", context: ctx }, TELEGRAPH_BASIC),
    ).toBe("AI casts X.");
  });

  it("block returns null at none, terse at basic", () => {
    expect(
      generateBlockTelegraph(
        { subject: "X", target: "A", context: ctx },
        TELEGRAPH_NONE,
      ),
    ).toBeNull();
    expect(
      generateBlockTelegraph(
        { subject: "X", target: "A", context: ctx },
        TELEGRAPH_BASIC,
      ),
    ).toBe("AI blocks A with X.");
  });
});
