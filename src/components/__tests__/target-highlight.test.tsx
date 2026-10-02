/**
 * Battlefield cards show when they're a legal target (#2300).
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { BattlefieldCard } from "../virtualized-zone-strip";
import { TargetHighlightContext } from "../target-highlight-context";
import type { CardState } from "@/types/game";

describe("BattlefieldCard target highlight", () => {
  const card = {
    id: "card-1",
    card: { id: "scry-1", name: "Wolf", image_uris: undefined },
    tapped: false,
  } as unknown as CardState;

  it("marks a card that is a legal target", () => {
    render(
      <TargetHighlightContext.Provider value={new Set(["card-1"])}>
        <BattlefieldCard card={card} zone="battlefield" />
      </TargetHighlightContext.Provider>,
    );
    expect(screen.getByTestId("battlefield-card-wolf")).toHaveAttribute(
      "data-legal-target",
      "true",
    );
  });

  it("leaves other cards unmarked", () => {
    render(<BattlefieldCard card={card} zone="battlefield" />);
    expect(screen.getByTestId("battlefield-card-wolf")).not.toHaveAttribute(
      "data-legal-target",
    );
  });
});
