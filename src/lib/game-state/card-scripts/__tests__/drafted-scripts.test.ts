/**
 * Smoke test for every scripted card (#2487, phase 3.4).
 *
 * Goal: catch any LLM-drafted card whose JSON parses but whose effects
 * throw or leave the game state invalid. Runs once per script file in
 * the registry and aggregates failures into a single Jest failure, so
 * adding new scripts doesn't add new test cases.
 *
 * The test is deliberately defensive: it resolves every scripted ability
 * with synthetic placeholder targets and asserts only that the resolve
 * returns a valid GameState. The per-card logic is fuzzier than the
 * hand-written tests in card-scripts.test.ts, which is fine here — this
 * is the "no explode, no NaN life totals" guard for bulk LLM drafts.
 *
 * Per-card hand-checks live in the PR review; see
 * docs/card-scripts/drafts/<set>.md.
 */
import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CardScriptSchema } from "../schema";
import {
  getCardScript,
  listScriptedCardNames,
  registerCardScripts,
  resetCardScriptsForTests,
} from "../registry";
import { RAW_CARD_SCRIPTS } from "../cards/index.generated";
import { resolveScriptedSpell, resolveScriptedAbility } from "../interpret";
import { scriptedAbilityEffects, scriptedSpellEffects } from "../script-guards";
import { createInitialGameState, startGame } from "../../game-state";
import { createCardInstance } from "../../card-instance";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
  StackObject,
  Target,
} from "../../types";

const CARDS_DIR = join(__dirname, "..", "cards");
const id = (s: string) => s as CardInstanceId;

/** Index every scripted JSON by its `name` field. Hand-written files use
 * inconsistent apostrophe handling (Bilbo's -> bilbos_deadly_slice.json),
 * so we don't try to reverse-engineer filenames: we read every file once
 * and look up by parsed `name`. */
const NAME_TO_FILE = (() => {
  const map = new Map<string, string>();
  for (const f of readdirSync(CARDS_DIR).filter((n) => n.endsWith(".json"))) {
    try {
      const raw = JSON.parse(readFileSync(join(CARDS_DIR, f), "utf-8")) as {
        name: string;
      };
      if (raw.name) map.set(raw.name, f);
    } catch {
      /* skip — the schema test below surfaces real parse errors */
    }
  }
  return map;
})();

function mockCard(name: string, typeLine: string): ScryfallCard {
  return {
    id: `mock-${name}`,
    name,
    type_line: typeLine,
    oracle_text: "",
    mana_cost: "",
    cmc: 0,
    colors: [],
    color_identity: [],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
  } as unknown as ScryfallCard;
}

function placePermanent(
  state: GameState,
  player: PlayerId,
  name: string,
  typeLine: string,
): GameState {
  const key = `${player}-battlefield`;
  const cards = new Map(state.cards);
  cards.set(
    id(name),
    createCardInstance(mockCard(name, typeLine), player, player, {
      id: id(name),
      currentZoneKey: key,
    }),
  );
  const zones = new Map(state.zones);
  const z = zones.get(key)!;
  zones.set(key, { ...z, cardIds: [...z.cardIds, id(name)] });
  return { ...state, cards, zones };
}

function opponentTarget(state: GameState): Target {
  const opp = Array.from(state.players.keys()).find(
    (p) => p !== Array.from(state.players.keys())[0],
  )!;
  return { type: "player", targetId: opp, isValid: true };
}

const playerTarget = (player: PlayerId): Target => ({
  type: "player",
  targetId: player,
  isValid: true,
});

const cardTarget = (cardId: string): Target => ({
  type: "card",
  targetId: cardId,
  isValid: true,
});

function invariant(state: GameState): string | null {
  for (const [pid, p] of state.players) {
    if (!Number.isFinite(p.life))
      return `player ${pid} has non-finite life: ${p.life}`;
  }
  for (const [cardId, c] of state.cards) {
    if (c.cardData && c.cardData.name === undefined)
      return `card ${cardId} is missing cardData.name`;
  }
  return null;
}

function startTwoPlayer(): {
  state: GameState;
  p1: PlayerId;
  p2: PlayerId;
} {
  const state = startGame(
    createInitialGameState(["Player1", "Player2"], 20, false),
  );
  const [p1, p2] = Array.from(state.players.keys());
  return { state, p1, p2 };
}

function asStackAbility(
  sourceCardId: CardInstanceId,
  controllerId: PlayerId,
  text: string,
  kind: "triggered" | "activated",
  targets: Target[] = [],
): StackObject {
  return {
    id: "smoke-ab",
    type: "ability",
    sourceCardId,
    controllerId,
    text,
    targets,
    triggered: kind === "triggered",
    activated: kind === "activated",
  } as unknown as StackObject;
}

