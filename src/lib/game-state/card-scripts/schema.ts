/**
 * Card scripts: cards as data (issue: card-scripts epic).
 *
 * A card script describes what a card does as a short list of effects drawn
 * from a small shared vocabulary, instead of the engine reading oracle text
 * at resolution time. The idea comes from how Forge scaled to tens of
 * thousands of cards; the format and every script here are our own.
 *
 * Targeted effects consume the spell's chosen targets in order: the first
 * targeted effect uses targets[0], the next targeted effect targets[1], etc.
 */
import { z } from "zod";
import { PREDEFINED_TOKEN_KINDS } from "./predefined-tokens";
import {
  REMOVAL_ALL_TARGETS,
  REMOVAL_TARGETS,
  TARGET_CONTROLLERS,
} from "./target-filters";

const amount = z.number().int().min(0);

/**
 * Per-effect Kicker gate (CR 702.32, #2564, multikicker CR 702.85 #2594).
 * When set, the effect is applied only when the spell was kicked the
 * specified amount:
 * - `true` — effect runs iff the spell was kicked at least once
 *   (`stackObject.timesKicked >= 1`).
 * - `false` — effect runs iff the spell was not kicked
 *   (`stackObject.timesKicked === 0`). Used for the base of a
 *   "kicker-replacement" pair (Burst Lightning's 2-damage branch).
 * - `N` (positive integer) — effect runs iff the spell was kicked at
 *   least N times. Lets a multikicker script layer tiered bonus effects
 *   on a single spell: e.g. "if kicked twice or more, also draw a card"
 *   (`if_kicked: 2`) on a spell whose base effect is
 *   `if_kicked: true` with linear scaling.
 *
 * An unset value means the effect always applies. This is the
 * sibling-on-effect shape (not a wrapper union) so existing scripts that
 * don't care about kicker stay byte-compatible. Mirrors how
 * `CardScript.flashback` augments the schema for a single alternative cost
 * without restructuring the spell-effects array.
 */
const ifKicked = z.union([z.boolean(), z.number().int().min(1)]).optional();

/**
 * "X" (CR 107.3, #2552): the value chosen for X as the spell was cast
 * (CR 601.2b). Only on a card whose mana cost has {X}; 0 anywhere else.
 */
const X = z.literal("X");
const xAmount = z.union([amount, X]);
const xCount = z.union([z.number().int().min(1), X]);
/** Pump: "+X/+0", "-X/-X". */
const xPump = z.union([z.number().int(), X, z.literal("-X")]);

/**
 * Whose permanent a targeted effect may pick (#2532): "target creature you
 * control" is "you", "an opponent controls" / "you don't control" is
 * "opponent". Only on effects that target a permanent.
 */
const controller = z.enum(TARGET_CONTROLLERS).optional();
const controllerNeedsCreatureTarget = {
  message: "controller only applies to target creature",
};

export const DealDamageSchema = z
  .object({
    op: z.literal("DealDamage"),
    amount: xAmount,
    /**
     * each_opponent is untargeted: damage to every opponent. opponent is
     * "target opponent" (#2614).
     */
    target: z.enum([
      "any",
      "creature",
      "player",
      "opponent",
      "each_opponent",
      "each_player",
      "defending_player",
    ]),
    controller,
    /**
     * Per-player amount for an untargeted each_player effect (#2614, Sunspine
     * Lynx): "deals damage to each player equal to the number of nonbasic
     * lands that player controls" is amount 1 per nonbasic land (CR 205.4a).
     * With defending_player (Generous Plunderer): "deals damage to defending
     * player equal to the number of artifacts they control" is per artifact.
     * On a targeted effect, treasure counts the Treasures you control (Smaug
     * the Magnificent: "damage equal to the number of Treasures you control").
     */
    per: z.enum(["nonbasic_land", "artifact", "treasure"]).optional(),
    /**
     * CR 702.33d — "If this spell was kicked, it deals N damage instead."
     * Set on the `if_kicked: true` variant of a damage effect that REPLACES
     * the base amount (Burst Lightning: 2 normally, 4 if kicked). The
     * interpreter dispatches this as `kickedAmount` on the resolved
     * StackEffect so the engine applies the "instead" rule rather than the
     * default +1-per-kick bonus. Only meaningful on the kicked variant;
     * the un-kicked variant declares the base `amount` and no
     * `kickedAmount`.
     */
    kickedAmount: z.number().int().nonnegative().optional(),
    if_kicked: ifKicked,
  })
  .strict()
  .refine(
    (e) => e.controller === undefined || e.target === "creature",
    controllerNeedsCreatureTarget,
  )
  .refine(
    (e) =>
      e.per === undefined ||
      (e.target === "each_player" && e.per === "nonbasic_land") ||
      (e.target === "defending_player" && e.per === "artifact") ||
      (e.per === "treasure" &&
        ["any", "creature", "player", "opponent"].includes(e.target)),
    {
      message:
        "per is nonbasic_land on each_player, artifact on defending_player, or treasure on a targeted effect",
    },
  );

/** #2594 lane 25: each_player draws a card for every player. */
export const DrawSchema = z
  .object({
    op: z.literal("Draw"),
    amount: xAmount,
    who: z.enum(["you", "target_player", "each_player"]).default("you"),
    if_kicked: ifKicked,
  })
  .strict();

export const GainLifeSchema = z
  .object({
    op: z.literal("GainLife"),
    amount: xAmount,
    who: z.enum(["you", "target_player"]).default("you"),
    if_kicked: ifKicked,
  })
  .strict();

export const LoseLifeSchema = z
  .object({
    op: z.literal("LoseLife"),
    amount: xAmount,
    who: z
      .enum([
        "you",
        "target_player",
        "each_opponent",
        /**
         * "drawer": the player whose draw fired the trigger (#2614
         * follow-up lane 87, Scrawling Crawler). Only valid when the
         * parent trigger has `event: "drawCard"`; the engine routes
         * the loss to `ctx.drawingPlayerId` (set by `drawCards` on
         * every card draw). Falls back to the active player if the
         * context is missing (defensive against legacy callers).
         */
        "drawer",
      ])
      .default("target_player"),
    if_kicked: ifKicked,
  })
  .strict();

const tokenColor = z.enum(["white", "blue", "black", "red", "green"]);

/** Keywords a created token can have (CR 702). Evergreen ones only for now. */
export const TOKEN_KEYWORDS = [
  "flying",
  "vigilance",
  "trample",
  "haste",
  "lifelink",
  "deathtouch",
  "reach",
  "first strike",
  "menace",
  "defender",
] as const;

/**
 * Keywords an Equipment or Aura may grant the equipped/enchanted creature
 * (issue #2561). Broader than `TOKEN_KEYWORDS`: equipment commonly grants
 * hexproof, double strike, and indestructible too. Kept to evergreens only;
 * new entries must also be supported in the engine's `hasKeyword` and
 * `parseAuraKeywords` paths.
 */
export const EQUIPMENT_KEYWORDS = [
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
] as const;

export const CreateTokenSchema = z
  .object({
    op: z.literal("CreateToken"),
    count: xCount,
    power: amount,
    toughness: amount,
    /** One color, or "colorless". Use `colors` for multicolor tokens. */
    color: z.union([tokenColor, z.literal("colorless")]).optional(),
    /** Two or more colors, e.g. a white and black Inkling (#2496). */
    colors: z.array(tokenColor).min(2).optional(),
    subtypes: z.array(z.string().min(1)).min(1),
    /** An artifact creature token, e.g. a Thopter or Robot (#2496). */
    artifact: z.boolean().optional(),
    keywords: z.array(z.enum(TOKEN_KEYWORDS)).min(1).optional(),
    /**
     * Wave 4.8 follow-up 4 lane 66 (#2614 follow-up): "embedded
     * static" stamped on the created token at creation time
     * (Adaptive Automaton, Avenger of Zendikar, Hornet Queen,
     * Cloudblazer — the "creature token has keyword / gets
     * +X/+X" family). The engine folds `power` and `toughness`
     * additively into the token's base P/T (so a 1/1 with
     * `power: 1, toughness: 1` becomes a 2/2), and stamps
     * `keywords` on the token's per-instance
     * `embeddedStaticKeywords` field. `hasKeyword` reads the
     * field as an additional source of keywords alongside
     * `cardData.keywords`. v1 supports P/T + keywords;
     * restrictions (`restrictAttack`, `restrictBlock`,
     * `maxBlockers`) are a follow-up lane. Parallel to the
     * lane 65 `grantedTriggers` pattern (per-instance +
     * battlefield-zone-only).
     */
    embedded_static: z
      .object({
        power: z.number().int().optional(),
        toughness: z.number().int().optional(),
        keywords: z.array(z.enum(TOKEN_KEYWORDS)).min(1).optional(),
      })
      .strict()
      .optional(),
    if_kicked: ifKicked,
  })
  .strict()
  .refine((t) => (t.color === undefined) !== (t.colors === undefined), {
    message: "set exactly one of color or colors",
  });

/**
 * Wave 4.8 follow-up 5 lane 70 (#2614 follow-up): "create a
 * permanent that copies the characteristics of [a target
 * permanent on the battlefield]" (Clone, Phantasmal Image,
 * Vesuvan Doppelganger). The new permanent inherits the
 * target's `cardData` (name, mana cost, type line, P/T,
 * keywords, oracle text, colors) — i.e. "all
 * characteristics copied" semantics (CR 707.2). The new
 * permanent enters the battlefield under the spell's
 * controller; the target is unchanged. The v1 minimum
 * supports a single target of any kind (`target: "permanent"`)
 * — the spell's controller chooses any permanent on the
 * battlefield as the copy source.
 *
 * Out of scope (each a follow-up lane): "may become a copy
 * until end of turn" (Sakashima-style / manifested /
 * disposition-of-copy), "may copy a spell on the stack"
 * (Splice), "may copy a card in a graveyard" (reanimation),
 * "copied characteristics except for [X]" (Phyrexian
 * Metamorph's "Phyrexian in addition to its other types"
 * rider), and "named-copy" / "choose-creature-type-copy"
 * filters.
 */
export const CopyPermanentSchema = z
  .object({
    op: z.literal("CopyPermanent"),
    /**
     * v1: `target: "permanent"` — any permanent on the
     * battlefield. The schema's `controller` arm mirrors the
     * lane 17 `cost.sacrifice_permanents.type` enum and the
     * lane 63 `additionalCosts.sacrifice.target` enum.
     * "creature" / "artifact" / "enchantment" / "land" are
     * follow-up lanes (each adds a narrower filter).
     */
    target: z.enum([
      "permanent",
      "creature",
      "artifact",
      "enchantment",
      "land",
    ]),
    /** Restrict to the controller's own permanents. */
    controller: z.enum(["you", "opponent", "any"]).optional(),
    if_kicked: ifKicked,
  })
  .strict();

/**
 * Wave 4.8 follow-up 8 lane 75a (#2614 follow-up):
 * "create a token that's a copy of [a chosen permanent] until
 * end of turn" (Cackling Counterpart, Ravenous
 * Chupacabra-style-to-copy). The new op creates a new
 * `CardInstance` whose printed `cardData` is the chosen
 * permanent's cardData (name, type_line, power, toughness,
 * colors, color_identity, keywords) — "all characteristics
 * copied" semantics (CR 707.2) — and stamps the new card's
 * `animatedUntilEndOfTurn` + `copyOfTargetId` ledger so the
 * existing lane 75 rollback paths (`clearUntilEndOfTurnPT` /
 * `restoreAnimatedOffBattlefield`) restore the printed
 * characteristics when the turn ends or the chosen target /
 * the new permanent leaves the battlefield.
 *
 * v1 single chosen target, "until end of turn" duration.
 * The chosen target must be on the battlefield at
 * resolution time (the engine validates
 * `state.cards.has(chosen_permanent)` at cast time and
 * checks `currentZoneKey.endsWith("-battlefield")`). The
 * chosen target itself is unchanged.
 *
 * Distinct from lane 70's `CopyPermanent` op (no EOT
 * rollback, creates a permanent copy that stays as a copy
 * forever) and lane 75's `StaticSchema.become_copy` (a
 * static on an existing permanent that copies itself onto
 * itself — the underlying permanent pre-exists the copy).
 * Lane 75a is the spell-effect shape: cast → token created
 * → copies a chosen permanent → rolls back at EOT.
 *
 * Out of scope (each a follow-up lane): multi-target copies
 * (a copy that picks the strongest of two chosen targets
 * at resolution time), narrow `controller` filter
 * ("you" / "opponent" / "any"), narrower `target` filters
 * ("creature" / "artifact" / "enchantment" / "land"),
 * permanent copies (no EOT duration), named-card copies
 * ("becomes a copy of [card name]" — lane 75b),
 * copy-with-exception copies (Phyrexian Metamorph — lane
 * 75c), nested copies (a target that itself has a
 * `become_copy` static — lane 75e), and Aura-shaped copies
 * (per-target — lane 75d).
 *
 * Sample card: a synthetic spell registered via the test
 * harness with `copyUntilEndOfTurn: { chosen_permanent:
 * <Grizzly Bears id>, until: "end_of_turn" }`. The spell
 * casts and creates a new token on the battlefield whose
 * characteristics are the chosen target's; the EOT rollback
 * restores the printed cardData.
 */
export const CopyUntilEndOfTurnSchema = z
  .object({
    op: z.literal("CopyUntilEndOfTurn"),
    /**
     * v1: the `CardInstanceId` of the chosen permanent on
     * the battlefield to copy. Resolved at cast time (the
     * engine validates the target is still on the
     * battlefield); if the target has left the
     * battlefield by the time the spell resolves, the
     * spell fizzles and no token is created.
     */
    chosen_permanent: z.string().min(1),
    /** v1: the only duration is `"end_of_turn"`. */
    until: z.literal("end_of_turn"),
    /**
     * Mirror the lane 70 `CopyPermanent` shape: an optional
     * kicker gate (#2564, lane 35). The cast-time kicker-
     * gate logic in `applyEffectsToTargets` reads
     * `effect.if_kicked` to gate each effect. The schema
     * inherits the standard `ifKicked` union.
     */
    if_kicked: ifKicked,
  })
  .strict();

/**
 * A Treasure, Food or Clue token (CR 111.10, #2544). "Investigate" is one
 * Clue. The token's ability is its rules text.
 */
export const CreatePredefinedTokenSchema = z
  .object({
    op: z.literal("CreatePredefinedToken"),
    token: z.enum(PREDEFINED_TOKEN_KINDS),
    count: z.number().int().min(1),
    /**
     * Who creates the tokens (#2614). "opponent" is "target opponent creates";
     * in two-player games the only opponent.
     */
    who: z.enum(["you", "opponent"]).optional(),
    /** The tokens enter tapped ("creates a tapped Treasure token"). */
    tapped: z.boolean().optional(),
    /**
     * "You may behold a [subtype]. If you do, create ..." (#2614 Sarkhan,
     * Dragon Ascendant). Beholding means choosing a permanent of that
     * subtype you control or revealing a card of it from your hand; the
     * engine always beholds when it can (revealing costs nothing) and
     * skips the tokens when it can't.
     */
    if_behold: z.string().min(1).optional(),
    if_kicked: ifKicked,
  })
  .strict();

