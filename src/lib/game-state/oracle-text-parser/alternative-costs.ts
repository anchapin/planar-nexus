/**
 * Alternative-cost parsing (CR 118.9): the generic parser plus buyback, flashback, bestow, mutate, blitz, foretell, spectacle, prototype.
 *
 * Mechanically extracted from oracle-text-parser.ts (issue #1725);
 * behavior pinned by the existing engine suites.
 */
import { parseEscapeExileCount } from './escape';
import { ParsedManaCost, parseManaCost } from './mana-cost';

/**
 * Result of parsing kicker cost
 */
export interface KickerInfo {
  hasKicker: boolean;
  isMultiKicker: boolean;
  kickerCost: ParsedManaCost | null;
  description: string;
}

/**
 * Parse kicker cost from oracle text
 * Handles patterns like:
 * - "Kicker {2}{U}"
 * - "Kicker {1}{R}"
 * - "Multikicker {2}"
 */
export function parseKicker(oracleText: string): KickerInfo {
  if (!oracleText) {
    return {
      hasKicker: false,
      isMultiKicker: false,
      kickerCost: null,
      description: "",
    };
  }

  // Match kicker or multikicker
  const kickerMatch = oracleText.match(/kicker\s*(\{[^}]+\}(?:\{[^}]+\})*)/i);
  const multiKickerMatch = oracleText.match(
    /multikicker\s*(\{[^}]+\}(?:\{[^}]+\})*)/i,
  );

  if (!kickerMatch && !multiKickerMatch) {
    return {
      hasKicker: false,
      isMultiKicker: false,
      kickerCost: null,
      description: "",
    };
  }

  const isMultiKicker = !!multiKickerMatch;
  const costString = isMultiKicker ? multiKickerMatch![1] : kickerMatch![1];
  const kickerCost = parseManaCost(costString);

  return {
    hasKicker: true,
    isMultiKicker,
    kickerCost,
    description: isMultiKicker
      ? `Multikicker ${costString}`
      : `Kicker ${costString}`,
  };
}

/**
 * Result of parsing Prototype ability
 * CR 702.152: Prototype is a static ability that lets you cast a copy of the card
 * with different power/toughness and mana cost.
 */
export interface PrototypeInfo {
  /** Whether this card has prototype */
  hasPrototype: boolean;
  /** Alternative power when in prototype form */
  prototypePower: number | null;
  /** Alternative toughness when in prototype form */
  prototypeToughness: number | null;
  /** Alternative mana cost for prototype (as string like "{1}") */
  prototypeManaCost: string | null;
  /** Parsed prototype mana cost */
  prototypeManaCostParsed: ParsedManaCost | null;
  /** Description for UI */
  description: string;
}

/**
 * Parse prototype keyword from Oracle text
 * CR 702.152: Prototype [cost] — [power]/[toughness]
 * Format examples:
 * - "Prototype {2}{U} — 3/3"
 * - "Prototype {1}{R} — 2/2"
 */
export function parsePrototype(oracleText: string): PrototypeInfo {
  if (!oracleText) {
    return {
      hasPrototype: false,
      prototypePower: null,
      prototypeToughness: null,
      prototypeManaCost: null,
      prototypeManaCostParsed: null,
      description: "",
    };
  }

  // Match prototype pattern: "Prototype {cost} — P/T"
  // The cost is in curly braces, followed by em dash, followed by power/toughness
  const prototypeMatch = oracleText.match(
    /prototype\s*(\{[^}]+\}(?:\{[^}]+\})*)\s*[—–-]\s*(\d+)\/(\d+)/i,
  );

  if (!prototypeMatch) {
    return {
      hasPrototype: false,
      prototypePower: null,
      prototypeToughness: null,
      prototypeManaCost: null,
      prototypeManaCostParsed: null,
      description: "",
    };
  }

  const manaCostString = prototypeMatch[1];
  const power = parseInt(prototypeMatch[2], 10);
  const toughness = parseInt(prototypeMatch[3], 10);
  const parsedCost = parseManaCost(manaCostString);

  return {
    hasPrototype: true,
    prototypePower: power,
    prototypeToughness: toughness,
    prototypeManaCost: manaCostString,
    prototypeManaCostParsed: parsedCost,
    description: `Prototype ${manaCostString} — ${power}/${toughness}`,
  };
}

/**
 * Alternative cost types
 */
