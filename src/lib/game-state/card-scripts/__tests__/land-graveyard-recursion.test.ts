/**
 * Card scripts — land graveyard recursion.
 *
 * Split out of the 9.8k-line card-scripts.test.ts (#2642). Suites:
 *   - Icetill Explorer: extra land, lands from graveyard, landfall mill (#2614)
 *   - Keen-Eyed Curator: exile from a graveyard, grow with card types (#2614)
 */
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

describe("Icetill Explorer: extra land, lands from graveyard, landfall mill (#2614)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;
  const main = (s: GameState): GameState => ({
    ...s,
    turn: {
      ...s.turn,
      currentPhase: Phase.PRECOMBAT_MAIN,
      activePlayerId: p1,
    },
    priorityPlayerId: p1,
    stack: [],
  });

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
    state = main(state);
  });

  it("adds a land play only while you control it", () => {
    expect(extraLandPlays(state, p1)).toBe(0);
    const s = put(
      state,
      p1,
      "explorer",
      card("Icetill Explorer", "Creature — Insect Scout", [2, 4]),
    );
    expect(extraLandPlays(s, p1)).toBe(1);
    expect(extraLandPlays(s, p2)).toBe(0);
  });

  it("lets you play a second land in a turn", () => {
    let s = put(
      state,
      p1,
      "explorer",
      card("Icetill Explorer", "Creature — Insect Scout", [2, 4]),
    );
    s = put(s, p1, "h1", card("Forest", "Basic Land — Forest", [0, 0]), "hand");
    s = put(s, p1, "h2", card("Forest", "Basic Land — Forest", [0, 0]), "hand");
    s = put(s, p1, "h3", card("Forest", "Basic Land — Forest", [0, 0]), "hand");
    const one = playLand(s, p1, id("h1"));
    expect(one.success).toBe(true);
    const two = playLand(main(one.state), p1, id("h2"));
    expect(two.success).toBe(true);
    const three = playLand(main(two.state), p1, id("h3"));
    expect(three.success).toBe(false);
  });

  it("plays a land from the graveyard only with the Explorer out", () => {
    const s = put(
      state,
      p1,
      "g1",
      card("Forest", "Basic Land — Forest", [0, 0]),
      "graveyard",
    );
    expect(playLand(s, p1, id("g1")).success).toBe(false);
    const withExplorer = put(
      s,
      p1,
      "explorer",
      card("Icetill Explorer", "Creature — Insect Scout", [2, 4]),
    );
    expect(
      listPriorityChoices(withExplorer, p1).some(
        (c) => c.kind === "play_land" && c.cardId === id("g1"),
      ),
    ).toBe(true);
    const r = playLand(withExplorer, p1, id("g1"));
    expect(r.success).toBe(true);
    expect(r.state.zones.get(`${p1}-battlefield`)!.cardIds).toContain(id("g1"));
    expect(r.state.zones.get(`${p1}-graveyard`)!.cardIds).not.toContain(
      id("g1"),
    );
  });

  it("landfall mills a card", () => {
    let s = put(
      state,
      p1,
      "lib1",
      card("Grizzly Bears", "Creature — Bear", [2, 2]),
      "library",
    );
    s = resolveScriptedEffects(
      s,
      getCardScript("Icetill Explorer")!.triggers![0].effects!,
      {
        controllerId: p1,
        sourceCardId: null as never,
        targets: [],
      } as unknown as StackObject,
    );
    expect(s.zones.get(`${p1}-graveyard`)!.cardIds).toContain(id("lib1"));
  });

  it("schema needs a land rule", () => {
    expect(
      CardScriptSchema.safeParse({
        name: "X",
        oracle: "x",
        land_rules: {},
        spell: [{ op: "GainLife", amount: 1, who: "you" }],
      }).success,
    ).toBe(false);
  });
});

