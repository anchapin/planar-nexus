/**
 * Card-script preference pairs for DPO fine-tuning (#2551, step 2).
 *
 * Covers the pairing rules (a valid draft against an invalid one, the
 * needs-new-op refusal against a forced script), the #2514 gold hold-out,
 * the loud failures and the empty source. The replies are canned model
 * outputs; no network, no LLM.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildPreferencePairs,
  checkPreferencePair,
  checkPreferences,
  judgeCandidate,
  parseDraftLog,
  type DraftLog,
  type DraftLogCard,
} from "../scripts/card-scripts/preference-lib";
import { buildSystemPrompt } from "../scripts/card-scripts/draft-lib";
import { buildDataset } from "../scripts/card-scripts/dataset-lib";
import { exportPreferences } from "../scripts/export-card-script-preferences";

const ROOT = join(__dirname, "..");
const GOLD_LIST = join(ROOT, "scripts", "data", "bakeoff-cards.json");
const goldNames = (
  JSON.parse(readFileSync(GOLD_LIST, "utf8")) as { gold: string[] }
).gold;

const shockScript = JSON.parse(
  readFileSync(
    join(
      ROOT,
      "src",
      "lib",
      "game-state",
      "card-scripts",
      "cards",
      "shock.json",
    ),
    "utf8",
  ),
) as { name: string; oracle: string };

/** A model reply that scripts Shock correctly. */
const goodShockReply = JSON.stringify({ script: shockScript });
/** A model reply whose script misses the damage amount: the schema rejects it. */
const brokenShockReply = JSON.stringify({
  script: {
    name: "Shock",
    oracle: shockScript.oracle,
    spell: [{ op: "DealDamage", target: "any" }],
  },
});
/** A reply with no JSON at all. */
const garbageReply = "Shock deals 2 damage to any target.";
/** A model reply that refuses because the card needs an op that doesn't exist. */
const refusalReply = JSON.stringify({
  needs_new_op: ["damage a target and draw a card in one effect"],
});
/** A model reply that guesses a script instead of refusing. */
const forcedReply = JSON.stringify({
  script: {
    name: "Glimmerburst",
    oracle: "Glimmerburst deals 2 damage to any target.",
    spell: [{ op: "DealDamage", amount: 2, target: "any" }],
  },
});

function card(over: Partial<DraftLogCard> = {}): DraftLogCard {
  return {
    name: shockScript.name,
    oracle_text: shockScript.oracle,
    type_line: "Instant",
    expect: "draft",
    replies: [],
    ...over,
  };
}

function log(cards: DraftLogCard[]): DraftLog {
  return { cards };
}

describe("candidate judging", () => {
  it("accepts a schema-valid reply as a draft", () => {
    const verdict = judgeCandidate(card(), goodShockReply);
    expect(verdict.kind).toBe("drafted");
    if (verdict.kind === "drafted") {
      expect(verdict.script.name).toBe("Shock");
      expect(verdict.script.spell).toHaveLength(1);
    }
  });

  it("rejects a reply the schema does not accept", () => {
    const verdict = judgeCandidate(card(), brokenShockReply);
    expect(verdict.kind).toBe("invalid");
    if (verdict.kind === "invalid") {
      expect(verdict.errors.join(" ")).toMatch(/amount/i);
    }
  });

  it("rejects a reply that is not JSON at all", () => {
    expect(judgeCandidate(card(), garbageReply).kind).toBe("invalid");
  });

  it("reads a refusal as a needs-new-op answer", () => {
    const verdict = judgeCandidate(card(), refusalReply);
    expect(verdict.kind).toBe("needs_new_op");
    if (verdict.kind === "needs_new_op") {
      expect(verdict.missing).toEqual([
        "damage a target and draw a card in one effect",
      ]);
    }
  });
});

