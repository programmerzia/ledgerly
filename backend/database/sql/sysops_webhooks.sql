-- Webhook retry sweep (13 §15): deliveries whose retry time has come, across tenants, so the
-- scheduler can queue one tenant-aware job per delivery. Returns ids and tenants only; the job
-- claims the row itself under its tenant context. `as_of` comes from the app clock.
CREATE OR REPLACE FUNCTION sysops.webhook_deliveries_due(as_of timestamptz, batch integer)
RETURNS TABLE (delivery_id uuid, tenant_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT d.id, d.tenant_id
  FROM public.webhook_deliveries d
  JOIN public.webhook_endpoints e ON e.tenant_id = d.tenant_id AND e.id = d.endpoint_id AND e.is_active
  WHERE d.status = 'pending'
    AND d.next_retry_at <= as_of
  ORDER BY d.next_retry_at, d.id
  LIMIT LEAST(GREATEST(batch, 1), 1000)
$$;

REVOKE ALL ON FUNCTION sysops.webhook_deliveries_due(timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sysops.webhook_deliveries_due(timestamptz, integer) TO ledgerly_app;
