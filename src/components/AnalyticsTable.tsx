"use client";

import { useState } from "react";

// ---------- Types ----------

interface UpcomingFixture {
  gw: number;
  opponent: string;
  difficulty: number;
  isHome: boolean;
}

export interface AnalyticsPlayer {
  id: number;
  webName: string;
  team: string;
  teamShort: string;
  teamId: number;
  position: string;
  positionId: number;
  price: number;
  minutes: number;
  starts: number;
  totalPoints: number;
  form: string;
  ownership: string;
  status: string;
  chanceOfPlaying: number | null;
  // Per-90 stats
  xGp90: number;
  goalsp90: number;
  xAp90: number;
  assistsp90: number;
  xGIp90: number;
  xGCp90: number;
  kpP90: number;   // Key Passes (creativity per 90)
  bpsP90: number;  // BPS per 90
  dcP90: number;   // Defensive Contribution per 90
  csp90: number;   // Clean sheets per 90
  gcp90: number;   // Goals conceded per 90
  svP90: number;   // Saves per 90
  penaltiesSaved: number;
  bonus: number;
  xPts: number;
  verdict: "KEEP" | "MONITOR" | "SELL";
  verdictReasons: string[];
  isDifferential: boolean;
  isRotationRisk: boolean;
  isUnavailable: boolean;
  isMaybeUnavailable: boolean;
  upcomingFixtures: UpcomingFixture[];
}

type SortKey = string;

// ---------- Column definitions per position ----------

interface ColDef {
  key: SortKey;
  label: string;
  title?: string;
  getValue: (p: AnalyticsPlayer) => string | number;
  getClass?: string;
}

function getColumnsForPosition(positionId: number): ColDef[] {
  const common: ColDef[] = [
    { key: "price", label: "£", getValue: (p) => p.price.toFixed(1), getClass: "text-slate-200" },
    { key: "starts", label: "St", title: "Starts", getValue: (p) => p.starts, getClass: "text-slate-400" },
  ];

  const attacking: ColDef[] = [
    { key: "xGp90", label: "xG/90", title: "Expected Goals per 90 min", getValue: (p) => p.xGp90.toFixed(2), getClass: "text-cyan-400" },
    { key: "goalsp90", label: "G/90", title: "Goals per 90 min", getValue: (p) => p.goalsp90.toFixed(2), getClass: "text-white font-semibold" },
    { key: "xAp90", label: "xA/90", title: "Expected Assists per 90 min", getValue: (p) => p.xAp90.toFixed(2), getClass: "text-cyan-400" },
    { key: "assistsp90", label: "A/90", title: "Assists per 90 min", getValue: (p) => p.assistsp90.toFixed(2), getClass: "text-white font-semibold" },
  ];

  const process: ColDef[] = [
    { key: "kpP90", label: "KP/90", title: "Key Passes per 90 (FPL Creativity score)", getValue: (p) => p.kpP90.toFixed(1), getClass: "text-violet-300" },
    { key: "bpsP90", label: "BPS/90", title: "Bonus Points System score per 90", getValue: (p) => p.bpsP90.toFixed(1), getClass: "text-yellow-300" },
  ];

  const defensive: ColDef[] = [
    { key: "dcP90", label: "DC/90", title: "Defensive Contribution per 90", getValue: (p) => p.dcP90.toFixed(2), getClass: "text-blue-300" },
    { key: "gcp90", label: "GC/90", title: "Goals Conceded per 90", getValue: (p) => p.gcp90.toFixed(2), getClass: "text-red-300" },
    { key: "csp90", label: "CS/90", title: "Clean Sheets per 90", getValue: (p) => p.csp90.toFixed(2), getClass: "text-emerald-300" },
    { key: "xGCp90", label: "xGC/90", title: "Expected Goals Conceded per 90", getValue: (p) => p.xGCp90.toFixed(2), getClass: "text-red-300" },
  ];

  const tail: ColDef[] = [
    { key: "ownership", label: "EO%", title: "Effective Ownership %", getValue: (p) => parseFloat(p.ownership || "0").toFixed(1) + "%", getClass: "text-amber-300" },
    { key: "xPts", label: "xPts", title: "Expected Points (next GW)", getValue: (p) => p.xPts.toFixed(1), getClass: "text-emerald-400 font-bold" },
    { key: "totalPoints", label: "Pts", getValue: (p) => p.totalPoints, getClass: "text-white font-semibold" },
  ];

  switch (positionId) {
    case 1: // GKP
      return [
        ...common,
        { key: "svP90", label: "Sv/90", title: "Saves per 90", getValue: (p) => p.svP90.toFixed(1), getClass: "text-sky-300" },
        { key: "penaltiesSaved", label: "PS", title: "Penalties Saved", getValue: (p) => p.penaltiesSaved, getClass: "text-emerald-300" },
        ...defensive,
        { key: "bpsP90", label: "BPS/90", title: "BPS per 90", getValue: (p) => p.bpsP90.toFixed(1), getClass: "text-yellow-300" },
        ...tail,
      ];
    case 2: // DEF
      return [
        ...common,
        ...defensive,
        ...attacking,
        ...process,
        ...tail,
      ];
    case 3: // MID
      return [
        ...common,
        ...attacking,
        ...defensive,
        ...process,
        ...tail,
      ];
    case 4: // FWD
    default:
      return [
        ...common,
        ...attacking,
        ...process,
        { key: "xGIp90", label: "xGI/90", title: "Expected Goal Involvements per 90", getValue: (p) => p.xGIp90.toFixed(2), getClass: "text-cyan-300" },
        { key: "bonus", label: "Bon", title: "Bonus Points", getValue: (p) => p.bonus, getClass: "text-yellow-300" },
        ...tail,
      ];
  }
}

