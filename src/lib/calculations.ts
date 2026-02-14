// ---------- Types ----------

export interface Pick {
  element: number;
  position: number; // 1-11 starting, 12-15 bench
  multiplier: number; // 0=benched, 1=normal, 2=captain, 3=triple-captain
  is_captain: boolean;
  is_vice_captain: boolean;
}

export interface PlayerElement {
  id: number;
  stats: { total_points: number; minutes: number };
}

export interface BootstrapElement {
  id: number;
  web_name: string;
  team: number;
  element_type: number; // 1=GKP, 2=DEF, 3=MID, 4=FWD
  status: string;
  now_cost: number;
}

export interface FixtureInfo {
  id: number;
  started: boolean;
  finished: boolean;
  finished_provisional: boolean;
}

// ---------- Core calculations ----------

export function calculateLivePoints(picks: Pick[], liveElements: PlayerElement[]) {
  let total = 0;
  for (const pick of picks) {
    const playerLive = liveElements.find((p) => p.id === pick.element);
    if (!playerLive) continue;
    const points = playerLive.stats.total_points;
    total += points * pick.multiplier;
  }
  return total;
}

export function findBestCaptain(picks: Pick[], liveElements: PlayerElement[]) {
  let best: { id: number | null; points: number; name?: string } = {
    id: null,
    points: 0,
  };
  for (const pick of picks.filter((p) => p.position <= 11)) {
    const playerLive = liveElements.find((p) => p.id === pick.element);
    if (!playerLive) continue;
    if (playerLive.stats.total_points > best.points) {
      best = { id: pick.element, points: playerLive.stats.total_points };
    }
  }
  return best;
}

// ---------- Bench & captain points ----------

export function getBenchPoints(picks: Pick[], liveElements: PlayerElement[]) {
  let total = 0;
  for (const pick of picks.filter((p) => p.position > 11)) {
    const playerLive = liveElements.find((el) => el.id === pick.element);
    if (playerLive) total += playerLive.stats.total_points;
  }
  return total;
}

export function getCaptainPoints(picks: Pick[], liveElements: PlayerElement[]) {
  const captain = picks.find((p) => p.is_captain);
  if (!captain) return 0;
  const playerLive = liveElements.find((el) => el.id === captain.element);
  return playerLive ? playerLive.stats.total_points * captain.multiplier : 0;
}

// ---------- Rank Estimation ----------

// Uses a simplified approximation model based on FPL average scores
// Maps total points in a GW to an approximate global rank position
export function estimateRank(
  livePoints: number,
  averageScore: number,
  totalPlayers: number
): number {
  if (totalPlayers === 0) return 0;

  // Use a normal distribution approximation
  // FPL scores roughly follow normal distribution with std dev ~ 14-16 points.
  // Using 15 aligns better with observed GW rank data (e.g. LiveFPL).
  const stdDev = 15;
  const zScore = (livePoints - averageScore) / stdDev;

  // Approximate percentile from z-score (simplified)
  const percentile = 0.5 * (1 + erf(zScore / Math.SQRT2));

  // Rank = total players * (1 - percentile)
  const rank = Math.max(1, Math.round(totalPlayers * (1 - percentile)));
  return rank;
}

// Error function approximation (Abramowitz and Stegun)
function erf(x: number): number {
  const sign = x >= 0 ? 1 : -1;
  const abs = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * abs);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t) *
    Math.exp(-abs * abs);
  return sign * y;
}

// ---------- What-If Simulation ----------

export interface SimulationResult {
  originalPoints: number;
  simulatedPoints: number;
  pointsDifference: number;
  description: string;
}

export function simulateCaptainChange(
  picks: Pick[],
  liveElements: PlayerElement[],
  newCaptainId: number,
  elements: BootstrapElement[]
): SimulationResult {
  const originalPoints = calculateLivePoints(picks, liveElements);

  // Create modified picks with new captain
  const simPicks = picks.map((p) => ({
    ...p,
    is_captain: p.element === newCaptainId,
    is_vice_captain: false,
    multiplier:
      p.element === newCaptainId
        ? 2
        : p.position <= 11
          ? 1
          : 0,
  }));

  const simulatedPoints = calculateLivePoints(simPicks, liveElements);
  const newCaptainName =
    elements.find((e) => e.id === newCaptainId)?.web_name ?? `#${newCaptainId}`;

  return {
    originalPoints,
    simulatedPoints,
    pointsDifference: simulatedPoints - originalPoints,
    description: `Captain ${newCaptainName}`,
  };
}