/**
 * Destroy/Exile targets (#2528). min_power/max_power bound a creature's power
 * ("creature with power 4 or greater"); they only ever match creatures.
 *
 * `target` accepts both single-target values (`REMOVAL_TARGETS`) and the
 * "all <type>" sweeper set (`REMOVAL_ALL_TARGETS`, lane 12). Sweepers are
 * distinguished in the engine: a single-target op looks up the named card
 * via the chosen target; a sweeper iterates the battlefield.
 */
const removalFields = {
  target: z.enum([...REMOVAL_TARGETS, ...REMOVAL_ALL_TARGETS]),
  min_power: z.number().int().optional(),
  max_power: z.number().int().optional(),
  /**
   * #2594 follow-up (lane 18): bound the card's mana value across
   * types — "destroy each nonland permanent with mana value X"
   * (Steel Hellkite — FDN #138, {X}: Destroy each nonland
   * permanent with mana value X), "exile target creature with
   * mana value 3 or less", etc. `min_mana_value` is the lower
   * bound (inclusive), `max_mana_value` is the upper bound
   * (inclusive). The filter only applies to cards with a numeric
   * mana value (tokens default to 0).
   */
  // "X" on a mana-value bound (Steel Hellkite's "{X}: destroy each
  // nonland permanent with mana value X") is accepted by the
  // schema but the engine's scripted-spell resolver currently
  // resolves it to 0 via `withX`. A future lane should bind the
  // resolved X from the activated ability's xValue so the sweeper
  // honors the chosen X at activation time.
  min_mana_value: z.union([z.number().int().min(0), X]).optional(),
  max_mana_value: z.union([z.number().int().min(0), X]).optional(),
  controller,
  if_kicked: ifKicked,
};

export const DestroySchema = z
  .object({ op: z.literal("Destroy"), ...removalFields })
  .strict();

/**
 * Exile a target (CR 701.14, #2528). The default `target` enum is the
 * `REMOVAL_TARGETS` list ("creature", "artifact", ..., "planeswalker")
 * — all battlefield permanents. When `fromZone` is `"graveyard"`,
 * the effect targets a card in the chosen player's graveyard
 * (FDN: Ambush Wolf, Soul-Guide Lantern, #2594 follow-up). The
 * engine's `target.targetId` is the card id; the schema's `target`
 * field is still required (the engine uses the same target-spec
 * plumbing) but the value is treated as a single-card id when
 * `fromZone === "graveyard"`.
 */
export const ExileSchema = z
  .object({
    op: z.literal("Exile"),
    ...removalFields,
    /**
     * Source zone for the exiled card:
     * - `undefined` / `"battlefield"` — single-target exile from
     *   the battlefield (default; e.g. Swords to Plowshares).
     * - `"graveyard"` — single-target exile from a graveyard (lane
     *   10, Ambush Wolf / Soul-Guide Lantern).
     * - `"opponent_graveyard"` — sweep: exile every card in the
     *   targeted opponent's graveyard (lane 14, Angel of Finality).
     *   The `target` enum is overridden by `target_player`; the
     *   effect iterates the graveyard in the engine's `applyEffect`.
     * - `"library_top"` — sweep: exile the top card of each player's
     *   library (lane 16, Etali, Primal Storm — FDN). The engine
     *   iterates `state.players`, finds the top card of each
     *   `${playerId}-library` zone, and moves it to exile.
     */
    fromZone: z
      .enum(["battlefield", "graveyard", "opponent_graveyard", "library_top"])
      .optional(),
    /**
     * With fromZone graveyard: whose graveyard the target card comes from
     * (#2614 Keen-Eyed Curator: "target card from a graveyard" is any).
     * Unset keeps the older targeting.
     */
    graveyard: z.enum(["you", "any"]).optional(),
    /**
     * #2594 follow-up (lane 20): "exile up to N target cards from a
     * graveyard" (Soul-Shackled Zombie — FDN #70: "exile up to two
     * target cards from a single graveyard"). When `count` is set
     * with `fromZone: "graveyard"`, the engine selects up to `count`
     * card ids from the chosen graveyard and exiles them all.
     * `count: undefined` falls back to the single-card branch (lane
     * 10). Max 9 (v1 safeguard).
     */
    count: z.number().int().min(1).max(9).optional(),
  })
  .strict()
  .refine((e) => !e.graveyard || e.fromZone === "graveyard", {
    message: "graveyard needs fromZone graveyard",
  });

/** Tap or untap target permanent (#2538). Same filters as Destroy/Exile. */
export const TapSchema = z
  .object({ op: z.literal("Tap"), ...removalFields })
  .strict();

export const UntapSchema = z
  .object({ op: z.literal("Untap"), ...removalFields })
  .strict();

/**
 * Return target permanent to its owner's hand (#2546). Same filters as
 * Destroy/Exile. A token returned to hand ceases to exist (CR 111.8).
 */
export const ReturnToHandSchema = z
  .object({ op: z.literal("ReturnToHand"), ...removalFields })
  .strict();

/**
 * Return a card from a non-battlefield zone to the battlefield (#2560,
 * #2594 follow-up lane 27). `from: "graveyard"` and `to: "battlefield"`
 * only.
 *
 * The `target` is a card in the chosen graveyard. `filter` narrows which
 * cards may be picked: `creature` (only creatures), `mv_le` (mana value
 * at most N — "creature card with mana value 2 or less"), and `controller`
 * ("you" for your graveyard, "opponent" for an opponent's). The card
 * returns under its owner's control (CR 400.3), fires ETB triggers
 * normally, and gets "enters with" counters via the engine's
 * `applyEntersWithCounters` (CR 614.1c).
 *
 * `count` (#2594 follow-up, lane 27):
 *   - default / `count: N` (numeric): up to N cards matching `filter`;
 *     the targeted card first if provided, fills from the graveyard in
 *     order. Used by `Gravedigger`-style (count: 1) and lane 20
 *     multiples.
 *   - `count: "all"`: every card matching `filter` — sweep mode. The
 *     effect consumes no target slot (mirrors lane 20's
 *     `isTargetedEffect` gate). Used by Raise the Past (FDN #22):
 *     "Return all creature cards with mana value 2 or less from your
 *     graveyard to the battlefield."
 *   - `count: "X"` is permitted for X-spells (schema support only —
 *     not exercised by any current FDN/FIN card).
 */
export const ReturnFromZoneSchema = z
  .object({
    op: z.literal("ReturnFromZone"),
    from: z.literal("graveyard"),
    to: z.literal("battlefield"),
    /** Required when a `filter` is set (the script's targetable card). */
    target: z.literal("card").optional(),
    filter: z
      .object({
        creature: z.literal(true).optional(),
        mv_le: z.number().int().min(0).optional(),
        controller: z.enum(TARGET_CONTROLLERS).optional(),
      })
      .strict()
      .optional(),
    count: z.union([xCount, z.literal("all")]).optional(),
    if_kicked: ifKicked,
  })
  .strict();

/**
 * Fight and Bite (#2548). Fight (CR 701.14): the fighter and the target
 * creature each deal damage equal to their power to the other. Bite: only the
 * fighter deals damage ("deals damage equal to its power to target creature").
 *
 * `fighter` is who fights:
 * - "self": the permanent the ability belongs to (untargeted).
 * - "it": the creature the previous targeted effect targeted ("Put a +1/+1
 *   counter on target creature you control. It fights ...").
 * - "creature": a target creature you control, chosen just before the other
 *   target, so the effect uses two targets.
 * - "enchanted": the creature the Aura the ability belongs to is attached to
 *   (untargeted; Meltstrider's Resolve, #2614).
 * `controller` is whose creature the other target is. `optional` is "up to
 * one target creature" and is only scripted on abilities of the fighter.
 */
const fightFields = {
  fighter: z.enum(["self", "it", "creature", "enchanted"]),
  target: z.literal("creature"),
  controller,
  optional: z.boolean().optional(),
  if_kicked: ifKicked,
};
const optionalNeedsSelf = {
  message: "optional only applies when the fighter is self or enchanted",
};
const optionalFighterOk = (e: { optional?: boolean; fighter: string }) =>
  !e.optional || e.fighter === "self" || e.fighter === "enchanted";

export const FightSchema = z
  .object({ op: z.literal("Fight"), ...fightFields })
  .strict()
  .refine(optionalFighterOk, optionalNeedsSelf);

export const BiteSchema = z
  .object({ op: z.literal("Bite"), ...fightFields })
  .strict()
  .refine(optionalFighterOk, optionalNeedsSelf);

export const CounterSchema = z
  .object({
    op: z.literal("Counter"),
    target: z.enum(["spell", "ability"]),
    /**
     * #2594 follow-up: "counter target red or green spell" filter
     * (Flashfreeze — FDN #590). When set, the targeted spell's
     * source card must have at least one color in this list on its
     * color identity. An empty array is rejected; the field is
     * optional and defaults to no filter (the existing
     * counter-anything behavior). Valid only when
     * `target: "spell"` (lane 22); abilities on the stack don't
     * carry a single "spell color" — they belong to their source
     * permanent. Future work may extend the filter to abilities.
     */
    colors: z
      .array(z.enum(["W", "U", "B", "R", "G"]))
      .min(1)
      .optional(),
    if_kicked: ifKicked,
  })
  .strict()
  .refine((c) => c.target !== "ability" || c.colors === undefined, {
    message:
      "Counter.colors is only valid when target is 'spell' (#2594 follow-up, lane 22).",
  });

/**
 * Attach an Equipment (or other permanent) to a creature. The source of the
 * ability is the equipment; the target is always a creature you control
 * (CR 301.5c, #2561). When the op has no chosen target — e.g. an ETB
 * auto-attach that hasn't been aimed — the interpreter picks the first
 * creature the source's controller controls on the battlefield, like the
 * engine's `attachEquipment` "no target" fizzle path.
 */
export const AttachEquipmentSchema = z
  .object({
    op: z.literal("AttachEquipment"),
    target: z.enum(["creature"]),
    controller,
    if_kicked: ifKicked,
  })
  .strict();

export const PumpSchema = z
  .object({
    op: z.literal("Pump"),
    power: xPump,
    toughness: xPump,
    /**
     * self: the permanent the ability belongs to (untargeted).
     * other_creatures_you_control: every other creature you control,
     * untargeted (#2614 Summon: Esper Maduin chapter III).
     */
    target: z.enum(["creature", "self", "other_creatures_you_control"]),
    controller,
    /**
     * Keywords to grant the target until end of turn (e.g. lifelink on
     * Divine Resilience, #2564). When set, the interpreter appends each
     * keyword to the target's `untilEndOfTurnKeywords` so the layer-6
     * read path sees them. Evergreens only today; new entries must also
     * be supported in `evergreen-keywords.ts`'s `hasKeyword` and the
     * layer-6 keyword grant path.
     */
    keywords: z.array(z.enum(EQUIPMENT_KEYWORDS)).min(1).optional(),
    /**
     * "Double the power of target creature" (Mightform Harmonizer, #2614):
     * the target gets +X/+0 until end of turn, X its power on resolution
     * (CR 701.10e-style doubling). `power` and `toughness` are ignored and
     * should be 0.
     */
    double_power: z.literal(true).optional(),
    if_kicked: ifKicked,
  })
  .strict()
  .refine(
    (e) => e.controller === undefined || e.target === "creature",
    controllerNeedsCreatureTarget,
  )
  .refine((e) => !e.double_power || (e.power === 0 && e.toughness === 0), {
    message: "double_power needs power 0 and toughness 0",
  });

/**
 * #2614 Earthbender Ascension: "if it has four or more quest counters on
 * it". The effect runs only when the ability's source has at least `min`
 * counters of `counter` as the effect resolves, so a counter an earlier
 * effect of the same ability just added counts. A gated effect that does
 * not run still uses up its target slot, and a following "it" effect
 * (GrantKeyword target "it") then has no target (CR 608.2b).
 */
const ifSourceCounters = z
  .object({
    counter: z.enum(["quest"]),
    min: z.number().int().min(1).max(20),
  })
  .strict()
  .optional();

/**
 * Keywords a resolved spell or ability may grant until end of turn (#2567,
 * follow-up #2594). Mirrors `EQUIPMENT_KEYWORDS`: every keyword in
 * `evergreen-keywords.hasKeyword` is honored via the
 * `untilEndOfTurnKeywords` field on the card, so any of the 12 standard
 * evergreen keywords can be granted until end of turn. Adding a new entry
 * to `EQUIPMENT_KEYWORDS` also flows through here automatically.
 */
export const GRANTABLE_KEYWORDS = [
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
] as const;

/**
 * "Target creature gains indestructible until end of turn" (#2567). `target`:
 * - "creature": a target creature (uses one target).
 * - "self": the permanent the ability belongs to (untargeted).
 * - "it": the creature the previous targeted effect targeted, as in Adamant
 *   Will's "Target creature gets +2/+2 and gains indestructible" (one target
 *   shared by the Pump and the grant).
 */
export const GrantKeywordSchema = z
  .object({
    op: z.literal("GrantKeyword"),
    keyword: z.enum(GRANTABLE_KEYWORDS),
    /**
     * target: "creature" + controller: "you" → "target creature you control"
     * (single-target, chosen on cast).
     * target: "self" → this creature (the source of the spell/ability).
     * target: "it" → the previous targeted effect's target (CR 608.2b,
     *   e.g. Adamant Will).
     * target: "permanents_you_control" → every permanent the controller
     *   owns on resolution; the engine fans out to all matching cards
     *   (Boros Charm mode 2 — "Permanents you control gain
     *   indestructible until end of turn.").
     */
    target: z.enum(["creature", "self", "it", "permanents_you_control"]),
    /**
     * With target "permanents_you_control": only permanents with one of
     * these subtypes (#2614 Sapling Nursery — "Treefolk and Forests you
     * control gain indestructible until end of turn.").
     */
    subtypes: z.array(z.string().min(1)).min(1).optional(),
    controller,
    until: z.literal("end_of_turn"),
    if_kicked: ifKicked,
    if_source_counters: ifSourceCounters,
  })
  .strict()
  .refine(
    (e) => e.controller === undefined || e.target === "creature",
    controllerNeedsCreatureTarget,
  )
  .refine(
    (e) => e.subtypes === undefined || e.target === "permanents_you_control",
    { message: "subtypes needs target permanents_you_control" },
  );

/**
 * "Target creature [with power N or less] can't be blocked this turn"
 * (#2614, Escape Tunnel). Records "can't be blocked" in the target's
 * `untilEndOfTurnKeywords`, which combat's block check reads and cleanup
 * clears. `max_power` is rechecked on resolution (CR 608.2b). `target`
 * matches GrantKeyword: "creature", "self", or "it" (the previous
 * effect's target).
 */
export const CantBeBlockedSchema = z
  .object({
    op: z.literal("CantBeBlocked"),
    target: z.enum(["creature", "self", "it"]),
    max_power: z.number().int().optional(),
    controller,
    until: z.literal("end_of_turn"),
    if_kicked: ifKicked,
  })
  .strict()
  .refine(
    (e) => e.controller === undefined || e.target === "creature",
    controllerNeedsCreatureTarget,
  );

