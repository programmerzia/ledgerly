import { describe, it, expect, vi } from 'vitest';
import { HttpClient, buildUrl } from '@/api/http';
import { ApiError, NetworkError, problemToError, parseRetryAfter } from '@/api/errors';
import { createIntent } from '@/api/idempotency';
import { shouldRetryQuery } from '@/api/queryClient';
import { fetchAllPages } from '@/api/cursor';

type Call = { url: string; init: RequestInit };

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json', ...headers },
  });

function setup(responses: Array<Response | Error>, cookie: string | undefined = 'tok%2B1') {
  const calls: Call[] = [];
  const queue = [...responses];
  const fetchMock = vi.fn(async (url: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/sanctum/csrf-cookie')) return new Response(null, { status: 204 });
    const next = queue.shift();
    if (!next) throw new Error('no response queued');
    if (next instanceof Error) throw next;
    return next;
  });
  const onUnauthenticated = vi.fn();
  const client = new HttpClient({
    baseUrl: '',
    fetch: fetchMock as unknown as typeof fetch,
    readCookie: (n) => (n === 'XSRF-TOKEN' ? decodeURIComponent(cookie ?? '') || undefined : undefined),
    onUnauthenticated,
  });
  const apiCalls = () => calls.filter((c) => !c.url.endsWith('/sanctum/csrf-cookie'));
  const csrfCalls = () => calls.filter((c) => c.url.endsWith('/sanctum/csrf-cookie'));
  return { client, calls, apiCalls, csrfCalls, onUnauthenticated };
}
const hdr = (c: Call, name: string) => (c.init.headers as Record<string, string>)[name];

describe('buildUrl', () => {
  it('prefixes /api, fills path params and skips empty query values', () => {
    expect(buildUrl('', '/v1/companies/{company}/accounts', { company: 'a b' }, { cursor: 'x', type: undefined, limit: 5 })).toBe(
      '/api/v1/companies/a%20b/accounts?cursor=x&limit=5',
    );
    expect(() => buildUrl('', '/v1/companies/{company}/accounts', {})).toThrow(/company/);
  });
});

describe('problem+json mapping', () => {
  it('maps every documented field', () => {
    const e = problemToError(
      409,
      { code: 'version_conflict', detail: 'stale', server_version: { version: 4 }, request_id: 'r1', errors: { a: ['x'] }, violations: [{ code: 'v', message: 'm' }] },
      new Headers(),
    );
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 409, code: 'version_conflict', detail: 'stale', requestId: 'r1', serverVersion: { version: 4 } });
    expect(e.isVersionConflict).toBe(true);
    expect(e.errors).toEqual({ a: ['x'] });
    expect(e.violations?.[0].code).toBe('v');
  });

  it('exposes the helpers the dialogs switch on', () => {
    expect(problemToError(403, { code: 'signature_required' }).isSignatureRequired).toBe(true);
    expect(problemToError(423, { code: 'tenant_read_only' }).isTenantReadOnly).toBe(true);
    expect(problemToError(422, { code: 'validation_failed', errors: { email: ['bad'] } }).isValidation).toBe(true);
  });

  it('never depends on message text; falls back on status when the body is not a problem', () => {
    expect(problemToError(419, null).code).toBe('csrf_mismatch');
    expect(problemToError(502, '<html>').code).toBe('server_error');
    expect(problemToError(401, { message: 'Unauthenticated.' }).code).toBe('unauthenticated');
  });

  it('reads Retry-After seconds and request id from headers', () => {
    const e = problemToError(429, { code: 'rate_limited' }, new Headers({ 'Retry-After': '7', 'X-Request-Id': 'abc' }));
    expect(e.retryAfterSeconds).toBe(7);
    expect(e.requestId).toBe('abc');
    expect(e.isRateLimited).toBe(true);
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter('nonsense')).toBeUndefined();
  });
});

