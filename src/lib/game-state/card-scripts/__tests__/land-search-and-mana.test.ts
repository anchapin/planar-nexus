/**
 * Card scripts — land search and mana.
 *
 * Split out of the 9.8k-line card-scripts.test.ts (#2642). Suites:
 *   - Fabled Passage: untap the found land with four or more lands (#2614)
 *   - Escape Tunnel: can
 *   - Demolition Field: destroy a nonbasic land, both players search (#2614)
 *   - Mightform Harmonizer: landfall doubles a creature
 *   - Meltstrider
 *   - Lumbering Worldwagon: lands-count power, land search on enter or attack (#2614)
 *   - Icetill Explorer: extra land, lands from graveyard, landfall mill (#2614)
 *   - Keen-Eyed Curator: exile from a graveyard, grow with card types (#2614)
 *   - Ba Sing Se: earthbend 2 and enters tapped unless basic (#2614)
 *   - Earthbender Ascension: earthbend, land search, quest counters (#2614)
 */
/**
 * Card scripts — land untap and search.
 *
 * Split out of the 9.8k-line card-scripts.test.ts (#2642). Suites:
 *   - Fabled Passage: untap the found land with four or more lands (#2614)
 *   - Escape Tunnel: can
 *   - Demolition Field: destroy a nonbasic land, both players search (#2614)
 *   - Mightform Harmonizer: landfall doubles a creature
 *   - Meltstrider
 *   - Sapling Nursery: affinity for Forests, Treefolk tokens, indestructible (#2614)
 *   - Lumbering Worldwagon: lands-count power, land search on enter or attack (#2614)
 *   - Icetill Explorer: extra land, lands from graveyard, landfall mill (#2614)
 *   - Keen-Eyed Curator: exile from a graveyard, grow with card types (#2614)
 *   - Soulstone Sanctuary: a land that becomes a 3/3 creature (#2614)
 *   - Ba Sing Se: earthbend 2 and enters tapped unless basic (#2614)
 *   - Earthbender Ascension: earthbend, land search, quest counters (#2614)
 */
import {
  CARDS_DIR,
  id,
  card,
  put,
  spell,
  cardTarget,
  battlefield,
} from "./helpers";
import {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
  StackObject,
  Target,
} from "../../types";
import { CardScript } from "../schema";
import {
  CardScriptSchema,
  getCardScript,
  resolveScriptedSpell,
  resolveScriptedAbility,
} from "../index";
import { Phase } from "../../types";
import { activateAbility } from "../../abilities/activated";
import { affinityReduction, hasSubtype } from "../../spell-casting/affinity";
import { attachAura } from "../../keyword-actions/enchant";
import { canBlock } from "../../combat/queries";
import { checkStateBasedActions } from "../../state-based-actions";
import { clearUntilEndOfTurnPT } from "../../pt-until-end-of-turn";
import { createInitialGameState, startGame } from "../../game-state";
import { declareAttackers, declareBlockers } from "../../combat/declaration";
import { destroyCard } from "../../keyword-actions/removal";
import { extraLandPlays } from "../../mana/land-rules";
import {
  getEffectivePower,
  getEffectiveToughness,
} from "../../evergreen-keywords";
import { hasKeyword } from "../../evergreen-keywords";
import { isCreature as isCreatureCard } from "../../card-instance";
import { join } from "node:path";
import { listPriorityChoices } from "../../legal-choices";
import { matchesRemovalFilter } from "../target-filters";
import { parseManaAbility } from "../../mana";
import { playLand } from "../../mana/lands";
import { readFileSync } from "node:fs";
import { refreshAuraBonuses } from "../../keyword-actions/aura-bonus";
import { refreshDomainPower } from "../../keyword-actions/domain";
import { refreshScriptedStatics } from "../../keyword-actions/scripted-statics";
import { resolveScriptedEffects } from "../interpret";

