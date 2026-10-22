/**
 * Card scripts — endstep lifegain triggers.
 *
 * Split out of the 9.8k-line card-scripts.test.ts (#2642). Suites:
 *   - scripted end-step and life-gain triggers (#2594 follow-up)
 */
import { CardScript } from "../schema";
import { CardScriptSchema } from "../index";
import { RAW_CARD_SCRIPTS } from "../cards/index.generated";
import { ScryfallCard } from "../../types";
import { card, put } from "./helpers";
import { getTriggeredAbilities } from "../../abilities/parse";
import { registerCardScripts } from "../registry";

describe("scripted end-step and life-gain triggers (#2594 follow-up)", () => {
  // CR 702.1a / 118: "At the beginning of your end step" and
  // "whenever you gain life" trigger events. The engine's
  // `abilities/triggered.ts` already fires `phaseEnds` and `lifeGain`
  // (issues #2498, #2496); the script surface just needs the schema
  // arm and a one-line `scriptedCondition` branch.

  // Hypothetical: "At the beginning of your end step, Midnight Snack
  // deals 1 damage to each opponent." — global event, no subject.
  const midnightSnackScript: CardScript = {
    name: "Test Midnight Snack",
    oracle:
      "At the beginning of your end step, Midnight Snack deals 1 damage to each opponent.",
    triggers: [
      {
        text: "At the beginning of your end step, this creature deals 1 damage to each opponent.",
        event: "phaseEnds",
        subject: "self",
        effects: [{ op: "DealDamage", amount: 1, target: "each_opponent" }],
      },
    ],
  };

  // Ajani's Pridemate: "Whenever you gain life, put a +1/+1 counter on
  // Ajani's Pridemate." — life-gain event, subject=self.
  const ajanisPridemateScript: CardScript = {
    name: "Test Ajani's Pridemate",
    oracle: "Whenever you gain life, put a +1/+1 counter on Ajani's Pridemate.",
    triggers: [
      {
        text: "Whenever you gain life, put a +1/+1 counter on this creature.",
        event: "lifeGain",
        subject: "self",
        effects: [
          {
            op: "PutCounters",
            counter: "+1/+1",
            amount: 1,
            target: "self",
            use_source_power: false,
          },
        ],
      },
    ],
  };

  beforeAll(() =>
    registerCardScripts([
      ...RAW_CARD_SCRIPTS,
      midnightSnackScript,
      ajanisPridemateScript,
    ]),
  );
  afterAll(() => registerCardScripts(RAW_CARD_SCRIPTS));

  it("schema accepts `phaseEnds` (end step) and `lifeGain` events", () => {
    const phaseEndsOk = CardScriptSchema.safeParse({
      name: "Test End Step Card",
      oracle: "At the beginning of your end step, draw a card.",
      triggers: [
        {
          text: "At the beginning of your end step, draw a card.",
          event: "phaseEnds",
          subject: "self",
          effects: [{ op: "Draw", amount: 1, who: "you" }],
        },
      ],
    });
    expect(phaseEndsOk.success).toBe(true);

    const lifeGainOk = CardScriptSchema.safeParse({
      name: "Test Life Gain Card",
      oracle: "Whenever you gain life, draw a card.",
      triggers: [
        {
          text: "Whenever you gain life, draw a card.",
          event: "lifeGain",
          subject: "self",
          effects: [{ op: "Draw", amount: 1, who: "you" }],
        },
      ],
    });
    expect(lifeGainOk.success).toBe(true);
  });

  it("schema rejects an unknown event value", () => {
    const result = CardScriptSchema.safeParse({
      name: "X",
      oracle: "x",
      triggers: [
        {
          text: "weird",
          // drawCard was added in Wave 4.8 follow-up 12 lane 87
          // (#2614 follow-up), so the unknown-event test now uses a
          // different unrecognised value.
          event: "totallyMadeUpEvent",
          subject: "self",
          effects: [{ op: "Draw", amount: 1, who: "you" }],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("schema accepts `drawCard` event with whose_draws filter (lane 87)", () => {
    const ok = CardScriptSchema.safeParse({
      name: "Scrawling Crawler",
      oracle: "Whenever an opponent draws a card, that player loses 1 life.",
      triggers: [
        {
          text: "Whenever an opponent draws a card, that player loses 1 life.",
          event: "drawCard",
          subject: "self",
          whose_draws: "opponent",
          effects: [{ op: "LoseLife", amount: 1, who: "drawer" }],
        },
      ],
    });
    expect(ok.success).toBe(true);
  });

  it("getTriggeredAbilities parses a scripted `phaseEnds` trigger", () => {
    const midnightSnack = {
      ...card("Test Midnight Snack", "Creature — Rat", [2, 1]),
      oracle_text:
        "At the beginning of your end step, Midnight Snack deals 1 damage to each opponent.",
    } as ScryfallCard;
    const triggers = getTriggeredAbilities(midnightSnack);
    expect(triggers).toHaveLength(1);
    expect(triggers[0].trigger.event).toBe("phaseEnds");
  });

  it("getTriggeredAbilities parses a scripted `lifeGain` trigger", () => {
    const ajanisPridemate = {
      ...card("Test Ajani's Pridemate", "Creature — Cat Soldier", [0, 0]),
      oracle_text:
        "Whenever you gain life, put a +1/+1 counter on Ajani's Pridemate.",
    } as ScryfallCard;
    const triggers = getTriggeredAbilities(ajanisPridemate);
    expect(triggers).toHaveLength(1);
    expect(triggers[0].trigger.event).toBe("lifeGain");
  });
});
