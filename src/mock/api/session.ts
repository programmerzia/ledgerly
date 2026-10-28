import { simulatedCall } from './client';
import { useLedgerStore } from '@/mock/store';
import { User, Company, FiscalPeriod } from '@/types';
import { mockUsers, mockCompanies } from '@/mock/data';

export async function getCurrentUser(): Promise<User> {
  return simulatedCall(() => useLedgerStore.getState().currentUser);
}

export async function getUsers(): Promise<User[]> {
  return simulatedCall(() => mockUsers);
}

export async function getCompanies(): Promise<Company[]> {
  return simulatedCall(() => mockCompanies);
}

export async function switchUser(userId: string): Promise<User> {
  return simulatedCall(() => {
    useLedgerStore.getState().switchUser(userId);
    return useLedgerStore.getState().currentUser;
  });
}

export async function switchCompany(companyId: string): Promise<Company> {
  return simulatedCall(() => {
    useLedgerStore.getState().switchCompany(companyId);
    return useLedgerStore.getState().currentCompany;
  });
}

export async function switchPeriod(periodId: string): Promise<FiscalPeriod> {
  return simulatedCall(() => {
    useLedgerStore.getState().switchPeriod(periodId);
    return useLedgerStore.getState().currentPeriod;
  });
}