describe('HttpClient', () => {
  it('sends cookies, JSON headers, CSRF token and an Idempotency-Key on a POST', async () => {
    const t = setup([json(200, { data: { id: 1 } })]);
    await t.client.post('/v1/companies', { body: { name: 'A', country: 'US', base_currency: 'USD', fiscal_year_start_month: 1 } });
    const c = t.apiCalls()[0];
    expect(c.url).toBe('/api/v1/companies');
    expect(c.init.credentials).toBe('include');
    expect(hdr(c, 'Accept')).toBe('application/json');
    expect(hdr(c, 'Content-Type')).toBe('application/json');
    expect(hdr(c, 'X-XSRF-TOKEN')).toBe('tok+1');
    expect(hdr(c, 'Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('fetches the CSRF cookie once and sends no key or token on GET', async () => {
    const t = setup([json(200, { data: [] }), json(200, { data: {} }), json(200, {})]);
    await t.client.get('/v1/me');
    await t.client.post('/v1/auth/logout');
    await t.client.post('/v1/auth/logout');
    expect(t.csrfCalls()).toHaveLength(1);
    const get = t.apiCalls()[0];
    expect(hdr(get, 'Idempotency-Key')).toBeUndefined();
    expect(hdr(get, 'X-XSRF-TOKEN')).toBeUndefined();
  });

  it('on 419 refreshes the CSRF cookie and retries once with the same Idempotency-Key', async () => {
    const t = setup([json(419, null), json(200, { ok: true })]);
    await t.client.post('/v1/auth/logout');
    expect(t.csrfCalls()).toHaveLength(2);
    const [first, second] = t.apiCalls();
    expect(hdr(first, 'Idempotency-Key')).toBe(hdr(second, 'Idempotency-Key'));
  });

  it('gives up after one 419 retry', async () => {
    const t = setup([json(419, null), json(419, null)]);
    await expect(t.client.post('/v1/auth/logout')).rejects.toMatchObject({ status: 419, code: 'csrf_mismatch' });
    expect(t.apiCalls()).toHaveLength(2);
  });

  it('reuses the key across retries of one intent and rotates it after success', async () => {
    const t = setup([json(500, { code: 'server_error' }), json(200, {}), json(200, {})]);
    const intent = createIntent();
    await expect(t.client.post('/v1/auth/logout', { intent })).rejects.toMatchObject({ status: 500 });
    await t.client.post('/v1/auth/logout', { intent });
    await t.client.post('/v1/auth/logout', { intent });
    const keys = t.apiCalls().map((c) => hdr(c, 'Idempotency-Key'));
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[1]);
  });

  it('keeps the key after a network failure and after signature_required, rotates it after a 422', async () => {
    const t = setup([new TypeError('failed'), json(403, { code: 'signature_required' }), json(422, { code: 'validation_failed', errors: { a: ['x'] } }), json(200, {})]);
    const intent = createIntent();
    await expect(t.client.post('/v1/auth/logout', { intent })).rejects.toBeInstanceOf(NetworkError);
    await expect(t.client.post('/v1/auth/logout', { intent })).rejects.toMatchObject({ code: 'signature_required' });
    await expect(t.client.post('/v1/auth/logout', { intent })).rejects.toMatchObject({ status: 422 });
    await t.client.post('/v1/auth/logout', { intent });
    const keys = t.apiCalls().map((c) => hdr(c, 'Idempotency-Key'));
    expect(new Set(keys.slice(0, 3)).size).toBe(1);
    expect(keys[3]).not.toBe(keys[0]);
  });

  it('creates a fresh key per call when no intent is given', async () => {
    const t = setup([json(200, {}), json(200, {})]);
    await t.client.post('/v1/auth/logout');
    await t.client.post('/v1/auth/logout');
    const [a, b] = t.apiCalls().map((c) => hdr(c, 'Idempotency-Key'));
    expect(a).not.toBe(b);
  });

  it('raises ApiError for 401 and tells the session guard', async () => {
    const t = setup([json(401, { code: 'unauthenticated', detail: 'Sign in to continue.' })]);
    await expect(t.client.get('/v1/me')).rejects.toMatchObject({ status: 401, code: 'unauthenticated' });
    expect(t.onUnauthenticated).toHaveBeenCalledTimes(1);
  });

  it('surfaces 409 version_conflict with serverVersion', async () => {
    const t = setup([json(409, { code: 'version_conflict', server_version: { version: 9 }, request_id: 'rq' })]);
    const err = await t.client.put('/v1/session/tenant', { body: { tenant_id: 'x' } }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).serverVersion).toEqual({ version: 9 });
  });

  it('keeps network failures distinct from API errors', async () => {
    const t = setup([new TypeError('Failed to fetch')]);
    const err = await t.client.get('/v1/me').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NetworkError);
    expect(err).not.toBeInstanceOf(ApiError);
  });

  it('reports a failed CSRF fetch as a network error and retries it next time', async () => {
    const calls: string[] = [];
    let fail = true;
    const client = new HttpClient({
      baseUrl: '',
      readCookie: () => undefined,
      fetch: (async (url: RequestInfo | URL) => {
        calls.push(String(url));
        if (String(url).endsWith('csrf-cookie') && fail) {
          fail = false;
          throw new TypeError('down');
        }
        return String(url).endsWith('csrf-cookie') ? new Response(null, { status: 204 }) : json(200, {});
      }) as typeof fetch,
    });
    await expect(client.post('/v1/auth/logout')).rejects.toBeInstanceOf(NetworkError);
    await client.post('/v1/auth/logout');
    expect(calls.filter((c) => c.endsWith('csrf-cookie'))).toHaveLength(2);
  });
});

