-- Step 1: Cloud-agnostic schema refactor
-- Adds CloudProvider enum, creates cloud_credentials table, migrates
-- Azure credential data out of tenants, then drops the old columns.
-- All steps run in an implicit transaction (PostgreSQL DDL is transactional).

-- ── 1a. Add CloudProvider enum ─────────────────────────────────────────────
CREATE TYPE "CloudProvider" AS ENUM ('AZURE', 'AWS', 'GCP');

-- ── 1b. Create cloud_credentials table (before data migration) ─────────────
CREATE TABLE "cloud_credentials" (
    "id"             TEXT NOT NULL,
    "tenantId"       TEXT NOT NULL,
    "provider"       "CloudProvider" NOT NULL,
    "credentialData" TEXT NOT NULL,  -- AES-256-CBC encrypted JSON blob
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cloud_credentials_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cloud_credentials_tenantId_key"
    ON "cloud_credentials"("tenantId");

ALTER TABLE "cloud_credentials"
    ADD CONSTRAINT "cloud_credentials_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 1c. DATA MIGRATION — copy credentials from tenants → cloud_credentials ─
-- Each existing tenant row produces one AZURE cloud_credentials row.
-- The credentialData JSON bundles the three Azure-specific fields.
-- NOTE: clientSecretEnc is already AES-256-CBC encrypted in the DB;
--       we carry it over as-is inside the JSON blob.
INSERT INTO "cloud_credentials" ("id", "tenantId", "provider", "credentialData", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::text,
    t."id",
    'AZURE'::"CloudProvider",
    json_build_object(
        'azureTenantId',   t."azureTenantId",
        'clientId',        t."clientId",
        'clientSecretEnc', t."clientSecretEnc"
    )::text,
    NOW(),
    NOW()
FROM "tenants" t;

-- ── 1d. Add provider column to tenants (default AZURE for all existing rows) ─
ALTER TABLE "tenants"
    ADD COLUMN "provider" "CloudProvider" NOT NULL DEFAULT 'AZURE';

-- ── 1e. Drop the now-migrated Azure-specific columns from tenants ──────────
-- Safe to drop because all data has been copied to cloud_credentials above.
DROP INDEX "tenants_azureTenantId_key";

ALTER TABLE "tenants"
    DROP COLUMN "azureTenantId",
    DROP COLUMN "clientId",
    DROP COLUMN "clientSecretEnc";
