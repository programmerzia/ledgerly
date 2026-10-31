#!/bin/sh
# Creates the Ledgerly database roles (13_Backend_Architecture §6) and the dev + test databases.
# Runs once, as the postgres superuser, when the data volume is first initialised.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
-- Owns tables, functions and triggers. Subject to FORCE RLS like everyone else.
CREATE ROLE ledgerly_owner LOGIN PASSWORD '${LEDGERLY_OWNER_PASSWORD}' NOSUPERUSER NOBYPASSRLS;
-- Web, worker, scheduler. DML only, never owner, never BYPASSRLS.
CREATE ROLE ledgerly_app LOGIN PASSWORD '${LEDGERLY_APP_PASSWORD}' NOSUPERUSER NOBYPASSRLS;
ALTER ROLE ledgerly_app SET statement_timeout = '30s';
-- Reporting (replica in prod). SELECT only.
CREATE ROLE ledgerly_report LOGIN PASSWORD '${LEDGERLY_REPORT_PASSWORD}' NOSUPERUSER NOBYPASSRLS;
ALTER ROLE ledgerly_report SET statement_timeout = '10min';
-- Cross-tenant system work. Cannot log in; owns SECURITY DEFINER functions only.
CREATE ROLE ledgerly_sysops NOLOGIN BYPASSRLS;
GRANT ledgerly_sysops TO ledgerly_owner;
-- Platform admin API. SELECT on allowlisted tables + EXECUTE on admin functions.
CREATE ROLE ledgerly_platform LOGIN PASSWORD '${LEDGERLY_PLATFORM_PASSWORD}' NOSUPERUSER NOBYPASSRLS;

CREATE DATABASE ledgerly OWNER ledgerly_owner;
CREATE DATABASE ledgerly_test OWNER ledgerly_owner;
SQL

for db in ledgerly ledgerly_test; do
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$db" <<SQL
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO ledgerly_owner;
GRANT USAGE ON SCHEMA public TO ledgerly_app, ledgerly_report, ledgerly_platform, ledgerly_sysops;
ALTER DEFAULT PRIVILEGES FOR ROLE ledgerly_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ledgerly_app;
ALTER DEFAULT PRIVILEGES FOR ROLE ledgerly_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO ledgerly_app;
ALTER DEFAULT PRIVILEGES FOR ROLE ledgerly_owner IN SCHEMA public
  GRANT SELECT ON TABLES TO ledgerly_report, ledgerly_sysops;
ALTER DEFAULT PRIVILEGES FOR ROLE ledgerly_owner IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
SQL
done
