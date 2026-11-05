-- Online invoice links (plan 3c.7b): a customer opens a link with no account, so no tenant is known yet. The raw token's SHA-256
-- finds the link's id and tenant, and nothing else; the app then reads the link and the invoice itself under that tenant's context,
-- with row-level security on. Like the invitation lookup this is the only cross-tenant read the public page has: it takes one hash,
-- returns at most one row (token_hash is unique), and exposes ids only.
CREATE OR REPLACE FUNCTION sysops.invoice_link_by_token_hash(hash text)
RETURNS TABLE (link_id uuid, tenant_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT l.id, l.tenant_id
  FROM public.invoice_share_links l
  WHERE l.token_hash = hash
$$;

REVOKE ALL ON FUNCTION sysops.invoice_link_by_token_hash(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sysops.invoice_link_by_token_hash(text) TO ledgerly_app;