describe("Fabled Passage: untap the found land with four or more lands (#2614)", () => {
  let state: GameState;
  let p1: PlayerId;

  const PASSAGE =
    "Search your library for a basic land card, put it onto the battlefield tapped, then shuffle. Then if you control four or more lands, untap that land.";

  const passageAbility = (sourceCardId: string) =>
    ({
      id: "ab-passage",
      type: "ability",
      sourceCardId: id(sourceCardId),
      controllerId: p1,
      text: PASSAGE,
      targets: [],
      triggered: false,
      activated: true,
    }) as unknown as StackObject;

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1] = Array.from(state.players.keys());
  });

  const withLands = (s: GameState, n: number) => {
    let out = s;
    for (let i = 0; i < n; i++) {
      out = put(out, p1, `bf-land-${i}`, card("Forest", "Basic Land — Forest"));
    }
    return out;
  };

  it("validates SearchLibrary's untap_if_lands", () => {
    const ok = (extra: object) =>
      CardScriptSchema.safeParse({
        name: "X",
        oracle: "x",
        spell: [
          {
            op: "SearchLibrary",
            filter: { basic_land: true },
            destination: "battlefield",
            tapped: true,
            ...extra,
          },
        ],
      }).success;
    expect(ok({ untap_if_lands: 4 })).toBe(true);
    expect(ok({ untap_if_lands: 0 })).toBe(false);
    expect(ok({ untap_if_lands: "four" })).toBe(false);
  });

  it("untaps the found land when you then control four or more lands", () => {
    // Three lands already out (the sacrificed Passage is gone): the found
    // land makes four.
    let s = withLands(state, 3);
    s = put(s, p1, "passage", card("Fabled Passage", "Land"), "graveyard");
    s = put(
      s,
      p1,
      "lib-forest",
      card("Forest", "Basic Land — Forest"),
      "library",
    );
    const out = resolveScriptedAbility(s, passageAbility("passage"))!;
    expect(battlefield(out, p1)).toContain(id("lib-forest"));
    expect(out.cards.get(id("lib-forest"))!.isTapped).toBe(false);
  });

  it("leaves the found land tapped with fewer than four lands", () => {
    // One land out plus the found land is two: it stays tapped.
    let s = withLands(state, 1);
    s = put(s, p1, "passage", card("Fabled Passage", "Land"), "graveyard");
    s = put(
      s,
      p1,
      "lib-forest",
      card("Forest", "Basic Land — Forest"),
      "library",
    );
    const out = resolveScriptedAbility(s, passageAbility("passage"))!;
    expect(out).toBeDefined();
    expect(battlefield(out, p1)).toContain(id("lib-forest"));
    expect(out.cards.get(id("lib-forest"))!.isTapped).toBe(true);
  });

  it("does not count the sacrificed Passage (two lands plus the found land)", () => {
    // Two lands out plus the found land is three. The Passage itself is in
    // the graveyard (sacrificed as a cost), so it does not make a fourth.
    let s = withLands(state, 2);
    s = put(s, p1, "passage", card("Fabled Passage", "Land"), "graveyard");
    s = put(
      s,
      p1,
      "lib-forest",
      card("Forest", "Basic Land — Forest"),
      "library",
    );
    const out = resolveScriptedAbility(s, passageAbility("passage"))!;
    expect(out.cards.get(id("lib-forest"))!.isTapped).toBe(true);
  });

  it("Fabled Passage's script matches Scryfall's oracle", () => {
    const passage = JSON.parse(
      readFileSync(join(CARDS_DIR, "fabled_passage.json"), "utf8"),
    ) as { oracle: string; activated: { text: string }[] };
    expect(passage.oracle).toBe(`{T}, Sacrifice this land: ${PASSAGE}`);
    expect(passage.activated.map((a) => a.text)).toEqual([PASSAGE]);
  });
});

