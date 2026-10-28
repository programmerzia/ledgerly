import React from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { formatMoney, formatDate } from '@/lib/format';
import { X, ExternalLink, ArrowRight, BookOpen } from 'lucide-react';

export interface GLLineRecord {
  id: string;
  date: string;
  journal_number: string;
  source_type: string;
  source_id: string;
  source_number: string;
  description: string;
  debit: number;
  credit: number;
  dimensions?: { branch?: string; cost_centre?: string };
}

interface DrillDownDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  accountCode: string;
  accountName: string;
  periodName?: string;
  lines: GLLineRecord[];
  companySlug: string;
}

export const DrillDownDrawer: React.FC<DrillDownDrawerProps> = ({
  isOpen,
  onClose,
  accountCode,
  accountName,
  periodName = 'Oct 2026',
  lines,
  companySlug,
}) => {
  const navigate = useNavigate();

  if (!isOpen) return null;

  const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
  const netAmount = totalCredit - totalDebit;

  const handleOpenDoc = (line: GLLineRecord) => {
    onClose();
    if (line.source_type === 'sales_invoice') {
      navigate(`/${companySlug}/invoices/${line.source_id}`);
    } else {
      navigate(`/${companySlug}/journals/${line.source_id}`);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-ink-900/30 backdrop-blur-[1px] flex justify-end">
      <div
        className="w-full max-w-[560px] bg-surface border-l border-ink-200 h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drawer Header */}
        <div className="p-5 border-b border-ink-200 bg-ink-50/70 flex items-start justify-between">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-bold text-brand-600 bg-brand-50 px-1.5 py-0.5 rounded border border-brand-100">
                {accountCode}
              </span>
              <span className="text-xs text-ink-500 uppercase tracking-wider font-semibold">
                General Ledger Detail
              </span>
            </div>
            <h2 className="text-h2 font-semibold text-ink-900">{accountName}</h2>
            <span className="text-xs text-ink-500">Period: {periodName} • {lines.length} postings</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-sm text-ink-500 hover:text-ink-900 hover:bg-ink-200/50 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Drawer Body: Dense GL Lines List */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
          <div className="text-xs text-ink-500 flex items-center justify-between pb-1">
            <span>Posted Transactions</span>
            <span className="text-[11px] text-ink-500">Click any row to view source document</span>
          </div>

          <div className="border border-ink-200 rounded-md bg-surface overflow-hidden divide-y divide-ink-100">
            {lines.length === 0 ? (
              <div className="p-8 text-center text-xs text-ink-500">
                No ledger activity for this account in {periodName}.
              </div>
            ) : (
              lines.map((l) => (
                <div
                  key={l.id}
                  onClick={() => handleOpenDoc(l)}
                  className="p-3 hover:bg-brand-50/60 cursor-pointer transition-colors group flex flex-col gap-1.5"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-ink-900 group-hover:text-brand-700">
                        {l.source_number || l.journal_number}
                      </span>
                      {l.dimensions?.branch && (
                        <span className="text-[10px] font-mono px-1.5 py-0.2 bg-ink-100 rounded text-ink-700">
                          {l.dimensions.branch}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 text-xs font-mono font-medium">
                      {l.credit > 0 ? (
                        <span className="text-ink-900 font-semibold">{formatMoney(l.credit)} Cr</span>
                      ) : (
                        <span className="text-ink-900 font-semibold">{formatMoney(l.debit)} Dr</span>
                      )}
                      <ExternalLink className="w-3.5 h-3.5 text-ink-500 group-hover:text-brand-600 ml-1" />
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs text-ink-500">
                    <span className="truncate max-w-[320px]">{l.description}</span>
                    <span className="font-mono text-[11px]">{formatDate(l.date)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Drawer Footer Totals */}
        <div className="p-4 border-t border-ink-200 bg-ink-50/80 flex items-center justify-between text-xs font-mono">
          <div className="flex items-center gap-4 text-ink-500">
            <span>Debits: {formatMoney(totalDebit)}</span>
            <span>Credits: {formatMoney(totalCredit)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-ink-900">Net Period Balance:</span>
            <span className="font-bold text-sm text-brand-700">{formatMoney(Math.abs(netAmount))}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
