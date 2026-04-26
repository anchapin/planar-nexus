#!/usr/bin/env node
/**
 * Oracle Text Audit: Standard Card Implementation Matrix
 * Issue #617: Maps every Standard card to its implementation status
 */

import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");
const REPORT_DIR = path.join(ROOT, "reports");
const FIXTURES_PATH = path.join(ROOT, "e2e", "fixtures", "test-cards.json");
const GAME_STATE_DIR = path.join(ROOT, "src", "lib", "game-state");
const CSV_PATH = path.join(REPORT_DIR, "standard-card-implementation-matrix.csv");
const MD_PATH = path.join(REPORT_DIR, "standard-card-implementation-matrix.md");

// Read test fixtures
function loadFixtureCards(): any[] {
  if (!fs.existsSync(FIXTURES_PATH)) return [];
  const data = JSON.parse(fs.readFileSync(FIXTURES_PATH, "utf-8"));
  return data.cards || data || [];
}

// Read all mock/test card definitions from codebase
function findMockCards(): { name: string; oracle_text: string; type_line: string; source: string }[] {
  const results: { name: string; oracle_text: string; type_line: string; source: string }[] = [];

  // Search test files for createMockCard / createMockLand / createMockCreature calls
  const testDir = path.join(GAME_STATE_DIR, "__tests__");
  if (fs.existsSync(testDir)) {
    const files = fs.readdirSync(testDir).filter((f) => f.endsWith(".ts"));
    for (const file of files) {
      const text = fs.readFileSync(path.join(testDir, file), "utf-8");
      // Find createMockCard calls with oracle_text
      const re = /createMock(?:Card|Land|Creature)\s*\(\s*["']([^"']+)["']/g;
      let m;
      while ((m = re.exec(text)) !== null) {
        const name = m[1];
        // Try to find oracle_text in same file near the call
        const nearby = text.substring(Math.max(0, m.index - 200), m.index + 400);
        const otMatch = nearby.match(/oracle_text\s*:\s*["']([^"']*)["']/);
        const typeMatch = nearby.match(/type_line\s*:\s*["']([^"']*)["']/);
        results.push({
          name,
          oracle_text: otMatch?.[1] || "",
          type_line: typeMatch?.[1] || "",
          source: `test: ${file}`,
        });
      }
    }
  }

  return results;
}

// Extract keywords from oracle text using the same logic as the parser
function extractKeywords(oracleText: string, typeLine: string = ""): string[] {
  const combined = `${typeLine} ${oracleText}`.toLowerCase();
  const keywords: string[] = [];

  const evergreenKeywords = [
    "flying", "first strike", "double strike", "deathtouch", "defender",
    "enchant", "equip", "flash", "haste", "hexproof", "indestructible",
    "lifelink", "menace", "reach", "trample", "vigilance", "banding",
    "protection", "shadow", " phasing", "flanking", "fear", "intimidate",
    "landwalk", "lure", "provoke", "rampage", "wither", "bestow", "crew",
    "crewmate", "fabricate", "fight", "hexproof from", "improvise", "infect",
    "mentor", "miracle", "morph", "mutate", "ninjutsu", "outlast", "overload",
    "prowess", "raid", "renown", "revolt", "splice", "storm", "support",
    "surge", "surveil", "transform", "tribute", "undaunted", "convoke",
    "kicker", "ward", "cycling", "flashback", "proliferate", "explore",
    "investigate", "food", "learn", "disguise", "plot", "offspring", "gift",
    "saddle", "descend", "craft", "suspect", "survival", "valiant", "bargain",
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

  for (const kw of evergreenKeywords) {
    if (combined.includes(kw)) {
      keywords.push(kw);
    }
  }

  return [...new Set(keywords)];
}

// Check if keyword has engine enforcement
function hasEnforcement(keyword: string): "full" | "partial" | "none" {
  const k = keyword.toLowerCase().replace(/\s+/g, "").replace(/!/g, "").replace(/from$/, "");
  const camel = k.replace(/(?:^|\.)(.)/g, (_, c: string) => c.toUpperCase());
  const candidates = [
    `has${camel}`, `is${camel}`, `can${camel}`, `get${camel}`,
    `deals${camel}Damage`, `isProtectedBy${camel}`,
  ];

  const kwFile = path.join(GAME_STATE_DIR, "evergreen-keywords.ts");
  if (!fs.existsSync(kwFile)) return "none";
  const text = fs.readFileSync(kwFile, "utf-8");

  const found = candidates.some((c) => text.includes(`export function ${c}`) || text.includes(`export const ${c}`));
  if (!found) return "none";

  // Check if used in gameplay files
  const gameplayFiles = ["combat.ts", "game-state.ts", "state-based-actions.ts", "spell-casting.ts", "mana.ts", "keyword-actions.ts"];
  const used = gameplayFiles.some((f) => {
    const p = path.join(GAME_STATE_DIR, f);
    if (!fs.existsSync(p)) return false;
    const content = fs.readFileSync(p, "utf-8");
    return candidates.some((c) => new RegExp(`\\b${c}\\b`).test(content));
  });

  return used ? "full" : "partial";
}

// Check test coverage
function hasUnitTest(keyword: string): boolean {
  const testDir = path.join(GAME_STATE_DIR, "__tests__");
  if (!fs.existsSync(testDir)) return false;
  const files = fs.readdirSync(testDir).filter((f) => f.endsWith(".test.ts"));
  const re = new RegExp(keyword.replace(/\s+/g, "\\s*"), "i");
  return files.some((f) => re.test(fs.readFileSync(path.join(testDir, f), "utf-8")));
}

function hasE2ETest(cardName: string): boolean {
  const e2eDir = path.join(ROOT, "e2e");
  if (!fs.existsSync(e2eDir)) return false;
  const files = fs.readdirSync(e2eDir).filter((f) => f.endsWith(".spec.ts"));
  const re = new RegExp(cardName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  return files.some((f) => re.test(fs.readFileSync(path.join(e2eDir, f), "utf-8")));
}

// Determine severity
function getSeverity(keywords: string[], enforcementStatus: string[]): string {
  const hasCore = keywords.some((k) =>
    ["flying", "first strike", "double strike", "deathtouch", "trample", "menace", "hexproof", "lifelink", "vigilance", "flash", "haste", "defender", "reach", "indestructible", "ward"].includes(k)
  );
  const hasStandard = keywords.some((k) =>
    ["cycling", "flashback", "convoke", "explore", "surveil", "investigate", "disguise", "plot", "offspring", "saddle", "food", "treasure", "learn", "valiant", "bargain", "backup", "incubate", "kicker", "proliferate"].includes(k)
  );
  const anyEnforced = enforcementStatus.some((s) => s === "full");

  if (hasCore && !anyEnforced) return "critical";
  if (hasStandard && !anyEnforced) return "high";
  if (!anyEnforced) return "medium";
  if (enforcementStatus.some((s) => s === "partial")) return "low";
  return "none";
}

// ─── Main ───
const fixtureCards = loadFixtureCards();
const mockCards = findMockCards();

// Merge and deduplicate by name
const allCards = new Map<string, { name: string; oracle_text: string; type_line: string; source: string }>();
for (const card of fixtureCards) {
  const name = card.name || card.cardData?.name;
  const ot = card.oracle_text || card.cardData?.oracle_text || "";
  const tl = card.type_line || card.cardData?.type_line || "";
  if (name) allCards.set(name, { name, oracle_text: ot, type_line: tl, source: "fixture" });
}
for (const card of mockCards) {
  if (!allCards.has(card.name)) {
    allCards.set(card.name, card);
  }
}

// Build matrix
const matrix: {
  name: string;
  oracle_text: string;
  type_line: string;
  keywords: string[];
  enforcementStatuses: string[];
  hasUnitTest: boolean;
  hasE2ETest: boolean;
  severity: string;
  notes: string;
}[] = [];

for (const card of allCards.values()) {
  const keywords = extractKeywords(card.oracle_text, card.type_line);
  const enforcementStatuses = keywords.map(hasEnforcement);
  const unitTested = keywords.some(hasUnitTest);
  const e2eTested = hasE2ETest(card.name);
  const severity = getSeverity(keywords, enforcementStatuses);

  const notes: string[] = [];
  if (keywords.length === 0) notes.push("No keywords detected");
  else {
    const unenforced = keywords.filter((_, i) => enforcementStatuses[i] === "none");
    if (unenforced.length > 0) notes.push(`Unenforced: ${unenforced.join(", ")}`);
  }

  matrix.push({
    name: card.name,
    oracle_text: card.oracle_text,
    type_line: card.type_line,
    keywords,
    enforcementStatuses,
    hasUnitTest: unitTested,
    hasE2ETest: e2eTested,
    severity,
    notes: notes.join("; ") || "All enforced",
  });
}

// Sort by severity
const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, none: 4 };
matrix.sort((a, b) => severityOrder[a.severity as keyof typeof severityOrder] - severityOrder[b.severity as keyof typeof severityOrder]);

// ─── Write CSV ───
const csvLines: string[] = [];
csvLines.push("card_name,oracle_text,type_line,detected_keywords,has_enforcement,has_unit_test,has_e2e_test,gap_severity,notes");
for (const row of matrix) {
  const kw = row.keywords.join(" | ");
  const enf = row.enforcementStatuses.join(" | ");
  csvLines.push(`"${row.name}","${row.oracle_text.replace(/"/g, '""')}","${row.type_line}","${kw}","${enf}",${row.hasUnitTest},${row.hasE2ETest},${row.severity},"${row.notes}"`);
}
fs.mkdirSync(REPORT_DIR, { recursive: true });
fs.writeFileSync(CSV_PATH, csvLines.join("\n"), "utf-8");

// ─── Write Markdown ───
const mdLines: string[] = [];
mdLines.push(`# Standard Card Implementation Matrix`);
mdLines.push(``);
mdLines.push(`**Generated:** ${new Date().toISOString()}`);
mdLines.push(``);
mdLines.push(`## Summary`);
mdLines.push(``);
mdLines.push(`- Total cards analyzed: ${matrix.length}`);
mdLines.push(`- Cards with critical gaps: ${matrix.filter((r) => r.severity === "critical").length}`);
mdLines.push(`- Cards with high gaps: ${matrix.filter((r) => r.severity === "high").length}`);
mdLines.push(`- Cards with medium gaps: ${matrix.filter((r) => r.severity === "medium").length}`);
mdLines.push(`- Cards fully implemented: ${matrix.filter((r) => r.severity === "none").length}`);
mdLines.push(``);

function renderSection(title: string, rows: typeof matrix) {
  if (rows.length === 0) return;
  mdLines.push(`## ${title} (${rows.length})`);
  mdLines.push(``);
  mdLines.push(`| Card | Keywords | Enforcement | Unit Test | E2E Test | Notes |`);
  mdLines.push(`|------|----------|-------------|-----------|----------|-------|`);
  for (const row of rows) {
    const kw = row.keywords.join(", ") || "—";
    const enf = row.enforcementStatuses.every((s) => s === "full") ? "✅" :
      row.enforcementStatuses.some((s) => s === "full") ? "⚠️ partial" : "❌";
    const ut = row.hasUnitTest ? "✅" : "❌";
    const e2e = row.hasE2ETest ? "✅" : "❌";
    mdLines.push(`| ${row.name} | ${kw} | ${enf} | ${ut} | ${e2e} | ${row.notes} |`);
  }
  mdLines.push(``);
}

renderSection("Critical Gaps", matrix.filter((r) => r.severity === "critical"));
renderSection("High Gaps", matrix.filter((r) => r.severity === "high"));
renderSection("Medium Gaps", matrix.filter((r) => r.severity === "medium"));
renderSection("Low Gaps", matrix.filter((r) => r.severity === "low"));
renderSection("Fully Implemented", matrix.filter((r) => r.severity === "none"));

fs.writeFileSync(MD_PATH, mdLines.join("\n"), "utf-8");

console.log(`✅ CSV written to: ${CSV_PATH}`);
console.log(`✅ Markdown written to: ${MD_PATH}`);
console.log(`   Cards analyzed: ${matrix.length}`);
console.log(`   Critical gaps: ${matrix.filter((r) => r.severity === "critical").length}`);
console.log(`   High gaps: ${matrix.filter((r) => r.severity === "high").length}`);
console.log(`   Medium gaps: ${matrix.filter((r) => r.severity === "medium").length}`);
