// ---------- Understat Data Scraper ----------
// Fetches advanced player stats from Understat (EPL)
// Data is embedded as hex-escaped JSON in <script> tags

import * as cheerio from "cheerio";

// ---------- Types ----------

export interface UnderstatPlayer {
  id: string;
  player_name: string;
  games: string;
  time: string;
  goals: string;
  xG: string;
  assists: string;
  xA: string;
  shots: string;
  key_passes: string;
  yellow_cards: string;
  red_cards: string;
  position: string;
  team_title: string;
  npg: string;
  npxG: string;
  xGChain: string;
  xGBuildup: string;
}

export interface ParsedUnderstatPlayer {
  id: string;
  name: string;
  games: number;
  minutes: number;
  goals: number;
  xG: number;
  assists: number;
  xA: number;
  shots: number;
  keyPasses: number;
  yellowCards: number;
  redCards: number;
  position: string;
  team: string;
  npg: number;
  npxG: number;
  xGChain: number;
  xGBuildup: number;
  shotsPerGame: number;
  keyPassesPerGame: number;
}

// ---------- Decode Helpers ----------

function decodeHexEscapes(encoded: string): string {
  return encoded.replace(
    /\\x([0-9a-fA-F]{2})/g,
    (_, hex) => String.fromCharCode(parseInt(hex, 16))
  );
}

function extractVariable(html: string, variableName: string): unknown {
  const $ = cheerio.load(html);
  let result: unknown = null;

  $("script").each((_, script) => {
    const content = $(script).html() || "";
    if (content.includes(variableName)) {
      const regex = new RegExp(
        `${variableName}\\s*=\\s*JSON\\.parse\\('(.+?)'\\)`
      );
      const match = content.match(regex);
      if (match && match[1]) {
        result = JSON.parse(decodeHexEscapes(match[1]));
      }
    }
  });

  return result;
}

// ---------- Data Fetching ----------

// Cache to avoid hitting Understat too frequently
let cachedData: { players: ParsedUnderstatPlayer[]; fetchedAt: number } | null = null;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

export async function fetchUnderstatPlayers(
  season?: number
): Promise<ParsedUnderstatPlayer[]> {
  // Return cached data if fresh
  if (cachedData && Date.now() - cachedData.fetchedAt < CACHE_TTL) {
    return cachedData.players;
  }

  // Determine season: Understat uses the start year (e.g., 2024 for 2024/25)
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth(); // 0-indexed
  const defaultSeason = currentMonth >= 7 ? currentYear : currentYear - 1;
  const targetSeason = season ?? defaultSeason;

  const url = `https://understat.com/league/EPL/${targetSeason}`;

  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
    next: { revalidate: 3600 },
  });

  if (!res.ok) {
    throw new Error(`Understat fetch failed: ${res.status}`);
  }

  const html = await res.text();
  const rawPlayers = extractVariable(html, "playersData") as
    | UnderstatPlayer[]
    | null;

  if (!rawPlayers || !Array.isArray(rawPlayers)) {
    throw new Error("Failed to extract playersData from Understat");
  }

  const players = rawPlayers.map(parsePlayer);

  cachedData = { players, fetchedAt: Date.now() };

  return players;
}

function parsePlayer(raw: UnderstatPlayer): ParsedUnderstatPlayer {
  const games = parseInt(raw.games) || 0;
  const shots = parseInt(raw.shots) || 0;
  const keyPasses = parseInt(raw.key_passes) || 0;

  return {
    id: raw.id,
    name: raw.player_name,
    games,
    minutes: parseInt(raw.time) || 0,
    goals: parseInt(raw.goals) || 0,
    xG: parseFloat(raw.xG) || 0,
    assists: parseInt(raw.assists) || 0,
    xA: parseFloat(raw.xA) || 0,
    shots,
    keyPasses,
    yellowCards: parseInt(raw.yellow_cards) || 0,
    redCards: parseInt(raw.red_cards) || 0,
    position: raw.position,
    team: raw.team_title,
    npg: parseInt(raw.npg) || 0,
    npxG: parseFloat(raw.npxG) || 0,
    xGChain: parseFloat(raw.xGChain) || 0,
    xGBuildup: parseFloat(raw.xGBuildup) || 0,
    shotsPerGame: games > 0 ? shots / games : 0,
    keyPassesPerGame: games > 0 ? keyPasses / games : 0,
  };
}

