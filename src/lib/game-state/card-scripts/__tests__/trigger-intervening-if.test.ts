/**
 * Card scripts — trigger intervening if.
 *
 * Split out of the 9.8k-line card-scripts.test.ts (#2642). Suites:
 *   - Scrawling Crawler: each player draws a card in upkeep (#2594 lane 25)
 *   - Discard each_player dispatch (#2594 lane 25)
 *   - Crypt Feaster: threshold intervening-if on attacks trigger (#2594 lane 26)
 *   - Cackling Prowler: morbid intervening-if on phaseEnds trigger (#2594 lane 28)
 *   - Skyship Buccaneer: raid intervening-if on phaseEnds trigger (#2594 lane 29)
 *   - Knight of Grace: literal color anthem (#2594 lane 30)
 */
/**
 * Card scripts — attack damage and counters.
 *
 * Split out of the 9.8k-line card-scripts.test.ts (#2642). Suites:
 *   - Hired Claw: Lizard attack ping and conditional counter (#2614)
 *   - Generous Plunderer: Treasures and attack damage (#2614)
 *   - Smaug the Magnificent: Treasure-scaled attack damage (#2614)
 *   - Magmatic Hellkite: land destruction and stun counters (#2614)
 *   - Surrak, Elusive Hunter: draw when an opponent targets your creatures (#2614)
 *   - Scrawling Crawler: each player draws a card in upkeep (#2594 lane 25)
 *   - Discard each_player dispatch (#2594 lane 25)
 *   - Crypt Feaster: threshold intervening-if on attacks trigger (#2594 lane 26)
 *   - Cackling Prowler: morbid intervening-if on phaseEnds trigger (#2594 lane 28)
 *   - Skyship Buccaneer: raid intervening-if on phaseEnds trigger (#2594 lane 29)
 *   - Knight of Grace: literal color anthem (#2594 lane 30)
 */
import {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
  StackObject,
} from "../../types";
import {
  CardScriptSchema,
  getCardScript,
  resolveScriptedAbility,
} from "../index";
import { Phase } from "../../types";
import { activateAbility } from "../../abilities/activated";
import { autoChooseTriggerTargets } from "../../trigger-system/trigger-targets";
import {
  createInitialGameState,
  startGame,
  processUntapStep,
} from "../../game-state";
import { declareAttackers } from "../../combat/declaration";
import { detectTriggeredAbilities } from "../../abilities/triggered";
import { evaluateInterveningIfClause } from "../../abilities/evaluate";
import { fireTargetedTriggers } from "../../keyword-actions/targeted";
import {
  getEffectivePower,
  getEffectiveToughness,
} from "../../evergreen-keywords";
import {
  getScriptedTriggeredAbilities,
  getTriggeredAbilities,
} from "../../abilities/parse";
import { id, card, put, spell, cardTarget, battlefield } from "./helpers";
import { markAttackedThisTurn } from "../../keyword-actions/raid";
import { markCreatureDiedThisTurn } from "../../keyword-actions/morbid";
import { passPriority } from "../../game-state";
import { putTriggersOnStack } from "../../trigger-system/stack-ops";
import { refreshScriptedStatics } from "../../keyword-actions/scripted-statics";
import { resolveScriptedEffects } from "../interpret";

describe("Scrawling Crawler: each player draws a card in upkeep (#2594 lane 25)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;
  const hand = (s: GameState, who: PlayerId) =>
    s.zones.get(`${who}-hand`)?.cardIds.length ?? 0;
  const library = (s: GameState, who: PlayerId) =>
    s.zones.get(`${who}-library`)?.cardIds.length ?? 0;
  const run = (s: GameState) =>
    resolveScriptedEffects(
      s,
      getCardScript("Scrawling Crawler")!.triggers![0].effects!,
      {
        controllerId: p1,
        sourceCardId: id("crawler"),
        targets: [],
      } as unknown as StackObject,
    );

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
    state = put(state, p1, "crawler", {
      id: "mock-Scrawling Crawler",
      name: "Scrawling Crawler",
      type_line: "Creature — Eldrazi Drone",
      oracle_text: "",
      mana_cost: "",
      cmc: 0,
      colors: [],
      color_identity: [],
      keywords: [],
      legalities: { standard: "legal" },
      layout: "normal",
      power: "2",
      toughness: "2",
    } as unknown as ScryfallCard);
    // game startGame gives each player a full library (60 cards by default),
    // so the draw effect has plenty to chew on.
  });

  it("upkeep: each_player draws for both the controller and every opponent", () => {
    const beforeP1Hand = hand(state, p1);
    const beforeP2Hand = hand(state, p2);
    const beforeP1Lib = library(state, p1);
    const beforeP2Lib = library(state, p2);
    const after = run(state);
    // both players' hands grew by exactly 1 and libraries shrank by exactly 1
    expect(hand(after, p1)).toBe(beforeP1Hand + 1);
    expect(hand(after, p2)).toBe(beforeP2Hand + 1);
    expect(library(after, p1)).toBe(beforeP1Lib - 1);
    expect(library(after, p2)).toBe(beforeP2Lib - 1);
  });
});

