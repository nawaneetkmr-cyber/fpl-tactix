"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import FixtureDifficultyGrid from "@/components/FixtureDifficultyGrid";
import PitchView from "@/components/PitchView";
import {
  buildFixtureDifficultyGrid,
  suggestNextGWCaptain,
  FPLFixture,
  FixtureDifficultyRow,
} from "@/lib/projections";
import type { FullElement, TeamStrength, FixtureDetail } from "@/lib/xpts";

// ---------- Types ----------

interface EnrichedPick {
  element: number;
  position: number;
  multiplier: number;
  isCaptain: boolean;
  isViceCaptain: boolean;
  webName: string;
  teamId: number;
  elementType: number;
  points: number;
  minutes: number;
  isPlaying: boolean;
  isFinished: boolean;
}

interface MilpPlayer {
  id: number;
  name: string;
  team: string;
  position: string;
  now_cost: number;
  selling_price: number;
  xP: number;
  ownership_percent: number;
}

interface MilpOptimization {
  status: string;
  transfers_in: MilpPlayer[];
  transfers_out: MilpPlayer[];
  starters: MilpPlayer[];
  bench: MilpPlayer[];
  captain: MilpPlayer | null;
  total_xp: number;
  hit_cost: number;
  net_xp: number;
  current_team_xp: number;
  net_improvement: number;
  budget_used: number;
  budget_available: number;
  should_roll: boolean;
  safety_score: number;
}

interface DashboardData {
  teamName: string;
  playerName: string;
  gameweek: number;
  livePoints: number;
  benchPoints: number;
  captainPoints: number;
  bestCaptain: { id: number | null; points: number };
  estimatedLiveRank: number;
  averageScore: number;
  totalPlayers: number;
  prevOverallRank: number | null;
  milpOptimization: MilpOptimization | null;
  picks: EnrichedPick[];
  elements: { id: number; web_name: string; team: number; element_type: number }[];
  teams: { id: number; name: string; shortName: string }[];
  error?: string;
}

interface BootstrapElement {
  id: number;
  web_name: string;
  team: number;
  element_type: number;
  selected_by_percent: string;
  form: string;
  photo: string;
  now_cost: number;
}

interface BootstrapTeam {
  id: number;
  name: string;
  short_name: string;
  code: number;
}

// ---------- Main Dashboard Wrapper ----------

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="spinner" />
        </div>
      }
    >
      <DashboardInner />
    </Suspense>
  );
}

// ---------- Dashboard Inner ----------

