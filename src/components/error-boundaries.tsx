'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Swords } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ComponentErrorBoundaryProps {
  children: React.ReactNode;
  /** Heading shown when the boundary catches an error. */
  title?: string;
  /** User-friendly message shown under the heading. */
  description?: string;
  /** Lucide icon component rendered in the destructive badge. */
  icon?: React.ComponentType<{ className?: string }>;
  /** Label for the reset button. */
  resetLabel?: string;
  /** Optional className applied to the error fallback wrapper. */
  className?: string;
}

interface ComponentErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

const DefaultIcon = AlertTriangle;

/**
 * Reusable React class error boundary for wrapping individual client
 * components so that a single component crash never takes down an entire page.
 *
 * Unlike Next.js route-level `error.tsx`, this can be placed around any
 * component subtree and supports an in-place "Try Again" reset.
 */
export class ComponentErrorBoundary extends React.Component<
  ComponentErrorBoundaryProps,
  ComponentErrorBoundaryState
> {
  constructor(props: ComponentErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(
    error: Error,
  ): ComponentErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ComponentErrorBoundary]', error, errorInfo.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    const { hasError, error } = this.state;
    const {
      children,
      title = 'Something went wrong',
      description = 'An unexpected error occurred while rendering this section.',
      icon: Icon = DefaultIcon,
      resetLabel = 'Try Again',
      className,
    } = this.props;

    if (!hasError) {
      return <>{children}</>;
    }

    return (
      <div
        role="alert"
        className={cn(
          'flex min-h-[200px] items-center justify-center rounded-lg border border-destructive/20 bg-background p-4',
          className,
        )}
      >
        <div className="max-w-md text-center space-y-6">
          <div className="flex justify-center">
            <div className="rounded-full bg-destructive/10 p-4">
              <Icon className="size-12 text-destructive" aria-hidden="true" />
            </div>
          </div>
          <div className="space-y-2">
            <h2 className="font-headline text-2xl font-bold text-foreground">
              {title}
            </h2>
            <p className="text-muted-foreground">{description}</p>
          </div>
          <div className="flex justify-center">
            <Button onClick={this.handleReset}>{resetLabel}</Button>
          </div>
          {process.env.NODE_ENV === 'development' && error && (
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
    );
  }
}

/**
 * Convenience wrapper preconfigured for the game board. Renders the
 * ComponentErrorBoundary with game-specific messaging so that a board
 * rendering failure never crashes the surrounding game page.
 */
export function GameBoardErrorBoundary({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <ComponentErrorBoundary
      title="Game Board Error"
      description="The game board encountered a rendering error. Your game state is preserved — try reloading the board."
      icon={Swords}
      resetLabel="Reload Board"
      className={className}
    >
      {children}
    </ComponentErrorBoundary>
  );
}