describe("Escape Tunnel: can't be blocked this turn (#2614)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  const SEARCH =
    "Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.";
  const EVADE =
    "Target creature with power 2 or less can't be blocked this turn.";

  const evadeAbility = (sourceCardId: string, targetId: string) =>
    ({
      id: "ab-tunnel",
      type: "ability",
      sourceCardId: id(sourceCardId),
      controllerId: p1,
      text: EVADE,
      targets: [cardTarget(targetId)],
      triggered: false,
      activated: true,
    }) as unknown as StackObject;

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
  });

  const setup = (power: number) => {
    let s = put(
      state,
      p1,
      "tunnel",
      card("Escape Tunnel", "Land"),
      "graveyard",
    );
    s = put(s, p1, "attacker", card("Runner", "Creature — Elf", [power, 2]));
    s = put(s, p2, "blocker", card("Wall", "Creature — Wall", [0, 4]));
    return s;
  };

  it("validates CantBeBlocked", () => {
    const ok = (effect: object) =>
      CardScriptSchema.safeParse({
        name: "X",
        oracle: "x",
        spell: [{ op: "CantBeBlocked", until: "end_of_turn", ...effect }],
      }).success;
    expect(ok({ target: "creature", max_power: 2 })).toBe(true);
    expect(ok({ target: "self" })).toBe(true);
    expect(ok({ target: "self", controller: "you" })).toBe(false);
    expect(ok({ target: "player" })).toBe(false);
    expect(ok({ target: "creature", until: "next_turn" })).toBe(false);
  });

  it("makes a creature with power 2 or less unblockable this turn", () => {
    const s = setup(2);
    expect(canBlock(s, id("blocker"), id("attacker")).canBlock).toBe(true);
    const out = resolveScriptedAbility(s, evadeAbility("tunnel", "attacker"))!;
    expect(canBlock(out, id("blocker"), id("attacker")).canBlock).toBe(false);
  });

  it("does nothing if the target's power is above 2 on resolution", () => {
    const s = setup(3);
    const out = resolveScriptedAbility(s, evadeAbility("tunnel", "attacker"));
    const after = out ?? s;
    expect(canBlock(after, id("blocker"), id("attacker")).canBlock).toBe(true);
  });

  it("wears off in the cleanup step", () => {
    const out = resolveScriptedAbility(
      setup(1),
      evadeAbility("tunnel", "attacker"),
    )!;
    const cleaned = clearUntilEndOfTurnPT(out);
    expect(canBlock(cleaned, id("blocker"), id("attacker")).canBlock).toBe(
      true,
    );
  });

  it("Escape Tunnel's script matches Scryfall's oracle", () => {
    const tunnel = JSON.parse(
      readFileSync(join(CARDS_DIR, "escape_tunnel.json"), "utf8"),
    ) as { oracle: string; activated: { text: string }[] };
    expect(tunnel.oracle).toBe(
      `{T}, Sacrifice this land: ${SEARCH}\n{T}, Sacrifice this land: ${EVADE}`,
    );
    expect(tunnel.activated.map((a) => a.text)).toEqual([SEARCH, EVADE]);
  });
});

describe("Demolition Field: destroy a nonbasic land, both players search (#2614)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  const DEMOLISH =
    "Destroy target nonbasic land an opponent controls. That land's controller may search their library for a basic land card, put it onto the battlefield, then shuffle. You may search your library for a basic land card, put it onto the battlefield, then shuffle.";

  const demolishAbility = (targetId: string) =>
    ({
      id: "ab-demolish",
      type: "ability",
      sourceCardId: id("field"),
      controllerId: p1,
      text: DEMOLISH,
      targets: [cardTarget(targetId)],
      triggered: false,
      activated: true,
    }) as unknown as StackObject;

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
  });

  const setup = () => {
    let s = put(
      state,
      p1,
      "field",
      card("Demolition Field", "Land"),
      "graveyard",
    );
    s = put(s, p2, "temple", card("Temple of Mystery", "Land"));
    s = put(s, p2, "their-forest", card("Forest", "Basic Land — Forest"));
    s = put(s, p1, "my-lib", card("Forest", "Basic Land — Forest"), "library");
    s = put(
      s,
      p2,
      "their-lib",
      card("Island", "Basic Land — Island"),
      "library",
    );
    return s;
  };

  const zoneOf = (s: GameState, cardId: string) =>
    [...s.zones.entries()].find(([, z]) => z.cardIds.includes(id(cardId)))?.[0];

  it("validates nonbasic_land and SearchLibrary's target_controller", () => {
    const ok = (effects: object[]) =>
      CardScriptSchema.safeParse({ name: "X", oracle: "x", spell: effects })
        .success;
    expect(ok([{ op: "Destroy", target: "nonbasic_land" }])).toBe(true);
    expect(
      ok([
        {
          op: "SearchLibrary",
          who: "target_controller",
          filter: { basic_land: true },
        },
      ]),
    ).toBe(true);
    expect(
      ok([
        {
          op: "SearchLibrary",
          who: "land_owner",
          filter: { basic_land: true },
        },
      ]),
    ).toBe(false);
  });

  it("matches only nonbasic lands", () => {
    const s = setup();
    const filter = { target: "nonbasic_land" as const };
    expect(matchesRemovalFilter(s.cards.get(id("temple"))!, filter)).toBe(true);
    expect(matchesRemovalFilter(s.cards.get(id("their-forest"))!, filter)).toBe(
      false,
    );
  });

  it("destroys the land and puts a basic land onto the battlefield for each player", () => {
    const out = resolveScriptedAbility(setup(), demolishAbility("temple"))!;
    expect(zoneOf(out, "temple")).toBe(`${p2}-graveyard`);
    expect(zoneOf(out, "their-lib")).toBe(`${p2}-battlefield`);
    expect(zoneOf(out, "my-lib")).toBe(`${p1}-battlefield`);
    expect(out.cards.get(id("their-lib"))!.isTapped).toBe(false);
    expect(out.cards.get(id("my-lib"))!.isTapped).toBe(false);
  });

  it("lets nobody search the target's library when the land already left", () => {
    // The land left before resolution: its controller gets no search
    // (CR 608.2b). The whole-ability fizzle when every target is illegal
    // happens on the stack, before the script runs.
    let s = setup();
    s = destroyCard(s, id("temple")).state ?? s;
    const out = resolveScriptedAbility(s, demolishAbility("temple")) ?? s;
    expect(zoneOf(out, "their-lib")).toBe(`${p2}-library`);
  });

  it("taps for exactly {C}, not the {2} from the next ability", () => {
    const field = JSON.parse(
      readFileSync(join(CARDS_DIR, "demolition_field.json"), "utf8"),
    ) as { oracle: string; activated: { text: string }[] };
    expect(parseManaAbility(field.oracle)).toEqual([
      { description: expect.any(String), mana: { colorless: 1 } },
    ]);
  });

  it("Demolition Field's script matches Scryfall's oracle", () => {
    const field = JSON.parse(
      readFileSync(join(CARDS_DIR, "demolition_field.json"), "utf8"),
    ) as { oracle: string; activated: { text: string }[] };
    expect(field.oracle).toBe(
      `{T}: Add {C}.\n{2}, {T}, Sacrifice this land: ${DEMOLISH}`,
    );
    expect(field.activated.map((a) => a.text)).toEqual(["Add {C}.", DEMOLISH]);
  });
});

