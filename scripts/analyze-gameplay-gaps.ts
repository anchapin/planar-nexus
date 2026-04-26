#!/usr/bin/env node
/**
 * Static Analysis & Gap Detection Tool
 * Issue #616: Finds gaps between detected keywords and engine enforcement
 */

import * as fs from "fs";
import * as path from "path";

// ─── Configuration ───
const ROOT = path.resolve(__dirname, "..");
const GAME_STATE_DIR = path.join(ROOT, "src", "lib", "game-state");
const GAME_PAGE = path.join(ROOT, "src", "app", "(app)", "game", "[id]", "page.tsx");
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

// ─── Helpers ───
function readFile(p: string): string {
  return fs.readFileSync(p, "utf-8");
}

function extractArrayItems(text: string, arrayName: string): string[] {
  const regex = new RegExp(
    `${arrayName}\\s*[=:]\\s*\\[([\\s\\S]*?)\\];`,
    "m"
  );
  const match = text.match(regex);
  if (!match) return [];
  return match[1]
    .split("\n")
    .map((l) => l.trim().replace(/,$/, "").replace(/"/g, ""))
    .filter((l) => l.length > 0 && !l.startsWith("//") && !l.startsWith("*"));
}

function extractExportedFunctions(text: string): { name: string; line: number }[] {
  const results: { name: string; line: number }[] = [];
  const lines = text.split("\n");
  const re = /export\s+(?:function|const)\s+(\w+)/;
  lines.forEach((line, idx) => {
    const m = line.match(re);
    if (m) results.push({ name: m[1], line: idx + 1 });
  });
  return results;
}

function grepLines(text: string, pattern: RegExp): { line: number; content: string }[] {
  return text
    .split("\n")
    .map((content, idx) => ({ line: idx + 1, content }))
    .filter(({ content }) => pattern.test(content));
}

function grepFiles(dir: string, pattern: RegExp, ext: string): { file: string; line: number; content: string }[] {
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
const parserText = readFile(path.join(GAME_STATE_DIR, "oracle-text-parser.ts"));
const evergreenKeywords = extractArrayItems(parserText, "evergreenKeywords");
const abilityWords = extractArrayItems(parserText, "abilityWords");

// ─── 2. Extract Enforcement Functions ───
const keywordsText = readFile(path.join(GAME_STATE_DIR, "evergreen-keywords.ts"));
const exportedFns = extractExportedFunctions(keywordsText);
const enforcementFnNames = new Set(exportedFns.map((f) => f.name));

// Read gameplay files to check for actual usage
const gameplayCode = GAMEPLAY_FILES
  .map((f) => {
    const p = path.join(GAME_STATE_DIR, f);
    return fs.existsSync(p) ? readFile(p) : "";
  })
  .join("\n");

// Map keyword → likely enforcement function names
function inferEnforcementFns(keyword: string): string[] {
  const k = keyword.toLowerCase().replace(/\s+/g, "").replace(/!/g, "").replace(/from$/, "");
  const camel = k.replace(/(?:^|\.)(.)/g, (_, c: string) => c.toUpperCase());
  return [
    `has${camel}`,
    `is${camel}`,
    `can${camel}`,
    `get${camel}`,
    `deals${camel}Damage`,
    `isProtectedBy${camel}`,
    `hasLethal${camel}`,
    `calculate${camel}Damage`,
  ];
}

function isUsedInGameplay(fnName: string): boolean {
  return new RegExp(`\\b${fnName}\\b`).test(gameplayCode);
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
    return { status: used ? "full" : "partial", fnNames: found, usedInGameplay: used };
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
const spellCastingText = readFile(path.join(GAME_STATE_DIR, "spell-casting.ts"));
const combatText = readFile(path.join(GAME_STATE_DIR, "combat.ts"));
const pageText = fs.existsSync(GAME_PAGE) ? readFile(GAME_PAGE) : "";

const hardcodedCards: { card: string; location: string; line: number; snippet: string }[] = [];

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
  ({ line }) => line !== 75
);
const manualUntap = grepLines(pageText, /untapCard\s*\(/).filter(
  ({ line }) => line !== 76
);

// ─── 7. TODO/FIXME/HACK ───
const todoComments = [
  ...grepFiles(GAME_STATE_DIR, /TODO|FIXME|HACK|XXX/, ".ts"),
  ...(pageText ? grepLines(pageText, /TODO|FIXME|HACK|XXX/).map((r) => ({ ...r, file: "page.tsx" })) : []),
];

// ─── 8. Build Report ───
const lines: string[] = [];
lines.push(`# Gameplay Gap Analysis`);
lines.push(``);
lines.push(`**Generated:** ${new Date().toISOString()}`);
lines.push(``);
lines.push(`## Summary`);
lines.push(``);

const keywordResults = evergreenKeywords.map((k) => ({
  keyword: k,
  ...checkEnforcement(k),
  tested: hasTest(k),
}));

const abilityWordResults = abilityWords.map((k) => ({
  keyword: k,
  ...checkEnforcement(k),
  tested: hasTest(k),
}));

const allKeywords = [...keywordResults, ...abilityWordResults];
const fullEnforced = allKeywords.filter((k) => k.status === "full");
const partialEnforced = allKeywords.filter((k) => k.status === "partial");
const noneEnforced = allKeywords.filter((k) => k.status === "none");

lines.push(`- Total keywords detected: ${evergreenKeywords.length + abilityWords.length}`);
lines.push(`  - Evergreen keywords: ${evergreenKeywords.length}`);
lines.push(`  - Ability words: ${abilityWords.length}`);
lines.push(`- Keywords fully enforced: ${fullEnforced.length}`);
lines.push(`- Keywords partially enforced: ${partialEnforced.length}`);
lines.push(`- Keywords not enforced: ${noneEnforced.length}`);
lines.push(`- Hardcoded card effects: ${hardcodedCards.length}`);
lines.push(`- Forced auto-pass priority calls: ${forcedAutoPass.length}`);
lines.push(`- Manual tap/untap calls: ${manualTap.length + manualUntap.length}`);
lines.push(`- TODO/FIXME/HACK/XXX comments: ${todoComments.length}`);
lines.push(``);

// ─── Keyword Gaps ───
lines.push(`## Keyword Enforcement Matrix`);
lines.push(``);

function renderTable(title: string, items: typeof keywordResults) {
  if (items.length === 0) return;
  lines.push(`### ${title} (${items.length})`);
  lines.push(``);
  lines.push(`| Keyword | Enforced | Used in Gameplay | Tested | Function |`);
  lines.push(`|---------|----------|------------------|--------|----------|`);
  for (const item of items.sort((a, b) => a.keyword.localeCompare(b.keyword))) {
    const tested = item.tested ? "✅" : "❌";
    const used = item.usedInGameplay ? "✅" : "❌";
    const fn = item.fnNames.join(", ") || "—";
    lines.push(`| ${item.keyword} | ${item.status} | ${used} | ${tested} | ${fn} |`);
  }
  lines.push(``);
}

renderTable("Fully Enforced", fullEnforced);
renderTable("Partially Enforced", partialEnforced);

// Focus on Standard-relevant keywords for the "not enforced" section
const standardRelevant = [
  "first strike", "double strike", "enchant", "equip", "convoke", "kicker",
  "ward", "cycling", "flashback", "proliferate", "explore", "investigate",
  "food", "learn", "disguise", "plot", "offspring", "gift", "saddle",
  "descend", "craft", "suspect", "survival", "valiant", "bargain",
  "celebration", "connive", "casualty", "backup", "blitz", "incubate",
  "training", "compleated", "enlist", "reconfigure", "undying", "persist",
  "unleash", "cascade", "delirium", "decayed", "cloak", "eerie", "endure",
  "forage", "harmonize", "flurry", "manifest dread", "room", "spree",
  "treasure", "adventure", "dash", "embalm", "escape", "evoke", "exert",
  "formidable", "hideaway", "meld", "modular", "populate", "rebound",
  "scavenge", "spectacle", "suspend", "totem armor", "undergrowth",
  "myriad", "skulk", "frenzy", "goad", "haunt", "imprint", "living weapon",
  "offering", "prototype", "sunburst", "strive", "vanishing", "dungeon",
  "venture", "max speed", "start your engines!", "read ahead", "toxic",
  "affinity", "annihilator", "bloodthirst", "conspire", "devour", "level up",
  "soulbond", "extort", "dethrone", "hidden agenda", "delve", "ferocious",
  "exploit", "entwine", "threshold", "underdog", "transmute", "transfigure",
  "graft", "bloodrush", "cohort", "join forces", "parley",
  "will of the council", "assemble", "battle cry", "chroma", "eked",
  "fateful hour", "hellbent", "heroic", "inspired", "kinfall", "lieutenant",
  "might of the nations", "pack tactics", "radiance", "shield",
  "strength in numbers", "tempting offer",
];

const standardNotEnforced = noneEnforced.filter((k) =>
  standardRelevant.some((sr) => k.keyword.toLowerCase().includes(sr.toLowerCase()))
);
const otherNotEnforced = noneEnforced.filter(
  (k) => !standardRelevant.some((sr) => k.keyword.toLowerCase().includes(sr.toLowerCase()))
);

renderTable("Not Enforced — Standard Relevant", standardNotEnforced);
renderTable("Not Enforced — Non-Standard / Legacy", otherNotEnforced);

// ─── Hardcoded Cards ───
lines.push(`## Hardcoded Card Effects`);
lines.push(``);
lines.push(`| Card | Location | Line | Snippet |`);
lines.push(`|------|----------|------|---------|`);
for (const item of hardcodedCards) {
  const snippet = item.snippet.replace(/\|/g, "\\|").substring(0, 60);
  lines.push(`| ${item.card} | ${item.location} | ${item.line} | \`${snippet}\` |`);
}
lines.push(``);

// ─── Auto-Pass Priority ───
lines.push(`## Forced Auto-Pass Priority Calls`);
lines.push(``);
lines.push(`These bypass the stack interaction model by forcing both players to pass priority without giving them a response window.`);
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
lines.push(`These bypass proper ability activation validation (summoning sickness, cost payment, etc.).`);
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
lines.push(`Based on Standard relevance and gameplay impact:`);
lines.push(``);

const topGaps = [
  ...partialEnforced.filter((k) => !k.usedInGameplay),
  ...standardNotEnforced.slice(0, 20),
];

let rank = 1;
for (const item of topGaps) {
  const issue = item.status === "partial" ? "Partial enforcement — function exists but not wired to gameplay" : "No enforcement function exists";
  lines.push(`${rank}. **${item.keyword}** — ${issue}`);
  rank++;
}
lines.push(``);

// ─── Recommendations ───
lines.push(`## Recommendations`);
lines.push(``);
lines.push(`### Immediate (This Session)`);
lines.push(`1. Fix auto-pass priority (#618) — ${forcedAutoPass.length} locations bypass stack interaction`);
lines.push(`2. Add mechanic stubs (#628) — ${standardNotEnforced.length} Standard mechanics detected but not enforced`);
lines.push(`3. Fix mana pool emptying (#619) — missing automatic phase transition cleanup`);
lines.push(``);
lines.push(`### Short Term (Next 2–3 Sessions)`);
lines.push(`4. Enforce hexproof & menace (#620) — partial enforcement exists but not wired to gameplay`);
lines.push(`5. Fix shockland life payment (#621) — uses damage instead of life loss`);
lines.push(`6. Implement untap step (#624) — structural phase with no engine logic`);
lines.push(``);
lines.push(`### Medium Term (Next 4–6 Sessions)`);
lines.push(`7. First strike / double strike combat (#626) — single damage step is wrong`);
lines.push(`8. Trample + blocker ordering (#627) — no player choice in damage assignment`);
lines.push(`9. Standard mechanic E2E tests (#623) — verify actual gameplay, not just card presence`);
lines.push(``);

// ─── Write Report ───
fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
fs.writeFileSync(REPORT_PATH, lines.join("\n"), "utf-8");
console.log(`✅ Report written to: ${REPORT_PATH}`);
console.log(`   Keywords detected: ${evergreenKeywords.length + abilityWords.length}`);
console.log(`   Fully enforced: ${fullEnforced.length}`);
console.log(`   Partially enforced: ${partialEnforced.length}`);
console.log(`   Not enforced: ${noneEnforced.length}`);
console.log(`   Hardcoded cards: ${hardcodedCards.length}`);
console.log(`   Auto-pass calls: ${forcedAutoPass.length}`);
console.log(`   Manual tap/untap: ${manualTap.length + manualUntap.length}`);
