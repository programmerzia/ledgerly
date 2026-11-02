import { describe, expect, it } from 'vitest';
import { monthRanges } from '@/data/dashboardExtras';
import { monthPnlFromReport } from '@/api/live/dashboardExtras';

describe('dashboard monthly ranges', () => {
  it('lists the last six calendar months, the current one only up to today', () => {
    const r = monthRanges('2026-11-02', '2026-01-01');
    expect(r.map((m) => m.label)).toEqual(['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov']);
    expect(r[4]).toMatchObject({ from: '2026-10-01', to: '2026-10-31' });
    expect(r[5]).toMatchObject({ from: '2026-11-01', to: '2026-11-02' });
  });

  it('does not reach back before the fiscal year starts', () => {
    const r = monthRanges('2026-11-02', '2026-09-01');
    expect(r.map((m) => m.from)).toEqual(['2026-09-01', '2026-10-01', '2026-11-01']);
  });
});

describe('monthPnlFromReport', () => {
  const total = (amount: number) => ({ amount: { amount, currency: 'USD' } });
  it('takes the server section totals and net profit as given', () => {
    const pnl = monthPnlFromReport({
      currency: 'USD',
      sections: [{ key: 'operating_revenue', total: total(300000) }, { key: 'operating_expense', total: total(120000) }],
      subtotals: { net_profit: total(180000) },
    });
    expect(pnl).toEqual({ currency: 'USD', revenue: 300000, otherIncome: 0, costOfSales: 0, operatingExpenses: 120000, otherExpenses: 0, netProfit: 180000 });
  });

  it('returns null when the report has no net profit', () => {
    expect(monthPnlFromReport({ currency: 'USD', sections: [], subtotals: {} })).toBeNull();
  });
});
