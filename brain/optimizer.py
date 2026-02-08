"""
FPL Transfer Optimization Brain — MILP Solver
===============================================
Uses PuLP to solve a Multi-Period Mixed-Integer Linear Programming problem
that maximizes expected points over a rolling horizon while respecting
FPL squad, budget, and team constraints.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

import pulp


# ---------- Data Structures ----------


@dataclass
class Player:
    id: int
    web_name: str
    team_id: int
    position: int  # 1=GKP, 2=DEF, 3=MID, 4=FWD
    now_cost: int  # price in 0.1m units (e.g. 100 = £10.0m)
    selling_price: int  # what you'd get if you sold (may differ from now_cost)
    ownership_pct: float
    form: float
    xp_by_gw: Dict[int, float] = field(default_factory=dict)  # gw -> xP
    actual_points_last_5: float = 0.0
    xp_last_5: float = 0.0
    status: str = "a"  # a=available, d=doubtful, i=injured, etc.


@dataclass
class SquadState:
    """Current squad state before optimization."""

    players: List[Player]  # 15 current squad members
    bank: int  # remaining budget in 0.1m units
    free_transfers: int  # 1 or 2
    gameweek: int  # current GW


@dataclass
class TransferSuggestion:
    player_out: Player
    player_in: Player
    xp_gain: float  # net xP gain over the horizon


@dataclass
class OptimizationResult:
    suggested_squad: List[Player]
    transfers_out: List[Player]
    transfers_in: List[Player]
    starting_xi: List[Player]
    bench: List[Player]
    captain_id: int
    vice_captain_id: int
    total_xp: float
    transfer_cost: int  # points deducted for hits
    net_xp: float  # total_xp - transfer_cost
    horizon: int


# ---------- Constants ----------

POSITION_LIMITS = {1: 2, 2: 5, 3: 5, 4: 3}  # GKP, DEF, MID, FWD
STARTING_LIMITS_MIN = {1: 1, 2: 3, 3: 2, 4: 1}
STARTING_LIMITS_MAX = {1: 1, 2: 5, 3: 5, 4: 3}
MAX_PER_TEAM = 3
SQUAD_SIZE = 15
STARTING_XI = 11
BENCH_SIZE = 4
HIT_COST = 4  # points per extra transfer
BENCH_WEIGHT = 0.1  # bench points contribute at 10%


# ---------- Core Solver ----------


def optimize_transfers(
    current_squad: SquadState,
    all_players: List[Player],
    horizon: int = 5,
    gamma: float = 0.85,
    max_transfers: int = 3,
) -> OptimizationResult:
    """
    Solve the MILP transfer optimization problem.

    Maximizes:
        Z = Σ_t Σ_p (xP_p,t · x_p,t · γ^t) - TransferCost

    Subject to:
        - Budget constraint
        - Squad composition (2 GKP, 5 DEF, 5 MID, 3 FWD)
        - Max 3 per team
        - Valid starting XI formation
        - Transfer limits and hit costs
    """

    # Build player lookup
    current_ids = {p.id for p in current_squad.players}
    player_map = {p.id: p for p in all_players}

    # Ensure current squad players are in the pool
    for p in current_squad.players:
        if p.id not in player_map:
            player_map[p.id] = p

    all_ids = list(player_map.keys())

    # ---------- Problem ----------
    prob = pulp.LpProblem("FPL_Transfer_Optimizer", pulp.LpMaximize)

    # ---------- Decision Variables ----------

    # x[p] = 1 if player p is in the new squad
    x = {pid: pulp.LpVariable(f"squad_{pid}", cat="Binary") for pid in all_ids}

    # s[p] = 1 if player p is in the starting XI
    s = {pid: pulp.LpVariable(f"start_{pid}", cat="Binary") for pid in all_ids}

    # t_out[p] = 1 if player p is transferred OUT (was in squad, now isn't)
    t_out = {
        pid: pulp.LpVariable(f"tout_{pid}", cat="Binary")
        for pid in all_ids
        if pid in current_ids
    }

    # t_in[p] = 1 if player p is transferred IN (wasn't in squad, now is)
    t_in = {
        pid: pulp.LpVariable(f"tin_{pid}", cat="Binary")
        for pid in all_ids
        if pid not in current_ids
    }

    # cap[p] = 1 if player p is captain (gets 2x points)
    cap = {pid: pulp.LpVariable(f"cap_{pid}", cat="Binary") for pid in all_ids}

    # ---------- Objective Function ----------
    # Maximize expected points over the horizon with time decay

    obj_terms = []

    for pid in all_ids:
        player = player_map[pid]

        # Sum xP across the horizon with decay
        total_weighted_xp = 0.0
        for t in range(1, horizon + 1):
            gw = current_squad.gameweek + t
            xp_gw = player.xp_by_gw.get(gw, _estimate_xp(player))
            decay = gamma ** t
            total_weighted_xp += xp_gw * decay

        # Starter gets full weight, bench gets BENCH_WEIGHT
        obj_terms.append(total_weighted_xp * s[pid])
        obj_terms.append(total_weighted_xp * BENCH_WEIGHT * (x[pid] - s[pid]))

        # Captain bonus: extra 1x points for captain (already counted once in starter)
        obj_terms.append(total_weighted_xp * cap[pid])

    # Subtract transfer hit cost
    num_transfers_out = pulp.lpSum(t_out[pid] for pid in t_out)
    free = current_squad.free_transfers
    # hits = max(0, num_transfers - free_transfers)
    # We model this with an auxiliary variable
    hits = pulp.LpVariable("hits", lowBound=0, cat="Integer")
    prob += hits >= num_transfers_out - free
    prob += hits >= 0

    obj_terms.append(-HIT_COST * hits)

    prob += pulp.lpSum(obj_terms), "Objective"

    # ---------- Constraints ----------

    # 1. Squad size = 15
    prob += pulp.lpSum(x[pid] for pid in all_ids) == SQUAD_SIZE, "SquadSize"

    # 2. Position limits (exactly 2 GKP, 5 DEF, 5 MID, 3 FWD)
    for pos, count in POSITION_LIMITS.items():
        prob += (
            pulp.lpSum(x[pid] for pid in all_ids if player_map[pid].position == pos)
            == count,
            f"PosLimit_{pos}",
        )

    # 3. Max 3 per team
    team_ids = set(p.team_id for p in player_map.values())
    for tid in team_ids:
        prob += (
            pulp.lpSum(x[pid] for pid in all_ids if player_map[pid].team_id == tid)
            <= MAX_PER_TEAM,
            f"TeamLimit_{tid}",
        )

    # 4. Budget constraint
    # Budget available = bank + selling_price of transferred out players
    # Cost = sum of now_cost for new squad
    # We need: cost_of_new_squad <= bank + selling_price_of_outs
    selling_value = pulp.lpSum(
        player_map[pid].selling_price * t_out[pid] for pid in t_out
    )
    buying_cost = pulp.lpSum(
        player_map[pid].now_cost * t_in[pid] for pid in t_in
    )
    # Players kept have no cost change
    prob += buying_cost <= current_squad.bank + selling_value, "Budget"

    # 5. Starting XI = 11
    prob += pulp.lpSum(s[pid] for pid in all_ids) == STARTING_XI, "StartingXI"

    # 6. Starters must be in squad
    for pid in all_ids:
        prob += s[pid] <= x[pid], f"StartInSquad_{pid}"

    # 7. Starting XI formation constraints
    for pos, min_count in STARTING_LIMITS_MIN.items():
        prob += (
            pulp.lpSum(s[pid] for pid in all_ids if player_map[pid].position == pos)
            >= min_count,
            f"StartMin_{pos}",
        )
    for pos, max_count in STARTING_LIMITS_MAX.items():
        prob += (
            pulp.lpSum(s[pid] for pid in all_ids if player_map[pid].position == pos)
            <= max_count,
            f"StartMax_{pos}",
        )

    # 8. Exactly one GKP starts
    prob += (
        pulp.lpSum(s[pid] for pid in all_ids if player_map[pid].position == 1) == 1,
        "OneGKPStart",
    )

    # 9. Captain constraints
    prob += pulp.lpSum(cap[pid] for pid in all_ids) == 1, "OneCaptain"
    for pid in all_ids:
        prob += cap[pid] <= s[pid], f"CaptainStarts_{pid}"

    # 10. Transfer linking constraints
    for pid in current_ids:
        if pid in t_out:
            # If was in squad: x[pid] = 1 - t_out[pid]
            prob += x[pid] == 1 - t_out[pid], f"TransferOut_{pid}"

    for pid in all_ids:
        if pid not in current_ids and pid in t_in:
            # If wasn't in squad: x[pid] = t_in[pid]
            prob += x[pid] == t_in[pid], f"TransferIn_{pid}"

    # 11. Max transfers cap (practical limit to keep solver fast)
    prob += num_transfers_out <= max_transfers, "MaxTransfers"

    # 12. Only consider available/doubtful players for transfers in
    for pid in t_in:
        p = player_map[pid]
        if p.status in ("i", "u", "s", "n"):
            prob += t_in[pid] == 0, f"Unavailable_{pid}"

    # ---------- Solve ----------
    solver = pulp.PULP_CBC_CMD(msg=0, timeLimit=30)
    prob.solve(solver)

    if prob.status != pulp.constants.LpStatusOptimal:
        # Fallback: return current squad unchanged
        return _fallback_result(current_squad, horizon)

    # ---------- Extract Solution ----------
    new_squad = [player_map[pid] for pid in all_ids if x[pid].varValue and x[pid].varValue > 0.5]
    starters = [player_map[pid] for pid in all_ids if s[pid].varValue and s[pid].varValue > 0.5]
    bench = [p for p in new_squad if p not in starters]
    captain = next(
        (player_map[pid] for pid in all_ids if cap[pid].varValue and cap[pid].varValue > 0.5),
        starters[0] if starters else new_squad[0],
    )

    transfers_out_list = [
        player_map[pid]
        for pid in t_out
        if t_out[pid].varValue and t_out[pid].varValue > 0.5
    ]
    transfers_in_list = [
        player_map[pid]
        for pid in t_in
        if t_in[pid].varValue and t_in[pid].varValue > 0.5
    ]

    num_hits = max(0, len(transfers_out_list) - current_squad.free_transfers)
    transfer_cost = num_hits * HIT_COST

    # Calculate total xP
    total_xp = 0.0
    for p in starters:
        for t in range(1, horizon + 1):
            gw = current_squad.gameweek + t
            xp_gw = p.xp_by_gw.get(gw, _estimate_xp(p))
            total_xp += xp_gw * (gamma ** t)
            if p.id == captain.id:
                total_xp += xp_gw * (gamma ** t)  # captain bonus

    for p in bench:
        for t in range(1, horizon + 1):
            gw = current_squad.gameweek + t
            xp_gw = p.xp_by_gw.get(gw, _estimate_xp(p))
            total_xp += xp_gw * BENCH_WEIGHT * (gamma ** t)

    # Vice captain = second highest xP starter
    starters_by_xp = sorted(
        starters,
        key=lambda p: sum(p.xp_by_gw.get(current_squad.gameweek + t, _estimate_xp(p)) for t in range(1, horizon + 1)),
        reverse=True,
    )
    vice_captain = starters_by_xp[1] if len(starters_by_xp) > 1 else captain

    return OptimizationResult(
        suggested_squad=new_squad,
        transfers_out=transfers_out_list,
        transfers_in=transfers_in_list,
        starting_xi=starters,
        bench=bench,
        captain_id=captain.id,
        vice_captain_id=vice_captain.id,
        total_xp=round(total_xp, 1),
        transfer_cost=transfer_cost,
        net_xp=round(total_xp - transfer_cost, 1),
        horizon=horizon,
    )


# ---------- Helpers ----------


def _estimate_xp(player: Player) -> float:
    """Fallback xP estimate when per-GW projections are missing."""
    if player.xp_by_gw:
        return sum(player.xp_by_gw.values()) / len(player.xp_by_gw)
    # Use form as a rough proxy
    return max(player.form, 2.0)


def _fallback_result(squad: SquadState, horizon: int) -> OptimizationResult:
    """Return unchanged squad when solver fails."""
    starters = sorted(squad.players, key=lambda p: p.form, reverse=True)[:11]
    bench = [p for p in squad.players if p not in starters]
    best = max(starters, key=lambda p: p.form)
    second = sorted(starters, key=lambda p: p.form, reverse=True)[1]
    return OptimizationResult(
        suggested_squad=squad.players,
        transfers_out=[],
        transfers_in=[],
        starting_xi=starters,
        bench=bench,
        captain_id=best.id,
        vice_captain_id=second.id,
        total_xp=0.0,
        transfer_cost=0,
        net_xp=0.0,
        horizon=horizon,
    )


# ---------- Quick Evaluation (no solver, for API speed) ----------


def quick_transfer_suggestions(
    current_squad: SquadState,
    all_players: List[Player],
    horizon: int = 5,
    gamma: float = 0.85,
    top_n: int = 5,
) -> List[TransferSuggestion]:
    """
    Fast heuristic transfer suggestions without full MILP.
    Useful for real-time API responses.

    For each squad player, find the best replacement at the same position
    within budget, ranked by xP gain.
    """
    current_ids = {p.id for p in current_squad.players}
    suggestions: List[TransferSuggestion] = []

    for squad_player in current_squad.players:
        budget_available = current_squad.bank + squad_player.selling_price

        # Find candidates at same position, affordable, not in squad
        candidates = [
            p
            for p in all_players
            if p.position == squad_player.position
            and p.id not in current_ids
            and p.now_cost <= budget_available
            and p.status in ("a", "d")
        ]

        # Check team limit: can't have >3 from same team after swap
        team_counts: Dict[int, int] = {}
        for sp in current_squad.players:
            if sp.id != squad_player.id:
                team_counts[sp.team_id] = team_counts.get(sp.team_id, 0) + 1

        valid_candidates = [
            c for c in candidates if team_counts.get(c.team_id, 0) < MAX_PER_TEAM
        ]

        for candidate in valid_candidates:
            # Calculate xP gain over horizon with decay
            gain = 0.0
            for t in range(1, horizon + 1):
                gw = current_squad.gameweek + t
                decay = gamma ** t
                xp_in = candidate.xp_by_gw.get(gw, _estimate_xp(candidate))
                xp_out = squad_player.xp_by_gw.get(gw, _estimate_xp(squad_player))
                gain += (xp_in - xp_out) * decay

            if gain > 0:
                suggestions.append(
                    TransferSuggestion(
                        player_out=squad_player,
                        player_in=candidate,
                        xp_gain=round(gain, 1),
                    )
                )

    # Sort by xP gain descending, return top N
    suggestions.sort(key=lambda s: s.xp_gain, reverse=True)
    return suggestions[:top_n]
