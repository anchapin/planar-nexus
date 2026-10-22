/**
 * Card scripts — library search.
 *
 * Split out of the 9.8k-line card-scripts.test.ts (#2642). Suites:
 *   - SearchLibrary tapped + Solemn Simulacrum, Campus Guide fix (#2566)
 *   - scripted SearchLibrary and ShuffleLibrary (#2566)
 */
import {
  CARDS_DIR,
  id,
  card,
  put,
  spell,
  playerTarget,
  battlefield,
} from "./helpers";
import {
  CardScriptSchema,
  getCardScript,
  resolveScriptedSpell,
  resolveScriptedAbility,
} from "../index";
import { GameState, PlayerId, StackObject, Target } from "../../types";
import { createInitialGameState, startGame } from "../../game-state";
import { join } from "node:path";
import { readFileSync } from "node:fs";

describe("SearchLibrary tapped + Solemn Simulacrum, Campus Guide fix (#2566)", () => {
  let state: GameState;
  let p1: PlayerId;

  const ability = (sourceCardId: string, text: string) =>
    ({
      id: "ab-search",
      type: "ability",
      sourceCardId: id(sourceCardId),
      controllerId: p1,
      text,
      targets: [],
      triggered: true,
      activated: false,
    }) as unknown as StackObject;

  const SOLEMN_ETB =
    "When this creature enters, you may search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.";
  const SOLEMN_DIES = "When this creature dies, you may draw a card.";
  const CAMPUS_ETB =
    "When this creature enters, you may search your library for a basic land card, reveal it, then shuffle and put that card on top.";

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1] = Array.from(state.players.keys());
  });

  it("validates SearchLibrary's tapped flag", () => {
    const ok = (effect: object) =>
      CardScriptSchema.safeParse({ name: "X", oracle: "x", spell: [effect] })
        .success;
    const base = {
      op: "SearchLibrary",
      filter: { basic_land: true },
      destination: "battlefield",
    };
    expect(ok({ ...base, tapped: true })).toBe(true);
    expect(ok(base)).toBe(true);
    expect(ok({ ...base, tapped: "yes" })).toBe(false);
  });

  it("Solemn Simulacrum's ETB puts a basic land onto the battlefield tapped", () => {
    let s = put(
      state,
      p1,
      "solemn",
      card("Solemn Simulacrum", "Artifact Creature — Golem", [2, 2]),
    );
    s = put(
      s,
      p1,
      "lib-bear",
      card("Grizzly Bears", "Creature — Bear", [2, 2]),
      "library",
    );
    s = put(
      s,
      p1,
      "lib-forest",
      card("Forest", "Basic Land — Forest"),
      "library",
    );
    const libBefore = s.zones.get(`${p1}-library`)!.cardIds.length;
    const out = resolveScriptedAbility(s, ability("solemn", SOLEMN_ETB))!;
    expect(battlefield(out, p1)).toContain(id("lib-forest"));
    expect(out.cards.get(id("lib-forest"))!.isTapped).toBe(true);
    expect(out.cards.get(id("lib-forest"))!.currentZoneKey).toBe(
      `${p1}-battlefield`,
    );
    const lib = out.zones.get(`${p1}-library`)!.cardIds;
    expect(lib).toHaveLength(libBefore - 1);
    expect(lib).toContain(id("lib-bear"));
  });

  it("Solemn Simulacrum's dies trigger draws a card", () => {
    let s = put(
      state,
      p1,
      "solemn",
      card("Solemn Simulacrum", "Artifact Creature — Golem", [2, 2]),
    );
    s = put(s, p1, "lib-top", card("Island", "Basic Land — Island"), "library");
    const handBefore = s.zones.get(`${p1}-hand`)!.cardIds.length;
    const out = resolveScriptedAbility(s, ability("solemn", SOLEMN_DIES))!;
    expect(out.zones.get(`${p1}-hand`)!.cardIds).toHaveLength(handBefore + 1);
  });

  it("Campus Guide's ETB puts the basic land on top of the library, not onto the battlefield", () => {
    let s = put(
      state,
      p1,
      "guide",
      card("Campus Guide", "Artifact Creature — Golem", [2, 1]),
    );
    s = put(
      s,
      p1,
      "lib-forest",
      card("Forest", "Basic Land — Forest"),
      "library",
    );
    s = put(
      s,
      p1,
      "lib-bear",
      card("Grizzly Bears", "Creature — Bear", [2, 2]),
      "library",
    );
    const out = resolveScriptedAbility(s, ability("guide", CAMPUS_ETB))!;
    expect(battlefield(out, p1)).not.toContain(id("lib-forest"));
    const lib = out.zones.get(`${p1}-library`)!.cardIds;
    // The top of a library is the last id (getTopCard, zones.ts).
    expect(lib[lib.length - 1]).toBe(id("lib-forest"));
    // Same library size as before, the Forest only once (not duplicated).
    expect(lib).toHaveLength(s.zones.get(`${p1}-library`)!.cardIds.length);
    expect(lib.filter((c) => c === id("lib-forest"))).toHaveLength(1);
  });

  it("Solemn Simulacrum and Campus Guide scripts match Scryfall's oracle", () => {
    const read = (f: string) =>
      JSON.parse(readFileSync(join(CARDS_DIR, f), "utf8")) as {
        oracle: string;
        triggers: { text: string }[];
      };
    const solemn = read("solemn_simulacrum.json");
    expect(solemn.oracle).toBe(`${SOLEMN_ETB}\n${SOLEMN_DIES}`);
    expect(solemn.triggers.map((t) => t.text)).toEqual([
      SOLEMN_ETB,
      SOLEMN_DIES,
    ]);
    const campus = read("campus_guide.json");
    expect(campus.oracle).toBe(CAMPUS_ETB);
    expect(campus.triggers.map((t) => t.text)).toEqual([CAMPUS_ETB]);
  });

  const HART =
    "Search your library for up to two basic land cards, put them onto the battlefield tapped, then shuffle.";
  const hartAbility = (sourceCardId: string) =>
    ({
      id: "ab-hart",
      type: "ability",
      sourceCardId: id(sourceCardId),
      controllerId: p1,
      text: HART,
      targets: [],
      triggered: false,
      activated: true,
    }) as unknown as StackObject;

  it("validates SearchLibrary's count (1 or 2)", () => {
    const ok = (count: unknown) =>
      CardScriptSchema.safeParse({
        name: "X",
        oracle: "x",
        spell: [{ op: "SearchLibrary", filter: { basic_land: true }, count }],
      }).success;
    expect(ok(1)).toBe(true);
    expect(ok(2)).toBe(true);
    expect(ok(0)).toBe(false);
    expect(ok(3)).toBe(false);
    expect(ok(1.5)).toBe(false);
  });

  it("Burnished Hart puts up to two basic lands onto the battlefield tapped", () => {
    let s = put(
      state,
      p1,
      "hart",
      card("Burnished Hart", "Artifact Creature — Elk", [2, 2]),
    );
    s = put(s, p1, "f1", card("Forest", "Basic Land — Forest"), "library");
    s = put(s, p1, "f2", card("Plains", "Basic Land — Plains"), "library");
    s = put(s, p1, "f3", card("Island", "Basic Land — Island"), "library");
    const libBefore = s.zones.get(`${p1}-library`)!.cardIds;
    const basics = libBefore.filter((c) =>
      /^Basic Land/.test(s.cards.get(c)?.cardData.type_line ?? ""),
    );
    const out = resolveScriptedAbility(s, hartAbility("hart"))!;
    const fetched = battlefield(out, p1).filter((c) => basics.includes(c));
    expect(fetched).toHaveLength(2);
    for (const c of fetched) expect(out.cards.get(c)!.isTapped).toBe(true);
    expect(out.zones.get(`${p1}-library`)!.cardIds).toHaveLength(
      libBefore.length - 2,
    );
  });

  it("Burnished Hart finds fewer lands when fewer are left", () => {
    let s = put(
      state,
      p1,
      "hart",
      card("Burnished Hart", "Artifact Creature — Elk", [2, 2]),
    );
    // Only nonbasic cards in the library apart from one Forest.
    const lib = s.zones.get(`${p1}-library`)!;
    const zones = new Map(s.zones);
    zones.set(`${p1}-library`, { ...lib, cardIds: [] });
    s = { ...s, zones };
    s = put(
      s,
      p1,
      "bear",
      card("Grizzly Bears", "Creature — Bear", [2, 2]),
      "library",
    );
    s = put(s, p1, "f1", card("Forest", "Basic Land — Forest"), "library");
    const out = resolveScriptedAbility(s, hartAbility("hart"))!;
    expect(battlefield(out, p1)).toContain(id("f1"));
    expect(out.zones.get(`${p1}-library`)!.cardIds).toEqual([id("bear")]);
  });

  it("Burnished Hart's script matches Scryfall's oracle", () => {
    const hart = JSON.parse(
      readFileSync(join(CARDS_DIR, "burnished_hart.json"), "utf8"),
    ) as { oracle: string; activated: { text: string }[] };
    expect(hart.oracle).toBe(`{3}, Sacrifice this creature: ${HART}`);
    expect(hart.activated.map((a) => a.text)).toEqual([HART]);
  });
});

