import React from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import { Card, CardHeader } from './Card';

export interface AttentionRow {
  id: string;
  icon: React.ReactNode;
  tone: string;
  text: string;
  detail?: string;
  cta: string;
  to: string;
}

export const AttentionList: React.FC<{ rows: AttentionRow[]; index: number; className?: string }> = ({ rows, index, className }) => {
  const navigate = useNavigate();
  return (
    <Card index={index} className={className}>
      <CardHeader
        title="Needs your attention"
        right={rows.length > 0 ? <span className="text-xs font-semibold rounded-full bg-warning-soft text-warning px-2 py-0.5">{rows.length}</span> : undefined}
      />
      {rows.length === 0 ? (
        <div className="px-5 py-10 flex flex-col items-center gap-2 text-center">
          <span className="size-12 rounded-full bg-success-soft text-success flex items-center justify-center"><CheckCircle2 className="size-6" /></span>
          <p className="text-sm font-medium text-text-primary">You're all caught up</p>
          <p className="text-xs text-text-muted">Nothing needs your attention right now.</p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <li key={row.id} className="px-5 py-3 flex items-center gap-3">
              <span className={`size-8 rounded-lg flex items-center justify-center shrink-0 ${row.tone}`}>{row.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] text-text-primary leading-snug">{row.text}</div>
                {row.detail && <div className="tabular-nums text-xs text-text-muted mt-0.5">{row.detail}</div>}
              </div>
              <button
                type="button"
                onClick={() => navigate(row.to)}
                className="h-7 px-3 rounded-lg border border-border hover:border-accent hover:text-accent hover:bg-accent-soft text-xs font-semibold text-text-primary transition-colors cursor-pointer shrink-0"
              >
                {row.cta}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
};
