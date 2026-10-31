import React from 'react';
import { useNavigate } from 'react-router-dom';
import { formatMoney } from '@/lib/format';
import { Card, CardHeader } from './Card';
import type { DashboardData } from '../useDashboardData';

export const BankAccountsCard: React.FC<{ d: DashboardData; co: string; index: number; className?: string }> = ({ d, co, index, className }) => {
  const navigate = useNavigate();
  return (
    <Card index={index} className={className}>
      <CardHeader title="Bank accounts" right={<button type="button" onClick={() => navigate(`${co}/banking`)} className="text-xs text-accent hover:underline cursor-pointer">Manage</button>} />
      <ul className="border-t border-border divide-y divide-border">
        {d.bankRows.map(({ acct, balance, unmatched }) => (
          <li key={acct.id} className="px-5 py-2.5 flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium text-text-primary truncate">{acct.name}</div>
              <div className="text-xs text-text-muted tabular-nums">{acct.account_number_masked}</div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-[13px] font-medium tabular-nums whitespace-nowrap text-text-primary">{formatMoney(balance, acct.currency)}</div>
              {unmatched > 0 ? (
                <button type="button" onClick={() => navigate(`${co}/banking/${acct.id}/reconcile`)} className="text-xs text-accent hover:underline cursor-pointer">
                  {unmatched} to reconcile
                </button>
              ) : (
                <span className="text-xs text-text-muted">Reconciled</span>
              )}
            </div>
          </li>
        ))}
        {d.bankRows.length === 0 && <li className="px-5 py-4 text-[13px] text-text-muted">No bank accounts yet.</li>}
      </ul>
    </Card>
  );
};
