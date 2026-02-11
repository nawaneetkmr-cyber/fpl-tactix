"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import AnalyticsTable from "@/components/AnalyticsTable";
import type { AnalyticsPlayer } from "@/components/AnalyticsTable";

interface AnalyticsData {
  ok: boolean;
  players: AnalyticsPlayer[];
  currentGW: number;
  targetGW: number;
  upcomingGWs: number[];
  squadIds: number[];
  error?: string;
}

export default function AnalyticsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-[60vh]"><div className="spinner" /></div>}>
      <AnalyticsInner />
    </Suspense>
  );
}

function AnalyticsInner() {
  const searchParams = useSearchParams();
  const teamIdParam = searchParams.get("teamId");

  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activePosition, setActivePosition] = useState<number>(4);
  const [range, setRange] = useState<"season" | "last5">("season");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ position: String(activePosition), range });
      if (teamIdParam) params.set("teamId", teamIdParam);
      const res = await fetch(`/api/fpl/analytics?${params}`);
      const json = await res.json();
      if (!json.ok) setError(json.error || "Failed to load");
      else setData(json);
    } catch (e) { setError(String(e)); }
    setLoading(false);
  }, [activePosition, range, teamIdParam]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const tabs = [
    { id: 1, label: "Goalkeepers", short: "GKP" },
    { id: 2, label: "Defenders", short: "DEF" },
    { id: 3, label: "Midfielders", short: "MID" },
    { id: 4, label: "Forwards", short: "FWD" },
  ];

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-6 space-y-5 min-h-screen bg-[#0a0e14]">
      <header>
        <h1 className="text-xl font-bold text-white">Player Analytics</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          Per-90 stats — xG, xA, KP, BPS, DC, CS with KEEP / MONITOR / SELL verdicts
        </p>
      </header>

      <div className="flex gap-1 bg-[#111827] rounded-lg p-1 w-fit">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActivePosition(tab.id)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              activePosition === tab.id
                ? "bg-purple-600 text-white"
                : "text-slate-500 hover:text-slate-300 hover:bg-[#1a2030]"
            }`}
          >
            <span className="hidden sm:inline">{tab.label}</span>
            <span className="sm:hidden">{tab.short}</span>
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="spinner" />
        </div>
      )}

      {error && (
        <div className="bg-red-900/20 border border-red-800 rounded-lg p-4">
          <p className="text-red-400 font-medium text-sm">{error}</p>
          <button onClick={fetchData} className="mt-2 px-3 py-1.5 rounded bg-slate-800 text-slate-300 text-sm hover:bg-slate-700">Retry</button>
        </div>
      )}

      {!loading && data && !error && (
        <AnalyticsTable
          players={data.players}
          upcomingGWs={data.upcomingGWs}
          squadIds={new Set(data.squadIds)}
          positionId={activePosition}
          range={range}
          onRangeChange={setRange}
        />
      )}
    </div>
  );
}
