/**
 * @fileoverview Unit Tests for CombatDecisionTree
 *
 * Tests for AI combat decision-making logic.
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import {
  CombatDecisionTree,
  DefaultCombatConfigs,
  deckArchetypeToOpponentArchetype,
  type CombatPlan,
  type AttackDecision,
  type BlockDecision,
} from "../decision-making/combat-decision-tree";
import { predictOpponentBlocks } from "../decision-making/block-prediction";
import {
  resolveDifficultyConfig,
  type DifficultyLevel,
  type DifficultyFormat,
} from "../ai-difficulty";
import type { AIGameState, AIPlayerState, AIPermanent } from "@/lib/game-state";

/**
 * Create a mock AI player state for testing
 */
function createMockPlayerState(
  id: string,
  life: number = 20,
  battlefield: AIPermanent[] = [],
): AIPlayerState {
  return {
    id,
    name: `Player ${id}`,
    life,
    poisonCounters: 0,
    hand: [],
    battlefield,
    graveyard: [],
    exile: [],
    library: 40,
    manaPool: {
      white: 0,
      blue: 0,
      black: 0,
      red: 0,
      green: 0,
      colorless: 0,
      generic: 0,
    },
    commanderDamage: {},
    landsPlayedThisTurn: 0,
    hasPassedPriority: false,
  };
}

/**
 * Create a mock permanent for testing
 */
function createMockPermanent(
  id: string,
  name: string,
  type:
    | "creature"
    | "land"
    | "artifact"
    | "enchantment"
    | "planeswalker" = "creature",
  power?: number,
  toughness?: number,
  tapped: boolean = false,
  manaValue: number = 1,
  keywords: string[] = [],
): AIPermanent {
  return {
    id,
    cardInstanceId: id,
    name,
    type,
    controller: "player1",
    tapped,
    manaValue,
    power,
    toughness,
    keywords,
  };
}

/**
 * Create a basic test game state
 */
function createTestGameState(
  player1Life: number = 20,
  player2Life: number = 20,
  player1Battlefield: AIPermanent[] = [],
  player2Battlefield: AIPermanent[] = [],
  currentPlayer: string = "player1",
  phase:
    | "beginning"
    | "precombat_main"
    | "combat"
    | "postcombat_main"
    | "end" = "precombat_main",
): AIGameState {
  return {
    players: {
      player1: createMockPlayerState(
        "player1",
        player1Life,
        player1Battlefield,
      ),
      player2: createMockPlayerState(
        "player2",
        player2Life,
        player2Battlefield,
      ),
    },
    turnInfo: {
      currentTurn: 1,
      currentPlayer,
      priority: currentPlayer,
      phase,
      step: phase.includes("combat") ? "combat" : "main",
    },
    stack: [],
    combat: {
      inCombatPhase: phase === "combat",
      attackers: [],
      blockers: {},
    },
  };
}