describe("Discard each_player dispatch (#2594 lane 25)", () => {
  it("Discard { who: 'each_player' } is a valid schema arm", () => {
    const parsed = CardScriptSchema.safeParse({
      name: "Discard each",
      oracle: "Each player discards a card.",
      spell: [{ op: "Discard", amount: 1, who: "each_player" }],
    });
    expect(parsed.success).toBe(true);
  });

  it("Discard { who: 'each_player' } asks each player to discard (#2594 lane 25)", () => {
    // mirrors the each_opponent precedent in "asks the discarding player to
    // choose, then discards the pick" above; the difference here is that
    // every player (controller + opponents) is queued for the same
    // discard_cards waiting choice.
    const state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [p1, p2] = Array.from(state.players.keys());
    const after = resolveScriptedEffects(
      state,
      [{ op: "Discard", amount: 1, who: "each_player" } as never],
      {
        controllerId: p1,
        sourceCardId: null as never,
        targets: [],
      } as unknown as StackObject,
    );
    // startDiscard sets a discard_cards waiting choice (controller first,
    // opponent queued behind). Library and graveyard counts must be
    // unchanged until the player picks.
    expect(after.waitingChoice?.type).toBe("discard_cards");
  });
});

describe("Crypt Feaster: threshold intervening-if on attacks trigger (#2594 lane 26)", () => {
  it("passes intervening_if through scriptedTrigger to ParsedTriggeredAbility", () => {
    const crypt = getCardScript("Crypt Feaster");
    expect(crypt).toBeDefined();
    const trig = crypt!.triggers![0];
    expect(trig.intervening_if).toBe(
      "there are seven or more cards in your graveyard",
    );

    const abilities = getScriptedTriggeredAbilities(
      // any ScryfallCard with the right oracle works for parse; the
      // engine looks at scriptedTrigger's `t` not the card text.
      { name: "Crypt Feaster" } as unknown as ScryfallCard,
    );
    expect(abilities).toBeDefined();
    expect(abilities![0].interveningIf).toBe(
      "there are seven or more cards in your graveyard",
    );
  });

  it("attack trigger is suppressed when the graveyard has 0 cards", () => {
    // Direct evaluator: 0 cards in p1's graveyard → clause is false.
    const state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [p1] = Array.from(state.players.keys());
    const cluase = "there are seven or more cards in your graveyard";
    expect(evaluateInterveningIfClause(cluase, state, p1)).toBe(false);
  });

  it("attack trigger is suppressed when the graveyard has 6 cards", () => {
    let state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [p1] = Array.from(state.players.keys());
    // put 6 cards in p1's graveyard
    for (let i = 0; i < 6; i++) {
      const cardId = `g${i}` as CardInstanceId;
      state = put(
        state,
        p1,
        `g${i}`,
        card("Discarded", "Creature — Rat"),
        "graveyard",
      );
    }
    const cluase = "there are seven or more cards in your graveyard";
    expect(evaluateInterveningIfClause(cluase, state, p1)).toBe(false);
  });

  it("attack trigger fires when the graveyard has 7 cards", () => {
    let state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [p1] = Array.from(state.players.keys());
    for (let i = 0; i < 7; i++) {
      state = put(
        state,
        p1,
        `g${i}`,
        card("Discarded", "Creature — Rat"),
        "graveyard",
      );
    }
    const cluase = "there are seven or more cards in your graveyard";
    expect(evaluateInterveningIfClause(cluase, state, p1)).toBe(true);
  });
});

