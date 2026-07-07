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
import { useScopeParams } from "@/hooks/useScopeParams";
import { ScopeSelector } from "@/components/dashboard/ScopeSelector";
import { ScopeBreadcrumb } from "@/components/dashboard/ScopeBreadcrumb";

interface OverviewData {
  totalCost: number;
  dailyCosts: { date: string; cost: number; currency: string }[];
  byBreakdown: { label: string; totalCost: number }[];
  byService: { serviceName: string; totalCost: number }[];
  breakdownType: string;
  breakdownLabel: string;
  activeCount: number;
  activeCountLabel: string;
}

export default function DashboardPage() {
  const { status } = useSession();
  const { lastSyncAt } = useSyncEvent();
  const { scope } = useScopeParams();
  const [range, setRange] = useState<DateRange>("30d");
  const [currency, setCurrency] = useState("USD");
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
      if (scope.tenantId) params.set("tenantId", scope.tenantId);
      if (scope.subscriptionId) params.set("subscriptionId", scope.subscriptionId);
      if (scope.resourceGroup) params.set("resourceGroup", scope.resourceGroup);
      params.set("currency", currency);

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
  }, [scope.tenantId, scope.subscriptionId, scope.resourceGroup, currency]);

  // Guard: only fetch when session is confirmed authenticated
  // Also re-fetch when lastSyncAt changes (sync completed)
  useEffect(() => {
    if (status !== "authenticated") return;
    if (range !== "custom") {
      fetchData(range);
    } else if (customFrom && customTo) {
      fetchData("custom", customFrom, customTo);
    }
  }, [range, customFrom, customTo, fetchData, status, lastSyncAt]);

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

  const isEmpty = !loading && data?.dailyCosts.length === 0;

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

      {/* Scope Controls */}
      <div className="flex flex-col gap-4 bg-white p-4 rounded-lg border">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <ScopeSelector range={range} customFrom={customFrom} customTo={customTo} />
          
          <div className="flex gap-3 items-end ml-auto">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Currency</label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger className="w-24">
                  <SelectValue>{currency}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD ($)</SelectItem>
                  <SelectItem value="INR">INR (₹)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Date Range</label>
              <Select value={range} onValueChange={handleRangeChange}>
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
                  className="mb-0.5"
                >
                  <CalendarDays className="h-4 w-4" />
                  Apply
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between mt-2 pt-4 border-t">
          <ScopeBreadcrumb />
          <CurrencyNote />
        </div>
      </div>

      {isEmpty ? (
        <Card className="border-dashed border-2 bg-gray-50/50">
          <CardContent className="flex flex-col items-center justify-center h-[400px] text-center">
            <div className="rounded-full bg-gray-100 p-4 mb-4">
              <DollarSign className="h-8 w-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900">No cost data found</h3>
            <p className="text-sm text-gray-500 mt-2 max-w-sm">
              There are no cost records for the selected scope in this date range. 
              Try expanding the date range or selecting a broader scope.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
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
                    {loading ? "—" : formatCurrency(data?.totalCost ?? 0, currency)}
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
                  <p className="text-xs text-gray-500">{data?.activeCountLabel ?? "Active Tenants"}</p>
                  <p className="text-2xl font-semibold text-gray-900">
                    {loading ? "—" : data?.activeCount ?? 0}
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
                  <p className="text-sm font-semibold text-gray-900 leading-tight mt-0.5 truncate max-w-[120px]" title={data?.byService[0]?.serviceName}>
                    {loading ? "—" : (data?.byService[0]?.serviceName ?? "—")}
                  </p>
                  {data?.byService[0] && (
                    <p className="text-xs text-gray-500">
                      {formatCurrency(data.byService[0].totalCost, currency, true)}
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
                <CostTrendChart data={forecastData} showForecast currency={currency} />
              )}
            </CardContent>
          </Card>

          {/* Tenant Breakdown + Service */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle>{data?.breakdownLabel ?? "Cost Breakdown"}</CardTitle>
                <div className="flex gap-1.5">
                  <Button size="sm" variant={chartType === "bar" ? "default" : "outline"} onClick={() => setChartType("bar")}>Bar</Button>
                  <Button size="sm" variant={chartType === "pie" ? "default" : "outline"} onClick={() => setChartType("pie")}>Pie</Button>
                </div>
              </CardHeader>
              <CardContent className="pt-4">
                {loading || !data?.byBreakdown.length ? (
                  <div className="h-[280px] flex items-center justify-center text-gray-400 text-sm">
                    {loading ? "Loading…" : "No data for this period"}
                  </div>
                ) : (
                  <TenantBreakdownChart data={data.byBreakdown} type={chartType} currency={currency} />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle>Top Services</CardTitle></CardHeader>
              <CardContent className="pt-4">
                {loading || !data?.byService.length ? (
                  <div className="h-[300px] flex items-center justify-center text-gray-400 text-sm">
                    {loading ? "Loading…" : "No data for this period"}
                  </div>
                ) : (
                  <ServiceCostChart data={data.byService} topN={8} currency={currency} />
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
