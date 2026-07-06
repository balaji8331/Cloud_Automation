"use client";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from "recharts";
import { formatCurrency } from "@/lib/utils";

interface DataPoint {
  date: string;
  cost: number;
  forecast?: number;
}

interface CostTrendChartProps {
  data: DataPoint[];
  currency?: string;
  showForecast?: boolean;
}

export function CostTrendChart({
  data,
  currency = "USD",
  showForecast = false,
}: CostTrendChartProps) {
  const today = new Date().toISOString().split("T")[0];

  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="actualGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="forecastGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.15} />
            <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: "#6b7280" }}
          tickFormatter={(v: string) =>
            new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric" })
          }
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fontSize: 11, fill: "#6b7280" }}
          tickFormatter={(v: number) => formatCurrency(v, currency, true)}
          width={70}
        />
        <Tooltip
          formatter={(value: number, name: string) => [
            formatCurrency(value, currency),
            name === "cost" ? "Actual" : "Forecast (est.)",
          ]}
          labelFormatter={(label: string) =>
            new Date(label).toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            })
          }
          contentStyle={{ borderRadius: 8, fontSize: 12 }}
        />
        {showForecast && <Legend />}
        <ReferenceLine x={today} stroke="#9ca3af" strokeDasharray="4 2" label="" />
        <Area
          type="monotone"
          dataKey="cost"
          name="cost"
          stroke="#3b82f6"
          strokeWidth={2}
          fill="url(#actualGrad)"
          dot={false}
          activeDot={{ r: 4 }}
        />
        {showForecast && (
          <Area
            type="monotone"
            dataKey="forecast"
            name="forecast"
            stroke="#f59e0b"
            strokeWidth={2}
            strokeDasharray="5 4"
            fill="url(#forecastGrad)"
            dot={false}
          />
        )}
      </AreaChart>
    </ResponsiveContainer>
  );
}
