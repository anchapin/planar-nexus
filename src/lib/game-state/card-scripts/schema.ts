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

/**
 * #2594 lane 25: each_player draws a card for every player.
 *
 * Wave 4.8 follow-up 12 lane 90 (#2614 follow-up): the
 * `X: "creaturesDiedThisTurn"` arm adds a state-derived draw count
 * (Needletooth Pack's "draw cards equal to the number of creatures
 * that died this turn" — lane 90 v1 minimum reads the boolean
 * `state.turn.creatureDiedThisTurn` for 0 or 1; the COUNT ledger
 * is a follow-up lane). When `X` is set, the integer `amount` is
 * ignored; the engine reads the named count from state and passes
 * it as the resolved draw amount to `resolveCardDrawEffect`.
 *
 * Wave 4.8 follow-up 13 lane 94 (#2614 follow-up): the
 * `X: "cardsDrawnThisTurn"` arm reads the integer
 * `state.players[controllerId].cardsDrawnThisTurn` counter
 * (Proft's Eidetic Memory's "you draw cards equal to the number
 * of cards you've drawn this turn" — the lane 87
 * `recordCardsDrawn` helper already maintains the
 * per-player counter; lane 94 just reads it). When `X` is
 * set, the integer `amount` is ignored.
 *
 * Wave 4.8 follow-up 13 lane 95 (#2614 follow-up): the
 * `X: "cardsDrawnThisTurnByOpponents"` arm sums the
 * per-opponent counters — every player EXCEPT the
 * controller — for "draw N where N = cards drawn by
 * opponents this turn" (Rhystic Study's deferred half).
 * The sum is taken across all opponents in
 * `state.players` (a 3-player game has 2 opponents;
 * the lane 95 read sums both).
 */
export const DrawSchema = z
  .object({
    op: z.literal("Draw"),
    amount: xAmount,
    who: z.enum(["you", "target_player", "each_player"]).default("you"),
    if_kicked: ifKicked,
    X: z
      .enum([
        "creaturesDiedThisTurn",
        "cardsDrawnThisTurn",
        "cardsDrawnThisTurnByOpponents",
      ])
      .optional(),
  })
  .strict();

/**
 * Wave 4.8 follow-up 12 lane 92 (#2614 follow-up): the
 * `X: "toughness"` arm reads the entering creature's
 * `cardData.toughness` (Drogskol Reaver's "you gain life equal
 * to its toughness"). The integer `amount` is ignored when
 * `X` is set; the engine reads the named creature's toughness
 * from state and passes it as the resolved life-gain amount
 * to `resolveLifeGainEffect`. v1 supports a single shape; the
 * `X: "power"`, `X: "mana_value"`, and `X: "creatures"` variants
 * ride future lanes.
 */
