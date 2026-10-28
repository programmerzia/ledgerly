# ADR-0001 — Integrated Inertia monolith instead of a separate SPA
Status: Accepted · Date: 2026-10-27

Context: form/table-heavy finance UI; one team; need REST API as well.
Decision: Laravel 12 + Inertia 2 + React/TS in one deployable; `/api/v1` shares Actions.
Consequences: single auth/permission layer, no duplicated DTOs (types generated from PHP);
revisit if a native mobile app or externally-built UI is required.
