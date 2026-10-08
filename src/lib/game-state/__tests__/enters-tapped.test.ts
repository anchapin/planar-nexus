/**
 * "This card enters the battlefield tapped" tests (#2594 follow-up,
 * lane 19)
 *
 * The drafter has 1 FDN card wanting this — Diregraf Ghoul (FDN
 * #171, "This creature enters tapped."). The current scripted
 * schema had no flag for this; the engine's `SearchLibrary.tapped`
 * flag works for "search up to N and put them onto the battlefield
 * tapped", but not for "this permanent always enters tapped". This
 * lane adds `entersTapped?: boolean` to `CardScriptSchema` and
 * threads it through `moveCardToZone`'s ETB branch.
 */
import { describe, it, expect, beforeEach } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { moveCardToZone } from "../keyword-actions/removal";
import { startGame, createInitialGameState } from "../game-state";
import { createCardInstance } from "../card-instance";
import { registerCardScripts } from "../card-scripts/registry";
import { RAW_CARD_SCRIPTS } from "../card-scripts/cards/index.generated";
import { Phase } from "../types";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";

function makeCard(
  name: string,
  typeLine: string,
  power?: [number, number],
): ScryfallCard {
  return {
    id: `mock-${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    type_line: typeLine,
    oracle_text: "",
    mana_cost: "",
    cmc: power ? Math.max(...power) : 0,
    colors: [],
    color_identity: [],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
    power: power ? String(power[0]) : undefined,
    toughness: power ? String(power[1]) : undefined,
  } as ScryfallCard;
}

/** Place a real CardInstance in a player's graveyard. */
function placeInGraveyard(
  state: GameState,
  card: ScryfallCard,
  owner: PlayerId,
  cardId: CardInstanceId,
): GameState {
  const zoneKey = `${owner}-graveyard`;
  const inst = createCardInstance(card, owner, owner, {
    id: cardId,
    currentZoneKey: zoneKey,
  });
  const cards = new Map(state.cards).set(cardId, inst);
  const existing = state.zones.get(zoneKey)!;
  const zones = new Map(state.zones);
  zones.set(zoneKey, {
    ...existing,
    cardIds: [...existing.cardIds, cardId],
  });
  return { ...state, cards, zones };
}

describe('This card enters tapped (#2594 follow-up, lane 19)', () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
    state.turn.activePlayerId = p1;
    state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    registerCardScripts([...RAW_CARD_SCRIPTS]);
  });

  it("Diregraf Ghoul script declares entersTapped: true", () => {
    const cardsDir = join(__dirname, "..", "card-scripts", "cards");
    const fixture = JSON.parse(
      readFileSync(join(cardsDir, "diregraf_ghoul.json"), "utf8"),
    ) as { name: string; entersTapped?: boolean };
    expect(fixture.name).toBe("Diregraf Ghoul");
    expect(fixture.entersTapped).toBe(true);
  });

  it("a card with entersTapped: true lands on the battlefield tapped", () => {
    // Bear in p1's graveyard; the engine's moveCardToZone(battlefield)
    // should stamp `isTapped: true` because the script's
    // `entersTapped` flag is set.
    const bear = makeCard("Diregraf Ghoul", "Creature — Zombie", [2, 2]);
    const s = placeInGraveyard(state, bear, p1, "bear-1" as CardInstanceId);
    const r = moveCardToZone(s, "bear-1" as CardInstanceId, "battlefield");
    expect(r.success).toBe(true);
    // The engine clears `currentZoneKey` after a zone move (readers
    // fall back to a zone scan), so we check the zone cardIds instead.
    expect(r.state.zones.get(`${p1}-battlefield`)!.cardIds).toContain(
      "bear-1",
    );
    expect(r.state.cards.get("bear-1" as CardInstanceId)!.isTapped).toBe(
      true,
    );
  });

  it("a card without entersTapped: lands on the battlefield untapped", () => {
    // Bear with no entersTapped flag — regression: default behavior.
    const bear = makeCard("Bear", "Creature — Bear", [2, 2]);
    const s = placeInGraveyard(state, bear, p1, "bear-2" as CardInstanceId);
    const r = moveCardToZone(s, "bear-2" as CardInstanceId, "battlefield");
    expect(r.success).toBe(true);
    expect(r.state.cards.get("bear-2" as CardInstanceId)!.isTapped).toBe(
      false,
    );
  });
});