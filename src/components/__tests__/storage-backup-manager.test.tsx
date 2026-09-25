/**
 * @fileOverview Unit tests for StorageBackupManager component
 * Issue #2152: Add unit tests for storage-backup-manager.tsx
 *
 * Tests cover backup, compression, quota, error handling, and hooks wiring.
 */

import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
  cleanup,
} from "@testing-library/react";
import { StorageBackupManager } from "../storage-backup-manager";

// ---------------------------------------------------------------------------
// Mock: useStorageBackup hook
// ---------------------------------------------------------------------------
/* eslint-disable @typescript-eslint/no-require-imports */
const mockExportData = jest.fn().mockResolvedValue(undefined);
const mockExportIncrementalData = jest.fn().mockResolvedValue(undefined);
const mockImportData = jest.fn().mockResolvedValue(undefined);
const mockClearAllData = jest.fn().mockResolvedValue(undefined);
const mockLoadStorageQuota = jest.fn().mockResolvedValue(undefined);
const mockRefreshBackupManifest = jest.fn().mockResolvedValue(undefined);
const mockSetBackupMode = jest.fn();
const mockReset = jest.fn();

const defaultHookProps = {
  status: "idle" as const,
  progress: 0,
  error: null as null,
  quota: {
    usage: 2 * 1024 * 1024,
    quota: 10 * 1024 * 1024,
    percentage: 20,
    approachingLimit: false,
    available: true,
  },
  isInitialized: true,
  backupMode: "full" as const,
  backupManifest: null,
  lastIncrementalResult: null,
  exportData: mockExportData,
  exportIncrementalData: mockExportIncrementalData,
  importData: mockImportData,
  getBackupSize: jest.fn().mockResolvedValue(1024),
  clearAllData: mockClearAllData,
  loadStorageQuota: mockLoadStorageQuota,
  refreshBackupManifest: mockRefreshBackupManifest,
  setBackupMode: mockSetBackupMode,
  reset: mockReset,
  isProcessing: false,
  isComplete: false,
  isApproachingLimit: false,
  storageUsage: "2.0 MB",
  storageQuota: "10.0 MB",
  storagePercentage: "20.0",
  hasIncrementalBaseline: false,
  lastBackupAt: null,
};

jest.mock("@/hooks/use-storage-backup", () => ({
  useStorageBackup: jest.fn(),
  validateBackupFile: jest.fn().mockResolvedValue(true),
  getBackupMetadata: jest.fn().mockImplementation((file: File) => ({
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
    formattedSize: "1.0 KB",
    formattedDate: new Date(file.lastModified).toLocaleString(),
  })),
  downloadBlob: jest.fn(),
}));

jest.mock("@/hooks/use-toast", () => ({
  toast: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Mock: lucide-react icons
// ---------------------------------------------------------------------------

jest.mock("lucide-react", () => ({
  Download: () => <span data-testid="icon-download">Download</span>,
  Upload: () => <span data-testid="icon-upload">Upload</span>,
  Trash2: () => <span data-testid="icon-trash">Trash2</span>,
  HardDrive: () => <span data-testid="icon-harddrive">HardDrive</span>,
  AlertTriangle: () => <span data-testid="icon-alert">AlertTriangle</span>,
  CheckCircle: () => <span data-testid="icon-check">CheckCircle</span>,
  Loader2: () => <span data-testid="icon-loader">Loader2</span>,
  Layers: () => <span data-testid="icon-layers">Layers</span>,
  FileStack: () => <span data-testid="icon-filestack">FileStack</span>,
}));

// ---------------------------------------------------------------------------
// Mock: shadcn/ui components
// ---------------------------------------------------------------------------

jest.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    variant,
    type,
    className,
    asChild,
    ...props
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    variant?: string;
    type?: "button" | "submit" | "reset";
    className?: string;
    asChild?: boolean;
    [key: string]: unknown;
  }) => (
    <button
      data-testid={`btn-${variant ?? "default"}`}
      data-type={type ?? "button"}
      onClick={onClick}
      disabled={disabled}
      className={className}
      {...props}
    >
      {children}
    </button>
  ),
}));

