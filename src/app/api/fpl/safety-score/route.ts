import {
  fetchBootstrap,
  fetchLiveGW,
  fetchUserPicks,
  fetchEntry,
  fetchEntryHistory,
  fetchOverallStandings,
} from "@/lib/fpl";
import {
  calculateLivePoints,
  estimateRank,
  computeSafetyResult,
  findMostCaptainedPlayer,
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

    // Determine rank tier
    const tier = tierOverride ? (tierOverride as ReturnType<typeof getRankTier>) : getRankTier(rank);

    // Try live EO sampling for accurate safety score; fall back to heuristic
    let safetyScore: number;
    let contributors: ReturnType<typeof buildTopContributors>;
    let usedLiveEO = false;

    try {
      const liveEO = await sampleLiveEO(gw, tier, liveElements, bootstrap.elements);
      safetyScore = liveEO.safetyScore;
      contributors = liveEO.contributors;
      usedLiveEO = true;
    } catch {
      // Fall back to heuristic
      const captainId = findMostCaptainedPlayer(elements);
      const safetyResult = computeSafetyResult(livePoints, liveElements, elements, rank, captainId);
      safetyScore = safetyResult.safetyScore;
      contributors = buildTopContributors(liveElements, elements, tier);
    }

    const TIER_LABELS: Record<string, string> = {
      top10k: "Top 10K", top50k: "Top 50K", top100k: "Top 100K",
      top500k: "Top 500K", top1m: "Top 1M", overall: "Overall",
    };

    const delta = livePoints - safetyScore;
    const arrow: "green" | "red" | "neutral" = delta > 0 ? "green" : delta < 0 ? "red" : "neutral";

    const response: SafetyScoreResponse = {
      gameweek: gw,
      livePoints,
      safetyScore,
      delta,
      arrow,
      rankTier: tier,
      tierLabel: TIER_LABELS[tier] ?? "Overall",
      estimatedRank,
      averageScore,
      topContributors: contributors.slice(0, 10),
    };

    return Response.json({ ...response, usedLiveEO });
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

// ---------- Live EO Sampling ----------

// In-memory cache for sampled EO data
const liveEOCache = new Map<string, { data: LiveEOData; ts: number }>();
const EO_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface LiveEOData {
  safetyScore: number;
  contributors: {
    id: number;
    webName: string;
    points: number;
    ownership: number;
    eoContribution: number;
  }[];
}

// Tier → which pages to sample from overall league (each page = 50 managers)
const TIER_SAMPLE_PAGES: Record<string, number[]> = {
  top10k:  [1, 2, 3, 4],              // ranks ~1-200
  top50k:  [50, 51, 52, 53],          // ranks ~2500-2700
  top100k: [100, 101, 102, 103],      // ranks ~5000-5200
  top500k: [500, 501, 502, 503],      // ranks ~25000-25200
  top1m:   [1000, 1001, 1002, 1003],  // ranks ~50000-50200
  overall: [2000, 2001, 2002, 2003],  // ranks ~100000+
};

/**
 * Sample real manager teams from the overall league to compute
 * actual EO (Effective Ownership) and a true safety score.
 */
async function sampleLiveEO(
  gw: number,
  tier: string,
  liveElements: PlayerElement[],
  bootstrapElements: { id: number; web_name: string }[]
): Promise<LiveEOData> {
  const cacheKey = `${gw}-${tier}`;
  const cached = liveEOCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < EO_CACHE_TTL_MS) {
    return cached.data;
  }

  const pages = TIER_SAMPLE_PAGES[tier] ?? TIER_SAMPLE_PAGES.top10k;

  // Fetch standings pages in parallel
  const standingsResults = await Promise.all(
    pages.map((page) => fetchOverallStandings(page))
  );

  const managerIds: number[] = [];
  for (const result of standingsResults) {
    const entries = result?.standings?.results ?? [];
    for (const entry of entries) {
      managerIds.push(entry.entry);
    }
  }

  if (managerIds.length === 0) {
    throw new Error("No managers found for sampling");
  }

  // Fetch picks in batches of 25
  const BATCH_SIZE = 25;
  const allPicks: { picks: { element: number; is_captain: boolean; position: number }[] }[] = [];

  for (let i = 0; i < managerIds.length; i += BATCH_SIZE) {
    const batch = managerIds.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map((id) => fetchUserPicks(id, gw))
    );
    for (const result of batchResults) {
      if (result.status === "fulfilled") {
        allPicks.push(result.value);
      }
    }
  }

  const sampleSize = allPicks.length;
  if (sampleSize === 0) {
    throw new Error("Could not fetch any manager picks");
  }

  // Count ownership (starters only) and captaincy
  const ownershipCount = new Map<number, number>();
  const captaincyCount = new Map<number, number>();

  for (const picksData of allPicks) {
    for (const pick of picksData.picks) {
      if (pick.position <= 11) {
        ownershipCount.set(pick.element, (ownershipCount.get(pick.element) ?? 0) + 1);
      }
      if (pick.is_captain) {
        captaincyCount.set(pick.element, (captaincyCount.get(pick.element) ?? 0) + 1);
      }
    }
  }

  // Build name lookup
  const nameMap = new Map<number, string>();
  for (const el of bootstrapElements) {
    nameMap.set(el.id, el.web_name);
  }

  // Compute EO-weighted safety score
  let safetyScore = 0;
  const contributors: LiveEOData["contributors"] = [];

  for (const player of liveElements) {
    const owned = ownershipCount.get(player.id) ?? 0;
    const captained = captaincyCount.get(player.id) ?? 0;
    if (owned === 0 && captained === 0) continue;

    const ownershipPct = (owned / sampleSize) * 100;
    const captaincyPct = (captained / sampleSize) * 100;
    const eo = ownershipPct + captaincyPct;
    const points = player.stats.total_points;
    const eoContribution = points * (eo / 100);

    safetyScore += eoContribution;

    contributors.push({
      id: player.id,
      webName: nameMap.get(player.id) ?? `#${player.id}`,
      points,
      ownership: Math.round(ownershipPct * 10) / 10,
      eoContribution: Math.round(eoContribution * 10) / 10,
    });
  }

  contributors.sort((a, b) => b.eoContribution - a.eoContribution);

  const data: LiveEOData = {
    safetyScore: Math.round(safetyScore),
    contributors,
  };

  liveEOCache.set(cacheKey, { data, ts: Date.now() });
  return data;
}