export const PutCountersSchema = z
  .object({
    op: z.literal("PutCounters"),
    /**
     * +1/+1 counters, or quest counters on the source itself (#2614
     * Earthbender Ascension: "put a quest counter on this enchantment").
     */
    counter: z.enum(["+1/+1", "quest"]),
    /**
     * The number of counters to add. Required when
     * `use_source_power` is unset/false; ignored (and may be
     * omitted entirely) when `use_source_power: true` (lane 23).
     */
    amount: xCount.optional(),
    target: z.enum(["creature", "self"]),
    controller,
    /**
     * The creature target may be left unchosen. Models a reflexive "when
     * you do ... target creature" inside an ability that itself has no
     * target, so the rest of the ability still resolves with no creature
     * around (Earthbender Ascension's landfall still adds its quest
     * counter).
     */
    optional: z.boolean().optional(),
    /**
     * #2594 follow-up (lane 23): "Put X +1/+1 counters on Heroes'
     * Bane, where X is its power" (Heroes' Bane — FDN #639). When
     * true, the engine resolves `amount` to the ability source's
     * effective power at apply-time (`getEffectivePower(source)`),
     * ignoring `amount` (which may be omitted). Only valid with
     * `counter: "+1/+1"` and `target: "self"` (the pattern is "put
     * N counters on yourself, where N is your power"). Lane 23's v1
     * limitation: not yet supported on quest counters or non-self
     * targets.
     */
    use_source_power: z.boolean().default(false),
    if_kicked: ifKicked,
    if_source_counters: ifSourceCounters,
  })
  .strict()
  .refine(
    (e) => e.controller === undefined || e.target === "creature",
    controllerNeedsCreatureTarget,
  )
  .refine((e) => e.counter !== "quest" || e.target === "self", {
    message: "quest counters only go on self",
  })
  .refine((e) => e.optional === undefined || e.target === "creature", {
    message: "optional needs target creature",
  })
  .refine(
    (e) =>
      !e.use_source_power || (e.counter === "+1/+1" && e.target === "self"),
    {
      message:
        "use_source_power needs counter '+1/+1' and target 'self' (#2594 follow-up, lane 23)",
    },
  )
  .refine(
    (e) =>
      e.use_source_power ||
      (typeof e.amount === "number" && e.amount >= 1) ||
      e.amount === "X",
    {
      message: "amount is required (>=1 or 'X') unless use_source_power is set",
    },
  );

/**
 * Put the top N cards of a library into its owner's graveyard (#2534).
 * Milling more cards than the library holds mills what is there.
 */
/** #2594 lane 25: each_player mills every player in the game. */
export const MillSchema = z
  .object({
    op: z.literal("Mill"),
    amount: xCount,
    who: z
      .enum(["you", "target_player", "each_opponent", "each_player"])
      .default("you"),
    if_kicked: ifKicked,
  })
  .strict();

/**
 * That player discards N cards of their choice (CR 701.8a). The game waits
 * for the choice, so Discard must come after every other effect in its list
 * ("draw two cards, then discard a card").
 */
export const DiscardSchema = z
  .object({
    op: z.literal("Discard"),
    amount: z.number().int().min(1),
    who: z
      .enum(["you", "target_player", "each_opponent", "each_player"])
      .default("you"),
    /**
     * #2594 follow-up (lane 15): "Discard your hand" (Myojin of
     * Night's Reach — FDN #110, Nibelheim Aflame — FIN). When
     * true, the player (per `who`) discards every card in their
     * hand regardless of `amount`. The `amount` is ignored when
     * this is set.
     */
    all: z.boolean().default(false),
    if_kicked: ifKicked,
  })
  .strict();

/** Scry N (CR 701.22, #2540). */
export const ScrySchema = z
  .object({
    op: z.literal("Scry"),
    amount: z.number().int().min(1),
    if_kicked: ifKicked,
  })
  .strict();

export const SurveilSchema = z
  .object({
    op: z.literal("Surveil"),
    amount: z.number().int().min(1),
    if_kicked: ifKicked,
  })
  .strict();

/**
 * Copy the spell that triggered this ability (CR 707.10), keeping its
 * targets. Only for cast triggers. `gain`: "those spells gain wither", so
 * the original and the copy both get the keyword while on the stack.
 *
 * `new_targets`: true marks the engine's intent to retarget ("you may
 * choose new targets for the copy", CR 707.10d). The v1 pipeline doesn't
 * expose a real retarget UI, so the engine records the intent and the
 * copy still inherits the original's targets (#2594 follow-up, lane 33,
 * Double Vision). A future pass can thread player-chosen targets
 * through the same flag.
 */
export const CopySpellSchema = z
  .object({
    op: z.literal("CopySpell"),
    gain: z
      .array(z.enum(["wither"]))
      .min(1)
      .optional(),
    new_targets: z.literal(true).optional(),
    if_kicked: ifKicked,
  })
  .strict();

/**
 * "Search your library for a [filter], reveal, [put into hand/battlefield/top/bottom],
 *  shuffle" (CR 603.9d / 608.2d, #2562). The searcher is `who`: the controller
 *  by default, or the previous targeted player for `target_player` spells.
 *
 * The filter is a single object whose keys AND together (`{creature: true, mv_le: 1}`
 *  means a creature with mana value ≤ 1). For OR-style filters — e.g.
 *  "search for an artifact or a land" — use the `or` arm with an array of
 *  filter objects, any of which may match (#2594 follow-up). The `or` arm
 *  is recursive: each sub-filter can itself carry an `or`. Top-level AND
 *  keys and `or` arms compose: a card matches when (the AND keys all match)
 *  AND (any `or` sub-filter matches, if any `or` arm is present).
 *
 * `destination` defaults to hand. `shuffle` defaults to true and is mandatory
 *  by CR: even a search that finds nothing still shuffles.
 *
 * `count` defaults to 1, capped at 2 in v1 (#2587); "up to N" search for
 *  N>2 is a follow-up.
 *
 * v1 limitations (noted in the PR): "reveal" is not modeled (the card simply
 *  moves into a private or public zone, or onto the library), and "put it onto
 *  the battlefield tapped" is not modeled (the card enters untapped).
 */
type SearchLibraryFilterShape = {
  basic_land?: true;
  land?: true;
  creature?: true;
  artifact?: true;
  enchantment?: true;
  instant_or_sorcery?: true;
  mv_le?: number;
  mv_eq?: number;
  name?: string;
  color?: "W" | "U" | "B" | "R" | "G";
  or?: SearchLibraryFilterShape[];
};

/**
 * Recursive filter schema (#2594 follow-up). The recursive `or` arm
 * requires a forward reference, which we resolve with a `let` binding
 * + z.lazy. Empty `or` arrays are rejected by the inner array schema.
 */
const SearchLibraryFilterSchema: z.ZodType<SearchLibraryFilterShape> = z.lazy(
  () =>
    z
      .object({
        basic_land: z.literal(true).optional(),
        land: z.literal(true).optional(),
        creature: z.literal(true).optional(),
        artifact: z.literal(true).optional(),
        enchantment: z.literal(true).optional(),
        instant_or_sorcery: z.literal(true).optional(),
        /** Mana value ≤ N. */
        mv_le: z.number().int().min(0).optional(),
        /** Mana value = N. */
        mv_eq: z.number().int().min(0).optional(),
        /** Exact English card name (case-insensitive). */
        name: z.string().min(1).optional(),
        /** A single color (W/U/B/R/G). */
        color: z.enum(["W", "U", "B", "R", "G"]).optional(),
        /**
         * OR arm: an array of sub-filters, any of which may match.
         * Recursive — each sub-filter can carry its own `or`. Empty
         * arrays are rejected.
         */
        or: z.array(SearchLibraryFilterSchema).min(1).optional(),
      })
      .strict()
      .refine(
        (f: SearchLibraryFilterShape) => {
          const hasKey =
            f.basic_land !== undefined ||
            f.land !== undefined ||
            f.creature !== undefined ||
            f.artifact !== undefined ||
            f.enchantment !== undefined ||
            f.instant_or_sorcery !== undefined ||
            f.mv_le !== undefined ||
            f.mv_eq !== undefined ||
            f.name !== undefined ||
            f.color !== undefined;
          return hasKey || f.or !== undefined;
        },
        { message: "filter needs at least one key or an 'or' arm" },
      ),
);

/** Inferred shape of the `filter` field on a `SearchLibrary` effect (#2562). */
export type SearchLibraryFilter = z.infer<typeof SearchLibraryFilterSchema>;

export const SearchLibrarySchema = z
  .object({
    op: z.literal("SearchLibrary"),
    /**
     * "target_controller": the controller of the previous effect's target
     * (Demolition Field: "That land's controller may search their library
     * ..."). Uses the target's last known controller (CR 608.2h) and does
     * nothing when that target was illegal.
     */
    who: z.enum(["you", "target_player", "target_controller"]).default("you"),
    filter: SearchLibraryFilterSchema,
    destination: z
      .enum(["hand", "battlefield", "library_top", "library_bottom"])
      .default("hand"),
    shuffle: z.boolean().default(true),
    /**
     * "up to N" cards (Burnished Hart: "up to two basic land cards"). The
     * engine takes the first N matches in library order; the player does not
     * choose yet. Capped at 2, the most any scripted card needs today.
     */
    count: z.number().int().min(1).max(2).default(1),
    /**
     * "put it onto the battlefield tapped" (Solemn Simulacrum). Only read
     * when `destination` is "battlefield"; ignored for other destinations.
     */
    tapped: z.boolean().optional(),
    /**
     * Fabled Passage: "Then if you control four or more lands, untap that
     * land." After the search, untap the found cards when the searcher
     * controls at least this many lands (the found land counts). Only read
     * with `tapped` on a battlefield search.
     */
    untap_if_lands: z.number().int().min(1).optional(),
    /**
     * Magmatic Hellkite: "puts it onto the battlefield tapped with a stun
     * counter on it" (CR 122.1d). Stun counters on each found card. Only
     * read with `tapped` on a battlefield search.
     */
    stun: z.number().int().min(1).optional(),
    if_kicked: ifKicked,
  })
  .strict();

/**
 * Add mana to the controller's pool (#2565). Covers mana dorks and rocks:
 * "{T}: Add {G}." is `{"amount":1,"colors":["G"]}`, "{T}: Add {G}{G}." is
 * `{"amount":2,"colors":["G"]}`, "Add {R} or {G}." is
 * `{"amount":1,"colors":["R","G"]}`, and "Add one mana of any color." is
 * `{"amount":1,"colors":"any"}`.
 *
 * An activated ability with this op is a mana ability (CR 605.1a): it
 * resolves immediately without using the stack, and the engine's mana
 * ability path adds the mana (with a color choice when there is more
 * than one option). There is no flag for this in the script.
 *
 * Out of scope for now: "spend this mana only on ..." restrictions, mana
 * that depends on a count ("for each creature you control"), and mixed
 * symbols like "{R}{G}". Cards with those wait for a follow-up.
 */
export const MANA_SYMBOLS = ["W", "U", "B", "R", "G", "C"] as const;

export const AddManaSchema = z
  .object({
    op: z.literal("AddMana"),
    amount: z.number().int().min(1).default(1),
    /**
     * `"chosen"` (#2594 follow-up, Wave 4.7 lane 41) is a sentinel
     * meaning "use the source's `chosenColor` instance field"
     * (Heraldic Banner's "{T}: Add one mana of the chosen color").
     * Only valid as the SOLE entry of the array, never combined
     * with literal colors or with `"any"` — the engine substitutes
     * the source's chosen color and the multi-color and "any"
     * branches have no chosen-color fallback. The engine's
     * activated-ability mana path reads `source.chosenColor`;
     * if null the activated ability produces nothing (and the
     * engine surfaces a soft error so the UI can re-prompt or
     * skip).
     */
    colors: z
      .union([
        z.array(z.enum([...MANA_SYMBOLS, "chosen"])).min(1),
        z.literal("any"),
      ])
      .refine((c) => c === "any" || !c.includes("chosen") || c.length === 1, {
        message:
          "AddMana.colors may only be the single 'chosen' sentinel (not mixed with literal colors or 'any')",
      }),
    if_kicked: ifKicked,
  })
  .strict();

/**
 * "Shuffle [a player's] library" (CR 701.20, #2566). The standalone
 * shuffle op covers cards whose only effect is to shuffle (rare, but
 * every search-style spell ALSO needs the post-search shuffle — the
 * `SearchLibrary` op's `shuffle: true` field handles that). For now
 * only `into: "library"` is supported: "shuffle your graveyard into
 * your library" is a follow-up variant.
 */
export const ShuffleLibrarySchema = z
  .object({
    op: z.literal("ShuffleLibrary"),
    who: z.enum(["you", "target_player"]).default("you"),
    into: z.literal("library").default("library"),
    if_kicked: ifKicked,
  })
  .strict();

/**
 * "This land becomes a 3/3 creature with vigilance and all creature types.
 * It's still a land." (#2614 Soulstone Sanctuary, CR 611.2a, layer 4/6/7b).
 * Until end of turn the source keeps its types and adds Creature, with the
 * given base power and toughness and keywords.
 */
export const AnimateSchema = z
  .object({
    op: z.literal("Animate"),
    target: z.literal("self"),
    power: z.number().int().min(0),
    toughness: z.number().int().min(0),
    keywords: z.array(z.enum(EQUIPMENT_KEYWORDS)).min(1).optional(),
    all_creature_types: z.literal(true).optional(),
    if_kicked: ifKicked,
  })
  .strict();

/**
 * Earthbend N (#2614 Ba Sing Se): target land you control becomes a 0/0
 * creature with haste that's still a land, with N +1/+1 counters; it
 * returns to the battlefield tapped when it dies or is exiled.
 */
export const EarthbendSchema = z
  .object({
    op: z.literal("Earthbend"),
    target: z.literal("land_you_control"),
    amount: z.number().int().min(1).max(9),
    if_kicked: ifKicked,
  })
  .strict();

/**
 * "[This creature] becomes a [subtype] in addition to its other types until
 * end of turn" (#2614 Sarkhan, Dragon Ascendant). Adds the subtype to the
 * source's `untilEndOfTurnSubtypes`; cleanup clears it.
 */
export const AddSubtypeSchema = z
  .object({
    op: z.literal("AddSubtype"),
    target: z.literal("self"),
    subtype: z.string().min(1),
    until: z.literal("end_of_turn"),
    if_kicked: ifKicked,
  })
  .strict();

/**
 * "Reveal the top card of your library. If it's a permanent card, put it
 * into your hand." (#2614 Summon: Esper Maduin chapter I). A nonpermanent
 * card stays on top.
 */
export const RevealTopToHandSchema = z
  .object({
    op: z.literal("RevealTopToHand"),
    filter: z.literal("permanent"),
    if_kicked: ifKicked,
  })
  .strict();

/**
 * "If this spell was cast from a graveyard, exile it, then put it onto the
 * battlefield transformed under its owner's control with a finality counter
 * on it." (#2614 Esper Origins). Only on a transforming double-faced spell.
 */
export const ReturnTransformedSchema = z
  .object({
    op: z.literal("ReturnTransformed"),
    if_cast_from: z.literal("graveyard"),
    counter: z.literal("finality").optional(),
    if_kicked: ifKicked,
  })
  .strict();

