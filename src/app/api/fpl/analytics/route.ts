import { NextResponse } from "next/server";
import {
  fetchUnderstatPlayers,
  matchUnderstatToFPL,
  classifyPlayer,
} from "@/lib/understat";
import type { Verdict } from "@/lib/understat";
import { calculatePlayerProjections } from "@/lib/xpts";
import type { FullElement, TeamStrength, FixtureDetail } from "@/lib/xpts";

// ---------- Types ----------

interface AnalyticsPlayer {
  id: number;
  webName: string;
  fullName: string;
  team: string;
  teamId: number;
  position: string;
  positionId: number;
  price: number;
  // FPL stats
  appearances: number;
  goals: number;
  assists: number;
  totalPoints: number;
  form: string;
  ownership: string;
  status: string;
  chanceOfPlaying: number | null;
  // Understat stats
  shots: number | null;
  keyPasses: number | null;
  npxG: number | null;
  xGChain: number | null;
  // Combined stats
  xG: number;
  xA: number;
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

// ---------- Route Handler ----------

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const teamIdParam = searchParams.get("teamId");
    const positionFilter = searchParams.get("position"); // 1,2,3,4

    // Fetch FPL bootstrap data
    const bootstrapRes = await fetch(
      "https://fantasy.premierleague.com/api/bootstrap-static/",
      {
        headers: { "user-agent": "FPL Tactix/1.0" },
        next: { revalidate: 3600 },
      }
    );
    if (!bootstrapRes.ok) {
      return NextResponse.json(
        { error: "FPL API unavailable" },
        { status: 502 }
      );
    }
    const bootstrap = await bootstrapRes.json();

    // Fetch fixtures
    const fixturesRes = await fetch(
      "https://fantasy.premierleague.com/api/fixtures/",
      {
        headers: { "user-agent": "FPL Tactix/1.0" },
        next: { revalidate: 3600 },
      }
    );
    const rawFixtures = fixturesRes.ok ? await fixturesRes.json() : [];

    // Detect current GW
    const events = bootstrap.events || [];
    let currentGW = 1;
    const currentEvent = events.find(
      (e: { is_current: boolean }) => e.is_current
    );
    const nextEvent = events.find((e: { is_next: boolean }) => e.is_next);
    if (currentEvent && !currentEvent.finished) {
      currentGW = currentEvent.id;
    } else if (nextEvent) {
      currentGW = nextEvent.id;
    } else if (currentEvent) {
      currentGW = currentEvent.id;
    }

    // Parse FPL data
    const elements: FullElement[] = bootstrap.elements || [];
    const teams: TeamStrength[] = (bootstrap.teams || []).map(
      (t: Record<string, unknown>) => ({
        id: t.id,
        name: t.name,
        short_name: t.short_name,
        strength_attack_home: t.strength_attack_home,
        strength_attack_away: t.strength_attack_away,
        strength_defence_home: t.strength_defence_home,
        strength_defence_away: t.strength_defence_away,
        strength_overall_home: t.strength_overall_home,
        strength_overall_away: t.strength_overall_away,
      })
    );

    const fixtures: FixtureDetail[] = (rawFixtures as Record<string, unknown>[])
      .filter(
        (f: Record<string, unknown>) => f.event != null && (f.event as number) > 0
      )
      .map((f: Record<string, unknown>) => ({
        id: f.id as number,
        event: f.event as number,
        team_h: f.team_h as number,
        team_a: f.team_a as number,
        team_h_difficulty: f.team_h_difficulty as number,
        team_a_difficulty: f.team_a_difficulty as number,
        finished: f.finished as boolean,
        started: f.started as boolean,
      }));

    // Calculate xPts for next GW
    const targetGW = nextEvent ? nextEvent.id : currentGW;
    const projections = calculatePlayerProjections(
      elements,
      teams,
      fixtures,
      targetGW
    );
    const projMap = new Map(projections.map((p) => [p.player_id, p]));

    // Fetch Understat data
    let understatMap = new Map<
      number,
      import("@/lib/understat").ParsedUnderstatPlayer
    >();
    try {
      const understatPlayers = await fetchUnderstatPlayers();
      const fplPlayersForMatch = elements.map(
        (e: FullElement & { first_name?: string; second_name?: string }) => ({
          id: e.id,
          web_name: e.web_name,
          first_name:
            (e as unknown as Record<string, string>).first_name || e.web_name,
          second_name:
            (e as unknown as Record<string, string>).second_name || e.web_name,
          team: e.team,
        })
      );
      const fplTeams = (bootstrap.teams || []).map(
        (t: { id: number; name: string; short_name: string }) => ({
          id: t.id,
          name: t.name,
          short_name: t.short_name,
        })
      );
      understatMap = matchUnderstatToFPL(
        understatPlayers,
        fplPlayersForMatch,
        fplTeams
      );
    } catch (err) {
      console.warn("Understat fetch failed, continuing with FPL data only:", err);
    }

    // Build team lookup
    const teamMap = new Map<number, { name: string; short_name: string }>();
    for (const t of bootstrap.teams || []) {
      teamMap.set(t.id, { name: t.name, short_name: t.short_name });
    }

    // Position labels
    const posLabels: Record<number, string> = {
      1: "GKP",
      2: "DEF",
      3: "MID",
      4: "FWD",
    };

