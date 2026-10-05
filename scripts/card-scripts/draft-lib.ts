/**
 * Card-script drafting pipeline (#2491): the pure parts, kept free of I/O so
 * they can be unit tested. scripts/draft-card-scripts.ts is the CLI.
 *
 * An LLM drafts a JSON card script from oracle text; every draft is checked
 * against the zod schema before it is written, effects the schema can't
 * express come back as "needs new op", and drafts land as a PR for review.
 *
 * Never prompt with or train on Forge scripts (Forge is GPL-3.0, this repo is
 * MIT). Few-shot examples come only from this repo's own scripts, and
 * assertNoForgeContent guards every prompt.
 */
import {
  CardScriptSchema,
  EffectSchema,
  type CardScript,
} from "../../src/lib/game-state/card-scripts/schema";

/** The Scryfall fields the pipeline reads. */
export interface DraftCard {
  name: string;
  oracle_text?: string;
  type_line: string;
  layout: string;
  keywords?: string[];
}

export type DraftOutcome =
  | { kind: "drafted"; name: string; script: CardScript }
  | { kind: "needs_new_op"; name: string; missing: string[] }
  | { kind: "invalid"; name: string; errors: string[] }
  | { kind: "skipped"; name: string; reason: string };

/**
 * Human-readable reference for every op the schema accepts. A test checks it
 * covers EffectSchema exactly, so a new op can't ship undocumented to the LLM.
 */
export const OP_REFERENCE: Record<string, string> = {
  DealDamage:
    '{"op":"DealDamage","amount":N,"target":"any"|"creature"|"player"|"each_opponent"}',
  Draw: '{"op":"Draw","amount":N,"who":"you"|"target_player"}',
  GainLife: '{"op":"GainLife","amount":N,"who":"you"|"target_player"}',
  LoseLife:
    '{"op":"LoseLife","amount":N,"who":"you"|"target_player"|"each_opponent"}',
  CreateToken:
    '{"op":"CreateToken","count":N,"power":N,"toughness":N,"color":"white"|"blue"|"black"|"red"|"green"|"colorless" OR "colors":["white","black"],"subtypes":["Thopter"],"artifact":true,"keywords":["flying"]} (creature tokens; exactly one of color/colors; artifact and keywords optional; evergreen keywords only; no enchantment tokens or token abilities)',
  Destroy: '{"op":"Destroy","target":"creature"}',
  Exile: '{"op":"Exile","target":"creature"}',
  Counter: '{"op":"Counter","target":"spell"}',
  Pump: '{"op":"Pump","power":N,"toughness":N,"target":"creature"|"self"} (until end of turn)',
  PutCounters:
    '{"op":"PutCounters","counter":"+1/+1","amount":N,"target":"creature"|"self"}',
  Surveil: '{"op":"Surveil","amount":N}',
  CopySpell:
    '{"op":"CopySpell","gain":["wither"]} (cast triggers only: copy the spell that was cast, same targets; gain optional)',
};

export function documentedOps(): string[] {
  return Object.keys(OP_REFERENCE).sort();
}

export function schemaOps(): string[] {
  return EffectSchema.options
    .map((o) => (o.shape.op as { value: string }).value)
    .sort();
}

const FORGE_MARKERS = [
  /^(A|T|S|K|SVar|Oracle|ManaCost|Types|PT):/m,
  /\b(AB|SP|DB|Mode|ValidTgts|NumDmg|SubAbility)\$/,
];

/** Throws if text looks like Forge card-script syntax. */
export function assertNoForgeContent(text: string): void {
  for (const re of FORGE_MARKERS) {
    if (re.test(text)) {
      throw new Error(
        "prompt contains Forge card-script syntax; Forge scripts must never be used (GPL-3.0)",
      );
    }
  }
}

const isSpellType = (typeLine: string) =>
  /\b(Instant|Sorcery)\b/.test(typeLine);

/** Oracle text minus reminder text and lines that are only keywords. */
export function abilityText(card: DraftCard): string {
  const keywords = new Set((card.keywords ?? []).map((k) => k.toLowerCase()));
  return (card.oracle_text ?? "")
    .replace(/\([^)]*\)/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => {
      if (!l) return false;
      const parts = l.split(/,\s*/).map((p) => p.toLowerCase());
      return !parts.every((p) => keywords.has(p));
    })
    .join("\n");
}

/** Why a card shouldn't be drafted, or null when it should. */
export function skipReason(
  card: DraftCard,
  alreadyScripted: ReadonlySet<string>,
): string | null {
  if (alreadyScripted.has(card.name.toLowerCase())) return "already scripted";
  if (card.layout !== "normal")
    return `layout ${card.layout} not supported yet`;
  if (/\b(Land|Planeswalker|Battle)\b/.test(card.type_line)) {
    return "card type not supported yet";
  }
  if (!abilityText(card)) return "no abilities beyond keywords";
  return null;
}

