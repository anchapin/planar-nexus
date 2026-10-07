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

type Modes = NonNullable<CardScript["modes"]>;

/**
 * The effects of a modal spell or ability's chosen modes, in printed order
 * (CR 700.2); labels that match no mode are ignored. Pass `chosenModes`
 * undefined to get every mode's effects, e.g. to ask whether it can target
 * at all before a mode is picked.
 */
export function modalEffects(
  modes: Modes,
  chosenModes?: readonly string[],
): CardEffect[] {
  if (chosenModes === undefined) return modes.options.flatMap((o) => o.effects);
  const chosen = new Set(chosenModes.map(modeLabelKey));
  return modes.options
    .filter((o) => chosen.has(modeLabelKey(o.text)))
    .flatMap((o) => o.effects);
}

/**
 * The effects a scripted instant or sorcery applies: its `spell` effects, or
 * for a modal spell the chosen modes' effects (see `modalEffects`).
 */
export function scriptedSpellEffects(
  script: CardScript,
  chosenModes?: readonly string[],
): CardEffect[] {
  if (!script.modes) return [...(script.spell ?? [])];
  return modalEffects(script.modes, chosenModes);
}

/**
 * The effects a scripted triggered or activated ability applies: its
 * `effects`, or for a modal ability the chosen modes' effects.
 */
export function scriptedAbilityEffects(
  ability: { effects?: readonly CardEffect[]; modes?: Modes },
  chosenModes?: readonly string[],
): CardEffect[] {
  if (!ability.modes) return [...(ability.effects ?? [])];
  return modalEffects(ability.modes, chosenModes);
}

/** True when the effect uses one of the spell's chosen targets. */
export function isTargetedEffect(effect: CardEffect): boolean {
  switch (effect.op) {
    case "DealDamage":
      return effect.target !== "each_opponent";
    case "Pump":
    case "PutCounters":
    case "AttachEquipment":
      return effect.target === "creature";
    case "Destroy":
    case "Exile":
    case "Tap":
    case "Untap":
    case "ReturnToHand":
    case "ReturnFromZone":
    case "Counter":
    case "Fight":
    case "Bite":
      return true;
    case "Draw":
    case "GainLife":
    case "LoseLife":
    case "Mill":
    case "Discard":
    case "SearchLibrary":
      return effect.who === "target_player";
    default:
      return false;
  }
}

/**
 * How many of the spell's chosen targets the effect uses (#2548): a Fight or
 * Bite whose fighter is a target uses two (the fighter, then the other
 * creature); any other targeted effect uses one.
 */
export function effectTargetCount(effect: CardEffect): number {
  if (!isTargetedEffect(effect)) return 0;
  if (
    (effect.op === "Fight" || effect.op === "Bite") &&
    effect.fighter === "creature"
  )
    return 2;
  return 1;
}

/**
 * Why `chosenModes` isn't a legal choice for `modes`, or null when it is:
 * exactly `choose` distinct modes, each one of its own (CR 700.2).
 */
export function modeChoiceError(
  name: string,
  modes: Modes,
  chosenModes: readonly string[],
): string | null {
  const known = new Set(modes.options.map((o) => modeLabelKey(o.text)));
  const picked = chosenModes.map(modeLabelKey);
  if (
    picked.length !== modes.choose ||
    new Set(picked).size !== picked.length ||
    picked.some((m) => !known.has(m))
  ) {
    return `${name}: choose exactly ${modes.choose} of its modes.`;
  }
  return null;
}

/**
 * Why `chosenModes` isn't a legal choice for a scripted modal spell, or null
 * when it is (or the script isn't modal).
 */
export function scriptedModeChoiceError(
  script: CardScript,
  chosenModes: readonly string[],
): string | null {
  return script.modes
    ? modeChoiceError(script.name, script.modes, chosenModes)
    : null;
}