export enum AlternativeCostType {
  KICKER = "kicker",
  BUYBACK = "buyback",
  FLASHBACK = "flashback",
  BESTOW = "bestow",
  ESCAPE = "escape",
  COMBAT = "combat",
  SPECTACLE = "spectacle",
  BLAZE = "blaze",
  BLITZ = "blitz",
  FORETELL = "foretell",
  MUTATE = "mutate",
  OTHER = "other",
}

/**
 * Result of parsing alternative costs
 * CR 117.2, CR 702.8 (Buyback), CR 702.66 (Flashback), CR 702.99 (Bestow)
 */
export interface AlternativeCostInfo {
  /** Whether this spell has an alternative cost */
  hasAlternativeCost: boolean;
  /** Type of alternative cost */
  costType: AlternativeCostType | null;
  /** Parsed mana cost for the alternative */
  manaCost: ParsedManaCost | null;
  /** Additional requirements (e.g., "exile this from your graveyard") */
  additionalRequirement: string | null;
  /** Whether the alternative cost is available (e.g., card in graveyard for Flashback) */
  isAvailable: boolean;
  /** Description of the alternative cost for UI */
  description: string;
}

/**
 * Parse alternative cost from oracle text
 * Handles: Kicker, Buyback, Flashback, Bestow, Escape, Spectacle, etc.
 */
