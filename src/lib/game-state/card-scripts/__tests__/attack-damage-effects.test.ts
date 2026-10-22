/**
 * Card scripts — attack damage effects.
 *
 * Split out of the 9.8k-line card-scripts.test.ts (#2642). Suites:
 *   - Hired Claw: Lizard attack ping and conditional counter (#2614)
 *   - Generous Plunderer: Treasures and attack damage (#2614)
 *   - Smaug the Magnificent: Treasure-scaled attack damage (#2614)
 *   - Magmatic Hellkite: land destruction and stun counters (#2614)
 *   - Surrak, Elusive Hunter: draw when an opponent targets your creatures (#2614)
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

describe("Hired Claw: Lizard attack ping and conditional counter (#2614)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;
  const ORACLE =
    "Whenever you attack with one or more Lizards, this creature deals 1 damage to target opponent.\n{1}{R}: Put a +1/+1 counter on this creature. Activate only if an opponent lost life this turn and only once each turn.";
  const claw = () =>
    ({
      ...card("Hired Claw", "Creature — Lizard Mercenary", [1, 2]),
      oracle_text: ORACLE,
      mana_cost: "{R}",
      cmc: 1,
      colors: ["R"],
    }) as ScryfallCard;
  const sources = (s: GameState) => s.stack.map((o) => o.sourceCardId);
  const bothPass = (s: GameState) => passPriority(passPriority(s, p1), p2);
  const ready = (s: GameState, cardId: string): GameState => {
    const cards = new Map(s.cards);
    cards.set(id(cardId), {
      ...cards.get(id(cardId))!,
      hasSummoningSickness: false,
    });
    return { ...s, cards };
  };
  const at = (s: GameState, phase: Phase): GameState => ({
    ...s,
    stack: [],
    priorityPlayerId: p1,
    turn: { ...s.turn, activePlayerId: p1, currentPhase: phase },
  });
  const fund = (s: GameState): GameState => {
    const players = new Map(s.players);
    const p = players.get(p1)!;
    players.set(p1, {
      ...p,
      manaPool: { ...p.manaPool, generic: 1, red: 1 },
    });
    return { ...s, players };
  };
  const lostLife = (s: GameState, who: PlayerId, n: number): GameState => {
    const players = new Map(s.players);
    players.set(who, { ...players.get(who)!, lastTurnLifeLost: n });
    return { ...s, players };
  };
  const counters = (s: GameState) =>
    s.cards
      .get(id("claw"))!
      .counters.filter((c) => c.type === "+1/+1")
      .reduce((n, c) => n + c.count, 0);

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
    state = put(state, p1, "claw", claw());
  });

  it("parses into a once-per-combat Lizard attack trigger", () => {
    const [ability] = getTriggeredAbilities(claw());
    expect(ability.trigger).toMatchObject({
      event: "attacked",
      subject: "any",
      enteringFilter: {
        types: ["creature"],
        controller: "you",
        subtype: "Lizard",
      },
      attackFilter: { once: true },
    });
  });

  it("triggers once when Lizards attack and pings the opponent", () => {
    state = put(
      state,
      p1,
      "lizard",
      card("Lizard", "Creature — Lizard", [2, 2]),
    );
    state = at(ready(ready(state, "claw"), "lizard"), Phase.DECLARE_ATTACKERS);
    const attacked = autoChooseTriggerTargets(
      declareAttackers(state, [
        { cardId: id("claw"), defenderId: p2 },
        { cardId: id("lizard"), defenderId: p2 },
      ]).state,
      p1,
    );
    expect(sources(attacked)).toEqual([id("claw")]);
    expect(attacked.stack[0].targets).toEqual([
      expect.objectContaining({ type: "player", targetId: p2 }),
    ]);
    expect(bothPass(attacked).players.get(p2)!.life).toBe(19);
  });

  it("doesn't trigger when only non-Lizards attack", () => {
    state = put(state, p1, "bear", card("Bear", "Creature — Bear", [2, 2]));
    state = at(ready(state, "bear"), Phase.DECLARE_ATTACKERS);
    const attacked = declareAttackers(state, [
      { cardId: id("bear"), defenderId: p2 },
    ]).state;
    expect(sources(attacked)).toEqual([]);
  });

  it("can't put a counter on until an opponent lost life this turn", () => {
    const s = fund(at(state, Phase.PRECOMBAT_MAIN));
    expect(activateAbility(s, p1, id("claw"), 0).success).toBe(false);
    expect(activateAbility(lostLife(s, p1, 3), p1, id("claw"), 0).success).toBe(
      false,
    );
    const r = activateAbility(lostLife(s, p2, 1), p1, id("claw"), 0);
    expect(r.success).toBe(true);
    const resolved = resolveScriptedAbility(
      r.state,
      r.state.stack[r.state.stack.length - 1],
    )!;
    expect(counters(resolved)).toBe(1);
  });

  it("activates only once each turn", () => {
    const s = fund(lostLife(at(state, Phase.PRECOMBAT_MAIN), p2, 2));
    const first = activateAbility(s, p1, id("claw"), 0);
    expect(first.success).toBe(true);
    expect(activateAbility(fund(first.state), p1, id("claw"), 0).success).toBe(
      false,
    );
  });

  it("rejects a subtype on a self trigger", () => {
    const ok = (extra: object) =>
      CardScriptSchema.safeParse({
        name: "X",
        oracle: "X",
        triggers: [
          {
            text: "X",
            event: "attacks",
            effects: [{ op: "Draw", amount: 1 }],
            ...extra,
          },
        ],
      }).success;
    expect(ok({ subject: "any", subtype: "Lizard" })).toBe(true);
    expect(ok({ subject: "self", subtype: "Lizard" })).toBe(false);
  });
});

describe("Generous Plunderer: Treasures and attack damage (#2614)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;
  const plunderer = () =>
    card("Generous Plunderer", "Creature — Human Rogue", [2, 2]);
  const life = (s: GameState, who: PlayerId) => s.players.get(who)!.life;
  const treasures = (s: GameState, who: PlayerId) =>
    [...s.cards.values()].filter(
      (c) => c.cardData.name === "Treasure" && c.controllerId === who,
    );
  const run = (s: GameState, index: number) =>
    resolveScriptedEffects(
      s,
      getCardScript("Generous Plunderer")!.triggers![index].effects!,
      {
        controllerId: p1,
        sourceCardId: id("plunderer"),
        targets: [],
      } as unknown as StackObject,
    );

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
    state = put(state, p1, "plunderer", plunderer());
  });

  it("upkeep: you get a Treasure and the opponent gets a tapped one", () => {
    const after = run(state, 0);
    const mine = treasures(after, p1);
    const theirs = treasures(after, p2);
    expect(mine).toHaveLength(1);
    expect(mine[0].isTapped).toBe(false);
    expect(theirs).toHaveLength(1);
    expect(theirs[0].isTapped).toBe(true);
  });

  it("attack deals damage equal to the defending player's artifacts", () => {
    state = put(state, p2, "art1", card("Ornithopter", "Artifact Creature"));
    state = put(state, p2, "art2", card("Mind Stone", "Artifact"));
    state = put(state, p1, "myart", card("Sol Ring", "Artifact"));
    state = {
      ...state,
      combat: {
        ...state.combat,
        attackers: [
          {
            cardId: id("plunderer"),
            defenderId: p2,
            isAttackingPlaneswalker: false,
            damageToDeal: 2,
            hasFirstStrike: false,
            hasDoubleStrike: false,
          },
        ],
      },
    };
    const after = run(state, 1);
    expect(life(after, p2)).toBe(18);
    expect(life(after, p1)).toBe(20);
  });

  it("attack deals nothing when the defender has no artifacts", () => {
    expect(life(run(state, 1), p2)).toBe(20);
  });

  it("schema: per artifact needs defending_player", () => {
    const base = { name: "Test", oracle: "x" };
    const spell = (target: string, per: string) =>
      CardScriptSchema.safeParse({
        ...base,
        spell: [{ op: "DealDamage", amount: 1, target, per }],
      }).success;
    expect(spell("each_player", "artifact")).toBe(false);
    expect(spell("defending_player", "nonbasic_land")).toBe(false);
    expect(spell("defending_player", "artifact")).toBe(true);
  });
});

describe("Smaug the Magnificent: Treasure-scaled attack damage (#2614)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;
  const life = (s: GameState, who: PlayerId) => s.players.get(who)!.life;
  const treasures = (s: GameState, who: PlayerId) =>
    [...s.cards.values()].filter(
      (c) => c.cardData.name === "Treasure" && c.controllerId === who,
    );
  const run = (s: GameState, index: number) =>
    resolveScriptedEffects(
      s,
      getCardScript("Smaug the Magnificent")!.triggers![index].effects!,
      {
        controllerId: p1,
        sourceCardId: id("smaug"),
        targets: [{ type: "player", targetId: p2, isValid: true }],
      } as unknown as StackObject,
    );

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
    state = put(
      state,
      p1,
      "smaug",
      card("Smaug the Magnificent", "Legendary Creature — Dragon", [4, 3]),
    );
  });

  it("upkeep creates a Treasure for you", () => {
    expect(treasures(run(state, 1), p1)).toHaveLength(1);
  });

  it("attack deals damage equal to the Treasures you control", () => {
    state = run(run(state, 1), 1);
    state = put(
      state,
      p2,
      "theirs",
      card("Treasure", "Token Artifact — Treasure"),
    );
    expect(life(run(state, 0), p2)).toBe(18);
  });

  it("attack deals nothing with no Treasures", () => {
    expect(life(run(state, 0), p2)).toBe(20);
  });

  it("schema: per treasure needs a targeted damage effect", () => {
    const ok = (target: string) =>
      CardScriptSchema.safeParse({
        name: "Test",
        oracle: "x",
        spell: [{ op: "DealDamage", amount: 1, target, per: "treasure" }],
      }).success;
    expect(ok("any")).toBe(true);
    expect(ok("each_opponent")).toBe(false);
    expect(ok("defending_player")).toBe(false);
  });
});

describe("Magmatic Hellkite: land destruction and stun counters (#2614)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;
  const zoneOf = (s: GameState, cardId: string) =>
    [...s.zones.entries()].find(([, z]) => z.cardIds.includes(id(cardId)))?.[0];
  const stunOf = (s: GameState, cardId: string) =>
    s.cards.get(id(cardId))!.counters.find((c) => c.type === "stun")?.count ??
    0;
  const etb = (targetId: string) =>
    ({
      id: "ab-magmatic",
      type: "ability",
      sourceCardId: id("hellkite"),
      controllerId: p1,
      text: getCardScript("Magmatic Hellkite")!.triggers![0].text,
      targets: [cardTarget(targetId)],
      triggered: true,
      activated: false,
    }) as unknown as StackObject;

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
  });

  it("destroys the land and its controller fetches a stunned basic", () => {
    let s = put(
      state,
      p1,
      "hellkite",
      card("Magmatic Hellkite", "Creature — Dragon", [4, 5]),
    );
    s = put(s, p2, "temple", card("Temple of Mystery", "Land"));
    s = put(
      s,
      p2,
      "their-lib",
      card("Island", "Basic Land — Island"),
      "library",
    );
    const [trigger] = getCardScript("Magmatic Hellkite")!.triggers!;
    const after = resolveScriptedEffects(s, trigger.effects!, etb("temple"));
    expect(zoneOf(after, "temple")).toBe(`${p2}-graveyard`);
    expect(zoneOf(after, "their-lib")).toBe(`${p2}-battlefield`);
    expect(after.cards.get(id("their-lib"))!.isTapped).toBe(true);
    expect(stunOf(after, "their-lib")).toBe(1);
  });

  it("a stun counter is removed instead of untapping", () => {
    let s = put(state, p1, "land", card("Mountain", "Basic Land — Mountain"));
    const cards = new Map(s.cards);
    cards.set(id("land"), {
      ...cards.get(id("land"))!,
      isTapped: true,
      counters: [{ type: "stun", count: 1 }],
    });
    s = { ...s, cards };
    const first = processUntapStep(s).state;
    expect(first.cards.get(id("land"))!.isTapped).toBe(true);
    expect(stunOf(first, "land")).toBe(0);
    const second = processUntapStep(first).state;
    expect(second.cards.get(id("land"))!.isTapped).toBe(false);
  });

  it("schema: stun is a positive count on SearchLibrary", () => {
    const ok = (stun: number) =>
      CardScriptSchema.safeParse({
        name: "X",
        oracle: "x",
        spell: [
          {
            op: "SearchLibrary",
            filter: { basic_land: true },
            destination: "battlefield",
            tapped: true,
            stun,
          },
        ],
      }).success;
    expect(ok(1)).toBe(true);
    expect(ok(0)).toBe(false);
  });
});

describe("Surrak, Elusive Hunter: draw when an opponent targets your creatures (#2614)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;
  const targeting = (controllerId: PlayerId, targetId: string) => ({
    controllerId,
    targets: [{ type: "card" as const, targetId, isValid: true }],
  });
  const surrakTriggers = (s: GameState) =>
    s.stack.filter((o) => o.sourceCardId === id("surrak"));

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
    state = put(
      state,
      p1,
      "surrak",
      card(
        "Surrak, Elusive Hunter",
        "Legendary Creature — Human Warrior",
        [4, 3],
      ),
    );
    state = put(
      state,
      p1,
      "bear",
      card("Grizzly Bears", "Creature — Bear", [2, 2]),
    );
    state = put(
      state,
      p2,
      "theirs",
      card("Grizzly Bears", "Creature — Bear", [2, 2]),
    );
  });

  it("triggers when an opponent targets a creature you control", () => {
    const s = fireTargetedTriggers(state, targeting(p2, "bear"));
    expect(surrakTriggers(s)).toHaveLength(1);
    expect(surrakTriggers(s)[0].controllerId).toBe(p1);
  });

  it("ignores your own targeting and the opponent's own creatures", () => {
    expect(
      surrakTriggers(fireTargetedTriggers(state, targeting(p1, "bear"))),
    ).toHaveLength(0);
    expect(
      surrakTriggers(fireTargetedTriggers(state, targeting(p2, "theirs"))),
    ).toHaveLength(0);
  });

  it("triggers once per targeted creature", () => {
    const s = fireTargetedTriggers(state, {
      controllerId: p2,
      targets: [
        { type: "card", targetId: "bear", isValid: true },
        { type: "card", targetId: "surrak", isValid: true },
        { type: "card", targetId: "bear", isValid: true },
      ],
    } as never);
    expect(surrakTriggers(s)).toHaveLength(2);
  });

  it("the trigger draws a card, and the spell can't be countered", () => {
    expect(getCardScript("Surrak, Elusive Hunter")!.cantBeCountered).toBe(true);
    const before = state.zones.get(`${p1}-hand`)!.cardIds.length;
    const s = resolveScriptedEffects(
      state,
      getCardScript("Surrak, Elusive Hunter")!.triggers![0].effects!,
      {
        controllerId: p1,
        sourceCardId: id("surrak"),
        targets: [],
      } as unknown as StackObject,
    );
    expect(s.zones.get(`${p1}-hand`)!.cardIds.length).toBe(before + 1);
  });
});
