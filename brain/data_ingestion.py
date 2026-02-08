"""
FPL Data Ingestion Module
==========================
Fetches and cleans data from the official FPL API, transforming it
into the data structures expected by the optimizer and advisor.
"""

from __future__ import annotations

import statistics
from typing import Any, Dict, List, Optional, Tuple

import requests

from optimizer import Player, SquadState

# ---------- API Endpoints ----------

BASE_URL = "https://fantasy.premierleague.com/api"
BOOTSTRAP_URL = f"{BASE_URL}/bootstrap-static/"
FIXTURES_URL = f"{BASE_URL}/fixtures/"
ENTRY_URL = f"{BASE_URL}/entry/{{team_id}}/"
PICKS_URL = f"{BASE_URL}/entry/{{team_id}}/event/{{gw}}/picks/"
HISTORY_URL = f"{BASE_URL}/entry/{{team_id}}/history/"
ELEMENT_SUMMARY_URL = f"{BASE_URL}/element-summary/{{element_id}}/"


# ---------- Raw Fetch ----------


def fetch_bootstrap() -> Dict[str, Any]:
    """Fetch bootstrap-static data (elements, teams, events, etc.)."""
    resp = requests.get(BOOTSTRAP_URL, timeout=15)
    resp.raise_for_status()
    return resp.json()


def fetch_fixtures() -> List[Dict[str, Any]]:
    """Fetch all fixtures for the season."""
    resp = requests.get(FIXTURES_URL, timeout=15)
    resp.raise_for_status()
    return resp.json()


def fetch_entry(team_id: int) -> Dict[str, Any]:
    """Fetch manager entry data."""
    resp = requests.get(ENTRY_URL.format(team_id=team_id), timeout=15)
    resp.raise_for_status()
    return resp.json()


def fetch_picks(team_id: int, gw: int) -> Dict[str, Any]:
    """Fetch a manager's picks for a specific gameweek."""
    resp = requests.get(
        PICKS_URL.format(team_id=team_id, gw=gw), timeout=15
    )
    resp.raise_for_status()
    return resp.json()


def fetch_element_summary(element_id: int) -> Dict[str, Any]:
    """Fetch per-player history and upcoming fixtures."""
    resp = requests.get(
        ELEMENT_SUMMARY_URL.format(element_id=element_id), timeout=15
    )
    resp.raise_for_status()
    return resp.json()


# ---------- Data Cleaning ----------


def detect_current_gw(events: List[Dict[str, Any]]) -> int:
    """Detect the current/next gameweek from events data."""
    current = next((e for e in events if e.get("is_current")), None)
    next_ev = next((e for e in events if e.get("is_next")), None)

    if current and not current.get("finished"):
        return current["id"]
    elif next_ev:
        return next_ev["id"]
    elif current:
        return current["id"]

    finished = [e for e in events if e.get("finished")]
    return max((e["id"] for e in finished), default=1)


