/**
 * Anchored own-keyword resolution (issue #2641).
 *
 * THE FLAW THIS MODULE REMOVES
 *
 * The engine had four unanchored oracle-text scans that decided whether a
 * card *has* a keyword:
 *
 *     oracleText.includes(keyword.toLowerCase())   // hasKeyword fallback
 *     oracleText.includes(kw)                      // getAllKeywords scan
 *     oracleText.includes("boast")                 // hasBoast
 *     oracleText.includes("toxic")                 // getToxicLevel
 *
 * A substring scan cannot tell "this card's own keyword" from "the word
 * appears in the rules text", so a card whose text merely *mentions* a
 * keyword acquired it:
 *
 *     "Target creature loses flying."                    -> flying  (wrong)
 *     "creatures without flying"                         -> flying  (wrong)
 *     "can't be blocked except by creatures with reach"  -> reach   (wrong)
 *
 * This module replaces those four scans with ONE anchored resolver: a
 * keyword counts only when it is written on the card's OWN keyword line
 * (the card's keyword list), i.e. at the start of the oracle text or at the
 * start of a line, as a comma/"and"-separated list, optionally carrying a
 * parameter ("Toxic 2", "Rampage 3"). A keyword that only appears inside a
 * rules sentence is a *mention*, not a keyword, and is rejected.
 *
 * TWO SOURCES
 *
 *   1. `cardData.keywords` — the parsed Scryfall keyword array. Authoritative
 *      and preferred; read LIVE on every call (the engine mutates it, e.g. a
 *      layer-6 "strip abilities" effect empties it).
 *   2. The anchored oracle parse below — a fallback for cards whose parsed
 *      array is missing the tag (the case the four scans existed for).
 *
 * CACHING
 *
 * The oracle parse is the expensive part (a vocabulary scan over the text),
 * so it is computed ONCE and cached. The cache is keyed by the *card data*
 * object (`ScryfallCard`), because every `CardInstance` of a card shares the
 * same `cardData` by reference (`createCardInstance` stores the object, it
 * does not clone it), so one parse serves every instance of that card. A
 * per-instance `WeakMap` sits in front of it so the hot combat path does
 * not even have to reach the card-data map. Both maps are `WeakMap`s, so
 * nothing is retained beyond the lifetime of the cards.
 *
 * The parsed `keywords` array is deliberately NOT cached: the engine mutates
 * it at runtime (an effect that strips abilities sets `keywords = []`), and
 * a cached copy would keep granting the stripped keyword.
 *
 * This module is a **pure leaf** with respect to the rules engine: it only
 * reads `cardData` and the card-script registry, and imports no engine
 * module that could create a cycle.
 */

import type { CardInstance } from "../types";
import type { ScryfallCard } from "../types/card-data";
import { getCardScript } from "../card-scripts/registry";

/**
 * The keyword names the anchored oracle parse recognises.
 *
 * Deliberately restricted to the keyword abilities the engine models (plus
 * the landwalk family and `protection`). A wider list would let an
 * ability word ("Convoke", "Landfall", "Sacrifice") be mistaken for a
 * printed keyword, which is exactly the class of bug this module removes.
 */
const OWN_KEYWORD_NAMES: readonly string[] = [
  // Evergreen keyword abilities (CR 702).
  "flying",
  "haste",
  "vigilance",
  "trample",
  "lifelink",
  "deathtouch",
  "reach",
  "first strike",
  "double strike",
  "menace",
  "hexproof",
  "indestructible",
  "defender",
  "flash",
  // Keyword abilities the engine models explicitly.
  "boast",
  "infect",
  "mutate",
  "persist",
  "prowess",
  "shroud",
  "toxic",
  "ward",
  "wither",
  // Deciduous / common keyword abilities that may head a keyword line.
  "intimidate",
  "fear",
  "rampage",
  "protection",
  // The landwalk family (CR 702.14).
  "plainswalk",
  "islandwalk",
  "swampwalk",
  "mountainwalk",
  "forestwalk",
];

/** Lookup set for the vocabulary above. */
const OWN_KEYWORD_SET: ReadonlySet<string> = new Set(OWN_KEYWORD_NAMES);

/**
 * The vocabulary sorted longest-first so that a multi-word keyword
 * ("first strike", "double strike") is preferred over any shorter prefix
 * that might also match.
 */
const OWN_KEYWORD_NAMES_BY_LENGTH: readonly string[] = [...OWN_KEYWORD_NAMES]
  .sort((a, b) => b.length - a.length)
  .filter((name, index, all) => all.indexOf(name) === index);