describe("Mightform Harmonizer: landfall doubles a creature's power (#2614)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;
  const run = (s: GameState, targetId: string) =>
    resolveScriptedEffects(
      s,
      getCardScript("Mightform Harmonizer")!.triggers![0].effects!,
      {
        controllerId: p1,
        sourceCardId: id("harmonizer"),
        targets: [cardTarget(targetId)],
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
      "harmonizer",
      card("Mightform Harmonizer", "Creature — Insect Druid", [4, 4]),
    );
    state = put(
      state,
      p1,
      "bear",
      card("Grizzly Bears", "Creature — Bear", [3, 2]),
    );
  });

  it("doubles the target's power and leaves toughness alone", () => {
    const after = run(state, "bear");
    const bear = after.cards.get(id("bear"))!;
    expect(getEffectivePower(bear)).toBe(6);
    expect(getEffectiveToughness(bear)).toBe(2);
  });

  it("doubles the current power, including earlier pumps", () => {
    const after = run(run(state, "bear"), "bear");
    expect(getEffectivePower(after.cards.get(id("bear"))!)).toBe(12);
  });

  it("does nothing to a creature an opponent controls", () => {
    state = put(state, p2, "foe", card("Foe", "Creature — Ogre", [3, 3]));
    const after = run(state, "foe");
    expect(getEffectivePower(after.cards.get(id("foe"))!)).toBe(3);
  });

  it("schema: double_power needs power and toughness 0", () => {
    const ok = (power: number) =>
      CardScriptSchema.safeParse({
        name: "X",
        oracle: "x",
        spell: [
          {
            op: "Pump",
            power,
            toughness: 0,
            target: "creature",
            double_power: true,
          },
        ],
      }).success;
    expect(ok(0)).toBe(true);
    expect(ok(2)).toBe(false);
  });
});

