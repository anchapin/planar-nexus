/**
 * Outcome comparison for the differential rules harness (#2411).
 *
 * `diffExpected` checks an engine outcome against a scenario's rules-derived
 * `expect` block. `diffOutcomes` compares two engines' outcomes field by
 * field (planar-nexus against Forge, once the Forge runner exists).
 */
import type {
  ExpectedPlayer,
  ObservedPermanent,
  ObservedPlayer,
  Scenario,
  ScenarioOutcome,
} from "./scenario";

export type Verdict = "match" | "mismatch" | "couldn't express";

export interface DiffRow {
  scenario: string;
  verdict: Verdict;
  /** One line per differing field, e.g. "P1 life: expected 14, got 15". */
  differences: string[];
}

const show = (v: unknown) => JSON.stringify(v);

function permanentMatches(
  want: Partial<ObservedPermanent>,
  got: ObservedPermanent,
): boolean {
  return (Object.keys(want) as (keyof ObservedPermanent)[]).every(
    (k) => show(want[k]) === show(got[k]),
  );
}

function diffBattlefield(
  label: string,
  want: Partial<ObservedPermanent>[],
  got: ObservedPermanent[],
): string[] {
  const unused = [...got];
  const missing: string[] = [];
  for (const w of want) {
    const i = unused.findIndex((g) => permanentMatches(w, g));
    if (i >= 0) unused.splice(i, 1);
    else missing.push(show(w));
  }
  const out: string[] = [];
  if (missing.length)
    out.push(`${label} battlefield missing ${missing.join(", ")}`);
  if (unused.length) {
    out.push(
      `${label} battlefield has extra ${unused.map((u) => show(u)).join(", ")}`,
    );
  }
  return out;
}

function diffPlayer(
  label: string,
  want: ExpectedPlayer,
  got: ObservedPlayer,
): string[] {
  const out: string[] = [];
  for (const k of ["life", "library"] as const) {
    if (want[k] !== undefined && want[k] !== got[k]) {
      out.push(`${label} ${k}: expected ${want[k]}, got ${got[k]}`);
    }
  }
  for (const k of ["hand", "graveyard", "exile"] as const) {
    const w = want[k];
    if (w !== undefined && show([...w].sort()) !== show(got[k] ?? [])) {
      out.push(
        `${label} ${k}: expected ${show([...w].sort())}, got ${show(got[k] ?? [])}`,
      );
    }
  }
  if (want.battlefield) {
    out.push(
      ...diffBattlefield(label, want.battlefield, got.battlefield ?? []),
    );
  }
  return out;
}

/** Compare an outcome with the scenario's own `expect` block. */
export function diffExpected(
  scenario: Scenario,
  outcome: ScenarioOutcome,
): DiffRow {
  if (outcome.status !== "ok") {
    return {
      scenario: scenario.id,
      verdict: "couldn't express",
      differences: outcome.errors,
    };
  }
  const differences = (scenario.expect ?? []).flatMap((w, i) =>
    diffPlayer(`P${i}`, w, outcome.players[i] ?? {}),
  );
  // The stack is compared as a SET: the order in which spells sit on the
  // stack is not what a scenario asserts. A missing stack in the outcome is
  // a mismatch, never a silent pass.
  if (scenario.expectStack !== undefined) {
    const want = [...scenario.expectStack].sort();
    const got =
      outcome.stack === undefined ? undefined : [...outcome.stack].sort();
    if (got === undefined || show(want) !== show(got)) {
      differences.push(
        `stack: expected ${show(want)}, got ${
          got === undefined ? "undefined" : show(got)
        }`,
      );
    }
  }
  // An ok-path error means an action failed inside the engine (a rejected
  // cast, a stack that did not empty, an advanceTo that stopped short, an
  // engine finding). The board can still coincide with `expect`, so the
  // errors are differences in their own right: a failed action must never
  // pass silently (#2928).
  for (const e of outcome.errors) {
    differences.push(`error: ${e}`);
  }
  return {
    scenario: scenario.id,
    verdict: differences.length ? "mismatch" : "match",
    differences,
  };
}

/** Compare two engines' outcomes for the same scenario. */
export function diffOutcomes(a: ScenarioOutcome, b: ScenarioOutcome): DiffRow {
  if (a.status !== "ok" || b.status !== "ok") {
    const why = [a, b]
      .filter((o) => o.status !== "ok")
      .map((o) => `${o.engine}: ${o.errors.join("; ")}`);
    return {
      scenario: a.scenario,
      verdict: "couldn't express",
      differences: why,
    };
  }
  const differences = a.players.flatMap((pa, i) => {
    const pb = b.players[i] ?? {};
    const want: ExpectedPlayer = { ...pb, battlefield: pb.battlefield };
    const fwd = diffPlayer(`P${i}`, want, pa);
    // Battlefield matching is one-directional; check the reverse for extras.
    const back = diffBattlefield(
      `P${i}`,
      pa.battlefield ?? [],
      pb.battlefield ?? [],
    );
    return [...fwd, ...back.filter((d) => d.includes("extra"))];
  });
  if (show(a.stack ?? []) !== show(b.stack ?? [])) {
    differences.push(
      `stack: ${a.engine} ${show(a.stack)}, ${b.engine} ${show(b.stack)}`,
    );
  }
  // Symmetric treatment of ok-path errors (#2928): either engine's error
  // list makes the comparison a mismatch, for the same reason as in
  // `diffExpected` — a failed action whose board coincides with the other
  // engine's must not pass silently. Error lines are appended after the
  // field rewrite so their text is never mangled by it.
  const errorLines = [
    ...a.errors.map((e) => `error: ${a.engine}: ${e}`),
    ...b.errors.map((e) => `error: ${b.engine}: ${e}`),
  ];
  const rewritten = differences.map((d) =>
    d.replace("expected", b.engine).replace("got", a.engine),
  );
  return {
    scenario: a.scenario,
    verdict: rewritten.length || errorLines.length ? "mismatch" : "match",
    differences: [...rewritten, ...errorLines],
  };
}

/** One printable row per scenario. */
export function formatRows(rows: DiffRow[]): string {
  return rows
    .map((r) =>
      [
        `${r.verdict.padEnd(16)} ${r.scenario}`,
        ...r.differences.map((d) => `    ${d}`),
      ].join("\n"),
    )
    .join("\n");
}
