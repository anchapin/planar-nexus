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

export const CreateTokenSchema = z
  .object({
    op: z.literal("CreateToken"),
    count: z.number().int().min(1),
    power: amount,
    toughness: amount,
    color: z.enum(["white", "blue", "black", "red", "green", "colorless"]),
    subtypes: z.array(z.string().min(1)).min(1),
  })
  .strict();

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
]);

const effects = z.array(EffectSchema).min(1);

/**
 * A triggered ability. `text` is the ability's oracle sentence: it is what
 * the stack shows and how a resolving ability is matched back to its script.
 * Only enters-the-battlefield triggers so far; other events need the
 * engine's per-event subject checks first (see #2490).
 */
export const TriggerSchema = z
  .object({
    text: z.string().min(1),
    /**
     * etb: enters the battlefield. landfall: a land you control enters
     * (#2496). The engine now fires dies, attacks and upkeep in real games
     * (#2498); adding them here is the rest of #2496.
     */
    event: z.enum(["etb", "landfall"]),
    /** ETB only: whose entry it watches (CR 603.6a). */
    subject: z.enum(["self", "another", "any"]).default("self"),
    effects,
  })
  .strict();

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
    effects,
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
    /** A permanent's triggered abilities (the full list when present). */
    triggers: z.array(TriggerSchema).min(1).optional(),
    /** A permanent's activated abilities (the full list when present). */
    activated: z.array(ActivatedSchema).min(1).optional(),
  })
  .strict()
  .refine((s) => s.spell || s.triggers || s.activated, {
    message: "a card script needs spell, triggers, or activated",
  })
  .refine((s) => !(s.spell && (s.triggers || s.activated)), {
    message: "a spell script can't also have permanent abilities",
  });

export type CardEffect = z.infer<typeof EffectSchema>;
export type CardScript = z.infer<typeof CardScriptSchema>;
export type ScriptedTrigger = z.infer<typeof TriggerSchema>;
export type ScriptedActivated = z.infer<typeof ActivatedSchema>;

/**
 * A permanent's script: its abilities come only from the script, never from
 * oracle text (keywords still come from the card's keyword list).
 */
export function isPermanentScript(script: CardScript): boolean {
  return !script.spell;
}

/** True when the effect uses one of the spell's chosen targets. */
export function isTargetedEffect(effect: CardEffect): boolean {
  switch (effect.op) {
    case "DealDamage":
      return effect.target !== "each_opponent";
    case "Pump":
    case "PutCounters":
      return effect.target === "creature";
    case "Destroy":
    case "Exile":
    case "Counter":
      return true;
    case "Draw":
    case "GainLife":
    case "LoseLife":
      return effect.who === "target_player";
    default:
      return false;
  }
}
