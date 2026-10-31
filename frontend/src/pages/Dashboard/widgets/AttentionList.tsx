import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { Card, CardHeader } from './Card';

export interface AttentionRow {
  id: string;
  text: string;
  detail?: string;
  /** Overdue money and the like; shown in the danger colour. */
  urgent?: boolean;
  cta: string;
  to: string;
}

/** Today's to-do list, written the way a bookkeeper would note it. */
export const AttentionList: React.FC<{ rows: AttentionRow[]; className?: string }> = ({ rows, className }) => {
  const navigate = useNavigate();
  return (
    <Card className={className}>
      <CardHeader title="To do" sub={rows.length > 0 ? `${rows.length} open` : undefined} />
      {rows.length === 0 ? (
        <p className="px-5 pb-6 text-[13px] text-text-muted">Nothing waiting on you.</p>
      ) : (
        <ul className="border-t border-border divide-y divide-border">
          {rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => navigate(row.to)}
                className="group w-full px-5 py-2.5 flex items-center gap-3 text-left hover:bg-canvas transition-colors cursor-pointer"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] text-text-primary">{row.text}</div>
                  {row.detail && <div className={`tabular-nums text-xs mt-0.5 ${row.urgent ? 'text-danger' : 'text-text-muted'}`}>{row.detail}</div>}
                </div>
                <span className="text-xs text-text-muted group-hover:text-accent flex items-center gap-0.5 shrink-0">
                  {row.cta}<ChevronRight className="size-3.5" />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
};
