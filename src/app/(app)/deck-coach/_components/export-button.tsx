"use client";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Download, FileText, Printer } from "lucide-react";
import type { DeckReviewOutput } from "@/ai/flows/ai-deck-coach-review";
import type { SynergyResult, MissingSynergy } from "@/ai/synergy-detector";
import type { KeyCard } from "./key-cards";

export interface CoachReportData {
  archetype?: {
    primary: string;
    confidence: number;
    secondary?: string;
    secondaryConfidence?: number;
  };
  synergies: SynergyResult[];
  missingSynergies: MissingSynergy[];
  keyCards: KeyCard[];
  reviewSummary?: string;
  deckOptions?: DeckReviewOutput["deckOptions"];
  decklist?: string;
}

export interface ExportButtonProps {
  report: CoachReportData;
  deckName?: string;
}

/**
 * Format report as plain text for export
 */
export function formatReportAsText(report: CoachReportData, deckName: string = "Unknown"): string {
  const lines: string[] = [];
  const divider = "=".repeat(60);
  const sectionDivider = "-".repeat(40);
  
  // Header
  lines.push(divider);
  lines.push(`DECK COACH REPORT: ${deckName}`);
  lines.push(`Generated: ${new Date().toLocaleString()}`);
  lines.push(divider);
  lines.push("");
  
  // Archetype
  if (report.archetype) {
    lines.push("ARCHETYPE ANALYSIS");
    lines.push(sectionDivider);
    lines.push(`Primary: ${report.archetype.primary}`);
    lines.push(`Confidence: ${Math.round(report.archetype.confidence * 100)}%`);
    if (report.archetype.secondary) {
      lines.push(`Secondary: ${report.archetype.secondary} (${Math.round((report.archetype.secondaryConfidence || 0) * 100)}%)`);
    }
    lines.push("");
  }
  
  // Overall Summary
  if (report.reviewSummary) {
    lines.push("OVERALL ANALYSIS");
    lines.push(sectionDivider);
    lines.push(report.reviewSummary);
    lines.push("");
  }
  
  // Synergies
  if (report.synergies && report.synergies.length > 0) {
    lines.push("DETECTED SYNERGIES");
    lines.push(sectionDivider);
    report.synergies.forEach((syn, i) => {
      lines.push(`${i + 1}. ${syn.name} (Score: ${syn.score})`);
      lines.push(`   Category: ${syn.category}`);
      lines.push(`   Description: ${syn.description}`);
      lines.push(`   Cards: ${syn.cards.slice(0, 8).join(", ")}${syn.cards.length > 8 ? ` (+${syn.cards.length - 8} more)` : ""}`);
      lines.push("");
    });
  }
  
  // Missing Synergies
  if (report.missingSynergies && report.missingSynergies.length > 0) {
    lines.push("MISSING SYNERGIES");
    lines.push(sectionDivider);
    report.missingSynergies.forEach((missing, i) => {
      lines.push(`${i + 1}. ${missing.synergy} [${missing.impact.toUpperCase()} IMPACT]`);
      lines.push(`   Missing: ${missing.description}`);
      lines.push(`   Suggestion: ${missing.suggestion}`);
      lines.push("");
    });
  }
  
  // Key Cards
  if (report.keyCards && report.keyCards.length > 0) {
    lines.push("KEY CARDS");
    lines.push(sectionDivider);
    report.keyCards.forEach((card, i) => {
      lines.push(`${i + 1}. ${card.name} (x${card.count})`);
      lines.push(`   Reason: ${card.reason}`);
      lines.push("");
    });
  }
  
  // Deck Options
  if (report.deckOptions && report.deckOptions.length > 0) {
    lines.push("SUGGESTED IMPROVEMENTS");
    lines.push(sectionDivider);
    report.deckOptions.forEach((option, i) => {
      lines.push(`${i + 1}. ${option.title}`);
      lines.push(`   ${option.description}`);
      if (option.cardsToAdd && option.cardsToAdd.length > 0) {
        lines.push(`   Cards to Add: ${option.cardsToAdd.map(c => `${c.quantity}x ${c.name}`).join(", ")}`);
      }
      if (option.cardsToRemove && option.cardsToRemove.length > 0) {
        lines.push(`   Cards to Remove: ${option.cardsToRemove.map(c => `${c.quantity}x ${c.name}`).join(", ")}`);
      }
      lines.push("");
    });
  }
  
  // Decklist
  if (report.decklist) {
    lines.push("DECKLIST");
    lines.push(sectionDivider);
    lines.push(report.decklist);
  }
  
  lines.push("");
  lines.push(divider);
  lines.push("End of Report");
  lines.push(divider);
  
  return lines.join("\n");
}

/**
 * Download text file
 */
function downloadText(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Trigger PDF export via browser print
 */
function exportToPDF(): void {
  window.print();
}

/**
 * ExportButton Component
 * 
 * Provides export options for the coach report:
 * - Text file download (.txt)
 * - PDF export (via browser print dialog)
 */
export function ExportButton({ report, deckName }: ExportButtonProps) {
  const handleExportText = () => {
    const text = formatReportAsText(report, deckName || "Deck");
    const safeName = (deckName || "deck-report").replace(/[^a-z0-9]/gi, "-").toLowerCase();
    downloadText(text, `${safeName}-coach-report.txt`);
  };
  
  const handleExportPDF = () => {
    exportToPDF();
  };
  
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Download className="h-4 w-4 mr-2" />
          Export Report
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={handleExportText}>
          <FileText className="h-4 w-4 mr-2" />
          Download as Text
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleExportPDF}>
          <Printer className="h-4 w-4 mr-2" />
          Print to PDF
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
