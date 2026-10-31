import { simulatedCall } from './client';
import { useLedgerStore } from '@/mock/store';
import { CompanySettings, PostingAccounts } from '@/types';

export async function getCompanySettings(): Promise<CompanySettings> {
  return simulatedCall(() => useLedgerStore.getState().companySettings);
}

export async function updatePostingAccounts(accounts: Partial<PostingAccounts>): Promise<PostingAccounts> {
  return simulatedCall(() => {
    useLedgerStore.getState().updatePostingAccounts(accounts);
    return useLedgerStore.getState().companySettings.posting_accounts;
  });
}

export async function updateNumbering(numbering: Partial<CompanySettings['numbering']>): Promise<CompanySettings['numbering']> {
  return simulatedCall(() => {
    useLedgerStore.getState().updateNumbering(numbering);
    return useLedgerStore.getState().companySettings.numbering;
  });
}

export async function updateApprovalWorkflows(workflows: Partial<CompanySettings['approval_workflows']>): Promise<CompanySettings['approval_workflows']> {
  return simulatedCall(() => {
    useLedgerStore.getState().updateApprovalWorkflows(workflows);
    return useLedgerStore.getState().companySettings.approval_workflows;
  });
}
