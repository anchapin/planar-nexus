'use client';

import * as React from 'react';
import { Construction, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * @fileOverview Reusable placeholder UI for stub / under-construction features.
 *
 * Created in Issue #1009 to standardize how non-functional or partially
 * implemented surfaces are presented to end users. Instead of surfacing raw
 * errors or "unavailable" strings, stub components render this friendly
 * "Feature Coming Soon" panel. See STUBS.md for the full stub inventory.
 */

export interface PlaceholderComponentProps {
  /** Feature name shown as the heading. */
  title: string;
  /** Human friendly explanation of current state / what to use instead. */
  description: string;
  /** Optional lucide icon. Defaults to a "construction" signifier. */
  icon?: LucideIcon;
  /** Optional call-to-action rendered below the description. */
  action?: React.ReactNode;
  /** Internal tracking id of the stub (shown only in debug mode). */
  stubId?: string;
  className?: string;
}

/**
 * Friendly "Feature Coming Soon" surface for stub components. Renders a
 * centered, non-blocking notice so users never see a raw error when a backing
 * service is absent.
 */
export function PlaceholderComponent({
  title,
  description,
  icon: Icon = Construction,
  action,
  stubId,
  className,
}: PlaceholderComponentProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-muted-foreground/30 bg-muted/20 p-8 text-center',
        className,
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Icon className="h-6 w-6" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mx-auto max-w-xs text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      {action && <div className="pt-1">{action}</div>}
      {stubId && isDebugStubMode() && (
        <p className="pt-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/60">
          stub: {stubId}
        </p>
      )}
    </div>
  );
}

export interface StubDebugBannerProps {
  /** Short label identifying the stub (e.g. "AI Coach"). */
  label: string;
  className?: string;
}

/**
 * A small, dev-only banner that makes stub status obvious during development.
 * Renders nothing outside of debug mode (production builds are unaffected).
 */
export function StubDebugBanner({ label, className }: StubDebugBannerProps) {
  if (!isDebugStubMode()) return null;
  return (
    <div
      className={cn(
        'flex items-center gap-1.5 border-b border-amber-300/40 bg-amber-100/80 px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
        className,
      )}
    >
      <Construction className="h-3 w-3" aria-hidden="true" />
      <span>Stub · {label} · not yet implemented</span>
    </div>
  );
}

/**
 * Whether stub diagnostics (debug banners, stub ids) should be visible.
 *
 * Gated on `NODE_ENV !== 'production'` plus an opt-in
 * `NEXT_PUBLIC_DEBUG_STUBS` flag so QA can toggle it without a dev server.
 * Production builds never reveal stub internals to end users.
 */
export function isDebugStubMode(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  return process.env.NEXT_PUBLIC_DEBUG_STUBS !== 'false';
}
