"use client";

import * as React from "react";
import { memo, useMemo, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Skull, 
  Ban, 
  Library, 
  Crown, 
  Layers,
  Eye,
  Search,
  User
} from "lucide-react";
import { ZoneType } from "@/types/game";
import { cn } from "@/lib/utils";

/**
 * Card data for display in zone viewers
 */
interface ZoneCard {
  id: string;
  name: string;
  typeLine: string;
  manaCost?: string;
  cmc?: number;
  colors?: string[];
  imageUrl?: string;
  oracleText?: string;
  power?: string;
  toughness?: string;
}

/**
 * Props for the ZoneViewer component
 */
interface ZoneViewerProps {
  /** Cards in the graveyard */
  graveyard?: ZoneCard[];
  /** Cards in exile */
  exile?: ZoneCard[];
  /** Cards in the command zone */
  command?: ZoneCard[];
  /** Cards on the stack */
  stack?: StackItem[];
  /** Cards in sideboard */
  sideboard?: ZoneCard[];
  /** Cards in companion zone */
  companion?: ZoneCard[];
  /** Currently open tab */
  defaultTab?: "graveyard" | "exile" | "command" | "stack" | "sideboard" | "companion";
  /** Callback when a card is clicked */
  onCardClick?: (cardId: string) => void;
  /** Callback when the viewer is closed */
  onClose?: () => void;
  /** Whether the viewer is open */
  isOpen?: boolean;
  /** Title for the viewer */
  title?: string;
  /** Player name for context */
  playerName?: string;
}

/**
 * Stack item for the stack viewer
 */
interface StackItem {
  id: string;
  name: string;
  typeLine: string;
  manaCost?: string;
  cmc?: number;
  colors?: string[];
  controllerName: string;
  targets?: string[];
  modes?: string[];
  isCopiedSpell?: boolean;
}

/**
 * Sort options for zone cards
 */
type SortOption = "name" | "cmc" | "type" | "color";

/**
 * Zone card list component
 */
const ZoneCardList = memo(function ZoneCardList({
  cards,
  onCardClick,
  sortBy = "name",
}: {
  cards: ZoneCard[];
  onCardClick?: (cardId: string) => void;
  sortBy?: SortOption;
}) {
  const sortedCards = useMemo(() => {
    const sorted = [...cards];
    switch (sortBy) {
      case "name":
        return sorted.sort((a, b) => a.name.localeCompare(b.name));
      case "cmc":
        return sorted.sort((a, b) => (a.cmc || 0) - (b.cmc || 0));
      case "type":
        return sorted.sort((a, b) => a.typeLine.localeCompare(b.typeLine));
      case "color":
        return sorted.sort((a, b) => (a.colors?.[0] || "").localeCompare(b.colors?.[0] || ""));
      default:
        return sorted;
    }
  }, [cards, sortBy]);

  const colorMap: Record<string, string> = {
    W: "bg-white border-white",
    U: "bg-blue-500 border-blue-500",
    B: "bg-black border-black",
    R: "bg-red-500 border-red-500",
    G: "bg-green-500 border-green-500",
  };

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
      {sortedCards.map((card, idx) => (
        <button
          key={`${card.id}-${idx}`}
          onClick={() => onCardClick?.(card.id)}
          className="group relative flex flex-col items-center p-2 rounded-md border border-border hover:border-primary/50 hover:bg-primary/5 transition-all text-left w-full"
        >
          {/* Color indicator */}
          {card.colors && card.colors.length > 0 && (
            <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-md overflow-hidden">
              {card.colors.map((color) => (
                <div 
                  key={color} 
                  className={cn("w-full", colorMap[color] || "bg-gray-400")}
                  style={{ height: `${100 / (card.colors?.length ?? 1)}%` }}
                />
              ))}
            </div>
          )}
          
          {/* Card name */}
          <span className="text-xs font-medium truncate w-full pl-2" title={card.name}>
            {card.name}
          </span>
          
          {/* Card type */}
          <span className="text-[10px] text-muted-foreground truncate w-full pl-2" title={card.typeLine}>
            {card.typeLine}
          </span>
          
          {/* Mana cost if present */}
          {card.manaCost && (
            <span className="text-[10px] text-muted-foreground mt-1">
              {card.manaCost}
            </span>
          )}
          
          {/* P/T for creatures */}
          {card.power && card.toughness && (
            <span className="text-xs font-mono mt-1">
              {card.power}/{card.toughness}
            </span>
          )}
        </button>
      ))}
    </div>
  );
});

