import { simulatedCall } from './client';
import { useLedgerStore } from '@/mock/store';
import { Invoice, Bill, Settlement, PaymentRun, WhtCertificate, Contact } from '@/types';

export async function getInvoices(filters?: { status?: string }): Promise<Invoice[]> {
  return simulatedCall(() => {
    const list = useLedgerStore.getState().invoices;
    if (filters?.status && filters.status !== 'all') {
      return list.filter((i) => i.status === filters.status);
    }
    return list;
  });
}

export async function getInvoice(id: string): Promise<Invoice | undefined> {
  return simulatedCall(() => useLedgerStore.getState().invoices.find((i) => i.id === id));
}

export const getInvoiceById = getInvoice;

export async function saveInvoiceDraft(data: Partial<Invoice>): Promise<Invoice> {
  return simulatedCall(() => {
    const state = useLedgerStore.getState();
    return state.saveInvoiceDraft(data, state.currentUser);
  });
}

export const createInvoice = saveInvoiceDraft;

export async function submitInvoice(id: string): Promise<Invoice> {
  return simulatedCall(() => {
    const state = useLedgerStore.getState();
    return state.submitInvoiceForApproval(id, state.currentUser);
  });
}

export async function approveInvoice(id: string, pin = '246810'): Promise<Invoice> {
  return simulatedCall(() => {
    const state = useLedgerStore.getState();
    return state.approveInvoice(id, state.currentUser, pin, state.companySettings);
  });
}

export async function returnInvoice(id: string, reason: string): Promise<Invoice> {
  return simulatedCall(() => {
    const state = useLedgerStore.getState();
    return state.returnInvoice(id, reason, state.currentUser);
  });
}

export async function voidInvoice(id: string, reason: string): Promise<Invoice> {
  return simulatedCall(() => {
    const state = useLedgerStore.getState();
    return state.voidInvoice(id, reason, state.currentUser);
  });
}

export async function getBills(filters?: { status?: string }): Promise<Bill[]> {
  return simulatedCall(() => {
    const list = useLedgerStore.getState().bills;
    if (filters?.status && filters.status !== 'all') {
      return list.filter((b) => b.status === filters.status);
    }
    return list;
  });
}

export async function getBill(id: string): Promise<Bill | undefined> {
  return simulatedCall(() => useLedgerStore.getState().bills.find((b) => b.id === id));
}

export const getBillById = getBill;

export async function saveBillDraft(data: Partial<Bill>): Promise<Bill> {
  return simulatedCall(() => {
    const state = useLedgerStore.getState();
    return state.saveBillDraft(data, state.currentUser);
  });
}

export const createBill = saveBillDraft;

export async function submitBill(id: string): Promise<Bill> {
  return simulatedCall(() => {
    const state = useLedgerStore.getState();
    return state.submitBillForApproval(id, state.currentUser);
  });
}

export async function approveBill(id: string, pin = '246810'): Promise<Bill> {
  return simulatedCall(() => {
    const state = useLedgerStore.getState();
    return state.approveBill(id, state.currentUser, pin, state.companySettings);
  });
}

export async function returnBill(id: string, reason: string): Promise<Bill> {
  return simulatedCall(() => {
    const state = useLedgerStore.getState();
    return state.returnBill(id, reason, state.currentUser);
  });
}

export async function getContacts(): Promise<Contact[]> {
  return simulatedCall(() => useLedgerStore.getState().contacts);
}

export async function getContact(id: string): Promise<Contact | undefined> {
  return simulatedCall(() => useLedgerStore.getState().contacts.find((c) => c.id === id));
}

export async function saveContact(contact: Contact): Promise<Contact> {
  return simulatedCall(() => {
    const exists = useLedgerStore.getState().contacts.some((c) => c.id === contact.id);
    if (exists) useLedgerStore.getState().updateContact(contact);
    else useLedgerStore.getState().addContact(contact);
    return contact;
  });
}

export async function getSettlements(): Promise<Settlement[]> {
  return simulatedCall(() => useLedgerStore.getState().settlements);
}

export async function recordReceipt(data: Partial<Settlement>): Promise<Settlement> {
  return simulatedCall(() => {
    const state = useLedgerStore.getState();
    return state.recordReceipt(data, state.currentUser, state.companySettings);
  });
}

export const createReceipt = recordReceipt;

export async function recordPayment(data: Partial<Settlement>): Promise<Settlement> {
  return simulatedCall(() => {
    const state = useLedgerStore.getState();
    return state.recordPayment(data, state.currentUser, state.companySettings);
  });
}

export const createPayment = recordPayment;

export async function getPaymentRuns(): Promise<PaymentRun[]> {
  return simulatedCall(() => useLedgerStore.getState().paymentRuns);
}

export async function createPaymentRun(data: Partial<PaymentRun>): Promise<PaymentRun> {
  return simulatedCall(() => {
    const state = useLedgerStore.getState();
    return state.createPaymentRun(data, state.currentUser, state.companySettings);
  });
}

export async function postPaymentRun(runId: string, pin = '246810'): Promise<PaymentRun> {
  return simulatedCall(() => {
    const state = useLedgerStore.getState();
    return state.postPaymentRun(runId, state.currentUser, pin, state.companySettings);
  });
}

export async function getWhtCertificates(): Promise<WhtCertificate[]> {
  return simulatedCall(() => useLedgerStore.getState().whtCertificates);
}
