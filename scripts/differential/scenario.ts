/**
 * Engine-neutral scenario format for differential rules testing (#2411).
 *
 * A scenario describes a starting board, a short list of actions, and the
 * outcome fields to compare. Card references are by English card name, so
 * the same file can be loaded by planar-nexus and by a reference engine
 * (Forge) without either engine's internal ids leaking into the format.
 */

export type ScenarioPhase =
  | "upkeep"
  | "draw"
  | "precombat_main"
  | "begin_combat"
  | "declare_attackers"
  | "postcombat_main"
  | "end";

/** A permanent on the battlefield at the start of the scenario. */
export interface ScenarioPermanent {
  /** Exact English card name. */
  card: string;
  /** Optional label so actions and targets can refer to this exact object. */
  id?: string;
  tapped?: boolean;
  /** Defaults to false: setup permanents have been under control all turn. */
  summoningSick?: boolean;
  /** Counter type to count, e.g. { "+1/+1": 2 }. */
  counters?: Record<string, number>;
}

/** A card in a hidden or public zone, by name with an optional label. */
export type ScenarioZoneCard = string | { card: string; id?: string };

/**
 * The six mana letters a scenario can seed and observe: white, blue, black,
 * red, green and colorless. The engine's generic bucket is not seedable
 * through the scenario shape, so it is never reported either.
 */
export const MANA_LETTERS = ["W", "U", "B", "R", "G", "C"] as const;

export type ManaLetter = (typeof MANA_LETTERS)[number];

/** A mana pool by colour letter. A letter left out means zero. */
export type ManaPoolSpec = Partial<Record<ManaLetter, number>>;

export interface ScenarioPlayer {
  life?: number;
  battlefield?: ScenarioPermanent[];
  hand?: ScenarioZoneCard[];
  graveyard?: ScenarioZoneCard[];
  /** Library contents, top first. A number means that many basic Forests. */
  library?: ScenarioZoneCard[] | number;
  /** Mana already in the pool, by colour letter: W U B R G C. */
  manaPool?: ManaPoolSpec;
}

/** A target: a labelled card (or the first card with that name), or a player. */
export type ScenarioTarget = { card: string } | { player: number };

export type ScenarioAction =
  | {
      do: "cast";
      player: number;
      card: string;
      targets?: ScenarioTarget[];
      x?: number;
      kicked?: boolean;
    }
  | { do: "playLand"; player: number; card: string }
  /** Resolve the whole stack, top first, including triggers it causes. */
  | { do: "resolveStack" }
  | { do: "attack"; player: number; attackers: string[]; defender?: number }
  /** Pass priority until the game reaches this phase of the current turn. */
  | { do: "advanceTo"; phase: ScenarioPhase }
  /**
   * Create a token directly on the battlefield (CR 701.6). `card` names the
   * card whose printed stats the token copies; `tokenName` overrides the
   * name the token is observed under (e.g. "Bear" for a 2/2 Bear token).
   */
  | {
      do: "createToken";
      player: number;
      card: string;
      tokenName?: string;
      count?: number;
    };

export type ObservedField =
  | "life"
  | "battlefield"
  | "hand"
  | "graveyard"
  | "exile"
  | "library"
  | "stack"
  | "manaPool";

export interface Scenario {
  id: string;
  description: string;
  /** Issue or PR this scenario guards, e.g. "#2408". */
  refs?: string;
  /** Exactly two players; player 0 is active unless activePlayer says otherwise. */
  players: [ScenarioPlayer, ScenarioPlayer];
  activePlayer?: 0 | 1;
  phase?: ScenarioPhase;
  actions: ScenarioAction[];
  /** Fields compared across engines. Defaults to every field. */
  observe?: ObservedField[];
  /**
   * Rules-derived expected outcome, one entry per player. Only the fields
   * given are checked; a permanent matches on the keys it lists. This lets a
   * scenario be checked before a reference engine is wired in.
   */
  expect?: [ExpectedPlayer, ExpectedPlayer];
  /**
   * Expected contents of the stack, as card names, compared as a SET (order
   * does not matter). Empty means "the stack must be empty". Omitted means
   * "do not check the stack". A missing stack in an outcome is a mismatch,
   * never a silent pass.
   */
  expectStack?: string[];
}

export interface ExpectedPlayer {
  life?: number;
  battlefield?: Partial<ObservedPermanent>[];
  hand?: string[];
  graveyard?: string[];
  exile?: string[];
  library?: number;
  /**
   * Expected mana pool, by colour letter (W U B R G C). ALL six letters are
   * compared: a letter left out of the expectation means an expected value of
   * zero, so `{}` asserts that the pool is completely empty. When the
   * expectation is present and the observed player has no pool at all, that
   * is a mismatch, never a silent pass.
   */
  manaPool?: ManaPoolSpec;
}

export interface ObservedPermanent {
  name: string;
  tapped: boolean;
  power?: number;
  toughness?: number;
  counters?: Record<string, number>;
  token?: boolean;
}

export interface ObservedPlayer {
  life?: number;
  battlefield?: ObservedPermanent[];
  hand?: string[];
  graveyard?: string[];
  exile?: string[];
  library?: number;
  /** The six mana letters, as observed. */
  manaPool?: ManaPoolSpec;
}

/** Normalised outcome: every list is sorted so engines compare as sets. */
export interface ScenarioOutcome {
  scenario: string;
  engine: string;
  /** "ok", or "unsupported" when the engine can't express the scenario. */
  status: "ok" | "unsupported" | "error";
  players: ObservedPlayer[];
  stack?: string[];
  /** Action failures the engine reported, in order. */
  errors: string[];
}

export const ALL_FIELDS: ObservedField[] = [
  "life",
  "battlefield",
  "hand",
  "graveyard",
  "exile",
  "library",
  "stack",
  "manaPool",
];

/** Every card name a scenario mentions, for prefetching card data. */
export function scenarioCardNames(s: Scenario): string[] {
  const names = new Set<string>();
  const zoneName = (c: ScenarioZoneCard) =>
    names.add(typeof c === "string" ? c : c.card);
  for (const p of s.players) {
    p.battlefield?.forEach((b) => names.add(b.card));
    p.hand?.forEach(zoneName);
    p.graveyard?.forEach(zoneName);
    if (Array.isArray(p.library)) p.library.forEach(zoneName);
    else if (typeof p.library === "number" && p.library > 0)
      names.add("Forest");
  }
  // Cards named by an ACTION are not necessarily in a zone (a token's stats
  // come from a card that is never held), so collect them too — otherwise the
  // card snapshot would miss the data the runner needs.
  for (const a of s.actions) {
    if (a.do === "cast" || a.do === "playLand" || a.do === "createToken") {
      names.add(a.card);
    }
  }
  return [...names].sort();
}
