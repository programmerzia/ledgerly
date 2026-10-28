# ADR-0002 — Single database, tenant_id + PostgreSQL Row-Level Security
Status: Accepted · Date: 2026-10-27

Alternatives: database-per-tenant (stancl/tenancy), schema-per-tenant.
Decision: one database; every tenant table carries `tenant_id`; RLS policies enforced for a
non-owner app role; `SET LOCAL app.tenant_id` per request.
Consequences: cheap tenants, simple migrations, cross-tenant reporting for the platform;
isolation enforced by the DB not only the app; must audit every new table for RLS (migration
macro + invariant test).
