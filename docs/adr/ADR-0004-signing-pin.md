# ADR-0004 — Signing PIN for checker actions
Status: Accepted · Date: 2026-10-28

Context: approvals, postings and period reopen move money or evidence; a one-click approve
by a logged-in session is weak evidence (shared screens, left-open sessions).
Decision: a per-user 6-digit signing PIN, separate from the password, required for approve,
post, payment run, period close/reopen and audit export; signatures stored as a hash in the
approval record and chained into the audit log; 3 failures lock 15 min; signature cached
10 min for bulk work. WebAuthn (hardware key) is the planned upgrade path with the same API.
Consequences: extra step for checkers (mitigated by caching); PIN policy in tenant settings.
