/**
 * Card scripts — land transform and tokens.
 *
 * Split out of the 9.8k-line card-scripts.test.ts (#2642). Suites:
 *   - Sapling Nursery: affinity for Forests, Treefolk tokens, indestructible (#2614)
 *   - Soulstone Sanctuary: a land that becomes a 3/3 creature (#2614)
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

describe("Sapling Nursery: affinity for Forests, Treefolk tokens, indestructible (#2614)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;
  const nursery = () => getCardScript("Sapling Nursery")!;

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
  });

  it("costs {1} less for each Forest you control, not an opponent's", () => {
    let s = put(state, p1, "f1", card("Forest", "Basic Land — Forest", [0, 0]));
    s = put(s, p1, "f2", card("Forest", "Basic Land — Forest", [0, 0]));
    s = put(s, p1, "m1", card("Mountain", "Basic Land — Mountain", [0, 0]));
    s = put(s, p2, "f3", card("Forest", "Basic Land — Forest", [0, 0]));
    expect(affinityReduction(s, p1, "Sapling Nursery")).toBe(2);
    expect(affinityReduction(s, p2, "Sapling Nursery")).toBe(1);
    expect(affinityReduction(s, p1, "Grizzly Bears")).toBe(0);
  });

  it("landfall makes a 3/4 green Treefolk with reach", () => {
    const after = resolveScriptedEffects(
      state,
      nursery().triggers![0].effects!,
      {
        controllerId: p1,
        sourceCardId: null as never,
        targets: [],
      } as unknown as StackObject,
    );
    const tokens = Array.from(after.cards.values()).filter(
      (c) => c.cardData.name.includes("Treefolk") && c.controllerId === p1,
    );
    expect(tokens).toHaveLength(1);
    expect(tokens[0].cardData.type_line).toContain("Treefolk");
    expect(tokens[0].cardData.power).toBe("3");
    expect(tokens[0].cardData.toughness).toBe("4");
    expect(
      (tokens[0].cardData.keywords ?? []).map((k) => k.toLowerCase()),
    ).toContain("reach");
  });

  it("the exile ability gives only Treefolk and Forests indestructible", () => {
    let s = put(
      state,
      p1,
      "tree",
      card("Treefolk", "Token Creature — Treefolk", [3, 4]),
    );
    s = put(s, p1, "forest", card("Forest", "Basic Land — Forest", [0, 0]));
    s = put(s, p1, "bear", card("Grizzly Bears", "Creature — Bear", [2, 2]));
    s = put(
      s,
      p2,
      "foetree",
      card("Treefolk", "Token Creature — Treefolk", [3, 4]),
    );
    const after = resolveScriptedEffects(s, nursery().activated![0].effects!, {
      controllerId: p1,
      sourceCardId: null as never,
      targets: [],
    } as unknown as StackObject);
    const kw = (cid: string) =>
      after.cards.get(id(cid))!.untilEndOfTurnKeywords ?? [];
    expect(kw("tree")).toContain("indestructible");
    expect(kw("forest")).toContain("indestructible");
    expect(kw("bear")).not.toContain("indestructible");
    expect(kw("foetree")).not.toContain("indestructible");
  });

  it("exiles itself as part of the activation cost", () => {
    let s = put(state, p1, "nursery", card("Sapling Nursery", "Enchantment"));
    const players = new Map(s.players);
    const pl = players.get(p1)!;
    players.set(p1, { ...pl, manaPool: { ...pl.manaPool, green: 2 } });
    s = { ...s, players };
    const r = activateAbility(s, p1, id("nursery"), 0);
    expect(r.success).toBe(true);
    expect(r.state.cards.get(id("nursery"))!.currentZoneKey).toBe(
      `${p1}-exile`,
    );
  });

  it("schema only allows subtypes with permanents_you_control", () => {
    const bad = {
      name: "X",
      oracle: "x",
      spell: [
        {
          op: "GrantKeyword",
          keyword: "indestructible",
          target: "creature",
          subtypes: ["Forest"],
          until: "end_of_turn",
        },
      ],
    };
    expect(CardScriptSchema.safeParse(bad).success).toBe(false);
  });
});

describe("Soulstone Sanctuary: a land that becomes a 3/3 creature (#2614)", () => {
  let state: GameState;
  let p1: PlayerId;
  const animate = (s: GameState) =>
    resolveScriptedEffects(
      s,
      getCardScript("Soulstone Sanctuary")!.activated![1].effects!,
      {
        controllerId: p1,
        sourceCardId: id("sanctuary"),
        targets: [],
      } as unknown as StackObject,
    );

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1] = Array.from(state.players.keys());
    const data = {
      ...card("Soulstone Sanctuary", "Land"),
      oracle_text:
        "{T}: Add {C}.\n{4}: This land becomes a 3/3 creature with vigilance and all creature types. It's still a land.",
    } as ScryfallCard;
    state = put(state, p1, "sanctuary", data);
  });

  it("is a plain land without vigilance until the ability resolves", () => {
    const land = state.cards.get(id("sanctuary"))!;
    expect(land.cardData.type_line).toBe("Land");
    expect(hasKeyword(land, "vigilance")).toBe(false);
  });

  it("becomes a 3/3 Land Creature with vigilance and all creature types", () => {
    const land = animate(state).cards.get(id("sanctuary"))!;
    expect(land.cardData.type_line).toBe("Land Creature");
    expect(getEffectivePower(land)).toBe(3);
    expect(getEffectiveToughness(land)).toBe(3);
    expect(hasKeyword(land, "vigilance")).toBe(true);
    expect(hasSubtype(land, "Elf")).toBe(true);
    // All creature types, not land types (CR 205.3m).
    expect(hasSubtype(land, "Forest")).toBe(false);
  });

  it("stays animated through a statics refresh while on the battlefield", () => {
    const land = refreshScriptedStatics(animate(state)).cards.get(
      id("sanctuary"),
    )!;
    expect(land.cardData.type_line).toBe("Land Creature");
  });

  it("a second activation the same turn doesn't stack the type change", () => {
    const land = animate(animate(state)).cards.get(id("sanctuary"))!;
    expect(land.cardData.type_line).toBe("Land Creature");
    expect(land.animatedUntilEndOfTurn!.cardData.type_line).toBe("Land");
  });

  it("is a land again at end of turn", () => {
    const land = clearUntilEndOfTurnPT(animate(state)).cards.get(
      id("sanctuary"),
    )!;
    expect(land.cardData.type_line).toBe("Land");
    expect(land.animatedUntilEndOfTurn).toBeUndefined();
    expect(hasKeyword(land, "vigilance")).toBe(false);
  });

  it("goes to the graveyard as a land card (CR 400.7)", () => {
    const s = destroyCard(animate(state), id("sanctuary"));
    const after = refreshScriptedStatics(s.state);
    const land = after.cards.get(id("sanctuary"))!;
    expect(after.zones.get(`${p1}-graveyard`)!.cardIds).toContain(
      id("sanctuary"),
    );
    expect(land.cardData.type_line).toBe("Land");
  });
});