function getNumericValue(p: AnalyticsPlayer, key: string): number {
  switch (key) {
    case "xPts": return p.xPts;
    case "totalPoints": return p.totalPoints;
    case "price": return p.price;
    case "starts": return p.starts;
    case "minutes": return p.minutes;
    case "xGp90": return p.xGp90;
    case "goalsp90": return p.goalsp90;
    case "xAp90": return p.xAp90;
    case "assistsp90": return p.assistsp90;
    case "xGIp90": return p.xGIp90;
    case "xGCp90": return p.xGCp90;
    case "kpP90": return p.kpP90;
    case "bpsP90": return p.bpsP90;
    case "dcP90": return p.dcP90;
    case "csp90": return p.csp90;
    case "gcp90": return p.gcp90;
    case "svP90": return p.svP90;
    case "penaltiesSaved": return p.penaltiesSaved;
    case "bonus": return p.bonus;
    case "form": return parseFloat(p.form || "0");
    case "ownership": return parseFloat(p.ownership || "0");
    default: return 0;
  }
}

// ---------- Main Component ----------

export default function AnalyticsTable({
  players,
  upcomingGWs,
  squadIds,
  positionId,
  range = "season",
  onRangeChange,
}: {
  players: AnalyticsPlayer[];
  upcomingGWs: number[];
  squadIds: Set<number>;
  positionId: number;
  range?: "season" | "last5";
  onRangeChange?: (range: "season" | "last5") => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("xPts");
  const [sortAsc, setSortAsc] = useState(false);
  const [verdictFilter, setVerdictFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [squadOnly, setSquadOnly] = useState(false);

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  }

  const columns = getColumnsForPosition(positionId);

  const filtered = players
    .filter((p) => {
      if (verdictFilter !== "ALL" && p.verdict !== verdictFilter) return false;
      if (squadOnly && !squadIds.has(p.id)) return false;
      if (searchQuery && !p.webName.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      return true;
    })
    .sort((a, b) => {
      const diff = getNumericValue(a, sortKey) - getNumericValue(b, sortKey);
      return sortAsc ? diff : -diff;
    });

  const keepPlayers = filtered.filter((p) => p.verdict === "KEEP");
  const monitorPlayers = filtered.filter((p) => p.verdict === "MONITOR");
  const sellPlayers = filtered.filter((p) => p.verdict === "SELL");

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Search player..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="px-3 py-1.5 rounded-lg bg-[#0d1117] border border-[#2a2f3a] text-slate-50 placeholder-slate-600 focus:outline-none focus:border-purple-500 text-sm w-44"
        />
        <div className="flex gap-0.5 bg-[#0d1117] rounded-lg p-0.5">
          {["ALL", "KEEP", "MONITOR", "SELL"].map((v) => (
            <button
              key={v}
              onClick={() => setVerdictFilter(v)}
              className={`px-2.5 py-1 rounded-md text-xs font-bold transition-colors ${
                verdictFilter === v
                  ? v === "KEEP" ? "bg-emerald-600 text-white"
                    : v === "MONITOR" ? "bg-amber-600 text-white"
                    : v === "SELL" ? "bg-red-600 text-white"
                    : "bg-[#2a2f3a] text-white"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
        {squadIds.size > 0 && (
          <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={squadOnly}
              onChange={(e) => setSquadOnly(e.target.checked)}
              className="rounded border-slate-700 bg-[#0d1117]"
            />
            My Squad
          </label>
        )}

        {/* Range toggle: Season vs Last 5 */}
        {onRangeChange && (
          <div className="flex gap-0.5 bg-[#0d1117] rounded-lg p-0.5 ml-1">
            <button
              onClick={() => onRangeChange("season")}
              className={`px-2.5 py-1 rounded-md text-xs font-bold transition-colors ${
                range === "season" ? "bg-purple-600 text-white" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              Season
            </button>
            <button
              onClick={() => onRangeChange("last5")}
              className={`px-2.5 py-1 rounded-md text-xs font-bold transition-colors ${
                range === "last5" ? "bg-purple-600 text-white" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              Last 5
            </button>
          </div>
        )}

        <span className="text-slate-600 text-xs ml-auto">
          {filtered.length} players
          {range === "last5" && <span className="text-purple-400 ml-1">(Last 5 GWs)</span>}
        </span>
      </div>

      {/* Tables by verdict */}
      {verdictFilter === "ALL" ? (
        <>
          {keepPlayers.length > 0 && <VerdictTable label="KEEP" players={keepPlayers} columns={columns} upcomingGWs={upcomingGWs} squadIds={squadIds} sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} />}
          {monitorPlayers.length > 0 && <VerdictTable label="MONITOR" players={monitorPlayers} columns={columns} upcomingGWs={upcomingGWs} squadIds={squadIds} sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} />}
          {sellPlayers.length > 0 && <VerdictTable label="SELL" players={sellPlayers} columns={columns} upcomingGWs={upcomingGWs} squadIds={squadIds} sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} />}
        </>
      ) : (
        <VerdictTable label={verdictFilter as "KEEP" | "MONITOR" | "SELL"} players={filtered} columns={columns} upcomingGWs={upcomingGWs} squadIds={squadIds} sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} />
      )}

      {/* Key */}
      <TableKey positionId={positionId} />
    </div>
  );
}

// ---------- Verdict Table ----------

function VerdictTable({
  label,
  players,
  columns,
  upcomingGWs,
  squadIds,
  sortKey,
  sortAsc,
  onSort,
}: {
  label: "KEEP" | "MONITOR" | "SELL";
  players: AnalyticsPlayer[];
  columns: ColDef[];
  upcomingGWs: number[];
  squadIds: Set<number>;
  sortKey: SortKey;
  sortAsc: boolean;
  onSort: (key: SortKey) => void;
}) {
  const colors = {
    KEEP:    { border: "border-emerald-800", headerBg: "bg-emerald-900/30", badge: "bg-emerald-600" },
    MONITOR: { border: "border-amber-800",   headerBg: "bg-amber-900/30",   badge: "bg-amber-600" },
    SELL:    { border: "border-red-800",     headerBg: "bg-red-900/30",     badge: "bg-red-600" },
  };
  const c = colors[label];

  return (
    <div className={`rounded-lg border ${c.border} overflow-hidden`}>
      <div className={`px-3 py-2 ${c.headerBg} flex items-center gap-2`}>
        <span className={`px-2 py-0.5 rounded text-[10px] font-bold text-white ${c.badge}`}>{label}</span>
        <span className="text-slate-500 text-xs">{players.length} player{players.length !== 1 ? "s" : ""}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12px] whitespace-nowrap">
          <thead>
            <tr>
              <th className="at-th at-th-sticky">Player</th>
              <th className="at-th">Team</th>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className="at-th at-th-sort"
                  onClick={() => onSort(col.key)}
                  title={col.title}
                >
                  {col.label}
                  {sortKey === col.key && <span className="text-purple-400 ml-0.5 text-[9px]">{sortAsc ? "\u25B2" : "\u25BC"}</span>}
                </th>
              ))}
              {upcomingGWs.map((gw) => (
                <th key={gw} className="at-th text-center">GW{gw}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {players.map((p) => (
              <PlayerRow key={p.id} player={p} columns={columns} upcomingGWs={upcomingGWs} isInSquad={squadIds.has(p.id)} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- Player Row ----------

function PlayerRow({ player: p, columns, upcomingGWs, isInSquad }: {
  player: AnalyticsPlayer;
  columns: ColDef[];
  upcomingGWs: number[];
  isInSquad: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <tr className={`at-row ${isInSquad ? "at-row-squad" : ""}`} onClick={() => setOpen(!open)}>
        <td className="at-td at-td-sticky">
          <div className="flex items-center gap-1">
            <span className="text-white font-medium">{p.webName}</span>
            {isInSquad && <span className="at-icon bg-indigo-600">S</span>}
            {p.isDifferential && <span className="at-icon bg-purple-600" title="Differential">D</span>}
            {p.isRotationRisk && <span className="at-icon bg-amber-600" title="Rotation risk">R</span>}
            {p.isMaybeUnavailable && <span className="at-icon bg-yellow-500 text-black" title="Doubtful">?</span>}
            {p.isUnavailable && <span className="at-icon bg-red-600" title="Unavailable">X</span>}
          </div>
        </td>
        <td className="at-td text-slate-500">{p.teamShort}</td>
        {columns.map((col) => (
          <td key={col.key} className={`at-td ${col.getClass || "text-slate-300"}`}>
            {col.getValue(p)}
          </td>
        ))}
        {upcomingGWs.map((gw) => {
          const fix = p.upcomingFixtures.find((f) => f.gw === gw);
          if (!fix || fix.opponent === "-") return <td key={gw} className="at-td text-center text-slate-700">-</td>;
          return (
            <td key={gw} className="at-td text-center">
              <span className={`at-fdr at-fdr-${fix.difficulty}`} title={`${fix.isHome ? "H" : "A"} vs ${fix.opponent} (FDR ${fix.difficulty})`}>
                {fix.opponent}{fix.isHome ? "(H)" : "(A)"}
              </span>
            </td>
          );
        })}
      </tr>
      {open && p.verdictReasons.length > 0 && (
        <tr>
          <td colSpan={100} className="px-3 py-1.5 text-[11px] text-slate-500 bg-[#0a0e14]">
            <strong className="text-slate-400">{p.verdict}:</strong> {p.verdictReasons.join(" | ")}
          </td>
        </tr>
      )}
    </>
  );
}

// ---------- Table Key ----------

function TableKey({ positionId }: { positionId: number }) {
  return (
    <div className="bg-[#0d1117] rounded-lg border border-[#1e2530] p-3 text-[11px]">
      <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-slate-400">
        <span className="flex items-center gap-1.5"><span className="at-icon bg-purple-600">D</span> Differential (&lt;10%)</span>
        <span className="flex items-center gap-1.5"><span className="at-icon bg-amber-600">R</span> Rotation risk</span>
        <span className="flex items-center gap-1.5"><span className="at-icon bg-yellow-500 text-black">?</span> Doubtful</span>
        <span className="flex items-center gap-1.5"><span className="at-icon bg-red-600">X</span> Unavailable</span>
        <span className="flex items-center gap-1.5"><span className="at-icon bg-indigo-600">S</span> In your squad</span>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2 text-slate-500">
        <span className="font-medium text-slate-400">All stats are per 90 minutes</span>
        <span><strong className="text-violet-300">KP/90</strong> = Key Passes (chance creation)</span>
        <span><strong className="text-yellow-300">BPS/90</strong> = Bonus Point System score</span>
        <span><strong className="text-amber-300">EO%</strong> = Effective Ownership</span>
        {(positionId === 1 || positionId === 2 || positionId === 3) && (
          <>
            <span><strong className="text-blue-300">DC/90</strong> = Defensive Contribution</span>
            <span><strong className="text-red-300">GC/90</strong> = Goals Conceded</span>
            <span><strong className="text-emerald-300">CS/90</strong> = Clean Sheets</span>
            <span><strong className="text-red-300">xGC/90</strong> = Expected Goals Conceded</span>
          </>
        )}
        {positionId === 4 && (
          <span><strong className="text-cyan-300">xGI/90</strong> = Expected Goal Involvements</span>
        )}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
        {[1,2,3,4,5].map((d) => (
          <span key={d} className="flex items-center gap-1">
            <span className={`w-2.5 h-2.5 rounded-sm at-fdr-${d}`} />
            <span className="text-slate-600">{d === 1 ? "Easy" : d === 2 ? "Fair" : d === 3 ? "Medium" : d === 4 ? "Hard" : "Very Hard"}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