export const GainLifeSchema = z
  .object({
    op: z.literal("GainLife"),
    amount: xAmount,
    who: z.enum(["you", "target_player"]).default("you"),
    if_kicked: ifKicked,
    X: z.enum(["toughness"]).optional(),
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
  // Wave 4.8 follow-up 12 lane 91 (#2614 follow-up): Twinblade
  // Paladin's "as long as you have 25 or more life, this creature
  // has double strike and lifelink" static. The
  // `double strike` arm is stamped onto the source via the
  // existing `scriptStaticKeywords` ledger (parallel to the
  // lane 65 `grantedTriggers` pattern), read by `hasKeyword`
  // alongside the printed keyword list.
  "double strike",
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
    /**
     * Wave 4.8 follow-up 13 lane 97 (#2614 follow-up):
     * `CreateToken.X` — the X-count substrate for
     * `count`. Parallel to `GainLifeSchema.X: "toughness"`
     * (lane 92), `DrawSchema.X: "creaturesDiedThisTurn"`
     * (lane 90), `DrawSchema.X: "cardsDrawnThisTurn"`
     * (lane 94), and `DrawSchema.X:
     * "cardsDrawnThisTurnByOpponents"` (lane 95). The
     * v1 minimum supports three arms:
     *   - `cardsDrawnThisTurn`: integer
     *     `state.players[controllerId].cardsDrawnThisTurn`
     *   - `creaturesDiedThisTurn`: boolean
     *     `state.turn.creatureDiedThisTurn` (0 or 1)
     *   - `yourCreatures`: integer — the number of
     *     creatures the controller controls on the
     *     battlefield (Redcap-style "create X 1/1 red
     *     Goblin creature tokens where X is the number
     *     of creatures you control" — X-counts scale
     *     with the board state)
     *   - `landsYouControl`: integer — the number of
     *     lands the controller controls on the
     *     battlefield (Avenger of Zendikar's
     *     "create X 0/1 green Plant creature tokens
     *     where X is the number of lands you control"
     *     half — #2500 Zendikar Rising, DFC 186).
     *     The engine reads the controller's
     *     battlefield land count via the existing
     *     `computeX(..., "lands")` arm in
     *     `keyword-actions/scripted-statics.ts`
     *     (the helper already counts lands for the
     *     static-anthem substrate; lane 114 piece
     *     2 promotes it into the CreateToken X
     *     substrate).
     *
     * When `X` is set, the integer `count` is ignored;
     * the engine resolves the named count from state.
     */
    X: z
      .enum([
        "cardsDrawnThisTurn",
        "creaturesDiedThisTurn",
        "yourCreatures",
        "landsYouControl",
      ])
      .optional(),
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
     * Wave 4.8 follow-up 29 priority 1 (lane 28,
     * piece 2/4) (#2614 follow-up): the
     * discriminated-union target selector. The
     * existing enum filter (`"permanent"` /
     * `"creature"` / `"artifact"` /
     * `"enchantment"` / `"land"`) is preserved as
     * the `kind: "filter"` arm — the v1 minimum
     * (the engine auto-picks the first matching
     * permanent APNAP-ordered). The new
     * `kind: "id"` arm accepts a literal
     * `CardInstanceId` (the named target on the
     * battlefield — the engine reads the named
     * target's `cardData` directly without the
     * filter consult). The new `kind: "named_card"`
     * arm is a STUB in this piece (parses, no
     * engine consult — the engine consult lands
     * in piece 3/4). Exactly one arm is set per
     * effect (the `kind` discriminator enforces
     * this); `if_kicked` is at the top level
     * (independent of the discriminator).
     *
     * The v1 lane 70 substrate used
     * `target: z.enum([...])` (a single enum
     * value). The lane 28 piece 1/4 (follow-up
     * 28 priority 4) preserved the v1 enum.
     * Piece 2/4 (this piece) extends the schema
     * with the discriminated union; the engine
     * consult consults the `kind` discriminator
     * for resolution.
     */
    target: z.union([
      /**
       * The existing enum filter — the v1 lane
       * 70 substrate. The engine finds the
       * first matching permanent on the
       * battlefield (APNAP-ordered) whose
       * `cardData.type_line` matches the enum
       * value. Mirrors the lane 17
       * `cost.sacrifice_permanents.type` enum
       * and the lane 63
       * `additionalCosts.sacrifice.target`
       * enum.
       */
      z
        .object({
          kind: z.literal("filter"),
          value: z.enum([
            "permanent",
            "creature",
            "artifact",
            "enchantment",
            "land",
          ]),
        })
        .strict(),
      /**
       * The explicit named target — a
       * `CardInstanceId` on the battlefield.
       * The engine reads the named target's
       * `cardData` directly from
       * `state.cards.get(value)` (validates the
       * target is on the battlefield; a missing
       * target is a no-op per the lane 70
       * substrate's auto-pick fallback).
       * Parallel to the lane 75a
       * `CopyUntilEndOfTurn.chosen_permanent`
       * shape (a literal `CardInstanceId` named
       * target).
       */
      z
        .object({
          kind: z.literal("id"),
          value: z.string().min(1),
        })
        .strict(),
      /**
       * The named-card variant (Self-Reflection
       * style — "create a token that's a copy
       * of [card name]"). This is a STUB in
       * piece 2/4 (parses, no engine consult
       * — the engine consult lands in piece
       * 3/4). The schema union has all three
       * arms; the engine consults two (filter
       * + id) in piece 2/4. The named-card arm
       * is included here so the discriminator
       * is in place when piece 3/4 lands (no
       * second schema bump needed). The
       * `getCardDataByName(value.name)` lookup
       * is the named card's printed `cardData`;
       * missing-name is a no-op (see piece
       * 3/4).
       */
      z
        .object({
          kind: z.literal("named_card"),
          value: z.object({ name: z.string().min(1) }).strict(),
        })
        .strict(),
    ]),
    /** Restrict to the controller's own permanents. */
    controller: z.enum(["you", "opponent", "any"]).optional(),
    /**
     * Wave 4.8 follow-up 28 priority 4 (lane 28,
     * piece 1/N) (#2614 follow-up): the `count`
     * field for multi-copy tokens (Rite of
     * Replication's "create X tokens that are
     * copies of target creature"; Extravagant
     * Replication's "create three tokens that
     * are copies"). Default is 1 (the v1
     * minimum — a single copy; the engine
     * creates a single new CardInstance as in
     * the lane 70 substrate). When `count >= 2`,
     * the engine creates `count` independent
     * tokens in sequence (each with its own
     * `cardId`, `cardData`, and battlefield
     * entry — the tokens are NEW CardInstances,
     * not the existing copy-substrate's overlay
     * mechanism). v1 minimum: count=1 (default)
     * + count=N (integer >= 1). CR 707.2
     * reference for "all characteristics
     * copied" semantics on each token.
     *
     * Out of scope (each a follow-up lane):
     * explicit `target: CardInstanceId` (a
     * named target on the battlefield — the
     * current `target` enum auto-picks the
     * first matching permanent); the named-card
     * variant `named_card: { name: string }`
     * (Self-Reflection-style "create a token
     * that's a copy of [card name]"); the
     * copy-with-exception variant (Phyrexian
     * Metamorph-style "create a token that's a
     * copy of [target] EXCEPT it has no
     * abilities"). The variant is unbuilt;
     * deferred since follow-up 4 piece 2/N +
     * 3/N + 4/N. See wave4.8-closed.md §2.
     *
     * Wave 4.8 follow-up 29 priority 3 (lane
     * 28, piece 4/4) (#2614 follow-up): the
     * `exceptions` arm — Phyrexian
     * Metamorph-style "create a token that's
     * a copy of [target] EXCEPT it has
     * additional subtypes". The engine
     * rebuilds each copy token's
     * `cardData.type_line` to include the
     * added subtypes after the source's
     * `cardData` shallow-copy. The exceptions
     * are PER-COPY (each token receives the
     * same `add_subtype` list — the
     * exceptions are NOT per-token in v1; a
     * per-token exception array rides
     * follow-up 30). v1 minimum:
     * `add_subtype` only; `add_color` /
     * `add_power` / `add_toughness` /
     * `add_type` exception variants ride
     * follow-up 30 (parallel to the lane
     * 75c parked-out exception variants).
     *
     * Wave 4.8 follow-up 31 priority 1 (lane
     * 28, piece 1/N) (#2614 follow-up): the
     * parallel `add_supertype` arm (the
     * `Legendary` / `Snow` / `Basic`
     * supertype prepend — the OUTERMOST
     * position in the types half,
     * PREPENDED to the `add_type` arm AND
     * the printed types). v1 minimum: a
     * list of the three `SUPERTYPES` enum
     * values; the destructive
     * `set_supertype` variant rides
     * follow-up 32 if any future priority
     * piece surfaces a "exactly
     * [supertypes]" semantic.
     */
    count: z.number().int().min(1).optional(),
    /**
     * Wave 4.8 follow-up 29 priority 3 (lane
     * 28, piece 4/4) (#2614 follow-up):
     * OPTIONAL `exceptions` arm. The engine
     * consults the `add_subtype` list after
     * the source's `cardData` shallow-copy;
     * each copy token's `cardData.type_line`
     * is rebuilt to include the added
     * subtypes (the added subtypes are
     * APPENDED to the printed subtypes; the
     * exceptions arm is ADDITIVE — no
     * overwrite).
     *
     * Wave 4.8 follow-up 30 priority 1 (lane
     * 28, piece 1/N) (#2614 follow-up): the
     * `add_color` sub-arm — Phyrexian
     * Metamorph's "it's red in addition to
     * its other colors" half. The engine
     * reads the printed `colors` array (CR
     * 707.2 — "all characteristics copied")
     * and APPENDS the added color names (in
     * declared order, deduplicated by the
     * engine's Set pass). The matching
     * `color_identity` array is rebuilt to
     * the union of printed + added colors
     * (a one-pass transform — no overwrite
     * of the printed colors). The `add_color`
     * arm is ADDITIVE (no overwrite of the
     * printed colors); a destructive
     * `set_color` variant ("only [colors]"
     * semantic) IS the `set_color` field
     * below; no further follow-up needed.
     * (Original marker promised a future
     * follow-up 31; the field has shipped
     * in the schema since wave 4.)
     * The color names use the engine's
     * full-name convention (`"white" |
     * "blue" | "black" | "red" | "green" |
     * "colorless"`) — parallel to the
     * `CreateToken.color` enum at line ~215
     * and the lane 75c `become_copy`
     * color conventions.
     *
     * Wave 4.8 follow-up 30 priority 2 (lane
     * 28, piece 2/N) (#2614 follow-up): the
     * `add_power` sub-arm — Phyrexian
     * Metamorph's "it has +1/+0" half (or
     * "it has -1/-0" with a negative
     * integer). The engine parses the
     * printed `power` string as an integer,
     * ADDS the `add_power` value, and
     * rebuilds `cardData.power` as a
     * string. The arm is ADDITIVE — no
     * overwrite of the printed power. v1
     * minimum: a single integer field;
     * non-integer printed powers (`*` or
     * `1+*`) yield 0 + the additive. A
     * destructive `set_power` variant rides
     * follow-up 31 if any future priority
     * piece surfaces a "exactly N" semantic.
     *
     * Wave 4.8 follow-up 30 priority 3 (lane
     * 28, piece 3/N) (#2614 follow-up): the
     * `add_toughness` sub-arm — Phyrexian
     * Metamorph's "it has 0/-1" half (or
     * "it has +0/+1" with a positive
     * integer). The engine parses the
     * printed `toughness` string as an
     * integer, ADDS the `add_toughness`
     * value, and rebuilds
     * `cardData.toughness` as a string. The
     * arm is ADDITIVE — no overwrite of the
     * printed toughness. v1 minimum: a
     * single integer field; non-integer
     * printed toughnesses (`*` / `1+*`)
     * yield 0. A destructive `set_toughness`
     * variant ("exactly N" semantic) IS
     * the `set_toughness` field below; no
     * further follow-up needed. (Original
     * marker promised a future follow-up 31;
     * the field has shipped in the schema
     * since wave 4. The non-integer `*` /
     * `1+*` printed-toughness case is a
     * separate limitation, not addressed
     * here.) The
     * `add_toughness` arm composes with the
     * priority 2 `add_power` arm (parallel
     * additive P/T merge — both arms
     * consume the printed P/T as the base).
     *
     * Wave 4.8 follow-up 30 priority 4 (lane
     * 28, piece 4/N) (#2614 follow-up): the
     * `add_type` sub-arm — Phyrexian
     * Metamorph's "it's an Artifact in
     * addition to its other types" half
     * (the type-line prepend). The engine
     * reads the printed `cardData.type_line`
     * and PREPENDS the listed card types to
     * the TYPES half (the types come
     * BEFORE the printed types; e.g. a
     * `"Creature — Bear"` with
     * `add_type: ["Artifact"]` becomes
     * `"Artifact Creature — Bear"`). The
     * subtypes half is preserved. The arm
     * is ADDITIVE — no overwrite of the
     * printed types. v1 minimum: a list of
     * the seven `CARD_TYPES` enum values
     * (`Creature | Artifact | Enchantment |
     * Land | Planeswalker | Battle |
     * Tribal`); supertypes (`Legendary` /
     * `Snow` / `Basic`) ride follow-up 31
     * via the parallel `add_supertype` arm.
     * The `add_type` arm is distinct from
     * `add_subtype` (which appends to the
     * SUBTYPES half). A destructive
     * `set_type` variant ("exactly [types]"
     * semantic) IS the `set_type` field
     * below; no further follow-up needed.
     * (Original marker promised a future
     * follow-up 31; the field has shipped
     * in the schema since wave 4.)
     */
    exceptions: z
      .object({
        /**
         * PRECEDENCE summary for every
         * `CopyPermanentSchema.exceptions`
         * axis (lane 28 — locked in follow-ups
         * 24…28, codified by this comment in
         * follow-up 33 across the P/T, color,
         * type, and subtype axes):
         *
         *   1. On every identity axis (power,
         *      toughness, color, type,
         *      subtype, keywords, abilities),
         *      a `set_<axis>` arm
         *      OVERWRITES the printed value
         *      to its listed values (the
         *      printed value is the BASE only
         *      when no `set_<axis>` is
         *      present).
         *
         *   2. An `add_<axis>` arm is
         *      ADDITIVE — it merges its
         *      listed values into the
         *      EFFECTIVE value (printed
         *      base, or the latest
         *      `set_<axis>` result), never
         *      overwriting.
         *
         *   3. When BOTH `set_<axis>` and
         *      `add_<axis>` ride the same
         *      axis on the same effect, the
         *      `set_<axis>` value is the
         *      EFFECTIVE base, and the
         *      `add_<axis>` is appended (or
         *      applied) ON TOP of it. The
         *      REPLACE form wins; additive
         *      overlays never replace.
         *
         *   4. On cross-axis axes (e.g. P/T
         *      where `set_power` and
         *      `add_toughness` ride together)
         *      each axis follows its own
         *      sub-rule — `set_power` REPLACES
         *      the printed power independently
         *      of whether `add_toughness` is
         *      also present (and vice versa),
         *      because they modify independent
         *      printed values.
         *
         *   5. When NEITHER `set_<axis>` NOR
         *      `add_<axis>` is present, the
         *      effect leaves the printed axis
         *      value untouched.
         *
         * Engine consult precedence lives in
         * `src/lib/game-state/card-scripts/interpret.ts`
         * `applyExceptions` — `set_<axis>`
         * arms are evaluated first, and
         * `add_<axis>` is skipped when its
         * corresponding `set_<axis>` arm is
         * present (the REPLACE form is the
         * final word on the axis).
         *
         * Per-axis current scheme — locked
         * `add_*` arms (follow-ups 28-31):
         *   - `add_color` (follow-up 30)
         *   - `add_type` (follow-up 30)
         *   - `add_subtype` (follow-up 29)
         *   - `add_power` (follow-up 25)
         *   - `add_toughness` (follow-up 32,
         *     wired 41b3ad3a)
         *   - `add_ability` (follow-up 27)
         *   - `add_keyword` (follow-up 27)
         *
         * Per-axis current scheme — `set_*`
         * arms (follow-ups 28-34):
         *   - `set_power` (follow-up 28)
         *   - `set_toughness` (follow-up 32)
         *   - `set_subtype` (follow-up 33
         *     piece 1/N, shipped) — REPLACES
         *     the subtypes half of
         *     `type_line`; `add_subtype`
         *     consult SKIPPED on the same
         *     effect (REPLACE wins). See
         *     commit e2d5070f.
         *   - `set_type` (follow-up 34
         *     piece 2/N, this commit) —
         *     REPLACES the types half of
         *     `type_line`; `add_type`
         *     consult SKIPPED on the same
         *     effect (REPLACE wins — same
         *     pattern as `set_subtype`).
         *     Cross-axis with `set_subtype`
         *     is allowed: the engine
         *     rebuilds the type_line as
         *     `<set_type> — <set_subtype>`
         *     when both REPLACE forms are
         *     set on the same effect.
         *   - `set_keyword` (deferred —
         *     rides follow-up 35+)
         *   - `set_ability` (deferred —
         *     rides follow-up 35+)
         *   - `set_supertype` (follow-up 34
         *     piece 3/N, this commit) —
         *     REPLACES the supertype
         *     segment of the types half
         *     with the listed supertypes
         *     (the outermost tokens
         *     `Legendary` / `Snow` /
         *     `Basic` are dropped and
         *     replaced by the listed
         *     supertypes in declared
         *     order); `add_supertype`
         *     consult SKIPPED on the same
         *     effect (REPLACE wins). The
         *     rest of the types half
         *     (post-`add_type` /
         *     post-`set_type`) is
         *     preserved verbatim; the
         *     subtypes half is preserved
         *     unchanged. See
         *     `applyExceptions` for the
         *     REPLACE consult.
         *   - `set_color_identity`
         *     (follow-up 34 piece 4/N,
         *     this commit) — REPLACES
         *     ONLY the `color_identity`
         *     array (the printer-identity
         *     axis — DISTINCT from the
         *     printed `colors` axis);
         *     `colors` is preserved
         *     unchanged. Cross-axis with
         *     `set_color`: `set_color`
         *     REPLACES BOTH `colors` AND
         *     `color_identity`; if both
         *     ride together, `set_color`
         *     sets `colors` first and
         *     `color_identity`, then
         *     `set_color_identity` further
         *     REPLACES `color_identity`
         *     to its own list. There is
         *     NO `add_color_identity` arm
         *     — the additive-color-identity
         *     semantic is not on the
         *     road map; the
         *     `set_color_identity`
         *     consult skips any additive
         *     color-identity consult (none
         *     exists) and the `add_color`
         *     consult (REPLACE wins on each
         *     axis independently). See
         *     `applyExceptions` for the
         *     REPLACE consult.
         */
        add_subtype: z.array(z.string().min(1)).min(1).optional(),
        /**
         * Wave 4.8 follow-up 33 priority 1
         * (lane 28, piece 1/2) (#2614
         * follow-up): OPTIONAL `set_subtype`
         * sub-arm. The engine REPLACES the
         * subtypes half of `type_line` with
         * the listed subtype names (printed
         * base is dropped). When
         * `set_subtype` is present, the
         * `add_subtype` append-consult is
         * SKIPPED — the REPLACE form wins
         * on the same axis (see PRECEDENCE
         * block above).
         *
         * Marker is `REPLACE wins over
         * additive on the subtype axis`.
         */
        set_subtype: z.array(z.string().min(1)).min(1).optional(),
        /**
         * Wave 4.8 follow-up 34 priority 1
         * (lane 28, piece 2/N) (#2614
         * follow-up): OPTIONAL `set_type`
         * sub-arm. The engine REPLACES the
         * TYPES half of `type_line` with the
         * listed type names (printed types
         * half is dropped; the subtypes half
         * is preserved unchanged). When
         * `set_type` is present, the
         * `add_type` prepend-consult is
         * SKIPPED — REPLACE wins on the same
         * axis (parallel to `set_subtype` vs
         * `add_subtype` from follow-up 33 —
         * the REPLACE form is the final word
         * on the axis; see PRECEDENCE block
         * above).
         *
         * Note the cross-axis interaction:
         * if BOTH `set_type` (types-half
         * REPLACE) and `set_subtype`
         * (subtypes-half REPLACE) are set
         * on the same effect, the engine
         * rebuilds the entire type_line as
         * `<set_type> — <set_subtype>` and
         * preserves no printed half. The
         * `add_type` consult runs BEFORE
         * `set_type` (in source order) and
         * is skipped only when `set_type` is
         * also present. The `add_subtype`
         * consult runs BEFORE `set_subtype`
         * and is skipped only when
         * `set_subtype` is also present.
         * Cross-axis `add_subtype` still
         * runs even when `set_type` is set
         * (and vice versa) — additive
         * overlays on independent axes do
         * not block each other; only the
         * REPLACE form on the SAME axis
         * blocks the additive form.
         *
         * Marker is `REPLACE wins over
         * additive on the type axis`.
         */
        set_type: z.array(z.string().min(1)).min(1).optional(),
        /**
         * Wave 4.8 follow-up 30 priority 1
         * (lane 28, piece 1/N) (#2614
         * follow-up): OPTIONAL `add_color`
         * sub-arm. The engine merges the
         * listed color names into each copy
         * token's `colors` array AND rebuilds
         * the matching `color_identity` array
         * to include them (the union is
         * deduplicated; declared order is
         * preserved). v1 minimum: a list of
         * the six `COLOR` enum values
         * (`white` / `blue` / `black` / `red`
         * / `green` / `colorless`).
         *
         * Wave 4.8 follow-up 31 priority 2
         * (lane 28, piece 2/N) (#2614
         * follow-up): the destructive
         * `set_color` variant — REPLACES the
         * token's `colors` array with the
         * listed color names (deduplicated;
         * declared order preserved) AND
         * rebuilds `color_identity` to match
         * the REPLACED list verbatim (no
         * merge, no append — the printed
         * colors are discarded; the listed
         * colors become the entire `colors`
         * / `color_identity` arrays). The
         * `set_color` arm takes PRECEDENCE
         * over `add_color` when both are set
         * (the destructive variant always
         * wins; parallel to the
         * `andPer.perCounterSummed`
         * precedence rule for the additive
         * vs REPLACE form). A separate
         * `set_color_identity` variant (which
         * overrides the identity but leaves
         * the printed colors intact — a
         * `set_color` + `add_color` hybrid)
         * rides follow-up 32 if any future
         * priority piece surfaces a need.
         */
        add_color: z
          .array(
            z.enum(["white", "blue", "black", "red", "green", "colorless"]),
          )
          .min(1)
          .optional(),
        /**
         * Wave 4.8 follow-up 31 priority 2
         * (lane 28, piece 2/N) (#2614
         * follow-up): OPTIONAL `set_color`
         * sub-arm. The engine REPLACES the
         * token's `colors` array with the
         * listed color names (deduplicated;
         * declared order preserved) AND
         * rebuilds `color_identity` to match
         * the REPLACED list verbatim (no
         * merge, no append — the printed
         * colors are discarded; the listed
         * colors become the entire `colors`
         * / `color_identity` arrays). v1
         * minimum: a list of the six `COLOR`
         * enum values. The `set_color` arm
         * takes PRECEDENCE over `add_color`
         * when both are set (the destructive
         * variant always wins). The
         * `set_color` arm is DISTINCT from
         * the priority 1 `add_color` arm
         * (which MERGES with the printed
         * colors). The `set_color` arm is
         * also distinct from a parallel
         * `set_color_identity` variant
         * (which would override the identity
         * but leave the printed colors
         * intact — a hybrid that rides
         * follow-up 34 piece 4/N — see
         * the next field below).
         */
        set_color: z
          .array(
            z.enum(["white", "blue", "black", "red", "green", "colorless"]),
          )
          .min(1)
          .optional(),
        /**
         * Wave 4.8 follow-up 34 priority 1
         * (lane 28, piece 4/N) (#2614
         * follow-up): OPTIONAL
         * `set_color_identity` sub-arm.
         * The HYBRID variant of the
         * `set_color` family — REPLACES
         * ONLY the token's `color_identity`
         * array (deduplicated; declared
         * order preserved) WHILE LEAVING
         * the token's `colors` array
         * UNTOUCHED. This is the inverse
         * of `set_color` (which REPLACES
         * BOTH `colors` AND `color_identity`
         * to the same listed values).
         *
         * v1 minimum: a list of the same
         * six `COLOR` enum values. The
         * typical use case is "a token
         * that's a copy of target creature
         * except it has the chosen player's
         * color identity" — commander-deck
         * reconstruct semantics where the
         * face card's printed colors are
         * preserved but its color_identity
         * is rebound.
         *
         * When `set_color_identity` is
         * present, the `add_color` consult
         * is SKIPPED entirely. The printed
         * `colors` array on the token
         * remains untouched (the engine
         * does NOT consult `add_color` to
         * extend the printed `colors` —
         * REPLACE wins on the axis).
         * Cross-axis with `set_color`:
         * `set_color` REPLACES BOTH
         * `colors` and `color_identity`;
         * if BOTH `set_color` and
         * `set_color_identity` ride
         * together, `set_color` wins on
         * the `colors` axis (sets
         * `colors` AND `color_identity`),
         * and `set_color_identity`'s
         * further REPLACE on
         * `color_identity` runs AFTER
         * — the final `color_identity`
         * reflects `set_color_identity`,
         * not `set_color`.
         *
         * Marker is `REPLACE wins over
         * additive on the color_identity
         * axis — INDEPENDENT of the
         * colors axis`.
         */
        set_color_identity: z
          .array(
            z.enum(["white", "blue", "black", "red", "green", "colorless"]),
          )
          .min(1)
          .optional(),
        /**
         * Wave 4.8 follow-up 30 priority 2
         * (lane 28, piece 2/N) (#2614
         * follow-up): OPTIONAL `add_power`
         * sub-arm. The engine parses the
         * printed `power` string as an
         * integer (default 0; non-integer
         * printed powers like `*` or `1+*`
         * yield 0), ADDS the `add_power`
         * value, and rebuilds
         * `cardData.power` as a string. The
         * merge is ADDITIVE — no overwrite
         * of the printed power. The
         * `add_power` arm accepts negative
         * integers (Phyrexian Metamorph-style
         * "create a token that's a copy of
         * [target] EXCEPT it has -1/-0");
         * the parallel destructive `set_power`
         * variant ships in follow-up 31
         * priority 3 — the engine REPLACES
         * the printed power with
         * `String(set_power)` (the integer
         * stringified; the printed power
         * string is discarded entirely).
         * The `set_power` arm takes
         * PRECEDENCE over `add_power` when
         * both are set (the destructive
         * variant always wins; parallel to
         * the `set_color` PRECEDENCE rule).
         * A parallel `set_power_until_eot`
         * variant (which would override
         * the power until end of turn and
         * then restore the printed power —
         * a hybrid that mirrors the lane
         * 75c `become_copy` until-eot
         * shape) rides follow-up 32 if any
         * future priority piece surfaces a
         * until-eot semantic. v1 minimum:
         * a single integer field; no
         * `*` / `X+*` printed-power
         * resolution.
         */
        add_power: z.number().int().optional(),
        /**
         * Wave 4.8 follow-up 31 priority 3
         * (lane 28, piece 3/N) (#2614
         * follow-up): OPTIONAL `set_power`
         * sub-arm. The engine REPLACES the
         * token's `cardData.power` with
         * `String(set_power)` (the integer
         * stringified; the printed power
         * string is discarded entirely).
         * v1 minimum: an integer. Negative
         * values are accepted at the Zod
         * layer (the engine stringifies
         * them as `"-" + n`; the additive
         * `add_power` arm also accepts
         * negative values, so the
         * destructive variant mirrors
         * that). The `set_power` arm takes
         * PRECEDENCE over `add_power` when
         * both are set (the destructive
         * variant always wins; parallel to
         * the `set_color` PRECEDENCE rule).
         * The `set_power` arm is DISTINCT
         * from the priority 2 `add_power`
         * arm (which MERGES with the
         * printed power). The `set_power`
         * arm is also distinct from a
         * parallel `set_power_until_eot`
         * variant (which would override
         * the power until end of turn and
         * then restore the printed power —
         * a hybrid that rides follow-up
         * 32).
         */
        set_power: z.number().int().optional(),
        /**
         * Wave 4.8 follow-up 32 priority 1
         * (lane 28, piece 1/N) (#2614
         * follow-up 32): OPTIONAL
         * `set_toughness` sub-arm. The engine
         * parses the printed `toughness`
         * string as an integer (default 0;
         * non-integer printed toughnesses
         * like `*` or `1+*` yield 0),
         * REPLACES the printed toughness with
         * `String(set_toughness)`, and
         * rebuilds `cardData.toughness` as a
         * string. The merge is DESTRUCTIVE —
         * `set_toughness` OVERRIDES the
         * printed toughness and any
         * `add_toughness` value. The
         * `set_toughness` arm takes
         * PRECEDENCE over the parallel
         * `add_toughness` arm (REPLACE wins
         * over ADD). The arm accepts
         * negative integers
         * ("EXCEPT it has 0/-1" — Phyrexian
         * Metamorph-style); v1 minimum: a
         * single integer field; no `*` /
         * `X+*` printed-toughness resolution.
         * The `set_toughness` arm composes
         * with the parallel `set_power` arm
         * (parallel destructive P/T merge —
         * each arm consumes its own half of
         * the printed P/T independently).
         */
        set_toughness: z.number().int().optional(),
        /**
         * Wave 4.8 follow-up 30 priority 3
         * (lane 28, piece 3/N) (#2614
         * follow-up): OPTIONAL `add_toughness`
         * sub-arm. The engine parses the
         * printed `toughness` string as an
         * integer (default 0; non-integer
         * printed toughnesses like `*` or
         * `1+*` yield 0), ADDS the
         * `add_toughness` value, and rebuilds
         * `cardData.toughness` as a string.
         * The merge is ADDITIVE — no
         * overwrite of the printed toughness.
         * The `add_toughness` arm accepts
         * negative integers
         * (Phyrexian Metamorph-style
         * "create a token that's a copy of
         * [target] EXCEPT it has 0/-1"). v1
         * minimum: a single integer field;
         * no `*` / `X+*` printed-toughness
         * resolution. The `add_toughness`
         * arm composes with the priority 2
         * `add_power` arm (parallel additive
         * P/T merge — both arms consume the
         * printed P/T as the base).
         */
        add_toughness: z.number().int().optional(),
        /**
         * Wave 4.8 follow-up 30 priority 4
         * (lane 28, piece 4/N) (#2614
         * follow-up): OPTIONAL `add_type`
         * sub-arm. The engine reads the
         * printed `cardData.type_line` and
         * PREPENDS the added card types to
         * the TYPES half of the type_line
         * (e.g. `"Creature — Bear"` +
         * `["Artifact"]` =
         * `"Artifact Creature — Bear"`).
         * The added types are prepended in
         * declared order; the subtypes half
         * is preserved. The arm is ADDITIVE
         * — no overwrite of the printed
         * types. v1 minimum: a list of
         * `CARD_TYPES` enum values (the
         * standard seven — `Creature`,
         * `Artifact`, `Enchantment`, `Land`,
         * `Planeswalker`, `Battle`, and
         * `Tribal`; `Tribal` is a legacy
         * type that some cards still use).
         *
         * Wave 4.8 follow-up 31 priority 1
         * (lane 28, piece 1/N) (#2614
         * follow-up): the parallel
         * `add_supertype` arm — the engine
         * PREPENDS the listed supertypes to
         * the OUTER FRONT of the types half
         * (the supertypes come BEFORE the
         * `add_type` prepend AND BEFORE the
         * printed types; e.g. `"Creature —
         * Bear"` + `add_supertype:
         * ["Legendary"]` + `add_type:
         * ["Artifact"]` = `"Legendary
         * Artifact Creature — Bear"`). The
         * subtypes half is preserved. The
         * `add_supertype` arm is ADDITIVE —
         * no overwrite of the printed
         * supertypes. v1 minimum: a list of
         * the three `SUPERTYPES` enum values
         * (`Legendary` / `Snow` / `Basic`)
         * — the standard MTG supertypes from
         * CR 205.4. Legacy supertype
         * distinctions (`"World"` /
         * `"Legendary"`-only /
         * `"Snow"`-only) ride follow-up 32
         * if any future priority piece
         * surfaces a legacy variant. The
         * `add_type` arm is distinct from
         * `add_subtype` (which appends to
         * the SUBTYPES half). A destructive
         * `set_type` variant rides follow-up
         * 32 if any future priority piece
         * surfaces a "exactly [types]"
         * semantic.
         */
        add_type: z
          .array(
            z.enum([
              "Creature",
              "Artifact",
              "Enchantment",
              "Land",
              "Planeswalker",
              "Battle",
              "Tribal",
            ]),
          )
          .min(1)
          .optional(),
        /**
         * Wave 4.8 follow-up 31 priority 1
         * (lane 28, piece 1/N) (#2614
         * follow-up): OPTIONAL
         * `add_supertype` sub-arm. The
         * engine reads the printed
         * `cardData.type_line` and
         * PREPENDS the listed supertypes
         * to the OUTER FRONT of the types
         * half (the supertypes come BEFORE
         * the `add_type` prepend AND BEFORE
         * the printed types; e.g.
         * `"Creature — Bear"` +
         * `add_supertype: ["Legendary"]` =
         * `"Legendary Creature — Bear"` —
         * the supertype is outermost). The
         * subtypes half is preserved. The
         * `add_supertype` arm is ADDITIVE
         * — no overwrite of the printed
         * supertypes. v1 minimum: a list
         * of the three `SUPERTYPES` enum
         * values (`"Legendary"`,
         * `"Snow"`, `"Basic"`). The arm
         * composes with the follow-up 30
         * priority 4 `add_type` arm
         * (parallel cross-arm order:
         * supertype OUTERMOST, type INNER,
         * then printed types). Legacy
         * supertype distinctions
         * (`"World"` / `"Legendary"`-only
         * / `"Snow"`-only) are unbuilt;
         * deferred since follow-up 32.
         * See wave4.8-closed.md §2. A
         * destructive `set_supertype`
         * variant rides follow-up 34
         * piece 3/N (this commit) — see
         * the `set_supertype` field below.
         */
        add_supertype: z
          .array(z.enum(["Legendary", "Snow", "Basic"]))
          .min(1)
          .optional(),
        /**
         * Wave 4.8 follow-up 34 priority 1
         * (lane 28, piece 3/N) (#2614
         * follow-up): OPTIONAL
         * `set_supertype` sub-arm. The
         * engine REPLACES the supertype
         * segment of the types half: the
         * listed supertype names are
         * placed at the outer-most edge
         * of the types half, and any
         * existing supertype-prefix words
         * (`"Legendary"`, `"Snow"`,
         * `"Basic"`) are dropped. The rest
         * of the types half (which may
         * include `add_type`-added types
         * + the printed types) is
         * preserved verbatim. The subtypes
         * half is preserved unchanged.
         *
         * Concrete rebuild: the engine
         * drops any existing supertype
         * prefix from the types half, then
         * rebuilds the types half as
         * `<set_supertype> <existing-types-half-without-supertype-prefix>`.
         * The subtypes half (when present)
         * is preserved verbatim after the
         * rebuild.
         *
         * When `set_supertype` is present,
         * the `add_supertype` prepend-consult
         * is SKIPPED — REPLACE wins on the
         * same axis (parallel to
         * `set_subtype` vs `add_subtype`
         * from follow-up 33, `set_type` vs
         * `add_type` from follow-up 34
         * piece 2/N, and `set_toughness` vs
         * `add_toughness` from follow-up 32
         * / commit 41b3ad3a).
         *
         * Cross-axis with `set_type` /
         * `set_subtype`: the per-axis pair
         * rule still applies — cross-axis
         * REPLACE forms on the same effect
         * do NOT cancel the `set_supertype`
         * consult; each axis follows its
         * own sub-rule. The `set_supertype`
         * consult runs LAST in the per-pass
         * order — it operates on the final
         * types half (post-`add_type` /
         * post-`set_type` / post-
         * `add_supertype` cancellations).
         *
         * Marker is `REPLACE wins over
         * additive on the supertype axis`.
         */
        set_supertype: z
          .array(z.enum(["Legendary", "Snow", "Basic"]))
          .min(1)
          .optional(),
      })
      .strict()
      .optional(),
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
    /**
     * Wave 4.8 follow-up 19 lane 114 piece 2/2
     * (#2614 follow-up): the "each_creature" target
     * mode on `PutCounters` (Avenger of Zendikar's
     * "Landfall — you may put a +1/+1 counter on
     * each Plant you control" half — DSC 186).
     * The engine iterates the controller's
     * battlefield creatures matching the
     * `subtype` filter and stamps `amount` counters
     * on each. The `subtype` and `controller` fields
     * are mutually required (a single filter per
     * effect); out-of-battlefield creatures are
     * skipped. Only valid with
     * `counter: "+1/+1"`; quest counters ride a
     * follow-up lane.
     */
    target_each: z
      .object({
        subtype: z.string().min(1),
      })
      .strict()
      .optional(),
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
  )
  .refine((e) => e.target_each === undefined || e.counter === "+1/+1", {
    message:
      "target_each (each_creature mode) only supports '+1/+1' counters (lane 114 piece 2/2, #2614)",
  });

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
 * The optional `restriction` field (#2614 follow-up, Wave 4.8
 * follow-up 21 lane 69 piece 1/N) is a free-form string tag
 * identifying the per-mana restriction (e.g. `"creature_spells"`
 * for "spend this mana only on creature spells", or
 * `"instant_or_sorcery"`). The engine stashes the produced mana
 * into the player's parallel `restrictionLedger[restriction]`
 * (a per-tag partial pool) instead of the main `manaPool`. The
 * spend-side consult is the multi-lane piece 2/N — v1 ships
 * the ledger + the schema arm only. Mixed-color restrictions,
 * per-restriction generic reductions, and multi-tag (a single
 * mana tagged with two restrictions) ride follow-up lanes.
 *
 * Out of scope for now: mana that depends on a count ("for each
 * creature you control"), and mixed symbols like "{R}{G}". Cards
 * with those wait for a follow-up.
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
    /**
     * Wave 4.8 follow-up 21 lane 69 (#2614 follow-up): the
     * per-mana restriction tag ("spend this mana only on
     * [X]"). When set, the engine routes the produced mana
     * into `player.restrictionLedger[restriction]` (a parallel
     * per-tag partial pool) instead of the main `manaPool`,
     * and the spend-side consult (`resolveXspentOn` in
     * `mana/restriction-ledger.ts`) reads the same tag back
     * against the spell's restriction to gate the spend.
     *
     * v1 collapses to a constrained enum of well-known tags:
     *   - `"creature_spells"` — "spend this mana only on
     *     creature spells" (Llawan / War Tax / etc.)
     *   - `"instant_or_sorcery"` — "spend only on instant or
     *     sorcery spells"
     *   - `"artifact_or_enchantment"` — "spend only on
     *     artifact or enchantment spells"
     *   - `"any_color"` — colored mana tagged for unrestricted
     *     spending (used when a producer emits colored mana
     *     that the engine should still ledger)
     *   - `"colorless"` — colorless mana tagged for
     *     unrestricted spending
     *
     * Multi-tag and per-color matching variants ride follow-up
     * lanes; this enum is the v1 floor. Common typos like
     * `"creature_spell"` (singular) are blocked by the schema
     * so they don't silently widen the ledger at runtime.
     */
    restriction: z
      .enum([
        "creature_spells",
        "instant_or_sorcery",
        "artifact_or_enchantment",
        "any_color",
        "colorless",
      ])
      .optional(),
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
    /**
     * Wave 4.8 follow-up 19 lane 116 (#2614 follow-up):
     * "this spell's X equals the X spent on the previous
     * spell" — a cast-only X-source filter. When set, the
     * trigger fires only when the cast spell has X in its
     * mana cost AND `state.castVariableValues[spellCardId]`
     * is set (the spell that triggered this). The
     * `interpret.ts` consumer reads
     * `state.castVariableValues[spellCardId]` to surface
     * the stored X as the effect's resolved X.
     *
     * v1 supports a single arm
     * (`"X_spent_on_spell"`); the "X spent on any prior
     * spell this turn" / "X spent on the most recent
     * instant or sorcery" variants ride follow-up lanes.
     * v1 ships a **read-only path** — the engine surfaces
     * the helper but does NOT yet write to
     * `state.castVariableValues` at cast time. The
     * synthetic test pre-populates the map directly; the
     * write step is a follow-up sub-piece (lane 116
     * piece 2/2).
     */
    X: z.enum(["X_spent_on_spell"]).optional(),
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
     * Wave 4.8 follow-up 13 lane 93 (#2614 follow-up):
     * `you_may_cost` — a "you may pay [cost]; if you do,
     * [effects]" gate. Combines the lane 60 `you_may`
     * yes/no prompt with a cost-on-yes path (CR 117.3a
     * "you may pay N life; if you do, ..." pattern;
     * Skyship Buccaneer (FDN 76) is the canonical
     * example: "you may pay 2 life; if you do, draw a
     * card").
     *
     * The v1 minimum supports two cost shapes
     * (parallel to the lane 88 `cost` substrate):
     *   - `sacrifice_self: true` — sacrifice the source
     *     permanent (midrange variant: "you may sacrifice
     *     [this]; if you do, [effects]"). The cost
     *     mechanism reuses the lane 88 sacrifice-card
     *     path.
     *   - `pay_life: { amount: N }` — pay N life. The
     *     cost mechanism reuses the lane 63
     *     `additionalCosts.pay_life` arm's
     *     `resolveLifeLossEffect` helper.
     *
     * The engine's gate flow:
     *   1. `you_may: true` is required alongside
     *      `you_may_cost` (the yes/no gate is the
     *      precondition for paying the cost).
     *   2. On the first resolve pass, surface a
     *      `you_may_prompt` waitingChoice (the lane 60
     *      shape).
     *   3. On `you_may_resolved === true`, evaluate the
     *      cost: if it can be paid (sacrifice_self:
     *      source still on battlefield; pay_life:
     *      controller's life ≥ amount), stamp
     *      `cost_paid: true` and run effects; if it
     *      can't be paid, stamp `cost_paid: false` and
     *      the trigger fizzles.
     *   4. On `you_may_resolved === false`, skip the
     *      trigger entirely (no cost, no effects).
     *
     * Out of scope for lane 93 (each a follow-up lane):
     * the `you_may_cost.discard` arm (lane 98), the
     * "you may pay [cost]; if you don't, [alt
     * effects]" alternate (lane 99), the
     * `you_may_cost.pay_mana` arm (some shapes use
     * mana instead of life; out of scope), and the
     * multi-cost combinations.
     */
    you_may_cost: z
      .union([
        z
          .object({
            sacrifice_self: z.literal(true),
          })
          .strict(),
        z
          .object({
            pay_life: z.object({ amount: z.number().int().min(1) }).strict(),
          })
          .strict(),
      ])
      .optional(),
    /**
     * Wave 4.8 follow-up 12 lane 88 (#2614 follow-up): a "Sacrifice
     * this [permanent]:" cost on a triggered ability (Midnight Snack,
     * FDN 65's deferred half — "Sacrifice this artifact: create a
     * Food token"). When `true`, the engine surfaces a yes/no prompt
     * (`sacrifice_self_prompt` waitingChoice) at trigger resolution;
     * on yes, the source permanent is sacrificed BEFORE the trigger's
     * effects resolve; on no, the trigger does nothing (CR 602.2b).
     *
     * The v1 supports only `sacrifice_self: true` (a self-sacrifice
     * cost). Multi-target sacrifice costs, hybrid mana costs combined
     * with sacrifice, and "sacrifice this OR pay X life" alternates
     * are follow-up lanes. Mutual exclusion with `modes`: a single
     * trigger is either modal OR has a sacrifice cost, not both.
     */
    cost: z
      .object({
        sacrifice_self: z.literal(true).optional(),
        /**
         * Wave 4.8 follow-up 13 lane 98 (#2614 follow-up):
         * the "you may discard a card as cost" arm
         * (Storm Fleet Spy variant — parallel to the lane
         * 88 sacrifice-self substrate). When set, the
         * engine surfaces a yes/no prompt
         * (`discard_prompt` WaitingChoice) at trigger
         * resolution; on yes, the controller discards
         * `amount` cards (the lane 87 `startDiscard` helper
         * surfaces a target-card choice — v1 minimum uses
         * a simple "discard a random card" path; multi-card
         * discard with explicit targeting is a follow-up
         * lane); on no, the trigger does nothing
         * (CR 602.2b).
         *
         * v1 supports `amount: 1` only (single-card
         * discard). The "discard 2 cards" variant rides
         * a follow-up lane.
         */
        discard: z
          .object({
            amount: z.number().int().min(1).max(1),
          })
          .strict()
          .optional(),
        /**
         * Wave 4.8 follow-up 13 lane 106 (#2614 follow-up):
         * the "you may pay [life]; if you do, [X]"
         * alternate cost ("you may pay 5 life; if you do,
         * draw a card" — the Aether Burst /
         * Skeleton Scarab / Necropotence-style cost).
         * The arm is parallel to the lane 88
         * `sacrifice_self` substrate and the lane 98
         * `discard` substrate; the engine consult's
         * `resolveScriptedAbility` cost-dispatch block
         * runs `loseLife(state, controllerId, amount,
         * cardId)` on `cost_paid === true` (reusing the
         * existing `resolveLifeLossEffect` helper).
         *
         * v1 supports a single integer `amount`. The
         * "pay 0 life" / "pay any amount of life"
         * variants ride follow-up lanes.
         */
        pay_life: z
          .object({
            amount: z.number().int().min(1),
          })
          .strict()
          .optional(),
        /**
         * Wave 4.8 follow-up 17 lane 117 (#2614 follow-up):
         * the "pay [mana]; if you do, [X]" trigger-cost
         * substrate (parallel to the lane 106
         * `pay_life` arm). When set, the engine surfaces a
         * yes/no prompt (`pay_mana_prompt` waitingChoice)
         * at trigger resolution; on yes, the controller
         * pays `amount` generic mana via the existing
         * `spendMana(state, controllerId, { generic:
         * amount })` helper; on no, the trigger does
         * nothing (CR 602.2b).
         *
         * v1 supports a single integer `amount` of generic
         * mana (the cascade pays generic first, then
         * colorless, then colored — the standard
         * spendMana cascade). The "pay [colored] mana"
         * variant rides a follow-up lane; the
         * "pay any amount" variant rides a follow-up lane.
         *
         * The combined `you_may + pay_life` + `pay_mana`
         * shape (the handoff's "you_may + pay_life
         * combined" wording) is NOT a single composite
         * arm — the bridge is the side-by-side use of
         * `pay_mana` and `pay_life` on the same trigger
         * `cost` object, with `you_may: true` orchestrating
         * the yes/no flow. A card with
         * `cost: { pay_mana: { amount: 2 } }` is the
         * canonical single-cost shape; the multi-cost
         * combinator rides a future lane.
         */
        pay_mana: z
          .object({
            amount: z.number().int().min(1).max(99),
          })
          .strict()
          .optional(),
        /**
         * Wave 4.8 follow-up 21 lane 99 follow-up extension
         * (#2614 follow-up): the multi-cost OR combinator
         * ("you may pay [A] OR pay [B]; if you do,
         * [effects]" — Skeletonize / Oracle-shaped choices
         * on the cost). The arm is a non-empty array of
         * single-arm cost shapes (one of `sacrifice_self`
         * / `discard` / `pay_life` / `pay_mana` — the same
         * v1 substrate as the standalone `cost.<arm>`
         * siblings). The combinator surfaces a
         * `cost_combinator_or_prompt` waitingChoice at
         * trigger resolution; on the first resolve pass the
         * controller picks one (0-based index stamped on
         * `stackObject.chosen_or_cost_index`); on the
         * second pass the picked cost runs through the
         * existing lane 88 / 98 / 106 / 117 dispatch as if
         * it were the standalone `cost.<arm>` shape.
         *
         * The arm is mutually exclusive with the
         * standalone `cost.<arm>` siblings (the refine
         * rule rejects the dual shape) and requires
         * `you_may: true` (the yes/no gate is the
         * precondition for picking which arm to pay).
         * v1 ships the 2-arm minimum (`min(2)`); 3+ arms
         * ride a follow-up lane.
         */
        or: z
          .array(
            z.union([
              z.object({ sacrifice_self: z.literal(true) }).strict(),
              z
                .object({
                  discard: z
                    .object({ amount: z.number().int().min(1).max(1) })
                    .strict(),
                })
                .strict(),
              z
                .object({
                  pay_life: z
                    .object({ amount: z.number().int().min(1) })
                    .strict(),
                })
                .strict(),
              z
                .object({
                  pay_mana: z
                    .object({ amount: z.number().int().min(1).max(99) })
                    .strict(),
                })
                .strict(),
            ]),
          )
          .min(2)
          .optional(),
      })
      .strict()
      .optional(),
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
  .refine((t) => t.you_may_cost === undefined || t.you_may === true, {
    message: "you_may_cost requires you_may: true (lane 93, #2614)",
  })
  .refine(
    (t) => !(t.you_may_cost !== undefined && t.cost?.sacrifice_self === true),
    {
      message:
        "you_may_cost and cost.sacrifice_self are mutually exclusive on a trigger (lane 93, #2614) — the cost substrate's sacrifice-self gate subsumes the lane 88 / 93 paths",
    },
  )
  .refine((t) => !(t.cost?.sacrifice_self === true && t.modes !== undefined), {
    message:
      "cost.sacrifice_self and modes are mutually exclusive on a trigger (lane 88, #2614)",
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
      t.cost?.or === undefined ||
      !(
        t.cost.sacrifice_self === true ||
        t.cost.discard !== undefined ||
        t.cost.pay_life !== undefined ||
        t.cost.pay_mana !== undefined
      ),
    {
      message:
        "cost.or is mutually exclusive with the standalone cost arms (pay_life, pay_mana, sacrifice_self, discard) — pick one shape",
    },
  )
  .refine((t) => t.cost?.or === undefined || t.you_may === true, {
    message:
      "cost.or requires you_may: true (the yes/no gate is the precondition for picking which cost arm to pay)",
  })
  .refine(
    (t) =>
      t.event === "cast" ||
      (t.caster === undefined &&
        t.spell === undefined &&
        t.targets === undefined &&
        t.cast_color === undefined &&
        t.X === undefined),
    {
      message:
        "caster, spell, targets, cast_color and X are only for cast triggers (lane 116, #2614)",
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
    /**
     * Wave 4.8 follow-up 13 lane 61b (#2614 follow-up):
     * `death_replacement` — a printed-card mechanism for
     * the "if a creature you control would die, instead
     * exile it" replacement effect. The structured form
     * lives in `ReplacementEffectSchema` (lane 61a); this
     * static arm is the LEGACY / printed-oracle bridge —
     * the engine reads the source's printed
     * `cardData.oracle_text` at refresh time and builds a
     * `deathReplacement` per-instance ledger for any
     * "would die, instead [destination]" clauses it parses.
     * The replacement consult in `moveCardToZone`
     * (lane 61a) reads both the lane 61a schema arm AND
     * this ledger, so a card whose only mechanism is the
     * printed `static` (Whip of Erebos's actual oracle —
     * "Creatures you control have lifelink. Whenever a
     * creature you control would die, exile it instead.")
     * works end-to-end via `refreshScriptedStatics`.
     *
     * v1 supports a single shape: the source declares
     * `"if a creature you control would die, instead
     * exile it"` in its `cardData.oracle_text`, and the
     * static's `text` field mirrors that line for the
     * drafter's reference. The engine builds a
     * `replacement_effects` entry on the source's
     * per-instance `deathReplacement` field via
     * `refreshScriptedStatics`, and the consult picks it
     * up. Multi-target / conditional targets / etc. ride
     * follow-up lanes (100 / 102 / 103 / 104 / 105).
     *
     * The `parser` arm lets the drafter bypass the
     * default oracle-text parser by listing known
     * substrings to match (avoids brittleness on
     * in-game phrases). Default: the parser reads the
     * source's `cardData.oracle_text` for "would die,
     * instead exile it" / "you'd die, exile instead"
     * substrings.
     */
    death_replacement: z
      .object({
        /**
         * Free-form description for the drafter. The
         * engine doesn't read this — it's metadata.
         */
        description: z.string().min(1).optional(),
        /**
         * Whether the printed effect is mandatory or
         * optional. Lane 61b defaults to mandatory
         * (Whip of Erebos's "if [thing] would die,
         * instead exile it" has no "you may"). Out of
         * scope: the `optional: true` engine arm
         * (lane 100).
         */
        optional: z.literal(false).default(false),
      })
      .strict()
      .optional(),
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
         * Wave 4.8 follow-up 14 lane 51 (#2614 follow-up): a
         * permanent (not end-of-turn) "this creature is the
         * chosen type in addition to its other types" static
         * — Adaptive Automaton's type-change half. Parallel
         * to lane 52's `add_creature_type` + `addCreatureTypeToSelf`
         * pair but the chosen type is **always** resolved
         * from `source.chosenCreatureType` (no literal-string
         * variant — by definition the chosen type IS the
         * instance's chosen type). The engine extends the
         * source's `cardData.type_line` permanently to include
         * the chosen subtype alongside the printed subtypes,
         * so call sites that read `cardData.type_line`
         * directly (rather than the `subtypesOf` helper
         * unioning `chosenTypeAdditions`) see the addition.
         * The overlay is held in a per-instance
         * `permanentTypeOverlay` field (parallel to
         * `animatedUntilEndOfTurn.cardData` but persistent —
         * no EOT cleanup; cleared only when the source leaves
         * the battlefield). v1 is self-only (matches lane
         * 52's self-only semantics); the Aura-style
         * generalization rides a follow-up lane. The chosen
         * type evicts naturally on zone change because the
         * static itself is battlefield-zone-only.
         *
         * Used by Adaptive Automaton's "is the chosen type
         * in addition to its other types" half. Distinct
         * from `add_creature_type` + `addCreatureTypeToSelf`
         * (lane 52): the lane 52 arm only stamps the
         * `chosenTypeAdditions` field which the local
         * `subtypesOf` helper unions with the printed type
         * line; the lane 51 arm ALSO overlays the printed
         * `cardData.type_line` itself. Both arms may
         * coexist on the same card without conflict (the
         * lane 51 arm produces the overlay; the lane 52 arm
         * produces the parallel `chosenTypeAdditions` —
         * both read paths see the chosen type). The lane
         * 51 arm without a `chosenCreatureType` resolved
         * (no enter choice) is inert.
         */
        becomes_chosen_creature_type: z.literal(true).optional(),
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
      .strict()
      // Wave 4.8 follow-up 18 lane 112 (#2614 follow-up):
      // the `affects` slot is now optional. v1 statics
      // that have at least one of `affects`,
      // `power`, `toughness`, etc. use `affects` for
      // per-target filtering. Lane 61b's pure
      // `death_replacement` meta-static
      // (Whip of Erebos-style replacement effects)
      // also carries `affects` in v1 — the consult
      // reads `source.controllerId` rather than the
      // static's `affects.controller` for the
      // replacement-applies-to set, but the schema
      // requires the field for symmetry. The lane 112
      // self-grant arm — and any future
      // meta-static arms — may legitimately omit
      // `affects` because the meta-static doesn't
      // apply per-target (it stamps the source's own
      // `grantedTriggers` field via a side channel).
      // Without the `.optional()`, such meta-statics
      // would fail schema validation.
      .optional(),
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
    /**
     * Wave 4.8 follow-up 23 lane 32 (#2614 follow-up): the
     * "per count" P/T scaling modifier — the Warrior
     * Knights / adaptive anthem family that grows with the
     * board. Combines with `power` / `toughness` to model
     * "creatures you control get +1/+1 for each creature
     * you control" patterns without a redundant integer
     * pair. v1 single shape: a count source + a per-unit
     * power contribution + a per-unit toughness
     * contribution. Standard sample:
     *
     *   {
     *     anthemScaling: {
     *       per: "other_creatures",
     *       perPower: 1,
     *       perToughness: 1,
     *     },
     *   }
     *
     * ...with `affects: { controller: "you", other: true }`
     * gives "Other creatures you control get +1/+1 for
     * each other creature you control."
     *
     * The count sources parallel the lane 36 `X` enum —
     * `other_creatures` is the lane 32 addition that
     * excludes the source (the "OTHER creatures you
     * control" semantics — the source doesn't count
     * itself). v1 supports a single count source; multi-
     * source scaling (e.g. "for each creature OR artifact
     * you control") is a follow-up sub-piece.
     *
     * Out of scope (each a follow-up lane): filtered
     * count sources ("per creature of the chosen type"),
     * compound count sources ("per creature AND artifact
     * you control"), and a per_unit shape with a unit-
     * type filter ("per +1/+1 counter on this creature").
     *
     * Wave 4.8 follow-up 24 lane 32 piece 2/N (#2614
     * follow-up): an OPTIONAL `perSubtype?: string`
     * field that, when set, filters the count iteration
     * to permanents whose `cardData.type_line` matches
     * the given creature (or permanent) type. v1 takes a
     * FIXED TYPE STRING — the chosen-type variant ("per
     * creature of the chosen type" — `chosenCreatureType`
     * field on the source) rides a follow-up sub-piece.
     * The existing `affects.subtype` field already filters
     * WHICH permanents the anthem AFFECTS; this field
     * filters the COUNT SOURCE specifically. Sample:
     *
     *   "Other creatures you control get +1/+1 for each
     *   other Warrior you control"
     *   →
     *   {
     *     affects: {
     *       controller: "you",
     *       other: true,
     *       subtype: "Creature",
     *     },
     *     anthemScaling: {
     *       per: "other_creatures",
     *       perPower: 1,
     *       perToughness: 1,
     *       perSubtype: "Warrior",
     *     },
     *   }
     *
     * The engine's `computeAnthemScalingCount` consults
     * `perSubtype` when set and filters the count
     * iteration to cards whose `type_line` includes the
     * given subtype as a case-insensitive substring
     * (matching how the existing `computeX` looks up
     * "Treasure" / "Creature" / "Land" — the chosen
     * "Warrior" type matches cards whose `type_line`
     * contains "Warrior"). When unset, the count is
     * unfiltered (the v1 default).
     *
     * Out of scope (each a follow-up lane): the
     * chosen-type variant of the `perSubtype` field
     * ("per creature of the chosen type" — driven by a
     * `chosenCreatureType` field on the source), and a
     * per-counter scaling shape ("per +1/+1 counter on
     * this creature"). The compound "AND" variant rides
     * follow-up 25 piece 2/N.
     */
    anthemScaling: z
      .object({
        /**
         * The state-derived count source. v1 single shape
         * — the per-unit P/T contribution is multiplied by
         * the count of this source on the source's
         * controller's battlefield.
         */
        per: z.enum(["creatures", "treasures", "lands", "other_creatures"]),
        /**
         * The power contribution per unit. Default 0
         * (matches the integer `power: 0` no-P/T pattern);
         * +1 for the "+1/+1 per creature" family.
         */
        perPower: z.number().int().default(0),
        /**
         * The toughness contribution per unit. Default 0
         * (matches the integer `toughness: 0` no-P/T
         * pattern); +1 for the "+1/+1 per creature"
         * family.
         */
        perToughness: z.number().int().default(0),
        /**
         * Wave 4.8 follow-up 24 lane 32 piece 2/N
         * (#2614 follow-up): an OPTIONAL subtype filter
         * on the count source. When set, the count
         * iteration skips permanents whose `type_line`
         * does NOT include the given subtype as a
         * case-insensitive substring (matching how
         * `computeX` looks up "Treasure" / "Creature" /
         * "Land"). When unset, the count source is
         * unfiltered (the v1 default — the count
         * includes every permanent matching the `per`
         * arm).
         *
         * Wave 4.8 follow-up 25 lane 32 piece 3/N
         * (#2614 follow-up): the `"chosen"` sentinel.
         * A sentinel meaning "use the source's
         * `chosenCreatureType` instance field". Only
         * valid when the source has `enter_choice: {
         * kind: "creature_type" }` (the lane 44
         * substrate); the engine
         * (`computeAnthemScalingCount` in
         * `keyword-actions/scripted-statics.ts`) reads
         * `source.chosenCreatureType` and substitutes it
         * (parallel to `affects.subtype: "chosen"` at the
         * affects-side filter — see line ~2152). If
         * `chosenCreatureType` is null (the enter choice
         * hasn't resolved yet) the count is 0 — the
         * scripted anthem remains inert until the player
         * makes the enter choice. Used by a chosen-type
         * anthem ("creatures you control of the chosen
         * type get +1/+1 for each OTHER creature you
         * control OF THE CHOSEN TYPE" — exercises both
         * the affects-side filter AND the count-side
         * filter in one pass).
         */
        perSubtype: z
          .union([z.string().min(1), z.literal("chosen")])
          .optional(),
        /**
         * Wave 4.8 follow-up 25 lane 32 piece 2/N
         * (#2614 follow-up): an OPTIONAL secondary
         * AND-source for the count. When set, the count
         * is `count(per) + count(andPer.per)` (CR
         * 613.4c-style multi-source scaling — a card
         * granting "+1/+1 for each creature AND artifact
         * you control" reads as the sum of both source
         * counts). The `andPer` shares the same `per`
         * enum + optional `perSubtype` filter as the
         * primary source; the v1 minimum is two sources
         * summed (a more expressive multi-arm array
         * variant rides a later follow-up).
         *
         * Sample card: a synthetic anthem registered via
         * the test harness with `per: "creatures",
         * andPer: { per: "treasures" }` ("Creatures you
         * control get +1/+1 for each creature AND each
         * Treasure you control"). The count is
         * `creatures_count + treasures_count`.
         *
         * Wave 4.8 follow-up 27 lane 32 piece 1/N
         * (#2614 follow-up): the `andPer.perCounter`
         * OPTIONAL self-referential per-counter arm
         * (parallel to the primary `perCounter` arm).
         * When set on the `andPer` arm, REPLACES the
         * `andPer.per` state-derived count with the
         * SOURCE's own per-counter count — the compound
         * count is `count(per) + count(andPer.perCounter)`
         * (matches how the primary `perCounter` REPLACES
         * the primary `per` entirely). The
         * `andPer.perCounter.counter` accepts the
         * `"chosen"` sentinel — the engine resolves the
         * counter type from `source.chosenCreatureType`
         * (parallel to the primary `perCounter` sentinel
         * and the `perSubtype: "chosen"` sentinel — the
         * same instance field drives all three
         * substrates via independent branches in
         * `computeAnthemScalingCount`).
         *
         * The `andPer.perCounter` arm is INDEPENDENT
         * from the `andPer.per` enum + `andPer.perSubtype`
         * filter — they are not both consulted in the
         * same pass. When `andPer.perCounter` is set,
         * the `andPer.per` and `andPer.perSubtype`
         * fields are ignored (the per-counter count
         * replaces them). This matches the primary
         * `perCounter` arm's "REPLACES the `per` arm
         * entirely" semantic.
         *
         * Out of scope (each a follow-up lane): the
         * exclusion variant ("per creature but NOT
         * artifact") and the OR combinator (lane 36's
         * `X.or`-style matrix).
         */
        andPer: z
          .object({
            per: z.enum(["creatures", "treasures", "lands", "other_creatures"]),
            perSubtype: z
              .union([z.string().min(1), z.literal("chosen")])
              .optional(),
            /**
             * Wave 4.8 follow-up 27 lane 32 piece 1/N
             * (#2614 follow-up): an OPTIONAL self-
             * referential per-counter arm on the
             * `andPer` AND-source. When set, the
             * `andPer` contribution to the compound
             * count becomes the SOURCE's own
             * per-counter count (REPLACES the
             * `andPer.per` state-derived count). The
             * `counter` field accepts the `"chosen"`
             * sentinel — the engine resolves the
             * counter type from
             * `source.chosenCreatureType` (parallel
             * to the primary `perCounter` sentinel
             * from follow-up 26 piece 1/N).
             */
            perCounter: z
              .object({
                counter: z.union([z.string().min(1), z.literal("chosen")]),
                /**
                 * Wave 4.8 follow-up 28 priority 1
                 * (#2614 follow-up): an OPTIONAL
                 * ordinal variant on the
                 * `andPer.perCounter` arm. Mirrors the
                 * primary `perCounter.ordinal?` field
                 * — when set, the per-counter count is
                 * the CUMULATIVE sum of the first
                 * `ordinal` counters of the resolved
                 * type on the source. When unset, the
                 * existing semantic is used (sum of
                 * ALL counters of the resolved type).
                 * The primary `perCounter.ordinal?` and
                 * the `andPer.perCounter.ordinal?`
                 * fields are INDEPENDENT (each applies
                 * to its own arm).
                 */
                ordinal: z.number().int().min(1).optional(),
              })
              .strict()
              .optional(),
            /**
             * Wave 4.8 follow-up 28 priority 3
             * (#2614 follow-up): the SUMMED
             * per-counter arm on the `andPer`
             * AND-source. The natural read for
             * "per creature AND per chosen counter"
             * anthems — the per-counter count is
             * SUMMED with the `andPer.per`
             * state-derived count (NOT replaced).
             * The follow-up 27 piece 1/N
             * `andPer.perCounter` arm REPLACES the
             * state-derived count (parallel to the
             * primary `perCounter` REPLACES the
             * primary `per`); this new
             * `andPer.perCounterSummed` arm is the
             * SUMMED alternative for "per creature +
             * per counter" anthems where the
             * REPLACE semantic is wrong (the
             * REPLACE form is a special case for
             * self-referential count sources;
             * the summed form is the CORRECT shape
             * for most "per + perCounter" use
             * cases). v1 minimum: the SUMMED arm
             * lives alongside the REPLACE arm
             * (both are valid). When BOTH are set,
             * the SUM arm takes precedence
             * (the SUM is the natural read).
             * Future lane: deprecating the REPLACE
             * arm (the self-referential case is
             * rare; the summed form covers 90%+ of
             * use cases) rides follow-up 29.
             */
            perCounterSummed: z
              .object({
                counter: z.union([z.string().min(1), z.literal("chosen")]),
                /**
                 * Wave 4.8 follow-up 28 priority 3
                 * (#2614 follow-up): an OPTIONAL
                 * ordinal variant on the
                 * `andPer.perCounterSummed` arm.
                 * Mirrors the primary
                 * `perCounter.ordinal?` field —
                 * when set, the summed per-counter
                 * count is the CUMULATIVE sum of the
                 * first `ordinal` counters of the
                 * resolved type on the source. When
                 * unset, the summed per-counter
                 * count is the sum of ALL counters
                 * of the resolved type (which is
                 * then ADDED to the
                 * `andPer.per` state-derived count).
                 */
                ordinal: z.number().int().min(1).optional(),
              })
              .strict()
              .optional(),
          })
          .strict()
          .optional(),
        /**
         * Wave 4.8 follow-up 25 lane 32 piece 4/N
         * (#2614 follow-up): an OPTIONAL self-referential
         * per-counter count source. When set, REPLACES
         * the `per` arm's state-derived count with the
         * source's own per-counter count — the count is
         * `card.counters?.find(c => c.type ===
         * counter)?.count ?? 0` (matches how
         * `evergreen-keywords.getEffectivePower` reads
         * the +1/+1 counter from the same field — see
         * `evergreen-keywords.ts` line ~973). v1
         * supports a single counter type per arm; a
         * chosen-counter variant rides follow-up 26+.
         *
         * Wave 4.8 follow-up 26 lane 32 piece 1/N
         * (#2614 follow-up): the `"chosen"` sentinel
         * for `perCounter.counter`. When the field is
         * the sentinel, the engine resolves the
         * counter type from `source.chosenCreatureType`
         * (parallel to the `perSubtype: "chosen"`
         * sentinel — the same instance field drives both
         * substrates via independent branches in
         * `computeAnthemScalingCount`). If
         * `chosenCreatureType` is null (the
         * `enter_choice: { kind: "creature_type" }`
         * resolve hasn't happened yet), the count is 0
         * (the scripted anthem remains inert — matches
         * the lane 86 chosen-type anthem semantics).
         *
         * Sample card: a chosen-counter anthem ("this
         * creature gets +1/+1 for each [chosen counter
         * kind] on it" — combined with `enter_choice: {
         * kind: "creature_type" }` resolving to "Marker
         * Counter" or similar — exercises both the
         * sentinel substitution AND the per-counter
         * count in one pass).
         *
         * Out of scope: the `andPer` / `perSubtype`
         * combinations with `perCounter` (the
         * per-counter arm REPLACES the `per` arm
         * entirely; a hybrid "per creatures + per
         * counter" arm is a follow-up lane). The
         * `perCounter.counter: "chosen"` interaction
         * with `andPer` / `perSubtype` rides follow-up
         * 27.
         *
         * Wave 4.8 follow-up 28 priority 1 (#2614
         * follow-up): the OPTIONAL `ordinal: number`
         * field on `perCounter`. When set, the
         * per-counter count is the CUMULATIVE sum of
         * the first `ordinal` counters of the resolved
         * type on the source (matches MTG "Nth counter"
         * semantics — a source with 3 +1/+1 counters
         * and `ordinal: 2` contributes 2, not 3). When
         * unset, the existing semantic is used (sum of
         * ALL counters of the resolved type). The
         * `"chosen"` sentinel resolves the counter type
         * first; the ordinal then applies to the
         * resolved type. v1 minimum is the per-source
         * Nth-counter read; a per-pair counter ordinal
         * ("Nth counter of each unique type") rides a
         * future lane.
         */
        perCounter: z
          .object({
            counter: z.union([z.string().min(1), z.literal("chosen")]),
            /**
             * Wave 4.8 follow-up 28 priority 1 (#2614
             * follow-up): an OPTIONAL ordinal variant
             * on the per-counter arm. When set, the
             * count is the CUMULATIVE sum of the first
             * `ordinal` counters of the resolved type
             * on the source (matches MTG "Nth counter"
             * semantics — a source with 3 +1/+1
             * counters and `ordinal: 2` contributes 2,
             * not 3). When unset, the existing
             * per-counter semantic is used (sum of ALL
             * counters of the resolved type). The
             * `"chosen"` sentinel resolves the counter
             * type first; the ordinal then applies to
             * the resolved type. v1 minimum: the
             * ordinal is a per-source Nth-counter read;
             * a per-pair counter ordinal variant (a
             * second arm that reads "Nth counter of
             * each unique type") rides a future lane.
             *
             * Wave 4.8 follow-up 29 priority 4 (lane
             * 32) (#2614 follow-up): the OPTIONAL
             * `perPair` arm — a per-pair cross-type
             * variant ("Nth counter of each unique
             * type"). When set, the count is the SUM
             * across all unique counter types of the
             * cumulative sum of the first `ordinal`
             * counters of each type. A source with 2
             * +1/+1 counters + 3 -1/-1 counters with
             * `perPair.ordinal: 2` contributes 2 +1/+1
             * + 2 -1/-1 = 4 (NOT 2 + 3 = 5 — the
             * cross-type summation is per-pair, not
             * per-counter cumulative). The `perPair`
             * arm lives alongside the existing
             * `perCounter` arm; both can be set, but
             * the `perPair` arm takes precedence when
             * both are set (parallel to the
             * `andPer.perCounterSummed` precedence
             * rule from follow-up 28 priority 3). The
             * `perPair.ordinal` defaults to 1
             * (cumulative sum of the FIRST counter of
             * each unique type — a "first counter per
             * pair" read). v1 minimum: the `perPair`
             * ordinal-only cross-type read (no per-pair
             * sentinel extension; the per-pair-with-
             * sentinel rides follow-up 30).
             */
            ordinal: z.number().int().min(1).optional(),
            /**
             * Wave 4.8 follow-up 29 priority 4 (lane
             * 32) (#2614 follow-up): the OPTIONAL
             * `perPair` arm. When set, the per-counter
             * count is the SUM across all unique
             * counter types of the cumulative sum of
             * the first `perPair.ordinal` counters of
             * each type. When unset, the existing
             * `perCounter.ordinal?` semantic is used
             * (cumulative sum of the first
             * `perCounter.ordinal` counters of the
             * resolved type). Both `perCounter` and
             * `perPair` can be set on the same arm
             * (they're independent Zod fields); when
             * both are set, `perPair` takes precedence
             * (the per-pair is the "Nth counter of
             * each unique type" read; a separate arm
             * from the per-counter Nth-counter read).
             * The `andPer.perCounter perPair` parallel
             * ordinal extension rides follow-up 30.
             */
            perPair: z
              .object({
                ordinal: z.number().int().min(1).optional(),
              })
              .strict()
              .optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    /**
     * Wave 4.8 follow-up 12 lane 91 (#2614 follow-up): a
     * CR 603. "while-condition" gate on the static ability itself
     * (Twinblade Paladin's "as long as you have 25 or more life,
     * this creature has double strike and lifelink"). When the
     * gate evaluates false, the static's `keywords` / `power` /
     * `toughness` are NOT applied at refresh time; when true,
     * the static applies normally.
     *
     * Wave 4.8 follow-up 14 lane 57 (#2614 follow-up): extends
     * the discriminator with `counter_minimum` — the static
     * applies only when the source's per-instance
     * `card.instanceCounters[counter]` matches the comparator:
     *   - `op: "gte"` → `count >= n`
     *   - `op: "eq"`  → `count === n`
     * Default behavior on absent counters is `0`. Used by
     * Redcap Gutter-Dweller's "Goblins you control have menace
     * as long as this has three or more counters on it" half
     * (`counter: "+1/+1", op: "gte", n: 3`).
     */
    while_condition: z
      .discriminatedUnion("kind", [
        z
          .object({
            kind: z.literal("life_minimum"),
            value: z.number().int().min(1),
          })
          .strict(),
        z
          .object({
            kind: z.literal("counter_minimum"),
            counter: z.string().min(1),
            op: z.enum(["gte", "eq"]),
            n: z.number().int().min(0),
          })
          .strict(),
      ])
      .optional(),
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
     * Wave 4.8 follow-up 26 lane 71 piece 3/N (#2614
     * follow-up): the `"chosen"` sentinel for
     * `protectionFrom`. When the field is the sentinel, the
     * engine resolves the protected quality from
     * `source.chosenProtectionFrom` (parallel to the lane 86
     * chosen-type anthem `affects.subtype: "chosen"` +
     * follow-up 25 lane 32 piece 3/N `perSubtype: "chosen"`
     * + follow-up 26 lane 32 piece 1/N `perCounter.counter:
     * "chosen"` — the same `enter_choice: { kind:
     * "protection_quality" }` enter-choice instance field
     * drives the substrate). If `chosenProtectionFrom` is
     * null (the enter choice hasn't resolved yet), the
     * static is INERT for that pass (no qualities stamped;
     * matches the lane 86 chosen-type anthem "null"
     * semantics).
     *
     * Sample card: a chosen-quality anthem ("creatures you
     * control have protection from the chosen color")
     * combined with `enter_choice: { kind:
     * "protection_quality" }`. The anthem grants protection
     * from the chosen quality to each affected permanent
     * (a red creature + a red-quality anthem verify the
     * protection is honored at cast time and combat time).
     *
     * Out of scope (each a follow-up lane): the
     * union with the per-source per-quality ledger
     * (the follow-up 26 lane 71 piece 2/N parked out as
     * a redundant fourth ledger); the `affects.subtype:
     * "chosen"` interaction with `protectionFrom: "chosen"`
     * (the sentinel resolves independently of the
     * `chosenCreatureType` instance field — different
     * field, same resolution pattern).
     *
     * Wave 4.8 follow-up 27 lane 71 piece 3/N (#2614
     * follow-up): the per-entry `"chosen"` sentinel
     * (multi-quality sentinel). The protectionFrom
     * field accepts a per-entry union form
     * `z.array(z.union([z.string().min(1),
     * z.literal("chosen")]))` so a multi-quality
     * anthem can grant protection from a list of
     * literal qualities AND the chosen quality in the
     * same arm (e.g. `["red", "chosen"]` = "protection
     * from red AND the chosen quality"). The
     * `"chosen"` entry is resolved from
     * `source.chosenProtectionFrom` (the same
     * `enter_choice: { kind: "protection_quality" }`
     * instance field as the standalone sentinel). When
     * `chosenProtectionFrom` is null, the `"chosen"`
     * entry contributes 0 qualities (the static
     * still grants the literal entries — the entry-
     * level resolution is independent per entry).
     *
     * Wave 4.8 follow-up 28 priority 2 (#2614
     * follow-up): the array-aware entry shape
     * (nested-array "pair" form).
     */
    protectionFrom: z
      .union([
        z.array(z.string().min(1)),
        z.literal("chosen"),
        z.array(
          z.union([
            z.string().min(1),
            // Wave 4.8 follow-up 28 priority 2 (#2614
            // follow-up): the array-aware entry shape
            // (nested-array "pair" form). Each nested
            // array is a list of ≥ 2 literal qualities
            // representing a "pair" (e.g.
            // `["red", "green"]` = "protection from the
            // red/green pair"). A 1-element nested
            // array is REJECTED via `.min(2)` to avoid
            // confusion with the flat literal form.
            // The engine consult FLATTENS each entry's
            // nested array to its literal entries
            // before stamping the resolved qualities
            // list. A 0-element array is also rejected
            // (`.min(2)` covers both bounds). The
            // `"chosen"` sentinel resolution is
            // independent of the pair-flattening (the
            // `"chosen"` literal still reads
            // `source.chosenProtectionFrom`).
            //
            // Wave 4.8 follow-up 29 priority 5 (lane
            // 71) (#2614 follow-up): the per-pair
            // `"chosen"` sentinel entry. The
            // nested array now ALSO accepts a
            // `"chosen"` sentinel entry — the
            // engine consult FLATTENS each
            // nested array to its literal
            // entries AND resolves the
            // `"chosen"` entry via
            // `source.chosenProtectionFrom`.
            // The resulting quality is added to
            // the flattened list (alongside the
            // literal entries). v1 minimum: a
            // single `"chosen"` entry inside
            // the nested array (the
            // per-pair-with-sentinel extension
            // rides follow-up 30; the
            // per-pair-with-`"chosen"`-per-pair
            // extension rides follow-up 30 too).
            z.array(z.union([z.string().min(1), z.literal("chosen")])).min(2),
            z.literal("chosen"),
          ]),
        ),
      ])
      .optional(),
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
             *
             * Wave 4.8 follow-up 22 lane 70 piece 1/N
             * (#2614 follow-up): `until` now also
             * accepts `"permanent"` — the "becomes a
             * copy of [X] forever" variant (Clone,
             * Phantasmal Image without the EOT
             * suffix). v1 ships the schema arm + the
             * substrate only; the refresh-pass write
             * that honours the permanent overlay
             * rides a follow-up piece (the field is
             * parseable and the substrate stamps
             * `copyOfTargetIdPermanent` onto the
             * source, but the overlay itself is not
             * yet applied).
             */
            target: z.string().min(1),
            until: z.union([z.literal("end_of_turn"), z.literal("permanent")]),
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
                add_subtype: z.array(z.string().min(1)).min(1).optional(),
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
            /**
             * Wave 4.8 follow-up 22 lane 70 piece 1/N
             * (#2614 follow-up): `until` now also
             * accepts `"permanent"` for the named-card
             * copy variant. Same substrate / engine
             * split as the `target` arm — v1 ships the
             * schema + the `copyOfTargetIdPermanent`
             * field; the refresh-pass write rides a
             * follow-up piece.
             */
            until: z.union([z.literal("end_of_turn"), z.literal("permanent")]),
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
                add_subtype: z.array(z.string().min(1)).min(1).optional(),
              })
              .strict()
              .optional(),
          })
          .strict(),
      ])
      .optional(),
    /**
     * Wave 4.8 follow-up 18 lane 112 (#2614 follow-up):
     * the self-grant triggered-ability arm of `StaticSchema`.
     * CR 603.2 grant semantics — the source's own static
     * copies one or more triggered abilities onto the
     * SOURCE itself. Mirrors the lane 65 Aura-shaped
     * variant (`AuraStaticSchema.grants.triggers`, which
     * grants triggers onto the ENCHANTED card) but routes
     * the grant onto the source. The engine consumer
     * (`refreshScriptedStatics`) reads the static's
     * `grants.triggers` list and merges each entry into
     * the source's per-instance `grantedTriggers` field
     * with `from: source.id` and `sourceControllerId:
     * source.controllerId`; the trigger fire path
     * (`detectTriggeredAbilities` in
     * `abilities/triggered.ts`) already reads the
     * `grantedTriggers` list (lane 65's path) and fires
     * alongside the card's own scripted triggers.
     *
     * v1 supports a single `event: "dies"` trigger
     * (parallel to the lane 65 v1 minimum). Multi-event
     * grants (`["dies" | "etb" | "attacks"]`) and
     * grants that reference the source's controller
     * (vs the source's controller at fire time) ride
     * future lanes. CR 603.2: the static-creature
     * itself becomes the source of the granted trigger;
     * the trigger's `effect text` reads `[card name]
     * dies, …` (matching the lane 65 Aura path's
     * `When [enchanted card name] dies, …`).
     *
     * Use case (single-card sample + lane 112 v1): a
     * creature whose static reads "When this creature
     * dies, draw a card" but written as a self-grant
     * (the card has no native `triggers`; the static
     * grants the trigger). The v1 minimum covers the
     * self-dies shape so the lane parallels the Aura
     * pattern end-to-end.
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
      // Wave 4.8 follow-up 23 lane 32 (#2614 follow-up):
      // the scaling-anthem arm — the per-count P/T
      // modifier. Combines with the integer `power` /
      // `toughness` arms but is allowed as a stand-alone
      // arm for the "+1/+1 per [type]" family that has no
      // integer component (e.g.
      // `affects: { controller: "you", other: true }` +
      // `anthemScaling: { per: "other_creatures", perPower:
      // 1, perToughness: 1 }`).
      s.anthemScaling !== undefined ||
      // Wave 4.7 phase 2 lane 50 (#2708 phase 2b): the
      // chosen-name block is a meta-static — allow it as a
      // stand-alone arm. See lane 50's `chosen_name_block`
      // docstring.
      s.affects?.chosen_name_block === true ||
      // Wave 4.8 lane 52 (#2614 follow-up): chosen-type
      // addition is a pure type-changer — also a
      // meta-static, allowed as a stand-alone arm with the
      // `addCreatureTypeToSelf` flag.
      (s.affects?.add_creature_type !== undefined &&
        s.affects?.addCreatureTypeToSelf === true) ||
      // Wave 4.8 lane 55 (#2614 follow-up): chosen-color
      // addition is a pure color-changer — same
      // meta-static shape, allowed as a stand-alone arm
      // with the `addColorToSelf` flag. Redcap
      // Gutter-Dweller-style self-only semantics for v1.
      (s.affects?.add_color !== undefined &&
        s.affects?.addColorToSelf === true) ||
      // Wave 4.8 follow-up 14 lane 51 (#2614 follow-up):
      // a permanent type-line overlay meta-static —
      // `becomes_chosen_creature_type: true` is allowed
      // as a stand-alone arm. The engine overlays the
      // source's `cardData.type_line` permanently to
      // include the chosen creature type alongside the
      // printed subtypes (Adaptive Automaton's
      // type-change half). No P/T or keywords of its
      // own; the static only triggers the type-line
      // overlay.
      s.affects?.becomes_chosen_creature_type === true ||
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
      s.become_copy !== undefined ||
      // Wave 4.8 follow-up 12 lane 91 (#2614 follow-up):
      // a while-condition gate by itself isn't enough — the
      // keyword/power arm must still be present — but allow
      // it to be combined with `keywords: ["double strike",
      // "lifelink"]` (Twinblade Paladin). Always evaluated
      // alongside the keywords; nothing additional to add.
      s.while_condition !== undefined ||
      // Wave 4.8 follow-up 13 lane 61b (#2614 follow-up):
      // the `death_replacement` arm is a meta-static —
      // allow it as a stand-alone arm. The engine reads
      // the source's `cardData.oracle_text` and builds a
      // per-instance `deathReplacement` ledger (parallel
      // to `scriptStaticKeywords` for keyword grants).
      // No P/T or keyword changes of its own; the static
      // only triggers the death-replacement consult.
      s.death_replacement !== undefined ||
      // Wave 4.8 follow-up 18 lane 112 (#2614 follow-up):
      // the self-grant triggered-ability arm
      // (`grants.triggers`) is a meta-static — allow it
      // as a stand-alone arm. The engine reads the
      // source's `statics[].grants.triggers` list in
      // `refreshScriptedStatics` and merges each entry
      // onto the source's per-instance `grantedTriggers`
      // field (with `from: source.id`). The trigger fire
      // path (`detectTriggeredAbilities`) consumes the
      // list alongside the card's own scripted triggers —
      // no P/T or keyword changes of its own. The
      // v1 schema accepts an array of `event: "dies"`
      // + `effects[]` entries (parallel to the lane 65
      // Aura variant).
      (s.grants?.triggers?.length ?? 0) > 0,
    {
      message:
        "a static needs power/toughness, keywords, X, chosen_name_block, add_creature_type (with addCreatureTypeToSelf), add_color (with addColorToSelf), protectionFrom, becomes_chosen_creature_type, become_copy, death_replacement, anthemScaling, or grants.triggers",
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
     * Wave 4.8 follow-up 24 lane 70 piece 2/N (#2614
     * follow-up): `until` now also accepts
     * `"permanent"` — the Aura-shaped permanent-arm
     * copy variant (parallel to lane 70's `StaticSchema`
     * `become_copy: { until: "permanent" }` arm). The
     * engine writes the overlay onto the ENCHANTED card
     * via `refreshAuraBonuses` using the lane 70
     * `permanentCopyPrintedCardData` /
     * `copyOfTargetIdPermanent` substrate (snapshot +
     * overlay + battlefield-leave cleanup). The
     * overlay is NOT cleared at end of turn; it persists
     * for as long as the Aura is attached. The chosen
     * target's "in a tracked zone" cross-zones check is
     * inherited from lane 78 (the overlay applies for
     * any chosen target whose zone is in `state.zones`).
     * The Aura's own `copyOfTargetIdPermanent` ledger
     * is stamped by the substrate (parallel to the
     * lane 70 `setPermanentCopyOf` helper for the
     * source-driven overlay; the helper is reused
     * unchanged).
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
     * `restoreAnimatedOffBattlefield` rollback paths
     * (for the `end_of_turn` arm) or via the lane 70
     * `restorePermanentCopyOffBattlefield` cleanup +
     * Aura-detach rollback (for the `permanent` arm).
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
             * semantics, until end of turn,
             * or `permanent` — the
             * Aura-shaped permanent arm
             * added in follow-up 24 lane 70
             * piece 2/N). Validated at
             * refresh time via
             * `state.cards.has(targetId)` +
             * the lane 78 tracked-zone check.
             */
            target: z.string().min(1),
            until: z.union([z.literal("end_of_turn"), z.literal("permanent")]),
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
        "an aura static needs power/toughness, keywords, a restriction, maxBlockers, removesAllAbilities, grants, protectionFrom, become_copy, or anthemScaling",
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

/**
 * Wave 4.8 follow-up 13 lane 61a (#2614 follow-up):
 * ReplacementEffectSchema — the structured form of a CR 614.1
 * "if X would happen, instead Y" replacement effect, declarative
 * on a permanent card. Drives the foundational
 * `death_replacement` arm (Whip of Erebos-style "if a creature
 * you control would die, instead exile it") that
 * `moveCardToZone`'s consult and
 * `ReplacementEffectManager.processEvent` consume.
 *
 * The v1 minimum supports a single shape:
 *   `event: "would_die"` + `applies_to.type: "creature"` +
 *   `applies_to.controller: "you"` + `redirect.to: "exile"`.
 * Other `event` values, `applies_to` filters, and `redirect`
 * destinations ride follow-up lanes (100 / 101 / 102 / 103 /
 * 104 / 105). The schema is permissive — it accepts the wider
 * shape — but the engine only acts on the v1 minimum today.
 */
export const ReplacementEffectSchema = z
  .object({
    /**
     * Oracle-text-style description of the replacement effect
     * (e.g. "if a creature you control would die, instead exile
     * it"). Used by the engine to label the
     * `ReplacementAbility.description` and by the
     * `REPLACEMENT_CHOICE_TYPE` waitingChoice.
     */
    text: z.string().min(1),
    /**
     * The event this replacement effect watches. v1 supports
     * only `"would_die"`; other events are documented but not
     * yet implemented in the engine.
     */
    event: z.enum(["would_die", "would_be_destroyed"]).default("would_die"),
    /**
     * Which permanents the replacement effect applies to.
     * v1 minimum: `type: "creature"` + `controller: "you"`.
     * Other combinations parse but are out of scope for lane
     * 61a's engine consult.
     *
     * Wave 4.8 follow-up 13 lane 102 (#2614 follow-up):
     * `notSelf: true` excludes the source permanent from
     * the replacement ("if ANOTHER creature you control
     * would die, instead..." — defender-of-the-faith-
     * style anthem). When `notSelf: true`, the consult
     * skips the replacement when the dying card IS
     * the source's own instance — the source is
     * immune to its own replacement. The
     * implementation: the `canApply` filter
     * compares the event's `sourceId` against the
     * dying card's `targetId` (a miss when the dying
     * card IS the source's own). v1 supports `notSelf:
     * true` only.
     */
    applies_to: z
      .object({
        type: z
          .enum([
            "self",
            "creature",
            "artifact",
            "enchantment",
            "planeswalker",
            "any",
          ])
          .default("creature"),
        controller: z.enum(["you", "opponent", "any"]).default("you"),
        notSelf: z.literal(true).optional(),
        /**
         * Wave 4.8 follow-up 13 lane 105 (#2614 follow-up):
         * `isToken: true` filters the replacement to
         * only fire for dying TOKEN creatures
         * (Hedron Crawler-style "if a token you control
         * would die, instead exile it"). The consult's
         * `canApply` filter reads
         * `state.cards[dyingCardId].isToken`; when
         * `isToken: true` is set on the replacement,
         * the filter returns false for non-token
         * dying cards. v1 supports `isToken: true`
         * only — the inverse ("if a nontoken creature
         * would die") rides a follow-up lane.
         */
        isToken: z.literal(true).optional(),
      })
      .strict()
      .default({ type: "creature", controller: "you" }),
    /**
     * Where the replacement effect routes the event. v1
     * supports only `to: "exile"`. Other destinations parse
     * but are out of scope for lane 61a (lanes 100 / 101 / 104
     * wire them).
     */
    redirect: z
      .object({
        to: z
          .enum([
            "exile",
            "library_top",
            "library_bottom",
            "hand",
            "battlefield_tapped",
            "battlefield_untapped",
            "sacrifice",
            // Wave 4.8 follow-up 21 lane 61 sub-piece
            // piece 2/N (#2614 follow-up): "any_zone"
            // — the drafter writes a free-form
            // destination ("may put it into their
            // hand, library, graveyard, or exile
            // instead"); the consult surfaces a
            // `redirect_zone_choice` WaitingChoice
            // and routes the chosen zone through
            // `moveCardToZoneWithoutTriggers`.
            // Valid destinations exclude
            // `battlefield` and `command`; the
            // consult refuses non-death redirects.
            "any_zone",
            // Wave 4.8 follow-up 13 lane 104 (#2614 follow-up):
            // "life_loss" — the replacement routes the
            // death to a life loss instead (e.g.
            // "if [thing] would die, instead lose 1
            // life"). The `amount` field carries the
            // integer loss.
            "life_loss",
          ])
          .default("exile"),
        /**
         * Wave 4.8 follow-up 13 lane 104 (#2614 follow-up):
         * the integer parameter for `redirect.to:
         * "life_loss"` (the number of life points to
         * lose). Optional — defaults to 0 when the
         * redirect is anything other than `"life_loss"`.
         * When the redirect is `"life_loss"` and `amount`
         * is unset, the factory returns null (the
         * `life_loss` redirect requires an explicit
         * amount).
         */
        amount: z.number().int().min(0).optional(),
        /**
         * Wave 4.8 follow-up 21 lane 61 sub-piece
         * piece 2/N (#2614 follow-up): optional marker
         * for `redirect.to: "any_zone"` — when `true`
         * the consult surfaces a `redirect_zone_choice`
         * WaitingChoice on the controller. Default
         * `true` when `to === "any_zone"`; otherwise
         * ignored. Reserved for forward compatibility
         * with the "any_zone with filters" sub-variant
         * ("any zone you choose except [battlefield]")
         * that rides a follow-up lane.
         */
        controller_choice: z.boolean().optional(),
      })
      .strict()
      .default({ to: "exile" }),
    /**
     * CR 603.4 intervening-if: the replacement only fires when
     * the named condition holds (the drafter writes the
     * condition string verbatim; the engine evaluates it via
     * `evaluateInterveningIfClause`). Out of scope for v1; the
     * field parses but the engine ignores it. Lane 103 wires it.
     */
    if_condition: z.string().min(1).optional(),
    /**
     * Whether the replacement is optional. When `true`, the
     * engine surfaces a `REPLACEMENT_CHOICE_TYPE` waitingChoice
     * for the affected player. Out of scope for v1; the field
     * parses but the engine treats every v1 replacement as
     * mandatory. Lane 100+ wires it.
     */
    optional: z.boolean().optional(),
    /**
     * CR 702 — once-per-turn cap. The engine tracks usage on
     * the source's per-instance ledger and refuses the
     * replacement a second time in the same turn. Out of
     * scope for v1.
     */
    once_per_turn: z.boolean().optional(),
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
     * Wave 4.8 follow-up 13 lane 61a (#2614 follow-up):
     * Replacement effects ("if X would happen, instead Y",
     * CR 614.1) declared on a permanent card. The v1 minimum
     * supports the single shape "if a creature you control
     * would die, instead exile it" (Whip of Erebos, False
     * Dawn — the foundational replacement-effect-for-death
     * layer). Other shapes (`hand`, `library_top`,
     * `library_bottom`, `battlefield_tapped`,
     * `battlefield_untapped`, `sacrifice`, conditional
     * `if_condition`, `optional`, `notSelf`, `isToken`)
     * parse but are out of scope for lane 61a.
     *
     * The engine arm:
     * 1. registers each entry on
     *    `state.replacementEffectManager` when the card enters
     *    the battlefield (the script-resolution path is
     *    triggered via `refreshScriptedReplacementEffects`,
     *    called alongside `refreshScriptedStatics`);
     * 2. consults the manager in `moveCardToZone` whenever a
     *    creature is about to leave the battlefield for the
     *    graveyard (the consult runs BEFORE the move so the
     *    replacement effect runs on the "would die" event
     *    with the battlefield still intact — CR 603.10a).
     *
     * A card with `replacement_effects` only (no `triggers`,
     * `activated`, `statics`, etc.) is legal under the
     * "needs ... or replacement_effects" refine arm below.
     */
    replacement_effects: z.array(ReplacementEffectSchema).min(1).optional(),
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
     * Wave 4.8 follow-up 17 lane 113 piece 2 (#2614 follow-up):
     * relax the v1 single-entry cap to support multi-zone
     * arrays. v1.1 accepts any non-empty subset of
     * ["exile", "graveyard", "command"] (e.g. flashback+foretell
     * cards that cast from BOTH graveyard AND exile — the
     * classic Yawgmoth's Vile Offer / Jump-Start pattern when
     * combined with the printed flashback effect). At cast time
     * the engine iterates the array and accepts the cast from
     * the FIRST matching zone (the script's listed order is the
     * preference order — graveyard over exile over command).
     * The `castableFromZone` field on the StackObject reflects
     * the actual source zone so the resolve path routes correctly.
     *
     * The end zone is implicit for v1.1; a future lane can
     * extend the field with an explicit `end_zone` arm (the
     * follow-up 17 lane 113 piece 3 work).
     *
     * The cast-time legality check just confirms the card is in
     * one of the named zones; the resolve-time redirect routes
     * the card to the right end zone (exile for graveyard or
     * exile source; command for commander).
     *
     * Sample card: a synthetic 1/1 creature that can be cast
     * from exile via `castable_from: ["exile"]` (foretell-
     * style). The engine accepts the cast when the card is in
     * exile and routes it back to exile on resolution (foretell
     * keeps the card in exile after resolution). A flashback-
     * style sample (`castable_from: ["graveyard"]`) would
     * accept the cast when the card is in the graveyard and
     * route it to exile on resolution. A multi-zone sample
     * (`castable_from: ["graveyard", "exile"]`) accepts the
     * cast from EITHER zone and prefers the graveyard entry
     * when the card is in both.
     */
    castable_from: z
      .array(z.enum(["exile", "graveyard", "command"]))
      .min(1)
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
            colors: z.array(z.enum(["W", "U", "B", "R", "G"])).length(1),
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
          // Wave 4.8 follow-up 26 lane 71 piece 3/N
          // (#2614 follow-up): the protection-quality
          // sentinel. When set, the source's
          // `chosenProtectionFrom` instance field is
          // resolved at ETB-time by `enter_choice` →
          // `kind === "protection_quality"` → choice
          // value validated against the curated
          // protection-quality set (W/U/B/R/G plus
          // "everything" — parallel to the lane 86
          // chosen-type anthem curated list). The
          // `protectionFrom: "chosen"` static then
          // consults this instance field (parallel to
          // `affects.subtype: "chosen"` +
          // `perSubtype: "chosen"` +
          // `perCounter.counter: "chosen"` reading
          // `chosenCreatureType`). The dual kind
          // `color_and_creature_type` is not extended
          // — the protection-quality sentinel is
          // resolved independently of the chosen
          // creature type (different instance field,
          // independent resolver call).
          "protection_quality",
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
      // Wave 4.8 follow-up 13 lane 61a (#2614 follow-up): a card
      // with only `replacement_effects` is also legal — it's the
      // foundational replacement-effect-for-death substrate
      // (Whip of Erebos-style "if a creature you control would
      // die, instead exile it"). The synthetic
      // `Whispering_Ward_of_Grave` card in lane 61a carries only
      // this arm and no `triggers` / `activated` / `statics`.
      s.cycling ||
      s.enter_choice ||
      s.enters_with_counters ||
      s.replacement_effects,
    {
      message:
        "a card script needs spell, modes, triggers, activated, statics, rules, equipment, aura, cycling, enter_choice, enters_with_counters, or replacement_effects",
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
export type ScriptedReplacementEffect = z.infer<typeof ReplacementEffectSchema>;

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
