-- Migration 0030: Cross-agent boundary fixes (Plan 21 post-merge sync)
-- F3: Add 'assignment' to rule_type enum
-- F4: voice_agents timestamps already exist in DB (migration 0029) — Drizzle schema alignment only
-- F5: Add forceAuthn / signedAssertions columns to sso_providers

-- NOTE: ALTER TYPE ... ADD VALUE cannot run inside a transaction block in PostgreSQL
ALTER TYPE rule_type ADD VALUE IF NOT EXISTS 'assignment';

-- F5: SAML enforcement fields for SSO providers
ALTER TABLE sso_providers ADD COLUMN IF NOT EXISTS force_authn BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE sso_providers ADD COLUMN IF NOT EXISTS signed_assertions BOOLEAN NOT NULL DEFAULT false;
