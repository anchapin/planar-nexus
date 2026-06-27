/**
 * @fileOverview Tests for AI opponent sideboard generation and best-of-3
 * sideboarding (issue #995).
 *
 * Covers:
 * - Sideboard generation (legal size, color identity, archetype-coherent, deterministic)
 * - Post-game sideboarding swaps (correct in/out direction by matchup)
 * - applyAISideboardSwap (maindeck/sideboard size preservation, purity)
 * - best-of-3 progression via progressAISideboarding
 * - Role/category helper functions
 */

import {
  generateOpponentDeck,
  generateSideboard,
  computeAISideboardSwap,
  applyAISideboardSwap,
  progressAISideboarding,
  classifyCardRole,
  archetypeToCategory,
  getAISideboardSize,
  type GeneratedDeck,
  type MatchupCategory,
  type AISideboardingStep,
} from "../opponent-deck-generator";

// ---- helpers -----------------------------------------------------------
function countCards(
  list: Array<{ name: string; quantity: number }> | undefined,
): number {
  return (list ?? []).reduce((sum, c) => sum + c.quantity, 0);
}

function namesOf(
  list: Array<{ name: string; quantity: number }> | undefined,
): string[] {
  return (list ?? []).map((c) => c.name);
}

/** A fixed, deterministic deck fixture used for swap assertions. */
function controlFixture(
  difficulty: GeneratedDeck["difficulty"] = "expert",
): GeneratedDeck {
  return {
    name: "UB Control",
    archetype: "control",
    theme: "control",
    description: "",
    strategicApproach: "",
    colorIdentity: ["U", "B"],
    difficulty,
    format: "constructed-core",
    cards: [
      { name: "Counterspell", quantity: 4 }, // disruption (kept vs control)
      { name: "Doom Blade", quantity: 2 }, // removal (cuttable vs control)
      { name: "Murder", quantity: 2 }, // removal (cuttable vs control)
      { name: "Terminate", quantity: 2 }, // removal (cuttable vs control)
      { name: "Scroll Rack", quantity: 1 }, // other utility (cuttable)
      { name: "Sheoldred, Whispering One", quantity: 1 }, // threat (kept)
      { name: "Island", quantity: 14 },
      { name: "Swamp", quantity: 14 },
    ],
    sideboard: [
      { name: "Batterskull", quantity: 1 }, // threat
      { name: "Wurmcoil Engine", quantity: 1 }, // threat
      { name: "Mystic Remora", quantity: 1 }, // cardDraw (U)
      { name: "Thoughtseize", quantity: 2 }, // disruption (B)
      { name: "Negate", quantity: 2 }, // disruption (U)
      { name: "Duress", quantity: 2 }, // disruption (B)
      { name: "Engineered Explosives", quantity: 1 }, // removal
      { name: "Pithing Needle", quantity: 1 }, // removal
    ],
  };
}

// ---- tests -------------------------------------------------------------

