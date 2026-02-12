"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import FixtureDifficultyGrid from "@/components/FixtureDifficultyGrid";
import PitchView from "@/components/PitchView";
import AnalyticsTable from "@/components/AnalyticsTable";
import type { AnalyticsPlayer } from "@/components/AnalyticsTable";
import {
  buildFixtureDifficultyGrid,
  suggestNextGWCaptain,
  FPLFixture,
  FixtureDifficultyRow,
} from "@/lib/projections";
import type { FullElement, TeamStrength, FixtureDetail } from "@/lib/xpts";
import { calculatePlayerProjections } from "@/lib/xpts";
import type { PlayerProjection as XPtsProjection } from "@/lib/xpts";

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

interface SafetyScoreData {
  safetyScore: number;
  rankTier: string;
  tierLabel: string;
  delta: number;
  arrow: "green" | "red" | "neutral";
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
  safetyScore?: SafetyScoreData;
  picks: EnrichedPick[];
  elements: { id: number; web_name: string; team: number; element_type: number }[];
  teams: { id: number; name: string; shortName: string }[];
  bank?: number;
  freeTransfers?: number;
  chipsUsed?: string[];
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

  // Analytics section state
  const [analyticsPlayers, setAnalyticsPlayers] = useState<AnalyticsPlayer[]>([]);
  const [analyticsUpcomingGWs, setAnalyticsUpcomingGWs] = useState<number[]>([]);
  const [analyticsSquadIds, setAnalyticsSquadIds] = useState<Set<number>>(new Set());
  const [analyticsPosition, setAnalyticsPosition] = useState<number>(4);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  // GW Planner state
  const [plannerProjections, setPlannerProjections] = useState<XPtsProjection[]>([]);
  const [plannerAllPlayers, setPlannerAllPlayers] = useState<FullElement[]>([]);
  const [plannerFixtures, setPlannerFixtures] = useState<FixtureDetail[]>([]);
  const [plannerTeams, setPlannerTeams] = useState<TeamStrength[]>([]);
  const [plannerNextGW, setPlannerNextGW] = useState<number | null>(null);

  // Planner transfer simulation state
  interface PlannerTransfer { outId: number; inId: number; }
  const [plannerTransfers, setPlannerTransfers] = useState<PlannerTransfer[]>([]);
  const [plannerSelectedSlot, setPlannerSelectedSlot] = useState<number | null>(null); // element id of player being swapped
  const [plannerCaptainId, setPlannerCaptainId] = useState<number | null>(null);
  const [simulationResult, setSimulationResult] = useState<{
    totalXPts: number;
    startingXPts: number;
    captainName: string;
    captainXPts: number;
    pros: string[];
    cons: string[];
    benchXPts: number;
    hitCost: number;
    netXPts: number;
  } | null>(null);
  const [simulating, setSimulating] = useState(false);

  const fetchAnalytics = useCallback(async (pos: number, tid: string) => {
    setAnalyticsLoading(true);
    try {
      const params = new URLSearchParams({ position: String(pos) });
      if (tid) params.set("teamId", tid);
      const res = await fetch(`/api/fpl/analytics?${params}`);
      const json = await res.json();
      if (json.ok) {
        setAnalyticsPlayers(json.players);
        setAnalyticsUpcomingGWs(json.upcomingGWs);
        setAnalyticsSquadIds(new Set(json.squadIds));
      }
    } catch { /* silent */ }
    setAnalyticsLoading(false);
  }, []);

  // Fetch analytics when position changes or data loads
  useEffect(() => {
    if (data && !data.error && teamId) {
      fetchAnalytics(analyticsPosition, teamId);
    }
  }, [data, analyticsPosition, teamId, fetchAnalytics]);

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

        // GW Planner data
        setPlannerAllPlayers(allPlayers);
        setPlannerFixtures(fixtureData);
        setPlannerTeams(teams);
        setPlannerNextGW(nextGW);

        // Calculate projections for squad players for the next GW
        const squadProjections = calculatePlayerProjections(
          allPlayers.filter((p: FullElement) => squadIds.includes(p.id)),
          teams,
          fixtureData,
          nextGW
        );
        setPlannerProjections(squadProjections);

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

  // Build the "effective squad" after planner transfers are applied
  function getPlannerSquad(): EnrichedPick[] {
    if (!data) return [];
    let squad = [...data.picks];
    for (const t of plannerTransfers) {
      const outIdx = squad.findIndex((p) => p.element === t.outId);
      if (outIdx === -1) continue;
      const inEl = plannerAllPlayers.find((p) => p.id === t.inId);
      if (!inEl) continue;
      squad[outIdx] = {
        ...squad[outIdx],
        element: inEl.id,
        webName: inEl.web_name,
        teamId: inEl.team,
        elementType: inEl.element_type,
      };
    }
    return squad;
  }