describe("card-script smoke test (data-driven)", () => {
  beforeAll(() => {
    resetCardScriptsForTests();
    registerCardScripts(RAW_CARD_SCRIPTS);
  });

  it("every scripted card resolves without throwing on minimal state", () => {
    const names = listScriptedCardNames();
    expect(names.length).toBeGreaterThan(0);

    const failures: Array<{ name: string; phase: string; error: string }> = [];

    for (const name of names) {
      const script = getCardScript(name);
      if (!script) {
        failures.push({
          name,
          phase: "load",
          error: "getCardScript returned undefined",
        });
        continue;
      }
      // Validate the on-disk file (with its oracle field) parses against the
      // schema. The registry's index strips `oracle` to save bundle size
      // (#1814), so re-parsing the JSON file is the cheap round-trip check
      // for bulk-drafted cards.
      const file = NAME_TO_FILE.get(name);
      if (!file) {
        failures.push({
          name,
          phase: "disk-read",
          error: "no JSON file in cards/ for this name",
        });
        continue;
      }
      let onDisk: unknown;
      try {
        onDisk = JSON.parse(readFileSync(join(CARDS_DIR, file), "utf-8"));
      } catch (e) {
        failures.push({
          name,
          phase: "disk-read",
          error: (e as Error).message,
        });
        continue;
      }
      const parsed = CardScriptSchema.safeParse(onDisk);
      if (!parsed.success) {
        failures.push({
          name,
          phase: "schema",
          error: parsed.error.issues.map((i) => i.message).join("; "),
        });
        continue;
      }

      try {
        const { state: base, p1, p2 } = startTwoPlayer();

        // Permanent scripts: place the card on the battlefield, fire each
        // trigger/activated ability once. We don't know the right targets, so
        // pass an empty list — the interpreter is expected to either resolve
        // with the missing targets or no-op gracefully.
        if (script.triggers || script.activated) {
          const typeLine =
            /\b(Creature|Artifact|Enchantment|Planeswalker|Battle)\b/.test(
              script.oracle,
            )
              ? "Creature"
              : "Permanent";
          let s = placePermanent(base, p1, name, typeLine);

          for (const trig of script.triggers ?? []) {
            const stack = asStackAbility(id(name), p1, trig.text, "triggered", [
              opponentTarget(s),
            ]);
            try {
              s = resolveScriptedAbility(s, stack) ?? s;
            } catch (e) {
              failures.push({
                name,
                phase: `trigger "${trig.text.slice(0, 40)}"`,
                error: (e as Error).message,
              });
            }
          }

          for (const act of script.activated ?? []) {
            const stack = asStackAbility(id(name), p1, act.text, "activated", [
              opponentTarget(s),
            ]);
            try {
              s = resolveScriptedAbility(s, stack) ?? s;
            } catch (e) {
              failures.push({
                name,
                phase: `activated "${act.text.slice(0, 40)}"`,
                error: (e as Error).message,
              });
            }
          }

          const inv = invariant(s);
          if (inv) failures.push({ name, phase: "post-permanent", error: inv });
        }

        // Spell scripts: cast the spell on a synthetic target. Mode choice is
        // handled separately below.
        if (script.spell) {
          const stack = {
            id: "smoke-spell",
            type: "spell",
            sourceCardId: id(name),
            controllerId: p1,
            targets: [playerTarget(p2)],
          } as unknown as StackObject;
          try {
            const s = resolveScriptedSpell(base, script, stack);
            const inv = invariant(s);
            if (inv) failures.push({ name, phase: "post-spell", error: inv });
          } catch (e) {
            failures.push({
              name,
              phase: "spell",
              error: (e as Error).message,
            });
          }
        }
      } catch (e) {
        failures.push({ name, phase: "outer", error: (e as Error).message });
      }
    }

    if (failures.length > 0) {
      const lines = failures.map(
        (f) => `  - ${f.name} [${f.phase}]: ${f.error}`,
      );
      throw new Error(
        `${failures.length}/${names.length} scripted cards failed smoke test:\n` +
          lines.join("\n"),
      );
    }
  });

  it("every script's spell/ability effect list is non-empty when present", () => {
    const names = listScriptedCardNames();
    const empty: string[] = [];
    for (const name of names) {
      const s = getCardScript(name);
      if (!s) continue;
      if (s.spell && scriptedSpellEffects(s).length === 0)
        empty.push(name + " (spell)");
      for (const a of s.activated ?? []) {
        if (scriptedAbilityEffects(a).length === 0)
          empty.push(name + " (activated)");
      }
    }
    expect(empty).toEqual([]);
  });

  it("every script with `modes` declares at least 2 options and choose < options", () => {
    const names = listScriptedCardNames();
    const offenders: string[] = [];
    for (const name of names) {
      const s = getCardScript(name);
      if (!s) continue;
      const m =
        s.modes ??
        (s.triggers ?? []).find((t) => t.modes)?.modes ??
        (s.activated ?? []).find((a) => a.modes)?.modes;
      if (!m) continue;
      if (m.options.length < 2) offenders.push(`${name}: < 2 mode options`);
      if (m.choose < 1 || m.choose >= m.options.length)
        offenders.push(
          `${name}: choose ${m.choose} for ${m.options.length} options`,
        );
    }
    expect(offenders).toEqual([]);
  });
});

