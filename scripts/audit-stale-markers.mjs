#!/usr/bin/env node
/**
 * scripts/audit-stale-markers.mjs
 *
 * Audit engine markers against the schema-field and runtime-handler
 * inventories. Catches the §1b misclassification pattern from the
 * wave 4.8 stale-marker cleanup (#2814): a marker that says "X rides
 * follow-up N if any future priority piece surfaces a need" — but X
 * is shipped as a schema field and/or as a runtime operation.
 *
 * Two distinct questions:
 *   - Is the `set_X` schema field present? → schema field inventory
 *   - Is the `set_X` variant built as a runtime operation? → runtime
 *     handler inventory (interpret.ts consults)
 *
 * Stale markers conflate these. This script separates them.
 *
 * Usage:
 *   node scripts/audit-stale-markers.mjs                  # report findings
 *   node scripts/audit-stale-markers.mjs --strict         # exit 1 on stale
 *   node scripts/audit-stale-markers.mjs --json           # machine-readable
 *
 * See docs/card-scripts/wave4.8-stale-marker-cleanup.md §1b and
 * issue #2815 for context.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

const SCHEMA_PATH = join(
  REPO_ROOT,
  "src/lib/game-state/card-scripts/schema.ts",
);
const INTERPRET_PATH = join(
  REPO_ROOT,
  "src/lib/game-state/card-scripts/interpret.ts",
);
const CARDS_TYPE_PATH = join(REPO_ROOT, "src/lib/game-state/types/cards.ts");
const TESTS_DIR = join(REPO_ROOT, "src/lib/game-state/__tests__");

const VARIANT_RE = /\b(set|add)_[a-z_]+/g;
const MARKER_RE =
  /(rides follow-up \d+|is unbuilt|deferred since follow-up|future priority piece surfaces)/;

/**
 * Distinguish "future deferral" markers (which claim a variant is
 * unbuilt pending a future follow-up) from "historical note" markers
 * (which record WHEN a variant shipped). The §1b conflation pattern
 * only applies to future-deferral markers.
 *
 * Future-deferral markers include the phrase "if any future priority
 * piece surfaces a need" (or similar conditional wording). Historical
 * notes just say "rides follow-up N priority 4" without a conditional.
 */
function isFutureDeferralMarker(marker, fullContext) {
  return /if any future|future priority piece surfaces/i.test(fullContext);
}
const FIELD_RE = /^\s*([a-z_][a-z_0-9]*):\s*z(\.|\s*$)/gm;
const HANDLER_RE = /exceptions\?\.([a-z_][a-z_0-9]*)(?:\?|\b)/g;

/**
 * Extract a stable inventory of schema fields from a Zod schema file.
 * Skips string/comment content by tokenizing on top-level identifiers
 * that look like `fieldName: z.<...>`.
 */
function extractSchemaFields(content) {
  const fields = new Set();
  let m;
  FIELD_RE.lastIndex = 0;
  while ((m = FIELD_RE.exec(content)) !== null) {
    // Skip identifiers that are obviously not engine fields
    const name = m[1];
    if (
      name === "exceptions" ||
      name === "effects" ||
      name === "value" ||
      name === "type" ||
      name === "color_identity" ||
      name === "colors" ||
      name === "toughness" ||
      name === "power" ||
      name === "subtypes" ||
      name === "supertypes" ||
      name === "id" ||
      name === "name" ||
      name === "tags" ||
      name === "label"
    )
      continue;
    fields.add(name);
  }
  return fields;
}

/**
 * Extract runtime handlers from interpret.ts. Looks for `exceptions?.X?`
 * access patterns, which is the canonical consult form.
 */
function extractRuntimeHandlers(content) {
  const handlers = new Set();
  let m;
  HANDLER_RE.lastIndex = 0;
  while ((m = HANDLER_RE.exec(content)) !== null) {
    handlers.add(m[1]);
  }
  return handlers;
}

/**
 * Walk all files under a directory recursively, returning their paths.
 */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) {
      if (entry === "node_modules" || entry === "coverage") continue;
      out.push(...walk(p));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(p);
    }
  }
  return out;
}

/**
 * Strip comment markers and extract the text content for marker parsing.
 * Strips `//` line comments and `/* ... * /` block comments. Returns
 * the original line numbers so we can report marker locations.
 *
 * We need a version of the file where the markers (which live INSIDE
 * comments) are visible, but string literals and identifier noise
 * outside comments are stripped — so we search `commentOnly` for the
 * marker pattern.
 */
