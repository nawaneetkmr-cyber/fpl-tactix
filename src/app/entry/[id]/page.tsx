import Link from "next/link";

async function getEntry(id: string) {
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
  const res = await fetch(`${base}/api/fpl/entry/${id}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`entry api failed ${res.status}`);
  return res.json();
}

export default async function EntryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { entry, history } = await getEntry(id);
  const latest = history?.current?.[history.current.length - 1];
  const header = {
    name: entry?.name,
    manager: `${entry?.player_first_name} ${entry?.player_last_name}`,
    overallPoints: history?.current?.reduce(
      (acc: number, c: { points?: number }) => acc + (c.points || 0),
      0
    ),
    overallRank: latest?.overall_rank,
  };

  return (
    <div
      style={{
        maxWidth: 600,
        margin: "0 auto",
        padding: "32px 16px",
      }}
    >
      <div className="card" style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
          {header.name}
        </h1>
        <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 16 }}>
          {header.manager}
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 16,
          }}
        >
          <div>
            <div className="stat-label">Total Points</div>
            <div style={{ fontSize: 28, fontWeight: 700 }}>
              {header.overallPoints ?? "-"}
            </div>
          </div>
          <div>
            <div className="stat-label">Overall Rank</div>
            <div style={{ fontSize: 28, fontWeight: 700 }}>
              {header.overallRank
                ? header.overallRank.toLocaleString()
                : "-"}
            </div>
          </div>
        </div>
      </div>

      {latest && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--muted)",
              marginBottom: 8,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Last Gameweek
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div style={{ fontWeight: 600 }}>GW {latest.event}</div>
            <div
              style={{
                fontSize: 24,
                fontWeight: 700,
                color: "var(--accent-dark)",
              }}
            >
              {latest.points} pts
            </div>
          </div>
        </div>
      )}

      <Link
        href={`/dashboard?teamId=${id}`}
        className="btn-primary"
        style={{
          width: "100%",
          textDecoration: "none",
          textAlign: "center",
        }}
      >
        View Live Dashboard
      </Link>
    </div>
  );
}
