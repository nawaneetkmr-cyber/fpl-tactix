// ---------- Decision Intelligence Engine ----------
// Evaluates current user decisions using projections.
// Scores captain choice, bench efficiency, formation, and total optimization.

import { PlayerProjection } from "./xpts";

// ---------- Types ----------

export interface DecisionMetrics {
  captain_score: number; // 0-10
  bench_efficiency: number; // 0-100%
  formation_efficiency: number; // 0-100%
  expected_points_lost: number;
  decision_grade: string; // A+ to F
  insights: DecisionInsight[];
}

export interface DecisionInsight {
  type: "captain" | "bench" | "formation" | "transfer" | "general";
  severity: "info" | "warning" | "critical";
  message: string;
}

interface PickWithProjection {
  element: number;
  position: number;
  is_captain: boolean;
  is_vice_captain: boolean;
  element_type: number;
  web_name: string;
  projection: PlayerProjection | null;
}

// ---------- Formation helpers ----------

const VALID_FORMATIONS = [
  [1, 3, 5, 2],
  [1, 3, 4, 3],
  [1, 4, 4, 2],
  [1, 4, 3, 3],
  [1, 4, 5, 1],
  [1, 5, 4, 1],
  [1, 5, 3, 2],
  [1, 5, 2, 3],
];

// ---------- Core Engine ----------

export function evaluateDecisions(
  picks: {
    element: number;
    position: number;
    is_captain: boolean;
    is_vice_captain: boolean;
  }[],
  elements: {
    id: number;
    web_name: string;
    element_type: number;
  }[],
  projections: PlayerProjection[]
): DecisionMetrics {
  const projMap = new Map(projections.map((p) => [p.player_id, p]));
  const elemMap = new Map(elements.map((e) => [e.id, e]));

  const enrichedPicks: PickWithProjection[] = picks.map((p) => {
    const el = elemMap.get(p.element);
    return {
      ...p,
      element_type: el?.element_type ?? 0,
      web_name: el?.web_name ?? `#${p.element}`,
      projection: projMap.get(p.element) ?? null,
    };
  });

  const starters = enrichedPicks.filter((p) => p.position <= 11);
  const bench = enrichedPicks.filter((p) => p.position > 11);

  const insights: DecisionInsight[] = [];

  // 1. Captain Decision Score
  const captainScore = evaluateCaptainDecision(starters, projMap, insights);

  // 2. Bench Efficiency
  const benchEfficiency = evaluateBenchEfficiency(
    starters,
    bench,
    projMap,
    insights
  );

  // 3. Formation Efficiency
  const formationEfficiency = evaluateFormationEfficiency(
    enrichedPicks,
    projMap,
    insights
  );

  // 4. Expected Points Lost
  const xPtsLost = calculateExpectedPointsLost(
    enrichedPicks,
    projMap,
    insights
  );

  // 5. Overall Grade
  const grade = calculateGrade(captainScore, benchEfficiency, formationEfficiency, xPtsLost);

  return {
    captain_score: captainScore,
    bench_efficiency: benchEfficiency,
    formation_efficiency: formationEfficiency,
    expected_points_lost: Math.round(xPtsLost * 10) / 10,
    decision_grade: grade,
    insights,
  };
}

// ---------- Component Evaluators ----------

function evaluateCaptainDecision(
  starters: PickWithProjection[],
  projMap: Map<number, PlayerProjection>,
  insights: DecisionInsight[]
): number {
  const captain = starters.find((p) => p.is_captain);
  if (!captain || !captain.projection) return 5;

  const captainXPts = captain.projection.expected_points;

  // Find the best xPts among starters
  let bestXPts = 0;
  let bestPlayer: PickWithProjection | null = null;
  for (const p of starters) {
    const xpts = p.projection?.expected_points ?? 0;
    if (xpts > bestXPts) {
      bestXPts = xpts;
      bestPlayer = p;
    }
  }

  if (bestXPts === 0) return 5;

  // Score = how close captain xPts is to best option
  const ratio = captainXPts / bestXPts;
  const score = Math.min(10, Math.round(ratio * 10 * 10) / 10);

  if (ratio < 0.7 && bestPlayer) {
    insights.push({
      type: "captain",
      severity: "critical",
      message: `${bestPlayer.web_name} (${bestXPts} xPts) is projected significantly higher than your captain ${captain.web_name} (${captainXPts} xPts).`,
    });
  } else if (ratio < 0.9 && bestPlayer && bestPlayer.element !== captain.element) {
    insights.push({
      type: "captain",
      severity: "warning",
      message: `Consider ${bestPlayer.web_name} (${bestXPts} xPts) as captain over ${captain.web_name} (${captainXPts} xPts).`,
    });
  } else {
    insights.push({
      type: "captain",
      severity: "info",
      message: `${captain.web_name} is a strong captain choice with ${captainXPts} expected points.`,
    });
  }

  return score;
}

