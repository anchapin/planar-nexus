"use client";

import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useCollection } from "@/hooks/use-collection";
import { ScryfallCard, searchCards } from "@/app/actions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Plus, Trash2, Download, Upload, FolderPlus, Package } from "lucide-react";

export default function CollectionPage() {
  const { toast } = useToast();
  const {
    collections,
    activeCollection,
    activeCollectionId,
    setActiveCollectionId,
    addCard,
    removeCard,
    createCollection,
    deleteCollection,
    renameCollection,
    importFromCSV,
    exportToCSV,
  } = useCollection();

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState< ScryfallCard[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [importText, setImportText] = useState("");
  const [newCollectionName, setNewCollectionName] = useState("");
  const [showNewCollectionDialog, setShowNewCollectionDialog] = useState(false);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    try {
      const results = await searchCards(searchQuery, "commander");
      setSearchResults(results.slice(0, 20)); // Limit to 20 results
    } catch (error) {
      console.error(error);
      toast({
        variant: "destructive",
        title: "Search Failed",
        description: "Failed to search for cards.",
      });
    } finally {
      setIsSearching(false);
    }
  };

  const handleAddCard = (card: ScryfallCard) => {
    addCard(card, 1);
    toast({
      title: "Card Added",
      description: `${card.name} has been added to your collection.`,
    });
  };

  const handleRemoveCard = (cardId: string, cardName: string) => {
    removeCard(cardId, 1);
    toast({
      title: "Card Removed",
      description: `${cardName} has been removed from your collection.`,
    });
  };

  const handleImport = () => {
    if (!importText.trim()) {
      toast({
        variant: "destructive",
        title: "Import Failed",
        description: "Please paste a decklist or card list to import.",
      });
      return;
    }

    importFromCSV(importText);
    setImportText("");
    toast({
      title: "Import Complete",
      description: "Cards have been added to your collection.",
    });
  };

  const handleExport = () => {
    const csv = exportToCSV();
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeCollection.name.replace(/\s/g, '_')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast({
      title: "Export Complete",
      description: "Your collection has been exported.",
    });
  };

  const handleCreateCollection = () => {
    if (!newCollectionName.trim()) {
      toast({
        variant: "destructive",
        title: "Invalid Name",
        description: "Please enter a name for the collection.",
      });
      return;
    }

    createCollection(newCollectionName);
    setNewCollectionName("");
    setShowNewCollectionDialog(false);
    toast({
      title: "Collection Created",
      description: `Created "${newCollectionName}" collection.`,
    });
  };

  const filteredCards = activeCollection.cards.filter((c) =>
    c.card.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const totalCards = activeCollection.cards.reduce((sum, c) => sum + c.quantity, 0);
  const uniqueCards = activeCollection.cards.length;

  return (
    <div className="flex h-full min-h-svh w-full flex-col p-4 md:p-6">
      <div className="mb-6">
        <h1 className="font-headline text-3xl font-bold">Collection</h1>
        <p className="text-muted-foreground mt-2">
          Track and manage your card collection.
        </p>
      </div>

      {/* Collection Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{totalCards}</div>
            <div className="text-sm text-muted-foreground">Total Cards</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{uniqueCards}</div>
            <div className="text-sm text-muted-foreground">Unique Cards</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{collections.length}</div>
            <div className="text-sm text-muted-foreground">Collections</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">
              {activeCollection.cards.filter((c) => c.quantity >= 4).length}
            </div>
            <div className="text-sm text-muted-foreground">Playable (4+)</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Collection List */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>{activeCollection.name}</CardTitle>
                <CardDescription>
                  {totalCards} cards • Updated {new Date(activeCollection.updatedAt).toLocaleDateString()}
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Dialog open={showNewCollectionDialog} onOpenChange={setShowNewCollectionDialog}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm">
                      <FolderPlus className="h-4 w-4 mr-2" />
                      New
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Create New Collection</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 pt-4">
                      <div className="space-y-2">
                        <Label htmlFor="collectionName">Collection Name</Label>
                        <Input
                          id="collectionName"
                          value={newCollectionName}
                          onChange={(e) => setNewCollectionName(e.target.value)}
                          placeholder="My Binder"
                        />
                      </div>
                      <Button onClick={handleCreateCollection}>Create Collection</Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {/* Search/Filter */}
            <div className="flex gap-2 mb-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search collection..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>

            {/* Collection Cards */}
            {filteredCards.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No cards in your collection yet.</p>
                <p className="text-sm">Search for cards to add them.</p>
              </div>
            ) : (
              <ScrollArea className="h-[400px]">
                <div className="space-y-2">
                  {filteredCards.map((collectionCard) => (
                    <div
                      key={collectionCard.card.id}
                      className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <Badge variant="secondary" className="w-8 justify-center">
                          {collectionCard.quantity}
                        </Badge>
                        <div>
                          <div className="font-medium">{collectionCard.card.name}</div>
                          {collectionCard.card.set && (
                            <div className="text-xs text-muted-foreground">
                              {collectionCard.card.set.toUpperCase()} #{collectionCard.card.collector_number}
                            </div>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemoveCard(collectionCard.card.id, collectionCard.card.name)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        {/* Right Column - Add Cards / Import Export */}
        <div className="space-y-6">
          {/* Add Cards */}
          <Card>
            <CardHeader>
              <CardTitle>Add Cards</CardTitle>
              <CardDescription>Search and add cards to your collection.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input
                  placeholder="Search for cards..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                />
                <Button onClick={handleSearch} disabled={isSearching}>
                  {isSearching ? "..." : <Search className="h-4 w-4" />}
                </Button>
              </div>

              {searchResults.length > 0 && (
                <ScrollArea className="h-[300px]">
                  <div className="space-y-2">
                    {searchResults.map((card) => (
                      <div
                        key={card.id}
                        className="flex items-center justify-between p-2 rounded border bg-card"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{card.name}</div>
                          <div className="text-xs text-muted-foreground truncate">
                            {card.set?.toUpperCase()} {card.collector_number}
                          </div>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => handleAddCard(card)}>
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>

          {/* Import/Export */}
          <Card>
            <CardHeader>
              <CardTitle>Import / Export</CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="import">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="import">Import</TabsTrigger>
                  <TabsTrigger value="export">Export</TabsTrigger>
                </TabsList>

                <TabsContent value="import" className="space-y-4 mt-4">
                  <Textarea
                    placeholder="Paste decklist or card list here (one card per line)&#10;4 Lightning Bolt&#10;Counterspell"
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                    className="min-h-[150px]"
                  />
                  <Button onClick={handleImport} className="w-full">
                    <Upload className="h-4 w-4 mr-2" />
                    Import Cards
                  </Button>
                </TabsContent>

                <TabsContent value="export" className="space-y-4 mt-4">
                  <p className="text-sm text-muted-foreground">
                    Export your collection as a CSV file that can be imported into other apps.
                  </p>
                  <Button onClick={handleExport} className="w-full">
                    <Download className="h-4 w-4 mr-2" />
                    Export Collection
                  </Button>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          {/* Collection Selector */}
          <Card>
            <CardHeader>
              <CardTitle>Collections</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {collections.map((collection) => (
                  <div
                    key={collection.id}
                    className={`flex items-center justify-between p-2 rounded cursor-pointer ${
                      collection.id === activeCollectionId ? "bg-accent" : "hover:bg-accent/50"
                    }`}
                    onClick={() => setActiveCollectionId(collection.id)}
                  >
                    <div>
                      <div className="font-medium">{collection.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {collection.cards.reduce((sum, c) => sum + c.quantity, 0)} cards
                      </div>
                    </div>
                    {collection.id !== "default-collection" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteCollection(collection.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
