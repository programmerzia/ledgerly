import React, { useRef, useState } from 'react';
import { CheckCircle2, FileUp, X } from 'lucide-react';
import type { Contact } from '@/types';
import { BUSINESS_TODAY } from '@/lib/docStatus';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatMoney } from '@/lib/format';

export type Confidence = 'high' | 'medium' | 'low';
export type CaptureField = 'supplier' | 'amount' | 'date' | 'due' | 'reference';

export interface BillExtraction {
  fileName: string;
  supplierId: string | null;
  amount: number;
  date: string;
  due: string;
  reference: string;
  confidence: Record<CaptureField, Confidence>;
}

const addDays = (date: string, days: number) =>
  new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);

const tokens = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t.length >= 3);

/** Mock extraction: no network. Deterministic from the file name and size. */
export function extractBill(file: { name: string; size: number }, suppliers: Contact[]): BillExtraction {
  const stem = file.name.replace(/\.[^.]+$/, '');
  const fileTokens = tokens(stem);
  let best: { c: Contact; score: number } | null = null;
  for (const c of suppliers) {
    const nameTokens = tokens(c.name);
    const hits = nameTokens.filter((t) => fileTokens.some((f) => f.startsWith(t.slice(0, 4)) || t.startsWith(f.slice(0, 4)))).length;
    const score = nameTokens.length ? hits / nameTokens.length : 0;
    if (hits > 0 && (!best || score > best.score)) best = { c, score };
  }
  const supplier = best?.c ?? null;
  const amount = Math.round((file.size % 900000) + 5000);
  const date = BUSINESS_TODAY;
  return {
    fileName: file.name,
    supplierId: supplier?.id ?? null,
    amount,
    date,
    due: addDays(date, supplier?.payment_terms_days ?? 30),
    reference: stem,
    confidence: {
      supplier: !best ? 'low' : best.score >= 0.5 ? 'high' : 'medium',
      amount: 'medium',
      date: 'medium',
      due: supplier ? 'high' : 'low',
      reference: 'high',
    },
  };
}

const CHIP: Record<Confidence, string> = {
  high: 'bg-success-soft text-success',
  medium: 'bg-warning-soft text-warning',
  low: 'bg-danger-soft text-danger',
};
const CHIP_LABEL: Record<Confidence, string> = { high: 'Looks right', medium: 'Please check', low: 'Not found' };

export const BillDropZone: React.FC<{ onFile: (file: File) => void }> = ({ onFile }) => {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const pick = (f?: File | null) => f && onFile(f);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        pick(e.dataTransfer.files?.[0]);
      }}
      className={cn(
        'flex items-center gap-3 rounded-lg border border-dashed px-4 py-3 transition-colors',
        over ? 'border-accent bg-surface-neutral' : 'border-border-strong bg-surface'
      )}
    >
      <FileUp className="size-4 shrink-0 text-text-muted" />
      <div className="flex-1 text-[13px]">
        <span className="font-medium text-text-primary">Drop a bill PDF or photo, or </span>
        <button type="button" onClick={() => input.current?.click()} className="font-medium text-accent hover:underline">
          browse
        </button>
        <div className="text-xs text-text-muted">Fields are read from the file. Check them before saving.</div>
      </div>
      <input
        ref={input}
        type="file"
        accept="application/pdf,image/*"
        className="sr-only"
        aria-label="Upload a supplier bill"
        data-testid="bill-file"
        onChange={(e) => {
          pick(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
};

interface PanelProps {
  extraction: BillExtraction;
  supplierName?: string;
  suppliers: Contact[];
  needsSupplier: boolean;
  onPickSupplier: (id: string) => void;
  onDismiss: () => void;
}

export const BillExtractedPanel: React.FC<PanelProps> = ({ extraction: x, supplierName, suppliers, needsSupplier, onPickSupplier, onDismiss }) => {
  const rows: Array<[CaptureField, string, string]> = [
    ['supplier', 'Supplier', supplierName || 'Not recognised'],
    ['amount', 'Amount', formatMoney(x.amount)],
    ['date', 'Bill date', x.date],
    ['due', 'Due date', x.due],
    ['reference', 'Reference', x.reference],
  ];
  return (
    <section className="rounded-lg border border-border bg-surface p-4 flex flex-col gap-3" aria-label="Extracted from the bill">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-text-primary">Read from the bill: check before using</h3>
        <span className="text-xs text-text-muted truncate">from {x.fileName}</span>
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="ml-auto grid size-7 place-items-center rounded-md text-text-muted hover:bg-surface-neutral">
          <X className="size-4" />
        </button>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {rows.map(([field, label, value]) => (
          <li key={field} className="rounded-lg bg-surface border border-border px-3 py-2">
            <div className="text-xs font-medium text-text-muted">{label}</div>
            <div className="truncate text-[13px] font-medium text-text-primary tabular-nums">{value}</div>
            <span className={cn('mt-1 inline-flex rounded-[3px] px-1.5 py-0.5 text-[11px] font-medium', CHIP[x.confidence[field]])}>
              {CHIP_LABEL[x.confidence[field]]}
            </span>
          </li>
        ))}
      </ul>
      {needsSupplier && (
        <div className="flex flex-wrap items-center gap-2 text-[13px]" role="alert">
          <span className="text-text-primary font-medium">We couldn't tell who this bill is from. Pick the supplier:</span>
          <Select onValueChange={onPickSupplier}>
            <SelectTrigger autoFocus className="w-56" aria-label="Supplier">
              <SelectValue placeholder="Choose a supplier…" />
            </SelectTrigger>
            <SelectContent>
              {suppliers.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <p className="flex items-center gap-1.5 text-xs text-text-muted">
        <CheckCircle2 className="size-3.5" /> Highlighted fields below were filled from the file. Nothing is saved until you click Save draft or Submit.
      </p>
    </section>
  );
};
