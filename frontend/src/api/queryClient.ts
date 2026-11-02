import { QueryClient } from '@tanstack/react-query';
import { ApiError, NetworkError } from './errors';

const MAX_READ_RETRIES = 2;

/** Reads retry network failures and 5xx, never 4xx (a 4xx will not change by asking again). */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_READ_RETRIES) return false;
  if (error instanceof NetworkError) return true;
  if (error instanceof ApiError) return error.status >= 500;
  return false;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetryQuery,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
      // A mutation is one user intent with one Idempotency-Key; retrying is the user's decision.
      mutations: { retry: false },
    },
  });
}

export const queryClient = createQueryClient();
