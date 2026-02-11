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
  minutes: number;
  starts: number;
  totalPoints: number;
  form: string;
  ownership: string;
  status: string;
  chanceOfPlaying: number | null;
  // Per-90 stats
  xGp90: number;
  goalsp90: number;
  xAp90: number;
  assistsp90: number;
  xGIp90: number;
  xGCp90: number;
  kpP90: number;   // creativity per 90 (key pass / chance creation proxy)
  bpsP90: number;  // BPS per 90 (bonus point system score)
  dcP90: number;   // defensive contribution per 90
  csp90: number;   // clean sheets per 90
  gcp90: number;   // goals conceded per 90
  svP90: number;   // saves per 90 (GKP)
  penaltiesSaved: number;
  bonus: number;
  xPts: number;
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

// ---------- Helpers ----------

function p90(stat: number, minutes: number): number {
  if (minutes < 45) return 0;
  return Math.round((stat / minutes) * 90 * 100) / 100;
}

// ---------- KEEP / MONITOR / SELL ----------

function classifyPlayer(
  el: Record<string, unknown>,
  xPts: number,
  upcomingDifficulty: number[],
  minutes: number
): { verdict: Verdict; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  const form = parseFloat((el.form as string) || "0");

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

  // Creativity/Threat per 90 check
  const creativityP90 = p90(parseFloat((el.creativity as string) || "0"), minutes);
  const threatP90 = p90(parseFloat((el.threat as string) || "0"), minutes);
  if (threatP90 >= 35) { score += 1; reasons.push("High goal threat"); }
  if (creativityP90 >= 25) { score += 1; reasons.push("High chance creation"); }

  // xG overperformance check
  const xg = parseFloat((el.expected_goals as string) || "0");
  const goals = (el.goals_scored as number) || 0;
  if (goals > 0 && xg > 0) {
    const ratio = goals / xg;
    if (ratio > 1.5) { score -= 1; reasons.push("Overperforming xG"); }
    else if (ratio < 0.65 && xg > 2) { score += 1; reasons.push("Underperforming xG"); }
  }

  if (el.status === "i" || el.status === "s" || el.status === "n") {
    score -= 3; reasons.push("Unavailable");
  } else if (el.status === "d") {
    score -= 1; reasons.push("Doubtful");
  }

  const starts = (el.starts as number) || 0;
  if (starts > 0) {
    const startRate = starts / Math.max(starts + 5, 20);
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
    const range = searchParams.get("range") || "season"; // "season" | "last5"

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

    // ---------- Last 5 GW aggregation ----------
    let last5Map: Map<number, {
      minutes: number; starts: number; goals_scored: number; assists: number;
      clean_sheets: number; goals_conceded: number; saves: number;
      bps: number; bonus: number; creativity: number; threat: number;
      expected_goals: number; expected_assists: number;
      expected_goal_involvements: number; expected_goals_conceded: number;
      total_points: number; penalties_saved: number;
    }> | null = null;

    if (range === "last5") {
      const finishedGWs = events
        .filter((e: { finished: boolean }) => e.finished)
        .sort((a: { id: number }, b: { id: number }) => b.id - a.id)
        .slice(0, 5)
        .map((e: { id: number }) => e.id);

      if (finishedGWs.length > 0) {
        const liveResults = await Promise.all(
          finishedGWs.map((gw: number) =>
            fetch(`https://fantasy.premierleague.com/api/event/${gw}/live/`, {
              headers: { "user-agent": "FPL Tactix/1.0" },
            }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
          )
        );

        last5Map = new Map();
        for (const liveData of liveResults) {
          if (!liveData?.elements) continue;
          for (const el of liveData.elements) {
            const s = el.stats;
            if (!s || s.minutes === 0) continue;
            const existing = last5Map.get(el.id) || {
              minutes: 0, starts: 0, goals_scored: 0, assists: 0,
              clean_sheets: 0, goals_conceded: 0, saves: 0,
              bps: 0, bonus: 0, creativity: 0, threat: 0,
              expected_goals: 0, expected_assists: 0,
              expected_goal_involvements: 0, expected_goals_conceded: 0,
              total_points: 0, penalties_saved: 0,
            };
            existing.minutes += s.minutes || 0;
            existing.starts += s.starts || 0;
            existing.goals_scored += s.goals_scored || 0;
            existing.assists += s.assists || 0;
            existing.clean_sheets += s.clean_sheets || 0;
            existing.goals_conceded += s.goals_conceded || 0;
            existing.saves += s.saves || 0;
            existing.bps += s.bps || 0;
            existing.bonus += s.bonus || 0;
            existing.creativity += parseFloat(s.creativity || "0");
            existing.threat += parseFloat(s.threat || "0");
            existing.expected_goals += parseFloat(s.expected_goals || "0");
            existing.expected_assists += parseFloat(s.expected_assists || "0");
            existing.expected_goal_involvements += parseFloat(s.expected_goal_involvements || "0");
            existing.expected_goals_conceded += parseFloat(s.expected_goals_conceded || "0");
            existing.total_points += s.total_points || 0;
            existing.penalties_saved += s.penalties_saved || 0;
            last5Map.set(el.id, existing);
          }
        }
      }
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
      const { verdict, reasons } = classifyPlayer(el, xPts, upcomingDiffs, el.minutes);

      const ownership = parseFloat(el.selected_by_percent || "0");

      // Determine stats source: season totals or last 5 aggregated
      const useLast5 = range === "last5" && last5Map?.has(el.id);
      const s = useLast5 ? last5Map!.get(el.id)! : null;

      const mins = useLast5 ? s!.minutes : (el.minutes as number);
      const starts = useLast5 ? s!.starts : (el.starts as number);

      // Skip players with < 45 mins in selected range
      if (mins < 45) continue;

      const xG = useLast5 ? s!.expected_goals : parseFloat(el.expected_goals || "0");
      const xA = useLast5 ? s!.expected_assists : parseFloat(el.expected_assists || "0");
      const xGI = useLast5 ? s!.expected_goal_involvements : parseFloat(el.expected_goal_involvements || "0");
      const xGC = useLast5 ? s!.expected_goals_conceded : parseFloat(el.expected_goals_conceded || "0");
      const goals = useLast5 ? s!.goals_scored : el.goals_scored;
      const assists = useLast5 ? s!.assists : el.assists;
      const cs = useLast5 ? s!.clean_sheets : el.clean_sheets;
      const gc = useLast5 ? s!.goals_conceded : el.goals_conceded;
      const saves = useLast5 ? s!.saves : (el.saves ?? 0);
      const bps = useLast5 ? s!.bps : (el.bps ?? 0);
      const bonus = useLast5 ? s!.bonus : el.bonus;
      const creativity = useLast5 ? s!.creativity : parseFloat(el.creativity || "0");
      const totalPts = useLast5 ? s!.total_points : el.total_points;
      const pensSaved = useLast5 ? s!.penalties_saved : (el.penalties_saved ?? 0);
      const dc = useLast5 ? 0 : (el.defensive_contribution ?? 0); // DC not in live data

      analyticsPlayers.push({
        id: el.id,
        webName: el.web_name,
        team: team?.name || "???",
        teamShort: team?.short_name || "???",
        teamId: el.team,
        position: posLabels[el.element_type] || "???",
        positionId: el.element_type,
        price: el.now_cost / 10,
        minutes: mins,
        starts,
        totalPoints: totalPts,
        form: el.form,
        ownership: el.selected_by_percent,
        status: el.status,
        chanceOfPlaying: el.chance_of_playing_next_round,
        // Per-90 stats
        xGp90: p90(xG, mins),
        goalsp90: p90(goals, mins),
        xAp90: p90(xA, mins),
        assistsp90: p90(assists, mins),
        xGIp90: p90(xGI, mins),
        xGCp90: p90(xGC, mins),
        kpP90: p90(creativity, mins),   // Key Passes proxy (FPL Creativity / 90)
        bpsP90: p90(bps, mins),         // BPS per 90
        dcP90: p90(dc, mins),           // Defensive Contribution per 90
        csp90: p90(cs, mins),           // Clean sheets per 90
        gcp90: p90(gc, mins),           // Goals conceded per 90
        svP90: p90(saves, mins),        // Saves per 90
        penaltiesSaved: pensSaved,
        bonus,
        xPts: Math.round(xPts * 10) / 10,
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
      range,
    });
  } catch (err: unknown) {
    console.error("Analytics API error:", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
