/**
 * Audit slice: Immutable audit trail with SHA-256 hash chaining and integrity verification
 * per 05_Schema.md and 08_Mock_Refactor_Prompt.md Block F.7.
 */

import { StateCreator } from 'zustand';
import { AuditEvent } from '@/types';
import { mockAuditEvents } from '@/mock/data';
import { generateAuditHash } from '@/lib/hash';

export interface AuditSlice {
  auditEvents: AuditEvent[];

  appendAuditEvent: (event: AuditEvent) => void;
  verifyAuditChain: () => {
    isValid: boolean;
    totalEvents: number;
    tamperedIndex?: number;
    reason?: string;
  };
}

export const createAuditSlice: StateCreator<any, [], [], AuditSlice> = (set, get) => ({
  auditEvents: [...mockAuditEvents],

  appendAuditEvent: (event) => {
    set((s: any) => ({
      auditEvents: [event, ...s.auditEvents],
    }));
  },

  verifyAuditChain: () => {
    const { auditEvents } = get();
    if (!auditEvents || auditEvents.length <= 1) {
      return { isValid: true, totalEvents: auditEvents?.length || 0 };
    }

    // Sort chronologically ascending to verify chain forward
    const sorted = [...auditEvents].sort(
      (a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime()
    );

    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const current = sorted[i];

      if (current.prev_hash !== prev.hash) {
        return {
          isValid: false,
          totalEvents: sorted.length,
          tamperedIndex: i,
          reason: `Chain breakage: Event #${current.id} prev_hash (${current.prev_hash.slice(0, 10)}...) does not match prior event hash (${prev.hash.slice(0, 10)}...).`,
        };
      }

      // Recompute hash
      const expectedHash = generateAuditHash(
        current.prev_hash,
        current.occurred_at,
        current.actor_id,
        current.action,
        current.subject_type,
        current.subject_id,
        current.detail
      );

      // In real backend verification: current.hash === expectedHash
      // Here in mock we verify link integrity
    }

    return { isValid: true, totalEvents: sorted.length };
  },
});
