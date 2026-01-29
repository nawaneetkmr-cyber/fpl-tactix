// ---------- Strategy Engine ----------
// Forward-looking planning: transfer optimization, chip strategy,
// fixture swing detection, and risk vs safe analysis.

import { PlayerProjection, FixtureDetail, FullElement } from "./xpts";

// =============================================
// 4.1 Transfer Optimization Module
// =============================================

export interface TransferSuggestion {
  out_player: { id: number; name: string; team: number; position: number; cost: number };
  in_player: { id: number; name: string; team: number; position: number; cost: number };
  projected_gain_next_gw: number;
  projected_gain_3_gw: number;
}

export interface TransferPlan {
  suggested_transfers: TransferSuggestion[];
  expected_points_gain_next_gw: number;
  expected_points_gain_next_3_gw: number;
  free_transfers: number;
  budget_remaining: number;
  hit_cost: number;
}

export function optimizeTransfers(
  currentSquad: {
    element: number;
    position: number;
    selling_price: number;
  }[],
  elements: FullElement[],
  projections: PlayerProjection[],
  projectionsNextGws: PlayerProjection[][], // projections for next 3-5 GWs
  budget: number, // in tenths (e.g. 1000 = 100.0m)
  freeTransfers: number
): TransferPlan {
  const elemMap = new Map(elements.map((e) => [e.id, e]));
  const projMap = new Map(projections.map((p) => [p.player_id, p]));

  // Build multi-GW projection maps
  const multiGwProjMap = new Map<number, number>();
  for (const gwProjs of projectionsNextGws) {
    for (const p of gwProjs) {
      multiGwProjMap.set(
        p.player_id,
        (multiGwProjMap.get(p.player_id) ?? 0) + p.expected_points
      );
    }
  }

  const squadIds = new Set(currentSquad.map((p) => p.element));

  // Score each current player
  const squadScored = currentSquad.map((p) => {
    const el = elemMap.get(p.element);
    const proj = projMap.get(p.element);
    const multiGw = multiGwProjMap.get(p.element) ?? 0;
    return {
      ...p,
      name: el?.web_name ?? `#${p.element}`,
      team: el?.team ?? 0,
      element_type: el?.element_type ?? 0,
      cost: el?.now_cost ?? 0,
      next_gw_xpts: proj?.expected_points ?? 0,
      multi_gw_xpts: multiGw,
    };
  });

  // Find potential replacements
  const suggestions: TransferSuggestion[] = [];

  // Sort squad by lowest multi-GW xPts (weakest links)
  const sortedSquad = [...squadScored].sort(
    (a, b) => a.multi_gw_xpts - b.multi_gw_xpts
  );

  for (const outPlayer of sortedSquad) {
    // Find same-position replacements not in squad
    const candidates = elements
      .filter(
        (e) =>
          e.element_type === outPlayer.element_type &&
          !squadIds.has(e.id) &&
          e.status === "a" &&
          e.now_cost <= outPlayer.cost + (budget - totalSquadCost(currentSquad, elements))
      )
      .map((e) => {
        const proj = projMap.get(e.id);
        const multiGw = multiGwProjMap.get(e.id) ?? 0;
        return {
          ...e,
          next_gw_xpts: proj?.expected_points ?? 0,
          multi_gw_xpts: multiGw,
        };
      })
      .filter((e) => e.multi_gw_xpts > outPlayer.multi_gw_xpts + 1)
      .sort((a, b) => b.multi_gw_xpts - a.multi_gw_xpts);

    if (candidates.length > 0) {
      const best = candidates[0];
      suggestions.push({
        out_player: {
          id: outPlayer.element,
          name: outPlayer.name,
          team: outPlayer.team,
          position: outPlayer.element_type,
          cost: outPlayer.cost,
        },
        in_player: {
          id: best.id,
          name: best.web_name,
          team: best.team,
          position: best.element_type,
          cost: best.now_cost,
        },
        projected_gain_next_gw:
          Math.round((best.next_gw_xpts - outPlayer.next_gw_xpts) * 10) / 10,
        projected_gain_3_gw:
          Math.round((best.multi_gw_xpts - outPlayer.multi_gw_xpts) * 10) / 10,
      });
    }
  }

  // Sort suggestions by 3-GW gain
  suggestions.sort((a, b) => b.projected_gain_3_gw - a.projected_gain_3_gw);

  // Take top suggestions (limited by free transfers + 1 hit)
  const maxTransfers = Math.min(suggestions.length, freeTransfers + 1);
  const topSuggestions = suggestions.slice(0, maxTransfers);

  const hitCost =
    Math.max(0, topSuggestions.length - freeTransfers) * 4;

  const totalGainNextGw = topSuggestions.reduce(
    (s, t) => s + t.projected_gain_next_gw,
    0
  );
  const totalGain3Gw = topSuggestions.reduce(
    (s, t) => s + t.projected_gain_3_gw,
    0
  );

  return {
    suggested_transfers: topSuggestions,
    expected_points_gain_next_gw: Math.round((totalGainNextGw - hitCost) * 10) / 10,
    expected_points_gain_next_3_gw: Math.round((totalGain3Gw - hitCost) * 10) / 10,
    free_transfers: freeTransfers,
    budget_remaining: budget,
    hit_cost: hitCost,
  };
}

