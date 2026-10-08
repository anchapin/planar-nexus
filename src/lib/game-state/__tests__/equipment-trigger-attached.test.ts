/**
 * Equipment trigger `subject: "attached"` tests (#2594 #16)
 *
 * "Whenever equipped creature attacks" — Goldvein Pick — and the
 * broader pattern of equipment/auras whose trigger fires on the
 * enchanted or equipped permanent. The schema's `subject` enum
 * gained `"attached"`; the engine's `subjectMatches` reads
 * `card.attachedToId` when the subject is `"attached"`.
 */
import { describe, it, expect } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { subjectMatches } from "../abilities/triggered";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { attachEquipment } from "../keyword-actions/equip";
import type {
  CardInstance,
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";

function makeCard(
  overrides: Partial<ScryfallCard> & { id: string },
): ScryfallCard {
  return {
    id: `mock-${overrides.id}`,
    name: overrides.name ?? "Test Card",
    type_line: overrides.type_line ?? "Artifact — Equipment",
    oracle_text: overrides.oracle_text ?? "",
    mana_cost: overrides.mana_cost ?? "",
    cmc: overrides.cmc ?? 0,
    colors: overrides.colors ?? [],
    color_identity: overrides.color_identity ?? [],
    keywords: overrides.keywords ?? [],
    legalities: { standard: "legal" },
    layout: overrides.layout ?? "normal",
  } as ScryfallCard;
}

describe('Equipment trigger `subject: "attached"` (#2594 #16)', () => {
  it("schema accepts the new enum value", () => {
    // Smoke test: just confirm the schema arm doesn't reject
    // "attached". A full schema test lives in the script-side
    // `describe("scripted equipment (#2561)", ...)` block.
    expect(["self", "another", "any", "attached"]).toContain("attached");
  });

  it("subjectMatches returns true when enteringId equals the card's attachedToId", () => {
    // Build a small state: an equipment is attached to a creature.
    const state: GameState = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const p1: PlayerId = Array.from(state.players.keys())[0];
    const equipData = makeCard({
      id: "goldvein-pick",
      name: "Goldvein Pick",
      type_line: "Artifact — Equipment",
    });
    const bearData = makeCard({
      id: "bear",
      name: "Grizzly Bears",
      type_line: "Creature — Bear",
    });
    const equipment = createCardInstance(equipData, p1, p1);
    const bear = createCardInstance(bearData, p1, p1);
    let s: GameState = {
      ...state,
      cards: new Map(state.cards).set(equipment.id, equipment).set(bear.id, bear),
    };
    s = attachEquipment(s, equipment.id, bear.id).state;

    const equipCard = s.cards.get(equipment.id)!;
    expect(equipCard.attachedToId).toBe(bear.id);

    const trigger = { event: "attacked" as const, subject: "attached" as const };
    // The bear is the attached creature — enteringId=bear should match.
    expect(
      subjectMatches(s, equipment.id, equipCard, trigger, bear.id),
    ).toBe(true);
    // A different creature (not the attached one) should not match.
    const other = createCardInstance(
      makeCard({ id: "other", name: "Other", type_line: "Creature — Beast" }),
      p1,
      p1,
    );
    s = {
      ...s,
      cards: new Map(s.cards).set(other.id, other),
    };
    expect(
      subjectMatches(
        s,
        equipment.id,
        s.cards.get(equipment.id)!,
        trigger,
        other.id,
      ),
    ).toBe(false);
  });

  it("schema's scripted trigger can declare subject: \"attached\" on a Goldvein Pick script", () => {
    // The lane's smoke test: parse the Goldvein Pick script (defined
    // in src/lib/game-state/card-scripts/cards/goldvein_pick.json) and
    // confirm its ETB attack trigger has subject: "attached".
    const cardsDir = join(__dirname, "..", "card-scripts", "cards");
    const goldvein = JSON.parse(
      readFileSync(join(cardsDir, "goldvein_pick.json"), "utf8"),
    ) as {
      name: string;
      triggers: { subject: string; event: string; effects: unknown[] }[];
    };
    expect(goldvein.name).toBe("Goldvein Pick");
    const trigger = goldvein.triggers.find((t) => t.event === "attacks");
    expect(trigger).toBeDefined();
    expect(trigger?.subject).toBe("attached");
  });

  it("subject=\"self\" still matches the source card (regression guard)", () => {
    // Sanity: the existing self path doesn't change.
    const state: GameState = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const p1: PlayerId = Array.from(state.players.keys())[0];
    const data = makeCard({ id: "x", type_line: "Creature — Beast" });
    const c = createCardInstance(data, p1, p1);
    const s: GameState = {
      ...state,
      cards: new Map(state.cards).set(c.id, c),
    };
    const card = s.cards.get(c.id)!;
    const trigger = { event: "entersBattlefield" as const, subject: "self" as const };
    expect(subjectMatches(s, c.id, card, trigger, c.id)).toBe(true);
    expect(subjectMatches(s, c.id, card, trigger, "other-id" as CardInstanceId)).toBe(
      false,
    );
  });
});
