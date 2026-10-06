/**
 * Aggregate `needs_new_op` reasons across `docs/card-scripts/drafts/*.md`
 * and group by capability, ranking the resulting capabilities by the number
 * of distinct cards they unlock. Writes `reports/op-frontier.md`.
 *
 * Phase 4 (#2487). Reuses `tallyMissingOps` from `scripts/card-scripts/
 * draft-lib.ts` for the raw key tally; capability grouping lives here so
 * `draft-lib.ts` keeps its single-purpose surface.
 *
 * Usage: `npx tsx scripts/build-op-frontier.ts`
 */
import * as fs from "node:fs";
import * as path from "node:path";

const REPO = path.resolve(__dirname, "..");
const DRAFTS = path.join(REPO, "docs", "card-scripts", "drafts");
const OUT = path.join(REPO, "reports", "op-frontier.md");

interface CapabilityRow {
  capability: string;
  cards: string[];
  rawReasons: string[];
}

/**
 * Map a normalized LLM `needs_new_op` reason string to a canonical
 * capability. The LLM produces dozens of paraphrases of the same gap
 * (e.g. "enchant creature", "aura enchantment", "enchantment - aura" —
 * all the aura op). Each entry is a regex that anchors at the START of
 * the lower-cased reason: most paraphrases lead with the key concept.
 *
 * Capability rows below are ordered by the rank we want in the output; the
 * first match wins, so put specific patterns before generic ones
 * ("indestructible keyword" must come before "static effect").
 */
