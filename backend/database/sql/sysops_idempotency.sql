-- Hourly purge of idempotency keys older than 24 h (13 §11). Runs as ledgerly_sysops; returns
-- the number of rows removed so the scheduler can log it.
CREATE OR REPLACE FUNCTION sysops.purge_idempotency_keys()
RETURNS bigint
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  WITH gone AS (
    DELETE FROM public.idempotency_keys WHERE created_at < now() - interval '24 hours' RETURNING 1
  )
  SELECT count(*) FROM gone
$$;

REVOKE ALL ON FUNCTION sysops.purge_idempotency_keys() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sysops.purge_idempotency_keys() TO ledgerly_app;
