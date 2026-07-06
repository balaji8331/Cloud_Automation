import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(
  amount: number,
  currency = "USD",
  compact = false
): string {
  if (compact && amount >= 1_000_000) {
    return `${currency} ${(amount / 1_000_000).toFixed(1)}M`;
  }
  if (compact && amount >= 1_000) {
    return `${currency} ${(amount / 1_000).toFixed(1)}K`;
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatDate(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export type DateRange = "7d" | "30d" | "90d" | "1y" | "1m" | "3m" | "6m" | "custom";

export function getDateRange(range: DateRange, customFrom?: Date, customTo?: Date): {
  from: Date;
  to: Date;
} {
  const to = new Date();
  const from = new Date();

  switch (range) {
    case "7d":
      from.setDate(from.getDate() - 7);
      break;
    case "30d":
      from.setDate(from.getDate() - 30);
      break;
    case "90d":
      from.setDate(from.getDate() - 90);
      break;
    case "1m":
      from.setMonth(from.getMonth() - 1);
      break;
    case "3m":
      from.setMonth(from.getMonth() - 3);
      break;
    case "6m":
      from.setMonth(from.getMonth() - 6);
      break;
    case "1y":
      from.setFullYear(from.getFullYear() - 1);
      break;
    case "custom":
      return {
        from: customFrom ?? new Date(from.getFullYear(), from.getMonth(), 1),
        to: customTo ?? to,
      };
  }
  return { from, to };
}

/** Simple linear regression forecast */
export function linearForecast(
  data: { date: string; cost: number }[],
  daysAhead: number
): { date: string; cost: number }[] {
  if (data.length < 2) return [];

  const n = data.length;
  const xs = data.map((_, i) => i);
  const ys = data.map((d) => d.cost);

  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = ys.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((s, x, i) => s + x * ys[i], 0);
  const sumX2 = xs.reduce((s, x) => s + x * x, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  const lastDate = new Date(data[data.length - 1].date);
  const forecast: { date: string; cost: number }[] = [];

  for (let i = 1; i <= daysAhead; i++) {
    const nextDate = new Date(lastDate);
    nextDate.setDate(nextDate.getDate() + i);
    const predictedCost = Math.max(0, intercept + slope * (n + i - 1));
    forecast.push({
      date: nextDate.toISOString().split("T")[0],
      cost: predictedCost,
    });
  }

  return forecast;
}

/** Calculate 7-day moving average */
export function movingAverage(
  data: { date: string; cost: number }[],
  window = 7
): (number | null)[] {
  return data.map((_, i) => {
    if (i < window - 1) return null;
    const slice = data.slice(i - window + 1, i + 1);
    return slice.reduce((s, d) => s + d.cost, 0) / window;
  });
}