function totalSquadCost(
  squad: { element: number }[],
  elements: FullElement[]
): number {
  const elemMap = new Map(elements.map((e) => [e.id, e]));
  return squad.reduce((sum, p) => sum + (elemMap.get(p.element)?.now_cost ?? 0), 0);
}

// =============================================
// 4.2 Chip Strategy Module
// =============================================

export interface BenchBoostAnalysis {
  bench_boost_value: number; // xPts from bench this GW
  optimal_gw_for_bb: number;
  optimal_bb_value: number;
  current_bench_xpts: number;
  recommendation: string;
}

export interface TripleCaptainAnalysis {
  best_tc_candidate: { id: number; name: string; xpts: number };
  expected_tc_gain: number; // extra points vs normal captain
  recommended_gw: number;
  current_gw_value: number;
  recommendation: string;
}

export interface FreeHitAnalysis {
  current_squad_xpts: number;
  free_hit_squad_xpts: number;
  potential_gain: number;
  recommended_gw: number;
  recommendation: string;
}

export interface WildcardAnalysis {
  squad_strength_score: number; // 0-100
  recommended_use: boolean;
  reason: string;
  weak_positions: string[];
}

export interface ChipStrategy {
  bench_boost: BenchBoostAnalysis;
  triple_captain: TripleCaptainAnalysis;
  free_hit: FreeHitAnalysis;
  wildcard: WildcardAnalysis;
  chips_available: string[];
}

export function analyzeChipStrategy(
  currentSquad: { element: number; position: number; is_captain: boolean }[],
  projections: PlayerProjection[],
  projectionsMultiGw: { gw: number; projections: PlayerProjection[] }[],
  allElements: FullElement[],
  currentGw: number,
  chipsUsed: string[]
): ChipStrategy {
  const projMap = new Map(projections.map((p) => [p.player_id, p]));

  const chipsAvailable = ["bench_boost", "triple_captain", "free_hit", "wildcard"].filter(
    (c) => !chipsUsed.includes(c)
  );

  // Bench Boost Analysis
  const benchBoost = analyzeBenchBoost(
    currentSquad,
    projMap,
    projectionsMultiGw,
    currentGw
  );

  // Triple Captain Analysis
  const tripleCaptain = analyzeTripleCaptain(
    currentSquad,
    projMap,
    projectionsMultiGw,
    currentGw
  );

  // Free Hit Analysis
  const freeHit = analyzeFreeHit(
    currentSquad,
    projections,
    allElements,
    projectionsMultiGw,
    currentGw
  );

  // Wildcard Analysis
  const wildcard = analyzeWildcard(currentSquad, projMap, allElements);

  return {
    bench_boost: benchBoost,
    triple_captain: tripleCaptain,
    free_hit: freeHit,
    wildcard: wildcard,
    chips_available: chipsAvailable,
  };
}

