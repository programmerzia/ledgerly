import React, { useMemo, useState } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { ArrowDown, ArrowUp, Copy, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useLedgerStore } from '@/mock/store';
import { formatMoney } from '@/lib/format';
import { PageHeader } from '@/components/domain/PageHeader';
import { DataTable } from '@/components/domain/DataTable';
import { EmptyState } from '@/components/domain/EmptyState';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { BankRule } from '@/types';
import { RuleDialog } from './reconcile/RuleDialog';

export const BankRules: React.FC = () => {
  const { bankRules, accounts, taxCodes, contacts, currentCompany, updateBankRule, deleteBankRule } = useLedgerStore();
  const [editing, setEditing] = useState<BankRule | undefined>();
  const [template, setTemplate] = useState<Partial<BankRule> | undefined>();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [toDelete, setToDelete] = useState<BankRule | null>(null);

  const rules = useMemo(() => [...bankRules].sort((a, b) => a.priority - b.priority), [bankRules]);
  const open = (rule?: BankRule, tpl?: Partial<BankRule>) => {
    setEditing(rule);
    setTemplate(tpl);
    setDialogOpen(true);
  };

  const move = (rule: BankRule, dir: -1 | 1) => {
    const i = rules.findIndex((r) => r.id === rule.id);
    const other = rules[i + dir];
    if (!other) return;
    updateBankRule(rule.id, { priority: other.priority });
    updateBankRule(other.id, { priority: rule.priority });
  };

  const acc = (id?: string) => {
    const a = accounts.find((x) => x.id === id);
    return a ? `${a.code} ${a.name}` : '-';
  };

  const columns: ColumnDef<BankRule>[] = [
    {
      id: 'order',
      header: 'Order',
      cell: ({ row }) => {
        const i = rules.findIndex((r) => r.id === row.original.id);
        return (
          <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
            <span className="w-5 text-xs tabular-nums text-text-muted">{i + 1}</span>
            <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => move(row.original, -1)} className="rounded p-1 text-text-muted hover:bg-surface-neutral hover:text-text-primary disabled:opacity-30">
              <ArrowUp className="size-3.5" />
            </button>
            <button type="button" aria-label="Move down" disabled={i === rules.length - 1} onClick={() => move(row.original, 1)} className="rounded p-1 text-text-muted hover:bg-surface-neutral hover:text-text-primary disabled:opacity-30">
              <ArrowDown className="size-3.5" />
            </button>
          </div>
        );
      },
    },
    { accessorKey: 'name', header: 'Name', cell: ({ row }) => <span className="text-[13px] font-medium text-text-primary">{row.original.name}</span> },
    {
      id: 'if',
      header: 'If the bank line...',
      cell: ({ row }) => {
        const r = row.original;
        const range =
          r.min_amount !== undefined && r.max_amount !== undefined
            ? `${formatMoney(r.min_amount)} to ${formatMoney(r.max_amount)}`
            : r.min_amount !== undefined
              ? `at least ${formatMoney(r.min_amount)}`
              : r.max_amount !== undefined
                ? `up to ${formatMoney(r.max_amount)}`
                : null;
        return (
          <div className="text-xs text-text-secondary">
            <span className="mr-1.5 rounded bg-surface-neutral px-1.5 py-0.5 text-[11px] font-medium">
              {r.direction === 'out' ? 'Money out' : r.direction === 'in' ? 'Money in' : 'Any'}
            </span>
            contains <span className="font-mono font-semibold text-text-primary">"{r.contains}"</span>
            {range && <span className="text-text-muted"> · {range}</span>}
          </div>
        );
      },
    },
    {
      id: 'then',
      header: '...then code as',
      cell: ({ row }) => {
        const r = row.original;
        const tax = taxCodes.find((t) => t.id === r.tax_code_id)?.code;
        const contact = contacts.find((c) => c.id === r.contact_id)?.name;
        return (
          <div className="text-xs text-text-secondary">
            <span className="text-text-primary">{acc(r.account_id)}</span>
            {tax && <span className="ml-1.5 rounded border border-border px-1 font-mono text-[10px]">{tax}</span>}
            {contact && <span className="text-text-muted"> · {contact}</span>}
          </div>
        );
      },
    },
    { accessorKey: 'times_applied', header: () => <div className="text-right">Times used</div>, cell: ({ row }) => <div className="text-right text-xs tabular-nums text-text-secondary">{row.original.times_applied}</div> },
    {
      accessorKey: 'is_active',
      header: 'Active',
      cell: ({ row }) => (
        <div onClick={(e) => e.stopPropagation()}>
          <Switch
            checked={row.original.is_active}
            aria-label={`${row.original.name} active`}
            onCheckedChange={(v) => updateBankRule(row.original.id, { is_active: v })}
          />
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        breadcrumb={[{ label: 'Bank & cash', to: `/${currentCompany.slug}/banking` }, { label: 'Rules' }]}
        title="Bank rules"
        subtitle="Rules code repeat bank lines. They only suggest; you accept each one. The first matching rule wins."
        actions={
          <button type="button" onClick={() => open()} className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-white transition hover:bg-accent-hover">
            <Plus className="size-4" /> New rule
          </button>
        }
      />

      {rules.length === 0 ? (
        <EmptyState
          title="No bank rules yet"
          description="When you code a bank line, tick 'Create a rule for lines like this' and the next one is suggested for you. Or add one now."
          actionLabel="New rule"
          onAction={() => open()}
        />
      ) : (
        <DataTable
          columns={columns}
          data={rules}
          tableId="bank-rules"
          searchPlaceholder="Search rules..."
          contextMenuTitle={(r) => r.name}
          onRowClick={(r) => open(r)}
          rowActions={(r) => [
            { label: 'Edit', icon: Pencil, shortcut: 'E', onClick: () => open(r) },
            {
              label: 'Duplicate',
              icon: Copy,
              onClick: () => open(undefined, { ...r, name: `${r.name} (copy)` }),
            },
            { label: 'Delete', icon: Trash2, destructive: true, onClick: () => setToDelete(r) },
          ]}
        />
      )}

      <RuleDialog open={dialogOpen} onClose={() => setDialogOpen(false)} rule={editing} template={template} />

      <Dialog open={Boolean(toDelete)} onOpenChange={(o) => !o && setToDelete(null)}>
        <DialogContent className="max-w-sm p-6">
          <DialogHeader>
            <DialogTitle>Delete this rule?</DialogTitle>
            <DialogDescription>
              "{toDelete?.name}" will stop suggesting codes. Lines already recorded are not changed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <button type="button" onClick={() => setToDelete(null)} className="h-8 rounded-md border border-border px-3 text-[13px] font-medium text-text-secondary hover:bg-surface-neutral">
              Keep rule
            </button>
            <button
              type="button"
              autoFocus
              onClick={() => {
                if (toDelete) deleteBankRule(toDelete.id);
                toast.success('Rule deleted.');
                setToDelete(null);
              }}
              className="h-9 rounded-lg bg-danger px-4 text-[13px] font-semibold text-white hover:opacity-90"
            >
              Delete rule
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
