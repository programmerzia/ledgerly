/** A customer's or supplier's statement of account (3c.4, 3c.5): choose the period, download the PDF or email it. */
import React, { useState } from 'react';
import { CARD } from '@/pages/Sales/invoice-view/shared';
import type { StatementParams } from '@/api/adapters/documents';
import { EmailButton, PdfButton, SendLog } from './DocumentActions';

const FIELD = 'h-9 rounded-md border border-border-strong bg-surface px-3 text-[13px] text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const StatementCard: React.FC<{ contactId: string; side: 'customer' | 'supplier'; canSend: boolean }> = ({ contactId, side, canSend }) => {
  const today = new Date();
  const [from, setFrom] = useState(iso(new Date(today.getFullYear(), 0, 1)));
  const [to, setTo] = useState(iso(today));
  const valid = from !== '' && to !== '' && from <= to;
  const params: StatementParams = { from, to, side };
  return (
    <section className={`${CARD} flex flex-col gap-3 p-5`} aria-label="Statement of account">
      <div>
        <h2 className="text-[13px] font-semibold text-text-primary">Statement of account</h2>
        <p className="text-xs text-text-muted">Every posted entry for the period with a running balance, taken from the books.</p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-text-secondary">
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={FIELD} aria-label="Statement from" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-text-secondary">
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={FIELD} aria-label="Statement to" />
        </label>
        <PdfButton family="contacts" id={contactId} params={params} label="Download statement" disabled={!valid} />
        {canSend && <EmailButton family="contacts" id={contactId} params={params} label="Email statement" disabled={!valid} why="Choose a period first." />}
      </div>
      {!valid && <p className="text-xs text-danger">Choose a start date on or before the end date.</p>}
      <SendLog family="contacts" id={contactId} className="border-0 p-0 shadow-none" />
    </section>
  );
};
