import React from 'react';
import { useNavigate } from 'react-router-dom';
import { formatMoney } from '@/lib/format';
import { Card, CardHeader, Avatar } from './Card';
import type { DashboardData } from '../useDashboardData';

export const TopCustomers: React.FC<{ d: DashboardData; to: string; index: number; className?: string }> = ({ d, to, index, className }) => {
  const navigate = useNavigate();
  return (
    <Card index={index} className={className}>
      <CardHeader title="Top customers by balance owed" sub="Unpaid invoices" right={<button type="button" onClick={() => navigate(to)} className="text-xs text-accent hover:underline cursor-pointer">All customers</button>} />
      {d.topCustomers.length === 0 ? (
        <p className="text-xs text-text-muted py-10 text-center">No customer owes you anything.</p>
      ) : (
        <ul className="divide-y divide-border">
          {d.topCustomers.map((c) => (
            <li key={c.id} className="px-5 py-2.5 flex items-center gap-3">
              <Avatar name={c.name} size={32} />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-text-primary truncate">{c.name}</div>
                <div className="text-xs text-text-muted">{c.count} open {c.count === 1 ? 'invoice' : 'invoices'}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[13px] font-semibold tabular-nums whitespace-nowrap text-text-primary">{formatMoney(c.owed, d.base)}</div>
                {c.overdue > 0 && <span className="inline-block mt-0.5 text-[11px] font-medium rounded-full bg-danger-soft text-danger px-1.5 py-px">Overdue</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
};
