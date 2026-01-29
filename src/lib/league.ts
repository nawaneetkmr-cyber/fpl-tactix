// ---------- League Intelligence Engine ----------
// Analyzes mini-league competition dynamics, threats,
// overtake conditions, and decision comparison between rivals.

// ---------- Types ----------

export interface LeagueStanding {
  entry: number;
  entry_name: string;
  player_name: string;
  rank: number;
  last_rank: number;
  total: number;
  event_total: number;
}

export interface LeaguePicksInfo {
  entry: number;
  entry_name: string;
  player_name: string;
  total: number;
  event_total: number;
  picks: {
    element: number;
    position: number;
    multiplier: number;
    is_captain: boolean;
    is_vice_captain: boolean;
  }[];
}

export interface ThreatRadarEntry {
  entry: number;
  entry_name: string;
  player_name: string;
  total: number;
  event_total: number;
  gap: number; // positive = behind you, negative = ahead of you
  can_overtake_this_gw: boolean;
  threat_level: "low" | "medium" | "high" | "critical";
  direction: "above" | "below";
}

export interface OvertakeCondition {
  rival_entry: number;
  rival_name: string;
  gap: number;
  points_needed: number;
  scenario: string;
}

export interface RivalComparison {
  rival_entry: number;
  rival_name: string;
  rival_total: number;
  rival_gw_points: number;
  your_total: number;
  your_gw_points: number;
  shared_players: number;
  differential_players: {
    yours: string[];
    theirs: string[];
  };
  captain_comparison: {
    your_captain: string;
    their_captain: string;
    same: boolean;
  };
}

export interface LeagueIntelligence {
  league_name: string;
  your_rank: number;
  your_entry: number;
  total_entries: number;
  standings: LeagueStanding[];
  threat_radar: ThreatRadarEntry[];
  overtake_conditions: OvertakeCondition[];
  rival_comparisons: RivalComparison[];
}

// ---------- Core Engine ----------

export function analyzeLeague(
  leagueData: {
    league: { id: number; name: string };
    standings: {
      results: {
        entry: number;
        entry_name: string;
        player_name: string;
        rank: number;
        last_rank: number;
        total: number;
        event_total: number;
      }[];
    };
  },
  userEntryId: number,
  userPicks: {
    element: number;
    position: number;
    multiplier: number;
    is_captain: boolean;
    is_vice_captain: boolean;
  }[],
  rivalPicksMap: Map<number, LeaguePicksInfo>,
  elements: { id: number; web_name: string }[]
): LeagueIntelligence {
  const standings = leagueData.standings.results;
  const elemMap = new Map(elements.map((e) => [e.id, e.web_name]));

  const userStanding = standings.find((s) => s.entry === userEntryId);
  if (!userStanding) {
    return {
      league_name: leagueData.league.name,
      your_rank: 0,
      your_entry: userEntryId,
      total_entries: standings.length,
      standings,
      threat_radar: [],
      overtake_conditions: [],
      rival_comparisons: [],
    };
  }

  // Build threat radar
  const threatRadar = buildThreatRadar(standings, userStanding);

  // Build overtake conditions
  const overtakeConditions = buildOvertakeConditions(standings, userStanding);

  // Build rival comparisons
  const rivalComparisons = buildRivalComparisons(
    standings,
    userStanding,
    userPicks,
    rivalPicksMap,
    elemMap
  );

  return {
    league_name: leagueData.league.name,
    your_rank: userStanding.rank,
    your_entry: userEntryId,
    total_entries: standings.length,
    standings,
    threat_radar: threatRadar,
    overtake_conditions: overtakeConditions,
    rival_comparisons: rivalComparisons,
  };
}

// ---------- Component Functions ----------

function buildThreatRadar(
  standings: LeagueStanding[],
  user: LeagueStanding
): ThreatRadarEntry[] {
  const threats: ThreatRadarEntry[] = [];

  for (const rival of standings) {
    if (rival.entry === user.entry) continue;

    const gap = user.total - rival.total; // positive = you're ahead
    const direction = gap >= 0 ? "below" : "above";
    const absGap = Math.abs(gap);

    // Can they overtake this GW? (If gap < ~30 points, plausible)
    const canOvertake = absGap < 30;

    let threatLevel: "low" | "medium" | "high" | "critical";
    if (absGap <= 5) threatLevel = "critical";
    else if (absGap <= 15) threatLevel = "high";
    else if (absGap <= 30) threatLevel = "medium";
    else threatLevel = "low";

    threats.push({
      entry: rival.entry,
      entry_name: rival.entry_name,
      player_name: rival.player_name,
      total: rival.total,
      event_total: rival.event_total,
      gap,
      can_overtake_this_gw: canOvertake,
      threat_level: threatLevel,
      direction,
    });
  }

  // Sort by absolute gap (closest threats first)
  threats.sort((a, b) => Math.abs(a.gap) - Math.abs(b.gap));

  return threats;
}

