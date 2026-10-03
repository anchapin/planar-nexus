/**
 * planar-nexus side of the differential rules harness (#2411).
 *
 * Loads an engine-neutral {@link Scenario} into the planar-nexus engine, plays
 * its actions, and returns a normalised {@link ScenarioOutcome}. Card data is
 * passed in by the caller so this module never touches the network.
 */
import {
  createInitialGameState,
  startGame,
  passPriority,
} from "../../src/lib/game-state/game-state";
// The full SBA pass (refreshes threshold, domain, anthems), the same one the
// `@/lib/game-state` barrel exports. game-state.ts has a narrower one.
import { checkStateBasedActions } from "../../src/lib/game-state/state-based-actions";
import { createCardInstance } from "../../src/lib/game-state/card-instance";
import {
  castSpell,
  resolveTopOfStack,
} from "../../src/lib/game-state/spell-casting";
import { playLand, addMana } from "../../src/lib/game-state/mana";
import { declareAttackers } from "../../src/lib/game-state/combat/declaration";
import { resolveCombatDamage } from "../../src/lib/game-state/combat/resolution";
import {
  getEffectivePower,
  getEffectiveToughness,
  layerSystem,
} from "../../src/lib/game-state/layer-system";
import {
  getEffectivePower as getModifiedPower,
  getEffectiveToughness as getModifiedToughness,
} from "../../src/lib/game-state/evergreen-keywords";
import { Phase } from "../../src/lib/game-state/types";
import type {
  GameState,
  PlayerId,
  CardInstance,
  CardInstanceId,
  ScryfallCard,
  Target,
} from "../../src/lib/game-state/types";
import {
  ALL_FIELDS,
  type ObservedField,
  type ObservedPermanent,
  type ObservedPlayer,
  type Scenario,
  type ScenarioAction,
  type ScenarioOutcome,
  type ScenarioPhase,
  type ScenarioTarget,
  type ScenarioZoneCard,
} from "./scenario";

export const ENGINE_NAME = "planar-nexus";

/** Card data keyed by exact English card name. */
export type CardLookup = Record<string, ScryfallCard>;

const PHASES: Record<ScenarioPhase, Phase> = {
  upkeep: Phase.UPKEEP,
  draw: Phase.DRAW,
  precombat_main: Phase.PRECOMBAT_MAIN,
  begin_combat: Phase.BEGIN_COMBAT,
  declare_attackers: Phase.DECLARE_ATTACKERS,
  postcombat_main: Phase.POSTCOMBAT_MAIN,
  end: Phase.END,
};

const MANA_KEYS = {
  W: "white",
  U: "blue",
  B: "black",
  R: "red",
  G: "green",
  C: "colorless",
} as const;

/** Upper bound on stack resolutions and priority passes per action. */
const STEP_LIMIT = 60;

class UnsupportedScenario extends Error {}

interface Ctx {
  state: GameState;
  playerIds: PlayerId[];
  /** Scenario labels to card instance ids. */
  labels: Map<string, CardInstanceId>;
  cards: CardLookup;
  errors: string[];
}

function cardData(ctx: Ctx, name: string): ScryfallCard {
  const data = ctx.cards[name];
  if (!data) throw new UnsupportedScenario(`no card data for "${name}"`);
  return data;
}

function placeCard(
  ctx: Ctx,
  playerId: PlayerId,
  zone: string,
  entry: ScenarioZoneCard,
): CardInstance {
  const name = typeof entry === "string" ? entry : entry.card;
  const card = createCardInstance(cardData(ctx, name), playerId, playerId);
  const key = `${playerId}-${zone}`;
  card.currentZoneKey = key;
  ctx.state.cards.set(card.id, card);
  const z = ctx.state.zones.get(key);
  if (!z) throw new UnsupportedScenario(`no zone ${key}`);
  ctx.state.zones.set(key, { ...z, cardIds: [...z.cardIds, card.id] });
  if (typeof entry !== "string" && entry.id) ctx.labels.set(entry.id, card.id);
  return card;
}

