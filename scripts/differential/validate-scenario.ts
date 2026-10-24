#!/usr/bin/env tsx
/**
 * Validate differential scenario files against the engine-neutral format
 * (#2411).
 *
 *   npx tsx scripts/differential/validate-scenario.ts <file.json> [more.json]
 *
 * Exit code 0 = every file is a valid scenario; 1 = at least one file is
 * invalid (each problem is printed as `path: message`), or the file could
 * not be parsed at all.
 */
import * as path from "path";
import { loadScenarioFile } from "./validate";

function main(): void {
  const files = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (files.length === 0) {
    console.error("usage: tsx scripts/differential/validate-scenario.ts <file.json> [...]");
    process.exit(2);
  }
  let failed = 0;
  for (const file of files) {
    const resolved = path.resolve(file);
    try {
      const scenario = loadScenarioFile(resolved);
      console.log(`ok       ${resolved} (${scenario.id})`);
    } catch (e) {
      failed += 1;
      const message = e instanceof Error ? e.message : String(e);
      console.error(`INVALID  ${resolved}\n${message}`);
    }
  }
  process.exit(failed === 0 ? 0 : 1);
}

main();