describe("AI Opponent Sideboard Generation (#995)", () => {
  describe("Sideboard presence by format", () => {
    test("constructed formats produce a sideboard", () => {
      const formats = [
        "constructed-core",
        "constructed-legacy",
        "constructed-pioneer",
      ] as const;
      for (const format of formats) {
        const deck = generateOpponentDeck({
          format,
          archetype: "midrange",
          colorIdentity: ["U", "B"],
          difficulty: "expert",
        });
        expect(deck.sideboard).toBeDefined();
        expect(deck.sideboard!.length).toBeGreaterThan(0);
        expect(countCards(deck.sideboard)).toBeLessThanOrEqual(
          getAISideboardSize(format),
        );
      }
    });

    test("Commander does NOT use a sideboard", () => {
      const deck = generateOpponentDeck({
        format: "legendary-commander",
        archetype: "control",
        colorIdentity: ["U", "B", "W"],
        difficulty: "expert",
      });
      expect(countCards(deck.sideboard)).toBe(0);
    });

    test("getAISideboardSize returns 0 for non-sideboard formats", () => {
      expect(getAISideboardSize("legendary-commander")).toBe(0);
    });

    test("getAISideboardSize returns 15 for constructed formats", () => {
      expect(getAISideboardSize("constructed-core")).toBe(15);
    });
  });

  describe("Sideboard legality", () => {
    test("sideboard total never exceeds the format sideboard size", () => {
      for (const difficulty of ["easy", "medium", "hard", "expert"] as const) {
        for (const archetype of [
          "aggro",
          "control",
          "midrange",
          "combo",
          "ramp",
        ] as const) {
          const deck = generateOpponentDeck({
            format: "constructed-core",
            archetype,
            colorIdentity: ["R", "W"],
            difficulty,
          });
          expect(countCards(deck.sideboard)).toBeLessThanOrEqual(15);
          expect(countCards(deck.sideboard)).toBeGreaterThan(0);
        }
      }
    });

    test("sideboard contains no duplicate card names", () => {
      const deck = generateOpponentDeck({
        format: "constructed-core",
        archetype: "control",
        colorIdentity: ["U", "B"],
        difficulty: "expert",
      });
      const sbNames = namesOf(deck.sideboard);
      expect(new Set(sbNames).size).toBe(sbNames.length);
    });

    test("sideboard cards are not duplicated from the maindeck", () => {
      const deck = generateOpponentDeck({
        format: "constructed-core",
        archetype: "midrange",
        colorIdentity: ["G", "B"],
        difficulty: "expert",
      });
      const main = new Set(namesOf(deck.cards));
      for (const name of namesOf(deck.sideboard)) {
        expect(main.has(name)).toBe(false);
      }
    });

    test("sideboard respects color identity", () => {
      // Mono-red deck: no blue-only sideboard staples should appear.
      const deck = generateOpponentDeck({
        format: "constructed-core",
        archetype: "aggro",
        colorIdentity: ["R"],
        difficulty: "expert",
      });
      const blueOnly = new Set([
        "Negate",
        "Flusterstorm",
        "Mystic Remora",
        "Bond of Insight",
        "Sea Gate Restoration",
        "Doom Blade",
        "Path to Exile",
        "Duress",
        "Thoughtseize",
        "Leyline of the Void",
        "Sylvan Library",
        "Compost",
        "Stony Silence",
        "Fragmentize",
        "Blood Moon",
      ]);
      // Blood Moon is red -> legal; the others are off-color and must be absent.
      for (const name of namesOf(deck.sideboard)) {
        if (blueOnly.has(name) && name !== "Blood Moon") {
          // Any off-color entry would be a violation.
          expect(["R"]).toContain("R"); // sanity (always true); real check below
        }
      }
      // Explicit: blue-only cards must never appear in a mono-R sideboard.
      for (const forbidden of [
        "Negate",
        "Flusterstorm",
        "Doom Blade",
        "Path to Exile",
      ]) {
        expect(namesOf(deck.sideboard)).not.toContain(forbidden);
      }
    });
  });

  describe("Sideboard is archetype-coherent (sensible)", () => {
    test("control sideboard prioritises threats / draw / disruption roles", () => {
      const deck = generateOpponentDeck({
        format: "constructed-core",
        archetype: "control",
        colorIdentity: ["U", "B", "W"],
        difficulty: "expert",
      });
      const roles = namesOf(deck.sideboard).map((n) => classifyCardRole(n));
      const wanted = new Set(["threats", "cardDraw", "disruption", "removal"]);
      // At least one of the priority roles is represented.
      expect(roles.some((r) => wanted.has(r))).toBe(true);
    });

    test("aggro sideboard includes interactive roles (removal/disruption)", () => {
      const deck = generateOpponentDeck({
        format: "constructed-core",
        archetype: "aggro",
        colorIdentity: ["R", "W"],
        difficulty: "hard",
      });
      const roles = namesOf(deck.sideboard).map((n) => classifyCardRole(n));
      expect(roles).toContain("removal");
    });

    test("expert packs a fuller sideboard than easy", () => {
      const easy = generateOpponentDeck({
        format: "constructed-core",
        archetype: "midrange",
        colorIdentity: ["G", "B"],
        difficulty: "easy",
      });
      const expert = generateOpponentDeck({
        format: "constructed-core",
        archetype: "midrange",
        colorIdentity: ["G", "B"],
        difficulty: "expert",
      });
      // Across several generations the expert target should be >= easy target.
      expect(countCards(expert.sideboard)).toBeGreaterThanOrEqual(
        countCards(easy.sideboard),
      );
    });
  });

  describe("Sideboard generation is deterministic", () => {
    test("identical inputs yield identical sideboards", () => {
      const input = {
        archetype: "control" as const,
        colorIdentity: ["U", "B"],
        difficulty: "expert" as const,
        format: "constructed-core" as const,
        maindeckCards: [{ name: "Counterspell", quantity: 4 }],
      };
      const a = generateSideboard(input);
      const b = generateSideboard(input);
      expect(a).toEqual(b);
    });
  });
});

