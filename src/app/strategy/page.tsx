"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";

// ---------- Types ----------

interface TransferSuggestion {
  out_player: { id: number; name: string; team: number; position: number; cost: number };
  in_player: { id: number; name: string; team: number; position: number; cost: number };
  projected_gain_next_gw: number;
  projected_gain_3_gw: number;
}

interface TransferData {
  gameweek: number;
  teamId: number;
  suggested_transfers: TransferSuggestion[];
  expected_points_gain_next_gw: number;
  expected_points_gain_next_3_gw: number;
  free_transfers: number;
  budget_remaining: number;
  hit_cost: number;
  error?: string;
}

interface ChipData {
  gameweek: number;
  bench_boost: {
    bench_boost_value: number;
    optimal_gw_for_bb: number;
    optimal_bb_value: number;
    current_bench_xpts: number;
    recommendation: string;
  };
  triple_captain: {
    best_tc_candidate: { id: number; name: string; xpts: number };
    expected_tc_gain: number;
    recommended_gw: number;
    current_gw_value: number;
    recommendation: string;
  };
  free_hit: {
    current_squad_xpts: number;
    free_hit_squad_xpts: number;
    potential_gain: number;
    recommended_gw: number;
    recommendation: string;
  };
  wildcard: {
    squad_strength_score: number;
    recommended_use: boolean;
    reason: string;
    weak_positions: string[];
  };
  chips_available: string[];
  error?: string;
}

interface RiskData {
  gameweek: number;
  risk_score: number;
  differential_count: number;
  template_exposure: number;
  playstyle: string;
  suggestions: string[];
  player_ownership: {
    id: number;
    name: string;
    ownership: number;
    is_differential: boolean;
  }[];
  error?: string;
}

interface FixtureSwing {
  team_id: number;
  team_name: string;
  short_name: string;
  difficulty_trend: string;
  avg_difficulty_next_3: number;
  avg_difficulty_next_5: number;
  upcoming_fixtures: {
    gw: number;
    opponent: string;
    difficulty: number;
    is_home: boolean;
  }[];
  target_players: {
    id: number;
    name: string;
    position: number;
    xpts: number;
  }[];
}

interface FixtureData {
  gameweek: number;
  fixture_swings: FixtureSwing[];
  error?: string;
}

// ---------- Main Page ----------

export default function StrategyPage() {
  return (
    <Suspense
      fallback={
        <div style={{ padding: 40, textAlign: "center" }}>
          <div className="spinner" style={{ margin: "0 auto" }} />
        </div>
      }
    >
      <StrategyInner />
    </Suspense>
  );
}

