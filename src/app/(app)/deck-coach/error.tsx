'use client';

import { Button } from '@/components/ui/button';
import { Bot, Home } from 'lucide-react';
import Link from 'next/link';

export default function DeckCoachError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[50vh] items-center justify-center bg-background p-4">
      <div className="max-w-md text-center space-y-6">
        <div className="flex justify-center">
          <div className="rounded-full bg-destructive/10 p-4">
            <Bot className="size-12 text-destructive" aria-hidden="true" />
          </div>
        </div>
        <div className="space-y-2">
          <h1 className="font-headline text-2xl font-bold text-foreground">
            Coach Connection Lost
          </h1>
          <p className="text-muted-foreground">
            The AI coach is temporarily unavailable. Your deck is safe, and you can try connecting again later.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Button onClick={reset}>Try Again</Button>
          <Button variant="outline" asChild>
            <Link href="/dashboard">
              <Home className="mr-2 size-4" />
              Return to Dashboard
            </Link>
          </Button>
        </div>
        {process.env.NODE_ENV === 'development' && (
          <details className="rounded-lg border bg-muted p-4 text-left">
            <summary className="cursor-pointer font-medium text-foreground">
              Error Details
            </summary>
            <pre className="mt-2 overflow-auto text-xs text-muted-foreground">
              {error.message}
              {error.digest && `\n\nDigest: ${error.digest}`}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}
