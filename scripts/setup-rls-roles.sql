-- Create application role for RLS-compatible connections.
-- This role does NOT bypass RLS (critical for policy enforcement).
-- Run this on the production database before enabling RLS.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'cliaas_app') THEN
    CREATE ROLE cliaas_app LOGIN;
  END IF;
END
$$;

-- Grant necessary privileges (no BYPASSRLS)
GRANT USAGE ON SCHEMA public TO cliaas_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO cliaas_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO cliaas_app;

-- Ensure future tables also get grants
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cliaas_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO cliaas_app;

-- IMPORTANT: Set the password for cliaas_app in production:
-- ALTER ROLE cliaas_app WITH PASSWORD 'your-secure-password';
