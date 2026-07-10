/**
 * @fileoverview Tests for the JSON export path of ImportExportControls.
 *
 * Regression coverage for issue #1401: the export previously emitted a
 * hardcoded `format: "commander"` regardless of the active deck format,
 * causing Modern / Standard / Pioneer / Legacy / Vintage / Pauper decks to
 * be silently mislabelled on round-trip. The fix makes the export driven by
 * a `format` prop (falls back to "unknown" when omitted).
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/jest-globals";

jest.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, className, disabled, ...props }: any) => (
    <button
      type="button"
      onClick={onClick}
      className={className}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  ),
}));

jest.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: any) => <div>{children}</div>,
  DialogTrigger: ({ children }: any) => <div>{children}</div>,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
  DialogClose: ({ children }: any) => <div>{children}</div>,
}));

jest.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: any) => <div>{children}</div>,
  TabsList: ({ children }: any) => <div>{children}</div>,
  TabsTrigger: ({ children, value }: any) => (
    <button type="button" data-value={value}>
      {children}
    </button>
  ),
  TabsContent: ({ children }: any) => <div>{children}</div>,
}));

jest.mock("@/components/ui/label", () => ({
  Label: ({ children }: any) => <label>{children}</label>,
}));

jest.mock("@/components/ui/input", () => ({
  Input: (props: any) => <input {...props} />,
}));

jest.mock("@/components/ui/textarea", () => ({
  Textarea: (props: any) => <textarea {...props} />,
}));

jest.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ children }: any) => <div>{children}</div>,
  AlertDialogTrigger: ({ children }: any) => <div>{children}</div>,
  AlertDialogContent: ({ children }: any) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: any) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: any) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: any) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: any) => <div>{children}</div>,
  AlertDialogAction: ({ children, onClick }: any) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  AlertDialogCancel: ({ children }: any) => <div>{children}</div>,
}));

jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: jest.fn(),
  }),
}));

jest.mock("lucide-react", () => {
  const Svg = () => <svg />;
  return {
    Download: Svg,
    Upload: Svg,
    Trash2: Svg,
    Loader2: Svg,
    Save: Svg,
    Clipboard: Svg,
    ClipboardPaste: Svg,
    Link: Svg,
    FileText: Svg,
    Share2: Svg,
    AlertCircle: Svg,
    CheckCircle2: Svg,
    HelpCircle: Svg,
  };
});

import { ImportExportControls } from "@/app/(app)/deck-builder/_components/import-export-controls";

const CARDS = [
  { name: "Lightning Bolt", quantity: 4 },
  { name: "Counterspell", quantity: 4 },
];

const baseProps = () => ({
  onImport: jest.fn(async () => null),
  onExport: jest.fn(),
  onClear: jest.fn(),
  onSave: jest.fn(),
  isDeckSaved: false,
  deckName: "Test Deck",
  deckCards: CARDS,
});

/**
 * Capture the JSON payload that would be written to the export Blob.
 * The handler creates a Blob via `new Blob([JSON.stringify(exportData, null, 2)], ...)`
 * — we spy on the global Blob to capture the first JSON-encoded argument.
 */
function captureExportJSON() {
  const originalBlob = global.Blob;
  let captured: string | null = null;
  const blobSpy = jest
    .spyOn(global, "Blob")
    .mockImplementation((parts: any, opts: any) => {
      captured = typeof parts[0] === "string" ? parts[0] : String(parts[0]);
      return {
        size: captured.length,
        type: opts?.type ?? "application/json",
      } as unknown as Blob;
    });

  // jsdom does not implement URL.createObjectURL / revokeObjectURL.
  // Stub them so the export handler does not throw after writing the Blob.
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = jest.fn(() => "blob:mock") as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = jest.fn() as unknown as typeof URL.revokeObjectURL;

  return {
    read: () => {
      blobSpy.mockRestore();
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
      // Ensure the test does not silently receive an undefined value.
      expect(captured).not.toBeNull();
      return JSON.parse(captured as string);
    },
    restore: () => {
      blobSpy.mockRestore();
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    },
  };
}

/** Open the Export dialog, click "Export as JSON", and return the parsed payload. */
function exportJSONAndCapture(props: any) {
  render(<ImportExportControls {...props} />);

  const capture = captureExportJSON();

  // The export button lives inside a Dialog trigger; reach it by testid.
  const exportButton = screen.getByTestId("export-deck-button");
  fireEvent.click(exportButton);

  const exportJsonButton = screen.getByTestId("export-json-button");
  fireEvent.click(exportJsonButton);

  const payload = capture.read();
  capture.restore();
  return payload;
}

describe("ImportExportControls — JSON export format (issue #1401)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("writes format='commander' for a Commander deck", () => {
    const payload = exportJSONAndCapture({ ...baseProps(), format: "commander" });
    expect(payload.format).toBe("commander");
  });

  it("writes format='standard' for a Standard deck", () => {
    const payload = exportJSONAndCapture({ ...baseProps(), format: "standard" });
    expect(payload.format).toBe("standard");
  });

  it("writes format='modern' for a Modern deck", () => {
    const payload = exportJSONAndCapture({ ...baseProps(), format: "modern" });
    expect(payload.format).toBe("modern");
  });

  it("writes format='pioneer' for a Pioneer deck (regression: no longer hardcoded)", () => {
    const payload = exportJSONAndCapture({ ...baseProps(), format: "pioneer" });
    expect(payload.format).toBe("pioneer");
    // Belt-and-braces: the bug emitted "commander" here. Confirm we did not
    // regress to the literal.
    expect(payload.format).not.toBe("commander");
  });

  it("falls back to format='unknown' when no format prop is supplied", () => {
    const payload = exportJSONAndCapture({ ...baseProps() });
    expect(payload.format).toBe("unknown");
  });

  it("preserves the mainboard cards and sideboard in the export", () => {
    const sideboard = [{ name: "Rest in Peace", quantity: 2 }];
    const payload = exportJSONAndCapture({
      ...baseProps(),
      format: "modern",
      sideboardCards: sideboard,
    });
    expect(payload.format).toBe("modern");
    expect(payload.cards).toEqual(CARDS);
    expect(payload.sideboard).toEqual(sideboard);
  });

  it("omits the sideboard key entirely when none is supplied", () => {
    const payload = exportJSONAndCapture({
      ...baseProps(),
      format: "commander",
    });
    expect(payload.format).toBe("commander");
    expect(payload.sideboard).toBeUndefined();
  });
});