const CAPABILITY_PATTERNS: ReadonlyArray<{
  capability: string;
  pattern: RegExp;
  cr?: string;
  sketch?: string;
}> = [
  {
    capability: "equipment (attach, equip cost, equipped-creature static)",
    pattern:
      /^(equipment mechanics|equipment attachment|equipment mechanic|equip cost|equip ability|equipped creature|attach(?:ing)?\s+(?:an?|the)\s+equipment|attach effect|attach (?:an )?equipment)\b/i,
    cr: "CR 301.5 (equipped), 702.6 (equip keyword)",
    sketch:
      "New `Equipment` schema branch in `CardScriptSchema`: `equipment: { attachTarget?: 'creature', equipCost?, static: { keywords?, power?, toughness? } }`. The engine attaches on ETB; the static applies to the equipped creature (layer 6/7c).",
  },
  {
    capability: "return card from graveyard to battlefield",
    pattern:
      /^(returning (?:a |cards )?from graveyard|return (?:target )?(?:card|cards|creature(?: card)?|nonland permanent)s? from graveyard|return from graveyard|return card from graveyard|return to battlefield|put (?:a |target )?(?:card|target card) from (?:a |your )?graveyard onto the battlefield|put a card from a graveyard onto the battlefield|effect '?return target card from graveyard to the battlefield)/i,
    cr: "CR 400.7 (zone-change rebind)",
    sketch:
      "New `ReturnFromZone` op with `from: 'graveyard'`, `to: 'battlefield'`, `target: 'card'`, plus an optional `filter` (e.g. `creature`, `mv<=X`). Shares its identity-rebind path with `ReturnToHand`.",
  },
  {
    capability: "search library",
    pattern: /^search (your )?library/i,
    cr: "CR 701.13 (search library)",
    sketch:
      "New `SearchLibrary` op: `amount: number`, `filter` (e.g. 'creature', 'land', 'cmc<=N'), `destination: 'hand' | 'battlefield' | 'graveyard'`, `shuffle: boolean` (default true). Library state is private (CR 401.5); result is the only thing the opponent sees.",
  },
  {
    capability: "flashback cost",
    pattern: /^flashback/i,
    cr: "CR 702.33 (flashback)",
    sketch:
      "Add `flashback: { mana }` to `CardScriptSchema`. Resolver checks the spell's source zone; if cast from graveyard, exile it instead of putting it there on resolution.",
  },
  {
    capability: "add mana",
    pattern:
      /^(add (?:one |an? )?mana|add mana of any|adding mana to mana pool|ability to add mana|ability to add mana|mana production|{t}:\s*add|add \{[wubrgc]\}|add mana to mana pool)/i,
    cr: "CR 106 (mana), 605 (mana abilities)",
    sketch:
      "New `AddMana` op: `amount`, `colors: ('W'|'U'|'B'|'R'|'G'|'C')[] | 'any'`, optional `restrict` (e.g. 'spend only on creatures'). The mana ability flag is automatic (CR 605.1).",
  },
  {
    capability: "shuffle library",
    pattern: /^shuffle/i,
    cr: "CR 701.20 (shuffling)",
    sketch:
      "New `ShuffleLibrary` op (`who: 'you' | 'target_player'`). Reusable whenever a search or put-back happens.",
  },
  {
    capability: "X-cost in triggered/activated effects",
    pattern: /^x (cost|costs)|x power dependency|dynamic x\b/i,
    cr: "CR 107.3, 601.2b (X already in spell-casting via #2552/#2553)",
    sketch:
      "Promote `X` from spell-casting into triggers/activations/statics. Schema: `amount: xAmount` (where `xAmount = z.union([amount, X])`) for `Pump`, `PutCounters`, `CreateToken`, `DealDamage` effect payloads on a trigger. Spell-level `X` is already in (#2487#2552/#2553).",
  },
  {
    capability: "kicker / optional additional cost",
    pattern: /^(kicker|kicked|kicker cost|additional cost|optional cost)/i,
    cr: "CR 702.32 (kicker), 601.2b (additional costs)",
    sketch:
      "Add `kicker: {mana, count?}` to `CardScriptSchema` (or a `costs.kicker` block). Effects after the spell can branch on `if_kicked: true|false`; the cast-time UI flips the cost when the player opts in.",
  },
  {
    capability: "indestructible keyword",
    pattern: /^indestructible|granting indestructible|gain indestructible/,
    cr: "CR 702.13 (indestructible), 701.9 (lose abilities removes it)",
    sketch:
      "Add `indestructible: true` to `StaticSchema.keywords` (alongside the existing evergreen keywords). Grant-from-effect: a new op `GrantKeyword { keyword, target, until }`. Aura pump block gets the same field.",
  },
  {
    capability: "ward keyword / ward cost",
    pattern: /^ward\b/i,
    cr: "CR 702.21 (ward)",
    sketch:
      "Add `ward: { cost }` to a future aura/permanent schema; the engine prompts the would-be caster for the ward cost before the spell resolves.",
  },
  // Lower-frequency rows (run after the high-frequency set).
  {
    capability: "aura enchantment",
    pattern:
      /^(aura enchantment|enchant(ment)? (?:creature|land|planeswalker|permanent)|enchant creature|enchant land|enchantment\s*[-—–]\s*aura)/i,
    cr: "CR 702.5 (Enchant), 303.4 (auras)",
    sketch:
      "New `Enchant` op with `target` ('creature' | 'land' | 'planeswalker' | 'permanent'), plus a static pumping the enchanted permanent (CR 604, layer 7c). Replaces the inline 'enchanted creature gets +2/+2' ad-hoc phrasing.",
  },
  {
    capability: "hexproof keyword (self, from-color, or conditional)",
    pattern: /^hexproof|^gain hexproof/i,
    cr: "CR 702.11 (hexproof), 702.11b/c (from-X)",
    sketch:
      "Add `hexproof` (and `hexproof_from: 'red' | 'black' | …`) to `TOKEN_KEYWORDS`/`StaticSchema.keywords`. For the 'until end of turn' variant: `GrantKeyword` op.",
  },
  {
    capability: "exile card from graveyard",
    pattern:
      /^exile (?:target )?card from graveyard|^exile from graveyard|^exile up to one target card from a graveyard|^exile target player's graveyard|^targeting cards in graveyards|^exile card from graveyard|^exile cards from graveyard/i,
    cr: "CR 701.18 (exile), 404 (graveyard zone)",
    sketch:
      "New `ExileFromZone` op: `from: 'graveyard' | 'library' | 'exile'`, `target: 'card' | 'cards'`, optional `filter`.",
  },
  {
    capability: "exile until this enchantment leaves the battlefield",
    pattern:
      /^exile until this (?:enchantment|creature) leaves?|exile until this enchantment leaves the battlefield/i,
    cr: "CR 303 (continuous enchantment), 701.18 (exile)",
    sketch:
      "Compound aura op: new `ExileUntilLeaves` op (`target`, `host`) on a card that also has an `Enchant`/`Equipment` host. The engine watches the host's zone-change and returns the exiled card (CR 400.7). The host itself is an Aura or a creature with an aura pump.",
  },
];

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\.$/, "");
}

