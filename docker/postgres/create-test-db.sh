#!/bin/sh
# Creates an extra test database set up like ledgerly_test, so parallel work never shares one:
#   docker/postgres/create-test-db.sh ledgerly_test_a
#   DB_DATABASE=ledgerly_test_a php vendor/bin/pest
set -eu
name="$1"
case "$name" in ledgerly_test_*) ;; *) echo "The name must start with ledgerly_test_" >&2; exit 1 ;; esac
psql() { docker compose -f docker/compose.yaml exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres "$@"; }
psql -d postgres -tc "SELECT 1 FROM pg_database WHERE datname = '$name'" | grep -q 1 && { echo "$name exists"; exit 0; }
psql -d postgres -c "CREATE DATABASE $name OWNER ledgerly_owner" >/dev/null
psql -d "$name" >/dev/null <<SQL
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO ledgerly_owner;
GRANT USAGE ON SCHEMA public TO ledgerly_app, ledgerly_report, ledgerly_platform, ledgerly_sysops;
ALTER DEFAULT PRIVILEGES FOR ROLE ledgerly_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ledgerly_app;
ALTER DEFAULT PRIVILEGES FOR ROLE ledgerly_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ledgerly_app;
ALTER DEFAULT PRIVILEGES FOR ROLE ledgerly_owner IN SCHEMA public GRANT SELECT ON TABLES TO ledgerly_report, ledgerly_sysops;
ALTER DEFAULT PRIVILEGES FOR ROLE ledgerly_owner IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
SQL
echo "$name created"
