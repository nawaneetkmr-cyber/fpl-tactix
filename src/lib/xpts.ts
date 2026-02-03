// ---------- Expected Points (xPts) Engine ----------
// Predicts expected points for every player based on
// attacking stats, opponent defensive quality, fixture context,
// minutes probability, and position.

// ---------- Types ----------

export interface PlayerProjection {
  player_id: number;
  web_name: string;
  team_id: number;
  position: number; // element_type 1-4
  expected_points: number;
  goal_threat_score: number;
  assist_threat_score: number;
  clean_sheet_probability: number;
  minutes_probability: number;
  bonus_projection: number;
  risk_rating: "low" | "medium" | "high";
}

export interface FixtureDetail {
  id: number;
  event: number;
  team_h: number;
  team_a: number;
  team_h_difficulty: number;
  team_a_difficulty: number;
  finished: boolean;
  started: boolean;
}

export interface TeamStrength {
  id: number;
  name: string;
  short_name: string;
  strength_attack_home: number;
  strength_attack_away: number;
  strength_defence_home: number;
  strength_defence_away: number;
  strength_overall_home: number;
  strength_overall_away: number;
}

// Extended element with stats from bootstrap
export interface FullElement {
  id: number;
  web_name: string;
  team: number;
  element_type: number; // 1=GKP, 2=DEF, 3=MID, 4=FWD
  status: string;
  now_cost: number;
  form: string;
  points_per_game: string;
  selected_by_percent: string;
  minutes: number;
  goals_scored: number;
  assists: number;
  clean_sheets: number;
  goals_conceded: number;
  bonus: number;
  influence: string;
  creativity: string;
  threat: string;
  ict_index: string;
  expected_goals: string;
  expected_assists: string;
  expected_goal_involvements: string;
  expected_goals_conceded: string;
  starts: number;
  chance_of_playing_next_round: number | null;
  total_points: number;
  event_points: number;
}

// ---------- Constants ----------

// Base expected points by position per 90 minutes
const BASE_APPEARANCE_PTS = 2; // 60+ mins

// Points for actions by position
const GOAL_POINTS: Record<number, number> = { 1: 6, 2: 6, 3: 5, 4: 4 };
const ASSIST_POINTS = 3;
const CS_POINTS: Record<number, number> = { 1: 4, 2: 4, 3: 1, 4: 0 };

// Difficulty modifiers (FDR 1-5 maps to multiplier)
const FDR_ATTACK_MODIFIER: Record<number, number> = {
  1: 1.4, // very easy fixture
  2: 1.2,
  3: 1.0,
  4: 0.8,
  5: 0.6, // very hard fixture
};

const FDR_DEFENCE_MODIFIER: Record<number, number> = {
  1: 1.3,
  2: 1.15,
  3: 1.0,
  4: 0.85,
  5: 0.7,
};

// Home advantage multiplier
const HOME_ADVANTAGE = 1.12;

// ---------- Core Engine ----------

