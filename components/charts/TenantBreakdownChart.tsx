"use client";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  PieChart,
  Pie,
  Legend,
} from "recharts";
import { formatCurrency } from "@/lib/utils";

const COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444",
  "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16",
];

interface TenantCost {
  tenantName: string;
  totalCost: number;
  currency: string;
}

interface TenantBreakdownChartProps {
  data: TenantCost[];
  type?: "bar" | "pie";
}

export function TenantBreakdownChart({
  data,
  type = "bar",
}: TenantBreakdownChartProps) {
  const currency = data[0]?.currency ?? "USD";

  if (type === "pie") {
    return (
      <ResponsiveContainer width="100%" height={280}>
        <PieChart>
          <Pie
            data={data}
            dataKey="totalCost"
            nameKey="tenantName"
            cx="50%"
            cy="50%"
            outerRadius={100}
            label={({ tenantName, percent }: { tenantName: string; percent: number }) =>
              `${tenantName} ${(percent * 100).toFixed(1)}%`
            }
          >
            {data.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value: number) => [formatCurrency(value, currency), "Cost"]}
            contentStyle={{ borderRadius: 8, fontSize: 12 }}
          />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="tenantName" tick={{ fontSize: 12, fill: "#6b7280" }} />
        <YAxis
          tick={{ fontSize: 11, fill: "#6b7280" }}
          tickFormatter={(v: number) => formatCurrency(v, currency, true)}
          width={70}
        />
        <Tooltip
          formatter={(v: number) => [formatCurrency(v, currency), "Cost"]}
          contentStyle={{ borderRadius: 8, fontSize: 12 }}
        />
        <Bar dataKey="totalCost" radius={[4, 4, 0, 0]}>
          {data.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