function StrategyInner() {
  const searchParams = useSearchParams();
  const teamIdParam = searchParams.get("teamId") || "";

  const [teamId, setTeamId] = useState(teamIdParam);
  const [inputId, setInputId] = useState(teamIdParam);
  const [tab, setTab] = useState<"transfers" | "chips" | "fixtures" | "risk">(
    "transfers"
  );
  const [transferData, setTransferData] = useState<TransferData | null>(null);
  const [chipData, setChipData] = useState<ChipData | null>(null);
  const [riskData, setRiskData] = useState<RiskData | null>(null);
  const [fixtureData, setFixtureData] = useState<FixtureData | null>(null);
  const [loading, setLoading] = useState(false);

  async function fetchStrategyData(id: string) {
    if (!id) return;
    setLoading(true);

    // Fetch all strategy data in parallel
    const [transfersRes, chipsRes, riskRes, fixturesRes] = await Promise.all([
      fetch(`/api/fpl/strategy/transfers?teamId=${id}`).then((r) => r.json()).catch((e) => ({ error: String(e) })),
      fetch(`/api/fpl/strategy/chips?teamId=${id}`).then((r) => r.json()).catch((e) => ({ error: String(e) })),
      fetch(`/api/fpl/strategy/risk?teamId=${id}`).then((r) => r.json()).catch((e) => ({ error: String(e) })),
      fetch(`/api/fpl/strategy/fixtures`).then((r) => r.json()).catch((e) => ({ error: String(e) })),
    ]);

    setTransferData(transfersRes);
    setChipData(chipsRes);
    setRiskData(riskRes);
    setFixtureData(fixturesRes);
    setLoading(false);
  }

  useEffect(() => {
    if (teamId) fetchStrategyData(teamId);
  }, [teamId]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const id = inputId.trim();
    if (id && !isNaN(Number(id))) {
      setTeamId(id);
    }
  }

  if (!teamId) {
    return (
      <div
        style={{
          maxWidth: 500,
          margin: "0 auto",
          padding: "60px 16px",
          textAlign: "center",
        }}
      >
        <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 8 }}>
          Strategy Planner
        </h1>
        <p
          style={{
            color: "var(--muted)",
            fontSize: 15,
            marginBottom: 32,
          }}
        >
          Transfer optimization, chip timing, fixture swings, and risk analysis.
        </p>
        <form
          onSubmit={handleSubmit}
          style={{
            display: "flex",
            gap: 12,
            justifyContent: "center",
            flexWrap: "wrap",
          }}
        >
          <input
            type="text"
            inputMode="numeric"
            placeholder="Enter your FPL Team ID"
            value={inputId}
            onChange={(e) => setInputId(e.target.value)}
            style={{
              padding: "12px 20px",
              fontSize: 15,
              borderRadius: 10,
              border: "1px solid var(--card-border)",
              background: "var(--card)",
              color: "var(--foreground)",
              width: 260,
            }}
          />
          <button type="submit" className="btn-primary">
            Plan Strategy
          </button>
        </form>
      </div>
    );
  }

  if (loading && !transferData) {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <div className="spinner" style={{ margin: "0 auto 16px" }} />
        <p style={{ color: "var(--muted)" }}>
          Analyzing strategy options...
        </p>
      </div>
    );
  }

  return (
    <div
      style={{ maxWidth: 900, margin: "0 auto", padding: "20px 16px" }}
      className="fade-in"
    >
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 2 }}>
          Strategy Planner
        </h1>
        <p style={{ color: "var(--muted)", fontSize: 14 }}>
          Team {teamId} &middot; Future Planning &amp; Optimization
        </p>
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
            ["transfers", "Transfers"],
            ["chips", "Chips"],
            ["fixtures", "Fixtures"],
            ["risk", "Risk Profile"],
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

      {tab === "transfers" && <TransfersTab data={transferData} />}
      {tab === "chips" && <ChipsTab data={chipData} />}
      {tab === "fixtures" && <FixturesTab data={fixtureData} />}
      {tab === "risk" && <RiskTab data={riskData} />}
    </div>
  );
}

// ---------- Transfers Tab ----------

