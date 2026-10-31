import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useLedgerStore } from '@/mock/store';
import type { Contact } from '@/types';
import { Kbd } from '@/components/ui/kbd';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: 'customer' | 'supplier';
  onCreated?: (contact: Contact) => void;
  initialName?: string;
}

const fieldCls =
  'h-8 px-2.5 bg-surface border border-border rounded-sm text-xs text-text-primary focus:outline-none focus:border-accent';

export const QuickCreateContactDialog: React.FC<Props> = ({ open, onOpenChange, kind, onCreated, initialName = '' }) => {
  const { contacts, currentCompany, addContact } = useLedgerStore();
  const label = kind === 'customer' ? 'customer' : 'supplier';

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [terms, setTerms] = useState(30);
  const [taxId, setTaxId] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setName(initialName);
      setEmail('');
      setTerms(30);
      setTaxId('');
      setError('');
    }
  }, [open, initialName]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setError(`Enter the ${label}'s name.`);
    if (email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim())) {
      return setError('That email does not look right. Check it or leave it empty.');
    }
    if (contacts.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) {
      return setError(`A contact named ${trimmed} already exists. Pick it from the list instead.`);
    }
    const prefix = kind === 'customer' ? 'CUST-' : 'SUPP-';
    const maxNo = contacts
      .filter((c) => c.code.startsWith(prefix))
      .reduce((m, c) => Math.max(m, parseInt(c.code.slice(prefix.length), 10) || 0), 0);
    const code = `${prefix}${String(maxNo + 1).padStart(3, '0')}`;
    const contact: Contact = {
      id: `cnt-${Date.now()}`,
      tenant_id: currentCompany.tenant_id,
      company_id: currentCompany.id,
      kind,
      code,
      name: trimmed,
      tax_id: taxId.trim() || undefined,
      email: email.trim(),
      default_currency: 'USD',
      payment_terms_days: terms,
      ...(kind === 'customer'
        ? { default_account_id: 'acc-4000', default_tax_code_id: 'tax-vat5', default_branch: 'MG' }
        : {}),
      is_active: true,
    };
    addContact(contact);
    toast.success(`${trimmed} added as ${code}`);
    onOpenChange(false);
    onCreated?.(contact);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New {label}</DialogTitle>
          <DialogDescription>Just the basics. You can add more details later.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-text-secondary">
            Name
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={fieldCls} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-text-secondary">
            Email
            <input
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={`billing@${label}.com`}
              className={fieldCls}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-text-secondary">
              Payment terms (days)
              <input
                type="number"
                min={0}
                value={terms}
                onChange={(e) => setTerms(Math.max(0, parseInt(e.target.value, 10) || 0))}
                className={`${fieldCls} font-mono`}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-text-secondary">
              Tax ID (optional)
              <input value={taxId} onChange={(e) => setTaxId(e.target.value)} className={`${fieldCls} font-mono`} />
            </label>
          </div>
          {error && <p className="text-xs text-danger font-medium">{error}</p>}
          <DialogFooter>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="h-8 px-3 rounded-sm border border-border text-xs font-medium text-text-secondary hover:bg-surface-neutral"
            >
              Cancel <Kbd className="ml-1">Esc</Kbd>
            </button>
            <button
              type="submit"
              className="h-8 px-3 rounded-md bg-accent hover:bg-accent-hover text-white text-[13px] font-medium"
            >
              Create {label} <Kbd className="ml-1 bg-white/20 border-white/30 text-white">↵</Kbd>
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
