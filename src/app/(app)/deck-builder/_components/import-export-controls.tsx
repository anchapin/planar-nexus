"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Download,
  Upload,
  Trash2,
  Loader2,
  Save,
  Clipboard,
  ClipboardPaste,
  Link as LinkIcon,
  FileText,
  Share2,
} from "lucide-react";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

interface ImportExportControlsProps {
  onImport: (decklist: string, format?: "standard" | "mtgo" | "json") => void;
  onExport: () => void;
  onClear: () => void;
  onSave: () => void;
  isDeckSaved: boolean;
  isImporting?: boolean;
  deckName?: string;
  deckCards?: Array<{ name: string; quantity: number }>;
}

export function ImportExportControls({
  onImport,
  onExport,
  onClear,
  onSave,
  isDeckSaved,
  isImporting = false,
  deckName,
  deckCards,
}: ImportExportControlsProps) {
  const [importText, setImportText] = useState("");
  const [importFormat, setImportFormat] = useState<
    "standard" | "mtgo" | "json"
  >("standard");
  const [importUrl, setImportUrl] = useState("");
  const [activeTab, setActiveTab] = useState<"text" | "url">("text");
  const [isUrlImporting, setIsUrlImporting] = useState(false);
  const { toast } = useToast();

  const handleImportClick = () => {
    onImport(importText, importFormat);
  };

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setImportText(text);
      toast({
        title: "Pasted from clipboard",
        description: "Decklist pasted successfully",
      });
    } catch (error) {
      toast({
        title: "Failed to paste",
        description: "Clipboard access denied or not supported",
        variant: "destructive",
      });
    }
  };

  const handleCopyToClipboard = async () => {
    if (!deckCards || deckCards.length === 0) {
      toast({
        title: "No cards to copy",
        description: "Add cards to your deck first",
        variant: "destructive",
      });
      return;
    }

    const decklist = deckCards
      .map((card) => `${card.quantity} ${card.name}`)
      .join("\n");

    try {
      await navigator.clipboard.writeText(decklist);
      toast({
        title: "Copied to clipboard",
        description: `${deckCards.length} cards copied`,
      });
    } catch (error) {
      toast({
        title: "Failed to copy",
        description: "Clipboard access denied",
        variant: "destructive",
      });
    }
  };

  const handleUrlImport = async () => {
    if (!importUrl) {
      toast({
        title: "Enter a URL",
        description: "Please paste a deck URL",
        variant: "destructive",
      });
      return;
    }

    // Validate URL format
    try {
      new URL(importUrl);
    } catch {
      toast({
        title: "Invalid URL",
        description: "Please enter a valid URL",
        variant: "destructive",
      });
      return;
    }

    setIsUrlImporting(true);

    try {
      const response = await fetch("/api/deck-import", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: importUrl }),
      });

      const data = await response.json();

      if (!response.ok) {
        toast({
          title: "Import failed",
          description: data.suggestion
            ? `${data.error}. ${data.suggestion}`
            : data.error || "Failed to import deck from URL",
          variant: "destructive",
        });
        return;
      }

      // Import the parsed decklist
      onImport(data.decklist, "standard");

      toast({
        title: "Deck imported",
        description: `Successfully imported ${data.cardCount} cards from ${data.siteName}`,
      });

      // Reset the URL input and close dialog
      setImportUrl("");
    } catch (error) {
      toast({
        title: "Import failed",
        description: "An error occurred while fetching the deck",
        variant: "destructive",
      });
    } finally {
      setIsUrlImporting(false);
    }
  };

  const handleExportJSON = () => {
    if (!deckCards || deckCards.length === 0) {
      toast({
        title: "No cards to export",
        description: "Add cards to your deck first",
        variant: "destructive",
      });
      return;
    }

    const exportData = {
      name: deckName || "My Deck",
      format: "commander",
      cards: deckCards,
      exportedAt: new Date().toISOString(),
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(deckName || "deck").replace(/[^a-z0-9]/gi, "-")}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast({
      title: "Exported JSON",
      description: "Deck exported as JSON file",
    });
  };

  const handleShareDeck = async () => {
    if (!deckCards || deckCards.length === 0) {
      toast({
        title: "No cards to share",
        description: "Add cards to your deck first",
        variant: "destructive",
      });
      return;
    }

    const decklist = deckCards
      .map((card) => `${card.quantity} ${card.name}`)
      .join("\n");

    const shareData = {
      title: deckName || "My Deck",
      text: `Check out my deck: ${deckName || "My Deck"}\n\n${decklist}`,
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch (error) {
        // User cancelled or share failed
      }
    } else {
      // Fallback to clipboard
      await navigator.clipboard.writeText(shareData.text);
      toast({
        title: "Copied to clipboard",
        description: "Deck copied for sharing",
      });
    }
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Button
        variant="outline"
        size="sm"
        onClick={onSave}
        disabled={isDeckSaved}
        data-testid="save-deck-button"
      >
        <Save className="mr-2" />
        {isDeckSaved ? "Saved" : "Save"}
      </Button>

      <Button
        variant="outline"
        size="sm"
        onClick={handleCopyToClipboard}
        data-testid="copy-deck-button"
      >
        <Clipboard className="mr-2" />
        Copy
      </Button>

      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            setImportText("");
            setImportUrl("");
            setActiveTab("text");
          }
        }}
      >
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" data-testid="import-deck-button">
            <Upload className="mr-2" />
            Import
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import Decklist</DialogTitle>
            <DialogDescription>
              Import from text, URL, or clipboard
            </DialogDescription>
          </DialogHeader>

          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as "text" | "url")}
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="text">Text/Clipboard</TabsTrigger>
              <TabsTrigger value="url">URL Import</TabsTrigger>
            </TabsList>

            <TabsContent value="text" className="space-y-4">
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePasteFromClipboard}
                  className="flex-1"
                  data-testid="paste-deck-button"
                >
                  <ClipboardPaste className="mr-2 h-4 w-4" />
                  Paste from Clipboard
                </Button>
              </div>

              <div className="space-y-2">
                <Label htmlFor="import-format">Format</Label>
                <Tabs
                  value={importFormat}
                  onValueChange={(v) =>
                    setImportFormat(v as typeof importFormat)
                  }
                  data-testid="import-format-tabs"
                >
                  <TabsList>
                    <TabsTrigger value="standard">Standard</TabsTrigger>
                    <TabsTrigger value="mtgo">MTGO</TabsTrigger>
                    <TabsTrigger value="json">JSON</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              <Textarea
                placeholder={
                  importFormat === "mtgo"
                    ? "4 Sol Ring\n2 Arcane Signet\n1 Lightning Bolt"
                    : importFormat === "json"
                      ? '{"cards": [{"name": "Sol Ring", "quantity": 4}]}'
                      : "1 Sol Ring\n1 Command Tower\n..."
                }
                className="h-64"
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                disabled={isImporting}
                data-testid="import-textarea"
              />

              {importFormat === "mtgo" && (
                <p className="text-xs text-muted-foreground">
                  MTGO format:{" "}
                  <code className="bg-muted px-1 py-0.5 rounded">
                    COUNT CARDNAME
                  </code>{" "}
                  (e.g.,{" "}
                  <code className="bg-muted px-1 py-0.5 rounded">
                    4 Sol Ring
                  </code>
                  )
                </p>
              )}
            </TabsContent>

            <TabsContent value="url" className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="import-url">Deck URL</Label>
                <div className="flex gap-2">
                  <Input
                    id="import-url"
                    placeholder="https://mtggoldfish.com/decks/..."
                    value={importUrl}
                    onChange={(e) => setImportUrl(e.target.value)}
                    disabled={isUrlImporting}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        handleUrlImport();
                      }
                    }}
                  />
                  <Button onClick={handleUrlImport} disabled={isUrlImporting}>
                    {isUrlImporting ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <LinkIcon className="mr-2 h-4 w-4" />
                    )}
                    {isUrlImporting ? "Importing..." : "Import"}
                  </Button>
                </div>
              </div>

              <div className="text-xs text-muted-foreground space-y-2">
                <p>Supported sites:</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>MTGGoldfish</li>
                  <li>TappedOut</li>
                  <li>Moxfield</li>
                </ul>
              </div>
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <DialogClose asChild>
              <Button
                type="button"
                onClick={handleImportClick}
                disabled={isImporting}
                data-testid="confirm-import-button"
              >
                {isImporting && <Loader2 className="mr-2 animate-spin" />}
                {isImporting ? "Importing..." : "Import"}
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" data-testid="export-deck-button">
            <Download className="mr-2" />
            Export
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Export Deck</DialogTitle>
            <DialogDescription>Choose your export format</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={handleCopyToClipboard}
              data-testid="export-copy-button"
            >
              <Clipboard className="mr-2 h-4 w-4" />
              Copy to Clipboard
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={handleExportJSON}
              data-testid="export-json-button"
            >
              <FileText className="mr-2 h-4 w-4" />
              Export as JSON
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={onExport}
              data-testid="export-text-button"
            >
              <Download className="mr-2 h-4 w-4" />
              Export as Text
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={handleShareDeck}
            >
              <Share2 className="mr-2 h-4 w-4" />
              Share Deck
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="destructive"
            size="sm"
            data-testid="clear-deck-button"
          >
            <Trash2 className="mr-2" />
            Clear
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action will permanently delete all cards from your current
              deck. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onClear}
              data-testid="confirm-clear-button"
            >
              Clear Deck
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