export function simulateBenchSwap(
  picks: Pick[],
  liveElements: PlayerElement[],
  starterId: number,
  benchId: number,
  elements: BootstrapElement[]
): SimulationResult {
  const originalPoints = calculateLivePoints(picks, liveElements);

  const starter = picks.find((p) => p.element === starterId);
  const benched = picks.find((p) => p.element === benchId);

  if (!starter || !benched) {
    return {
      originalPoints,
      simulatedPoints: originalPoints,
      pointsDifference: 0,
      description: "Invalid swap",
    };
  }

  // Swap positions and multipliers
  const simPicks = picks.map((p) => {
    if (p.element === starterId) {
      return { ...p, position: benched.position, multiplier: 0 };
    }
    if (p.element === benchId) {
      return {
        ...p,
        position: starter.position,
        multiplier: starter.is_captain ? 2 : 1,
      };
    }
    return { ...p };
  });

  const simulatedPoints = calculateLivePoints(simPicks, liveElements);
  const starterName =
    elements.find((e) => e.id === starterId)?.web_name ?? `#${starterId}`;
  const benchName =
    elements.find((e) => e.id === benchId)?.web_name ?? `#${benchId}`;

  return {
    originalPoints,
    simulatedPoints,
    pointsDifference: simulatedPoints - originalPoints,
    description: `Swap ${starterName} with ${benchName}`,
  };
}

export function simulateViceCaptain(
  picks: Pick[],
  liveElements: PlayerElement[],
  elements: BootstrapElement[]
): SimulationResult {
  const originalPoints = calculateLivePoints(picks, liveElements);
  const captain = picks.find((p) => p.is_captain);
  const viceCaptain = picks.find((p) => p.is_vice_captain);

  if (!captain || !viceCaptain) {
    return {
      originalPoints,
      simulatedPoints: originalPoints,
      pointsDifference: 0,
      description: "No vice captain found",
    };
  }

  const captainLive = liveElements.find((el) => el.id === captain.element);
  const captainBlanked = !captainLive || captainLive.stats.minutes === 0;

  if (!captainBlanked) {
    return {
      originalPoints,
      simulatedPoints: originalPoints,
      pointsDifference: 0,
      description: "Captain played - VC not activated",
    };
  }

  // VC gets captain's multiplier
  const simPicks = picks.map((p) => {
    if (p.element === captain.element) {
      return { ...p, multiplier: 0, is_captain: false };
    }
    if (p.element === viceCaptain.element) {
      return { ...p, multiplier: 2, is_captain: true };
    }
    return { ...p };
  });

  const simulatedPoints = calculateLivePoints(simPicks, liveElements);
  const vcName =
    elements.find((e) => e.id === viceCaptain.element)?.web_name ??
    `#${viceCaptain.element}`;

  return {
    originalPoints,
    simulatedPoints,
    pointsDifference: simulatedPoints - originalPoints,
    description: `VC ${vcName} activated (captain blanked)`,
  };
}

// ---------- Safety Score Calculation ----------

/**
 * Rank tier definitions for safety score adjustment.
 * Higher-ranked managers tend to converge on "template" squads,
 * so effective ownership is more concentrated at the top.
 */
export type RankTier = "top10k" | "top50k" | "top100k" | "top500k" | "top1m" | "overall";

export interface SafetyScoreResult {
  safetyScore: number;        // The EO-weighted average score for this rank tier
  rankTier: RankTier;         // Which tier was used
  tierLabel: string;          // Human-readable label
  delta: number;              // livePoints - safetyScore (positive = above safety)
  arrow: "green" | "red" | "neutral";
}

/**
 * Determine rank tier from an estimated or actual rank.
 */
export function getRankTier(rank: number): RankTier {
  if (rank <= 10_000) return "top10k";
  if (rank <= 50_000) return "top50k";
  if (rank <= 100_000) return "top100k";
  if (rank <= 500_000) return "top500k";
  if (rank <= 1_000_000) return "top1m";
  return "overall";
}

