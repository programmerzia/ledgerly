import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Plus, Tags, Pencil, Ban, ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/domain/PageHeader';
import { EmptyState } from '@/components/domain/EmptyState';
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useLedgerStore } from '@/mock/store';
import { useDimensions, useDimensionActions } from '@/data/dimensions';
import type { LiveDimension, LiveDimensionValue } from '@/api/adapters/dimension';
import { createIntent } from '@/api/idempotency';
import { describeError } from '@/api/messages';
import { Handled, describeProblem } from '@/api/live/writeProblems';
import { cn } from '@/lib/utils';

const inputCls = 'h-8 w-full px-3 rounded-md border border-border bg-surface text-[13px] text-text-primary transition focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20';
const btnGhost = 'h-8 px-3 rounded-md border border-border bg-surface hover:bg-surface-neutral text-[13px] font-medium text-text-primary cursor-pointer';
const btnPrimary = 'h-8 px-4 rounded-md bg-accent hover:bg-accent-hover text-white text-[13px] font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';

type Form =
  | { kind: 'dimension' }
  | { kind: 'rename-dimension'; dimension: LiveDimension }
  | { kind: 'value'; dimension: LiveDimension }
  | { kind: 'rename-value'; dimension: LiveDimension; value: LiveDimensionValue };