export function calculatePlayerProjections(
  elements: FullElement[],
  teams: TeamStrength[],
  fixtures: FixtureDetail[],
  targetGw: number
): PlayerProjection[] {
  // Get fixtures for the target gameweek
  const gwFixtures = fixtures.filter((f) => f.event === targetGw);

  // Build team-to-fixture map
  const teamFixtureMap = new Map<
    number,
    { fixture: FixtureDetail; isHome: boolean }[]
  >();
  for (const fix of gwFixtures) {
    const homeEntry = teamFixtureMap.get(fix.team_h) || [];
    homeEntry.push({ fixture: fix, isHome: true });
    teamFixtureMap.set(fix.team_h, homeEntry);

    const awayEntry = teamFixtureMap.get(fix.team_a) || [];
    awayEntry.push({ fixture: fix, isHome: false });
    teamFixtureMap.set(fix.team_a, awayEntry);
  }

  const projections: PlayerProjection[] = [];

  for (const el of elements) {
    const teamFixtures = teamFixtureMap.get(el.team);
    if (!teamFixtures || teamFixtures.length === 0) {
      // Player's team doesn't play this GW (blank GW)
      projections.push({
        player_id: el.id,
        web_name: el.web_name,
        team_id: el.team,
        position: el.element_type,
        expected_points: 0,
        goal_threat_score: 0,
        assist_threat_score: 0,
        clean_sheet_probability: 0,
        minutes_probability: 0,
        bonus_projection: 0,
        risk_rating: "high",
      });
      continue;
    }

    // Calculate per-fixture projections and sum (double gameweeks)
    let totalXPts = 0;
    let totalGoalThreat = 0;
    let totalAssistThreat = 0;
    let totalCSProb = 0;

    const minutesProb = calculateMinutesProbability(el);
    const riskRating = calculateRiskRating(el, minutesProb);

    for (const { fixture, isHome } of teamFixtures) {
      const difficulty = isHome
        ? fixture.team_a_difficulty
        : fixture.team_h_difficulty;
      // For defence, the difficulty is the opponent's attacking quality
      const defDifficulty = isHome
        ? fixture.team_h_difficulty
        : fixture.team_a_difficulty;

      const homeMultiplier = isHome ? HOME_ADVANTAGE : 1.0;

      // Calculate component projections
      const goalThreat = calculateGoalThreat(el, difficulty, homeMultiplier);
      const assistThreat = calculateAssistThreat(el, difficulty, homeMultiplier);
      const csProb = calculateCleanSheetProbability(
        el,
        defDifficulty,
        homeMultiplier
      );

      // Expected points from goals
      const goalPoints =
        goalThreat * (GOAL_POINTS[el.element_type] || 4) * minutesProb;

      // Expected points from assists
      const assistPoints = assistThreat * ASSIST_POINTS * minutesProb;

      // Expected points from clean sheets
      const csPoints =
        csProb * (CS_POINTS[el.element_type] || 0) * minutesProb;

      // Appearance points (weighted by minutes probability)
      const appearancePoints = minutesProb * BASE_APPEARANCE_PTS;

      // Bonus projection
      const bonusProj =
        calculateBonusProjection(
          el,
          goalThreat,
          assistThreat,
          csProb
        ) * minutesProb;

      const fixtureXPts =
        goalPoints + assistPoints + csPoints + appearancePoints + bonusProj;

      totalXPts += fixtureXPts;
      totalGoalThreat += goalThreat;
      totalAssistThreat += assistThreat;
      totalCSProb += csProb;
    }

    projections.push({
      player_id: el.id,
      web_name: el.web_name,
      team_id: el.team,
      position: el.element_type,
      expected_points: Math.round(totalXPts * 10) / 10,
      goal_threat_score: Math.round(totalGoalThreat * 100) / 100,
      assist_threat_score: Math.round(totalAssistThreat * 100) / 100,
      clean_sheet_probability:
        Math.round(Math.min(totalCSProb, 1) * 100) / 100,
      minutes_probability: Math.round(minutesProb * 100) / 100,
      bonus_projection:
        Math.round(
          calculateBonusProjection(
            el,
            totalGoalThreat,
            totalAssistThreat,
            totalCSProb
          ) * 10
        ) / 10,
      risk_rating: riskRating,
    });
  }

  // Sort by expected points descending
  projections.sort((a, b) => b.expected_points - a.expected_points);

  return projections;
}

// ---------- Component Calculators ----------

function calculateGoalThreat(
  el: FullElement,
  fixtureDifficulty: number,
  homeMultiplier: number
): number {
  // Base xG rate from actual stats
  const gamesPlayed = Math.max(el.starts, 1);
  const xgPerGame = parseFloat(el.expected_goals || "0") / gamesPlayed;
  const goalsPerGame = el.goals_scored / gamesPlayed;

  // Blend actual goals and xG (60% xG, 40% actual)
  const blendedRate = xgPerGame * 0.6 + goalsPerGame * 0.4;

  // Apply fixture difficulty modifier
  const fdrModifier = FDR_ATTACK_MODIFIER[fixtureDifficulty] || 1.0;

  return blendedRate * fdrModifier * homeMultiplier;
}

function calculateAssistThreat(
  el: FullElement,
  fixtureDifficulty: number,
  homeMultiplier: number
): number {
  const gamesPlayed = Math.max(el.starts, 1);
  const xaPerGame = parseFloat(el.expected_assists || "0") / gamesPlayed;
  const assistsPerGame = el.assists / gamesPlayed;

  // Blend xA and actual assists
  const blendedRate = xaPerGame * 0.6 + assistsPerGame * 0.4;

  const fdrModifier = FDR_ATTACK_MODIFIER[fixtureDifficulty] || 1.0;

  return blendedRate * fdrModifier * homeMultiplier;
}

