/**
 * P2PStatusBanner
 *
 * Polished, in-app "Coming Soon" status surface for the (not-yet-implemented)
 * WebRTC peer-to-peer multiplayer feature. Replaces the previous jarring,
 * full-screen alert-style modal on the multiplayer join flow.
 *
 * Shows:
 *   - a connection-status indicator (Badge) reflecting the actual P2P state
 *   - clear, non-blocking messaging about feature availability
 *   - an optional "Learn More" link to the P2P roadmap documentation
 *
 * See: https://github.com/anchapin/planar-nexus/issues/984
 */

'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Radio, ExternalLink, Construction } from 'lucide-react';

export type P2PStatus = 'unavailable' | 'coming-soon' | 'in-development';

export interface P2PStatusBannerProps {
  /** Reflects the actual P2P implementation state. Defaults to 'coming-soon'. */
  status?: P2PStatus;
  /** Optional heading override. */
  title?: string;
  /** Optional body copy override. */
  description?: string;
  /**
   * URL opened by the "Learn More" link. Set to empty string to hide the link.
   * Defaults to the project's P2P networking research document.
   */
  learnMoreUrl?: string;
  /** Compact variant renders a single inline row (no description block). */
  compact?: boolean;
  className?: string;
}

const STATUS_META: Record<
  P2PStatus,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  unavailable: { label: 'Unavailable', variant: 'destructive' },
  'coming-soon': { label: 'Coming Soon', variant: 'secondary' },
  'in-development': { label: 'In Development', variant: 'default' },
};

const DEFAULT_LEARN_MORE_URL =
  'https://github.com/anchapin/planar-nexus/blob/main/docs/PHASE-4-5-P2P-NETWORKING-RESEARCH.md';

export function P2PStatusBanner({
  status = 'coming-soon',
  title,
  description,
  learnMoreUrl = DEFAULT_LEARN_MORE_URL,
  compact = false,
  className,
}: P2PStatusBannerProps) {
  const meta = STATUS_META[status];

  const heading =
    title ?? 'P2P Multiplayer Coming Soon';
  const body =
    description ??
    'WebRTC peer-to-peer sync is not yet available in this build. Lobby and deck choices are stored locally for now and will sync across players once multiplayer ships.';

  return (
    <Alert className={cn('gap-2', className)} role="status" aria-live="polite">
      <Construction className="h-4 w-4" aria-hidden="true" />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <AlertTitle className="flex flex-wrap items-center gap-2">
            {heading}
            <Badge variant={meta.variant} data-testid="p2p-status-badge">
              <Radio className="mr-1 h-3 w-3" aria-hidden="true" />
              {meta.label}
            </Badge>
          </AlertTitle>
          {!compact && <AlertDescription>{body}</AlertDescription>}
        </div>
        {learnMoreUrl ? (
          <a
            href={learnMoreUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
            data-testid="p2p-learn-more-link"
          >
            Learn More
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        ) : null}
      </div>
    </Alert>
  );
}

export default P2PStatusBanner;
