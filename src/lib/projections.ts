// ---------- xPts Projection Engine ----------
// Calculates expected points for players based on weighted form,
// fixture difficulty, and minutes probability.

import type { FixtureDetail, FullElement, TeamStrength } from "./xpts";
import { calculatePlayerProjections } from "./xpts";

// ---------- Types ----------

export interface GWPlayerStats {
  element: number;
  gameweek: number;
  total_points: number;
  minutes: number;
  goals_scored: number;
  assists: number;
  clean_sheets: number;
  bonus: number;
  bps: number;
}

export interface FPLFixture {
  id: number;
  event: number; // gameweek
  team_h: number;
  team_a: number;
  team_h_difficulty: number;
  team_a_difficulty: number;
  finished: boolean;
  started: boolean;
  kickoff_time: string;
}

export interface FPLTeam {
  id: number;
  name: string;
  short_name: string;
}

export interface PlayerProjection {
  element: number;
  webName: string;
  teamId: number;
  gameweek: number;
  xPts: number;
  minutesProbability: number;
  fixtureLabel: string;
  difficulty: number;
}

export interface PlayerProjectionSummary {
  element: number;
  webName: string;
  teamId: number;
  totalXPts: number;
  perGwXPts: number;
  projections: PlayerProjection[];
  form: number;
}

export interface FixtureDifficultyRow {
  teamId: number;
  teamName: string;
  shortName: string;
  fixtures: {
    gameweek: number;
    opponent: string;
    opponentId: number;
    difficulty: number;
    isHome: boolean;
  }[];
}

export interface TransferImpactResult {
  playerOut: { element: number; webName: string; totalXPts: number };
  playerIn: { element: number; webName: string; totalXPts: number };
  projectedGain: number;
  budgetDelta: number;
  recommendation: "strong" | "marginal" | "avoid";
  breakdown: string[];
}

export interface PlayerMeta {
  id: number;
  web_name: string;
  team: number;
  element_type: number;
  now_cost: number;
  status: string;
  element_summary?: GWPlayerStats[];
}

// ---------- Config Constants ----------

const FORM_WINDOW = 6;
const FORM_WEIGHTS = [0.5, 0.7, 0.9, 1.0, 1.2, 1.4]; // index 0 = oldest
const DEFAULT_PROJECTION_WINDOW = 3;
const DIFFICULTY_MULTIPLIER: Record<number, number> = {
  1: 1.30,
  2: 1.12,
  3: 1.00,
  4: 0.82,
  5: 0.68,
};
const MIN_MINUTES_THRESHOLD = 60;
const ROTATION_DISCOUNT = 0.55;

// ---------- Internal Functions ----------

function calculateWeightedForm(history: GWPlayerStats[]): number {
  // Filter to GWs where player actually played
  const playedGws = history
    .filter((h) => h.minutes > 0)
    .sort((a, b) => a.gameweek - b.gameweek)
    .slice(-FORM_WINDOW);

  if (playedGws.length === 0) return 2.0; // fallback

  let weightedSum = 0;
  let weightSum = 0;

  for (let i = 0; i < playedGws.length; i++) {
    const weight = FORM_WEIGHTS[Math.min(i, FORM_WEIGHTS.length - 1)];
    weightedSum += playedGws[i].total_points * weight;
    weightSum += weight;
  }

  return weightSum > 0 ? weightedSum / weightSum : 2.0;
}

function calculateMinutesProbability(history: GWPlayerStats[]): number {
  const recentGws = history
    .sort((a, b) => b.gameweek - a.gameweek)
    .slice(0, FORM_WINDOW);

  if (recentGws.length === 0) return 0.5; // fallback

  const gamesPlayed = recentGws.filter(
    (h) => h.minutes >= MIN_MINUTES_THRESHOLD
  ).length;

  return gamesPlayed / recentGws.length;
}

function projectPlayerGW(
  weightedForm: number,
  minutesProbability: number,
  fixtureDifficulty: number
): number {
  const diffMultiplier = DIFFICULTY_MULTIPLIER[fixtureDifficulty] ?? 1.0;
  const xPts = weightedForm * diffMultiplier * minutesProbability;
  return Math.round(xPts * 100) / 100;
}

function getUpcomingFixtures(
  teamId: number,
  allFixtures: FPLFixture[],
  currentGW: number,
  windowSize: number
): FPLFixture[] {
  return allFixtures
    .filter(
      (f) =>
        !f.finished &&
        f.event != null &&
        f.event > 0 &&
        f.event >= currentGW &&
        f.event < currentGW + windowSize &&
        (f.team_h === teamId || f.team_a === teamId)
    )
    .sort((a, b) => a.event - b.event);
}