describe("Keen-Eyed Curator: exile from a graveyard, grow with card types (#2614)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;
  const exileEffects = () =>
    getCardScript("Keen-Eyed Curator")!.activated![0].effects!;
  const exileWithCurator = (s: GameState, cardId: string) =>
    resolveScriptedEffects(s, exileEffects(), {
      controllerId: p1,
      sourceCardId: id("curator"),
      targets: [{ type: "card", targetId: id(cardId), isValid: true }],
    } as unknown as StackObject);

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
    state = put(
      state,
      p1,
      "curator",
      card("Keen-Eyed Curator", "Creature — Raccoon Scout", [3, 3]),
    );
    const gy: [string, PlayerId, string][] = [
      ["g-creature", p2, "Creature — Bear"],
      ["g-instant", p2, "Instant"],
      ["g-sorcery", p1, "Sorcery"],
      ["g-land", p2, "Land"],
      ["g-artcreature", p2, "Artifact Creature — Golem"],
    ];
    for (const [cid, owner, type] of gy) {
      state = put(state, owner, cid, card(cid, type), "graveyard");
    }
  });

  it("exiles a card from any graveyard and links it to the Curator", () => {
    const s = exileWithCurator(state, "g-creature");
    expect(s.zones.get(`${p2}-exile`)!.cardIds).toContain(id("g-creature"));
    expect(s.cards.get(id("g-creature"))!.exiledWith?.sourceId).toBe(
      id("curator"),
    );
    const own = exileWithCurator(s, "g-sorcery");
    expect(own.zones.get(`${p1}-exile`)!.cardIds).toContain(id("g-sorcery"));
  });

  it("gets +4/+4 and trample at four card types, not three", () => {
    let s = state;
    for (const c of ["g-creature", "g-instant", "g-sorcery"]) {
      s = exileWithCurator(s, c);
    }
    s = refreshScriptedStatics(s);
    expect(s.cards.get(id("curator"))!.scriptStaticPT).toBeUndefined();
    expect(hasKeyword(s.cards.get(id("curator"))!, "trample")).toBe(false);
    s = refreshScriptedStatics(exileWithCurator(s, "g-land"));
    const curator = s.cards.get(id("curator"))!;
    expect(curator.scriptStaticPT).toEqual({ power: 4, toughness: 4 });
    expect(getEffectivePower(curator)).toBe(7);
    expect(hasKeyword(curator, "trample")).toBe(true);
  });

  it("counts each card type once, including both types of an artifact creature", () => {
    let s = state;
    for (const c of ["g-creature", "g-artcreature", "g-land"]) {
      s = exileWithCurator(s, c);
    }
    // creature, artifact, land = three types; the second creature adds none.
    s = refreshScriptedStatics(s);
    expect(s.cards.get(id("curator"))!.scriptStaticPT).toBeUndefined();
  });

  it("a new Curator object doesn't count cards the old one exiled (CR 400.7)", () => {
    let s = state;
    for (const c of ["g-creature", "g-instant", "g-sorcery", "g-land"]) {
      s = exileWithCurator(s, c);
    }
    const cards = new Map(s.cards);
    const old = cards.get(id("curator"))!;
    cards.set(id("curator"), {
      ...old,
      enteredBattlefieldTimestamp: old.enteredBattlefieldTimestamp + 1,
    });
    s = refreshScriptedStatics({ ...s, cards });
    expect(s.cards.get(id("curator"))!.scriptStaticPT).toBeUndefined();
  });

  it("a card re-exiled by another source loses its old link (CR 400.7)", () => {
    let s = exileWithCurator(state, "g-creature");
    const zones = new Map(s.zones);
    const exile = zones.get(`${p2}-exile`)!;
    zones.set(`${p2}-exile`, {
      ...exile,
      cardIds: exile.cardIds.filter((c) => c !== id("g-creature")),
    });
    const gy = zones.get(`${p2}-graveyard`)!;
    zones.set(`${p2}-graveyard`, {
      ...gy,
      cardIds: [...gy.cardIds, id("g-creature")],
    });
    const cards = new Map(s.cards);
    cards.set(id("g-creature"), {
      ...cards.get(id("g-creature"))!,
      currentZoneKey: `${p2}-graveyard`,
    });
    s = resolveScriptedEffects({ ...s, zones, cards }, exileEffects(), {
      controllerId: p1,
      sourceCardId: null,
      targets: [{ type: "card", targetId: id("g-creature"), isValid: true }],
    } as unknown as StackObject);
    expect(s.zones.get(`${p2}-exile`)!.cardIds).toContain(id("g-creature"));
    expect(s.cards.get(id("g-creature"))!.exiledWith).toBeUndefined();
  });

  it("an exile by a card without the bonus leaves no link", () => {
    const s = resolveScriptedEffects(state, exileEffects(), {
      controllerId: p1,
      sourceCardId: null,
      targets: [{ type: "card", targetId: id("g-creature"), isValid: true }],
    } as unknown as StackObject);
    expect(s.cards.get(id("g-creature"))!.exiledWith).toBeUndefined();
  });
});
