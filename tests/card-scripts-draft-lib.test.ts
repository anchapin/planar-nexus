/**
 * Card-script drafting pipeline (#2491): prompt building, reply judging, and
 * the Forge guard. No network: replies are canned model outputs.
 */
import {
  abilityText,
  assertNoForgeContent,
  buildPrompt,
  documentedOps,
  judgeReply,
  renderReport,
  schemaOps,
  scriptFileName,
  skipReason,
  tallyMissingOps,
  type DraftCard,
  type DraftOutcome,
} from "../scripts/card-scripts/draft-lib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CardScript } from "../src/lib/game-state/card-scripts/schema";

// The runtime index drops oracle text to keep it out of the client bundle,
// so few-shot examples come from the JSON on disk, as the CLI loads them.
const lightningStrike = JSON.parse(
  readFileSync(
    join(
      __dirname,
      "..",
      "src",
      "lib",
      "game-state",
      "card-scripts",
      "cards",
      "lightning_strike.json",
    ),
    "utf8",
  ),
) as CardScript;

const hunter: DraftCard = {
  name: "Helpful Hunter",
  type_line: "Creature — Cat",
  layout: "normal",
  oracle_text: "When this creature enters, draw a card.",
  keywords: [],
};

const shock: DraftCard = {
  name: "Shock",
  type_line: "Instant",
  layout: "normal",
  oracle_text: "Shock deals 2 damage to any target.",
};

describe("card-script drafting pipeline", () => {
  it("documents every schema op for the model, and nothing else", () => {
    expect(documentedOps()).toEqual(schemaOps());
  });

  it("refuses Forge card-script syntax in a prompt", () => {
    expect(() =>
      assertNoForgeContent("A:AB$ DealDamage | Cost$ T | NumDmg$ 1"),
    ).toThrow(/Forge/);
    expect(() => assertNoForgeContent("SVar:DBDraw:DB$ Draw")).toThrow(/Forge/);
    expect(() =>
      assertNoForgeContent("When this creature enters, draw a card."),
    ).not.toThrow();
  });

  it("builds a prompt from our own scripts and the card", () => {
    const prompt = buildPrompt(hunter, [lightningStrike]);
    expect(prompt).toContain('"name":"Helpful Hunter"');
    expect(prompt).toContain("Lightning Strike deals 3 damage");
    expect(prompt).toContain("needs_new_op");
  });

  it("skips scripted, unsupported, and keyword-only cards", () => {
    const scripted = new Set(["helpful hunter"]);
    expect(skipReason(hunter, scripted)).toBe("already scripted");
    expect(skipReason({ ...hunter, layout: "adventure" }, new Set())).toMatch(
      /layout/,
    );
    expect(skipReason({ ...hunter, type_line: "Land" }, new Set())).toMatch(
      /type/,
    );
    const vanillaFlyer: DraftCard = {
      ...hunter,
      oracle_text:
        "Flying, vigilance (Attacking doesn't cause this creature to tap.)",
      keywords: ["Flying", "Vigilance"],
    };
    expect(abilityText(vanillaFlyer)).toBe("");
    expect(skipReason(vanillaFlyer, new Set())).toMatch(/keywords/);
    expect(skipReason(hunter, new Set())).toBeNull();
  });

  it("accepts a schema-valid draft and pins name and oracle to the card", () => {
    const reply =
      '```json\n{"script":{"name":"helpful hunter","oracle":"wrong","triggers":[{"text":"When this creature enters, draw a card.","event":"etb","subject":"self","effects":[{"op":"Draw","amount":1,"who":"you"}]}]}}\n```';
    const out = judgeReply(hunter, reply);
    expect(out.kind).toBe("drafted");
    if (out.kind !== "drafted") return;
    expect(out.script.name).toBe("Helpful Hunter");
    expect(out.script.oracle).toBe(hunter.oracle_text);
  });

  it("rejects drafts that fail the schema or mismatch the card type", () => {
    expect(
      judgeReply(shock, '{"script":{"spell":[{"op":"Explode","amount":2}]}}')
        .kind,
    ).toBe("invalid");
    expect(judgeReply(shock, "I think Shock deals 2.").kind).toBe("invalid");
    const permAsSpell = judgeReply(
      hunter,
      '{"script":{"spell":[{"op":"Draw","amount":1,"who":"you"}]}}',
    );
    expect(permAsSpell).toMatchObject({
      kind: "invalid",
      errors: ["permanent scripted with spell effects"],
    });
    const spellAsPerm = judgeReply(
      shock,
      '{"script":{"activated":[{"text":"x","cost":{"tap":true},"effects":[{"op":"Draw","amount":1}]}]}}',
    );
    expect(spellAsPerm.kind).toBe("invalid");
  });

  it("reports needs-new-op instead of guessing", () => {
    const out = judgeReply(
      hunter,
      '{"needs_new_op":["dies trigger","return card from graveyard to hand"]}',
    );
    expect(out).toEqual({
      kind: "needs_new_op",
      name: "Helpful Hunter",
      missing: ["dies trigger", "return card from graveyard to hand"],
    });
  });

  it("tallies missing ops and renders the review report", () => {
    const outcomes: DraftOutcome[] = [
      { kind: "drafted", name: "Shock", script: lightningStrike },
      { kind: "needs_new_op", name: "A", missing: ["Dies trigger."] },
      { kind: "needs_new_op", name: "B", missing: ["dies trigger", "scry"] },
      { kind: "invalid", name: "C", errors: ["bad op"] },
      { kind: "skipped", name: "D", reason: "already scripted" },
    ];
    expect(tallyMissingOps(outcomes)[0]).toEqual({
      missing: "dies trigger",
      cards: ["A", "B"],
    });
    const report = renderReport("DSK", outcomes);
    expect(report).toContain(
      "1 drafted, 2 need new ops, 1 failed the schema, 1 skipped.",
    );
    expect(report).toContain("- dies trigger (2): A, B");
    expect(report).toContain("- C: bad op");
    expect(report).toContain("- already scripted: 1");
  });

  it("names files like the hand-written scripts", () => {
    expect(scriptFileName("Jeong Jeong's Deserters")).toBe(
      "jeong_jeong_s_deserters.json",
    );
    expect(scriptFileName("S.H.I.E.L.D. Deployment Drone")).toBe(
      "s_h_i_e_l_d_deployment_drone.json",
    );
  });
});
