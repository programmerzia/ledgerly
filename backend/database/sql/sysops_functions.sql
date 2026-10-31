-- Narrow cross-tenant functions (13 §6). Created as ledgerly_sysops (BYPASSRLS, cannot log in) in
-- the sysops schema, so they run with its rights. Each has a fixed search_path, takes explicit
-- arguments, returns only the columns its caller needs, and is executable by ledgerly_app only.
-- purge_idempotency_keys() lives in sysops_idempotency.sql, created with its table.

-- Tenants a scheduled per-tenant job should run for, in id order, keyset-paginated: pass the last
-- id of the previous page as after_id. Only live tenants; job-specific filters are added here as
-- those jobs land (13 §15), so a job never loops over every tenant itself.
CREATE OR REPLACE FUNCTION sysops.tenants_due_for(job text, after_id uuid DEFAULT NULL, batch integer DEFAULT 500)
RETURNS TABLE (tenant_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT t.id
  FROM public.tenants t
  WHERE t.lifecycle IN ('trial', 'active', 'past_due')
    AND (after_id IS NULL OR t.id > after_id)
    AND job IS NOT NULL
  ORDER BY t.id
  LIMIT LEAST(GREATEST(batch, 1), 1000)
$$;

-- Outbox sweep (13 §15): claims undispatched messages that nobody claimed in the last 60 s,
-- oldest first, skipping rows another relay holds. Returns ids and tenants only; the relay reads
-- each message under its tenant context. After 20 attempts a message is left for operators
-- (visible as dispatched_at IS NULL AND attempts >= 20) instead of being retried forever.
CREATE OR REPLACE FUNCTION sysops.claim_outbox_batch(batch integer)
RETURNS TABLE (message_id uuid, tenant_id uuid)
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  WITH picked AS (
    SELECT m.id
    FROM public.outbox_messages m
    WHERE m.dispatched_at IS NULL
      AND m.attempts < 20
      AND (m.claimed_at IS NULL OR m.claimed_at < now() - interval '60 seconds')
    ORDER BY m.occurred_at, m.id
    LIMIT LEAST(GREATEST(batch, 1), 1000)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.outbox_messages m
  SET claimed_at = now(), attempts = m.attempts + 1
  FROM picked
  WHERE m.id = picked.id
  RETURNING m.id, m.tenant_id
$$;

-- Invitation acceptance happens before any tenant is known: the raw token's SHA-256 finds the
-- invitation's id and tenant, and the app reads the row itself under that tenant's context.
CREATE OR REPLACE FUNCTION sysops.invitation_by_token_hash(hash text)
RETURNS TABLE (invitation_id uuid, tenant_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT i.id, i.tenant_id
  FROM public.invitations i
  WHERE i.token_hash = hash
$$;

REVOKE ALL ON FUNCTION sysops.tenants_due_for(text, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION sysops.claim_outbox_batch(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION sysops.invitation_by_token_hash(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sysops.tenants_due_for(text, uuid, integer) TO ledgerly_app;
GRANT EXECUTE ON FUNCTION sysops.claim_outbox_batch(integer) TO ledgerly_app;
GRANT EXECUTE ON FUNCTION sysops.invitation_by_token_hash(text) TO ledgerly_app;