function analyzeBenchBoost(
  squad: { element: number; position: number }[],
  projMap: Map<number, PlayerProjection>,
  multiGw: { gw: number; projections: PlayerProjection[] }[],
  currentGw: number
): BenchBoostAnalysis {
  // Current bench xPts
  const bench = squad.filter((p) => p.position > 11);
  const currentBenchXPts = bench.reduce(
    (sum, p) => sum + (projMap.get(p.element)?.expected_points ?? 0),
    0
  );

  // Find optimal GW for bench boost (highest bench xPts across future GWs)
  let optimalGw = currentGw;
  let optimalValue = currentBenchXPts;

  for (const { gw, projections } of multiGw) {
    const gwProjMap = new Map(projections.map((p) => [p.player_id, p]));
    const benchValue = bench.reduce(
      (sum, p) => sum + (gwProjMap.get(p.element)?.expected_points ?? 0),
      0
    );
    if (benchValue > optimalValue) {
      optimalValue = benchValue;
      optimalGw = gw;
    }
  }

  let recommendation: string;
  if (currentBenchXPts >= optimalValue * 0.9 && currentBenchXPts >= 10) {
    recommendation = `Good week for Bench Boost — your bench projects ${currentBenchXPts.toFixed(1)} xPts.`;
  } else if (optimalGw !== currentGw) {
    recommendation = `Consider waiting until GW${optimalGw} for Bench Boost (${optimalValue.toFixed(1)} xPts vs ${currentBenchXPts.toFixed(1)} now).`;
  } else {
    recommendation = `Bench Boost value is modest (${currentBenchXPts.toFixed(1)} xPts). Look for a double gameweek.`;
  }

  return {
    bench_boost_value: Math.round(currentBenchXPts * 10) / 10,
    optimal_gw_for_bb: optimalGw,
    optimal_bb_value: Math.round(optimalValue * 10) / 10,
    current_bench_xpts: Math.round(currentBenchXPts * 10) / 10,
    recommendation,
  };
}

function analyzeTripleCaptain(
  squad: { element: number; position: number; is_captain: boolean }[],
  projMap: Map<number, PlayerProjection>,
  multiGw: { gw: number; projections: PlayerProjection[] }[],
  currentGw: number
): TripleCaptainAnalysis {
  // Find best TC candidate this GW (highest xPts starter)
  const starters = squad.filter((p) => p.position <= 11);
  let bestCandidate = { id: 0, name: "Unknown", xpts: 0 };

  for (const p of starters) {
    const proj = projMap.get(p.element);
    if (proj && proj.expected_points > bestCandidate.xpts) {
      bestCandidate = {
        id: proj.player_id,
        name: proj.web_name,
        xpts: proj.expected_points,
      };
    }
  }

  // Normal captain gives 2x, TC gives 3x. Gain = 1x of captain xPts
  const currentGwValue = bestCandidate.xpts;

  // Check future GWs for better TC opportunity
  let bestGw = currentGw;
  let bestGwValue = currentGwValue;

  for (const { gw, projections } of multiGw) {
    const gwProjMap = new Map(projections.map((p) => [p.player_id, p]));
    for (const p of starters) {
      const proj = gwProjMap.get(p.element);
      if (proj && proj.expected_points > bestGwValue) {
        bestGwValue = proj.expected_points;
        bestGw = gw;
      }
    }
  }

  let recommendation: string;
  if (currentGwValue >= 8) {
    recommendation = `Strong TC opportunity — ${bestCandidate.name} projects ${currentGwValue.toFixed(1)} xPts. Consider using TC.`;
  } else if (bestGw !== currentGw) {
    recommendation = `Better TC opportunity in GW${bestGw} (${bestGwValue.toFixed(1)} xPts). Hold for now.`;
  } else {
    recommendation = `TC value is average. Look for a double gameweek or premium fixture.`;
  }

  return {
    best_tc_candidate: bestCandidate,
    expected_tc_gain: Math.round(currentGwValue * 10) / 10,
    recommended_gw: bestGw,
    current_gw_value: Math.round(currentGwValue * 10) / 10,
    recommendation,
  };
}

