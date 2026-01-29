"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";

// ---------- Types ----------

interface ThreatRadarEntry {
  entry: number;
  entry_name: string;
  player_name: string;
  total: number;
  event_total: number;
  gap: number;
  can_overtake_this_gw: boolean;
  threat_level: "low" | "medium" | "high" | "critical";
  direction: "above" | "below";
}

interface OvertakeCondition {
  rival_entry: number;
  rival_name: string;
  gap: number;
  points_needed: number;
  scenario: string;
}

interface RivalComparison {
  rival_entry: number;
  rival_name: string;
  rival_total: number;
  rival_gw_points: number;
  your_total: number;
  your_gw_points: number;
  shared_players: number;
  differential_players: {
    yours: string[];
    theirs: string[];
  };
  captain_comparison: {
    your_captain: string;
    their_captain: string;
    same: boolean;
  };
}

interface LeagueStanding {
  entry: number;
  entry_name: string;
  player_name: string;
  rank: number;
  last_rank: number;
  total: number;
  event_total: number;
}

interface LeagueData {
  gameweek: number;
  league_name: string;
  your_rank: number;
  your_entry: number;
  total_entries: number;
  standings: LeagueStanding[];
  threat_radar: ThreatRadarEntry[];
  overtake_conditions: OvertakeCondition[];
  rival_comparisons: RivalComparison[];
  error?: string;
}

// ---------- Main Page ----------

export default function LeaguesPage() {
  return (
    <Suspense
      fallback={
        <div style={{ padding: 40, textAlign: "center" }}>
          <div className="spinner" style={{ margin: "0 auto" }} />
        </div>
      }
    >
      <LeaguesInner />
    </Suspense>
  );
}

