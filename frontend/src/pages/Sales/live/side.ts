import type { DocResource } from '@/api/live/trade';
import type { InvoiceKind } from '@/types';

/**
 * The two sides of trade documents. The live screens under `pages/Sales/live` serve both: the wording, the collection a
 * document lives under, the routes and the kind of account a line posts to all come from here, so a purchases screen is
 * the same component with `side="purchases"` and the sales screens are unchanged.
 */
export type Side = 'sales' | 'purchases';

export interface SideConfig {
  side: Side;
  resource: DocResource;
  contactKind: 'customer' | 'supplier';
  mainKind: InvoiceKind;
  creditKind: InvoiceKind;
  /** Route segments under /:co */
  docsPath: 'invoices' | 'bills';
  creditsPath: 'credit-notes' | 'debit-notes';
  contactsPath: 'customers' | 'suppliers';
  settlementPath: 'receipts' | 'payments';
  /** Settlement kind made by the form. */
  settlementKind: 'receipt' | 'payment';
  contact: string;
  Contact: string;
  contacts: string;
  Contacts: string;
  main: string;
  Main: string;
  mains: string;
  Mains: string;
  credit: string;
  Credit: string;
  credits: string;
  Credits: string;
  settlement: string;
  Settlement: string;
  /** Account type a document line may post to. */
  lineAccountType: 'income' | 'expense';
  /** What the contact owes / is owed, as the heading of the balance figure. */
  balanceLabel: string;
  balanceOnCard: string;
}

export const SIDES: Record<Side, SideConfig> = {
  sales: {
    side: 'sales',
    resource: 'invoices',
    contactKind: 'customer',
    mainKind: 'sales_invoice',
    creditKind: 'credit_note',
    docsPath: 'invoices',
    creditsPath: 'credit-notes',
    contactsPath: 'customers',
    settlementPath: 'receipts',
    settlementKind: 'receipt',
    contact: 'customer',
    Contact: 'Customer',
    contacts: 'customers',
    Contacts: 'Customers',
    main: 'invoice',
    Main: 'Invoice',
    mains: 'invoices',
    Mains: 'Invoices',
    credit: 'credit note',
    Credit: 'Credit note',
    credits: 'credit notes',
    Credits: 'Credit notes',
    settlement: 'receipt',
    Settlement: 'Receipt',
    lineAccountType: 'income',
    balanceLabel: 'Owes you',
    balanceOnCard: 'Owes you',
  },
  purchases: {
    side: 'purchases',
    resource: 'bills',
    contactKind: 'supplier',
    mainKind: 'purchase_bill',
    creditKind: 'debit_note',
    docsPath: 'bills',
    creditsPath: 'debit-notes',
    contactsPath: 'suppliers',
    settlementPath: 'payments',
    settlementKind: 'payment',
    contact: 'supplier',
    Contact: 'Supplier',
    contacts: 'suppliers',
    Contacts: 'Suppliers',
    main: 'bill',
    Main: 'Bill',
    mains: 'bills',
    Mains: 'Bills',
    credit: 'debit note',
    Credit: 'Debit note',
    credits: 'debit notes',
    Credits: 'Debit notes',
    settlement: 'payment',
    Settlement: 'Payment',
    lineAccountType: 'expense',
    balanceLabel: 'You owe',
    balanceOnCard: 'You owe them',
  },
};

export const isCreditKind = (k: InvoiceKind | string): boolean => k === 'credit_note' || k === 'debit_note';
export const sideOfKind = (k: InvoiceKind | string): Side => (k === 'purchase_bill' || k === 'debit_note' ? 'purchases' : 'sales');
