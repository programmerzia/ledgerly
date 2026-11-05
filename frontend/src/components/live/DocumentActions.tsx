/**
 * Download PDF, Email and the send log on a live document (3c.4, 3c.5). The server owns the rules: a PDF is made on a
 * worker from the stored document, only a posted document can be sent, and the send log is its own record. This shows
 * the server's verdict in plain words.
 */
import React, { useRef, useState } from 'react';
import { FileDown, Loader2, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { BTN_PRIMARY, BTN_SECONDARY, CARD } from '@/pages/Sales/invoice-view/shared';
import { describeError } from '@/api/messages';
import { IntentSlot } from '@/api/intentSlot';
import { looksLikeEmail, parseRecipients, sendLook, type DocFamily, type StatementParams } from '@/api/adapters/documents';
import { useEmailDraft, usePdfDownload, useSendEmail, useSends } from '@/data/documents';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

const TONE = { ok: 'bg-success-soft text-success', wait: 'bg-surface-neutral text-text-secondary', bad: 'bg-danger-soft text-danger' } as const;

/** "Download PDF". For a statement pass the period. */
export const PdfButton: React.FC<{ family: DocFamily; id: string; params?: StatementParams; label?: string; disabled?: boolean }> = ({ family, id, params, label = 'Download PDF', disabled }) => {
  const pdf = usePdfDownload(family, id);
  return (
    <button
      type="button"
      disabled={pdf.busy || disabled}
      className={cn(BTN_SECONDARY, 'disabled:opacity-60')}
      onClick={() => void pdf.run(params).catch((e: unknown) => toast.error(describeError(e)))}
    >
      {pdf.busy ? <Loader2 className="size-4 animate-spin text-text-muted" /> : <FileDown className="size-4 text-text-muted" />}
      {pdf.busy ? 'Preparing PDF…' : label}
    </button>
  );
};

/** "Email…" opens the message as it would go out; the person can change who gets it and what it says. */
export const EmailButton: React.FC<{ family: DocFamily; id: string; params?: StatementParams; label?: string; disabled?: boolean; why?: string }> = ({ family, id, params, label = 'Email', disabled, why }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" disabled={disabled} title={disabled ? why : undefined} className={cn(BTN_SECONDARY, 'disabled:opacity-60')} onClick={() => setOpen(true)}>
        <Mail className="size-4 text-text-muted" /> {label}
      </button>
      {open && <EmailDialog family={family} id={id} params={params} onClose={() => setOpen(false)} />}
    </>
  );
};

