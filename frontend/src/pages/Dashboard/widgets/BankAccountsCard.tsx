import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Landmark } from 'lucide-react';
import { formatMoney } from '@/lib/format';
import { Card, CardHeader } from './Card';
import type { DashboardData } from '../useDashboardData';

export const BankAccountsCard: React.FC<{ d: DashboardData; co: string; index: number; className?: string }> = ({ d, co, index, className }) => {
  const navigate = useNavigate();
  return (
    <Card index={index} className={className}>
      <CardHeader title="Bank accounts" right={<button type="button" onClick={() => navigate(`${co}/banking`)} className="text-xs text-accent hover:underline cursor-pointer">Manage</button>} />
      <ul className="divide-y divide-border">
        {d.bankRows.map(({ acct, balance, unmatched }) => (
          <li key={acct.id} className="px-5 py-3 flex items-center gap-3">
            <span className="size-8 rounded-lg bg-info-soft text-info flex items-center justify-center shrink-0"><Landmark className="size-4" /></span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium text-text-primary truncate">{acct.name}</div>
              <div className="text-xs text-text-muted font-mono">{acct.account_number_masked}</div>
            </div>
            <div className="text-right shrink-0 flex flex-col items-end gap-1">
              <div className="text-[13px] font-semibold tabular-nums whitespace-nowrap text-text-primary">{formatMoney(balance, acct.currency)}</div>
              {unmatched > 0 ? (
                <button type="button" onClick={() => navigate(`${co}/banking/${acct.id}/reconcile`)} className="inline-flex items-center gap-1.5 text-[11px] font-semibold rounded-full bg-info-soft text-info px-2 py-0.5 hover:brightness-95 cursor-pointer">
                  {unmatched} to reconcile
                </button>
              ) : (
                <span className="text-[11px] font-medium rounded-full bg-success-soft text-success px-2 py-0.5">Reconciled</span>
              )}
            </div>
          </li>
        ))}
        {d.bankRows.length === 0 && <li className="px-5 py-6 text-xs text-text-muted">No bank accounts yet.</li>}
      </ul>
    </Card>
  );
};
