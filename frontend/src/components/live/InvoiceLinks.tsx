/**
 * The online link of a posted sales invoice (3c.7b): make one (the address is shown once), see how often each was opened, turn one off.
 * The customer needs no account to open it; anyone with the address can see this one invoice, so it is never shown again.
 */
import React, { useRef, useState } from 'react';
import { Check, Copy, Link2 } from 'lucide-react';
import { toast } from 'sonner';
import { describeError } from '@/api/messages';
import { IntentSlot } from '@/api/intentSlot';
import { EXPIRY_CHOICES, linkStatusLook, viewsLine } from '@/api/adapters/invoiceLinks';
import { useInvoiceLinks, useLinkActions } from '@/data/invoiceLinks';
import { BTN_PRIMARY, BTN_SECONDARY, CARD } from '@/pages/Sales/invoice-view/shared';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

const TONE = { ok: 'bg-success-soft text-success', wait: 'bg-surface-neutral text-text-secondary', bad: 'bg-danger-soft text-danger' } as const;

export const InvoiceLinks: React.FC<{ invoiceId: string; posted: boolean; canShare: boolean }> = ({ invoiceId, posted, canShare }) => {
  const links = useInvoiceLinks(invoiceId, posted);
  const { create, revoke } = useLinkActions(invoiceId);
  const slot = useRef(new IntentSlot()).current;
  const [days, setDays] = useState<number | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [problem, setProblem] = useState('');

  if (!posted || (!canShare && (links.isPending || !links.data || links.data.length === 0))) return null;

  const make = async () => {
    setProblem('');
    try {
      const made = await create.mutateAsync({ days, intent: slot.for(String(days)) });
      slot.clear();
      setFresh(made.url);
      setCopied(false);
    } catch (e) {
      setProblem(describeError(e));
    }
  };
  const copy = async () => {
    if (!fresh) return;
    try {
      await navigator.clipboard.writeText(fresh);
      setCopied(true);
    } catch {
      toast.error('Copying did not work here. Select the address and copy it by hand.');
    }
  };
  const turnOff = async (linkId: string) => {
    setProblem('');
    try {
      await revoke.mutateAsync({ linkId, intent: new IntentSlot().for(linkId) });
      toast.success('The link is turned off. It no longer opens the invoice.');
    } catch (e) {
      setProblem(describeError(e));
    }
  };

  return (
    <section className={cn(CARD, 'p-5')} aria-label="Online link">
      <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-text-primary"><Link2 className="size-4 text-text-muted" /> Online link</h2>
      <p className="mt-1 text-xs text-text-muted">A customer can open this invoice, see what is still due and download the PDF without signing in. Anyone who has the address can see this one invoice, so share it only with the customer.</p>

      {fresh && (
        <div className="mt-3 rounded-md border border-border bg-surface-neutral p-3" role="status">
          <p className="text-xs font-medium text-text-primary">Copy the address now. For your customers&apos; safety it is not shown again.</p>
          <div className="mt-2 flex items-center gap-2">
            <input readOnly value={fresh} aria-label="Online link address" onFocus={(e) => e.currentTarget.select()} className="h-9 min-w-0 flex-1 rounded-md border border-border-strong bg-surface px-3 text-[13px] text-text-primary" />
            <button type="button" className={BTN_SECONDARY} onClick={() => void copy()}>
              {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4 text-text-muted" />} {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      {canShare && (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-text-muted">Works for
            <select value={days === null ? '' : String(days)} onChange={(e) => setDays(e.target.value === '' ? null : Number(e.target.value))} className="h-9 rounded-md border border-border-strong bg-surface px-2 text-[13px] text-text-primary" aria-label="How long the link works">
              {EXPIRY_CHOICES.map((c) => <option key={c.label} value={c.value === null ? '' : String(c.value)}>{c.label}</option>)}
            </select>
          </label>
          <button type="button" className={cn(BTN_PRIMARY, 'disabled:opacity-60')} disabled={create.isPending} onClick={() => void make()}>{create.isPending ? 'Making…' : 'Make a link'}</button>
        </div>
      )}
      {problem && <p role="alert" className="mt-2 text-[13px] text-danger">{problem}</p>}

      {links.data && links.data.length > 0 && (
        <ul className="mt-3 flex flex-col divide-y divide-border" data-testid="link-list">
          {links.data.map((l) => {
            const look = linkStatusLook(l.status);
            return (
              <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-[13px]">
                <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', TONE[look.tone])}>{look.label}</span>
                <span className="text-text-secondary">Made {formatDateTime(l.created_at)}{l.created_by_name ? ` by ${l.created_by_name}` : ''}{l.channel === 'email' ? ' (sent by email)' : ''}</span>
                <span className="text-text-muted">{l.expires_at ? `Expires ${formatDateTime(l.expires_at)}` : 'No expiry'}</span>
                <span className="text-text-muted">{viewsLine(l, formatDateTime)}</span>
                {canShare && l.status === 'active' && (
                  <button type="button" className="ml-auto text-xs text-text-muted hover:text-danger" onClick={() => void turnOff(l.id)}>Turn off</button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};