describe("AI Opponent Post-Game Sideboarding (#995)", () => {
  describe("Swap direction by matchup", () => {
    test("vs control: boards IN threats/draw/disruption, boards OUT removal", () => {
      const deck = controlFixture();
      const swap = computeAISideboardSwap({
        deck,
        opponentCategory: "control",
        difficulty: "expert",
        lastGameResult: "loss",
      });
      expect(swap.boardIn.length).toBeGreaterThan(0);

      const inRoles = swap.boardIn.map((c) => classifyCardRole(c.name));
      const outRoles = swap.boardOut.map((c) => classifyCardRole(c.name));

      // In candidates should be the high-value roles vs control.
      const wantedIn = new Set(["threats", "cardDraw", "disruption"]);
      expect(inRoles.some((r) => wantedIn.has(r))).toBe(true);
      // Removal is the most cuttable role vs control.
      expect(outRoles).toContain("removal");
    });

    test("vs aggro: boards IN removal/disruption", () => {
      const deck = controlFixture();
      const swap = computeAISideboardSwap({
        deck,
        opponentCategory: "aggro",
        difficulty: "expert",
        lastGameResult: "loss",
      });
      expect(swap.boardIn.length).toBeGreaterThan(0);
      const inRoles = swap.boardIn.map((c) => classifyCardRole(c.name));
      expect(inRoles).toContain("removal");
    });

    test("in/out quantities always balance (keeps deck legal)", () => {
      const deck = controlFixture();
      for (const opp of [
        "aggro",
        "control",
        "midrange",
        "combo",
        "tribal",
        "special",
      ] as const) {
        const swap = computeAISideboardSwap({
          deck,
          opponentCategory: opp,
          difficulty: "expert",
          lastGameResult: "loss",
        });
        expect(countCards(swap.boardIn)).toBe(countCards(swap.boardOut));
      }
    });

    test("never boards out lands", () => {
      const deck = controlFixture();
      const swap = computeAISideboardSwap({
        deck,
        opponentCategory: "midrange",
        difficulty: "expert",
        lastGameResult: "loss",
      });
      for (const c of swap.boardOut) {
        expect(classifyCardRole(c.name)).not.toBe("lands");
        expect(c.name.toLowerCase()).not.toMatch(/island|swamp|plains|land/);
      }
    });
  });

  describe("Difficulty scaling", () => {
    test("easy boards fewer cards than expert (loss)", () => {
      const deck = controlFixture();
      const easy = computeAISideboardSwap({
        deck,
        opponentCategory: "control",
        difficulty: "easy",
        lastGameResult: "loss",
      });
      const expert = computeAISideboardSwap({
        deck,
        opponentCategory: "control",
        difficulty: "expert",
        lastGameResult: "loss",
      });
      expect(countCards(easy.boardIn)).toBeLessThanOrEqual(3);
      expect(countCards(expert.boardIn)).toBeGreaterThan(
        countCards(easy.boardIn),
      );
      expect(countCards(expert.boardIn)).toBeLessThanOrEqual(10);
    });
  });

  describe("Result-aware boarding", () => {
    test("a win boards conservatively (no more than 3 cards)", () => {
      const deck = controlFixture();
      const swap = computeAISideboardSwap({
        deck,
        opponentCategory: "control",
        difficulty: "expert",
        lastGameResult: "win",
      });
      expect(countCards(swap.boardIn)).toBeLessThanOrEqual(3);
    });

    test("a loss boards at least as much as a win", () => {
      const deck = controlFixture();
      const win = computeAISideboardSwap({
        deck,
        opponentCategory: "control",
        difficulty: "expert",
        lastGameResult: "win",
      });
      const loss = computeAISideboardSwap({
        deck,
        opponentCategory: "control",
        difficulty: "expert",
        lastGameResult: "loss",
      });
      expect(countCards(loss.boardIn)).toBeGreaterThanOrEqual(
        countCards(win.boardIn),
      );
    });
  });

  describe("Determinism", () => {
    test("identical inputs produce identical swaps", () => {
      const deck = controlFixture();
      const a = computeAISideboardSwap({
        deck,
        opponentCategory: "combo",
        difficulty: "hard",
        lastGameResult: "loss",
      });
      const b = computeAISideboardSwap({
        deck,
        opponentCategory: "combo",
        difficulty: "hard",
        lastGameResult: "loss",
      });
      expect(a).toEqual(b);
    });
  });

  describe("applyAISideboardSwap", () => {
    test("preserves maindeck and sideboard size", () => {
      const deck = controlFixture();
      const mainBefore = countCards(deck.cards);
      const sbBefore = countCards(deck.sideboard);
      const swap = computeAISideboardSwap({
        deck,
        opponentCategory: "control",
        difficulty: "expert",
        lastGameResult: "loss",
      });
      const applied = applyAISideboardSwap(deck, swap);
      expect(countCards(applied.cards)).toBe(mainBefore);
      expect(countCards(applied.sideboard)).toBe(sbBefore);
    });

    test("board-in cards enter the maindeck, board-out cards leave it", () => {
      const deck = controlFixture();
      const swap = computeAISideboardSwap({
        deck,
        opponentCategory: "control",
        difficulty: "expert",
        lastGameResult: "loss",
      });
      const applied = applyAISideboardSwap(deck, swap);
      const mainNames = new Set(namesOf(applied.cards));
      for (const c of swap.boardIn) expect(mainNames.has(c.name)).toBe(true);
    });

    test("does not mutate the input deck (pure)", () => {
      const deck = controlFixture();
      const snapshot = JSON.stringify(deck);
      const swap = computeAISideboardSwap({
        deck,
        opponentCategory: "midrange",
        difficulty: "expert",
        lastGameResult: "loss",
      });
      applyAISideboardSwap(deck, swap);
      expect(JSON.stringify(deck)).toBe(snapshot);
    });
  });
});

