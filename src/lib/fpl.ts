const BASE = "https://fantasy.premierleague.com/api";

const FPL_HEADERS = {
  "user-agent": "FPL Tactix/1.0 (+https://fpl-tactix.app)",
};

const RETRYABLE_STATUSES = new Set([403, 429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

async function fetchWithRetry(
  url: string,
  options: RequestInit & { next?: { revalidate: number } },
  label: string
): Promise<Response> {
  const opts = { ...options, headers: { ...FPL_HEADERS, ...options.headers } };

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url, opts);
    if (res.ok) return res;

    // Don't retry client errors (except 403/429 which are often transient rate-limits)
    if (!RETRYABLE_STATUSES.has(res.status) || attempt === MAX_RETRIES) {
      throw new Error(`${label} failed: ${res.status}`);
    }

    // Exponential backoff: 1s, 2s, 4s
    const delay = BASE_DELAY_MS * Math.pow(2, attempt);
    await new Promise((r) => setTimeout(r, delay));
  }

  // Should never reach here, but TypeScript needs it
  throw new Error(`${label} failed after retries`);
}

export async function fetchBootstrap() {
  const res = await fetchWithRetry(
    `${BASE}/bootstrap-static/`,
    { next: { revalidate: 3600 } },
    "bootstrap"
  );
  return res.json();
}

export async function fetchLiveGW(gw: number) {
  const res = await fetchWithRetry(
    `${BASE}/event/${gw}/live/`,
    { cache: "no-store" },
    `live gw ${gw}`
  );
  return res.json();
}

export async function fetchUserPicks(teamId: number, gw: number) {
  const res = await fetchWithRetry(
    `${BASE}/entry/${teamId}/event/${gw}/picks/`,
    { cache: "no-store" },
    `picks ${teamId} gw ${gw}`
  );
  return res.json();
}

export async function fetchEntry(teamId: number) {
  const res = await fetchWithRetry(
    `${BASE}/entry/${teamId}/`,
    { next: { revalidate: 3600 } },
    `entry ${teamId}`
  );
  return res.json();
}

export async function fetchEntryHistory(teamId: number) {
  const res = await fetchWithRetry(
    `${BASE}/entry/${teamId}/history/`,
    { next: { revalidate: 600 } },
    `entry history ${teamId}`
  );
  return res.json();
}

// ---------- New V3 Fetch Functions ----------

export async function fetchFixtures() {
  const res = await fetchWithRetry(
    `${BASE}/fixtures/`,
    { next: { revalidate: 3600 } },
    "fixtures"
  );
  return res.json();
}

export async function fetchLeagueStandings(leagueId: number, page: number = 1) {
  const res = await fetchWithRetry(
    `${BASE}/leagues-classic/${leagueId}/standings/?page_standings=${page}`,
    { cache: "no-store" },
    `league ${leagueId} standings`
  );
  return res.json();
}

export async function fetchLeagueH2H(leagueId: number, page: number = 1) {
  const res = await fetchWithRetry(
    `${BASE}/leagues-h2h/${leagueId}/standings/?page_standings=${page}`,
    { cache: "no-store" },
    `league h2h ${leagueId}`
  );
  return res.json();
}

export async function fetchEntryTransfers(teamId: number) {
  const res = await fetchWithRetry(
    `${BASE}/entry/${teamId}/transfers/`,
    { next: { revalidate: 600 } },
    `transfers ${teamId}`
  );
  return res.json();
}

export async function fetchEventStatus() {
  const res = await fetchWithRetry(
    `${BASE}/event-status/`,
    { cache: "no-store" },
    "event-status"
  );
  return res.json();
}

/**
 * Fetch overall league standings (league 314) to get top-ranked manager IDs.
 * Each page returns 50 managers sorted by overall rank.
 */
export async function fetchOverallStandings(page: number = 1) {
  const res = await fetchWithRetry(
    `${BASE}/leagues-classic/314/standings/?page_standings=${page}`,
    { next: { revalidate: 600 } },
    `overall standings p${page}`
  );
  return res.json();
}
