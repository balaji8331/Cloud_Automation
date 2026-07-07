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

interface BreakdownData {
  label: string;
  totalCost: number;
}

interface TenantBreakdownChartProps {
  data: BreakdownData[];
  type?: "bar" | "pie";
  currency?: string;
}

export function TenantBreakdownChart({
  data,
  type = "bar",
  currency = "USD",
}: TenantBreakdownChartProps) {
  if (type === "pie") {
    return (
      <ResponsiveContainer width="100%" height={280}>
        <PieChart>
          <Pie
            data={data}
            dataKey="totalCost"
            nameKey="label"
            cx="50%"
            cy="50%"
            outerRadius={100}
            label={({ label, percent }: { label: string; percent: number }) =>
              `${label} ${(percent * 100).toFixed(1)}%`
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
        <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#6b7280" }} />
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
