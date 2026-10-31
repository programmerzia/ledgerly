import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLedgerStore } from '@/mock/store';
import { AlertCircle, Plus, Receipt } from 'lucide-react';
import { ContactAccountCard } from './ContactAccountCard';

export const CustomerCard: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currentCompany, contacts, invoices, settlements, contactBalance, contactOverdueBalance } = useLedgerStore();
  const coSlug = currentCompany.slug;
  const contact = contacts.find((c) => c.id === id);

  if (!contact) {
    return (
      <div className="p-12 text-center max-w-md mx-auto flex flex-col items-center gap-4">
        <AlertCircle className="size-10 text-danger" />
        <h2 className="text-base font-semibold text-text-primary">Customer not found</h2>
        <p className="text-xs text-text-muted">We couldn't find this customer. It may have been removed.</p>
        <button
          onClick={() => navigate(`/${coSlug}/customers`)}
          className="inline-flex items-center gap-1.5 h-8 px-3 bg-accent hover:bg-accent-hover text-white rounded-md text-[13px] font-medium transition-colors cursor-pointer"
        >
          Back to customers
        </button>
      </div>
    );
  }

  return (
    <ContactAccountCard
      kind="customer"
      contact={contact}
      docs={invoices.filter((d) => d.contact_id === contact.id)}
      settlements={settlements.filter((s) => s.contact_id === contact.id && s.kind === 'receipt')}
      balance={contactBalance(contact.id)}
      overdue={contactOverdueBalance(contact.id)}
      companyName={currentCompany.name}
      coSlug={coSlug}
      actions={
        <>
          <button type="button" onClick={() => navigate(`/${coSlug}/receipts/new?contactId=${contact.id}`)} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border hover:border-border-strong bg-surface hover:bg-surface-neutral text-text-primary text-[13px] font-medium transition-colors cursor-pointer">
            <Receipt className="size-4 text-text-muted" /> Receive money
          </button>
          <button type="button" onClick={() => navigate(`/${coSlug}/invoices/new?contactId=${contact.id}`)} className="inline-flex items-center gap-1.5 h-8 px-3 bg-accent hover:bg-accent-hover text-white rounded-md text-[13px] font-medium transition-colors cursor-pointer">
            <Plus className="size-4" /> New invoice
          </button>
        </>
      }
    />
  );
};
