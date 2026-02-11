import { NextResponse } from "next/server";
import { calculatePlayerProjections } from "@/lib/xpts";
import type { FullElement, TeamStrength, FixtureDetail } from "@/lib/xpts";

// ---------- Types ----------

type Verdict = "KEEP" | "MONITOR" | "SELL";

interface AnalyticsPlayer {
  id: number;
  webName: string;
  team: string;
  teamShort: string;
  teamId: number;
  position: string;
  positionId: number;
  price: number;
  // Core stats
  appearances: number;
  goals: number;
  assists: number;
  cleanSheets: number;
  goalsConceded: number;
  totalPoints: number;
  form: string;
  ownership: string;
  status: string;
  chanceOfPlaying: number | null;
  // Expected stats
  xG: number;
  xA: number;
  xGI: number;
  xGC: number;
  xPts: number;
  // ICT components (FPL's underlying process stats)
  threat: number; // shot proxy
  creativity: number; // chance creation proxy
  influence: number;
  ictIndex: number;
  // Defensive stats
  defensiveContribution: number;
  defensiveContributionPer90: number;
  cleanSheetsPer90: number;
  goalsConcededPer90: number;
  saves: number;
  savesPer90: number;
  penaltiesSaved: number;
  // BPS and bonus
  bps: number;
  bonus: number;
  // Classification
  verdict: Verdict;
  verdictReasons: string[];
  // Flags
  isDifferential: boolean;
  isRotationRisk: boolean;
  isUnavailable: boolean;
  isMaybeUnavailable: boolean;
  // Upcoming fixtures
  upcomingFixtures: {
    gw: number;
    opponent: string;
    difficulty: number;
    isHome: boolean;
  }[];
}

// ---------- KEEP / MONITOR / SELL ----------

function classifyPlayer(
  el: FullElement & Record<string, unknown>,
  xPts: number,
  upcomingDifficulty: number[]
): { verdict: Verdict; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  const form = parseFloat(el.form || "0");

  if (form >= 6) { score += 2; reasons.push("Excellent form"); }
  else if (form >= 4) { score += 1; }
  else if (form < 2) { score -= 2; reasons.push("Poor form"); }

  if (xPts >= 5) { score += 2; reasons.push("High xPts projection"); }
  else if (xPts >= 3.5) { score += 1; }
  else if (xPts < 2) { score -= 2; reasons.push("Low xPts projection"); }

  if (upcomingDifficulty.length > 0) {
    const avgDiff = upcomingDifficulty.reduce((a, b) => a + b, 0) / upcomingDifficulty.length;
    if (avgDiff <= 2.5) { score += 2; reasons.push("Great upcoming fixtures"); }
    else if (avgDiff <= 3) { score += 1; }
    else if (avgDiff >= 4) { score -= 2; reasons.push("Tough upcoming fixtures"); }
  }

  // Threat/creativity check (FPL process stats)
  const threatPerGame = el.starts > 0 ? parseFloat(el.threat || "0") / el.starts : 0;
  const creativityPerGame = el.starts > 0 ? parseFloat(el.creativity || "0") / el.starts : 0;
  if (threatPerGame >= 40) { score += 1; reasons.push("High goal threat"); }
  if (creativityPerGame >= 30) { score += 1; reasons.push("High chance creation"); }

  // xG overperformance check
  const xg = parseFloat(el.expected_goals || "0");
  if (el.goals_scored > 0 && xg > 0) {
    const ratio = el.goals_scored / xg;
    if (ratio > 1.5) { score -= 1; reasons.push("Overperforming xG"); }
    else if (ratio < 0.65 && xg > 2) { score += 1; reasons.push("Underperforming xG"); }
  }

  if (el.status === "i" || el.status === "s" || el.status === "n") {
    score -= 3; reasons.push("Unavailable");
  } else if (el.status === "d") {
    score -= 1; reasons.push("Doubtful");
  }

  if (el.starts > 0) {
    const startRate = el.starts / Math.max(el.starts + 5, 20);
    if (startRate < 0.5) { score -= 1; reasons.push("Rotation risk"); }
  }

  let verdict: Verdict;
  if (score >= 3) verdict = "KEEP";
  else if (score >= 0) verdict = "MONITOR";
  else verdict = "SELL";

  return { verdict, reasons };
}