function calculateCleanSheetProbability(
  el: FullElement,
  defDifficulty: number,
  homeMultiplier: number
): number {
  // Only GKP and DEF get significant CS points
  if (el.element_type > 2) {
    return el.element_type === 3 ? 0.15 : 0; // MID gets 1pt for CS
  }

  const gamesPlayed = Math.max(el.starts, 1);
  const csRate = el.clean_sheets / gamesPlayed;

  // Factor in opponent attack strength via FDR
  const fdrModifier = FDR_DEFENCE_MODIFIER[defDifficulty] || 1.0;

  return Math.min(csRate * fdrModifier * homeMultiplier, 0.95);
}

function calculateMinutesProbability(el: FullElement): number {
  // Use chance_of_playing_next_round if available
  if (el.chance_of_playing_next_round !== null) {
    return el.chance_of_playing_next_round / 100;
  }

  // Use status
  if (el.status === "a") return 0.95; // available
  if (el.status === "d") return 0.5; // doubtful
  if (el.status === "i" || el.status === "u" || el.status === "s")
    return 0.0; // injured/unavailable/suspended
  if (el.status === "n") return 0.0; // not available

  // Fallback: estimate from starts and minutes
  const gamesPlayed = Math.max(el.starts, 1);
  const startRate = el.starts / gamesPlayed;
  return Math.min(startRate, 0.95);
}

function calculateBonusProjection(
  el: FullElement,
  goalThreat: number,
  assistThreat: number,
  csProb: number
): number {
  // Bonus is correlated with involvement
  const gamesPlayed = Math.max(el.starts, 1);
  const bonusPerGame = el.bonus / gamesPlayed;

  // Weight current form + projected involvement
  const projectedInvolvement = goalThreat * 3 + assistThreat * 2 + csProb * 1;

  return bonusPerGame * 0.7 + projectedInvolvement * 0.3;
}

function calculateRiskRating(
  el: FullElement,
  minutesProb: number
): "low" | "medium" | "high" {
  if (minutesProb < 0.5) return "high";
  if (minutesProb < 0.8) return "medium";

  // Check injury flag
  if (el.status !== "a") return "medium";

  // Check form
  const form = parseFloat(el.form || "0");
  if (form < 2) return "medium";

  return "low";
}

// ---------- Squad xPts Summary ----------

export interface SquadXPts {
  total_expected_points: number;
  starting_xi_xpts: number;
  bench_xpts: number;
  captain_xpts: number;
  best_captain_id: number | null;
  best_captain_xpts: number;
  player_projections: PlayerProjection[];
}

export function calculateSquadXPts(
  picks: { element: number; position: number; is_captain: boolean }[],
  projections: PlayerProjection[]
): SquadXPts {
  const projMap = new Map(projections.map((p) => [p.player_id, p]));

  let startingXPts = 0;
  let benchXPts = 0;
  let captainXPts = 0;
  let bestCaptainId: number | null = null;
  let bestCaptainXPts = 0;

  const playerProjections: PlayerProjection[] = [];

  for (const pick of picks) {
    const proj = projMap.get(pick.element);
    if (!proj) continue;

    playerProjections.push(proj);

    if (pick.position <= 11) {
      startingXPts += proj.expected_points;

      if (pick.is_captain) {
        captainXPts = proj.expected_points;
      }

      // Track best captain option
      if (proj.expected_points > bestCaptainXPts) {
        bestCaptainXPts = proj.expected_points;
        bestCaptainId = proj.player_id;
      }
    } else {
      benchXPts += proj.expected_points;
    }
  }

  // Captain gets double, so add the extra captain xPts
  const totalXPts = startingXPts + captainXPts; // captain counted once in starting, add again

  return {
    total_expected_points: Math.round(totalXPts * 10) / 10,
    starting_xi_xpts: Math.round(startingXPts * 10) / 10,
    bench_xpts: Math.round(benchXPts * 10) / 10,
    captain_xpts: Math.round(captainXPts * 10) / 10,
    best_captain_id: bestCaptainId,
    best_captain_xpts: Math.round(bestCaptainXPts * 10) / 10,
    player_projections: playerProjections,
  };
}
