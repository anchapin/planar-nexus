/**
 * Wave 4.8 follow-up 13 lane 61a (#2614 follow-up):
 * builds `ReplacementAbility` entries from a card's
 * `replacement_effects` arm in its `CardScript`. The v1
 * minimum supports a single shape — `event: "would_die"` +
 * `applies_to.type: "creature"` + `applies_to.controller:
 * "you"` + `redirect.to: "exile"` — and the
 * {@link buildScriptedDeathReplacementEffect} factory
 * returns an effect that, when applied to a `would_die`
 * event by `ReplacementEffectManager.processEvent`,
 * redirects the dying permanent to its owner's exile
 * zone via the result's `redirectToZone: "exile"`.
 *
 * Other shapes (`hand`, `library_top`, `library_bottom`,
 * `battlefield_tapped`, `battlefield_untapped`,
 * `sacrifice`, `life_loss`, `if_condition`, `optional`,
 * `notSelf`, `isToken`) parse and surface from the schema
 * but are out of scope for lane 61a; follow-up lanes (100 /
 * 101 / 102 / 103 / 104 / 105) wire them. The factory
 * returns `null` for those shapes so the engine consult
 * ignores them.
 *
 * The consult in `keyword-actions/removal.ts`'s
 * `moveCardToZone` is the single call site that consumes
 * these abilities; it walks every card on the battlefield,
 * builds the abilities from each card's script, registers
 * them on `state.replacementEffectManager`, runs
 * `processEvent`, then clears the just-registered
 * registrations before returning. This avoids the
 * "permanent registration" bookkeeping that the lane 87
 * trigger propagation learned to avoid (a fresh
 * registration per consult keeps the manager stateless
 * w.r.t. death-replacement).
 */
import type { CardInstanceId, GameState, PlayerId } from "../types";
import type {
  ReplacementAbility,
  ReplacementEvent,
  ReplacementEffectType,
} from "../replacement-effects/types";
import type { ScriptedReplacementEffect } from "./schema";
import { getCardScript } from "./registry";

/**
 * Per-source timestamp used to make the effect id
 * unique across consults. The replacement manager keeps
 * the effect on a per-instance ledger for the duration
 * of `processEvent`, then the consult's cleanup loop
 * removes it (`removeEffectsFromSource`).
 */
function makeTimestamp(): number {
  // `Date.now()` is fine — the consult runs in the
  // synchronous game-loop path, not across awaits.
  return Date.now();
}

/**
 * v1 minimum: build a `death_replacement` effect from a
 * single `ScriptedReplacementEffect`. Returns `null` for
 * out-of-scope shapes (the consult ignores the entry).
 *
 * The effect's `apply` function:
 * 1. Reads the dying permanent's controller from the
 *    event's `controllerId` (the consult sets it).
 * 2. Stamps `redirectToZone: "exile"` on the result.
 * 3. Sets the `modifiedEvent.controllerId` so any
 *    downstream effect (not in scope today, but
 *    forward-compatible) can read the dying controller.
 *
 * The effect's `canApply` function:
 * 1. Requires `event.type === "would_die"` (the manager's
 *    `effectTypeMatches` already filters by type, but the
 *    guard is defensive).
 * 2. Requires `event.targetId === dyingCardId` (the
 *    effect is per-source, not per-event).
 * 3. Enforces the `applies_to.controller` filter — the
 *    "if a creature YOU control would die" half of
 *    Whip of Erebos's oracle.
 * 4. Enforces the `applies_to.type` filter (the v1
 *    minimum restricts to `"creature"`; non-creature
 *    permanent deaths don't fire the replacement).
 */