describe('query retry policy', () => {
  it('retries network and 5xx errors twice, never 4xx', () => {
    expect(shouldRetryQuery(0, new NetworkError())).toBe(true);
    expect(shouldRetryQuery(0, problemToError(503, null))).toBe(true);
    expect(shouldRetryQuery(2, new NetworkError())).toBe(false);
    for (const s of [401, 403, 404, 409, 422, 429]) expect(shouldRetryQuery(0, problemToError(s, null))).toBe(false);
    expect(shouldRetryQuery(0, new Error('bug'))).toBe(false);
  });
});

describe('cursor lists', () => {
  it('follows next_cursor until it is null', async () => {
    const pages = [
      { data: [1, 2], meta: { next_cursor: 'c1', prev_cursor: null, limit: 2 } },
      { data: [3], meta: { next_cursor: null, prev_cursor: 'p', limit: 2 } },
    ];
    const seen: Array<string | undefined> = [];
    const all = await fetchAllPages(async (cursor) => {
      seen.push(cursor);
      return pages[seen.length - 1];
    });
    expect(all).toEqual([1, 2, 3]);
    expect(seen).toEqual([undefined, 'c1']);
  });

  it('stops a runaway cursor', async () => {
    await expect(fetchAllPages(async () => ({ data: [1], meta: { next_cursor: 'again', prev_cursor: null, limit: 1 } }), 3)).rejects.toThrow(/3 pages/);
  });
});

describe('live route allowlist', () => {
  it('lets through only connected screens', async () => {
    const { isLiveRoute } = await import('../src/data/liveRoutes');
    expect(isLiveRoute('/acme/accounts')).toBe(true);
    expect(isLiveRoute('/acme/accounts/')).toBe(true);
    expect(isLiveRoute('/acme/dashboard')).toBe(true);
    expect(isLiveRoute('/acme/onboarding')).toBe(true);
    expect(isLiveRoute('/acme/settings/security')).toBe(true);
    for (const t of ['general', 'posting', 'workflows', 'team', 'api-clients', 'webhooks']) expect(isLiveRoute(`/acme/settings/${t}`)).toBe(true);
    expect(isLiveRoute('/acme/audit-log')).toBe(true);
    expect(isLiveRoute('/acme/settings/import')).toBe(true);
    // sales (3.5)
    for (const r of ['invoices', 'invoices/new', 'customers', 'credit-notes', 'credit-notes/new', 'receipts/new', 'customers/01a19a52-30f1-70e3-aaea-ff42efaac3b9', 'invoices/01a19a52-30f1-70e3-aaea-ff42efaac3b9', 'receipts/01a19a52-30f1-70e3-aaea-ff42efaac3b9']) expect(isLiveRoute(`/acme/${r}`)).toBe(true);
    expect(isLiveRoute('/acme/receipts')).toBe(false);
    // purchases, tax, items and recurring documents (3.6)
    const id = '01a19a52-30f1-70e3-aaea-ff42efaac3b9';
    for (const r of ['bills', 'bills/new', 'bills/recurring', 'suppliers', 'debit-notes', 'debit-notes/new', 'payments/new', 'payment-run', 'payment-run/new', 'wht-certificates', 'tax', 'items', 'sales/items', 'invoices/recurring', `bills/${id}`, `suppliers/${id}`, `payments/${id}`, `payment-run/${id}`]) expect(isLiveRoute(`/acme/${r}`)).toBe(true);
    for (const r of ['payments', 'bills/x', 'tax/codes']) expect(isLiveRoute(`/acme/${r}`)).toBe(false);
    expect(isLiveRoute('/accounts/receipts')).toBe(false);
  });
});
