import { describe, it, expect } from 'vitest';
import { csvCell, minorToDecimal, toCsv } from '@/lib/csv';
import { runBulkRows, summarise } from '@/data/bulk';
import { ApiError } from '@/api/errors';
import { SigningCancelled } from '@/data/signing';

describe('csv', () => {
  it('writes integer minor units as decimal strings without arithmetic on fractions', () => {
    expect(minorToDecimal(123456, 'USD')).toBe('1234.56');
    expect(minorToDecimal(5, 'USD')).toBe('0.05');
    expect(minorToDecimal(-5, 'USD')).toBe('-0.05');
    expect(minorToDecimal(0, 'USD')).toBe('0.00');
    expect(minorToDecimal(9007199254740991, 'USD')).toBe('90071992547409.91');
    expect(minorToDecimal(1500, 'JPY')).toBe('1500');
  });
  it('quotes commas, quotes and newlines, and defuses formulas in text', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe(`'+1`);
    expect(csvCell('-0.05')).toBe('-0.05');
    expect(csvCell(null)).toBe('');
    expect(csvCell(30)).toBe('30');
  });
  it('joins rows with CRLF', () => {
    expect(toCsv([['a', 'b'], ['1', '2']])).toBe('a,b\r\n1,2\r\n');
  });
});

const refuse = (code: string, detail: string) => new ApiError({ status: 422, code, detail, requestId: null });

describe('runBulkRows', () => {
  const rows = [1, 2, 3, 4].map((n) => ({ id: `d${n}`, label: `Doc ${n}`, draft: n !== 4 }));
  const run = <T,>(fn: () => Promise<T>) => fn();

  it('reports every row on its own: done, refused with the server reason, or not offered', async () => {
    const called: string[] = [];
    const r = await runBulkRows(run, 'submitted', rows, (d) => d.draft, 'Not a draft.', async (d) => {
      called.push(d.id);
      if (d.id === 'd2') throw refuse('period_closed', 'The period is closed.');
      return 'Posted';
    });
    expect(called).toEqual(['d1', 'd2', 'd3']);
    expect(r.outcomes.map((o) => o.state)).toEqual(['done', 'refused', 'done', 'skipped']);
    expect(r.outcomes[1].text).toContain('closed');
    expect(r.outcomes[3].text).toBe('Not a draft.');
    expect(summarise(r)).toBe('2 of 4 submitted');
  });

  it('gives each document its own idempotency intent', async () => {
    const keys: string[] = [];
    await runBulkRows(run, 'submitted', rows, () => true, '', async (_d, intent) => {
      keys.push(intent.key);
      return 'ok';
    });
    expect(new Set(keys).size).toBe(4);
  });

  it('stops asking after signing is cancelled and says so for the rest', async () => {
    let calls = 0;
    const cancelling = async <T,>(): Promise<T> => {
      calls++;
      throw new SigningCancelled();
    };
    const r = await runBulkRows(cancelling, 'submitted', rows, (d) => d.draft, 'Not a draft.', async () => 'x');
    expect(calls).toBe(1);
    expect(r.outcomes.map((o) => o.state)).toEqual(['skipped', 'skipped', 'skipped', 'skipped']);
    expect(r.outcomes[1].text).toMatch(/cancelled/);
  });

  it('says a version conflict plainly', async () => {
    const r = await runBulkRows(run, 'submitted', [rows[0]], () => true, '', async () => {
      throw new ApiError({ status: 409, code: 'version_conflict', detail: 'x', requestId: null, serverVersion: 5 });
    });
    expect(r.outcomes[0].text).toMatch(/changed/);
  });
});