/**
 * Stack item component
 */
const StackItemDisplay = memo(function StackItemDisplay({
  item,
}: {
  item: StackItem;
}) {

  return (
    <div className="flex flex-col p-3 rounded-md border border-border bg-muted/30">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm truncate">{item.name}</span>
            {item.isCopiedSpell && (
              <Badge variant="outline" className="text-[10px]">Copy</Badge>
            )}
          </div>
          <span className="text-xs text-muted-foreground">{item.typeLine}</span>
        </div>
        <div className="flex flex-col items-end gap-1">
          {item.manaCost && (
            <span className="text-xs">{item.manaCost}</span>
          )}
          <span className="text-xs text-muted-foreground">
            {item.controllerName}
          </span>
        </div>
      </div>

      {/* Targets */}
      {item.targets && item.targets.length > 0 && (
        <div className="mt-2 pt-2 border-t border-border/50">
          <span className="text-xs text-muted-foreground">Targets: </span>
          <span className="text-xs">{item.targets.join(", ")}</span>
        </div>
      )}

      {/* Modes */}
      {item.modes && item.modes.length > 0 && (
        <div className="mt-2 pt-2 border-t border-border/50">
          <span className="text-xs text-muted-foreground">Modes: </span>
          <div className="mt-1 space-y-1">
            {item.modes.map((mode, idx) => (
              <div key={idx} className="text-xs bg-background/50 p-1 rounded">
                {mode}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

/**
 * Main ZoneViewer component
 */
export function ZoneViewer({
  graveyard = [],
  exile = [],
  command = [],
  stack = [],
  sideboard = [],
  companion = [],
  defaultTab = "graveyard",
  onCardClick,
  onClose,
  isOpen = true,
  title = "Zone Viewer",
  playerName,
}: ZoneViewerProps) {
  const [activeTab, setActiveTab] = useState<string>(defaultTab);
  const [sortBy, setSortBy] = useState<SortOption>("name");
  const [searchQuery, setSearchQuery] = useState("");

  // Filter cards based on search
  const filterCards = useCallback((cards: ZoneCard[]) => {
    if (!searchQuery) return cards;
    const query = searchQuery.toLowerCase();
    return cards.filter(
      (card) =>
        card.name.toLowerCase().includes(query) ||
        card.typeLine.toLowerCase().includes(query)
    );
  }, [searchQuery]);

  const filteredGraveyard = useMemo(() => filterCards(graveyard), [graveyard, filterCards]);
  const filteredExile = useMemo(() => filterCards(exile), [exile, filterCards]);
  const filteredCommand = useMemo(() => filterCards(command), [command, filterCards]);
  const filteredSideboard = useMemo(() => filterCards(sideboard), [sideboard, filterCards]);
  const filteredCompanion = useMemo(() => filterCards(companion), [companion, filterCards]);

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose?.()}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5" />
            {title}
          </DialogTitle>
          {playerName && (
            <DialogDescription>
              Viewing zones for {playerName}
            </DialogDescription>
          )}
        </DialogHeader>

        {/* Search and sort controls */}
        <div className="flex items-center gap-2 pb-2 border-b">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search cards..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-4 py-1.5 text-sm border rounded-md bg-background"
            />
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">Sort:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="text-xs border rounded px-2 py-1 bg-background"
            >
              <option value="name">Name</option>
              <option value="cmc">CMC</option>
              <option value="type">Type</option>
              <option value="color">Color</option>
            </select>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="graveyard" className="flex items-center gap-1">
              <Skull className="h-3 w-3" />
              Graveyard
              {graveyard.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-[10px]">
                  {graveyard.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="exile" className="flex items-center gap-1">
              <Ban className="h-3 w-3" />
              Exile
              {exile.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-[10px]">
                  {exile.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="command" className="flex items-center gap-1">
              <Crown className="h-3 w-3" />
              Command
              {command.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-[10px]">
                  {command.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="stack" className="flex items-center gap-1">
              <Layers className="h-3 w-3" />
              Stack
              {stack.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-[10px]">
                  {stack.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="sideboard" className="flex items-center gap-1">
              <Library className="h-3 w-3" />
              Sideboard
              {sideboard.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-[10px]">
                  {sideboard.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="companion" className="flex items-center gap-1">
              <User className="h-3 w-3" />
              Companion
              {companion.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-[10px]">
                  {companion.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* Tab content */}
          <ScrollArea className="flex-1 mt-2">
            <TabsContent value="graveyard" className="m-0">
              {filteredGraveyard.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Skull className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>Graveyard is empty</p>
                </div>
              ) : (
                <ZoneCardList 
                  cards={filteredGraveyard} 
                  onCardClick={onCardClick}
                  sortBy={sortBy}
                />
              )}
            </TabsContent>

            <TabsContent value="exile" className="m-0">
              {filteredExile.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Ban className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>Exile zone is empty</p>
                </div>
              ) : (
                <ZoneCardList 
                  cards={filteredExile} 
                  onCardClick={onCardClick}
                  sortBy={sortBy}
                />
              )}
            </TabsContent>

            <TabsContent value="command" className="m-0">
              {filteredCommand.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Crown className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>Command zone is empty</p>
                </div>
              ) : (
                <ZoneCardList 
                  cards={filteredCommand} 
                  onCardClick={onCardClick}
                  sortBy={sortBy}
                />
              )}
            </TabsContent>

            <TabsContent value="stack" className="m-0">
              {stack.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Layers className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>Stack is empty</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {stack.map((item) => (
                    <StackItemDisplay 
                      key={item.id} 
                      item={item}
                    />
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="sideboard" className="m-0">
              {filteredSideboard.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Library className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>Sideboard is empty</p>
                </div>
              ) : (
                <ZoneCardList 
                  cards={filteredSideboard} 
                  onCardClick={onCardClick}
                  sortBy={sortBy}
                />
              )}
            </TabsContent>

            <TabsContent value="companion" className="m-0">
              {filteredCompanion.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <User className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No companion</p>
                </div>
              ) : (
                <ZoneCardList 
                  cards={filteredCompanion} 
                  onCardClick={onCardClick}
                  sortBy={sortBy}
                />
              )}
            </TabsContent>
          </ScrollArea>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Compact zone button for quick access
 */
export function ZoneButton({
  zone,
  count,
  onClick,
  className,
}: {
  zone: ZoneType;
  count: number;
  onClick?: () => void;
  className?: string;
}) {
  const icons: Record<ZoneType, React.ReactNode> = {
    graveyard: <Skull className="h-4 w-4" />,
    exile: <Ban className="h-4 w-4" />,
    commandZone: <Crown className="h-4 w-4" />,
    stack: <Layers className="h-4 w-4" />,
    library: <Library className="h-4 w-4" />,
    hand: null,
    battlefield: null,
    sideboard: <Library className="h-4 w-4" />,
    anticipate: null,
    companion: <User className="h-4 w-4" />,
  };

  const labels: Record<ZoneType, string> = {
    graveyard: "Graveyard",
    exile: "Exile",
    commandZone: "Command",
    stack: "Stack",
    library: "Library",
    hand: "Hand",
    battlefield: "Battlefield",
    sideboard: "Sideboard",
    anticipate: "Anticipate",
    companion: "Companion",
  };

  const Icon = icons[zone];

  if (!Icon) return null;

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      className={cn("flex items-center gap-1", className)}
      disabled={count === 0}
    >
      {Icon}
      <span>{labels[zone]}</span>
      {count > 0 && (
        <Badge variant="secondary" className="ml-1 text-[10px]">
          {count}
        </Badge>
      )}
    </Button>
  );
}

export default ZoneViewer;
