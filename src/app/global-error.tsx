"use client";

import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Root global-error boundary (issue #1731).
 *
 * `src/app/error.tsx` catches errors thrown inside route segments, but it can
 * NEVER catch a throw from the root layout itself — in the App Router those
 * errors fall through to the platform default: a white screen in the browser
 * and a blank, unrecoverable frame inside the Tauri webview.
 *
 * `global-error.tsx` is the only file convention that covers that tier. When
 * it activates it REPLACES the root layout, so it must render its own
 * <html>/<body> shell and cannot rely on the root layout's providers, fonts,
 * sidebar, or toaster being mounted.
 *
 * Recovery actions:
 *  - Reload (primary): hard window.location.reload() — the root layout is the
 *    thing that crashed, so a full document reload is the most reliable path
 *    back to a working app.
 *  - Try Again (secondary): Next.js `reset` — re-attempts rendering the root
 *    layout without discarding client state.
 *
 * The digest is always shown (it is an opaque server-side hash, safe to
 * expose and useful for correlating with server logs); the raw error message
 * is only rendered in development, mirroring src/app/error.tsx.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <title>Planar Nexus — Critical Error</title>
      </head>
      <body className="font-body antialiased" suppressHydrationWarning>
        <div
          role="alert"
          className="flex min-h-screen items-center justify-center bg-background p-4"
        >
          <div className="max-w-md text-center space-y-6">
            <div className="flex justify-center">
              <div className="rounded-full bg-destructive/10 p-4">
                <AlertTriangle
                  className="size-12 text-destructive"
                  aria-hidden="true"
                />
              </div>
            </div>
            <div className="space-y-2">
              <h1 className="font-headline text-2xl font-bold text-foreground">
                Something went wrong
              </h1>
              <p className="text-muted-foreground">
                A critical error crashed the application shell itself. The
                planar bridge has collapsed — your decks are stored locally
                and are safe, and reloading usually restores the connection.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
              <Button onClick={() => window.location.reload()}>Reload</Button>
              <Button variant="outline" onClick={reset}>
                Try Again
              </Button>
            </div>
            {error.digest && (
              <p className="font-mono text-xs text-muted-foreground">
                Error digest: {error.digest}
              </p>
            )}
            {process.env.NODE_ENV === "development" && (
              <details className="rounded-lg border bg-muted p-4 text-left">
                <summary className="cursor-pointer font-medium text-foreground">
                  Error Details
                </summary>
                <pre className="mt-2 overflow-auto text-xs text-muted-foreground">
                  {error.message}
                </pre>
              </details>
            )}
          </div>
        </div>
      </body>
    </html>
  );
}
