import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface Assertion {
  path: string;
  operator: string;
  value: unknown;
}

interface Fixture {
  description: string;
  category: string;
  setup: {
    playerNames: string[];
    startingLife: number;
    isCommander: boolean;
    actions?: string[];
  };
  assertions: Assertion[];
}

const FIXTURES_DIR = path.resolve(__dirname, "fixtures");
const OUTPUT_DIR = path.resolve(__dirname, "__tests__");

const ACCESSOR_MAP: Record<string, string> = {
  "players.size": "playerCount(state)",
  "cards.size": "state.cards.size",
  "zones.size": "state.zones.size",
  "stack.length": "state.stack.length",
  "winners.length": "state.winners.length",
  "combat.inCombatPhase": "state.combat.inCombatPhase",
  "combat.attackers.length": "state.combat.attackers.length",
  "combat.attackers[0].damageToDeal": "state.combat.attackers[0]?.damageToDeal ?? 0",
  "combat.remainingCombatPhases": "state.combat.remainingCombatPhases",
  "status": "state.status",
  "format": "state.format",
  "turn.turnNumber": "state.turn.turnNumber",
  "turn.currentPhase": "state.turn.currentPhase",
  "turn.isFirstTurn": "state.turn.isFirstTurn",
  "priorityPlayerId": "state.priorityPlayerId",
  "consecutivePasses": "state.consecutivePasses",
  "serializationRoundtrip": "null",
};

const MANA_COLORS = ["white", "red", "blue", "black", "green", "colorless"] as const;
const SIMPLE_PLAYER_FIELDS = [
  "poisonCounters", "life", "landsPlayedThisTurn", "maxLandsPerTurn",
  "hasLost", "hasPassedPriority", "experienceCounters", "commanderCastCount",
] as const;

