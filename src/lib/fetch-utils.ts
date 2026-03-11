/**
 * Centralized fetch utility with consistent error handling
 * 
 * Provides:
 * - Timeout handling for slow requests
 * - HTTP status code checks
 * - Network error handling
 * - User-friendly error messages
 */

/**
 * Custom error class for API errors
 */
export class ApiError extends Error {
  public status?: number;
  public statusText?: string;

  constructor(message: string, status?: number, statusText?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.statusText = statusText;
  }
}

/**
 * Options for safeFetch
 */
export interface SafeFetchOptions extends RequestInit {
  /** Timeout in milliseconds (default: 10000) */
  timeoutMs?: number;
  /** Custom error message prefix */
  errorMessage?: string;
  /** Whether to parse response as JSON (default: true) */
  parseJson?: boolean;
  /** Whether to return full response with headers (default: false) */
  fullResponse?: boolean;
}

/**
 * Full response type with headers
 */
export interface FullResponse<T> {
  data: T;
  status: number;
  statusText: string;
  headers: Headers;
}

/**
 * Safe fetch wrapper with consistent error handling
 * 
 * @param url - The URL to fetch
 * @param options - Fetch options with timeout and error handling
 * @returns The response data (parsed as JSON by default)
 * @throws ApiError with user-friendly message
 */
export async function safeFetch<T = unknown>(
  url: string,
  options: SafeFetchOptions = {}
): Promise<T | FullResponse<T>> {
  const {
    timeoutMs = 10000,
    errorMessage,
    parseJson = true,
    fullResponse = false,
    ...fetchOptions
  } = options;

  try {
    // Create abort controller with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Check for HTTP errors
    if (!response.ok) {
      let errorDetails: string;

      try {
        const errorData = await response.json();
        errorDetails = errorData.error?.message || errorData.message || JSON.stringify(errorData);
      } catch {
        errorDetails = response.statusText || `HTTP ${response.status}`;
      }

      const defaultMessage = `Request failed: ${errorDetails}`;
      throw new ApiError(
        errorMessage ? `${errorMessage}: ${defaultMessage}` : defaultMessage,
        response.status,
        response.statusText
      );
    }

    // Parse response
    let data: T;
    if (parseJson) {
      data = await response.json() as T;
    } else {
      data = await response.text() as unknown as T;
    }

    // Return full response if requested
    if (fullResponse) {
      return {
        data,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      } as FullResponse<T>;
    }

    return data;
  } catch (error) {
    // Handle abort (timeout)
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError(
        errorMessage
          ? `${errorMessage}: Request timed out after ${timeoutMs}ms`
          : `Request timed out after ${timeoutMs}ms`
      );
    }

    // Handle network errors
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new ApiError(
        errorMessage 
          ? `${errorMessage}: Network error. Please check your connection.`
          : 'Network error. Please check your internet connection.'
      );
    }

    // Re-throw ApiError as-is
    if (error instanceof ApiError) {
      throw error;
    }

    // Handle unknown errors
    const message = error instanceof Error ? error.message : 'Unknown error occurred';
    throw new ApiError(
      errorMessage ? `${errorMessage}: ${message}` : message
    );
  }
}

/**
 * Map API error to user-friendly message
 */
export function mapErrorToUserMessage(error: unknown): string {
  if (error instanceof ApiError) {
    // Specific handling for common errors
    if (error.status === 401) {
      return 'Invalid API key. Please check your credentials.';
    }
    if (error.status === 403) {
      return 'Access denied. Your API key may not have permission for this action.';
    }
    if (error.status === 429) {
      return 'Rate limit exceeded. Please wait a moment and try again.';
    }
    if (error.status === 500 || error.status === 503) {
      return 'Service temporarily unavailable. Please try again later.';
    }
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'An unexpected error occurred.';
}
