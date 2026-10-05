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

const amount = z.number().int().min(0);

export const DealDamageSchema = z
  .object({
    op: z.literal("DealDamage"),
    amount,
    /** each_opponent is untargeted: damage to every opponent. */
    target: z.enum(["any", "creature", "player", "each_opponent"]),
  })
  .strict();

export const DrawSchema = z
  .object({
    op: z.literal("Draw"),
    amount,
    who: z.enum(["you", "target_player"]).default("you"),
  })
  .strict();

export const GainLifeSchema = z
  .object({
    op: z.literal("GainLife"),
    amount,
    who: z.enum(["you", "target_player"]).default("you"),
  })
  .strict();

export const LoseLifeSchema = z
  .object({
    op: z.literal("LoseLife"),
    amount,
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

export const CreateTokenSchema = z
  .object({
    op: z.literal("CreateToken"),
    count: z.number().int().min(1),
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

export const DestroySchema = z
  .object({ op: z.literal("Destroy"), target: z.enum(["creature"]) })
  .strict();

export const ExileSchema = z
  .object({ op: z.literal("Exile"), target: z.enum(["creature"]) })
  .strict();

export const CounterSchema = z
  .object({ op: z.literal("Counter"), target: z.enum(["spell"]) })
  .strict();

export const PumpSchema = z
  .object({
    op: z.literal("Pump"),
    power: z.number().int(),
    toughness: z.number().int(),
    /** self: the permanent the ability belongs to (untargeted). */
    target: z.enum(["creature", "self"]),
  })
  .strict();

export const PutCountersSchema = z
  .object({
    op: z.literal("PutCounters"),
    /** Only +1/+1 counters for now. */
    counter: z.literal("+1/+1"),
    amount: z.number().int().min(1),
    target: z.enum(["creature", "self"]),
  })
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

export const EffectSchema = z.discriminatedUnion("op", [
  DealDamageSchema,
  DrawSchema,
  GainLifeSchema,
  LoseLifeSchema,
  CreateTokenSchema,
  DestroySchema,
  ExileSchema,
  CounterSchema,
  PumpSchema,
  PutCountersSchema,
  SurveilSchema,
  CopySpellSchema,
]);

const effects = z.array(EffectSchema).min(1);

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
  })
  .strict()
  .refine((s) => s.spell || s.modes || s.triggers || s.activated || s.statics, {
    message:
      "a card script needs spell, modes, triggers, activated, or statics",
  })
  .refine(
    (s) => !((s.spell || s.modes) && (s.triggers || s.activated || s.statics)),
    { message: "a spell script can't also have permanent abilities" },
  )
  .refine((s) => !(s.spell && s.modes), {
    message: "a spell script has spell or modes, not both",
  });

export type CardEffect = z.infer<typeof EffectSchema>;
export type CardScript = z.infer<typeof CardScriptSchema>;
export type ScriptedTrigger = z.infer<typeof TriggerSchema>;
export type ScriptedActivated = z.infer<typeof ActivatedSchema>;
export type ScriptedStatic = z.infer<typeof StaticSchema>;
export type ScriptedModes = z.infer<typeof ModesSchema>;

export {
  isPermanentScript,
  isTargetedEffect,
  modalEffects,
  modeChoiceError,
  modeLabelKey,
  scriptedAbilityEffects,
  scriptedModeChoiceError,
  scriptedSpellEffects,
} from "./script-guards";
