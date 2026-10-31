/**
 * API client simulator providing 150-400ms latency and 2% injected network errors
 * to ensure UI error states and retry buttons function authentically.
 * Conforms to RFC 9457 Problem Details for HTTP APIs (13 §16).
 */

import { RFC9457Problem, PostingViolation } from '@/mock/PostingRules';

export class ApiError extends Error implements RFC9457Problem {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
  errors?: Record<string, string[]>;
  violations?: PostingViolation[];
  request_id: string;

  constructor(
    message: string,
    status = 500,
    code = 'network_error',
    violations?: PostingViolation[],
    errors?: Record<string, string[]>
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.detail = message;
    this.type = `https://ledgerly.app/errors/${code.replace(/_/g, '-')}`;
    this.title = code
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
    this.violations = violations;
    this.errors = errors;
    this.request_id = `req-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  }

  toJSON(): RFC9457Problem {
    return {
      type: this.type,
      title: this.title,
      status: this.status,
      code: this.code,
      detail: this.detail,
      errors: this.errors,
      violations: this.violations,
      request_id: this.request_id,
    };
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
    throw new ApiError(
      'Temporary network glitch. Server returned 503 Service Unavailable.',
      503,
      'service_unavailable'
    );
  }

  return action();
}