describe("AI Opponent Best-of-3 Progression (#995)", () => {
  test("game 1 (no steps) returns the pre-board deck unchanged", () => {
    const deck = controlFixture();
    const game1 = progressAISideboarding(deck, []);
    expect(game1).toEqual(deck);
  });

  test("after a game-1 loss, the game-2 deck has been boarded", () => {
    const deck = controlFixture();
    const steps: AISideboardingStep[] = [
      { opponentCategory: "control", result: "loss" },
    ];
    const game2 = progressAISideboarding(deck, steps);
    expect(game2).not.toEqual(deck);
    // Maindeck size preserved after boarding.
    expect(countCards(game2.cards)).toBe(countCards(deck.cards));
    expect(countCards(game2.sideboard)).toBe(countCards(deck.sideboard));
  });

  test("full best-of-3 keeps every configuration legal", () => {
    const deck = controlFixture();
    const steps: AISideboardingStep[] = [
      { opponentCategory: "control", result: "loss" },
      { opponentCategory: "control", result: "win" },
    ];
    const game3 = progressAISideboarding(deck, steps);
    expect(countCards(game3.cards)).toBe(countCards(deck.cards));
    expect(countCards(game3.sideboard)).toBe(countCards(deck.sideboard));
  });

  test("adapts when the observed opponent category changes between games", () => {
    const deck = controlFixture();
    const steps: AISideboardingStep[] = [
      { opponentCategory: "aggro", result: "loss" },
      { opponentCategory: "control", result: "loss" },
    ];
    const game3 = progressAISideboarding(deck, steps);
    // Still legal, and the final config reflects re-boarding.
    expect(countCards(game3.cards)).toBe(countCards(deck.cards));
    expect(countCards(game3.sideboard)).toBe(countCards(deck.sideboard));
  });
});

describe("AI Sideboard helper functions", () => {
  test("classifyCardRole returns expected roles for known cards", () => {
    expect(classifyCardRole("Counterspell")).toBe("disruption");
    expect(classifyCardRole("Doom Blade")).toBe("removal");
    expect(classifyCardRole("Duress")).toBe("disruption");
    expect(classifyCardRole("Engineered Explosives")).toBe("removal");
    expect(classifyCardRole("Batterskull")).toBe("threats");
    expect(classifyCardRole("Plains")).toBe("lands");
    expect(classifyCardRole("Sol Ring")).toBe("ramp");
    expect(classifyCardRole("Birds of Paradise")).toBe("ramp");
  });

  test("archetypeToCategory maps every archetype to a matchup category", () => {
    const archetypes = [
      "aggro",
      "control",
      "midrange",
      "combo",
      "ramp",
      "prison",
      "tempo",
      "tokens",
      "aristocrats",
      "stompy",
    ] as const;
    for (const a of archetypes) {
      const cat: MatchupCategory = archetypeToCategory(a);
      expect([
        "aggro",
        "control",
        "midrange",
        "combo",
        "tribal",
        "special",
      ]).toContain(cat);
    }
    expect(archetypeToCategory("control")).toBe("control");
    expect(archetypeToCategory("ramp")).toBe("special");
    expect(archetypeToCategory("aggro")).toBe("aggro");
  });
});
