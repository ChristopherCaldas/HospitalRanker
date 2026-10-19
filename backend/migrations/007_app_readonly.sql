-- Read-only access for the public site's database role.
--
-- The role itself is created once, outside migrations, so its password never
-- lands in git (see `npm run create-readonly-role`). Roles created through
-- the Neon console/CLI join neon_superuser, so it must be created in SQL.
-- These grants are idempotent and skipped if the role doesn't exist yet
-- (e.g. a fresh local or test database).
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT USAGE ON SCHEMA public TO app_readonly;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_readonly;
    -- Tables and views created by later migrations (run as the owner).
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO app_readonly;
    ALTER ROLE app_readonly SET default_transaction_read_only = on;
  END IF;
END
$$;