  // Get planner bank after transfers
  function getPlannerBank(): number {
    const baseBank = data?.bank ?? 0;
    let bank = baseBank;
    for (const t of plannerTransfers) {
      const outEl = bootstrapElements.find((e) => e.id === t.outId);
      const inEl = plannerAllPlayers.find((e) => e.id === t.inId);
      if (outEl && inEl) {
        bank += (outEl.now_cost - inEl.now_cost) / 10;
      }
    }
    return Math.round(bank * 10) / 10;
  }

  // Compute hits
  function getPlannerHitCost(): number {
    const ft = data?.freeTransfers ?? 1;
    const extraTransfers = Math.max(0, plannerTransfers.length - ft);
    return extraTransfers * 4;
  }

  // Available chips
  function getRemainingChips(): string[] {
    const allChips = ["wildcard", "freehit", "bboost", "3xc"];
    const used = data?.chipsUsed ?? [];
    return allChips.filter((c) => !used.includes(c));
  }

  // Get replacement candidates for a position
  function getReplacementCandidates(elementType: number): { id: number; name: string; team: string; xPts: number; cost: number; eo: string }[] {
    const projMap = new Map(plannerProjections.map((p) => [p.player_id, p]));
    const squadIds = new Set(getPlannerSquad().map((p) => p.element));
    const teamMap = new Map(plannerTeams.map((t) => [t.id, t]));

    // Get all projections for this position, not just squad
    const allProjs = plannerNextGW
      ? calculatePlayerProjections(
          plannerAllPlayers.filter((p) => p.element_type === elementType),
          plannerTeams,
          plannerFixtures,
          plannerNextGW
        )
      : [];

    return allProjs
      .filter((p) => !squadIds.has(p.player_id) && p.expected_points > 0.5)
      .sort((a, b) => b.expected_points - a.expected_points)
      .slice(0, 15)
      .map((p) => {
        const el = plannerAllPlayers.find((e) => e.id === p.player_id);
        return {
          id: p.player_id,
          name: p.web_name,
          team: teamMap.get(p.team_id)?.short_name ?? "?",
          xPts: Math.round(p.expected_points * 10) / 10,
          cost: el ? el.now_cost / 10 : 0,
          eo: el?.selected_by_percent ?? "0",
        };
      });
  }