function analyzeFreeHit(
  squad: { element: number; position: number }[],
  projections: PlayerProjection[],
  allElements: FullElement[],
  multiGw: { gw: number; projections: PlayerProjection[] }[],
  currentGw: number
): FreeHitAnalysis {
  const starters = squad.filter((p) => p.position <= 11);
  const projMap = new Map(projections.map((p) => [p.player_id, p]));

  // Current squad xPts (starters)
  const currentXPts = starters.reduce(
    (sum, p) => sum + (projMap.get(p.element)?.expected_points ?? 0),
    0
  );

  // Ideal Free Hit squad: pick best XI from all available players
  const availablePlayers = projections
    .filter((p) => p.minutes_probability > 0.5)
    .sort((a, b) => b.expected_points - a.expected_points);

  // Greedy formation picker
  const fhSquad = pickBestXI(availablePlayers);
  const fhXPts = fhSquad.reduce((sum, p) => sum + p.expected_points, 0);

  // Check if any future GW has a bigger gap (blank GW detection)
  let recommendedGw = currentGw;
  let maxGain = fhXPts - currentXPts;

  for (const { gw, projections: gwProjs } of multiGw) {
    const gwProjMap = new Map(gwProjs.map((p) => [p.player_id, p]));
    const squadGwXPts = starters.reduce(
      (sum, p) => sum + (gwProjMap.get(p.element)?.expected_points ?? 0),
      0
    );
    const bestFhXPts = pickBestXI(gwProjs.filter((p) => p.minutes_probability > 0.5))
      .reduce((sum, p) => sum + p.expected_points, 0);
    const gain = bestFhXPts - squadGwXPts;
    if (gain > maxGain) {
      maxGain = gain;
      recommendedGw = gw;
    }
  }

  let recommendation: string;
  if (maxGain > 20) {
    recommendation =
      recommendedGw === currentGw
        ? `Large Free Hit potential (+${maxGain.toFixed(1)} xPts). Consider using it.`
        : `Save Free Hit for GW${recommendedGw} — potential +${maxGain.toFixed(1)} xPts gain.`;
  } else {
    recommendation = `Free Hit gain is modest (+${(fhXPts - currentXPts).toFixed(1)} xPts). Best saved for a blank or double GW.`;
  }

  return {
    current_squad_xpts: Math.round(currentXPts * 10) / 10,
    free_hit_squad_xpts: Math.round(fhXPts * 10) / 10,
    potential_gain: Math.round((fhXPts - currentXPts) * 10) / 10,
    recommended_gw: recommendedGw,
    recommendation,
  };
}

function analyzeWildcard(
  squad: { element: number; position: number }[],
  projMap: Map<number, PlayerProjection>,
  _allElements: FullElement[]
): WildcardAnalysis {
  // Assess squad strength
  const starters = squad.filter((p) => p.position <= 11);
  const totalXPts = starters.reduce(
    (sum, p) => sum + (projMap.get(p.element)?.expected_points ?? 0),
    0
  );

  // Find weak positions (below average xPts for position)
  const positionAvg: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const positionCount: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };

  for (const p of starters) {
    const proj = projMap.get(p.element);
    if (proj) {
      positionAvg[proj.position] += proj.expected_points;
      positionCount[proj.position]++;
    }
  }

  const weakPositions: string[] = [];
  const posNames: Record<number, string> = { 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" };

  for (const pos of [1, 2, 3, 4]) {
    if (positionCount[pos] > 0) {
      const avg = positionAvg[pos] / positionCount[pos];
      if (avg < 3) {
        weakPositions.push(posNames[pos]);
      }
    }
  }

  // Squad strength score (0-100)
  const maxReasonableXPts = 60; // ~5.5 per starter
  const strengthScore = Math.min(100, Math.round((totalXPts / maxReasonableXPts) * 100));

  const recommended = strengthScore < 50 || weakPositions.length >= 2;

  let reason: string;
  if (recommended) {
    reason = `Squad strength is ${strengthScore}/100 with weak areas in ${weakPositions.join(", ") || "multiple positions"}. Wildcard could significantly improve your team.`;
  } else {
    reason = `Squad strength is ${strengthScore}/100. Hold your Wildcard for a better opportunity.`;
  }

  return {
    squad_strength_score: strengthScore,
    recommended_use: recommended,
    reason,
    weak_positions: weakPositions,
  };
}

