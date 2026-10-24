/**
 * Runtime validator for the engine-neutral differential scenario format
 * (#2411).
 *
 * `scenario.ts` holds the TypeScript types; this module holds the matching
 * Zod schema so a scenario FILE is rejected with a clear message before it
 * reaches the engine. A scenario that parses as TypeScript is not enough:
 * the files are JSON on disk, hand-written, and (from a future step) shared
 * with a reference-engine runner that cannot type-check them.
 *
 * The schema is intentionally strict (`.strict()` on every object): a typo
 * such as `life_total` must fail loudly instead of being silently ignored
 * by a runner that only reads the fields it knows.
 */
import * as fs from "fs";
import { z } from "zod";
import type { Scenario } from "./scenario";

export const PHASES = [
  "upkeep",
  "draw",
  "precombat_main",
  "begin_combat",
  "declare_attackers",
  "postcombat_main",
  "end",
] as const;

export const OBSERVED_FIELDS = [
  "life",
  "battlefield",
  "hand",
  "graveyard",
  "exile",
  "library",
  "stack",
] as const;

const phaseSchema = z.enum(PHASES);
const observedFieldSchema = z.enum(OBSERVED_FIELDS);

const permanentSchema = z
  .object({
    card: z.string().min(1, "card name must not be empty"),
    id: z.string().min(1).optional(),
    tapped: z.boolean().optional(),
    summoningSick: z.boolean().optional(),
    counters: z.record(z.string().min(1), z.number().int()).optional(),
  })
  .strict();

const zoneCardSchema = z.union([
  z.string().min(1, "card name must not be empty"),
  z
    .object({
      card: z.string().min(1, "card name must not be empty"),
      id: z.string().min(1).optional(),
    })
    .strict(),
]);

const playerSchema = z
  .object({
    life: z.number().int().optional(),
    battlefield: z.array(permanentSchema).optional(),
    hand: z.array(zoneCardSchema).optional(),
    graveyard: z.array(zoneCardSchema).optional(),
    library: z
      .union([z.array(zoneCardSchema), z.number().int().nonnegative()])
      .optional(),
    manaPool: z
      .partialRecord(
        z.enum(["W", "U", "B", "R", "G", "C"]),
        z.number().int().nonnegative(),
      )
      .optional(),
  })
  .strict();

const targetSchema = z.union([
  z.object({ card: z.string().min(1) }).strict(),
  z.object({ player: z.number().int().min(0).max(1) }).strict(),
]);

const playerIndexSchema = z.number().int().min(0).max(1);

const actionSchema = z.discriminatedUnion("do", [
  z
    .object({
      do: z.literal("cast"),
      player: playerIndexSchema,
      card: z.string().min(1),
      targets: z.array(targetSchema).optional(),
      x: z.number().int().nonnegative().optional(),
      kicked: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      do: z.literal("playLand"),
      player: playerIndexSchema,
      card: z.string().min(1),
    })
    .strict(),
  z.object({ do: z.literal("resolveStack") }).strict(),
  z
    .object({
      do: z.literal("attack"),
      player: playerIndexSchema,
      attackers: z.array(z.string().min(1)).min(1),
      defender: playerIndexSchema.optional(),
    })
    .strict(),
  z
    .object({
      do: z.literal("advanceTo"),
      phase: phaseSchema,
    })
    .strict(),
  z
    .object({
      do: z.literal("createToken"),
      player: playerIndexSchema,
      /** Card whose printed stats the token copies (e.g. "Grizzly Bears"). */
      card: z.string().min(1),
      /** Name the token is observed under (e.g. "Bear"). */
      tokenName: z.string().min(1).optional(),
      count: z.number().int().positive().max(20).optional(),
    })
    .strict(),
]);

const observedPermanentSchema = z
  .object({
    name: z.string().min(1),
    tapped: z.boolean(),
    power: z.number().optional(),
    toughness: z.number().optional(),
    counters: z.record(z.string().min(1), z.number().int()).optional(),
    token: z.boolean().optional(),
  })
  .strict();

const expectedPlayerSchema = z
  .object({
    life: z.number().optional(),
    battlefield: z.array(observedPermanentSchema.partial()).optional(),
    hand: z.array(z.string().min(1)).optional(),
    graveyard: z.array(z.string().min(1)).optional(),
    exile: z.array(z.string().min(1)).optional(),
    library: z.number().int().nonnegative().optional(),
  })
  .strict();

export const scenarioSchema = z
  .object({
    id: z.string().min(1, "scenario id must not be empty"),
    description: z.string(),
    refs: z.string().optional(),
    players: z.tuple([playerSchema, playerSchema]),
    activePlayer: z.number().int().min(0).max(1).optional(),
    phase: phaseSchema.optional(),
    actions: z.array(actionSchema),
    observe: z.array(observedFieldSchema).optional(),
    expect: z.tuple([expectedPlayerSchema, expectedPlayerSchema]).optional(),
  })
  .strict();

export type ScenarioInput = z.input<typeof scenarioSchema>;

/** The schema and the hand-written types must agree. */
type AssertEqual<A, B> = [A] extends [B]
  ? ([B] extends [A] ? true : never)
  : never;
const _schemaMatchesTypes: AssertEqual<
  z.output<typeof scenarioSchema>,
  Scenario
> = true;
void _schemaMatchesTypes;

export interface ScenarioValidationOk {
  ok: true;
  scenario: Scenario;
}

export interface ScenarioValidationError {
  ok: false;
  /** One human-readable line per problem, e.g. `players.0.life: expected number`. */
  errors: string[];
}

export type ScenarioValidationResult =
  | ScenarioValidationOk
  | ScenarioValidationError;

/** Format one Zod issue as `path: message`. */
function formatIssue(issue: z.core.$ZodIssue): string {
  const path = issue.path.length ? issue.path.join(".") : "(root)";
  return `${path}: ${issue.message}`;
}

/**
 * Validate an already-parsed scenario object.
 *
 * Returns the typed scenario on success, or a list of readable errors on
 * failure — never throws.
 */
export function validateScenario(data: unknown): ScenarioValidationResult {
  const result = scenarioSchema.safeParse(data);
  if (result.success) return { ok: true, scenario: result.data as Scenario };
  return {
    ok: false,
    errors: result.error.issues.map(formatIssue),
  };
}

/**
 * Validate a scenario file on disk.
 *
 * @param file path to the JSON file
 * @throws Error with a single readable message listing every problem.
 */
export function loadScenarioFile(file: string): Scenario {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf-8");
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`scenario file ${file} could not be read: ${message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`scenario file ${file} is not valid JSON: ${message}`);
  }
  const result = validateScenario(parsed);
  if (!result.ok) {
    throw new Error(
      `scenario file ${file} is invalid:\n` +
        result.errors.map((e) => `  - ${e}`).join("\n"),
    );
  }
  return result.scenario;
}
