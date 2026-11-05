import { describe, expect, it } from 'vitest';
import { EXPIRY_CHOICES, linkStatusLook, publicStatusLook, showsBalance, tokenFromPath, viewsLine, type PublicInvoice } from '../src/api/adapters/invoiceLinks';

describe('invoice link labels', () => {
  it('names the three states of a link', () => {
    expect(linkStatusLook('active')).toEqual({ label: 'Active', tone: 'ok' });
    expect(linkStatusLook('expired').label).toBe('Expired');
    expect(linkStatusLook('revoked').label).toBe('Turned off');
  });

  it('says how often a link was opened', () => {
    const fmt = (iso: string) => `on ${iso}`;
    expect(viewsLine({ view_count: 0, last_viewed_at: null }, fmt)).toBe('Not opened yet');
    expect(viewsLine({ view_count: 1, last_viewed_at: 'X' }, fmt)).toBe('Opened 1 time, last on on X');
    expect(viewsLine({ view_count: 3, last_viewed_at: null }, fmt)).toBe('Opened 3 times');
  });

  it('offers a lifetime or none', () => {
    expect(EXPIRY_CHOICES[0]).toEqual({ value: null, label: 'Until I turn it off' });
    expect(EXPIRY_CHOICES.every((c) => c.value === null || (c.value >= 1 && c.value <= 365))).toBe(true);
  });
});

describe('the customer page', () => {
  const inv = (status: string, due: PublicInvoice['balance_due']): Pick<PublicInvoice, 'status' | 'balance_due'> => ({ status, balance_due: due });

  it('shows the balance except on a reversed invoice, which shows its status instead', () => {
    expect(showsBalance(inv('open', { amount: 5500, currency: 'USD' }))).toBe(true);
    expect(showsBalance(inv('paid', { amount: 0, currency: 'USD' }))).toBe(true);
    expect(showsBalance(inv('reversed', null))).toBe(false);
    expect(showsBalance(inv('reversed', { amount: 100, currency: 'USD' }))).toBe(false);
    expect(publicStatusLook('reversed').label).toBe('Cancelled');
    expect(publicStatusLook('open').label).toBe('Awaiting payment');
    expect(publicStatusLook('overdue').tone).toBe('bad');
  });

  it('reads the token only from the exact public address shape', () => {
    const t = 'A'.repeat(43);
    expect(tokenFromPath(`/i/${t}`)).toBe(t);
    expect(tokenFromPath(`/i/${t}/`)).toBe(t);
    expect(tokenFromPath(`/i/${t}x`)).toBeNull();
    expect(tokenFromPath('/acme/invoices/1')).toBeNull();
  });
});
