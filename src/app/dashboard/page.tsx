"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import FixtureDifficultyGrid from "@/components/FixtureDifficultyGrid";
import {
  buildFixtureDifficultyGrid,
  suggestNextGWCaptain,
  FPLFixture,
  FPLTeam,
  PlayerMeta,
  FixtureDifficultyRow,
} from "@/lib/projections";

// ---------- Types ----------

interface EnrichedPick {
  element: number;
  position: number;
  multiplier: number;
  isCaptain: boolean;
  isViceCaptain: boolean;
  webName: string;
  teamId: number;
  elementType: number; // 1=GKP, 2=DEF, 3=MID, 4=FWD
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

interface SimulationResponse {
  originalPoints: number;
  simulatedPoints: number;
  pointsDifference: number;
  description: string;
  originalRank: number;
  simulatedRank: number;
  rankDifference: number;
}

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
  const [tab, setTab] = useState<"live" | "ai" | "whatif" | "team" | "fixtures">("live");
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const id = inputId.trim();
    if (id && !isNaN(Number(id))) {
      setTeamId(id);
    }
  }

  // No team ID entered yet
  if (!teamId) {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <h2 style={{ marginBottom: 16 }}>Enter your FPL Team ID</h2>
        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", gap: 8, justifyContent: "center" }}
        >
          <input
            type="text"
            inputMode="numeric"
            placeholder="Team ID"
            value={inputId}
            onChange={(e) => setInputId(e.target.value)}
            style={{
              padding: "10px 16px",
              fontSize: 15,
              borderRadius: 8,
              border: "1px solid var(--card-border)",
              background: "var(--card)",
              color: "var(--foreground)",
              width: 200,
            }}
          />
          <button type="submit" className="btn-primary">
            Go
          </button>
        </form>
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

  return (
    <div
      style={{ maxWidth: 900, margin: "0 auto", padding: "20px 16px" }}
      className="fade-in"
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          flexWrap: "wrap",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 2 }}>
            {data.teamName}
          </h1>
          <p style={{ color: "var(--muted)", fontSize: 14 }}>
            {data.playerName} &middot; GW{data.gameweek}
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

      {/* Quick Stats Row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 12,
          marginBottom: 24,
        }}
      >
        <StatCard
          label="Live Points"
          value={data.livePoints}
          accent
        />
        <StatCard
          label="Est. Live Rank"
          value={formatRank(data.estimatedLiveRank)}
          sublabel="Estimated"
        />
        <StatCard
          label="Captain Pts"
          value={data.captainPoints}
          sublabel={
            data.picks.find((p) => p.isCaptain)?.webName ?? ""
          }
        />
        <StatCard
          label="Bench Pts"
          value={data.benchPoints}
        />
        <StatCard
          label="GW Average"
          value={data.averageScore}
        />
      </div>

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          gap: 0,
          borderBottom: "1px solid var(--card-border)",
          marginBottom: 20,
          overflowX: "auto",
        }}
      >
        {(
          [
            ["live", "Live Rank"],
            ["ai", "AI Optimized"],
            ["whatif", "What-If"],
            ["team", "Team View"],
            ["fixtures", "Fixtures"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            className={`tab ${tab === key ? "tab-active" : ""}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === "live" && <LiveRankTab data={data} />}
      {tab === "ai" && <AIOptimizedTab data={data} />}
      {tab === "whatif" && <WhatIfTab data={data} teamId={teamId} />}
      {tab === "team" && <TeamVisualizerTab data={data} />}
      {tab === "fixtures" && <FixturesTab data={data} />}
    </div>
  );
}

// ---------- Feature 1: Live Rank Tab ----------

function LiveRankTab({ data }: { data: DashboardData }) {
  const rankChange = data.prevOverallRank
    ? data.prevOverallRank - data.estimatedLiveRank
    : null;

  return (
    <div className="fade-in">
      <div
        className="card-glow"
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 24,
          marginBottom: 20,
        }}
      >
        <div>
          <div className="stat-label">Live Points</div>
          <div className="stat-value" style={{ color: "var(--accent-dark)" }}>
            {data.livePoints}
          </div>
          <div
            style={{
              fontSize: 13,
              color: "var(--muted)",
              marginTop: 4,
            }}
          >
            GW Average: {data.averageScore} &middot;{" "}
            {data.livePoints >= data.averageScore ? "Above" : "Below"} avg by{" "}
            {Math.abs(data.livePoints - data.averageScore)} pts
          </div>
        </div>
        <div>
          <div className="stat-label">Estimated Live Rank</div>
          <div className="stat-value">
            {formatRank(data.estimatedLiveRank)}
          </div>
          {rankChange !== null && (
            <div
              style={{ fontSize: 13, marginTop: 4 }}
              className={
                rankChange > 0
                  ? "rank-up"
                  : rankChange < 0
                    ? "rank-down"
                    : "rank-same"
              }
            >
              {rankChange > 0 ? `+${formatRank(rankChange)} positions` : rankChange < 0 ? `${formatRank(rankChange)} positions` : "No change"} vs last GW
            </div>
          )}
        </div>
      </div>

      {/* Captain highlight */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--muted)",
                marginBottom: 4,
              }}
            >
              CAPTAIN
            </div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>
              {data.picks.find((p) => p.isCaptain)?.webName ?? "N/A"}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: "var(--accent-dark)" }}>
              {data.captainPoints} pts
            </div>
            <span className="badge badge-captain">C</span>
          </div>
        </div>
      </div>

      {/* Bench points */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--muted)",
            marginBottom: 8,
          }}
        >
          BENCH (Non-counting)
        </div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {data.picks
            .filter((p) => p.position > 11)
            .map((p) => (
              <div
                key={p.element}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 12px",
                  background: "var(--background)",
                  borderRadius: 8,
                }}
              >
                <span style={{ fontWeight: 600, fontSize: 14 }}>
                  {p.webName}
                </span>
                <span
                  style={{
                    fontWeight: 700,
                    color: p.points > 0 ? "var(--warning)" : "var(--muted)",
                  }}
                >
                  {p.points} pts
                </span>
              </div>
            ))}
        </div>
        <div
          style={{
            marginTop: 8,
            fontSize: 14,
            fontWeight: 600,
            color: data.benchPoints > 5 ? "var(--warning)" : "var(--muted)",
          }}
        >
          Total bench: {data.benchPoints} pts
        </div>
      </div>

      {/* Player list */}
      <div className="card">
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--muted)",
            marginBottom: 12,
          }}
        >
          STARTING XI
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {data.picks
            .filter((p) => p.position <= 11)
            .sort((a, b) => a.elementType - b.elementType || a.position - b.position)
            .map((p) => (
              <div
                key={p.element}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "8px 12px",
                  borderRadius: 8,
                  background: "var(--background)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--muted-light)",
                      width: 28,
                    }}
                  >
                    {positionLabel(p.elementType)}
                  </span>
                  <span style={{ fontWeight: 600 }}>{p.webName}</span>
                  {p.isCaptain && (
                    <span className="badge badge-captain">C</span>
                  )}
                  {p.isViceCaptain && (
                    <span className="badge badge-vice">V</span>
                  )}
                </div>
                <span style={{ fontWeight: 700, fontSize: 15 }}>
                  {p.points * (p.multiplier || 1)} pts
                </span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

// ---------- Feature 2: AI Optimized Tab ----------

function AIOptimizedTab({ data }: { data: DashboardData }) {
  const opt = data.optimization;
  const bestCaptainName =
    data.elements.find((e) => e.id === opt.bestCaptainId)?.web_name ?? "N/A";
  const actualCaptainName =
    data.elements.find((e) => e.id === opt.actualCaptainId)?.web_name ?? "N/A";

  return (
    <div className="fade-in">
      {/* Main comparison */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
          marginBottom: 20,
        }}
      >
        <div className="card" style={{ textAlign: "center" }}>
          <div className="stat-label">Your Actual Points</div>
          <div className="stat-value">{opt.actualPoints}</div>
          <div
            style={{
              fontSize: 13,
              color: "var(--muted)",
              marginTop: 4,
            }}
          >
            Est. Rank: {formatRank(data.estimatedLiveRank)}
          </div>
        </div>
        <div
          className="card-glow"
          style={{
            textAlign: "center",
            borderColor: "var(--accent)",
          }}
        >
          <div className="stat-label">AI Optimized Points</div>
          <div className="stat-value" style={{ color: "var(--accent-dark)" }}>
            {opt.optimizedPoints}
          </div>
          <div
            style={{
              fontSize: 13,
              color: "var(--muted)",
              marginTop: 4,
            }}
          >
            Est. Rank: {formatRank(data.estimatedOptimizedRank)}
          </div>
        </div>
      </div>

      {/* Points left on table */}
      <div
        className="card"
        style={{
          textAlign: "center",
          marginBottom: 20,
          background:
            opt.pointsLeftOnTable > 0
              ? "linear-gradient(135deg, rgba(245,158,11,0.08), rgba(239,68,68,0.08))"
              : undefined,
        }}
      >
        <div className="stat-label">Points Left on Table</div>
        <div
          className="stat-value"
          style={{
            color:
              opt.pointsLeftOnTable > 10
                ? "var(--danger)"
                : opt.pointsLeftOnTable > 0
                  ? "var(--warning)"
                  : "var(--success)",
          }}
        >
          {opt.pointsLeftOnTable}
        </div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 8 }}>
          {opt.pointsLeftOnTable === 0
            ? "Perfect decisions! No points wasted."
            : opt.pointsLeftOnTable <= 5
              ? "Minor optimization missed. Decent decisions overall."
              : opt.pointsLeftOnTable <= 15
                ? "Room for improvement. Some decisions cost you."
                : "Significant points missed. Review the changes below."}
        </div>
      </div>

      {/* Captain comparison */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--muted)",
            marginBottom: 12,
          }}
        >
          CAPTAIN ANALYSIS
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 16,
          }}
        >
          <div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              Your Captain
            </div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>
              {actualCaptainName}
            </div>
            <div style={{ fontSize: 14, color: "var(--muted)" }}>
              {opt.actualCaptainPoints} pts (x2 ={" "}
              {opt.actualCaptainPoints * 2})
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: "var(--accent-dark)" }}>
              Best Captain
            </div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>
              {bestCaptainName}
            </div>
            <div style={{ fontSize: 14, color: "var(--accent-dark)" }}>
              {opt.bestCaptainPoints} pts (x2 ={" "}
              {opt.bestCaptainPoints * 2})
            </div>
          </div>
        </div>
      </div>

      {/* Changes */}
      {opt.changes.length > 0 && (
        <div className="card">
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--muted)",
              marginBottom: 12,
            }}
          >
            OPTIMAL CHANGES
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {opt.changes.map((change, i) => (
              <div
                key={i}
                style={{
                  padding: "8px 12px",
                  background: "var(--background)",
                  borderRadius: 8,
                  fontSize: 14,
                  borderLeft: "3px solid var(--accent)",
                  paddingLeft: 12,
                }}
              >
                {change}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Feature 3: What-If Tab ----------

function WhatIfTab({
  data,
  teamId,
}: {
  data: DashboardData;
  teamId: string;
}) {
  const [simType, setSimType] = useState<"captain" | "bench_swap" | "vice_captain">(
    "captain"
  );
  const [selectedCaptain, setSelectedCaptain] = useState<number | null>(null);
  const [selectedStarter, setSelectedStarter] = useState<number | null>(null);
  const [selectedBench, setSelectedBench] = useState<number | null>(null);
  const [simResult, setSimResult] = useState<SimulationResponse | null>(null);
  const [simLoading, setSimLoading] = useState(false);

  async function runSimulation() {
    setSimLoading(true);
    setSimResult(null);

    const body: Record<string, unknown> = {
      teamId: Number(teamId),
      gw: data.gameweek,
      type: simType,
    };

    if (simType === "captain") body.newCaptainId = selectedCaptain;
    if (simType === "bench_swap") {
      body.starterId = selectedStarter;
      body.benchId = selectedBench;
    }

    try {
      const res = await fetch("/api/fpl/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      setSimResult(json);
    } catch (e) {
      setSimResult(null);
    }
    setSimLoading(false);
  }

  const starters = data.picks.filter((p) => p.position <= 11);
  const bench = data.picks.filter((p) => p.position > 11);

  return (
    <div className="fade-in">
      {/* Simulation type selector */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--muted)",
            marginBottom: 12,
          }}
        >
          SIMULATION TYPE
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(
            [
              ["captain", "Change Captain"],
              ["bench_swap", "Bench Swap"],
              ["vice_captain", "VC Toggle"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              className={simType === key ? "btn-accent" : "btn-secondary"}
              onClick={() => {
                setSimType(key);
                setSimResult(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Captain change UI */}
      {simType === "captain" && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--muted)",
              marginBottom: 12,
            }}
          >
            SELECT NEW CAPTAIN
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
              gap: 8,
            }}
          >
            {starters.map((p) => (
              <button
                key={p.element}
                onClick={() => setSelectedCaptain(p.element)}
                style={{
                  padding: "10px 8px",
                  borderRadius: 8,
                  border:
                    selectedCaptain === p.element
                      ? "2px solid var(--accent)"
                      : "1px solid var(--card-border)",
                  background:
                    selectedCaptain === p.element
                      ? "rgba(0,255,135,0.08)"
                      : "var(--background)",
                  cursor: "pointer",
                  textAlign: "center",
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 13 }}>
                  {p.webName}
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  {p.points} pts
                </div>
                {p.isCaptain && (
                  <span
                    className="badge badge-captain"
                    style={{ marginTop: 4 }}
                  >
                    Current C
                  </span>
                )}
              </button>
            ))}
          </div>
          <button
            className="btn-primary"
            style={{ marginTop: 16, width: "100%" }}
            disabled={!selectedCaptain || simLoading}
            onClick={runSimulation}
          >
            {simLoading ? "Simulating..." : "Simulate Captain Change"}
          </button>
        </div>
      )}

      {/* Bench swap UI */}
      {simType === "bench_swap" && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--muted)",
              marginBottom: 8,
            }}
          >
            SELECT STARTER TO BENCH
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))",
              gap: 8,
              marginBottom: 16,
            }}
          >
            {starters.map((p) => (
              <button
                key={p.element}
                onClick={() => setSelectedStarter(p.element)}
                style={{
                  padding: "8px",
                  borderRadius: 8,
                  border:
                    selectedStarter === p.element
                      ? "2px solid var(--danger)"
                      : "1px solid var(--card-border)",
                  background:
                    selectedStarter === p.element
                      ? "rgba(239,68,68,0.08)"
                      : "var(--background)",
                  cursor: "pointer",
                  textAlign: "center",
                  fontSize: 13,
                }}
              >
                <div style={{ fontWeight: 600 }}>{p.webName}</div>
                <div style={{ color: "var(--muted)", fontSize: 12 }}>
                  {p.points} pts
                </div>
              </button>
            ))}
          </div>

          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--muted)",
              marginBottom: 8,
            }}
          >
            SELECT BENCH PLAYER TO START
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))",
              gap: 8,
            }}
          >
            {bench.map((p) => (
              <button
                key={p.element}
                onClick={() => setSelectedBench(p.element)}
                style={{
                  padding: "8px",
                  borderRadius: 8,
                  border:
                    selectedBench === p.element
                      ? "2px solid var(--success)"
                      : "1px solid var(--card-border)",
                  background:
                    selectedBench === p.element
                      ? "rgba(16,185,129,0.08)"
                      : "var(--background)",
                  cursor: "pointer",
                  textAlign: "center",
                  fontSize: 13,
                }}
              >
                <div style={{ fontWeight: 600 }}>{p.webName}</div>
                <div style={{ color: "var(--muted)", fontSize: 12 }}>
                  {p.points} pts
                </div>
              </button>
            ))}
          </div>

          <button
            className="btn-primary"
            style={{ marginTop: 16, width: "100%" }}
            disabled={!selectedStarter || !selectedBench || simLoading}
            onClick={runSimulation}
          >
            {simLoading ? "Simulating..." : "Simulate Bench Swap"}
          </button>
        </div>
      )}

      {/* Vice captain toggle */}
      {simType === "vice_captain" && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 12 }}>
            <p style={{ fontSize: 14, color: "var(--muted)" }}>
              This simulates what would happen if your captain didn&apos;t play
              and the vice-captain received the captain&apos;s multiplier.
            </p>
          </div>
          <div
            style={{
              display: "flex",
              gap: 16,
              padding: "12px 0",
            }}
          >
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>Captain</div>
              <div style={{ fontWeight: 700 }}>
                {data.picks.find((p) => p.isCaptain)?.webName ?? "N/A"}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>
                Vice Captain
              </div>
              <div style={{ fontWeight: 700 }}>
                {data.picks.find((p) => p.isViceCaptain)?.webName ?? "N/A"}
              </div>
            </div>
          </div>
          <button
            className="btn-primary"
            style={{ width: "100%" }}
            disabled={simLoading}
            onClick={runSimulation}
          >
            {simLoading ? "Simulating..." : "Simulate VC Activation"}
          </button>
        </div>
      )}

      {/* Simulation result */}
      {simResult && !simResult.originalPoints && simResult.description && (
        <div className="card" style={{ textAlign: "center" }}>
          <p style={{ color: "var(--muted)" }}>{simResult.description}</p>
        </div>
      )}

      {simResult && simResult.originalPoints !== undefined && (
        <div className="card-glow fade-in">
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--muted)",
              marginBottom: 16,
              textAlign: "center",
            }}
          >
            SIMULATION RESULT: {simResult.description}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto 1fr",
              gap: 16,
              alignItems: "center",
              textAlign: "center",
            }}
          >
            <div>
              <div className="stat-label">Original</div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>
                {simResult.originalPoints} pts
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>
                Rank: {formatRank(simResult.originalRank)}
              </div>
            </div>
            <div
              style={{
                fontSize: 28,
                color: "var(--muted-light)",
              }}
            >
              &#8594;
            </div>
            <div>
              <div className="stat-label">Simulated</div>
              <div
                style={{
                  fontSize: 24,
                  fontWeight: 700,
                  color:
                    simResult.pointsDifference > 0
                      ? "var(--success)"
                      : simResult.pointsDifference < 0
                        ? "var(--danger)"
                        : "inherit",
                }}
              >
                {simResult.simulatedPoints} pts
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>
                Rank: {formatRank(simResult.simulatedRank)}
              </div>
            </div>
          </div>

          <div
            style={{
              textAlign: "center",
              marginTop: 20,
              padding: "12px",
              borderRadius: 8,
              background:
                simResult.pointsDifference > 0
                  ? "rgba(16,185,129,0.1)"
                  : simResult.pointsDifference < 0
                    ? "rgba(239,68,68,0.1)"
                    : "var(--background)",
            }}
          >
            <span
              style={{
                fontSize: 16,
                fontWeight: 700,
                color:
                  simResult.pointsDifference > 0
                    ? "var(--success)"
                    : simResult.pointsDifference < 0
                      ? "var(--danger)"
                      : "var(--muted)",
              }}
            >
              {simResult.pointsDifference > 0
                ? `+${simResult.pointsDifference} points, +${formatRank(simResult.rankDifference)} rank positions`
                : simResult.pointsDifference < 0
                  ? `${simResult.pointsDifference} points, ${formatRank(simResult.rankDifference)} rank positions`
                  : "No change"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Feature 4: Team Visualizer Tab ----------

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
  10: "#C8102E", // Liverpool (was Ipswich in some seasons, adjust as needed)
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

function TeamVisualizerTab({ data }: { data: DashboardData }) {
  const starters = data.picks.filter((p) => p.position <= 11);
  const bench = data.picks.filter((p) => p.position > 11);

  // Group starters by position type
  const gkp = starters.filter((p) => p.elementType === 1);
  const def = starters.filter((p) => p.elementType === 2);
  const mid = starters.filter((p) => p.elementType === 3);
  const fwd = starters.filter((p) => p.elementType === 4);

  return (
    <div className="fade-in">
      {/* Pitch view */}
      <div className="pitch" style={{ marginBottom: 16, paddingBottom: 24 }}>
        <div
          style={{
            position: "relative",
            zIndex: 1,
            display: "flex",
            flexDirection: "column",
            gap: 20,
            alignItems: "center",
          }}
        >
          {/* FWD row */}
          <PitchRow players={fwd} data={data} />
          {/* MID row */}
          <PitchRow players={mid} data={data} />
          {/* DEF row */}
          <PitchRow players={def} data={data} />
          {/* GKP row */}
          <PitchRow players={gkp} data={data} />
        </div>
      </div>

      {/* Bench */}
      <div
        className="card"
        style={{
          background: "var(--bench-bg)",
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--muted)",
            marginBottom: 12,
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
              <div
                className="player-name"
                style={{ color: "var(--muted-light)" }}
              >
                {p.webName}
              </div>
              <div className="player-points">{p.points}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PitchRow({
  players,
  data,
}: {
  players: EnrichedPick[];
  data: DashboardData;
}) {
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
          <div className="player-points">
            {p.points * (p.multiplier || 1)}
          </div>
          {p.isCaptain && (
            <span
              className="badge badge-captain"
              style={{ fontSize: 9, padding: "1px 4px" }}
            >
              C
            </span>
          )}
          {p.isViceCaptain && (
            <span
              className="badge badge-vice"
              style={{ fontSize: 9, padding: "1px 4px" }}
            >
              V
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------- Feature 5: Fixtures Tab ----------

function FixturesTab({ data }: { data: DashboardData }) {
  const [fixtureRows, setFixtureRows] = useState<FixtureDifficultyRow[]>([]);
  const [fixturesLoading, setFixturesLoading] = useState(true);
  const [captainSuggestions, setCaptainSuggestions] = useState<
    { element: number; webName: string; xPts: number; fixtureLabel: string }[]
  >([]);
  const [debugInfo, setDebugInfo] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchFixtureData() {
      try {
        const res = await fetch("/api/fpl/bootstrap");
        const bootstrap = await res.json();

        if (cancelled) return;

        if (!bootstrap.ok) {
          setDebugInfo(`Bootstrap API error: ${bootstrap.error || bootstrap.status}`);
          setFixturesLoading(false);
          return;
        }

        const fixtures: FPLFixture[] = bootstrap.fixtures || [];
        const teams: FPLTeam[] = (bootstrap.teams || []).map(
          (t: { id: number; name: string; short_name: string }) => ({
            id: t.id,
            name: t.name,
            short_name: t.short_name,
          })
        );
        // Use bootstrap currentGW if available, otherwise fall back to data.gameweek
        const currentGW = bootstrap.currentGW || data.gameweek;

        // Debug info
        if (fixtures.length === 0 || teams.length === 0) {
          setDebugInfo(`No data: ${fixtures.length} fixtures, ${teams.length} teams, currentGW=${currentGW}`);
        }

        // Build fixture difficulty grid
        const rows = buildFixtureDifficultyGrid(fixtures, teams, currentGW, 10);
        setFixtureRows(rows);

        // Build captain suggestions
        const squadIds = data.picks.map((p) => p.element);
        const allPlayers: PlayerMeta[] = (bootstrap.elements || []).map(
          (e: {
            id: number;
            web_name: string;
            team: number;
            element_type: number;
            now_cost: number;
            status: string;
          }) => ({
            id: e.id,
            web_name: e.web_name,
            team: e.team,
            element_type: e.element_type,
            now_cost: e.now_cost,
            status: e.status,
            element_summary: [],
          })
        );

        const suggestions = suggestNextGWCaptain(
          squadIds,
          allPlayers,
          fixtures,
          teams,
          currentGW
        );
        setCaptainSuggestions(suggestions);
      } catch (err) {
        setDebugInfo(`Fetch error: ${String(err)}`);
      }
      if (!cancelled) setFixturesLoading(false);
    }

    fetchFixtureData();
    return () => {
      cancelled = true;
    };
  }, [data.gameweek, data.picks]);

  // Get squad team IDs for highlighting
  const squadTeamIds = [...new Set(data.picks.map((p) => p.teamId))];

  if (fixturesLoading) {
    return (
      <div className="fade-in" style={{ textAlign: "center", padding: 40 }}>
        <div className="spinner" style={{ margin: "0 auto 16px" }} />
        <p style={{ color: "var(--muted)" }}>Loading fixture data...</p>
      </div>
    );
  }

  // Show debug info if data loading failed or rows are empty
  if (debugInfo || fixtureRows.length === 0) {
    return (
      <div className="fade-in">
        <div className="card" style={{ textAlign: "center", padding: 40 }}>
          <p style={{ color: "var(--warning)", marginBottom: 8 }}>
            Unable to load fixture data
          </p>
          {debugInfo && (
            <p style={{ color: "var(--muted)", fontSize: 12 }}>{debugInfo}</p>
          )}
          {!debugInfo && fixtureRows.length === 0 && (
            <p style={{ color: "var(--muted)", fontSize: 12 }}>
              No fixture rows generated. This may indicate a data issue with the FPL API.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="fade-in">
      {/* Captain Suggestion Card */}
      {captainSuggestions.length > 0 && (
        <div className="card-glow" style={{ marginBottom: 20 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--muted)",
              marginBottom: 12,
            }}
          >
            CAPTAIN SUGGESTIONS (GW{data.gameweek})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {captainSuggestions.map((s, idx) => (
              <div
                key={s.element}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px 14px",
                  borderRadius: 8,
                  background:
                    idx === 0
                      ? "linear-gradient(135deg, rgba(0,255,135,0.12), rgba(0,255,135,0.04))"
                      : "var(--background)",
                  border: idx === 0 ? "1px solid var(--accent)" : "none",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: "50%",
                      background:
                        idx === 0
                          ? "var(--accent)"
                          : idx === 1
                            ? "#C0C0C0"
                            : "#CD7F32",
                      color: idx === 0 ? "#000" : "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    {idx + 1}
                  </span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>
                      {s.webName}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>
                      {s.fixtureLabel}
                    </div>
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: 18,
                      color: idx === 0 ? "var(--accent-dark)" : "inherit",
                    }}
                  >
                    {s.xPts.toFixed(1)}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>
                    xPts
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Fixture Difficulty Grid */}
      <div className="card">
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--muted)",
            marginBottom: 12,
          }}
        >
          FIXTURE DIFFICULTY (NEXT 10 GWs)
        </div>
        <FixtureDifficultyGrid
          rows={fixtureRows}
          currentGW={data.gameweek}
          numGWs={10}
          highlightTeamIds={squadTeamIds}
        />
      </div>
    </div>
  );
}

// ---------- Shared Components ----------

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
    <div className="card" style={{ textAlign: "center" }}>
      <div className="stat-label">{label}</div>
      <div
        style={{
          fontSize: 24,
          fontWeight: 700,
          color: accent ? "var(--accent-dark)" : "inherit",
          marginTop: 4,
        }}
      >
        {value}
      </div>
      {sublabel && (
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
          {sublabel}
        </div>
      )}
    </div>
  );
}

// ---------- Utility ----------

function formatRank(rank: number): string {
  if (rank === 0) return "-";
  if (Math.abs(rank) >= 1_000_000) return `${(rank / 1_000_000).toFixed(1)}M`;
  if (Math.abs(rank) >= 1_000) return `${(rank / 1_000).toFixed(0)}K`;
  return rank.toLocaleString();
}

function positionLabel(elementType: number): string {
  switch (elementType) {
    case 1: return "GKP";
    case 2: return "DEF";
    case 3: return "MID";
    case 4: return "FWD";
    default: return "???";
  }
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