function TransfersTab({ data }: { data: TransferData | null }) {
  if (!data || data.error) {
    return (
      <div className="card" style={{ textAlign: "center" }}>
        <p style={{ color: "var(--muted)" }}>
          {data?.error || "Transfer data unavailable."}
        </p>
      </div>
    );
  }

  return (
    <div className="fade-in">
      {/* Summary */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <div className="card" style={{ textAlign: "center" }}>
          <div className="stat-label">Next GW Gain</div>
          <div
            style={{
              fontSize: 24,
              fontWeight: 700,
              color:
                data.expected_points_gain_next_gw > 0
                  ? "var(--success)"
                  : "var(--muted)",
              marginTop: 4,
            }}
          >
            {data.expected_points_gain_next_gw > 0 ? "+" : ""}
            {data.expected_points_gain_next_gw} xPts
          </div>
        </div>
        <div className="card-glow" style={{ textAlign: "center" }}>
          <div className="stat-label">3 GW Gain</div>
          <div
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: "var(--accent-dark)",
              marginTop: 4,
            }}
          >
            {data.expected_points_gain_next_3_gw > 0 ? "+" : ""}
            {data.expected_points_gain_next_3_gw} xPts
          </div>
        </div>
        <div className="card" style={{ textAlign: "center" }}>
          <div className="stat-label">Free Transfers</div>
          <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>
            {data.free_transfers}
          </div>
        </div>
        <div className="card" style={{ textAlign: "center" }}>
          <div className="stat-label">Hit Cost</div>
          <div
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: data.hit_cost > 0 ? "var(--danger)" : "var(--success)",
              marginTop: 4,
            }}
          >
            {data.hit_cost > 0 ? `-${data.hit_cost}` : "0"}
          </div>
        </div>
      </div>

      {/* Transfer Suggestions */}
      <div className="card">
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--muted)",
            marginBottom: 12,
          }}
        >
          SUGGESTED TRANSFERS
        </div>
        {data.suggested_transfers.length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: 14 }}>
            No beneficial transfers found. Your squad looks well-optimized.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {data.suggested_transfers.map((t, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px",
                  borderRadius: 8,
                  background: "var(--background)",
                }}
              >
                {/* Out player */}
                <div
                  style={{
                    flex: 1,
                    padding: "8px 12px",
                    borderRadius: 8,
                    background: "rgba(239,68,68,0.08)",
                    borderLeft: "3px solid var(--danger)",
                  }}
                >
                  <div style={{ fontSize: 11, color: "var(--danger)", fontWeight: 600 }}>
                    OUT
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>
                    {t.out_player.name}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    {formatCost(t.out_player.cost)} &middot;{" "}
                    {posLabel(t.out_player.position)}
                  </div>
                </div>

                <div style={{ fontSize: 20, color: "var(--muted-light)" }}>
                  &#8594;
                </div>

                {/* In player */}
                <div
                  style={{
                    flex: 1,
                    padding: "8px 12px",
                    borderRadius: 8,
                    background: "rgba(16,185,129,0.08)",
                    borderLeft: "3px solid var(--success)",
                  }}
                >
                  <div style={{ fontSize: 11, color: "var(--success)", fontWeight: 600 }}>
                    IN
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>
                    {t.in_player.name}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    {formatCost(t.in_player.cost)} &middot;{" "}
                    {posLabel(t.in_player.position)}
                  </div>
                </div>

                {/* Gain */}
                <div style={{ textAlign: "right", minWidth: 70 }}>
                  <div
                    style={{
                      fontWeight: 700,
                      color:
                        t.projected_gain_3_gw > 0
                          ? "var(--success)"
                          : "var(--danger)",
                    }}
                  >
                    {t.projected_gain_3_gw > 0 ? "+" : ""}
                    {t.projected_gain_3_gw}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>
                    3 GW xPts
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Chips Tab ----------

function ChipsTab({ data }: { data: ChipData | null }) {
  if (!data || data.error) {
    return (
      <div className="card" style={{ textAlign: "center" }}>
        <p style={{ color: "var(--muted)" }}>
          {data?.error || "Chip data unavailable."}
        </p>
      </div>
    );
  }

  return (
    <div className="fade-in">
      {/* Available Chips */}
      <div
        style={{
          display: "flex",
          gap: 8,
          marginBottom: 20,
          flexWrap: "wrap",
        }}
      >
        {data.chips_available.map((chip) => (
          <span
            key={chip}
            className="badge"
            style={{
              background: "var(--accent)",
              color: "var(--primary)",
              padding: "4px 12px",
              fontSize: 12,
            }}
          >
            {chipLabel(chip)}
          </span>
        ))}
        {data.chips_available.length === 0 && (
          <span style={{ color: "var(--muted)", fontSize: 13 }}>
            All chips used
          </span>
        )}
      </div>

      {/* Bench Boost */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
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
              BENCH BOOST
            </div>
            <div style={{ fontSize: 14, marginBottom: 8 }}>
              {data.bench_boost.recommendation}
            </div>
          </div>
          <div
            style={{
              textAlign: "right",
            }}
          >
            <div style={{ fontSize: 24, fontWeight: 700, color: "var(--accent-dark)" }}>
              {data.bench_boost.bench_boost_value}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>
              Bench xPts
            </div>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            gap: 16,
            marginTop: 8,
            fontSize: 13,
            color: "var(--muted)",
          }}
        >
          <span>
            Best GW: <strong>GW{data.bench_boost.optimal_gw_for_bb}</strong>
          </span>
          <span>
            Best value:{" "}
            <strong>{data.bench_boost.optimal_bb_value} xPts</strong>
          </span>
        </div>
      </div>

      {/* Triple Captain */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
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
              TRIPLE CAPTAIN
            </div>
            <div style={{ fontSize: 14, marginBottom: 8 }}>
              {data.triple_captain.recommendation}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: "var(--accent-dark)" }}>
              {data.triple_captain.expected_tc_gain}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>
              TC Gain xPts
            </div>
          </div>
        </div>
        <div
          style={{
            marginTop: 8,
            padding: "8px 12px",
            background: "var(--background)",
            borderRadius: 8,
            fontSize: 13,
          }}
        >
          Best candidate:{" "}
          <strong>{data.triple_captain.best_tc_candidate.name}</strong> (
          {data.triple_captain.best_tc_candidate.xpts} xPts) &middot; Best GW:{" "}
          <strong>GW{data.triple_captain.recommended_gw}</strong>
        </div>
      </div>

      {/* Free Hit */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
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
              FREE HIT
            </div>
            <div style={{ fontSize: 14, marginBottom: 8 }}>
              {data.free_hit.recommendation}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: "var(--accent-dark)" }}>
              +{data.free_hit.potential_gain}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>
              Potential Gain
            </div>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            gap: 16,
            marginTop: 8,
            fontSize: 13,
            color: "var(--muted)",
          }}
        >
          <span>
            Current: <strong>{data.free_hit.current_squad_xpts} xPts</strong>
          </span>
          <span>
            FH Squad:{" "}
            <strong>{data.free_hit.free_hit_squad_xpts} xPts</strong>
          </span>
          <span>
            Best GW: <strong>GW{data.free_hit.recommended_gw}</strong>
          </span>
        </div>
      </div>

      {/* Wildcard */}
      <div className="card">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
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
              WILDCARD
            </div>
            <div style={{ fontSize: 14, marginBottom: 8 }}>
              {data.wildcard.reason}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div
              style={{
                fontSize: 24,
                fontWeight: 700,
                color: data.wildcard.recommended_use
                  ? "var(--warning)"
                  : "var(--success)",
              }}
            >
              {data.wildcard.squad_strength_score}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>
              Strength /100
            </div>
          </div>
        </div>
        {data.wildcard.weak_positions.length > 0 && (
          <div style={{ marginTop: 8, fontSize: 13, color: "var(--warning)" }}>
            Weak positions: {data.wildcard.weak_positions.join(", ")}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Fixtures Tab ----------

function FixturesTab({ data }: { data: FixtureData | null }) {
  if (!data || data.error) {
    return (
      <div className="card" style={{ textAlign: "center" }}>
        <p style={{ color: "var(--muted)" }}>
          {data?.error || "Fixture data unavailable."}
        </p>
      </div>
    );
  }

  const trendColors: Record<string, string> = {
    improving: "var(--success)",
    worsening: "var(--danger)",
    stable: "var(--muted)",
  };

  const difficultyColors: Record<number, string> = {
    1: "#375523",
    2: "#01fc7a",
    3: "#e7e7e7",
    4: "#ff1751",
    5: "#861d46",
  };

  return (
    <div className="fade-in">
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: "var(--muted)",
          marginBottom: 12,
        }}
      >
        FIXTURE DIFFICULTY RANKINGS (Next 3 GWs)
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {data.fixture_swings.map((team) => (
          <div key={team.team_id} className="card">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                marginBottom: 10,
              }}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>
                  {team.team_name}
                  <span
                    style={{
                      marginLeft: 8,
                      fontSize: 12,
                      color: trendColors[team.difficulty_trend],
                      fontWeight: 600,
                    }}
                  >
                    {team.difficulty_trend === "improving"
                      ? "&#9650; Improving"
                      : team.difficulty_trend === "worsening"
                        ? "&#9660; Worsening"
                        : "&#8212; Stable"}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  Avg FDR (3 GW): {team.avg_difficulty_next_3} &middot; Avg FDR
                  (5 GW): {team.avg_difficulty_next_5}
                </div>
              </div>
            </div>

            {/* Fixture strip */}
            <div
              style={{
                display: "flex",
                gap: 6,
                marginBottom: 10,
                overflowX: "auto",
              }}
            >
              {team.upcoming_fixtures.map((f, i) => (
                <div
                  key={i}
                  style={{
                    minWidth: 56,
                    padding: "6px 8px",
                    borderRadius: 6,
                    background: difficultyColors[f.difficulty] || "#e7e7e7",
                    color: f.difficulty >= 4 ? "white" : f.difficulty <= 1 ? "white" : "#333",
                    textAlign: "center",
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  <div style={{ fontSize: 10, opacity: 0.7 }}>GW{f.gw}</div>
                  <div>
                    {f.opponent} ({f.is_home ? "H" : "A"})
                  </div>
                </div>
              ))}
            </div>

            {/* Target players */}
            {team.target_players.length > 0 && (
              <div style={{ fontSize: 12, color: "var(--muted)" }}>
                <span style={{ fontWeight: 600 }}>Targets: </span>
                {team.target_players.map((p, i) => (
                  <span key={p.id}>
                    {p.name} ({p.xpts} xPts)
                    {i < team.target_players.length - 1 ? ", " : ""}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- Risk Profile Tab ----------

function RiskTab({ data }: { data: RiskData | null }) {
  if (!data || data.error) {
    return (
      <div className="card" style={{ textAlign: "center" }}>
        <p style={{ color: "var(--muted)" }}>
          {data?.error || "Risk data unavailable."}
        </p>
      </div>
    );
  }

  const playstyleColors: Record<string, string> = {
    template_heavy: "var(--primary-light)",
    balanced: "var(--accent-dark)",
    high_risk_differential: "var(--warning)",
  };

  const playstyleLabels: Record<string, string> = {
    template_heavy: "Template Heavy",
    balanced: "Balanced",
    high_risk_differential: "High Risk Differential",
  };

  return (
    <div className="fade-in">
      {/* Risk Overview */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <div className="card-glow" style={{ textAlign: "center" }}>
          <div className="stat-label">Risk Score</div>
          <div
            style={{
              fontSize: 32,
              fontWeight: 700,
              color: playstyleColors[data.playstyle] || "inherit",
              marginTop: 4,
            }}
          >
            {data.risk_score}
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>/100</div>
        </div>
        <div className="card" style={{ textAlign: "center" }}>
          <div className="stat-label">Playstyle</div>
          <div
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: playstyleColors[data.playstyle] || "inherit",
              marginTop: 8,
            }}
          >
            {playstyleLabels[data.playstyle] || data.playstyle}
          </div>
        </div>
        <div className="card" style={{ textAlign: "center" }}>
          <div className="stat-label">Differentials</div>
          <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>
            {data.differential_count}
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>
            &lt;10% owned
          </div>
        </div>
        <div className="card" style={{ textAlign: "center" }}>
          <div className="stat-label">Template Exposure</div>
          <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>
            {data.template_exposure}%
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>
            &gt;20% owned
          </div>
        </div>
      </div>

      {/* Suggestions */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--muted)",
            marginBottom: 12,
          }}
        >
          STRATEGY INSIGHTS
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {data.suggestions.map((s, i) => (
            <div
              key={i}
              style={{
                padding: "10px 12px",
                borderRadius: 8,
                background: "var(--background)",
                borderLeft: "3px solid var(--primary-light)",
                fontSize: 14,
              }}
            >
              {s}
            </div>
          ))}
        </div>
      </div>

      {/* Player Ownership */}
      <div className="card">
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--muted)",
            marginBottom: 12,
          }}
        >
          SQUAD OWNERSHIP BREAKDOWN
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {data.player_ownership
            .sort((a, b) => b.ownership - a.ownership)
            .map((p) => (
              <div
                key={p.id}
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
                  <span style={{ fontWeight: 600, fontSize: 14 }}>
                    {p.name}
                  </span>
                  {p.is_differential && (
                    <span
                      className="badge"
                      style={{
                        background: "var(--warning)",
                        color: "white",
                        fontSize: 10,
                      }}
                    >
                      DIFF
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div
                    style={{
                      width: 60,
                      height: 6,
                      borderRadius: 3,
                      background: "var(--card-border)",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${Math.min(p.ownership, 100)}%`,
                        height: "100%",
                        borderRadius: 3,
                        background:
                          p.ownership >= 20
                            ? "var(--primary-light)"
                            : p.ownership >= 10
                              ? "var(--accent-dark)"
                              : "var(--warning)",
                      }}
                    />
                  </div>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--muted)",
                      minWidth: 45,
                      textAlign: "right",
                    }}
                  >
                    {p.ownership}%
                  </span>
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

// ---------- Utilities ----------

function formatCost(cost: number): string {
  return `${(cost / 10).toFixed(1)}m`;
}

function posLabel(pos: number): string {
  switch (pos) {
    case 1:
      return "GKP";
    case 2:
      return "DEF";
    case 3:
      return "MID";
    case 4:
      return "FWD";
    default:
      return "???";
  }
}

function chipLabel(chip: string): string {
  switch (chip) {
    case "bench_boost":
      return "Bench Boost";
    case "triple_captain":
      return "Triple Captain";
    case "free_hit":
      return "Free Hit";
    case "wildcard":
      return "Wildcard";
    default:
      return chip;
  }
}
