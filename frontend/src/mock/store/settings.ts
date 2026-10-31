/**
 * Settings slice: Company profile, posting accounts mapping, numbering rules,
 * and approval thresholds per 08_Mock_Refactor_Prompt.md Block F.6.
 */

import { StateCreator } from 'zustand';
import { CompanySettings, PostingAccounts } from '@/types';
import { mockCompanySettings } from '@/mock/data';

export interface SettingsSlice {
  companySettings: CompanySettings;

  updatePostingAccounts: (accounts: Partial<PostingAccounts>) => void;
  updateNumbering: (numbering: Partial<CompanySettings['numbering']>) => void;
  updateApprovalWorkflows: (workflows: Partial<CompanySettings['approval_workflows']>) => void;
}

export const createSettingsSlice: StateCreator<any, [], [], SettingsSlice> = (set, get) => ({
  companySettings: { ...mockCompanySettings },

  updatePostingAccounts: (accounts) => {
    set((s: any) => ({
      companySettings: {
        ...s.companySettings,
        posting_accounts: { ...s.companySettings.posting_accounts, ...accounts },
      },
    }));
  },

  updateNumbering: (numbering) => {
    set((s: any) => ({
      companySettings: {
        ...s.companySettings,
        numbering: { ...s.companySettings.numbering, ...numbering },
      },
    }));
  },

  updateApprovalWorkflows: (workflows) => {
    set((s: any) => ({
      companySettings: {
        ...s.companySettings,
        approval_workflows: { ...s.companySettings.approval_workflows, ...workflows },
      },
    }));
  },
});
