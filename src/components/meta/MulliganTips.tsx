"use client";

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MulliganTips } from '@/lib/matchup-guides';

interface MulliganTipsComponentProps {
  tips: MulliganTips;
}

/**
 * Component displaying mulligan recommendations
 */
export function MulliganTipsComponent({ tips }: MulliganTipsComponentProps) {
  return (
    <Card className="w-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">Mulligan Guide</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Keep */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Badge variant="default" className="bg-green-500">Keep</Badge>
            <span className="text-sm text-muted-foreground">Cards you want to keep</span>
          </div>
          <ScrollArea className="h-[100px]">
            <ul className="space-y-1">
              {tips.keep.map((card, index) => (
                <li key={index} className="text-sm flex items-start gap-2">
                  <span className="text-green-500">✓</span>
                  {card}
                </li>
              ))}
            </ul>
          </ScrollArea>
        </div>

        {/* Mulligan */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Badge variant="destructive">Mulligan</Badge>
            <span className="text-sm text-muted-foreground">Cards to ship back</span>
          </div>
          <ScrollArea className="h-[100px]">
            <ul className="space-y-1">
              {tips.mulligan.map((card, index) => (
                <li key={index} className="text-sm flex items-start gap-2">
                  <span className="text-red-500">✗</span>
                  {card}
                </li>
              ))}
            </ul>
          </ScrollArea>
        </div>

        {/* Consider */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Badge variant="outline" className="border-yellow-500 text-yellow-500">Consider</Badge>
            <span className="text-sm text-muted-foreground">Situational keeps</span>
          </div>
          <ScrollArea className="h-[80px]">
            <ul className="space-y-1">
              {tips.consider.map((card, index) => (
                <li key={index} className="text-sm flex items-start gap-2">
                  <span className="text-yellow-500">?</span>
                  {card}
                </li>
              ))}
            </ul>
          </ScrollArea>
        </div>

        {/* Notes */}
        <div className="pt-2 border-t">
          <span className="text-sm font-medium">Notes:</span>
          <p className="text-sm text-muted-foreground mt-1">
            {tips.notes}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export default MulliganTipsComponent;
