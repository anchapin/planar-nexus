import { cn } from "@/lib/utils";

interface SkipLinkProps {
  /** The ID of the target element to skip to */
  targetId: string;
  /** Additional class names */
  className?: string;
}

/**
 * Skip link component for keyboard accessibility
 * Allows users to skip navigation and jump to main content
 */
export function SkipLink({ targetId, className }: SkipLinkProps) {
  return (
    <a
      href={`#${targetId}`}
      className={cn(
        "absolute left-0 top-0 z-50 -translate-y-full transform bg-indigo-600 px-4 py-2 text-white transition-transform focus:translate-y-0",
        className
      )}
    >
      Skip to main content
    </a>
  );
}