function buildOvertakeConditions(
  standings: LeagueStanding[],
  user: LeagueStanding
): OvertakeCondition[] {
  const conditions: OvertakeCondition[] = [];

  // Rivals ahead of you (who you can potentially overtake)
  const rivalsAbove = standings.filter(
    (s) => s.entry !== user.entry && s.total > user.total
  );

  for (const rival of rivalsAbove.slice(0, 5)) {
    const gap = rival.total - user.total;
    const pointsNeeded = gap + 1; // Need 1 more to overtake

    let scenario: string;
    if (pointsNeeded <= 5) {
      scenario = `A good captain return could close the ${gap}-point gap.`;
    } else if (pointsNeeded <= 15) {
      scenario = `Need a strong GW to close ${gap} points. Differential captain could help.`;
    } else {
      scenario = `${gap}-point gap requires sustained outperformance over multiple GWs.`;
    }

    conditions.push({
      rival_entry: rival.entry,
      rival_name: rival.entry_name,
      gap,
      points_needed: pointsNeeded,
      scenario,
    });
  }

  // Also show rivals behind who could overtake you
  const rivalsBehind = standings.filter(
    (s) => s.entry !== user.entry && s.total < user.total
  );

  for (const rival of rivalsBehind.slice(0, 3)) {
    const gap = user.total - rival.total;

    if (gap <= 20) {
      conditions.push({
        rival_entry: rival.entry,
        rival_name: rival.entry_name,
        gap: -gap,
        points_needed: 0,
        scenario: `${rival.entry_name} is only ${gap} points behind. Protect your lead.`,
      });
    }
  }

  return conditions;
}

function buildRivalComparisons(
  standings: LeagueStanding[],
  user: LeagueStanding,
  userPicks: {
    element: number;
    is_captain: boolean;
  }[],
  rivalPicksMap: Map<number, LeaguePicksInfo>,
  elemMap: Map<number, string>
): RivalComparison[] {
  const comparisons: RivalComparison[] = [];

  // Compare with top rivals (closest in rank)
  const sortedByGap = standings
    .filter((s) => s.entry !== user.entry)
    .sort((a, b) => Math.abs(a.total - user.total) - Math.abs(b.total - user.total))
    .slice(0, 5);

  const userPlayerIds = new Set(userPicks.map((p) => p.element));
  const userCaptain = userPicks.find((p) => p.is_captain);

  for (const rival of sortedByGap) {
    const rivalInfo = rivalPicksMap.get(rival.entry);

    if (!rivalInfo) {
      // No picks data available — provide basic comparison
      comparisons.push({
        rival_entry: rival.entry,
        rival_name: rival.entry_name,
        rival_total: rival.total,
        rival_gw_points: rival.event_total,
        your_total: user.total,
        your_gw_points: user.event_total,
        shared_players: 0,
        differential_players: { yours: [], theirs: [] },
        captain_comparison: {
          your_captain: elemMap.get(userCaptain?.element ?? 0) ?? "Unknown",
          their_captain: "Unknown",
          same: false,
        },
      });
      continue;
    }

    const rivalPlayerIds = new Set(rivalInfo.picks.map((p) => p.element));
    const rivalCaptain = rivalInfo.picks.find((p) => p.is_captain);

    // Shared players
    const shared = [...userPlayerIds].filter((id) => rivalPlayerIds.has(id));

    // Differential players
    const yourDiffs = [...userPlayerIds]
      .filter((id) => !rivalPlayerIds.has(id))
      .map((id) => elemMap.get(id) ?? `#${id}`);
    const theirDiffs = [...rivalPlayerIds]
      .filter((id) => !userPlayerIds.has(id))
      .map((id) => elemMap.get(id) ?? `#${id}`);

    const yourCaptainName =
      elemMap.get(userCaptain?.element ?? 0) ?? "Unknown";
    const theirCaptainName =
      elemMap.get(rivalCaptain?.element ?? 0) ?? "Unknown";

    comparisons.push({
      rival_entry: rival.entry,
      rival_name: rival.entry_name,
      rival_total: rival.total,
      rival_gw_points: rival.event_total,
      your_total: user.total,
      your_gw_points: user.event_total,
      shared_players: shared.length,
      differential_players: {
        yours: yourDiffs,
        theirs: theirDiffs,
      },
      captain_comparison: {
        your_captain: yourCaptainName,
        their_captain: theirCaptainName,
        same:
          (userCaptain?.element ?? 0) === (rivalCaptain?.element ?? 0),
      },
    });
  }

  return comparisons;
}
