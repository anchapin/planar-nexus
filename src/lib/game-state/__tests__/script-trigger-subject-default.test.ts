/**
 * The script index is installed raw (no zod parse), so a trigger with no
 * `subject` must still read as "self". Without that, "When Sarkhan enters"
 * fired for every permanent that entered, including the Treasure it made,
 * and #2614's seeded games looped forever.
 */
import { describe, it, expect, beforeAll } from "@jest/globals";
import { registerCardScripts } from "../card-scripts/registry";
import { RAW_CARD_SCRIPTS } from "../card-scripts/cards/index.generated";
import { getScriptedTriggeredAbilities } from "../abilities/parse";
import type { ScryfallCard } from "@/lib/card-database";

const sarkhan = {
  name: "Sarkhan, Dragon Ascendant",
  type_line: "Legendary Creature — Human Monk",
  oracle_text: "",
} as unknown as ScryfallCard;

describe("scripted trigger subject default (#2614)", () => {
  beforeAll(() => registerCardScripts(RAW_CARD_SCRIPTS));

  it("the raw index really omits the subject on Sarkhan's own ETB", () => {
    const raw = RAW_CARD_SCRIPTS.find(
      (s) => (s as { name: string }).name === sarkhan.name,
    ) as { triggers: Array<{ subject?: string }> };
    expect(raw.triggers[0].subject).toBeUndefined();
  });

  it("reads a missing subject as self, with no entering filter", () => {
    const [own] = getScriptedTriggeredAbilities(sarkhan) ?? [];
    expect(own.trigger.subject).toBe("self");
    expect(own.trigger.enteringFilter).toBeUndefined();
  });

  it("keeps an explicit subject on the Dragon-enters trigger", () => {
    const [, dragon] = getScriptedTriggeredAbilities(sarkhan) ?? [];
    expect(dragon.trigger.subject).toBe("another");
    expect(dragon.trigger.enteringFilter).toMatchObject({ subtype: "Dragon" });
  });
});
