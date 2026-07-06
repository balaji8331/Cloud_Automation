"use client";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2 } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface BudgetRow {
  id: string;
  name: string;
  amount: number;
  timeGrain: string;
  startDate: string;
  endDate: string | null;
  alertThreshold: number;
  currentSpend: number;
  spendPercent: number;
  tenantId: string;
}

interface BudgetTableProps {
  budgets: BudgetRow[];
  tenantNames: Record<string, string>;
  onEdit: (budget: BudgetRow) => void;
  onDelete: (id: string) => void;
  isAdmin: boolean;
}

function progressColor(pct: number): string {
  if (pct >= 100) return "bg-red-500";
  if (pct >= 80) return "bg-yellow-500";
  return "bg-green-500";
}

export function BudgetTable({
  budgets,
  tenantNames,
  onEdit,
  onDelete,
  isAdmin,
}: BudgetTableProps) {
  if (budgets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-gray-400">
        <p className="text-sm">No budgets configured yet.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left">
            <th className="pb-3 pr-4 font-medium text-gray-500 text-xs uppercase tracking-wide">Budget</th>
            <th className="pb-3 pr-4 font-medium text-gray-500 text-xs uppercase tracking-wide">Tenant</th>
            <th className="pb-3 pr-4 font-medium text-gray-500 text-xs uppercase tracking-wide">Period</th>
            <th className="pb-3 pr-4 font-medium text-gray-500 text-xs uppercase tracking-wide w-48">Spend</th>
            <th className="pb-3 pr-4 font-medium text-gray-500 text-xs uppercase tracking-wide">Alert at</th>
            {isAdmin && <th className="pb-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Actions</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {budgets.map((b) => {
            const pct = Math.min(b.spendPercent, 100);
            return (
              <tr key={b.id}>
                <td className="py-4 pr-4">
                  <p className="font-medium text-gray-900">{b.name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{b.timeGrain}</p>
                </td>
                <td className="py-4 pr-4 text-gray-600 text-xs">
                  {tenantNames[b.tenantId] ?? b.tenantId.slice(0, 8)}
                </td>
                <td className="py-4 pr-4 text-xs text-gray-500">
                  <div>{formatDate(b.startDate)}</div>
                  {b.endDate && <div>→ {formatDate(b.endDate)}</div>}
                </td>
                <td className="py-4 pr-4">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className={cn("font-medium", b.spendPercent >= 100 ? "text-red-600" : b.spendPercent >= 80 ? "text-yellow-600" : "text-green-600")}>
                      {formatCurrency(b.currentSpend)} / {formatCurrency(b.amount)}
                    </span>
                    <span className="text-gray-500 ml-2">{b.spendPercent.toFixed(1)}%</span>
                  </div>
                  <Progress
                    value={pct}
                    className="h-1.5"
                    indicatorClassName={progressColor(b.spendPercent)}
                  />
                </td>
                <td className="py-4 pr-4 text-xs text-gray-500">
                  {(Number(b.alertThreshold) * 100).toFixed(0)}%
                </td>
                {isAdmin && (
                  <td className="py-4">
                    <div className="flex items-center gap-1.5">
                      <Button size="icon" variant="ghost" onClick={() => onEdit(b)} aria-label="Edit budget">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => onDelete(b.id)}
                        aria-label="Delete budget"
                        className="text-red-500 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
