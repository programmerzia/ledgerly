import { afterEach, describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatMoney, setFormatPrefs } from '../src/lib/format';

afterEach(() => setFormatPrefs(null));

describe('company date and number formats (plan 3c.26b)', () => {
  it('keeps the demo look when no company format is set', () => {
    expect(formatDate('2026-03-05')).toBe('Mar 05, 2026');
    expect(formatMoney(123456789, 'USD')).toBe('$1,234,567.89');
  });

  it.each([
    ['dmy', '05/03/2026'],
    ['mdy', '03/05/2026'],
    ['ymd', '2026-03-05'],
    ['d_mon_y', '05 Mar 2026'],
  ])('writes a date as %s', (date, expected) => {
    setFormatPrefs({ date, number: 'comma_dot' });
    expect(formatDate('2026-03-05')).toBe(expected);
    expect(formatDate('2026-03-05T10:00:00Z')).toBe(expected);
    expect(formatDate(null)).toBe('—');
  });

  it.each([
    ['comma_dot', '$1,234,567.89'],
    ['dot_comma', '$1.234.567,89'],
    ['space_comma', '$1 234 567,89'],
    ['apostrophe_dot', '$1’234’567.89'],
  ])('groups and separates money as %s from integer minor units', (number, expected) => {
    setFormatPrefs({ date: 'ymd', number });
    expect(formatMoney(123456789, 'USD')).toBe(expected);
  });

  it('keeps signs, parentheses and zero-decimal currencies right', () => {
    setFormatPrefs({ date: 'ymd', number: 'dot_comma' });
    expect(formatMoney(-5, 'USD')).toBe('-$0,05');
    expect(formatMoney(-125000, 'USD', { parenthesesNegative: true })).toBe('($1.250,00)');
    expect(formatMoney(1500000, 'JPY', { showCurrency: false })).toBe('1.500.000');
    expect(formatMoney(null, 'USD')).toBe('—');
  });

  it('ignores an unknown format key rather than printing nonsense', () => {
    setFormatPrefs({ date: 'weird', number: 'comma_dot' });
    expect(formatDate('2026-03-05')).toBe('Mar 05, 2026');
  });

  it('puts the date part of a date-time in the company format', () => {
    setFormatPrefs({ date: 'dmy', number: 'comma_dot' });
    expect(formatDateTime('2026-03-05T10:30:00')).toBe('05/03/2026 10:30');
  });
});
