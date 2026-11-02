/** Withholding tax certificates at the API boundary. Read only: the server issues them when a payment settles a bill that carries withholding. */
import type { components } from '../schema';
import { fromApiMoney } from './money';

export type ApiWhtCertificate = components['schemas']['WhtCertificateResource'];

export interface LiveWhtCertificate {
  id: string;
  number: string;
  /** `issued`, or `void` once the payment that withheld is reversed. */
  status: string;
  payment_id: string;
  invoice_id: string;
  contact_id: string;
  tax_code_id: string;
  /** What the tax was worked out on, base currency. */
  base_amount: number;
  wht_amount: number;
  currency: string;
  issued_on: string;
}

export function toWhtCertificate(a: ApiWhtCertificate): LiveWhtCertificate {
  return {
    id: a.id,
    number: a.number,
    status: a.status,
    payment_id: a.payment_id,
    invoice_id: a.invoice_id,
    contact_id: a.contact_id,
    tax_code_id: a.tax_code_id,
    base_amount: fromApiMoney(a.base_amount),
    wht_amount: fromApiMoney(a.wht_amount),
    currency: a.wht_amount.currency,
    issued_on: a.issued_on ?? '',
  };
}