// ---------- Name Matching ----------

// FPL uses web_name (usually surname), Understat uses full name.
// We use fuzzy matching to link the two datasets.

export function matchUnderstatToFPL(
  understatPlayers: ParsedUnderstatPlayer[],
  fplPlayers: {
    id: number;
    web_name: string;
    first_name: string;
    second_name: string;
    team: number;
  }[],
  fplTeams: { id: number; name: string; short_name: string }[]
): Map<number, ParsedUnderstatPlayer> {
  const result = new Map<number, ParsedUnderstatPlayer>();

  // Build team name mapping (FPL team name -> normalized)
  const fplTeamMap = new Map<number, string>();
  for (const t of fplTeams) {
    fplTeamMap.set(t.id, t.name);
  }

  // Normalize names for comparison
  const normalize = (name: string) =>
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // strip accents
      .replace(/[^a-z\s]/g, "")
      .trim();

  // Build lookup for Understat players by normalized name + team
  const understatByName = new Map<string, ParsedUnderstatPlayer[]>();
  for (const up of understatPlayers) {
    const normName = normalize(up.name);
    const parts = normName.split(/\s+/);
    // Index by last name and full name
    for (const key of [normName, parts[parts.length - 1]]) {
      const existing = understatByName.get(key) || [];
      existing.push(up);
      understatByName.set(key, existing);
    }
  }

  // Team name normalization map (Understat team name -> FPL team name)
  const teamAliases: Record<string, string> = {
    "Manchester City": "Man City",
    "Manchester United": "Man Utd",
    "Tottenham": "Spurs",
    "Newcastle United": "Newcastle",
    "Wolverhampton Wanderers": "Wolves",
    "West Ham": "West Ham",
    "Nottingham Forest": "Nott'm Forest",
    "Brighton": "Brighton",
    "Leicester": "Leicester",
  };

  function teamsMatch(understatTeam: string, fplTeamName: string): boolean {
    const uTeam = understatTeam.toLowerCase();
    const fTeam = fplTeamName.toLowerCase();
    if (uTeam === fTeam) return true;
    // Check aliases
    const aliased = teamAliases[understatTeam];
    if (aliased && aliased.toLowerCase() === fTeam) return true;
    // Fuzzy: check if one contains the other
    if (uTeam.includes(fTeam) || fTeam.includes(uTeam)) return true;
    // Check first word match
    const uFirst = uTeam.split(/\s+/)[0];
    const fFirst = fTeam.split(/\s+/)[0];
    if (uFirst === fFirst && uFirst.length > 3) return true;
    return false;
  }

  for (const fp of fplPlayers) {
    const fplTeamName = fplTeamMap.get(fp.team) || "";
    const normWebName = normalize(fp.web_name);
    const normSecondName = normalize(fp.second_name);
    const normFullName = normalize(`${fp.first_name} ${fp.second_name}`);

    // Try to find exact match by second name + team
    let match: ParsedUnderstatPlayer | undefined;

    // Strategy 1: Match by second/web name
    for (const key of [normSecondName, normWebName, normFullName]) {
      const candidates = understatByName.get(key);
      if (candidates) {
        match = candidates.find((c) => teamsMatch(c.team, fplTeamName));
        if (match) break;
      }
    }

    // Strategy 2: If no match, try matching full FPL name against full Understat name
    if (!match) {
      for (const up of understatPlayers) {
        const normUp = normalize(up.name);
        if (
          teamsMatch(up.team, fplTeamName) &&
          (normUp.includes(normSecondName) ||
            normSecondName.includes(normUp.split(/\s+/).pop() || "") ||
            normUp.includes(normWebName))
        ) {
          match = up;
          break;
        }
      }
    }

    if (match) {
      result.set(fp.id, match);
    }
  }

  return result;
}

