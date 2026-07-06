/*
  Warnings:

  - A unique constraint covering the columns `[azureBudgetId]` on the table `budgets` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "budgets_azureBudgetId_key" ON "budgets"("azureBudgetId");
