/**
 * Format rules display component
 * Shows format-specific rules and validation information
 */

"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import type { Format } from "@/lib/game-rules";
import { getFormatRulesSummary } from "@/lib/format-validator";
import type { ValidationResult } from "@/lib/game-rules";

interface FormatRulesDisplayProps {
  format: Format;
  className?: string;
}

export function FormatRulesDisplay({ format, className }: FormatRulesDisplayProps) {
  const { formatName, rules } = getFormatRulesSummary(format);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Info className="w-5 h-5 text-primary" />
          {formatName} Rules
        </CardTitle>
        <CardDescription>
          Deck construction rules for this format
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {rules.map((rule, index) => (
            <li key={index} className="flex items-start gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
              <span className="text-sm">{rule}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

interface DeckValidationResultProps {
  result: ValidationResult;
  deckName: string;
  format: Format;
  className?: string;
}

export function DeckValidationResult({
  result,
  deckName,
  format,
  className,
}: DeckValidationResultProps) {
  const formatName = format.charAt(0).toUpperCase() + format.slice(1);

  if (result.isValid && result.warnings.length === 0) {
    return (
      <Alert className={className}>
        <CheckCircle2 className="w-4 h-4 text-green-500" />
        <AlertDescription>
          <strong>{deckName}</strong> is valid for {formatName}!
        </AlertDescription>
      </Alert>
    );
  }

  if (result.isValid && result.warnings.length > 0) {
    return (
      <Alert className={className}>
        <AlertTriangle className="w-4 h-4 text-yellow-500" />
        <AlertDescription>
          <div>
            <strong>{deckName}</strong> is mostly valid for {formatName}, but has warnings:
            <ul className="mt-2 space-y-1">
              {result.warnings.map((warning, index) => (
                <li key={index} className="text-sm text-muted-foreground">
                  • {warning}
                </li>
              ))}
            </ul>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert variant="destructive" className={className}>
      <XCircle className="w-4 h-4" />
      <AlertDescription>
        <div>
          <strong>{deckName}</strong> is not valid for {formatName}:
          <ul className="mt-2 space-y-1">
            {result.errors.map((error, index) => (
              <li key={index} className="text-sm">
                • {error}
              </li>
            ))}
          </ul>
        </div>
      </AlertDescription>
    </Alert>
  );
}

interface FormatInfoBadgeProps {
  format: Format;
  className?: string;
}

export function FormatInfoBadge({ format, className }: FormatInfoBadgeProps) {
  const formatName = format.charAt(0).toUpperCase() + format.slice(1);

  const formatColors: Record<Format, string> = {
    commander: "bg-purple-100 text-purple-800 hover:bg-purple-200",
    standard: "bg-green-100 text-green-800 hover:bg-green-200",
    modern: "bg-blue-100 text-blue-800 hover:bg-blue-200",
    pioneer: "bg-orange-100 text-orange-800 hover:bg-orange-200",
    legacy: "bg-red-100 text-red-800 hover:bg-red-200",
    vintage: "bg-yellow-100 text-yellow-800 hover:bg-yellow-200",
    pauper: "bg-gray-100 text-gray-800 hover:bg-gray-200",
  };

  return (
    <Badge className={className} variant="outline">
      <span className={formatColors[format]}> {formatName} </span>
    </Badge>
  );
}
