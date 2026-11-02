/**
 * Thin typed fetch wrapper over the generated OpenAPI `paths` (no extra package).
 * Same-origin session cookie (ADR-0006), CSRF via /sanctum/csrf-cookie, JSON only,
 * problem+json -> ApiError, one Idempotency-Key per intent on mutating calls.
 */
import type { paths } from './schema';
import { API_BASE_URL } from './config';
import { ApiError, NetworkError, problemToError } from './errors';
import { IDEMPOTENCY_HEADER, createIntent, isMutating, type Intent } from './idempotency';

type HttpMethod = 'get' | 'post' | 'put' | 'delete' | 'patch';
type PathsWith<M extends HttpMethod> = {
  [P in keyof paths]: paths[P] extends { [K in M]: infer O } ? ([O] extends [never] ? never : O extends undefined ? never : P) : never;
}[keyof paths];
type OperationOf<P extends keyof paths, M extends HttpMethod> = paths[P] extends { [K in M]: infer O } ? NonNullable<O> : never;

type PathParamsOf<O> = O extends { parameters: { path: infer X } } ? X : never;
type QueryOf<O> = O extends { parameters: { query?: infer Q } } ? NonNullable<Q> : never;
type BodyOf<O> = O extends { requestBody: { content: { 'application/json': infer B } } }
  ? B
  : O extends { requestBody?: { content: { 'application/json': infer B } } }
    ? B | undefined
    : never;
type SuccessOf<O> = O extends { responses: infer R }
  ? R extends { 200: { content: { 'application/json': infer J } } }
    ? J
    : R extends { 201: { content: { 'application/json': infer J } } }
      ? J
      : R extends { 200: unknown } | { 201: unknown } | { 204: unknown }
        ? unknown
        : unknown
  : unknown;

/** `cursor` and `limit` are read by every list endpoint but are not in the generated query types yet. */
export interface PageQuery {
  cursor?: string;
  limit?: number;
}

export interface RequestOptions<O> {
  path?: PathParamsOf<O>;
  query?: QueryOf<O> & PageQuery;
  body?: BodyOf<O>;
  /** Reuse the same intent across user-driven retries; omit for a fresh key per call. */
  intent?: Intent;
  signal?: AbortSignal;
}

type ArgsOf<O> = RequestOptions<O>;

export interface HttpClientConfig {
  baseUrl: string;
  fetch: typeof fetch;
  /** Reads a cookie value (decoded). Injected for tests; default reads document.cookie. */
  readCookie: (name: string) => string | undefined;
  /** Called on every 401, after the ApiError is built and before it is thrown. */
  onUnauthenticated?: (error: ApiError) => void;
}

export function readBrowserCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  for (const part of document.cookie.split('; ')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return undefined;
}

const API_PREFIX = '/api';

export function buildUrl(baseUrl: string, path: string, params?: Record<string, unknown>, query?: Record<string, unknown>): string {
  let p = path.replace(/\{(\w+)\}/g, (_, name: string) => {
    const v = params?.[name];
    if (v === undefined || v === null) throw new Error(`Missing path parameter "${name}" for ${path}`);
    return encodeURIComponent(String(v));
  });
  p = `${baseUrl}${API_PREFIX}${p}`;
  if (query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      qs.set(k, String(v));
    }
    const s = qs.toString();
    if (s) p += `?${s}`;
  }
  return p;
}

export class HttpClient {
  private csrf: Promise<void> | null = null;

  constructor(private readonly cfg: HttpClientConfig) {}

  /** Fetches /sanctum/csrf-cookie once; later calls share the result until `resetCsrf()`. */
  ensureCsrf(): Promise<void> {
    if (!this.csrf) {
      this.csrf = this.cfg
        .fetch(`${this.cfg.baseUrl}/sanctum/csrf-cookie`, { credentials: 'include', headers: { Accept: 'application/json' } })
        .then((res) => {
          if (!res.ok) throw problemToError(res.status, null, res.headers);
        })
        .catch((e) => {
          this.csrf = null;
          throw e instanceof ApiError ? e : new NetworkError(e);
        });
    }
    return this.csrf;
  }

  resetCsrf(): void {
    this.csrf = null;
  }

