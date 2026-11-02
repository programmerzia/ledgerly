/**
 * Error model (13 §16). The API speaks RFC 9457 problem+json; the SPA switches on `code`,
 * never on message text. A failed network round trip is a different class (NetworkError).
 */

export interface Violation {
  code: string;
  line_no?: number;
  message: string;
}

export interface ApiErrorInit {
  status: number;
  code: string;
  detail: string;
  title?: string;
  errors?: Record<string, string[]>;
  violations?: Violation[];
  serverVersion?: unknown;
  requestId: string | null;
  retryAfterSeconds?: number;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: string;
  readonly errors?: Record<string, string[]>;
  readonly violations?: Violation[];
  readonly serverVersion?: unknown;
  readonly requestId: string | null;
  readonly retryAfterSeconds?: number;

  constructor(init: ApiErrorInit) {
    super(init.detail || init.title || init.code);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.detail = init.detail;
    this.errors = init.errors;
    this.violations = init.violations;
    this.serverVersion = init.serverVersion;
    this.requestId = init.requestId;
    this.retryAfterSeconds = init.retryAfterSeconds;
  }

  get isUnauthenticated(): boolean {
    return this.status === 401;
  }
  /** 409 version_conflict: feed `serverVersion` to the existing ConflictDialog. */
  get isVersionConflict(): boolean {
    return this.code === 'version_conflict';
  }
  /** 403 signature_required: open the SignDialog, then retry the same intent. */
  get isSignatureRequired(): boolean {
    return this.code === 'signature_required';
  }
  get isTenantReadOnly(): boolean {
    return this.code === 'tenant_read_only';
  }
  get isRateLimited(): boolean {
    return this.code === 'rate_limited' || this.status === 429;
  }
  get isValidation(): boolean {
    return this.status === 422 && this.errors !== undefined;
  }
}

/** The request never produced an HTTP response (offline, DNS, CORS, aborted). */
export class NetworkError extends Error {
  readonly cause?: unknown;
  constructor(cause?: unknown) {
    super('The server could not be reached.');
    this.name = 'NetworkError';
    this.cause = cause;
  }
}

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError;
export const isNetworkError = (e: unknown): e is NetworkError => e instanceof NetworkError;

/** Fallback codes when the body is not problem+json (proxy errors, Laravel's own 419 page, ...). */
const STATUS_CODES: Record<number, string> = {
  400: 'bad_request',
  401: 'unauthenticated',
  402: 'entitlement_exceeded',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  419: 'csrf_mismatch',
  422: 'validation_failed',
  423: 'locked',
  429: 'rate_limited',
};

export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Builds an ApiError from a non-2xx response body (already JSON-decoded, or null). */
export function problemToError(status: number, body: unknown, headers?: { get(name: string): string | null }): ApiError {
  const p = isRecord(body) ? body : {};
  const code = typeof p.code === 'string' ? p.code : (STATUS_CODES[status] ?? (status >= 500 ? 'server_error' : 'unknown'));
  const detail = typeof p.detail === 'string' ? p.detail : typeof p.message === 'string' ? p.message : '';
  return new ApiError({
    status,
    code,
    detail,
    title: typeof p.title === 'string' ? p.title : undefined,
    errors: isRecord(p.errors) ? (p.errors as Record<string, string[]>) : undefined,
    violations: Array.isArray(p.violations) ? (p.violations as Violation[]) : undefined,
    serverVersion: p.server_version,
    requestId: typeof p.request_id === 'string' ? p.request_id : (headers?.get('X-Request-Id') ?? null),
    retryAfterSeconds: parseRetryAfter(headers?.get('Retry-After') ?? null),
  });
}