const EmailDialog: React.FC<{ family: DocFamily; id: string; params?: StatementParams; onClose: () => void }> = ({ family, id, params, onClose }) => {
  const draft = useEmailDraft(family, id, params, true);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl rounded-lg border border-border bg-surface-elevated p-6 shadow-popover">
        <DialogHeader>
          <DialogTitle>Email this document</DialogTitle>
        </DialogHeader>
        {draft.isPending && <p role="status" className="text-[13px] text-text-muted">Preparing the message…</p>}
        {draft.isError && (
          <>
            <p role="alert" className="text-[13px] text-danger">{describeError(draft.error)}</p>
            <DialogFooter><button type="button" className={BTN_SECONDARY} onClick={onClose}>Close</button></DialogFooter>
          </>
        )}
        {draft.isSuccess && <EmailForm key={draft.dataUpdatedAt} family={family} id={id} params={params} draft={draft.data} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
};

const FIELD = 'rounded-md border border-border-strong bg-surface px-3 text-[13px] text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';

const EmailForm: React.FC<{ family: DocFamily; id: string; params?: StatementParams; draft: NonNullable<ReturnType<typeof useEmailDraft>['data']>; onClose: () => void }> = ({ family, id, params, draft, onClose }) => {
  const send = useSendEmail(family, id);
  const slot = useRef(new IntentSlot()).current;
  const [to, setTo] = useState(draft.recipients.join(', '));
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [problem, setProblem] = useState('');
  const [withLink, setWithLink] = useState(false);

  const recipients = parseRecipients(to);
  const bad = recipients.filter((r) => !looksLikeEmail(r));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProblem('');
    if (recipients.length === 0) return setProblem('Add at least one email address.');
    if (bad.length > 0) return setProblem(`${bad[0]} is not a valid email address.`);
    // The link is made when the mail is sent: the placeholder stands for it (3c.7b).
    const text = withLink && !body.includes('{{ invoice_link }}') ? `${body.trimEnd()}\n\nView and download this invoice online: {{ invoice_link }}` : body;
    const payload = { recipients, subject, body: text, ...(params ?? {}) };
    try {
      await send.mutateAsync({ body: payload, intent: slot.for(JSON.stringify(payload)) });
      slot.clear();
      toast.success('The email is on its way. The send log on this page shows when it has been sent.');
      onClose();
    } catch (err) {
      setProblem(describeError(err));
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3" aria-label="Email this document">
      {!draft.can_send && <p className="text-[13px] text-text-secondary">You can read this document but your role does not allow sending it.</p>}
      <label className="flex flex-col gap-1 text-[13px] font-medium text-text-primary">
        To
        <input value={to} onChange={(e) => setTo(e.target.value)} className={cn(FIELD, 'h-9')} placeholder="name@company.com, another@company.com" aria-label="To" />
        <span className="text-xs font-normal text-text-muted">{draft.recipients.length === 0 ? `${draft.contact_name} has no email address on file. Type one here.` : 'From the contact. Change it or add more, separated by commas.'}</span>
      </label>
      <label className="flex flex-col gap-1 text-[13px] font-medium text-text-primary">
        Subject
        <input value={subject} onChange={(e) => setSubject(e.target.value)} className={cn(FIELD, 'h-9')} maxLength={200} aria-label="Subject" />
      </label>
      <label className="flex flex-col gap-1 text-[13px] font-medium text-text-primary">
        Message
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={9} className={cn(FIELD, 'py-2 leading-relaxed')} maxLength={5000} aria-label="Message" />
        <span className="text-xs font-normal text-text-muted">The PDF is attached. The wording comes from your company’s email template (Settings, General).</span>
      </label>
      {draft.can_share && (
        <label className="flex items-start gap-2 text-[13px] text-text-primary">
          <input type="checkbox" className="mt-0.5" checked={withLink} onChange={(e) => setWithLink(e.target.checked)} />
          <span>Include an online link to this invoice<span className="block text-xs text-text-muted">The customer can open it without signing in and see what is still due. It works for 90 days. You can turn it off on the invoice page.</span></span>
        </label>
      )}
      {problem && <p role="alert" className="text-[13px] text-danger">{problem}</p>}
      <DialogFooter>
        <button type="button" className={BTN_SECONDARY} onClick={onClose}>Cancel</button>
        <button type="submit" disabled={send.isPending || !draft.can_send} className={cn(BTN_PRIMARY, 'disabled:opacity-60')}>
          {send.isPending ? 'Sending…' : 'Send email'}
        </button>
      </DialogFooter>
    </form>
  );
};

/** Who sent this document to whom, when, and whether the mail server took it. Hidden until there is something to show. */
export const SendLog: React.FC<{ family: DocFamily; id: string; className?: string }> = ({ family, id, className }) => {
  const sends = useSends(family, id);
  if (sends.isPending || sends.isError || !sends.data || sends.data.length === 0) return null;
  return (
    <section className={cn(CARD, 'p-5', className)} aria-label="Sent by email">
      <h2 className="text-[13px] font-semibold text-text-primary">Sent by email</h2>
      <ul className="mt-3 flex flex-col divide-y divide-border">
        {sends.data.map((s) => {
          const look = sendLook(s.status);
          return (
            <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-[13px]">
              <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', TONE[look.tone])}>{look.label}</span>
              <span className="text-text-primary">{s.recipients.join(', ')}</span>
              <span className="text-text-muted">{s.subject}</span>
              <span className="ml-auto text-xs text-text-muted">
                {s.queued_by_name ?? 'Someone'} · {formatDateTime(s.sent_at ?? s.queued_at)}
              </span>
              {s.status === 'failed' && <p className="w-full text-xs text-danger">The email was not sent{typeof s.error === 'string' && s.error ? `: ${s.error}` : '.'} Try sending it again.</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
};
