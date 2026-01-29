"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const [teamId, setTeamId] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const id = teamId.trim();
    if (!id || isNaN(Number(id)) || Number(id) <= 0) {
      setError("Please enter a valid FPL Team ID (numbers only).");
      return;
    }
    router.push(`/dashboard?teamId=${id}`);
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "calc(100vh - 56px)",
        padding: "24px",
        textAlign: "center",
      }}
    >
      <div style={{ maxWidth: 520 }} className="fade-in">
        <h1
          style={{
            fontSize: 48,
            fontWeight: 800,
            lineHeight: 1.1,
            letterSpacing: "-0.03em",
            marginBottom: 16,
          }}
        >
          Your FPL.{" "}
          <span
            style={{
              background: "linear-gradient(135deg, #37003c, #963cff)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            Optimized.
          </span>
        </h1>
        <p
          style={{
            fontSize: 18,
            color: "var(--muted)",
            lineHeight: 1.6,
            marginBottom: 40,
          }}
        >
          Live rank tracking, AI-optimized squad analysis, and what-if
          simulations. Know exactly how your FPL team is performing in real time.
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
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
            style={{
              padding: "12px 20px",
              fontSize: 16,
              borderRadius: 10,
              border: "1px solid var(--card-border)",
              background: "var(--card)",
              color: "var(--foreground)",
              width: 260,
              outline: "none",
            }}
          />
          <button type="submit" className="btn-primary">
            View Dashboard
          </button>
        </form>

        {error && (
          <p style={{ color: "var(--danger)", marginTop: 12, fontSize: 14 }}>
            {error}
          </p>
        )}

        <p
          style={{
            fontSize: 13,
            color: "var(--muted-light)",
            marginTop: 16,
          }}
        >
          Find your Team ID on the FPL website under the &quot;Points&quot; page
          URL
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 16,
            marginTop: 64,
          }}
        >
          <div className="card" style={{ textAlign: "center" }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>&#9889;</div>
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>
              Live Rank
            </div>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>
              Real-time rank tracking during live gameweeks
            </div>
          </div>
          <div className="card" style={{ textAlign: "center" }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>&#129504;</div>
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>
              AI Optimized
            </div>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>
              See what your rank could be with perfect decisions
            </div>
          </div>
          <div className="card" style={{ textAlign: "center" }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>&#128300;</div>
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>
              What-If
            </div>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>
              Simulate captain changes, bench swaps, and more
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
