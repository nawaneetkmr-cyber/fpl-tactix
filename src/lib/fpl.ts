const BASE = "https://fantasy.premierleague.com/api";

export async function fetchBootstrap() {
  const res = await fetch(`${BASE}/bootstrap-static/`, { next: { revalidate: 3600 } });
  if (!res.ok) throw new Error(`bootstrap failed: ${res.status}`);
  return res.json();
}

export async function fetchLiveGW(gw: number) {
  const res = await fetch(`${BASE}/event/${gw}/live/`, { cache: "no-store" });
  if (!res.ok) throw new Error(`live gw ${gw} failed: ${res.status}`);
  return res.json();
}

export async function fetchUserPicks(teamId: number, gw: number) {
  const res = await fetch(`${BASE}/entry/${teamId}/event/${gw}/picks/`, { cache: "no-store" });
  if (!res.ok) throw new Error(`picks ${teamId} gw ${gw} failed: ${res.status}`);
  return res.json();
}

export async function fetchEntry(teamId: number) {
  const res = await fetch(`${BASE}/entry/${teamId}/`, { next: { revalidate: 3600 } });
  if (!res.ok) throw new Error(`entry ${teamId} failed: ${res.status}`);
  return res.json();
}

export async function fetchEntryHistory(teamId: number) {
  const res = await fetch(`${BASE}/entry/${teamId}/history/`, { next: { revalidate: 600 } });
  if (!res.ok) throw new Error(`entry history ${teamId} failed: ${res.status}`);
  return res.json();
}
