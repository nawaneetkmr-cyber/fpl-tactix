"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import FixtureDifficultyGrid from "@/components/FixtureDifficultyGrid";
import {
  buildFixtureDifficultyGrid,
  suggestNextGWCaptain,
  FPLFixture,
  FixtureDifficultyRow,
} from "@/lib/projections";
import type { FullElement, TeamStrength } from "@/lib/xpts";

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

interface RawPick {
  element: number;
  position: number;
  multiplier: number;
  is_captain: boolean;
  is_vice_captain: boolean;
}

interface OptimizationResult {
  optimizedPoints: number;
  actualPoints: number;
  pointsLeftOnTable: number;
  bestCaptainId: number | null;
  bestCaptainPoints: number;
  actualCaptainId: number | null;
  actualCaptainPoints: number;
  changes: string[];
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
  estimatedOptimizedRank: number;
  averageScore: number;
  totalPlayers: number;
  prevOverallRank: number | null;
  optimization: OptimizationResult;
  picks: EnrichedPick[];
  rawPicks: RawPick[];
  liveElements: { id: number; stats: { total_points: number; minutes: number } }[];
  elements: { id: number; web_name: string; team: number; element_type: number }[];
  teams: { id: number; name: string; shortName: string }[];
  error?: string;
}

// ---------- Team Colors ----------

const TEAM_COLORS: Record<number, string> = {
  1: "#EF0107", // Arsenal
  2: "#95BFE5", // Aston Villa
  3: "#DA291C", // Bournemouth
  4: "#0057B8", // Brighton
  5: "#6C1D45", // Burnley
  6: "#034694", // Chelsea
  7: "#1B458F", // Crystal Palace
  8: "#003399", // Everton
  9: "#FFFFFF", // Fulham
  10: "#C8102E", // Ipswich
  11: "#003090", // Leicester
  12: "#C8102E", // Liverpool
  13: "#6CABDD", // Man City
  14: "#DA291C", // Man Utd
  15: "#241F20", // Newcastle
  16: "#E53233", // Nottm Forest
  17: "#EE2737", // Southampton
  18: "#132257", // Spurs
  19: "#1C2D3E", // West Ham
  20: "#FDB913", // Wolves
};

