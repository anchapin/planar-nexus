#!/usr/bin/env node
/**
 * npm audit gate with time-boxed exceptions (#2437).
 *
 * Fails on any high/critical advisory unless it is listed in
 * npm-audit-exceptions.json with an expiry date that has not passed.
 * An expired exception fails too, so it gets re-reviewed instead of
 * silently renewed. Exceptions that no longer match anything only warn.
 *
 * Usage: node scripts/security/check-npm-audit.mjs
 *          [--audit-json <file>] [--exceptions <file>] [--today YYYY-MM-DD]
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BLOCKING = new Set(["high", "critical"]);

export function advisoryId(url) {
  const m = /GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/i.exec(url ?? "");
  return m ? m[0].toLowerCase() : null;
}

/** Collect direct high/critical advisories from `npm audit --json` output. */
export function collectAdvisories(audit) {
  const found = new Map();
  for (const vuln of Object.values(audit?.vulnerabilities ?? {})) {
    for (const via of vuln.via ?? []) {
      if (typeof via !== "object" || !BLOCKING.has(via.severity)) continue;
      const id = advisoryId(via.url) ?? `npm-${via.source}`;
      if (!found.has(id)) {
        found.set(id, {
          id,
          name: via.name,
          severity: via.severity,
          title: via.title,
          url: via.url,
        });
      }
    }
  }
  return [...found.values()];
}

export function evaluate(audit, exceptions, today) {
  const errors = [];
  const warnings = [];
  if (audit?.error) {
    errors.push(
      `npm audit failed: ${audit.error.summary ?? JSON.stringify(audit.error)}`,
    );
    return { errors, warnings, waived: [] };
  }
  const byId = new Map();
  for (const ex of exceptions) {
    const id = String(ex.id).toLowerCase();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ex.expires ?? "")) {
      errors.push(
        `exception ${ex.id} has no valid "expires" date (YYYY-MM-DD)`,
      );
    } else if (ex.expires < today) {
      errors.push(
        `exception ${ex.id} (${ex.package}) expired on ${ex.expires}; re-review it (${ex.issue ?? "no issue"})`,
      );
    } else {
      byId.set(id, ex);
    }
  }
  const advisories = collectAdvisories(audit);
  const waived = [];
  for (const adv of advisories) {
    const ex = byId.get(adv.id);
    if (ex && (!ex.package || ex.package === adv.name)) {
      waived.push({ ...adv, expires: ex.expires });
    } else {
      errors.push(
        `${adv.severity}: ${adv.name} ${adv.id} ${adv.title ?? ""} ${adv.url ?? ""}`.trim(),
      );
    }
  }
  const seen = new Set(advisories.map((a) => a.id));
  for (const [id, ex] of byId) {
    if (!seen.has(id))
      warnings.push(
        `exception ${ex.id} (${ex.package}) no longer matches any advisory; remove it`,
      );
  }
  return { errors, warnings, waived };
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

function runAudit() {
  try {
    return execFileSync("npm", ["audit", "--json"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    // npm audit exits non-zero whenever it finds anything; the JSON is still on stdout.
    if (err.stdout) return err.stdout;
    throw err;
  }
}

function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const exFile =
    arg("--exceptions") ?? path.join(here, "npm-audit-exceptions.json");
  const auditFile = arg("--audit-json");
  const today = arg("--today") ?? new Date().toISOString().slice(0, 10);
  const exceptions =
    JSON.parse(fs.readFileSync(exFile, "utf8")).exceptions ?? [];
  const audit = JSON.parse(
    auditFile ? fs.readFileSync(auditFile, "utf8") : runAudit(),
  );
  const { errors, warnings, waived } = evaluate(audit, exceptions, today);
  for (const w of waived)
    console.log(`waived until ${w.expires}: ${w.severity} ${w.name} ${w.id}`);
  for (const w of warnings) console.warn(`warning: ${w}`);
  if (errors.length) {
    for (const e of errors) console.error(`error: ${e}`);
    console.error(`npm audit gate failed (${errors.length} problem(s)).`);
    process.exit(1);
  }
  console.log("npm audit gate passed: no unwaived high/critical advisories.");
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
