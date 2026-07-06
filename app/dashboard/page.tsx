"use client";
import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { DollarSign, TrendingUp, Building2, AlertTriangle, CalendarDays } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CostTrendChart } from "@/components/charts/CostTrendChart";
import { TenantBreakdownChart } from "@/components/charts/TenantBreakdownChart";
import { ServiceCostChart } from "@/components/charts/ServiceCostChart";
import { formatCurrency, linearForecast, type DateRange } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchWithAuth } from "@/lib/auth/fetchWithAuth";
import { CurrencyNote } from "@/components/charts/CurrencyNote";
import { useSyncEvent } from "@/lib/context/SyncEventContext";

interface OverviewData {
  totalCost: number;
  dailyCosts: { date: string; cost: number; currency: string }[];
  byTenant: { tenantId: string; tenantName: string; totalCost: number; currency: string }[];
  byService: { serviceName: string; totalCost: number }[];
}

export default function DashboardPage() {
  const { status } = useSession();
  const { lastSyncAt } = useSyncEvent();
  const [range, setRange] = useState<DateRange>("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [chartType, setChartType] = useState<"bar" | "pie">("bar");

  const fetchData = useCallback(async (
    activeRange: DateRange,
    fromDate?: string,
    toDate?: string
  ) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ range: activeRange });
      if (activeRange === "custom" && fromDate && toDate) {
        params.set("from", fromDate);
        params.set("to", toDate);
      }
      // Use fetchWithAuth — redirects to /login on 401
      const res = await fetchWithAuth(`/api/dashboard/overview?${params}`);
      const json = await res.json();
      if (Array.isArray(json.dailyCosts)) {
        setData(json);
      } else {
        setData(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Guard: only fetch when session is confirmed authenticated
  // Also re-fetch when lastSyncAt changes (sync completed)
  useEffect(() => {
    if (status !== "authenticated") return;
    if (range !== "custom") {
      fetchData(range);
    }
  }, [range, fetchData, status, lastSyncAt]);

  function handleRangeChange(val: string) {
    if (val === "custom") {
      setShowCustom(true);
      setRange("custom");
    } else {
      setShowCustom(false);
      setRange(val as DateRange);
    }
  }

  function applyCustomRange() {
    if (customFrom && customTo) {
      fetchData("custom", customFrom, customTo);
    }
  }

  const forecastData = data && Array.isArray(data.dailyCosts)
    ? [
        ...data.dailyCosts,
        ...linearForecast(data.dailyCosts, 14).map((f) => ({
          ...f,
          forecast: f.cost,
          cost: 0,
          currency: "USD",
        })),
      ]
    : [];

  const half = Math.floor((data?.dailyCosts.length ?? 0) / 2);
  const prevCost = data?.dailyCosts.slice(0, half).reduce((s, d) => s + d.cost, 0) ?? 0;
  const currCost = data?.dailyCosts.slice(half).reduce((s, d) => s + d.cost, 0) ?? 0;
  const trend = prevCost > 0 ? ((currCost - prevCost) / prevCost) * 100 : 0;

  const rangeLabel: Record<string, string> = {
    "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days",
    "1m": "Last month", "3m": "Last 3 months", "6m": "Last 6 months",
    "1y": "Last year", "custom": "Custom range",
  };

  return (
    <div className="space-y-6">
      {/* Session loading state — prevents blank flash */}
      {status === "loading" && (
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Loading session…
        </div>
      )}
      {/* Controls */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">Date Range</label>          <Select value={range} onValueChange={handleRangeChange}>
            <SelectTrigger className="w-40">
              <SelectValue>{rangeLabel[range]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
              <SelectItem value="1m">Last 1 month</SelectItem>
              <SelectItem value="3m">Last 3 months</SelectItem>
              <SelectItem value="6m">Last 6 months</SelectItem>
              <SelectItem value="1y">Last year</SelectItem>
              <SelectItem value="custom">Custom range…</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {showCustom && (
          <>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">From</label>
              <Input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="w-36"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">To</label>
              <Input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="w-36"
              />
            </div>
            <Button
              onClick={applyCustomRange}
              disabled={!customFrom || !customTo}
              size="sm"
              className="mt-auto"
            >
              <CalendarDays className="h-4 w-4" />
              Apply
            </Button>
          </>
        )}
        <div className="ml-auto flex items-center">
          <CurrencyNote />
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="flex items-start gap-4 pt-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100">
              <DollarSign className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Total Spend</p>
              <p className="text-2xl font-semibold text-gray-900">
                {loading ? "—" : formatCurrency(data?.totalCost ?? 0)}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-start gap-4 pt-6">
            <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${trend >= 0 ? "bg-red-100" : "bg-green-100"}`}>
              <TrendingUp className={`h-5 w-5 ${trend >= 0 ? "text-red-600" : "text-green-600"}`} />
            </div>
            <div>
              <p className="text-xs text-gray-500">Period Trend</p>
              <p className="text-2xl font-semibold text-gray-900">
                {loading ? "—" : `${trend >= 0 ? "+" : ""}${trend.toFixed(1)}%`}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-start gap-4 pt-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100">
              <Building2 className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Active Tenants</p>
              <p className="text-2xl font-semibold text-gray-900">
                {loading ? "—" : data?.byTenant.length ?? 0}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-start gap-4 pt-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-yellow-100">
              <AlertTriangle className="h-5 w-5 text-yellow-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Top Service</p>
              <p className="text-sm font-semibold text-gray-900 leading-tight mt-0.5">
                {loading ? "—" : (data?.byService[0]?.serviceName ?? "—")}
              </p>
              {data?.byService[0] && (
                <p className="text-xs text-gray-500">
                  {formatCurrency(data.byService[0].totalCost, "USD", true)}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Trend Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Cost Trend + Forecast</CardTitle>
          <p className="text-xs text-yellow-600 bg-yellow-50 rounded px-2 py-1 w-fit mt-1">
            Forecast is a linear estimate — not Azure&apos;s own forecast
          </p>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="h-[280px] flex items-center justify-center text-gray-400 text-sm">
              Loading…
            </div>
          ) : (
            <CostTrendChart data={forecastData} showForecast currency="USD" />
          )}
        </CardContent>
      </Card>

      {/* Tenant Breakdown + Service */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Cost by Tenant</CardTitle>
            <div className="flex gap-1.5">
              <Button size="sm" variant={chartType === "bar" ? "default" : "outline"} onClick={() => setChartType("bar")}>Bar</Button>
              <Button size="sm" variant={chartType === "pie" ? "default" : "outline"} onClick={() => setChartType("pie")}>Pie</Button>
            </div>
          </CardHeader>
          <CardContent>
            {loading || !data?.byTenant.length ? (
              <div className="h-[280px] flex items-center justify-center text-gray-400 text-sm">
                {loading ? "Loading…" : "No data for this period"}
              </div>
            ) : (
              <TenantBreakdownChart data={data.byTenant} type={chartType} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Top Services</CardTitle></CardHeader>
          <CardContent>
            {loading || !data?.byService.length ? (
              <div className="h-[300px] flex items-center justify-center text-gray-400 text-sm">
                {loading ? "Loading…" : "No data for this period"}
              </div>
            ) : (
              <ServiceCostChart data={data.byService} topN={8} />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
