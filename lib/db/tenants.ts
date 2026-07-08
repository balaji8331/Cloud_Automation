/**
 * Tenant DB helpers — wraps Prisma calls for tenants + cloud credentials.
 *
 * PUBLIC API UNCHANGED: getTenantCredentials() still returns the same
 * { azureTenantId, clientId, clientSecret, subscriptions[] } shape so
 * no callers in jobs/ or app/api/ need to change.
 */
import prisma from "./index";
import { encrypt, decrypt, encryptJson, decryptJson } from "@/lib/crypto";
import type { Tenant, Subscription, TenantStatus } from "@prisma/client";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TenantCreateInput {
  name: string;
  azureTenantId: string;
  clientId: string;
  clientSecret: string; // plaintext — encrypted before storage
  subscriptionIds: string[];
}

export interface TenantUpdateInput {
  name?: string;
  clientId?: string;
  clientSecret?: string; // plaintext optional — only update if provided
  subscriptionIds?: string[];
}

export interface TenantWithSubs extends Tenant {
  subscriptions: Subscription[];
}

/** Shape stored inside CloudCredential.credentialData for AZURE provider */
interface AzureCredentialData {
  azureTenantId: string;
  clientId: string;
  clientSecretEnc: string; // AES-256 encrypted plaintext secret
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function getAllTenants(): Promise<TenantWithSubs[]> {
  return prisma.tenant.findMany({
    include: { subscriptions: true, cloudCredential: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function getTenantById(id: string): Promise<TenantWithSubs | null> {
  return prisma.tenant.findUnique({
    where: { id },
    include: { subscriptions: true, cloudCredential: true },
  });
}

/** Returns tenant with decrypted secret — only call in server-side ingestion code */
export async function getTenantCredentials(id: string): Promise<{
  azureTenantId: string;
  clientId: string;
  clientSecret: string;
  subscriptions: Subscription[];
  provider: "AZURE" | "AWS" | "GCP";
  credentialData: string;
} | null> {
  const tenant = await prisma.tenant.findUnique({
    where: { id },
    include: {
      subscriptions: { where: { isActive: true } },
      cloudCredential: true,
    },
  });
  if (!tenant || !tenant.cloudCredential) return null;

  const creds = decryptJson<AzureCredentialData>(
    tenant.cloudCredential.credentialData
  );

  return {
    azureTenantId: creds.azureTenantId,
    clientId: creds.clientId,
    clientSecret: decrypt(creds.clientSecretEnc),
    subscriptions: tenant.subscriptions,
    provider: tenant.provider,
    credentialData: tenant.cloudCredential.credentialData,
  };
}

// ─── Create ───────────────────────────────────────────────────────────────────

export async function createTenant(input: TenantCreateInput): Promise<TenantWithSubs> {
  const credentialData = encryptJson<AzureCredentialData>({
    azureTenantId: input.azureTenantId,
    clientId: input.clientId,
    clientSecretEnc: encrypt(input.clientSecret),
  });

  return prisma.tenant.create({
    data: {
      name: input.name,
      provider: "AZURE",
      status: "PENDING",
      cloudCredential: {
        create: {
          provider: "AZURE",
          credentialData,
        },
      },
      subscriptions: {
        create: input.subscriptionIds.map((subId) => ({
          subscriptionId: subId,
        })),
      },
    },
    include: { subscriptions: true },
  });
}

// ─── Update ───────────────────────────────────────────────────────────────────

export async function updateTenant(
  id: string,
  input: TenantUpdateInput
): Promise<TenantWithSubs> {
  const tenantData: Record<string, unknown> = {};
  if (input.name) tenantData.name = input.name;

  // Run in a transaction so all changes are atomic
  return prisma.$transaction(async (tx) => {
    // Update tenant name if provided
    if (Object.keys(tenantData).length > 0) {
      await tx.tenant.update({ where: { id }, data: tenantData });
    }

    // Update credential fields if provided
    if (input.clientId || input.clientSecret) {
      const existing = await tx.cloudCredential.findUnique({
        where: { tenantId: id },
      });

      if (existing) {
        const currentCreds = decryptJson<AzureCredentialData>(
          existing.credentialData
        );
        const updatedCreds: AzureCredentialData = {
          azureTenantId: currentCreds.azureTenantId,
          clientId: input.clientId ?? currentCreds.clientId,
          clientSecretEnc: input.clientSecret
            ? encrypt(input.clientSecret)
            : currentCreds.clientSecretEnc,
        };
        await tx.cloudCredential.update({
          where: { tenantId: id },
          data: { credentialData: encryptJson(updatedCreds) },
        });
      }
    }

    // Manage subscriptions
    if (input.subscriptionIds !== undefined) {
      await tx.subscription.updateMany({
        where: { tenantId: id, subscriptionId: { notIn: input.subscriptionIds } },
        data: { isActive: false },
      });

      for (const subId of input.subscriptionIds) {
        await tx.subscription.upsert({
          where: { tenantId_subscriptionId: { tenantId: id, subscriptionId: subId } },
          create: { tenantId: id, subscriptionId: subId, isActive: true },
          update: { isActive: true },
        });
      }
    }

    return tx.tenant.findUniqueOrThrow({
      where: { id },
      include: { subscriptions: true },
    });
  });
}

// ─── Status ───────────────────────────────────────────────────────────────────

export async function setTenantStatus(
  id: string,
  status: TenantStatus,
  errorMessage?: string
): Promise<void> {
  await prisma.tenant.update({
    where: { id },
    data: {
      status,
      errorMessage: status === "ERROR" ? errorMessage : null,
      lastSyncAt: status === "CONNECTED" ? new Date() : undefined,
    },
  });
}

// ─── Delete ───────────────────────────────────────────────────────────────────

export async function deleteTenant(id: string): Promise<void> {
  await prisma.tenant.delete({ where: { id } });
}
