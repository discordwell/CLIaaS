-- 0016: Add new user_role enum values for RBAC
-- IMPORTANT: ALTER TYPE ADD VALUE cannot run inside a transaction block.
-- This migration MUST be run outside a transaction (e.g., drizzle-kit handles this).

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'light_agent';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'collaborator';
