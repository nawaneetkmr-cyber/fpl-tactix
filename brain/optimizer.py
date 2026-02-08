"""
FPL Transfer Optimization Brain — Production-Grade MILP Solver
===============================================================
Solves a Mixed-Integer Linear Programming problem to recommend optimal
FPL transfers.

Modes:
  - CLI (default): Runs with mock data and pretty-printed output.
  - API (--json):  Reads player data from stdin as JSON, outputs pure JSON
                   to stdout. No decorations, no emojis.

Input JSON schema (stdin when --json):
  {
    "players": [
      { "id": 1, "name": "Salah", "team": "LIV", "position": "MID",
        "now_cost": 13.0, "selling_price": 12.8, "xP": 9.5,
        "ownership_percent": 62.0, "in_current_squad": true,
        "is_current_starter": true }
    ],
    "bank": 1.5,
    "free_transfers": 1
  }
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from typing import Any, Dict, List, Set, Tuple

import pulp


# ╔══════════════════════════════════════════════════════════════════╗
# ║   MODULE 1 — DATA STRUCTURES & MOCK DATA                       ║
# ╚══════════════════════════════════════════════════════════════════╝

@dataclass
class Player:
    id: int
    name: str
    team: str
    position: str  # GK, DEF, MID, FWD
    now_cost: float
    selling_price: float
    xP: float
    ownership_percent: float
    in_current_squad: bool = False
    is_current_starter: bool = False


@dataclass
class UserState:
    bank: float
    free_transfers: int
    current_squad_ids: Set[int] = field(default_factory=set)


# Constants — single source of truth for the entire app
POS_LIMITS = {"GK": 2, "DEF": 5, "MID": 5, "FWD": 3}
STARTING_MIN = {"GK": 1, "DEF": 3, "MID": 2, "FWD": 1}
STARTING_MAX = {"GK": 1, "DEF": 5, "MID": 5, "FWD": 3}
MAX_PER_CLUB = 3
SQUAD_SIZE = 15
STARTING_XI = 11
HIT_COST = 4
BENCH_WEIGHT = 0.1
INERTIA_THRESHOLD = 2.0
EPSILON = 1e-5


def parse_input_json(raw: Dict[str, Any]) -> Tuple[List[Player], UserState]:
    """Parse the JSON input from the API into Player list and UserState."""
    players = []
    for p in raw["players"]:
        players.append(Player(
            id=p["id"],
            name=p["name"],
            team=p["team"],
            position=p["position"],
            now_cost=p["now_cost"],
            selling_price=p["selling_price"],
            xP=p["xP"],
            ownership_percent=p["ownership_percent"],
            in_current_squad=p.get("in_current_squad", False),
            is_current_starter=p.get("is_current_starter", False),
        ))
    current_ids = {p.id for p in players if p.in_current_squad}
    user = UserState(
        bank=raw["bank"],
        free_transfers=raw["free_transfers"],
        current_squad_ids=current_ids,
    )
    return players, user


def build_mock_data() -> Tuple[List[Player], UserState]:
    players = [
        # ---- CURRENT SQUAD (15) ----
        Player(1, "Raya", "ARS", "GK", 5.5, 5.5, 4.8, 28.0, True, True),
        Player(2, "Flekken", "BRE", "GK", 4.5, 4.5, 2.1, 5.0, True, False),
        Player(3, "Gabriel", "ARS", "DEF", 6.2, 6.2, 5.5, 35.0, True, True),
        Player(4, "Saliba", "ARS", "DEF", 6.0, 6.0, 5.3, 32.0, True, True),
        Player(5, "Alexander-Arnold", "LIV", "DEF", 7.2, 7.0, 6.2, 22.0, True, True),
        Player(6, "Hall", "NEW", "DEF", 4.8, 4.8, 3.5, 8.0, True, True),
        Player(7, "Mitchell", "CRY", "DEF", 4.5, 4.3, 2.0, 6.0, True, False),
        Player(8, "Salah", "LIV", "MID", 13.0, 12.8, 9.5, 62.0, True, True),
        Player(9, "Saka", "ARS", "MID", 10.0, 10.0, 7.0, 38.0, True, True),
        Player(10, "Neto", "MCI", "MID", 5.8, 5.6, 2.1, 7.0, True, True),
        Player(11, "Gordon", "NEW", "MID", 7.5, 7.3, 5.8, 18.0, True, True),
        Player(12, "Smith Rowe", "FUL", "MID", 5.5, 5.5, 3.2, 4.0, True, False),
        Player(13, "Haaland", "MCI", "FWD", 14.5, 14.5, 10.2, 58.0, True, True),
        Player(14, "Solanke", "TOT", "FWD", 7.5, 7.3, 3.2, 12.0, True, True),
        Player(15, "Wissa", "BRE", "FWD", 6.0, 5.8, 4.1, 9.0, True, False),
        # ---- TRANSFER TARGETS ----
        Player(16, "Pickford", "EVE", "GK", 5.0, 5.0, 4.0, 10.0),
        Player(17, "Henderson", "CRY", "GK", 4.5, 4.5, 3.0, 3.0),
        Player(18, "Van Dijk", "LIV", "DEF", 6.5, 6.5, 5.8, 25.0),
        Player(19, "Gvardiol", "MCI", "DEF", 6.0, 6.0, 4.5, 15.0),
        Player(20, "Lewis", "MCI", "DEF", 4.2, 4.2, 1.5, 2.0),
        Player(21, "Ait-Nouri", "WOL", "DEF", 5.2, 5.2, 4.8, 11.0),
        Player(22, "Palmer", "CHE", "MID", 10.5, 10.5, 8.2, 55.0),
        Player(23, "Mbeumo", "BRE", "MID", 7.5, 7.5, 6.5, 20.0),
        Player(24, "Rogers", "AVL", "MID", 5.5, 5.5, 5.0, 7.5),
        Player(25, "Elanga", "NFO", "MID", 5.2, 5.2, 4.2, 6.0),
        Player(26, "McAtee", "MCI", "MID", 4.5, 4.5, 1.0, 1.0),
        Player(27, "Watkins", "AVL", "FWD", 9.0, 9.0, 7.8, 9.5),
        Player(28, "Isak", "NEW", "FWD", 8.8, 8.8, 7.5, 25.0),
        Player(29, "Cunha", "WOL", "FWD", 7.0, 7.0, 6.0, 14.0),
        Player(30, "Archer", "SOU", "FWD", 4.5, 4.5, 1.2, 1.5),
    ]
    current_ids = {p.id for p in players if p.in_current_squad}
    user = UserState(bank=1.5, free_transfers=1, current_squad_ids=current_ids)
    return players, user


# ╔══════════════════════════════════════════════════════════════════╗
# ║   MODULE 2 — THE MILP SOLVER                                   ║
# ╚══════════════════════════════════════════════════════════════════╝

@dataclass
class SolverResult:
    status: str
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
    safety_score: float


def solve_fpl_problem(
    players: List[Player], user: UserState, max_transfers: int = 4
) -> SolverResult:
    pid = {p.id: p for p in players}
    all_ids = sorted(p.id for p in players)
    current_ids = user.current_squad_ids

    # Decision variables
    squad = {i: pulp.LpVariable(f"squad_{i}", cat="Binary") for i in all_ids}
    starter = {i: pulp.LpVariable(f"start_{i}", cat="Binary") for i in all_ids}
    captain = {i: pulp.LpVariable(f"cap_{i}", cat="Binary") for i in all_ids}
    transfer_out = {i: pulp.LpVariable(f"tout_{i}", cat="Binary") for i in current_ids}
    transfer_in = {
        i: pulp.LpVariable(f"tin_{i}", cat="Binary")
        for i in all_ids if i not in current_ids
    }
    hits = pulp.LpVariable("hits", lowBound=0, cat="Integer")

    prob = pulp.LpProblem("FPL_Optimizer", pulp.LpMaximize)

    # Objective: starters full xP + bench 0.1x + captain extra 1x - hit costs
    obj = []
    for i in all_ids:
        xp = pid[i].xP
        obj.append(xp * starter[i])
        obj.append(xp * BENCH_WEIGHT * (squad[i] - starter[i]))
        obj.append(xp * captain[i])
    obj.append(-HIT_COST * hits)
    prob += pulp.lpSum(obj), "Objective"

    # Squad constraints
    prob += pulp.lpSum(squad[i] for i in all_ids) == SQUAD_SIZE, "squad_size"
    prob += pulp.lpSum(starter[i] for i in all_ids) == STARTING_XI, "starting_xi"
    prob += pulp.lpSum(captain[i] for i in all_ids) == 1, "one_captain"

    # Position limits
    for pos, count in POS_LIMITS.items():
        prob += (
            pulp.lpSum(squad[i] for i in all_ids if pid[i].position == pos) == count,
            f"pos_{pos}",
        )

    # Club limit: max 3 per team
    clubs = set(p.team for p in players)
    for club in clubs:
        prob += (
            pulp.lpSum(squad[i] for i in all_ids if pid[i].team == club) <= MAX_PER_CLUB,
            f"club_{club}",
        )

    # Formation & lineup logic
    for i in all_ids:
        prob += starter[i] <= squad[i], f"start_in_squad_{i}"
        prob += captain[i] <= starter[i], f"cap_starts_{i}"

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
    prob += (
        pulp.lpSum(starter[i] for i in all_ids if pid[i].position == "GK") == 1,
        "one_gk_starts",
    )

    # Transfer links
    for i in current_ids:
        prob += squad[i] == 1 - transfer_out[i], f"link_out_{i}"
    for i in transfer_in:
        prob += squad[i] == transfer_in[i], f"link_in_{i}"

    # Hits & max transfers
    num_transfers = pulp.lpSum(transfer_out[i] for i in transfer_out)
    prob += hits >= num_transfers - user.free_transfers, "hit_calc"
    prob += num_transfers <= max_transfers, "max_transfers"

    # Budget with epsilon tolerance
    selling_rev = pulp.lpSum(pid[i].selling_price * transfer_out[i] for i in transfer_out)
    buying_cost = pulp.lpSum(pid[i].now_cost * transfer_in[i] for i in transfer_in)
    prob += buying_cost <= user.bank + selling_rev + EPSILON, "budget"

    # Solve
    solver = pulp.PULP_CBC_CMD(msg=0, timeLimit=10)
    prob.solve(solver)

    # Extract results
    status = pulp.LpStatus[prob.status]
    new_squad = [pid[i] for i in all_ids if _val(squad[i])]
    starters = [pid[i] for i in all_ids if _val(starter[i])]
    bench = [p for p in new_squad if p not in starters]
    cap = next(
        (pid[i] for i in all_ids if _val(captain[i])),
        starters[0] if starters else None,
    )

    t_out = [pid[i] for i in transfer_out if _val(transfer_out[i])]
    t_in = [pid[i] for i in transfer_in if _val(transfer_in[i])]

    # xP totals
    starter_xp = sum(p.xP for p in starters)
    bench_xp = sum(p.xP * BENCH_WEIGHT for p in bench)
    cap_xp = cap.xP if cap else 0
    total_xp = starter_xp + bench_xp + cap_xp

    real_hits_count = max(0, len(t_out) - user.free_transfers)
    hit_cost = real_hits_count * HIT_COST
    net_xp = total_xp - hit_cost

    # Baseline (current team) xP for comparison
    curr_start = [p for p in players if p.is_current_starter]
    curr_bench = [p for p in players if p.in_current_squad and not p.is_current_starter]
    curr_cap = max(curr_start, key=lambda p: p.xP) if curr_start else None
    curr_xp = (
        sum(p.xP for p in curr_start)
        + sum(p.xP * BENCH_WEIGHT for p in curr_bench)
        + (curr_cap.xP if curr_cap else 0)
    )

    net_improvement = net_xp - curr_xp
    should_roll = net_improvement < INERTIA_THRESHOLD and len(t_out) > 0

    # Safety score: sum(xP * ownership%) for all players in the pool
    # This approximates the expected score of the "average manager" —
    # the points threshold you need to beat to avoid a red arrow.
    safety_score = round(
        sum(p.xP * (p.ownership_percent / 100.0) for p in players if p.xP > 0), 1
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
        current_team_xp=round(curr_xp, 1),
        net_improvement=round(net_improvement, 1),
        budget_used=round(sum(p.now_cost for p in t_in), 1),
        budget_available=round(user.bank + sum(p.selling_price for p in t_out), 1),
        should_roll=should_roll,
        safety_score=safety_score,
    )


def _val(var: pulp.LpVariable) -> bool:
    return var.varValue is not None and var.varValue > 0.5


# ╔══════════════════════════════════════════════════════════════════╗
# ║   MODULE 3 — OUTPUT (Pretty-Print & JSON)                      ║
# ╚══════════════════════════════════════════════════════════════════╝

def _player_dict(p: Player) -> Dict[str, Any]:
    """Serialize a Player to a plain dict for JSON output."""
    return {
        "id": p.id,
        "name": p.name,
        "team": p.team,
        "position": p.position,
        "now_cost": p.now_cost,
        "selling_price": p.selling_price,
        "xP": p.xP,
        "ownership_percent": p.ownership_percent,
    }


def result_to_json(result: SolverResult) -> Dict[str, Any]:
    """Convert SolverResult into a JSON-serializable dict for the API."""
    return {
        "status": result.status,
        "transfers_in": [_player_dict(p) for p in result.transfers_in],
        "transfers_out": [_player_dict(p) for p in result.transfers_out],
        "starters": [_player_dict(p) for p in result.starters],
        "bench": [_player_dict(p) for p in result.bench],
        "captain": _player_dict(result.captain) if result.captain else None,
        "total_xp": result.total_xp,
        "hit_cost": result.hit_cost,
        "net_xp": result.net_xp,
        "current_team_xp": result.current_team_xp,
        "net_improvement": result.net_improvement,
        "budget_used": result.budget_used,
        "budget_available": result.budget_available,
        "should_roll": result.should_roll,
        "safety_score": result.safety_score,
    }


def print_result(result: SolverResult, players: List[Player], user: UserState) -> None:
    print(f"\n{'='*65}\n  FPL TACTIX — OPTIMIZATION ENGINE\n{'='*65}")

    if len(result.transfers_in) == 0:
        print("\n  STATUS: No transfers needed.")
    else:
        status_msg = "  ROLL RECOMMENDED" if result.should_roll else "  TRANSFER SUGGESTED"
        print(f"\n{status_msg}")
        if result.should_roll:
            print(f"   (Gain +{result.net_improvement} is below {INERTIA_THRESHOLD}pt threshold)")
            print("   The move below is the *best possible*, but you should probably save FT.")

        print("\n   OUT:")
        for p in result.transfers_out:
            print(f"      {p.position} {p.name} ({p.team}) - {p.selling_price}m")

        print("\n   IN:")
        for p in result.transfers_in:
            print(f"      {p.position} {p.name} ({p.team}) - {p.now_cost}m [xP: {p.xP}]")

    rem = result.budget_available - result.budget_used
    print(f"\n  BANK: {rem:.1f}m (Used {result.budget_used:.1f}m of {result.budget_available:.1f}m)")

    print(f"\n  METRICS:")
    print(f"   Current XP: {result.current_team_xp}  ->  Optimized XP: {result.total_xp}")
    print(f"   Hit Cost:   -{result.hit_cost}")
    print(f"   Net Gain:   {'+' if result.net_improvement > 0 else ''}{result.net_improvement} pts")
    print(f"   Safety Line: {result.safety_score} pts")

    print(f"\n  OPTIMIZED LINEUP:")
    print(f"   CAPTAIN: {result.captain.name} ({result.captain.team})")

    for pos in ["GK", "DEF", "MID", "FWD"]:
        ps = sorted(
            [p for p in result.starters if p.position == pos],
            key=lambda x: x.xP, reverse=True,
        )
        for p in ps:
            cap_mark = "(C)" if p.id == result.captain.id else ""
            print(f"   {pos:3} | {p.name:15} {p.team:3} | {p.xP} xP {cap_mark}")

    print("\n  BENCH:")
    for p in sorted(result.bench, key=lambda x: x.xP, reverse=True):
        print(f"   {p.position:3} | {p.name:15} {p.team:3} | {p.xP} xP")
    print("\n" + "=" * 65)


# ╔══════════════════════════════════════════════════════════════════╗
# ║   MAIN                                                          ║
# ╚══════════════════════════════════════════════════════════════════╝

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="FPL MILP Optimizer")
    parser.add_argument(
        "--json",
        action="store_true",
        help="Read player data from stdin as JSON, output pure JSON to stdout.",
    )
    args = parser.parse_args()

    if args.json:
        # API mode: read JSON from stdin, output JSON to stdout
        try:
            raw = json.loads(sys.stdin.read())
            players, user = parse_input_json(raw)
            result = solve_fpl_problem(players, user)
            print(json.dumps(result_to_json(result)))
        except Exception as e:
            print(json.dumps({"error": str(e)}))
            sys.exit(1)
    else:
        # CLI mode: use mock data, pretty-print output
        players, user = build_mock_data()
        result = solve_fpl_problem(players, user)
        print_result(result, players, user)
