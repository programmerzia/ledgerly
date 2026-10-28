/**
 * API client simulator providing 150-400ms latency and 2% injected network errors
 * to ensure UI error states and retry buttons function authentically.
 */

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 500, code = 'NETWORK_ERROR') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export async function simulatedCall<T>(
  action: () => T | Promise<T>,
  options: { minMs?: number; maxMs?: number; failRate?: number } = {}
): Promise<T> {
  const minMs = options.minMs ?? 150;
  const maxMs = options.maxMs ?? 400;
  const failRate = options.failRate ?? 0.02; // 2% injected failure

  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  await new Promise((resolve) => setTimeout(resolve, delay));

  if (Math.random() < failRate) {
    throw new ApiError('Temporary network glitch. Server returned 503 Service Unavailable.', 503, 'SERVICE_UNAVAILABLE');
  }

  return action();
}
