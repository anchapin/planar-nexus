/**
 * Card scripts — cycling.
 *
 * Split out of the 9.8k-line card-scripts.test.ts (#2642). Suites:
 *   - scripted cycling (#2566)
 */
import { CardScript } from "../schema";
import { CardScriptSchema } from "../index";
import { Phase } from "../../types";
import { RAW_CARD_SCRIPTS } from "../cards/index.generated";
import { ScryfallCard } from "../../types";
import { createInitialGameState, startGame } from "../../game-state";
import { cycleCard } from "../../keyword-actions/cycling";
import { getActivatedAbilities } from "../../abilities/parse";
import { id, card, put } from "./helpers";
import { registerCardScripts } from "../registry";

describe("scripted cycling (#2566)", () => {
  // Cycling (CR 702.30) + Typecycling / Landcycling / Basic landcycling
  // (CR 702.31) for card scripts. The engine has a full implementation
  // in `keyword-actions/cycling.ts`; the script side adds a
  // `cycling: { cost, variant, type?, basicLandType? }` field to
  // `CardScriptSchema` and synthesizes a `ParsedActivatedAbility` from
  // it so the ability is exposed to the engine/UI.
  //
  // v1 limitation (documented in the schema): the engine's `cycleCard`
  // still reads the cycling keyword from `card.cardData.oracle_text`,
  // so the drafter must mirror the cycling line into the `oracle`
  // field. The structured `cycling` field on the script is the
  // drafter-facing form; the engine's `getActivatedAbilities` returns
  // a synthesized ability whose `effect` text matches the canonical
  // `parseCycling` patterns so resolution keeps working.

  it("schema accepts a base cycling field", () => {
    const result = CardScriptSchema.safeParse({
      name: "Hill Gigas",
      oracle:
        "{5}{R}\nHill Gigas\nCreature — Giant\nCycling {2} ({2}, Discard this card: Draw a card.)",
      cycling: { cost: "{2}", variant: "cycling" },
    });
    expect(result.success).toBe(true);
  });

  it("schema accepts all four cycling variants", () => {
    // Typecycling (e.g. Galeprowler).
    const tc = CardScriptSchema.safeParse({
      name: "Galeprowler",
      oracle: "Wizardcycling {2}",
      cycling: { cost: "{2}", variant: "typecycling", type: "Wizard" },
    });
    expect(tc.success).toBe(true);

    // Landcycling (any land).
    const lc = CardScriptSchema.safeParse({
      name: "Terminal Moraine",
      oracle: "Landcycling {1}",
      cycling: { cost: "{1}", variant: "landcycling" },
    });
    expect(lc.success).toBe(true);

    // [Type] landcycling (e.g. Island landcycling).
    const ilc = CardScriptSchema.safeParse({
      name: "Flooded Strand",
      oracle: "Islandcycling {1}{U}",
      cycling: {
        cost: "{1}{U}",
        variant: "landcycling",
        basicLandType: "Island",
      },
    });
    expect(ilc.success).toBe(true);

    // Basic landcycling.
    const blc = CardScriptSchema.safeParse({
      name: "Terminal Moraine",
      oracle: "Basic landcycling {1}",
      cycling: { cost: "{1}", variant: "basic_landcycling" },
    });
    expect(blc.success).toBe(true);
  });

  it("schema rejects a cycling field without a mana cost", () => {
    const result = CardScriptSchema.safeParse({
      name: "X",
      oracle: "x",
      cycling: {},
    });
    expect(result.success).toBe(false);
  });

  it("schema rejects an unknown cycling variant", () => {
    const result = CardScriptSchema.safeParse({
      name: "X",
      oracle: "x",
      cycling: { cost: "{2}", variant: "mythiccycling" },
    });
    expect(result.success).toBe(false);
  });

  it("schema accepts a cycling-only script (no triggers/activated/etc.)", () => {
    // A creature whose only scripted ability is cycling (e.g. Hill
    // Gigas). The required-field refine in the schema explicitly
    // allows `cycling` to be the sole shape (#2566).
    const result = CardScriptSchema.safeParse({
      name: "Hill Gigas",
      oracle: "Cycling {2}",
      cycling: { cost: "{2}", variant: "cycling" },
    });
    expect(result.success).toBe(true);
  });

  // A scripted cycling card. We register it as a fixture because
  // `getActivatedAbilities` reads scripted abilities from the registry
  // keyed on card name. The `oracle` field mirrors the cycling line so
  // the engine's `parseCycling` / `cycleCard` paths can find it (v1).
  const hillGigasScript: CardScript = {
    name: "Test Hill Gigas",
    oracle: "{5}{R}\nCycling {2} ({2}, Discard this card: Draw a card.)",
    cycling: { cost: "{2}", variant: "cycling" },
  };
  // A typecycling card to exercise the variant effect text.
  const wizardCyclerScript: CardScript = {
    name: "Test Wizard Cycler",
    oracle: "Wizardcycling {2}",
    cycling: { cost: "{2}", variant: "typecycling", type: "Wizard" },
  };

  // The full registry this describe runs against. The register/restore
  // tests below replace the registry mid-describe, so their `finally`
  // blocks must restore THIS set, not the raw index: under jest
  // --randomize their restore can run before the fixture tests above,
  // which otherwise lose hillGigas/wizardCycler and fall back to
  // oracle-text parsing (0 abilities).
  const withCyclingScripts = [
    ...RAW_CARD_SCRIPTS,
    hillGigasScript,
    wizardCyclerScript,
  ];

  beforeAll(() => registerCardScripts(withCyclingScripts));
  afterAll(() => registerCardScripts(RAW_CARD_SCRIPTS));

  it("getActivatedAbilities synthesizes a Cycling {cost} ability", () => {
    const hillGigas = card("Test Hill Gigas", "Creature — Giant", [3, 3]);
    const abilities = getActivatedAbilities(hillGigas);
    expect(abilities).toHaveLength(1);
    const a = abilities[0];
    // The cycling cost is recorded on the parsed ability.
    expect(a.costs.mana).not.toBeNull();
    expect(a.costs.mana!.generic).toBe(2);
    // CR 702.30a: the cost includes discarding the card itself.
    expect(a.costs.discard).toBe(true);
    // Sorcery-speed (CR 117.1a).
    expect(a.sorceryOnly).toBe(true);
    // The effect text is the canonical "Cycling {cost}." form that
    // `parseCycling` recognizes when the engine falls back to reading
    // the card's oracle text.
    expect(a.effect).toBe("Cycling {2}.");
  });

  it("getActivatedAbilities synthesizes a typecycling ability with the named type", () => {
    const wiz = card("Test Wizard Cycler", "Creature — Human Wizard", [1, 1]);
    const abilities = getActivatedAbilities(wiz);
    expect(abilities).toHaveLength(1);
    expect(abilities[0].effect).toBe("Wizardcycling {2}.");
    expect(abilities[0].costs.mana!.generic).toBe(2);
    expect(abilities[0].costs.discard).toBe(true);
  });

  it("a cycling card with no other ability is valid and surfaces one ability", () => {
    // The schema's required-field refine explicitly allows
    // `cycling`-only scripts; confirm the synthesis still works.
    const hillGigas = card("Test Hill Gigas", "Creature — Giant", [3, 3]);
    const abilities = getActivatedAbilities(hillGigas);
    expect(abilities).toHaveLength(1);
    expect(abilities[0].effect).toMatch(/^Cycling /);
  });

  it("a card with both `activated` and `cycling` exposes both abilities", () => {
    // Some cards have a cycling variant and a regular activated ability
    // (e.g. Skyclave Apparition's cycling). The synthesis appends the
    // cycling ability to whatever the script's `activated` list has.
    const script: CardScript = {
      name: "Test Cycler + Activated",
      oracle: "{T}: Draw a card.\nCycling {2}.",
      activated: [
        {
          text: "Draw a card.",
          cost: { tap: true, sacrifice: false, exileSelf: false },
          effects: [{ op: "Draw", amount: 1, who: "you" }],
        },
      ],
      cycling: { cost: "{2}", variant: "cycling" },
    };
    registerCardScripts([...RAW_CARD_SCRIPTS, script]);
    try {
      const cd = card("Test Cycler + Activated", "Creature — Spirit", [2, 2]);
      const abilities = getActivatedAbilities(cd);
      expect(abilities).toHaveLength(2);
      const effects = abilities.map((a) => a.effect).sort();
      expect(effects).toEqual(["Cycling {2}.", "Draw a card."]);
    } finally {
      registerCardScripts(withCyclingScripts);
    }
  });

  it("engine: cycleCard resolves a scripted cycling card via the oracle-text fallback", () => {
    // v1 limitation: the engine's `cycleCard` reads the cycling cost
    // from `card.cardData.oracle_text` (the existing `parseCycling`
    // path, #2566). When a card's `oracle` mirrors the cycling line,
    // the engine can resolve cycling end-to-end — the drafter must
    // include "Cycling {cost}." in the `oracle` field. This test
    // documents that contract.
    //
    // A future lane will thread the script's `cycling` data into
    // `cycleCard` directly so the oracle-text fallback is no longer
    // required.
    const script: CardScript = {
      name: "Test Cycling Creature",
      oracle: "Cycling {2} ({2}, Discard this card: Draw a card.)",
      cycling: { cost: "{2}", variant: "cycling" },
    };
    registerCardScripts([...RAW_CARD_SCRIPTS, script]);
    try {
      const s0 = startGame(
        createInitialGameState(["Player1", "Player2"], 20, false),
      );
      const [p1] = Array.from(s0.players.keys());
      const cardId = id("cycler");
      let s = put(
        s0,
        p1,
        "cycler",
        {
          ...card("Test Cycling Creature", "Creature — Beast", [3, 3]),
          oracle_text: "Cycling {2} ({2}, Discard this card: Draw a card.)",
        } as ScryfallCard,
        "hand",
      );
      // Cycling is sorcery-speed: only during a main phase, with
      // priority, on the active player's turn. The fresh game starts
      // in the untap step, so we set the phase + priority.
      s = {
        ...s,
        turn: { ...s.turn, currentPhase: Phase.PRECOMBAT_MAIN },
        priorityPlayerId: p1,
      };
      // Fund the cycling cost (2 generic).
      const player = s.players.get(p1)!;
      s = {
        ...s,
        players: new Map(s.players).set(p1, {
          ...player,
          manaPool: { ...player.manaPool, generic: 2 },
        }),
      };

      const result = cycleCard(s, p1, cardId);
      expect(result.success).toBe(true);
      // The cycled card is now in the graveyard.
      expect(result.state.zones.get(`${p1}-graveyard`)!.cardIds).toContain(
        cardId,
      );
      // The cycler drew a card.
      const postHand = result.state.zones.get(`${p1}-hand`)!.cardIds;
      // The cycled card left the hand; the engine drew a card (so the
      // hand may contain other cards, but the cycler isn't in it).
      expect(postHand).not.toContain(cardId);
    } finally {
      registerCardScripts(withCyclingScripts);
    }
  });
});
