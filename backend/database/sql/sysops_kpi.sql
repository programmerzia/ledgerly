-- Practice overview (13 §7, plan 2.19). tenant_kpi_snapshots has no RLS and the app role has no privilege on it;
-- these functions are the only way in. Writers must be running inside the tenant they write for (the GUC is
-- compared with the argument); the reader is scoped by the caller's active memberships.

-- A posting, settlement or period event happened in this tenant: flag every active company's row for refresh.
-- Rows for companies without one yet are created empty (refreshed_at NULL = never computed).
CREATE OR REPLACE FUNCTION sysops.mark_kpi_dirty(p_tenant uuid)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF p_tenant IS NULL OR p_tenant IS DISTINCT FROM NULLIF(current_setting('app.tenant_id', true), '')::uuid THEN
    RAISE EXCEPTION 'tenant mismatch' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.tenant_kpi_snapshots AS k (tenant_id, company_id, company_name, base_currency, dirty_at)
  SELECT c.tenant_id, c.id, c.name, c.base_currency, now()
  FROM public.companies c
  WHERE c.tenant_id = p_tenant AND c.status = 'active'
  ON CONFLICT (tenant_id, company_id) DO UPDATE SET dirty_at = COALESCE(k.dirty_at, now());
END
$$;

-- Tenants with a row flagged before older_than, for the refresh sweep (ids only, live tenants only).
CREATE OR REPLACE FUNCTION sysops.kpi_dirty_tenants(older_than timestamptz, batch integer)
RETURNS TABLE (tenant_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT DISTINCT k.tenant_id
  FROM public.tenant_kpi_snapshots k
  JOIN public.tenants t ON t.id = k.tenant_id AND t.lifecycle IN ('trial', 'active', 'past_due')
  WHERE k.dirty_at IS NOT NULL AND k.dirty_at <= older_than
  ORDER BY k.tenant_id
  LIMIT LEAST(GREATEST(batch, 1), 1000)
$$;

-- Replaces the tenant's rows with freshly computed ones. A row flagged again after p_started stays flagged,
-- so an event during the computation triggers another refresh.
CREATE OR REPLACE FUNCTION sysops.store_kpi_snapshots(p_tenant uuid, p_started timestamptz, p_rows jsonb)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF p_tenant IS NULL OR p_tenant IS DISTINCT FROM NULLIF(current_setting('app.tenant_id', true), '')::uuid THEN
    RAISE EXCEPTION 'tenant mismatch' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.tenant_kpi_snapshots k
  WHERE k.tenant_id = p_tenant
    AND k.company_id NOT IN (SELECT (e ->> 'company_id')::uuid FROM jsonb_array_elements(p_rows) e);

  INSERT INTO public.tenant_kpi_snapshots AS k
    (tenant_id, company_id, company_name, base_currency, open_ar, open_ap, pending_approvals, last_closed_period, period_states, dirty_at, refreshed_at)
  SELECT p_tenant, r.company_id, r.company_name, r.base_currency, r.open_ar, r.open_ap, r.pending_approvals, r.last_closed_period, r.period_states, NULL, clock_timestamp()
  FROM jsonb_to_recordset(p_rows) AS r(company_id uuid, company_name text, base_currency text, open_ar bigint, open_ap bigint,
                                      pending_approvals integer, last_closed_period date, period_states jsonb)
  ON CONFLICT (tenant_id, company_id) DO UPDATE SET
    company_name = EXCLUDED.company_name, base_currency = EXCLUDED.base_currency, open_ar = EXCLUDED.open_ar,
    open_ap = EXCLUDED.open_ap, pending_approvals = EXCLUDED.pending_approvals,
    last_closed_period = EXCLUDED.last_closed_period, period_states = EXCLUDED.period_states,
    refreshed_at = EXCLUDED.refreshed_at,
    dirty_at = CASE WHEN k.dirty_at > p_started THEN k.dirty_at ELSE NULL END;
END
$$;

-- The caller's practice: live tenants where the user has an ACTIVE membership, with each snapshot row of the tenant
-- (a tenant with none yet still appears, with NULL company columns). Company-level access is applied by the app.
CREATE OR REPLACE FUNCTION sysops.practice_overview(p_user uuid)
RETURNS TABLE (tenant_id uuid, tenant_name text, tenant_slug text, tenant_lifecycle text, org_role text,
               company_id uuid, company_name text, base_currency text, open_ar bigint, open_ap bigint,
               pending_approvals integer, last_closed_period date, period_states jsonb, refreshed_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT t.id, t.name::text, t.slug::text, t.lifecycle::text, tu.role::text,
         k.company_id, k.company_name::text, k.base_currency::text, k.open_ar, k.open_ap,
         k.pending_approvals, k.last_closed_period, k.period_states, k.refreshed_at
  FROM public.tenant_users tu
  JOIN public.tenants t ON t.id = tu.tenant_id
  LEFT JOIN public.tenant_kpi_snapshots k ON k.tenant_id = tu.tenant_id
  WHERE tu.user_id = p_user
    AND tu.status = 'active'
    AND t.lifecycle NOT IN ('cancelled', 'deleted')
  ORDER BY t.name, t.id, k.company_name, k.company_id
$$;

REVOKE ALL ON FUNCTION sysops.mark_kpi_dirty(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION sysops.kpi_dirty_tenants(timestamptz, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION sysops.store_kpi_snapshots(uuid, timestamptz, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION sysops.practice_overview(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sysops.mark_kpi_dirty(uuid) TO ledgerly_app;
GRANT EXECUTE ON FUNCTION sysops.kpi_dirty_tenants(timestamptz, integer) TO ledgerly_app;
GRANT EXECUTE ON FUNCTION sysops.store_kpi_snapshots(uuid, timestamptz, jsonb) TO ledgerly_app;
GRANT EXECUTE ON FUNCTION sysops.practice_overview(uuid) TO ledgerly_app;