  function runSimulation() {
    if (!data || plannerProjections.length === 0 || !plannerNextGW) return;
    setSimulating(true);

    const squad = getPlannerSquad();
    const hitCost = getPlannerHitCost();

    // Recompute projections for the effective squad
    const squadIds = squad.map((p) => p.element);
    const effectiveProjections = calculatePlayerProjections(
      plannerAllPlayers.filter((p) => squadIds.includes(p.id)),
      plannerTeams,
      plannerFixtures,
      plannerNextGW
    );
    const projMap = new Map(effectiveProjections.map((p) => [p.player_id, p]));

    const starters = squad.filter((p) => p.position <= 11);
    const bench = squad.filter((p) => p.position > 11);

    const starterProjs = starters
      .map((pick) => ({ pick, proj: projMap.get(pick.element) }))
      .filter((x) => x.proj);
    const benchProjs = bench
      .map((pick) => ({ pick, proj: projMap.get(pick.element) }))
      .filter((x) => x.proj);

    const startingXPts = starterProjs.reduce((s, x) => s + (x.proj?.expected_points ?? 0), 0);
    const benchXPts = benchProjs.reduce((s, x) => s + (x.proj?.expected_points ?? 0), 0);

    // Captain: use planner captain if set, else best xPts among starters
    let captainEl: typeof starterProjs[0] | undefined;
    if (plannerCaptainId) {
      captainEl = starterProjs.find((x) => x.pick.element === plannerCaptainId);
    }
    if (!captainEl) {
      captainEl = starterProjs.reduce(
        (best, x) => ((x.proj?.expected_points ?? 0) > (best.proj?.expected_points ?? 0) ? x : best),
        starterProjs[0]
      );
    }
    const captainXPts = captainEl?.proj?.expected_points ?? 0;
    const captainName = captainEl?.pick.webName ?? "Unknown";

    const totalXPts = startingXPts + captainXPts;
    const netXPts = totalXPts - hitCost;

    // Generate ALWAYS-meaningful pros and cons
    const pros: string[] = [];
    const cons: string[] = [];

    // --- Pros analysis ---
    const highPerformers = starterProjs.filter((x) => (x.proj?.expected_points ?? 0) >= 5);
    if (highPerformers.length >= 3) {
      pros.push(`${highPerformers.length} players projected 5+ xPts — strong ceiling`);
    } else if (highPerformers.length >= 1) {
      pros.push(`${highPerformers.length} player(s) with 5+ xPts projection`);
    }

    if (captainXPts >= 6) {
      pros.push(`Strong captain: ${captainName} at ${captainXPts.toFixed(1)} xPts (x2)`);
    }

    const lowRisk = starterProjs.filter((x) => x.proj?.risk_rating === "low");
    if (lowRisk.length >= 8) {
      pros.push(`${lowRisk.length}/11 starters are nailed — reliable lineup`);
    }

    const csPlayers = starterProjs.filter(
      (x) => x.proj && x.proj.clean_sheet_probability >= 0.35 && (x.pick.elementType <= 2)
    );
    if (csPlayers.length >= 3) {
      pros.push(`${csPlayers.length} DEF/GK with 35%+ clean sheet probability`);
    }

    if (benchXPts >= 10) {
      pros.push(`Strong bench cover: ${benchXPts.toFixed(1)} xPts total`);
    }

    if (plannerTransfers.length > 0 && hitCost === 0) {
      pros.push(`${plannerTransfers.length} free transfer(s) — no hit cost`);
    }

    if (totalXPts >= 55) {
      pros.push(`Projected ${totalXPts.toFixed(1)} xPts — green arrow territory`);
    }

    // --- Cons analysis (ALWAYS generate at least 2) ---
    const highRisk = starterProjs.filter((x) => x.proj?.risk_rating === "high");
    if (highRisk.length > 0) {
      const names = highRisk.map((x) => x.pick.webName).join(", ");
      cons.push(`${highRisk.length} starter(s) rotation/injury risk: ${names}`);
    }

    const mediumRisk = starterProjs.filter((x) => x.proj?.risk_rating === "medium");
    if (mediumRisk.length >= 3) {
      cons.push(`${mediumRisk.length} starters with moderate risk — lineups uncertain`);
    }

    if (captainXPts < 4.5) {
      cons.push(`Weak captain options — best is ${captainName} at ${captainXPts.toFixed(1)} xPts`);
    }

    const blanking = starterProjs.filter((x) => (x.proj?.expected_points ?? 0) === 0);
    if (blanking.length > 0) {
      const names = blanking.map((x) => x.pick.webName).join(", ");
      cons.push(`${blanking.length} starter(s) blank this GW: ${names}`);
    }

    if (benchXPts < 6) {
      cons.push(`Weak bench at ${benchXPts.toFixed(1)} xPts — auto-sub insurance poor`);
    }

    if (hitCost > 0) {
      cons.push(`Taking a ${hitCost}pt hit — net total drops to ${netXPts.toFixed(1)} xPts`);
    }

    // Low-xPts starters
    const underperformers = starterProjs.filter((x) => (x.proj?.expected_points ?? 0) < 2.5 && (x.proj?.expected_points ?? 0) > 0);
    if (underperformers.length >= 2) {
      const names = underperformers.map((x) => `${x.pick.webName} (${(x.proj?.expected_points ?? 0).toFixed(1)})`).join(", ");
      cons.push(`${underperformers.length} starters projected under 2.5 xPts: ${names}`);
    }

    // Fixture difficulty — players facing FDR 4-5
    const toughFixtures = starterProjs.filter((x) => {
      if (!x.proj) return false;
      // High risk + low CS prob indicates tough fixture
      return x.proj.goal_threat_score < 0.1 && x.proj.expected_points < 3 && x.pick.elementType >= 3;
    });
    if (toughFixtures.length >= 3) {
      cons.push(`${toughFixtures.length} attacking players with low goal threat this GW`);
    }

    // Ownership concentration
    const highEO = starterProjs.filter((x) => {
      const el = plannerAllPlayers.find((e) => e.id === x.pick.element);
      return el && parseFloat(el.selected_by_percent || "0") > 30;
    });
    if (highEO.length >= 6) {
      pros.push(`${highEO.length} template picks — safe floor against average`);
    }

    const diffPicks = starterProjs.filter((x) => {
      const el = plannerAllPlayers.find((e) => e.id === x.pick.element);
      return el && parseFloat(el.selected_by_percent || "0") < 5 && (x.proj?.expected_points ?? 0) >= 4;
    });
    if (diffPicks.length >= 1) {
      const names = diffPicks.map((x) => x.pick.webName).join(", ");
      pros.push(`Differential edge: ${names} (<5% EO, 4+ xPts)`);
    }

    // Ensure at least 1 pro and 2 cons always
    if (pros.length === 0) {
      const avgXPts = startingXPts / Math.max(starterProjs.length, 1);
      pros.push(`Average starter xPts: ${avgXPts.toFixed(1)} — ${avgXPts >= 3.5 ? "decent" : "needs improvement"}`);
    }
    if (cons.length < 2) {
      if (totalXPts < 50) cons.push(`Total xPts (${totalXPts.toFixed(1)}) below 50 — red arrow risk`);
      if (cons.length < 2) cons.push(`Limited differential upside — similar to template managers`);
    }

    setSimulationResult({
      totalXPts: Math.round(totalXPts * 10) / 10,
      startingXPts: Math.round(startingXPts * 10) / 10,
      captainName,
      captainXPts: Math.round(captainXPts * 10) / 10,
      pros,
      cons,
      benchXPts: Math.round(benchXPts * 10) / 10,
      hitCost,
      netXPts: Math.round(netXPts * 10) / 10,
    });
    setSimulating(false);
  }

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
  const rankChangePercentRaw =
    data.prevOverallRank && rankChange
      ? (rankChange / data.prevOverallRank) * 100
      : null;
  const rankChangePercent =
    rankChangePercentRaw !== null
      ? Math.min(Math.abs(rankChangePercentRaw), 999.9) * (rankChangePercentRaw < 0 ? -1 : 1)
      : null;
  const rankChangePercentStr = rankChangePercent !== null ? rankChangePercent.toFixed(1) : null;

