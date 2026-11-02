import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportReport } from '../src/api/live/reports';
import { ApiError } from '../src/api/errors';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const file = (name: string) => new Response('data', { status: 200, headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="${name}"` } });

afterEach(() => vi.restoreAllMocks());

describe('exportReport', () => {
  it('returns the file of a small export and asks for the format in the query', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(file('trial-balance-x-20261102.csv'));
    const out = await exportReport('co1', 'trial-balance', 'csv', { as_of: '2026-11-02', 'dimensions[d1]': 'v1' });
    expect(out.filename).toBe('trial-balance-x-20261102.csv');
    const url = String(f.mock.calls[0][0]);
    expect(url).toContain('/api/v1/companies/co1/reports/trial-balance/export?');
    expect(url).toContain('format=csv');
    expect(decodeURIComponent(url)).toContain('dimensions[d1]=v1');
  });

  it('polls a queued export until the file is ready', async () => {
    const queued = vi.fn();
    const f = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json(202, { data: { id: 'e1', status: 'queued', report: 'trial-balance', format: 'pdf' } }))
      .mockResolvedValueOnce(json(200, { data: { id: 'e1', status: 'queued' } }))
      .mockResolvedValueOnce(file('trial-balance.pdf'));
    const out = await exportReport('co1', 'trial-balance', 'pdf', {}, { onQueued: queued, pollMs: 1 });
    expect(queued).toHaveBeenCalledOnce();
    expect(out.filename).toBe('trial-balance.pdf');
    expect(String(f.mock.calls[1][0])).toContain('/reports/exports/e1');
  });

  it('turns a failed job into an error instead of an empty file', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json(202, { data: { id: 'e1', status: 'queued', report: 'x', format: 'pdf' } }))
      .mockResolvedValueOnce(json(200, { data: { id: 'e1', status: 'failed' } }));
    await expect(exportReport('co1', 'trial-balance', 'pdf', {}, { pollMs: 1 })).rejects.toMatchObject({ code: 'export_failed' });
  });

  it('keeps the code of a refusal (rate limit, no permission)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(429, { code: 'rate_limited', detail: 'x' }, { 'Retry-After': '3000' }));
    const err = await exportReport('co1', 'trial-balance', 'csv', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 429, code: 'rate_limited', retryAfterSeconds: 3000 });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(403, { code: 'forbidden' }));
    await expect(exportReport('co1', 'trial-balance', 'csv', {})).rejects.toMatchObject({ status: 403 });
  });
});