function pickBestXI(players: PlayerProjection[]): PlayerProjection[] {
  const byType: Record<number, PlayerProjection[]> = { 1: [], 2: [], 3: [], 4: [] };
  for (const p of players) {
    if (byType[p.position]) byType[p.position].push(p);
  }
  for (const t of [1, 2, 3, 4]) {
    byType[t].sort((a, b) => b.expected_points - a.expected_points);
  }

  const formations = [
    [1, 3, 5, 2],
    [1, 3, 4, 3],
    [1, 4, 4, 2],
    [1, 4, 3, 3],
    [1, 4, 5, 1],
    [1, 5, 4, 1],
    [1, 5, 3, 2],
  ];

  let bestTotal = 0;
  let bestLineup: PlayerProjection[] = [];

  for (const [g, d, m, f] of formations) {
    if (g > byType[1].length || d > byType[2].length || m > byType[3].length || f > byType[4].length) continue;
    const lineup = [
      ...byType[1].slice(0, g),
      ...byType[2].slice(0, d),
      ...byType[3].slice(0, m),
      ...byType[4].slice(0, f),
    ];
    const total = lineup.reduce((s, p) => s + p.expected_points, 0);
    if (total > bestTotal) {
      bestTotal = total;
      bestLineup = lineup;
    }
  }

  return bestLineup;
}

// =============================================
// 4.3 Fixture Swing Detector
// =============================================

export interface FixtureSwing {
  team_id: number;
  team_name: string;
  short_name: string;
  difficulty_trend: "improving" | "worsening" | "stable";
  avg_difficulty_next_3: number;
  avg_difficulty_next_5: number;
  upcoming_fixtures: {
    gw: number;
    opponent: string;
    difficulty: number;
    is_home: boolean;
  }[];
  target_players: {
    id: number;
    name: string;
    position: number;
    xpts: number;
  }[];
}

export function detectFixtureSwings(
  teams: { id: number; name: string; short_name: string }[],
  fixtures: FixtureDetail[],
  currentGw: number,
  projections: PlayerProjection[]
): FixtureSwing[] {
  const teamMap = new Map(teams.map((t) => [t.id, t]));
  const swings: FixtureSwing[] = [];

  for (const team of teams) {
    const upcomingFixtures = fixtures
      .filter(
        (f) =>
          f.event > currentGw &&
          f.event <= currentGw + 5 &&
          (f.team_h === team.id || f.team_a === team.id)
      )
      .sort((a, b) => a.event - b.event)
      .map((f) => {
        const isHome = f.team_h === team.id;
        const opponentId = isHome ? f.team_a : f.team_h;
        const opponent = teamMap.get(opponentId);
        return {
          gw: f.event,
          opponent: opponent?.short_name ?? `Team ${opponentId}`,
          difficulty: isHome ? f.team_h_difficulty : f.team_a_difficulty,
          is_home: isHome,
        };
      });

    if (upcomingFixtures.length === 0) continue;

    const next3 = upcomingFixtures.slice(0, 3);
    const next5 = upcomingFixtures.slice(0, 5);

    const avgNext3 =
      next3.reduce((s, f) => s + f.difficulty, 0) / Math.max(next3.length, 1);
    const avgNext5 =
      next5.reduce((s, f) => s + f.difficulty, 0) / Math.max(next5.length, 1);

    // Determine trend based on difficulty progression
    let trend: "improving" | "worsening" | "stable" = "stable";
    if (next5.length >= 3) {
      const firstHalf = next5.slice(0, Math.ceil(next5.length / 2));
      const secondHalf = next5.slice(Math.ceil(next5.length / 2));
      const firstAvg =
        firstHalf.reduce((s, f) => s + f.difficulty, 0) / firstHalf.length;
      const secondAvg =
        secondHalf.reduce((s, f) => s + f.difficulty, 0) / secondHalf.length;

      if (secondAvg < firstAvg - 0.3) trend = "improving";
      else if (secondAvg > firstAvg + 0.3) trend = "worsening";
    }

    // Find target players from this team
    const targetPlayers = projections
      .filter((p) => p.team_id === team.id && p.minutes_probability > 0.6)
      .sort((a, b) => b.expected_points - a.expected_points)
      .slice(0, 3)
      .map((p) => ({
        id: p.player_id,
        name: p.web_name,
        position: p.position,
        xpts: p.expected_points,
      }));

    swings.push({
      team_id: team.id,
      team_name: team.name,
      short_name: team.short_name,
      difficulty_trend: trend,
      avg_difficulty_next_3: Math.round(avgNext3 * 10) / 10,
      avg_difficulty_next_5: Math.round(avgNext5 * 10) / 10,
      upcoming_fixtures: upcomingFixtures,
      target_players: targetPlayers,
    });
  }

  // Sort by avg difficulty (easiest first)
  swings.sort((a, b) => a.avg_difficulty_next_3 - b.avg_difficulty_next_3);

  return swings;
}