// ---------- KEEP / MONITOR / SELL Classification ----------

export type Verdict = "KEEP" | "MONITOR" | "SELL";

export interface VerdictFactors {
  verdict: Verdict;
  reasons: string[];
}

export function classifyPlayer(
  fplPlayer: {
    form: string;
    status: string;
    now_cost: number;
    total_points: number;
    selected_by_percent: string;
    minutes: number;
    starts: number;
    expected_goals: string;
    expected_assists: string;
    chance_of_playing_next_round: number | null;
  },
  understat: ParsedUnderstatPlayer | undefined,
  xPts: number,
  upcomingDifficulty: number[] // FDR values for next 4 GWs
): VerdictFactors {
  const reasons: string[] = [];
  let score = 0; // positive = keep, negative = sell

  const form = parseFloat(fplPlayer.form || "0");
  const ownership = parseFloat(fplPlayer.selected_by_percent || "0");

  // Form check
  if (form >= 6) {
    score += 2;
    reasons.push("Excellent form");
  } else if (form >= 4) {
    score += 1;
  } else if (form < 2) {
    score -= 2;
    reasons.push("Poor form");
  }

  // xPts check
  if (xPts >= 5) {
    score += 2;
    reasons.push("High xPts projection");
  } else if (xPts >= 3.5) {
    score += 1;
  } else if (xPts < 2) {
    score -= 2;
    reasons.push("Low xPts projection");
  }

  // Fixture difficulty (average of next 4)
  if (upcomingDifficulty.length > 0) {
    const avgDiff =
      upcomingDifficulty.reduce((a, b) => a + b, 0) /
      upcomingDifficulty.length;
    if (avgDiff <= 2.5) {
      score += 2;
      reasons.push("Great upcoming fixtures");
    } else if (avgDiff <= 3) {
      score += 1;
    } else if (avgDiff >= 4) {
      score -= 2;
      reasons.push("Tough upcoming fixtures");
    }
  }

  // Understat process stats
  if (understat) {
    if (understat.shotsPerGame >= 3) {
      score += 1;
      reasons.push("High shot volume");
    }
    if (understat.keyPassesPerGame >= 2) {
      score += 1;
      reasons.push("High chance creation");
    }
    // xG overperformance (goals >> xG means regression likely)
    if (understat.goals > 0 && understat.xG > 0) {
      const overPerformance = understat.goals / understat.xG;
      if (overPerformance > 1.4) {
        score -= 1;
        reasons.push("Overperforming xG (regression risk)");
      } else if (overPerformance < 0.7 && understat.xG > 2) {
        score += 1;
        reasons.push("Underperforming xG (due a correction)");
      }
    }
  }

  // Availability
  if (
    fplPlayer.status === "i" ||
    fplPlayer.status === "s" ||
    fplPlayer.status === "n"
  ) {
    score -= 3;
    reasons.push("Unavailable");
  } else if (fplPlayer.status === "d") {
    score -= 1;
    reasons.push("Doubtful");
  }

  // Minutes consistency
  if (fplPlayer.starts > 0) {
    const startRate = fplPlayer.starts / Math.max(fplPlayer.starts + 5, 20);
    if (startRate < 0.5) {
      score -= 1;
      reasons.push("Rotation risk");
    }
  }

  // Determine verdict
  let verdict: Verdict;
  if (score >= 3) {
    verdict = "KEEP";
  } else if (score >= 0) {
    verdict = "MONITOR";
  } else {
    verdict = "SELL";
  }

  return { verdict, reasons };
}
