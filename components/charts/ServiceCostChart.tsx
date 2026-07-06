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
} from "recharts";
import { formatCurrency } from "@/lib/utils";

const COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444",
  "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16",
  "#f97316", "#14b8a6",
];

interface ServiceCost {
  serviceName: string;
  totalCost: number;
}

interface ServiceCostChartProps {
  data: ServiceCost[];
  currency?: string;
  topN?: number;
}

export function ServiceCostChart({
  data,
  currency = "USD",
  topN = 10,
}: ServiceCostChartProps) {
  const sorted = [...data]
    .sort((a, b) => b.totalCost - a.totalCost)
    .slice(0, topN);

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart
        layout="vertical"
        data={sorted}
        margin={{ top: 4, right: 24, left: 0, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
        <XAxis
          type="number"
          tick={{ fontSize: 11, fill: "#6b7280" }}
          tickFormatter={(v: number) => formatCurrency(v, currency, true)}
        />
        <YAxis
          type="category"
          dataKey="serviceName"
          tick={{ fontSize: 11, fill: "#374151" }}
          width={130}
        />
        <Tooltip
          formatter={(v: number) => [formatCurrency(v, currency), "Cost"]}
          contentStyle={{ borderRadius: 8, fontSize: 12 }}
        />
        <Bar dataKey="totalCost" radius={[0, 4, 4, 0]}>
          {sorted.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