describe("Meltstrider's Resolve: enchanted creature fights; max one blocker (#2614)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;
  const fightEffects = () =>
    getCardScript("Meltstrider's Resolve")!.triggers![0].effects!;
  const ready = (s: GameState, cardId: string): GameState => {
    const cards = new Map(s.cards);
    cards.set(id(cardId), {
      ...cards.get(id(cardId))!,
      hasSummoningSickness: false,
    });
    return { ...s, cards };
  };

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
    state = put(
      state,
      p1,
      "bear",
      card("Grizzly Bears", "Creature — Bear", [3, 3]),
    );
    state = put(
      state,
      p1,
      "resolve",
      card("Meltstrider's Resolve", "Enchantment — Aura"),
    );
    state = attachAura(state, id("resolve"), id("bear"));
    state = refreshAuraBonuses(state);
  });

  it("gives +0/+2 and a one-blocker limit", () => {
    const host = state.cards.get(id("bear"))!;
    expect(getEffectivePower(host)).toBe(3);
    expect(getEffectiveToughness(host)).toBe(5);
    expect(host.auraMaxBlockers).toBe(1);
  });

  it("the enchanted creature fights the opponent's creature", () => {
    state = put(state, p2, "foe", card("Foe", "Creature — Ogre", [2, 4]));
    const after = resolveScriptedEffects(state, fightEffects(), {
      controllerId: p1,
      sourceCardId: id("resolve"),
      targets: [cardTarget("foe")],
    } as unknown as StackObject);
    expect(after.cards.get(id("foe"))!.damage).toBe(3);
    expect(after.cards.get(id("bear"))!.damage).toBe(2);
  });

  it("does nothing with no target (up to one)", () => {
    const after = resolveScriptedEffects(state, fightEffects(), {
      controllerId: p1,
      sourceCardId: id("resolve"),
      targets: [],
    } as unknown as StackObject);
    expect(after.cards.get(id("bear"))!.damage).toBe(0);
  });

  it("can't be blocked by more than one creature", () => {
    state = ready(state, "bear");
    state = put(
      state,
      p2,
      "b1",
      card("Blocker One", "Creature — Wall", [0, 4]),
    );
    state = put(
      state,
      p2,
      "b2",
      card("Blocker Two", "Creature — Wall", [0, 4]),
    );
    state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
    const attacked = declareAttackers(state, [
      { cardId: id("bear"), defenderId: p2 },
    ]);
    expect(attacked.success).toBe(true);
    attacked.state.turn.currentPhase = Phase.DECLARE_BLOCKERS;
    const two = declareBlockers(
      attacked.state,
      new Map([[id("bear"), [id("b1"), id("b2")]]]),
    );
    expect(two.state.combat.blockers.has(id("bear"))).toBe(false);
    expect(two.errors?.join(" ")).toContain("more than 1 creature");
    const one = declareBlockers(
      attacked.state,
      new Map([[id("bear"), [id("b1")]]]),
    );
    expect(one.state.combat.blockers.get(id("bear"))).toHaveLength(1);
  });

  it("schema: optional fight needs a self or enchanted fighter", () => {
    const parses = (fighter: string) =>
      CardScriptSchema.safeParse({
        name: "X",
        oracle: "x",
        spell: [{ op: "Fight", fighter, target: "creature", optional: true }],
      }).success;
    expect(parses("enchanted")).toBe(true);
    expect(parses("it")).toBe(false);
  });
});

