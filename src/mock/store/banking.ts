/**
 * Banking slice: Manages bank accounts, statements, and reconciliation workspace matching.
 */

import { StateCreator } from 'zustand';
import { BankAccount, BankStatementLine } from '@/types';
import { mockBankAccounts, mockBankStatementLines } from '@/mock/data';

export interface BankingSlice {
  bankAccounts: BankAccount[];
  bankStatementLines: BankStatementLine[];

  addBankAccount: (account: BankAccount) => void;
  matchLine: (lineId: string, docId: string, docType: string, journalLineId?: string) => void;
  unmatchLine: (lineId: string) => void;
  addBankStatementLines: (lines: BankStatementLine[]) => void;
}

export const createBankingSlice: StateCreator<any, [], [], BankingSlice> = (set, get) => ({
  bankAccounts: [...mockBankAccounts],
  bankStatementLines: [...mockBankStatementLines],

  addBankAccount: (account) => {
    set((s: any) => ({
      bankAccounts: [...s.bankAccounts, account],
    }));
  },

  matchLine: (lineId, docId, docType, journalLineId) => {
    set((s: any) => ({
      bankStatementLines: s.bankStatementLines.map((l: BankStatementLine) =>
        l.id === lineId
          ? {
              ...l,
              status: 'matched',
              matched_doc_id: docId,
              matched_doc_type: docType,
              matched_journal_line_id: journalLineId || `jln-match-${Date.now()}`,
            }
          : l
      ),
    }));
  },

  unmatchLine: (lineId) => {
    set((s: any) => ({
      bankStatementLines: s.bankStatementLines.map((l: BankStatementLine) =>
        l.id === lineId
          ? {
              ...l,
              status: 'unmatched',
              matched_doc_id: undefined,
              matched_doc_type: undefined,
              matched_journal_line_id: undefined,
            }
          : l
      ),
    }));
  },

  addBankStatementLines: (lines) => {
    set((s: any) => ({
      bankStatementLines: [...lines, ...s.bankStatementLines],
    }));
  },
});
