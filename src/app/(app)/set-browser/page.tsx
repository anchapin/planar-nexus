/**
 * Set Browser - MTG Set Selection for Limited Modes
 * 
 * Phase 14: Foundation
 * Requirements: SET-01, SET-02, SET-03
 * 
 * Features:
 * - Browse all MTG sets sorted by release date or name
 * - Display card count for each set
 * - Select set for Draft or Sealed
 * - Confirmation modal before starting session
 */

"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  fetchAllSets,
  sortSets,
  getSetDetails,
  getSetTypeDisplayName,
  filterPlayableSets,
} from "@/lib/limited/set-service";
import type { ScryfallSet, SetSortOption, LimitedMode } from "@/lib/limited/types";

export default function SetBrowserPage() {
  const router = useRouter();
  
  // State
  const [sets, setSets] = useState<ScryfallSet[]>([]);
  const [filteredSets, setFilteredSets] = useState<ScryfallSet[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortOption, setSortOption] = useState<SetSortOption>("release_date");
  
  // Selection state
  const [selectedSet, setSelectedSet] = useState<ScryfallSet | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedMode, setSelectedMode] = useState<LimitedMode>("sealed");

  // Fetch sets on mount
  useEffect(() => {
    async function loadSets() {
      try {
        setIsLoading(true);
        setError(null);
        
        const allSets = await fetchAllSets();
        const playableSets = filterPlayableSets(allSets);
        
        setSets(playableSets);
        setFilteredSets(sortSets(playableSets, sortOption));
      } catch (err) {
        console.error("Failed to load sets:", err);
        setError(err instanceof Error ? err.message : "Failed to load sets");
      } finally {
        setIsLoading(false);
      }
    }

    loadSets();
  }, []);

  // Re-sort when sort option changes
  useEffect(() => {
    if (sets.length > 0) {
      setFilteredSets(sortSets(sets, sortOption));
    }
  }, [sortOption, sets]);

  // Handle set selection
  const handleSetClick = (set: ScryfallSet) => {
    setSelectedSet(set);
    setSelectedMode("draft"); // Default to draft for Phase 15
    setIsDialogOpen(true);
  };

  // Handle starting a session
  const handleStartSession = () => {
    if (!selectedSet) return;

    const setCode = selectedSet.code.toLowerCase();
    
    if (selectedMode === "sealed") {
      router.push(`/sealed?set=${setCode}`);
    } else {
      // Draft will be implemented in Phase 15
      console.warn("Draft mode not yet implemented");
      router.push(`/draft?set=${setCode}`);
    }
  };

  // Format release date
  const formatReleaseDate = (dateStr: string | null | undefined): string => {
    if (!dateStr) return "TBA";
    try {
      return format(new Date(dateStr), "MMM d, yyyy");
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="flex h-full min-h-svh w-full flex-col p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="font-headline text-3xl font-bold">Select a Set</h1>
          <p className="text-muted-foreground mt-1">
            Choose a Magic: The Gathering set for Draft or Sealed
          </p>
        </div>
        
        {/* Sort Controls */}
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">Sort by:</span>
          <Select
            value={sortOption}
            onValueChange={(value) => setSortOption(value as SetSortOption)}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="release_date">Release Date</SelectItem>
              <SelectItem value="name">Name (A-Z)</SelectItem>
              <SelectItem value="card_count">Card Count</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <Card className="mb-6 border-destructive">
          <CardContent className="py-4">
            <p className="text-destructive">{error}</p>
            <Button
              variant="outline"
              className="mt-2"
              onClick={() => window.location.reload()}
            >
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i} className="overflow-hidden">
              <CardHeader className="pb-2">
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-4 w-1/2 mt-2" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3 mt-2" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Sets Grid */}
      {!isLoading && !error && (
        <>
          <div className="mb-4 text-sm text-muted-foreground">
            Showing {filteredSets.length} sets
          </div>
          
          <ScrollArea className="flex-1">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pb-6">
              {filteredSets.map((set) => (
                <SetCard
                  key={set.id}
                  set={set}
                  onClick={() => handleSetClick(set)}
                  formatReleaseDate={formatReleaseDate}
                />
              ))}
            </div>
          </ScrollArea>
        </>
      )}

      {/* Selection Dialog */}
      <SelectionDialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        set={selectedSet}
        selectedMode={selectedMode}
        onModeChange={setSelectedMode}
        onStart={handleStartSession}
        formatReleaseDate={formatReleaseDate}
      />
    </div>
  );
}

// ============================================================================
// Set Card Component
// ============================================================================

interface SetCardProps {
  set: ScryfallSet;
  onClick: () => void;
  formatReleaseDate: (date: string | null | undefined) => string;
}

function SetCard({ set, onClick, formatReleaseDate }: SetCardProps) {
  return (
    <Card
      className="cursor-pointer transition-all hover:shadow-lg hover:border-primary/50"
      onClick={onClick}
    >
      {/* Set Icon */}
      <div className="relative h-16 bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center">
        {set.icon_svg_uri ? (
          <img
            src={set.icon_svg_uri}
            alt={`${set.name} icon`}
            className="h-12 w-12 object-contain"
          />
        ) : (
          <div className="text-3xl font-bold text-muted-foreground">
            {set.code.toUpperCase()}
          </div>
        )}
        <Badge
          variant="secondary"
          className="absolute top-2 right-2"
        >
          {set.card_count} cards
        </Badge>
      </div>

      <CardHeader className="pb-2">
        <CardTitle className="text-lg leading-tight">{set.name}</CardTitle>
        <p className="text-sm text-muted-foreground">
          {getSetTypeDisplayName(set.set_type)}
        </p>
      </CardHeader>

      <CardContent className="pt-0">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {formatReleaseDate(set.released_at)}
          </span>
          <Badge variant="outline" className="font-mono text-xs">
            {set.code.toUpperCase()}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Selection Dialog Component
// ============================================================================

interface SelectionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  set: ScryfallSet | null;
  selectedMode: LimitedMode;
  onModeChange: (mode: LimitedMode) => void;
  onStart: () => void;
  formatReleaseDate: (date: string | null | undefined) => string;
}

function SelectionDialog({
  isOpen,
  onClose,
  set,
  selectedMode,
  onModeChange,
  onStart,
  formatReleaseDate,
}: SelectionDialogProps) {
  if (!set) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{set.name}</DialogTitle>
          <DialogDescription>
            {getSetTypeDisplayName(set.set_type)} • Released{" "}
            {formatReleaseDate(set.released_at)}
          </DialogDescription>
        </DialogHeader>

        {/* Set Details */}
        <div className="space-y-4 py-4">
          <div className="flex items-center gap-4">
            {set.icon_svg_uri && (
              <img
                src={set.icon_svg_uri}
                alt={`${set.name} icon`}
                className="h-16 w-16 object-contain"
              />
            )}
            <div>
              <p className="text-2xl font-bold">{set.card_count}</p>
              <p className="text-sm text-muted-foreground">cards in set</p>
            </div>
          </div>

          {/* Mode Selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Select Mode</label>
            <Select
              value={selectedMode}
              onValueChange={(value) => onModeChange(value as LimitedMode)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sealed">
                  Sealed Deck (6 packs, build immediately)
                </SelectItem>
                <SelectItem value="draft">
                  Draft (3 packs, pick cards)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onStart}>
            {selectedMode === "sealed" ? "Start Sealed" : "Start Draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