function extractCommentOnly(content) {
  const lines = content.split("\n");
  const commentOnly = new Array(lines.length);
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    let commentText = "";
    if (inBlock) {
      const end = line.indexOf("*/");
      if (end >= 0) {
        inBlock = false;
        commentText = line.slice(0, end);
        line = line.slice(end + 2);
      } else {
        commentOnly[i] = line.trim();
        continue;
      }
    }
    // Block comments on the same line
    const blockRe = /\/\*([\s\S]*?)\*\//g;
    let m;
    while ((m = blockRe.exec(line)) !== null) {
      commentText += " " + m[1];
    }
    // Strip block comments from the working line
    line = line.replace(blockRe, (mm) => " ".repeat(mm.length));
    // Strip string literals (avoid false positives in code)
    line = line.replace(/"[^"\n]*"/g, (mm) => " ".repeat(mm.length));
    line = line.replace(/'[^'\n]*'/g, (mm) => " ".repeat(mm.length));
    // Line comments
    const lineComment = line.indexOf("//");
    if (lineComment >= 0) {
      commentText += " " + line.slice(lineComment + 2);
      line = line.slice(0, lineComment);
    }
    // Track multi-line block comments
    const blockStart = line.indexOf("/*");
    if (blockStart >= 0 && line.indexOf("*/", blockStart) < 0) {
      inBlock = true;
      commentText += " " + line.slice(blockStart + 2);
    }
    commentOnly[i] = commentText.trim();
  }
  return commentOnly;
}

/**
 * Find markers and their variant references in a file's comment regions.
 * Returns array of { line, marker, variants, fullContext }.
 *
 * Variant extraction: we look at ±5 lines around the marker. We then
 * filter to the variant that is the SUBJECT of the marker — the one
 * named as "X rides follow-up N" — by picking the variant that
 * appears immediately before the "rides follow-up" phrase. If no
 * such subject exists, fall back to all variants in the window (with
 * a warning that the marker may be ambiguous).
 */
function findMarkers(filePath, content) {
  const commentOnly = extractCommentOnly(content);
  const markers = [];
  for (let i = 0; i < commentOnly.length; i++) {
    const line = commentOnly[i];
    if (!line) continue;
    const m = line.match(MARKER_RE);
    if (!m) continue;
    // Wide window for context
    let ctxStart = Math.max(0, i - 5);
    let ctxEnd = Math.min(commentOnly.length - 1, i + 5);
    const fullContext = commentOnly.slice(ctxStart, ctxEnd + 1).join(" ");
    // Find the subject variant — the LAST variant that appears
    // immediately before "rides follow-up N" (or "is unbuilt" /
    // "deferred") in the marker text. Heuristic for the §1b-style
    // "A `set_X` variant ... rides follow-up N if any future priority
    // piece surfaces a need" structure.
    const subjectVariant = pickSubjectVariant(fullContext);
    const variants = subjectVariant
      ? [subjectVariant]
      : collectVariants(fullContext);
    if (variants.length === 0) continue;
    markers.push({
      line: i + 1, // 1-indexed
      marker: m[0],
      variants,
      fullContext,
    });
  }
  return markers;
}

/**
 * Pick the variant that is the grammatical subject of the marker.
 *
 * The marker text in this codebase follows several patterns:
 *   - "the `set_X` variant rides follow-up N if any future ..."
 *   - "the `add_X` arm rides follow-up N priority 4"  (historical)
 *   - "a parallel `set_X` variant ... rides follow-up N" (last in chain)
 *   - "X is unbuilt; deferred since follow-up N"
 *   - "A separate `set_X` variant (which ... a hybrid that rides ..." (subject is `set_X`, not the components of the hybrid)
 *
 * Strategy: find the variant name that is FOLLOWED by the words
 * "variant" or "arm" within a small window before "rides follow-up" /
 * "is unbuilt" / "deferred since". The structural cue "variant" / "arm"
 * distinguishes the subject from incidental variant mentions like the
 * components of a hybrid.
 */
function pickSubjectVariant(contextText) {
  const markerPhrases = [
    /rides follow-up \d+/i,
    /is unbuilt/i,
    /deferred since follow-up/i,
  ];
  for (const markerRe of markerPhrases) {
    const m = contextText.match(markerRe);
    if (!m) continue;
    // Look at the text within 200 chars BEFORE the marker phrase.
    const beforeText = contextText.substring(
      Math.max(0, m.index - 200),
      m.index,
    );
    // Find variant names that are followed by "variant" or "arm" within
    // 30 chars. These are the structural subjects.
    const structuralMatches = [
      ...beforeText.matchAll(
        /\b((?:set|add)_[a-z_]+)\b[^.]{0,30}?\b(?:variant|arm)\b/gi,
      ),
    ];
    if (structuralMatches.length > 0) {
      // Take the LAST structural match — most recent in the sentence.
      return structuralMatches[structuralMatches.length - 1][1];
    }
    // Fallback: take the LAST variant name in the immediate vicinity
    // (within 80 chars before the marker phrase).
    const variantMatches = [...beforeText.matchAll(/\b(set|add)_[a-z_]+\b/g)];
    if (variantMatches.length === 0) continue;
    const lastMatch = variantMatches[variantMatches.length - 1];
    if (m.index - lastMatch.index < 80) {
      return lastMatch[0];
    }
  }
  return null;
}

