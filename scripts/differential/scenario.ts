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

export interface ScenarioPlayer {
  life?: number;
  battlefield?: ScenarioPermanent[];
  hand?: ScenarioZoneCard[];
  graveyard?: ScenarioZoneCard[];
  /** Library contents, top first. A number means that many basic Forests. */
  library?: ScenarioZoneCard[] | number;
  /** Mana already in the pool, by colour letter: W U B R G C. */
  manaPool?: Partial<Record<"W" | "U" | "B" | "R" | "G" | "C", number>>;
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
  | { do: "advanceTo"; phase: ScenarioPhase };

export type ObservedField =
  "life" | "battlefield" | "hand" | "graveyard" | "exile" | "library" | "stack";

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
}

export interface ExpectedPlayer {
  life?: number;
  battlefield?: Partial<ObservedPermanent>[];
  hand?: string[];
  graveyard?: string[];
  exile?: string[];
  library?: number;
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
  return [...names].sort();
}
