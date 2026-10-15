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
  DeathRedirectZone,
  ReplacementAbility,
  ReplacementEvent,
  ReplacementEffectType,
} from "../replacement-effects/types";
import { evaluateInterveningIfClause } from "../abilities/evaluate";
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
  state: GameState,
): ReplacementAbility | null {
  // v1 only — other shapes ride follow-up lanes.
  if (re.event !== "would_die") return null;
  if (re.applies_to.type !== "creature") return null;
  if (re.applies_to.controller !== "you") return null;
  // Wave 4.8 follow-up 13 lane 100 (#2614 follow-up):
  // added `redirect.to: "hand"` (Whip of Erebos's
  // deferred hand-redirect — "if [thing] would die,
  // instead return it to its owner's hand"). The
  // lane 61a engine surface accepts the redirect; the
  // factory now stamps `redirectToZone: "hand"` on
  // the result.
  //
  // Wave 4.8 follow-up 13 lane 101 (#2614 follow-up):
  // added `redirect.to: "sacrifice"` (False Dawn's
  // deferred sacrifice-redirect — "if [thing] would
  // die, instead sacrifice it"). The factory stamps
  // `redirectToZone: "sacrifice"` on the result; the
  // engine consult's `moveCardToZone` switch routes
  // the dying card through the `sacrificeCard` path
  // (the sacrifice keyword bumps
  // `state.turn.creatureDiedThisThisTurn` and
  // suppresses dies triggers — see
  // `keyword-actions/removal.ts`).
  //
  // Wave 4.8 follow-up 20 lane 61 sub-piece
  // (#2614 follow-up, follow-up 20 piece 1): added
  // `redirect.to: "library_top" | "library_bottom"`.
  // The "instead put [thing] on top/bottom of its
  // owner's library" family (e.g. Elspeth, Sun's
  // Champion-style "instead shuffle it into its
  // owner's library" — the per-position variants of
  // the deferral). The factory now stamps
  // `redirectToZone: "library_top" | "library_bottom"`
  // on the result; the engine consult's
  // `moveCardToZone` consult routes the dying
  // card through the new `moveCardToZoneWithPosition`
  // helper (which threads `position` through to
  // `moveCardBetweenZones` / `addCardToZone`). The
  // pre-existing `moveCardToZone` narrow-union API
  // stays untouched (every other call-site that
  // doesn't care about position keeps working).
  //
  // Out of scope: "any_zone" (lane 104 partial).
  if (
    re.redirect.to !== "exile" &&
    re.redirect.to !== "hand" &&
    re.redirect.to !== "sacrifice" &&
    re.redirect.to !== "library_top" &&
    re.redirect.to !== "library_bottom" &&
    re.redirect.to !== "battlefield_tapped" &&
    re.redirect.to !== "battlefield_untapped" &&
    re.redirect.to !== "life_loss"
  ) {
    return null;
  }

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
      // Wave 4.8 follow-up 13 lane 102 (#2614 follow-up):
      // `notSelf: true` excludes the source's own
      // instance from the replacement. The replacement
      // effect's source is the anthem (a creature); the
      // dying card is `event.targetId`. When they match,
      // the source is immune to its own replacement
      // (the anthem can't exile ITSELF when it dies).
      if (re.applies_to.notSelf === true && sourceCardId === event.targetId) {
        return false;
      }
      // Wave 4.8 follow-up 13 lane 105 (#2614 follow-up):
      // `isToken: true` filters the replacement to only
      // fire for dying TOKEN creatures (Hedron Crawler-
      // style "if a token you control would die,
      // instead exile it"). The consult's `canApply`
      // filter reads `state.cards[dyingCardId].isToken`;
      // when `isToken: true` is set on the replacement,
      // the filter returns false for non-token dying
      // cards. v1 supports `isToken: true` only — the
      // inverse ("if a nontoken creature would die")
      // rides a follow-up lane.
      if (re.applies_to.isToken === true) {
        const dyingCard = state.cards.get(event.targetId ?? "");
        if (!dyingCard?.isToken) {
          return false;
        }
      }
      // Wave 4.8 follow-up 13 lane 103 (#2614 follow-up):
      // `if_condition` — the replacement only fires
      // when the named condition holds (CR 603.4
      // intervening-if at replacement time). The
      // condition string is evaluated via
      // `evaluateInterveningIfClause` (parallel to the
      // lane 91 `while_condition` pattern but at
      // replacement time, not static-refresh time).
      // The condition reads the controller's
      // perspective (the consult path is the controller's
      // replacement — the drafter writes the
      // condition as the controller would read it).
      // v1 supports a single-shape pattern: any
      // condition string `evaluateInterveningIfClause`
      // recognizes. When `if_condition` is unset, the
      // replacement always fires (the field is
      // optional).
      if (
        re.if_condition !== undefined &&
        !evaluateInterveningIfClause(re.if_condition, state, controllerId)
      ) {
        return false;
      }
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
        //
        // Wave 4.8 follow-up 13 lane 100 (#2614 follow-up):
        // the redirect destination flows from the script's
        // `replacement_effects[].redirect.to` field. v1
        // supports `"exile"` (lane 61a) and `"hand"`
        // (lane 100); other destinations parse in the
        // schema but the factory returns null for them
        // (lanes 101 / 104 wire them).
        //
        // Wave 4.8 follow-up 20 lane 61 sub-piece
        // (#2614 follow-up, follow-up 20 piece 1):
        // `"library_top"` and `"library_bottom"`
        // are now in scope — the `moveCardToZone`
        // consult routes them through the new
        // `moveCardToZoneWithPosition` helper.
        //
        // Wave 4.8 follow-up 13 lane 104 (#2614 follow-up):
        // the `redirect.amount` flows on
        // `context.redirectToZoneAmount` (used by the
        // engine consult when the redirect is
        // `"life_loss"` — the integer parameter for the
        // life loss). For non-`life_loss` destinations,
        // the field defaults to 0.
        context: {
          ...(event.context ?? {}),
          redirectToZone: re.redirect.to as DeathRedirectZone,
          redirectToZoneAmount: re.redirect.amount ?? 0,
        },
      },
      description: re.text,
      instead: true,
      redirectToZone: re.redirect.to as DeathRedirectZone,
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
    if (!card.controllerId) continue;
    // Wave 4.8 follow-up 13 lane 61a (#2614 follow-up):
    // the script-side `replacement_effects` arm.
    if (script?.replacement_effects) {
      for (const re of script.replacement_effects) {
        // Runtime filter: the v1 minimum restricts to
        // `applies_to.type: "creature"` — when the dying
        // card is not a creature (an enchantment, an
        // artifact, a planeswalker), skip the effect.
        // The factory returns null for non-creature
        // scripts already, but a creature-shape script
        // applied to a non-creature dying card is also
        // a miss.
        if (re.applies_to.type === "creature" && !dyingIsCreature) continue;
        const effect = buildScriptedDeathReplacementEffect(
          card.id as CardInstanceId,
          card.controllerId,
          re,
          state,
        );
        if (effect) out.push(effect);
      }
    }
    // Wave 4.8 follow-up 13 lane 61b (#2614 follow-up):
    // also iterate the per-instance `deathReplacement`
    // ledger. The ledger is populated by
    // `refreshScriptedStatics` from any source's
    // `static[].death_replacement` arm — the
    // printed-card mechanism for Whip of Erebos's
    // actual oracle ("Whenever a creature you control
    // would die, exile it instead"). Each entry is a
    // structured `ScriptedReplacementEffect`; the
    // factory builds the same `ReplacementAbility`
    // shape as the lane 61a schema arm. The ledger
    // path runs alongside (not gated by) the
    // `replacement_effects` arm — a card with only
    // `statics[].death_replacement` (the Whip of Erebos
    // shape) still surfaces its replacement here.
    if (card.deathReplacement && card.deathReplacement.length > 0) {
      for (const re of card.deathReplacement) {
        if (re.applies_to.type === "creature" && !dyingIsCreature) continue;
        const effect = buildScriptedDeathReplacementEffect(
          card.id as CardInstanceId,
          card.controllerId,
          re,
          state,
        );
        if (effect) out.push(effect);
      }
    }
  }
  return out;
}