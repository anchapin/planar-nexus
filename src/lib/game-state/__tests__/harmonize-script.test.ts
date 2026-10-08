/**
 * Harmonize (CR 702.180, #2614): Channeled Dragonfire.
 *
 * "You may cast this card from your graveyard for its harmonize cost. You
 * may tap a creature you control to reduce that cost by {X}, where X is its
 * power. Then exile this spell."
 */
import { describe, it, expect, beforeEach } from "@jest/globals";
import { castSpell, resolveTopOfStack } from "../spell-casting";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import { registerCardScripts } from "../card-scripts/registry";
import { RAW_CARD_SCRIPTS } from "../card-scripts/cards/index.generated";
import { CardScriptSchema } from "../card-scripts/schema";
import { Phase } from "../types";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
  Target,
} from "../types";

const DRAGONFIRE_ORACLE =
  "Channeled Dragonfire deals 2 damage to any target.\nHarmonize {5}{R}{R} (You may cast this card from your graveyard for its harmonize cost. You may tap a creature you control to reduce that cost by {X}, where X is its power. Then exile this spell.)";

const scry = (
  name: string,
  type_line: string,
  mana_cost: string,
  extra: Partial<ScryfallCard> = {},
): ScryfallCard =>
  ({
    id: name.toLowerCase().replace(/\W+/g, "-"),
    name,
    type_line,
    oracle_text: "",
    mana_cost,
    cmc: 1,
    colors: ["R"],
    color_identity: ["R"],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
    ...extra,
  }) as ScryfallCard;

describe("Harmonize: Channeled Dragonfire (#2614)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;
  let fire: CardInstanceId;

  const place = (s: GameState, inst: { id: CardInstanceId }, zone: string) => {
    const cards = new Map(s.cards);
    cards.set(inst.id, { ...(inst as never), currentZoneKey: zone });
    const zones = new Map(s.zones);
    const z = zones.get(zone)!;
    zones.set(zone, { ...z, cardIds: [...z.cardIds, inst.id] });
    return { ...s, cards, zones };
  };

  const opponent = (): Target => ({
    type: "player",
    targetId: p2,
    isValid: true,
  });

  beforeEach(() => {
    registerCardScripts(RAW_CARD_SCRIPTS);
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
    state.turn.activePlayerId = p1;
    state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    state.priorityPlayerId = p1;
    state.stack = [];
    const inst = createCardInstance(
      scry("Channeled Dragonfire", "Sorcery", "{R}", {
        oracle_text: DRAGONFIRE_ORACLE,
      }),
      p1,
      p1,
    );
    fire = inst.id;
    state = place(state, inst, `${p1}-graveyard`);
  });

  it("casts from the graveyard for {5}{R}{R}, deals 2, then is exiled", () => {
    state = addMana(state, p1, { generic: 5, red: 2 });
    const cast = castSpell(state, p1, fire, [opponent()], [], 0, false, {
      type: "harmonize",
    });
    expect(cast.success).toBe(true);
    expect(cast.state.stack[0].alternativeCostsUsed).toContain("harmonize");
    const pool = cast.state.players.get(p1)!.manaPool;
    expect(pool.generic).toBe(0);
    expect(pool.red).toBe(0);
    const after = resolveTopOfStack(cast.state);
    expect(after.players.get(p2)!.life).toBe(18);
    expect(after.zones.get(`${p1}-exile`)!.cardIds).toContain(fire);
    expect(after.zones.get(`${p1}-graveyard`)!.cardIds).not.toContain(fire);
  });

  it("tapping a creature reduces the generic cost by its power", () => {
    const giant = createCardInstance(
      scry("Hill Giant", "Creature — Giant", "{3}{R}", {
        power: "3",
        toughness: "3",
      }),
      p1,
      p1,
    );
    state = place(state, giant, `${p1}-battlefield`);
    state = addMana(state, p1, { generic: 2, red: 2 });
    const cast = castSpell(state, p1, fire, [opponent()], [], 0, false, {
      type: "harmonize",
      harmonizeTapCreature: giant.id,
    });
    expect(cast.success).toBe(true);
    expect(cast.state.cards.get(giant.id)!.isTapped).toBe(true);
    expect(cast.state.players.get(p1)!.manaPool.generic).toBe(0);
  });

  it("rejects a tapped creature for the reduction", () => {
    const giant = createCardInstance(
      scry("Hill Giant", "Creature — Giant", "{3}{R}", {
        power: "3",
        toughness: "3",
      }),
      p1,
      p1,
    );
    state = place(state, { ...giant, isTapped: true }, `${p1}-battlefield`);
    state = addMana(state, p1, { generic: 2, red: 2 });
    const cast = castSpell(state, p1, fire, [opponent()], [], 0, false, {
      type: "harmonize",
      harmonizeTapCreature: giant.id,
    });
    expect(cast.success).toBe(false);
  });

  it("schema: harmonize is only for instant or sorcery scripts", () => {
    const ok = (s: object) => CardScriptSchema.safeParse(s).success;
    expect(
      ok({
        name: "X",
        oracle: "x",
        spell: [{ op: "Draw", amount: 1, who: "you" }],
        harmonize: { cost: "{5}{R}{R}" },
      }),
    ).toBe(true);
    expect(
      ok({
        name: "X",
        oracle: "x",
        triggers: [
          {
            text: "x",
            event: "etb",
            subject: "self",
            effects: [{ op: "Draw", amount: 1, who: "you" }],
          },
        ],
        harmonize: { cost: "{5}{R}{R}" },
      }),
    ).toBe(false);
  });
});