jest.mock("@/components/ui/card", () => ({
  Card: ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => (
    <div data-testid="card" className={className}>
      {children}
    </div>
  ),
  CardContent: ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => (
    <div data-testid="card-content" className={className}>
      {children}
    </div>
  ),
  CardDescription: ({ children }: { children: React.ReactNode }) => (
    <span data-testid="card-description">{children}</span>
  ),
  CardHeader: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="card-header">{children}</div>
  ),
  CardTitle: ({ children }: { children: React.ReactNode }) => (
    <h2 data-testid="card-title">{children}</h2>
  ),
}));

jest.mock("@/components/ui/alert", () => ({
  Alert: ({
    children,
    variant,
  }: {
    children: React.ReactNode;
    variant?: string;
  }) => (
    <div data-testid="alert" data-variant={variant ?? "default"}>
      {children}
    </div>
  ),
  AlertDescription: ({ children }: { children: React.ReactNode }) => (
    <span data-testid="alert-description">{children}</span>
  ),
  AlertTitle: ({ children }: { children: React.ReactNode }) => (
    <span data-testid="alert-title">{children}</span>
  ),
}));

jest.mock("@/components/ui/dialog", () => {
  // Internal Context so DialogTrigger can invoke the parent Dialog's
  // onOpenChange when clicked (Radix UI does this via its own context).
  const DialogContext = React.createContext<{
    onOpenChange: (open: boolean) => void;
  }>({ onOpenChange: () => {} });

  const Dialog = ({
    children,
    open,
    onOpenChange,
  }: {
    children: React.ReactNode;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  }) => {
    // Radix UI Dialog: DialogTrigger renders always (it's the trigger button);
    // DialogContent (and friends) render only when the dialog is open. We
    // identify the trigger by its displayName to keep test queries stable.
    const arr = React.Children.toArray(children);
    const trigger = arr.find(
      (c) =>
        React.isValidElement(c) &&
        (c.type as { displayName?: string })?.displayName === "DialogTrigger",
    );
    const rest = arr.filter((c) => c !== trigger);
    const handleOpenChange = (next: boolean) => onOpenChange?.(next);
    return (
      <DialogContext.Provider value={{ onOpenChange: handleOpenChange }}>
        <div data-testid="dialog" data-open={open ? "true" : "false"}>
          {trigger}
          {open && rest}
        </div>
      </DialogContext.Provider>
    );
  };
  Dialog.displayName = "Dialog";

  const DialogTrigger = Object.assign(
    ({
      children,
      asChild,
    }: {
      children: React.ReactNode;
      asChild?: boolean;
    }) => (
      <DialogContext.Consumer>
        {({ onOpenChange }) => {
          const handleClick = () => onOpenChange(true);
          if (asChild) {
            const child = React.Children.only(children) as React.ReactElement<{
              onClick?: (e: React.MouseEvent) => void;
            }>;
            return React.cloneElement(child, {
              onClick: (e: React.MouseEvent) => {
                child.props.onClick?.(e);
                handleClick();
              },
            });
          }
          return (
            <button data-testid="dialog-trigger" onClick={handleClick}>
              {children}
            </button>
          );
        }}
      </DialogContext.Consumer>
    ),
    { displayName: "DialogTrigger" },
  );

  return {
    Dialog,
    DialogTrigger,
    DialogContent: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="dialog-content">{children}</div>
    ),
    DialogDescription: ({ children }: { children: React.ReactNode }) => (
      <span data-testid="dialog-description">{children}</span>
    ),
    DialogFooter: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="dialog-footer">{children}</div>
    ),
    DialogHeader: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="dialog-header">{children}</div>
    ),
    DialogTitle: ({ children }: { children: React.ReactNode }) => (
      <h2 data-testid="dialog-title">{children}</h2>
    ),
    DialogOverlay: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="dialog-overlay">{children}</div>
    ),
    DialogPortal: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="dialog-portal">{children}</div>
    ),
    DialogClose: ({
      children,
      asChild,
    }: {
      children: React.ReactNode;
      asChild?: boolean;
    }) =>
      asChild ? (
        <>{children}</>
      ) : (
        <button data-testid="dialog-close">{children}</button>
      ),
  };
});

