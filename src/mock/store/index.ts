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
  TabsSlice;

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
}));

export const useLedgerlyStore = useLedgerStore;

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
