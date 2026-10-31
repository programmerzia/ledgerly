import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useLedgerStore } from '@/mock/store';
import { BUSINESS_TODAY } from '@/lib/docStatus';
import { ChartTooltip } from '@/pages/Dashboard/widgets/ChartTooltip';
import { ReportShell, defaultReportParameters, useSelectedPeriod, type ReportParameters } from './ReportShell';
import { CheckBadge, ReportCard, SectionTitle, StatementLine, TotalLine, moneyFmt } from './ReportParts';

const CASH_CODES = ['1000', '1010', '1020'];

const compact = (v: number) => {
  const m = v / 100;
  if (Math.abs(m) >= 1_000_000) return `${(m / 1_000_000).toFixed(1)}M`;
  if (Math.abs(m) >= 1000) return `${Math.round(m / 1000)}k`;
  return `${Math.round(m)}`;
};

export const CashFlow: React.FC = () => {
  const navigate = useNavigate();
  const { currentCompany, accounts, balanceOf, periods, fiscalYear, journals } = useLedgerStore();
  const cur = currentCompany.base_currency;
  const money = moneyFmt(cur);
  const [parameters, setParameters] = useState<ReportParameters>(defaultReportParameters());
  const period = useSelectedPeriod(parameters.periodTo);

  const regular = useMemo(() => periods.filter((p) => p.kind !== 'adjustment' && p.starts_on <= BUSINESS_TODAY), [periods]);
  const dayBeforeFy = useMemo(() => {
    const d = new Date(`${fiscalYear.starts_on}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }, [fiscalYear.starts_on]);

  const idOf = (code: string) => accounts.find((a) => a.code === code)?.id;
  // Net movement of one account (in its normal-balance direction) between two dates.
  const mov = (code: string, end: string, start: string) => {
    const id = idOf(code);
    return id ? balanceOf(id, end) - balanceOf(id, start) : 0;
  };
  const cashAt = (date: string) => CASH_CODES.reduce((s, c) => s + (idOf(c) ? balanceOf(idOf(c)!, date) : 0), 0);
  const startOf = (p: { number: number }) => regular.find((x) => x.number === p.number - 1)?.ends_on ?? dayBeforeFy;

  const monthly = useMemo(
    () => regular.map((p) => ({ name: p.name.slice(0, 3), net: cashAt(p.ends_on) - cashAt(startOf(p)) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [regular, journals, accounts, balanceOf]
  );

  if (!period) return <div className="p-8 text-center text-xs text-text-muted">No periods available.</div>;
  const end = period.ends_on;
  const start = startOf(period);
  const m = (code: string) => mov(code, end, start);

  const netIncome =
    accounts.filter((a) => a.account_type === 'income').reduce((s, a) => s + mov(a.code, end, start), 0) -
    accounts.filter((a) => a.account_type === 'expense').reduce((s, a) => s + mov(a.code, end, start), 0);
  const depreciation = m('6500');
  const unrealisedFx = m('4800') - m('6800');
  const arChange = -m('1200');
  const apChange = m('2000');
  const taxChange = m('2100') - m('2110') + m('2120');
  const operating = netIncome + depreciation - unrealisedFx + arChange + apChange + taxChange;
  const capex = -m('1500');
  const investing = capex;
  const shareCapital = m('3000');
  const financing = shareCapital;

  const openingCash = cashAt(start);
  const closingCash = cashAt(end);
  const actualChange = closingCash - openingCash;
  const classified = operating + investing + financing;
  const other = actualChange - classified;
  const reconciles = other === 0;

  const go = (code: string) => navigate(`/${currentCompany.slug}/reports/general-ledger?account=${code}`);
  const L = (label: string, value: number, code?: string, muted = true) => (
    <StatementLine label={label} value={value} money={money} onClick={code ? () => go(code) : undefined} indent muted={muted} />
  );

  return (
    <ReportShell
      title="Cash flow"
      parameters={parameters}
      onParametersChange={setParameters}
      showHideEmpty={false}
      toolbar={
        <CheckBadge
          ok={reconciles}
          okLabel="Matches bank and cash balances"
          badLabel={`${money(Math.abs(other))} not explained by activities`}
        />
      }
    >
      <div className="bg-surface border border-border rounded-lg p-4 sm:p-5">
        <div className="text-sm font-semibold text-text-primary">Net cash flow by month</div>
        <div className="text-xs text-text-muted mb-2">Change in cash and bank balances, in {cur}</div>
        <div className="h-44 text-xs">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--color-border)" />
              <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
              <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={compact} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
              <Tooltip cursor={{ fill: 'var(--surface-neutral)' }} content={<ChartTooltip currency={cur} />} />
              <ReferenceLine y={0} stroke="var(--border-strong)" />
              <Bar dataKey="net" name="Net cash flow" radius={[1, 1, 0, 0]} maxBarSize={36}>
                {monthly.map((d, i) => (
                  <Cell key={i} fill={d.name === period.name.slice(0, 3) ? (d.net < 0 ? 'var(--color-danger)' : 'var(--color-accent)') : 'var(--color-text-muted)'} fillOpacity={d.name === period.name.slice(0, 3) ? 1 : 0.4} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <ReportCard>
        <div className="min-w-[480px]">
          <div className="flex justify-between px-2 pb-2 border-b border-border text-[11px] font-semibold text-text-muted">
            <span>Activity</span>
            <span>{period.name}</span>
          </div>

          <SectionTitle>Operating activities</SectionTitle>
          <div className="divide-y divide-border/60">
            <StatementLine label="Net profit" value={netIncome} money={money} onClick={() => navigate(`/${currentCompany.slug}/reports/profit-and-loss`)} />
            {L('Depreciation (not paid in cash)', depreciation, '6500')}
            {L('Unrealised exchange gains and losses', -unrealisedFx, '4800')}
            {L('Change in money owed by customers', arChange, '1200')}
            {L('Change in money owed to suppliers', apChange, '2000')}
            {L('Change in VAT and withholding tax owed', taxChange, '2100')}
          </div>
          <TotalLine label="Cash from operating activities" value={operating} money={money} />

          <SectionTitle>Investing activities</SectionTitle>
          <div className="divide-y divide-border/60">{L('Purchase of fixed assets', capex, '1500')}</div>
          <TotalLine label="Cash from investing activities" value={investing} money={money} />

          <SectionTitle>Financing activities</SectionTitle>
          <div className="divide-y divide-border/60">{L('Share capital contributed', shareCapital, '3000')}</div>
          <TotalLine label="Cash from financing activities" value={financing} money={money} />

          {!reconciles && (
            <div className="mt-3">
              <StatementLine label="Other cash movements not classified above" value={other} money={money} muted />
            </div>
          )}

          <div className="mt-4 divide-y divide-border/60">
            <StatementLine label="Net change in cash" value={actualChange} money={money} />
            <StatementLine label={`Cash at start of ${period.name}`} value={openingCash} money={money} />
          </div>
          <TotalLine big label={`Cash at end of ${period.name}`} value={closingCash} money={money} />
        </div>
      </ReportCard>
    </ReportShell>
  );
};