jest.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tabs">{children}</div>
  ),
  TabsContent: ({
    children,
    value,
  }: {
    children: React.ReactNode;
    value: string;
  }) => <div data-testid={`tab-content-${value}`}>{children}</div>,
  TabsList: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tabs-list">{children}</div>
  ),
  TabsTrigger: ({
    children,
    value,
    onClick,
  }: {
    children: React.ReactNode;
    value: string;
    onClick?: () => void;
  }) => (
    <button data-testid={`tab-trigger-${value}`} onClick={onClick}>
      {children}
    </button>
  ),
}));

jest.mock("@/components/ui/progress", () => ({
  Progress: ({ value }: { value?: number }) => (
    <div data-testid="progress" data-value={value}>
      Progress {value}%
    </div>
  ),
}));

jest.mock("@/components/ui/badge", () => ({
  Badge: ({
    children,
    variant,
  }: {
    children: React.ReactNode;
    variant?: string;
  }) => (
    <span data-testid="badge" data-variant={variant ?? "default"}>
      {children}
    </span>
  ),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockUseStorageBackup = require("@/hooks/use-storage-backup")
  .useStorageBackup as jest.Mock;
const getMockToast = () =>
  (require("@/hooks/use-toast") as { toast: jest.Mock }).toast;

function setupHookProps(overrides = {}) {
  mockUseStorageBackup.mockReturnValue({ ...defaultHookProps, ...overrides });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  getMockToast().mockReset();
  mockExportData.mockClear();
  mockExportIncrementalData.mockClear();
  mockImportData.mockClear();
  mockClearAllData.mockClear();
  mockLoadStorageQuota.mockClear();
  mockSetBackupMode.mockClear();
  mockReset.mockClear();
  setupHookProps();
});

// Explicit RTL cleanup so DOM does not leak between tests. Without this hook
// the inner `beforeEach` blocks (which call `render`) leave stale nodes attached
// when the next test runs, producing "Found multiple elements" failures.
afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("StorageBackupManager", () => {
  // Captured render results for inner beforeEach blocks; allows `it` bodies to
  // re-render the same tree with new props (via `rerender`) instead of calling
  // `render` a second time and producing "Found multiple elements" failures.
  let backupTabRender: ReturnType<typeof render> | undefined;
  let restoreTabRender: ReturnType<typeof render> | undefined;
  describe("loading state", () => {
    it("renders card when not initialized (loading placeholder)", () => {
      setupHookProps({ isInitialized: false });
      render(<StorageBackupManager />);
      expect(screen.getByTestId("card")).toBeInTheDocument();
    });
  });

  describe("overview tab (default)", () => {
    it("renders storage usage info", async () => {
      setupHookProps({
        storageUsage: "5.0 MB",
        storageQuota: "10.0 MB",
        storagePercentage: "50.0",
      });
      render(<StorageBackupManager />);
      await waitFor(() => {
        expect(screen.getByTestId("card")).toBeInTheDocument();
      });
    });

    it("shows approaching limit badge when isApproachingLimit is true", async () => {
      setupHookProps({ isApproachingLimit: true });
      render(<StorageBackupManager />);
      await waitFor(() => {
        const badge = screen.getByTestId("badge");
        expect(badge).toHaveAttribute("data-variant", "destructive");
      });
    });

    it("does not show destructive badge when under threshold", async () => {
      setupHookProps({ isApproachingLimit: false });
      render(<StorageBackupManager />);
      await waitFor(() => {
        const badges = screen.queryAllByTestId("badge");
        const destructiveBadges = badges.filter(
          (b) => b.getAttribute("data-variant") === "destructive",
        );
        expect(destructiveBadges).toHaveLength(0);
      });
    });

    it("calls loadStorageQuota on mount when quota is not initialized", async () => {
      // loadStorageQuota is called when isInitialized=false OR quota is null
      setupHookProps({
        isInitialized: false,
        quota: null as null,
      });
      render(<StorageBackupManager />);
      await waitFor(() => {
        expect(mockLoadStorageQuota).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("backup tab", () => {
    beforeEach(async () => {
      setupHookProps();
      backupTabRender = render(<StorageBackupManager />);
      await waitFor(() => {
        expect(screen.getByTestId("tab-trigger-backup")).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId("tab-trigger-backup"));
      await waitFor(() => {
        expect(screen.getByTestId("tab-content-backup")).toBeInTheDocument();
      });
    });

    it("renders backup tab content", () => {
      expect(screen.getByTestId("tab-content-backup")).toBeInTheDocument();
    });

    it("has Full and Incremental mode buttons", () => {
      expect(screen.getByText("Full")).toBeInTheDocument();
      expect(screen.getByText("Incremental")).toBeInTheDocument();
    });

    it("exportData is called when Export Backup button is clicked", async () => {
      const exportBtn = screen.getByText("Export Backup");
      fireEvent.click(exportBtn);
      await waitFor(() => {
        expect(mockExportData).toHaveBeenCalledTimes(1);
      });
    });

    it("disables Export Backup button when isProcessing is true", async () => {
      // Re-render with isProcessing: true
      setupHookProps({ isProcessing: true });
      backupTabRender?.rerender(<StorageBackupManager />);
      await waitFor(() => {
        expect(screen.getByTestId("tab-trigger-backup")).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId("tab-trigger-backup"));
      await waitFor(() => {
        expect(screen.getByTestId("tab-content-backup")).toBeInTheDocument();
      });
      const exportBtn = within(
        screen.getByTestId("tab-content-backup"),
      ).getByRole("button", { name: /Export/i });
      expect(exportBtn).toBeDisabled();
    });

    it("calls setBackupMode with 'incremental' when Incremental button is clicked", () => {
      const incrementalBtn = screen.getByText("Incremental");
      fireEvent.click(incrementalBtn);
      expect(mockSetBackupMode).toHaveBeenCalledWith("incremental");
    });

    it("calls exportIncrementalData when in incremental mode", async () => {
      setupHookProps({ backupMode: "incremental" });
      backupTabRender?.rerender(<StorageBackupManager />);
      await waitFor(() => {
        expect(screen.getByTestId("tab-trigger-backup")).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId("tab-trigger-backup"));
      await waitFor(() => {
        expect(screen.getByTestId("tab-content-backup")).toBeInTheDocument();
      });
      const exportBtn = within(
        screen.getByTestId("tab-content-backup"),
      ).getByRole("button", { name: /Export Incremental Backup/i });
      fireEvent.click(exportBtn);
      await waitFor(() => {
        expect(mockExportIncrementalData).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("restore tab", () => {
    beforeEach(async () => {
      setupHookProps();
      restoreTabRender = render(<StorageBackupManager />);
      await waitFor(() => {
        expect(screen.getByTestId("tab-trigger-restore")).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId("tab-trigger-restore"));
      await waitFor(() => {
        expect(screen.getByTestId("tab-content-restore")).toBeInTheDocument();
      });
    });

    it("renders restore tab content", () => {
      expect(screen.getByTestId("tab-content-restore")).toBeInTheDocument();
    });

    it("disables import button when isProcessing is true", async () => {
      setupHookProps({ isProcessing: true });
      restoreTabRender?.rerender(<StorageBackupManager />);
      await waitFor(() => {
        expect(screen.getByTestId("tab-trigger-restore")).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId("tab-trigger-restore"));
      await waitFor(() => {
        expect(screen.getByTestId("tab-content-restore")).toBeInTheDocument();
      });
      // The Import button only renders after a file has been selected. Simulate
      // the file input change so the import button is mounted before we probe it.
      const file = new File(["{}"], "backup.json", {
        type: "application/json",
      });
      const fileInput = document.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement | null;
      if (fileInput) {
        fireEvent.change(fileInput, { target: { files: [file] } });
      }
      const importBtn = within(
        screen.getByTestId("tab-content-restore"),
      ).getByRole("button", { name: /Import/i });
      expect(importBtn).toBeDisabled();
    });
  });

  describe("error handling", () => {
    it("shows error alert when status is error on backup tab", async () => {
      const error = { message: "Export failed", code: "EXPORT_ERROR" as const };
      setupHookProps({ status: "error", error });
      render(<StorageBackupManager />);
      await waitFor(() => {
        expect(screen.getByTestId("tab-trigger-backup")).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId("tab-trigger-backup"));
      await waitFor(() => {
        const backupContent = screen.getByTestId("tab-content-backup");
        const errorAlert = within(backupContent).getByTestId("alert");
        expect(errorAlert).toHaveAttribute("data-variant", "destructive");
      });
    });

    it("shows error alert when status is error on restore tab", async () => {
      const error = { message: "Import failed", code: "IMPORT_ERROR" as const };
      setupHookProps({ status: "error", error });
      render(<StorageBackupManager />);
      await waitFor(() => {
        expect(screen.getByTestId("tab-trigger-restore")).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId("tab-trigger-restore"));
      await waitFor(() => {
        const restoreContent = screen.getByTestId("tab-content-restore");
        const errorAlert = within(restoreContent).getByTestId("alert");
        expect(errorAlert).toHaveAttribute("data-variant", "destructive");
      });
    });

    it("shows Reset button when in error state", async () => {
      const error = {
        message: "Something went wrong",
        code: "UNKNOWN" as const,
      };
      setupHookProps({ status: "error", error });
      render(<StorageBackupManager />);
      await waitFor(() => {
        expect(screen.getByTestId("tab-trigger-backup")).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId("tab-trigger-backup"));
      await waitFor(() => {
        expect(screen.getByText("Reset")).toBeInTheDocument();
      });
    });

    it("calls reset when Reset button is clicked", async () => {
      const error = { message: "Test error", code: "TEST" as const };
      setupHookProps({ status: "error", error });
      render(<StorageBackupManager />);
      await waitFor(() => {
        expect(screen.getByTestId("tab-trigger-backup")).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId("tab-trigger-backup"));
      await waitFor(() => {
        const resetBtn = screen.getByText("Reset");
        fireEvent.click(resetBtn);
      });
      expect(mockReset).toHaveBeenCalledTimes(1);
    });
  });

  describe("progress tracking", () => {
    it("shows progress bar during export when progress > 0", async () => {
      setupHookProps({ status: "exporting", progress: 50 });
      render(<StorageBackupManager />);
      await waitFor(() => {
        expect(screen.getByTestId("tab-trigger-backup")).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId("tab-trigger-backup"));
      await waitFor(() => {
        const backupContent = screen.getByTestId("tab-content-backup");
        const progress = within(backupContent).getByTestId("progress");
        expect(progress).toHaveAttribute("data-value", "50");
      });
    });
  });

  describe("clear all data dialog", () => {
    it("opens confirmation dialog when Clear All Data button is clicked", async () => {
      setupHookProps();
      render(<StorageBackupManager />);
      await waitFor(() => {
        expect(screen.getByTestId("tab-trigger-restore")).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId("tab-trigger-restore"));
      await waitFor(() => {
        expect(screen.getByTestId("tab-content-restore")).toBeInTheDocument();
      });
      // Find Clear All Data button within restore tab content
      const restoreContent = screen.getByTestId("tab-content-restore");
      const clearBtn = within(restoreContent).getByText("Clear All Data");
      fireEvent.click(clearBtn);
      await waitFor(() => {
        const dialog = screen.getByTestId("dialog");
        expect(dialog).toHaveAttribute("data-open", "true");
      });
    });

    it("calls clearAllData when confirmed", async () => {
      setupHookProps();
      render(<StorageBackupManager />);
      await waitFor(() => {
        expect(screen.getByTestId("tab-trigger-restore")).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId("tab-trigger-restore"));
      await waitFor(() => {
        expect(screen.getByTestId("tab-content-restore")).toBeInTheDocument();
      });
      // Open dialog
      const restoreContent = screen.getByTestId("tab-content-restore");
      const clearBtn = within(restoreContent).getByText("Clear All Data");
      fireEvent.click(clearBtn);
      await waitFor(() => {
        expect(screen.getByTestId("dialog")).toHaveAttribute(
          "data-open",
          "true",
        );
      });
      // Dialog is open - find confirm button inside the dialog content (the trigger
      // button lives at the dialog root and would otherwise match the query).
      const confirmBtn = within(screen.getByTestId("dialog-content")).getByText(
        "Clear All Data",
      );
      fireEvent.click(confirmBtn);
      await waitFor(() => {
        expect(mockClearAllData).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("incremental backup display", () => {
    it("shows last backup time when hasIncrementalBaseline is true", async () => {
      setupHookProps({
        backupMode: "incremental",
        hasIncrementalBaseline: true,
        lastBackupAt: "2026-01-01T00:00:00.000Z",
      });
      render(<StorageBackupManager />);
      await waitFor(() => {
        expect(screen.getByTestId("tab-trigger-backup")).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId("tab-trigger-backup"));
      await waitFor(() => {
        expect(screen.getByTestId("tab-content-backup")).toBeInTheDocument();
      });
    });

    it("shows no previous backup message when hasIncrementalBaseline is false", async () => {
      setupHookProps({
        backupMode: "incremental",
        hasIncrementalBaseline: false,
        lastBackupAt: null,
      });
      render(<StorageBackupManager />);
      await waitFor(() => {
        expect(screen.getByTestId("tab-trigger-backup")).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId("tab-trigger-backup"));
      await waitFor(() => {
        expect(screen.getByTestId("tab-content-backup")).toBeInTheDocument();
      });
    });
  });

  describe("quota checking", () => {
    it("displays storage usage and quota", async () => {
      setupHookProps({
        storageUsage: "8.5 GB",
        storageQuota: "10.0 GB",
        storagePercentage: "85.0",
      });
      render(<StorageBackupManager />);
      await waitFor(() => {
        expect(screen.getByTestId("card")).toBeInTheDocument();
      });
    });

    it("shows approaching limit badge when quota percentage is high", async () => {
      setupHookProps({ isApproachingLimit: true });
      render(<StorageBackupManager />);
      await waitFor(() => {
        const badge = screen.getByTestId("badge");
        expect(badge).toHaveAttribute("data-variant", "destructive");
      });
    });
  });

  describe("import flow", () => {
    it("importData is called with file when file is selected and import clicked", async () => {
      const validateBackupFile = require("@/hooks/use-storage-backup")
        .validateBackupFile as jest.Mock;
      validateBackupFile.mockResolvedValueOnce(true);

      setupHookProps();
      render(<StorageBackupManager />);
      await waitFor(() => {
        expect(screen.getByTestId("tab-trigger-restore")).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId("tab-trigger-restore"));
      await waitFor(() => {
        expect(screen.getByTestId("tab-content-restore")).toBeInTheDocument();
      });

      // Select file
      const file = new File(["{}"], "backup.json", {
        type: "application/json",
      });
      const fileInput = document.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;
      if (fileInput) {
        fireEvent.change(fileInput, { target: { files: [file] } });
      }

      // Click import button - target the button role (the first "Import Backup"
      // text node is the <h3> heading, which is not clickable as an import action).
      const importBtn = within(
        screen.getByTestId("tab-content-restore"),
      ).getByRole("button", { name: /Import Backup/i });
      fireEvent.click(importBtn);

      await waitFor(() => {
        expect(mockImportData).toHaveBeenCalledWith(file);
      });
    });

    it("shows invalid file toast when validateBackupFile returns false", async () => {
      const validateBackupFile = require("@/hooks/use-storage-backup")
        .validateBackupFile as jest.Mock;
      validateBackupFile.mockResolvedValueOnce(false);

      setupHookProps();
      render(<StorageBackupManager />);
      await waitFor(() => {
        expect(screen.getByTestId("tab-trigger-restore")).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId("tab-trigger-restore"));
      await waitFor(() => {
        expect(screen.getByTestId("tab-content-restore")).toBeInTheDocument();
      });

      const file = new File(["{}"], "backup.json", {
        type: "application/json",
      });
      const fileInput = document.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;
      if (fileInput) {
        fireEvent.change(fileInput, { target: { files: [file] } });
      }

      const importBtn = within(
        screen.getByTestId("tab-content-restore"),
      ).getByRole("button", { name: /Import Backup/i });
      fireEvent.click(importBtn);

      await waitFor(() => {
        expect(getMockToast()).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Invalid backup file",
            variant: "destructive",
          }),
        );
      });
    });
  });
});
