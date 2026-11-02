import { ApiError, NetworkError } from './errors';

/** User-facing text for an error. Branches on `code` and class, never on server message text. */
export function describeError(e: unknown): string {
  if (e instanceof NetworkError) return 'The server could not be reached. Check your connection and try again.';
  if (e instanceof ApiError) {
    switch (e.code) {
      case 'rate_limited':
        return e.retryAfterSeconds ? `Too many attempts. Try again in ${e.retryAfterSeconds} seconds.` : 'Too many attempts. Try again in a moment.';
      case 'tenant_read_only':
        return 'This organisation is read-only right now, so changes cannot be saved.';
      case 'forbidden':
        return 'You do not have permission to do this.';
      case 'unauthenticated':
        return 'Your session has ended. Sign in again.';
      case 'version_conflict':
        return 'Someone else changed this while you were editing.';
      case 'signature_required':
        return 'This action needs your signing PIN.';
      case 'validation_failed':
        return 'Some fields need attention.';
      default:
        return e.status >= 500 ? 'Something went wrong on our side. Try again.' : e.detail || 'The request could not be completed.';
    }
  }
  return 'Something went wrong. Try again.';
}

/** First message for a field from a 422 `errors` map. */
export function fieldError(e: unknown, field: string): string | undefined {
  return e instanceof ApiError ? e.errors?.[field]?.[0] : undefined;
}
