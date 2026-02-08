"""
FPL Transfer Optimization Brain — Production-Grade MILP Solver
===============================================================
Solves a Mixed-Integer Linear Programming problem to recommend optimal
FPL transfers. Properly accounts for:

  - Bench weighting (0.1x) to avoid wasting budget on bench players
  - Budget via selling_price (50% profit tax already applied)
  - Squad structure (2 GK, 5 DEF, 5 MID, 3 FWD, max 3/club)
  - Transfer hit costs (-4 per extra transfer beyond free transfers)
  - Captaincy (2x points for best starter)
  - Inertia threshold (skip if net gain < 2.0 points)

Usage:
    python optimizer.py
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set, Tuple

import pulp


# ╔══════════════════════════════════════════════════════════════════╗
# ║  MODULE 1 — DATA STRUCTURES & MOCK DATA                        ║
# ╚══════════════════════════════════════════════════════════════════╝


@dataclass
class Player:
    id: int
    name: str
    team: str
    position: str  # GK, DEF, MID, FWD
    now_cost: float  # current price in £m
    selling_price: float  # what you'd get if sold (accounts for 50% profit tax)
    xP: float  # expected points for next GW
    ownership_percent: float
    in_current_squad: bool = False
    is_current_starter: bool = False


@dataclass
class UserState:
    bank: float  # remaining budget in £m
    free_transfers: int
    current_squad_ids: Set[int] = field(default_factory=set)


# Position requirements
POS_LIMITS = {"GK": 2, "DEF": 5, "MID": 5, "FWD": 3}
STARTING_MIN = {"GK": 1, "DEF": 3, "MID": 2, "FWD": 1}
STARTING_MAX = {"GK": 1, "DEF": 5, "MID": 5, "FWD": 3}
MAX_PER_CLUB = 3
SQUAD_SIZE = 15
STARTING_XI = 11
HIT_COST = 4
BENCH_WEIGHT = 0.1
INERTIA_THRESHOLD = 2.0


def build_mock_data() -> Tuple[List[Player], UserState]:
    """
    Create realistic mock player pool + user state with an obvious
    good transfer baked in to validate the solver.

    Obvious moves:
      - Sell Solanke (£7.5m, 3.2 xP) → Buy Watkins (£9.0m, 7.8 xP)
      - Sell Neto (£5.8m, 2.1 xP) → Buy Palmer (£10.5m, 8.2 xP, 55% owned)
    Budget allows it: bank=1.5 + selling frees up funds.
    """

    players = [
        # ---- CURRENT SQUAD (15 players) ----
        # GK (2)
        Player(1, "Raya", "ARS", "GK", 5.5, 5.5, 4.8, 28.0, True, True),
        Player(2, "Flekken", "BRE", "GK", 4.5, 4.5, 2.1, 5.0, True, False),
        # DEF (5)
        Player(3, "Gabriel", "ARS", "DEF", 6.2, 6.2, 5.5, 35.0, True, True),
        Player(4, "Saliba", "ARS", "DEF", 6.0, 6.0, 5.3, 32.0, True, True),
        Player(5, "Alexander-Arnold", "LIV", "DEF", 7.2, 7.0, 6.2, 22.0, True, True),
        Player(6, "Hall", "NEW", "DEF", 4.8, 4.8, 3.5, 8.0, True, True),
        Player(7, "Mitchell", "CRY", "DEF", 4.5, 4.3, 2.0, 6.0, True, False),
        # MID (5)
        Player(8, "Salah", "LIV", "MID", 13.0, 12.8, 9.5, 62.0, True, True),
        Player(9, "Saka", "ARS", "MID", 10.0, 10.0, 7.0, 38.0, True, True),
        Player(10, "Neto", "MCI", "MID", 5.8, 5.6, 2.1, 7.0, True, True),
        Player(11, "Gordon", "NEW", "MID", 7.5, 7.3, 5.8, 18.0, True, True),
        Player(12, "Smith Rowe", "FUL", "MID", 5.5, 5.5, 3.2, 4.0, True, False),
        # FWD (3)
        Player(13, "Haaland", "MCI", "FWD", 14.5, 14.5, 10.2, 58.0, True, True),
        Player(14, "Solanke", "TOT", "FWD", 7.5, 7.3, 3.2, 12.0, True, True),
        Player(15, "Wissa", "BRE", "FWD", 6.0, 5.8, 4.1, 9.0, True, False),

        # ---- AVAILABLE TRANSFERS (non-squad players) ----
        # GK
        Player(16, "Pickford", "EVE", "GK", 5.0, 5.0, 4.0, 10.0),
        Player(17, "Henderson", "CRY", "GK", 4.5, 4.5, 3.0, 3.0),
        # DEF
        Player(18, "Van Dijk", "LIV", "DEF", 6.5, 6.5, 5.8, 25.0),
        Player(19, "Gvardiol", "MCI", "DEF", 6.0, 6.0, 4.5, 15.0),
        Player(20, "Lewis", "MCI", "DEF", 4.2, 4.2, 1.5, 2.0),  # cheap fodder
        Player(21, "Ait-Nouri", "WOL", "DEF", 5.2, 5.2, 4.8, 11.0),
        # MID
        Player(22, "Palmer", "CHE", "MID", 10.5, 10.5, 8.2, 55.0),  # obvious target
        Player(23, "Mbeumo", "BRE", "MID", 7.5, 7.5, 6.5, 20.0),
        Player(24, "Rogers", "AVL", "MID", 5.5, 5.5, 5.0, 7.5),
        Player(25, "Elanga", "NFO", "MID", 5.2, 5.2, 4.2, 6.0),
        Player(26, "McAtee", "MCI", "MID", 4.5, 4.5, 1.0, 1.0),  # fodder
        # FWD
        Player(27, "Watkins", "AVL", "FWD", 9.0, 9.0, 7.8, 9.5),  # obvious target
        Player(28, "Isak", "NEW", "FWD", 8.8, 8.8, 7.5, 25.0),
        Player(29, "Cunha", "WOL", "FWD", 7.0, 7.0, 6.0, 14.0),
        Player(30, "Archer", "SOU", "FWD", 4.5, 4.5, 1.2, 1.5),  # cheap fodder
    ]

    current_squad_ids = {p.id for p in players if p.in_current_squad}

    user = UserState(
        bank=1.5,
        free_transfers=1,
        current_squad_ids=current_squad_ids,
    )

    return players, user


# ╔══════════════════════════════════════════════════════════════════╗
# ║  MODULE 2 — THE MILP SOLVER                                    ║
# ╚══════════════════════════════════════════════════════════════════╝


@dataclass
class SolverResult:
    status: str  # "Optimal", "Infeasible", etc.
    new_squad: List[Player]
    starters: List[Player]
    bench: List[Player]
    captain: Player
    transfers_in: List[Player]
    transfers_out: List[Player]
    total_xp: float
    hit_cost: float
    net_xp: float
    current_team_xp: float
    net_improvement: float
    budget_used: float
    budget_available: float
    should_roll: bool


def solve_fpl_problem(
    players: List[Player],
    user: UserState,
    max_transfers: int = 4,
) -> SolverResult:
    """
    Solve the MILP transfer optimization problem.

    Maximize:
        Z = Σ(xP_p × starter_p) + Σ(xP_p × bench_p × 0.1)
            + Σ(xP_p × captain_p)    [captain gets extra 1x]
            - 4 × max(0, total_transfers - free_transfers)

    Subject to:
        - Budget: cost(new_squad) ≤ bank + selling_price(transferred_out)
        - Squad: 2 GK, 5 DEF, 5 MID, 3 FWD (exactly 15)
        - Club limit: max 3 from any team
        - Starting XI: exactly 11 starters, valid formation
        - Captain: exactly 1 captain, must be a starter
        - Starters ⊆ Squad
    """

    pid = {p.id: p for p in players}
    all_ids = [p.id for p in players]
    current_ids = user.current_squad_ids

    # ── Decision Variables ──

    squad = {i: pulp.LpVariable(f"squad_{i}", cat="Binary") for i in all_ids}
    starter = {i: pulp.LpVariable(f"start_{i}", cat="Binary") for i in all_ids}
    captain = {i: pulp.LpVariable(f"cap_{i}", cat="Binary") for i in all_ids}
    transfer_out = {
        i: pulp.LpVariable(f"tout_{i}", cat="Binary")
        for i in all_ids
        if i in current_ids
    }
    transfer_in = {
        i: pulp.LpVariable(f"tin_{i}", cat="Binary")
        for i in all_ids
        if i not in current_ids
    }

    # Auxiliary: hits = max(0, num_transfers - FT)
    hits = pulp.LpVariable("hits", lowBound=0, cat="Integer")

    # ── Problem ──
    prob = pulp.LpProblem("FPL_Optimizer", pulp.LpMaximize)

    # ── Objective Function ──
    # Starters get full xP, bench gets 0.1x, captain gets an extra 1x
    obj = []
    for i in all_ids:
        xp = pid[i].xP
        # Starter contribution (full weight)
        obj.append(xp * starter[i])
        # Bench contribution: squad but not starter → 0.1x
        # bench_p = squad_p - starter_p (since starter ≤ squad)
        obj.append(xp * BENCH_WEIGHT * (squad[i] - starter[i]))
        # Captain bonus: extra 1x on top of starter
        obj.append(xp * captain[i])

    # Subtract hit cost
    obj.append(-HIT_COST * hits)

    prob += pulp.lpSum(obj), "Objective"

    # ── Constraints ──

    # 1. Squad size = 15
    prob += pulp.lpSum(squad[i] for i in all_ids) == SQUAD_SIZE, "squad_size"

    # 2. Position limits (exact)
    for pos, count in POS_LIMITS.items():
        prob += (
            pulp.lpSum(squad[i] for i in all_ids if pid[i].position == pos) == count,
            f"pos_{pos}",
        )

    # 3. Club limit: max 3 per team
    clubs = set(p.team for p in players)
    for club in clubs:
        prob += (
            pulp.lpSum(squad[i] for i in all_ids if pid[i].team == club)
            <= MAX_PER_CLUB,
            f"club_{club}",
        )

    # 4. Starting XI = 11
    prob += pulp.lpSum(starter[i] for i in all_ids) == STARTING_XI, "starting_xi"

    # 5. Starter must be in squad
    for i in all_ids:
        prob += starter[i] <= squad[i], f"start_in_squad_{i}"

    # 6. Starting formation constraints
    for pos, mn in STARTING_MIN.items():
        prob += (
            pulp.lpSum(starter[i] for i in all_ids if pid[i].position == pos) >= mn,
            f"start_min_{pos}",
        )
    for pos, mx in STARTING_MAX.items():
        prob += (
            pulp.lpSum(starter[i] for i in all_ids if pid[i].position == pos) <= mx,
            f"start_max_{pos}",
        )
    # Exactly 1 GK starts
    prob += (
        pulp.lpSum(starter[i] for i in all_ids if pid[i].position == "GK") == 1,
        "one_gk_starts",
    )

    # 7. Captain constraints
    prob += pulp.lpSum(captain[i] for i in all_ids) == 1, "one_captain"
    for i in all_ids:
        prob += captain[i] <= starter[i], f"cap_starts_{i}"

    # 8. Transfer linking
    # For current squad members: squad[i] = 1 - transfer_out[i]
    for i in current_ids:
        prob += squad[i] == 1 - transfer_out[i], f"link_out_{i}"

    # For non-squad players: squad[i] = transfer_in[i]
    for i in all_ids:
        if i not in current_ids:
            prob += squad[i] == transfer_in[i], f"link_in_{i}"

    # 9. Hit calculation: hits >= num_transfers - FT
    num_transfers = pulp.lpSum(transfer_out[i] for i in transfer_out)
    prob += hits >= num_transfers - user.free_transfers, "hit_calc"
    prob += hits >= 0, "hit_floor"

    # 10. Max transfers cap (keep solver fast)
    prob += num_transfers <= max_transfers, "max_transfers"

    # 11. Budget constraint
    # Budget available = bank + selling_price of players transferred out
    # Cost of new players = now_cost of players transferred in
    selling_revenue = pulp.lpSum(
        pid[i].selling_price * transfer_out[i] for i in transfer_out
    )
    buying_cost = pulp.lpSum(
        pid[i].now_cost * transfer_in[i] for i in transfer_in
    )
    prob += buying_cost <= user.bank + selling_revenue, "budget"

    # ── Solve ──
    solver = pulp.PULP_CBC_CMD(msg=0, timeLimit=30)
    prob.solve(solver)

    # ── Extract Results ──
    status = pulp.LpStatus[prob.status]

    new_squad = [pid[i] for i in all_ids if _val(squad[i])]
    starters = [pid[i] for i in all_ids if _val(starter[i])]
    bench = [p for p in new_squad if p not in starters]
    cap = next((pid[i] for i in all_ids if _val(captain[i])), starters[0])
    t_out = [pid[i] for i in transfer_out if _val(transfer_out[i])]
    t_in = [pid[i] for i in transfer_in if _val(transfer_in[i])]

    # Compute xP totals
    starter_xp = sum(p.xP for p in starters)
    bench_xp = sum(p.xP * BENCH_WEIGHT for p in bench)
    captain_xp = cap.xP  # extra 1x for captain
    total_xp = starter_xp + bench_xp + captain_xp

    num_hits = max(0, len(t_out) - user.free_transfers)
    hit_cost = num_hits * HIT_COST
    net_xp = total_xp - hit_cost

    # Current team xP (for comparison)
    current_starters = [p for p in players if p.is_current_starter]
    current_bench = [p for p in players if p.in_current_squad and not p.is_current_starter]
    # Assume best current starter is captain
    current_cap = max(current_starters, key=lambda p: p.xP) if current_starters else None
    current_xp = (
        sum(p.xP for p in current_starters)
        + sum(p.xP * BENCH_WEIGHT for p in current_bench)
        + (current_cap.xP if current_cap else 0)
    )

    net_improvement = net_xp - current_xp
    should_roll = net_improvement < INERTIA_THRESHOLD and len(t_out) > 0

    # Budget accounting
    budget_available = user.bank + sum(p.selling_price for p in t_out)
    budget_used = sum(p.now_cost for p in t_in)
    # Total squad cost check
    total_squad_cost = sum(p.now_cost for p in new_squad)
    total_selling_power = user.bank + sum(
        p.selling_price for p in players if p.in_current_squad
    )

    return SolverResult(
        status=status,
        new_squad=new_squad,
        starters=starters,
        bench=bench,
        captain=cap,
        transfers_in=t_in,
        transfers_out=t_out,
        total_xp=round(total_xp, 1),
        hit_cost=hit_cost,
        net_xp=round(net_xp, 1),
        current_team_xp=round(current_xp, 1),
        net_improvement=round(net_improvement, 1),
        budget_used=round(budget_used, 1),
        budget_available=round(budget_available, 1),
        should_roll=should_roll,
    )


def _val(var: pulp.LpVariable) -> bool:
    """Check if a binary variable is set to 1."""
    return var.varValue is not None and var.varValue > 0.5


# ╔══════════════════════════════════════════════════════════════════╗
# ║  MODULE 3 — THE BRAIN (TAGGING & OUTPUT)                       ║
# ╚══════════════════════════════════════════════════════════════════╝


def tag_player(player: Player, is_bench: bool, all_xps: List[float]) -> str:
    """Assign strategic tags to a player."""
    tags = []

    # Template: high ownership safety pick
    if player.ownership_percent > 30:
        tags.append("🛡️ [Template]")

    # Differential: low ownership + high xP
    percentile_70 = sorted(all_xps, reverse=True)[int(len(all_xps) * 0.3)] if all_xps else 0
    if player.ownership_percent < 10 and player.xP > percentile_70:
        tags.append("⚔️ [Differential]")

    # Fodder: cheap bench player
    if is_bench and player.now_cost <= 4.5:
        tags.append("💰 [Fodder]")

    return " ".join(tags)


def print_result(result: SolverResult, players: List[Player], user: UserState) -> None:
    """Print the formatted optimization result."""
    all_xps = [p.xP for p in players]

    # Transfer budget: bank + selling_price of outgoing players
    transfer_budget = user.bank + sum(p.selling_price for p in result.transfers_out)
    transfer_cost = sum(p.now_cost for p in result.transfers_in)
    remaining = transfer_budget - transfer_cost

    print()
    print("=" * 65)
    print("  FPL TACTIX — TRANSFER OPTIMIZATION ENGINE")
    print("=" * 65)

    # ── Financial Check ──
    budget_ok = remaining >= -0.01
    print()
    print("💰 FINANCIAL CHECK:")
    print(f"   Bank: £{user.bank:.1f}m | "
          f"Sale Revenue: £{sum(p.selling_price for p in result.transfers_out):.1f}m | "
          f"Purchase Cost: £{transfer_cost:.1f}m | "
          f"Remaining: £{remaining:.1f}m")
    print(f"   ({'✅ Constraint Met' if budget_ok else '❌ BUDGET EXCEEDED'})")

    # ── Transfer Recommendation ──
    print()
    if result.should_roll:
        print("🔄 TRANSFER RECOMMENDATION:")
        print(f"   🟡 ROLL TRANSFER — Net improvement is only "
              f"+{result.net_improvement:.1f} pts (below {INERTIA_THRESHOLD:.1f} threshold)")
        print("   Save the FT for next week or a double move.")
    elif len(result.transfers_in) == 0:
        print("🔄 TRANSFER RECOMMENDATION:")
        print("   No transfers needed. Current squad is already optimal.")
    else:
        print("🔄 TRANSFER RECOMMENDATION:")
        for idx, (p_out, p_in) in enumerate(
            zip(result.transfers_out, result.transfers_in), 1
        ):
            in_tags = tag_player(p_in, p_in in result.bench, all_xps)
            out_note = ""
            # Flag traps (high recent-looking but low xP)
            if p_out.xP < 3.5 and p_out.ownership_percent > 10:
                out_note = " 📉 [Trap?]"
            print(
                f"   {idx}. OUT: ❌ {p_out.name} (£{p_out.selling_price:.1f}m, "
                f"{p_out.xP:.1f} xP){out_note}"
            )
            print(
                f"      IN:  ✅ {p_in.name} (£{p_in.now_cost:.1f}m, "
                f"{p_in.xP:.1f} xP) {in_tags}"
            )

    # ── Analysis ──
    num_moves = len(result.transfers_out)
    ft_used = min(num_moves, user.free_transfers)
    hits_taken = max(0, num_moves - user.free_transfers)

    print()
    print("📊 ANALYSIS:")
    print(f"   Current Team xP:  {result.current_team_xp:.1f}")
    print(f"   Optimized xP:     {result.total_xp:.1f}")
    print(f"   Base xP Gain:     +{result.total_xp - result.current_team_xp:.1f}")
    if hits_taken > 0:
        print(f"   Hit Cost:         -{result.hit_cost} "
              f"({ft_used} FT used, {num_moves} moves made)")
    else:
        print(f"   Hit Cost:         0 ({ft_used} FT used, {num_moves} move(s) made)")
    print(f"   Net Improvement:  {'+' if result.net_improvement >= 0 else ''}"
          f"{result.net_improvement:.1f} points")

    if result.should_roll:
        print(f"   Verdict: 🟡 ROLL (Below {INERTIA_THRESHOLD:.1f}pt threshold)")
    elif result.net_improvement >= INERTIA_THRESHOLD:
        print(f"   Verdict: ✅ WORTH IT (Exceeds {INERTIA_THRESHOLD:.1f}pt threshold)")
    elif result.net_improvement > 0:
        print(f"   Verdict: ⚠️ MARGINAL (Positive but below {INERTIA_THRESHOLD:.1f}pt threshold)")
    else:
        print(f"   Verdict: ❌ NOT WORTH IT")

    # ── Captain Pick ──
    print()
    cap_tags = tag_player(result.captain, False, all_xps)
    print(f"👑 CAPTAIN: {result.captain.name} ({result.captain.xP:.1f} xP) {cap_tags}")

    # ── Starting XI ──
    print()
    print("📋 STARTING XI:")
    for pos in ["GK", "DEF", "MID", "FWD"]:
        pos_players = sorted(
            [p for p in result.starters if p.position == pos],
            key=lambda p: p.xP,
            reverse=True,
        )
        for p in pos_players:
            tags = tag_player(p, False, all_xps)
            cap_marker = " (C)" if p.id == result.captain.id else ""
            is_new = " 🆕" if p in result.transfers_in else ""
            print(f"   {pos:3s} | {p.name:20s} | £{p.now_cost:.1f}m | "
                  f"{p.xP:.1f} xP{cap_marker}{is_new} {tags}")

    # ── Bench ──
    print()
    print("🪑 BENCH:")
    for p in sorted(result.bench, key=lambda p: p.xP, reverse=True):
        tags = tag_player(p, True, all_xps)
        is_new = " 🆕" if p in result.transfers_in else ""
        print(f"   {p.position:3s} | {p.name:20s} | £{p.now_cost:.1f}m | "
              f"{p.xP:.1f} xP (bench: {p.xP * BENCH_WEIGHT:.1f}){is_new} {tags}")

    print()
    print("=" * 65)


# ╔══════════════════════════════════════════════════════════════════╗
# ║  MAIN                                                           ║
# ╚══════════════════════════════════════════════════════════════════╝


if __name__ == "__main__":
    players, user = build_mock_data()

    print("Solving MILP optimization...")
    result = solve_fpl_problem(players, user)

    if result.status != "Optimal":
        print(f"⚠️ Solver status: {result.status}")
        print("Could not find an optimal solution. Check constraints.")
    else:
        print_result(result, players, user)
