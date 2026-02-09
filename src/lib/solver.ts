/**
 * FPL Transfer Optimization Solver — Pure TypeScript
 * ===================================================
 * Brute-force enumeration solver for 0–2 transfers.
 * Replaces the Python MILP solver so it runs on Vercel (no Python).
 *
 * For 1-2 transfers the search space is small enough:
 *   - 0 transfers: just optimize lineup
 *   - 1 transfer: 15 out × ~40 in = 600 combos
 *   - 2 transfers: 105 out-pairs × ~40×40 in-pairs ≈ 168K (filtered fast)
 */

// ---------- Types ----------

export interface SolverPlayer {
  id: number;
  name: string;
  team: string;
  position: string; // GK, DEF, MID, FWD
  now_cost: number; // £m
  selling_price: number; // £m
  xP: number;
  ownership_percent: number;
  in_current_squad: boolean;
  is_current_starter: boolean;
}

export interface SolverInput {
  players: SolverPlayer[];
  bank: number;
  free_transfers: number;
}

export interface SolverResult {
  status: string;
  transfers_in: SolverPlayer[];
  transfers_out: SolverPlayer[];
  starters: SolverPlayer[];
  bench: SolverPlayer[];
  captain: SolverPlayer | null;
  total_xp: number;
  hit_cost: number;
  net_xp: number;
  current_team_xp: number;
  net_improvement: number;
  budget_used: number;
  budget_available: number;
  should_roll: boolean;
  safety_score: number;
}

// ---------- Constants ----------

const POS_LIMITS: Record<string, number> = { GK: 2, DEF: 5, MID: 5, FWD: 3 };
const STARTING_MIN: Record<string, number> = { GK: 1, DEF: 3, MID: 2, FWD: 1 };
const STARTING_MAX: Record<string, number> = { GK: 1, DEF: 5, MID: 5, FWD: 3 };
const MAX_PER_CLUB = 3;
const SQUAD_SIZE = 15;
const STARTING_XI = 11;
const HIT_COST = 4;
const BENCH_WEIGHT = 0.1;
const INERTIA_THRESHOLD = 2.0;
const EPSILON = 1e-5;

// ---------- Lineup Optimizer ----------

/**
 * Given a 15-player squad, find the best valid starting XI + bench + captain.
 * Returns { starters, bench, captain, totalXp }.
 */
function optimizeLineup(squad: SolverPlayer[]): {
  starters: SolverPlayer[];
  bench: SolverPlayer[];
  captain: SolverPlayer;
  totalXp: number;
} {
  // Group by position
  const byPos: Record<string, SolverPlayer[]> = { GK: [], DEF: [], MID: [], FWD: [] };
  for (const p of squad) {
    byPos[p.position]?.push(p);
  }
  // Sort each position by xP descending
  for (const pos of Object.keys(byPos)) {
    byPos[pos].sort((a, b) => b.xP - a.xP);
  }

  // Start with minimum formation: 1 GK, 3 DEF, 2 MID, 1 FWD = 7
  // Fill remaining 4 slots with highest xP players from eligible positions
  const starters: SolverPlayer[] = [];
  const used = new Set<number>();

  // Pick minimums
  for (const pos of ["GK", "DEF", "MID", "FWD"] as const) {
    const min = STARTING_MIN[pos];
    for (let i = 0; i < min && i < byPos[pos].length; i++) {
      starters.push(byPos[pos][i]);
      used.add(byPos[pos][i].id);
    }
  }

  // Fill remaining slots (11 - 7 = 4) from best available outfield players
  const remaining = STARTING_XI - starters.length;
  const candidates: SolverPlayer[] = [];
  for (const pos of ["DEF", "MID", "FWD"] as const) {
    const max = STARTING_MAX[pos];
    const alreadyPicked = starters.filter((s) => s.position === pos).length;
    for (let i = alreadyPicked; i < max && i < byPos[pos].length; i++) {
      if (!used.has(byPos[pos][i].id)) {
        candidates.push(byPos[pos][i]);
      }
    }
  }
  candidates.sort((a, b) => b.xP - a.xP);
  for (let i = 0; i < remaining && i < candidates.length; i++) {
    starters.push(candidates[i]);
    used.add(candidates[i].id);
  }

  const bench = squad.filter((p) => !used.has(p.id));

  // Captain = highest xP starter
  const captain = [...starters].sort((a, b) => b.xP - a.xP)[0];

  // Total xP: starters + bench * weight + captain bonus
  const starterXp = starters.reduce((s, p) => s + p.xP, 0);
  const benchXp = bench.reduce((s, p) => s + p.xP * BENCH_WEIGHT, 0);
  const capXp = captain?.xP ?? 0;
  const totalXp = starterXp + benchXp + capXp;

  return { starters, bench, captain, totalXp };
}