def build_player_pool(
    bootstrap: Dict[str, Any],
    fixtures: List[Dict[str, Any]],
    current_gw: int,
    horizon: int = 5,
) -> List[Player]:
    """
    Transform raw bootstrap + fixtures data into a list of Player objects
    with per-GW expected point projections.
    """
    elements = bootstrap.get("elements", [])
    teams = {t["id"]: t for t in bootstrap.get("teams", [])}

    # Build fixture difficulty map: team_id -> [(gw, difficulty, is_home, opponent_id)]
    fixture_map: Dict[int, List[Tuple[int, int, bool, int]]] = {}
    for f in fixtures:
        event = f.get("event")
        if event is None or event < current_gw:
            continue
        if f.get("finished"):
            continue

        # Home team
        home_id = f["team_h"]
        fixture_map.setdefault(home_id, []).append(
            (event, f.get("team_h_difficulty", 3), True, f["team_a"])
        )
        # Away team
        away_id = f["team_a"]
        fixture_map.setdefault(away_id, []).append(
            (event, f.get("team_a_difficulty", 3), False, f["team_h"])
        )

    # FDR attack modifier
    fdr_mod = {1: 1.4, 2: 1.2, 3: 1.0, 4: 0.8, 5: 0.6}
    home_advantage = 1.12

    players: List[Player] = []

    for el in elements:
        player_id = el["id"]
        position = el["element_type"]
        team_id = el["team"]
        price = el.get("now_cost", 50)
        status = el.get("status", "a")
        ownership = float(el.get("selected_by_percent", "0") or "0")
        form = float(el.get("form", "0") or "0")
        total_points = el.get("total_points", 0)
        minutes = el.get("minutes", 0)
        starts = max(el.get("starts", 1), 1)

        # Calculate base per-game stats
        xg = float(el.get("expected_goals", "0") or "0")
        xa = float(el.get("expected_assists", "0") or "0")
        goals = el.get("goals_scored", 0)
        assists = el.get("assists", 0)
        clean_sheets = el.get("clean_sheets", 0)
        bonus = el.get("bonus", 0)

        # Estimate per-90 rates
        xg_rate = xg / starts
        xa_rate = xa / starts
        goals_rate = goals / starts
        assists_rate = assists / starts
        cs_rate = clean_sheets / starts
        bonus_rate = bonus / starts

        # Points per action by position
        goal_pts = {1: 6, 2: 6, 3: 5, 4: 4}.get(position, 4)
        assist_pts = 3
        cs_pts = {1: 4, 2: 4, 3: 1, 4: 0}.get(position, 0)
        appearance_pts = 2

        # Minutes probability
        if el.get("chance_of_playing_next_round") is not None:
            mins_prob = min(el["chance_of_playing_next_round"] / 100, 0.95)
        elif status == "a":
            mins_prob = min(0.95, starts / max(starts, 1))
        elif status == "d":
            mins_prob = 0.5
        else:
            mins_prob = 0.0

        # Generate per-GW xP projections
        xp_by_gw: Dict[int, float] = {}
        team_fixtures = fixture_map.get(team_id, [])

        for gw in range(current_gw, current_gw + horizon + 1):
            gw_fixtures = [(d, h, o) for (ev, d, h, o) in team_fixtures if ev == gw]

            if not gw_fixtures:
                xp_by_gw[gw] = 0.0  # blank GW
                continue

            gw_xp = 0.0
            for difficulty, is_home, opponent_id in gw_fixtures:
                fdr = fdr_mod.get(difficulty, 1.0)
                home_mult = home_advantage if is_home else 1.0

                # Blended goal threat
                goal_threat = (xg_rate * 0.6 + goals_rate * 0.4) * fdr * home_mult
                assist_threat = (xa_rate * 0.6 + assists_rate * 0.4) * fdr * home_mult
                cs_prob = cs_rate * fdr * home_mult if position <= 2 else (0.15 if position == 3 else 0.0)

                fixture_xp = (
                    goal_threat * goal_pts * mins_prob
                    + assist_threat * assist_pts * mins_prob
                    + cs_prob * cs_pts * mins_prob
                    + appearance_pts * mins_prob
                    + bonus_rate * mins_prob * 0.7
                )
                gw_xp += fixture_xp

            xp_by_gw[gw] = round(gw_xp, 2)

        # Actual vs expected for Trap detection (use season totals as proxy)
        # actual_points_last_5 and xp_last_5 ideally come from element-summary
        # For bulk loading, approximate from season averages
        ppg = float(el.get("points_per_game", "0") or "0")
        actual_last_5 = ppg * 5
        xp_last_5 = sum(list(xp_by_gw.values())[:5]) if xp_by_gw else ppg * 5

        players.append(
            Player(
                id=player_id,
                web_name=el.get("web_name", f"#{player_id}"),
                team_id=team_id,
                position=position,
                now_cost=price,
                selling_price=price,  # Will be overridden for owned players
                ownership_pct=ownership,
                form=form,
                xp_by_gw=xp_by_gw,
                actual_points_last_5=actual_last_5,
                xp_last_5=xp_last_5,
                status=status,
            )
        )

    return players


def build_squad_state(
    team_id: int,
    player_pool: List[Player],
    bootstrap: Dict[str, Any],
    current_gw: int,
) -> SquadState:
    """
    Build the current squad state from a manager's picks.
    """
    player_map = {p.id: p for p in player_pool}

    # Fetch picks
    picks_data = fetch_picks(team_id, current_gw)
    picks = picks_data.get("picks", [])

    # Fetch entry for bank and transfers
    entry = fetch_entry(team_id)
    history_data = requests.get(
        HISTORY_URL.format(team_id=team_id), timeout=15
    ).json()

    # Get bank from latest history entry
    current_history = history_data.get("current", [])
    latest = next(
        (h for h in reversed(current_history) if h["event"] <= current_gw),
        None,
    )
    bank = latest.get("bank", 0) if latest else 0

    # Free transfers (estimate: 1 base + 1 if rolled)
    # FPL doesn't expose this directly via API, so default to 1
    free_transfers = 1

    squad_players: List[Player] = []
    for pick in picks:
        element_id = pick["element"]
        if element_id in player_map:
            player = player_map[element_id]
            # Update selling price (FPL selling price may differ from current price)
            player.selling_price = pick.get("selling_price", player.now_cost)
            squad_players.append(player)

    return SquadState(
        players=squad_players,
        bank=bank,
        free_transfers=free_transfers,
        gameweek=current_gw,
    )


# ---------- High-Level Pipeline ----------


def load_all_data(
    team_id: int, horizon: int = 5
) -> Tuple[SquadState, List[Player]]:
    """
    Complete data pipeline: fetch, clean, and return squad state + player pool.
    """
    bootstrap = fetch_bootstrap()
    fixtures = fetch_fixtures()
    current_gw = detect_current_gw(bootstrap.get("events", []))

    player_pool = build_player_pool(bootstrap, fixtures, current_gw, horizon)
    squad_state = build_squad_state(team_id, player_pool, bootstrap, current_gw)

    return squad_state, player_pool