export const EffectSchema = z.discriminatedUnion("op", [
  DealDamageSchema,
  DrawSchema,
  GainLifeSchema,
  LoseLifeSchema,
  CreateTokenSchema,
  CreatePredefinedTokenSchema,
  CopyPermanentSchema,
  DestroySchema,
  ExileSchema,
  TapSchema,
  UntapSchema,
  ReturnToHandSchema,
  ReturnFromZoneSchema,
  CounterSchema,
  AttachEquipmentSchema,
  PumpSchema,
  PutCountersSchema,
  SurveilSchema,
  ScrySchema,
  MillSchema,
  DiscardSchema,
  CopySpellSchema,
  SearchLibrarySchema,
  ShuffleLibrarySchema,
  FightSchema,
  BiteSchema,
  AddManaSchema,
  GrantKeywordSchema,
  CantBeBlockedSchema,
  AnimateSchema,
  EarthbendSchema,
  AddSubtypeSchema,
  RevealTopToHandSchema,
  ReturnTransformedSchema,
  CopyUntilEndOfTurnSchema,
]);

/** True when no non-Discard effect follows a Discard (#2536). */
function discardIsLast(list: readonly { op: string }[]): boolean {
  const first = list.findIndex((e) => e.op === "Discard");
  return first < 0 || list.slice(first).every((e) => e.op === "Discard");
}

const effects = z.array(EffectSchema).min(1).refine(discardIsLast, {
  message: "Discard must come after every other effect",
});

/**
 * One mode of a modal spell or ability. `text` is the mode as printed after its bullet,
 * mode name included ("Fight Crime — Counter target spell. Draw a card.");
 * reminder text is left out. It is how the stack's `chosenModes` labels are
 * matched back to the mode.
 */
export const ModeSchema = z
  .object({ text: z.string().min(1), effects })
  .strict();

/**
 * A modal instant or sorcery (CR 700.2): "Choose one —", "Choose two —".
 * The chosen modes resolve in printed order and share the spell's targets,
 * in order, like a plain spell's effects.
 */
export const ModesSchema = z
  .object({
    choose: z.number().int().min(1).max(4),
    options: z.array(ModeSchema).min(2),
  })
  .strict()
  .refine((m) => m.choose < m.options.length, {
    message: "choose must be less than the number of modes",
  })
  .refine(
    (m) =>
      new Set(m.options.map((o) => o.text.trim().toLowerCase())).size ===
      m.options.length,
    { message: "mode texts must be distinct" },
  );

/**
 * A triggered ability. `text` is the ability's oracle sentence: it is what
 * the stack shows and how a resolving ability is matched back to its script.
 */
export const TriggerSchema = z
  .object({
    text: z.string().min(1),
    /**
     * etb: enters the battlefield. landfall: a land you control enters.
     * dies: a creature goes to the graveyard from the battlefield (CR 700.4).
     * attacks: attackers are declared (CR 508.1m). upkeep: the upkeep step
     * begins (CR 503.1a). cast: a spell is cast (CR 601.2i), the trigger
     * goes on the stack above it. phaseEnds: the end step begins
     * (CR 702.1a-style "at the beginning of your end step" wording;
     * the engine's `phaseEnds` covers both the beginning-of-end-step
     * delayed trigger and the phase-end tick). lifeGain: a player gains
     * life (CR 118 — covers "Ajani's Pridemate" style triggers). The
     * engine fires all of these in real games (#2498, #2496).
     */
    event: z.enum([
      "etb",
      "landfall",
      "dies",
      "attacks",
      "upkeep",
      "cast",
      "phaseEnds",
      "lifeGain",
      // targeted: a creature you control or a creature spell you control
      // becomes the target of a spell or ability an opponent controls
      // (#2614 Surrak, Elusive Hunter).
      "targeted",
      // crime: you target an opponent, anything they control, or a card in
      // their graveyard (CR 700.13, #2614 Magda, the Hoardmaster).
      "crime",
      // chapter: a Saga chapter ability (CR 714.2b), fired when a lore
      // counter brings the count to `chapter` or past it (#2614 Summon:
      // Esper Maduin).
      "chapter",
      // drawCard: any player draws a card. Narrowed by `whose_draws`
      // ("opponent" for Scrawling Crawler's "Whenever an opponent draws
      // a card, that player loses 1 life" #2614 follow-up, lane 87).
      "drawCard",
    ]),
    /**
     * etb, dies, attacks: whose entry, death or attack it watches
     * (CR 603.6a). "self" is this permanent; "another" / "any" are
     * creatures, narrowed by `controller`.
     */
    subject: z.enum(["self", "another", "any", "attached"]).default("self"),
    /** With subject another/any: only creatures you or an opponent control. */
    controller: z.enum(["you", "opponent"]).optional(),
    /**
     * With subject another/any: only creatures of this creature type,
     * singular ("Whenever you attack with one or more Lizards" is
     * attacks/any/you/once with subtype "Lizard"), #2614.
     */
    subtype: z.string().min(1).optional(),
    /** attacks only: "whenever you attack", once per combat, not per attacker. */
    once: z.boolean().optional(),
    /** upkeep only: whose upkeep (CR 503.1a). */
    whose: z.enum(["you", "each", "opponent"]).optional(),
    /**
     * drawCard only: who drew the card (CR 121.2, #2614 follow-up lane
     * 87). "opponent" narrows the trigger to opponent-only draws
     * (Scrawling Crawler's "Whenever an opponent draws a card" half);
     * "you" / "any" cover the rest. Default "any". The
     * `whose_draws: "opponent"` filter is evaluated against the
     * trigger's source controller in `detectTriggeredAbilities`; the
     * `LoseLife.who: "drawer"` op routes the life loss to whoever drew.
     */
    whose_draws: z.enum(["you", "opponent", "any"]).optional(),
    /** cast only: who casts the spell. "you" when unstated. */
    caster: z.enum(["you", "opponent", "any"]).optional(),
    /** cast only: which spells count. "any" when unstated. */
    spell: z
      .enum([
        "any",
        "creature",
        "noncreature",
        "instant_or_sorcery",
        "artifact",
        "enchantment",
        "multicolored",
      ])
      .optional(),
    /**
     * cast only: a single-color filter ("a red spell",
     * "a white spell", CR 601.2i / 603.2). The trigger fires only when
     * the cast spell's `colors` includes this color. Mutually
     * independent from `spell` (e.g. `spell: "instant_or_sorcery"` +
     * `cast_color: "R"` = "whenever you cast a red instant or
     * sorcery"). v1 supports a single color; multicolored or "color
     * identity" filters are a follow-up. (#2594 follow-up, lane 34,
     * Pyromancer's Goggles — color half only.)
     */
    cast_color: z.enum(["W", "U", "B", "R", "G"]).optional(),
    /** crime only: "This ability triggers only once each turn." */
    once_per_turn: z.literal(true).optional(),
    /** cast only: "a spell with a single target" (exactly one target). */
    targets: z.literal("single").optional(),
    /** The chapter number of a Saga chapter ability (I = 1). */
    chapter: z.number().int().min(1).max(6).optional(),
    effects: effects.optional(),
    /**
     * Intervening-if (CR 603.4). The engine only puts the trigger
     * on the stack (and re-checks at resolution) when this clause
     * evaluates true. Today this gates threshold triggers
     * ("there are seven or more cards in your graveyard"); the
     * full regex set lives in `abilities/evaluate.ts`. (#2594
     * lane 26, Crypt Feaster.)
     */
    intervening_if: z.string().min(1).optional(),
    /**
     * A modal ability ("When this creature enters, choose one —"), instead of
     * `effects`. The controller picks the modes as it goes on the stack
     * (CR 603.3c, 700.2a); `text` is then the line up to the dash.
     */
    modes: ModesSchema.optional(),
    /**
     * Wave 4.8 follow-up 2 lane 60 (#2614 follow-up): a "you may"
     * (CR 117.3a "you may") that gates the whole ability's effects
     * behind a yes/no confirmation prompt offered to the controller
     * at resolution time. Covers "you may pay 2 life; if you do, draw
     * a card" / "you may gain 1 life" / Skyship Buccaneer's later-
     * payment pattern. The engine surfaces a `waitingChoice` of type
     * `you_may_prompt` (registry in spell-casting/choices.ts), the
     * player picks yes / no, and `stackObject.you_may_resolved` is
     * stamped `true` / `false` to control whether the effects loop
     * applies. Modal `modes` and `you_may` are mutually exclusive:
     * a single trigger is either "you may do X" OR a "choose one"
     * modal, not both — the schema refuses the combination. Out of
     * scope for lane 60: dynamic cost reductions combined with the
     * "you may" payment (lane 65 work).
     */
    you_may: z.boolean().optional(),
    /**
     * Wave 4.8 follow-up 2 lane 62 (#2614 follow-up): a counter
     * gate on the trigger event itself (CR 603.2 — a "while-
     * condition"-style gate, NOT an intervening-if CR 603.4).
     * When set, the engine only fires the trigger if the source
     * permanent's `card.instanceCounters[counter.type]` matches
     * the gate's comparator:
     *   - op: "gte" → `count >= n`
     *   - op: "eq"  → `count === n`
     * Default behavior on absent counters is `0`; the gate reads
     * `card.instanceCounters?.[counter] ?? 0` so cards without
     * the ledger default to 0 (matches the documented v1
     * behavior of `CardInstance.instanceCounters` from lane 59).
     * The sample card is Redcap Gutter-Dweller's deferred
     * "Goblins you control have menace when 3+ counters" half —
     * lane 57 (#2731) shipped the JSON shape; lane 62 wires the
     * engine arm the card already carries.
     */
    counter_gate: z
      .object({
        counter: z.string().min(1),
        op: z.enum(["gte", "eq"]),
        n: z.number().int().min(0),
      })
      .optional(),
  })
  .strict()
  .refine((t) => (t.effects === undefined) !== (t.modes === undefined), {
    message: "a trigger has effects or modes, exactly one",
  })
  .refine((t) => !(t.you_may === true && t.modes !== undefined), {
    message:
      "you_may and modes are mutually exclusive on a trigger (lane 60, #2614)",
  })
  .refine((t) => (t.event === "chapter") === (t.chapter !== undefined), {
    message: "chapter is required on, and only for, chapter triggers",
  })
  .refine((t) => t.event === "upkeep" || t.whose === undefined, {
    message: "whose is only for upkeep triggers",
  })
  .refine((t) => t.event === "crime" || t.once_per_turn === undefined, {
    message: "once_per_turn is only for crime triggers",
  })
  .refine((t) => t.event === "attacks" || t.once === undefined, {
    message: "once is only for attacks triggers",
  })
  .refine(
    (t) =>
      t.event === "cast" ||
      (t.caster === undefined &&
        t.spell === undefined &&
        t.targets === undefined &&
        t.cast_color === undefined),
    {
      message:
        "caster, spell, targets and cast_color are only for cast triggers",
    },
  )
  .refine(
    (t) =>
      t.event === "cast" ||
      ![
        ...(t.effects ?? []),
        ...(t.modes?.options ?? []).flatMap((o) => o.effects),
      ].some((e) => e.op === "CopySpell"),
    { message: "CopySpell is only for cast triggers" },
  )
  .refine(
    (t) =>
      t.controller === undefined ||
      (t.subject !== "self" && ["etb", "dies", "attacks"].includes(t.event)),
    { message: "controller needs subject another/any on etb, dies or attacks" },
  )
  .refine(
    (t) =>
      t.subtype === undefined ||
      (t.subject !== "self" && ["etb", "dies", "attacks"].includes(t.event)),
    { message: "subtype needs subject another/any on etb, dies or attacks" },
  );

/** An activated ability (CR 602). `text` is the part after the colon. */
export const ActivatedSchema = z
  .object({
    text: z.string().min(1),
    cost: z
      .object({
        /**
         * Mana cost string (#2559 follow-up: X in activation cost). "{X}" is
         * accepted and surfaces on the script's parsed `manaCost.X` field;
         * the engine charges the chosen X as generic mana at activation time
         * (`activateAbility` reads `card.xValue` for the chosen value). All
         * mana symbols on one ability fit the `(symbol)+` shape; mixed "{X}{G}",
         * "{X}{X}{R}", and "{2}{X}{W}" are valid in v1.
         */
        mana: z
          .string()
          .regex(/^(\{(?:[0-9]+|X|[WUBRGC])\})+$/)
          .optional(),
        tap: z.boolean().default(false),
        sacrifice: z.boolean().default(false),
        /**
         * "Sacrifice three Treasures" (#2614 Magda, the Hoardmaster): that
         * many permanents of the subtype you control, sacrificed as a cost.
         * "Sacrifice a creature" (Ravenous Amulet, Eaten Alive — FDN):
         * any number of any creature you control. When `type` is set,
         * the engine matches cards whose type line starts with the
         * given type ("Creature", "Artifact", "Enchantment"). `subtype`
         * and `type` are mutually exclusive — pick one. (#2594
         * follow-up, lane 17.)
         */
        sacrifice_permanents: z
          .object({
            count: z.number().int().min(1).max(9),
            subtype: z.string().min(1).optional(),
            type: z
              .enum([
                "Creature",
                "Artifact",
                "Enchantment",
                "Land",
                "Planeswalker",
              ])
              .optional(),
          })
          .strict()
          .refine((s) => Boolean(s.subtype) !== Boolean(s.type), {
            message:
              "sacrifice_permanents needs exactly one of subtype or type",
          })
          .optional(),
        /**
         * #2594 follow-up: "Exile this artifact" as a cost (Phoenix Down,
         * Ether, Elixir — FIN #29, etc.). When true, the engine
         * exiles the source card to the controller's exile zone as
         * part of the activation cost. The activation will still fail
         * (no-op) if the source card can't be moved (e.g. an Aura
         * attached to an illegal target — but this is an artifact
         * ability, so that case doesn't apply here).
         */
        exileSelf: z.boolean().default(false),
        /**
         * #2594 follow-up (lane 21): "Pay N life" as an activation
         * cost (Ring of the Lucii — FIN #269: "{2}, {T}, Pay 1 life:
         * Tap target nonland permanent"). Parallel to
         * `sacrifice_permanents`. The engine's `payLife` field in
         * `ParsedActivatedAbility.costs` is already paid in
         * `abilities/activated.ts` (`activated.ts:412`); this lane
         * wires the script's `cost.pay_life` into that field. Range
         * 1..99 (v1 safeguard). The activation fails if the
         * controller's life is below `pay_life` (CR 118.4, "If a
         * player pays life, they lose that much life"; engine
         * surfaces "Not enough life" via `canActivate`).
         */
        pay_life: z.number().int().min(1).max(99).optional(),
      })
      .strict(),
    /** CR 602.5b: "Activate only once" / "Activate only once each turn". */
    limit: z.enum(["once", "once_per_turn"]).optional(),
    /** CR 602.5d: "Activate only as a sorcery". */
    timing: z.literal("sorcery").optional(),
    effects: effects.optional(),
    /**
     * A modal ability ("{2}, Sacrifice this creature: Choose one —"), instead
     * of `effects`; `text` is then "Choose one —". Modes are picked as it is
     * activated (CR 700.2a).
     */
    modes: ModesSchema.optional(),
  })
  .strict()
  .refine((a) => (a.effects === undefined) !== (a.modes === undefined), {
    message: "an activated ability has effects or modes, exactly one",
  });

