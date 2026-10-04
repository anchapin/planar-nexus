/**
 * Runtime helpers over card scripts that do not need zod. The engine imports
 * these (and the registry) on the client, so they must not import a schema
 * value: that would pull zod into the game page's bundle (#1814).
 */
import type { CardEffect, CardScript } from "./schema";

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
