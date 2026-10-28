# ADR-0005 — Offline-first, scoped to drafts and reads
Status: Accepted · Date: 2026-10-28

Context: users in low-connectivity regions; but gapless numbering, period locks and
maker-checker cannot be decided on a disconnected client.
Decision: installable PWA; IndexedDB cache plus outbox of client-generated ops with UUID
idempotency; offline allows drafts, allocations, bank matching and cached reports. Server
actions (post, approve, close/reopen, payment run) queue as `queued` and are applied in order
on reconnect; numbers are assigned server-side only. Conflicts surface via the 409 dialog.
Consequences: a `client_ops` table and replay endpoint; UI must show queued state honestly.
