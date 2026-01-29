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

// ---------- Formation helpers ----------

const POSITION_ORDER = [1, 2, 3, 4]; // GKP, DEF, MID, FWD

function getElementType(
  elementId: number,
  elements: BootstrapElement[]
): number {
  return elements.find((e) => e.id === elementId)?.element_type ?? 0;
}

function isValidFormation(lineup: { elementType: number }[]): boolean {
  const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const p of lineup) counts[p.elementType] = (counts[p.elementType] || 0) + 1;
  // Valid: exactly 1 GKP, 3-5 DEF, 2-5 MID, 1-3 FWD, total=11
  return (
    counts[1] === 1 &&
    counts[2] >= 3 && counts[2] <= 5 &&
    counts[3] >= 2 && counts[3] <= 5 &&
    counts[4] >= 1 && counts[4] <= 3 &&
    lineup.length === 11
  );
}

// ---------- Auto-sub logic ----------

export function applyAutoSubs(
  picks: Pick[],
  liveElements: PlayerElement[],
  elements: BootstrapElement[]
): Pick[] {
  const result = picks.map((p) => ({ ...p }));
  const starting = result.filter((p) => p.position <= 11);
  const bench = result
    .filter((p) => p.position > 11)
    .sort((a, b) => a.position - b.position);

  // Find starters who didn't play (0 minutes)
  const didNotPlay = starting.filter((p) => {
    const live = liveElements.find((el) => el.id === p.element);
    return !live || live.stats.minutes === 0;
  });

  for (const outPlayer of didNotPlay) {
    // Skip captain — captain never gets subbed out (VC takes multiplier instead)
    if (outPlayer.is_captain) continue;

    const outType = getElementType(outPlayer.element, elements);

    for (const benchPlayer of bench) {
      if (benchPlayer.multiplier > 0) continue; // Already subbed in

      const benchLive = liveElements.find((el) => el.id === benchPlayer.element);
      if (!benchLive || benchLive.stats.minutes === 0) continue;

      const benchType = getElementType(benchPlayer.element, elements);

      // Try the sub: swap types in the lineup and check formation validity
      const testLineup = starting
        .filter((p) => p.element !== outPlayer.element)
        .map((p) => ({
          elementType: getElementType(p.element, elements),
        }));
      testLineup.push({ elementType: benchType });

      if (isValidFormation(testLineup)) {
        // Apply sub
        benchPlayer.multiplier = outPlayer.multiplier;
        benchPlayer.position = outPlayer.position;
        outPlayer.multiplier = 0;
        outPlayer.position = 15; // Moved to bench conceptually
        break;
      }
    }
  }

  return result;
}

// ---------- AI Optimization Engine ----------

export interface OptimizationResult {
  optimizedPoints: number;
  actualPoints: number;
  pointsLeftOnTable: number;
  bestCaptainId: number | null;
  bestCaptainPoints: number;
  actualCaptainId: number | null;
  actualCaptainPoints: number;
  changes: string[];
}

export function calculateOptimizedSquad(
  picks: Pick[],
  liveElements: PlayerElement[],
  elements: BootstrapElement[]
): OptimizationResult {
  const changes: string[] = [];

  // Step 1: Apply auto-subs first
  const subsApplied = applyAutoSubs(picks, liveElements, elements);

  // Step 2: Find the best possible lineup from all 15 players
  const allPlayers = picks.map((p) => {
    const live = liveElements.find((el) => el.id === p.element);
    const element = elements.find((e) => e.id === p.element);
    return {
      ...p,
      points: live?.stats.total_points ?? 0,
      minutes: live?.stats.minutes ?? 0,
      elementType: element?.element_type ?? 0,
      webName: element?.web_name ?? `#${p.element}`,
    };
  });

  // Find optimal 11 with valid formation
  const bestLineup = findBestValidLineup(allPlayers);

  // Step 3: Pick best captain from optimal lineup
  const bestCaptain = bestLineup.reduce(
    (best, p) => (p.points > best.points ? p : best),
    bestLineup[0]
  );

  // Step 4: Calculate optimized points
  let optimizedPoints = 0;
  for (const p of bestLineup) {
    if (p.element === bestCaptain.element) {
      optimizedPoints += p.points * 2; // Captain gets 2x
    } else {
      optimizedPoints += p.points;
    }
  }

  // Step 5: Calculate actual points
  const actualPoints = calculateLivePoints(subsApplied, liveElements);

  // Step 6: Identify actual captain
  const actualCaptain = picks.find((p) => p.is_captain);
  const actualCaptainLive = actualCaptain
    ? liveElements.find((el) => el.id === actualCaptain.element)
    : null;

  // Step 7: Generate change descriptions
  const originalStartingIds = new Set(
    picks.filter((p) => p.position <= 11).map((p) => p.element)
  );
  const optimalStartingIds = new Set(bestLineup.map((p) => p.element));

  for (const p of bestLineup) {
    if (!originalStartingIds.has(p.element)) {
      changes.push(`Sub in ${p.webName} (+${p.points} pts)`);
    }
  }

  if (actualCaptain && bestCaptain.element !== actualCaptain.element) {
    changes.push(
      `Captain ${bestCaptain.webName} instead of ${
        allPlayers.find((p) => p.element === actualCaptain.element)?.webName
      }`
    );
  }

  return {
    optimizedPoints,
    actualPoints,
    pointsLeftOnTable: optimizedPoints - actualPoints,
    bestCaptainId: bestCaptain.element,
    bestCaptainPoints: bestCaptain.points,
    actualCaptainId: actualCaptain?.element ?? null,
    actualCaptainPoints: actualCaptainLive?.stats.total_points ?? 0,
    changes,
  };
}

interface PlayerWithStats {
  element: number;
  position: number;
  multiplier: number;
  is_captain: boolean;
  is_vice_captain: boolean;
  points: number;
  minutes: number;
  elementType: number;
  webName: string;
}

function findBestValidLineup(allPlayers: PlayerWithStats[]): PlayerWithStats[] {
  // Group by position type
  const byType: Record<number, PlayerWithStats[]> = { 1: [], 2: [], 3: [], 4: [] };
  for (const p of allPlayers) {
    if (byType[p.elementType]) byType[p.elementType].push(p);
  }

  // Sort each position by points descending
  for (const type of POSITION_ORDER) {
    byType[type].sort((a, b) => b.points - a.points);
  }

  // Try all valid formation combinations and pick highest scoring
  const formations = [
    [1, 3, 5, 2], // 3-5-2
    [1, 3, 4, 3], // 3-4-3
    [1, 4, 4, 2], // 4-4-2
    [1, 4, 3, 3], // 4-3-3
    [1, 4, 5, 1], // 4-5-1
    [1, 5, 4, 1], // 5-4-1
    [1, 5, 3, 2], // 5-3-2
    [1, 5, 2, 3], // 5-2-3
    [1, 3, 2, 5], // invalid but handles edge
  ];

  let bestTotal = -1;
  let bestLineup: PlayerWithStats[] = [];

  for (const [gkp, def, mid, fwd] of formations) {
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

    if (lineup.length !== 11) continue;

    const total = lineup.reduce((sum, p) => sum + p.points, 0);
    if (total > bestTotal) {
      bestTotal = total;
      bestLineup = lineup;
    }
  }

  return bestLineup;
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
