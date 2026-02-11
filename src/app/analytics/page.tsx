"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";

// ---------- Types ----------

interface UpcomingFixture {
  gw: number;
  opponent: string;
  difficulty: number;
  isHome: boolean;
}

interface AnalyticsPlayer {
  id: number;
  webName: string;
  fullName: string;
  team: string;
  teamId: number;
  position: string;
  positionId: number;
  price: number;
  appearances: number;
  goals: number;
  assists: number;
  totalPoints: number;
  form: string;
  ownership: string;
  status: string;
  chanceOfPlaying: number | null;
  shots: number | null;
  keyPasses: number | null;
  npxG: number | null;
  xGChain: number | null;
  xG: number;
  xA: number;
  xPts: number;
  verdict: "KEEP" | "MONITOR" | "SELL";
  verdictReasons: string[];
  isDifferential: boolean;
  isRotationRisk: boolean;
  isUnavailable: boolean;
  isMaybeUnavailable: boolean;
  upcomingFixtures: UpcomingFixture[];
}

interface AnalyticsData {
  ok: boolean;
  players: AnalyticsPlayer[];
  currentGW: number;
  targetGW: number;
  upcomingGWs: number[];
  squadIds: number[];
  understatAvailable: boolean;
  error?: string;
}

type SortKey =
  | "xPts"
  | "totalPoints"
  | "price"
  | "shots"
  | "keyPasses"
  | "xG"
  | "xA"
  | "goals"
  | "assists"
  | "form"
  | "npxG"
  | "ownership";

// ---------- Main Page ----------