describe("Lumbering Worldwagon: lands-count power, land search on enter or attack (#2614)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;
  const wagon = () => getCardScript("Lumbering Worldwagon")!;

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
    state = put(
      state,
      p1,
      "wagon",
      card("Lumbering Worldwagon", "Artifact — Vehicle"),
    );
    const c = state.cards.get(id("wagon"))!;
    const cards = new Map(state.cards);
    cards.set(id("wagon"), {
      ...c,
      cardData: {
        ...c.cardData,
        power: "*",
        toughness: "4",
        oracle_text:
          "This Vehicle's power is equal to the number of lands you control.\nWhenever this Vehicle enters or attacks, you may search your library for a basic land card, put it onto the battlefield tapped, then shuffle.\nCrew 4",
      },
    });
    state = { ...state, cards };
  });

  it("power tracks the number of lands you control, not the opponent's", () => {
    let s = put(state, p1, "f1", card("Forest", "Basic Land — Forest", [0, 0]));
    s = put(s, p1, "f2", card("Forest", "Basic Land — Forest", [0, 0]));
    s = put(s, p1, "dual", card("Dual", "Land — Forest Mountain", [0, 0]));
    s = put(s, p2, "f3", card("Forest", "Basic Land — Forest", [0, 0]));
    expect(refreshDomainPower(s).cards.get(id("wagon"))!.domainPower).toBe(3);
    const more = put(
      s,
      p1,
      "f4",
      card("Forest", "Basic Land — Forest", [0, 0]),
    );
    expect(refreshDomainPower(more).cards.get(id("wagon"))!.domainPower).toBe(
      4,
    );
  });

  it("has an enters trigger and an attacks trigger with the same search", () => {
    const events = wagon().triggers!.map((t) => t.event);
    expect(events).toEqual(["etb", "attacks"]);
    expect(wagon().triggers![0].effects).toEqual(wagon().triggers![1].effects);
  });

  it("the search puts a basic land onto the battlefield tapped", () => {
    let s = put(
      state,
      p1,
      "libforest",
      card("Forest", "Basic Land — Forest", [0, 0]),
      "library",
    );
    s = put(
      s,
      p1,
      "libbear",
      card("Grizzly Bears", "Creature — Bear", [2, 2]),
      "library",
    );
    const after = resolveScriptedEffects(s, wagon().triggers![1].effects!, {
      controllerId: p1,
      sourceCardId: id("wagon"),
      targets: [],
    } as unknown as StackObject);
    const land = after.cards.get(id("libforest"))!;
    expect(land.currentZoneKey).toBe(`${p1}-battlefield`);
    expect(land.isTapped).toBe(true);
    expect(after.cards.get(id("libbear"))!.currentZoneKey).toBe(
      `${p1}-library`,
    );
  });
});

describe("Ba Sing Se: earthbend 2 and enters tapped unless basic (#2614)", () => {
  let state: GameState;
  let p1: PlayerId;
  const earthbend2 = (s: GameState, targetId: string) =>
    resolveScriptedSpell(
      s,
      {
        name: "X",
        oracle: "x",
        spell: [{ op: "Earthbend", target: "land_you_control", amount: 2 }],
      } as CardScript,
      spell(p1, [cardTarget(targetId)]),
    );
  const main = (s: GameState, p: PlayerId): GameState => ({
    ...s,
    turn: { ...s.turn, currentPhase: Phase.PRECOMBAT_MAIN, activePlayerId: p },
    priorityPlayerId: p,
    stack: [],
  });
  const zoneOf = (s: GameState, cid: string) =>
    s.cards.get(cid as CardInstanceId)?.currentZoneKey;

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1] = Array.from(state.players.keys());
    state = put(state, p1, "forest", card("Forest", "Basic Land — Forest"));
  });

  it("validates Earthbend", () => {
    const ok = (effect: object) =>
      CardScriptSchema.safeParse({ name: "X", oracle: "x", spell: [effect] })
        .success;
    expect(ok({ op: "Earthbend", target: "land_you_control", amount: 2 })).toBe(
      true,
    );
    expect(ok({ op: "Earthbend", target: "land_you_control", amount: 0 })).toBe(
      false,
    );
  });

  it("turns the land into a 0/0 haste creature with two +1/+1 counters", () => {
    const s = earthbend2(state, id("forest"));
    const land = s.cards.get(id("forest"))!;
    expect(land.cardData.type_line).toMatch(/Land Creature/);
    expect(isCreatureCard(land)).toBe(true);
    expect(getEffectivePower(land)).toBe(2);
    expect(getEffectiveToughness(land)).toBe(2);
    expect(hasKeyword(land, "haste")).toBe(true);
  });

  it("returns to the battlefield tapped as a plain land when it dies", () => {
    let s = earthbend2(state, id("forest"));
    s = destroyCard(s, id("forest")).state;
    s = checkStateBasedActions(s).state;
    const land = s.cards.get(id("forest"))!;
    expect(s.zones.get(`${p1}-battlefield`)!.cardIds).toContain(id("forest"));
    expect(land.isTapped).toBe(true);
    expect(land.earthbent).toBeUndefined();
    expect(isCreatureCard(land)).toBe(false);
  });

  it("won't earthbend a nonland permanent", () => {
    const s0 = put(
      state,
      p1,
      "bear",
      card("Grizzly Bears", "Creature — Bear", [2, 2]),
    );
    const s = earthbend2(s0, id("bear"));
    expect(s.cards.get(id("bear"))!.earthbent).toBeUndefined();
  });

  it("enters untapped only while you control a basic land", () => {
    const basing = {
      ...card("Ba Sing Se", "Land"),
      oracle_text:
        "This land enters tapped unless you control a basic land.\n{T}: Add {G}.",
    };
    const withBasic = put(main(state, p1), p1, "bss", basing, "hand");
    const a = playLand(withBasic, p1, id("bss"));
    expect(a.success).toBe(true);
    expect(a.state.cards.get(id("bss"))!.isTapped).toBe(false);

    const bare = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const q1 = Array.from(bare.players.keys())[0];
    const noBasic = put(main(bare, q1), q1, "bss", basing, "hand");
    const b = playLand(noBasic, q1, id("bss"));
    expect(b.success).toBe(true);
    expect(b.state.cards.get(id("bss"))!.isTapped).toBe(true);
  });
});