const SCHEMA_RULES = `You write JSON card scripts for an MTG rules engine. Reply with ONE JSON object and nothing else.

Either
  {"script": {"name": ..., "oracle": ..., <abilities>}}
or, when ANY part of the card's abilities can't be expressed exactly with the fields and ops below,
  {"needs_new_op": ["short description of each missing effect"]}

Never approximate, drop, or simplify an ability. A partial script is wrong: the engine takes a scripted card's abilities only from its script. Use only the fields shown here (no "type_line", "mana_cost" or other keys).

Abilities:
- Instants and sorceries: "spell": [effects], applied in order. Targeted effects use the spell's targets in order.
- Permanents use any of "triggers", "activated" and "statics", each the full list of that kind.
- Triggers: {"text": <ability sentence as printed>, "event": ..., "effects": [...]} plus the fields for that event:
  - "etb" (enters the battlefield), "dies", "attacks": "subject": "self" (this permanent, the default) | "another" | "any" (creatures), and with another/any an optional "controller": "you" | "opponent". "attacks" also takes "once": true for "whenever you attack" (once per combat, not per attacker).
  - "landfall": a land you control enters. No other fields.
  - "upkeep": at the beginning of an upkeep. "whose": "you" | "each" | "opponent".
  - "cast": whenever a spell is cast. "caster": "you" (default) | "opponent" | "any"; "spell": "any" | "creature" | "noncreature" | "instant_or_sorcery" | "artifact" | "enchantment" | "multicolored"; "targets": "single" for "a spell with a single target".
- Activated: {"text": <the part after the colon>, "cost": {"mana": "{1}{B}", "tap": true, "sacrifice": true}, "effects": [...]}. "mana" holds only generic, colored or {C} mana symbols; {T} goes in "tap"; leave "mana" out when the cost has none. Add "limit": "once" | "once_per_turn" for "Activate only once" / "Activate only once each turn", and "timing": "sorcery" for "Activate only as a sorcery".
- Statics: {"text": <the line>, "affects": {"controller": "you" | "opponents", "other": true, "subtype": "Dinosaur"}, "power": N, "toughness": N, "keywords": ["haste"]} for creatures getting +N/+N and/or gaining evergreen keywords. "other" and "subtype" are optional; set power and toughness together.
- Keywords printed on the card itself (flying, flash, prowess, ward, deathtouch, ...) need nothing: the engine reads them from the card. Script the card's other abilities only.

Still needs new ops: X costs, hybrid or Phyrexian mana in an activation cost, other costs (discard, pay life, tap or sacrifice other permanents, remove counters), modes ("choose one"), conditions ("if", "as long as", "unless"), static effects other than P/T and keywords, and any effect not listed.

Ops:
`;

/**
 * Keys models echo back from the card or the prompt that aren't script
 * fields. Dropping them is safe: name and oracle are pinned from the card.
 */
const ECHO_KEYS = ["type_line", "mana_cost", "type", "types", "cmc"];
/** Trigger events whose "subject" the engine ignores. */
const NO_SUBJECT_EVENTS = new Set(["landfall", "upkeep", "cast"]);

/**
 * Mechanical clean-up before schema validation: drops echoed card fields,
 * moves a {T} written into the mana cost to "tap", drops an empty mana cost,
 * and drops "subject" on events that ignore it. Never changes an effect.
 */
export function normalizeDraft(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw };
  for (const k of ECHO_KEYS) delete out[k];
  if (Array.isArray(out.activated)) {
    out.activated = out.activated.map((a) => {
      if (!a || typeof a !== "object") return a;
      const ability = { ...(a as Record<string, unknown>) };
      const cost = ability.cost;
      if (cost && typeof cost === "object") {
        const c = { ...(cost as Record<string, unknown>) };
        if (typeof c.mana === "string") {
          let mana = c.mana.replace(/\s+/g, "");
          if (/\{T\}/i.test(mana)) {
            mana = mana.replace(/\{T\}/gi, "");
            c.tap = true;
          }
          if (mana) c.mana = mana.toUpperCase();
          else delete c.mana;
        }
        ability.cost = c;
      }
      return ability;
    });
  }
  if (Array.isArray(out.triggers)) {
    out.triggers = out.triggers.map((t) => {
      if (!t || typeof t !== "object") return t;
      const trig = { ...(t as Record<string, unknown>) };
      if (NO_SUBJECT_EVENTS.has(String(trig.event))) delete trig.subject;
      return trig;
    });
  }
  return out;
}

/** The full prompt for one card. Examples must be this repo's own scripts. */
export function buildPrompt(
  card: DraftCard,
  examples: readonly CardScript[],
): string {
  const ops = Object.values(OP_REFERENCE)
    .map((o) => `- ${o}`)
    .join("\n");
  const shots = examples.map((e) => JSON.stringify({ script: e })).join("\n");
  const prompt = `${SCHEMA_RULES}${ops}

Examples:
${shots}

Card:
${JSON.stringify({ name: card.name, type_line: card.type_line, oracle: card.oracle_text ?? "" })}`;
  assertNoForgeContent(prompt);
  return prompt;
}