  // Safety score from EO-weighted live points calculation
  const safetyData = data.safetyScore;
  const safetyScore = safetyData?.safetyScore ?? data.averageScore;
  const aboveSafety = data.livePoints >= safetyScore;
  const safetyArrow = safetyData?.arrow ?? (aboveSafety ? "green" : "red");
  const safetyDelta = safetyData?.delta ?? (data.livePoints - safetyScore);
  const safetyTierLabel = safetyData?.tierLabel ?? "Overall";

  const squadTeamIds = [...new Set(data.picks.map((p) => p.teamId).filter((id) => id > 0))];

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-6 space-y-8 bg-slate-950 min-h-screen">
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
                ? `+${Math.round(data.livePoints - data.averageScore)} above avg`
                : `${Math.round(data.livePoints - data.averageScore)} below avg`
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
              rankChangePercentStr
                ? `${rankChange! > 0 ? "+" : ""}${rankChangePercentStr}%`
                : undefined
            }
          />
          {/* Safety Score: EO-weighted points threshold for rank bracket */}
          <div className={`p-4 rounded-xl bg-gradient-to-br border ${
            aboveSafety
              ? "from-emerald-950/40 to-slate-800 border-emerald-700/50"
              : "from-red-950/40 to-slate-800 border-red-700/50"
          }`}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm text-slate-400 uppercase tracking-wider">
                Safety Score
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-400">
                {safetyTierLabel}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-3xl font-bold ${
                aboveSafety ? "text-emerald-400" : "text-red-400"
              }`}>
                {safetyScore}
              </span>
              <span className="text-xs text-slate-500">pts</span>
              {safetyArrow === "green" && (
                <span className="text-emerald-400 text-lg" title="Above safety — rank rising">▲</span>
              )}
              {safetyArrow === "red" && (
                <span className="text-red-400 text-lg" title="Below safety — rank falling">▼</span>
              )}
              {safetyArrow === "neutral" && (
                <span className="text-slate-500 text-lg" title="On the line">—</span>
              )}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              {aboveSafety
                ? `+${Math.round(safetyDelta)} above — green arrow likely`
                : `${Math.round(safetyDelta)} below — red arrow zone`}
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
                  {Number(data.milpOptimization.net_improvement).toFixed(1)} xPts net gain
                </span>
              </div>
              {data.milpOptimization.should_roll && (
                <p className="text-amber-300/70 text-sm">
                  Best possible move is below the 2.0pt threshold — save your FT.
                </p>
              )}
              <div className="flex gap-4 mt-2 text-xs text-slate-400">
                <span>Current: {Number(data.milpOptimization.current_team_xp).toFixed(1)} xP</span>
                <span>→</span>
                <span>Optimized: {Number(data.milpOptimization.total_xp).toFixed(1)} xP</span>
                {data.milpOptimization.hit_cost > 0 && (
                  <span className="text-red-400">-{Number(data.milpOptimization.hit_cost).toFixed(0)} hit cost</span>
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
                <div className="text-xs text-slate-400 uppercase tracking-wider mb-2">Optimized Captain (after transfers)</div>
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

      {/* ===== PLAYER ANALYTICS SECTION ===== */}
      <section className="bg-slate-900 rounded-xl border border-slate-700 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="text-2xl font-bold text-slate-50">Player Analytics</h2>
            <p className="text-sm text-slate-400 mt-1">
              xG, xA, Threat, Creativity, DC, CS — KEEP / MONITOR / SELL verdicts
            </p>
          </div>
          <a
            href={`/analytics?teamId=${teamId}`}
            className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs font-medium hover:bg-slate-700 transition-colors border border-slate-700"
          >
            Full View &rarr;
          </a>
        </div>

        {/* Position tabs */}
        <div className="flex gap-1 bg-[#111827] rounded-lg p-1 w-fit mb-4">
          {[
            { id: 1, label: "Goalkeepers", short: "GKP" },
            { id: 2, label: "Defenders", short: "DEF" },
            { id: 3, label: "Midfielders", short: "MID" },
            { id: 4, label: "Forwards", short: "FWD" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setAnalyticsPosition(tab.id)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                analyticsPosition === tab.id
                  ? "bg-purple-600 text-white"
                  : "text-slate-500 hover:text-slate-300 hover:bg-[#1a2030]"
              }`}
            >
              <span className="hidden sm:inline">{tab.label}</span>
              <span className="sm:hidden">{tab.short}</span>
            </button>
          ))}
        </div>

        {analyticsLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="spinner" />
          </div>
        ) : analyticsPlayers.length > 0 ? (
          <AnalyticsTable
            players={analyticsPlayers}
            upcomingGWs={analyticsUpcomingGWs}
            squadIds={analyticsSquadIds}
            positionId={analyticsPosition}
          />
        ) : (
          <p className="text-slate-500 py-4">No analytics data available</p>
        )}
      </section>

      {/* ===== SECTION 4: CAPTAIN PICK (NEXT GW) ===== */}
      <section className="bg-slate-900 rounded-xl border border-slate-700 p-6">
        <h2 className="text-2xl font-bold text-slate-50 mb-1">
          Captain Pick — Next GW{captainGW ?? data.gameweek + 1}
        </h2>
        <p className="text-sm text-slate-400 mb-6">
          Best captain from your <span className="text-slate-300">current squad</span> for the upcoming gameweek
        </p>
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

      {/* ===== SECTION 6: GW PLANNER — PITCH VIEW WITH TRANSFER SIMULATION ===== */}
      <section className="bg-slate-900 rounded-xl border border-slate-700 overflow-hidden">
        <div className="p-6 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-2">
            <div>
              <h2 className="text-2xl font-bold text-slate-50">
                GW{plannerNextGW ?? data.gameweek + 1} Planner
              </h2>
              <p className="text-sm text-slate-400 mt-1">
                Tap a player to swap them out, then simulate your scenario
              </p>
            </div>
            <div className="flex items-center gap-2">
              {plannerTransfers.length > 0 && (
                <button
                  onClick={() => { setPlannerTransfers([]); setPlannerSelectedSlot(null); setSimulationResult(null); }}
                  className="px-3 py-2 rounded-lg bg-slate-700 text-slate-300 text-sm hover:bg-slate-600 transition-colors"
                >
                  Reset
                </button>
              )}
              <button
                onClick={runSimulation}
                disabled={simulating || plannerProjections.length === 0}
                className="px-5 py-2.5 rounded-lg bg-gradient-to-r from-purple-600 to-purple-500 text-white font-semibold text-sm hover:from-purple-500 hover:to-purple-400 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-purple-900/30"
              >
                {simulating ? "Simulating..." : "Simulate Scenario"}
              </button>
            </div>
          </div>

          {/* Transfer info bar */}
          <div className="flex flex-wrap items-center gap-3 mt-3 text-sm">
            <span className="px-2.5 py-1 rounded bg-slate-800 border border-slate-700 text-slate-300">
              Bank: <span className="font-semibold text-emerald-400">£{getPlannerBank().toFixed(1)}m</span>
            </span>
            <span className="px-2.5 py-1 rounded bg-slate-800 border border-slate-700 text-slate-300">
              FT: <span className="font-semibold text-slate-50">{data.freeTransfers ?? 1}</span>
            </span>
            <span className={`px-2.5 py-1 rounded border ${
              getPlannerHitCost() > 0
                ? "bg-red-900/30 border-red-700/40 text-red-400"
                : "bg-slate-800 border-slate-700 text-slate-400"
            }`}>
              Hit: <span className="font-semibold">{getPlannerHitCost() > 0 ? `-${getPlannerHitCost()}pts` : "0"}</span>
            </span>
            <span className="px-2.5 py-1 rounded bg-slate-800 border border-slate-700 text-slate-300">
              Transfers: <span className="font-semibold text-purple-400">{plannerTransfers.length}</span>
            </span>
            {getRemainingChips().length > 0 && (
              <span className="px-2.5 py-1 rounded bg-slate-800 border border-slate-700 text-slate-400">
                Chips: {getRemainingChips().map((c) => {
                  const labels: Record<string, string> = { wildcard: "WC", freehit: "FH", bboost: "BB", "3xc": "TC" };
                  return <span key={c} className="text-amber-400 ml-1 font-medium">{labels[c] ?? c}</span>;
                })}
              </span>
            )}
          </div>
        </div>

        {/* Planner Pitch */}
        {plannerProjections.length > 0 ? (
          <PlannerPitch
            picks={getPlannerSquad()}
            projections={plannerProjections}
            allPlayers={plannerAllPlayers}
            elements={bootstrapElements}
            teams={bootstrapTeams}
            captainId={plannerCaptainId ?? captainSuggestions[0]?.element ?? null}
            selectedSlot={plannerSelectedSlot}
            onPlayerClick={(elementId) => {
              if (plannerSelectedSlot === elementId) {
                setPlannerSelectedSlot(null);
              } else {
                setPlannerSelectedSlot(elementId);
              }
            }}
            onCaptainClick={(elementId) => {
              setPlannerCaptainId(elementId);
            }}
            plannerFixtures={plannerFixtures}
            plannerTeams={plannerTeams}
            plannerNextGW={plannerNextGW}
          />
        ) : fixturesLoading ? (
          <div className="flex justify-center py-12">
            <div className="spinner" />
          </div>
        ) : (
          <div className="px-6 pb-6">
            <p className="text-slate-500 py-4">No projection data available for the next GW</p>
          </div>
        )}

        {/* Replacement picker panel */}
        {plannerSelectedSlot && plannerProjections.length > 0 && (() => {
          const pick = getPlannerSquad().find((p) => p.element === plannerSelectedSlot);
          if (!pick) return null;
          const candidates = getReplacementCandidates(pick.elementType);
          const bankAvailable = getPlannerBank();
          const outEl = bootstrapElements.find((e) => e.id === plannerSelectedSlot);
          const outCost = outEl ? outEl.now_cost / 10 : 0;

          return (
            <div className="mx-6 mb-4 p-4 rounded-lg bg-slate-800 border border-purple-700/40">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-semibold text-slate-50">
                  Replace <span className="text-red-400">{pick.webName}</span> (£{outCost.toFixed(1)}m)
                </div>
                <button onClick={() => setPlannerSelectedSlot(null)} className="text-slate-500 hover:text-slate-300 text-sm">
                  Cancel
                </button>
              </div>
              <div className="max-h-48 overflow-y-auto space-y-1">
                {candidates.map((c) => {
                  const affordable = c.cost <= (bankAvailable + outCost);
                  return (
                    <button
                      key={c.id}
                      disabled={!affordable}
                      onClick={() => {
                        // Remove any existing transfer for this slot
                        const existing = plannerTransfers.filter((t) => t.outId !== (outEl?.id ?? plannerSelectedSlot));
                        // Find original player at this position
                        const originalPick = data.picks.find((p) => p.element === plannerSelectedSlot);
                        const originalId = originalPick?.element ?? plannerSelectedSlot;
                        // Check if this is reverting back to original
                        const revertTransfer = plannerTransfers.find((t) => t.outId === originalId);
                        if (revertTransfer && c.id === originalId) {
                          // Just remove the transfer
                          setPlannerTransfers(existing);
                        } else {
                          // If current slot is already a transferred-in player, find the original out
                          const origOut = plannerTransfers.find((t) => t.inId === plannerSelectedSlot);
                          const realOutId = origOut ? origOut.outId : plannerSelectedSlot;
                          const cleaned = plannerTransfers.filter((t) => t.outId !== realOutId);
                          setPlannerTransfers([...cleaned, { outId: realOutId, inId: c.id }]);
                        }
                        setPlannerSelectedSlot(null);
                        setSimulationResult(null);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded text-sm transition-colors ${
                        affordable
                          ? "hover:bg-slate-700 text-slate-200"
                          : "opacity-40 cursor-not-allowed text-slate-500"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="font-medium">{c.name}</span>
                        <span className="text-slate-500">{c.team}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-slate-400">{c.eo}% EO</span>
                        <span className="text-emerald-400 font-semibold">{c.xPts} xPts</span>
                        <span className={affordable ? "text-slate-400" : "text-red-400"}>£{c.cost.toFixed(1)}m</span>
                      </div>
                    </button>
                  );
                })}
                {candidates.length === 0 && (
                  <p className="text-slate-500 text-sm py-2">No replacements available</p>
                )}
              </div>
            </div>
          );
        })()}

        {/* Captain Recommendation */}
        {captainSuggestions.length > 0 && plannerProjections.length > 0 && (
          <div className="mx-6 mb-4 p-4 rounded-lg bg-gradient-to-r from-yellow-900/30 to-amber-900/10 border border-yellow-700/40">
            <div className="flex items-center gap-3">
              <span className="text-2xl">&#9733;</span>
              <div>
                <div className="text-sm text-yellow-400/80 uppercase tracking-wider font-medium">Captain Suggestion</div>
                <div className="text-slate-50 font-bold text-lg">
                  {captainSuggestions[0].webName}
                  <span className="text-yellow-400 ml-2 text-base font-semibold">
                    {captainSuggestions[0].xPts.toFixed(1)} xPts
                  </span>
                </div>
                <div className="text-slate-400 text-sm">{captainSuggestions[0].fixtureLabel}</div>
              </div>
              {captainSuggestions[1] && (
                <div className="ml-auto text-right">
                  <div className="text-xs text-slate-500">Runner-up</div>
                  <div className="text-slate-300 text-sm font-medium">{captainSuggestions[1].webName}</div>
                  <div className="text-slate-500 text-xs">{captainSuggestions[1].xPts.toFixed(1)} xPts</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Simulation Results */}
        {simulationResult && (
          <div className="mx-6 mb-6 space-y-4">
            {/* Summary stats */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <div className="p-3 rounded-lg bg-slate-800 border border-slate-700">
                <div className="text-xs text-slate-400 uppercase">Total xPts</div>
                <div className="text-2xl font-bold text-emerald-400">{simulationResult.totalXPts.toFixed(1)}</div>
              </div>
              <div className="p-3 rounded-lg bg-slate-800 border border-slate-700">
                <div className="text-xs text-slate-400 uppercase">Starting XI</div>
                <div className="text-2xl font-bold text-slate-50">{simulationResult.startingXPts.toFixed(1)}</div>
              </div>
              <div className="p-3 rounded-lg bg-slate-800 border border-slate-700">
                <div className="text-xs text-slate-400 uppercase">Captain (x2)</div>
                <div className="text-lg font-bold text-yellow-400">{simulationResult.captainName}</div>
                <div className="text-xs text-slate-500">{simulationResult.captainXPts.toFixed(1)} xPts</div>
              </div>
              <div className="p-3 rounded-lg bg-slate-800 border border-slate-700">
                <div className="text-xs text-slate-400 uppercase">Bench Cover</div>
                <div className="text-2xl font-bold text-slate-400">{simulationResult.benchXPts.toFixed(1)}</div>
              </div>
              {simulationResult.hitCost > 0 && (
                <div className="p-3 rounded-lg bg-red-900/30 border border-red-700/40">
                  <div className="text-xs text-red-400 uppercase">Net (after hit)</div>
                  <div className="text-2xl font-bold text-red-400">{simulationResult.netXPts.toFixed(1)}</div>
                </div>
              )}
            </div>

            {/* Pros and Cons */}
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="p-4 rounded-lg bg-emerald-950/30 border border-emerald-700/30">
                <h4 className="text-sm font-semibold text-emerald-400 uppercase tracking-wider mb-3">Pros</h4>
                <ul className="space-y-2">
                  {simulationResult.pros.map((pro, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                      <span className="text-emerald-400 mt-0.5 shrink-0">+</span>
                      {pro}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="p-4 rounded-lg bg-red-950/30 border border-red-700/30">
                <h4 className="text-sm font-semibold text-red-400 uppercase tracking-wider mb-3">Cons</h4>
                <ul className="space-y-2">
                  {simulationResult.cons.map((con, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                      <span className="text-red-400 mt-0.5 shrink-0">-</span>
                      {con}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

// ---------- Planner Pitch Component ----------

function PlannerPitch({
  picks,
  projections,
  allPlayers,
  elements,
  teams,
  captainId,
  selectedSlot,
  onPlayerClick,
  onCaptainClick,
  plannerFixtures,
  plannerTeams,
  plannerNextGW,
}: {
  picks: EnrichedPick[];
  projections: XPtsProjection[];
  allPlayers: FullElement[];
  elements: BootstrapElement[];
  teams: BootstrapTeam[];
  captainId: number | null;
  selectedSlot: number | null;
  onPlayerClick: (elementId: number) => void;
  onCaptainClick: (elementId: number) => void;
  plannerFixtures: FixtureDetail[];
  plannerTeams: TeamStrength[];
  plannerNextGW: number | null;
}) {
  // Build projections for the effective squad
  const squadIds = picks.map((p) => p.element);
  const effectiveProjs = plannerNextGW
    ? calculatePlayerProjections(
        allPlayers.filter((p) => squadIds.includes(p.id)),
        plannerTeams,
        plannerFixtures,
        plannerNextGW
      )
    : projections;
  const projMap = new Map(effectiveProjs.map((p) => [p.player_id, p]));
  const teamMap = new Map(teams.map((t) => [t.id, t]));

  const starters = picks.filter((p) => p.position <= 11);
  const bench = picks.filter((p) => p.position > 11);

  const gkp = starters.filter((p) => p.elementType === 1);
  const def = starters.filter((p) => p.elementType === 2);
  const mid = starters.filter((p) => p.elementType === 3);
  const fwd = starters.filter((p) => p.elementType === 4);

  const renderPlannerCard = (pick: EnrichedPick, isBench = false) => {
    const proj = projMap.get(pick.element);
    const el = allPlayers.find((e) => e.id === pick.element);
    const team = teamMap.get(pick.teamId);
    const xPts = proj?.expected_points ?? 0;
    const risk = proj?.risk_rating ?? "medium";
    const isCaptainPick = captainId === pick.element;
    const isSelected = selectedSlot === pick.element;
    const eo = el ? parseFloat(el.selected_by_percent || "0") : 0;

    // Status-based icon logic
    const status = el?.status ?? "a";
    const chanceOfPlaying = el?.chance_of_playing_next_round;

    // Determine icon: doubtful, injured, rotation risk, differential, nailed
    let statusIcon = "";
    let statusTitle = "";
    let statusColor = "text-slate-500";

    if (status === "i" || status === "s" || status === "n") {
      statusIcon = "\u2718"; // ✘ cross
      statusTitle = status === "i" ? "Injured" : status === "s" ? "Suspended" : "Unavailable";
      statusColor = "text-red-400";
    } else if (status === "d" || (chanceOfPlaying !== null && chanceOfPlaying !== undefined && chanceOfPlaying <= 50)) {
      statusIcon = "\u26A0"; // ⚠ warning
      statusTitle = "Doubtful";
      statusColor = "text-amber-400";
    } else if (risk === "high") {
      statusIcon = "\u21BB"; // ↻ rotation
      statusTitle = "Rotation risk";
      statusColor = "text-orange-400";
    } else if (eo < 5 && xPts >= 3) {
      statusIcon = "\u2606"; // ☆ star outline
      statusTitle = "Differential (<5% EO)";
      statusColor = "text-purple-400";
    } else if (risk === "low") {
      statusIcon = "\u2714"; // ✔ check
      statusTitle = "Nailed";
      statusColor = "text-emerald-400";
    } else {
      statusIcon = "\u25CF"; // ● dot
      statusTitle = "Regular";
      statusColor = "text-slate-400";
    }

    const xPtsColor = xPts >= 5 ? "text-emerald-400" : xPts >= 3 ? "text-yellow-300" : xPts > 0 ? "text-orange-400" : "text-red-400";

    return (
      <div
        key={pick.element}
        className={`flex flex-col items-center cursor-pointer transition-all ${
          isBench ? "opacity-60 hover:opacity-90" : ""
        } ${isSelected ? "scale-110" : "hover:scale-105"}`}
        style={{ width: 82 }}
        onClick={() => onPlayerClick(pick.element)}
      >
        {/* xPts card */}
        <div className={`relative rounded-lg px-2 py-1.5 border transition-all ${
          isSelected
            ? "border-purple-400 ring-2 ring-purple-400/40 bg-purple-900/30"
            : isCaptainPick
              ? "border-yellow-500 ring-1 ring-yellow-500/30 bg-yellow-900/20"
              : "border-slate-600 bg-slate-800/60"
        }`}>
          <div className={`text-lg font-bold text-center ${xPtsColor}`}>
            {xPts.toFixed(1)}
          </div>
          <div className="text-[9px] text-slate-500 text-center">xPts</div>
          {/* Status icon */}
          <span className={`absolute -top-1.5 -left-1.5 text-xs ${statusColor}`} title={statusTitle}>
            {statusIcon}
          </span>
          {/* Captain badge */}
          {isCaptainPick && (
            <div className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-yellow-500 flex items-center justify-center text-[10px] font-bold text-black">
              C
            </div>
          )}
        </div>
        {/* Player name */}
        <div className="text-xs font-semibold text-white mt-1 text-center truncate w-full" title={pick.webName}>
          {pick.webName}
        </div>
        {/* Team & EO% */}
        <div className="flex gap-1 text-[9px] text-slate-500">
          <span>{team?.short_name ?? "?"}</span>
          <span>|</span>
          <span title="Effective Ownership">{eo.toFixed(1)}%</span>
        </div>
        {/* Captain toggle (double-click area) */}
        {!isBench && (
          <button
            onClick={(e) => { e.stopPropagation(); onCaptainClick(pick.element); }}
            className={`mt-0.5 text-[8px] px-1.5 py-0.5 rounded transition-colors ${
              isCaptainPick
                ? "bg-yellow-500/20 text-yellow-400 font-semibold"
                : "text-slate-600 hover:text-yellow-400 hover:bg-yellow-500/10"
            }`}
            title="Set as captain"
          >
            {isCaptainPick ? "CAPT" : "set C"}
          </button>
        )}
      </div>
    );
  };

  const renderRow = (players: EnrichedPick[]) => (
    <div className="flex justify-center gap-2 py-3">
      {players.map((pick) => renderPlannerCard(pick))}
    </div>
  );

  return (
    <div className="w-full">
      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 px-6 py-2 text-[10px] text-slate-500 border-b border-slate-700/50">
        <span><span className="text-emerald-400">{"\u2714"}</span> Nailed</span>
        <span><span className="text-amber-400">{"\u26A0"}</span> Doubtful</span>
        <span><span className="text-orange-400">{"\u21BB"}</span> Rotation</span>
        <span><span className="text-red-400">{"\u2718"}</span> Unavailable</span>
        <span><span className="text-purple-400">{"\u2606"}</span> Differential</span>
        <span className="ml-auto text-slate-600">Tap player to swap</span>
      </div>

      {/* Pitch */}
      <div
        className="relative overflow-hidden"
        style={{
          background: `
            linear-gradient(180deg,
              #1a472a 0%, #2d5a3d 10%, #1a472a 20%, #2d5a3d 30%,
              #1a472a 40%, #2d5a3d 50%, #1a472a 60%, #2d5a3d 70%,
              #1a472a 80%, #2d5a3d 90%, #1a472a 100%
            )
          `,
          minHeight: 380,
        }}
      >
        {/* Pitch markings */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute left-0 right-0 h-px bg-white/15" style={{ top: "50%" }} />
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-20 h-20 rounded-full border border-white/15" />
          <div className="absolute left-1/2 -translate-x-1/2 top-0 w-40 h-14 border-b border-l border-r border-white/15" />
          <div className="absolute left-1/2 -translate-x-1/2 bottom-0 w-40 h-14 border-t border-l border-r border-white/15" />
        </div>

        <div className="relative z-10 flex flex-col justify-between py-4" style={{ minHeight: 380 }}>
          {fwd.length > 0 && renderRow(fwd)}
          {mid.length > 0 && renderRow(mid)}
          {def.length > 0 && renderRow(def)}
          {gkp.length > 0 && renderRow(gkp)}
        </div>
      </div>

      {/* Bench */}
      <div className="p-4 bg-slate-800/30 border-t border-slate-700">
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
          Bench
        </div>
        <div className="flex justify-center gap-4">
          {bench.map((pick) => renderPlannerCard(pick, true))}
        </div>
      </div>
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

