import React from 'react';
import { useReport, useStatementContacts } from '@/data/reports';
import { useRouteCompany } from '@/data/session';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ReportCard, SelectBox, longDate, tone } from '../ReportParts';
import { LiveReportShell } from './LiveReportShell';
import { ReportError, ReportLoading, dash, fmt } from './parts';
import { useReportSelection } from './useSelection';

const GRID = 'grid grid-cols-[6.5rem_7rem_8rem_1fr_7.5rem_7.5rem_8rem] gap-3';
const TYPE_LABEL: Record<string, string> = {
  invoice: 'Invoice', credit_note: 'Credit note', bill: 'Bill', debit_note: 'Debit note', credit_application: 'Credit applied', reversal: 'Reversal',
  receipt: 'Receipt', payment: 'Payment', refund: 'Refund', supplier_refund: 'Supplier refund', manual: 'Journal',
};

export const LiveStatement: React.FC<{ side: 'customer' | 'supplier' }> = ({ side }) => {
  const company = useRouteCompany();
  const { selection, set, periods, ready } = useReportSelection('range');
  const contacts = useStatementContacts(side);
  const name = side === 'customer' ? 'customer-statement' : 'supplier-statement';
  const contactId = selection.contactId;
  const q = useReport(name, selection, ready && Boolean(contactId));
  const st = q.data;
  const money = fmt(st?.currency ?? company.base_currency);

  return (
    <LiveReportShell
      title={side === 'customer' ? 'Customer statement' : 'Supplier statement'}
      report={name}
      kind="range"
      selection={selection}
      onChange={set}
      periods={periods}
      descriptor={st ? `${st.contact.name} · ${longDate(st.from)} to ${longDate(st.to)}` : undefined}
      generatedAt={st?.generatedAt}
      exportDisabled={!contactId}
      toolbar={
        <SelectBox aria-label={side === 'customer' ? 'Customer' : 'Supplier'} value={contactId ?? ''} onChange={(e) => set({ ...selection, contactId: e.target.value || undefined })} className="min-w-[14rem]">
          <option value="">{contacts.isPending ? 'Loading…' : `Choose a ${side}`}</option>
          {(contacts.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </SelectBox>
      }
    >
      {contacts.isError && <ReportError error={contacts.error} onRetry={() => void contacts.refetch()} what="the contact list" />}
      {!contactId ? (
        <p className="p-4 text-[13px] text-text-muted">Choose a {side} to see their statement.</p>
      ) : !ready || q.isPending ? <ReportLoading what="the statement" /> : q.isError ? <ReportError error={q.error} onRetry={() => void q.refetch()} what="this statement" /> : st && (
        <ReportCard className="p-0 sm:p-0">
          <div className="min-w-[860px]">
            <div className={`${GRID} px-4 py-2.5 border-b border-border text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted`}>
              <span>Date</span><span>Type</span><span>Document</span><span>Description</span>
              <span className="text-right">Debit</span><span className="text-right">Credit</span><span className="text-right">Balance</span>
            </div>
            <div className={`${GRID} items-baseline px-4 py-2 text-xs bg-surface-neutral/50 font-medium`} data-testid="stmt-opening">
              <span className="text-text-muted">{longDate(st.from)}</span>
              <span className="col-span-5 text-text-primary">Opening balance</span>
              <span className={cn('text-right tabular-nums', tone(st.opening))}>{money(st.opening)}</span>
            </div>
            {st.rows.length === 0 && <p className="p-6 text-center text-xs text-text-muted">No activity in this range.</p>}
            <div className="divide-y divide-border/60">
              {st.rows.map((r, i) => (
                <div key={i} className={`${GRID} items-baseline px-4 py-1.5 text-xs`}>
                  <span className="tabular-nums text-text-muted">{formatDate(r.date)}</span>
                  <span className="text-text-secondary">{TYPE_LABEL[r.type] ?? r.type}</span>
                  <span className="font-code text-text-muted">{r.documentNumber ?? dash}</span>
                  <span className="truncate text-text-primary">{r.description ?? dash}</span>
                  <span className="text-right tabular-nums">{r.debit ? money(r.debit) : dash}</span>
                  <span className="text-right tabular-nums">{r.credit ? money(r.credit) : dash}</span>
                  <span className={cn('text-right tabular-nums', tone(r.balance))}>{money(r.balance)}</span>
                </div>
              ))}
            </div>
            <div className={`${GRID} items-baseline px-4 py-3 border-t border-text-primary border-b-[3px] border-double text-[13px] font-semibold`} data-testid="stmt-closing">
              <span className="text-text-muted font-normal">{longDate(st.to)}</span>
              <span className="col-span-3 text-text-primary">Closing balance</span>
              <span className="text-right tabular-nums">{money(st.totalDebit)}</span>
              <span className="text-right tabular-nums">{money(st.totalCredit)}</span>
              <span className={cn('text-right tabular-nums', tone(st.closing))}>{money(st.closing)}</span>
            </div>
          </div>
        </ReportCard>
      )}
    </LiveReportShell>
  );
};