function evaluateBenchEfficiency(
  starters: PickWithProjection[],
  bench: PickWithProjection[],
  projMap: Map<number, PlayerProjection>,
  insights: DecisionInsight[]
): number {
  // Bench efficiency = how well bench points are minimized vs starters
  // Low bench xPts relative to starters = good (means best players are starting)
  const starterXPts = starters.reduce(
    (sum, p) => sum + (p.projection?.expected_points ?? 0),
    0
  );
  const benchXPts = bench.reduce(
    (sum, p) => sum + (p.projection?.expected_points ?? 0),
    0
  );

  // Check if any bench player has higher xPts than any starter
  const lowestStarter = starters.reduce(
    (min, p) => {
      const xpts = p.projection?.expected_points ?? 999;
      return xpts < min.xpts ? { player: p, xpts } : min;
    },
    { player: null as PickWithProjection | null, xpts: 999 }
  );

  const highestBench = bench.reduce(
    (max, p) => {
      const xpts = p.projection?.expected_points ?? 0;
      return xpts > max.xpts ? { player: p, xpts } : max;
    },
    { player: null as PickWithProjection | null, xpts: 0 }
  );

  if (
    highestBench.player &&
    lowestStarter.player &&
    highestBench.xpts > lowestStarter.xpts + 0.5
  ) {
    insights.push({
      type: "bench",
      severity: "warning",
      message: `Bench player ${highestBench.player.web_name} (${highestBench.xpts} xPts) is projected higher than starter ${lowestStarter.player.web_name} (${lowestStarter.xpts} xPts).`,
    });
  }

  // Efficiency: higher is better (more xPts in starters vs bench)
  const totalXPts = starterXPts + benchXPts;
  if (totalXPts === 0) return 50;

  const efficiency = Math.round((starterXPts / totalXPts) * 100);
  return Math.min(100, efficiency);
}

function evaluateFormationEfficiency(
  picks: PickWithProjection[],
  projMap: Map<number, PlayerProjection>,
  insights: DecisionInsight[]
): number {
  // Find all 15 players and their projections
  const allPlayers = picks.map((p) => ({
    ...p,
    xpts: p.projection?.expected_points ?? 0,
  }));

  // Group by position
  const byType: Record<number, typeof allPlayers> = { 1: [], 2: [], 3: [], 4: [] };
  for (const p of allPlayers) {
    if (byType[p.element_type]) byType[p.element_type].push(p);
  }

  // Sort each position group by xPts descending
  for (const type of [1, 2, 3, 4]) {
    byType[type].sort((a, b) => b.xpts - a.xpts);
  }

  // Find optimal formation
  let bestTotal = 0;
  let bestFormation: number[] = [];

  for (const [gkp, def, mid, fwd] of VALID_FORMATIONS) {
    if (
      gkp > byType[1].length ||
      def > byType[2].length ||
      mid > byType[3].length ||
      fwd > byType[4].length
    ) {
      continue;
    }

    const total =
      byType[1].slice(0, gkp).reduce((s, p) => s + p.xpts, 0) +
      byType[2].slice(0, def).reduce((s, p) => s + p.xpts, 0) +
      byType[3].slice(0, mid).reduce((s, p) => s + p.xpts, 0) +
      byType[4].slice(0, fwd).reduce((s, p) => s + p.xpts, 0);

    if (total > bestTotal) {
      bestTotal = total;
      bestFormation = [gkp, def, mid, fwd];
    }
  }

  // Current formation xPts
  const currentTotal = allPlayers
    .filter((p) => p.position <= 11)
    .reduce((s, p) => s + p.xpts, 0);

  if (bestTotal === 0) return 50;

  const efficiency = Math.round((currentTotal / bestTotal) * 100);

  if (efficiency < 90 && bestFormation.length > 0) {
    const formationStr = `${bestFormation[1]}-${bestFormation[2]}-${bestFormation[3]}`;
    insights.push({
      type: "formation",
      severity: "warning",
      message: `A ${formationStr} formation would yield ${bestTotal.toFixed(1)} xPts vs your current ${currentTotal.toFixed(1)} xPts.`,
    });
  }

  return Math.min(100, efficiency);
}

