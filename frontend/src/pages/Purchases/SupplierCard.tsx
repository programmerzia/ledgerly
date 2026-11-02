import { selectByMode } from '@/data/select';
import { SupplierCardLive } from './live';
import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLedgerStore } from '@/mock/store';
import { AlertCircle, Plus, CreditCard } from 'lucide-react';
import { ContactAccountCard } from '@/pages/Sales/ContactAccountCard';

const MockSupplierCard: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currentCompany, contacts, bills, settlements, contactBalance, contactOverdueBalance } = useLedgerStore();
  const coSlug = currentCompany.slug;
  const contact = contacts.find((c) => c.id === id);

  if (!contact) {
    return (
      <div className="p-12 text-center max-w-md mx-auto flex flex-col items-center gap-4">
        <AlertCircle className="size-10 text-danger" />
        <h2 className="text-base font-semibold text-text-primary">Supplier not found</h2>
        <p className="text-xs text-text-muted">We couldn't find this supplier. It may have been removed.</p>
        <button
          onClick={() => navigate(`/${coSlug}/suppliers`)}
          className="inline-flex items-center gap-1.5 h-8 px-3 bg-accent hover:bg-accent-hover text-white rounded-md text-[13px] font-medium transition-colors cursor-pointer"
        >
          Back to suppliers
        </button>
      </div>
    );
  }

  return (
    <ContactAccountCard
      kind="supplier"
      contact={contact}
      docs={bills.filter((d) => d.contact_id === contact.id)}
      settlements={settlements.filter((s) => s.contact_id === contact.id && s.kind === 'payment')}
      balance={contactBalance(contact.id)}
      overdue={contactOverdueBalance(contact.id)}
      companyName={currentCompany.name}
      coSlug={coSlug}
      actions={
        <>
          <button type="button" onClick={() => navigate(`/${coSlug}/payment-run`)} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border hover:border-border-strong bg-surface hover:bg-surface-neutral text-text-primary text-[13px] font-medium transition-colors cursor-pointer">
            <CreditCard className="size-4 text-text-muted" /> Pay supplier
          </button>
          <button type="button" onClick={() => navigate(`/${coSlug}/bills/new?contactId=${contact.id}`)} className="inline-flex items-center gap-1.5 h-8 px-3 bg-accent hover:bg-accent-hover text-white rounded-md text-[13px] font-medium transition-colors cursor-pointer">
            <Plus className="size-4" /> New bill
          </button>
        </>
      }
    />
  );
};

/** The demo keeps its store-backed screen; live mode reads the API (docs/15). */
export const SupplierCard: React.FC = selectByMode({ mock: MockSupplierCard, live: SupplierCardLive });
