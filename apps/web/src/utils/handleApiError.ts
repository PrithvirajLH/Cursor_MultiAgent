import { ApiError } from '../api/client';

/**
 * Centralized error handler that produces user-friendly messages
 * based on error type and HTTP status codes.
 */
export function handleApiError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Your session has expired. Please refresh.';
    if (error.status === 403) return 'You do not have permission to perform this action.';
    if (error.status === 404) return 'The requested resource was not found.';
    if (error.status === 409) return 'A conflict occurred. Please refresh and try again.';
    if (error.status === 422) return error.message || 'Invalid data. Please check your input.';
    if (error.status >= 500) return 'Server error. Please try again later.';
    // Try to parse the message from the API response body
    try {
      const parsed = JSON.parse(error.message) as { message?: string };
      if (typeof parsed?.message === 'string') return parsed.message;
    } catch {
      // not JSON, use raw message
    }
    return error.message || 'An unexpected error occurred.';
  }

  if (error instanceof TypeError && /fetch|network|failed/i.test(error.message)) {
    return 'Network error. Please check your connection.';
  }

  if (error instanceof Error) {
    return error.message || 'An unexpected error occurred.';
  }

  return 'An unexpected error occurred.';
}
