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
import { REMOVAL_TARGETS, TARGET_CONTROLLERS } from "./target-filters";

const amount = z.number().int().min(0);

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
    /** each_opponent is untargeted: damage to every opponent. */
    target: z.enum(["any", "creature", "player", "each_opponent"]),
    controller,
  })
  .strict()
  .refine(
    (e) => e.controller === undefined || e.target === "creature",
    controllerNeedsCreatureTarget,
  );

export const DrawSchema = z
  .object({
    op: z.literal("Draw"),
    amount: xAmount,
    who: z.enum(["you", "target_player"]).default("you"),
  })
  .strict();

export const GainLifeSchema = z
  .object({
    op: z.literal("GainLife"),
    amount: xAmount,
    who: z.enum(["you", "target_player"]).default("you"),
  })
  .strict();

export const LoseLifeSchema = z
  .object({
    op: z.literal("LoseLife"),
    amount: xAmount,
    who: z
      .enum(["you", "target_player", "each_opponent"])
      .default("target_player"),
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
  })
  .strict();

/**
 * Destroy/Exile targets (#2528). min_power/max_power bound a creature's power
 * ("creature with power 4 or greater"); they only ever match creatures.
 */
const removalFields = {
  target: z.enum(REMOVAL_TARGETS),
  min_power: z.number().int().optional(),
  max_power: z.number().int().optional(),
  controller,
};

export const DestroySchema = z
  .object({ op: z.literal("Destroy"), ...removalFields })
  .strict();

export const ExileSchema = z
  .object({ op: z.literal("Exile"), ...removalFields })
  .strict();

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
 * `controller` is whose creature the other target is. `optional` is "up to
 * one target creature" and is only scripted on abilities of the fighter.
 */
const fightFields = {
  fighter: z.enum(["self", "it", "creature"]),
  target: z.literal("creature"),
  controller,
  optional: z.boolean().optional(),
};
const optionalNeedsSelf = {
  message: "optional only applies when the fighter is self",
};

export const FightSchema = z
  .object({ op: z.literal("Fight"), ...fightFields })
  .strict()
  .refine((e) => !e.optional || e.fighter === "self", optionalNeedsSelf);

export const BiteSchema = z
  .object({ op: z.literal("Bite"), ...fightFields })
  .strict()
  .refine((e) => !e.optional || e.fighter === "self", optionalNeedsSelf);

export const CounterSchema = z
  .object({ op: z.literal("Counter"), target: z.enum(["spell"]) })
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
  })
  .strict()
  .refine(
    (e) => e.controller === undefined || e.target === "creature",
    controllerNeedsCreatureTarget,
  );

/**
 * Keywords a resolved spell or ability may grant until end of turn (#2567).
 * Indestructible only for now (CR 702.12); widen as cards surface, and each
 * new entry must be honored by the engine's keyword gate for it.
 */
export const GRANTABLE_KEYWORDS = ["indestructible"] as const;

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
    target: z.enum(["creature", "self", "it"]),
    controller,
    until: z.literal("end_of_turn"),
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
  })
  .strict();

/** Scry N (CR 701.22, #2540). */
export const ScrySchema = z
  .object({ op: z.literal("Scry"), amount: z.number().int().min(1) })
  .strict();

export const SurveilSchema = z
  .object({ op: z.literal("Surveil"), amount: z.number().int().min(1) })
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
  })
  .strict();

/**
 * "Search your library for a [filter], reveal, [put into hand/battlefield/top/bottom],
 *  shuffle" (CR 603.9d / 608.2d, #2562). The searcher is `who`: the controller
 *  by default, or the previous targeted player for `target_player` spells.
 *
 * The filter is a single object whose keys AND together (`{creature: true, mv_le: 1}`
 *  means a creature with mana value ≤ 1). For "basic land OR creature with MV 1"
 *  style filters the LLM picks the first matching key — full disjunction is a
 *  follow-up lane.
 *
 * `destination` defaults to hand. `shuffle` defaults to true and is mandatory
 *  by CR: even a search that finds nothing still shuffles.
 *
 * `count` defaults to 1 and is the only value accepted in v1; "up to N" search
 *  needs UI choice plumbing and is a follow-up.
 *
 * v1 limitations (noted in the PR): "reveal" is not modeled (the card simply
 *  moves into a private or public zone, or onto the library), and "put it onto
 *  the battlefield tapped" is not modeled (the card enters untapped).
 */
const SearchLibraryFilterSchema = z
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
  })
  .strict()
  .refine(
    (f) =>
      f.basic_land !== undefined ||
      f.land !== undefined ||
      f.creature !== undefined ||
      f.artifact !== undefined ||
      f.enchantment !== undefined ||
      f.instant_or_sorcery !== undefined ||
      f.mv_le !== undefined ||
      f.mv_eq !== undefined ||
      f.name !== undefined ||
      f.color !== undefined,
    { message: "filter needs at least one key" },
  );

/** Inferred shape of the `filter` field on a `SearchLibrary` effect (#2562). */
export type SearchLibraryFilter = z.infer<typeof SearchLibraryFilterSchema>;

export const SearchLibrarySchema = z
  .object({
    op: z.literal("SearchLibrary"),
    who: z.enum(["you", "target_player"]).default("you"),
    filter: SearchLibraryFilterSchema,
    destination: z
      .enum(["hand", "battlefield", "library_top", "library_bottom"])
      .default("hand"),
    shuffle: z.boolean().default(true),
    count: z.literal(1).default(1),
    /**
     * "put it onto the battlefield tapped" (Solemn Simulacrum). Only read
     * when `destination` is "battlefield"; ignored for other destinations.
     */
    tapped: z.boolean().optional(),
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
  FightSchema,
  BiteSchema,
  AddManaSchema,
  GrantKeywordSchema,
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
     * goes on the stack above it. The engine fires all six in real games
     * (#2498, #2496).
     */
    event: z.enum(["etb", "landfall", "dies", "attacks", "upkeep", "cast"]),
    /**
     * etb, dies, attacks: whose entry, death or attack it watches
     * (CR 603.6a). "self" is this permanent; "another" / "any" are
     * creatures, narrowed by `controller`.
     */
    subject: z.enum(["self", "another", "any"]).default("self"),
    /** With subject another/any: only creatures you or an opponent control. */
    controller: z.enum(["you", "opponent"]).optional(),
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
  );

/** An activated ability (CR 602). `text` is the part after the colon. */
export const ActivatedSchema = z
  .object({
    text: z.string().min(1),
    cost: z
      .object({
        mana: z
          .string()
          .regex(/^(\{(?:[0-9]+|[WUBRGC])\})+$/)
          .optional(),
        tap: z.boolean().default(false),
        sacrifice: z.boolean().default(false),
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
      s.restrictUntap,
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
  })
  .strict()
  .refine(
    (s) =>
      s.spell ||
      s.modes ||
      s.triggers ||
      s.activated ||
      s.statics ||
      s.equipment ||
      s.aura,
    {
      message:
        "a card script needs spell, modes, triggers, activated, statics, equipment, or aura",
    },
  )
  .refine(
    (s) => !((s.spell || s.modes) && (s.triggers || s.activated || s.statics)),
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
  .refine((s) => !(s.aura && s.equipment), {
    message: "a card is an aura or an equipment, not both",
  });

export type CardEffect = z.infer<typeof EffectSchema>;
export type CardScript = z.infer<typeof CardScriptSchema>;
export type ScriptedTrigger = z.infer<typeof TriggerSchema>;
export type ScriptedActivated = z.infer<typeof ActivatedSchema>;
export type ScriptedStatic = z.infer<typeof StaticSchema>;
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