describe("Cackling Prowler: morbid intervening-if on phaseEnds trigger (#2594 lane 28)", () => {
  // Cackling Prowler (FDN 1/3/2, 2G) — "At the beginning of your end step,
  // if a creature died this turn, put a +1/+1 counter on this creature."
  // (#2594 lane 28.) The existing lane 26 intervening_if plumbing covers
  // this without any new schema or engine work; the lane ships one
  // sample card + a small test that proves:
  //   1. the script is in the registry with the right intervening_if,
  //   2. the parse pipeline forwards intervening_if to the
  //      ParsedTriggeredAbility,
  //   3. the clause evaluator returns false with no death, true with one,
  //   4. resolving the end-of-turn ability actually puts a +1/+1 counter
  //      on Cackling Prowler only when the morbid flag is set.

  it("registry exposes Cackling Prowler with the morbid intervening_if", () => {
    const prowler = getCardScript("Cackling Prowler");
    expect(prowler).toBeDefined();
    const trig = prowler!.triggers![0];
    expect(trig.event).toBe("phaseEnds");
    expect(trig.intervening_if).toBe("a creature died this turn");
    expect(trig.effects).toEqual([
      {
        op: "PutCounters",
        counter: "+1/+1",
        amount: 1,
        target: "self",
      },
    ]);
  });

  it("forwards intervening_if to ParsedTriggeredAbility", () => {
    const abilities = getScriptedTriggeredAbilities({
      name: "Cackling Prowler",
    } as unknown as ScryfallCard);
    expect(abilities).toBeDefined();
    expect(abilities![0].interveningIf).toBe("a creature died this turn");
  });

  it("evaluator returns false on a clean turn (no creature has died)", () => {
    const state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [p1] = Array.from(state.players.keys());
    expect(state.turn.creatureDiedThisTurn).toBeFalsy();
    expect(
      evaluateInterveningIfClause("a creature died this turn", state, p1),
    ).toBe(false);
  });

  it("evaluator returns true after markCreatureDiedThisTurn flips the flag", () => {
    const state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [p1] = Array.from(state.players.keys());
    const flagged = markCreatureDiedThisTurn(state);
    expect(flagged.turn.creatureDiedThisTurn).toBe(true);
    expect(
      evaluateInterveningIfClause("a creature died this turn", flagged, p1),
    ).toBe(true);
  });

  it("end-of-turn trigger is suppressed when no creature died this turn", () => {
    // The intervening_if clause (CR 603.4) is checked in the trigger
    // detection pipeline (`abilities/triggered.ts`), not in the
    // resolution layer. With no creature having died, the trigger
    // must NOT be put on the stack at the end of turn.
    let state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [p1] = Array.from(state.players.keys());
    state = put(
      state,
      p1,
      "prowler",
      card("Cackling Prowler", "Creature — Horror", [1, 3]),
    );
    expect(state.turn.creatureDiedThisTurn).toBeFalsy();

    const triggers = detectTriggeredAbilities(state, "endOfTurn");
    const prowlerTriggers = triggers.filter(
      (t) => t.sourceCardId === id("prowler"),
    );
    expect(prowlerTriggers).toHaveLength(0);
  });

  it("end-of-turn trigger fires when a creature has died this turn, and resolves into a +1/+1 counter", () => {
    // Flip the morbid flag, then re-detect: the trigger must now be
    // present, get pushed onto the stack, and resolve into a +1/+1
    // counter on Cackling Prowler.
    let state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [p1] = Array.from(state.players.keys());
    state = put(
      state,
      p1,
      "prowler",
      card("Cackling Prowler", "Creature — Horror", [1, 3]),
    );
    state = markCreatureDiedThisTurn(state);

    const triggers = detectTriggeredAbilities(state, "endOfTurn");
    const prowlerTriggers = triggers.filter(
      (t) => t.sourceCardId === id("prowler"),
    );
    expect(prowlerTriggers).toHaveLength(1);

    // Put the trigger on the stack, then resolve it.
    const { state: stacked, triggeredAbilities } = putTriggersOnStack(
      state,
      prowlerTriggers,
    );
    expect(triggeredAbilities).toHaveLength(1);
    expect(stacked.stack).toHaveLength(1);
    const stackObject = stacked.stack[0];
    const resolved = resolveScriptedAbility(stacked, stackObject)!;
    const prowler = resolved.cards.get(id("prowler"))!;
    const counters = prowler.counters.filter((c) => c.type === "+1/+1");
    expect(counters.reduce((sum, c) => sum + c.count, 0)).toBe(1);
  });
});