/**
 * A static ability that pumps or grants keywords to creatures (CR 604, 611.3),
 * e.g. "Other Dinosaurs you control get +1/+1" or "Creatures you control have
 * haste" (#2496). Applied in layer 6 (keywords) and 7c (P/T).
 *
 * `X` (#2594 follow-up, lane 36, Smaug, Blanchwood Armor, Tempest Djinn) is
 * a state-derived P/T contribution that overrides the integer
 * `power`/`toughness` when present. The refresh pass in
 * `keyword-actions/scripted-statics.ts` reads the named count from the
 * current state and writes the effective P/T to `scriptStaticPT`. v1
 * supports `treasures` (cards on the battlefield with the Treasure
 * token type under your control), `creatures` (creatures you control),
 * and `lands` (lands you control).
 */
export const StaticSchema = z
  .object({
    /** The static ability's line of oracle text. */
    text: z.string().min(1),
    affects: z
      .object({
        controller: z.enum(["you", "opponents"]),
        /** "Other creatures": excludes the source itself. */
        other: z.boolean().optional(),
        /**
         * "this creature" — only the source itself (Smaug,
         * Blanchwood Armor — wait, Blanchwood is an Aura; this is
         * for self-stating creatures like Smaug, Tempest Djinn).
         * #2594 follow-up, lane 36.
         */
        self: z.boolean().optional(),
        /**
         * Only creatures with this creature type, singular
         * ("Dinosaur"). Used by single-type anthem patterns like
         * "Goblins you control get +1/+1" (#2594 lane 30).
         *
         * `"chosen"` (#2594 follow-up, Wave 4.7 follow-up lane 45,
         * #2705b) is a sentinel meaning "use the source's
         * `chosenCreatureType` instance field". Only valid when the
         * source has `enter_choice: { kind: "creature_type" }`
         * (lane 44, #2705a); the engine (`staticAffects` in
         * `keyword-actions/scripted-statics.ts`) reads
         * `source.chosenCreatureType` and substitutes it. If
         * `chosenCreatureType` is null (the enter choice hasn't
         * resolved yet) the anthem doesn't apply — the scripted
         * anthem remains inert until the player makes the enter
         * choice. Used by Adaptive Automaton's "other creatures
         * you control of the chosen type get +1/+1".
         */
        subtype: z.union([z.string().min(1), z.literal("chosen")]).optional(),
        /**
         * Only creatures of this color, single-letter Scryfall form
         * ("W", "U", "B", "R", "G"). Used by single-color anthem
         * patterns like Knight of Grace's "White creatures you
         * control get +1/+1" (#2594 lane 30).
         *
         * `"chosen"` (#2594 follow-up, Wave 4.7 lane 40) is a
         * sentinel meaning "use the source's `chosenColor` instance
         * field". Only valid when the source has
         * `enter_choice: { kind: "color" }`; the engine
         * (`staticAffects` in `keyword-actions/scripted-statics.ts`)
         * reads `source.chosenColor` and substitutes it. If
         * `chosenColor` is null (the enter choice hasn't resolved
         * yet) the anthem doesn't apply — the scripted anthem
         * remains inert until the player makes the enter choice.
         * Used by Heraldic Banner's "creatures you control of the
         * chosen color get +1/+1".
         */
        color: z.enum(["W", "U", "B", "R", "G", "chosen"]).optional(),
        /**
         * Wave 4.7 phase 2 lane 50 (#2708 phase 2b): the
         * chosen-name block static. When true, the static
         * identifies the source as a "Spyglass-like" card whose
         * `chosenCardName` (set by `enter_choice: { kind:
         * "chosen_name" }` in lane 49) blocks activation of
         * non-mana activated abilities on cards named with that
         * chosen name. The engine's gate lives in
         * `canActivateAbility` (`abilities/activated.ts`); it
         * scans the battlefield for any source carrying a static
         * with `chosen_name_block: true` and checks whether the
         * ability's source card's `name` matches the static
         * source's `chosenCardName`. The chosen-name block is
         * entirely a meta-static — no P/T, no keywords, no X.
         *
         * Used by Sorcerous Spyglass: "Activated abilities of
         * sources with the chosen name can't be activated unless
         * they're mana abilities." The chosen-name block only
         * affects activated abilities (CR 602.2d) and explicitly
         * spares mana abilities (CR 605), matching the original
         * card's text.
         */
        chosen_name_block: z.literal(true).optional(),
        /**
         * Wave 4.8 lane 52 (#2614 follow-up): a creature-type
         * changing static. The source adds the named creature
         * type (or its `chosenCreatureType` for the sentinel)
         * to its own subtypes — Adaptive Automaton's "is the
         * chosen type in addition to its other types" half.
         * `"chosen"` reads `source.chosenCreatureType`;
         * literal strings (Eaten by Piranhas / Infernal Vessel
         * family) use a verbatim creature type. v1 is
         * self-only (companion `addCreatureTypeToSelf` flag
         * below); the Aura-style generalization rides lane 54.
         * Engine path: `staticAffects` +
         * `refreshScriptedStatics` in
         * `keyword-actions/scripted-statics.ts`. The chosen
         * type evicts naturally on zone change (the source
         * leaves the battlefield; `chosenTypeAdditions` is
         * stamped by `refreshScriptedStatics` only for cards
         * currently on the battlefield).
         */
        add_creature_type: z
          .union([z.string().min(1), z.literal("chosen")])
          .optional(),
        /**
         * Wave 4.8 lane 52 (#2614 follow-up): companion flag
         * for `add_creature_type` — opt-in to the v1 self-only
         * engine path. Without this flag the engine does NOT
         * grow `source.subtypes`. Lane 54 picks up the
         * Aura-style "enchanted creature is the chosen type"
         * generalization.
         */
        addCreatureTypeToSelf: z.literal(true).optional(),
        /**
         * Wave 4.8 lane 55 (#2614 follow-up): a
         * creature-color-changing static. The source adds
         * the named color (or its `chosenColor`) to its own
         * colors while on the battlefield (Redcap
         * Gutter-Dweller-style, parallel to lane 52's
         * `add_creature_type`).
         *
         * `"W"|"U"|"B"|"R"|"G"` — literal color for the
         * named-color variant (a card that always adds a
         * specific color to itself).
         * `"chosen"` — sentinel meaning "use the source's
         * `chosenColor` instance field" (an `enter_choice:
         * { kind: "color" }` card that adds its own chosen
         * color to itself in addition to its printed
         * colors). Mirrors lane 52's chosen-sentinel
         * pattern.
         */
        add_color: z.enum(["W", "U", "B", "R", "G", "chosen"]).optional(),
        /**
         * Wave 4.8 lane 55 (#2614 follow-up): companion
         * flag for `add_color` — opt-in to the v1 self-only
         * engine path. Mirrors `addCreatureTypeToSelf` (lane
         * 52). Without this flag the engine does NOT grow
         * the source's `chosenColorAdditions`. The
         * Aura-style "enchanted creature gains a color"
         * generalization rides a future lane.
         */
        addColorToSelf: z.literal(true).optional(),
      })
      .strict(),
    power: z.number().int().optional(),
    toughness: z.number().int().optional(),
    /**
     * State-derived P/T contribution (#2594 follow-up, lane 36). When
     * set, the refresh pass reads the named count and writes it to
     * `scriptStaticPT` instead of the integer `power`/`toughness`.
     * Sample card: Smaug ("Smaug gets +X/+X where X is the number of
     * Treasures you control") — `power: 0, X: "treasures"` is the
     * standard shape, but a card with "+1/+1 plus X" can stack both.
     */
    X: z.enum(["treasures", "creatures", "lands"]).optional(),
    keywords: z.array(z.enum(TOKEN_KEYWORDS)).min(1).optional(),
    /**
     * Wave 4.8 follow-up 5 lane 71 (#2614 follow-up): the
     * protection-from-static arm. Each entry is a protection
     * quality (color or "everything") that the engine grants
     * to each affected permanent. The engine stamps the
     * values on the affected `CardInstance` per-instance
     * `protectionFrom: string[]` field
     * (`refreshScriptedStatics` in
     * `keyword-actions/scripted-statics.ts`); the existing
     * `hasProtectionFrom` / `canBeTargetedBy` / `canBeBlocked`
     * checks in `evergreen-keywords.ts` consult the new
     * field. v1 supports single-color protection
     * (`["red"]`) and the "everything" quality
     * (`["everything"]`); multi-color and
     * "choose-a-quality" protection are follow-up lanes.
     *
     * Sample card: a synthetic anthem registered via the
     * test harness with `protectionFrom: ["red"]` and
     * `affects: { controller: "you" }` ("Creatures you
     * control have protection from red"). A red creature +
     * a red spell verify the protection is honored at cast
     * time and combat time.
     */
    protectionFrom: z.array(z.string().min(1)).optional(),
    /**
     * Wave 4.8 follow-up 7 lane 75 (#2614 follow-up):
     * "as long as this is in play, it's a copy of [a chosen
     * permanent] until end of turn" (Sakashima-style /
     * manifested / disposition-of-copy). v1 single-target,
     * "all characteristics copied" semantics with a
     * turn-key duration. The engine stamps the target's
     * characteristics (name, type_line, power, toughness,
     * colors, keywords) onto the source's `cardData` via the
     * existing `animatedUntilEndOfTurn` infrastructure
     * (parallel to lane 66's `embedded_static` token
     * stamping + the
     * `clearUntilEndOfTurnPT` /
     * `restoreAnimatedOffBattlefield` rollback path).
     * `target: CardInstanceId` names the permanent whose
     * characteristics are copied; `until: "end_of_turn"`
     * sets the duration. The `staticAffects` check returns
     * true iff the source IS the target (self-only — the
     * source copies itself onto itself, swapping its own
     * printed characteristics for the named target's).
     *
     * Sample card: a synthetic static registered via the
     * test harness with `become_copy: { target: <Grizzly
     * Bears id>, until: "end_of_turn" }`. The source
     * permanently takes on the Grizzly Bears's name, type
     * line, P/T, colors, and keywords for the duration of
     * the turn; the rollback path restores the source's
     * printed cardData at the end of the turn (or when the
     * source / target leaves the battlefield).
     *
     * Out of scope (each a follow-up lane): chosen-target
     * copies (Cackling Counterpart — a `chosen_permanent`
     * field the engine resolves at resolution time),
     * named-card copies ("Becomes a copy of [card name]"),
     * copy-with-exception copies (Phyrexian Metamorph-style
     * "this creature is a [named card] in addition to its
     * other types"), nested copies (a target that itself
     * has a `become_copy` static), and Aura-shaped copies
     * ("enchanted creature is a copy of [target] until end
     * of turn" — a per-target instead of self-only shape).
     */
    become_copy: z
      .union([
        z
          .object({
            /**
             * v1: the `CardInstanceId` of the chosen
             * permanent on the battlefield to copy.
             * Lane 75 — Wave 4.8 follow-up 7
             * (#2614 follow-up). The named target
             * must be on the battlefield for the
             * overlay to take effect (the refresh
             * pass checks `state.cards.has(targetId)`).
             */
            target: z.string().min(1),
            until: z.literal("end_of_turn"),
            /**
             * Wave 4.8 follow-up 8 lane 75c
             * (#2614 follow-up): copy with
             * exception. Phyrexian Metamorph's
             * "It's a copy of [chosen permanent]
             * except it's a [named card] in
             * addition to its other types"
             * pattern. v1 supports a single
             * `add_subtype` arm — the engine
             * merges the subtype list onto the
             * source's overlaid `cardData.type_line`
             * after the lane 75 / 75b overlay
             * runs (rebuilding the type_line
             * as `<types> — <printed + added
             * subtypes>`). The lane 75
             * `animatedUntilEndOfTurn` rollback
             * restores the printed `cardData`
             * (and thus the printed type_line)
             * at end of turn / when the source
             * leaves the battlefield.
             *
             * Out of scope (each a follow-up
             * lane): `add_color` exceptions
             * ("it's red in addition to its
             * other colors"), `add_power` /
             * `add_toughness` exceptions ("it
             * has base power and toughness N
             * in addition to its other
             * characteristics"), `add_type`
             * exceptions ("it's an artifact in
             * addition to its other types"),
             * and multi-exception copies
             * ("is a copy except for [X] and
             * also [Y]").
             */
            exceptions: z
              .object({
                add_subtype: z
                  .array(z.string().min(1))
                  .min(1)
                  .optional(),
              })
              .strict()
              .optional(),
          })
          .strict(),
        z
          .object({
            /**
             * Wave 4.8 follow-up 8 lane 75b
             * (#2614 follow-up): "as long as this
             * is in play, it's a copy of [named
             * card] until end of turn" (Memnarch,
             * Clone Shell, the "named-card-copy"
             * subfamily of the until-EOT-copy
             * family). The named card's printed
             * `cardData` is looked up via the
             * `cardDataByName` registry helper
             * (parallel to how the engine reads
             * scripted statics from
             * `getCardScript`); missing-name is a
             * no-op (the source keeps its printed
             * `cardData`). The overlay + cleanup
             * path reuses the lane 75
             * `animatedUntilEndOfTurn`
             * infrastructure. The named card is
             * NOT required to be on the
             * battlefield (unlike `target` —
             * Memnarch names a card that's not in
             * play; the source takes on the named
             * card's printed characteristics for
             * the duration of the turn).
             *
             * Out of scope (each a follow-up
             * lane): multi-named copies ("becomes
             * a copy of [card name] or [other card
             * name]"), named-card copies with
             * exceptions ("becomes a copy of [card
             * name] except for [X]" — that's lane
             * 75c), and nested named copies (a
             * named-card copy of a card that
             * itself has a `become_copy` static —
             * that's lane 75e).
             */
            named_card: z
              .object({
                name: z.string().min(1),
              })
              .strict(),
            until: z.literal("end_of_turn"),
            /**
             * Wave 4.8 follow-up 8 lane 75c
             * (#2614 follow-up): copy-with-exception
             * on the named-card variant. Same
             * `add_subtype` semantics as the
             * lane 75 arm — the exception is applied
             * after the named-card overlay runs.
             * A synthetic named-card-with-exception
             * is the smallest v1 sample card.
             */
            exceptions: z
              .object({
                add_subtype: z
                  .array(z.string().min(1))
                  .min(1)
                  .optional(),
              })
              .strict()
              .optional(),
          })
          .strict(),
      ])
      .optional(),
  })
  .strict()
  .refine((s) => (s.power === undefined) === (s.toughness === undefined), {
    message: "set both power and toughness, or neither",
  })
  .refine(
    (s) =>
      s.power !== undefined ||
      s.keywords ||
      s.X !== undefined ||
      // Wave 4.7 phase 2 lane 50 (#2708 phase 2b): the
      // chosen-name block is a meta-static — allow it as a
      // stand-alone arm. See lane 50's `chosen_name_block`
      // docstring.
      s.affects.chosen_name_block === true ||
      // Wave 4.8 lane 52 (#2614 follow-up): chosen-type
      // addition is a pure type-changer — also a
      // meta-static, allowed as a stand-alone arm with the
      // `addCreatureTypeToSelf` flag.
      (s.affects.add_creature_type !== undefined &&
        s.affects.addCreatureTypeToSelf === true) ||
      // Wave 4.8 lane 55 (#2614 follow-up): chosen-color
      // addition is a pure color-changer — same
      // meta-static shape, allowed as a stand-alone arm
      // with the `addColorToSelf` flag. Redcap
      // Gutter-Dweller-style self-only semantics for v1.
      (s.affects.add_color !== undefined && s.affects.addColorToSelf === true) ||
      // Wave 4.8 follow-up 5 lane 71 (#2614 follow-up):
      // protection-from static is a meta-static — allow it
      // as a stand-alone arm. The protection is granted via
      // the per-instance `protectionFrom: string[]` field,
      // read by `hasProtectionFrom` alongside the parsed
      // keyword list (canonical contract — see
      // `keyword-actions/protection.ts`). No P/T or keyword
      // changes; the static only writes the new field.
      (s.protectionFrom?.length ?? 0) > 0 ||
      // Wave 4.8 follow-up 7 lane 75 (#2614 follow-up):
      // until-EOT copy static is a meta-static — allow it
      // as a stand-alone arm. The source swaps its own
      // printed characteristics for the target's at refresh
      // time via the `animatedUntilEndOfTurn` infra; the
      // EOT cleanup rolls them back. No P/T or keyword
      // changes of its own; the static only triggers the
      // copy swap.
      s.become_copy !== undefined,
    {
      message:
        "a static needs power/toughness, keywords, X, chosen_name_block, add_creature_type (with addCreatureTypeToSelf), add_color (with addColorToSelf), protectionFrom, or become_copy",
    },
  );