function pascalCase(str: string): string {
  return str
    .split(/[-_]/)
    .map((s: string) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");
}

function escapeForTemplate(str: string): string {
  return str.replace(/'/g, "\\'").replace(/\n/g, " ");
}

function generateActionCode(action: string, actionIndex: number): string {
  if (action === "startGame") return "state = startGame(state);";
  if (action === "advanceToDrawPhase")
    return "while (state.turn.currentPhase !== Phase.DRAW) { state = passPriority(state, state.priorityPlayerId!); }";
  if (action === "advanceToDeclareAttackers")
    return "while (state.turn.currentPhase !== Phase.DECLARE_ATTACKERS) { state = passPriority(state, state.priorityPlayerId!); }";
  if (action === "declareSingleAttacker")
    return [
      "state.combat.inCombatPhase = true;",
      "const attackerId = Array.from(state.cards.keys())[0];",
      "if (attackerId) {",
      "  state.combat.attackers = [{ cardId: attackerId, defenderId: playerIds[1], isAttackingPlaneswalker: false, damageToDeal: 2, hasFirstStrike: false, hasDoubleStrike: false }];",
      "}",
    ].join("\n      ");

  const damageMatch = action.match(/^dealDamageToPlayer(\d):(\d+)$/);
  if (damageMatch)
    return `state = dealDamageToPlayer(state, playerIds[${damageMatch[1]}], ${damageMatch[2]});`;

  const lifeMatch = action.match(/^gainLifePlayer(\d):(\d+)$/);
  if (lifeMatch)
    return `state = gainLife(state, playerIds[${lifeMatch[1]}], ${lifeMatch[2]});`;

  const poisonMatch = action.match(/^addPoisonPlayer(\d):(\d+)$/);
  if (poisonMatch)
    return `const _p${actionIndex} = state.players.get(playerIds[${poisonMatch[1]}]); if (_p${actionIndex}) { _p${actionIndex}.poisonCounters = ${poisonMatch[2]}; }`;

  const manaMatch = action.match(/^addManaPlayer(\d):(\w+):(\d+)$/);
  if (manaMatch)
    return `const _mp${actionIndex} = state.players.get(playerIds[${manaMatch[1]}]); if (_mp${actionIndex}) { _mp${actionIndex}.manaPool.${manaMatch[2]} = ${manaMatch[3]}; }`;

  const cmdDmgMatch = action.match(/^addCommanderDamage:player(\d)FromPlayer(\d):(\d+)$/);
  if (cmdDmgMatch)
    return `const _cmd${actionIndex} = state.players.get(playerIds[${cmdDmgMatch[1]}]); if (_cmd${actionIndex}) { _cmd${actionIndex}.commanderDamage.set(playerIds[${cmdDmgMatch[2]}], ${cmdDmgMatch[3]}); }`;

  const landMatch = action.match(/^incrementLandsPlayedPlayer(\d):(\d+)$/);
  if (landMatch)
    return `const _lp${actionIndex} = state.players.get(playerIds[${landMatch[1]}]); if (_lp${actionIndex}) { _lp${actionIndex}.landsPlayedThisTurn = ${landMatch[2]}; }`;

  const passMatch = action.match(/^passPriority:(\d+)$/);
  if (passMatch) {
    const count = parseInt(passMatch[1], 10);
    let code = "";
    for (let i = 0; i < count; i++) {
      code += "state = passPriority(state, state.priorityPlayerId!);\n      ";
    }
    return code.trimEnd();
  }

  return `// action: ${action}`;
}

function generateAccessorCode(accessor_path: string): string {
  const playerMatch = accessor_path.match(/^players\[(\d+)\]\.(\S+)$/);
  if (playerMatch) {
    const idx = playerMatch[1];
    const field = playerMatch[2];
    if (field.startsWith("manaPool.") && (MANA_COLORS as readonly string[]).includes(field.split(".")[1])) {
      return `getManaPool(state, ${idx}).${field.split(".")[1]}`;
    }
    if ((SIMPLE_PLAYER_FIELDS as readonly string[]).includes(field)) {
      return `getPlayer(state, ${idx}).${field}`;
    }
    if (field.startsWith("commanderDamage")) {
      return `getCommanderDamage(state, ${idx}, 1)`;
    }
    return `getPlayer(state, ${idx}).${field}`;
  }

  return ACCESSOR_MAP[accessor_path] || "state";
}

function generateAssertionCode(assertion: Assertion): string {
  const accessor = generateAccessorCode(assertion.path);
  if (assertion.operator === "toBeDefined") return `expect(${accessor}).toBeDefined();`;
  if (assertion.operator === "toBeTrue") return `expect(${accessor}).toBe(true);`;
  return `expect(${accessor}).${assertion.operator}(${JSON.stringify(assertion.value)});`;
}

function generateTestFile(fixtures: Fixture[]): string {
  const grouped = new Map<string, Fixture[]>();
  for (const f of fixtures) {
    const cat = f.category;
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(f);
  }

  let output = [
    "// Auto-generated test file from game state fixtures",
    "// Generated by: src/test-utils/generate-test-fixture.ts",
    "// Fixture count: " + fixtures.length,
    "",
    "import { describe, it, expect } from '@jest/globals';",
    "import {",
    "  createInitialGameState,",
    "  startGame,",
    "  passPriority,",
    "  dealDamageToPlayer,",
    "  gainLife,",
    "} from '@/lib/game-state/game-state';",
    "import { Phase } from '@/lib/game-state/types';",
    "",
    "function playerCount(state: ReturnType<typeof createInitialGameState>): number {",
    "  return state.players.size;",
    "}",
    "",
    "function getPlayer(state: ReturnType<typeof createInitialGameState>, idx: number) {",
    "  const ids = Array.from(state.players.keys());",
    "  return state.players.get(ids[idx]);",
    "}",
    "",
    "function getManaPool(state: ReturnType<typeof createInitialGameState>, idx: number) {",
    "  const ids = Array.from(state.players.keys());",
    "  return state.players.get(ids[idx])?.manaPool;",
    "}",
    "",
    "function getCommanderDamage(state: ReturnType<typeof createInitialGameState>, targetIdx: number, sourceIdx: number) {",
    "  const ids = Array.from(state.players.keys());",
    "  const target = state.players.get(ids[targetIdx]);",
    "  return target?.commanderDamage.get(ids[sourceIdx]);",
    "}",
  ].join("\n");

  for (const [category, categoryFixtures] of grouped) {
    output += "\ndescribe('" + pascalCase(category) + " fixtures', () => {\n";
    for (const fixture of categoryFixtures) {
      const testName = escapeForTemplate(fixture.description);
      output += "  it('" + testName + "', () => {\n";
      const { playerNames, startingLife, isCommander } = fixture.setup;
      output += "    let state = createInitialGameState(" + JSON.stringify(playerNames) + ", " + startingLife + ", " + isCommander + ");\n";
      output += "    const playerIds = Array.from(state.players.keys());\n";
      if (fixture.setup.actions && fixture.setup.actions.length > 0) {
        output += "\n";
        for (let ai = 0; ai < fixture.setup.actions.length; ai++) {
          output += "    " + generateActionCode(fixture.setup.actions[ai], ai) + "\n";
        }
      }
      output += "\n";
      for (const assertion of fixture.assertions) {
        output += "    " + generateAssertionCode(assertion) + "\n";
      }
      output += "  });\n\n";
    }
    output += "});\n";
  }

  return output;
}

function main(): void {
  const fixtureFiles = fs
    .readdirSync(FIXTURES_DIR)
    .filter((f: string) => f.endsWith(".json"))
    .sort();

  if (fixtureFiles.length === 0) {
    console.error("No fixture JSON files found in", FIXTURES_DIR);
    process.exit(1);
  }

  const fixtures: Fixture[] = fixtureFiles.map((file: string) => {
    const raw = fs.readFileSync(path.join(FIXTURES_DIR, file), "utf-8");
    return JSON.parse(raw) as Fixture;
  });

  const testCode = generateTestFile(fixtures);

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const outputPath = path.join(OUTPUT_DIR, "generated-fixtures.test.ts");
  fs.writeFileSync(outputPath, testCode, "utf-8");

  console.info("Generated " + fixtures.length + " test cases from " + fixtureFiles.length + " fixture files");
  console.info("Output: " + outputPath);
}

main();
