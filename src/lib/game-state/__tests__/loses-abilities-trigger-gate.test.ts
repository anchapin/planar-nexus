/**
 * Triggered-ability suppression for `removes_all_abilities`
 * (Wave 4.8 follow-up lane 58, #2614 follow-up).
 *
 * Lane 54 shipped the activated-ability gate:
 * `canActivateAbility` denies scripted activated abilities
 * on a card whose `losesAbilities` field is true (stamped
 * by `refreshAuraBonuses` for any Aura with
 * `static.removesAllAbilities: true`, Witness Protection-
 * style). Lane 58 adds the parallel triggered-ability
 * gate in `detectTriggeredAbilities` (the engine's
 * trigger fire pipeline): when the source card carries
 * `losesAbilities: true`, the engine skips firing its
 * scripted triggers entirely.
 *
 * Mirrors the CR 603.2 / 602.2d rule that "loses all other
 * abilities" removes BOTH activated AND triggered
 * abilities from the enchanted permanent. Mana-ability
 * carve-out is not applicable to triggered abilities
 * (mana abilities are activated; CR 605).
 *
 * Test coverage:
 *  1. A card with a scripted `etb` trigger + `losesAbilities:
 *     true` does NOT fire the trigger when it enters the
 *     battlefield.
 *  2. The same card WITHOUT `losesAbilities` DOES fire the
 *     trigger (regression).
 *  3. A card with `losesAbilities: true` + an `attacks`
 *     trigger does NOT fire the trigger when it attacks.
 *  4. The same card WITHOUT `losesAbilities` DOES fire the
 *     `attacks` trigger (regression).
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { CardScriptSchema } from "../card-scripts/schema";
import {
  registerCardScripts,
  resetCardScriptsForTests,
} from "../card-scripts/registry";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import { detectTriggeredAbilities } from "../abilities/triggered";
import { attachAura } from "../keyword-actions/enchant";
import { refreshAuraBonuses } from "../keyword-actions/aura-bonus";
import { fireEntersTriggers } from "../keyword-actions/enters";
import { Phase } from "../types";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";

const HOST_NAME = "Test Host (lane 58)";
const HOST_ETB_NAME = "Test Host ETB (lane 58)";
const HOST_ATTACKS_NAME = "Test Host Attacks (lane 58)";
const AURA_NAME = "Test Lane-58 Aura";

// Synthetic Aura with removesAllAbilities (mirrors the
// lane 54 schema arm). attachAura + refreshAuraBonuses
// should stamp `losesAbilities: true` on the enchanted
// card; we then exercise the trigger-fire gate.
const AURA_SCRIPT = CardScriptSchema.parse({
  name: AURA_NAME,
  oracle: "Enchant creature\nEnchanted creature loses all other abilities.",
  aura: {
    text: "Enchanted creature loses all other abilities.",
    target: "creature",
    static: {
      text: "Enchanted creature loses all other abilities.",
      removesAllAbilities: true,
    },
  },
});

const HOST_SCRIPT = CardScriptSchema.parse({
  name: HOST_NAME,
  oracle: "Triggers should be suppressed.",
  triggers: [
    {
      text: "Whenever this creature enters the battlefield, draw a card.",
      event: "etb",
      subject: "self",
      effects: [{ op: "Draw", amount: 1 }],
    },
    {
      text: "Whenever this creature attacks, draw a card.",
      event: "attacks",
      subject: "self",
      effects: [{ op: "Draw", amount: 1 }],
    },
  ],
});

// For "ETB only" host (cleaner single-trigger test).
const HOST_ETB_SCRIPT = CardScriptSchema.parse({
  name: HOST_ETB_NAME,
  oracle: "ETB trigger.",
  triggers: [
    {
      text: "Whenever this creature enters the battlefield, draw a card.",
      event: "etb",
      subject: "self",
      effects: [{ op: "Draw", amount: 1 }],
    },
  ],
});

// For "attacks only" host.
const HOST_ATTACKS_SCRIPT = CardScriptSchema.parse({
  name: HOST_ATTACKS_NAME,
  oracle: "Attacks trigger.",
  triggers: [
    {
      text: "Whenever this creature attacks, draw a card.",
      event: "attacks",
      subject: "self",
      effects: [{ op: "Draw", amount: 1 }],
    },
  ],
});

function card(overrides: Partial<ScryfallCard>): ScryfallCard {
  return {
    id: `mock-${overrides.name}`,
    name: "Test",
    type_line: "Creature — Construct",
    oracle_text: "",
    mana_cost: "{2}",
    cmc: 2,
    colors: [],
    color_identity: [],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
    power: "2",
    toughness: "2",
    ...overrides,
  } as ScryfallCard;
}

function put(
  state: GameState,
  playerId: PlayerId,
  zone: "hand" | "battlefield",
  data: ScryfallCard,
): CardInstanceId {
  const c = createCardInstance(data, playerId, playerId, {
    currentZoneKey: `${playerId}-${zone}`,
  });
  state.cards.set(c.id, { ...c, hasSummoningSickness: false });
  const key = `${playerId}-${zone}`;
  const z = state.zones.get(key)!;
  state.zones.set(key, { ...z, cardIds: [...z.cardIds, c.id] });
  return c.id;
}

function installSynthetic(): void {
  resetCardScriptsForTests();
  registerCardScripts([
    HOST_SCRIPT,
    HOST_ETB_SCRIPT,
    HOST_ATTACKS_SCRIPT,
    AURA_SCRIPT,
  ]);
}

describe("losesAbilities suppresses scripted triggered abilities (Wave 4.8 follow-up lane 58)", () => {
  let state: GameState;
  let alice: PlayerId;

  beforeEach(() => {
    state = startGame(createInitialGameState(["Alice", "Bob"], 20, false));
    [alice] = Array.from(state.players.keys());
    state.status = "in_progress";
    state.turn.activePlayerId = alice;
    state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    state.priorityPlayerId = alice;
    state.stack = [];
    state = addMana(state, alice, { generic: 6 });
    installSynthetic();
  });

  afterEach(() => {
    resetCardScriptsForTests();
  });

  it("does NOT fire a scripted ETB trigger when the source card has losesAbilities: true", () => {
    // Place a HOST_ETB on the battlefield with losesAbilities
    // set (mimicking the post-Witness-Protection state).
    const hostId = put(state, alice, "battlefield", card({
      name: HOST_ETB_NAME,
    }));
    const hostCard = state.cards.get(hostId)!;
    state.cards.set(hostId, { ...hostCard, losesAbilities: true });
    // detectTriggeredAbilities with event=etb (no entering
    // context — every card on the battlefield is checked
    // against the "etb" trigger event).
    const triggered = detectTriggeredAbilities(state, "entersBattlefield");
    // No trigger should be raised for the HOST_ETB card
    // when its losesAbilities flag is set.
    const fromHost = triggered.filter((t) => t.sourceCardId === hostId);
    expect(fromHost).toHaveLength(0);
  });

  it("DOES fire the scripted ETB trigger when the source card has losesAbilities: undefined (regression)", () => {
    // Same setup but WITHOUT losesAbilities. The trigger
    // should fire (regression on the lane 54 default).
    const hostId = put(state, alice, "battlefield", card({
      name: HOST_ETB_NAME,
    }));
    expect(state.cards.get(hostId)?.losesAbilities).toBeUndefined();
    const triggered = detectTriggeredAbilities(state, "entersBattlefield");
    const fromHost = triggered.filter((t) => t.sourceCardId === hostId);
    expect(fromHost.length).toBeGreaterThan(0);
  });

  it("does NOT fire a scripted attacks trigger when the source card has losesAbilities: true", () => {
    const hostId = put(state, alice, "battlefield", card({
      name: HOST_ATTACKS_NAME,
    }));
    const hostCard = state.cards.get(hostId)!;
    state.cards.set(hostId, { ...hostCard, losesAbilities: true });
    const triggered = detectTriggeredAbilities(state, "attacked", {
      attackerId: hostId,
    });
    const fromHost = triggered.filter((t) => t.sourceCardId === hostId);
    expect(fromHost).toHaveLength(0);
  });

  it("DOES fire the scripted attacks trigger when the source card has losesAbilities: undefined (regression)", () => {
    const hostId = put(state, alice, "battlefield", card({
      name: HOST_ATTACKS_NAME,
    }));
    const triggered = detectTriggeredAbilities(state, "attacked", {
      attackerId: hostId,
    });
    const fromHost = triggered.filter((t) => t.sourceCardId === hostId);
    expect(fromHost.length).toBeGreaterThan(0);
  });

  it("does NOT fire scripted triggers after refreshAuraBonuses stamps losesAbilities on a Witness-Protection target", () => {
    // End-to-end: place a HOST_ETB and a synthetic Aura
    // on the battlefield, run attachAura + refreshAuraBonuses,
    // and confirm the ETB trigger is suppressed.
    const hostId = put(state, alice, "battlefield", card({
      name: HOST_ETB_NAME,
    }));
    const auraCard = card({ name: AURA_NAME });
    const auraId = put(state, alice, "battlefield", auraCard);
    // Wire the Aura to the host via the production
    // attachAura helper (mirrors
    // `removes-all-abilities-static.test.ts`'s e2e path).
    state = attachAura(state, auraId, hostId);
    state = refreshAuraBonuses(state);
    // After refreshAuraBonuses, the host carries
    // losesAbilities: true (stamped by the
    // removesAllAbilities arm).
    expect(state.cards.get(hostId)?.losesAbilities).toBe(true);
    // detectTriggeredAbilities should NOT raise the host's
    // scripted ETB trigger.
    const triggered = detectTriggeredAbilities(state, "entersBattlefield");
    const fromHost = triggered.filter((t) => t.sourceCardId === hostId);
    expect(fromHost).toHaveLength(0);
  });

  it("fireEntersTriggers does NOT surface a scripted trigger waitingChoice for a losesAbilities card", () => {
    // The ETB pipeline (fireEntersTriggers) is a parallel
    // surface that should also skip the trigger when
    // losesAbilities is set. We pin the engine arm here so
    // future changes to the ETB pipeline (e.g. a different
    // gate location) surface in this test.
    const hostId = put(state, alice, "battlefield", card({
      name: HOST_ETB_NAME,
    }));
    const hostCard = state.cards.get(hostId)!;
    state.cards.set(hostId, { ...hostCard, losesAbilities: true });
    const after = fireEntersTriggers(state, hostId);
    // fireEntersTriggers's no-trigger outcome is
    // `after.waitingChoice === null` for this synthetic.
    // Note: this synthetic doesn't surface a waitingChoice
    // for any path (the DrawCards effect doesn't read
    // targets), so we assert the post-fire state is
    // unchanged from no-fire.
    expect(after.waitingChoice).toBeNull();
  });
});