/**
 * A rule-changing static ability (#2614, Sunspine Lynx), CR 604.1: "Players
 * can't gain life" (CR 119.7) and "Damage can't be prevented" (CR 615.12).
 * Active while the source is on the battlefield.
 */
export const RULE_STATICS = [
  "players_cant_gain_life",
  "damage_cant_be_prevented",
] as const;

export const RuleStaticSchema = z
  .object({
    /** The static's line of oracle text. */
    text: z.string().min(1),
    rule: z.enum(RULE_STATICS),
  })
  .strict();

/**
 * The static ability an Equipment grants the equipped creature (issue
 * #2561). Layer 6 (keywords) and layer 7c (P/T), per CR 613.3 — same shape
 * as Aura bonuses in `refreshAuraBonuses`. No `affects`: the host is
 * whichever creature `attachedToId` points at.
 */
export const EquipmentStaticSchema = z
  .object({
    /** The static's oracle sentence, for review and drift checks. */
    text: z.string().min(1),
    power: z.number().int().optional(),
    toughness: z.number().int().optional(),
    keywords: z.array(z.enum(EQUIPMENT_KEYWORDS)).min(1).optional(),
  })
  .strict()
  .refine((s) => (s.power === undefined) === (s.toughness === undefined), {
    message: "set both power and toughness, or neither",
  })
  .refine((s) => s.power !== undefined || s.keywords, {
    message: "an equipment static needs power/toughness or keywords",
  });

/**
 * The static ability a scripted Aura grants the permanent it enchants
 * (issue #2568, CR 702.5 / 303.4). Layer 6 (keywords) and layer 7c (P/T),
 * per CR 613.3, applied in `refreshAuraBonuses` alongside the engine's
 * oracle-text Aura bonuses. No `affects`: the host is whichever permanent
 * `attachedToId` points at.
 *
 * v1 also covers Pacifism-style "can't attack / can't block" restrictions
 * via `restrictAttack` / `restrictBlock`. They ride the same refresh path
 * and are surfaced as `auraRestrictAttack` / `auraRestrictBlock` on the
 * enchanted card. `restrictUntap` is a forward-compat field (the engine
 * does not yet honor it; #2568 leaves the schema room for a follow-up
 * lane, e.g. Imprisoned in the Moon's "it doesn't untap" clause).
 */
export const AuraStaticSchema = z
  .object({
    /** The static's oracle sentence, for review and drift checks. */
    text: z.string().min(1),
    power: z.number().int().optional(),
    toughness: z.number().int().optional(),
    keywords: z.array(z.enum(EQUIPMENT_KEYWORDS)).min(1).optional(),
    /** "Enchanted creature can't attack." (Pacifism, issue #2568.) */
    restrictAttack: z.boolean().optional(),
    /** "Enchanted creature can't block." (Pacifism, issue #2568.) */
    restrictBlock: z.boolean().optional(),
    /** Forward-compat: "Enchanted permanent doesn't untap during its controller's untap step." */
    restrictUntap: z.boolean().optional(),
    /**
     * "Enchanted creature can't be blocked by more than one creature."
     * (Meltstrider's Resolve, #2614; CR 509.1b). Surfaced as
     * `auraMaxBlockers` on the enchanted card.
     */
    maxBlockers: z.literal(1).optional(),
    /**
     * Wave 4.8 lane 54 (#2614 follow-up): the enchanted
     * creature loses all its OTHER abilities. Witness
     * Protection: "Enchanted creature gets -1/-1 and can't
     * attack. *(It loses all other abilities.)*" — the
     * reminder text confirms the actual mechanic. The
     * engine stamps `losesAbilities: true` on the enchanted
     * card via `refreshAuraBonuses`; `canActivateAbility`
     * then denies the card's scripted activated abilities
     * (parallel to the lane 50 chosen-name gate on Spyglass).
     *
     * The gate only suppresses the card's OWN scripted
     * abilities (the card's `script.activated` /
     * `script.triggers`). The Aura's own static bonuses
     * (P/T, restrictions, keywords granted by the Aura
     * itself) stay — Witness Protection keeps granting
     * `-1/-1` and `can't attack` even though the enchanted
     * creature's own abilities are gone. (CR 613.1b: "Effects
     * from static abilities that set base characteristics
     * are applied first" — the Aura's continuous effect is
     * separate from the enchanted card's native
     * characteristics.)
     *
     * Triggered-ability gating is a follow-up multi-lane —
     * the trigger fire path requires a broader engine change
     * (deferred, see `wave4-blockers.md`).
     */
    removesAllAbilities: z.literal(true).optional(),
    /**
     * Wave 4.8 follow-up 3 lane 65 (#2614 follow-up):
     * "granting triggered abilities to other cards" (CR 603
     * / CR 702.15-style static abundance, e.g. Lifelink-
     * granting auras, Undying Malice, Fake Your Own Death).
     * The Aura's `grants.triggers` arms list scripted
     * triggers the Aura COPIES onto the enchanted card.
     * The engine stamps the list on the enchanted card via
     * `refreshAuraBonuses` as `card.grantedTriggers`; the
     * trigger fire path (`detectTriggeredAbilities`) reads
     * the list and fires each granted trigger alongside the
     * target's own scripted triggers. The grant is dropped
     * when the source leaves the battlefield (parallel to
     * the lane 52 `add_creature_type` pattern).
     *
     * v1 supports a single `event: "dies"` trigger with a
     * list of effect ops; the trigger fires when the
     * ENCHANTED CARD (not the Aura) dies, with the
     * enchanted card's controller as the trigger's
     * controller. Multi-event grants (e.g. "dies OR
     * attacks") and grants that reference the Aura's
     * controller are follow-up lanes. Sample card: a
     * synthetic Aura that grants "When enchanted creature
     * dies, draw a card" (test harness).
     */
    grants: z
      .object({
        triggers: z
          .array(
            z
              .object({
                event: z.enum(["dies"]),
                effects: z.array(EffectSchema).min(1),
              })
              .strict(),
          )
          .min(1)
          .optional(),
      })
      .strict()
      .optional(),
    /**
     * Wave 4.8 follow-up 6 lane 76 (#2614 follow-up): the
     * Aura-shaped protection-from arm. "Enchanted creature
     * has protection from [color]" / "Enchanted creature
     * has protection from [quality]" (Akoumep Halberd /
     * Niveous Wisps pattern — Auras that grant protection
     * to the enchanted creature). A parallel arm to the
     * lane 71 `StaticSchema.protectionFrom`; the engine
     * stamps the qualities on the enchanted card via
     * `refreshAuraBonuses`. The existing `hasProtectionFrom`
     * / `canBeTargetedBy` / `canBeBlocked` checks in
     * `evergreen-keywords.ts` consult the per-instance
     * `protectionFrom` ledger (which the Aura now writes
     * directly via the same `auraStaticAffected` pattern
     * `refreshScriptedStatics` uses for lane 71).
     *
     * v1 supports a single quality (`["red"]`); multi-
     * quality protection on Auras (`["red", "blue"]`) is
     * data-driven via the same `hasProtectionFrom`
     * `perInstance.some(...)` loop that lane 71 uses, so
     * no engine change is needed for the multi-quality
     * case (the schema accepts any length).
     *
     * Sample card: a synthetic Aura registered via the
     * test harness with `protectionFrom: ["red"]` and a
     * red creature + a red spell to verify the protection
     * is honored at cast time and combat time.
     */
    /**
     * Wave 4.8 follow-up 8 lane 75d (#2614 follow-up):
     * "Enchanted creature is a copy of [chosen permanent]
     * until end of turn" — the Aura-shaped
     * until-EOT-copy variant (parallel to lane 75's
     * `StaticSchema.become_copy` lane, but here it's a
     * per-enchanted-card overlay rather than a self-
     * overlay on the Aura itself). The engine writes
     * the overlay onto the ENCHANTED CARD via
     * `refreshAuraBonuses` (parallel to the lane 76
     * `protectionFrom` Arm and the lane 65
     * `grants.triggers` Arm) using the same
     * lane 75 `animatedUntilEndOfUntil` infrastructure
     * for EOT rollback.
     *
     * v1 supports the lane 75 `target: CardInstanceId`
     * arm only — the chosen permanent must be on the
     * battlefield at refresh time (the engine validates
     * `state.cards.has(targetId)`). The named-card
     * arm (lane 75b), the copy-with-exception arm
     * (lane 75c), and multi-Aura / multi-target
     * variants are follow-up lanes. The overlay is
     * dropped at end of turn via the existing
     * `clearUntilEndOfTurnPT` /
     * `restoreAnimatedOffBattlefield` rollback paths.
     *
     * Sample card: a synthetic Aura registered via
     * the test harness ("Enchanted creature is a copy
     * of [chosen creature] until end of turn.") with
     * a 2/2 Grizzly Bears on the battlefield to
     * verify the copy characteristics are honored
     * (overlay on the enchanted card's `cardData`).
     */
    become_copy: z
      .union([
        z
          .object({
            /**
             * The chosen permanent on the
             * battlefield to copy (CR 707.2
             * "all characteristics copied"
             * semantics, until end of turn).
             * Validated at refresh time via
             * `state.cards.has(targetId)` +
             * zone endsWith `"-battlefield"`.
             */
            target: z.string().min(1),
            until: z.literal("end_of_turn"),
          })
          .strict(),
      ])
      .optional(),
    protectionFrom: z.array(z.string().min(1)).optional(),
  })
  .strict()
  .refine((s) => (s.power === undefined) === (s.toughness === undefined), {
    message: "set both power and toughness, or neither",
  })
  .refine(
    (s) =>
      s.power !== undefined ||
      s.keywords ||
      s.restrictAttack ||
      s.restrictBlock ||
      s.restrictUntap ||
      s.maxBlockers !== undefined ||
      // Wave 4.8 lane 54 (#2614 follow-up): Witness
      // Protection's "loses all other abilities" arm
      // rides the Aura-shape path — it has no P/T and
      // no keywords; it's a pure ability-stripper. Allow
      // `removesAllAbilities: true` as a stand-alone arm
      // when the same Aura also has P/T or keywords
      // (Witness Protection: power: -1 + removes all).
      s.removesAllAbilities === true ||
      // Wave 4.8 follow-up 3 lane 65 (#2614 follow-up):
      // a granted-trigger Aura has no P/T and no
      // keywords; it's a pure ability-granter. Allow
      // `grants.triggers` as a stand-alone arm.
      (s.grants?.triggers?.length ?? 0) > 0 ||
      // Wave 4.8 follow-up 6 lane 76 (#2614 follow-up):
      // a protection-granting Aura has no P/T and no
      // keywords; it's a pure protection-granter
      // ("Enchanted creature has protection from red").
      // Allow `protectionFrom` as a stand-alone arm.
      (s.protectionFrom?.length ?? 0) > 0 ||
      // Wave 4.8 follow-up 8 lane 75d (#2614 follow-up):
      // an Aura-shaped "enchanted creature is a copy of
      // [chosen permanent] until end of turn" static has
      // no P/T and no keywords; it's a pure copy
      // overlay on the enchanted card. Allow
      // `become_copy` as a stand-alone arm (parallel to
      // the lane 75 `become_copy` on `StaticSchema`).
      // The engine writes the overlay onto the
      // enchanted card's `cardData` via
      // `refreshAuraBonuses` using the lane 75
      // `animatedUntilEndOfUntil` infrastructure.
      s.become_copy !== undefined,
    {
      message:
        "an aura static needs power/toughness, keywords, a restriction, maxBlockers, removesAllAbilities, grants, protectionFrom, or become_copy",
    },
  );

/**
 * An Equipment card (CR 301.5, #2561). Has exactly one `Equip` activated
 * ability ("{cost}: Attach this permanent to target creature you control.
 * Activate only as a sorcery", CR 702.6) and grants a static bonus to the
 * equipped creature. By default, the Equipment auto-attaches on ETB to a
 * creature the controller picks; the engine's existing `attachEquipment`
 * does the move and `refreshEquipmentBonuses` rewrites the host's bonuses.
 */
export const EquipmentSchema = z
  .object({
    /** The card's equip-related oracle text, for review and drift checks. */
    text: z.string().min(1),
    attachedStatic: EquipmentStaticSchema,
    /**
     * Whether the Equipment auto-attaches to a creature you control when it
     * enters the battlefield. The default `true` matches Auras (CR 303.4f)
     * and the "comes into play attached" wording some Equipment use; the
     * engine accepts `false` for cards that need an explicit Equip before
     * any bonus lands, like the rare Equipment with no "Equipped creature
     * gets ..." line and only a triggered ability that cares about its
     * host. The lane's chosen default is `true` (the prompt for #2561).
     */
    attachOnEnter: z.boolean().default(true),
    /**
     * The "Equip {cost}" activated ability. The `text` of this ability is
     * what the engine's `getEquipCost` parses when reading oracle text; the
     * scripted `effects` is the interpreter's `AttachEquipment` op.
     */
    equip: ActivatedSchema,
  })
  .strict();

/**
 * The synthetic ETB trigger an Equipment with `attachOnEnter: true` adds
 * to its scripted trigger list (#2561). The text is matched by
 * `getScriptedAbility`, so the resolver recognizes the stack object as
 * scripted and routes the `AttachEquipment` op. The same text is used by
 * `getScriptedTriggeredAbilities` in `abilities/parse.ts` when emitting
 * the parsed ability.
 */
export const EQUIPMENT_ATTACH_ON_ENTER_TEXT =
  "When this Equipment enters, attach it to target creature you control.";

/**
 * An Aura card (CR 702.5 / 303.4, issue #2568). Mirrors `EquipmentSchema`
 * for scripted Auras: an Aura always attaches at cast time to a chosen
 * target matching its "Enchant" line. The engine's existing `attachAura`
 * is called from the Aura ETB path in `spell-casting/resolve.ts`, and
 * `refreshAuraBonuses` reads the scripted `static` to write the enchanted
 * permanent's `auraPT` / `auraKeywords` (and the new
 * `auraRestrictAttack` / `auraRestrictBlock` for Pacifism-style auras).
 *
 * `target` defaults to "creature" — the only value the v1 sample cards
 * use. The engine's target-legality check still reads the card's
 * "Enchant" oracle line; the script is a forward-compat hint. "land" and
 * "planeswalker" are accepted by the schema and reserved for follow-up
 * lanes (Blanchwood Armor, Angelic Destiny).
 */