/** Pulls the first JSON object out of a model reply (tolerates code fences). */
export function extractJson(reply: string): unknown {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in reply");
  return JSON.parse(reply.slice(start, end + 1));
}

/**
 * Turns a model reply into an outcome. The card's own name and oracle text
 * always win over whatever the model echoed back.
 */
export function judgeReply(card: DraftCard, reply: string): DraftOutcome {
  let parsed: unknown;
  try {
    parsed = extractJson(reply);
  } catch (e) {
    return { kind: "invalid", name: card.name, errors: [(e as Error).message] };
  }
  const obj = (parsed ?? {}) as Record<string, unknown>;
  if (Array.isArray(obj.needs_new_op)) {
    const missing = obj.needs_new_op.map(String).filter(Boolean);
    return {
      kind: "needs_new_op",
      name: card.name,
      missing: missing.length ? missing : ["unspecified"],
    };
  }
  if (!obj.script || typeof obj.script !== "object") {
    return {
      kind: "invalid",
      name: card.name,
      errors: ['reply has neither "script" nor "needs_new_op"'],
    };
  }
  const candidate = {
    ...normalizeDraft(obj.script as Record<string, unknown>),
    name: card.name,
    oracle: card.oracle_text ?? "",
  };
  const result = CardScriptSchema.safeParse(candidate);
  if (!result.success) {
    return {
      kind: "invalid",
      name: card.name,
      errors: result.error.issues.map(
        (i) => `${i.path.join(".") || "(root)"}: ${i.message}`,
      ),
    };
  }
  const script = result.data;
  const spell = isSpellType(card.type_line);
  if (spell && !script.spell) {
    return {
      kind: "invalid",
      name: card.name,
      errors: ["instant or sorcery scripted without spell effects"],
    };
  }
  if (!spell && script.spell) {
    return {
      kind: "invalid",
      name: card.name,
      errors: ["permanent scripted with spell effects"],
    };
  }
  return { kind: "drafted", name: card.name, script };
}

/** File name a script is written under (matches the hand-written ones). */
export function scriptFileName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") + ".json"
  );
}

/** Groups needs-new-op descriptions so the most common gaps sort first. */
export function tallyMissingOps(
  outcomes: readonly DraftOutcome[],
): Array<{ missing: string; cards: string[] }> {
  const by = new Map<string, string[]>();
  for (const o of outcomes) {
    if (o.kind !== "needs_new_op") continue;
    for (const m of o.missing) {
      const key = m.trim().toLowerCase().replace(/\.$/, "");
      by.set(key, [...(by.get(key) ?? []), o.name]);
    }
  }
  return [...by.entries()]
    .map(([missing, cards]) => ({ missing, cards }))
    .sort(
      (a, b) =>
        b.cards.length - a.cards.length || a.missing.localeCompare(b.missing),
    );
}

/** Markdown report: the PR body and docs/card-scripts/drafts/<set>.md. */
export function renderReport(
  title: string,
  outcomes: readonly DraftOutcome[],
): string {
  const of = <K extends DraftOutcome["kind"]>(k: K) =>
    outcomes.filter(
      (o): o is Extract<DraftOutcome, { kind: K }> => o.kind === k,
    );
  const drafted = of("drafted");
  const needs = of("needs_new_op");
  const invalid = of("invalid");
  const skipped = of("skipped");
  const lines = [
    `# Card script drafts: ${title}`,
    "",
    `${drafted.length} drafted, ${needs.length} need new ops, ${invalid.length} failed the schema, ${skipped.length} skipped.`,
    "",
    "Every draft is LLM-written and must be checked against the card before merge.",
    "",
    "## Drafted",
    "",
    ...(drafted.length ? drafted.map((o) => `- ${o.name}`) : ["None."]),
    "",
    "## Missing ops",
    "",
  ];
  const tally = tallyMissingOps(outcomes);
  lines.push(
    ...(tally.length
      ? tally.map(
          (t) => `- ${t.missing} (${t.cards.length}): ${t.cards.join(", ")}`,
        )
      : ["None."]),
    "",
    "## Failed the schema (not written)",
    "",
    ...(invalid.length
      ? invalid.map((o) => `- ${o.name}: ${o.errors.join("; ")}`)
      : ["None."]),
    "",
    "## Skipped",
    "",
  );
  const reasons = new Map<string, number>();
  for (const s of skipped)
    reasons.set(s.reason, (reasons.get(s.reason) ?? 0) + 1);
  lines.push(
    ...(reasons.size
      ? [...reasons.entries()].map(([r, n]) => `- ${r}: ${n}`)
      : ["None."]),
    "",
  );
  return lines.join("\n");
}
