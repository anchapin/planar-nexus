import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Create a simple checksum for data integrity verification
 * Uses a djb2-style hash for simplicity and speed
 */
export function createChecksum(data: string): string {
  let hash = 5381;
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5) + hash) ^ data.charCodeAt(i);
  }
  // Convert to positive hex string
  const unsigned = hash >>> 0;
  return unsigned.toString(16).padStart(8, '0');
}

/**
 * Verify data against a checksum
 */
export function verifyChecksum(data: string, checksum: string): boolean {
  const computed = createChecksum(data);
  return computed === checksum;
}