    // Get user's squad player IDs (if teamId provided)
    let squadIds: Set<number> = new Set();
    if (teamIdParam) {
      try {
        const picksGW = currentEvent?.finished ? currentGW : currentGW;
        const picksRes = await fetch(
          `https://fantasy.premierleague.com/api/entry/${teamIdParam}/event/${picksGW}/picks/`,
          { cache: "no-store" }
        );
        if (picksRes.ok) {
          const picksData = await picksRes.json();
          squadIds = new Set(
            (picksData.picks || []).map(
              (p: { element: number }) => p.element
            )
          );
        }
      } catch {
        // Silent fail - we'll just show all players
      }
    }

    // Build upcoming fixtures for each team (next 4 GWs)
    const upcomingGWs = Array.from(
      { length: 4 },
      (_, i) => targetGW + i
    );
    const teamUpcomingFixtures = new Map<
      number,
      { gw: number; opponent: string; difficulty: number; isHome: boolean }[]
    >();

    for (const teamId of teamMap.keys()) {
      const upcoming: {
        gw: number;
        opponent: string;
        difficulty: number;
        isHome: boolean;
      }[] = [];
      for (const gw of upcomingGWs) {
        const gwFixtures = fixtures.filter(
          (f) =>
            f.event === gw && (f.team_h === teamId || f.team_a === teamId)
        );
        for (const fix of gwFixtures) {
          const isHome = fix.team_h === teamId;
          const opponentId = isHome ? fix.team_a : fix.team_h;
          const opponent = teamMap.get(opponentId)?.short_name || "???";
          const difficulty = isHome
            ? fix.team_h_difficulty
            : fix.team_a_difficulty;
          upcoming.push({ gw, opponent, difficulty, isHome });
        }
        // Blank GW - no fixture for this team
        if (gwFixtures.length === 0) {
          upcoming.push({ gw, opponent: "-", difficulty: 0, isHome: false });
        }
      }
      teamUpcomingFixtures.set(teamId, upcoming);
    }

    // Build analytics players
    const analyticsPlayers: AnalyticsPlayer[] = [];

    for (const el of elements) {
      // Filter by position if requested
      if (positionFilter && el.element_type !== parseInt(positionFilter)) {
        continue;
      }

      // Skip players with very few minutes
      if (el.minutes < 90) continue;

      const team = teamMap.get(el.team);
      const understat = understatMap.get(el.id);
      const proj = projMap.get(el.id);
      const xPts = proj?.expected_points ?? 0;

      // Get upcoming fixture difficulties for classification
      const upcoming = teamUpcomingFixtures.get(el.team) || [];
      const upcomingDifficulties = upcoming
        .filter((f) => f.difficulty > 0)
        .map((f) => f.difficulty);

      const { verdict, reasons } = classifyPlayer(
        el,
        understat,
        xPts,
        upcomingDifficulties
      );

      const ownership = parseFloat(el.selected_by_percent || "0");

      analyticsPlayers.push({
        id: el.id,
        webName: el.web_name,
        fullName: `${(el as unknown as Record<string, string>).first_name || ""} ${(el as unknown as Record<string, string>).second_name || el.web_name}`.trim(),
        team: team?.short_name || "???",
        teamId: el.team,
        position: posLabels[el.element_type] || "???",
        positionId: el.element_type,
        price: el.now_cost / 10,
        appearances: el.starts,
        goals: el.goals_scored,
        assists: el.assists,
        totalPoints: el.total_points,
        form: el.form,
        ownership: el.selected_by_percent,
        status: el.status,
        chanceOfPlaying: el.chance_of_playing_next_round,
        shots: understat?.shots ?? null,
        keyPasses: understat?.keyPasses ?? null,
        npxG: understat ? Math.round(understat.npxG * 100) / 100 : null,
        xGChain: understat
          ? Math.round(understat.xGChain * 100) / 100
          : null,
        xG: understat
          ? Math.round(understat.xG * 100) / 100
          : Math.round(parseFloat(el.expected_goals || "0") * 100) / 100,
        xA: understat
          ? Math.round(understat.xA * 100) / 100
          : Math.round(parseFloat(el.expected_assists || "0") * 100) / 100,
        xPts: Math.round(xPts * 10) / 10,
        verdict,
        verdictReasons: reasons,
        isDifferential: ownership < 10,
        isRotationRisk:
          el.starts > 0 &&
          el.starts / Math.max(el.starts + 5, 20) < 0.6,
        isUnavailable:
          el.status === "i" || el.status === "s" || el.status === "n",
        isMaybeUnavailable: el.status === "d",
        upcomingFixtures: upcoming,
      });
    }

    // Sort by xPts descending
    analyticsPlayers.sort((a, b) => b.xPts - a.xPts);

    return NextResponse.json({
      ok: true,
      players: analyticsPlayers,
      currentGW,
      targetGW,
      upcomingGWs,
      squadIds: Array.from(squadIds),
      understatAvailable: understatMap.size > 0,
    });
  } catch (err: unknown) {
    console.error("Analytics API error:", err);
    return NextResponse.json(
      { ok: false, error: String(err) },
      { status: 500 }
    );
  }
}
