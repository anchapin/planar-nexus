#!/usr/bin/env node
/**
 * Static Analysis & Gap Detection Tool
 * Issue #616: Finds gaps between detected keywords and engine enforcement
 */

import * as fs from "fs";
import * as path from "path";
import * as prettier from "prettier";

// ─── Configuration ───
const ROOT = path.resolve(__dirname, "..");
const GAME_STATE_DIR = path.join(ROOT, "src", "lib", "game-state");
const GAME_PAGE = path.join(
  ROOT,
  "src",
  "app",
  "(app)",
  "game",
  "[id]",
  "page.tsx",
);
const REPORT_PATH = path.join(ROOT, "reports", "gameplay-gap-analysis.md");

// Files that constitute "gameplay enforcement" (not just tests or UI)
const GAMEPLAY_FILES = [
  "combat.ts",
  "game-state.ts",
  "state-based-actions.ts",
  "spell-casting.ts",
  "mana.ts",
  "keyword-actions.ts",
];

// Four of the six entries above (`combat.ts`, `game-state.ts`, `mana.ts`,
// `keyword-actions.ts`) were split from a single file into a family
// directory. The gameplay-usage scan historically did
// `fs.existsSync(p) ? readFile(p) : ""`, so those four silently contributed
// "" instead of failing — leaving the "Used in Gameplay" column blind to
// `combat/`, `game-state/`, `mana/` and all 34 `keyword-actions/*.ts`
// implementation files, i.e. to essentially the whole engine. That is why the
// report under-counted enforcement so badly and why epic #2300's "243 of 257
// unenforced" figure was heavily stale. Resolve dir-or-file and walk
// directories recursively.
function walkTsFiles(dir: string): string {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((ent) => {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) return [walkTsFiles(full)];
      return ent.name.endsWith(".ts") ? [readFile(full)] : [];
    })
    .join("\n");
}

/**
 * Read a `GAMEPLAY_FILES` entry, tolerating the file -> family-directory
 * split. `combat.ts` means either the old single file or today's `combat/`.
 */
function readGameplaySource(entry: string): string {
  const asFile = path.join(GAME_STATE_DIR, entry);
  if (fs.existsSync(asFile) && fs.statSync(asFile).isFile()) {
    return readFile(asFile);
  }
  const asDir = asFile.replace(/\.ts$/, "");
  if (fs.existsSync(asDir) && fs.statSync(asDir).isDirectory()) {
    return walkTsFiles(asDir);
  }
  return "";
}

// ─── Helpers ───
function readFile(p: string): string {
  return fs.readFileSync(p, "utf-8");
}

