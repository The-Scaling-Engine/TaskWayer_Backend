-- Migration: Supabase Auth integration
-- Removes password fields (now managed by Supabase Auth)
-- Adds supabaseId to link profiles to Supabase Auth users

-- Drop password reset index before dropping column
DROP INDEX IF EXISTS "profiles_passwordResetToken_idx";

-- Drop auth columns managed by Supabase going forward
ALTER TABLE "profiles" DROP COLUMN IF EXISTS "passwordHash";
ALTER TABLE "profiles" DROP COLUMN IF EXISTS "passwordResetToken";
ALTER TABLE "profiles" DROP COLUMN IF EXISTS "passwordResetExpires";

-- Add Supabase Auth user UUID link
ALTER TABLE "profiles" ADD COLUMN "supabaseId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "profiles_supabaseId_key" ON "profiles"("supabaseId");