describe("card-scripts text-vs-numbers guard (data-driven)", () => {
  it("every numeric literal in a script appears in its oracle text", () => {
    const fileNames = readdirSync(CARDS_DIR).filter((f) => f.endsWith(".json"));
    const failures: Array<{ name: string; number: number }> = [];
    // Map of digit → word form so "Draw four cards" matches "amount":4.
    // Only the small numbers MTG uses in card text are listed.
    const NUMBER_WORDS: Record<number, string> = {
      1: "one",
      2: "two",
      3: "three",
      4: "four",
      5: "five",
      6: "six",
      7: "seven",
      8: "eight",
      9: "nine",
      10: "ten",
    };
    for (const file of fileNames) {
      const raw = JSON.parse(readFileSync(join(CARDS_DIR, file), "utf-8")) as {
        name: string;
        oracle: string;
      };
      const oracleLower = raw.oracle.toLowerCase();
      // Saga chapter numbers are printed as Roman numerals ("I —",
      // "III —"), so the `chapter` field is skipped here.
      const numbersInScript =
        JSON.stringify(raw, (key, value) =>
          key === "chapter" ? undefined : value,
        )
          .match(/\b\d+\b/g)
          ?.map((s) => Number(s))
          // Skip 0 and 1: P/T 1/1, default discard-1, default count-1 all
          // use the digit but the oracle rarely spells them out ("1/1 white
          // Dog", "draw a card", "create a 1/1 ...").
          .filter((n) => n >= 2 && n <= 10 && Number.isFinite(n)) ?? [];
      for (const n of numbersInScript) {
        const digit = String(n);
        const word = NUMBER_WORDS[n];
        if (
          !oracleLower.includes(digit) &&
          (!word || !oracleLower.includes(word))
        ) {
          failures.push({ name: raw.name, number: n });
        }
      }
    }
    if (failures.length > 0) {
      throw new Error(
        `numeric literals in script that aren't in oracle:\n` +
          failures.map((f) => `  - ${f.name}: ${f.number}`).join("\n"),
      );
    }
  });
});