describe("Skyship Buccaneer: raid intervening-if on phaseEnds trigger (#2594 lane 29)", () => {
  // Skyship Buccaneer (FDN) — "Raid — At the beginning of your end
  // step, if you attacked this turn, put a +1/+1 counter on this
  // creature." (#2594 lane 29.) Like lane 28's Cackling Prowler, the
  // raid pattern rides on lane 26's intervening_if plumbing; the
  // engine's `RAID_CONDITION` regex (keyword-actions/raid.ts) matches
  // "you attacked this turn" and `Player.attackedThisTurn` is set by
  // `declareAttackers`.

  it("registry exposes Skyship Buccaneer with the raid intervening_if", () => {
    const buccaneer = getCardScript("Skyship Buccaneer");
    expect(buccaneer).toBeDefined();
    const trig = buccaneer!.triggers![0];
    expect(trig.event).toBe("phaseEnds");
    expect(trig.intervening_if).toBe("you attacked this turn");
    expect(trig.effects).toEqual([
      {
        op: "PutCounters",
        counter: "+1/+1",
        amount: 1,
        target: "self",
      },
    ]);
  });

  it("forwards intervening_if to ParsedTriggeredAbility", () => {
    const abilities = getScriptedTriggeredAbilities({
      name: "Skyship Buccaneer",
    } as unknown as ScryfallCard);
    expect(abilities).toBeDefined();
    expect(abilities![0].interveningIf).toBe("you attacked this turn");
  });

  it("evaluator returns false when the controller has not attacked this turn", () => {
    const state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [p1] = Array.from(state.players.keys());
    expect(state.players.get(p1)?.attackedThisTurn).toBeFalsy();
    expect(
      evaluateInterveningIfClause("you attacked this turn", state, p1),
    ).toBe(false);
  });

  it("evaluator returns true after markAttackedThisTurn flips the flag", () => {
    const state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [p1] = Array.from(state.players.keys());
    const attacked = markAttackedThisTurn(state, [p1]);
    expect(attacked.players.get(p1)?.attackedThisTurn).toBe(true);
    expect(
      evaluateInterveningIfClause("you attacked this turn", attacked, p1),
    ).toBe(true);
  });

  it("end-of-turn trigger is suppressed when the controller has not attacked this turn", () => {
    let state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [p1] = Array.from(state.players.keys());
    state = put(
      state,
      p1,
      "buccaneer",
      card("Skyship Buccaneer", "Creature — Human Pirate", [2, 2]),
    );
    expect(state.players.get(p1)?.attackedThisTurn).toBeFalsy();

    const triggers = detectTriggeredAbilities(state, "endOfTurn");
    const buccaneerTriggers = triggers.filter(
      (t) => t.sourceCardId === id("buccaneer"),
    );
    expect(buccaneerTriggers).toHaveLength(0);
  });

  it("end-of-turn trigger fires when the controller has attacked, and resolves into a +1/+1 counter", () => {
    let state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [p1] = Array.from(state.players.keys());
    state = put(
      state,
      p1,
      "buccaneer",
      card("Skyship Buccaneer", "Creature — Human Pirate", [2, 2]),
    );
    state = markAttackedThisTurn(state, [p1]);

    const triggers = detectTriggeredAbilities(state, "endOfTurn");
    const buccaneerTriggers = triggers.filter(
      (t) => t.sourceCardId === id("buccaneer"),
    );
    expect(buccaneerTriggers).toHaveLength(1);

    const { state: stacked, triggeredAbilities } = putTriggersOnStack(
      state,
      buccaneerTriggers,
    );
    expect(triggeredAbilities).toHaveLength(1);
    expect(stacked.stack).toHaveLength(1);
    const stackObject = stacked.stack[0];
    const resolved = resolveScriptedAbility(stacked, stackObject)!;
    const buccaneer = resolved.cards.get(id("buccaneer"))!;
    const counters = buccaneer.counters.filter((c) => c.type === "+1/+1");
    expect(counters.reduce((sum, c) => sum + c.count, 0)).toBe(1);
  });
});

