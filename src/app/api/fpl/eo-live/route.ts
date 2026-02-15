import {
  fetchBootstrap,
  fetchLiveGW,
  fetchOverallStandings,
  fetchUserPicks,
} from "@/lib/fpl";

export const dynamic = "force-dynamic";

/**
 * GET /api/fpl/eo-live?gw=XX&tier=top10k
 *
 * Samples real manager teams from the overall league (league 314) to compute
 * actual Effective Ownership (EO) by rank bracket.
 *
 * This replaces the heuristic concentration-factor approach with empirical data:
 * - Fetches top N managers from the overall standings
 * - Retrieves each manager's picks for the given GW
 * - Aggregates ownership% + captaincy% = true EO
 * - Computes the EO-weighted safety score
 *
 * Sampling sizes per tier:
 *   top10k  → sample 200 managers (pages 1-4, 50 per page)
 *   top50k  → sample 200 managers from pages ~50-54
 *   top100k → sample 200 managers from pages ~100-104
 */

// In-memory cache: key = `${gw}-${tier}`, value = { data, timestamp }
const eoCache = new Map<string, { data: EOResult; ts: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface EOEntry {
  id: number;
  webName: string;
  ownership: number;    // % of sampled managers who own (start) this player
  captaincy: number;    // % of sampled managers who captain this player
  eo: number;           // ownership + captaincy (can exceed 100)
  livePoints: number;
  eoContribution: number; // livePoints * eo/100
}

interface EOResult {
  gameweek: number;
  tier: string;
  sampleSize: number;
  safetyScore: number;
  entries: EOEntry[];
}

// Tier → which pages to sample (each page = 50 managers)
const TIER_PAGES: Record<string, number[]> = {
  top1k:   [1, 2, 3, 4],            // ranks ~1-200
  top10k:  [1, 2, 3, 4],            // ranks ~1-200 (representative of top 10k)
  top50k:  [50, 51, 52, 53],        // ranks ~2500-2700
  top100k: [100, 101, 102, 103],    // ranks ~5000-5200
  top500k: [500, 501, 502, 503],    // ranks ~25000-25200
  top1m:   [1000, 1001, 1002, 1003],// ranks ~50000-50200
};

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    let gw = Number(searchParams.get("gw")) || 0;
    const tier = searchParams.get("tier") || "top10k";

    const bootstrap = await fetchBootstrap();

    if (!gw) {
      const currentEvent = bootstrap.events?.find(
        (e: { is_current: boolean }) => e.is_current
      );
      gw = currentEvent?.id ?? 1;
    }

    // Check cache
    const cacheKey = `${gw}-${tier}`;
    const cached = eoCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return Response.json(cached.data);
    }

    const pages = TIER_PAGES[tier] ?? TIER_PAGES.top10k;

    // Fetch standings pages in parallel to get manager IDs
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
      return Response.json({ error: "No managers found" }, { status: 404 });
    }

    // Fetch picks for all managers in parallel (batched to avoid overwhelming)
    const BATCH_SIZE = 25;
    const allPicks: { picks: { element: number; is_captain: boolean; is_vice_captain: boolean; position: number; multiplier: number }[] }[] = [];

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
      return Response.json({ error: "Could not fetch any manager picks" }, { status: 500 });
    }

    // Aggregate: count ownership (started) and captaincy per player
    const ownershipCount = new Map<number, number>();
    const captaincyCount = new Map<number, number>();

    for (const picksData of allPicks) {
      for (const pick of picksData.picks) {
        // Only count starters (position 1-11) for ownership
        if (pick.position <= 11) {
          ownershipCount.set(pick.element, (ownershipCount.get(pick.element) ?? 0) + 1);
        }
        if (pick.is_captain) {
          captaincyCount.set(pick.element, (captaincyCount.get(pick.element) ?? 0) + 1);
        }
      }
    }

    // Fetch live data for points
    const live = await fetchLiveGW(gw);
    const liveElements: { id: number; stats: { total_points: number } }[] = live.elements;

    // Build name lookup
    const nameMap = new Map<number, string>();
    for (const el of bootstrap.elements) {
      nameMap.set(el.id, el.web_name);
    }

    // Compute EO entries and safety score
    let safetyScore = 0;
    const entries: EOEntry[] = [];

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

      entries.push({
        id: player.id,
        webName: nameMap.get(player.id) ?? `#${player.id}`,
        ownership: Math.round(ownershipPct * 10) / 10,
        captaincy: Math.round(captaincyPct * 10) / 10,
        eo: Math.round(eo * 10) / 10,
        livePoints: points,
        eoContribution: Math.round(eoContribution * 10) / 10,
      });
    }

    entries.sort((a, b) => b.eoContribution - a.eoContribution);
    safetyScore = Math.round(safetyScore);

    const result: EOResult = {
      gameweek: gw,
      tier,
      sampleSize,
      safetyScore,
      entries: entries.slice(0, 30),
    };

    // Cache the result
    eoCache.set(cacheKey, { data: result, ts: Date.now() });

    return Response.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
