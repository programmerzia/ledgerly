import { simulatedCall } from './client';
import { useLedgerStore } from '@/mock/store';
import { BankAccount, BankStatementLine } from '@/types';

export async function getBankAccounts(): Promise<BankAccount[]> {
  return simulatedCall(() => useLedgerStore.getState().bankAccounts);
}

export async function getBankStatementLines(bankAccountId?: string): Promise<BankStatementLine[]> {
  return simulatedCall(() => {
    const lines = useLedgerStore.getState().bankStatementLines;
    if (bankAccountId) return lines.filter((l) => l.bank_account_id === bankAccountId);
    return lines;
  });
}

export async function matchStatementLine(
  lineId: string,
  docId: string,
  docType: string,
  journalLineId?: string
): Promise<void> {
  return simulatedCall(() => {
    useLedgerStore.getState().matchLine(lineId, docId, docType, journalLineId);
  });
}

export const matchBankLine = matchStatementLine;

export async function unmatchStatementLine(lineId: string): Promise<void> {
  return simulatedCall(() => {
    useLedgerStore.getState().unmatchLine(lineId);
  });
}
