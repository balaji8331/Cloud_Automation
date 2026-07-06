-- CreateTable
CREATE TABLE "resource_groups" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "tags" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resource_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resources" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "resourceGroupId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "location" TEXT,
    "sku" JSONB,
    "provisioningState" TEXT,
    "tags" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "resource_groups_tenantId_idx" ON "resource_groups"("tenantId");

-- CreateIndex
CREATE INDEX "resource_groups_subscriptionId_idx" ON "resource_groups"("subscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "resource_groups_tenantId_subscriptionId_name_key" ON "resource_groups"("tenantId", "subscriptionId", "name");

-- CreateIndex
CREATE INDEX "resources_tenantId_subscriptionId_idx" ON "resources"("tenantId", "subscriptionId");

-- CreateIndex
CREATE INDEX "resources_tenantId_type_idx" ON "resources"("tenantId", "type");

-- CreateIndex
CREATE INDEX "resources_resourceGroupId_idx" ON "resources"("resourceGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "resources_tenantId_resourceId_key" ON "resources"("tenantId", "resourceId");

-- AddForeignKey
ALTER TABLE "resource_groups" ADD CONSTRAINT "resource_groups_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_groups" ADD CONSTRAINT "resource_groups_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resources" ADD CONSTRAINT "resources_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resources" ADD CONSTRAINT "resources_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resources" ADD CONSTRAINT "resources_resourceGroupId_fkey" FOREIGN KEY ("resourceGroupId") REFERENCES "resource_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
