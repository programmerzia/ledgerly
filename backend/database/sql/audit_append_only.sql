-- Audit events are append-only (13 §14). The only exception is tenant purge by ledgerly_sysops
-- with app.purge_tenant set to the row's tenant (13 §18).
CREATE OR REPLACE FUNCTION purge_allowed(row_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT current_user = 'ledgerly_sysops'
     AND NULLIF(current_setting('app.purge_tenant', true), '')::uuid = row_tenant
$$;
GRANT EXECUTE ON FUNCTION purge_allowed(uuid) TO ledgerly_app, ledgerly_sysops;

CREATE OR REPLACE FUNCTION audit_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND purge_allowed(OLD.tenant_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_append_only: % on % is not allowed', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'LG010';
END
$$;

CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_append_only();