/** Pull just the `## Missing ops` bullets from a draft report. */
interface DraftReport {
  set: string;
  reasonToCards: Map<string, string[]>;
}

function loadAll(): DraftReport[] {
  const files = fs
    .readdirSync(DRAFTS)
    .filter((f) => f.endsWith(".md"))
    .sort();
  const out: DraftReport[] = [];
  for (const f of files) {
    const raw = fs.readFileSync(path.join(DRAFTS, f), "utf8");
    const reasonToCards = new Map<string, string[]>();
    const lines = raw.split("\n");
    let inMissing = false;
    for (const line of lines) {
      if (line.startsWith("## Missing ops")) {
        inMissing = true;
        continue;
      }
      if (inMissing && line.startsWith("## ")) break;
      if (!inMissing) continue;
      const m = line.match(/^- (.+?):\s*(.*)$/);
      if (!m) continue;
      // Strip the "(N)" card-count marker that `tallyMissingOps` / the drafter
      // writes after the reason: "- aura enchantment (10): A, B, ...".
      const head = m[1].replace(/\s*\(\d+\)\s*$/, "").trim();
      const cards = m[2]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      reasonToCards.set(normalize(head), cards);
    }
    out.push({ set: path.basename(f, ".md"), reasonToCards });
  }
  return out;
}

function groupByCapability(reports: DraftReport[]): CapabilityRow[] {
  const byCapability = new Map<
    string,
    {
      cards: Set<string>;
      rawReasons: Set<string>;
      sketch?: string;
      cr?: string;
    }
  >();
  for (const { set, reasonToCards } of reports) {
    for (const [reason, cards] of reasonToCards) {
      // Each `reason` is already normalized: trimmed, lower-cased, trailing
      // dot stripped. Match against the head of the string so that a
      // capability word buried inside a longer paraphrase doesn't trigger
      // (e.g. "plainscycling (... shuffle)" should not bucket under shuffle).
      const capabilityHit = CAPABILITY_PATTERNS.find((c) =>
        c.pattern.test(reason),
      );
      if (!capabilityHit) continue;
      const row = byCapability.get(capabilityHit.capability) ?? {
        cards: new Set(),
        rawReasons: new Set(),
        sketch: capabilityHit.sketch,
        cr: capabilityHit.cr,
      };
      // Cards are comma-separated inside the LLM's reason line, but real
      // card names can contain a comma (e.g. "Alesha, Who Laughs at Fate").
      // We don't have Scryfall available here, so we record the full raw
      // reason string verbatim in `rawReasons` and only expose the card
      // list (which is best-effort split) in the top-10 summary as a hint,
      // not as authoritative provenance.
      for (const card of cards) row.cards.add(`${card} (${set})`);
      row.rawReasons.add(`${reason}  [${set}]`);
      byCapability.set(capabilityHit.capability, row);
    }
  }
  return [...byCapability.entries()]
    .map(([capability, { cards, rawReasons, sketch, cr }]) => ({
      capability,
      cards: [...cards],
      rawReasons: [...rawReasons],
      sketch,
      cr,
    }))
    .sort(
      (a, b) =>
        b.cards.length - a.cards.length ||
        a.capability.localeCompare(b.capability),
    );
}