describe("preference pairs", () => {
  const system = buildSystemPrompt();

  it("pairs a schema-valid draft against an invalid one", () => {
    const { pairs, skipped } = buildPreferencePairs(
      log([
        card({
          replies: [
            { source: "arm-a", reply: goodShockReply },
            { source: "arm-b", reply: brokenShockReply },
          ],
        }),
      ]),
      system,
    );
    expect(skipped).toEqual([]);
    expect(pairs).toHaveLength(1);
    const pair = pairs[0];
    expect(JSON.parse(pair.chosen)).toEqual(shockScript);
    expect(JSON.parse(pair.rejected)).toEqual({
      name: "Shock",
      oracle: shockScript.oracle,
      spell: [{ op: "DealDamage", target: "any" }],
    });
    expect(pair.meta.card).toBe("Shock");
    expect(pair.meta.expect).toBe("draft");
    expect(pair.meta.chosen_source).toBe("arm-a");
    expect(pair.meta.rejected_source).toBe("arm-b");
  });

  it("uses the same system prompt and oracle text as the SFT export", () => {
    const { pairs } = buildPreferencePairs(
      log([
        card({
          replies: [goodShockReply, brokenShockReply],
        }),
      ]),
      system,
    );
    const pair = pairs[0];
    expect(pair.system).toBe(system);
    expect(pair.user).toBe(shockScript.oracle);
    expect(pair.messages).toEqual([
      { role: "user", content: shockScript.oracle },
    ]);
    // The chosen side is the same assistant turn step 1 exports for the
    // same script, so SFT and DPO data agree.
    const dataset = buildDataset([shockScript as never], [], system);
    expect(JSON.parse(pair.chosen)).toEqual(
      JSON.parse(dataset.train[0].assistant),
    );
  });

  it("pairs a needs-new-op refusal against the forced script", () => {
    const { pairs, skipped } = buildPreferencePairs(
      log([
        card({
          name: "Glimmerburst",
          oracle_text: "Glimmerburst deals 2 damage to any target.",
          expect: "needs_new_op",
          replies: [
            { source: "arm-a", reply: refusalReply },
            { source: "arm-b", reply: forcedReply },
          ],
        }),
      ]),
      system,
    );
    expect(skipped).toEqual([]);
    expect(pairs).toHaveLength(1);
    const pair = pairs[0];
    expect(JSON.parse(pair.chosen)).toEqual({
      needs_new_op: ["damage a target and draw a card in one effect"],
    });
    expect(JSON.parse(pair.rejected).name).toBe("Glimmerburst");
    expect(pair.meta.expect).toBe("needs_new_op");
  });

  it("skips a card with nothing to pair against, and says why", () => {
    const { pairs, skipped } = buildPreferencePairs(
      log([
        card({ replies: [goodShockReply] }),
        card({
          name: "Glimmerburst",
          oracle_text: "Glimmerburst deals 2 damage to any target.",
          expect: "needs_new_op",
          replies: [refusalReply],
        }),
      ]),
      system,
    );
    expect(pairs).toEqual([]);
    expect(skipped.map((s) => s.reason)).toEqual([
      "no invalid draft to pair the chosen draft against",
      "no forced draft to pair the refusal against",
    ]);
  });

  it("never puts a gold card in a training pair", () => {
    const gold = goldNames[0];
    const { pairs, skipped } = buildPreferencePairs(
      log([
        card({
          name: gold,
          oracle_text: `${gold} does something.`,
          replies: [goodShockReply, brokenShockReply],
        }),
      ]),
      system,
      goldNames,
    );
    expect(pairs).toEqual([]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].reason).toMatch(/gold/);
  });
});

describe("preference pair checks", () => {
  const system = buildSystemPrompt();
  const { pairs } = buildPreferencePairs(
    log([card({ replies: [goodShockReply, brokenShockReply] })]),
    system,
  );

  it("accepts a good pair", () => {
    expect(checkPreferencePair(pairs[0])).toEqual([]);
    expect(checkPreferences(pairs, goldNames)).toEqual([]);
  });

  it("fails loudly on a malformed pair", () => {
    const broken = {
      ...pairs[0],
      chosen: pairs[0].rejected,
      messages: [],
    };
    const errors = checkPreferencePair(broken).join(" ");
    expect(errors).toMatch(/same reply/);
    expect(errors).toMatch(/messages must hold the user turn/);
  });

  it("fails loudly on a chosen reply that is not a card script", () => {
    const broken = { ...pairs[0], chosen: JSON.stringify({ nope: true }) };
    expect(checkPreferencePair(broken).join(" ")).toMatch(
      /not a valid card script/,
    );
  });

  it("fails loudly when a gold card leaks into the pairs", () => {
    const leaked = { ...pairs[0], meta: { ...pairs[0].meta, card: goldNames[0] } };
    expect(checkPreferences([leaked], goldNames).join(" ")).toMatch(
      /gold card leaked/,
    );
  });
});