function extractArrayItems(text: string, arrayName: string): string[] {
  const regex = new RegExp(`${arrayName}\\s*[=:]\\s*\\[([\\s\\S]*?)\\];`, "m");
  const match = text.match(regex);
  if (!match) return [];
  return match[1]
    .split("\n")
    .map((l) => l.trim().replace(/,$/, "").replace(/"/g, ""))
    .filter((l) => l.length > 0 && !l.startsWith("//") && !l.startsWith("*"));
}

function extractExportedFunctions(
  text: string,
): { name: string; line: number }[] {
  const results: { name: string; line: number }[] = [];
  const lines = text.split("\n");
  const re = /export\s+(?:function|const)\s+(\w+)/;
  lines.forEach((line, idx) => {
    const m = line.match(re);
    if (m) results.push({ name: m[1], line: idx + 1 });
  });
  return results;
}

function grepLines(
  text: string,
  pattern: RegExp,
): { line: number; content: string }[] {
  return text
    .split("\n")
    .map((content, idx) => ({ line: idx + 1, content }))
    .filter(({ content }) => pattern.test(content));
}

function grepFiles(
  dir: string,
  pattern: RegExp,
  ext: string,
): { file: string; line: number; content: string }[] {
  const results: { file: string; line: number; content: string }[] = [];
  if (!fs.existsSync(dir)) return results;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(ext));
  for (const file of files) {
    const p = path.join(dir, file);
    const text = readFile(p);
    text.split("\n").forEach((content, idx) => {
      if (pattern.test(content)) {
        results.push({ file, line: idx + 1, content: content.trim() });
      }
    });
  }
  return results;
}

// ─── 1. Extract Keywords from Parser ───
// Issue #1725 split oracle-text-parser.ts into an oracle-text-parser/ directory.
// The keyword arrays now live in oracle-text-parser/keywords.ts inside the
// extractKeywords function. We read both locations and merge so the gap
// analyzer keeps working.
const parserText = readFile(path.join(GAME_STATE_DIR, "oracle-text-parser.ts"));
const keywordsModuleText = readFile(
  path.join(GAME_STATE_DIR, "oracle-text-parser", "keywords.ts"),
);
const combinedParserText = `${parserText}\n${keywordsModuleText}`;
const evergreenKeywords = extractArrayItems(
  combinedParserText,
  "evergreenKeywords",
);
const abilityWords = extractArrayItems(combinedParserText, "abilityWords");

// ─── 2. Extract Enforcement Functions ───
// Gates live in two places: the original `evergreen-keywords.ts` and the
// per-keyword `keyword-actions/*.ts` leaves (#2360, the #2356 residual).
// Scanning only the former reported keywords like indestructible and first
// strike as unenforced even though their canonical gate is wired.
const KEYWORD_ACTIONS_DIR = path.join(GAME_STATE_DIR, "keyword-actions");
const enforcementSources = [
  path.join(GAME_STATE_DIR, "evergreen-keywords.ts"),
  ...(fs.existsSync(KEYWORD_ACTIONS_DIR)
    ? fs
        .readdirSync(KEYWORD_ACTIONS_DIR)
        .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
        .sort()
        .map((f) => path.join(KEYWORD_ACTIONS_DIR, f))
    : []),
  // Gates that live outside the keyword modules (epic #2300 slices): storm's
  // copy trigger is detected in the spell-trigger system, and improvise is
  // parsed in the casting-keyword parser and paid for in spell-casting/cast.ts.
  ...[
    path.join(GAME_STATE_DIR, "trigger-system", "spell-triggers.ts"),
    path.join(GAME_STATE_DIR, "oracle-text-parser", "casting-keywords.ts"),
  ].filter((f) => fs.existsSync(f)),
];
const enforcementFnNames = new Set(
  enforcementSources.flatMap((file) =>
    extractExportedFunctions(readFile(file)).map((f) => f.name),
  ),
);

// Read gameplay code to check for actual usage. `GAMEPLAY_FILES` misses most
// of the engine: `keyword-actions.ts` and `spell-casting.ts` are now barrels,
// so their family directories were never read, and enforcement also happens
// in targeting-validation.ts, ward-system.ts, trigger-system/ and others
// (#2360). Treat every non-test engine source as gameplay code except the
// gate-definition modules themselves, the parser, types and barrels.
const NON_GAMEPLAY = new Set(
  [
    "evergreen-keywords.ts",
    "keyword-actions",
    "keyword-actions.ts",
    "oracle-text-parser",
    "oracle-text-parser.ts",
    "types",
    "types.ts",
    "index.ts",
    "__tests__",
  ].map((rel) => path.join(GAME_STATE_DIR, rel)),
);
function collectGameplaySources(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((ent) => {
      const full = path.join(dir, ent.name);
      if (NON_GAMEPLAY.has(full) || ent.name === "__tests__") return [];
      if (ent.isDirectory()) return collectGameplaySources(full);
      return ent.name.endsWith(".ts") && !ent.name.endsWith(".test.ts")
        ? [full]
        : [];
    })
    .sort();
}
const gameplayCode = collectGameplaySources(GAME_STATE_DIR)
  .map(readFile)
  .join("\n");

// A function counts as called when code invokes it or passes it as a
// callback. A bare name match is not enough: imports and re-exports would
// count, and so would the function's own declaration.
function calls(fnName: string, code: string): boolean {
  const call = new RegExp(`(?<!function\\s+)\\b${fnName}\\s*\\(`);
  const callback = new RegExp(`[(,]\\s*${fnName}\\s*[,)]`);
  return call.test(code) || callback.test(code);
}

// Gameplay often reaches a gate through a wrapper in the gate modules
// (combat calls getMenaceMinimumBlockers, which calls hasMenace). Split each
// gate module into top-level function bodies and close over "called by a
// wired function", so a gate reached that way counts as wired.
const TOP_LEVEL_DECL =
  /^(?:export\s+)?(?:async\s+)?(?:function\s+(\w+)|const\s+(\w+)\s*=)/;
const gateBodies = new Map<string, string>();
for (const file of enforcementSources) {
  let current: string | null = null;
  for (const line of readFile(file).split("\n")) {
    const m = line.match(TOP_LEVEL_DECL);
    if (m) {
      current = m[1] ?? m[2];
      gateBodies.set(current, "");
    }
    if (current) gateBodies.set(current, gateBodies.get(current) + line + "\n");
  }
}
const wiredFns = new Set(
  [...gateBodies.keys()].filter((fn) => calls(fn, gameplayCode)),
);
for (let changed = true; changed;) {
  changed = false;
  for (const [fn, body] of gateBodies) {
    if (!wiredFns.has(fn)) continue;
    for (const callee of gateBodies.keys()) {
      if (callee !== fn && !wiredFns.has(callee) && calls(callee, body)) {
        wiredFns.add(callee);
        changed = true;
      }
    }
  }
}

// Gates whose names can't be inferred from the keyword. Flash is enforced by
// canCastAtInstantSpeed (keyword-actions/flash.ts), which spell-casting
// calls before allowing a cast outside the main phase.
const ENFORCEMENT_ALIASES: Record<string, string[]> = {
  flash: ["canCastAtInstantSpeed"],
  surveil: ["performSurveil"],
  equip: ["resolveEquip"],
  enchant: ["canEnchantTarget", "isAuraIllegallyAttached"],
  transform: ["transformPermanent"],
  crew: ["activateCrew", "resolveCrew"],
  landfall: ["fireLandfallTriggers"],
  fight: ["resolveFight", "getFightDamage"],
  threshold: ["refreshThresholdBonuses", "hasThreshold"],
  // Epic #2300 slices #2408-#2439, whose gates aren't named after the keyword.
  raid: ["hasAttackedThisTurn", "markAttackedThisTurn"],
  converge: ["countColorsSpent", "isConvergeX"],
  ferocious: [
    "controlsCreatureWithPowerAtLeast",
    "evaluateTriggerWhileCondition",
  ],
  morbid: ["hasCreatureDiedThisTurn", "markCreatureDiedThisTurn"],
  improvise: ["parseImprovise", "grantsNoncreatureImprovise"],
  domain: ["refreshDomainPower", "countBasicLandTypes"],
  storm: ["detectStormTrigger"],
  grandeur: ["getDiscardNamedCost", "revealUntilInstantOrSorcery"],
  // Channel and ninjutsu have engine entry points, but only tests call them:
  // no game action reaches them yet, so they correctly report as partial.
  channel: ["channelCard"],
  ninjutsu: ["activateNinjutsu"],
};

// Map keyword → likely enforcement function names. Camel-case on word
// boundaries ("first strike" → FirstStrike; the old space-stripping produced
// "Firststrike" and never matched), and try the `Strict` / `Keyword` / `From`
// suffixes the keyword-actions/ leaves use.
function inferEnforcementFns(keyword: string): string[] {
  const words = keyword
    .toLowerCase()
    .replace(/!/g, "")
    .replace(/\bfrom$/, "")
    .trim()
    .split(/[\s-]+/)
    .filter(Boolean);
  const camel = words.map((w) => w[0].toUpperCase() + w.slice(1)).join("");
  if (!camel) return [];
  const bases = [
    `has${camel}`,
    `is${camel}`,
    `can${camel}`,
    `get${camel}`,
    `deals${camel}Damage`,
    `isProtectedBy${camel}`,
    `hasLethal${camel}`,
    `calculate${camel}Damage`,
  ];
  const inferred = bases.flatMap((b) => [
    b,
    `${b}Strict`,
    `${b}Keyword`,
    `${b}From`,
  ]);
  return [...inferred, ...(ENFORCEMENT_ALIASES[keyword.toLowerCase()] ?? [])];
}

function isUsedInGameplay(fnName: string): boolean {
  return wiredFns.has(fnName);
}

function checkEnforcement(keyword: string): {
  status: "full" | "partial" | "none";
  fnNames: string[];
  usedInGameplay: boolean;
} {
  const candidates = inferEnforcementFns(keyword);
  const found = candidates.filter((c) => enforcementFnNames.has(c));
  if (found.length > 0) {
    const used = found.some(isUsedInGameplay);
    return {
      status: used ? "full" : "partial",
      fnNames: found,
      usedInGameplay: used,
    };
  }
  return { status: "none", fnNames: [], usedInGameplay: false };
}

// ─── 3. Check Test Coverage ───
const testDir = path.join(GAME_STATE_DIR, "__tests__");
const testFiles = fs.existsSync(testDir)
  ? fs.readdirSync(testDir).filter((f) => f.endsWith(".test.ts"))
  : [];
const allTestText = testFiles
  .map((f) => readFile(path.join(testDir, f)))
  .join("\n");

function hasTest(keyword: string): boolean {
  const re = new RegExp(keyword.replace(/\s+/g, "\\s*"), "i");
  return re.test(allTestText);
}

// ─── 4. Hardcoded Card Names ───
const spellCastingText = readFile(
  path.join(GAME_STATE_DIR, "spell-casting.ts"),
);
// `combat.ts` was decomposed into the `combat/` family directory, so reading
// it directly died with ENOENT — the report had been silently broken since the
// split, which is why `reports/gameplay-gap-analysis.md` was stale. Reuse the
// directory-aware reader so both call sites stay in step.
const combatText = readGameplaySource("combat.ts");
const pageText = fs.existsSync(GAME_PAGE) ? readFile(GAME_PAGE) : "";

const hardcodedCards: {
  card: string;
  location: string;
  line: number;
  snippet: string;
}[] = [];

function findHardcodedCards(text: string, filename: string) {
  const lines = text.split("\n");
  lines.forEach((content, idx) => {
    const m = content.match(/(?:name|spellName)\s*===?\s*["']([^"']+)["']/i);
    if (m) {
      hardcodedCards.push({
        card: m[1],
        location: filename,
        line: idx + 1,
        snippet: content.trim(),
      });
    }
  });
}
findHardcodedCards(spellCastingText, "spell-casting.ts");
findHardcodedCards(pageText, "page.tsx");

// ─── 5. Auto-Pass Priority Patterns ───
const autoPassPatterns = grepLines(pageText, /passPriority\s*\(/);
const forcedAutoPass = autoPassPatterns.filter(({ content }) => {
  return (
    content.includes("aiPlayer") ||
    content.includes("passPriority(newState") ||
    content.includes("passPriority(resolvedState")
  );
});

// ─── 6. Manual Tap/Untap Patterns ───
const manualTap = grepLines(pageText, /tapCard\s*\(/).filter(
  ({ line }) => line !== 75,
);
const manualUntap = grepLines(pageText, /untapCard\s*\(/).filter(
  ({ line }) => line !== 76,
);

// ─── 7. TODO/FIXME/HACK ───
const todoComments = [
  ...grepFiles(GAME_STATE_DIR, /TODO|FIXME|HACK|XXX/, ".ts"),
  ...(pageText
    ? grepLines(pageText, /TODO|FIXME|HACK|XXX/).map((r) => ({
        ...r,
        file: "page.tsx",
      }))
    : []),
];

// ─── 8. Build Report ───
const lines: string[] = [];
lines.push(`# Gameplay Gap Analysis`);
lines.push(``);
lines.push(`**Generated:** ${new Date().toISOString()}`);
lines.push(``);
lines.push(`## Summary`);
lines.push(``);

// ─── Standard scope (epic #2300) ───
// A keyword is in scope when at least one Standard-legal card carries it,
// per the committed Scryfall snapshot. Everything else is an accepted gap.
interface StandardSnapshot {
  generatedAt: string;
  cardCount: number;
  keywords: Record<string, number>;
}
const STANDARD_SNAPSHOT = path.join(
  ROOT,
  "scripts",
  "data",
  "standard-keywords.json",
);
const standardSnapshot = JSON.parse(
  readFile(STANDARD_SNAPSHOT),
) as StandardSnapshot;
const snapshotDate = standardSnapshot.generatedAt.slice(0, 10);

const normalizeKeyword = (k: string) =>
  k.trim().toLowerCase().replace(/!+$/, "");
const standardCounts = new Map<string, number>();
for (const [k, n] of Object.entries(standardSnapshot.keywords)) {
  const key = normalizeKeyword(k);
  standardCounts.set(key, Math.max(standardCounts.get(key) ?? 0, n));
}

// The parser declares some keywords in both arrays (flying, landfall, raid,
// revolt, miracle, ...). Collapse to one row per keyword so no section
// repeats an entry.
const declared = new Map<string, Set<string>>();
for (const [list, source] of [
  [evergreenKeywords, "keyword"],
  [abilityWords, "ability word"],
] as const) {
  for (const raw of list) {
    const key = normalizeKeyword(raw);
    if (!key) continue;
    if (!declared.has(key)) declared.set(key, new Set());
    declared.get(key)!.add(source);
  }
}
const declaredCount = evergreenKeywords.length + abilityWords.length;
const duplicateCount = declaredCount - declared.size;

const allKeywords = [...declared.keys()].map((k) => ({
  keyword: k,
  ...checkEnforcement(k),
  tested: hasTest(k),
  standardCards: standardCounts.get(k) ?? 0,
}));
const keywordResults = allKeywords;
const fullEnforced = allKeywords.filter((k) => k.status === "full");
const partialEnforced = allKeywords.filter((k) => k.status === "partial");
const noneEnforced = allKeywords.filter((k) => k.status === "none");

const inScope = allKeywords.filter((k) => k.standardCards > 0);
const acceptedGaps = allKeywords.filter((k) => k.standardCards === 0);
const inScopeFull = inScope.filter((k) => k.status === "full");
const inScopePartial = inScope.filter((k) => k.status === "partial");
const inScopeNone = inScope.filter((k) => k.status === "none");
const inScopeRemainder = inScope.length - inScopeFull.length;

// Keywords on Standard cards the parser doesn't declare at all. Not counted
// against the epic's denominator yet: many are keyword actions (mill, scry)
// rather than abilities, so they need triage, not a gate each.
const undeclaredStandard = [...standardCounts.entries()]
  .filter(([k]) => !declared.has(k))
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

lines.push(
  `- Standard scope: ${standardSnapshot.cardCount} Standard-legal cards (Scryfall snapshot ${snapshotDate})`,
);
lines.push(`- **In scope (on a Standard-legal card): ${inScope.length}**`);
lines.push(`  - Enforced: ${inScopeFull.length}`);
lines.push(`  - Partially enforced: ${inScopePartial.length}`);
lines.push(`  - Not enforced: ${inScopeNone.length}`);
lines.push(`  - **Remainder (not fully enforced): ${inScopeRemainder}**`);
lines.push(
  `- Accepted gaps (not on any Standard-legal card): ${acceptedGaps.length}`,
);
lines.push(
  `- On Standard cards but not declared by the parser: ${undeclaredStandard.length}`,
);
lines.push(
  `- Unique keywords declared by the parser: ${declared.size} (${declaredCount} entries, ${duplicateCount} declared in both arrays)`,
);
lines.push(`  - Evergreen keywords: ${evergreenKeywords.length}`);
lines.push(`  - Ability words: ${abilityWords.length}`);
lines.push(`- Keywords fully enforced: ${fullEnforced.length}`);
lines.push(`- Keywords partially enforced: ${partialEnforced.length}`);
lines.push(`- Keywords not enforced: ${noneEnforced.length}`);
lines.push(`- Hardcoded card effects: ${hardcodedCards.length}`);
lines.push(`- Forced auto-pass priority calls: ${forcedAutoPass.length}`);
lines.push(
  `- Manual tap/untap calls: ${manualTap.length + manualUntap.length}`,
);
lines.push(`- TODO/FIXME/HACK/XXX comments: ${todoComments.length}`);
lines.push(``);

// ─── Keyword Gaps ───
lines.push(`## Keyword Enforcement Matrix`);
lines.push(``);

function renderTable(title: string, items: typeof keywordResults) {
  if (items.length === 0) return;
  lines.push(`### ${title} (${items.length})`);
  lines.push(``);
  lines.push(
    `| Keyword | Standard cards | Enforced | Used in Gameplay | Tested | Function |`,
  );
  lines.push(
    `|---------|----------------|----------|------------------|--------|----------|`,
  );
  const sorted = [...items].sort(
    (a, b) =>
      b.standardCards - a.standardCards || a.keyword.localeCompare(b.keyword),
  );
  for (const item of sorted) {
    const tested = item.tested ? "✅" : "❌";
    const used = item.usedInGameplay ? "✅" : "❌";
    const fn = item.fnNames.join(", ") || "—";
    lines.push(
      `| ${item.keyword} | ${item.standardCards} | ${item.status} | ${used} | ${tested} | ${fn} |`,
    );
  }
  lines.push(``);
}

lines.push(`## In Scope: Standard`);
lines.push(``);
lines.push(
  `Keywords that appear on at least one Standard-legal card. These are the epic #2300 denominator. Sorted by how many Standard cards carry them.`,
);
lines.push(``);
renderTable("Enforced", inScopeFull);
renderTable("Partially Enforced", inScopePartial);
renderTable("Not Enforced", inScopeNone);

lines.push(`## Accepted Gaps (${acceptedGaps.length})`);
lines.push(``);
lines.push(
  `Declared by the parser but not on any Standard-legal card as of ${snapshotDate}. Not counted against epic #2300.`,
);
lines.push(``);
lines.push(`| Keyword | Enforced | Reason |`);
lines.push(`|---------|----------|--------|`);
for (const item of [...acceptedGaps].sort((a, b) =>
  a.keyword.localeCompare(b.keyword),
)) {
  lines.push(
    `| ${item.keyword} | ${item.status} | not on any Standard-legal card (${snapshotDate}) |`,
  );
}
lines.push(``);

lines.push(`## On Standard Cards, Not Declared by the Parser`);
lines.push(``);
lines.push(
  `${undeclaredStandard.length} keywords carried by Standard-legal cards that the oracle-text parser never declares, so the engine can't detect them. Needs triage: some are keyword actions (mill, scry) handled by effect resolution rather than a gate. Top 40 by card count:`,
);
lines.push(``);
lines.push(`| Keyword | Standard cards |`);
lines.push(`|---------|----------------|`);
for (const [k, n] of undeclaredStandard.slice(0, 40)) {
  lines.push(`| ${k} | ${n} |`);
}
lines.push(``);

// ─── Hardcoded Cards ───
lines.push(`## Hardcoded Card Effects`);
lines.push(``);
lines.push(`| Card | Location | Line | Snippet |`);
lines.push(`|------|----------|------|---------|`);
for (const item of hardcodedCards) {
  const snippet = item.snippet.replace(/\|/g, "\\|").substring(0, 60);
  lines.push(
    `| ${item.card} | ${item.location} | ${item.line} | \`${snippet}\` |`,
  );
}
lines.push(``);

// ─── Auto-Pass Priority ───
lines.push(`## Forced Auto-Pass Priority Calls`);
lines.push(``);
lines.push(
  `These bypass the stack interaction model by forcing both players to pass priority without giving them a response window.`,
);
lines.push(``);
lines.push(`| Location | Line | Context |`);
lines.push(`|----------|------|---------|`);
for (const item of forcedAutoPass) {
  const ctx = item.content.replace(/\|/g, "\\|").substring(0, 80);
  lines.push(`| page.tsx | ${item.line} | \`${ctx}\` |`);
}
lines.push(``);

// ─── Manual Tap/Untap ───
lines.push(`## Manual Tap/Untap Calls`);
lines.push(``);
lines.push(
  `These bypass proper ability activation validation (summoning sickness, cost payment, etc.).`,
);
lines.push(``);
lines.push(`| Type | Location | Line | Context |`);
lines.push(`|------|----------|------|---------|`);
for (const item of manualTap) {
  const ctx = item.content.replace(/\|/g, "\\|").substring(0, 80);
  lines.push(`| tapCard | page.tsx | ${item.line} | \`${ctx}\` |`);
}
for (const item of manualUntap) {
  const ctx = item.content.replace(/\|/g, "\\|").substring(0, 80);
  lines.push(`| untapCard | page.tsx | ${item.line} | \`${ctx}\` |`);
}
lines.push(``);

// ─── TODO/FIXME ───
lines.push(`## TODO / FIXME / HACK / XXX Comments`);
lines.push(``);
if (todoComments.length === 0) {
  lines.push(`*No TODO/FIXME/HACK/XXX comments found in game-state code.*`);
} else {
  lines.push(`| File | Line | Comment |`);
  lines.push(`|------|------|---------|`);
  for (const item of todoComments) {
    const ctx = item.content.replace(/\|/g, "\\|").substring(0, 80);
    lines.push(`| ${item.file} | ${item.line} | \`${ctx}\` |`);
  }
}
lines.push(``);

// ─── Top Gaps ───
lines.push(`## Top Priority Gaps`);
lines.push(``);
lines.push(
  `In-scope keywords not fully enforced, ranked by how many Standard-legal cards carry them:`,
);
lines.push(``);
const topGaps = [...inScopePartial, ...inScopeNone]
  .sort(
    (a, b) =>
      b.standardCards - a.standardCards || a.keyword.localeCompare(b.keyword),
  )
  .slice(0, 20);
let rank = 1;
for (const item of topGaps) {
  const issue =
    item.status === "partial"
      ? "Partial enforcement — function exists but not wired to gameplay"
      : "No enforcement function found";
  lines.push(
    `${rank}. **${item.keyword}** (${item.standardCards} Standard cards) — ${issue}`,
  );
  rank++;
}
lines.push(``);

// ─── Recommendations ───
lines.push(`## Recommendations`);
lines.push(``);
lines.push(`### Immediate (This Session)`);
lines.push(
  `1. Fix auto-pass priority (#618) — ${forcedAutoPass.length} locations bypass stack interaction`,
);
lines.push(
  `2. Add mechanic stubs (#628) — ${inScopeNone.length} in-scope Standard mechanics detected but not enforced`,
);
lines.push(
  `3. Fix mana pool emptying (#619) — missing automatic phase transition cleanup`,
);
lines.push(``);
lines.push(`### Short Term (Next 2–3 Sessions)`);
lines.push(
  `4. Enforce hexproof & menace (#620) — partial enforcement exists but not wired to gameplay`,
);
lines.push(
  `5. Fix shockland life payment (#621) — uses damage instead of life loss`,
);
lines.push(
  `6. Implement untap step (#624) — structural phase with no engine logic`,
);
lines.push(``);
lines.push(`### Medium Term (Next 4–6 Sessions)`);
lines.push(
  `7. First strike / double strike combat (#626) — single damage step is wrong`,
);
lines.push(
  `8. Trample + blocker ordering (#627) — no player choice in damage assignment`,
);
lines.push(
  `9. Standard mechanic E2E tests (#623) — verify actual gameplay, not just card presence`,
);
lines.push(``);

// ─── Write Report ───
fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
// Format with the repo's prettier so the committed report stays clean under
// `prettier --check` (padded table columns) without a manual pass.
void prettier
  .format(lines.join("\n"), { parser: "markdown" })
  .then((report) => {
    fs.writeFileSync(REPORT_PATH, report, "utf-8");
    console.log(`✅ Report written to: ${REPORT_PATH}`);
    console.log(
      `   Keywords declared: ${declared.size} unique (${inScope.length} in Standard scope, ${inScopeRemainder} not fully enforced)`,
    );
    console.log(`   Fully enforced: ${fullEnforced.length}`);
    console.log(`   Partially enforced: ${partialEnforced.length}`);
    console.log(`   Not enforced: ${noneEnforced.length}`);
    console.log(`   Hardcoded cards: ${hardcodedCards.length}`);
    console.log(`   Auto-pass calls: ${forcedAutoPass.length}`);
    console.log(
      `   Manual tap/untap: ${manualTap.length + manualUntap.length}`,
    );
  });