export const AuraSchema = z
  .object({
    /** The card's aura-related oracle text, for review and drift checks. */
    text: z.string().min(1),
    /**
     * What the Aura can be cast onto. Defaults to "creature"; the engine's
     * `parseEnchantRestriction` still reads the oracle line for the
     * authoritative check (this is a script-side filter for UI and
     * follow-up lanes).
     */
    target: z
      .enum(["creature", "land", "planeswalker", "permanent"])
      .default("creature"),
    /**
     * The "Enchanted [permanent] gets +N/+N, has [keyword], can't attack,
     * can't block" static, applied in layer 6 (keywords) and layer 7c
     * (P/T) per CR 613.3.
     */
    static: AuraStaticSchema,
  })
  .strict();

export const CardScriptSchema = z
  .object({
    /** Exact English card name, as on Scryfall. */
    name: z.string().min(1),
    /** Oracle text the script was written against, for review and drift checks. */
    oracle: z.string().min(1),
    /**
     * #2594 — "This spell can't be countered." (Curator of Destinies,
     * Koma, World-Eater, Sphinx of the Final Word.) When true, the
     * engine's `castSpell` stamps `cantBeCountered: true` on the
     * StackObject and `counterSpell` returns a clear "this spell
     * can't be countered" error. The drafter can also mirror the
     * clause in `oracle` and the legacy oracle-text parser will
     * detect it (see `parseCantBeCountered`).
     */
    cantBeCountered: z.boolean().optional(),
    /**
     * #2594 follow-up (lane 19): "This creature enters the
     * battlefield tapped." (Diregraf Ghoul — FDN #80.) When true,
     * the engine stamps `isTapped: true` on the card instance as
     * it enters the battlefield (via cast spell, `ReturnFromZone`
     * to the battlefield, or `SearchLibrary` with destination
     * battlefield). SearchLibrary's per-call `tapped` flag is
     * still respected as before — this top-level flag applies
     * regardless of how the card arrived.
     */
    entersTapped: z.boolean().optional(),
    /** Effects of an instant or sorcery, applied in order on resolution. */
    spell: effects.optional(),
    /** A modal instant or sorcery's modes, instead of `spell`. */
    modes: ModesSchema.optional(),
    /** A permanent's triggered abilities (the full list when present). */
    triggers: z.array(TriggerSchema).min(1).optional(),
    /** A permanent's activated abilities (the full list when present). */
    activated: z.array(ActivatedSchema).min(1).optional(),
    /** A permanent's static abilities (the full list when present). */
    statics: z.array(StaticSchema).min(1).optional(),
    /** Rule-changing statics ("Players can't gain life"), #2614. */
    rules: z.array(RuleStaticSchema).min(1).optional(),
    /**
     * An Equipment card (issue #2561). When set, the card has an
     * attached-creature static and an "Equip" activated ability; the schema
     * fills in the equip ability and the auto-attach-on-ETB flag. May
     * coexist with `triggers` and `statics` for equipment that also has
     * other abilities (e.g. Goldvein Pick's "whenever equipped creature
     * attacks" trigger).
     */
    equipment: EquipmentSchema.optional(),
    /**
     * An Aura card (CR 702.5 / 303.4, issue #2568). When set, the card's
     * "Enchanted [permanent] ..." static is read from the script and
     * applied in `refreshAuraBonuses`. Auras and Equipment are mutually
     * exclusive — a card can't be both an Aura and an Equipment.
     */
    aura: AuraSchema.optional(),
    /**
     * Cycling (CR 702.30 + 702.31 for the typecycling/landcycling
     * variants, issue #2566): a discard-this-card activated ability from
     * the hand. "Cycling {cost}" draws a card; "[Type]cycling {cost}"
     * searches the library for a card of the named type;
     * "Landcycling {cost}" / "Basic landcycling {cost}" search for a
     * (basic) land.
     *
     * The `cost` is the printed cycling mana cost (e.g. "{2}", "{1}{U}").
     * `variant` defaults to base cycling. `type` is required for
     * typecycling (the named card type, e.g. "Wizard"). `basicLandType` is
     * required for "[Type] landcycling" (e.g. "Island") and optional for
     * the bare "Landcycling" form.
     *
     * v1 limitation: the engine's `cycleCard` still reads the cycling
     * keyword from `card.cardData.oracle_text` (existing `parseCycling`
     * path, #2566). The script's `cycling` field is the structured form
     * the drafter writes; the LLM should mirror the cycling line into
     * the `oracle` field too so the engine can find it. A future lane
     * will thread the script's cycling data into `cycleCard` directly
     * so the oracle-text fallback is no longer required.
     */
    cycling: z
      .object({
        cost: z.string().regex(/^(\{(?:[0-9]+|[WUBRGC])\})+$/),
        variant: z
          .enum(["cycling", "typecycling", "landcycling", "basic_landcycling"])
          .default("cycling"),
        /** Typecycling only: the named card type (e.g. "Wizard"). */
        type: z.string().min(1).optional(),
        /**
         * Landcycling: the basic land type (e.g. "Island" for
         * "Island landcycling"). Omit for the bare "Landcycling" form
         * (any land).
         */
        basicLandType: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    /**
     * Wave 4.8 follow-up lane 59 (#2614 follow-up): "enters
     * with N counters, one for each creature you control of
     * chosen subtype X" (Banner of Kinship). The card
     * carries an `enter_choice: { kind: "creature_type" }`
     * (Wave 4.7 follow-up lane 44, #2705a) so the player
     * picks a creature type on ETB; this field tells the
     * engine to stamp N counters of `counter` type on the
     * source itself at ETB, where N is the count of
     * chosen-subtype creatures the entering card's
     * controller controls AT THE MOMENT the choice
     * resolves (Banner of Kinship's "enters with X
     * counters on it, where X is the number of creatures
     * you control of the chosen type").
     *
     * `subtype: "chosen"` reads `card.chosenCreatureType`
     * (set by `resolveEnterChoice` for `kind:
     * "creature_type"`). `subtype: "<string>"` would be
     * a literal creature type — Banner of Kinship uses
     * the chosen sentinel. `counter` is the counter type
     * (Banner of Kinship uses `"+1/+1"`; +1/+1 is the
     * only counter type the engine models today).
     *
     * The field is paired with `enter_choice` — a card
     * that opts into the counter-stamping arm MUST also
     * have `enter_choice: { kind: "creature_type" }` so
     * `card.chosenCreatureType` is set at ETB. The
     * engine stamps the counters in
     * `resolveEnterChoice` (post-stamp, before the
     * waiting choice clears). The field is the small-
     * scope per-card opt-in (mirrors lane 52's
     * `addCreatureTypeToSelf` + lane 55's
     * `addColorToSelf` flags).
     */
    enters_with_counters_per_match: z
      .object({
        subtype: z.union([z.string().min(1), z.literal("chosen")]),
        counter: z.string().min(1),
      })
      .strict()
      .optional(),
    /**
     * Wave 4.8 follow-up 4 lane 67 (#2614 follow-up): generalize
     * the existing `instanceCounters` ledger (lane 59) to support
     * arbitrary named counter types at ETB. The script declares
     * a list of `{ counter, count }` pairs and the engine stamps
     * each pair on the entering card's `instanceCounters` ledger
     * (and, for backward compatibility with the existing
     * `untapOrRemoveStun` / `getEffectivePower` paths that read
     * `card.counters`, also mirrors the counter onto the legacy
     * `card.counters` list). The v1 enum of supported counter
     * types: `"+1/+1"`, `"-1/-1"`, `"stun"` (CR 122.1d), and
     * `"finality"` (CR 122.1d). Other counter types
     * (`"charge"`, `"time"`, `"lore"`, etc.) are follow-up lanes.
     *
     * v1 supports a single `enters_with_counters: [{ counter, count }]`
     * field on the script (parallel to the lane 59
     * `enters_with_counters_per_match` pattern but without the
     * per-match N computation — the script declares the count
     * directly). The per-turn stun-removal (the active decrement
     * of a stun counter during the untap step) and the
     * finality-skipping effect (blocking graveyard recursion) are
     * follow-up lanes; v1 stamps the counter on both ledgers
     * (`instanceCounters` and `card.counters`) so the existing
     * untap-skip path picks up the stun counter immediately
     * (legacy `SearchLibrary.stun` substrate uses `card.counters`
     * — the new path mirrors to it for the same reason).
     *
     * Sample card: a synthetic 1/1 creature that enters with one
     * stun counter via `enters_with_counters: [{ counter: "stun",
     * count: 1 }]`. The engine stamps both ledgers; the next
     * untap step sees the stun counter and decrements it
     * (the legacy `untapOrRemoveStun` behavior; the actual
     * per-turn removal logic already exists, no new untap wiring
     * needed for v1).
     */
    enters_with_counters: z
      .array(
        z
          .object({
            counter: z.enum(["+1/+1", "-1/-1", "stun", "finality"]),
            count: z.number().int().min(1),
          })
          .strict(),
      )
      .min(1)
      .optional(),
    /**
     * Flashback (CR 702.143) — an alternative cost: "you may cast this card
     * from your graveyard for its flashback cost. If you do, exile it instead
     * of putting it anywhere else any time it would leave the stack." Only
     * legal on instants and sorceries (the same set `spell`/`modes`
     * describes); the engine reads the cost from `cost` when the player
     * chooses the flashback alternative, and applies the exile redirect on
     * resolution via `StackObject.alternativeCostsUsed`. `destinations` is
     * fixed to "exile" — flashback always exiles (CR 702.143a).
     */
    flashback: z
      .object({
        cost: z.string().regex(/^(\{(?:[0-9]+|[WUBRGC])\})+$/),
        destinations: z
          .object({
            on_resolution: z.literal("exile"),
          })
          .strict(),
      })
      .strict()
      .optional(),
    /**
     * Wave 4.8 follow-up 4 lane 68 (#2614 follow-up): generalize
     * the "cast from a non-hand zone" pattern (Evoke, Flashback,
     * Jump-Start, Undergrowth, Escape, As Foretold, Yawgmoth's
     * Vile Offer). The v0 substrate is the per-keyword `flashback`
     * and `harmonize` fields; lane 68 unifies the castable-from
     * zone as a script-level `castable_from: ["exile" | "graveyard"
     * | "command"]` array.
     *
     * v1 supports a SINGLE entry in the array (multi-zone
     * casting is a follow-up lane). The engine reads the
     * field at cast time (`canCastSpell` extends to accept the
     * card from any named zone) and at resolve time (the
     * post-resolution end zone is inferred from the source:
     * `castable_from: ["graveyard"]` → exile, `castable_from:
     * ["exile"]` → exile, `castable_from: ["command"]` →
     * command). The end zone is implicit for v1; a future
     * lane can extend the field with an explicit
     * `end_zone` arm.
     *
     * v1 ships the standard printed mana cost (no
     * `cost` arm; the v0 `flashback.cost` field still works
     * alongside — the engine uses the flashback cost when
     * both are set, mirroring how the lane 22 / 23 / 24
     * additional-costs arms compose with the printed mana
     * cost). The cast-time legality check just confirms the
     * card is in one of the named zones; the resolve-time
     * redirect routes the card to the right end zone.
     *
     * Sample card: a synthetic 1/1 creature that can be cast
     * from exile via `castable_from: ["exile"]` (foretell-
     * style). The engine accepts the cast when the card is in
     * exile and routes it back to exile on resolution (foretell
     * keeps the card in exile after resolution). A flashback-
     * style sample (`castable_from: ["graveyard"]`) would
     * accept the cast when the card is in the graveyard and
     * route it to exile on resolution.
     */
    castable_from: z
      .array(z.enum(["exile", "graveyard", "command"]))
      .min(1)
      .max(1)
      .optional(),
    /**
     * Harmonize (CR 702.180) — "You may cast this card from your graveyard
     * for its harmonize cost. You may tap a creature you control to reduce
     * that cost by {X}, where X is its power. Then exile this spell."
     * Instants and sorceries only, like flashback.
     */
    /**
     * Affinity for <subtype> / <color> (CR 702.41; #2614 Sapling
     * Nursery; Wave 4.8 follow-up 3 lane 64 — Dragonlord's Servant,
     * Claws Out, Archmage of Runes, Mocking Sprite, Bolt Bend, Arcane
     * Epiphany). The spell's printed generic mana cost is reduced
     * by `reduction_per_match` for each matching card the controller
     * controls at cast time. v1 supports:
     *
     *  - `subtype: "<subtype>"` — the lane 22 / Sapling Nursery
     *    shape. Counts cards whose type line lists `<subtype>`.
     *    Default `reduction_per_match` is 1 (CR 702.41a: "This
     *    spell costs {1} less to cast for each..."); an explicit
     *    `reduction_per_match` overrides it for non-default
     *    affinity cards.
     *
     *  - `color: "W"|"U"|"B"|"R"|"G"|"any"` — the lane 64
     *    color-based shape. Counts cards the controller controls
     *    whose colors include `color` (`"any"` matches any
     *    non-colorless card). Default `reduction_per_match` is 1.
     *    Multi-color affinity discounts (e.g. "Affinity for
     *    artifacts and creatures") are a follow-up lane.
     *
     * The reduction is applied at cast time, after alternative
     * costs but before the can-cast legality check. Only generic
     * mana is reduced (CR 702.41a, 601.2f); the cost can't drop
     * below {0} (the rest of the cost is colored, and the affinity
     * discount can drive the total to 0 — Claws Out
     * (`{3}{R}{R}` with affinity for artifacts prints `{R}`
     * reduced typically). Going below `0` is illegal per CR 601.2f.
     */
    affinity: z
      .union([
        z
          .object({
            subtype: z.string().min(1),
            /**
             * Per-match reduction. Default `1` matches CR 702.41a
             * ("This spell costs {1} less to cast for each ...").
             * An explicit value covers non-default affinity cards
             * in the same family.
             */
            reduction_per_match: z.number().int().min(1).max(99).default(1),
          })
          .strict(),
        z
          .object({
            color: z.enum(["W", "U", "B", "R", "G", "any"]),
            /**
             * Per-match reduction. Default `1`; explicit values
             * cover non-default affinity cards in the same family.
             */
            reduction_per_match: z.number().int().min(1).max(99).default(1),
          })
          .strict(),
      ])
      .optional(),
    /**
     * Land-play statics while this permanent is on the battlefield (#2614
     * Icetill Explorer): "You may play an additional land on each of your
     * turns" (`extra_land_plays`, CR 305.2) and "You may play lands from your
     * graveyard" (`from_graveyard`).
     */
    /**
     * "As long as there are N or more card types among cards exiled with
     * this creature, it gets +P/+T and has ..." (#2614 Keen-Eyed Curator,
     * CR 607.2a). Cards this permanent's scripted Exile effects exile are
     * linked to it; the bonus applies to itself only.
     */
    exiled_types_bonus: z
      .object({
        text: z.string().min(1),
        min_types: z.number().int().min(1).max(9),
        power: z.number().int(),
        toughness: z.number().int(),
        keywords: z.array(z.enum(TOKEN_KEYWORDS)).min(1).optional(),
      })
      .strict()
      .optional(),
    land_rules: z
      .object({
        extra_land_plays: z.number().int().min(1).max(2).optional(),
        from_graveyard: z.literal(true).optional(),
      })
      .strict()
      .refine((r) => r.extra_land_plays !== undefined || r.from_graveyard, {
        message: "land_rules needs extra_land_plays or from_graveyard",
      })
      .optional(),
    harmonize: z
      .object({
        cost: z.string().regex(/^(\{(?:[0-9]+|[WUBRGC])\})+$/),
      })
      .strict()
      .optional(),
    /**
     * Warp (CR 702.185, #2614) — "You may cast this card from your hand for
     * its warp cost. Exile this permanent at the beginning of the next end
     * step, then you may cast it from exile on a later turn." `cost` is a
     * mana-string like `flashback.cost`. Permanent scripts only.
     */
    warp: z
      .object({
        cost: z.string().regex(/^(\{(?:[0-9]+|[WUBRGC])\})+$/),
      })
      .strict()
      .optional(),
    /**
     * Kicker (CR 702.32, #2564) — a single optional additional cost. "You may
     * pay an additional cost as you cast this spell. If you do, [its bonus
     * effect occurs]." `cost` is a mana-string in the same shape as
     * `flashback.cost`. `count` is the number of times the cost may be paid:
     * single-kicker is `count: 1` (the default); multikicker (CR 702.85,
     * #2594) sets `count` to a positive integer (e.g. `count: 3` for
     * "Multikicker {1}"). The cast flow charges `cost * count` mana and
     * stamps `StackObject.timesKicked` (and the card's `timesKicked`) with
     * the actual charge count; the interpreter then applies the script's
     * effects whose `if_kicked` gate matches the count.
     */
    kicker: z
      .object({
        cost: z.string().regex(/^(\{(?:[0-9]+|[WUBRGC])\})+$/),
        /**
         * Number of times the kicker cost may be paid. `1` (default) is
         * single-kicker; `>= 2` is multikicker. Bounded to a positive
         * integer; the engine itself enforces the practical upper bound
         * from the player's available mana.
         */
        count: z.number().int().min(1).default(1),
      })
      .strict()
      .optional(),
    /**
     * Generic additional-cost slot (#2564). Arms: `kicker` (CR 702.32;
     * single- and multi-kicker), `offspring` (CR 702.169), and the
     * Wave 4.8 follow-up 3 lane 63 `pay_life` and `sacrifice` arms
     * (CR 118.4 + CR 602, "Pay N life" / "Sacrifice a [thing]" for
     * instants / sorceries such as Painful Truths).
     */
    additionalCosts: z
      .object({
        kicker: z
          .object({
            cost: z.string().regex(/^(\{(?:[0-9]+|[WUBRGC])\})+$/),
            /** 1 for single-kicker, >=2 for multikicker (see top-level kicker). */
            count: z.number().int().min(1).default(1),
          })
          .strict()
          .optional(),
        offspring: z
          .object({
            createToken: z
              .object({
                count: z.literal(1),
                power: z.literal(1),
                toughness: z.literal(1),
                color: z.union([tokenColor, z.literal("colorless")]).optional(),
                keywords: z.array(z.enum(TOKEN_KEYWORDS)).optional(),
              })
              .strict(),
          })
          .strict()
          .optional(),
        /**
         * #2614 follow-up (Wave 4.8 follow-up 3 lane 63): "Pay N life"
         * as an additional cost (CR 118.4). Deducts `amount` at cast
         * time; "Not enough life" if life < `amount`. Sample: Painful
         * Truths.
         */
        pay_life: z
          .object({
            amount: z.number().int().min(1).max(99),
          })
          .strict()
          .optional(),
        /**
         * #2614 follow-up (Wave 4.8 follow-up 3 lane 63):
         * "Sacrifice a [thing] as an additional cost" (CR 602).
         * `target` matches the lane 17 `cost.sacrifice_permanents.type`
         * enum; per-subtype sacrifice is a follow-up.
         */
        sacrifice: z
          .object({
            amount: z.number().int().min(1).max(9),
            target: z.enum([
              "self",
              "creature",
              "artifact",
              "enchantment",
              "permanent",
            ]),
          })
          .strict()
          .optional(),
        /**
         * #2614 follow-up (Wave 4.8 follow-up 5 lane 69): "Pay the
         * generic portion of this spell's cost using only [color(s)]"
         * (the mana-restriction family — Force of Will, Cabal
         * Therapy, the Storm-Crow specter pattern). Records an
         * X-restriction on the cast: the player may pay the
         * spell's generic mana cost using only the named color(s),
         * and the cost is reduced by the named `generic` amount
         * (the v1 minimum is a single-color restriction with a
         * single generic reduction). The cast-time legality
         * check rejects the cast if the player can't pay the cost
         * with the restricted colors. The deduction happens at
         * cast time via the color-restricted mana payment path;
         * the per-instance `manaRestriction` field on the
         * StackObject carries the same shape so resolve-time
         * effects can reference it.
         *
         * Sample card: a synthetic instant with
         * `mana_restriction: { colors: ["U"], generic: 1 }` and a
         * printed cost of `{U}{U}` (the player may pay `{U}{U}`
         * normally, OR pay the generic 1 in blue and the second
         * U in any color — the v1 minimum). Out of scope (each a
         * follow-up lane): multi-color restrictions
         * (`colors: ["U", "B"]`), per-spell color substitutions,
         * hybrid mana costs, Phyrexian mana costs.
         */
        mana_restriction: z
          .object({
            /**
             * Restriction colors. v1 enforces exactly one entry;
             * multi-color restrictions are a follow-up lane.
             */
            colors: z
              .array(z.enum(["W", "U", "B", "R", "G"]))
              .length(1),
            /**
             * Amount of generic mana the player may pay using only
             * the named color(s). v1 minimum: 1 (matches a single
             * generic pip).
             */
            generic: z.number().int().min(1).max(99),
          })
          .strict()
          .optional(),
        /**
         * Wave 4.8 follow-up 6 lane 72 (#2614 follow-up): the
         * "pay the generic portion of this spell's cost by tapping a
         * creature you control" pattern (Llawan, War Tax — the
         * "spend this mana only on creature spells" / "creature
         * spells cost {1} more to cast" / "tap an untapped creature
         * you control rather than pay that cost" family). Records
         * a creature-only payment restriction on the cast: the
         * player may pay the spell's `generic` mana by tapping
         * `generic` untapped creatures they control (one creature
         * per generic). v1 minimum is a single tap-for-generic
         * reduction; multi-color creature pools ("only blue
         * creatures may pay"), per-creature-type pools ("only
         * Goblins may pay"), and opponent-only creature pools
         * ("your opponents' creatures may pay") are separate
         * follow-up lanes.
         *
         * Auto-apply semantics (parallel to lane 69's
         * `mana_restriction`): if the player CAN pay the printed
         * cost, the engine does NOT apply the creature payment
         * (the printed cost is the cheaper path). If the player
         * CANNOT pay the printed cost, but CAN tap `generic`
         * untapped creatures they control, the engine applies
         * the creature payment: tap the creatures, reduce
         * `totalGeneric` by `generic`. The cast fails ("Not
         * enough energy (mana) available.") if the player
         * cannot pay the cost under either path AND cannot tap
         * enough creatures.
         *
         * Sample card: a synthetic instant with
         * `creature_payment: { creature_only: true, generic: 1 }`
         * and a printed cost of `{1}{B}` (the player may pay
         * `{1}{B}` normally, OR tap an untapped creature they
         * control to pay the generic 1 — the v1 minimum).
         */
        creature_payment: z
          .object({
            /**
             * v1 minimum: `true` (the cost may be paid only by
             * tapping creatures the controller controls). A
             * `false` value is meaningless; the field exists
             * for forward compatibility (a follow-up lane could
             * add a multi-shape variant).
             */
            creature_only: z.literal(true),
            /**
             * Number of generic mana the player may pay by
             * tapping creatures. v1 minimum: 1 (matches a
             * single generic pip).
             */
            generic: z.number().int().min(1).max(99),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    /**
     * "As this [permanent] enters, choose a [thing]" (Wave 4.7 lane 39).
     * A general-purpose enter-time choice pattern that surfaces a
     * `waitingChoice` of shape `{ kind: "enter_choice", cardId, ... }`
     * to the controller as the permanent enters the battlefield. The
     * resolver (`resolveEnterChoice`, in `keyword-actions/enters.ts`)
     * stamps the chosen value on the card instance so later
     * applications (statics, AddMana) can substitute the choice.
     *
     * v1 supports `kind: "color"` (W | U | B | R | G; Wave 4.7 lane
     * 39) and `kind: "creature_type"` (Wave 4.7 follow-up lane 44,
     * #2705a; curated list of 10 types). The `player` arm is
     * documented but not yet implemented in the engine — schema
     * accepts it for forward compatibility, but
     * `resolveEnterChoice` returns a friendly error if a card
     * opts in.
     *
     * `kind: "chosen_name"` (Wave 4.7 follow-up lane 48 schema
     * baseline, #2708 phase 1) is the Sorcerous Spyglass pattern
     * — "as this enters, look at an opponent's hand, then choose
     * a card name". The schema accepts the enum value for
     * forward compatibility; the full engine arm
     * (look-at-hand, pick-a-card-name, stamp a chosen-name
     * static) is multi-lane and tracks under #2708. Cards that
     * opt in here today see `resolveEnterChoice` return a
     * "not yet supported" error — same shape as the `player`
     * arm. Phase 1 only adds the schema enum + a default-null
     * `chosenCardName` field on `CardInstance`.
     *
     * `kind: "color_and_creature_type"` (Wave 4.8 follow-up lane
     * 56, #2614 follow-up) is the compound arm for "as this
     * enters, choose a color AND a creature type" (Eaten by
     * Piranhas). The engine surfaces ONE waitingChoice whose
     * options are the cross-product of color × creature type;
     * the resolver writes BOTH `chosenColor` and
     * `chosenCreatureType` from one resolver call. Same downstream
     * substitutions as the singletons: chosen-color anthem
     * (lane 40) reads `chosenColor`; chosen-type anthem
     * (lane 45) reads `chosenCreatureType`; chosen-type
     * addition (lane 52) reads `chosenCreatureType`; chosen-color
     * addition (lane 55) reads `chosenColor`.
     *
     * Sample cards: Heraldic Banner (FDN #532, lanes 40 + 41)
     * uses `enter_choice: { kind: "color" }` together with the
     * chosen-color anthem and the chosen-color AddMana; Banner
     * of Kinship / Adaptive Automaton (lanes 44 + 45) use
     * `enter_choice: { kind: "creature_type" }` together with
     * the chosen-type anthem. The bare-arm sample card `Test
     * Goggles` exercises ONLY the engine arm with no other
     * effects. Eaten by Piranhas
     * (`cards/eaten_by_piranhas.json`) exercises the
     * `color_and_creature_type` compound arm with both halves
     * (chosen-color anthem + chosen-type anthem).
     */
    enter_choice: z
      .object({
        kind: z.enum([
          "color",
          "creature_type",
          "player",
          "chosen_name",
          "color_and_creature_type",
        ]),
        /**
         * Free-form text the drafter wants surfaced in the prompt and
         * the lane's chosen-value validation. For `kind: "color"`, the
         * engine normalises the choice against the canonical W/U/B/R/G
         * enum; the field is for review/drift checks today.
         */
        text: z.string().min(1),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (s) =>
      s.spell ||
      s.modes ||
      s.triggers ||
      s.activated ||
      s.statics ||
      s.rules ||
      s.equipment ||
      s.aura ||
      // #2566: a card with only `cycling` (no other ability) is legal —
      // e.g. "Hill Gigas" is a creature with just Cycling {2}. The
      // engine exposes the cycling ability via `getActivatedAbilities`
      // from the script's `cycling` field.
      // Wave 4.7 lane 39: a card with only `enter_choice` is also
      // legal — it's a placeholder for the engine arm until lanes
      // 40/41 wire anthem/AddMana on top.
      // Wave 4.8 follow-up 4 lane 67 (#2614 follow-up): a card
      // with only `enters_with_counters` is also legal — it's
      // a placeholder for the generalized stun / finality
      // counter stamping (the v0 substrate is the
      // `SearchLibrary.stun` arm which writes to `card.counters`;
      // the v1 schema arm declares the counter at ETB and the
      // engine stamps both `instanceCounters` and `card.counters`).
      s.cycling ||
      s.enter_choice ||
      s.enters_with_counters,
    {
      message:
        "a card script needs spell, modes, triggers, activated, statics, rules, equipment, aura, cycling, enter_choice, or enters_with_counters",
    },
  )
  .refine(
    (s) =>
      !(
        (s.spell || s.modes) &&
        (s.triggers || s.activated || s.statics || s.rules)
      ),
    { message: "a spell script can't also have permanent abilities" },
  )
  .refine((s) => !(s.spell && s.modes), {
    message: "a spell script has spell or modes, not both",
  })
  .refine(
    (s) =>
      s.flashback === undefined ||
      s.spell !== undefined ||
      s.modes !== undefined,
    { message: "flashback is only for instant or sorcery scripts" },
  )
  .refine(
    (s) =>
      s.harmonize === undefined ||
      s.spell !== undefined ||
      s.modes !== undefined,
    { message: "harmonize is only for instant or sorcery scripts" },
  )
  .refine(
    (s) =>
      s.warp === undefined || (s.spell === undefined && s.modes === undefined),
    { message: "warp is only for permanent scripts" },
  )
  .refine((s) => !(s.aura && s.equipment), {
    message: "a card is an aura or an equipment, not both",
  })
  .refine(
    (s) =>
      s.kicker === undefined ||
      s.spell !== undefined ||
      s.modes !== undefined ||
      s.triggers !== undefined,
    {
      message:
        "kicker is only for instant, sorcery, or enters-the-battlefield permanent scripts",
    },
  );

export type CardEffect = z.infer<typeof EffectSchema>;
export type CardScript = z.infer<typeof CardScriptSchema>;
export type ScriptedTrigger = z.infer<typeof TriggerSchema>;
export type ScriptedActivated = z.infer<typeof ActivatedSchema>;
export type ScriptedStatic = z.infer<typeof StaticSchema>;
export type ScriptedRuleStatic = z.infer<typeof RuleStaticSchema>;
export type RuleStatic = (typeof RULE_STATICS)[number];
export type ScriptedModes = z.infer<typeof ModesSchema>;
export type ScriptedEquipment = z.infer<typeof EquipmentSchema>;
export type ScriptedEquipmentStatic = z.infer<typeof EquipmentStaticSchema>;
export type ScriptedAura = z.infer<typeof AuraSchema>;
export type ScriptedAuraStatic = z.infer<typeof AuraStaticSchema>;

export {
  isPermanentScript,
  isTargetedEffect,
  effectTargetCount,
  modalEffects,
  modeChoiceError,
  modeLabelKey,
  scriptedAbilityEffects,
  scriptedModeChoiceError,
  scriptedSpellEffects,
} from "./script-guards";