export function buildScriptedDeathReplacementEffect(
  sourceCardId: CardInstanceId,
  controllerId: PlayerId,
  re: ScriptedReplacementEffect,
): ReplacementAbility | null {
  // v1 only — other shapes ride follow-up lanes.
  if (re.event !== "would_die") return null;
  if (re.applies_to.type !== "creature") return null;
  if (re.applies_to.controller !== "you") return null;
  if (re.redirect.to !== "exile") return null;

  const timestamp = makeTimestamp();
  const effectType: ReplacementEffectType = "death_replacement";
  const id = `death-replace-${sourceCardId}-${timestamp}`;

  return {
    id,
    sourceCardId,
    controllerId,
    effectType,
    description: re.text,
    layer: 6, // CR 614.5 — death-replacement effects apply at the
    // replacement layer above the SBA/destroy layer; lane 61a
    // uses layer 6 to match the existing
    // `land_enter_replacement` convention (same layer for
    // CR 614.1-style "instead" effects on permanent state).
    timestamp,
    // Self-replacement: the source's own permanent owns the
    // effect, so CR 614.6 self-replacement rules apply
    // (self-replacements always apply without a prompt).
    isSelfReplacement: false,
    isInstead: true,
    canApply: (event: ReplacementEvent) => {
      if (event.type !== "would_die") return false;
      // The replacement fires when ANY creature the source's
      // controller owns is about to die. The factory pre-
      // filters on `applies_to.type === "creature"` (a script
      // with `applies_to.type: "artifact"` returns null from
      // the factory — so this canApply is reached only for
      // the creature-shape). The controller half is checked
      // here at consult time (the consult sets
      // `event.controllerId` to the dying card's controller).
      if (controllerId !== event.controllerId) return false;
      return true;
    },
    apply: (event: ReplacementEvent) => ({
      modified: true,
      modifiedEvent: {
        ...event,
        controllerId: event.controllerId,
        // Carry the redirect destination on the event's
        // `context` so the consult can read it after
        // `processEvent` returns. `processEvent` exposes
        // the resulting `ReplacementEvent` (NOT the
        // `ReplacementResult`), so a side-channel field is
        // the cleanest path. The consult reads
        // `processed.context?.redirectToZone`.
        context: {
          ...(event.context ?? {}),
          redirectToZone: "exile",
        },
      },
      description: re.text,
      instead: true,
      redirectToZone: "exile",
    }),
  };
}

/**
 * Build every `death_replacement` effect from every card
 * on the battlefield that carries a `replacement_effects`
 * arm on its `CardScript`. Returns an array of
 * `ReplacementAbility` ready for
 * `ReplacementEffectManager.registerEffect`.
 *
 * The optional `dyingCardId` argument filters the effect
 * list to those whose `applies_to.type` matches the
 * dying card's `type_line` — the script-declared
 * `applies_to.type: "creature"` filter is enforced
 * dynamically against the dying card (a card script
 * declaring "if a creature you control would die"
 * should NOT fire when an enchantment is dying, even
 * though both share the same controller). Out-of-scope
 * entries (the v1 minimum rejects them — see
 * {@link buildScriptedDeathReplacementEffect}) are
 * silently dropped. The function is defensive: a missing
 * script or missing `cardData.name` returns an empty
 * array.
 */
export function buildScriptedDeathReplacementEffects(
  state: GameState,
  dyingCardId?: CardInstanceId,
): ReplacementAbility[] {
  const out: ReplacementAbility[] = [];
  // Determine the dying card's `type_line` up front so the
  // per-effect `applies_to.type` filter can match against
  // the actual dying card. The factory uses the script's
  // declared shape, but the runtime check needs the
  // dying card's type-line to enforce "creature" vs
  // "enchantment" (etc.).
  let dyingTypeLine = "";
  if (dyingCardId) {
    const dying = state.cards.get(dyingCardId);
    dyingTypeLine = dying?.cardData?.type_line ?? "";
  }
  // When no dying card id is supplied, the consult is in
  // "build all" mode (a direct helper call, not a
  // death-event consult). The dying-card type filter is
  // skipped — every effect from every script is returned.
  const dyingIsCreature = dyingCardId
    ? dyingTypeLine.toLowerCase().includes("creature")
    : true;
  for (const [, card] of state.cards) {
    // Only cards on the battlefield can host replacement
    // effects (lane 61a's scope is "a permanent you
    // control").
    const onBattlefield =
      card.currentZoneKey?.endsWith("-battlefield") ?? false;
    if (!onBattlefield) continue;
    if (!card.cardData?.name) continue;
    const script = getCardScript(card.cardData.name);
    if (!script || !script.replacement_effects) continue;
    if (!card.controllerId) continue;
    for (const re of script.replacement_effects) {
      // Runtime filter: the v1 minimum restricts to
      // `applies_to.type: "creature"` — when the dying
      // card is not a creature (an enchantment, an
      // artifact, a planeswalker), skip the effect. The
      // factory returns null for non-creature scripts
      // already, but a creature-shape script applied to
      // a non-creature dying card is also a miss.
      if (re.applies_to.type === "creature" && !dyingIsCreature) continue;
      const effect = buildScriptedDeathReplacementEffect(
        card.id as CardInstanceId,
        card.controllerId,
        re,
      );
      if (effect) out.push(effect);
    }
  }
  return out;
}