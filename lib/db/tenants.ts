/**
 * Tenant DB helpers — wraps Prisma calls for tenants + subscriptions.
 */
import prisma from "./index";
import { encrypt, decrypt } from "@/lib/crypto";
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

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function getAllTenants(): Promise<TenantWithSubs[]> {
  return prisma.tenant.findMany({
    include: { subscriptions: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function getTenantById(id: string): Promise<TenantWithSubs | null> {
  return prisma.tenant.findUnique({
    where: { id },
    include: { subscriptions: true },
  });
}

/** Returns tenant with decrypted secret — only call in server-side ingestion code */
export async function getTenantCredentials(id: string): Promise<{
  azureTenantId: string;
  clientId: string;
  clientSecret: string;
  subscriptions: Subscription[];
} | null> {
  const tenant = await prisma.tenant.findUnique({
    where: { id },
    include: { subscriptions: { where: { isActive: true } } },
  });
  if (!tenant) return null;
  return {
    azureTenantId: tenant.azureTenantId,
    clientId: tenant.clientId,
    clientSecret: decrypt(tenant.clientSecretEnc),
    subscriptions: tenant.subscriptions,
  };
}

// ─── Create ───────────────────────────────────────────────────────────────────

export async function createTenant(input: TenantCreateInput): Promise<TenantWithSubs> {
  const clientSecretEnc = encrypt(input.clientSecret);

  return prisma.tenant.create({
    data: {
      name: input.name,
      azureTenantId: input.azureTenantId,
      clientId: input.clientId,
      clientSecretEnc,
      status: "PENDING",
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
  const data: Record<string, unknown> = {};
  if (input.name) data.name = input.name;
  if (input.clientId) data.clientId = input.clientId;
  if (input.clientSecret) data.clientSecretEnc = encrypt(input.clientSecret);

  // Run in a transaction so subscription changes are atomic
  return prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.update({
      where: { id },
      data,
    });

    if (input.subscriptionIds !== undefined) {
      // Remove subs not in new list
      await tx.subscription.updateMany({
        where: { tenantId: id, subscriptionId: { notIn: input.subscriptionIds } },
        data: { isActive: false },
      });

      // Upsert subs in new list
      for (const subId of input.subscriptionIds) {
        await tx.subscription.upsert({
          where: { tenantId_subscriptionId: { tenantId: id, subscriptionId: subId } },
          create: { tenantId: id, subscriptionId: subId, isActive: true },
          update: { isActive: true },
        });
      }
    }

    return tx.tenant.findUniqueOrThrow({
      where: { id: tenant.id },
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