const FormDialog: React.FC<{ form: Form | null; onClose: () => void }> = ({ form, onClose }) => {
  const actions = useDimensionActions();
  const intent = useRef(createIntent());
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  React.useEffect(() => {
    if (!form) return;
    intent.current = createIntent();
    setProblem(null);
    setCode('');
    setName(form.kind === 'rename-dimension' ? form.dimension.name : form.kind === 'rename-value' ? form.value.name : '');
  }, [form]);
  if (!form) return null;
  const hasCode = form.kind === 'dimension' || form.kind === 'value';
  const title =
    form.kind === 'dimension' ? 'New dimension' : form.kind === 'rename-dimension' ? `Rename ${form.dimension.code}` : form.kind === 'value' ? `New value in ${form.dimension.name}` : `Rename ${form.value.code}`;
  const valid = name.trim() !== '' && (!hasCode || code.trim() !== '');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      if (form.kind === 'dimension') await actions.createDimension({ code, name }, intent.current);
      else if (form.kind === 'rename-dimension') await actions.renameDimension(form.dimension, name, intent.current);
      else if (form.kind === 'value') await actions.createValue(form.dimension, { code, name }, intent.current);
      else await actions.renameValue(form.dimension, form.value.id, form.value.version, name, intent.current);
      toast.success('Saved');
      onClose();
    } catch (err) {
      if (err instanceof Handled) onClose();
      else setProblem(describeProblem(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {form.kind === 'dimension' || form.kind === 'rename-dimension'
              ? 'A dimension is a way to tag journal lines, such as department or project.'
              : 'Values are the choices a line can carry for this dimension.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          {hasCode && (
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-text-primary">Code</span>
              <input autoFocus value={code} onChange={(e) => setCode(e.target.value)} className={`${inputCls} font-mono`} placeholder={form.kind === 'dimension' ? 'DEPT' : 'OPS'} />
            </label>
          )}
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-text-primary">Name</span>
            <input autoFocus={!hasCode} value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder={form.kind === 'dimension' ? 'e.g. Department' : 'e.g. Operations'} />
          </label>
          {problem && <p className="text-xs text-danger" role="alert">{problem}</p>}
          <DialogFooter>
            <button type="button" onClick={onClose} className={btnGhost}>Cancel</button>
            <button type="submit" disabled={!valid || busy} className={btnPrimary}>{busy ? 'Saving…' : 'Save'}</button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export const Dimensions: React.FC = () => {
  const navigate = useNavigate();
  const slug = useLedgerStore((s) => s.currentCompany.slug);
  const { data: dimensions, isLoading, error, refetch } = useDimensions();
  const actions = useDimensionActions();
  const [form, setForm] = useState<Form | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const deactivate = async (fn: () => Promise<void>) => {
    setProblem(null);
    try {
      await fn();
      toast.success('Deactivated');
    } catch (e) {
      if (!(e instanceof Handled)) setProblem(describeProblem(e));
    }
  };
  // Creating needs the same permission as editing; the list has no separate hint, so follow the dimensions we can see.
  const canManage = dimensions.length === 0 || dimensions.some((d) => d.can.update);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Dimensions"
        subtitle="Tags you can put on journal lines (department, project, branch) so reports can be split by them"
        actions={
          <>
            <button type="button" onClick={() => navigate(`/${slug}/accounts`)} className={cn(btnGhost, 'flex items-center gap-1.5')}>
              <ArrowLeft className="size-4 text-text-muted" />
              Chart of accounts
            </button>
            {canManage && (
              <button type="button" onClick={() => setForm({ kind: 'dimension' })} className={cn(btnPrimary, 'flex items-center gap-1.5')}>
                <Plus className="size-4" />
                New dimension
              </button>
            )}
          </>
        }
      />
      <FormDialog form={form} onClose={() => setForm(null)} />
      {problem && <div className="rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] font-medium text-danger" role="alert">{problem}</div>}

      {isLoading ? (
        <p className="p-4 text-[13px] text-text-muted" role="status">Loading dimensions…</p>
      ) : error ? (
        <div className="p-4 text-[13px] text-danger" role="alert">
          {describeError(error)}{' '}
          <button type="button" onClick={refetch} className="text-accent hover:underline cursor-pointer">Try again</button>
        </div>
      ) : dimensions.length === 0 ? (
        <EmptyState
          icon={Tags}
          title="No dimensions yet"
          description="Add a dimension such as Department, then give it values. You can then require it on selected accounts."
          actionLabel={canManage ? 'New dimension' : undefined}
          onAction={canManage ? () => setForm({ kind: 'dimension' }) : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {dimensions.map((d) => (
            <section key={d.id} className="flex flex-col rounded-lg border border-border bg-surface" aria-label={d.name}>
              <header className="flex items-start justify-between gap-3 border-b border-border p-4">
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold text-text-primary">
                    {d.name} <span className="ml-1 font-mono text-xs font-normal text-text-muted">{d.code}</span>
                  </h2>
                  <p className="mt-0.5 text-xs text-text-muted">
                    {d.is_active ? 'Active' : 'Inactive'} · {d.values.length} {d.values.length === 1 ? 'value' : 'values'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button type="button" disabled={!d.can.update} onClick={() => setForm({ kind: 'rename-dimension', dimension: d })} title={d.can.update ? 'Rename' : 'You cannot change this dimension'} className={cn(btnGhost, 'flex items-center gap-1 px-2 disabled:opacity-50 disabled:cursor-not-allowed')}>
                    <Pencil className="size-3.5" /> Rename
                  </button>
                  <button type="button" disabled={!d.is_active || !d.can.deactivate} onClick={() => void deactivate(() => actions.deactivateDimension(d))} title={!d.is_active ? 'Already inactive' : d.can.deactivate ? 'Deactivate' : 'You cannot deactivate this dimension'} className={cn(btnGhost, 'flex items-center gap-1 px-2 disabled:opacity-50 disabled:cursor-not-allowed')}>
                    <Ban className="size-3.5" /> Deactivate
                  </button>
                </div>
              </header>
              {d.values.length === 0 ? (
                <p className="p-4 text-[13px] text-text-muted">No values yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {d.values.map((v) => (
                    <li key={v.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
                      <span className={cn('min-w-0 truncate', v.is_active ? 'text-text-primary' : 'text-text-muted line-through')}>
                        <span className="mr-2 font-mono text-xs text-text-muted">{v.code}</span>
                        {v.name}
                      </span>
                      <span className="flex shrink-0 items-center gap-3 text-xs">
                        <button type="button" disabled={!d.can.update} onClick={() => setForm({ kind: 'rename-value', dimension: d, value: v })} className="text-accent hover:underline cursor-pointer disabled:opacity-50 disabled:no-underline disabled:cursor-not-allowed">Rename</button>
                        <button type="button" disabled={!v.is_active || !d.can.update} onClick={() => void deactivate(() => actions.deactivateValue(d, v.id, v.version))} className="text-danger hover:underline cursor-pointer disabled:opacity-50 disabled:no-underline disabled:cursor-not-allowed">{v.is_active ? 'Deactivate' : 'Inactive'}</button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {d.can.update && d.is_active && (
                <div className="border-t border-border p-3">
                  <button type="button" onClick={() => setForm({ kind: 'value', dimension: d })} className="flex items-center gap-1.5 text-[13px] font-medium text-accent hover:underline cursor-pointer">
                    <Plus className="size-4" /> Add value
                  </button>
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
};