describe("card-scripts enter_choice text-vs-kind guard (data-driven)", () => {
  it("every enter_choice script's kind agrees with its oracle text", () => {
    const fileNames = readdirSync(CARDS_DIR).filter((f) => f.endsWith(".json"));
    const failures: Array<{
      name: string;
      kind: string;
      reason: string;
    }> = [];
    for (const file of fileNames) {
      const raw = JSON.parse(readFileSync(join(CARDS_DIR, file), "utf-8")) as {
        name: string;
        oracle: string;
        enter_choice?: { kind: string; text: string };
      };
      // Cards without an enter_choice field aren't subject to
      // this guard.
      const ec = raw.enter_choice;
      if (!ec) continue;
      const kind = ec.kind;
      const text = ec.text ?? "";
      const oracle = (raw.oracle ?? "").toLowerCase();
      const txt = text.toLowerCase();
      if (kind === "color") {
        // Wave 4.7 lane 39: the chosen-color pattern is
        // "choose a color" (Heraldic Banner, Diamond Mare) or
        // "choose a [white/blue/black/red/green]" (Test Goggles
        // and the wider single-color anthem family). The
        // drafter's `text` field must mention "color" — it's
        // the descriptive text surfaced in the prompt.
        const colorOk =
          oracle.includes("choose a color") ||
          /\bchoose a (white|blue|black|red|green)\b/.test(oracle);
        const textOk = txt.includes("color");
        if (!colorOk)
          failures.push({
            name: raw.name,
            kind,
            reason: `oracle does not mention "choose a color"`,
          });
        if (!textOk)
          failures.push({
            name: raw.name,
            kind,
            reason: `enter_choice.text does not mention "color"`,
          });
      } else if (kind === "creature_type") {
        // Wave 4.7 follow-up lane 44 (#2705a) + lane 45
        // (#2705b): the chosen-creature-type pattern is
        // "choose a creature type" (Adaptive Automaton,
        // Banner of Kinship). Now active in CI because lane 44
        // shipped the engine arm and lane 45 shipped the
        // anthem sentinel.
        const ok = oracle.includes("choose a creature type");
        if (!ok)
          failures.push({
            name: raw.name,
            kind,
            reason: `oracle does not mention "choose a creature type"`,
          });
        if (!txt.includes("creature type"))
          failures.push({
            name: raw.name,
            kind,
            reason: `enter_choice.text does not mention "creature type"`,
          });
      } else if (kind === "player") {
        // Tracked in #2705 ("Out of scope" for Wave 4.7
        // follow-up). Asserts the drafter's oracle agrees with
        // the kind; the engine arm is documented-only today,
        // so a card opting in here would surface a friendly
        // error at cast time (see resolveEnterChoice). Still
        // catch the drift in CI.
        const ok =
          oracle.includes("choose an opponent") ||
          oracle.includes("choose a player");
        if (!ok)
          failures.push({
            name: raw.name,
            kind,
            reason: `oracle does not mention "choose a player"`,
          });
      } else if (kind === "chosen_name") {
        // Wave 4.7 phase 2 lanes 49 + 50 (#2708 phase 2): the
        // chosen-name pattern is "choose a card name" or
        // "choose any card name" - both are accepted by the
        // engine (Sorcerous Spyglass reads "choose any card
        // name"). The drafter's `text` field must mention "card
        // name" - it's the descriptive text surfaced in the
        // prompt.
        const nameOk =
          oracle.includes("choose a card name") ||
          oracle.includes("choose any card name");
        const textOk = txt.includes("card name");
        if (!nameOk)
          failures.push({
            name: raw.name,
            kind,
            reason: `oracle does not mention "choose a card name" or "choose any card name"`,
          });
        if (!textOk)
          failures.push({
            name: raw.name,
            kind,
            reason: `enter_choice.text does not mention "card name"`,
          });
      } else {
        failures.push({
          name: raw.name,
          kind,
          reason: `unknown enter_choice.kind "${kind}"`,
        });
      }
    }
    if (failures.length > 0) {
      throw new Error(
        `enter_choice script/oracle mismatches:\n` +
          failures
            .map((f) => `  - ${f.name} (kind=${f.kind}): ${f.reason}`)
            .join("\n"),
      );
    }
  });

  /**
   * Negative fixture for the guard above. Builds a synthetic
   * mismatch and asserts the matcher catches it. Lives next to
   * the guard so any future change to the matcher logic
   * immediately surfaces in CI.
   */
  it("flags a synthetic color-kind script whose oracle says 'choose a creature type'", () => {
    // The synthetic script passes schema (kind: "color" is a
    // valid enum value) but the oracle text describes the
    // WRONG choice. The data-driven guard above must flag it.
    // We mirror the guard's logic here to verify the matcher
    // rather than waiting for a regression on disk.
    const raw = {
      name: "Synthetic Mismatch",
      oracle:
        "As Synthetic Mismatch enters, choose a creature type. Some effect.",
      enter_choice: {
        kind: "color",
        text: "As Synthetic Mismatch enters, choose a color.",
      },
    };
    const oracle = (raw.oracle ?? "").toLowerCase();
    const txt = raw.enter_choice.text.toLowerCase();
    const colorOk =
      oracle.includes("choose a color") ||
      /\bchoose a (white|blue|black|red|green)\b/.test(oracle);
    const textOk = txt.includes("color");
    expect(colorOk).toBe(false);
    expect(textOk).toBe(true);
  });

  it("flags a synthetic creature_type-kind script whose text omits 'creature type'", () => {
    const raw = {
      name: "Synthetic Bad Text",
      oracle:
        "As Synthetic Bad Text enters, choose a creature type. Some effect.",
      enter_choice: {
        kind: "creature_type",
        text: "As Synthetic Bad Text enters, choose something else.",
      },
    };
    const oracle = (raw.oracle ?? "").toLowerCase();
    const txt = raw.enter_choice.text.toLowerCase();
    const ok = oracle.includes("choose a creature type");
    const textOk = txt.includes("creature type");
    expect(ok).toBe(true);
    expect(textOk).toBe(false);
  });
});