describe("draft log parsing", () => {
  it("rejects a log without cards", () => {
    expect(() => parseDraftLog({})).toThrow(/cards/);
  });

  it("rejects a card without a name, a label or replies", () => {
    expect(() =>
      parseDraftLog({ cards: [{ oracle_text: "x", replies: ["y"] }] }),
    ).toThrow(/name/);
    expect(() =>
      parseDraftLog({ cards: [{ name: "x", oracle_text: "y", replies: [] }] }),
    ).toThrow(/reply/);
    expect(() =>
      parseDraftLog({
        cards: [{ name: "x", oracle_text: "y", replies: ["z"] }],
      }),
    ).toThrow(/label/);
  });

  it("reads plain reply strings and objects", () => {
    const parsed = parseDraftLog({
      cards: [
        {
          name: "Shock",
          oracle_text: "Shock deals 2 damage to any target.",
          expect: "draft",
          replies: ["a", { reply: "b", source: "arm-a" }],
        },
      ],
    });
    expect(parsed.cards[0].replies).toEqual([
      { reply: "a" },
      { reply: "b", source: "arm-a" },
    ]);
  });
});

// The draft log the export reads: a run that produced both a good and a
// bad answer for one card, a refusal plus a forced script for another, and
// a gold card that must never reach a training pair.
const srcDir = mkdtempSync(join(tmpdir(), "card-script-preferences-src-"));
const DRAFTS_FILE = join(srcDir, "drafts.json");
writeFileSync(
  DRAFTS_FILE,
  JSON.stringify({
    cards: [
      {
        name: "Shock",
        oracle_text: shockScript.oracle,
        type_line: "Instant",
        expect: "draft",
        replies: [
          { source: "arm-a", reply: goodShockReply },
          { source: "arm-b", reply: brokenShockReply },
        ],
      },
      {
        name: "Glimmerburst",
        oracle_text: "Glimmerburst deals 2 damage to any target.",
        type_line: "Instant",
        expect: "needs_new_op",
        replies: [
          { source: "arm-a", reply: refusalReply },
          { source: "arm-b", reply: forcedReply },
        ],
      },
      {
        name: goldNames[0],
        oracle_text: `${goldNames[0]} does something.`,
        type_line: "Instant",
        expect: "draft",
        replies: [
          { source: "arm-a", reply: goodShockReply },
          { source: "arm-b", reply: brokenShockReply },
        ],
      },
    ],
  }),
);

describe("preferences export", () => {
  const outDir = mkdtempSync(join(tmpdir(), "card-script-preferences-"));
  const result = exportPreferences({
    draftsFile: DRAFTS_FILE,
    outDir,
    goldList: GOLD_LIST,
  });
  const lines = readFileSync(result.preferencesFile, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0);

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
    rmSync(srcDir, { recursive: true, force: true });
  });

  it("writes one JSON object per line, and every line parses", () => {
    expect(lines).toHaveLength(result.pairs.length);
    expect(result.pairs.length).toBeGreaterThan(0);
    for (const line of lines) {
      const parsed = JSON.parse(line) as {
        system: string;
        user: string;
        chosen: string;
        rejected: string;
      };
      expect(typeof parsed.system).toBe("string");
      expect(typeof parsed.user).toBe("string");
      expect(typeof parsed.chosen).toBe("string");
      expect(typeof parsed.rejected).toBe("string");
    }
  });

  it("keeps the gold set out of the pairs", () => {
    const cardNames = result.pairs.map((p) => p.meta.card);
    for (const gold of goldNames) {
      expect(cardNames).not.toContain(gold);
    }
  });

  it("fails loudly when the draft log is malformed", () => {
    const badFile = join(outDir, "bad.json");
    writeFileSync(badFile, JSON.stringify({ cards: [{ name: "X" }] }));
    expect(() =>
      exportPreferences({ draftsFile: badFile, outDir, goldList: GOLD_LIST }),
    ).toThrow(/malformed/);
  });

  it("writes an empty file when the source has no cards", () => {
    const emptyFile = join(outDir, "empty.json");
    writeFileSync(emptyFile, JSON.stringify({ cards: [] }));
    const empty = exportPreferences({
      draftsFile: emptyFile,
      outDir,
      goldList: GOLD_LIST,
    });
    expect(empty.pairs).toEqual([]);
    expect(empty.skipped).toEqual([]);
    expect(readFileSync(empty.preferencesFile, "utf8")).toBe("");
  });
});
