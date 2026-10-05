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
  return !script.spell && !script.modes;
}

/**
 * Comparison key for a mode's text: reminder text dropped, whitespace
 * collapsed, case ignored. The game board labels modes from oracle text,
 * reminder text included; scripts write them without it.
 */
export function modeLabelKey(text: string): string {
  return text
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * The effects a scripted instant or sorcery applies. For a modal spell
 * (CR 700.2) that is the chosen modes' effects in printed order; labels that
 * match no mode are ignored. Pass `chosenModes` undefined to get every mode's
 * effects, e.g. to ask whether the spell can target at all before a mode is
 * picked.
 */
export function scriptedSpellEffects(
  script: CardScript,
  chosenModes?: readonly string[],
): CardEffect[] {
  if (!script.modes) return [...(script.spell ?? [])];
  const options = script.modes.options;
  if (chosenModes === undefined) return options.flatMap((o) => o.effects);
  const chosen = new Set(chosenModes.map(modeLabelKey));
  return options
    .filter((o) => chosen.has(modeLabelKey(o.text)))
    .flatMap((o) => o.effects);
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

/**
 * Why `chosenModes` isn't a legal choice for a scripted modal spell, or null
 * when it is (or the script isn't modal): exactly `choose` distinct modes,
 * each one of the script's own (CR 700.2).
 */
export function scriptedModeChoiceError(
  script: CardScript,
  chosenModes: readonly string[],
): string | null {
  const modes = script.modes;
  if (!modes) return null;
  const known = new Set(modes.options.map((o) => modeLabelKey(o.text)));
  const picked = chosenModes.map(modeLabelKey);
  if (
    picked.length !== modes.choose ||
    new Set(picked).size !== picked.length ||
    picked.some((m) => !known.has(m))
  ) {
    return `${script.name}: choose exactly ${modes.choose} of its modes.`;
  }
  return null;
}