// ---------- Exported Functions ----------

export function projectPlayer(
  elementId: number,
  webName: string,
  teamId: number,
  history: GWPlayerStats[],
  allFixtures: FPLFixture[],
  teams: FPLTeam[],
  currentGW: number,
  windowSize: number = DEFAULT_PROJECTION_WINDOW
): PlayerProjectionSummary {
  const teamMap = new Map(teams.map((t) => [t.id, t]));
  const weightedForm = calculateWeightedForm(history);
  const minutesProbability = calculateMinutesProbability(history);

  // Apply rotation discount if low minutes probability
  const effectiveMinutesProb =
    minutesProbability < 0.5
      ? minutesProbability * ROTATION_DISCOUNT
      : minutesProbability;

  const upcomingFixtures = getUpcomingFixtures(
    teamId,
    allFixtures,
    currentGW,
    windowSize
  );

  const projections: PlayerProjection[] = [];

  for (const fix of upcomingFixtures) {
    const isHome = fix.team_h === teamId;
    const opponentId = isHome ? fix.team_a : fix.team_h;
    const opponent = teamMap.get(opponentId);
    const difficulty = isHome ? fix.team_h_difficulty : fix.team_a_difficulty;

    const xPts = projectPlayerGW(weightedForm, effectiveMinutesProb, difficulty);

    const fixtureLabel = `${opponent?.short_name ?? "???"} (${isHome ? "H" : "A"})`;

    projections.push({
      element: elementId,
      webName,
      teamId,
      gameweek: fix.event,
      xPts,
      minutesProbability: effectiveMinutesProb,
      fixtureLabel,
      difficulty,
    });
  }

  const totalXPts = projections.reduce((sum, p) => sum + p.xPts, 0);
  const perGwXPts =
    projections.length > 0 ? totalXPts / projections.length : 0;

  return {
    element: elementId,
    webName,
    teamId,
    totalXPts: Math.round(totalXPts * 100) / 100,
    perGwXPts: Math.round(perGwXPts * 100) / 100,
    projections,
    form: Math.round(weightedForm * 100) / 100,
  };
}

export function projectAllPlayers(
  players: PlayerMeta[],
  allFixtures: FPLFixture[],
  teams: FPLTeam[],
  currentGW: number,
  windowSize: number = DEFAULT_PROJECTION_WINDOW,
  filter?: (player: PlayerMeta) => boolean
): PlayerProjectionSummary[] {
  const filteredPlayers = filter ? players.filter(filter) : players;

  const projections = filteredPlayers.map((p) =>
    projectPlayer(
      p.id,
      p.web_name,
      p.team,
      p.element_summary ?? [],
      allFixtures,
      teams,
      currentGW,
      windowSize
    )
  );

  // Sort by totalXPts descending
  return projections.sort((a, b) => b.totalXPts - a.totalXPts);
}

export function buildFixtureDifficultyGrid(
  allFixtures: FPLFixture[],
  teams: FPLTeam[],
  currentGW: number,
  numGWs: number = 10
): FixtureDifficultyRow[] {
  const teamMap = new Map(teams.map((t) => [t.id, t]));
  const rows: FixtureDifficultyRow[] = [];

  for (const team of teams) {
    const fixtures: FixtureDifficultyRow["fixtures"] = [];

    for (let gw = currentGW; gw < currentGW + numGWs; gw++) {
      const gwFixtures = allFixtures.filter(
        (f) =>
          f.event === gw && (f.team_h === team.id || f.team_a === team.id)
      );

      for (const fix of gwFixtures) {
        const isHome = fix.team_h === team.id;
        const opponentId = isHome ? fix.team_a : fix.team_h;
        const opponent = teamMap.get(opponentId);
        const difficulty = isHome
          ? fix.team_h_difficulty
          : fix.team_a_difficulty;

        fixtures.push({
          gameweek: gw,
          opponent: opponent?.short_name ?? "???",
          opponentId,
          difficulty,
          isHome,
        });
      }
    }

    rows.push({
      teamId: team.id,
      teamName: team.name,
      shortName: team.short_name,
      fixtures,
    });
  }

  return rows;
}