export function parseAlternativeCost(oracleText: string): AlternativeCostInfo {
  if (!oracleText) {
    return {
      hasAlternativeCost: false,
      costType: null,
      manaCost: null,
      additionalRequirement: null,
      isAvailable: false,
      description: "",
    };
  }

  const lowerText = oracleText.toLowerCase();

  // Check for Flashback (CR 702.66)
  // Flashback [cost] — You may cast this card from your graveyard.
  const flashbackMatch = oracleText.match(
    /flashback\s*(\{[^}]+\}(?:\{[^}]+\})*)/i,
  );
  if (flashbackMatch) {
    const manaCost = parseManaCost(flashbackMatch[1]);
    // Flashback typically requires the card to be in your graveyard
    return {
      hasAlternativeCost: true,
      costType: AlternativeCostType.FLASHBACK,
      manaCost,
      additionalRequirement: "Exile this card from your graveyard",
      isAvailable: true, // Availability depends on card being in graveyard
      description: `Flashback ${flashbackMatch[1]}`,
    };
  }

  // Check for Buyback (CR 702.8)
  // Buyback [cost] — You may pay the buyback cost after the spell resolves to return it to your hand.
  const buybackMatch = oracleText.match(/buyback\s*(\{[^}]+\}(?:\{[^}]+\})*)/i);
  if (buybackMatch) {
    const manaCost = parseManaCost(buybackMatch[1]);
    return {
      hasAlternativeCost: true,
      costType: AlternativeCostType.BUYBACK,
      manaCost,
      additionalRequirement: null, // Buyback is paid as part of casting
      isAvailable: true,
      description: `Buyback ${buybackMatch[1]}`,
    };
  }

  // Check for Bestow (CR 702.99)
  // Bestow [cost] — If you cast this card for its bestow cost, it becomes an Aura.
  const bestowMatch = oracleText.match(/bestow\s*(\{[^}]+\}(?:\{[^}]+\})*)/i);
  if (bestowMatch) {
    const manaCost = parseManaCost(bestowMatch[1]);
    return {
      hasAlternativeCost: true,
      costType: AlternativeCostType.BESTOW,
      manaCost,
      additionalRequirement: "Becomes an Aura attached to target creature",
      isAvailable: true,
      description: `Bestow ${bestowMatch[1]}`,
    };
  }

  // Check for Mutate (CR 702.140)
  // Mutate [cost] — If you cast this spell for its mutate cost, it merges
  // onto a target non-Human creature you control instead of entering as an
  // independent permanent. The merged permanent uses the top card's
  // characteristics with combined text (CR 702.140b). Mutate is an
  // alternative cost that REPLACES the printed mana cost (same treatment as
  // Blitz/Foretell/Spectacle/Escape).
  const mutateMatch = oracleText.match(/mutate\s*(\{[^}]+\}(?:\{[^}]+\})*)/i);
  if (mutateMatch) {
    const manaCost = parseManaCost(mutateMatch[1]);
    return {
      hasAlternativeCost: true,
      costType: AlternativeCostType.MUTATE,
      manaCost,
      additionalRequirement:
        "Merges onto target non-Human creature you control",
      isAvailable: true,
      description: `Mutate ${mutateMatch[1]}`,
    };
  }

  // Check for Blitz (CR 702.150)
  // Blitz [cost] — You may cast this card for its blitz cost rather than its
  // mana cost. If you do, it gains haste and "When this creature dies, draw a
  // card." Sacrifice it at the beginning of the next end step.
  const blitzMatch = oracleText.match(/blitz\s*(\{[^}]+\}(?:\{[^}]+\})*)/i);
  if (blitzMatch) {
    const manaCost = parseManaCost(blitzMatch[1]);
    return {
      hasAlternativeCost: true,
      costType: AlternativeCostType.BLITZ,
      manaCost,
      additionalRequirement: "Gains haste, dies-draw, and is sacrificed at EOT",
      isAvailable: true,
      description: `Blitz ${blitzMatch[1]}`,
    };
  }

  // Check for Foretell (CR 702.142)
  // "Foretell [cost]" — the printed foretell cost is the alternative cost for
  // casting a foretold card from exile. Foretell itself is a two-step mechanic:
  // pay {2} to exile the card face down (CR 702.142b), then later cast it from
  // exile for [cost] (CR 702.142c). This parser surfaces [cost]; the {2} exile
  // cost is a constant of the keyword action, not part of this cost.
  const foretellMatch = oracleText.match(
    /foretell\s*(\{[^}]+\}(?:\{[^}]+\})*)/i,
  );
  if (foretellMatch) {
    const manaCost = parseManaCost(foretellMatch[1]);
    return {
      hasAlternativeCost: true,
      costType: AlternativeCostType.FORETELL,
      manaCost,
      additionalRequirement:
        "Cast from exile (must be foretold); revealed on cast",
      isAvailable: true,
      description: `Foretell ${foretellMatch[1]}`,
    };
  }

  // Check for Escape (CR 702.138)
  // Escape—[cost], Exile [N] other cards from your graveyard.
  //
  // The exile count N is part of the printed oracle text on every Escape card
  // (e.g. "Exile four other cards from your graveyard" on Pondering Mage,
  // "Exile 5 other cards" on Chrome Courier). Real-world N values vary per
  // card (3, 4, 5, 6, 7), so capture N from the text rather than hardcoding.
  // Older / unspecified oracle text falls back to a default N of 4 (the
  // historically most common value, e.g. on the original Theros Beyond Death
  // escape cards) so a partial print still parses.
  const escapeMatch = oracleText.match(
    /escape\s*[—–-]\s*(\{[^}]+\}(?:\{[^}]+\})*)/i,
  );
  if (escapeMatch) {
    const manaCost = parseManaCost(escapeMatch[1]);
    const escapeN = parseEscapeExileCount(oracleText);
    return {
      hasAlternativeCost: true,
      costType: AlternativeCostType.ESCAPE,
      manaCost,
      additionalRequirement: `Exile ${escapeN} other cards from your graveyard`,
      isAvailable: true,
      description: `Escape ${escapeMatch[1]}`,
    };
  }

  // Check for Spectacle (CR 702.135)
  // Spectacle [cost] — You may cast this spell for its spectacle cost if an opponent lost life this turn.
  const spectacleMatch = oracleText.match(
    /spectacle\s*(\{[^}]+\}(?:\{[^}]+\})*)/i,
  );
  if (spectacleMatch) {
    const manaCost = parseManaCost(spectacleMatch[1]);
    return {
      hasAlternativeCost: true,
      costType: AlternativeCostType.SPECTACLE,
      manaCost,
      additionalRequirement: "Opponent must have lost life this turn",
      isAvailable: false, // Availability depends on game state
      description: `Spectacle ${spectacleMatch[1]}`,
    };
  }

  // Check for Kicker (already handled separately in parseKicker)
  // Check for Multikicker (already handled separately in parseKicker)
  const kickerMatch = oracleText.match(/kicker\s*(\{[^}]+\}(?:\{[^}]+\})*)/i);
  const multiKickerMatch = oracleText.match(
    /multikicker\s*(\{[^}]+\}(?:\{[^}]+\})*)/i,
  );
  if (kickerMatch || multiKickerMatch) {
    const costString =
      (multiKickerMatch && multiKickerMatch[1]) ||
      (kickerMatch && kickerMatch[1]);
    if (costString) {
      const manaCost = parseManaCost(costString);
      return {
        hasAlternativeCost: true,
        costType: multiKickerMatch
          ? AlternativeCostType.KICKER
          : AlternativeCostType.KICKER,
        manaCost,
        additionalRequirement: null,
        isAvailable: true,
        description: multiKickerMatch
          ? `Multikicker ${costString}`
          : `Kicker ${costString}`,
      };
    }
  }

  return {
    hasAlternativeCost: false,
    costType: null,
    manaCost: null,
    additionalRequirement: null,
    isAvailable: false,
    description: "",
  };
}