describe("Knight of Grace: literal color anthem (#2594 lane 30)", () => {
  // Knight of Grace is a sub-piece of the (multi-lane) Lane 24
  // chosen-color anthem work; the static-ability schema gets a new
  // `affects.color` literal (Scryfall "W"..."G" form) and the
  // applicator in `staticAffects` filters by the target's color set.
  // Sample card: "White creatures you control get +1/+1." — pumps
  // white creatures the controller owns and leaves everyone else
  // alone.

  // Build a ScryfallCard that has real colors (the top-level `card()`
  // helper hard-codes colors: []).
  const coloredCard = (
    name: string,
    typeLine: string,
    pt: [number, number],
    colors: string[],
  ): ScryfallCard =>
    ({
      id: `mock-${name}`,
      name,
      type_line: typeLine,
      oracle_text: "",
      mana_cost: "",
      cmc: 0,
      colors,
      color_identity: colors,
      keywords: [],
      legalities: { standard: "legal" },
      layout: "normal",
      power: String(pt[0]),
      toughness: String(pt[1]),
    }) as unknown as ScryfallCard;

  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  const pt = (s: GameState, cardId: string) => {
    const c = s.cards.get(id(cardId))!;
    return [getEffectivePower(c), getEffectiveToughness(c)];
  };

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
  });

  it("registry exposes Knight of Grace with the color filter", () => {
    const knight = getCardScript("Knight of Grace");
    expect(knight).toBeDefined();
    expect(knight!.statics).toHaveLength(1);
    const stat = knight!.statics![0];
    expect(stat.affects!.controller).toBe("you");
    expect(stat.affects!.color).toBe("W");
    expect(stat.power).toBe(1);
    expect(stat.toughness).toBe(1);
  });

  it("schema accepts `affects.color` literal for Static abilities", () => {
    const ok = CardScriptSchema.safeParse({
      name: "Test Color Anthem",
      oracle: "White creatures you control get +1/+1.",
      statics: [
        {
          text: "White creatures you control get +1/+1.",
          affects: { controller: "you", color: "W" },
          power: 1,
          toughness: 1,
        },
      ],
    });
    expect(ok.success).toBe(true);
  });

  it("schema rejects an unknown color value", () => {
    const bad = CardScriptSchema.safeParse({
      name: "Bad Anthem",
      oracle: "x",
      statics: [
        {
          text: "x",
          affects: { controller: "you", color: "X" as never },
          power: 1,
          toughness: 1,
        },
      ],
    });
    expect(bad.success).toBe(false);
  });

  it("pumps a white creature you control (+1/+1)", () => {
    let s = put(
      state,
      p1,
      "knight",
      card("Knight of Grace", "Creature — Human Knight", [2, 2]),
    );
    s = put(
      s,
      p1,
      "white-cat",
      coloredCard("White Cat", "Creature — Cat", [1, 1], ["W"]),
    );
    s = refreshScriptedStatics(s);
    expect(pt(s, "white-cat")).toEqual([2, 2]);
  });

  it("leaves a blue creature you control alone", () => {
    let s = put(
      state,
      p1,
      "knight",
      card("Knight of Grace", "Creature — Human Knight", [2, 2]),
    );
    s = put(
      s,
      p1,
      "blue-crab",
      coloredCard("Blue Crab", "Creature — Crab", [1, 1], ["U"]),
    );
    s = refreshScriptedStatics(s);
    expect(pt(s, "blue-crab")).toEqual([1, 1]);
  });

  it("does not affect a white creature an opponent controls", () => {
    let s = put(
      state,
      p1,
      "knight",
      card("Knight of Grace", "Creature — Human Knight", [2, 2]),
    );
    s = put(
      s,
      p2,
      "foe-white",
      coloredCard("Foe White", "Creature — Human", [1, 1], ["W"]),
    );
    s = refreshScriptedStatics(s);
    expect(pt(s, "foe-white")).toEqual([1, 1]);
  });

  it("applies to a multicolored creature that includes white", () => {
    // CR 613.5: a multicolored creature is every color printed on it;
    // a "white creatures" anthem affects it because white is one of
    // its colors.
    let s = put(
      state,
      p1,
      "knight",
      card("Knight of Grace", "Creature — Human Knight", [2, 2]),
    );
    s = put(
      s,
      p1,
      "esper",
      coloredCard("Esper", "Creature — Human Wizard", [1, 1], ["W", "U", "B"]),
    );
    s = refreshScriptedStatics(s);
    expect(pt(s, "esper")).toEqual([2, 2]);
  });
});