function render(rows: CapabilityRow[], reports: DraftReport[]): string {
  const date = new Date().toISOString().slice(0, 10);

  const top = rows.slice(0, 10);
  const lines: string[] = [];
  lines.push("# Card script op frontier (epic #2487, phase 4)");
  lines.push("");
  lines.push(
    `Generated: ${date}. Aggregates \`needs_new_op\` reasons from \`docs/card-scripts/drafts/{${reports.map((r) => r.set).join(",")}}.md\` and groups them into capabilities ranked by the number of distinct cards each one unlocks.`,
  );
  lines.push("");
  lines.push("## Inputs");
  lines.push("");
  lines.push("| Set | Cards needing new ops |");
  lines.push("| --- | --- |");
  for (const r of reports) {
    const total = [...r.reasonToCards.values()].reduce(
      (n, cs) => n + cs.length,
      0,
    );
    lines.push(`| ${r.set} | ${total} |`);
  }
  lines.push("");
  lines.push(
    'The LLM produces one bullet per *reason*. Multiple reasons collapse to the same capability below (e.g. "aura enchantment", "enchant creature", and "enchantment - aura" are all the same row).',
  );
  lines.push("");
  lines.push("## Top 10 ops by card-unlock count");
  lines.push("");
  top.forEach((row, idx) => {
    lines.push(`### ${idx + 1}. ${row.capability} (${row.cards.length} cards)`);
    lines.push("");
    if (row.cr) lines.push(`- **CR**: ${row.cr}`);
    lines.push(
      `- **All paraphrases**: ${row.rawReasons.length} (see raw-reason mapping)`,
    );
    // The "first 5 cards" hint is best-effort: the LLM dumps card names
    // comma-separated, but card names can themselves contain a comma.
    // The full list per set is in the raw-reason mapping below.
    lines.push(
      `- **Sample of unlocked cards** (first 5 best-effort, see mapping for the full list): ${row.cards.slice(0, 5).join(", ")}`,
    );
    if (row.sketch) {
      lines.push("");
      lines.push(`**Design sketch**: ${row.sketch}`);
    }
    lines.push("");
  });
  lines.push("## Capability → raw-reason mapping (for traceability)");
  lines.push("");
  for (const row of rows) {
    lines.push(`- **${row.capability}** (${row.cards.length} cards)`);
    for (const r of row.rawReasons) {
      lines.push(`  - ${r}`);
    }
  }
  lines.push("");
  lines.push("## Deferred (set-specific, not Standard post-rotation)");
  lines.push("");
  lines.push(
    "- BLB `gift` (4 cards) and `valiant` (3 cards) — Bloomburrow block rotates out of Standard 2027-Q4; draft now if FDN-replacement sets need them.",
  );
  lines.push(
    "- MKM `disguise` (4 cards) — Murders at Karlov Manor rotates 2027-Q4.",
  );
  lines.push(
    "- MKM `suspect` (2 cards) — Murders-specific; no Standard card cares about it after rotation.",
  );
  lines.push("");
  lines.push(
    "Re-run with `npx tsx scripts/build-op-frontier.ts` after any new draft report lands.",
  );
  lines.push("");
  return lines.join("\n");
}

function main(): void {
  const reports = loadAll();
  if (reports.length === 0) {
    throw new Error(`no draft reports in ${DRAFTS}`);
  }
  const rows = groupByCapability(reports);
  const md = render(rows, reports);
  fs.writeFileSync(OUT, md);
  const top10 = rows.slice(0, 10);
  console.error(
    `wrote ${path.relative(REPO, OUT)} — top 10 capabilities by card-unlock count:`,
  );
  for (const [i, row] of top10.entries()) {
    console.error(`  ${i + 1}. ${row.capability} — ${row.cards.length} cards`);
  }
}

main();
