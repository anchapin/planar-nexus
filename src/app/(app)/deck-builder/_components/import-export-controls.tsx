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
import { Download, Upload, Trash2 } from "lucide-react";
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

interface ImportExportControlsProps {
  onImport: (decklist: string) => void;
  onExport: () => void;
  onClear: () => void;
}

export function ImportExportControls({ onImport, onExport, onClear }: ImportExportControlsProps) {
  const [importText, setImportText] = useState("");

  const handleImportClick = () => {
    onImport(importText);
    setImportText("");
  };

  return (
    <div className="flex items-center gap-2">
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            <Upload className="mr-2" />
            Import
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import Decklist</DialogTitle>
            <DialogDescription>
              Paste your decklist below (e.g., from a .txt file). One card per line.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="1 Sol Ring&#10;1 Command Tower&#10;..."
            className="h-64"
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
          />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" onClick={handleImportClick}>Import</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Button variant="outline" size="sm" onClick={onExport}>
        <Download className="mr-2" />
        Export
      </Button>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="destructive" size="sm">
            <Trash2 className="mr-2" />
            Clear
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action will permanently delete all cards from your current deck. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onClear}>Clear Deck</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
