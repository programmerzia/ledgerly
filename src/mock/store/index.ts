/**
 * Master Zustand store combining all domain slices into a cohesive,
 * controls-grade ledger application store per 08_Mock_Refactor_Prompt.md Block A.
 */

import { create } from 'zustand';
import { SessionSlice, createSessionSlice } from './session';
import { LedgerSlice, createLedgerSlice } from './ledger';
import { DocumentsSlice, createDocumentsSlice } from './documents';
import { BankingSlice, createBankingSlice } from './banking';
import { FxSlice, createFxSlice } from './fx';
import { AssetsSlice, createAssetsSlice } from './assets';
import { BudgetsSlice, createBudgetsSlice } from './budgets';
import { SettingsSlice, createSettingsSlice } from './settings';
import { AuditSlice, createAuditSlice } from './audit';
import { OfflineSlice, createOfflineSlice } from './offline';
import { TabsSlice, createTabsSlice } from './tabs';
import { AutomationSlice, createAutomationSlice } from './automation';

export type RootStore = SessionSlice &
  LedgerSlice &
  DocumentsSlice &
  BankingSlice &
  FxSlice &
  AssetsSlice &
  BudgetsSlice &
  SettingsSlice &
  AuditSlice &
  OfflineSlice &
  TabsSlice &
  AutomationSlice;

export const useLedgerStore = create<RootStore>()((...a) => ({
  ...createSessionSlice(...a),
  ...createLedgerSlice(...a),
  ...createDocumentsSlice(...a),
  ...createBankingSlice(...a),
  ...createFxSlice(...a),
  ...createAssetsSlice(...a),
  ...createBudgetsSlice(...a),
  ...createSettingsSlice(...a),
  ...createAuditSlice(...a),
  ...createOfflineSlice(...a),
  ...createTabsSlice(...a),
  ...createAutomationSlice(...a),
}));

export const useLedgerlyStore = useLedgerStore;

import { db } from '@/mock/db';
import { SEED_VERSION } from '@/mock/seedLedger';

export async function initDexiePersistence() {
  if (typeof window === 'undefined') return;
  try {
    // Drop data persisted from an older seed so everyone sees the current demo ledger.
    const seed = await db.session.get('seedVersion');
    if (seed?.value !== SEED_VERSION) {
      await Promise.all([
        db.invoices.clear(),
        db.bills.clear(),
        db.journals.clear(),
        db.auditEvents.clear(),
        db.outbox.clear(),
      ]);
      await db.session.put({ key: 'seedVersion', value: SEED_VERSION });
    }
    const invCount = await db.invoices.count();
    if (invCount > 0) {
      const [invoices, bills, journals, auditEvents, outbox] = await Promise.all([
        db.invoices.toArray(),
        db.bills.toArray(),
        db.journals.toArray(),
        db.auditEvents.toArray(),
        db.outbox.toArray(),
      ]);
      useLedgerStore.setState({
        ...(invoices.length > 0 ? { invoices } : {}),
        ...(bills.length > 0 ? { bills } : {}),
        ...(journals.length > 0 ? { journals } : {}),
        ...(auditEvents.length > 0 ? { auditEvents } : {}),
        ...(outbox.length > 0 ? { outbox } : {}),
      });
    } else {
      const state = useLedgerStore.getState();
      await Promise.all([
        db.invoices.bulkPut(state.invoices),
        db.bills.bulkPut(state.bills),
        db.journals.bulkPut(state.journals),
        db.auditEvents.bulkPut(state.auditEvents),
      ]);
    }
  } catch (err) {
    // Non-blocking in headless / memory environments
  }

  useLedgerStore.subscribe((state, prevState) => {
    try {
      if (state.invoices !== prevState.invoices) {
        db.invoices.clear().then(() => db.invoices.bulkPut(state.invoices)).catch(() => {});
      }
      if (state.bills !== prevState.bills) {
        db.bills.clear().then(() => db.bills.bulkPut(state.bills)).catch(() => {});
      }
      if (state.journals !== prevState.journals) {
        db.journals.clear().then(() => db.journals.bulkPut(state.journals)).catch(() => {});
      }
      if (state.auditEvents !== prevState.auditEvents) {
        db.auditEvents.clear().then(() => db.auditEvents.bulkPut(state.auditEvents)).catch(() => {});
      }
      if (state.outbox !== prevState.outbox) {
        db.outbox.clear().then(() => db.outbox.bulkPut(state.outbox)).catch(() => {});
      }
    } catch (e) {
      // Non-blocking
    }
  });
}

export * from './session';
export * from './ledger';
export * from './documents';
export * from './banking';
export * from './fx';
export * from './assets';
export * from './budgets';
export * from './settings';
export * from './audit';
export * from './offline';
export * from './tabs';
export type { DocumentTab, UIRowDensity } from '@/types';
