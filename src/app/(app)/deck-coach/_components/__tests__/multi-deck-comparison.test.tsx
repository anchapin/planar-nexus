/**
 * @fileoverview Tests for the MultiDeckComparison dropzone/upload UI (issue #2164).
 *
 * These tests cover:
 * - Dropzone rendering
 * - Drag state changes
 * - File type validation (.txt and .dec only)
 *
 * Note: File upload tests are tested manually or via E2E tests due to
 * jsdom File API limitations (File.text() not implemented).
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { render, screen, fireEvent } from "@testing-library/react";
import { MultiDeckComparison } from "../multi-deck-comparison";

const toastMock = jest.fn();
jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

jest.mock("@/hooks/use-local-storage", () => ({
  useLocalStorage: jest.fn(() => [[], jest.fn(), { loading: false }]),
}));

beforeEach(() => {
  toastMock.mockReset();
});

describe("MultiDeckComparison dropzone", () => {
  it("renders the dropzone section", () => {
    render(<MultiDeckComparison />);
    expect(screen.getByText(/drag and drop a deck file/i)).toBeInTheDocument();
    expect(screen.getByText(/upload deck file/i)).toBeInTheDocument();
    expect(screen.getByText(/\.txt and \.dec files/i)).toBeInTheDocument();
  });

  it("shows drag-over styling when dragging over the dropzone", () => {
    render(<MultiDeckComparison />);

    const dropzone = screen.getByText(
      /drag and drop a deck file/i,
    ).parentElement!;
    const dragEvent = Object.assign(new Event("dragover", { bubbles: true }), {
      dataTransfer: { files: [] },
    });

    fireEvent(dropzone, dragEvent);
    expect(dropzone).toHaveClass(/border-primary/);
    expect(dropzone).toHaveClass(/bg-primary\/5/);
  });

  it("removes drag-over styling when dragging leaves the dropzone", () => {
    render(<MultiDeckComparison />);

    const dropzone = screen.getByText(
      /drag and drop a deck file/i,
    ).parentElement!;

    // Simulate drag over
    const dragOverEvent = Object.assign(
      new Event("dragover", { bubbles: true }),
      {
        dataTransfer: { files: [] },
      },
    );
    fireEvent(dropzone, dragOverEvent);

    // Simulate drag leave
    fireEvent.dragLeave(dropzone);

    // After drag leave, the styling should be removed (reverts to default)
    expect(dropzone).not.toHaveClass(/border-primary/);
  });

  it("only accepts .txt and .dec files", () => {
    render(<MultiDeckComparison />);

    const fileInput = screen
      .getByText("Upload deck file")
      .closest("label")!
      .querySelector("input[type=file]") as HTMLInputElement;

    // The file input should accept .txt and .dec files
    expect(fileInput.getAttribute("accept")).toBe(".txt,.dec");
  });

  it("shows the empty state message when no decks are available", () => {
    render(<MultiDeckComparison />);
    expect(screen.getByText(/no saved decks yet/i)).toBeInTheDocument();
    expect(screen.getByText(/import a deck file below/i)).toBeInTheDocument();
  });
});
