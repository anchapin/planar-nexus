/**
 * Render helper with providers
 * 
 * Provides a render function that wraps components with all necessary providers
 * for consistent testing across the application.
 */

import React, { ReactElement, ReactNode } from 'react';
import { render, RenderOptions, RenderResult } from '@testing-library/react';
import { SidebarProvider } from '@/components/ui/sidebar';
import { Toaster } from '@/components/ui/toaster';

/**
 * Custom provider wrapper component
 */
interface ProvidersProps {
  children: ReactNode;
}

/**
 * Default providers that wrap all test components
 */
function DefaultProviders({ children }: ProvidersProps) {
  return (
    <SidebarProvider>
      {children}
      <Toaster />
    </SidebarProvider>
  );
}

/**
 * Extended render options that include provider overrides
 */
interface ExtendedRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  /**
   * Optional custom providers to wrap the component with.
   * If not provided, uses DefaultProviders.
   */
  wrapper?: React.ComponentType<{ children: ReactNode }>;
  /**
   * Initial state for the router mock
   */
  routerOptions?: {
    pathname?: string;
    query?: Record<string, string>;
    push?: (url: string) => void;
  };
}

/**
 * Custom render function that wraps components with providers
 * 
 * @param ui - The React element to render
 * @param options - Render options including provider overrides
 * @returns Render result with rerender and unmount functions
 * 
 * @example
 * // Basic usage
 * const { rerender, unmount } = renderWithProviders(<MyComponent />);
 * 
 * @example
 * // With custom provider
 * const { rerender } = renderWithProviders(<MyComponent />, {
 *   wrapper: ({ children }) => <CustomProvider>{children}</CustomProvider>
 * });
 */
export function renderWithProviders(
  ui: ReactElement,
  options?: ExtendedRenderOptions
): RenderResult {
  const { wrapper: Wrapper, ...rest } = options || {};
  
  // Use custom wrapper if provided, otherwise use default providers
  const FinalWrapper = Wrapper 
    ? ({ children }: { children: ReactNode }) => (
        <Wrapper>
          <DefaultProviders>{children}</DefaultProviders>
        </Wrapper>
      )
    : DefaultProviders;

  return render(ui, { wrapper: FinalWrapper, ...rest });
}

/**
 * Render a component within the app layout context
 * Useful for testing components that depend on the app layout
 * 
 * @param ui - The React element to render
 * @param options - Render options
 * @returns Render result
 */
export function renderInAppContext(
  ui: ReactElement,
  options?: Omit<ExtendedRenderOptions, 'wrapper'>
): RenderResult {
  return renderWithProviders(ui, options);
}

// Re-export commonly used items from @testing-library/react
export { render, cleanup } from '@testing-library/react';
export type { RenderOptions, RenderResult } from '@testing-library/react';
