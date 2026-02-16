/**
 * Saved Games Browser Page
 * Issue #33: Phase 2.3: Add saved games browser
 * 
 * Provides UI for browsing, loading, and managing saved games
 */

"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { 
  Save, 
  Play, 
  Trash2, 
  Search, 
  Filter, 
  Clock, 
  Users, 
  Trophy, 
  RotateCcw,
  Download,
  Upload,
  MoreVertical,
  Share2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { 
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { 
  savedGamesManager, 
  SavedGame, 
  formatSavedAt, 
  getStatusDisplay 
} from "@/lib/saved-games";
import { 
  generateShareableURL, 
  copyShareableLink,
  exportReplayToFile,
  canShareViaURL 
} from "@/lib/replay-sharing";
import { useToast } from "@/hooks/use-toast";

const formatDisplayNames: Record<string, string> = {
  commander: "Commander",
  modern: "Modern",
  standard: "Standard",
  pioneer: "Pioneer",
  legacy: "Legacy",
  vintage: "Vintage",
  pauper: "Pauper",
  unknown: "Unknown",
};

export default function SavedGamesPage() {
  const router = useRouter();
  const { toast } = useToast();
  
  const [games, setGames] = useState<SavedGame[]>([]);
  const [filteredGames, setFilteredGames] = useState<SavedGame[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [formatFilter, setFormatFilter] = useState<string>("all");
  const [deleteTarget, setDeleteTarget] = useState<SavedGame | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [fileInputRef, setFileInputRef] = useState<HTMLInputElement | null>(null);

  // Load games on mount
  useEffect(() => {
    loadGames();
  }, []);

  // Apply filters when games or filter criteria change
  useEffect(() => {
    let filtered = games;

    // Apply search
    if (searchQuery.trim()) {
      filtered = savedGamesManager.searchGames(searchQuery);
    }

    // Apply status filter
    if (statusFilter !== "all") {
      filtered = filtered.filter(g => g.status === statusFilter);
    }

    // Apply format filter
    if (formatFilter !== "all") {
      filtered = filtered.filter(g => g.format === formatFilter);
    }

    setFilteredGames(filtered);
  }, [games, searchQuery, statusFilter, formatFilter]);

  function loadGames() {
    setIsLoading(true);
    const allGames = savedGamesManager.getAllSavedGames();
    setGames(allGames);
    setFilteredGames(allGames);
    setIsLoading(false);
  }

  function handleLoadGame(game: SavedGame) {
    // Store the game ID to load in session storage
    sessionStorage.setItem('loadGameId', game.id);
    toast({
      title: "Loading Game",
      description: `Loading "${game.name}"...`,
    });
    // Navigate to single player to load the game
    router.push('/single-player');
  }

  function handleDeleteGame() {
    if (!deleteTarget) return;
    
    const success = savedGamesManager.deleteGame(deleteTarget.id);
    if (success) {
      toast({
        title: "Game Deleted",
        description: `"${deleteTarget.name}" has been deleted.`,
      });
      loadGames();
    }
    
    setDeleteTarget(null);
  }

  function handleExportGame(game: SavedGame) {
    savedGamesManager.exportGame(game.id);
    toast({
      title: "Game Exported",
      description: `"${game.name}" has been exported.`,
    });
  }

  function handleImportGame(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    savedGamesManager.importGame(file).then((game) => {
      if (game) {
        toast({
          title: "Game Imported",
          description: `"${game.name}" has been imported.`,
        });
        loadGames();
      } else {
        toast({
          variant: "destructive",
          title: "Import Failed",
          description: "Failed to import the game file.",
        });
      }
    });

    // Reset input
    if (fileInputRef) {
      fileInputRef.value = '';
    }
  }

  async function handleShareReplay(game: SavedGame) {
    if (!game.replayJson) {
      toast({
        variant: "destructive",
        title: "No Replay",
        description: "This game doesn't have replay data.",
      });
      return;
    }

    try {
      const replay = JSON.parse(game.replayJson);
      
      // Check if replay can be shared via URL
      if (canShareViaURL(replay)) {
        const success = await copyShareableLink(replay);
        if (success) {
          toast({
            title: "Link Copied",
            description: "Replay link copied to clipboard!",
          });
        } else {
          toast({
            variant: "destructive",
            title: "Copy Failed",
            description: "Failed to copy link to clipboard.",
          });
        }
      } else {
        // Fall back to file export
        exportReplayToFile(replay, `${game.name.replace(/\s+/g, '-')}-replay.json`);
        toast({
          title: "Replay Exported",
          description: "Replay file downloaded. It's too large for URL sharing.",
        });
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Share Failed",
        description: "Failed to generate replay share link.",
      });
    }
  }

  const manualSaves = games.filter(g => !g.isAutoSave);
  const autoSaves = games.filter(g => g.isAutoSave);

  return (
    <div className="flex-1 p-4 md:p-6 max-w-6xl mx-auto">
      <header className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-headline text-3xl font-bold flex items-center gap-2">
              <Save className="w-8 h-8" />
              Saved Games
            </h1>
            <p className="text-muted-foreground mt-1">
              Browse and manage your saved games.
            </p>
          </div>
          <div className="flex gap-2">
            <input
              type="file"
              accept=".json"
              onChange={handleImportGame}
              className="hidden"
              ref={(el) => setFileInputRef(el)}
            />
            <Button 
              variant="outline" 
              onClick={() => fileInputRef?.click()}
            >
              <Upload className="w-4 h-4 mr-2" />
              Import
            </Button>
            <Button variant="outline" onClick={() => router.push('/single-player')}>
              <Play className="w-4 h-4 mr-2" />
              New Game
            </Button>
          </div>
        </div>
      </header>

      <Tabs defaultValue="all" className="space-y-6">
        <TabsList>
          <TabsTrigger value="all">
            All Games ({games.length})
          </TabsTrigger>
          <TabsTrigger value="manual">
            Manual Saves ({manualSaves.length})
          </TabsTrigger>
          <TabsTrigger value="auto">
            Auto-Saves ({autoSaves.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="space-y-6">
          {renderGameList(games)}
        </TabsContent>

        <TabsContent value="manual" className="space-y-6">
          {renderGameList(manualSaves)}
        </TabsContent>

        <TabsContent value="auto" className="space-y-6">
          {renderGameList(autoSaves)}
        </TabsContent>
      </Tabs>
    </div>
  );

  function renderGameList(gameList: SavedGame[]) {
    return (
      <>
        {/* Filters */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Filter Games</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-3">
              {/* Search */}
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-1">
                  <Search className="w-4 h-4" />
                  Search
                </label>
                <Input
                  placeholder="Game name or player..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              {/* Status Filter */}
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-1">
                  <Filter className="w-4 h-4" />
                  Status
                </label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="paused">Paused</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Format Filter */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Format</label>
                <Select value={formatFilter} onValueChange={setFormatFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Formats" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Formats</SelectItem>
                    <SelectItem value="commander">Commander</SelectItem>
                    <SelectItem value="modern">Modern</SelectItem>
                    <SelectItem value="standard">Standard</SelectItem>
                    <SelectItem value="pioneer">Pioneer</SelectItem>
                    <SelectItem value="legacy">Legacy</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Active Filters */}
            {(searchQuery || statusFilter !== "all" || formatFilter !== "all") && (
              <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t">
                {searchQuery && (
                  <Badge variant="secondary" className="cursor-pointer" onClick={() => setSearchQuery("")}>
                    Search: "{searchQuery}" ×
                  </Badge>
                )}
                {statusFilter !== "all" && (
                  <Badge variant="secondary" className="cursor-pointer" onClick={() => setStatusFilter("all")}>
                    Status: {getStatusDisplay(statusFilter as SavedGame['status'])} ×
                  </Badge>
                )}
                {formatFilter !== "all" && (
                  <Badge variant="secondary" className="cursor-pointer" onClick={() => setFormatFilter("all")}>
                    Format: {formatDisplayNames[formatFilter]} ×
                  </Badge>
                )}
                <Button variant="link" size="sm" className="h-auto p-0" onClick={() => {
                  setSearchQuery("");
                  setStatusFilter("all");
                  setFormatFilter("all");
                }}>
                  Clear all
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Games Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center justify-between">
              <span>Games ({gameList.length})</span>
            </CardTitle>
            <CardDescription>
              {gameList.length === 0
                ? "No saved games found."
                : `${gameList.length} game${gameList.length !== 1 ? 's' : ''}`
              }
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-12 text-muted-foreground">
                <RotateCcw className="w-8 h-8 mx-auto mb-4 animate-spin" />
                <p>Loading games...</p>
              </div>
            ) : gameList.length === 0 ? (
              <div className="text-center py-12">
                <Save className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-lg font-semibold mb-2">No Games Found</h3>
                <p className="text-muted-foreground mb-4">
                  {games.length === 0
                    ? "You haven't saved any games yet."
                    : "No games match your filters."}
                </p>
                {games.length > 0 && (
                  <Button variant="outline" onClick={() => {
                    setSearchQuery("");
                    setStatusFilter("all");
                    setFormatFilter("all");
                  }}>
                    Clear Filters
                  </Button>
                )}
                {games.length === 0 && (
                  <Button onClick={() => router.push('/single-player')} className="ml-2">
                    Start a Game
                  </Button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Game Name</TableHead>
                      <TableHead>Players</TableHead>
                      <TableHead>Format</TableHead>
                      <TableHead>Turn</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Saved</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {gameList.map((game) => (
                      <TableRow key={game.id}>
                        <TableCell>
                          <div className="font-medium">{game.name}</div>
                          {game.isAutoSave && (
                            <Badge variant="outline" className="mt-1">
                              Auto-Save {game.autoSaveSlot !== undefined ? game.autoSaveSlot + 1 : ''}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Users className="w-4 h-4 text-muted-foreground" />
                            {game.playerNames.join(", ")}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {formatDisplayNames[game.format] || game.format}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <span>Turn {game.turnNumber}</span>
                            <span className="text-muted-foreground text-xs">
                              ({game.currentPhase})
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={
                            game.status === 'completed' ? 'default' :
                            game.status === 'in_progress' ? 'secondary' :
                            'outline'
                          }>
                            {getStatusDisplay(game.status)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 text-muted-foreground">
                            <Clock className="w-4 h-4" />
                            {formatSavedAt(game.savedAt)}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleLoadGame(game)}
                              disabled={game.status === 'completed'}
                            >
                              <Play className="w-4 h-4 mr-1" />
                              Load
                            </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button size="sm" variant="ghost">
                                  <MoreVertical className="w-4 h-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => handleExportGame(game)}>
                                  <Download className="w-4 h-4 mr-2" />
                                  Export
                                </DropdownMenuItem>
                                {game.replayJson && (
                                  <DropdownMenuItem onClick={() => handleShareReplay(game)}>
                                    <Share2 className="w-4 h-4 mr-2" />
                                    Share Replay
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem 
                                  onClick={() => setDeleteTarget(game)}
                                  className="text-destructive"
                                >
                                  <Trash2 className="w-4 h-4 mr-2" />
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </>
    );
  }
}