function DashboardInner() {
  const searchParams = useSearchParams();
  const teamIdParam = searchParams.get("teamId");
  const [teamId, setTeamId] = useState(teamIdParam || "");
  const [inputId, setInputId] = useState(teamIdParam || "");
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  // Bootstrap data for pitch and projections
  const [bootstrapElements, setBootstrapElements] = useState<BootstrapElement[]>([]);
  const [bootstrapTeams, setBootstrapTeams] = useState<BootstrapTeam[]>([]);
  const [fixtureRows, setFixtureRows] = useState<FixtureDifficultyRow[]>([]);
  const [fixturesLoading, setFixturesLoading] = useState(true);

  // Captain suggestions
  const [captainSuggestions, setCaptainSuggestions] = useState<
    { element: number; webName: string; xPts: number; fixtureLabel: string }[]
  >([]);
  const [captainGW, setCaptainGW] = useState<number | null>(null);


  const fetchData = useCallback(async (id: string) => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/fpl/summary?teamId=${id}`);
      const json = await res.json();
      if (json.error) {
        setData({ error: json.error } as DashboardData);
      } else {
        setData(json);
        setLastUpdate(new Date());
      }
    } catch (e) {
      setData({ error: String(e) } as DashboardData);
    }
    setLoading(false);
  }, []);

  // Initial fetch
  useEffect(() => {
    if (teamId) fetchData(teamId);
  }, [teamId, fetchData]);

  // Auto-refresh every 45 seconds
  useEffect(() => {
    if (!teamId) return;
    const interval = setInterval(() => fetchData(teamId), 45000);
    return () => clearInterval(interval);
  }, [teamId, fetchData]);

  // Fetch bootstrap/fixture data + run transfer brain
  useEffect(() => {
    if (!data || data.error) return;

    let cancelled = false;
    const gameweek = data.gameweek;
    const picks = data.picks;

    async function fetchFixtureData() {
      try {
        const res = await fetch("/api/fpl/bootstrap");
        const bootstrap = await res.json();

        if (cancelled) return;

        if (!bootstrap.ok) {
          setFixturesLoading(false);
          return;
        }

        // Store bootstrap data
        setBootstrapElements(bootstrap.elements || []);
        setBootstrapTeams(bootstrap.teams || []);

        const fixtureData: FixtureDetail[] = (bootstrap.fixtures || [])
          .filter((f: FPLFixture) => f.event != null && f.event > 0)
          .map((f: FPLFixture) => ({
            id: f.id,
            event: f.event,
            team_h: f.team_h,
            team_a: f.team_a,
            team_h_difficulty: f.team_h_difficulty,
            team_a_difficulty: f.team_a_difficulty,
            finished: f.finished,
            started: f.started,
          }));

        const teams: TeamStrength[] = (bootstrap.teams || []).map(
          (t: {
            id: number;
            name: string;
            short_name: string;
            strength_attack_home: number;
            strength_attack_away: number;
            strength_defence_home: number;
            strength_defence_away: number;
            strength_overall_home: number;
            strength_overall_away: number;
          }) => ({
            id: t.id,
            name: t.name,
            short_name: t.short_name,
            strength_attack_home: t.strength_attack_home,
            strength_attack_away: t.strength_attack_away,
            strength_defence_home: t.strength_defence_home,
            strength_defence_away: t.strength_defence_away,
            strength_overall_home: t.strength_overall_home,
            strength_overall_away: t.strength_overall_away,
          })
        );

        const currentGW = bootstrap.currentGW || gameweek;

        // Build fixture difficulty grid
        const fplFixtures: FPLFixture[] = (bootstrap.fixtures || [])
          .filter((f: FPLFixture) => f.event != null && f.event > 0);
        const fplTeams = (bootstrap.teams || []).map(
          (t: { id: number; name: string; short_name: string }) => ({
            id: t.id,
            name: t.name,
            short_name: t.short_name,
          })
        );
        const rows = buildFixtureDifficultyGrid(fplFixtures, fplTeams, currentGW, 10);
        setFixtureRows(rows);

        // Build full element array for projections
        const squadIds = picks.map((p) => p.element);
        const allPlayers: FullElement[] = (bootstrap.elements || []).map(
          (e: FullElement) => ({
            id: e.id,
            web_name: e.web_name,
            team: e.team,
            element_type: e.element_type,
            status: e.status,
            now_cost: e.now_cost,
            form: e.form,
            points_per_game: e.points_per_game,
            selected_by_percent: e.selected_by_percent,
            minutes: e.minutes,
            goals_scored: e.goals_scored,
            assists: e.assists,
            clean_sheets: e.clean_sheets,
            goals_conceded: e.goals_conceded,
            bonus: e.bonus,
            influence: e.influence,
            creativity: e.creativity,
            threat: e.threat,
            ict_index: e.ict_index,
            expected_goals: e.expected_goals,
            expected_assists: e.expected_assists,
            expected_goal_involvements: e.expected_goal_involvements,
            expected_goals_conceded: e.expected_goals_conceded,
            starts: e.starts,
            chance_of_playing_next_round: e.chance_of_playing_next_round,
            total_points: e.total_points,
            event_points: e.event_points,
          })
        );

        // Captain suggestions
        const { suggestions, nextGW } = suggestNextGWCaptain(
          squadIds,
          allPlayers,
          fixtureData,
          teams,
          currentGW
        );
        setCaptainSuggestions(suggestions);
        setCaptainGW(nextGW);

      } catch {
        // Silent fail
      }
      if (!cancelled) setFixturesLoading(false);
    }

    fetchFixtureData();
    return () => {
      cancelled = true;
    };
  }, [data]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const id = inputId.trim();
    if (id && !isNaN(Number(id))) {
      setTeamId(id);
    }
  }

  // No team ID - show input
  if (!teamId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
        <h1 className="text-3xl font-bold text-slate-50 mb-2">FPL Tactix</h1>
        <p className="text-slate-400 mb-8 text-center">
          Enter your FPL Team ID to view your dashboard
        </p>
        <form onSubmit={handleSubmit} className="flex gap-3 w-full max-w-sm">
          <input
            type="text"
            inputMode="numeric"
            placeholder="Team ID (e.g. 123456)"
            value={inputId}
            onChange={(e) => setInputId(e.target.value)}
            className="flex-1 px-4 py-3 rounded-lg bg-slate-800 border border-slate-700 text-slate-50 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
          />
          <button
            type="submit"
            className="px-6 py-3 rounded-lg bg-emerald-600 text-white font-semibold hover:bg-emerald-500 transition-colors"
          >
            Go
          </button>
        </form>
        <p className="text-slate-500 text-sm mt-4">
          Find your Team ID in the FPL app under Points → URL
        </p>
      </div>
    );
  }

  // Loading state
  if (loading && !data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <div className="spinner mb-4" />
        <p className="text-slate-400">Loading live data...</p>
      </div>
    );
  }

  // Error state
  if (data?.error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <p className="text-red-400 mb-4">Error: {data.error}</p>
        <button
          onClick={() => fetchData(teamId)}
          className="px-4 py-2 rounded-lg bg-slate-700 text-slate-50 hover:bg-slate-600"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  // Calculate stats
  const rankChange = data.prevOverallRank
    ? data.prevOverallRank - data.estimatedLiveRank
    : null;
  const rankChangePercent =
    data.prevOverallRank && rankChange
      ? ((rankChange / data.prevOverallRank) * 100).toFixed(1)
      : null;

  // Safety score: points threshold from solver (sum of xP * ownership%)
  // This is the "green arrow line" — score above this to climb rank
  const safetyScore = data.milpOptimization?.safety_score ?? data.averageScore;
  const aboveSafety = data.livePoints >= safetyScore;
  const safetyDelta = rankChange !== null
    ? (rankChange > 0 ? "up" : rankChange < 0 ? "down" : "flat")
    : null;

  const squadTeamIds = [...new Set(data.picks.map((p) => p.teamId).filter((id) => id > 0))];

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-8 bg-slate-950 min-h-screen">
      {/* ===== HEADER ===== */}
      <header className="sticky top-0 z-20 -mx-4 px-4 py-4 bg-slate-950/95 backdrop-blur border-b border-slate-700">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-50">{data.teamName}</h1>
            <p className="text-slate-400 text-sm">{data.playerName}</p>
          </div>
          <div className="flex items-center gap-6 text-sm">
            <div className="text-center">
              <div className="text-slate-400">GW{data.gameweek}</div>
              <div className="text-xl font-bold text-emerald-400">{data.livePoints}</div>
            </div>
            <div className="text-center">
              <div className="text-slate-400">Rank</div>
              <div className="text-xl font-bold text-slate-50">{formatRank(data.estimatedLiveRank)}</div>
            </div>
            {rankChange !== null && (
              <div className="text-center">
                <div className="text-slate-400">Change</div>
                <div
                  className={`text-lg font-semibold ${
                    rankChange > 0 ? "text-emerald-400" : rankChange < 0 ? "text-red-400" : "text-slate-400"
                  }`}
                >
                  {rankChange > 0 ? "+" : ""}
                  {formatRank(rankChange)}
                </div>
              </div>
            )}
            <div className="flex items-center gap-2">
              {loading && <div className="spinner w-4 h-4" />}
              <span className="px-2 py-1 rounded text-xs font-semibold bg-emerald-600 text-white animate-pulse">
                LIVE
              </span>
              {lastUpdate && (
                <span className="text-slate-500 text-xs">
                  {lastUpdate.toLocaleTimeString()}
                </span>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* ===== SECTION 1: PITCH VISUALIZATION ===== */}
      <section>
        <PitchView
          picks={data.picks}
          elements={bootstrapElements.map((e) => ({
            id: e.id,
            web_name: e.web_name,
            team: e.team,
            element_type: e.element_type,
            selected_by_percent: e.selected_by_percent,
            form: e.form,
            photo: e.photo || "",
          }))}
          teams={bootstrapTeams.map((t) => ({
            id: t.id,
            name: t.name,
            short_name: t.short_name,
            code: t.code,
          }))}
        />
      </section>

      {/* ===== SECTION 2: QUICK STATS ===== */}
      <section>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="GW Live Points"
            value={data.livePoints}
            sublabel={
              data.livePoints >= data.averageScore
                ? `+${data.livePoints - data.averageScore} above avg`
                : `${data.livePoints - data.averageScore} below avg`
            }
            accent={data.livePoints >= data.averageScore}
          />
          <StatCard
            label="GW Average"
            value={data.averageScore}
          />
          <StatCard
            label="Overall Rank"
            value={formatRank(data.estimatedLiveRank)}
            sublabel={
              rankChangePercent
                ? `${rankChange! > 0 ? "+" : ""}${rankChangePercent}%`
                : undefined
            }
          />
          {/* Safety Score: points threshold to stay green */}
          <div className="p-4 rounded-xl bg-gradient-to-br from-slate-900 to-slate-800 border border-slate-700">
            <div className="text-sm text-slate-400 uppercase tracking-wider mb-1">
              Safety Line
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-3xl font-bold ${
                aboveSafety ? "text-emerald-400" : "text-red-400"
              }`}>
                {safetyScore}
              </span>
              <span className="text-xs text-slate-500">pts</span>
              {safetyDelta === "up" && (
                <span className="text-emerald-400 text-lg" title="Rank improved this GW">▲</span>
              )}
              {safetyDelta === "down" && (
                <span className="text-red-400 text-lg" title="Rank declined this GW">▼</span>
              )}
              {safetyDelta === "flat" && (
                <span className="text-slate-500 text-lg" title="Unchanged">—</span>
              )}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              {aboveSafety
                ? `You're ${data.livePoints - safetyScore} above — green arrow`
                : `Need ${safetyScore - data.livePoints} more — red arrow zone`}
            </div>
          </div>
        </div>
      </section>

      {/* ===== SECTION 3: TRANSFER BRAIN (MILP) ===== */}
      <section className="bg-slate-900 rounded-xl border border-slate-700 p-6">
        <h2 className="text-2xl font-bold text-slate-50 mb-2">
          Transfer Brain
        </h2>
        <p className="text-sm text-slate-400 mb-6">
          MILP-optimized transfers with budget, formation &amp; hit-cost constraints
        </p>

        {!data.milpOptimization ? (
          <p className="text-slate-500 py-4">Optimizer not available for this gameweek.</p>
        ) : (data.milpOptimization as unknown as Record<string, unknown>).error ? (
          <div className="bg-red-900/20 rounded-lg p-4 border border-red-700/40">
            <p className="text-red-400 font-medium">Solver error</p>
            <p className="text-red-300/70 text-xs mt-1 font-mono break-all">
              {String((data.milpOptimization as unknown as Record<string, unknown>).error)}
            </p>
          </div>
        ) : data.milpOptimization.status !== "Optimal" ? (
          <p className="text-red-400 py-4">Solver status: {data.milpOptimization.status}</p>
        ) : data.milpOptimization.transfers_in.length === 0 ? (
          <div className="bg-slate-800 rounded-lg p-5 border border-emerald-700/40">
            <p className="text-emerald-400 font-semibold text-lg">No transfers needed</p>
            <p className="text-slate-400 text-sm mt-1">
              Your squad is already optimal — save the free transfer for next week.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Verdict banner */}
            <div className={`rounded-lg p-4 border ${
              data.milpOptimization.should_roll
                ? "bg-amber-900/20 border-amber-700/40"
                : "bg-emerald-900/20 border-emerald-700/40"
            }`}>
              <div className="flex items-center gap-3 mb-1">
                <span className={`text-lg font-bold ${
                  data.milpOptimization.should_roll ? "text-amber-400" : "text-emerald-400"
                }`}>
                  {data.milpOptimization.should_roll ? "ROLL TRANSFER" : "MAKE TRANSFER"}
                </span>
                <span className={`text-sm font-medium px-2 py-0.5 rounded ${
                  data.milpOptimization.net_improvement > 0
                    ? "bg-emerald-600/20 text-emerald-400 border border-emerald-500/30"
                    : "bg-red-600/20 text-red-400 border border-red-500/30"
                }`}>
                  {data.milpOptimization.net_improvement > 0 ? "+" : ""}
                  {data.milpOptimization.net_improvement} xPts net gain
                </span>
              </div>
              {data.milpOptimization.should_roll && (
                <p className="text-amber-300/70 text-sm">
                  Best possible move is below the 2.0pt threshold — save your FT.
                </p>
              )}
              <div className="flex gap-4 mt-2 text-xs text-slate-400">
                <span>Current: {data.milpOptimization.current_team_xp} xP</span>
                <span>→</span>
                <span>Optimized: {data.milpOptimization.total_xp} xP</span>
                {data.milpOptimization.hit_cost > 0 && (
                  <span className="text-red-400">-{data.milpOptimization.hit_cost} hit cost</span>
                )}
              </div>
            </div>

            {/* Transfer cards */}
            {data.milpOptimization.transfers_out.map((pOut, idx) => {
              const pIn = data.milpOptimization!.transfers_in[idx];
              if (!pIn) return null;
              return (
                <div
                  key={`${pOut.id}-${pIn.id}`}
                  className="bg-slate-800 rounded-lg p-4 border border-slate-700"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded bg-red-600/20 text-red-400 border border-red-500/30">
                      SELL
                    </span>
                    <span className="text-slate-50 font-medium">{pOut.name}</span>
                    <span className="text-slate-500 text-sm">({pOut.team})</span>
                    <span className="text-slate-500 text-sm">{pOut.position}</span>
                    <span className="text-slate-400 text-sm">£{pOut.selling_price.toFixed(1)}m</span>
                    <span className="text-slate-500 text-sm">{pOut.xP.toFixed(1)} xP</span>

                    <span className="text-slate-600 mx-1">→</span>

                    <span className="text-xs font-semibold px-2 py-0.5 rounded bg-emerald-600/20 text-emerald-400 border border-emerald-500/30">
                      BUY
                    </span>
                    <span className="text-slate-50 font-medium">{pIn.name}</span>
                    <span className="text-slate-500 text-sm">({pIn.team})</span>
                    <span className="text-slate-500 text-sm">{pIn.position}</span>
                    <span className="text-slate-400 text-sm">£{pIn.now_cost.toFixed(1)}m</span>
                    <span className="text-emerald-400 text-sm font-semibold">{pIn.xP.toFixed(1)} xP</span>
                  </div>

                  <div className="flex items-center gap-4 text-sm mt-3">
                    <span className="text-emerald-400 font-semibold">
                      +{(pIn.xP - pOut.xP).toFixed(1)} xPts gain
                    </span>
                    {pIn.now_cost > pOut.selling_price ? (
                      <span className="text-amber-400">
                        -£{(pIn.now_cost - pOut.selling_price).toFixed(1)}m extra
                      </span>
                    ) : pIn.now_cost < pOut.selling_price ? (
                      <span className="text-emerald-400">
                        +£{(pOut.selling_price - pIn.now_cost).toFixed(1)}m saved
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}

            {/* Budget summary */}
            <div className="flex gap-4 text-sm text-slate-400 pt-2">
              <span>Budget: £{data.milpOptimization.budget_available.toFixed(1)}m</span>
              <span>Spent: £{data.milpOptimization.budget_used.toFixed(1)}m</span>
              <span className="text-slate-50 font-medium">
                Remaining: £{(data.milpOptimization.budget_available - data.milpOptimization.budget_used).toFixed(1)}m
              </span>
            </div>

            {/* Optimized lineup preview */}
            {data.milpOptimization.captain && (
              <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50 mt-2">
                <div className="text-xs text-slate-400 uppercase tracking-wider mb-2">Optimized XI Captain</div>
                <span className="text-slate-50 font-semibold">
                  {data.milpOptimization.captain.name}
                </span>
                <span className="text-slate-400 ml-2 text-sm">
                  ({data.milpOptimization.captain.team}) — {data.milpOptimization.captain.xP.toFixed(1)} xP × 2
                </span>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ===== SECTION 4: CAPTAIN PICK ===== */}
      <section className="bg-slate-900 rounded-xl border border-slate-700 p-6">
        <h2 className="text-2xl font-bold text-slate-50 mb-6">
          Captain Pick (GW{captainGW ?? data.gameweek})
        </h2>
        {fixturesLoading ? (
          <div className="flex justify-center py-8">
            <div className="spinner" />
          </div>
        ) : captainSuggestions.length > 0 ? (
          <div className="space-y-3">
            {captainSuggestions.map((s, idx) => (
              <div
                key={s.element}
                className={`flex items-center justify-between p-4 rounded-lg ${
                  idx === 0
                    ? "bg-gradient-to-r from-emerald-900/40 to-emerald-800/10 border border-emerald-700"
                    : "bg-slate-800"
                }`}
              >
                <div className="flex items-center gap-4">
                  <span
                    className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${
                      idx === 0
                        ? "bg-emerald-500 text-black"
                        : idx === 1
                          ? "bg-slate-400 text-black"
                          : "bg-amber-700 text-white"
                    }`}
                  >
                    {idx + 1}
                  </span>
                  <div>
                    <div className="font-semibold text-slate-50">{s.webName}</div>
                    <div className="text-sm text-slate-400">{s.fixtureLabel}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div
                    className={`text-xl font-bold ${
                      idx === 0 ? "text-emerald-400" : "text-slate-50"
                    }`}
                  >
                    {s.xPts.toFixed(1)}
                  </div>
                  <div className="text-xs text-slate-500">xPts</div>
                </div>
                {idx === 0 && (
                  <span className="ml-4 px-2 py-1 rounded text-xs font-semibold bg-emerald-600 text-white">
                    Best Pick
                  </span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-slate-500 py-4">No captain suggestions available</p>
        )}
      </section>

      {/* ===== SECTION 5: FIXTURE DIFFICULTY GRID ===== */}
      <section className="bg-slate-900 rounded-xl border border-slate-700 p-6">
        <h2 className="text-2xl font-bold text-slate-50 mb-6">
          Fixture Difficulty (Next 10 GWs)
        </h2>
        {fixturesLoading ? (
          <div className="flex justify-center py-8">
            <div className="spinner" />
          </div>
        ) : fixtureRows.length > 0 ? (
          <FixtureDifficultyGrid
            rows={fixtureRows}
            currentGW={data.gameweek}
            numGWs={10}
            highlightTeamIds={squadTeamIds}
          />
        ) : (
          <p className="text-slate-500 py-4">Unable to load fixture data</p>
        )}
      </section>
    </div>
  );
}

// ---------- Stat Card Component ----------

function StatCard({
  label,
  value,
  sublabel,
  accent,
}: {
  label: string;
  value: string | number;
  sublabel?: string;
  accent?: boolean;
}) {
  return (
    <div className="p-4 rounded-xl bg-gradient-to-br from-slate-900 to-slate-800 border border-slate-700">
      <div className="text-sm text-slate-400 uppercase tracking-wider mb-1">
        {label}
      </div>
      <div
        className={`text-3xl font-bold ${accent ? "text-emerald-400" : "text-slate-50"}`}
      >
        {value}
      </div>
      {sublabel && <div className="text-xs text-slate-500 mt-1">{sublabel}</div>}
    </div>
  );
}

// ---------- Utility Functions ----------

function formatRank(rank: number): string {
  if (rank === 0) return "-";
  if (Math.abs(rank) >= 1_000_000) return `${(rank / 1_000_000).toFixed(1)}M`;
  if (Math.abs(rank) >= 1_000) return `${(rank / 1_000).toFixed(0)}K`;
  return rank.toLocaleString();
}

