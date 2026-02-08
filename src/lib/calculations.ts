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
