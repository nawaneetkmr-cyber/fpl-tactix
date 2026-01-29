import Link from "next/link";

async function getEntry(id: string) {
  const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL ?? ""}/api/fpl/entry/${id}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`entry api failed ${res.status}`);
  return res.json();
}

export default async function EntryPage({ params }: { params: { id: string } }) {
  const { entry, history } = await getEntry(params.id);
  const latest = history?.current?.[history.current.length - 1];
  const header = {
    name: entry?.name,
    manager: `${entry?.player_first_name} ${entry?.player_last_name}`,
    overallPoints: history?.current?.reduce((acc: number, c: any) => acc + (c.points || 0), 0),
    overallRank: latest?.overall_rank,
  };

  return (
    <div style={{ padding: 20 }}>
      <h1>{header.name}</h1>
      <div>Manager: {header.manager}</div>
      <div>Total points: {header.overallPoints ?? "-"}</div>
      <div>Overall rank: {header.overallRank ?? "-"}</div>

      <div style={{ marginTop: 20, padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
        <strong>Last GW</strong>
        <div>GW: {latest?.event}</div>
        <div>Points: {latest?.points}</div>
      </div>

      <div style={{ marginTop: 16 }}>
        <Link href={`/dashboard`}>Live dashboard (requires picks cookie)</Link>
      </div>
    </div>
  );
}