// ---------- Squad Validation ----------

function isValidSquad(squad: SolverPlayer[]): boolean {
  if (squad.length !== SQUAD_SIZE) return false;

  // Position counts
  const posCounts: Record<string, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  const clubCounts: Record<string, number> = {};

  for (const p of squad) {
    posCounts[p.position] = (posCounts[p.position] ?? 0) + 1;
    clubCounts[p.team] = (clubCounts[p.team] ?? 0) + 1;
  }

  // Check position limits
  for (const [pos, limit] of Object.entries(POS_LIMITS)) {
    if ((posCounts[pos] ?? 0) !== limit) return false;
  }

  // Check club limits
  for (const count of Object.values(clubCounts)) {
    if (count > MAX_PER_CLUB) return false;
  }

  return true;
}

// ---------- Main Solver ----------

export function solveFplTransfers(input: SolverInput): SolverResult {
  const { players, bank, free_transfers } = input;

  const currentSquad = players.filter((p) => p.in_current_squad);
  const targets = players.filter((p) => !p.in_current_squad);
  const currentSquadIds = new Set(currentSquad.map((p) => p.id));

  // Baseline: current team optimized lineup (0 transfers)
  const baseline = optimizeLineup(currentSquad);
  const currentTeamXp = Math.round(baseline.totalXp * 10) / 10;

  // Track best result
  let bestNetXp = baseline.totalXp;
  let bestSquad = currentSquad;
  let bestTransfersOut: SolverPlayer[] = [];
  let bestTransfersIn: SolverPlayer[] = [];
  let bestHitCost = 0;

  // Club counts for current squad
  const currentClubCounts: Record<string, number> = {};
  for (const p of currentSquad) {
    currentClubCounts[p.team] = (currentClubCounts[p.team] ?? 0) + 1;
  }

  // --- Try 1 transfer ---
  for (const out of currentSquad) {
    for (const inp of targets) {
      // Must be same position
      if (inp.position !== out.position) continue;

      // Budget check: bank + selling_price >= buying_cost
      if (bank + out.selling_price < inp.now_cost - EPSILON) continue;

      // Club limit: after removing out and adding inp
      const clubDelta: Record<string, number> = { ...currentClubCounts };
      clubDelta[out.team] = (clubDelta[out.team] ?? 0) - 1;
      clubDelta[inp.team] = (clubDelta[inp.team] ?? 0) + 1;
      if ((clubDelta[inp.team] ?? 0) > MAX_PER_CLUB) continue;

      // Build new squad
      const newSquad = currentSquad.filter((p) => p.id !== out.id).concat(inp);
      if (!isValidSquad(newSquad)) continue;

      const result = optimizeLineup(newSquad);
      const hits = Math.max(0, 1 - free_transfers);
      const netXp = result.totalXp - hits * HIT_COST;

      if (netXp > bestNetXp) {
        bestNetXp = netXp;
        bestSquad = newSquad;
        bestTransfersOut = [out];
        bestTransfersIn = [inp];
        bestHitCost = hits * HIT_COST;
      }
    }
  }

  // --- Try 2 transfers (only if we have reason to) ---
  // Only try double transfers if single transfer found improvement OR we have 2 FT
  if (free_transfers >= 2 || bestTransfersOut.length > 0) {
    for (let i = 0; i < currentSquad.length; i++) {
      for (let j = i + 1; j < currentSquad.length; j++) {
        const out1 = currentSquad[i];
        const out2 = currentSquad[j];
        const totalSelling = bank + out1.selling_price + out2.selling_price;

        // Pre-filter targets by position
        const targets1 = targets.filter((t) => t.position === out1.position);
        const targets2 = targets.filter((t) => t.position === out2.position);

        for (const in1 of targets1) {
          // Early budget check
          if (in1.now_cost > totalSelling) continue;
          const remainingBudget = totalSelling - in1.now_cost;

          for (const in2 of targets2) {
            if (in2.id === in1.id) continue;
            if (in2.now_cost > remainingBudget + EPSILON) continue;

            // Club limits
            const clubDelta: Record<string, number> = { ...currentClubCounts };
            clubDelta[out1.team] = (clubDelta[out1.team] ?? 0) - 1;
            clubDelta[out2.team] = (clubDelta[out2.team] ?? 0) - 1;
            clubDelta[in1.team] = (clubDelta[in1.team] ?? 0) + 1;
            clubDelta[in2.team] = (clubDelta[in2.team] ?? 0) + 1;
            if ((clubDelta[in1.team] ?? 0) > MAX_PER_CLUB) continue;
            if ((clubDelta[in2.team] ?? 0) > MAX_PER_CLUB) continue;

            const newSquad = currentSquad
              .filter((p) => p.id !== out1.id && p.id !== out2.id)
              .concat(in1, in2);

            if (!isValidSquad(newSquad)) continue;

            const result = optimizeLineup(newSquad);
            const hits = Math.max(0, 2 - free_transfers);
            const netXp = result.totalXp - hits * HIT_COST;

            if (netXp > bestNetXp) {
              bestNetXp = netXp;
              bestSquad = newSquad;
              bestTransfersOut = [out1, out2];
              bestTransfersIn = [in1, in2];
              bestHitCost = hits * HIT_COST;
            }
          }
        }
      }
    }
  }

  // Optimize final lineup
  const finalLineup = optimizeLineup(bestSquad);
  const totalXp = Math.round(finalLineup.totalXp * 10) / 10;
  const netXp = Math.round((totalXp - bestHitCost) * 10) / 10;
  const netImprovement = Math.round((netXp - currentTeamXp) * 10) / 10;
  const shouldRoll = netImprovement < INERTIA_THRESHOLD && bestTransfersOut.length > 0;

  const budgetUsed = Math.round(bestTransfersIn.reduce((s, p) => s + p.now_cost, 0) * 10) / 10;
  const budgetAvailable = Math.round(
    (bank + bestTransfersOut.reduce((s, p) => s + p.selling_price, 0)) * 10
  ) / 10;

  // Safety score: sum(xP * ownership%) for all players with xP > 0
  // This approximates "average manager's expected score" — the green-arrow threshold
  const safetyScore = Math.round(
    players
      .filter((p) => p.xP > 0)
      .reduce((s, p) => s + p.xP * (p.ownership_percent / 100), 0) * 10
  ) / 10;

  return {
    status: "Optimal",
    transfers_in: bestTransfersIn,
    transfers_out: bestTransfersOut,
    starters: finalLineup.starters,
    bench: finalLineup.bench,
    captain: finalLineup.captain,
    total_xp: totalXp,
    hit_cost: bestHitCost,
    net_xp: netXp,
    current_team_xp: currentTeamXp,
    net_improvement: netImprovement,
    budget_used: budgetUsed,
    budget_available: budgetAvailable,
    should_roll: shouldRoll,
    safety_score: safetyScore,
  };
}
