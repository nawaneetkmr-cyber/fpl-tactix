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

// ---------- New V3 Fetch Functions ----------

export async function fetchFixtures() {
  const res = await fetch(`${BASE}/fixtures/`, { next: { revalidate: 3600 } });
  if (!res.ok) throw new Error(`fixtures failed: ${res.status}`);
  return res.json();
}

export async function fetchLeagueStandings(leagueId: number, page: number = 1) {
  const res = await fetch(
    `${BASE}/leagues-classic/${leagueId}/standings/?page_standings=${page}`,
    { cache: "no-store" }
  );
  if (!res.ok) throw new Error(`league ${leagueId} standings failed: ${res.status}`);
  return res.json();
}

export async function fetchLeagueH2H(leagueId: number, page: number = 1) {
  const res = await fetch(
    `${BASE}/leagues-h2h/${leagueId}/standings/?page_standings=${page}`,
    { cache: "no-store" }
  );
  if (!res.ok) throw new Error(`league h2h ${leagueId} failed: ${res.status}`);
  return res.json();
}

export async function fetchEntryTransfers(teamId: number) {
  const res = await fetch(`${BASE}/entry/${teamId}/transfers/`, { next: { revalidate: 600 } });
  if (!res.ok) throw new Error(`transfers ${teamId} failed: ${res.status}`);
  return res.json();
}

export async function fetchEventStatus() {
  const res = await fetch(`${BASE}/event-status/`, { cache: "no-store" });
  if (!res.ok) throw new Error(`event-status failed: ${res.status}`);
  return res.json();
}
