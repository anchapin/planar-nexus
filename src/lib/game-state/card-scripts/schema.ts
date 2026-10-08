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

export const DrawSchema = z
  .object({
    op: z.literal("Draw"),
    amount: xAmount,
    who: z.enum(["you", "target_player"]).default("you"),
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
      .enum(["you", "target_player", "each_opponent"])
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
    if_kicked: ifKicked,
  })
  .strict()
  .refine((t) => (t.color === undefined) !== (t.colors === undefined), {
    message: "set exactly one of color or colors",
  });

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
     */
    fromZone: z
      .enum(["battlefield", "graveyard", "opponent_graveyard"])
      .optional(),
    /**
     * With fromZone graveyard: whose graveyard the target card comes from
     * (#2614 Keen-Eyed Curator: "target card from a graveyard" is any).
     * Unset keeps the older targeting.
     */
    graveyard: z.enum(["you", "any"]).optional(),
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
 * Return a card from a non-battlefield zone to the battlefield (#2560).
 * Currently only `from: "graveyard"` and `to: "battlefield"` are supported,
 * covering the 46 cards in the op frontier (BLB/FDN/FIN/MKM/SOS/TDC).
 *
 * The `target` is a card in the chosen graveyard. `filter` narrows which
 * cards may be picked: `creature` (only creatures), `mv_le` (mana value
 * at most N — "creature card with mana value 2 or less"), and `controller`
 * ("you" for your graveyard, "opponent" for an opponent's). The card
 * returns under its owner's control (CR 400.3), fires ETB triggers
 * normally, and gets "enters with" counters via the engine's
 * `applyEntersWithCounters` (CR 614.1c).
 *
 * `count` is the number of cards to return. With the default of 1, the
 * player picks a single target card; the effect does not silently move
 * others. Only `count: 1` is exercised by today's 46 cards.
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
    count: xCount.optional(),
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
    target: z.enum(["spell"]),
    /**
     * #2594 follow-up: "counter target red or green spell" filter
     * (Flashfreeze — FDN #590). When set, the targeted spell's
     * source card must have at least one color in this list on its
     * color identity. An empty array is rejected; the field is
     * optional and defaults to no filter (the existing
     * counter-anything behavior).
     */
    colors: z
      .array(z.enum(["W", "U", "B", "R", "G"]))
      .min(1)
      .optional(),
    if_kicked: ifKicked,
  })
  .strict();

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
    /** self: the permanent the ability belongs to (untargeted). */
    target: z.enum(["creature", "self"]),
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
    /** Only +1/+1 counters for now. */
    counter: z.literal("+1/+1"),
    amount: xCount,
    target: z.enum(["creature", "self"]),
    controller,
    if_kicked: ifKicked,
  })
  .strict()
  .refine(
    (e) => e.controller === undefined || e.target === "creature",
    controllerNeedsCreatureTarget,
  );

/**
 * Put the top N cards of a library into its owner's graveyard (#2534).
 * Milling more cards than the library holds mills what is there.
 */
export const MillSchema = z
  .object({
    op: z.literal("Mill"),
    amount: xCount,
    who: z.enum(["you", "target_player", "each_opponent"]).default("you"),
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
    who: z.enum(["you", "target_player", "each_opponent"]).default("you"),
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
 */
export const CopySpellSchema = z
  .object({
    op: z.literal("CopySpell"),
    gain: z
      .array(z.enum(["wither"]))
      .min(1)
      .optional(),
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
    colors: z.union([z.array(z.enum(MANA_SYMBOLS)).min(1), z.literal("any")]),
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

export const EffectSchema = z.discriminatedUnion("op", [
  DealDamageSchema,
  DrawSchema,
  GainLifeSchema,
  LoseLifeSchema,
  CreateTokenSchema,
  CreatePredefinedTokenSchema,
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
    /** crime only: "This ability triggers only once each turn." */
    once_per_turn: z.literal(true).optional(),
    /** cast only: "a spell with a single target" (exactly one target). */
    targets: z.literal("single").optional(),
    effects: effects.optional(),
    /**
     * A modal ability ("When this creature enters, choose one —"), instead of
     * `effects`. The controller picks the modes as it goes on the stack
     * (CR 603.3c, 700.2a); `text` is then the line up to the dash.
     */
    modes: ModesSchema.optional(),
  })
  .strict()
  .refine((t) => (t.effects === undefined) !== (t.modes === undefined), {
    message: "a trigger has effects or modes, exactly one",
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
        t.targets === undefined),
    { message: "caster, spell and targets are only for cast triggers" },
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
              .enum(["Creature", "Artifact", "Enchantment", "Land", "Planeswalker"])
              .optional(),
          })
          .strict()
          .refine(
            (s) =>
              Boolean(s.subtype) !== Boolean(s.type),
            {
              message: "sacrifice_permanents needs exactly one of subtype or type",
            },
          )
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
        /** Only creatures with this creature type, singular ("Dinosaur"). */
        subtype: z.string().min(1).optional(),
      })
      .strict(),
    power: z.number().int().optional(),
    toughness: z.number().int().optional(),
    keywords: z.array(z.enum(TOKEN_KEYWORDS)).min(1).optional(),
  })
  .strict()
  .refine((s) => (s.power === undefined) === (s.toughness === undefined), {
    message: "set both power and toughness, or neither",
  })
  .refine((s) => s.power !== undefined || s.keywords, {
    message: "a static needs power/toughness or keywords",
  });

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
      s.maxBlockers !== undefined,
    {
      message:
        "an aura static needs power/toughness, keywords, or a restriction",
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
     * Harmonize (CR 702.180) — "You may cast this card from your graveyard
     * for its harmonize cost. You may tap a creature you control to reduce
     * that cost by {X}, where X is its power. Then exile this spell."
     * Instants and sorceries only, like flashback.
     */
    /**
     * Affinity for <subtype> (CR 702.41, #2614 Sapling Nursery) — "This
     * spell costs {1} less to cast for each <subtype> you control." Only
     * generic mana is reduced.
     */
    affinity: z
      .object({
        subtype: z.string().min(1),
      })
      .strict()
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
     * Generic additional-cost slot (#2564). Today the only arm that has its
     * own schema is `offspring` (CR 702.169; flagged for a follow-up lane).
     * `kicker` is also accessible as `additionalCosts.kicker` for forward
     * compatibility with the spec, but the engine's `castSpell` reads
     * `script.kicker` directly so callers can set either field.
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
      s.cycling,
    {
      message:
        "a card script needs spell, modes, triggers, activated, statics, rules, equipment, aura, or cycling",
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
