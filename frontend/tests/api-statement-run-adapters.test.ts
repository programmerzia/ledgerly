import { describe, expect, it } from 'vitest';
import { defaultSelection, describeResult, fitsAllowance, periodProblem, summarise } from '../src/api/adapters/statementRun';
import type { RunCustomer, RunResult } from '../src/api/live/statementRun';

const row = (id: string, amount: number, email: string | null): RunCustomer =>
  ({ contact_id: id, code: id, name: id, email, has_email: email !== null, balance: { amount, currency: 'USD' }, last_sent_at: null }) as RunCustomer;

describe('statement run selection', () => {
  it('starts with customers who owe money and have an email', () => {
    expect(defaultSelection([row('a', 100, 'a@x.example'), row('b', 100, null), row('c', -50, 'c@x.example'), row('d', 5, 'd@x.example')])).toEqual(['a', 'd']);
  });

  it('says why a choice does not fit the hour, with the numbers', () => {
    expect(fitsAllowance(2, { used: 58, limit: 60, remaining: 2 })).toEqual({ ok: true });
    const over = fitsAllowance(5, { used: 58, limit: 60, remaining: 2 });
    expect(over.ok).toBe(false);
    if (!over.ok) {
      expect(over.message).toContain('You chose 5 customers, but only 2 more emails');
      expect(over.message).toContain('limit is 60 an hour');
      expect(over.message).toContain('Choose 2 or fewer');
    }
    const one = fitsAllowance(2, { used: 59, limit: 60, remaining: 1 });
    expect(!one.ok && one.message).toContain('only 1 more email can');
  });

  it('checks the period before asking', () => {
    expect(periodProblem({ basis: 'as_of' })).toBeTruthy();
    expect(periodProblem({ basis: 'as_of', as_of: '2026-03-31' })).toBeNull();
    expect(periodProblem({ basis: 'period', from: '2026-04-01', to: '2026-03-01' })).toMatch(/not be before/);
    expect(periodProblem({ basis: 'period', from: '2026-03-01', to: '2026-03-31' })).toBeNull();
  });
});

describe('statement run results', () => {
  const r = (status: string, code: string | null = null, send_id: string | null = null, reason: string | null = null): RunResult =>
    ({ contact_id: 'x', name: 'X', status, code, reason, send_id }) as RunResult;

  it('follows a queued statement to sent or failed', () => {
    expect(describeResult(r('queued', null, 's1'), {}).label).toBe('On its way');
    expect(describeResult(r('queued', null, 's1'), { s1: { id: 's1', contact_id: 'x', status: 'sent', error: null } }).tone).toBe('ok');
    const failed = describeResult(r('queued', null, 's1'), { s1: { id: 's1', contact_id: 'x', status: 'failed', error: 'Mailbox full' } });
    expect(failed).toEqual({ label: 'Not delivered', tone: 'bad', detail: 'Mailbox full' });
  });

  it('names skipped and failed rows', () => {
    expect(describeResult(r('skipped', 'no_email', null, 'Add one.'), {}).label).toBe('No email address');
    expect(describeResult(r('failed', 'already_sent', null, 'Just sent.'), {})).toMatchObject({ label: 'Not sent', detail: 'Just sent.' });
    expect(summarise([r('queued'), r('skipped'), r('skipped'), r('failed')])).toBe('1 queued, 2 skipped, 1 failed');
  });
});
