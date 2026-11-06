/**
 * The page a customer opens from an invoice email (3c.7b): `/i/:token`. No sign-in, no company chrome. It shows the invoice, what is
 * still due and how to pay, and lets the customer download the PDF; nothing else about the company or the contact. The address holds a
 * secret, so the page asks search engines to stay away and sends no referrer, and every request goes without cookies.
 */
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FileDown, Loader2 } from 'lucide-react';
import { fetchPublicInvoice, fetchPublicPdf } from '@/api/live/invoiceLinks';
import { publicStatusLook, showsBalance, type PublicInvoice } from '@/api/adapters/invoiceLinks';
import { saveBlob } from '@/data/documents';
import { formatDate, formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';

const TONE = { ok: 'bg-success-soft text-success', wait: 'bg-surface-neutral text-text-secondary', bad: 'bg-danger-soft text-danger' } as const;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Adds the robots and referrer meta tags for the life of the page. */
function useQuietHead(): void {
  useEffect(() => {
    const added: HTMLMetaElement[] = [];
    for (const [name, content] of [['robots', 'noindex, nofollow, noarchive'], ['referrer', 'no-referrer']] as const) {
      const m = document.createElement('meta');
      m.name = name;
      m.content = content;
      document.head.appendChild(m);
      added.push(m);
    }
    const before = document.title;
    document.title = 'Invoice';
    return () => {
      added.forEach((m) => m.remove());
      document.title = before;
    };
  }, []);
}

export const PublicInvoicePage: React.FC = () => {
  useQuietHead();
  const { token = '' } = useParams();
  const q = useQuery({ queryKey: ['public-invoice', token], queryFn: () => fetchPublicInvoice(token), retry: false, gcTime: 0, staleTime: Infinity, refetchOnWindowFocus: false });

  return (
    <div className="min-h-screen bg-canvas text-text-primary">
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        {q.isPending && <p role="status" className="text-sm text-text-muted">Loading the invoice…</p>}
        {q.isError && <Notice title="The invoice could not be loaded" text="Check your connection and reload the page." />}
        {q.data?.state === 'gone' && <Notice title="This link does not work" text="It is not valid, or it has been turned off or has expired. Ask the sender for a new one." />}
        {q.data?.state === 'busy' && <Notice title="Too many requests" text="Wait a minute and reload the page." />}
        {q.data?.state === 'error' && <Notice title="Something went wrong" text="Try again in a moment." />}
        {q.data?.state === 'ok' && <Invoice token={token} inv={q.data.invoice} />}
      </main>
    </div>
  );
};

const Notice: React.FC<{ title: string; text: string }> = ({ title, text }) => (
  <div role="alert" className="rounded-lg border border-border bg-surface p-6">
    <h1 className="text-base font-semibold">{title}</h1>
    <p className="mt-1 text-sm text-text-secondary">{text}</p>
  </div>
);

const Invoice: React.FC<{ token: string; inv: PublicInvoice }> = ({ token, inv }) => {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const look = publicStatusLook(inv.status);
  const money = (m: { amount: number; currency: string }) => formatMoney(m.amount, m.currency);

  const download = async () => {
    setBusy(true);
    setProblem('');
    try {
      for (let attempt = 0; attempt < 45; attempt++) {
        const out = await fetchPublicPdf(token);
        if (out.state === 'ready') return saveBlob(out.blob, out.filename);
        if (out.state === 'failed') throw new Error('failed');
        if (out.state === 'gone') throw new Error('gone');
        if (out.state === 'busy') throw new Error('busy');
        await sleep(attempt < 4 ? 500 : 1500);
      }
      throw new Error('failed');
    } catch (e) {
      const why = e instanceof Error ? e.message : '';
      setProblem(why === 'gone' ? 'This link no longer works.' : why === 'busy' ? 'Too many requests. Wait a minute and try again.' : 'The PDF could not be made. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="rounded-lg border border-border bg-surface p-5 sm:p-8" aria-label={`Invoice ${inv.number}`}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          {inv.logo && <img src={inv.logo} alt="" className="h-10 max-w-24 object-contain" />}
          <div>
            <p className="text-xs text-text-muted">{inv.company_name}</p>
            <h1 className="text-xl font-semibold">Invoice {inv.number}</h1>
            <p className="mt-1 text-sm text-text-secondary">For {inv.bill_to}</p>
          </div>
        </div>
        <span className={cn('rounded-full px-3 py-1 text-xs font-medium', TONE[look.tone])} data-testid="status">{look.label}</span>
      </header>

      <dl className="mt-5 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
        <div><dt className="text-xs text-text-muted">Issued</dt><dd>{formatDate(inv.issue_date)}</dd></div>
        <div><dt className="text-xs text-text-muted">Due</dt><dd>{formatDate(inv.due_date)}</dd></div>
        {showsBalance(inv) && inv.balance_due && (
          <div className="col-span-2 sm:col-span-1"><dt className="text-xs text-text-muted">Balance due</dt><dd className="text-lg font-semibold tabular-nums" data-testid="balance">{money(inv.balance_due)}</dd></div>
        )}
      </dl>
      {inv.status === 'reversed' && <p className="mt-4 rounded-md bg-surface-neutral p-3 text-sm text-text-secondary">This invoice has been cancelled. Nothing is due on it.</p>}

      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs text-text-muted">
            <tr><th className="py-2 pr-3 font-medium">Description</th><th className="py-2 pr-3 text-right font-medium">Qty</th><th className="py-2 pr-3 text-right font-medium">Price</th><th className="py-2 text-right font-medium">Amount</th></tr>
          </thead>
          <tbody>
            {inv.lines.map((l, i) => (
              <tr key={i} className="border-b border-border/60">
                <td className="py-2 pr-3">{l.description}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{String(Number(l.quantity))}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{money(l.unit_price)}</td>
                <td className="py-2 text-right tabular-nums">{money(l.line_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="ml-auto mt-4 w-full max-w-xs text-sm">
        <div className="flex justify-between py-0.5"><dt className="text-text-secondary">Subtotal</dt><dd className="tabular-nums">{money(inv.subtotal)}</dd></div>
        <div className="flex justify-between py-0.5"><dt className="text-text-secondary">Tax</dt><dd className="tabular-nums">{money(inv.tax_total)}</dd></div>
        <div className="flex justify-between border-t border-border py-1 font-semibold"><dt>Total</dt><dd className="tabular-nums">{money(inv.total)}</dd></div>
      </dl>

      {inv.payment_instructions && inv.status !== 'reversed' && inv.status !== 'paid' && (
        <section className="mt-6" aria-label="How to pay">
          <h2 className="text-sm font-semibold">How to pay</h2>
          <p className="mt-1 whitespace-pre-line text-sm text-text-secondary">{inv.payment_instructions}</p>
        </section>
      )}

      <div className="mt-6">
        <button type="button" onClick={() => void download()} disabled={busy} className="inline-flex h-9 items-center gap-2 rounded-md border border-border-strong bg-surface px-4 text-sm font-medium hover:bg-surface-neutral disabled:opacity-60">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />} {busy ? 'Preparing the PDF…' : 'Download PDF'}
        </button>
        {problem && <p role="alert" className="mt-2 text-sm text-danger">{problem}</p>}
      </div>
    </article>
  );
};