/** A keyword optionally followed by a numeric parameter ("Toxic 2"). */
const PARAMETER_PATTERN = /^\s+(\d+)/;

/**
 * What may legally follow a keyword list. Anything else means the matched
 * words were part of a sentence ("Reach for the stars."), not a keyword
 * line, and the whole line is rejected.
 */
const TERMINATOR_PATTERN = /^[.·—–:{(]/;

/** The parsed keyword line of one card. */
export interface OwnKeywordParse {
  /** Lowercase keyword names (no parameter: "toxic", not "toxic 2"). */
  readonly names: ReadonlySet<string>;
  /** Keyword name -> numeric parameter ("toxic" -> 2). */
  readonly params: ReadonlyMap<string, number>;
}

const EMPTY_PARSE: OwnKeywordParse = {
  names: new Set<string>(),
  params: new Map<string, number>(),
};

/** Per-instance cache (hot path) and per-card-data cache (shared). */
const instanceParseCache = new WeakMap<CardInstance, OwnKeywordParse>();
const cardDataParseCache = new WeakMap<ScryfallCard, OwnKeywordParse>();

/**
 * Normalize a keyword name: lowercase, trimmed, and with a numeric
 * parameter split off ("Toxic 2" -> "toxic"). A parameter is only split off
 * when the remaining stem is a known keyword, so a keyword array entry such
 * as "protection from the color of black" is preserved verbatim.
 */
function normalizeKeywordName(raw: string): string {
  const lowered = raw.trim().toLowerCase();
  const match = /^(.*?)\s+(\d+)$/.exec(lowered);
  if (match && OWN_KEYWORD_SET.has(match[1])) {
    return match[1];
  }
  return lowered;
}

/**
 * The numeric parameter of a keyword array entry ("Toxic 2" -> 2), or
 * `undefined` when the entry carries no parameter.
 */
function keywordEntryParameter(raw: string): number | undefined {
  const match = /^(.*?)\s+(\d+)$/.exec(raw.trim().toLowerCase());
  if (match && OWN_KEYWORD_SET.has(match[1])) {
    return Number(match[2]);
  }
  return undefined;
}

/**
 * Skip over the separators of a keyword list: whitespace, commas and the
 * word "and". Returns the position of the next candidate token.
 */
function skipSeparators(text: string, pos: number): number {
  let i = pos;
  for (;;) {
    while (i < text.length && /[\s,]/.test(text[i])) i++;
    if (text.startsWith("and", i)) {
      const after = text[i + 3];
      const endsWord = after === undefined || !/[a-z]/.test(after);
      if (endsWord) {
        i += 3;
        continue;
      }
    }
    return i;
  }
}

/**
 * Match a keyword name at `pos`. The name must not be followed by a
 * letter, so "Flashback" does not match the keyword "flash".
 */
function matchKeywordAt(
  text: string,
  pos: number,
): { name: string; end: number } | null {
  for (const name of OWN_KEYWORD_NAMES_BY_LENGTH) {
    if (!text.startsWith(name, pos)) continue;
    const end = pos + name.length;
    const next = text[end];
    if (next !== undefined && /[a-z]/.test(next)) continue;
    return { name, end };
  }
  return null;
}

/**
 * The self-statement arm: "This creature has flying." — a card that states
 * its own keyword in the first person.
 *
 * The subject must be the card itself, so a grant aimed at other creatures
 * ("Other creatures you control have flying.") and a negation ("Target
 * creature loses flying.") are NOT matched. The statement must be anchored
 * at the start of a line, so a conditional grant ("Whenever this creature
 * attacks, this creature has flying.") is not matched either.
 */
const SELF_STATEMENT_PATTERN =
  /^\s*this (?:creature|permanent|object|spell)\s+(?:has|have)\s+(.+)$/i;

/**
 * Parse one line as the card's own keyword list.
 *
 * The line must consist ONLY of keyword names (optionally separated by
 * commas / "and" / whitespace) followed by a terminator. A line whose
 * keyword words are embedded in a sentence ("Reach for the stars.") is
 * rejected as a whole.
 */
function parseKeywordLine(line: string): {
  names: string[];
  params: Map<string, number>;
} {
  const text = line.trim().toLowerCase();
  const names: string[] = [];
  const params = new Map<string, number>();
  if (!text) return { names, params };

  const selfStatement = SELF_STATEMENT_PATTERN.exec(text);
  const haystack = selfStatement ? selfStatement[1] : text;

  let pos = 0;
  for (;;) {
    pos = skipSeparators(haystack, pos);
    const match = matchKeywordAt(haystack, pos);
    if (!match) break;
    names.push(match.name);
    pos = match.end;
    const parameter = PARAMETER_PATTERN.exec(haystack.slice(pos));
    if (parameter) {
      params.set(match.name, Number(parameter[1]));
      pos += parameter[0].length;
    }
  }

  if (names.length === 0) return { names: [], params };

  const rest = haystack.slice(pos).trim();
  if (rest !== "" && !TERMINATOR_PATTERN.test(rest)) {
    // The keyword words were part of a sentence, not a keyword list.
    return { names: [], params: new Map<string, number>() };
  }
  return { names, params };
}

/**
 * The oracle text of the card with the scripted static / bonus / activated
 * ability texts removed — the same preprocessing the old `hasKeyword`
 * fallback applied. Those clauses are grants applied through the granted
 * keyword ledgers (`scriptStaticKeywords`, `untilEndOfTurnKeywords`), not
 * the card's own printed keywords.
 */
function effectiveOracleText(card: CardInstance): string {
  const script = getCardScript(card.cardData.name);
  if (!script) {
    return card.cardData.oracle_text ?? "";
  }
  let text = (card.cardData.oracle_text ?? "").toLowerCase();
  for (const staticAbility of script.statics ?? []) {
    text = text.replace(staticAbility.text.toLowerCase(), "");
  }
  if (script.exiled_types_bonus?.text) {
    text = text.replace(script.exiled_types_bonus.text.toLowerCase(), "");
  }
  for (const activated of script.activated ?? []) {
    if (activated.effects?.some((effect) => effect.op === "Animate")) {
      text = text.replace(activated.text.toLowerCase(), "");
    }
  }
  return text;
}

/**
 * Parse the card's own keywords out of its oracle text.
 *
 * Every line is examined: a keyword counts when it heads its own line as a
 * keyword list. Lines that merely mention a keyword inside a sentence are
 * rejected.
 */
function parseOracleKeywords(card: CardInstance): OwnKeywordParse {
  const text = effectiveOracleText(card);
  if (!text) return EMPTY_PARSE;

  const names = new Set<string>();
  const params = new Map<string, number>();
  for (const line of text.split(/\r?\n/)) {
    const parsed = parseKeywordLine(line);
    for (const name of parsed.names) names.add(name);
    for (const [name, value] of parsed.params) params.set(name, value);
  }
  if (names.size === 0 && params.size === 0) return EMPTY_PARSE;
  return { names, params };
}

/**
 * The cached anchored parse of the card's oracle text.
 */
function oracleParseFor(card: CardInstance): OwnKeywordParse {
  const byInstance = instanceParseCache.get(card);
  if (byInstance) return byInstance;

  const cardData = card.cardData;
  const byCardData = cardDataParseCache.get(cardData);
  if (byCardData) {
    instanceParseCache.set(card, byCardData);
    return byCardData;
  }

  const parsed = parseOracleKeywords(card);
  cardDataParseCache.set(cardData, parsed);
  instanceParseCache.set(card, parsed);
  return parsed;
}

/**
 * The card's own keywords, from the parsed keyword array and the anchored
 * oracle parse.
 *
 * @returns lowercase keyword names (no parameters).
 */
export function resolveOwnKeywords(card: CardInstance): ReadonlySet<string> {
  const names = new Set<string>();
  for (const raw of card.cardData.keywords ?? []) {
    names.add(normalizeKeywordName(raw));
  }
  for (const name of oracleParseFor(card).names) {
    names.add(name);
  }
  return names;
}

/**
 * The numeric parameter of the card's own keywords ("Toxic 2" -> 2).
 *
 * @returns keyword name -> parameter.
 */
export function resolveOwnKeywordParams(
  card: CardInstance,
): ReadonlyMap<string, number> {
  const params = new Map<string, number>();
  for (const raw of card.cardData.keywords ?? []) {
    const parameter = keywordEntryParameter(raw);
    if (parameter !== undefined) {
      params.set(normalizeKeywordName(raw), parameter);
    }
  }
  for (const [name, value] of oracleParseFor(card).params) {
    params.set(name, value);
  }
  return params;
}

/**
 * True iff the card has `keyword` as one of its OWN keywords — either
 * because the parsed keyword array says so, or because the anchored oracle
 * parse found it on the card's own keyword line.
 *
 * A keyword that is only *mentioned* in the card's rules text does not
 * count.
 */
export function hasOwnKeyword(card: CardInstance, keyword: string): boolean {
  const wanted = keyword.trim().toLowerCase();
  for (const raw of card.cardData.keywords ?? []) {
    if (normalizeKeywordName(raw) === wanted) return true;
  }
  return oracleParseFor(card).names.has(wanted);
}
