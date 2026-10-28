/**
 * Dexie IndexedDB database configuration for Ledgerly offline-first persistence.
 * Conforms to ADR-0005 and 08_Mock_Refactor_Prompt.md Block E.
 */

import Dexie, { type Table } from 'dexie';
import {
  Invoice,
  Bill,
  Journal,
  Settlement,
  Contact,
  Account,
  AuditEvent,
  OutboxOp,
  FiscalPeriod,
  FixedAsset,
  ExchangeRate,
} from '@/types';

export class LedgerlyDatabase extends Dexie {
  invoices!: Table<Invoice, string>;
  bills!: Table<Bill, string>;
  journals!: Table<Journal, string>;
  settlements!: Table<Settlement, string>;
  contacts!: Table<Contact, string>;
  accounts!: Table<Account, string>;
  auditEvents!: Table<AuditEvent, string>;
  outbox!: Table<OutboxOp, string>;
  periods!: Table<FiscalPeriod, string>;
  assets!: Table<FixedAsset, string>;
  fxRates!: Table<ExchangeRate, string>;

  constructor() {
    super('LedgerlyLocalDB');
    this.version(1).stores({
      invoices: 'id, company_id, number, status, contact_id, issue_date',
      bills: 'id, company_id, number, status, contact_id, issue_date',
      journals: 'id, company_id, number, status, fiscal_period_id, journal_date',
      settlements: 'id, company_id, number, status, contact_id, settlement_date',
      contacts: 'id, company_id, kind, code, name',
      accounts: 'id, company_id, code, account_type',
      auditEvents: 'id, occurred_at, action, subject_id, hash',
      outbox: 'id, type, entityId, status, createdAt',
      periods: 'id, company_id, status',
      assets: 'id, company_id, number, status',
      fxRates: 'id, company_id, from_currency, to_currency, rate_date',
    });
  }
}

export const db = new LedgerlyDatabase();