function setup(scenario: Scenario, cards: CardLookup): Ctx {
  let state = createInitialGameState(["P0", "P1"], 20, false);
  state = startGame(state);
  const playerIds = Array.from(state.players.keys());
  const ctx: Ctx = { state, playerIds, labels: new Map(), cards, errors: [] };

  // startGame may have drawn opening hands; scenarios specify zones exactly.
  for (const pid of playerIds) {
    for (const zone of [
      "hand",
      "library",
      "graveyard",
      "battlefield",
      "exile",
    ]) {
      const key = `${pid}-${zone}`;
      const z = state.zones.get(key);
      if (!z) continue;
      z.cardIds.forEach((id) => state.cards.delete(id));
      state.zones.set(key, { ...z, cardIds: [] });
    }
  }

  scenario.players.forEach((p, i) => {
    const pid = playerIds[i];
    const player = ctx.state.players.get(pid)!;
    ctx.state.players.set(pid, {
      ...player,
      life: p.life ?? 20,
      hasPassedPriority: false,
    });
    for (const b of p.battlefield ?? []) {
      const card = placeCard(ctx, pid, "battlefield", {
        card: b.card,
        id: b.id,
      });
      card.isTapped = b.tapped ?? false;
      card.hasSummoningSickness = b.summoningSick ?? false;
      card.counters = Object.entries(b.counters ?? {}).map(([type, count]) => ({
        type,
        count,
      }));
    }
    (p.hand ?? []).forEach((c) => placeCard(ctx, pid, "hand", c));
    (p.graveyard ?? []).forEach((c) => placeCard(ctx, pid, "graveyard", c));
    const lib =
      typeof p.library === "number"
        ? Array.from({ length: p.library }, () => "Forest")
        : (p.library ?? []);
    lib.forEach((c) => placeCard(ctx, pid, "library", c));
    if (p.manaPool) {
      const pool: Record<string, number> = {};
      for (const [k, v] of Object.entries(p.manaPool)) {
        pool[MANA_KEYS[k as keyof typeof MANA_KEYS]] = v ?? 0;
      }
      ctx.state = addMana(ctx.state, pid, pool);
    }
  });

  const active = playerIds[scenario.activePlayer ?? 0];
  ctx.state.status = "in_progress";
  ctx.state.turn.activePlayerId = active;
  ctx.state.priorityPlayerId = active;
  ctx.state.turn.currentPhase = PHASES[scenario.phase ?? "precombat_main"];
  ctx.state.stack = [];
  ctx.state.consecutivePasses = 0;
  return ctx;
}

/** Resolve a label or card name to an instance id, searching the given zones. */
function findCard(
  ctx: Ctx,
  ref: string,
  zones: string[],
  playerId?: PlayerId,
): CardInstanceId {
  const labelled = ctx.labels.get(ref);
  if (labelled && ctx.state.cards.has(labelled)) return labelled;
  const owners = playerId ? [playerId] : ctx.playerIds;
  for (const pid of owners) {
    for (const zone of zones) {
      const z = ctx.state.zones.get(`${pid}-${zone}`);
      const hit = z?.cardIds.find(
        (id) => ctx.state.cards.get(id)?.cardData.name === ref,
      );
      if (hit) return hit;
    }
  }
  throw new UnsupportedScenario(
    `card "${ref}" not found in ${zones.join("/")}`,
  );
}

function toTarget(ctx: Ctx, t: ScenarioTarget): Target {
  if ("player" in t) {
    return { type: "player", targetId: ctx.playerIds[t.player], isValid: true };
  }
  return {
    type: "card",
    targetId: findCard(ctx, t.card, ["battlefield"]),
    isValid: true,
  };
}

function resolveAll(ctx: Ctx): void {
  for (let i = 0; i < STEP_LIMIT && ctx.state.stack.length > 0; i++) {
    ctx.state = resolveTopOfStack(ctx.state);
  }
  if (ctx.state.stack.length > 0) ctx.errors.push("stack did not empty");
}

function advanceTo(ctx: Ctx, phase: ScenarioPhase): void {
  const goal = PHASES[phase];
  for (let i = 0; i < STEP_LIMIT; i++) {
    if (ctx.state.turn.currentPhase === goal && ctx.state.stack.length === 0) {
      return;
    }
    if (ctx.state.stack.length > 0) {
      resolveAll(ctx);
      continue;
    }
    const before = ctx.state.turn.currentPhase;
    const holder = ctx.state.priorityPlayerId ?? ctx.state.turn.activePlayerId;
    ctx.state = passPriority(ctx.state, holder);
    if (
      ctx.state.turn.currentPhase === before &&
      ctx.state.stack.length === 0
    ) {
      const other = ctx.playerIds.find((p) => p !== holder)!;
      ctx.state = passPriority(ctx.state, other);
    }
    // Priority passing does not deal combat damage; the game board calls
    // resolveCombatDamage on entering the step (#1914). Repeat calls no-op.
    if (ctx.state.turn.currentPhase === Phase.COMBAT_DAMAGE) {
      const r = resolveCombatDamage(ctx.state);
      if (r.success) ctx.state = checkStateBasedActions(r.state).state;
    }
  }
  ctx.errors.push(
    `advanceTo ${phase}: stopped at ${ctx.state.turn.currentPhase}`,
  );
}