export default function AnalyticsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="spinner" />
        </div>
      }
    >
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

  // Filters
  const [activePosition, setActivePosition] = useState<number>(4); // Default to FWD
  const [verdictFilter, setVerdictFilter] = useState<string>("ALL");
  const [squadOnly, setSquadOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("xPts");
  const [sortAsc, setSortAsc] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        position: String(activePosition),
      });
      if (teamIdParam) params.set("teamId", teamIdParam);

      const res = await fetch(`/api/fpl/analytics?${params}`);
      const json = await res.json();

      if (!json.ok) {
        setError(json.error || "Failed to load analytics data");
      } else {
        setData(json);
      }
    } catch (e) {
      setError(String(e));
    }
    setLoading(false);
  }, [activePosition, teamIdParam]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  }

  // Filter and sort players
  const filteredPlayers = (data?.players || [])
    .filter((p) => {
      if (verdictFilter !== "ALL" && p.verdict !== verdictFilter) return false;
      if (squadOnly && data?.squadIds && !data.squadIds.includes(p.id))
        return false;
      if (
        searchQuery &&
        !p.webName.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !p.fullName.toLowerCase().includes(searchQuery.toLowerCase())
      )
        return false;
      return true;
    })
    .sort((a, b) => {
      const getValue = (p: AnalyticsPlayer): number => {
        switch (sortKey) {
          case "xPts": return p.xPts;
          case "totalPoints": return p.totalPoints;
          case "price": return p.price;
          case "shots": return p.shots ?? 0;
          case "keyPasses": return p.keyPasses ?? 0;
          case "xG": return p.xG;
          case "xA": return p.xA;
          case "goals": return p.goals;
          case "assists": return p.assists;
          case "form": return parseFloat(p.form || "0");
          case "npxG": return p.npxG ?? 0;
          case "ownership": return parseFloat(p.ownership || "0");
          default: return 0;
        }
      };
      const diff = getValue(a) - getValue(b);
      return sortAsc ? diff : -diff;
    });

  // Group by verdict
  const keepPlayers = filteredPlayers.filter((p) => p.verdict === "KEEP");
  const monitorPlayers = filteredPlayers.filter((p) => p.verdict === "MONITOR");
  const sellPlayers = filteredPlayers.filter((p) => p.verdict === "SELL");

  const positionTabs = [
    { id: 1, label: "Goalkeepers", short: "GKP" },
    { id: 2, label: "Defenders", short: "DEF" },
    { id: 3, label: "Midfielders", short: "MID" },
    { id: 4, label: "Forwards", short: "FWD" },
  ];

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-6 space-y-6 min-h-screen">
      {/* Header */}
      <header>
        <h1 className="text-2xl font-bold text-slate-50">
          Player Analytics
        </h1>
        <p className="text-slate-400 text-sm mt-1">
          Advanced stats powered by Understat + FPL data
          {data && !data.understatAvailable && (
            <span className="text-amber-400 ml-2">
              (Understat data loading failed - Shots, KP, npxG show as &quot;-&quot;)
            </span>
          )}
        </p>
      </header>

      {/* Position Tabs */}
      <div className="flex gap-1 bg-slate-900 rounded-lg p-1 w-fit">
        {positionTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActivePosition(tab.id)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activePosition === tab.id
                ? "bg-purple-600 text-white"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
            }`}
          >
            <span className="hidden sm:inline">{tab.label}</span>
            <span className="sm:hidden">{tab.short}</span>
          </button>
        ))}
      </div>

      {/* Filters Row */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Search player..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-50 placeholder-slate-500 focus:outline-none focus:border-purple-500 text-sm w-48"
        />

        <div className="flex gap-1 bg-slate-800 rounded-lg p-0.5">
          {["ALL", "KEEP", "MONITOR", "SELL"].map((v) => (
            <button
              key={v}
              onClick={() => setVerdictFilter(v)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                verdictFilter === v
                  ? v === "KEEP"
                    ? "bg-emerald-600 text-white"
                    : v === "MONITOR"
                      ? "bg-amber-600 text-white"
                      : v === "SELL"
                        ? "bg-red-600 text-white"
                        : "bg-slate-600 text-white"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {v}
            </button>
          ))}
        </div>

        {data?.squadIds && data.squadIds.length > 0 && (
          <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={squadOnly}
              onChange={(e) => setSquadOnly(e.target.checked)}
              className="rounded border-slate-600 bg-slate-800 text-purple-500 focus:ring-purple-500"
            />
            My Squad Only
          </label>
        )}

        <span className="text-slate-500 text-sm ml-auto">
          {filteredPlayers.length} players
        </span>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3">
            <div className="spinner" />
            <p className="text-slate-400 text-sm">
              Loading analytics data...
            </p>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-900/20 border border-red-700/40 rounded-lg p-4">
          <p className="text-red-400 font-medium">Error loading analytics</p>
          <p className="text-red-300/70 text-sm mt-1">{error}</p>
          <button
            onClick={fetchData}
            className="mt-3 px-4 py-2 rounded-lg bg-slate-700 text-slate-50 text-sm hover:bg-slate-600"
          >
            Retry
          </button>
        </div>
      )}

      {/* Data Table */}
      {!loading && data && !error && (
        <div className="space-y-6 fade-in">
          {verdictFilter === "ALL" ? (
            <>
              {keepPlayers.length > 0 && (
                <VerdictSection
                  label="KEEP"
                  players={keepPlayers}
                  upcomingGWs={data.upcomingGWs}
                  sortKey={sortKey}
                  sortAsc={sortAsc}
                  onSort={handleSort}
                  squadIds={new Set(data.squadIds)}
                />
              )}
              {monitorPlayers.length > 0 && (
                <VerdictSection
                  label="MONITOR"
                  players={monitorPlayers}
                  upcomingGWs={data.upcomingGWs}
                  sortKey={sortKey}
                  sortAsc={sortAsc}
                  onSort={handleSort}
                  squadIds={new Set(data.squadIds)}
                />
              )}
              {sellPlayers.length > 0 && (
                <VerdictSection
                  label="SELL"
                  players={sellPlayers}
                  upcomingGWs={data.upcomingGWs}
                  sortKey={sortKey}
                  sortAsc={sortAsc}
                  onSort={handleSort}
                  squadIds={new Set(data.squadIds)}
                />
              )}
            </>
          ) : (
            <VerdictSection
              label={verdictFilter as "KEEP" | "MONITOR" | "SELL"}
              players={filteredPlayers}
              upcomingGWs={data.upcomingGWs}
              sortKey={sortKey}
              sortAsc={sortAsc}
              onSort={handleSort}
              squadIds={new Set(data.squadIds)}
            />
          )}

          {/* Table Key */}
          <div className="bg-slate-900 rounded-xl border border-slate-700 p-4">
            <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-3">
              Table Key
            </h3>
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <span className="flex items-center gap-2">
                <span className="analytics-icon-diff">D</span>
                <span className="text-slate-300">Differential (&lt;10% owned)</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="analytics-icon-rotation">R</span>
                <span className="text-slate-300">Rotation risk</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="analytics-icon-maybe">?</span>
                <span className="text-slate-300">May be unavailable</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="analytics-icon-unavailable">X</span>
                <span className="text-slate-300">Unavailable</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="analytics-icon-squad">S</span>
                <span className="text-slate-300">In your squad</span>
              </span>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm mt-3">
              <span className="text-slate-400">
                <strong className="text-sky-400">S</strong> = Shots (Understat) |{" "}
                <strong className="text-sky-400">KP</strong> = Key Passes (Understat) |{" "}
                <strong className="text-sky-400">npxG</strong> = Non-Penalty xG (Understat) |{" "}
                <strong className="text-emerald-400">EO</strong> = Effective Ownership %
              </span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm mt-2">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm analytics-fdr-1" />
                <span className="text-slate-400">Very Easy</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm analytics-fdr-2" />
                <span className="text-slate-400">Easy</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm analytics-fdr-3" />
                <span className="text-slate-400">Medium</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm analytics-fdr-4" />
                <span className="text-slate-400">Hard</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm analytics-fdr-5" />
                <span className="text-slate-400">Very Hard</span>
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Verdict Section ----------

function VerdictSection({
  label,
  players,
  upcomingGWs,
  sortKey,
  sortAsc,
  onSort,
  squadIds,
}: {
  label: "KEEP" | "MONITOR" | "SELL";
  players: AnalyticsPlayer[];
  upcomingGWs: number[];
  sortKey: SortKey;
  sortAsc: boolean;
  onSort: (key: SortKey) => void;
  squadIds: Set<number>;
}) {
  const verdictStyles = {
    KEEP: {
      border: "border-emerald-700/50",
      bg: "bg-emerald-900/10",
      badge: "bg-emerald-600 text-white",
    },
    MONITOR: {
      border: "border-amber-700/50",
      bg: "bg-amber-900/10",
      badge: "bg-amber-600 text-white",
    },
    SELL: {
      border: "border-red-700/50",
      bg: "bg-red-900/10",
      badge: "bg-red-600 text-white",
    },
  };

  const style = verdictStyles[label];

  return (
    <div className={`rounded-xl border ${style.border} ${style.bg} overflow-hidden`}>
      {/* Section Header */}
      <div className="px-4 py-3 border-b border-slate-700/50 flex items-center gap-3">
        <span className={`px-2.5 py-1 rounded text-xs font-bold ${style.badge}`}>
          {label}
        </span>
        <span className="text-slate-400 text-sm">
          {players.length} player{players.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="analytics-table">
          <thead>
            <tr>
              <th className="analytics-th analytics-th-sticky">Player</th>
              <th className="analytics-th">Team</th>
              <SortTh label={"\u00A3"} sortKey="price" currentKey={sortKey} asc={sortAsc} onSort={onSort} />
              <th className="analytics-th">App</th>
              <SortTh label="S" sortKey="shots" currentKey={sortKey} asc={sortAsc} onSort={onSort} className="analytics-th-understat" title="Shots (Understat)" />
              <SortTh label="KP" sortKey="keyPasses" currentKey={sortKey} asc={sortAsc} onSort={onSort} className="analytics-th-understat" title="Key Passes (Understat)" />
              <SortTh label="xG" sortKey="xG" currentKey={sortKey} asc={sortAsc} onSort={onSort} />
              <SortTh label="G" sortKey="goals" currentKey={sortKey} asc={sortAsc} onSort={onSort} />
              <SortTh label="xA" sortKey="xA" currentKey={sortKey} asc={sortAsc} onSort={onSort} />
              <SortTh label="A" sortKey="assists" currentKey={sortKey} asc={sortAsc} onSort={onSort} />
              <SortTh label="npxG" sortKey="npxG" currentKey={sortKey} asc={sortAsc} onSort={onSort} className="analytics-th-understat" title="Non-Penalty xG (Understat)" />
              <SortTh label="EO%" sortKey="ownership" currentKey={sortKey} asc={sortAsc} onSort={onSort} className="analytics-th-accent" title="Effective Ownership %" />
              <SortTh label="xPts" sortKey="xPts" currentKey={sortKey} asc={sortAsc} onSort={onSort} className="analytics-th-accent" />
              <SortTh label="Pts" sortKey="totalPoints" currentKey={sortKey} asc={sortAsc} onSort={onSort} />
              {upcomingGWs.map((gw) => (
                <th key={gw} className="analytics-th analytics-th-fixture">
                  GW{gw}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {players.map((p) => (
              <PlayerRow
                key={p.id}
                player={p}
                upcomingGWs={upcomingGWs}
                isInSquad={squadIds.has(p.id)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- Sortable Table Header ----------

function SortTh({
  label,
  sortKey,
  currentKey,
  asc,
  onSort,
  className,
  title,
}: {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey;
  asc: boolean;
  onSort: (key: SortKey) => void;
  className?: string;
  title?: string;
}) {
  const isActive = currentKey === sortKey;
  return (
    <th
      className={`analytics-th analytics-th-sortable ${className || ""} ${isActive ? "analytics-th-active" : ""}`}
      onClick={() => onSort(sortKey)}
      title={title}
    >
      {label}
      {isActive && <SortArrow asc={asc} />}
    </th>
  );
}

// ---------- Player Row ----------

function PlayerRow({
  player: p,
  upcomingGWs,
  isInSquad,
}: {
  player: AnalyticsPlayer;
  upcomingGWs: number[];
  isInSquad: boolean;
}) {
  const [showReasons, setShowReasons] = useState(false);

  return (
    <>
      <tr
        className={`analytics-row ${isInSquad ? "analytics-row-squad" : ""}`}
        onClick={() => setShowReasons(!showReasons)}
      >
        {/* Player name + icons */}
        <td className="analytics-td analytics-td-sticky">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-50 font-medium text-sm whitespace-nowrap">
              {p.webName}
            </span>
            {isInSquad && <span className="analytics-icon-squad">S</span>}
            {p.isDifferential && (
              <span className="analytics-icon-diff" title="Differential (<10% owned)">D</span>
            )}
            {p.isRotationRisk && (
              <span className="analytics-icon-rotation" title="Rotation risk">R</span>
            )}
            {p.isMaybeUnavailable && (
              <span className="analytics-icon-maybe" title="May be unavailable">?</span>
            )}
            {p.isUnavailable && (
              <span className="analytics-icon-unavailable" title="Unavailable">X</span>
            )}
          </div>
        </td>
        <td className="analytics-td text-slate-400">{p.team}</td>
        <td className="analytics-td text-slate-200">{p.price.toFixed(1)}</td>
        <td className="analytics-td text-slate-300">{p.appearances}</td>
        {/* Understat stats - always show columns, "-" if unavailable */}
        <td className="analytics-td text-sky-300">{p.shots ?? "-"}</td>
        <td className="analytics-td text-sky-300">{p.keyPasses ?? "-"}</td>
        <td className="analytics-td text-cyan-400 font-medium">{p.xG.toFixed(2)}</td>
        <td className="analytics-td text-slate-50 font-semibold">{p.goals}</td>
        <td className="analytics-td text-cyan-400 font-medium">{p.xA.toFixed(2)}</td>
        <td className="analytics-td text-slate-50 font-semibold">{p.assists}</td>
        <td className="analytics-td text-sky-300">
          {p.npxG !== null ? p.npxG.toFixed(2) : "-"}
        </td>
        {/* EO - Effective Ownership */}
        <td className="analytics-td text-amber-300 font-medium">
          {parseFloat(p.ownership || "0").toFixed(1)}%
        </td>
        <td className="analytics-td text-emerald-400 font-bold">
          {p.xPts.toFixed(1)}
        </td>
        <td className="analytics-td text-slate-50 font-semibold">
          {p.totalPoints}
        </td>
        {/* Upcoming fixture difficulty badges */}
        {upcomingGWs.map((gw) => {
          const fixture = p.upcomingFixtures.find((f) => f.gw === gw);
          if (!fixture || fixture.opponent === "-") {
            return (
              <td key={gw} className="analytics-td text-center">
                <span className="analytics-fdr-blank">-</span>
              </td>
            );
          }
          return (
            <td key={gw} className="analytics-td text-center">
              <span
                className={`analytics-fdr analytics-fdr-${fixture.difficulty}`}
                title={`GW${gw}: ${fixture.isHome ? "Home" : "Away"} vs ${fixture.opponent} (FDR ${fixture.difficulty})`}
              >
                {fixture.opponent}
                {fixture.isHome ? "(H)" : "(A)"}
              </span>
            </td>
          );
        })}
      </tr>
      {showReasons && p.verdictReasons.length > 0 && (
        <tr className="analytics-reasons-row">
          <td
            colSpan={100}
            className="px-4 py-2 text-xs text-slate-400 bg-slate-800/50"
          >
            <span className="font-semibold text-slate-300 mr-2">
              {p.verdict}:
            </span>
            {p.verdictReasons.join(" | ")}
          </td>
        </tr>
      )}
    </>
  );
}

// ---------- Sort Arrow ----------

function SortArrow({ asc }: { asc: boolean }) {
  return (
    <span className="ml-0.5 text-purple-300 text-[10px]">
      {asc ? "\u25B2" : "\u25BC"}
    </span>
  );
}
