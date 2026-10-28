import { simulatedCall } from './client';
import { useLedgerStore } from '@/mock/store';
import { AuditEvent } from '@/types';

export async function getAuditEvents(): Promise<AuditEvent[]> {
  return simulatedCall(() => useLedgerStore.getState().auditEvents);
}

export async function verifyAuditChain() {
  return simulatedCall(() => useLedgerStore.getState().verifyAuditChain());
}
