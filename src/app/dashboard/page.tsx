"use client";
import { useEffect, useState } from "react";

export default function Dashboard() {
  const [data, setData] = useState<any>(null);
  const teamId = 2191654; // your entry id (replace if needed)
  const gw = 23; // TODO: make dynamic from bootstrap

  useEffect(() => {
    fetch(`/api/fpl/summary?teamId=${teamId}&gw=${gw}`)
      .then((res) => res.json())
      .then(setData)
      .catch((e) => setData({ error: String(e) }));
  }, []);

  if (!data) return <div style={{ padding: 20 }}>Loading live FPL magic...</div>;
  if (data.error) return <div style={{ padding: 20, color: "red" }}>Error: {data.error}</div>;

  return (
    <div style={{ padding: 20 }}>
      <h1>{data.teamName}</h1>
      <h2>Manager: {data.playerName}</h2>

      <div style={{ fontSize: 28, marginTop: 20 }}>Live Points: {data.livePoints}</div>

      <div style={{ marginTop: 10 }}>
        Best Captain: Player #{data.bestCaptain?.id} ({data.bestCaptain?.points} pts)
      </div>
    </div>
  );
}
