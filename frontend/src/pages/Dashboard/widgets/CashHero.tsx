import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, ArrowDownRight, Wallet } from 'lucide-react';
import { formatMoney } from '@/lib/format';
import { Spark } from './Spark';
import type { DashboardData } from '../useDashboardData';

export const CashHero: React.FC<{ d: DashboardData; to: string; index: number; className?: string }> = ({ d, to, index, className = '' }) => {
  const navigate = useNavigate();
  const delta = d.cashDelta;
  return (
    <section
      className={`dash-card relative overflow-hidden rounded-xl text-white p-5 flex flex-col gap-3 shadow-md ${className}`}
      style={{ animationDelay: `${index * 40}ms`, background: 'linear-gradient(135deg, color-mix(in srgb, var(--color-accent) 72%, black), color-mix(in srgb, var(--color-violet) 70%, black))' }}
    >
      <div className="absolute -top-16 -right-12 size-56 rounded-full bg-white/10 blur-2xl pointer-events-none" />
      <div className="relative flex items-center justify-between">
        <span className="flex items-center gap-2 text-[13px] font-medium text-white/85">
          <span className="size-8 rounded-lg bg-white/20 flex items-center justify-center"><Wallet className="size-4" /></span>
          Cash in bank
        </span>
        {delta !== null && (
          <span className="inline-flex items-center gap-1 text-xs font-medium rounded-full bg-white/20 px-2 py-0.5">
            {delta >= 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
            {formatMoney(Math.abs(delta), d.base)} vs last month
          </span>
        )}
      </div>
      <button type="button" onClick={() => navigate(to)} className="relative text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-white rounded">
        <div className="text-[34px] leading-tight font-semibold tracking-tight tabular-nums">{formatMoney(d.cashBase, d.base)}</div>
      </button>
      <div className="relative flex flex-wrap gap-1.5">
        {d.bankRows.map((r) => (
          <span key={r.acct.id} className="inline-flex items-center gap-1.5 text-xs rounded-full bg-white/15 px-2.5 py-1 max-w-full">
            <span className="truncate">{r.acct.name}</span>
            <span className="tabular-nums font-semibold">{formatMoney(r.balance, r.acct.currency)}</span>
          </span>
        ))}
      </div>
      <div className="relative mt-auto -mx-5 -mb-5 pt-2">
        <Spark data={d.months.map((m) => m.cash)} color="#ffffff" height={72} fillOpacity={0.35} />
      </div>
    </section>
  );
};
