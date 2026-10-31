import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';
import { useLedgerStore } from '@/mock/store';
import { Account } from '@/types';
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { CLASSIFICATIONS } from './CoaGroupedTable';

const inputCls =
  'h-9 w-full px-3 rounded-lg border border-border bg-surface text-[13px] text-text-primary transition focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20';
const btnGhost = 'h-9 px-3.5 rounded-lg border border-border bg-surface hover:bg-surface-neutral text-[13px] font-medium text-text-primary cursor-pointer';
const btnPrimary = 'h-9 px-4 rounded-lg bg-accent hover:bg-accent-hover text-white text-[13px] font-semibold shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';

const Row: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <label className="flex flex-col gap-1.5">
    <span className="text-[13px] font-medium text-text-primary">{label}</span>
    {children}
    {hint && <span className="text-xs text-text-muted">{hint}</span>}
  </label>
);

export type AccountDialogMode =
  | { kind: 'new' }
  | { kind: 'sub'; parent: Account }
  | { kind: 'edit'; account: Account };

/** New account / add sub-account / edit account. */
export const AccountDialog: React.FC<{ mode: AccountDialogMode | null; onClose: () => void }> = ({ mode, onClose }) => {
  const { accounts, addAccount, updateAccount, currentCompany } = useLedgerStore();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<Account['account_type']>('asset');
  const [subtype, setSubtype] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (!mode) return;
    if (mode.kind === 'edit') {
      setCode(mode.account.code); setName(mode.account.name); setType(mode.account.account_type);
      setSubtype(mode.account.account_subtype); setDescription(mode.account.description ?? '');
    } else if (mode.kind === 'sub') {
      const siblings = accounts.filter((a) => a.account_type === mode.parent.account_type).map((a) => parseInt(a.code, 10)).filter(Number.isFinite);
      const base = parseInt(mode.parent.code, 10);
      let next = base + 1;
      while (siblings.includes(next)) next += 1;
      setCode(String(next)); setName(''); setType(mode.parent.account_type); setSubtype(mode.parent.account_subtype); setDescription('');
    } else {
      setCode(''); setName(''); setType('asset'); setSubtype(''); setDescription('');
    }
  }, [mode, accounts]);

  if (!mode) return null;
  const editing = mode.kind === 'edit' ? mode.account : null;
  const dupe = accounts.some((a) => a.code === code.trim() && a.id !== editing?.id);
  const valid = code.trim() && name.trim() && !dupe;
  const title = mode.kind === 'edit' ? 'Edit account' : mode.kind === 'sub' ? 'Add sub-account' : 'New account';

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    const normal = CLASSIFICATIONS.find((c) => c.value === type)!.normal;
    if (editing) {
      updateAccount({ ...editing, code: code.trim(), name: name.trim(), account_subtype: subtype.trim() || editing.account_subtype, description: description.trim() || undefined });
      toast.success(`Account ${code.trim()} updated`);
    } else {
      addAccount({
        id: `acc-${code.trim()}-${Date.now()}`,
        tenant_id: currentCompany.tenant_id,
        company_id: currentCompany.id,
        code: code.trim(),
        name: name.trim(),
        account_type: type,
        account_subtype: subtype.trim() || 'General',
        normal_balance: normal,
        control_type: null as unknown as Account['control_type'],
        currency_policy: 'base_only',
        is_postable: true,
        is_active: true,
        allow_manual_journals: true,
        description: description.trim() || undefined,
      });
      toast.success(`Account ${code.trim()} ${name.trim()} created`);
    }
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {mode.kind === 'sub' ? `Under ${mode.parent.code} ${mode.parent.name}.` : 'Accounts group your money into assets, debts, income and spending.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid grid-cols-[110px_1fr] gap-3">
            <Row label="Code" hint={dupe ? undefined : undefined}>
              <input autoFocus value={code} onChange={(e) => setCode(e.target.value)} className={`${inputCls} font-mono`} placeholder="1250" />
            </Row>
            <Row label="Account name">
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="e.g. Petty cash" />
            </Row>
          </div>
          {dupe && <p className="-mt-2 text-xs text-danger">That code is already used by another account.</p>}
          <div className="grid grid-cols-2 gap-3">
            <Row label="Type">
              <select value={type} onChange={(e) => setType(e.target.value as Account['account_type'])} disabled={mode.kind !== 'new'} className={inputCls}>
                {CLASSIFICATIONS.map((c) => <option key={c.value} value={c.value}>{c.label.replace(/s$/, '')}</option>)}
              </select>
            </Row>
            <Row label="Category">
              <input value={subtype} onChange={(e) => setSubtype(e.target.value)} className={inputCls} placeholder="e.g. Current assets" />
            </Row>
          </div>
          <Row label="Description (optional)">
            <input value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} />
          </Row>
          <DialogFooter>
            <button type="button" onClick={onClose} className={btnGhost}>Cancel</button>
            <button type="submit" disabled={!valid} className={btnPrimary}>{editing ? 'Save changes' : 'Create account'}</button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

/** Deactivate an account; a reason is required. */
export const DeactivateAccountDialog: React.FC<{ account: Account | null; onClose: () => void }> = ({ account, onClose }) => {
  const { updateAccount } = useLedgerStore();
  const [reason, setReason] = useState('');
  useEffect(() => setReason(''), [account]);
  if (!account) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Deactivate {account.code} {account.name}?</DialogTitle>
          <DialogDescription>
            The account stays in past reports but can no longer be used on new transactions.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-start gap-2.5 rounded-lg bg-warning-soft px-3 py-2.5 text-[13px] text-text-primary">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          You can turn it back on later from the account&apos;s edit menu.
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-text-primary">Reason</span>
          <textarea
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Why is this account no longer needed?"
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-text-primary focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </label>
        <DialogFooter>
          <button type="button" onClick={onClose} className={btnGhost}>Cancel</button>
          <button
            type="button"
            disabled={!reason.trim()}
            onClick={() => {
              updateAccount({ ...account, is_active: false, description: `${account.description ? account.description + ' · ' : ''}Deactivated: ${reason.trim()}` });
              toast.success(`${account.code} ${account.name} deactivated`);
              onClose();
            }}
            className="h-9 px-4 rounded-lg bg-danger text-white text-[13px] font-semibold shadow-sm cursor-pointer hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Deactivate
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