// ---------- Route Handler ----------

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const teamIdParam = searchParams.get("teamId");
    const positionFilter = searchParams.get("position");

    // Fetch FPL bootstrap + fixtures in parallel
    const [bootstrapRes, fixturesRes] = await Promise.all([
      fetch("https://fantasy.premierleague.com/api/bootstrap-static/", {
        headers: { "user-agent": "FPL Tactix/1.0" },
        next: { revalidate: 3600 },
      }),
      fetch("https://fantasy.premierleague.com/api/fixtures/", {
        headers: { "user-agent": "FPL Tactix/1.0" },
        next: { revalidate: 3600 },
      }),
    ]);

    if (!bootstrapRes.ok) {
      return NextResponse.json({ error: "FPL API unavailable" }, { status: 502 });
    }

    const bootstrap = await bootstrapRes.json();
    const rawFixtures = fixturesRes.ok ? await fixturesRes.json() : [];

    // Detect current GW
    const events = bootstrap.events || [];
    let currentGW = 1;
    const currentEvent = events.find((e: { is_current: boolean }) => e.is_current);
    const nextEvent = events.find((e: { is_next: boolean }) => e.is_next);
    if (currentEvent && !currentEvent.finished) currentGW = currentEvent.id;
    else if (nextEvent) currentGW = nextEvent.id;
    else if (currentEvent) currentGW = currentEvent.id;

    const elements = bootstrap.elements || [];
    const teams: TeamStrength[] = (bootstrap.teams || []).map(
      (t: Record<string, unknown>) => ({
        id: t.id, name: t.name, short_name: t.short_name,
        strength_attack_home: t.strength_attack_home, strength_attack_away: t.strength_attack_away,
        strength_defence_home: t.strength_defence_home, strength_defence_away: t.strength_defence_away,
        strength_overall_home: t.strength_overall_home, strength_overall_away: t.strength_overall_away,
      })
    );

    const fixtures: FixtureDetail[] = (rawFixtures as Record<string, unknown>[])
      .filter((f) => f.event != null && (f.event as number) > 0)
      .map((f) => ({
        id: f.id as number, event: f.event as number,
        team_h: f.team_h as number, team_a: f.team_a as number,
        team_h_difficulty: f.team_h_difficulty as number, team_a_difficulty: f.team_a_difficulty as number,
        finished: f.finished as boolean, started: f.started as boolean,
      }));

    // Calculate xPts
    const targetGW = nextEvent ? nextEvent.id : currentGW;
    const fullElements: FullElement[] = elements.map((e: Record<string, unknown>) => ({
      id: e.id, web_name: e.web_name, team: e.team, element_type: e.element_type,
      status: e.status, now_cost: e.now_cost, form: e.form,
      points_per_game: e.points_per_game, selected_by_percent: e.selected_by_percent,
      minutes: e.minutes, goals_scored: e.goals_scored, assists: e.assists,
      clean_sheets: e.clean_sheets, goals_conceded: e.goals_conceded, bonus: e.bonus,
      influence: e.influence, creativity: e.creativity, threat: e.threat, ict_index: e.ict_index,
      expected_goals: e.expected_goals, expected_assists: e.expected_assists,
      expected_goal_involvements: e.expected_goal_involvements,
      expected_goals_conceded: e.expected_goals_conceded,
      starts: e.starts, chance_of_playing_next_round: e.chance_of_playing_next_round,
      total_points: e.total_points, event_points: e.event_points,
    }));
    const projections = calculatePlayerProjections(fullElements, teams, fixtures, targetGW);
    const projMap = new Map(projections.map((p) => [p.player_id, p]));

    // Team lookup
    const teamMap = new Map<number, { name: string; short_name: string }>();
    for (const t of bootstrap.teams || []) {
      teamMap.set(t.id, { name: t.name, short_name: t.short_name });
    }

    const posLabels: Record<number, string> = { 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" };

    // User squad
    let squadIds: Set<number> = new Set();
    if (teamIdParam) {
      try {
        const picksRes = await fetch(
          `https://fantasy.premierleague.com/api/entry/${teamIdParam}/event/${currentGW}/picks/`,
          { cache: "no-store" }
        );
        if (picksRes.ok) {
          const picksData = await picksRes.json();
          squadIds = new Set((picksData.picks || []).map((p: { element: number }) => p.element));
        }
      } catch { /* silent */ }
    }

    // Upcoming fixtures per team (next 4 GWs)
    const upcomingGWs = Array.from({ length: 4 }, (_, i) => targetGW + i);
    const teamUpcomingFixtures = new Map<number, { gw: number; opponent: string; difficulty: number; isHome: boolean }[]>();

    for (const teamId of teamMap.keys()) {
      const upcoming: { gw: number; opponent: string; difficulty: number; isHome: boolean }[] = [];
      for (const gw of upcomingGWs) {
        const gwFix = fixtures.filter((f) => f.event === gw && (f.team_h === teamId || f.team_a === teamId));
        for (const fix of gwFix) {
          const isHome = fix.team_h === teamId;
          const opponentId = isHome ? fix.team_a : fix.team_h;
          upcoming.push({
            gw,
            opponent: teamMap.get(opponentId)?.short_name || "???",
            difficulty: isHome ? fix.team_h_difficulty : fix.team_a_difficulty,
            isHome,
          });
        }
        if (gwFix.length === 0) upcoming.push({ gw, opponent: "-", difficulty: 0, isHome: false });
      }
      teamUpcomingFixtures.set(teamId, upcoming);
    }

    // Build analytics players
    const analyticsPlayers: AnalyticsPlayer[] = [];

    for (const el of elements) {
      if (positionFilter && el.element_type !== parseInt(positionFilter)) continue;
      if (el.minutes < 90) continue;

      const team = teamMap.get(el.team);
      const proj = projMap.get(el.id);
      const xPts = proj?.expected_points ?? 0;

      const upcoming = teamUpcomingFixtures.get(el.team) || [];
      const upcomingDiffs = upcoming.filter((f) => f.difficulty > 0).map((f) => f.difficulty);
      const { verdict, reasons } = classifyPlayer(el, xPts, upcomingDiffs);

      const ownership = parseFloat(el.selected_by_percent || "0");

      analyticsPlayers.push({
        id: el.id,
        webName: el.web_name,
        team: team?.name || "???",
        teamShort: team?.short_name || "???",
        teamId: el.team,
        position: posLabels[el.element_type] || "???",
        positionId: el.element_type,
        price: el.now_cost / 10,
        appearances: el.starts,
        goals: el.goals_scored,
        assists: el.assists,
        cleanSheets: el.clean_sheets,
        goalsConceded: el.goals_conceded,
        totalPoints: el.total_points,
        form: el.form,
        ownership: el.selected_by_percent,
        status: el.status,
        chanceOfPlaying: el.chance_of_playing_next_round,
        xG: Math.round(parseFloat(el.expected_goals || "0") * 100) / 100,
        xA: Math.round(parseFloat(el.expected_assists || "0") * 100) / 100,
        xGI: Math.round(parseFloat(el.expected_goal_involvements || "0") * 100) / 100,
        xGC: Math.round(parseFloat(el.expected_goals_conceded || "0") * 100) / 100,
        xPts: Math.round(xPts * 10) / 10,
        threat: Math.round(parseFloat(el.threat || "0") * 10) / 10,
        creativity: Math.round(parseFloat(el.creativity || "0") * 10) / 10,
        influence: Math.round(parseFloat(el.influence || "0") * 10) / 10,
        ictIndex: Math.round(parseFloat(el.ict_index || "0") * 10) / 10,
        defensiveContribution: Math.round((el.defensive_contribution ?? 0) * 10) / 10,
        defensiveContributionPer90: Math.round((el.defensive_contribution_per_90 ?? 0) * 100) / 100,
        cleanSheetsPer90: Math.round((el.clean_sheets_per_90 ?? 0) * 100) / 100,
        goalsConcededPer90: Math.round((el.goals_conceded_per_90 ?? 0) * 100) / 100,
        saves: el.saves ?? 0,
        savesPer90: Math.round((el.saves_per_90 ?? 0) * 100) / 100,
        penaltiesSaved: el.penalties_saved ?? 0,
        bps: el.bps ?? 0,
        bonus: el.bonus,
        verdict,
        verdictReasons: reasons,
        isDifferential: ownership < 10,
        isRotationRisk: el.starts > 0 && el.starts / Math.max(el.starts + 5, 20) < 0.6,
        isUnavailable: el.status === "i" || el.status === "s" || el.status === "n",
        isMaybeUnavailable: el.status === "d",
        upcomingFixtures: upcoming,
      });
    }

    analyticsPlayers.sort((a, b) => b.xPts - a.xPts);

    return NextResponse.json({
      ok: true,
      players: analyticsPlayers,
      currentGW,
      targetGW,
      upcomingGWs,
      squadIds: Array.from(squadIds),
    });
  } catch (err: unknown) {
    console.error("Analytics API error:", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