function runAction(ctx: Ctx, action: ScenarioAction): void {
  switch (action.do) {
    case "cast": {
      const pid = ctx.playerIds[action.player];
      const cardId = findCard(ctx, action.card, ["hand"], pid);
      const targets = (action.targets ?? []).map((t) => toTarget(ctx, t));
      const r = castSpell(
        ctx.state,
        pid,
        cardId,
        targets,
        [],
        action.x ?? 0,
        action.kicked ?? false,
      );
      if (!r.success) ctx.errors.push(`cast ${action.card}: ${r.error}`);
      ctx.state = r.state;
      return;
    }
    case "playLand": {
      const pid = ctx.playerIds[action.player];
      const cardId = findCard(ctx, action.card, ["hand"], pid);
      const r = playLand(ctx.state, pid, cardId);
      if (!r.success) ctx.errors.push(`playLand ${action.card}: ${r.error}`);
      ctx.state = r.state;
      return;
    }
    case "resolveStack":
      resolveAll(ctx);
      return;
    case "attack": {
      const pid = ctx.playerIds[action.player];
      if (ctx.state.turn.currentPhase !== Phase.DECLARE_ATTACKERS) {
        advanceTo(ctx, "declare_attackers");
      }
      const defender = ctx.playerIds[action.defender ?? 1 - action.player];
      const r = declareAttackers(
        ctx.state,
        action.attackers.map((a) => ({
          cardId: findCard(ctx, a, ["battlefield"], pid),
          defenderId: defender,
        })),
      );
      if (!r.success) ctx.errors.push(`attack: ${(r.errors ?? []).join("; ")}`);
      ctx.state = r.state;
      return;
    }
    case "advanceTo":
      advanceTo(ctx, action.phase);
      return;
  }
}

function zoneNames(ctx: Ctx, pid: PlayerId, zone: string): string[] {
  const z = ctx.state.zones.get(`${pid}-${zone}`);
  return (z?.cardIds ?? [])
    .map((id) => ctx.state.cards.get(id)?.cardData.name ?? "?")
    .sort();
}

function observePermanent(ctx: Ctx, card: CardInstance): ObservedPermanent {
  const out: ObservedPermanent = {
    name: card.cardData.name,
    tapped: card.isTapped,
  };
  if (card.cardData.type_line?.includes("Creature")) {
    // Same read combat damage uses (combat/resolution.ts).
    out.power = getEffectivePower(card, layerSystem);
    out.toughness = getEffectiveToughness(card, layerSystem);
    // The engine has a second P/T read (evergreen-keywords.ts) that folds in
    // threshold, anthem and until-end-of-turn bonuses. Flag disagreement so
    // it shows up as an engine finding rather than being hidden.
    const p = getModifiedPower(card);
    const t = getModifiedToughness(card);
    if (p !== out.power || t !== out.toughness) {
      ctx.errors.push(
        `engine P/T reads disagree for ${card.cardData.name}: combat ${out.power}/${out.toughness}, modified ${p}/${t}`,
      );
    }
  }
  const counters = card.counters.filter((c) => c.count > 0);
  if (counters.length > 0) {
    out.counters = Object.fromEntries(
      counters
        .map((c) => [c.type === "p1p1" ? "+1/+1" : c.type, c.count] as const)
        .sort(([a], [b]) => a.localeCompare(b)),
    );
  }
  if (card.isToken) out.token = true;
  return out;
}

function observe(ctx: Ctx, fields: ObservedField[]): ObservedPlayer[] {
  const want = new Set(fields);
  return ctx.playerIds.map((pid) => {
    const p = ctx.state.players.get(pid)!;
    const o: ObservedPlayer = {};
    if (want.has("life")) o.life = p.life;
    if (want.has("battlefield")) {
      const z = ctx.state.zones.get(`${pid}-battlefield`);
      o.battlefield = (z?.cardIds ?? [])
        .map((id) => ctx.state.cards.get(id))
        .filter((c): c is CardInstance => !!c)
        .map((c) => observePermanent(ctx, c))
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    }
    if (want.has("hand")) o.hand = zoneNames(ctx, pid, "hand");
    if (want.has("graveyard")) o.graveyard = zoneNames(ctx, pid, "graveyard");
    if (want.has("exile")) o.exile = zoneNames(ctx, pid, "exile");
    if (want.has("library")) {
      o.library = ctx.state.zones.get(`${pid}-library`)?.cardIds.length ?? 0;
    }
    return o;
  });
}

/** Run one scenario in the planar-nexus engine. Never throws. */
export function runScenario(
  scenario: Scenario,
  cards: CardLookup,
): ScenarioOutcome {
  const fields = scenario.observe ?? ALL_FIELDS;
  const base = { scenario: scenario.id, engine: ENGINE_NAME };
  try {
    const ctx = setup(scenario, cards);
    // The game loop checks state-based actions (and refreshes statics such
    // as threshold) after every action; do the same here (CR 704.3).
    ctx.state = checkStateBasedActions(ctx.state).state;
    for (const action of scenario.actions) {
      runAction(ctx, action);
      ctx.state = checkStateBasedActions(ctx.state).state;
    }
    return {
      ...base,
      status: "ok",
      players: observe(ctx, fields),
      ...(fields.includes("stack")
        ? {
            stack: ctx.state.stack
              .map(
                (s) =>
                  (s.sourceCardId
                    ? ctx.state.cards.get(s.sourceCardId)?.cardData.name
                    : undefined) ?? s.name,
              )
              .sort(),
          }
        : {}),
      errors: ctx.errors,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ...base,
      status: e instanceof UnsupportedScenario ? "unsupported" : "error",
      players: [],
      errors: [message],
    };
  }
}