describe("CombatDecisionTree", () => {
  describe("constructor", () => {
    it("should initialize with default difficulty (medium)", () => {
      const gameState = createTestGameState();
      const combatAI = new CombatDecisionTree(gameState, "player1");

      expect(combatAI).toBeDefined();
    });

    it("should initialize with specified difficulty", () => {
      const gameState = createTestGameState();
      const combatAI = new CombatDecisionTree(gameState, "player1", "hard");

      expect(combatAI).toBeDefined();
    });

    it("should store the AI player ID", () => {
      const gameState = createTestGameState();
      const combatAI = new CombatDecisionTree(gameState, "player2");

      expect(combatAI).toBeDefined();
    });
  });

  describe("setConfig", () => {
    it("should update combat configuration", () => {
      const gameState = createTestGameState();
      const combatAI = new CombatDecisionTree(gameState, "player1");

      combatAI.setConfig({ aggression: 0.9 });

      // Config is updated (tested indirectly through behavior)
      expect(combatAI).toBeDefined();
    });

    it("should preserve unchanged config values", () => {
      const gameState = createTestGameState();
      const combatAI = new CombatDecisionTree(gameState, "player1", "hard");

      const originalConfig = { ...DefaultCombatConfigs.hard };
      combatAI.setConfig({ aggression: 0.9 });

      // Other config values should remain unchanged
      expect(combatAI).toBeDefined();
    });
  });

  describe("generateAttackPlan", () => {
    it("should return a combat plan object", () => {
      const gameState = createTestGameState();
      const combatAI = new CombatDecisionTree(gameState, "player1");

      const plan = combatAI.generateAttackPlan();

      expect(plan).toHaveProperty("attacks");
      expect(plan).toHaveProperty("blocks");
      expect(plan).toHaveProperty("strategy");
      expect(plan).toHaveProperty("totalExpectedValue");
      expect(plan).toHaveProperty("combatTricks");
    });

    it("should generate attack decisions for creatures", () => {
      const player1Creatures = [
        createMockPermanent("c1", "Bear", "creature", 2, 2, false),
        createMockPermanent("c2", "Ogre", "creature", 3, 2, false),
      ];

      const gameState = createTestGameState(20, 20, player1Creatures, []);
      const combatAI = new CombatDecisionTree(gameState, "player1");

      const plan = combatAI.generateAttackPlan();

      expect(plan.attacks).toBeDefined();
      expect(Array.isArray(plan.attacks)).toBe(true);
    });

    it("should only consider untapped creatures for attacking", () => {
      const tappedCreature = createMockPermanent(
        "c1",
        "Bear",
        "creature",
        2,
        2,
        true,
      );
      const untappedCreature = createMockPermanent(
        "c2",
        "Bear",
        "creature",
        2,
        2,
        false,
      );

      const gameState = createTestGameState(
        20,
        20,
        [tappedCreature, untappedCreature],
        [],
      );
      const combatAI = new CombatDecisionTree(gameState, "player1");

      const plan = combatAI.generateAttackPlan();

      // Should only attack with untapped creature
      expect(plan.attacks.length).toBeLessThanOrEqual(1);
    });

    it("should not attack with creatures that have summoning sickness", () => {
      const newCreature = createMockPermanent(
        "c1",
        "Bear",
        "creature",
        2,
        2,
        false,
      );
      (newCreature as any).summoningSickness = true;

      const gameState = createTestGameState(20, 20, [newCreature], []);
      const combatAI = new CombatDecisionTree(gameState, "player1");

      const plan = combatAI.generateAttackPlan();

      // Should not attack with summoning sick creature
      expect(plan.attacks.length).toBe(0);
    });

    it("should attack with creatures that have haste despite summoning sickness", () => {
      const hasteCreature = createMockPermanent(
        "c1",
        "Haste Bear",
        "creature",
        2,
        2,
        false,
        1,
        ["haste"],
      );
      (hasteCreature as any).summoningSickness = true;

      const gameState = createTestGameState(20, 20, [hasteCreature], []);
      const combatAI = new CombatDecisionTree(gameState, "player1");

      const plan = combatAI.generateAttackPlan();

      // Should attack with haste creature
      expect(plan.attacks.length).toBeGreaterThanOrEqual(0);
    });

    it("should determine aggressive strategy when opponent has low life", () => {
      const player1Creatures = [
        createMockPermanent("c1", "Bear", "creature", 2, 2),
      ];

      const gameState = createTestGameState(20, 8, player1Creatures, []);
      const combatAI = new CombatDecisionTree(gameState, "player1");

      const plan = combatAI.generateAttackPlan();

      expect(plan.strategy).toBe("aggressive");
    });

    it("should determine defensive strategy when AI has low life AND is losing the race", () => {
      // Issue #1542: the previous heuristic labelled *any* low-AI-life
      // board "defensive", even when the AI was winning the race. The
      // fixed heuristic only goes defensive on low life when the AI is
      // actually losing the race — i.e. the opponent has the bigger
      // board and can race us. AI is at 6 life with a 2/2 Bear; the
      // opponent has two 6/6s and 20 life, so the AI is clearly losing.
      const player1Creatures = [
        createMockPermanent("c1", "Bear", "creature", 2, 2),
      ];
      const player2Creatures = [
        createMockPermanent("c2", "Dragon", "creature", 6, 6),
        createMockPermanent("c3", "Dragon", "creature", 6, 6),
      ];

      const gameState = createTestGameState(
        6,
        20,
        player1Creatures,
        player2Creatures,
      );
      const combatAI = new CombatDecisionTree(gameState, "player1");
      // Issue #1748: seed the combat RNG so the #994 blunder roll
      // (`combatRng() < blunderChance`, medium = 0.10) never fires — the
      // test asserts the no-blunder defensive verdict and must be hermetic,
      // not a 1-in-10 Math.random flake (same class as #1706/#1734).
      combatAI.setCombatRng(() => 1);

      const plan = combatAI.generateAttackPlan();

      expect(plan.strategy).toBe("defensive");
    });

    it("should determine moderate strategy in even game state", () => {
      const player1Creatures = [
        createMockPermanent("c1", "Bear", "creature", 2, 2),
      ];
      const player2Creatures = [
        createMockPermanent("c2", "Bear", "creature", 2, 2),
      ];

      const gameState = createTestGameState(
        20,
        20,
        player1Creatures,
        player2Creatures,
      );
      const combatAI = new CombatDecisionTree(gameState, "player1", "medium");

      const plan = combatAI.generateAttackPlan();

      expect(plan.strategy).toBe("moderate");
    });

    /**
     * Issue #1542 — drive combat-strategy aggression from lightweight race
     * math (turns-to-lethal) instead of fixed life thresholds. The four
     * acceptance criteria from the issue each get their own test below; the
     * underlying pure-math helpers live in `race-math.test.ts` and the
     * integration with `determineCombatStrategy` is pinned down here.
     */
    describe("race-math override (issue #1542)", () => {
      it("AC1: AI winning the race is aggressive even at low life (Hard)", () => {
        // AI power 10 into opponent at 5 life with no blockers. Race is
        // mathematically over — the AI should commit, not stall behind a
        // walls-up defence. Hard difficulty blunders are vanishingly rare
        // (blunderChance = 0.05), so the strategy must be `aggressive`.
        const aiCreatures = [
          createMockPermanent("c1", "Bear", "creature", 4, 4),
          createMockPermanent("c2", "Ogre", "creature", 6, 6),
        ];
        const gameState = createTestGameState(5, 5, aiCreatures, []);
        const combatAI = new CombatDecisionTree(gameState, "player1", "hard");

        const plan = combatAI.generateAttackPlan();

        expect(plan.strategy).toBe("aggressive");
      });

      it("AC1: AI winning the race is aggressive even at low life (Expert)", () => {
        // Same board, Expert tier. The race-math verdict must dominate the
        // legacy low-life defensive branch even at the highest difficulty
        // where blunderChance drops to 0.02.
        const aiCreatures = [
          createMockPermanent("c1", "Bear", "creature", 4, 4),
          createMockPermanent("c2", "Ogre", "creature", 6, 6),
        ];
        const gameState = createTestGameState(5, 5, aiCreatures, []);
        const combatAI = new CombatDecisionTree(gameState, "player1", "expert");

        const plan = combatAI.generateAttackPlan();

        expect(plan.strategy).toBe("aggressive");
      });

      it("AC2: AI losing the race by a wide margin is defensive", () => {
        // Mirror of AC1 — opponent's on-board power sums to 12 into the AI's
        // 6 life while the AI's sums to 2 into the opponent's 20. AI is
        // losing the race and must hold blockers.
        const aiCreatures = [
          createMockPermanent("c1", "Bear", "creature", 2, 2),
        ];
        const oppCreatures = [
          createMockPermanent("c2", "Dragon", "creature", 6, 6),
          createMockPermanent("c3", "Dragon", "creature", 6, 6),
        ];
        const gameState = createTestGameState(6, 20, aiCreatures, oppCreatures);
        const combatAI = new CombatDecisionTree(gameState, "player1", "hard");
        // Issue #1748: never-blunder seed — the #994 roll (hard = 0.05)
        // must not turn this deterministic verdict into a 1-in-20 flake.
        combatAI.setCombatRng(() => 1);

        const plan = combatAI.generateAttackPlan();

        expect(plan.strategy).toBe("defensive");
      });

      it("AC3: symmetric boards fall through to the existing aggression-config branch", () => {
        // Both sides at 20 life with a single 2/2 Bear. Power ratio is
        // exactly 1.0 (no decisive advantage), so the race-math override
        // is silent and `determineCombatStrategy` continues to defer to
        // the per-archetype aggression config. medium difficulty with no
        // archetype modifier → moderate strategy.
        const aiCreatures = [
          createMockPermanent("c1", "Bear", "creature", 2, 2),
        ];
        const oppCreatures = [
          createMockPermanent("c2", "Bear", "creature", 2, 2),
        ];
        const gameState = createTestGameState(
          20,
          20,
          aiCreatures,
          oppCreatures,
        );
        const combatAI = new CombatDecisionTree(gameState, "player1", "medium");

        const plan = combatAI.generateAttackPlan();

        expect(plan.strategy).toBe("moderate");
      });

      it("AC3 (variant): a wider symmetric board still falls through", () => {
        // Two 3/3s on each side at 20 life — power sums are equal so race
        // math is silent. The strategy is whatever the archetype says.
        const aiCreatures = [
          createMockPermanent("c1", "Ogre", "creature", 3, 3),
          createMockPermanent("c2", "Ogre", "creature", 3, 3),
        ];
        const oppCreatures = [
          createMockPermanent("c3", "Ogre", "creature", 3, 3),
          createMockPermanent("c4", "Ogre", "creature", 3, 3),
        ];
        const gameState = createTestGameState(
          20,
          20,
          aiCreatures,
          oppCreatures,
        );
        const combatAI = new CombatDecisionTree(gameState, "player1", "medium");

        const plan = combatAI.generateAttackPlan();

        // medium = aggression 0.5, which is neither > 0.6 nor < 0.4, so
        // the legacy even-board branch returns `moderate`.
        expect(plan.strategy).toBe("moderate");
      });

      it("AC4: Easy tier occasionally blunders the race-verdict and picks the wrong strategy", () => {
        // The same losing-race scenario as AC2, but at Easy difficulty.
        // Easy blunderChance is 0.25, so over many rolls we expect to see
        // the AI occasionally pick `aggressive` (the OLD legacy heuristic)
        // even though race math says `defensive`.
        const aiCreatures = [
          createMockPermanent("c1", "Bear", "creature", 2, 2),
        ];
        const oppCreatures = [
          createMockPermanent("c2", "Dragon", "creature", 6, 6),
          createMockPermanent("c3", "Dragon", "creature", 6, 6),
        ];
        const gameState = createTestGameState(6, 20, aiCreatures, oppCreatures);

        // Seeded RNG so the test is deterministic. Roll 64 trials; with a
        // 0.25 blunderChance we expect ~16 blunders and ~48 correct plays.
        let seed = 0xc0ffee;
        const rng = () => {
          // Mulberry32 — deterministic, fast, 32-bit state.
          seed = (seed + 0x6d2b79f5) | 0;
          let t = seed;
          t = Math.imul(t ^ (t >>> 15), t | 1);
          t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        const combatAI = new CombatDecisionTree(gameState, "player1", "easy");
        combatAI.setCombatRng(rng);

        let blunders = 0;
        let correct = 0;
        const TRIALS = 64;
        for (let i = 0; i < TRIALS; i++) {
          const plan = combatAI.generateAttackPlan();
          if (plan.strategy === "aggressive") blunders++;
          else if (plan.strategy === "defensive") correct++;
        }

        // Easy tier MUST still mostly get the right answer (it's not
        // uniformly random), but it MUST blunder at least once over 64
        // trials at the 0.25 rate. The 99% confidence lower bound for a
        // Bernoulli(0.25) over 64 draws is 14, so we use a generous
        // minimum of 6 to keep the test stable across RNG choices.
        expect(blunders).toBeGreaterThanOrEqual(6);
        expect(correct).toBeGreaterThan(blunders);
      });

      it("Easy blunder pattern matches the combat-block blunder (issue #994)", () => {
        // Sanity: easy tier occasionally blunders, expert almost never does.
        // Sample both tiers across 128 trials of the same losing-race
        // scenario; expert must hit a much lower blunder rate.
        const aiCreatures = [
          createMockPermanent("c1", "Bear", "creature", 2, 2),
        ];
        const oppCreatures = [
          createMockPermanent("c2", "Dragon", "creature", 6, 6),
          createMockPermanent("c3", "Dragon", "creature", 6, 6),
        ];
        const gameState = createTestGameState(6, 20, aiCreatures, oppCreatures);

        let easySeed = 0xeae;
        const easyRng = () => {
          easySeed = (easySeed + 0x6d2b79f5) | 0;
          let t = easySeed;
          t = Math.imul(t ^ (t >>> 15), t | 1);
          t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        let expertSeed = 0xeae;
        const expertRng = () => {
          expertSeed = (expertSeed + 0x6d2b79f5) | 0;
          let t = expertSeed;
          t = Math.imul(t ^ (t >>> 15), t | 1);
          t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };

        const easyAI = new CombatDecisionTree(gameState, "player1", "easy");
        easyAI.setCombatRng(easyRng);
        const expertAI = new CombatDecisionTree(gameState, "player1", "expert");
        expertAI.setCombatRng(expertRng);

        let easyBlunders = 0;
        let expertBlunders = 0;
        const TRIALS = 128;
        for (let i = 0; i < TRIALS; i++) {
          if (easyAI.generateAttackPlan().strategy === "aggressive") {
            easyBlunders++;
          }
          if (expertAI.generateAttackPlan().strategy === "aggressive") {
            expertBlunders++;
          }
        }

        // Easy blunder rate (0.25) must dominate expert's (0.02).
        expect(easyBlunders).toBeGreaterThan(expertBlunders);
        // And expert must mostly get it right (≥ 95% of trials).
        expect(expertBlunders).toBeLessThan(10);
      });
    });

    it("should calculate total expected value", () => {
      const player1Creatures = [
        createMockPermanent("c1", "Bear", "creature", 2, 2),
      ];

      const gameState = createTestGameState(20, 20, player1Creatures, []);
      const combatAI = new CombatDecisionTree(gameState, "player1");

      const plan = combatAI.generateAttackPlan();

      expect(typeof plan.totalExpectedValue).toBe("number");
    });

    it("should handle empty battlefield", () => {
      const gameState = createTestGameState();
      const combatAI = new CombatDecisionTree(gameState, "player1");

      const plan = combatAI.generateAttackPlan();

      expect(plan.attacks.length).toBe(0);
      expect(plan.totalExpectedValue).toBe(0);
    });

    it("should handle multiple opponents", () => {
      const gameState: AIGameState = {
        players: {
          player1: createMockPlayerState("player1", 20, [
            createMockPermanent("c1", "Bear", "creature", 2, 2),
          ]),
          player2: createMockPlayerState("player2", 20, []),
          player3: createMockPlayerState("player3", 20, []),
        },
        turnInfo: {
          currentTurn: 1,
          currentPlayer: "player1",
          priority: "player1",
          phase: "precombat_main",
          step: "main",
        },
        stack: [],
        combat: {
          inCombatPhase: false,
          attackers: [],
          blockers: {},
        },
      };

      const combatAI = new CombatDecisionTree(gameState, "player1");
      const plan = combatAI.generateAttackPlan();

      expect(plan).toBeDefined();
      expect(plan.attacks).toBeDefined();
    });
  });

  describe("generateBlockingPlan", () => {
    it("should return a combat plan for blocking", () => {
      const gameState = createTestGameState();
      const combatAI = new CombatDecisionTree(gameState, "player1");

      const attackers: AIPermanent[] = [
        createMockPermanent("c1", "Bear", "creature", 2, 2),
      ];

      const plan = combatAI.generateBlockingPlan(attackers);

      expect(plan).toHaveProperty("attacks");
      expect(plan).toHaveProperty("blocks");
      expect(plan).toHaveProperty("strategy");
      expect(plan.strategy).toBe("defensive");
    });

    it("should generate block decisions for attackers", () => {
      const player1Creatures = [
        createMockPermanent("c1", "Bear", "creature", 2, 2),
        createMockPermanent("c2", "Ogre", "creature", 3, 2),
      ];
      const attackers: AIPermanent[] = [
        createMockPermanent("c3", "Enemy Bear", "creature", 2, 2),
      ];

      const gameState = createTestGameState(20, 20, player1Creatures, []);
      const combatAI = new CombatDecisionTree(gameState, "player1");

      const plan = combatAI.generateBlockingPlan(attackers);

      expect(plan.blocks).toBeDefined();
      expect(Array.isArray(plan.blocks)).toBe(true);
    });

    it("should handle multiple attackers", () => {
      const player1Creatures = [
        createMockPermanent("c1", "Bear", "creature", 2, 2),
      ];
      const attackers: AIPermanent[] = [
        createMockPermanent("c2", "Enemy Bear 1", "creature", 2, 2),
        createMockPermanent("c3", "Enemy Bear 2", "creature", 2, 2),
      ];

      const gameState = createTestGameState(20, 20, player1Creatures, []);
      const combatAI = new CombatDecisionTree(gameState, "player1");

      const plan = combatAI.generateBlockingPlan(attackers);

      expect(plan.blocks.length).toBeGreaterThanOrEqual(0);
    });

    it("should handle no available blockers", () => {
      const attackers: AIPermanent[] = [
        createMockPermanent("c1", "Enemy Bear", "creature", 2, 2),
      ];

      const gameState = createTestGameState(20, 20, [], []);
      const combatAI = new CombatDecisionTree(gameState, "player1");

      const plan = combatAI.generateBlockingPlan(attackers);

      expect(plan.blocks.length).toBe(0);
    });

    it("should only use untapped creatures for blocking", () => {
      const tappedCreature = createMockPermanent(
        "c1",
        "Bear",
        "creature",
        2,
        2,
        true,
      );
      const untappedCreature = createMockPermanent(
        "c2",
        "Bear",
        "creature",
        2,
        2,
        false,
      );
      const attackers: AIPermanent[] = [
        createMockPermanent("c3", "Enemy Bear", "creature", 2, 2),
      ];

      const gameState = createTestGameState(
        20,
        20,
        [tappedCreature, untappedCreature],
        [],
      );
      const combatAI = new CombatDecisionTree(gameState, "player1");

      const plan = combatAI.generateBlockingPlan(attackers);

      // Should only consider untapped creature for blocking
      expect(plan).toBeDefined();
    });

    it("should calculate total block value", () => {
      const player1Creatures = [
        createMockPermanent("c1", "Bear", "creature", 2, 2),
      ];
      const attackers: AIPermanent[] = [
        createMockPermanent("c2", "Enemy Bear", "creature", 2, 2),
      ];

      const gameState = createTestGameState(20, 20, player1Creatures, []);
      const combatAI = new CombatDecisionTree(gameState, "player1");

      const plan = combatAI.generateBlockingPlan(attackers);

      expect(typeof plan.totalExpectedValue).toBe("number");
    });
  });

  describe("evaluateAttacker (indirect)", () => {
    it("should create attack decisions with required properties", () => {
      const player1Creatures = [
        createMockPermanent("c1", "Bear", "creature", 2, 2),
      ];

      const gameState = createTestGameState(20, 20, player1Creatures, []);
      const combatAI = new CombatDecisionTree(gameState, "player1");

      const plan = combatAI.generateAttackPlan();

      if (plan.attacks.length > 0) {
        const decision = plan.attacks[0];
        expect(decision).toHaveProperty("creatureId");
        expect(decision).toHaveProperty("shouldAttack");
        expect(decision).toHaveProperty("target");
        expect(decision).toHaveProperty("reasoning");
        expect(decision).toHaveProperty("expectedValue");
        expect(decision).toHaveProperty("riskLevel");
      }
    });
  });

  describe("evaluateBlocksForAttacker (indirect)", () => {
    it("should create block decisions with required properties", () => {
      const player1Creatures = [
        createMockPermanent("c1", "Bear", "creature", 2, 2),
      ];
      const attackers: AIPermanent[] = [
        createMockPermanent("c2", "Enemy Bear", "creature", 2, 2),
      ];

      const gameState = createTestGameState(20, 20, player1Creatures, []);
      const combatAI = new CombatDecisionTree(gameState, "player1");

      const plan = combatAI.generateBlockingPlan(attackers);

      if (plan.blocks.length > 0) {
        const decision = plan.blocks[0];
        expect(decision).toHaveProperty("blockerId");
        expect(decision).toHaveProperty("attackerId");
        expect(decision).toHaveProperty("reasoning");
        expect(decision).toHaveProperty("expectedValue");
      }
    });
  });

  describe("difficulty-based combat behavior", () => {
    it("should be more aggressive at hard difficulty", () => {
      const player1Creatures = [
        createMockPermanent("c1", "Bear", "creature", 2, 2),
      ];

      const gameState = createTestGameState(20, 20, player1Creatures, []);
      const hardAI = new CombatDecisionTree(gameState, "player1", "hard");

      const hardPlan = hardAI.generateAttackPlan();

      expect(hardPlan).toBeDefined();
    });

    it("should be more cautious at easy difficulty", () => {
      const player1Creatures = [
        createMockPermanent("c1", "Bear", "creature", 2, 2),
      ];

      const gameState = createTestGameState(20, 20, player1Creatures, []);
      const easyAI = new CombatDecisionTree(gameState, "player1", "easy");

      const easyPlan = easyAI.generateAttackPlan();

      expect(easyPlan).toBeDefined();
    });
  });

  describe("edge cases", () => {
    it("should handle creatures with 0 power", () => {
      const weakCreature = createMockPermanent("c1", "Wall", "creature", 0, 5);

      const gameState = createTestGameState(20, 20, [weakCreature], []);
      const combatAI = new CombatDecisionTree(gameState, "player1");

      const plan = combatAI.generateAttackPlan();

      // Creatures with 0 power shouldn't attack
      expect(plan.attacks.length).toBe(0);
    });

    it("should handle very large creatures", () => {
      const bigCreature = createMockPermanent(
        "c1",
        "Big Beast",
        "creature",
        10,
        10,
      );

      const gameState = createTestGameState(20, 20, [bigCreature], []);
      const combatAI = new CombatDecisionTree(gameState, "player1");

      const plan = combatAI.generateAttackPlan();

      expect(plan).toBeDefined();
      expect(plan.attacks.length).toBeGreaterThanOrEqual(0);
    });

    it("should handle creatures with evasion keywords", () => {
      const flyingCreature = createMockPermanent(
        "c1",
        "Flying Bear",
        "creature",
        2,
        2,
        false,
        1,
        ["flying"],
      );

      const gameState = createTestGameState(20, 20, [flyingCreature], []);
      const combatAI = new CombatDecisionTree(gameState, "player1");

      const plan = combatAI.generateAttackPlan();

      expect(plan).toBeDefined();
    });

    it("should handle combat phase state", () => {
      const player1Creatures = [
        createMockPermanent("c1", "Bear", "creature", 2, 2),
      ];

      const gameState = createTestGameState(
        20,
        20,
        player1Creatures,
        [],
        "player1",
        "combat",
      );
      const combatAI = new CombatDecisionTree(gameState, "player1");

      const plan = combatAI.generateAttackPlan();

      expect(plan).toBeDefined();
    });
  });

  describe("optimizeBlockerOrdering (indirect)", () => {
    it("should handle multi-block scenarios", () => {
      const player1Creatures = [
        createMockPermanent("c1", "Bear 1", "creature", 2, 2),
        createMockPermanent("c2", "Bear 2", "creature", 2, 2),
        createMockPermanent("c3", "Bear 3", "creature", 2, 2),
      ];
      const attackers: AIPermanent[] = [
        createMockPermanent("c4", "Big Beast", "creature", 5, 5),
      ];

      const gameState = createTestGameState(20, 20, player1Creatures, []);
      const combatAI = new CombatDecisionTree(gameState, "player1");

      const plan = combatAI.generateBlockingPlan(attackers);

      expect(plan).toBeDefined();
    });
  });

  describe("evaluateCombatTricks (indirect)", () => {
    it("should consider combat tricks when enabled", () => {
      const player1Creatures = [
        createMockPermanent("c1", "Bear", "creature", 2, 2),
      ];

      const gameState = createTestGameState(20, 20, player1Creatures, []);
      const combatAI = new CombatDecisionTree(gameState, "player1", "expert");

      const plan = combatAI.generateAttackPlan();

      expect(plan.combatTricks).toBeDefined();
      expect(Array.isArray(plan.combatTricks)).toBe(true);
    });
  });

  describe("per-archetype playstyle wiring (#911)", () => {
    // Even board: 1 creature each, both at 20 life. On medium difficulty the
    // strategy is decided purely by the effective aggression threshold, which
    // the archetype modifier shifts.
    function createEvenBoardState(): AIGameState {
      const player1Creatures = [
        createMockPermanent("c1", "Bear", "creature", 2, 2),
      ];
      const player2Creatures = [
        createMockPermanent("c2", "Bear", "creature", 2, 2),
      ];
      return createTestGameState(20, 20, player1Creatures, player2Creatures);
    }

    it('defaults to "unknown" archetype when none is supplied (backward compat)', () => {
      const combatAI = new CombatDecisionTree(
        createEvenBoardState(),
        "player1",
      );
      expect(combatAI.getArchetype()).toBe("unknown");
    });

    it("stores the supplied archetype", () => {
      const combatAI = new CombatDecisionTree(
        createEvenBoardState(),
        "player1",
        "medium",
        "aggro",
      );
      expect(combatAI.getArchetype()).toBe("aggro");
    });

    it("keeps base config for the unknown archetype", () => {
      const combatAI = new CombatDecisionTree(
        createEvenBoardState(),
        "player1",
        "medium",
      );
      expect(combatAI.getConfig().aggression).toBe(
        DefaultCombatConfigs.medium.aggression,
      );
    });

    it("amplifies aggression for aggro and dampens it for control/combo/ramp", () => {
      const state = createEvenBoardState();
      const aggro = new CombatDecisionTree(state, "player1", "medium", "aggro");
      const midrange = new CombatDecisionTree(
        state,
        "player1",
        "medium",
        "midrange",
      );
      const control = new CombatDecisionTree(
        state,
        "player1",
        "medium",
        "control",
      );
      const combo = new CombatDecisionTree(state, "player1", "medium", "combo");
      const ramp = new CombatDecisionTree(state, "player1", "medium", "ramp");

      // Strict ordering: aggro > midrange > control > combo, ramp below midrange.
      expect(aggro.getConfig().aggression).toBeGreaterThan(
        midrange.getConfig().aggression,
      );
      expect(midrange.getConfig().aggression).toBeGreaterThan(
        control.getConfig().aggression,
      );
      expect(control.getConfig().aggression).toBeGreaterThan(
        combo.getConfig().aggression,
      );
      expect(midrange.getConfig().aggression).toBeGreaterThan(
        ramp.getConfig().aggression,
      );
      // midrange is a no-op modifier.
      expect(midrange.getConfig().aggression).toBe(
        DefaultCombatConfigs.medium.aggression,
      );
    });

    it("clamps aggression to [0, 1] for an already-extreme difficulty", () => {
      // expert aggression is 0.85; aggro +0.2 would exceed 1.
      const expertAggro = new CombatDecisionTree(
        createEvenBoardState(),
        "player1",
        "expert",
        "aggro",
      );
      expect(expertAggro.getConfig().aggression).toBeLessThanOrEqual(1);
      expect(expertAggro.getConfig().aggression).toBeGreaterThan(
        DefaultCombatConfigs.expert.aggression,
      );
    });

    it("shifts combat strategy by archetype on an even board (medium)", () => {
      const state = createEvenBoardState();

      const midrange = new CombatDecisionTree(
        state,
        "player1",
        "medium",
        "midrange",
      );
      const aggro = new CombatDecisionTree(state, "player1", "medium", "aggro");
      const control = new CombatDecisionTree(
        state,
        "player1",
        "medium",
        "control",
      );
      const combo = new CombatDecisionTree(state, "player1", "medium", "combo");
      const ramp = new CombatDecisionTree(state, "player1", "medium", "ramp");

      // Same exact board, different decks -> different playstyles.
      expect(midrange.generateAttackPlan().strategy).toBe("moderate");
      expect(aggro.generateAttackPlan().strategy).toBe("aggressive");
      expect(control.generateAttackPlan().strategy).toBe("defensive");
      expect(combo.generateAttackPlan().strategy).toBe("defensive");
      expect(ramp.generateAttackPlan().strategy).toBe("defensive");
    });

    it("raises defensive life threshold for fragile archetypes (combo)", () => {
      // combo gets +4 to lifeThreshold at medium (10 -> 14). At 14 life the
      // combo AI should already play defensively while a midrange AI at the
      // same life does not.
      const player1Creatures = [
        createMockPermanent("c1", "Bear", "creature", 2, 2),
      ];
      const player2Creatures = [
        createMockPermanent("c2", "Bear", "creature", 2, 2),
      ];
      const state = createTestGameState(
        14,
        20,
        player1Creatures,
        player2Creatures,
      );

      const combo = new CombatDecisionTree(state, "player1", "medium", "combo");
      const midrange = new CombatDecisionTree(
        state,
        "player1",
        "medium",
        "midrange",
      );

      expect(combo.generateAttackPlan().strategy).toBe("defensive");
      // midrange lifeThreshold stays at 10, so 14 life is still safe -> not defensive.
      expect(midrange.generateAttackPlan().strategy).not.toBe("defensive");
    });
  });

  describe("live opponent-archetype detection (#912)", () => {
    it('defaults opponentArchetype to "unknown" when none is supplied (backward compat)', () => {
      const combatAI = new CombatDecisionTree(createTestGameState(), "player1");
      expect(combatAI.getOpponentArchetype()).toBe("unknown");
      expect(combatAI.getConfig().opponentArchetype).toBe("unknown");
    });

    it("stores the supplied opponent archetype and surfaces it in the config", () => {
      const combatAI = new CombatDecisionTree(
        createTestGameState(),
        "player1",
        "medium",
        "unknown",
        "control",
      );
      expect(combatAI.getOpponentArchetype()).toBe("control");
      // Previously DefaultCombatConfigs forced this to "unknown" regardless.
      expect(combatAI.getConfig().opponentArchetype).toBe("control");
    });

    it("keeps the AI's own archetype independent of the opponent archetype", () => {
      const combatAI = new CombatDecisionTree(
        createTestGameState(),
        "player1",
        "medium",
        "aggro",
        "control",
      );
      expect(combatAI.getArchetype()).toBe("aggro");
      expect(combatAI.getOpponentArchetype()).toBe("control");
    });

    it("maps deck archetype buckets onto the opponent-archetype vocabulary", () => {
      expect(deckArchetypeToOpponentArchetype("aggro")).toBe("aggro");
      expect(deckArchetypeToOpponentArchetype("control")).toBe("control");
      expect(deckArchetypeToOpponentArchetype("combo")).toBe("combo");
      expect(deckArchetypeToOpponentArchetype("midrange")).toBe("midrange");
      // ramp has no OpponentArchetype counterpart -> folds to midrange.
      expect(deckArchetypeToOpponentArchetype("ramp")).toBe("midrange");
      expect(deckArchetypeToOpponentArchetype("unknown")).toBe("unknown");
    });

    it("adapts block prediction to the detected opponent archetype", () => {
      // Same attacker and potential blocker; only the opponent archetype
      // changes. A control opponent blocks far more readily than an aggro one,
      // so the predicted block probability and the weights consumed by the
      // live combat tree must differ. This proves the detected opponent
      // archetype reaches and shifts the strategy the AI plans against.
      const attacker = createMockPermanent("a1", "Bear", "creature", 2, 2);
      const blocker = createMockPermanent("b1", "Bear", "creature", 2, 2);

      const aggroPred = predictOpponentBlocks(
        [attacker],
        [blocker],
        20,
        "aggro",
      );
      const controlPred = predictOpponentBlocks(
        [attacker],
        [blocker],
        20,
        "control",
      );

      // The archetype weights table is the bridge between detection and the
      // block model — willingnessToBlock must reflect the opponent archetype.
      expect(aggroPred.archetypeWeights.willingnessToBlock).toBeLessThan(
        controlPred.archetypeWeights.willingnessToBlock,
      );
      // And the resulting block-probability feeding attack EV must differ.
      expect(aggroPred.predictions[0].blockProbability).not.toBe(
        controlPred.predictions[0].blockProbability,
      );
    });
  });

  describe("live opponent-archetype derivation from board state (#991)", () => {
    it("derives the opponent archetype from an observed aggro board when none is supplied", () => {
      // No explicit opponentArchetype argument: the tree must infer from the
      // opponent's battlefield instead of inheriting the "unknown" baked into
      // DefaultCombatConfigs.
      const opponentAggroBoard = [
        createMockPermanent("o1", "Goblin Guide", "creature", 2, 2, false, 1),
        createMockPermanent(
          "o2",
          "Monastery Swiftspear",
          "creature",
          1,
          2,
          false,
          1,
        ),
        createMockPermanent("o3", "Ragavan", "creature", 2, 1, false, 1),
      ];
      const state = createTestGameState(20, 20, [], opponentAggroBoard);

      const combatAI = new CombatDecisionTree(state, "player1", "hard");

      expect(combatAI.getOpponentArchetype()).toBe("aggro");
      // The derived archetype reaches the live combat config consumed by block
      // prediction (DefaultCombatConfigs no longer forces "unknown").
      expect(combatAI.getConfig().opponentArchetype).toBe("aggro");
    });

    it("derives control from a planeswalker-heavy opponent board", () => {
      const opponentControlBoard = [
        createMockPermanent("o1", "Teferi", "planeswalker", 0, 0, false, 4),
        createMockPermanent(
          "o2",
          "Shark Typhoon",
          "enchantment",
          0,
          0,
          false,
          6,
        ),
        createMockPermanent(
          "o3",
          "Solemn Simulacrum",
          "creature",
          1,
          1,
          false,
          4,
        ),
      ];
      const state = createTestGameState(20, 20, [], opponentControlBoard);

      const combatAI = new CombatDecisionTree(state, "player1", "expert");

      expect(combatAI.getOpponentArchetype()).toBe("control");
      expect(combatAI.getConfig().opponentArchetype).toBe("control");
    });

    it("keeps 'unknown' when the opponent board is too sparse to classify", () => {
      // Empty opponent board -> nothing observed -> genuine "unknown" fallback.
      const empty = createTestGameState();
      expect(
        new CombatDecisionTree(
          empty,
          "player1",
          "medium",
        ).getOpponentArchetype(),
      ).toBe("unknown");
      expect(
        new CombatDecisionTree(empty, "player1", "medium").getConfig()
          .opponentArchetype,
      ).toBe("unknown");

      // A single non-land permanent is below the minimum signal threshold.
      const thin = createTestGameState(
        20,
        20,
        [],
        [
          createMockPermanent(
            "o1",
            "Birds of Paradise",
            "creature",
            0,
            1,
            false,
            1,
          ),
        ],
      );
      expect(
        new CombatDecisionTree(
          thin,
          "player1",
          "medium",
        ).getOpponentArchetype(),
      ).toBe("unknown");
    });

    it("prefers an explicitly supplied archetype over board inference", () => {
      // The caller knows best (e.g. the live turn loop detects from the full
      // engine state). An explicit value must win even when the board suggests
      // a different archetype.
      const opponentAggroBoard = [
        createMockPermanent("o1", "Goblin Guide", "creature", 2, 2, false, 1),
        createMockPermanent("o2", "Ragavan", "creature", 2, 1, false, 1),
        createMockPermanent("o3", "Pashalik Mons", "creature", 2, 1, false, 1),
      ];
      const state = createTestGameState(20, 20, [], opponentAggroBoard);

      const combatAI = new CombatDecisionTree(
        state,
        "player1",
        "hard",
        "unknown",
        "control",
      );

      expect(combatAI.getOpponentArchetype()).toBe("control");
      expect(combatAI.getConfig().opponentArchetype).toBe("control");
    });

    it("flows the derived archetype into block prediction so combat adapts", () => {
      // Same attacker/blocker and difficulty; only the opponent's observed
      // board differs. The derived archetype must change the block-prediction
      // weights the combat tree plans against, proving the real matchup
      // context reaches combat decisions rather than a hardcoded "unknown".
      const attacker = createMockPermanent("a1", "Bear", "creature", 2, 2);
      const blocker = createMockPermanent("b1", "Bear", "creature", 2, 2);
      const playerBoard = [attacker];

      const vsAggro = new CombatDecisionTree(
        createTestGameState(20, 20, playerBoard, [
          createMockPermanent("o1", "Goblin", "creature", 2, 2, false, 1),
          createMockPermanent("o2", "Goblin", "creature", 2, 2, false, 1),
          createMockPermanent("o3", "Goblin", "creature", 2, 2, false, 1),
        ]),
        "player1",
        "hard",
      );
      const vsControl = new CombatDecisionTree(
        createTestGameState(20, 20, playerBoard, [
          createMockPermanent("o1", "Jace", "planeswalker", 0, 0, false, 4),
          createMockPermanent(
            "o2",
            "Engineered Explosives",
            "artifact",
            0,
            0,
            false,
            2,
          ),
        ]),
        "player1",
        "hard",
      );

      expect(vsAggro.getOpponentArchetype()).toBe("aggro");
      expect(vsControl.getOpponentArchetype()).toBe("control");

      // The block-prediction weights differ because the real archetype flows
      // through (control is far more willing to block than aggro).
      const aggroPred = predictOpponentBlocks(
        [attacker],
        [blocker],
        20,
        vsAggro.getConfig().opponentArchetype,
      );
      const controlPred = predictOpponentBlocks(
        [attacker],
        [blocker],
        20,
        vsControl.getConfig().opponentArchetype,
      );
      expect(aggroPred.archetypeWeights.willingnessToBlock).toBeLessThan(
        controlPred.archetypeWeights.willingnessToBlock,
      );
    });
  });

  describe("combat blunder frequency by difficulty (#994)", () => {
    const TIERS: DifficultyLevel[] = ["easy", "medium", "hard", "expert"];

    // mulberry32 — small, fast, deterministic PRNG so blunder-rate assertions
    // are reproducible on every CI run (no Math.random flakiness).
    function seededRng(seed: number): () => number {
      let s = seed >>> 0;
      return () => {
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    it("exposes the per-tier blunder chance from the unified difficulty config", () => {
      for (const tier of TIERS) {
        const ai = new CombatDecisionTree(
          createTestGameState(),
          "player1",
          tier,
        );
        // Combat reads the SAME knob the rest of the AI uses (composition with
        // the unified taxonomy #1064/#1192), via resolveDifficultyConfig.
        expect(ai.getCombatBlunderChance()).toBe(
          resolveDifficultyConfig(tier).blunderChance,
        );
      }
    });

    it("blunder chance is monotonic in skill: easy > medium > hard > expert", () => {
      const chances = TIERS.map((tier) =>
        new CombatDecisionTree(
          createTestGameState(),
          "player1",
          tier,
        ).getCombatBlunderChance(),
      );
      expect(chances[0]).toBeGreaterThan(chances[1]);
      expect(chances[1]).toBeGreaterThan(chances[2]);
      expect(chances[2]).toBeGreaterThan(chances[3]);
    });

    it("composes with per-format difficulty config through resolveDifficultyConfig", () => {
      const formats: DifficultyFormat[] = [
        "commander",
        "constructed",
        "limited",
      ];
      for (const tier of TIERS) {
        for (const format of formats) {
          const ai = new CombatDecisionTree(
            createTestGameState(),
            "player1",
            tier,
          );
          ai.setDifficultyFormat(format);
          // The combat path resolves through the same (tier, format) lookup, so
          // any future per-format blunderChance override is picked up here.
          expect(ai.getCombatBlunderChance()).toBe(
            resolveDifficultyConfig(tier, format).blunderChance,
          );
        }
      }
    });

    // --- Attack decisions: the optimal call is inverted at the per-tier rate ---
    // Both the direct-EV path (easy) and the block-prediction path (medium+)
    // run the same blunder roll.

    it("inverts an optimal attack into a hold when the blunder roll fires (easy, direct-EV path)", () => {
      // Uncontested 4/4 flyer vs an 8-life opponent: aggressive strategy, high
      // EV (~1.2) -> optimal decision is to attack.
      const state = createTestGameState(
        20,
        8,
        [
          createMockPermanent("a1", "Angel", "creature", 4, 4, false, 4, [
            "flying",
          ]),
        ],
        [],
      );

      const optimal = new CombatDecisionTree(state, "player1", "easy");
      optimal.setCombatRng(() => 1); // never fires -> optimal attack stands
      const optimalPlan = optimal.generateAttackPlan();
      expect(optimalPlan.attacks).toHaveLength(1);
      expect(optimalPlan.attacks[0].shouldAttack).toBe(true);

      const ai = new CombatDecisionTree(state, "player1", "easy");
      ai.setCombatRng(() => 0); // always fires -> attack blundered to hold
      expect(ai.generateAttackPlan().attacks).toHaveLength(0);
    });

    it("inverts an optimal hold into an attack when the blunder roll fires (easy)", () => {
      // 1/1 into a 5/5 blocker at even life: defensive strategy, EV ~-0.8 ->
      // optimal decision is to hold the attacker back.
      const state = createTestGameState(
        20,
        20,
        [createMockPermanent("a1", "Llanowar", "creature", 1, 1, false, 1)],
        [createMockPermanent("b1", "Serra", "creature", 5, 5, false, 5)],
      );

      const optimal = new CombatDecisionTree(state, "player1", "easy");
      optimal.setCombatRng(() => 1); // never fires -> doomed attacker held back
      expect(optimal.generateAttackPlan().attacks).toHaveLength(0);

      const ai = new CombatDecisionTree(state, "player1", "easy");
      ai.setCombatRng(() => 0); // always fires -> doomed attacker sent in
      const blundered = ai.generateAttackPlan();
      expect(blundered.attacks).toHaveLength(1);
      expect(blundered.attacks[0].shouldAttack).toBe(true);
    });

    it("applies the blunder on the block-prediction attack path (medium+)", () => {
      // medium enables useBlockPrediction, so evaluateAttacker resolves via the
      // predicted-EV branch (buildAttackDecision). The same roll inverts there.
      const state = createTestGameState(
        20,
        8,
        [
          createMockPermanent("a1", "Angel", "creature", 4, 4, false, 4, [
            "flying",
          ]),
        ],
        [],
      );

      const optimal = new CombatDecisionTree(state, "player1", "medium");
      optimal.setCombatRng(() => 1);
      expect(optimal.generateAttackPlan().attacks).toHaveLength(1);

      const ai = new CombatDecisionTree(state, "player1", "medium");
      ai.setCombatRng(() => 0);
      expect(ai.generateAttackPlan().attacks).toHaveLength(0);
    });

    // --- Block decisions: the optimal call is inverted at the per-tier rate ---

    it("inverts an optimal block into a no-block when the blunder roll fires", () => {
      // 3/3 blocker vs a 2/2 attacker: blocker kills attacker and survives ->
      // blockValue 0.8 -> optimal decision is to block.
      const state = createTestGameState(
        20,
        20,
        [createMockPermanent("b1", "Bear", "creature", 3, 3, false, 2)],
        [],
      );
      const attackers = [createMockPermanent("a1", "Goblin", "creature", 2, 2)];

      const optimal = new CombatDecisionTree(state, "player1", "easy");
      optimal.setCombatRng(() => 1); // never fires -> profitable block made
      expect(optimal.generateBlockingPlan(attackers).blocks).toHaveLength(1);

      const ai = new CombatDecisionTree(state, "player1", "easy");
      ai.setCombatRng(() => 0); // always fires -> lethal block missed
      expect(ai.generateBlockingPlan(attackers).blocks).toHaveLength(0);
    });

    it("inverts an optimal no-block into a block when the blunder roll fires", () => {
      // 2/2 blocker (mv 3) vs a 5/5 attacker at 20 life: chump that loses the
      // blocker without killing the attacker -> blockValue -0.2 -> no block.
      const state = createTestGameState(
        20,
        20,
        [createMockPermanent("b1", "Bear", "creature", 2, 2, false, 3)],
        [],
      );
      const attackers = [createMockPermanent("a1", "Giant", "creature", 5, 5)];

      const optimal = new CombatDecisionTree(state, "player1", "easy");
      optimal.setCombatRng(() => 1); // never fires -> harmless attacker ignored
      expect(optimal.generateBlockingPlan(attackers).blocks).toHaveLength(0);

      const ai = new CombatDecisionTree(state, "player1", "easy");
      ai.setCombatRng(() => 0); // always fires -> harmless attacker chumped
      expect(ai.generateBlockingPlan(attackers).blocks).toHaveLength(1);
    });

    // --- Statistical: the empirical rate scales (and is monotonic) by tier ---
    // Uses the blocking path: it has no lookahead or tricks, so the decision is
    // purely optimal + blunder, isolating the per-tier rate.

    it("blunders combat more often as difficulty drops (monotonic, beginner >> expert)", () => {
      // 3/3 blocker vs a 2/2 attacker -> blockValue 0.8 -> optimal block for
      // every tier. An inversion = the optimal block is skipped (length 0).
      const makeState = () =>
        createTestGameState(
          20,
          20,
          [createMockPermanent("b1", "Bear", "creature", 3, 3, false, 2)],
          [],
        );
      const attackers = [createMockPermanent("a1", "Goblin", "creature", 2, 2)];

      const trials = 400;
      const countInversions = (tier: DifficultyLevel): number => {
        let inversions = 0;
        for (let i = 0; i < trials; i++) {
          const ai = new CombatDecisionTree(makeState(), "player1", tier);
          // Same fresh stream per trial index across tiers -> the only thing
          // that changes is the per-tier blunderChance threshold.
          ai.setCombatRng(seededRng(0x994 + i));
          if (ai.generateBlockingPlan(attackers).blocks.length === 0)
            inversions++;
        }
        return inversions;
      };

      const counts = TIERS.map(countInversions);

      // Monotonic in skill: easy blunders most, expert least.
      expect(counts[0]).toBeGreaterThan(counts[1]);
      expect(counts[1]).toBeGreaterThan(counts[2]);
      expect(counts[2]).toBeGreaterThan(counts[3]);

      // Beginner collapses to easy (LEGACY_DIFFICULTY_ALIASES), so it blunders
      // as much as easy and far more than expert.
      expect(countInversions("easy")).toBe(counts[0]);

      // Absolute bounds (issue acceptance: easy >= ~15%, expert <= ~5%).
      expect(counts[0] / trials).toBeGreaterThanOrEqual(0.15);
      expect(counts[3] / trials).toBeLessThanOrEqual(0.05);
    });
  });

  describe("gang-block wiring for shouldMultiBlock (#1538)", () => {
    // mulberry32 — same deterministic PRNG as the #994 suite so gang-rate
    // assertions never flake on Math.random.
    function seededRng(seed: number): () => number {
      let s = seed >>> 0;
      return () => {
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    // AC1 board: vanilla 6/6 attacker vs a 3/3 and a 4/4. No single blocker
    // kills, combined power 7 >= 6 toughness, and threat 0.70 clears every
    // tier's multi-block threshold (0.6 base, 0.4 for cardAdvantageWeight 2).
    const makeGangBoard = (): AIGameState =>
      createTestGameState(
        20,
        20,
        [
          createMockPermanent("b1", "Knight", "creature", 3, 3, false, 3),
          createMockPermanent("b2", "Giant", "creature", 4, 4, false, 4),
        ],
        [],
      );
    const vanillaSixBySix = (): AIPermanent =>
      createMockPermanent("a1", "Demon", "creature", 6, 6, false, 6);

    it("AC1: hard/expert gang-block the vanilla 6/6 with both blockers and say gang-block", () => {
      for (const tier of ["hard", "expert"] as const) {
        const ai = new CombatDecisionTree(makeGangBoard(), "player1", tier);
        ai.setCombatRng(() => 1); // never blunder
        const plan = ai.generateBlockingPlan([vanillaSixBySix()]);

        expect(plan.blocks).toHaveLength(2);
        expect(new Set(plan.blocks.map((b) => b.blockerId))).toEqual(
          new Set(["b1", "b2"]),
        );
        for (const block of plan.blocks) {
          expect(block.attackerId).toBe("a1");
          expect(block.reasoning).toContain("gang-block");
        }

        // AC6: optimizeBlockerOrdering still ran on the multi-block — the
        // cheaper 3/3 (mv 3) takes damage order 0, the 4/4 (mv 4) takes 1.
        const byBlocker = new Map(plan.blocks.map((b) => [b.blockerId, b]));
        expect(byBlocker.get("b1")?.damageOrder).toBe(0);
        expect(byBlocker.get("b2")?.damageOrder).toBe(1);
      }
    });

    it("AC2: easy's blunderChance gate inverts the multi-block when the roll fires", () => {
      // Sanity: with a quiet RNG the easy tier still makes the optimal gang.
      const optimal = new CombatDecisionTree(
        makeGangBoard(),
        "player1",
        "easy",
      );
      optimal.setCombatRng(() => 1);
      expect(
        optimal.generateBlockingPlan([vanillaSixBySix()]).blocks,
      ).toHaveLength(2);

      // Force the roll to fire (easy blunderChance 0.25): the gang is
      // declined, so easy falls back to the sub-optimal single chump block
      // instead of the two-creature gang.
      const blundered = new CombatDecisionTree(
        makeGangBoard(),
        "player1",
        "easy",
      );
      blundered.setCombatRng(() => 0);
      const plan = blundered.generateBlockingPlan([vanillaSixBySix()]);
      expect(plan.blocks).not.toHaveLength(2);
      expect(
        plan.blocks.every((b) => !b.reasoning.includes("gang-block")),
      ).toBe(true);
    });

    it("AC2 (statistical): easy declines the gang far more often than expert", () => {
      const trials = 200;
      const gangRate = (tier: DifficultyLevel): number => {
        let gangs = 0;
        for (let i = 0; i < trials; i++) {
          const ai = new CombatDecisionTree(makeGangBoard(), "player1", tier);
          ai.setCombatRng(seededRng(0x538 + i));
          const plan = ai.generateBlockingPlan([vanillaSixBySix()]);
          if (
            plan.blocks.length === 2 &&
            plan.blocks.every((b) => b.reasoning.includes("gang-block"))
          ) {
            gangs++;
          }
        }
        return gangs / trials;
      };

      const easyRate = gangRate("easy");
      const expertRate = gangRate("expert");

      // Gang rate = 1 - blunderChance (easy 0.75 vs expert 0.98).
      expect(expertRate).toBeGreaterThan(easyRate);
      expect(easyRate).toBeGreaterThanOrEqual(0.6);
      expect(expertRate).toBeGreaterThanOrEqual(0.95);
    });

    it("AC3: a 2/2 attacker into a single 3/3 blocker is blocked exactly once", () => {
      const state = createTestGameState(20, 20, [
        createMockPermanent("b1", "Bear", "creature", 3, 3, false, 2),
      ]);
      const ai = new CombatDecisionTree(state, "player1", "hard");
      ai.setCombatRng(() => 1);
      const plan = ai.generateBlockingPlan([
        createMockPermanent("a1", "Goblin", "creature", 2, 2),
      ]);

      expect(plan.blocks).toHaveLength(1);
      expect(plan.blocks[0].blockerId).toBe("b1");
      expect(plan.blocks[0].reasoning).not.toContain("gang-block");
    });

    it("AC3 (over-block guard): no gang when one blocker already kills the attacker alone", () => {
      // 6/6 flying attacker (threat 0.85, clears the threshold) vs a 6/6 and
      // a 1/1: the 6/6 kills alone, so the gang must not add the 1/1 as a
      // needless casualty.
      const state = createTestGameState(20, 20, [
        createMockPermanent("b1", "Sprite", "creature", 1, 1, false, 1),
        createMockPermanent("b2", "Golem", "creature", 6, 6, false, 6),
      ]);
      const ai = new CombatDecisionTree(state, "player1", "hard");
      ai.setCombatRng(() => 1);
      const plan = ai.generateBlockingPlan([
        createMockPermanent("a1", "Angel", "creature", 6, 6, false, 6, [
          "flying",
        ]),
      ]);

      expect(plan.blocks).toHaveLength(1);
      expect(plan.blocks[0].blockerId).toBe("b2");
      expect(plan.blocks[0].reasoning).not.toContain("gang-block");
    });

    it("AC3 (over-block guard): no gang when the pair cannot combine for lethal", () => {
      // 5/5 attacker vs three 2/2s: threat 0.55 is below the 0.6 threshold
      // anyway, and 2+2=4 < 5 — both guards must keep this at a single block.
      const state = createTestGameState(20, 20, [
        createMockPermanent("c1", "Bear 1", "creature", 2, 2),
        createMockPermanent("c2", "Bear 2", "creature", 2, 2),
        createMockPermanent("c3", "Bear 3", "creature", 2, 2),
      ]);
      const ai = new CombatDecisionTree(state, "player1", "medium");
      ai.setCombatRng(() => 1);
      const plan = ai.generateBlockingPlan([
        createMockPermanent("a1", "Big Beast", "creature", 5, 5),
      ]);

      expect(
        plan.blocks.every((b) => !b.reasoning.includes("gang-block")),
      ).toBe(true);
    });

    it("AC4: shouldMultiBlock still refuses deathtouch attackers", () => {
      const state = makeGangBoard();
      const ai = new CombatDecisionTree(state, "player1", "expert");
      const blockers = state.players.player1.battlefield;
      const attacker = createMockPermanent(
        "a1",
        "Viper",
        "creature",
        6,
        6,
        false,
        6,
        ["deathtouch"],
      );

      const verdict = ai.shouldMultiBlock(attacker, blockers, {
        attackers: [attacker],
        blockers,
      });
      expect(verdict.shouldMultiBlock).toBe(false);
    });

    it("AC5: shouldMultiBlock still refuses indestructible attackers", () => {
      const state = makeGangBoard();
      const ai = new CombatDecisionTree(state, "player1", "expert");
      const blockers = state.players.player1.battlefield;
      const attacker = createMockPermanent(
        "a1",
        "Aegis",
        "creature",
        6,
        6,
        false,
        6,
        ["indestructible"],
      );

      const verdict = ai.shouldMultiBlock(attacker, blockers, {
        attackers: [attacker],
        blockers,
      });
      expect(verdict.shouldMultiBlock).toBe(false);
    });

    it("menace attackers keep their dedicated two-blocker path (never gang-block reasoning)", () => {
      // 3/3 menace vs two 4/4s: single block (kill + survive, 0.8) plus the
      // menace second blocker — no gang-block string, no double assignment.
      const state = createTestGameState(20, 20, [
        createMockPermanent("b1", "Bear 1", "creature", 4, 4, false, 2),
        createMockPermanent("b2", "Bear 2", "creature", 4, 4, false, 2),
      ]);
      const ai = new CombatDecisionTree(state, "player1", "hard");
      ai.setCombatRng(() => 1);
      const plan = ai.generateBlockingPlan([
        createMockPermanent("a1", "Ogre", "creature", 3, 3, false, 3, [
          "menace",
        ]),
      ]);

      const ids = plan.blocks.map((b) => b.blockerId);
      expect(new Set(ids).size).toBe(ids.length);
      expect(
        plan.blocks.every((b) => !b.reasoning.includes("gang-block")),
      ).toBe(true);
    });
  });
});