/**
 * Parse Buyback keyword from oracle text
 * CR 702.8: Buyback lets you return the spell to your hand as it resolves.
 */
export function parseBuyback(oracleText: string): {
  hasBuyback: boolean;
  buybackCost: ParsedManaCost | null;
  description: string;
} {
  if (!oracleText) {
    return { hasBuyback: false, buybackCost: null, description: "" };
  }

  const buybackMatch = oracleText.match(/buyback\s*(\{[^}]+\}(?:\{[^}]+\})*)/i);

  if (!buybackMatch) {
    return { hasBuyback: false, buybackCost: null, description: "" };
  }

  const buybackCost = parseManaCost(buybackMatch[1]);

  return {
    hasBuyback: true,
    buybackCost,
    description: `Buyback ${buybackMatch[1]}`,
  };
}

/**
 * Parse Flashback keyword from oracle text
 * CR 702.66: Flashback lets you cast a card from your graveyard.
 */
export function parseFlashback(oracleText: string): {
  hasFlashback: boolean;
  flashbackCost: ParsedManaCost | null;
  description: string;
} {
  if (!oracleText) {
    return { hasFlashback: false, flashbackCost: null, description: "" };
  }

  const flashbackMatch = oracleText.match(
    /flashback\s*(\{[^}]+\}(?:\{[^}]+\})*)/i,
  );

  if (!flashbackMatch) {
    return { hasFlashback: false, flashbackCost: null, description: "" };
  }

  const flashbackCost = parseManaCost(flashbackMatch[1]);

  return {
    hasFlashback: true,
    flashbackCost,
    description: `Flashback ${flashbackMatch[1]}`,
  };
}

/**
 * Parse Bestow keyword from oracle text
 * CR 702.99: Bestow lets you cast a creature as an Aura.
 */
export function parseBestow(oracleText: string): {
  hasBestow: boolean;
  bestowCost: ParsedManaCost | null;
  description: string;
} {
  if (!oracleText) {
    return { hasBestow: false, bestowCost: null, description: "" };
  }

  const bestowMatch = oracleText.match(/bestow\s*(\{[^}]+\}(?:\{[^}]+\})*)/i);

  if (!bestowMatch) {
    return { hasBestow: false, bestowCost: null, description: "" };
  }

  const bestowCost = parseManaCost(bestowMatch[1]);

  return {
    hasBestow: true,
    bestowCost,
    description: `Bestow ${bestowMatch[1]}`,
  };
}

/**
 * Parse the Mutate keyword from oracle text.
 *
 * CR 702.140: "Mutate [cost]" is a static ability that functions while the
 * spell is on the stack. It offers an alternative cost: "You may cast this
 * card for [cost] rather than its mana cost. If you do, it merges with a
 * creature you control." The parsed cost is an alternative cost (CR
 * 702.140b) — the spell's mana value is unchanged and other costs and taxes
 * still apply. The merge mechanic itself (target selection, merged
 * characteristics) is handled by the spell-casting dispatch and mutate.ts.
 *
 * Example oracle text: "Mutate {2}{U}" (e.g. Cloudpiercer). The reminder
 * text ("If you cast this spell for its mutate cost, put it over or under
 * target non-Human creature you control...") is not part of the cost.
 */
export function parseMutate(oracleText: string): {
  hasMutate: boolean;
  mutateCost: ParsedManaCost | null;
  description: string;
} {
  if (!oracleText) {
    return { hasMutate: false, mutateCost: null, description: "" };
  }

  const mutateMatch = oracleText.match(/mutate\s*(\{[^}]+\}(?:\{[^}]+\})*)/i);

  if (!mutateMatch) {
    return { hasMutate: false, mutateCost: null, description: "" };
  }

  const mutateCost = parseManaCost(mutateMatch[1]);

  return {
    hasMutate: true,
    mutateCost,
    description: `Mutate ${mutateMatch[1]}`,
  };
}