function calculateExpectedPointsLost(
  picks: PickWithProjection[],
  projMap: Map<number, PlayerProjection>,
  insights: DecisionInsight[]
): number {
  // Calculate optimal xPts with best lineup + best captain
  const allPlayers = picks.map((p) => ({
    ...p,
    xpts: p.projection?.expected_points ?? 0,
  }));

  const byType: Record<number, typeof allPlayers> = { 1: [], 2: [], 3: [], 4: [] };
  for (const p of allPlayers) {
    if (byType[p.element_type]) byType[p.element_type].push(p);
  }
  for (const type of [1, 2, 3, 4]) {
    byType[type].sort((a, b) => b.xpts - a.xpts);
  }

  // Find optimal lineup
  let bestOptimalTotal = 0;
  let bestLineup: typeof allPlayers = [];

  for (const [gkp, def, mid, fwd] of VALID_FORMATIONS) {
    if (
      gkp > byType[1].length ||
      def > byType[2].length ||
      mid > byType[3].length ||
      fwd > byType[4].length
    ) {
      continue;
    }

    const lineup = [
      ...byType[1].slice(0, gkp),
      ...byType[2].slice(0, def),
      ...byType[3].slice(0, mid),
      ...byType[4].slice(0, fwd),
    ];

    const total = lineup.reduce((s, p) => s + p.xpts, 0);
    if (total > bestOptimalTotal) {
      bestOptimalTotal = total;
      bestLineup = lineup;
    }
  }

  // Add best captain bonus
  const bestCaptainXPts = bestLineup.reduce(
    (max, p) => Math.max(max, p.xpts),
    0
  );
  const optimalWithCaptain = bestOptimalTotal + bestCaptainXPts;

  // Current squad xPts
  const currentStarters = allPlayers.filter((p) => p.position <= 11);
  const currentTotal = currentStarters.reduce((s, p) => s + p.xpts, 0);
  const captain = currentStarters.find((p) => p.is_captain);
  const captainXPts = captain?.xpts ?? 0;
  const currentWithCaptain = currentTotal + captainXPts;

  const xPtsLost = optimalWithCaptain - currentWithCaptain;

  if (xPtsLost > 5) {
    insights.push({
      type: "general",
      severity: "critical",
      message: `Your current team leaves an estimated ${xPtsLost.toFixed(1)} expected points on the table.`,
    });
  } else if (xPtsLost > 2) {
    insights.push({
      type: "general",
      severity: "warning",
      message: `Minor optimization possible — ${xPtsLost.toFixed(1)} xPts could be gained with lineup changes.`,
    });
  } else {
    insights.push({
      type: "general",
      severity: "info",
      message: `Your lineup is well optimized with only ${xPtsLost.toFixed(1)} xPts potential improvement.`,
    });
  }

  return Math.max(0, xPtsLost);
}

// ---------- Grade Calculator ----------

function calculateGrade(
  captainScore: number,
  benchEfficiency: number,
  formationEfficiency: number,
  xPtsLost: number
): string {
  // Weighted composite score
  const composite =
    captainScore * 0.35 + // Captain choice is most impactful
    (benchEfficiency / 10) * 0.25 +
    (formationEfficiency / 10) * 0.25 +
    Math.max(0, 10 - xPtsLost) * 0.15;

  if (composite >= 9.5) return "A+";
  if (composite >= 8.5) return "A";
  if (composite >= 7.5) return "B+";
  if (composite >= 6.5) return "B";
  if (composite >= 5.5) return "C+";
  if (composite >= 4.5) return "C";
  if (composite >= 3.5) return "D";
  return "F";
}
