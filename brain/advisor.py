"""
FPL Transfer Advisor — Strategic Tagging & Recommendation Engine
=================================================================
Post-processes optimizer output to assign strategic tags and generate
human-readable transfer advice with reasoning.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional, Tuple

from optimizer import (
    OptimizationResult,
    Player,
    SquadState,
    TransferSuggestion,
)


# ---------- Tag Definitions ----------


class Tag(Enum):
    TEMPLATE = "Template"
    DIFFERENTIAL = "Differential"
    ULTRA_DIFFERENTIAL = "Ultra-Differential"
    TRAP = "Trap"
    VALUE_BEAST = "Value Beast"

    @property
    def emoji(self) -> str:
        return {
            Tag.TEMPLATE: "🛡️",
            Tag.DIFFERENTIAL: "📈",
            Tag.ULTRA_DIFFERENTIAL: "🚀",
            Tag.TRAP: "⚠️",
            Tag.VALUE_BEAST: "💰",
        }[self]

    @property
    def context(self) -> str:
        return {
            Tag.TEMPLATE: "High ownership safety pick.",
            Tag.DIFFERENTIAL: "Rank climber.",
            Tag.ULTRA_DIFFERENTIAL: "High risk, massive reward potential.",
            Tag.TRAP: "Overperforming stats significantly—likely to regress.",
            Tag.VALUE_BEAST: "Frees up budget for premiums.",
        }[self]


# ---------- Data Structures ----------


@dataclass
class TaggedPlayer:
    player: Player
    tags: List[Tag]
    tag_reasons: Dict[Tag, str]
    xp_next_3: float = 0.0
    value_ratio: float = 0.0


@dataclass
class TransferAdvice:
    player_out: TaggedPlayer
    player_in: TaggedPlayer
    xp_gain: float
    budget_delta: float  # in £m (positive = saves money)
    reasoning: str
    priority: int  # 1 = highest


@dataclass
class AdvisorReport:
    transfer_advice: List[TransferAdvice]
    captain_pick: TaggedPlayer
    vice_captain_pick: TaggedPlayer
    squad_warnings: List[str]
    summary: str


# ---------- Core Tagging Engine ----------


def assign_player_tags(
    player: Player,
    all_players: List[Player],
    horizon_gws: List[int],
) -> TaggedPlayer:
    """
    Assign strategic tags to a player based on ownership, form,
    expected points, and value metrics.
    """

    tags: List[Tag] = []
    reasons: Dict[Tag, str] = {}

    # Calculate aggregate stats
    xp_next_3 = sum(player.xp_by_gw.get(gw, 0.0) for gw in horizon_gws[:3])
    price_m = player.now_cost / 10.0
    value_ratio = xp_next_3 / price_m if price_m > 0 else 0.0

    # Calculate top-25% xP threshold from all players
    all_xp_next_3 = sorted(
        [sum(p.xp_by_gw.get(gw, 0.0) for gw in horizon_gws[:3]) for p in all_players],
        reverse=True,
    )
    top_25_threshold = all_xp_next_3[len(all_xp_next_3) // 4] if all_xp_next_3 else 0.0

    # --- Tag 1: Template (High Ownership) ---
    if player.ownership_pct > 30.0:
        tags.append(Tag.TEMPLATE)
        reasons[Tag.TEMPLATE] = (
            f"Owned by {player.ownership_pct:.1f}% of managers. "
            f"Benching risks a red arrow."
        )

    # --- Tag 2: Differential ---
    if player.ownership_pct < 10.0 and xp_next_3 > top_25_threshold:
        tags.append(Tag.DIFFERENTIAL)
        reasons[Tag.DIFFERENTIAL] = (
            f"Only {player.ownership_pct:.1f}% ownership but {xp_next_3:.1f} xP "
            f"over next 3 GWs (top 25% threshold: {top_25_threshold:.1f})."
        )

    # --- Tag 3: Ultra-Differential ---
    if player.ownership_pct < 2.0:
        tags.append(Tag.ULTRA_DIFFERENTIAL)
        reasons[Tag.ULTRA_DIFFERENTIAL] = (
            f"Only {player.ownership_pct:.1f}% ownership. "
            f"Massive rank swing potential if they haul."
        )

    # --- Tag 4: The Trap ---
    if player.xp_last_5 > 0 and player.actual_points_last_5 > (player.xp_last_5 * 1.5):
        overperformance = (
            (player.actual_points_last_5 / player.xp_last_5 - 1) * 100
        )
        tags.append(Tag.TRAP)
        reasons[Tag.TRAP] = (
            f"Scored {player.actual_points_last_5:.0f} pts vs "
            f"{player.xp_last_5:.1f} xP over last 5 GWs "
            f"({overperformance:.0f}% overperformance). Regression likely."
        )

    # --- Tag 5: Value Beast ---
    if value_ratio > 0.8:
        tags.append(Tag.VALUE_BEAST)
        reasons[Tag.VALUE_BEAST] = (
            f"{xp_next_3:.1f} xP / £{price_m:.1f}m = {value_ratio:.2f} value ratio. "
            f"Frees budget for premium picks."
        )

    return TaggedPlayer(
        player=player,
        tags=tags,
        tag_reasons=reasons,
        xp_next_3=round(xp_next_3, 1),
        value_ratio=round(value_ratio, 2),
    )


# ---------- Advice Generator ----------


def generate_transfer_advice(
    suggestions: List[TransferSuggestion],
    all_players: List[Player],
    current_gw: int,
    horizon: int = 5,
) -> List[TransferAdvice]:
    """
    Takes raw transfer suggestions and produces tagged, reasoned advice.
    """
    horizon_gws = list(range(current_gw + 1, current_gw + horizon + 1))
    advice_list: List[TransferAdvice] = []

    for idx, suggestion in enumerate(suggestions):
        tagged_out = assign_player_tags(suggestion.player_out, all_players, horizon_gws)
        tagged_in = assign_player_tags(suggestion.player_in, all_players, horizon_gws)

        budget_delta = (suggestion.player_out.selling_price - suggestion.player_in.now_cost) / 10.0
        reasoning = _build_reasoning(tagged_out, tagged_in, suggestion.xp_gain, budget_delta)

        advice_list.append(
            TransferAdvice(
                player_out=tagged_out,
                player_in=tagged_in,
                xp_gain=suggestion.xp_gain,
                budget_delta=budget_delta,
                reasoning=reasoning,
                priority=idx + 1,
            )
        )

    return advice_list


def generate_full_report(
    result: OptimizationResult,
    suggestions: List[TransferSuggestion],
    all_players: List[Player],
    current_squad: SquadState,
) -> AdvisorReport:
    """
    Generate a full advisory report from optimization results.
    """
    horizon_gws = list(
        range(current_squad.gameweek + 1, current_squad.gameweek + result.horizon + 1)
    )

    # Tag all squad players
    tagged_squad = [
        assign_player_tags(p, all_players, horizon_gws)
        for p in result.suggested_squad
    ]

    # Transfer advice
    advice = generate_transfer_advice(
        suggestions, all_players, current_squad.gameweek, result.horizon
    )

    # Captain & VC
    captain_player = next(
        (p for p in result.suggested_squad if p.id == result.captain_id),
        result.suggested_squad[0],
    )
    vc_player = next(
        (p for p in result.suggested_squad if p.id == result.vice_captain_id),
        result.suggested_squad[1],
    )
    tagged_captain = assign_player_tags(captain_player, all_players, horizon_gws)
    tagged_vc = assign_player_tags(vc_player, all_players, horizon_gws)

    # Squad warnings
    warnings = _detect_squad_warnings(tagged_squad, current_squad)

    # Summary
    summary = _build_summary(result, advice, tagged_captain)

    return AdvisorReport(
        transfer_advice=advice,
        captain_pick=tagged_captain,
        vice_captain_pick=tagged_vc,
        squad_warnings=warnings,
        summary=summary,
    )


# ---------- Internal Helpers ----------


def _build_reasoning(
    out: TaggedPlayer,
    in_player: TaggedPlayer,
    xp_gain: float,
    budget_delta: float,
) -> str:
    """Build a natural language reasoning string for a transfer."""
    parts: List[str] = []

    # xP comparison
    if out.xp_next_3 > 0:
        pct = (in_player.xp_next_3 / out.xp_next_3 * 100) if out.xp_next_3 > 0 else 0
        if pct >= 90:
            parts.append(
                f"{in_player.player.web_name} provides {pct:.0f}% of "
                f"{out.player.web_name}'s output"
            )
        else:
            parts.append(
                f"{in_player.player.web_name} projects {in_player.xp_next_3:.1f} xP "
                f"vs {out.player.web_name}'s {out.xp_next_3:.1f} xP (next 3 GWs)"
            )

    # Budget impact
    if budget_delta > 0.5:
        parts.append(f"saving £{budget_delta:.1f}m to upgrade elsewhere")
    elif budget_delta < -0.5:
        parts.append(f"costs £{abs(budget_delta):.1f}m more but justifies the premium")

    # Fixture advantage
    if in_player.xp_next_3 > out.xp_next_3:
        parts.append("better upcoming fixture run")

    # Tag-based insights
    if Tag.TRAP in out.tags:
        parts.append(f"{out.player.web_name} is flagged as a Trap (regression risk)")
    if Tag.DIFFERENTIAL in in_player.tags:
        parts.append(f"{in_player.player.web_name} is a Differential pick for rank gains")
    if Tag.VALUE_BEAST in in_player.tags:
        parts.append(f"{in_player.player.web_name} offers elite value per £m")

    return ". ".join(parts) + "." if parts else "Marginal improvement based on fixture swing."


def _detect_squad_warnings(
    tagged_squad: List[TaggedPlayer],
    squad_state: SquadState,
) -> List[str]:
    """Detect potential issues in the squad."""
    warnings: List[str] = []

    # Check for traps in starting XI
    traps = [tp for tp in tagged_squad if Tag.TRAP in tp.tags]
    if traps:
        names = ", ".join(tp.player.web_name for tp in traps)
        warnings.append(
            f"Regression alert: {names} flagged as Trap(s). "
            f"Consider selling before price drops."
        )

    # Check template coverage
    templates = [tp for tp in tagged_squad if Tag.TEMPLATE in tp.tags]
    if len(templates) < 3:
        warnings.append(
            f"Low template coverage ({len(templates)} template players). "
            f"Risk of falling behind the crowd."
        )

    # Check for too many players from one team
    team_counts: Dict[int, int] = {}
    for tp in tagged_squad:
        team_counts[tp.player.team_id] = team_counts.get(tp.player.team_id, 0) + 1
    heavy_teams = {tid: c for tid, c in team_counts.items() if c >= 3}
    if heavy_teams:
        warnings.append(
            f"Fixture dependency: {len(heavy_teams)} team(s) with 3 players. "
            f"Blank GW risk."
        )

    # Check for injured/doubtful starters
    flagged = [
        tp for tp in tagged_squad
        if tp.player.status in ("d", "i") and tp.player.form > 3.0
    ]
    if flagged:
        names = ", ".join(tp.player.web_name for tp in flagged)
        warnings.append(f"Fitness concern: {names} flagged as doubtful/injured.")

    return warnings


def _build_summary(
    result: OptimizationResult,
    advice: List[TransferAdvice],
    captain: TaggedPlayer,
) -> str:
    """Build the executive summary string."""
    parts: List[str] = []

    if result.transfers_in:
        transfer_lines = []
        for a in advice:
            tags_str = " ".join(
                f"[{t.emoji} {t.value}]" for t in a.player_in.tags
            )
            transfer_lines.append(
                f"  Sell {a.player_out.player.web_name} → "
                f"Buy {a.player_in.player.web_name} "
                f"(+{a.xp_gain:.1f} xP) {tags_str}"
            )
        parts.append("Recommended transfers:\n" + "\n".join(transfer_lines))
    else:
        parts.append("Recommendation: Roll the transfer. No clear upgrades available.")

    if result.transfer_cost > 0:
        parts.append(
            f"Transfer cost: -{result.transfer_cost} pts "
            f"({len(result.transfers_in) - 1} hit(s)). "
            f"Net gain: {result.net_xp:.1f} xP over {result.horizon} GWs."
        )

    captain_tags = " ".join(f"[{t.emoji} {t.value}]" for t in captain.tags)
    parts.append(
        f"Captain: {captain.player.web_name} "
        f"({captain.xp_next_3:.1f} xP next 3 GWs) {captain_tags}"
    )

    return "\n".join(parts)


# ---------- Formatting Utilities ----------


def format_tags(tags: List[Tag]) -> str:
    """Format tags for display."""
    return " ".join(f"[{t.emoji} {t.value}]" for t in tags)


def format_transfer_card(advice: TransferAdvice) -> str:
    """Format a single transfer suggestion as a display card."""
    out_tags = format_tags(advice.player_out.tags)
    in_tags = format_tags(advice.player_in.tags)
    budget_str = (
        f"+£{advice.budget_delta:.1f}m saved"
        if advice.budget_delta > 0
        else f"-£{abs(advice.budget_delta):.1f}m"
        if advice.budget_delta < 0
        else "Budget neutral"
    )

    return (
        f"#{advice.priority} | "
        f"Sell {advice.player_out.player.web_name} {out_tags} → "
        f"Buy {advice.player_in.player.web_name} {in_tags}\n"
        f"   xP Gain: +{advice.xp_gain:.1f} | {budget_str}\n"
        f"   {advice.reasoning}"
    )