/**
 * Parse the Blitz keyword from oracle text.
 *
 * CR 702.150: "Blitz [cost]" is a static ability that functions while the
 * spell is on the stack. It offers an alternative cost: "You may cast this
 * card for [cost] rather than its mana cost." The parsed cost is an alternative
 * cost (CR 702.150b) — the spell's mana value is unchanged and other costs and
 * taxes still apply.
 *
 * Example oracle text: "Blitz {3}{R}" (e.g. Henchfiend of Korlash). The
 * reminder text ("If you do, it gains haste and 'When this creature dies, draw
 * a card.' Sacrifice it at the beginning of the next end step.") is not part of
 * the cost and is applied by the spell-casting / trigger systems.
 */
export function parseBlitz(oracleText: string): {
  hasBlitz: boolean;
  blitzCost: ParsedManaCost | null;
  description: string;
} {
  if (!oracleText) {
    return { hasBlitz: false, blitzCost: null, description: "" };
  }

  const blitzMatch = oracleText.match(/blitz\s*(\{[^}]+\}(?:\{[^}]+\})*)/i);

  if (!blitzMatch) {
    return { hasBlitz: false, blitzCost: null, description: "" };
  }

  const blitzCost = parseManaCost(blitzMatch[1]);

  return {
    hasBlitz: true,
    blitzCost,
    description: `Blitz ${blitzMatch[1]}`,
  };
}

/**
 * Parse the Foretell keyword from oracle text.
 *
 * CR 702.142: "Foretell [cost]" is a static ability. The printed [cost] is the
 * alternative cost for casting a foretold card from exile on a later turn
 * (CR 702.142c) — the spell's mana value is unchanged and other costs/taxes
 * still apply. The {2} paid to exile the card face down (CR 702.142b) is a
 * constant of the keyword action and is NOT part of this cost.
 *
 * Example oracle text: "Foretell {1}{U}" (e.g. Saw It Coming). The reminder
 * text ("During your turn, you may pay {2} and exile this card from your hand
 * face down...") is not part of the parsed cost.
 */
export function parseForetell(oracleText: string): {
  hasForetell: boolean;
  foretellCost: ParsedManaCost | null;
  description: string;
} {
  if (!oracleText) {
    return { hasForetell: false, foretellCost: null, description: "" };
  }

  const foretellMatch = oracleText.match(
    /foretell\s*(\{[^}]+\}(?:\{[^}]+\})*)/i,
  );

  if (!foretellMatch) {
    return { hasForetell: false, foretellCost: null, description: "" };
  }

  const foretellCost = parseManaCost(foretellMatch[1]);

  return {
    hasForetell: true,
    foretellCost,
    description: `Foretell ${foretellMatch[1]}`,
  };
}

/**
 * Parse the Spectacle keyword from oracle text.
 *
 * CR 702.135: "Spectacle [cost]" is a static ability that functions while the
 * spell is on the stack. It offers an alternative cost: the spell's controller
 * may pay [cost] rather than the printed mana cost IF an opponent has lost
 * life this turn (CR 702.135a). The spell's mana value is unchanged and other
 * costs/taxes still apply (CR 702.135b — same treatment as Blitz/Foretell).
 *
 * The opponent-lost-life precondition is a runtime game-state check, NOT a
 * property of the card text; this parser surfaces only the [cost]. The cast
 * gate lives in `castSpell` and reads `Player.lastTurnLifeLost` populated by
 * `dealDamageToPlayer` / `loseLife` in `player-actions.ts`.
 *
 * Example oracle text: "Spectacle {1}{B}" (e.g. Angrath's Rampage, Bedevil).
 */
export function parseSpectacle(oracleText: string): {
  hasSpectacle: boolean;
  spectacleCost: ParsedManaCost | null;
  description: string;
} {
  if (!oracleText) {
    return { hasSpectacle: false, spectacleCost: null, description: "" };
  }

  const spectacleMatch = oracleText.match(
    /spectacle\s*(\{[^}]+\}(?:\{[^}]+\})*)/i,
  );

  if (!spectacleMatch) {
    return { hasSpectacle: false, spectacleCost: null, description: "" };
  }

  const spectacleCost = parseManaCost(spectacleMatch[1]);

  return {
    hasSpectacle: true,
    spectacleCost,
    description: `Spectacle ${spectacleMatch[1]}`,
  };
}

