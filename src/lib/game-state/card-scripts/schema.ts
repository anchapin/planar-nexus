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
    target: z.enum(["any", "creature", "player"]),
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
    who: z.enum(["you", "target_player"]).default("target_player"),
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
    target: z.enum(["creature"]),
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
  SurveilSchema,
]);

export const CardScriptSchema = z
  .object({
    /** Exact English card name, as on Scryfall. */
    name: z.string().min(1),
    /** Oracle text the script was written against, for review and drift checks. */
    oracle: z.string().min(1),
    /** Effects of an instant or sorcery, applied in order on resolution. */
    spell: z.array(EffectSchema).min(1),
  })
  .strict();

export type CardEffect = z.infer<typeof EffectSchema>;
export type CardScript = z.infer<typeof CardScriptSchema>;

/** True when the effect uses one of the spell's chosen targets. */
export function isTargetedEffect(effect: CardEffect): boolean {
  switch (effect.op) {
    case "DealDamage":
    case "Destroy":
    case "Exile":
    case "Counter":
    case "Pump":
      return true;
    case "Draw":
    case "GainLife":
    case "LoseLife":
      return effect.who === "target_player";
    default:
      return false;
  }
}