export function calculateTransferImpact(
  playerOut: PlayerMeta,
  playerIn: PlayerMeta,
  playerOutHistory: GWPlayerStats[],
  playerInHistory: GWPlayerStats[],
  allFixtures: FPLFixture[],
  teams: FPLTeam[],
  currentGW: number,
  windowSize: number = DEFAULT_PROJECTION_WINDOW
): TransferImpactResult {
  const outProj = projectPlayer(
    playerOut.id,
    playerOut.web_name,
    playerOut.team,
    playerOutHistory,
    allFixtures,
    teams,
    currentGW,
    windowSize
  );

  const inProj = projectPlayer(
    playerIn.id,
    playerIn.web_name,
    playerIn.team,
    playerInHistory,
    allFixtures,
    teams,
    currentGW,
    windowSize
  );

  const projectedGain =
    Math.round((inProj.totalXPts - outProj.totalXPts) * 100) / 100;
  const budgetDelta = playerIn.now_cost - playerOut.now_cost;

  let recommendation: "strong" | "marginal" | "avoid";
  if (projectedGain >= 2.0) recommendation = "strong";
  else if (projectedGain >= 0.5) recommendation = "marginal";
  else recommendation = "avoid";

  const breakdown: string[] = [];
  breakdown.push(
    `${playerOut.web_name}: ${outProj.totalXPts} xPts (form: ${outProj.form})`
  );
  breakdown.push(
    `${playerIn.web_name}: ${inProj.totalXPts} xPts (form: ${inProj.form})`
  );
  breakdown.push(`Projected gain: ${projectedGain > 0 ? "+" : ""}${projectedGain} xPts`);
  breakdown.push(
    `Budget impact: ${budgetDelta > 0 ? "+" : ""}${(budgetDelta / 10).toFixed(1)}m`
  );

  return {
    playerOut: {
      element: playerOut.id,
      webName: playerOut.web_name,
      totalXPts: outProj.totalXPts,
    },
    playerIn: {
      element: playerIn.id,
      webName: playerIn.web_name,
      totalXPts: inProj.totalXPts,
    },
    projectedGain,
    budgetDelta,
    recommendation,
    breakdown,
  };
}

export function suggestNextGWCaptain(
  squadElementIds: number[],
  allPlayers: FullElement[],
  allFixtures: FixtureDetail[],
  teams: TeamStrength[],
  currentGW: number
): {
  suggestions: { element: number; webName: string; xPts: number; fixtureLabel: string }[];
  nextGW: number;
} {
  // Find the actual next unfinished GW dynamically
  // Filter out fixtures with null/0 event (unscheduled) to avoid Math.min coercing null to 0
  const unfinishedFixtures = allFixtures.filter(
    (f) => !f.finished && f.event != null && f.event > 0
  );
  const nextGW =
    unfinishedFixtures.length > 0
      ? Math.min(...unfinishedFixtures.map((f) => f.event))
      : currentGW;

  const teamMap = new Map(teams.map((t) => [t.id, t]));
  const fixtureLabelsByTeam = new Map<number, string[]>();

  for (const fix of allFixtures.filter((f) => f.event === nextGW)) {
    const homeOpponent = teamMap.get(fix.team_a)?.short_name ?? "???";
    const awayOpponent = teamMap.get(fix.team_h)?.short_name ?? "???";

    const homeLabels = fixtureLabelsByTeam.get(fix.team_h) ?? [];
    homeLabels.push(`${homeOpponent} (H)`);
    fixtureLabelsByTeam.set(fix.team_h, homeLabels);

    const awayLabels = fixtureLabelsByTeam.get(fix.team_a) ?? [];
    awayLabels.push(`${awayOpponent} (A)`);
    fixtureLabelsByTeam.set(fix.team_a, awayLabels);
  }

  const projections = calculatePlayerProjections(
    allPlayers,
    teams,
    allFixtures,
    nextGW
  );

  const squadProjections = projections.filter((p) =>
    squadElementIds.includes(p.player_id)
  );
  const eligible = squadProjections.filter((p) => p.minutes_probability >= 0.4);
  const baseList = eligible.length >= 3 ? eligible : squadProjections;

  const suggestions = baseList
    .map((p) => ({
      element: p.player_id,
      webName: p.web_name,
      xPts: Math.round(p.expected_points * 10) / 10,
      fixtureLabel:
        fixtureLabelsByTeam.get(p.team_id)?.join(", ") ?? "No fixture",
    }))
    .sort((a, b) => b.xPts - a.xPts)
    .slice(0, 3);

  return { suggestions, nextGW };
}

export function difficultyBgClass(difficulty: number): string {
  switch (difficulty) {
    case 1:
      return "bg-green-700 text-white";
    case 2:
      return "bg-green-400 text-gray-900";
    case 3:
      return "bg-yellow-400 text-gray-900";
    case 4:
      return "bg-orange-400 text-gray-900";
    case 5:
      return "bg-red-500 text-white";
    default:
      return "bg-gray-500 text-white";
  }
}