describe("Earthbender Ascension: earthbend, land search, quest counters (#2614)", () => {
  let state: GameState;
  let p1: PlayerId;
  const script = () => getCardScript("Earthbender Ascension")!;
  const resolveTrigger = (s: GameState, index: number, targets: Target[]) =>
    resolveScriptedEffects(s, script().triggers![index].effects!, {
      controllerId: p1,
      sourceCardId: id("asc"),
      targets,
    } as unknown as StackObject);
  const withQuest = (s: GameState, count: number): GameState => {
    const cards = new Map(s.cards);
    const asc = cards.get(id("asc"))!;
    cards.set(id("asc"), { ...asc, counters: [{ type: "quest", count }] });
    return { ...s, cards };
  };
  const counter = (s: GameState, cid: string, type: string) =>
    s.cards.get(id(cid))!.counters.find((c) => c.type === type)?.count ?? 0;

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1] = Array.from(state.players.keys());
    state = put(state, p1, "asc", card("Earthbender Ascension", "Enchantment"));
    state = put(state, p1, "forest", card("Forest", "Basic Land — Forest"));
    state = put(
      state,
      p1,
      "bear",
      card("Grizzly Bears", "Creature — Bear", [2, 2]),
    );
  });

  it("validates quest counters and the optional creature target", () => {
    const ok = (effect: object) =>
      CardScriptSchema.safeParse({ name: "X", oracle: "x", spell: [effect] })
        .success;
    expect(
      ok({ op: "PutCounters", counter: "quest", amount: 1, target: "self" }),
    ).toBe(true);
    expect(
      ok({
        op: "PutCounters",
        counter: "quest",
        amount: 1,
        target: "creature",
      }),
    ).toBe(false);
    expect(
      ok({
        op: "PutCounters",
        counter: "+1/+1",
        amount: 1,
        target: "self",
        optional: true,
      }),
    ).toBe(false);
  });

  it("earthbends 2, then puts a basic land onto the battlefield tapped", () => {
    let s = put(
      state,
      p1,
      "plains",
      card("Plains", "Basic Land — Plains"),
      "library",
    );
    s = resolveTrigger(s, 0, [cardTarget(id("forest"))]);
    const forest = s.cards.get(id("forest"))!;
    expect(isCreatureCard(forest)).toBe(true);
    expect(getEffectivePower(forest)).toBe(2);
    expect(battlefield(s, p1)).toContain(id("plains"));
    expect(s.cards.get(id("plains"))!.isTapped).toBe(true);
  });

  it("adds a quest counter but no bonus below four quest counters", () => {
    let s = withQuest(state, 2);
    s = resolveTrigger(s, 1, [cardTarget(id("bear"))]);
    expect(counter(s, "asc", "quest")).toBe(3);
    expect(counter(s, "bear", "+1/+1")).toBe(0);
    expect(hasKeyword(s.cards.get(id("bear"))!, "trample")).toBe(false);
  });

  it("at four quest counters, gives the target a +1/+1 counter and trample", () => {
    let s = withQuest(state, 3);
    s = resolveTrigger(s, 1, [cardTarget(id("bear"))]);
    expect(counter(s, "asc", "quest")).toBe(4);
    expect(counter(s, "bear", "+1/+1")).toBe(1);
    expect(hasKeyword(s.cards.get(id("bear"))!, "trample")).toBe(true);
  });

  it("still adds the quest counter with no creature chosen", () => {
    let s = withQuest(state, 3);
    s = resolveTrigger(s, 1, []);
    expect(counter(s, "asc", "quest")).toBe(4);
    expect(counter(s, "bear", "+1/+1")).toBe(0);
  });
});