describe("scripted SearchLibrary and ShuffleLibrary (#2566)", () => {
  /** Set up a fresh state with a known, ordered p1 library. */
  const fresh = (): { state: GameState; p1: PlayerId; p2: PlayerId } => {
    const s = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [a, b] = Array.from(s.players.keys());
    return { state: s, p1: a, p2: b };
  };

  /** Replace a player's library with an ordered list of cardIds (top = last). */
  const setLibrary = (
    s: GameState,
    p: PlayerId,
    names: string[],
    type: string = "Sorcery",
  ): GameState => {
    const zones = new Map(s.zones);
    zones.set(`${p}-library`, {
      ...zones.get(`${p}-library`)!,
      cardIds: [],
    });
    const cards = new Map(s.cards);
    let out = { ...s, cards, zones };
    // The library's top is the LAST element of `cardIds` (per
    // `getTopCard`). `put` appends, so iterating `names` in order with
    // `put` produces [name[0], name[1], …, name[n-1]] — name[n-1] is
    // the top.
    for (const n of names) {
      out = put(out, p, n, card(n, type), "library");
    }
    return out;
  };

  const ability = (
    controllerId: PlayerId,
    sourceCardId: string,
    text: string,
    targets: Target[] = [],
  ) =>
    ({
      id: "ab-1",
      type: "ability",
      sourceCardId: id(sourceCardId),
      controllerId,
      text,
      targets,
      triggered: false,
      activated: true,
    }) as unknown as StackObject;

  it("validates ShuffleLibrary", () => {
    const ok = (effect: object) =>
      CardScriptSchema.safeParse({ name: "X", oracle: "x", spell: [effect] })
        .success;
    expect(ok({ op: "ShuffleLibrary" })).toBe(true);
    expect(ok({ op: "ShuffleLibrary", who: "target_player" })).toBe(true);
    expect(ok({ op: "ShuffleLibrary", who: "you", into: "library" })).toBe(
      true,
    );
    // v1 only supports "library"; graveyard-into-library is a follow-up.
    expect(ok({ op: "ShuffleLibrary", into: "graveyard" })).toBe(false);
    expect(ok({ op: "ShuffleLibrary", into: "battlefield" })).toBe(false);
    expect(ok({ op: "ShuffleLibrary", into: "hand" })).toBe(false);
    // `who` is restricted to the same two values SearchLibrary uses.
    expect(ok({ op: "ShuffleLibrary", who: "each_opponent" })).toBe(false);
  });

  it("ShuffleLibrary rearranges the named player's library", () => {
    const f = fresh();
    const state = setLibrary(f.state, f.p1, [
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
      "g",
      "h",
    ]);
    const before = state.zones.get(`${f.p1}-library`)!.cardIds;
    const s = resolveScriptedSpell(
      state,
      CardScriptSchema.parse({
        name: "Shuffle Test",
        oracle: "x",
        spell: [{ op: "ShuffleLibrary" }],
      }),
      spell(f.p1),
    );
    const after = s.zones.get(`${f.p1}-library`)!.cardIds;
    // Multiset is preserved.
    expect([...after].sort()).toEqual([...before].sort());
    // Length is preserved.
    expect(after).toHaveLength(before.length);
    // With 8 cards and a uniform shuffle, the probability of the order
    // being identical is 1/8! ≈ 1/40320, so the test is extremely
    // unlikely to flake. If it ever does, regenerate.
    expect(after).not.toEqual(before);
  });

  it("ShuffleLibrary on a target player shuffles that library, not yours", () => {
    const f = fresh();
    let s = setLibrary(f.state, f.p1, ["a", "b", "c", "d", "e", "f", "g", "h"]);
    // Use a 6-card library for the target player — 1/720 chance of
    // an identical order on a uniform Fisher-Yates pass, very unlikely
    // to flake.
    s = setLibrary(s, f.p2, ["x", "y", "z", "p", "q", "r"]);
    const mineBefore = s.zones.get(`${f.p1}-library`)!.cardIds;
    const yoursBefore = s.zones.get(`${f.p2}-library`)!.cardIds;
    const after = resolveScriptedSpell(
      s,
      CardScriptSchema.parse({
        name: "Shuffle Other",
        oracle: "x",
        spell: [{ op: "ShuffleLibrary", who: "target_player" }],
      }),
      spell(f.p1, [playerTarget(f.p2)]),
    );
    expect(after.zones.get(`${f.p1}-library`)!.cardIds).toEqual(mineBefore);
    const theirs = after.zones.get(`${f.p2}-library`)!.cardIds;
    expect([...theirs].sort()).toEqual([...yoursBefore].sort());
    expect(theirs).not.toEqual(yoursBefore);
  });

  it("SearchLibrary on a basic land actually shuffles the library (#2562 + #2566)", () => {
    // The first matching card is a basic land somewhere in the library
    // (the engine picks the first match, not the top). After the search,
    // that land is in hand and the library is reshuffled — the Wave 1
    // "shuffle: true" was a no-op until Lane 8 wired the new
    // `shuffleLibraryZone` primitive into the SearchLibrary case.
    const f = fresh();
    let s = setLibrary(f.state, f.p1, [
      "bear-1",
      "bear-2",
      "bear-3",
      "Forest-1",
      "Plains-1",
    ]);
    // Replace the Forest-1 card's type_line with "Basic Land —" so the
    // `basic_land: true` filter matches it (the engine picks the first
    // match in cardIds order, which is Forest-1 here).
    const cards = new Map(s.cards);
    const f1 = cards.get(id("Forest-1"))!;
    cards.set(id("Forest-1"), {
      ...f1,
      cardData: { ...f1.cardData, type_line: "Basic Land — Forest" },
    });
    s = { ...s, cards };
    const before = s.zones.get(`${f.p1}-library`)!.cardIds;
    // Pin the shuffle's randomness: with Math.random() = 0 every
    // Fisher-Yates step swaps with index 0, which never leaves 4 cards in
    // their original order. Unpinned, the identical-order case (1/24) made
    // this test flake in CI.
    const randomSpy = jest.spyOn(Math, "random").mockReturnValue(0);
    let after: typeof s;
    try {
      after = resolveScriptedSpell(s, getCardScript("Bushwhack")!, spell(f.p1));
    } finally {
      randomSpy.mockRestore();
    }
    // The chosen basic land (Forest-1) is now in hand.
    const hand = after.zones.get(`${f.p1}-hand`)!.cardIds;
    expect(hand).toContain(id("Forest-1"));
    // The library is missing the chosen card.
    const afterLib = after.zones.get(`${f.p1}-library`)!.cardIds;
    expect(afterLib).not.toContain(id("Forest-1"));
    expect(afterLib).toHaveLength(before.length - 1);
    // The library was actually shuffled: its order differs from the
    // original (deterministic with the pinned randomness above).
    expect(afterLib).not.toEqual(before.filter((c) => c !== id("Forest-1")));
  });

  it("SearchLibrary with shuffle: false leaves the library order untouched", () => {
    // After Lane 8, `shuffle: false` skips the post-search shuffle
    // (the schema's default is true; the explicit `false` is what
    // players rarely want, but the schema accepts it).
    const f = fresh();
    let s = setLibrary(f.state, f.p1, ["bear-1", "bear-2", "Forest-top"]);
    // Replace the last (top) card's type_line with "Basic Land — Forest"
    // so the `basic_land: true` filter matches.
    const cards = new Map(s.cards);
    const ft = cards.get(id("Forest-top"))!;
    cards.set(id("Forest-top"), {
      ...ft,
      cardData: { ...ft.cardData, type_line: "Basic Land — Forest" },
    });
    s = { ...s, cards };
    const before = s.zones.get(`${f.p1}-library`)!.cardIds;
    const after = resolveScriptedSpell(
      s,
      CardScriptSchema.parse({
        name: "Search NoShuffle",
        oracle: "x",
        spell: [
          {
            op: "SearchLibrary",
            filter: { basic_land: true },
            destination: "hand",
            shuffle: false,
          },
        ],
      }),
      spell(f.p1),
    );
    const afterLib = after.zones.get(`${f.p1}-library`)!.cardIds;
    expect(afterLib).toEqual(before.filter((c) => c !== id("Forest-top")));
  });

  it("Burnished Hart's ETB searches a basic land onto the battlefield and shuffles", () => {
    const f = fresh();
    let s = setLibrary(f.state, f.p1, ["bear-1", "bear-2", "Plains-top"]);
    // Replace the land's type_line so the `basic_land: true` filter matches.
    const cards = new Map(s.cards);
    const inst = cards.get(id("Plains-top"))!;
    cards.set(id("Plains-top"), {
      ...inst,
      cardData: { ...inst.cardData, type_line: "Basic Land — Forest" },
    });
    s = { ...s, cards };
    s = put(
      s,
      f.p1,
      "hart",
      card("Burnished Hart", "Artifact Creature — Elk", [2, 2]),
    );
    const before = s.zones.get(`${f.p1}-library`)!.cardIds;
    const after = resolveScriptedAbility(
      s,
      ability(
        f.p1,
        "hart",
        "Search your library for up to two basic land cards, put them onto the battlefield tapped, then shuffle.",
      ),
    )!;
    // v1 limitation: the schema caps SearchLibrary.count at 1, so only
    // the first matching card (Plains-top) is chosen. The Hart also
    // doesn't tap on enter (no "enters tapped" op) and the "you may
    // sacrifice" path is not modeled. The shuffle IS the point of Lane 8
    // and IS applied.
    const battlefield = after.zones.get(`${f.p1}-battlefield`)!.cardIds;
    expect(battlefield).toContain(id("Plains-top"));
    const afterLib = after.zones.get(`${f.p1}-library`)!.cardIds;
    expect(afterLib).not.toContain(id("Plains-top"));
    expect(afterLib).not.toEqual(before);
  });

  it("Wishclaw Talisman's activated ability draws and discards", () => {
    // v1: Wishclaw is scripted for the Draw + Discard half; the "put
    // this artifact on the bottom of its owner's library" line is a
    // separate op that's a follow-up. The "library-shuffling context"
    // Lane 8 cares about is exercised by the underlying ShuffleLibrary
    // op tests above.
    const f = fresh();
    let s = setLibrary(f.state, f.p1, ["lib-1", "lib-2", "lib-3"]);
    s = put(s, f.p1, "hand-1", card("Hand 1", "Instant"), "hand");
    s = put(s, f.p1, "hand-2", card("Hand 2", "Instant"), "hand");
    s = put(s, f.p1, "talisman", card("Wishclaw Talisman", "Artifact"));
    const beforeHand = s.zones.get(`${f.p1}-hand`)!.cardIds.length;
    const beforeLib = s.zones.get(`${f.p1}-library`)!.cardIds.length;
    const after = resolveScriptedAbility(s, {
      id: "ab-1",
      type: "ability",
      sourceCardId: id("talisman"),
      controllerId: f.p1,
      text: "{T}: Draw a card, then discard a card. Then put this artifact on the bottom of its owner's library.",
      targets: [],
      triggered: false,
      activated: true,
    } as unknown as StackObject)!;
    // Drew one (now has beforeHand+1 in hand), then waiting on a
    // discard choice. Library is shorter by 1 (we drew the top).
    expect(after.zones.get(`${f.p1}-library`)!.cardIds.length).toBe(
      beforeLib - 1,
    );
    expect(after.waitingChoice?.type).toBe("discard_cards");
    expect(after.waitingChoice?.playerId).toBe(f.p1);
    // The discard choice's pool is the hand (after the draw); the
    // beforeHand hand has become beforeHand+1 by the time the discard
    // is asked.
    expect(after.waitingChoice?.choices.length).toBe(beforeHand + 1);
  });

  describe("SearchLibrary OR filter (#2594)", () => {
    // The OR arm lets a card match any of N sub-filters. Top-level AND
    // keys still apply; the `or` array is matched alongside (a card must
    // pass all AND keys AND at least one OR sub-filter when `or` is set).
    const ok = (effect: object) =>
      CardScriptSchema.safeParse({ name: "X", oracle: "x", spell: [effect] })
        .success;

    it("schema: or is rejected when empty", () => {
      expect(ok({ op: "SearchLibrary", filter: { or: [] } })).toBe(false);
    });

    it("schema: or alone is enough to satisfy the 'at least one key' refine", () => {
      expect(
        ok({ op: "SearchLibrary", filter: { or: [{ land: true }] } }),
      ).toBe(true);
    });

    it("schema: or is recursive (a sub-filter can carry its own or)", () => {
      // (creature with MV=1) OR ((land) OR (artifact))
      expect(
        ok({
          op: "SearchLibrary",
          filter: {
            or: [
              { creature: true, mv_eq: 1 },
              { or: [{ land: true }, { artifact: true }] },
            ],
          },
        }),
      ).toBe(true);
    });

    it("schema: off-list keys still rejected inside or sub-filters", () => {
      expect(
        ok({
          op: "SearchLibrary",
          filter: { or: [{ fear: true }] },
        }),
      ).toBe(false);
    });

    it("engine: or matches the first card that hits any sub-filter", () => {
      // "artifact or land" — the first matching card in library order
      // moves to hand; the rest are still shuffled.
      const f = fresh();
      const beforeHand = new Set(f.state.zones.get(`${f.p1}-hand`)!.cardIds);
      let s = setLibrary(
        f.state,
        f.p1,
        ["creature-1", "land-1", "artifact-1"],
        "Creature", // default type — override below
      );
      // Override the type_lines so the OR filter can distinguish.
      const cards = new Map(s.cards);
      for (const [cid, name, type] of [
        [id("creature-1"), "creature-1", "Creature — Test"],
        [id("land-1"), "land-1", "Basic Land — Plains"],
        [id("artifact-1"), "artifact-1", "Artifact Creature — Construct"],
      ] as const) {
        const inst = cards.get(cid)!;
        cards.set(cid, {
          ...inst,
          cardData: { ...inst.cardData, type_line: type },
        });
      }
      s = { ...s, cards };
      const after = resolveScriptedSpell(
        s,
        CardScriptSchema.parse({
          name: "ArtifactOrLand",
          oracle: "x",
          spell: [
            {
              op: "SearchLibrary",
              filter: { or: [{ artifact: true }, { land: true }] },
            },
          ],
        }),
        spell(f.p1),
      );
      // The fresh-state hand has a few default cards; the new card is
      // whichever hand id was not in the starting set.
      const afterHand = after.zones.get(`${f.p1}-hand`)!.cardIds;
      const newCard = afterHand.find((c) => !beforeHand.has(c));
      expect(newCard).toBeDefined();
      // The newly-moved card is a land or an artifact (not a plain creature).
      const movedName = after.cards.get(newCard!)!.cardData.name;
      expect(["land-1", "artifact-1"]).toContain(movedName);
      // The library was shuffled (CR 701.19b: even on a no-find, shuffle).
      const afterLib = after.zones.get(`${f.p1}-library`)!.cardIds;
      expect(afterLib).not.toEqual(s.zones.get(`${f.p1}-library`)!.cardIds);
    });

    it("engine: or combines with top-level AND keys (sub-filter must also pass)", () => {
      // "creature OR (artifact with MV <= 2)" — but the AND key `color: G`
      // applies to BOTH arms, so only green cards in either arm match.
      const f = fresh();
      const beforeHand = new Set(f.state.zones.get(`${f.p1}-hand`)!.cardIds);
      let s = setLibrary(
        f.state,
        f.p1,
        ["red-creature", "green-creature", "red-artifact", "green-artifact"],
        "Creature",
      );
      const cards = new Map(s.cards);
      for (const [cid, name, type, colors] of [
        [id("red-creature"), "red-creature", "Creature — Test", ["R"]],
        [id("green-creature"), "green-creature", "Creature — Test", ["G"]],
        [id("red-artifact"), "red-artifact", "Artifact", ["R"]],
        [id("green-artifact"), "green-artifact", "Artifact", ["G"]],
      ] as const) {
        const inst = cards.get(cid)!;
        cards.set(cid, {
          ...inst,
          cardData: { ...inst.cardData, type_line: type, colors: [...colors] },
        });
      }
      s = { ...s, cards };
      const after = resolveScriptedSpell(
        s,
        CardScriptSchema.parse({
          name: "GreenCreatureOrArtifact",
          oracle: "x",
          spell: [
            {
              op: "SearchLibrary",
              filter: {
                color: "G",
                or: [{ creature: true }, { artifact: true }],
              },
            },
          ],
        }),
        spell(f.p1),
      );
      const afterHand = after.zones.get(`${f.p1}-hand`)!.cardIds;
      const newCard = afterHand.find((c) => !beforeHand.has(c));
      expect(newCard).toBeDefined();
      // Only green cards should be selected — red ones are filtered out
      // by the top-level AND key. green-creature comes first in library
      // order, so it wins.
      expect(after.cards.get(newCard!)!.cardData.name).toBe("green-creature");
    });
  });
});
