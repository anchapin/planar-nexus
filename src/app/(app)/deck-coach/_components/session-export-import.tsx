"use client";

/**
 * @fileoverview Export / import controls for the AI coach session memory
 * (issue #1242).
 *
 * Two actions:
 *  - Export: serialises every conversation for the active deck (via the hook's
 *    `exportActiveDeckToJSON`) and triggers a JSON download.
 *  - Import: opens a hidden file picker, parses the picked JSON via the hook's
 *    `importFromJSON`, and surfaces a toast with the imported/skipped counts.
 *
 * The component is presentational — all persistence work happens in the hook
 * so callers (and tests) can drive the same flows without this UI.
 */

import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Download, Upload, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export interface SessionExportImportProps {
  /** Serialise the active deck's conversations to a JSON string. */
  exportActiveDeckToJSON: () => Promise<string | null>;
  /** Parse + import a previously-exported JSON envelope. */
  importFromJSON: (
    json: string,
    options?: { scope?: "active" | "original" },
  ) => Promise<
    | { imported: number; skipped: number; errors: string[] }
    | { error: string }
  >;
  /** Label used in toast messages (e.g. the deck name). */
  scopeLabel?: string;
}

function triggerDownload(content: string, filename: string): void {
  const blob = new Blob([content], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function safeFilename(label?: string): string {
  const base = (label ?? "deck").replace(/[^a-z0-9-_]+/gi, "-").toLowerCase();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${base}-coach-sessions-${stamp}.json`;
}

export function SessionExportImport({
  exportActiveDeckToJSON,
  importFromJSON,
  scopeLabel,
}: SessionExportImportProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"export" | "import" | null>(null);

  const handleExport = () => {
    startTransition(async () => {
      setBusy("export");
      try {
        const json = await exportActiveDeckToJSON();
        if (!json) {
          toast({
            title: "Nothing to export",
            description:
              "There are no saved coach sessions for this deck yet.",
          });
          return;
        }
        triggerDownload(json, safeFilename(scopeLabel));
        toast({
          title: "Sessions exported",
          description:
            "Your coach sessions were downloaded as JSON. Keep the file safe — it contains the full transcript.",
        });
      } catch (error) {
        toast({
          variant: "destructive",
          title: "Export failed",
          description:
            error instanceof Error
              ? error.message
              : "Could not export coach sessions.",
        });
      } finally {
        setBusy(null);
      }
    });
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Always reset the input so the same file can be re-picked later.
    event.target.value = "";
    if (!file) return;
    startTransition(async () => {
      setBusy("import");
      try {
        const text = await file.text();
        const result = await importFromJSON(text);
        if ("error" in result) {
          toast({
            variant: "destructive",
            title: "Import failed",
            description: result.error,
          });
          return;
        }
        if (result.imported === 0 && result.skipped === 0) {
          toast({
            title: "Nothing to import",
            description: "The selected file did not contain any sessions.",
          });
          return;
        }
        const desc =
          result.skipped > 0
            ? `Imported ${result.imported}, skipped ${result.skipped}.`
            : `Imported ${result.imported} session${
                result.imported === 1 ? "" : "s"
              }.`;
        toast({
          title: "Sessions imported",
          description: desc,
        });
      } catch (error) {
        toast({
          variant: "destructive",
          title: "Import failed",
          description:
            error instanceof Error
              ? error.message
              : "Could not import coach sessions.",
        });
      } finally {
        setBusy(null);
      }
    });
  };

  const disabled = isPending;

  return (
    <div
      className="flex items-center gap-2"
      data-testid="session-export-import"
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleExport}
        disabled={disabled}
        title="Download this deck's coach sessions as a JSON file"
      >
        {busy === "export" ? (
          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
        ) : (
          <Download className="mr-2 h-3.5 w-3.5" />
        )}
        Export
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleImportClick}
        disabled={disabled}
        title="Import a previously-exported coach-sessions JSON file"
      >
        {busy === "import" ? (
          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
        ) : (
          <Upload className="mr-2 h-3.5 w-3.5" />
        )}
        Import
      </Button>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        onChange={handleFileChange}
        aria-hidden="true"
        tabIndex={-1}
      />
    </div>
  );
}