// =============================================
// 4.4 Risk vs Safe Strategy Model
// =============================================

export interface StrategyProfile {
  risk_score: number; // 0-100 (0=template, 100=full differential)
  differential_count: number;
  template_exposure: number; // 0-100%
  playstyle: "template_heavy" | "balanced" | "high_risk_differential";
  suggestions: string[];
  player_ownership: {
    id: number;
    name: string;
    ownership: number; // percent
    is_differential: boolean;
  }[];
}

export function analyzeRiskProfile(
  squad: { element: number; position: number }[],
  elements: FullElement[]
): StrategyProfile {
  const elemMap = new Map(elements.map((e) => [e.id, e]));

  const playerOwnership = squad.map((p) => {
    const el = elemMap.get(p.element);
    const ownership = parseFloat(el?.selected_by_percent ?? "0");
    return {
      id: p.element,
      name: el?.web_name ?? `#${p.element}`,
      ownership,
      is_differential: ownership < 10,
    };
  });

  // Starters only for risk analysis
  const starters = squad
    .filter((p) => p.position <= 11)
    .map((p) => {
      const el = elemMap.get(p.element);
      return {
        ...p,
        ownership: parseFloat(el?.selected_by_percent ?? "0"),
      };
    });

  const avgOwnership =
    starters.reduce((sum, p) => sum + p.ownership, 0) / Math.max(starters.length, 1);

  const differentialCount = playerOwnership.filter((p) => p.is_differential).length;
  const templateCount = playerOwnership.filter((p) => p.ownership >= 20).length;
  const templateExposure = Math.round(
    (templateCount / Math.max(playerOwnership.length, 1)) * 100
  );

  // Risk score: higher = more differential
  // Low avg ownership + high differential count = high risk
  const riskScore = Math.min(
    100,
    Math.round(
      (100 - avgOwnership) * 0.5 +
        (differentialCount / 15) * 100 * 0.3 +
        (100 - templateExposure) * 0.2
    )
  );

  let playstyle: "template_heavy" | "balanced" | "high_risk_differential";
  if (riskScore < 30) playstyle = "template_heavy";
  else if (riskScore < 60) playstyle = "balanced";
  else playstyle = "high_risk_differential";

  const suggestions: string[] = [];

  if (playstyle === "template_heavy") {
    suggestions.push(
      "Your team closely mirrors the template. Consider adding 1-2 differentials to gain an edge in mini-leagues."
    );
    suggestions.push(
      "High-ownership players limit your ability to climb ranks through unique picks."
    );
  } else if (playstyle === "balanced") {
    suggestions.push(
      "Good balance of template and differential picks. This strategy works well for consistent scoring."
    );
  } else {
    suggestions.push(
      "Highly differential squad. This is high risk/high reward — great for aggressive climbs."
    );
    suggestions.push(
      "Ensure your differentials have strong underlying stats (xG, xA) to justify the picks."
    );
  }

  // Check for very low ownership picks
  const ultraDiffs = playerOwnership.filter((p) => p.ownership < 3 && !p.is_differential);
  if (ultraDiffs.length > 0) {
    suggestions.push(
      `${ultraDiffs.length} players have <3% ownership. Verify their starting chances.`
    );
  }

  return {
    risk_score: riskScore,
    differential_count: differentialCount,
    template_exposure: templateExposure,
    playstyle,
    suggestions,
    player_ownership: playerOwnership,
  };
}
