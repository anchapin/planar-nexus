/**
 * anchapin/manamind#86: one seat's player-visible view of a game, in the
 * shape the Forge bridge sends to manamind's ForgePointerNet
 * (`card_features` / `global_features` in
 * manamind/src/manamind/models/forge_pointer.py). A network trained on Forge
 * decisions can read a Planar Nexus state through this view.
 *
 * Hidden information stays hidden: the opponent's hand is a count, both
 * libraries are sizes, and the opponent's face-down permanents show no name,
 * cost, or printed stats.
 */
import {
  getEffectivePower,
  getEffectiveToughness,
  layerSystem,
  Phase,
  type CardInstance,
  type GameState,
  type PlayerId,
} from "@/lib/game-state";

/** One card as the Forge bridge describes it. */
export interface ViewCard {
  name: string;
  type: string;
  cost: string;
  cmc: number;
  creature: boolean;
  land: boolean;
  power: number;
  toughness: number;
  tapped: boolean;
  sick: boolean;
}

/** One seat's view of the game, Forge-bridge shape. */
export interface PlayerView {
  turn: number;
  phase: string;
  active: boolean;
  /** `[mine, opponent's]` */
  life: [number, number];
  hand: ViewCard[];
  opp_hand_size: number;
  battlefield: ViewCard[];
  opp_battlefield: ViewCard[];
  graveyard: string[];
  opp_graveyard: string[];
  /** Library sizes, `[mine, opponent's]` */
  library: [number, number];
}

/** Planar Nexus phase -> Forge `PhaseType` name (manamind `PHASES`). */
export const FORGE_PHASE: Record<Phase, string> = {
  [Phase.UNTAP]: "UNTAP",
  [Phase.UPKEEP]: "UPKEEP",
  [Phase.DRAW]: "DRAW",
  [Phase.PRECOMBAT_MAIN]: "MAIN1",
  [Phase.BEGIN_COMBAT]: "COMBAT_BEGIN",
  [Phase.DECLARE_ATTACKERS]: "COMBAT_DECLARE_ATTACKERS",
  [Phase.DECLARE_BLOCKERS]: "COMBAT_DECLARE_BLOCKERS",
  [Phase.COMBAT_DAMAGE_FIRST_STRIKE]: "COMBAT_FIRST_STRIKE_DAMAGE",
  [Phase.COMBAT_DAMAGE]: "COMBAT_DAMAGE",
  [Phase.END_COMBAT]: "COMBAT_END",
  [Phase.POSTCOMBAT_MAIN]: "MAIN2",
  [Phase.END]: "END_OF_TURN",
  [Phase.CLEANUP]: "CLEANUP",
};

/** Printed stat ("3", "*", "1+*") as a number; non-numeric reads as 0. */
function printedStat(value: string | undefined): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) ? n : 0;
}

/** A face-down permanent the viewer may not look at (CR 708.2). */
const HIDDEN_FACE_DOWN: Omit<ViewCard, "tapped" | "sick"> = {
  name: "Face-down card",
  type: "Creature",
  cost: "no cost",
  cmc: 0,
  creature: true,
  land: false,
  power: 2,
  toughness: 2,
};

function viewCard(
  card: CardInstance,
  onBattlefield: boolean,
  hidden: boolean,
): ViewCard {
  const tapped = onBattlefield && card.isTapped;
  if (hidden) {
    return {
      ...HIDDEN_FACE_DOWN,
      tapped,
      sick: onBattlefield && card.hasSummoningSickness,
    };
  }
  const data = card.cardData;
  const type = data.type_line ?? "";
  const creature = /\bcreature\b/i.test(type);
  const land = /\bland\b/i.test(type);
  const live = onBattlefield && creature;
  return {
    name: data.name,
    type,
    cost: data.mana_cost ? data.mana_cost : "no cost",
    cmc: data.cmc ?? 0,
    creature,
    land,
    power: live
      ? getEffectivePower(card, layerSystem)
      : printedStat(data.power),
    toughness: live
      ? getEffectiveToughness(card, layerSystem)
      : printedStat(data.toughness),
    tapped,
    sick: live && card.hasSummoningSickness,
  };
}

function zoneIds(state: GameState, playerId: PlayerId, zone: string) {
  return state.zones.get(`${playerId}-${zone}`)?.cardIds ?? [];
}

function zoneCards(state: GameState, playerId: PlayerId, zone: string) {
  return zoneIds(state, playerId, zone)
    .map((id) => state.cards.get(id))
    .filter((c): c is CardInstance => c !== undefined);
}

function battlefield(
  state: GameState,
  playerId: PlayerId,
  viewer: PlayerId,
): ViewCard[] {
  return zoneCards(state, playerId, "battlefield")
    .filter((c) => !c.isPhasedOut)
    .map((c) => viewCard(c, true, c.isFaceDown && c.controllerId !== viewer));
}

/**
 * `viewer`'s player-visible view of a two-player game, in the Forge-bridge
 * shape. Throws if `viewer` is not seated or has no opponent.
 */
export function playerView(state: GameState, viewer: PlayerId): PlayerView {
  const me = state.players.get(viewer);
  const opp = Array.from(state.players.values()).find((p) => p.id !== viewer);
  if (!me || !opp) {
    throw new Error(`playerView: ${viewer} is not in a two-player game`);
  }
  return {
    turn: state.turn.turnNumber,
    phase:
      FORGE_PHASE[state.turn.currentPhase] ?? String(state.turn.currentPhase),
    active: state.turn.activePlayerId === viewer,
    life: [me.life, opp.life],
    hand: zoneCards(state, viewer, "hand").map((c) =>
      viewCard(c, false, false),
    ),
    opp_hand_size: zoneIds(state, opp.id, "hand").length,
    battlefield: battlefield(state, viewer, viewer),
    opp_battlefield: battlefield(state, opp.id, viewer),
    graveyard: zoneCards(state, viewer, "graveyard").map(
      (c) => c.cardData.name,
    ),
    opp_graveyard: zoneCards(state, opp.id, "graveyard").map(
      (c) => c.cardData.name,
    ),
    library: [
      zoneIds(state, viewer, "library").length,
      zoneIds(state, opp.id, "library").length,
    ],
  };
}
