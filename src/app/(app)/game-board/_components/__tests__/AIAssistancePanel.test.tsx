import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "@jest/globals";
import { AIAssistancePanel } from "../AIAssistancePanel";

/**
 * Issue #2978 (follow-up to #2946 / #2947) — the AI assistance panel was
 * extracted from the game-board page into its own component so the page's
 * first-load bundle stays under budget. These tests pin the rendering
 * behaviour the extraction must preserve:
 *
 *   - the panel chrome (role, label, title),
 *   - the board-evaluation block (win chance, colour thresholds, board
 *     advantage wording),
 *   - the three capped lists (suggested plays, warnings, mana advice) and
 *     their priority / severity styling,
 *   - the strategic-advice list,
 *   - and that every section disappears when it has no content.
 */

const NO_ANALYSIS = {
  aiAnalysis: null,
  aiManaAdvice: null,
  aiBoardEval: null,
};

describe("AIAssistancePanel", () => {
  it("renders the panel chrome", () => {
    render(<AIAssistancePanel {...NO_ANALYSIS} />);

    const panel = screen.getByRole("complementary");
    expect(panel).toBeDefined();
    expect(panel.getAttribute("aria-label")).toBe("AI Game Suggestions");
    expect(panel.getAttribute("aria-live")).toBe("polite");
    expect(screen.getByText("AI Suggestions")).toBeDefined();
  });

  it("renders nothing but the chrome when there is no analysis at all", () => {
    render(<AIAssistancePanel {...NO_ANALYSIS} />);

    expect(screen.queryByText("Suggested Plays:")).toBeNull();
    expect(screen.queryByText("Warnings:")).toBeNull();
    expect(screen.queryByText("Mana Usage:")).toBeNull();
    expect(screen.queryByText("Strategic Advice:")).toBeNull();
    expect(screen.queryByText("Win Chance:")).toBeNull();
  });

  describe("board evaluation", () => {
    it("renders a high win chance in green", () => {
      render(
        <AIAssistancePanel
          {...NO_ANALYSIS}
          aiBoardEval={{ playerWinChance: 75, boardAdvantage: "winning" }}
        />,
      );

      expect(screen.getByText("Win Chance:")).toBeDefined();
      expect(screen.getByText("75%")).toBeDefined();
      expect(screen.getByText("75%").className).toContain("text-green-500");
      expect(screen.getByText("Board: winning")).toBeDefined();
    });

    it("renders a middling win chance in yellow", () => {
      render(
        <AIAssistancePanel
          {...NO_ANALYSIS}
          aiBoardEval={{ playerWinChance: 45, boardAdvantage: "even" }}
        />,
      );

      expect(screen.getByText("45%").className).toContain("text-yellow-500");
    });

    it("renders a low win chance in red", () => {
      render(
        <AIAssistancePanel
          {...NO_ANALYSIS}
          aiBoardEval={{ playerWinChance: 20, boardAdvantage: "losing" }}
        />,
      );

      expect(screen.getByText("20%").className).toContain("text-red-500");
    });

    it("defaults a missing win chance to 0% (red)", () => {
      render(
        <AIAssistancePanel {...NO_ANALYSIS} aiBoardEval={{ boardAdvantage: "even" }} />,
      );

      expect(screen.getByText("0%")).toBeDefined();
      expect(screen.getByText("0%").className).toContain("text-red-500");
    });

    it("turns an underscored board advantage into readable wording", () => {
      render(
        <AIAssistancePanel
          {...NO_ANALYSIS}
          aiBoardEval={{ playerWinChance: 60, boardAdvantage: "slight_advantage" }}
        />,
      );

      expect(screen.getByText("Board: slight advantage")).toBeDefined();
    });

    it("renders the board label even without a board advantage", () => {
      render(<AIAssistancePanel {...NO_ANALYSIS} aiBoardEval={{}} />);

      expect(screen.getByText(/^Board:/)).toBeDefined();
    });
  });

  describe("suggested plays", () => {
    it("renders the card name and reasoning", () => {
      render(
        <AIAssistancePanel
          {...NO_ANALYSIS}
          aiAnalysis={{
            suggestedPlays: [
              {
                cardName: "Lightning Bolt",
                reasoning: "Deal 3 damage to the attacking bear.",
                priority: "high",
              },
            ],
          }}
        />,
      );

      expect(screen.getByText("Suggested Plays:")).toBeDefined();
      expect(screen.getByText("Lightning Bolt")).toBeDefined();
      expect(
        screen.getByText("Deal 3 damage to the attacking bear."),
      ).toBeDefined();
    });

    it("caps the list at three entries", () => {
      render(
        <AIAssistancePanel
          {...NO_ANALYSIS}
          aiAnalysis={{
            suggestedPlays: Array.from({ length: 5 }, (_, i) => ({
              cardName: `Card ${i}`,
              reasoning: `Reason ${i}`,
              priority: "low" as const,
            })),
          }}
        />,
      );

      expect(screen.getByText("Card 0")).toBeDefined();
      expect(screen.getByText("Card 2")).toBeDefined();
      expect(screen.queryByText("Card 3")).toBeNull();
      expect(screen.queryByText("Card 4")).toBeNull();
    });

    it("colours each entry by priority", () => {
      render(
        <AIAssistancePanel
          {...NO_ANALYSIS}
          aiAnalysis={{
            suggestedPlays: [
              { cardName: "High", reasoning: "r", priority: "high" },
              { cardName: "Medium", reasoning: "r", priority: "medium" },
              { cardName: "Low", reasoning: "r", priority: "low" },
            ],
          }}
        />,
      );

      expect(screen.getByText("High").parentElement!.className).toContain(
        "border-green-500",
      );
      expect(screen.getByText("Medium").parentElement!.className).toContain(
        "border-yellow-500",
      );
      expect(screen.getByText("Low").parentElement!.className).toContain(
        "bg-gray-50",
      );
    });

    it("hides the section for an empty list", () => {
      render(
        <AIAssistancePanel {...NO_ANALYSIS} aiAnalysis={{ suggestedPlays: [] }} />,
      );

      expect(screen.queryByText("Suggested Plays:")).toBeNull();
    });
  });

  describe("warnings", () => {
    it("renders the warning messages", () => {
      render(
        <AIAssistancePanel
          {...NO_ANALYSIS}
          aiAnalysis={{
            warnings: [
              { message: "You are tapped out.", type: "danger" },
              { message: "Opponent has a big board.", type: "warning" },
            ],
          }}
        />,
      );

      expect(screen.getByText("Warnings:")).toBeDefined();
      expect(screen.getByText("You are tapped out.")).toBeDefined();
      expect(screen.getByText("Opponent has a big board.")).toBeDefined();
    });

    it("caps the list at two entries", () => {
      render(
        <AIAssistancePanel
          {...NO_ANALYSIS}
          aiAnalysis={{
            warnings: [
              { message: "First", type: "info" },
              { message: "Second", type: "info" },
              { message: "Third", type: "info" },
            ],
          }}
        />,
      );

      expect(screen.getByText("First")).toBeDefined();
      expect(screen.getByText("Second")).toBeDefined();
      expect(screen.queryByText("Third")).toBeNull();
    });

    it("colours danger warnings differently from other warnings", () => {
      render(
        <AIAssistancePanel
          {...NO_ANALYSIS}
          aiAnalysis={{
            warnings: [
              { message: "Fatal", type: "danger" },
              { message: "Heads up", type: "caution" },
            ],
          }}
        />,
      );

      expect(screen.getByText("Fatal").className).toContain("text-red-700");
      expect(screen.getByText("Heads up").className).toContain("text-amber-700");
    });

    it("hides the section for an empty list", () => {
      render(
        <AIAssistancePanel {...NO_ANALYSIS} aiAnalysis={{ warnings: [] }} />,
      );

      expect(screen.queryByText("Warnings:")).toBeNull();
    });
  });

  describe("mana advice", () => {
    it("renders the suggestion action and reasoning", () => {
      render(
        <AIAssistancePanel
          {...NO_ANALYSIS}
          aiManaAdvice={{
            suggestions: [
              { action: "Cast both lands", reasoning: "You have mana left." },
            ],
          }}
        />,
      );

      expect(screen.getByText("Mana Usage:")).toBeDefined();
      expect(screen.getByText("Cast both lands")).toBeDefined();
      expect(screen.getByText("You have mana left.")).toBeDefined();
    });

    it("caps the list at two entries", () => {
      render(
        <AIAssistancePanel
          {...NO_ANALYSIS}
          aiManaAdvice={{
            suggestions: [
              { action: "First", reasoning: "r" },
              { action: "Second", reasoning: "r" },
              { action: "Third", reasoning: "r" },
            ],
          }}
        />,
      );

      expect(screen.getByText("First")).toBeDefined();
      expect(screen.getByText("Second")).toBeDefined();
      expect(screen.queryByText("Third")).toBeNull();
    });

    it("hides the section when there is no mana advice", () => {
      render(
        <AIAssistancePanel
          {...NO_ANALYSIS}
          aiManaAdvice={{ suggestions: [] }}
        />,
      );

      expect(screen.queryByText("Mana Usage:")).toBeNull();
    });
  });

  describe("strategic advice", () => {
    it("renders every advice line", () => {
      render(
        <AIAssistancePanel
          {...NO_ANALYSIS}
          aiAnalysis={{
            strategicAdvice: ["Play around the counter spell.", "Hold up your bomb."],
          }}
        />,
      );

      expect(screen.getByText("Strategic Advice:")).toBeDefined();
      expect(
        screen.getByText("• Play around the counter spell."),
      ).toBeDefined();
      expect(screen.getByText("• Hold up your bomb.")).toBeDefined();
    });

    it("caps the list at two entries", () => {
      render(
        <AIAssistancePanel
          {...NO_ANALYSIS}
          aiAnalysis={{
            strategicAdvice: ["One", "Two", "Three"],
          }}
        />,
      );

      expect(screen.getByText("• One")).toBeDefined();
      expect(screen.getByText("• Two")).toBeDefined();
      expect(screen.queryByText("• Three")).toBeNull();
    });

    it("hides the section for an empty list", () => {
      render(
        <AIAssistancePanel
          {...NO_ANALYSIS}
          aiAnalysis={{ strategicAdvice: [] }}
        />,
      );

      expect(screen.queryByText("Strategic Advice:")).toBeNull();
    });
  });

  it("renders every section together", () => {
    render(
      <AIAssistancePanel
        aiAnalysis={{
          suggestedPlays: [
            { cardName: "Bolt", reasoning: "Kill it", priority: "high" },
          ],
          warnings: [{ message: "Watch out", type: "warning" }],
          strategicAdvice: ["Ramp first"],
        }}
        aiManaAdvice={{
          suggestions: [{ action: "Tap lands", reasoning: "Need mana" }],
        }}
        aiBoardEval={{ playerWinChance: 80, boardAdvantage: "winning" }}
      />,
    );

    expect(screen.getByText("AI Suggestions")).toBeDefined();
    expect(screen.getByText("Win Chance:")).toBeDefined();
    expect(screen.getByText("Suggested Plays:")).toBeDefined();
    expect(screen.getByText("Warnings:")).toBeDefined();
    expect(screen.getByText("Mana Usage:")).toBeDefined();
    expect(screen.getByText("Strategic Advice:")).toBeDefined();
  });
});
