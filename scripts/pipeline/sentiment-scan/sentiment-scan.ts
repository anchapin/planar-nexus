#!/usr/bin/env node

/**
 * Commentary Sentiment Analysis Pipeline
 * Issue #683: Detect missing/incorrect ability implementations via commentary sentiment analysis
 *
 * Scans transcripts from MTG educational channels for surprise/correction phrases,
 * identifies card references, cross-references against the rules engine, and
 * produces a prioritized triage list of potentially misimplemented abilities.
 *
 * @see Brainstorm doc §5.5.2 — Rules engine
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

import type {
  TranscriptInput,
  ScanReport,
} from "../../../src/lib/pipeline/sentiment-types.js";
import {
  getDefaultConfig,
  scanTranscriptForSentiment,
  extractCardReferences,
  extractExpectedVsActual,
  buildCandidates,
  buildTriageList,
} from "../../../src/lib/pipeline/sentiment-analyzer.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROOT = path.resolve(__dirname, "..", "..", "..");
const TRANSCRIPT_DIR = path.join(ROOT, "data", "raw", "youtube-transcripts");
const REPORT_DIR = path.join(ROOT, "reports");
const REPORT_PATH = path.join(REPORT_DIR, "sentiment-triage-report.md");
const CSV_PATH = path.join(REPORT_DIR, "sentiment-triage-report.csv");

function loadTranscripts(): TranscriptInput[] {
  const transcripts: TranscriptInput[] = [];

  if (!fs.existsSync(TRANSCRIPT_DIR)) {
    console.log(`No transcript directory found at ${TRANSCRIPT_DIR}`);
    console.log("Run youtube-ingest pipeline first to download transcripts.");
    return transcripts;
  }

  const files = fs
    .readdirSync(TRANSCRIPT_DIR)
    .filter((f) => f.endsWith(".json"));

  for (const file of files) {
    try {
      const raw = JSON.parse(
        fs.readFileSync(path.join(TRANSCRIPT_DIR, file), "utf-8"),
      );
      if (
        raw.transcript &&
        Array.isArray(raw.transcript) &&
        raw.transcript.length > 0
      ) {
        transcripts.push({
          videoId: raw.videoId || file.replace(".json", ""),
          channelTitle: raw.channelTitle || "Unknown",
          title: raw.title || "",
          publishedAt: raw.publishedAt || "",
          segments: raw.transcript.map(
            (seg: { text: string; start: number; duration: number }) => ({
              text: seg.text,
              start: seg.start || 0,
              duration: seg.duration || 0,
            }),
          ),
        });
      }
    } catch {
      console.log(`  Skipping ${file}: Failed to parse`);
    }
  }

  return transcripts;
}

function buildCardDatabase(): Set<string> {
  const cardNames = new Set<string>();

  const fixturePath = path.join(
    ROOT,
    "src",
    "lib",
    "__fixtures__",
    "test-cards.ts",
  );
  if (fs.existsSync(fixturePath)) {
    const content = fs.readFileSync(fixturePath, "utf-8");
    const nameMatches = content.matchAll(/name:\s*["']([^"']+)["']/g);
    for (const m of nameMatches) {
      cardNames.add(m[1].toLowerCase());
    }
  }

  return cardNames;
}

function buildEnforcementMap(): Map<
  string,
  { status: string; hasTests: boolean }
> {
  const map = new Map<string, { status: string; hasTests: boolean }>();

  const gameStateDir = path.join(ROOT, "src", "lib", "game-state");
  const keywordsFile = path.join(gameStateDir, "evergreen-keywords.ts");

  if (!fs.existsSync(keywordsFile)) return map;

  const keywordsContent = fs.readFileSync(keywordsFile, "utf-8");
  const fnMatches = keywordsContent.matchAll(
    /export\s+(?:function|const)\s+(\w+)/g,
  );
  const fnNames = new Set<string>();
  for (const m of fnMatches) {
    fnNames.add(m[1]);
  }

  const gameplayFiles = [
    "combat.ts",
    "game-state.ts",
    "state-based-actions.ts",
    "spell-casting.ts",
    "mana.ts",
    "keyword-actions.ts",
  ];

  let gameplayCode = "";
  for (const f of gameplayFiles) {
    const p = path.join(gameStateDir, f);
    if (fs.existsSync(p)) {
      gameplayCode += fs.readFileSync(p, "utf-8") + "\n";
    }
  }

  const testDir = path.join(gameStateDir, "__tests__");
  let testCode = "";
  if (fs.existsSync(testDir)) {
    const testFiles = fs
      .readdirSync(testDir)
      .filter((f) => f.endsWith(".test.ts"));
    for (const f of testFiles) {
      testCode += fs.readFileSync(path.join(testDir, f), "utf-8") + "\n";
    }
  }

  const parserFile = path.join(gameStateDir, "oracle-text-parser.ts");
  if (fs.existsSync(parserFile)) {
    const parserContent = fs.readFileSync(parserFile, "utf-8");
    const arrayMatches = parserContent.matchAll(
      /const\s+(\w+)\s*=\s*\[([\s\S]*?)\];/g,
    );
    for (const m of arrayMatches) {
      const name = m[1];
      if (["evergreenKeywords", "abilityWords"].includes(name)) {
        const items = m[2]
          .split(",")
          .map((s) => s.trim().replace(/["'`]/g, "").toLowerCase())
          .filter(Boolean);
        for (const kw of items) {
          const camelKw = kw.replace(/(?:^|\s)(.)/g, (_: string, c: string) =>
            c.toUpperCase(),
          );
          const candidates = [
            `has${camelKw}`,
            `apply${camelKw}`,
            `handle${camelKw}`,
            `enforce${camelKw}`,
            `is${camelKw}`,
            `can${camelKw}`,
          ];
          const found = candidates.filter((c) => fnNames.has(c));
          const used = found.some((c) => gameplayCode.includes(c));
          const hasTest = testCode.toLowerCase().includes(kw);

          let status = "none";
          if (used) status = "full";
          else if (found.length > 0) status = "partial";

          map.set(kw, { status, hasTests });
        }
      }
    }
  }

  return map;
}

function generateReport(
  triageItems: ScanReport["triageList"],
  channels: string[],
): string {
  const lines: string[] = [];

  lines.push(
    "# Commentary Sentiment Analysis — Ability Misimplementation Triage",
  );
  lines.push("");
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Transcripts scanned: ${channels.length} channels`);
  lines.push(`- Total candidates: ${triageItems.length}`);
  lines.push(
    `- Critical priority: ${triageItems.filter((i) => i.finalPriority === "critical").length}`,
  );
  lines.push(
    `- High priority: ${triageItems.filter((i) => i.finalPriority === "high").length}`,
  );
  lines.push(
    `- Medium priority: ${triageItems.filter((i) => i.finalPriority === "medium").length}`,
  );
  lines.push(
    `- Low priority: ${triageItems.filter((i) => i.finalPriority === "low").length}`,
  );
  lines.push("");
  lines.push(`**Channels scanned:** ${channels.join(", ")}`);
  lines.push("");

  const sections: Array<{
    title: string;
    filter: (i: ScanReport["triageList"][0]) => boolean;
  }> = [
    {
      title: "Critical",
      filter: (i) => i.finalPriority === "critical",
    },
    {
      title: "High",
      filter: (i) => i.finalPriority === "high",
    },
    {
      title: "Medium",
      filter: (i) => i.finalPriority === "medium",
    },
    { title: "Low", filter: (i) => i.finalPriority === "low" },
  ];

  for (const section of sections) {
    const items = triageItems.filter(section.filter);
    if (items.length === 0) continue;

    lines.push(`## ${section.title} Priority (${items.length})`);
    lines.push("");
    lines.push(
      "| # | Card/Keyword | Channel | Confidence | Enforcement | Tests | Recommendation |",
    );
    lines.push(
      "|---|-------------|---------|------------|-------------|-------|----------------|",
    );

    items.forEach((item, idx) => {
      const card = item.crossReference?.cardName || "unknown";
      const channel = item.candidate.channelTitle;
      const conf = (item.candidate.combinedConfidence * 100).toFixed(0) + "%";
      const enf = item.crossReference?.enforcementStatus || "unknown";
      const tests = item.crossReference?.engineHasTests ? "✅" : "❌";
      const rec =
        item.recommendation.substring(0, 80) +
        (item.recommendation.length > 80 ? "..." : "");

      lines.push(
        `| ${idx + 1} | ${card} | ${channel} | ${conf} | ${enf} | ${tests} | ${rec} |`,
      );
    });

    lines.push("");
  }

  if (triageItems.length > 0) {
    lines.push("## Detailed Findings");
    lines.push("");

    for (const item of triageItems.slice(0, 10)) {
      lines.push(`### ${item.candidate.videoTitle}`);
      lines.push("");
      lines.push(`- **Video ID:** ${item.candidate.videoId}`);
      lines.push(`- **Channel:** ${item.candidate.channelTitle}`);
      lines.push(`- **Priority:** ${item.finalPriority}`);
      lines.push(
        `- **Confidence:** ${(item.candidate.combinedConfidence * 100).toFixed(1)}%`,
      );

      if (item.crossReference) {
        lines.push(`- **Card/Keyword:** ${item.crossReference.cardName}`);
        lines.push(
          `- **Engine Status:** ${item.crossReference.enforcementStatus}`,
        );
        lines.push(
          `- **Has Tests:** ${item.crossReference.engineHasTests ? "Yes" : "No"}`,
        );
        if (item.crossReference.notes.length > 0) {
          lines.push(`- **Notes:** ${item.crossReference.notes.join("; ")}`);
        }
      }

      lines.push("");
      lines.push("**Sentiment matches:**");
      for (const match of item.candidate.sentimentMatches) {
        const mins = Math.floor(match.timestamp / 60);
        const secs = Math.floor(match.timestamp % 60);
        lines.push(
          `- [${mins}:${secs.toString().padStart(2, "0")}] (${match.category}) "${match.text.substring(0, 120)}"`,
        );
      }

      if (item.candidate.expectedVsActual.length > 0) {
        lines.push("");
        lines.push("**Expected vs Actual:**");
        for (const eva of item.candidate.expectedVsActual) {
          lines.push(`- Expected: ${eva.expectedBehavior}`);
          lines.push(`- Actual: ${eva.actualBehavior}`);
        }
      }

      lines.push("");
      lines.push(`**Recommendation:** ${item.recommendation}`);
      lines.push("");
    }
  }

  lines.push("---");
  lines.push("*Generated by sentiment-scan pipeline — Issue #683*");

  return lines.join("\n");
}

function generateCsv(triageItems: ScanReport["triageList"]): string {
  const lines: string[] = [];
  lines.push(
    "priority,video_id,channel,video_title,card_name,confidence,enforcement_status,has_tests,recommendation,sentiment_matches",
  );

  for (const item of triageItems) {
    const c = item.candidate;
    const cr = item.crossReference;
    const sentimentStr = c.sentimentMatches
      .map(
        (m) => `[${m.category}] ${m.text.substring(0, 60).replace(/"/g, "'")}`,
      )
      .join(" | ");

    lines.push(
      [
        item.finalPriority,
        c.videoId,
        `"${c.channelTitle.replace(/"/g, "'")}"`,
        `"${c.videoTitle.replace(/"/g, "'")}"`,
        cr?.cardName || "unknown",
        c.combinedConfidence.toFixed(2),
        cr?.enforcementStatus || "unknown",
        cr?.engineHasTests ? "true" : "false",
        `"${item.recommendation.replace(/"/g, "'")}"`,
        `"${sentimentStr.replace(/"/g, "'")}"`,
      ].join(","),
    );
  }

  return lines.join("\n");
}

function main() {
  console.log("=".repeat(60));
  console.log("Commentary Sentiment Analysis Pipeline");
  console.log("Issue #683: Detect missing/incorrect ability implementations");
  console.log("=".repeat(60));

  const config = getDefaultConfig();

  console.log(`\nChannels to scan: ${config.channels.length}`);
  for (const ch of config.channels) {
    console.log(`  - ${ch.name}`);
  }

  const transcripts = loadTranscripts();
  console.log(`\nTranscripts loaded: ${transcripts.length}`);

  if (transcripts.length === 0) {
    console.log(
      "\nNo transcripts found. Generate sample report with demo data...",
    );
  }

  const cardDatabase = buildCardDatabase();
  console.log(`Card database entries: ${cardDatabase.size}`);

  const enforcementMap = buildEnforcementMap();
  console.log(`Enforcement map entries: ${enforcementMap.size}`);

  const allTriageItems: ScanReport["triageList"] = [];
  const scannedChannels = new Set<string>();

  for (const transcript of transcripts) {
    scannedChannels.add(transcript.channelTitle);

    const sentimentMatches = scanTranscriptForSentiment(transcript, config);
    const cardReferences = extractCardReferences(transcript, cardDatabase);
    const expectedVsActual = extractExpectedVsActual(
      sentimentMatches,
      cardReferences,
    );
    const candidates = buildCandidates(
      transcript,
      sentimentMatches,
      cardReferences,
      expectedVsActual,
    );
    const triageItems = buildTriageList(
      candidates,
      cardDatabase,
      enforcementMap,
    );

    allTriageItems.push(...triageItems);
  }

  allTriageItems.sort((a, b) => {
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    const pa = priorityOrder[a.finalPriority] ?? 4;
    const pb = priorityOrder[b.finalPriority] ?? 4;
    if (pa !== pb) return pa - pb;
    return b.candidate.combinedConfidence - a.candidate.combinedConfidence;
  });

  console.log(
    `\nTotal sentiment matches: ${allTriageItems.reduce((sum, i) => sum + i.candidate.sentimentMatches.length, 0)}`,
  );
  console.log(`Total candidates generated: ${allTriageItems.length}`);
  console.log(
    `Critical: ${allTriageItems.filter((i) => i.finalPriority === "critical").length}`,
  );
  console.log(
    `High: ${allTriageItems.filter((i) => i.finalPriority === "high").length}`,
  );
  console.log(
    `Medium: ${allTriageItems.filter((i) => i.finalPriority === "medium").length}`,
  );
  console.log(
    `Low: ${allTriageItems.filter((i) => i.finalPriority === "low").length}`,
  );

  const mdReport = generateReport(allTriageItems, [...scannedChannels]);
  const csvReport = generateCsv(allTriageItems);

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(REPORT_PATH, mdReport, "utf-8");
  fs.writeFileSync(CSV_PATH, csvReport, "utf-8");

  console.log(`\n✅ Markdown report: ${REPORT_PATH}`);
  console.log(`✅ CSV report: ${CSV_PATH}`);
  console.log("=".repeat(60));
}

main();
