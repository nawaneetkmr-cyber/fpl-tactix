import {
  fetchBootstrap,
  fetchLiveGW,
  fetchUserPicks,
  fetchEntry,
  fetchEntryHistory,
} from "@/lib/fpl";
import {
  calculateLivePoints,
  estimateRank,
  computeSafetyResult,
  findMostCaptainedPlayer,
  findCaptainCandidates,
  getRankTier,
} from "@/lib/calculations";
import type { Pick, PlayerElement, SafetyScoreResult } from "@/lib/calculations";

export const dynamic = "force-dynamic";

interface SafetyScoreResponse {
  gameweek: number;
  livePoints: number;
  safetyScore: number;
  delta: number;
  arrow: "green" | "red" | "neutral";
  rankTier: string;
  tierLabel: string;
  estimatedRank: number;
  averageScore: number;
  // Breakdown: top contributing players to the safety score
  topContributors: {
    id: number;
    webName: string;
    points: number;
    ownership: number;
    eoContribution: number;
  }[];
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const teamId = Number(searchParams.get("teamId"));
    let gw = Number(searchParams.get("gw")) || 0;
    const tierOverride = searchParams.get("tier") || null;

    if (!teamId) {
      return Response.json({ error: "Missing teamId" }, { status: 400 });
    }

    // Fetch bootstrap + history to determine current GW
    const bootstrap = await fetchBootstrap();
    const history = await fetchEntryHistory(teamId);
    const latestHistoryEvent =
      history?.current && history.current.length > 0
        ? Math.max(...history.current.map((h: { event: number }) => h.event))
        : null;

    if (!gw) {
      const currentEvent = bootstrap.events?.find(
        (e: { is_current: boolean }) => e.is_current
      );
      const nextEvent = bootstrap.events?.find(
        (e: { is_next: boolean }) => e.is_next
      );
      if (currentEvent && !currentEvent.finished) {
        gw = currentEvent.id;
      } else if (nextEvent) {
        if (latestHistoryEvent && nextEvent.id > latestHistoryEvent) {
          gw = latestHistoryEvent;
        } else {
          gw = nextEvent.id;
        }
      } else if (currentEvent) {
        gw = currentEvent.id;
      } else {
        const finishedEvents = (bootstrap.events || []).filter(
          (e: { finished: boolean }) => e.finished
        );
        if (finishedEvents.length > 0) {
          gw = Math.max(...finishedEvents.map((e: { id: number }) => e.id));
        } else if (latestHistoryEvent) {
          gw = latestHistoryEvent;
        } else {
          gw = 1;
        }
      }
    }

    const currentEvent = bootstrap.events?.find(
      (e: { id: number }) => e.id === gw
    );
    const averageScore = currentEvent?.average_entry_score ?? 0;
    const totalPlayers = bootstrap.total_players ?? 10_000_000;

    const [live, picksData, entry] = await Promise.all([
      fetchLiveGW(gw),
      fetchUserPicks(teamId, gw),
      fetchEntry(teamId),
    ]);

    const picks: Pick[] = picksData.picks;
    const liveElements: PlayerElement[] = live.elements;
    const elements = bootstrap.elements;

    // Calculate live points and rank
    const livePoints = calculateLivePoints(picks, liveElements);
    const estimatedRank = estimateRank(livePoints, averageScore, totalPlayers);

    // Use actual overall rank from entry if available, otherwise estimated
    const actualRank = entry?.summary_overall_rank || estimatedRank;
    const rank = tierOverride ? rankFromTier(tierOverride) : actualRank;

    // Find captain candidates with weights
    const captainCandidates = findCaptainCandidates(elements);
    const captainId = findMostCaptainedPlayer(elements);

    // Compute safety score
    const safetyResult: SafetyScoreResult = computeSafetyResult(
      livePoints,
      liveElements,
      elements,
      rank,
      captainId,
      captainCandidates
    );

    // Build top contributors breakdown
    const tier = tierOverride ? (tierOverride as ReturnType<typeof getRankTier>) : getRankTier(rank);
    const contributors = buildTopContributors(liveElements, elements, tier);

    const response: SafetyScoreResponse = {
      gameweek: gw,
      livePoints,
      safetyScore: safetyResult.safetyScore,
      delta: safetyResult.delta,
      arrow: safetyResult.arrow,
      rankTier: safetyResult.rankTier,
      tierLabel: safetyResult.tierLabel,
      estimatedRank,
      averageScore,
      topContributors: contributors.slice(0, 10),
    };

    return Response.json(response);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

// Helper: convert tier string to approximate rank
function rankFromTier(tier: string): number {
  switch (tier) {
    case "top10k": return 5_000;
    case "top50k": return 25_000;
    case "top100k": return 50_000;
    case "top500k": return 250_000;
    case "top1m": return 500_000;
    default: return 2_000_000;
  }
}

// Build breakdown of which players contribute most to the safety score
function buildTopContributors(
  liveElements: PlayerElement[],
  elements: { id: number; web_name: string; selected_by_percent?: string }[],
  tier: string
) {
  const CONCENTRATION: Record<string, number> = {
    top10k: 1.35,
    top50k: 1.25,
    top100k: 1.15,
    top500k: 1.08,
    top1m: 1.04,
    overall: 1.0,
  };
  const concentration = CONCENTRATION[tier] ?? 1.0;

  const nameMap = new Map<number, string>();
  const ownershipMap = new Map<number, number>();
  for (const el of elements) {
    nameMap.set(el.id, el.web_name);
    ownershipMap.set(el.id, parseFloat(el.selected_by_percent || "0"));
  }

  const contributions: {
    id: number;
    webName: string;
    points: number;
    ownership: number;
    eoContribution: number;
  }[] = [];

  for (const player of liveElements) {
    const rawOwnership = ownershipMap.get(player.id) ?? 0;
    if (rawOwnership <= 0 || player.stats.total_points <= 0) continue;

    const adjustedOwnership = Math.pow(rawOwnership / 100, 1 / concentration);
    const eoContribution = Math.round(player.stats.total_points * adjustedOwnership * 10) / 10;

    contributions.push({
      id: player.id,
      webName: nameMap.get(player.id) ?? `#${player.id}`,
      points: player.stats.total_points,
      ownership: rawOwnership,
      eoContribution,
    });
  }

  contributions.sort((a, b) => b.eoContribution - a.eoContribution);
  return contributions;
}
