/**
 * `enter_choice: { kind: "chosen_name" }` schema baseline
 * (Wave 4.7 follow-up lane 48, #2708 phase 1, #2594 follow-up).
 *
 * The schema-only baseline for the Sorcerous Spyglass pattern:
 * - `enter_choice.kind` accepts the new `"chosen_name"` enum
 *   value (forward-compatible — the multi-lane engine arm ships
 *   in a future lane).
 * - `CardInstance.chosenCardName` defaults to `null` on every
 *   freshly-created instance.
 * - `CardScriptSchema` parses a `chosen_name` script.
 *
 * No sample card JSON is shipped in this lane. The full
 * script (look-at-hand → pick-card-name → stamp
 * `chosenCardName` → chosen-name static block) is multi-lane
 * and tracks under #2708.
 */
import { describe, it, expect } from "@jest/globals";
import { CardScriptSchema } from "../schema";
import { createCardInstance } from "../../card-instance";
import { getCardScript } from "../registry";

describe("chosen_name enter_choice schema baseline (Wave 4.7 follow-up lane 48, #2708 phase 1)", () => {
  it("CardScriptSchema parses a chosen_name script", () => {
    const parsed = CardScriptSchema.safeParse({
      name: "Sorcerous Spyglass (schema baseline)",
      oracle:
        "As Sorcerous Spyglass enters, look at an opponent's hand, then choose any card name.",
      enter_choice: {
        kind: "chosen_name",
        text:
          "As Sorcerous Spyglass enters, look at an opponent's hand, then choose any card name.",
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("CardScriptSchema rejects an unknown enter_choice.kind", () => {
    const parsed = CardScriptSchema.safeParse({
      name: "Bogus",
      oracle: "As Bogus enters, choose a continent.",
      enter_choice: {
        kind: "continent",
        text: "As Bogus enters, choose a continent.",
      },
    });
    expect(parsed.success).toBe(false);
  });

  it("chosenCardName defaults to null on freshly-created instances", () => {
    const card = createCardInstance(
      {
        id: "mock-test",
        name: "Test Permanent",
        type_line: "Artifact",
        oracle_text: "",
        mana_cost: "{2}",
        cmc: 2,
        colors: [],
        color_identity: [],
        keywords: [],
        legalities: { standard: "legal" },
        layout: "normal",
      },
      "alice",
      "alice",
    );
    expect(card.chosenCardName).toBeNull();
  });

  it("getCardScript is undefined for the synthetic chosen_name card (no JSON registered)", () => {
    // The schema accepts chosen_name but no real or synthetic
    // JSON is registered — the registry is data-driven from
    // `cards/`. A follow-up lane adds a Sorcerous Spyglass
    // JSON + the engine arm.
    expect(getCardScript("Sorcerous Spyglass (schema baseline)")).toBeUndefined();
  });
});
