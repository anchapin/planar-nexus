'use client';

import { useLocalSearch } from '@/hooks/use-local-search';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Loader2, Database, AlertCircle, CheckCircle2 } from 'lucide-react';

export function IndexingProgress() {
  const { indexingProgress } = useLocalSearch({ enabled: false });
  const { status, processed, total, error } = indexingProgress;

  if (status === 'idle') {
    return null;
  }

  if (status === 'error') {
    return (
      <Alert variant="destructive" className="my-4">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Search Indexing Failed</AlertTitle>
        <AlertDescription>
          {error?.message || 'An unknown error occurred while indexing cards for local search.'}
        </AlertDescription>
      </Alert>
    );
  }

  if (status === 'completed') {
    return (
      <Alert variant="default" className="my-4 border-green-500/50 bg-green-500/10 text-green-700 dark:text-green-400">
        <CheckCircle2 className="h-4 w-4 text-green-500" />
        <AlertTitle>Search Ready</AlertTitle>
        <AlertDescription>
          Local card index is up to date. You can now use semantic search.
        </AlertDescription>
      </Alert>
    );
  }

  const percentage = total > 0 ? Math.round((processed / total) * 100) : 0;

  return (
    <div className="my-4 space-y-3 rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-medium">Building Local Search Index</h3>
        </div>
        <span className="text-xs text-muted-foreground">
          {processed} / {total} cards
        </span>
      </div>
      
      <Progress value={percentage} className="h-2" />
      
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>Optimizing card database for semantic discovery...</span>
      </div>
    </div>
  );
}
