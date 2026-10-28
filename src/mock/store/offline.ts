/**
 * Offline & Outbox slice: Queues local writes into an IndexedDB outbox, handles
 * reconnect replay, and simulates 409 multi-user edit conflicts per Block E.
 */

import { StateCreator } from 'zustand';
import { OutboxOp } from '@/types';
import { db } from '@/mock/db';

export interface OfflineSlice {
  outbox: OutboxOp[];
  isSyncing: boolean;

  queueOp: (type: string, entityId: string, payload: any) => Promise<OutboxOp>;
  replayOutbox: () => Promise<{ processed: number; conflicts: number }>;
  clearOutbox: () => void;
}

export const createOfflineSlice: StateCreator<any, [], [], OfflineSlice> = (set, get) => ({
  outbox: [],
  isSyncing: false,

  queueOp: async (type, entityId, payload) => {
    const op: OutboxOp = {
      id: `op-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type,
      entityId,
      payload,
      createdAt: new Date().toISOString(),
      status: 'queued',
    };

    try {
      await db.outbox.add(op);
    } catch (e) {
      // Non-blocking in headless/test environments
    }

    set((s: any) => ({
      outbox: [...s.outbox, op],
    }));

    return op;
  },

  replayOutbox: async () => {
    const state = get();
    if (state.outbox.length === 0) return { processed: 0, conflicts: 0 };

    set({ isSyncing: true });

    let processed = 0;
    let conflicts = 0;

    for (const op of state.outbox) {
      // 1-in-10 simulated conflict on invoice drafts
      if (op.type === 'invoice.save' && Math.random() < 0.1) {
        conflicts++;
        state.setPendingConflict({
          documentId: op.entityId,
          serverVersion: { ...op.payload, memo: 'Updated by Fatima Hassan on Web 2 minutes ago' },
          localVersion: op.payload,
        });
        break; // Pause replay until conflict is resolved
      }

      processed++;
    }

    const remaining = state.outbox.slice(processed);
    set({ outbox: remaining, isSyncing: false });

    return { processed, conflicts };
  },

  clearOutbox: () => {
    set({ outbox: [] });
  },
});