const TIER_LABELS: Record<RankTier, string> = {
  top10k: "Top 10K",
  top50k: "Top 50K",
  top100k: "Top 100K",
  top500k: "Top 500K",
  top1m: "Top 1M",
  overall: "Overall",
};

/**
 * Ownership concentration factor per rank tier.
 *
 * At higher ranks, popular players are *more* widely owned, and differentials
 * are less common. We model this by applying an exponent to ownership:
 *   adjustedOwnership = ownership^(1/factor)  for factor > 1 (concentrates toward template)
 *
 * - top10k: highly template-heavy → exponent pushes high-ownership players higher
 * - overall: raw ownership is used as-is
 */
const TIER_CONCENTRATION: Record<RankTier, number> = {
  top10k: 1.8,
  top50k: 1.55,
  top100k: 1.35,
  top500k: 1.18,
  top1m: 1.08,
  overall: 1.0,
};

/**
 * Calculate the Safety Score for a given gameweek.
 *
 * Formula: SafetyScore = sum( playerLivePoints * adjustedOwnership(player) )
 * where adjustedOwnership accounts for rank-tier template concentration.
 *
 * This represents the expected GW score for the "average manager" in your rank
 * bracket. If your live points exceed this, you're likely gaining rank (green arrow).
 *
 * @param liveElements  - All players' live GW stats (from /event/{gw}/live/)
 * @param elements      - Bootstrap elements with ownership data (selected_by_percent)
 * @param rank          - The manager's estimated or actual rank
 * @param captainId     - The most-captained player ID (if known) for EO captain boost (legacy)
 * @param captainCandidates - Multiple captain candidates with weights (preferred over captainId)
 */
export function calculateSafetyScore(
  liveElements: PlayerElement[],
  elements: { id: number; selected_by_percent?: string; element_type?: number }[],
  rank: number,
  captainId?: number,
  captainCandidates?: { id: number; weight: number }[]
): SafetyScoreResult {
  const tier = getRankTier(rank);
  const concentration = TIER_CONCENTRATION[tier];

  // Build ownership lookup
  const ownershipMap = new Map<number, number>();
  for (const el of elements) {
    const pct = parseFloat(el.selected_by_percent || "0");
    ownershipMap.set(el.id, pct);
  }

  // Build captain weight lookup
  const captainWeightMap = new Map<number, number>();
  if (captainCandidates && captainCandidates.length > 0) {
    for (const c of captainCandidates) {
      captainWeightMap.set(c.id, c.weight);
    }
  } else if (captainId) {
    // Legacy single-captain fallback
    captainWeightMap.set(captainId, 1.0);
  }

  // First pass: compute adjusted EO values
  const STARTING_XI = 11;
  const adjustedEoMap = new Map<number, number>();
  let totalAdjustedEo = 0;

  for (const player of liveElements) {
    const rawOwnership = ownershipMap.get(player.id) ?? 0;
    if (rawOwnership <= 0) continue;

    const ownershipFraction = rawOwnership / 100;
    // Apply tier concentration: raise ownership to power 1/concentration
    const adjustedOwnership = Math.pow(ownershipFraction, 1 / concentration);
    adjustedEoMap.set(player.id, adjustedOwnership);
    totalAdjustedEo += adjustedOwnership;
  }

  // Normalize so that total adjusted EO = STARTING_XI (11 players per squad).
  // Without this, concentration inflates every player's EO and the sum
  // balloons past 11, producing an unrealistically high safety score.
  const normFactor = totalAdjustedEo > 0 ? STARTING_XI / totalAdjustedEo : 1;

  // Second pass: compute safety score with normalized EO
  let totalEoPoints = 0;

  for (const player of liveElements) {
    const adjustedOwnership = adjustedEoMap.get(player.id);
    if (!adjustedOwnership) continue;

    const normalizedEo = adjustedOwnership * normFactor;

    // Base contribution: points * normalized EO
    totalEoPoints += player.stats.total_points * normalizedEo;

    // Captain boost: captained players contribute EXTRA points (captain doubles points).
    // Extra = playerPoints * captainWeight * normalizedEo
    const captainWeight = captainWeightMap.get(player.id);
    if (captainWeight && captainWeight > 0) {
      totalEoPoints += player.stats.total_points * captainWeight * normalizedEo;
    }
  }

  const safetyScore = Math.round(totalEoPoints);

  return {
    safetyScore,
    rankTier: tier,
    tierLabel: TIER_LABELS[tier],
    delta: 0, // Caller should set: livePoints - safetyScore
    arrow: "neutral", // Caller should set based on delta
  };
}