function collectVariants(text) {
  const variants = new Set();
  let v;
  VARIANT_RE.lastIndex = 0;
  while ((v = VARIANT_RE.exec(text)) !== null) {
    variants.add(v[0]);
  }
  return [...variants];
}

/**
 * Classify a marker against the schema field and runtime handler
 * inventories.
 *
 * Possible verdicts:
 *   - OK_SCHEMA: marker references a future extension of an existing
 *     schema field. The schema field is shipped; the marker is for
 *     a follow-on variant that hasn't shipped. OK as-is.
 *   - OK_HANDLER: marker references a runtime handler that is built.
 *     OK as-is.
 *   - STALE_FIELD_SHIPPED: marker says "rides follow-up N if any future
 *     priority piece surfaces a need" but the variant field IS shipped
 *     in the schema AND the runtime handler IS implemented. The marker
 *     is conflating "the field exists" with "the operation works" —
 *     the §1b pattern from #2814.
 *   - STALE_FIELD_UNBUILT: marker says "is unbuilt" but the field is
 *     shipped. Stale.
 *   - OK_FUTURE: marker references a variant that is NOT in either
 *     inventory (genuinely future). OK as-is.
 */
function classifyMarker(
  marker,
  variants,
  fullContext,
  schemaFields,
  runtimeHandlers,
) {
  const findings = [];
  const isFutureDeferral = isFutureDeferralMarker(marker, fullContext);
  const subjectOfUnbuilt = isVariantSubjectOfUnbuilt(marker, fullContext);

  for (const variant of variants) {
    const inSchema = schemaFields.has(variant);
    const inRuntime = runtimeHandlers.has(variant);

    if (inSchema && inRuntime) {
      if (isFutureDeferral) {
        findings.push({
          variant,
          verdict: "STALE_FIELD_SHIPPED",
          reason:
            "variant field is shipped in schema AND runtime handler is " +
            "implemented in interpret.ts. Marker says 'rides follow-up N " +
            "if any future priority piece surfaces' but there is no " +
            "future extension needed — this is the §1b conflation pattern " +
            "from #2814.",
        });
      } else if (
        (marker.includes("is unbuilt") || marker.includes("deferred")) &&
        subjectOfUnbuilt === variant
      ) {
        findings.push({
          variant,
          verdict: "STALE_FIELD_UNBUILT",
          reason:
            "variant is shipped in both schema and runtime, but marker " +
            "claims it is unbuilt. Stale.",
        });
      } else if (
        (marker.includes("is unbuilt") || marker.includes("deferred")) &&
        subjectOfUnbuilt !== variant
      ) {
        // The variant is mentioned in passing; the actual "is unbuilt"
        // subject is a future extension of the variant (or something
        // unrelated). Honest.
        findings.push({
          variant,
          verdict: "OK_FIELD_SHIPPED",
          reason:
            "variant is fully shipped; marker describes a future " +
            "extension of this variant as unbuilt, not the variant itself.",
        });
      } else {
        findings.push({
          variant,
          verdict: "OK_FIELD_SHIPPED",
          reason:
            "variant is fully shipped; marker is a historical note " +
            "about which follow-up introduced it (not a future deferral).",
        });
      }
    } else if (inSchema && !inRuntime) {
      if (isFutureDeferral) {
        findings.push({
          variant,
          verdict: "OK_SCHEMA",
          reason:
            "schema field is shipped; marker notes the runtime extension " +
            "is unbuilt. Honest — the field is shipped but the operation " +
            "is not (yet) wired up.",
        });
      } else if (
        (marker.includes("is unbuilt") || marker.includes("deferred")) &&
        subjectOfUnbuilt === variant
      ) {
        findings.push({
          variant,
          verdict: "STALE_FIELD_UNBUILT",
          reason:
            "variant is shipped in schema; runtime handler is not wired. " +
            "Marker says 'is unbuilt' which is partially true (runtime) " +
            "but the schema side is shipped. Slight §1b conflation.",
        });
      } else {
        findings.push({
          variant,
          verdict: "OK_SCHEMA",
          reason:
            "schema field shipped; runtime not yet wired. Marker does " +
            "not contradict.",
        });
      }
    } else if (!inSchema && inRuntime) {
      // Unusual — runtime consults a field that isn't in the schema.
      // Worth flagging.
      findings.push({
        variant,
        verdict: "INCONSISTENT_RUNTIME",
        reason:
          "runtime handler consults this variant but the schema field " +
          "is not declared. Either the schema field was removed or the " +
          "runtime consult is dead code.",
      });
    } else {
      // Not in either inventory — genuinely future.
      findings.push({
        variant,
        verdict: "OK_FUTURE",
        reason:
          "variant is genuinely future — not in schema or runtime " +
          "inventories. Marker correctly notes it as unbuilt.",
      });
    }
  }
  return findings;
}

