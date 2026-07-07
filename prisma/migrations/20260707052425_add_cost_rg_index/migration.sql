-- CreateIndex
CREATE INDEX "cost_records_tenantId_subscriptionId_resourceGroup_idx" ON "cost_records"("tenantId", "subscriptionId", "resourceGroup");
