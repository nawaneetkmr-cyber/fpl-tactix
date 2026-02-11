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
  // FPL scores roughly follow normal distribution with std dev ~ 12-15 points
  const stdDev = 13;
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
  top10k: 1.35,
  top50k: 1.25,
  top100k: 1.15,
  top500k: 1.08,
  top1m: 1.04,
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
 * @param captainId     - The most-captained player ID (if known) for EO captain boost
 */
export function calculateSafetyScore(
  liveElements: PlayerElement[],
  elements: { id: number; selected_by_percent?: string; element_type?: number }[],
  rank: number,
  captainId?: number
): SafetyScoreResult {
  const tier = getRankTier(rank);
  const concentration = TIER_CONCENTRATION[tier];

  // Build ownership lookup
  const ownershipMap = new Map<number, number>();
  for (const el of elements) {
    const pct = parseFloat(el.selected_by_percent || "0");
    ownershipMap.set(el.id, pct);
  }

  let totalEoPoints = 0;

  for (const player of liveElements) {
    const rawOwnership = ownershipMap.get(player.id) ?? 0;
    if (rawOwnership <= 0) continue;

    const ownershipFraction = rawOwnership / 100;

    // Apply tier concentration: raise ownership to power 1/concentration
    // This makes high-ownership players even more dominant at top ranks
    const adjustedOwnership = Math.pow(ownershipFraction, 1 / concentration);

    let points = player.stats.total_points;

    // Captain boost: the most-captained player gets ~2x effective ownership
    // since many managers captain them (approximate 60-80% captain rate for top pick)
    if (captainId && player.id === captainId) {
      // Model: top-captained player contributes extra points from captaincy
      // At top ranks, captain convergence is higher
      const captainMultiplier = tier === "top10k" ? 0.7 : tier === "top50k" ? 0.6 : 0.5;
      points += player.stats.total_points * captainMultiplier * adjustedOwnership;
    }

    totalEoPoints += points * adjustedOwnership;
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
  captainId?: number
): SafetyScoreResult {
  const result = calculateSafetyScore(liveElements, elements, rank, captainId);
  const delta = livePoints - result.safetyScore;
  return {
    ...result,
    delta,
    arrow: delta > 0 ? "green" : delta < 0 ? "red" : "neutral",
  };
}

/**
 * Find the most-captained player from bootstrap data.
 * Uses a heuristic: highest (ownership% * form * points_per_game) among premium players.
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

    // Only consider premium players (cost > 8.0) as captain candidates
    if (cost < 8.0) continue;

    // Captain score: ownership * form (popular + in-form = likely captained)
    const score = ownership * form;
    if (score > bestScore) {
      bestScore = score;
      bestId = el.id;
    }
  }

  return bestId;
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
