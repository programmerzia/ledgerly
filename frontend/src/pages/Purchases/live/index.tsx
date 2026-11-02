import React from 'react';
import { InvoicesListLive } from '@/pages/Sales/live/InvoicesListLive';
import { InvoiceFormLive } from '@/pages/Sales/live/InvoiceFormLive';
import { InvoiceViewLive } from '@/pages/Sales/live/InvoiceViewLive';
import { CustomersListLive } from '@/pages/Sales/live/CustomersListLive';
import { CustomerCardLive } from '@/pages/Sales/live/CustomerCardLive';
import { ReceiptFormLive } from '@/pages/Sales/live/ReceiptFormLive';
import { ReceiptViewLive } from '@/pages/Sales/live/ReceiptViewLive';
import { RecurringDocsLive } from '@/pages/Sales/live/RecurringDocsLive';

/**
 * Purchases screens are the sales live screens with `side="purchases"` (docs/15, Done in 3.6): same components, supplier
 * and bill wording, `/bills`, `/payments`. Nothing here is a copy.
 */
export const BillsListLive: React.FC<{ initialTab?: string }> = ({ initialTab }) => <InvoicesListLive side="purchases" initialTab={initialTab} />;
export const BillFormLive: React.FC = () => <InvoiceFormLive side="purchases" />;
export const BillViewLive: React.FC = () => <InvoiceViewLive side="purchases" />;
export const SuppliersListLive: React.FC = () => <CustomersListLive side="purchases" />;
export const SupplierCardLive: React.FC = () => <CustomerCardLive side="purchases" />;
export const PaymentFormLive: React.FC = () => <ReceiptFormLive side="purchases" />;
export const PaymentViewLive: React.FC = () => <ReceiptViewLive side="purchases" />;
export const RecurringBillsLive: React.FC = () => <RecurringDocsLive side="purchases" />;