/**
 * Full safety score with delta and arrow direction computed.
 */
export function computeSafetyResult(
  livePoints: number,
  liveElements: PlayerElement[],
  elements: { id: number; selected_by_percent?: string; element_type?: number }[],
  rank: number,
  captainId?: number,
  captainCandidates?: { id: number; weight: number }[]
): SafetyScoreResult {
  const result = calculateSafetyScore(liveElements, elements, rank, captainId, captainCandidates);
  const delta = livePoints - result.safetyScore;
  return {
    ...result,
    delta,
    arrow: delta > 0 ? "green" : delta < 0 ? "red" : "neutral",
  };
}

/**
 * Find the most-captained player from bootstrap data.
 * Uses a heuristic: highest (ownership% * form) among premium players (cost >= 7.0).
 */
export function findMostCaptainedPlayer(
  elements: { id: number; selected_by_percent?: string; now_cost?: number; form?: string; element_type?: number }[]
): number | undefined {
  let bestId: number | undefined;
  let bestScore = 0;

  for (const el of elements) {
    const ownership = parseFloat(el.selected_by_percent || "0");
    const form = parseFloat(el.form || "0");
    const cost = (el.now_cost || 0) / 10;

    // Consider mid-to-premium players as captain candidates
    if (cost < 7.0) continue;

    const score = ownership * form;
    if (score > bestScore) {
      bestScore = score;
      bestId = el.id;
    }
  }

  return bestId;
}

/**
 * Find top captain candidates with estimated captaincy weights.
 * Returns up to 3 candidates with weights summing to ~1.0.
 * This better models the reality that captaincy is spread across a few players.
 */
export function findCaptainCandidates(
  elements: { id: number; selected_by_percent?: string; now_cost?: number; form?: string; element_type?: number }[]
): { id: number; weight: number }[] {
  const candidates: { id: number; score: number }[] = [];

  for (const el of elements) {
    const ownership = parseFloat(el.selected_by_percent || "0");
    const form = parseFloat(el.form || "0");
    const cost = (el.now_cost || 0) / 10;
    if (cost < 7.0 || form <= 0) continue;

    candidates.push({ id: el.id, score: ownership * form });
  }

  // Sort by score descending and take top 3
  candidates.sort((a, b) => b.score - a.score);
  const top = candidates.slice(0, 3);
  if (top.length === 0) return [];

  // Convert scores to weights (proportional)
  const totalScore = top.reduce((sum, c) => sum + c.score, 0);
  return top.map((c) => ({ id: c.id, weight: c.score / totalScore }));
}

// ---------- Enriched pick data for UI ----------

export interface EnrichedPick {
  element: number;
  position: number;
  multiplier: number;
  isCaptain: boolean;
  isViceCaptain: boolean;
  webName: string;
  teamId: number;
  elementType: number;
  points: number;
  minutes: number;
  isPlaying: boolean;
  isFinished: boolean;
}

export function enrichPicks(
  picks: Pick[],
  liveElements: PlayerElement[],
  elements: BootstrapElement[],
  fixtures?: FixtureInfo[]
): EnrichedPick[] {
  return picks.map((pick) => {
    const live = liveElements.find((el) => el.id === pick.element);
    const element = elements.find((e) => e.id === pick.element);
    const minutes = live?.stats.minutes ?? 0;

    return {
      element: pick.element,
      position: pick.position,
      multiplier: pick.multiplier,
      isCaptain: pick.is_captain,
      isViceCaptain: pick.is_vice_captain,
      webName: element?.web_name ?? `#${pick.element}`,
      teamId: element?.team ?? 0,
      elementType: element?.element_type ?? 0,
      points: live?.stats.total_points ?? 0,
      minutes,
      isPlaying: minutes > 0,
      isFinished: minutes > 0, // simplified; ideally check fixture status
    };
  });
}