function LeaguesInner() {
  const searchParams = useSearchParams();
  const teamIdParam = searchParams.get("teamId") || "";
  const leagueIdParam = searchParams.get("leagueId") || "";

  const [teamId, setTeamId] = useState(teamIdParam);
  const [leagueId, setLeagueId] = useState(leagueIdParam);
  const [inputTeamId, setInputTeamId] = useState(teamIdParam);
  const [inputLeagueId, setInputLeagueId] = useState(leagueIdParam);
  const [data, setData] = useState<LeagueData | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"standings" | "threats" | "rivals">(
    "standings"
  );

  async function fetchLeagueData(tid: string, lid: string) {
    if (!tid || !lid) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/fpl/league/live?leagueId=${lid}&teamId=${tid}`
      );
      const json = await res.json();
      if (json.error) {
        setData({ error: json.error } as LeagueData);
      } else {
        setData(json);
      }
    } catch (e) {
      setData({ error: String(e) } as LeagueData);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (teamId && leagueId) fetchLeagueData(teamId, leagueId);
  }, [teamId, leagueId]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (inputTeamId.trim() && inputLeagueId.trim()) {
      setTeamId(inputTeamId.trim());
      setLeagueId(inputLeagueId.trim());
    }
  }

  if (!teamId || !leagueId) {
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
          League Intelligence
        </h1>
        <p
          style={{
            color: "var(--muted)",
            fontSize: 15,
            marginBottom: 32,
          }}
        >
          Analyze your mini-league competition, threats, and rival decisions.
        </p>
        <form
          onSubmit={handleSubmit}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            alignItems: "center",
          }}
        >
          <input
            type="text"
            inputMode="numeric"
            placeholder="Your FPL Team ID"
            value={inputTeamId}
            onChange={(e) => setInputTeamId(e.target.value)}
            style={{
              padding: "12px 20px",
              fontSize: 15,
              borderRadius: 10,
              border: "1px solid var(--card-border)",
              background: "var(--card)",
              color: "var(--foreground)",
              width: 280,
            }}
          />
          <input
            type="text"
            inputMode="numeric"
            placeholder="Classic League ID"
            value={inputLeagueId}
            onChange={(e) => setInputLeagueId(e.target.value)}
            style={{
              padding: "12px 20px",
              fontSize: 15,
              borderRadius: 10,
              border: "1px solid var(--card-border)",
              background: "var(--card)",
              color: "var(--foreground)",
              width: 280,
            }}
          />
          <button type="submit" className="btn-primary" style={{ width: 280 }}>
            Analyze League
          </button>
          <p style={{ fontSize: 12, color: "var(--muted-light)", marginTop: 8 }}>
            Find your League ID in the league URL on the FPL website
          </p>
        </form>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <div className="spinner" style={{ margin: "0 auto 16px" }} />
        <p style={{ color: "var(--muted)" }}>Analyzing league...</p>
      </div>
    );
  }

  if (data?.error) {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <p style={{ color: "var(--danger)", marginBottom: 16 }}>
          Error: {data.error}
        </p>
        <button
          className="btn-secondary"
          onClick={() => fetchLeagueData(teamId, leagueId)}
        >
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
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 2 }}>
          {data.league_name}
        </h1>
        <p style={{ color: "var(--muted)", fontSize: 14 }}>
          Your rank: {data.your_rank} of {data.total_entries} &middot; GW
          {data.gameweek}
        </p>
      </div>

      {/* Quick Stats */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 12,
          marginBottom: 24,
        }}
      >
        <div className="card" style={{ textAlign: "center" }}>
          <div className="stat-label">Your Rank</div>
          <div
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: "var(--accent-dark)",
              marginTop: 4,
            }}
          >
            {data.your_rank}
          </div>
        </div>
        <div className="card" style={{ textAlign: "center" }}>
          <div className="stat-label">Total Entries</div>
          <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>
            {data.total_entries}
          </div>
        </div>
        <div className="card" style={{ textAlign: "center" }}>
          <div className="stat-label">Threats Nearby</div>
          <div
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: "var(--warning)",
              marginTop: 4,
            }}
          >
            {
              data.threat_radar.filter(
                (t) =>
                  t.threat_level === "critical" || t.threat_level === "high"
              ).length
            }
          </div>
        </div>
        <div className="card" style={{ textAlign: "center" }}>
          <div className="stat-label">Rivals Analyzed</div>
          <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>
            {data.rival_comparisons.length}
          </div>
        </div>
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
            ["standings", "Standings"],
            ["threats", "Threat Radar"],
            ["rivals", "Rival Analysis"],
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

      {tab === "standings" && <StandingsTab data={data} />}
      {tab === "threats" && <ThreatsTab data={data} />}
      {tab === "rivals" && <RivalsTab data={data} />}
    </div>
  );
}

// ---------- Standings Tab ----------

function StandingsTab({ data }: { data: LeagueData }) {
  return (
    <div className="fade-in">
      <div className="card">
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--muted)",
            marginBottom: 12,
          }}
        >
          LEAGUE TABLE
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "40px 1fr 80px 80px",
            gap: 8,
            fontSize: 13,
            fontWeight: 600,
            color: "var(--muted-light)",
            marginBottom: 8,
            padding: "0 8px",
          }}
        >
          <span>#</span>
          <span>Team</span>
          <span style={{ textAlign: "right" }}>GW Pts</span>
          <span style={{ textAlign: "right" }}>Total</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {data.standings.map((s) => {
            const isYou = s.entry === data.your_entry;
            const rankChange = s.last_rank - s.rank;
            return (
              <div
                key={s.entry}
                style={{
                  display: "grid",
                  gridTemplateColumns: "40px 1fr 80px 80px",
                  gap: 8,
                  padding: "10px 8px",
                  borderRadius: 8,
                  background: isYou
                    ? "rgba(0,255,135,0.08)"
                    : "var(--background)",
                  border: isYou
                    ? "1px solid var(--accent)"
                    : "1px solid transparent",
                  alignItems: "center",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ fontWeight: 700 }}>{s.rank}</span>
                  {rankChange > 0 && (
                    <span style={{ fontSize: 10, color: "var(--success)" }}>
                      &#9650;
                    </span>
                  )}
                  {rankChange < 0 && (
                    <span style={{ fontSize: 10, color: "var(--danger)" }}>
                      &#9660;
                    </span>
                  )}
                </div>
                <div>
                  <div
                    style={{
                      fontWeight: isYou ? 700 : 600,
                      fontSize: 14,
                    }}
                  >
                    {s.entry_name}
                    {isYou && (
                      <span
                        className="badge"
                        style={{
                          marginLeft: 6,
                          background: "var(--accent)",
                          color: "var(--primary)",
                          fontSize: 10,
                        }}
                      >
                        YOU
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    {s.player_name}
                  </div>
                </div>
                <div
                  style={{
                    textAlign: "right",
                    fontWeight: 600,
                    color: "var(--muted)",
                  }}
                >
                  {s.event_total}
                </div>
                <div
                  style={{
                    textAlign: "right",
                    fontWeight: 700,
                    fontSize: 15,
                  }}
                >
                  {s.total}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------- Threats Tab ----------

function ThreatsTab({ data }: { data: LeagueData }) {
  const threatColors: Record<string, string> = {
    critical: "var(--danger)",
    high: "var(--warning)",
    medium: "var(--muted)",
    low: "var(--muted-light)",
  };

  return (
    <div className="fade-in">
      {/* Threat Radar */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--muted)",
            marginBottom: 12,
          }}
        >
          THREAT RADAR
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {data.threat_radar.slice(0, 10).map((t) => (
            <div
              key={t.entry}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "10px 12px",
                borderRadius: 8,
                background: "var(--background)",
                borderLeft: `3px solid ${threatColors[t.threat_level]}`,
              }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>
                  {t.entry_name}
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  {t.player_name} &middot; {t.total} pts &middot; GW{" "}
                  {t.event_total}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div
                  style={{
                    fontWeight: 700,
                    color:
                      t.gap >= 0 ? "var(--success)" : "var(--danger)",
                  }}
                >
                  {t.gap >= 0 ? `+${t.gap}` : t.gap} pts
                </div>
                <span
                  className="badge"
                  style={{
                    background: threatColors[t.threat_level],
                    color: "white",
                    fontSize: 10,
                  }}
                >
                  {t.threat_level.toUpperCase()}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Overtake Conditions */}
      {data.overtake_conditions.length > 0 && (
        <div className="card">
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--muted)",
              marginBottom: 12,
            }}
          >
            OVERTAKE CONDITIONS
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {data.overtake_conditions.map((c, i) => (
              <div
                key={i}
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  background: "var(--background)",
                  borderLeft: `3px solid ${
                    c.gap > 0 ? "var(--primary-light)" : "var(--warning)"
                  }`,
                }}
              >
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: 14,
                    marginBottom: 4,
                  }}
                >
                  {c.rival_name}{" "}
                  <span style={{ color: "var(--muted)", fontWeight: 400 }}>
                    ({c.gap > 0 ? `${c.gap} ahead` : `${Math.abs(c.gap)} behind`})
                  </span>
                </div>
                <div style={{ fontSize: 13, color: "var(--muted)" }}>
                  {c.scenario}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Rivals Tab ----------

function RivalsTab({ data }: { data: LeagueData }) {
  if (data.rival_comparisons.length === 0) {
    return (
      <div className="card" style={{ textAlign: "center" }}>
        <p style={{ color: "var(--muted)" }}>
          No rival comparison data available. This requires accessing rival team picks.
        </p>
      </div>
    );
  }

  return (
    <div className="fade-in">
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {data.rival_comparisons.map((r) => (
          <div key={r.rival_entry} className="card">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                marginBottom: 12,
              }}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>
                  vs {r.rival_name}
                </div>
                <div style={{ fontSize: 13, color: "var(--muted)" }}>
                  Their total: {r.rival_total} pts &middot; GW:{" "}
                  {r.rival_gw_points}
                </div>
              </div>
              <div
                style={{
                  fontWeight: 700,
                  fontSize: 18,
                  color:
                    r.your_total >= r.rival_total
                      ? "var(--success)"
                      : "var(--danger)",
                }}
              >
                {r.your_total >= r.rival_total ? "+" : ""}
                {r.your_total - r.rival_total}
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: 12,
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  textAlign: "center",
                  padding: 8,
                  background: "var(--background)",
                  borderRadius: 8,
                }}
              >
                <div className="stat-label">Shared</div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>
                  {r.shared_players}
                </div>
              </div>
              <div
                style={{
                  textAlign: "center",
                  padding: 8,
                  background: "var(--background)",
                  borderRadius: 8,
                }}
              >
                <div className="stat-label">Your Diffs</div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>
                  {r.differential_players.yours.length}
                </div>
              </div>
              <div
                style={{
                  textAlign: "center",
                  padding: 8,
                  background: "var(--background)",
                  borderRadius: 8,
                }}
              >
                <div className="stat-label">Their Diffs</div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>
                  {r.differential_players.theirs.length}
                </div>
              </div>
            </div>

            {/* Captain Comparison */}
            <div
              style={{
                display: "flex",
                gap: 12,
                marginBottom: 12,
                fontSize: 13,
              }}
            >
              <div
                style={{
                  flex: 1,
                  padding: 8,
                  background: "var(--background)",
                  borderRadius: 8,
                }}
              >
                <div style={{ color: "var(--muted)", marginBottom: 2 }}>
                  Your Captain
                </div>
                <div style={{ fontWeight: 700 }}>
                  {r.captain_comparison.your_captain}
                </div>
              </div>
              <div
                style={{
                  flex: 1,
                  padding: 8,
                  background: "var(--background)",
                  borderRadius: 8,
                }}
              >
                <div style={{ color: "var(--muted)", marginBottom: 2 }}>
                  Their Captain
                </div>
                <div style={{ fontWeight: 700 }}>
                  {r.captain_comparison.their_captain}
                </div>
              </div>
              {r.captain_comparison.same && (
                <span
                  className="badge"
                  style={{
                    background: "var(--primary)",
                    color: "var(--accent)",
                    alignSelf: "center",
                    fontSize: 10,
                  }}
                >
                  SAME C
                </span>
              )}
            </div>

            {/* Differential Players */}
            {r.differential_players.yours.length > 0 && (
              <div style={{ fontSize: 13, marginBottom: 4 }}>
                <span style={{ color: "var(--success)", fontWeight: 600 }}>
                  Your differentials:{" "}
                </span>
                <span style={{ color: "var(--muted)" }}>
                  {r.differential_players.yours.join(", ")}
                </span>
              </div>
            )}
            {r.differential_players.theirs.length > 0 && (
              <div style={{ fontSize: 13 }}>
                <span style={{ color: "var(--danger)", fontWeight: 600 }}>
                  Their differentials:{" "}
                </span>
                <span style={{ color: "var(--muted)" }}>
                  {r.differential_players.theirs.join(", ")}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
