/**
 * Card scripts — grant keyword.
 *
 * Split out of the 9.8k-line card-scripts.test.ts (#2642). Suites:
 *   - scripted GrantKeyword (#2567)
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
import { CardScript } from "../schema";
import {
  CardScriptSchema,
  effectTargetCount,
  getCardScript,
  isTargetedEffect,
  resolveScriptedSpell,
  scriptedSpellEffects,
} from "../index";
import { GameState, PlayerId, Target } from "../../types";
import { checkStateBasedActions } from "../../state-based-actions";
import { clearUntilEndOfTurnPT } from "../../pt-until-end-of-turn";
import { createInitialGameState, startGame } from "../../game-state";
import { destroyCard } from "../../keyword-actions/removal";
import {
  getEffectivePower,
  getEffectiveToughness,
} from "../../evergreen-keywords";
import { hasKeyword } from "../../evergreen-keywords";
import { join } from "node:path";
import { readdirSync, readFileSync } from "node:fs";

describe("scripted GrantKeyword (#2567)", () => {
  const fresh = () => {
    const state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [p1, p2] = Array.from(state.players.keys());
    const s = put(state, p2, "bear", card("Bear", "Creature — Bear", [2, 2]));
    return { state: s, p1, p2 };
  };
  const ok = (effect: object) =>
    CardScriptSchema.safeParse({ name: "X", oracle: "x", spell: [effect] })
      .success;
  const grant = (target: "creature" | "self" | "it") =>
    ({
      op: "GrantKeyword",
      keyword: "indestructible",
      target,
      until: "end_of_turn",
    }) as const;
  const withDamage = (s: GameState, cardId: string, damage: number) => {
    const cards = new Map(s.cards);
    cards.set(id(cardId), { ...cards.get(id(cardId))!, damage });
    return { ...s, cards };
  };
  const adamant = (s: GameState, p1: PlayerId, target = "bear") =>
    resolveScriptedSpell(
      s,
      getCardScript("Adamant Will")!,
      spell(p1, [cardTarget(target)]),
    );

  it("validates GrantKeyword", () => {
    expect(ok(grant("creature"))).toBe(true);
    expect(ok(grant("it"))).toBe(true);
    expect(ok({ ...grant("creature"), controller: "you" })).toBe(true);
    expect(ok({ ...grant("self"), controller: "you" })).toBe(false);
    // Every evergreen keyword in the grantable list validates
    // (issue #2594 follow-up: widens from `indestructible`-only to
    // match the equipment keyword set).
    for (const keyword of [
      "flying",
      "vigilance",
      "trample",
      "haste",
      "lifelink",
      "deathtouch",
      "reach",
      "first strike",
      "double strike",
      "menace",
      "hexproof",
      "indestructible",
    ]) {
      expect(ok({ ...grant("creature"), keyword })).toBe(true);
    }
    // Keywords outside the evergreen set are still rejected.
    expect(ok({ ...grant("creature"), keyword: "fear" })).toBe(false);
    expect(ok({ ...grant("creature"), keyword: "banding" })).toBe(false);
    expect(ok({ ...grant("creature"), until: "next_turn" })).toBe(false);
    const { until: _until, ...noUntil } = grant("creature");
    expect(ok(noUntil)).toBe(false);
  });

  it("only a creature target uses a target", () => {
    expect(isTargetedEffect(grant("creature"))).toBe(true);
    expect(isTargetedEffect(grant("self"))).toBe(false);
    expect(isTargetedEffect(grant("it"))).toBe(false);
    const effects = getCardScript("Adamant Will")!.spell!;
    expect(effects.reduce((n, e) => n + effectTargetCount(e), 0)).toBe(1);
  });

  it("Adamant Will gives +2/+2 and indestructible to one target", () => {
    const { state, p1 } = fresh();
    const s = adamant(state, p1);
    const bear = s.cards.get(id("bear"))!;
    expect(getEffectivePower(bear)).toBe(4);
    expect(getEffectiveToughness(bear)).toBe(4);
    expect(hasKeyword(bear, "indestructible")).toBe(true);
  });

  it("the granted creature survives lethal damage and destroy (CR 702.12b)", () => {
    const { state, p1, p2 } = fresh();
    let s = withDamage(adamant(state, p1), "bear", 10);
    s = checkStateBasedActions(s).state;
    expect(battlefield(s, p2)).toContain(id("bear"));
    s = destroyCard(s, id("bear")).state;
    expect(battlefield(s, p2)).toContain(id("bear"));
  });

  it("the grant ends at cleanup, so lethal damage then kills it", () => {
    const { state, p1, p2 } = fresh();
    let s = clearUntilEndOfTurnPT(adamant(state, p1));
    expect(hasKeyword(s.cards.get(id("bear"))!, "indestructible")).toBe(false);
    s = checkStateBasedActions(withDamage(s, "bear", 2)).state;
    expect(battlefield(s, p2)).not.toContain(id("bear"));
    expect(s.zones.get(`${p2}-graveyard`)!.cardIds).toContain(id("bear"));
  });

  it('"it" grants nothing when the shared target is gone (CR 608.2b)', () => {
    const { state, p1 } = fresh();
    const s = adamant(state, p1, "nowhere");
    expect(hasKeyword(s.cards.get(id("bear"))!, "indestructible")).toBe(false);
  });

  it("every GrantKeyword script's text says until end of turn", () => {
    for (const f of readdirSync(CARDS_DIR).filter((x) => x.endsWith(".json"))) {
      const script = JSON.parse(
        readFileSync(join(CARDS_DIR, f), "utf8"),
      ) as CardScript;
      for (const e of scriptedSpellEffects(script)) {
        if (e.op !== "GrantKeyword") continue;
        expect([f, script.oracle.toLowerCase()]).toEqual([
          f,
          expect.stringContaining(`${e.keyword} until end of turn`),
        ]);
      }
    }
  });

  it("grants non-indestructible keywords through the same engine path (#2594)", () => {
    // The schema widens to all 12 evergreen keywords (#2594). The engine
    // path (`addUntilEndOfTurnKeyword` -> `untilEndOfTurnKeywords` ->
    // `hasKeyword`) is the same for every keyword; sanity-check three
    // representative ones (lifelink, trample, flying) flow through.
    const grant = (keyword: "lifelink" | "trample" | "flying") =>
      ({
        op: "GrantKeyword",
        keyword,
        target: "creature",
        until: "end_of_turn",
      }) as const;
    const resolve = (
      s: GameState,
      p1: PlayerId,
      keyword: "lifelink" | "trample" | "flying",
    ) =>
      resolveScriptedSpell(
        s,
        {
          name: "X",
          oracle: "x",
          spell: [grant(keyword)],
        },
        spell(p1, [cardTarget("bear")]),
      );
    for (const keyword of ["lifelink", "trample", "flying"] as const) {
      const { state, p1 } = fresh();
      const s = resolve(state, p1, keyword);
      expect(hasKeyword(s.cards.get(id("bear"))!, keyword)).toBe(true);
    }
    // Cleanup drops them too.
    const { state, p1 } = fresh();
    const s = clearUntilEndOfTurnPT(resolve(state, p1, "flying"));
    expect(hasKeyword(s.cards.get(id("bear"))!, "flying")).toBe(false);
  });

  it("Boros Charm's third mode grants double strike to a target creature", () => {
    // Re-validates the v1 workaround removal: the third mode of Boros
    // Charm was dropped in #2592's rebase because `GRANTABLE_KEYWORDS`
    // was `["indestructible"]`. With the enum widened, the mode parses
    // and resolves through the same engine path as indestructible.
    const f = fresh();
    const s = resolveScriptedSpell(f.state, getCardScript("Boros Charm")!, {
      ...spell(f.p1, [cardTarget("bear")]),
      chosenModes: ["Target creature gains double strike until end of turn."],
    });
    expect(hasKeyword(s.cards.get(id("bear"))!, "double strike")).toBe(true);
  });

  it("Boros Charm's second mode grants indestructible to ALL the controller's permanents (#2594 #14)", () => {
    // v1 limitation: mode 2 was scripted as `target: "creature" +
    // controller: "you"`, which only granted indestructible to creatures
    // you control — artifacts, enchantments, planeswalkers, and lands
    // missed the grant. With `target: "permanents_you_control"` the
    // engine fans out to every permanent the controller owns on
    // resolution, matching the card text.
    const f = fresh();
    // Set up a battlefield with a creature, an artifact, and an
    // enchantment under p1's control. The artifact and enchantment
    // would be skipped by the v1 creature-only path.
    let s0 = f.state;
    s0 = put(s0, f.p1, "bear", card("Bear", "Creature — Bear", [2, 2]));
    s0 = put(s0, f.p1, "rock", card("Rock", "Artifact"));
    s0 = put(s0, f.p1, "bestow", card("Bestow Test", "Enchantment — Aura"));
    // An opponent's creature that should NOT be granted indestructible.
    s0 = put(s0, f.p2, "theirs", card("Foe", "Creature — Beast", [1, 1]));

    const s = resolveScriptedSpell(s0, getCardScript("Boros Charm")!, {
      ...spell(f.p1, []),
      chosenModes: [
        "Permanents you control gain indestructible until end of turn.",
      ],
    });

    // All three of p1's permanents get indestructible.
    expect(hasKeyword(s.cards.get(id("bear"))!, "indestructible")).toBe(true);
    expect(hasKeyword(s.cards.get(id("rock"))!, "indestructible")).toBe(true);
    expect(hasKeyword(s.cards.get(id("bestow"))!, "indestructible")).toBe(true);
    // p2's creature does NOT.
    expect(hasKeyword(s.cards.get(id("theirs"))!, "indestructible")).toBe(
      false,
    );
  });

  it("GrantKeyword `permanents_you_control` with no permanents on the battlefield is a no-op", () => {
    const f = fresh();
    // Empty battlefield — the fan-out iterates over zero cards and
    // returns the state unchanged.
    const s = resolveScriptedSpell(
      {
        ...f.state,
        players: new Map(f.state.players).set(f.p1, {
          ...f.state.players.get(f.p1)!,
          manaPool: {
            ...f.state.players.get(f.p1)!.manaPool,
            white: 0,
            red: 0,
          },
        }),
      },
      getCardScript("Boros Charm")!,
      {
        ...spell(f.p1, []),
        chosenModes: [
          "Permanents you control gain indestructible until end of turn.",
        ],
      },
    );
    // State should be the same except for the spell resolution
    // timestamp — the simplest assertion is the battlefield is empty.
    expect(s.zones.get(`${f.p1}-battlefield`)!.cardIds).toEqual([]);
  });

  it("schema accepts `permanents_you_control` on GrantKeyword and rejects `controller`", () => {
    // The new target is a "plural" — the controller filter is
    // encoded in the target value, so a `controller` field is
    // rejected (it would be a redundant/conflicting filter).
    const ok = CardScriptSchema.safeParse({
      name: "Test",
      oracle: "x",
      spell: [
        {
          op: "GrantKeyword",
          keyword: "indestructible",
          target: "permanents_you_control",
          until: "end_of_turn",
        },
      ],
    });
    expect(ok.success).toBe(true);

    // The schema is `.strict()`, so an unexpected `controller` field
    // on a `permanents_you_control` target is rejected.
    const withController = CardScriptSchema.safeParse({
      name: "Test",
      oracle: "x",
      spell: [
        {
          op: "GrantKeyword",
          keyword: "indestructible",
          target: "permanents_you_control",
          controller: "you",
          until: "end_of_turn",
        },
      ],
    });
    expect(withController.success).toBe(false);
  });
});
