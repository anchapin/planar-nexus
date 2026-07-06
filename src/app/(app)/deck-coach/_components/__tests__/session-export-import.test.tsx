/**
 * @fileoverview Tests for the SessionExportImport UI (issue #1242).
 *
 * The component is a thin shell over two hook callbacks; these tests assert
 * the wiring (button click handlers, toast messages) without touching the real
 * IndexedDB store. The hook-level import/export paths are covered separately
 * in src/hooks/__tests__/use-deck-coach-chat.test.ts.
 */

import {
  describe,
  it,
  expect,
  jest,
  beforeEach,
} from "@jest/globals";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SessionExportImport } from "../session-export-import";

const toastMock = jest.fn();
jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

beforeEach(() => {
  toastMock.mockReset();
  // jsdom doesn't implement URL.createObjectURL/revokeObjectURL for our use,
  // but the export path still needs them to be callable.
  if (!global.URL.createObjectURL) {
    global.URL.createObjectURL = () => "blob:fake";
  }
  if (!global.URL.revokeObjectURL) {
    global.URL.revokeObjectURL = () => {};
  }
});

describe("SessionExportImport", () => {
  it("renders export and import buttons", () => {
    render(
      <SessionExportImport
        exportActiveDeckToJSON={jest.fn(async () => null)}
        importFromJSON={jest.fn(async () => ({
          imported: 0,
          skipped: 0,
          errors: [],
        })) as never}
      />,
    );
    expect(
      screen.getByRole("button", { name: /export/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /import/i }),
    ).toBeInTheDocument();
  });

  it("shows a friendly toast when there is nothing to export", async () => {
    const exportFn = jest.fn(async () => null);
    render(
      <SessionExportImport
        exportActiveDeckToJSON={exportFn}
        importFromJSON={jest.fn(async () => ({
          imported: 0,
          skipped: 0,
          errors: [],
        })) as never}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /export/i }));
    await waitFor(() => expect(exportFn).toHaveBeenCalledTimes(1));
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Nothing to export",
      }),
    );
  });

  it("calls the export hook with a success toast when JSON is produced", async () => {
    const json = JSON.stringify({
      type: "planar-nexus-coach-conversations",
      version: 1,
      exportedAt: new Date().toISOString(),
      deckId: "deck",
      conversations: [{ id: "c1" }],
    });
    const exportFn = jest.fn(async () => json);
    render(
      <SessionExportImport
        exportActiveDeckToJSON={exportFn}
        importFromJSON={jest.fn(async () => ({
          imported: 0,
          skipped: 0,
          errors: [],
        })) as never}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /export/i }));
    await waitFor(() => expect(exportFn).toHaveBeenCalledTimes(1));
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Sessions exported",
      }),
    );
  });

  it("surfaces a destructive toast when the export callback throws", async () => {
    const exportFn = jest.fn(async () => {
      throw new Error("boom");
    });
    render(
      <SessionExportImport
        exportActiveDeckToJSON={exportFn}
        importFromJSON={jest.fn(async () => ({
          imported: 0,
          skipped: 0,
          errors: [],
        })) as never}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /export/i }));
    await waitFor(() => expect(exportFn).toHaveBeenCalledTimes(1));
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Export failed",
        variant: "destructive",
      }),
    );
  });
});