/**
 * Determine whether the marker is naming a variant as the SUBJECT of an
 * "is unbuilt" / "deferred since" claim. Returns:
 *   - the variant name if it's the structural subject (e.g. "the
 *     `set_X` is unbuilt")
 *   - a different variant name if some OTHER variant is the subject
 *   - null if the unbuilt subject is not a recognized variant
 *     (e.g. "a per-token exception array is unbuilt" — no variant name)
 */
function isVariantSubjectOfUnbuilt(marker, fullContext) {
  if (!/is unbuilt|deferred since/i.test(fullContext)) return null;
  // Find variant name(s) immediately before "is unbuilt" / "deferred since".
  const re =
    /\b((?:set|add)_[a-z_]+)\b[^.]{0,30}?\b(is unbuilt|deferred since)/i;
  const m = fullContext.match(re);
  if (!m) return null;
  return m[1];
}

function main() {
  const args = new Set(process.argv.slice(2));
  const strict = args.has("--strict");
  const json = args.has("--json");

  const schemaContent = readFileSync(SCHEMA_PATH, "utf8");
  const interpretContent = readFileSync(INTERPRET_PATH, "utf8");
  const cardsTypeContent = readFileSync(CARDS_TYPE_PATH, "utf8");

  const schemaFields = extractSchemaFields(schemaContent);
  const runtimeHandlers = extractRuntimeHandlers(interpretContent);

  // Files to scan for markers
  const filesToScan = [SCHEMA_PATH, INTERPRET_PATH, CARDS_TYPE_PATH];
  if (statSync(TESTS_DIR).isDirectory()) {
    filesToScan.push(...walk(TESTS_DIR));
  }

  const report = {
    schemaFields: [...schemaFields].sort(),
    runtimeHandlers: [...runtimeHandlers].sort(),
    findings: [],
    counts: {
      OK_SCHEMA: 0,
      OK_HANDLER: 0,
      OK_FIELD_SHIPPED: 0,
      OK_FUTURE: 0,
      STALE_FIELD_SHIPPED: 0,
      STALE_FIELD_UNBUILT: 0,
      INCONSISTENT_RUNTIME: 0,
    },
  };

  for (const filePath of filesToScan) {
    const content = readFileSync(filePath, "utf8");
    const markers = findMarkers(filePath, content);
    for (const marker of markers) {
      const findings = classifyMarker(
        marker.marker,
        marker.variants,
        marker.fullContext,
        schemaFields,
        runtimeHandlers,
      );
      for (const f of findings) {
        report.findings.push({
          file: relative(REPO_ROOT, filePath),
          line: marker.line,
          marker: marker.marker,
          ...f,
        });
        report.counts[f.verdict] = (report.counts[f.verdict] || 0) + 1;
      }
    }
  }

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const rel = (p) => relative(REPO_ROOT, p);
    console.log(`# Stale-marker audit (issue #2815)`);
    console.log(`Schema fields inventoried: ${report.schemaFields.length}`);
    console.log(
      `Runtime handlers inventoried: ${report.runtimeHandlers.length}`,
    );
    console.log("");
    console.log("Verdict counts:");
    for (const [k, v] of Object.entries(report.counts)) {
      console.log(`  ${k}: ${v}`);
    }
    console.log("");
    console.log("Findings:");
    for (const f of report.findings) {
      console.log(`  ${f.file}:${f.line}`);
      console.log(`    marker: "${f.marker}"`);
      console.log(`    variant: ${f.variant}`);
      console.log(`    verdict: ${f.verdict}`);
      console.log(`    reason: ${f.reason}`);
      console.log("");
    }
  }

  const staleCount =
    (report.counts.STALE_FIELD_SHIPPED || 0) +
    (report.counts.STALE_FIELD_UNBUILT || 0) +
    (report.counts.INCONSISTENT_RUNTIME || 0);
  if (strict && staleCount > 0) {
    process.exit(1);
  }
  if (staleCount > 0 && !strict && !json) {
    // Don't fail the non-strict run — the script is a report tool, not a gate.
    // The user opted into --strict to make it a gate.
  }
  process.exit(0);
}

main();