// ---------- Main Dashboard Wrapper ----------

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div style={{ padding: 40, textAlign: "center" }}>
          <div className="spinner" style={{ margin: "0 auto" }} />
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

  // Fixture data state
  const [fixtureRows, setFixtureRows] = useState<FixtureDifficultyRow[]>([]);
  const [fixturesLoading, setFixturesLoading] = useState(true);
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

  // Fetch fixture data
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

        const fixtures: FPLFixture[] = bootstrap.fixtures || [];
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
        const rows = buildFixtureDifficultyGrid(fixtures, teams, currentGW, 10);
        setFixtureRows(rows);

        // Build captain suggestions
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

        const { suggestions, nextGW } = suggestNextGWCaptain(
          squadIds,
          allPlayers,
          fixtures,
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

  // No team ID entered yet - show prominent input
  if (!teamId) {
    return (
      <div
        style={{
          minHeight: "60vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: 40,
        }}
      >
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>
          FPL Tactix
        </h1>
        <p style={{ color: "var(--muted)", marginBottom: 32, textAlign: "center" }}>
          Enter your FPL Team ID to view your dashboard
        </p>
        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", gap: 12, width: "100%", maxWidth: 320 }}
        >
          <input
            type="text"
            inputMode="numeric"
            placeholder="Team ID (e.g. 123456)"
            value={inputId}
            onChange={(e) => setInputId(e.target.value)}
            style={{
              flex: 1,
              padding: "14px 18px",
              fontSize: 16,
              borderRadius: 10,
              border: "1px solid var(--card-border)",
              background: "var(--card)",
              color: "var(--foreground)",
            }}
          />
          <button type="submit" className="btn-primary" style={{ padding: "14px 24px" }}>
            Go
          </button>
        </form>
        <p style={{ color: "var(--muted-light)", fontSize: 12, marginTop: 16 }}>
          Find your Team ID in the FPL app under Points → URL
        </p>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <div className="spinner" style={{ margin: "0 auto 16px" }} />
        <p style={{ color: "var(--muted)" }}>Loading live data...</p>
      </div>
    );
  }

  if (data?.error) {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <p style={{ color: "var(--danger)", marginBottom: 16 }}>
          Error: {data.error}
        </p>
        <button className="btn-secondary" onClick={() => fetchData(teamId)}>
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  // Prepare data for pitch visualization
  const starters = data.picks.filter((p) => p.position <= 11);
  const bench = data.picks.filter((p) => p.position > 11);
  const gkp = starters.filter((p) => p.elementType === 1);
  const def = starters.filter((p) => p.elementType === 2);
  const mid = starters.filter((p) => p.elementType === 3);
  const fwd = starters.filter((p) => p.elementType === 4);

  const rankChange = data.prevOverallRank
    ? data.prevOverallRank - data.estimatedLiveRank
    : null;
  const rankChangePercent = data.prevOverallRank
    ? ((rankChange! / data.prevOverallRank) * 100).toFixed(1)
    : null;

  const squadTeamIds = [...new Set(data.picks.map((p) => p.teamId))];

  return (
    <div
      style={{ maxWidth: 900, margin: "0 auto", padding: "20px 16px" }}
      className="fade-in"
    >
      {/* ===== HEADER SECTION ===== */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          flexWrap: "wrap",
          gap: 12,
          marginBottom: 24,
        }}
      >
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
            {data.teamName}
          </h1>
          <p style={{ color: "var(--muted)", fontSize: 14 }}>
            {data.playerName} &middot; Gameweek {data.gameweek}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {loading && <div className="spinner" style={{ width: 16, height: 16 }} />}
          <span className="badge badge-playing live-pulse">LIVE</span>
          {lastUpdate && (
            <span style={{ fontSize: 11, color: "var(--muted-light)" }}>
              {lastUpdate.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {/* ===== SECTION 1: PITCH VISUALIZATION (Hero) ===== */}
      <div className="pitch" style={{ marginBottom: 24, paddingBottom: 24 }}>
        <div
          style={{
            position: "relative",
            zIndex: 1,
            display: "flex",
            flexDirection: "column",
            gap: 16,
            alignItems: "center",
          }}
        >
          <PitchRow players={fwd} />
          <PitchRow players={mid} />
          <PitchRow players={def} />
          <PitchRow players={gkp} />
        </div>
      </div>

      {/* Bench */}
      <div
        className="card"
        style={{
          background: "var(--bench-bg)",
          marginBottom: 24,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "var(--muted)",
            marginBottom: 10,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Bench
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-around",
            gap: 8,
          }}
        >
          {bench.map((p) => (
            <div key={p.element} className="player-card">
              <div
                className="player-shirt"
                style={{
                  background: TEAM_COLORS[p.teamId] || "#666",
                  opacity: 0.6,
                }}
              >
                {positionShort(p.elementType)}
              </div>
              <div className="player-name" style={{ color: "var(--muted-light)" }}>
                {p.webName}
              </div>
              <div className="player-points">{p.points}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ===== SECTION 2: QUICK STATS (4 horizontal cards) ===== */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 12,
          marginBottom: 24,
        }}
      >
        <StatCard label="GW Live Points" value={data.livePoints} accent />
        <StatCard
          label="GW Average"
          value={data.averageScore}
          sublabel={
            data.livePoints >= data.averageScore
              ? `+${data.livePoints - data.averageScore} above`
              : `${data.livePoints - data.averageScore} below`
          }
        />
        <StatCard
          label="Est. Live Rank"
          value={formatRank(data.estimatedLiveRank)}
        />
        <StatCard
          label="Rank Change"
          value={rankChange !== null ? (rankChange > 0 ? `+${formatRank(rankChange)}` : formatRank(rankChange)) : "-"}
          sublabel={rankChangePercent ? `${rankChange! > 0 ? "+" : ""}${rankChangePercent}%` : undefined}
        />
      </div>

      {/* ===== SECTION 3: TWO-COLUMN INSIGHTS ===== */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
          marginBottom: 24,
        }}
      >
        {/* Points Left on Table */}
        <div
          className="card"
          style={{
            background:
              data.optimization.pointsLeftOnTable > 0
                ? "linear-gradient(135deg, rgba(245,158,11,0.08), rgba(239,68,68,0.08))"
                : undefined,
          }}
        >
          <div className="stat-label">Points Left on Table</div>
          <div
            style={{
              fontSize: 36,
              fontWeight: 700,
              marginTop: 8,
              color:
                data.optimization.pointsLeftOnTable > 10
                  ? "var(--danger)"
                  : data.optimization.pointsLeftOnTable > 0
                    ? "var(--warning)"
                    : "var(--success)",
            }}
          >
            {data.optimization.pointsLeftOnTable}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
            {data.optimization.pointsLeftOnTable === 0
              ? "Perfect decisions!"
              : data.optimization.pointsLeftOnTable <= 5
                ? "Minor optimization missed"
                : "Room for improvement"}
          </div>
          {data.optimization.changes.length > 0 && (
            <div style={{ marginTop: 12 }}>
              {data.optimization.changes.slice(0, 2).map((change, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: 11,
                    color: "var(--muted)",
                    padding: "4px 0",
                    borderTop: i > 0 ? "1px solid var(--card-border)" : undefined,
                  }}
                >
                  {change}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Captain Suggestions */}
        <div className="card">
          <div className="stat-label">
            Captain Pick (GW{captainGW ?? data.gameweek})
          </div>
          {fixturesLoading ? (
            <div style={{ padding: 20, textAlign: "center" }}>
              <div className="spinner" style={{ margin: "0 auto" }} />
            </div>
          ) : captainSuggestions.length > 0 ? (
            <div style={{ marginTop: 12 }}>
              {captainSuggestions.map((s, idx) => (
                <div
                  key={s.element}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "8px 0",
                    borderTop: idx > 0 ? "1px solid var(--card-border)" : undefined,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: "50%",
                        background:
                          idx === 0 ? "var(--accent)" : idx === 1 ? "#C0C0C0" : "#CD7F32",
                        color: idx === 0 ? "#000" : "#fff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 10,
                        fontWeight: 700,
                      }}
                    >
                      {idx + 1}
                    </span>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{s.webName}</div>
                      <div style={{ fontSize: 10, color: "var(--muted)" }}>
                        {s.fixtureLabel}
                      </div>
                    </div>
                  </div>
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: 14,
                      color: idx === 0 ? "var(--accent-dark)" : "inherit",
                    }}
                  >
                    {s.xPts.toFixed(1)} xPts
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ padding: 20, textAlign: "center", color: "var(--muted)" }}>
              No suggestions available
            </div>
          )}
        </div>
      </div>

      {/* ===== SECTION 4: FIXTURE DIFFICULTY GRID ===== */}
      <div className="card">
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--muted)",
            marginBottom: 16,
          }}
        >
          FIXTURE DIFFICULTY (NEXT 10 GWs)
        </div>
        {fixturesLoading ? (
          <div style={{ padding: 40, textAlign: "center" }}>
            <div className="spinner" style={{ margin: "0 auto 16px" }} />
            <p style={{ color: "var(--muted)" }}>Loading fixtures...</p>
          </div>
        ) : fixtureRows.length > 0 ? (
          <FixtureDifficultyGrid
            rows={fixtureRows}
            currentGW={data.gameweek}
            numGWs={10}
            highlightTeamIds={squadTeamIds}
          />
        ) : (
          <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>
            Unable to load fixture data
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Pitch Row Component ----------

function PitchRow({ players }: { players: EnrichedPick[] }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-around",
        width: "100%",
        gap: 4,
      }}
    >
      {players.map((p) => (
        <div key={p.element} className="player-card">
          <div
            className="player-shirt"
            style={{
              background: TEAM_COLORS[p.teamId] || "#666",
              border: p.minutes > 0 ? "2px solid var(--accent)" : "2px solid transparent",
            }}
          >
            {p.isCaptain ? "C" : p.isViceCaptain ? "V" : positionShort(p.elementType)}
          </div>
          <div className="player-name">{p.webName}</div>
          <div className="player-points">{p.points * (p.multiplier || 1)}</div>
          {p.isCaptain && (
            <span className="badge badge-captain" style={{ fontSize: 9, padding: "1px 4px" }}>
              C
            </span>
          )}
          {p.isViceCaptain && (
            <span className="badge badge-vice" style={{ fontSize: 9, padding: "1px 4px" }}>
              V
            </span>
          )}
        </div>
      ))}
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
    <div className="card" style={{ textAlign: "center", padding: "16px 12px" }}>
      <div className="stat-label" style={{ fontSize: 11 }}>{label}</div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 700,
          color: accent ? "var(--accent-dark)" : "inherit",
          marginTop: 4,
        }}
      >
        {value}
      </div>
      {sublabel && (
        <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
          {sublabel}
        </div>
      )}
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

function positionShort(elementType: number): string {
  switch (elementType) {
    case 1: return "G";
    case 2: return "D";
    case 3: return "M";
    case 4: return "F";
    default: return "?";
  }
}
