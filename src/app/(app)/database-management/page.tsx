'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Download, Upload, Trash2, Database, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { getDatabaseStats, clearDatabase, clearImageCache, importCardsFromFile } from '@/lib/card-database';
import { useToast } from '@/hooks/use-toast';

export default function DatabaseManagementPage() {
  const { toast } = useToast();
  const [stats, setStats] = useState<{ cardCount: number; imageCount: number; isInitialized: boolean } | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [isClearing, setIsClearing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  async function loadStats() {
    try {
      const dbStats = await getDatabaseStats();
      setStats(dbStats);
    } catch (error) {
      console.error('Failed to load database stats:', error);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleFileImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.json')) {
      toast({
        title: 'Invalid file type',
        description: 'Please select a JSON file',
        variant: 'destructive',
      });
      return;
    }

    setIsImporting(true);
    setImportProgress(0);

    try {
      const result = await importCardsFromFile(file, async (count, total) => {
        const progress = Math.round((count / total) * 100);
        setImportProgress(progress);
        // Yield to UI
        await new Promise(resolve => setTimeout(resolve, 0));
      });

      toast({
        title: 'Import successful',
        description: `Imported ${result.count} cards${result.errors.length > 0 ? ` with ${result.errors.length} errors` : ''}`,
      });

      if (result.errors.length > 0) {
        console.warn('Import errors:', result.errors);
      }

      // Reload stats
      await loadStats();
    } catch (error) {
      console.error('Import failed:', error);
      toast({
        title: 'Import failed',
        description: error instanceof Error ? error.message : 'Unknown error occurred',
        variant: 'destructive',
      });
    } finally {
      setIsImporting(false);
      setImportProgress(0);
      // Reset file input
      event.target.value = '';
    }
  }

  async function handleClearDatabase() {
    if (!confirm('Are you sure you want to clear the entire card database? This cannot be undone.')) {
      return;
    }

    setIsClearing(true);
    try {
      await clearDatabase();
      await clearImageCache();
      
      toast({
        title: 'Database cleared',
        description: 'All card data has been removed',
      });

      await loadStats();
    } catch (error) {
      console.error('Failed to clear database:', error);
      toast({
        title: 'Failed to clear database',
        description: error instanceof Error ? error.message : 'Unknown error occurred',
        variant: 'destructive',
      });
    } finally {
      setIsClearing(false);
    }
  }

  async function handleDownloadScript() {
    const scriptUrl = '/scripts/fetch-cards-for-db.ts';
    window.open(scriptUrl, '_blank');
    
    toast({
      title: 'Script location',
      description: 'Opening scripts folder in new tab',
    });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Database Management</h1>
        <p className="text-muted-foreground">
          Import and manage your card database
        </p>
      </div>

      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          Planar Nexus starts with an empty database to avoid legal issues. 
          Use the script below to fetch cards from Scryfall for personal use, then import them here.
        </AlertDescription>
      </Alert>

      {/* Database Stats */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Database Status
          </CardTitle>
          <CardDescription>
            Current database statistics
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-1">
              <div className="text-sm text-muted-foreground">Total Cards</div>
              <div className="text-2xl font-bold">{stats?.cardCount ?? 0}</div>
            </div>
            <div className="space-y-1">
              <div className="text-sm text-muted-foreground">Cached Images</div>
              <div className="text-2xl font-bold">{stats?.imageCount ?? 0}</div>
            </div>
            <div className="space-y-1">
              <div className="text-sm text-muted-foreground">Status</div>
              <div className="flex items-center gap-2">
                {stats?.cardCount === 0 ? (
                  <>
                    <AlertCircle className="h-4 w-4 text-amber-500" />
                    <Badge variant="secondary">Empty</Badge>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    <Badge variant="default">Ready</Badge>
                  </>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Import Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Import Card Database
          </CardTitle>
          <CardDescription>
            Import a JSON file containing card data
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <label htmlFor="card-import" className="flex-1">
              <input
                id="card-import"
                type="file"
                accept=".json"
                onChange={handleFileImport}
                disabled={isImporting}
                className="hidden"
              />
              <Button
                variant="outline"
                className="w-full cursor-pointer"
                disabled={isImporting}
                asChild
              >
                <span>
                  <Upload className="mr-2 h-4 w-4" />
                  {isImporting ? 'Importing...' : 'Select JSON File'}
                </span>
              </Button>
            </label>
          </div>

          {isImporting && (
            <div className="space-y-2">
              <Progress value={importProgress} className="h-2" />
              <p className="text-sm text-muted-foreground text-center">
                Importing cards... {importProgress}%
              </p>
            </div>
          )}

          <div className="text-sm text-muted-foreground">
            <p className="font-medium">Expected JSON format:</p>
            <pre className="mt-2 p-4 bg-muted rounded-md overflow-x-auto text-xs">
              {`[
  {
    "id": "card-uuid",
    "name": "Card Name",
    "cmc": 3,
    "type_line": "Creature — Wizard",
    "oracle_text": "Card text...",
    "colors": ["U"],
    "color_identity": ["U"],
    "legalities": { "commander": "legal" }
  }
]`}
            </pre>
          </div>
        </CardContent>
      </Card>

      {/* Fetch Script Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Fetch Cards Script
          </CardTitle>
          <CardDescription>
            Generate your own card database from Scryfall
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm">
            Run this script to fetch cards from Scryfall API for personal use:
          </p>
          <pre className="p-4 bg-muted rounded-md overflow-x-auto text-sm">
            <code>npx tsx scripts/fetch-cards-for-db.ts --format commander --limit 500 --output ./my-cards.json</code>
          </pre>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleDownloadScript}>
              <Download className="mr-2 h-4 w-4" />
              View Script
            </Button>
          </div>
          <Alert className="bg-amber-50">
            <AlertCircle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-amber-800">
              <strong>Important:</strong> This script is for personal use only. Do not distribute pre-generated card data.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* Danger Zone */}
      <Card className="border-destructive">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-5 w-5" />
            Danger Zone
          </CardTitle>
          <CardDescription>
            Irreversible actions
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="destructive"
            onClick={handleClearDatabase}
            disabled={isClearing || stats?.cardCount === 0}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            {isClearing ? 'Clearing...' : 'Clear Entire Database'}
          </Button>
          <p className="mt-2 text-sm text-muted-foreground">
            This will remove all {stats?.cardCount ?? 0} cards and cached images. This cannot be undone.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