  private async attempt(method: string, url: string, body: unknown, key: string | null, signal?: AbortSignal): Promise<Response> {
    const headers: Record<string, string> = { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
    if (isMutating(method)) {
      await this.ensureCsrf();
      const token = this.cfg.readCookie('XSRF-TOKEN');
      if (token) headers['X-XSRF-TOKEN'] = token;
      if (key) headers[IDEMPOTENCY_HEADER] = key;
    }
    let payload: string | undefined;
    let form: FormData | undefined;
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      // Multipart upload: the browser sets the Content-Type with its boundary.
      form = body;
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    try {
      return await this.cfg.fetch(url, { method, headers, body: form ?? payload, credentials: 'include', signal });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      throw new NetworkError(e);
    }
  }

  /** Low-level call with an untyped path; the typed verbs below delegate here. */
  async request<T>(method: string, url: string, body: unknown, intent?: Intent, signal?: AbortSignal): Promise<T> {
    const m = method.toUpperCase();
    const intentForCall = isMutating(m) ? (intent ?? createIntent()) : undefined;
    const key = intentForCall?.key ?? null;

    let res = await this.attempt(m, url, body, key, signal);
    if (res.status === 419) {
      // Session/CSRF rotated: refresh the cookie and retry once with the SAME key.
      this.resetCsrf();
      res = await this.attempt(m, url, body, key, signal);
    }

    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }

    if (res.ok) {
      intentForCall?.settle();
      return (json ?? undefined) as T;
    }
    const error = problemToError(res.status, json, res.headers);
    // A stored 422 is replayed for the same key, so the next attempt (edited payload) is a new intent.
    if (res.status === 422) intentForCall?.settle();
    if (res.status === 401) this.cfg.onUnauthenticated?.(error);
    throw error;
  }

  /** Escape hatch for endpoints whose generated types are incomplete (e.g. Fortify's register). Path is relative to /api. */
  send<T = unknown>(method: string, apiPath: string, body?: unknown, intent?: Intent): Promise<T> {
    return this.request<T>(method, `${this.cfg.baseUrl}${API_PREFIX}${apiPath}`, body, intent);
  }

  get<P extends PathsWith<'get'>>(path: P, args?: ArgsOf<OperationOf<P, 'get'>>): Promise<SuccessOf<OperationOf<P, 'get'>>> {
    return this.request('GET', buildUrl(this.cfg.baseUrl, path, args?.path as Record<string, unknown>, args?.query as Record<string, unknown>), undefined, undefined, args?.signal);
  }
  post<P extends PathsWith<'post'>>(path: P, args?: ArgsOf<OperationOf<P, 'post'>>): Promise<SuccessOf<OperationOf<P, 'post'>>> {
    return this.request('POST', buildUrl(this.cfg.baseUrl, path, args?.path as Record<string, unknown>, args?.query as Record<string, unknown>), args?.body, args?.intent, args?.signal);
  }
  put<P extends PathsWith<'put'>>(path: P, args?: ArgsOf<OperationOf<P, 'put'>>): Promise<SuccessOf<OperationOf<P, 'put'>>> {
    return this.request('PUT', buildUrl(this.cfg.baseUrl, path, args?.path as Record<string, unknown>, args?.query as Record<string, unknown>), args?.body, args?.intent, args?.signal);
  }
  delete<P extends PathsWith<'delete'>>(path: P, args?: ArgsOf<OperationOf<P, 'delete'>>): Promise<SuccessOf<OperationOf<P, 'delete'>>> {
    return this.request('DELETE', buildUrl(this.cfg.baseUrl, path, args?.path as Record<string, unknown>, args?.query as Record<string, unknown>), undefined, args?.intent, args?.signal);
  }
}

let unauthenticatedListener: ((e: ApiError) => void) | undefined;
/** The live session module registers here; the client stays free of React and router imports. */
export function setUnauthenticatedListener(fn: ((e: ApiError) => void) | undefined): void {
  unauthenticatedListener = fn;
}

export const http = new HttpClient({
  baseUrl: API_BASE_URL,
  fetch: (...a) => globalThis.fetch(...a),
  readCookie: readBrowserCookie,
  onUnauthenticated: (e) => unauthenticatedListener?.(e),
});
