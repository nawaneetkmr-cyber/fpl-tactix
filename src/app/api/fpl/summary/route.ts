import {
  fetchBootstrap,
  fetchLiveGW,
  fetchUserPicks,
  fetchEntry,
  fetchEntryHistory,
  fetchFixtures,
  fetchOverallStandings,
} from "@/lib/fpl";
import {
  calculateLivePoints,
  findBestCaptain,
  getBenchPoints,
  getCaptainPoints,
  estimateRank,
  enrichPicks,
  computeSafetyResult,
  findMostCaptainedPlayer,
  getRankTier,
} from "@/lib/calculations";
import { calculatePlayerProjections } from "@/lib/xpts";
import type { FullElement, TeamStrength, FixtureDetail } from "@/lib/xpts";
import { solveFplTransfers } from "@/lib/solver";
import type { SolverPlayer } from "@/lib/solver";

export const dynamic = "force-dynamic";

// Position mapping: FPL element_type (1-4) → optimizer position string
const ELEMENT_TYPE_TO_POS: Record<number, string> = {
  1: "GK",
  2: "DEF",
  3: "MID",
  4: "FWD",
};

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const teamId = Number(searchParams.get("teamId"));
    let gw = Number(searchParams.get("gw")) || 0;

    if (!teamId) {
      return Response.json({ error: "Missing teamId" }, { status: 400 });
    }

    // Fetch bootstrap + history first if gw is not provided — determine current GW
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
        // GW is in progress — show it
        gw = currentEvent.id;
      } else if (currentEvent && currentEvent.finished) {
        // Current GW is finished — show it (user wants to see their completed GW score)
        gw = currentEvent.id;
      } else if (nextEvent) {
        // Between gameweeks — show the next upcoming GW
        gw = nextEvent.id;
      } else {
        // Fallback: highest finished event
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
    const totalPlayers = bootstrap.total_players ?? 10000000;

    const [live, picksData, entry, fixturesResult] = await Promise.all([
      fetchLiveGW(gw),
      fetchUserPicks(teamId, gw),
      fetchEntry(teamId),
      fetchFixtures().catch(() => [] as unknown[]),
    ]);
    const fixtures = Array.isArray(fixturesResult) ? fixturesResult : [];

    const picks = picksData.picks;
    const liveElements = live.elements;
    const elements = bootstrap.elements;

    // Core calculations
    const livePoints = calculateLivePoints(picks, liveElements);
    const bestCaptain = findBestCaptain(picks, liveElements);
    const benchPoints = getBenchPoints(picks, liveElements);
    const captainPoints = getCaptainPoints(picks, liveElements);

    // Rank estimation
    const estimatedLiveRank = estimateRank(livePoints, averageScore, totalPlayers);

    // Previous GW rank for rank change calculation
    const latestHistory = history?.current;
    const prevGw = latestHistory?.find(
      (h: { event: number }) => h.event === gw - 1
    );
    const prevOverallRank = prevGw?.overall_rank ?? null;

    // Enriched picks for UI
    const enrichedPicks = enrichPicks(picks, liveElements, elements);

    // Team info from bootstrap (for shirt colors etc)
    const teams = bootstrap.teams?.map(
      (t: { id: number; name: string; short_name: string }) => ({
        id: t.id,
        name: t.name,
        shortName: t.short_name,
      })
    );

    // ──────────────────────────────────────────────────
    //  Transfer Optimizer — TypeScript solver
    // ──────────────────────────────────────────────────

    let milpOptimization = null;
    try {
      // Determine the NEXT unstarted GW for transfer recommendations.
      // Transfers can only be made BEFORE a GW starts, so the solver must
      // always target the upcoming GW — never the current live one.
      const nextEvent = bootstrap.events?.find(
        (e: { is_next: boolean }) => e.is_next
      );
      const gwEvent = bootstrap.events?.find(
        (e: { id: number }) => e.id === gw
      );
      // If current GW is live (not finished), transfers are for the next GW.
      // If current GW is finished, next event is the target.
      // Fallback to gw + 1 if no next event found.
      const transferTargetGw = nextEvent?.id ?? gw + 1;

      // Build team short_name lookup
      const teamShortNames: Record<number, string> = {};
      for (const t of bootstrap.teams || []) {
        teamShortNames[t.id] = t.short_name;
      }

      const validFixtures = fixtures.filter(
        (f: { event: number | null }) => f.event != null && f.event > 0
      ) as FixtureDetail[];

      // ── Multi-GW Weighted Projections ──
      // Instead of only looking at the next GW's xPts (which inflates
      // DGW players you'd need to sell the week after), blend the next
      // 3 GWs so consistently good players rank higher than one-week punts.
      const GW_WEIGHTS = [0.60, 0.25, 0.15]; // next GW, GW+1, GW+2
      const gwTargets = [transferTargetGw, transferTargetGw + 1, transferTargetGw + 2];

      // Calculate projections for each of the next 3 GWs
      const multiGwProjs: Map<number, number>[] = gwTargets.map((targetGw) => {
        const projs = calculatePlayerProjections(
          elements as FullElement[],
          (bootstrap.teams || []) as TeamStrength[],
          validFixtures,
          targetGw
        );
        return new Map(projs.map((p) => [p.player_id, p.expected_points]));
      });

      // Also get the primary GW projections for display/captain pick
      const primaryProjections = calculatePlayerProjections(
        elements as FullElement[],
        (bootstrap.teams || []) as TeamStrength[],
        validFixtures,
        transferTargetGw
      );
      const primaryProjMap = new Map(primaryProjections.map((p) => [p.player_id, p]));

      // Compute blended multi-GW xP for each player
      const blendedXP = new Map<number, number>();
      for (const el of elements as FullElement[]) {
        let weightedXP = 0;
        for (let i = 0; i < gwTargets.length; i++) {
          const gwXP = multiGwProjs[i].get(el.id) ?? 0;
          weightedXP += gwXP * GW_WEIGHTS[i];
        }
        blendedXP.set(el.id, Math.round(weightedXP * 10) / 10);
      }

      // Current squad element IDs
      const squadIds = new Set(picks.map((p: { element: number }) => p.element));

      // Extract bank from picksData (in 0.1m units → £m)
      const bank = (picksData.entry_history?.bank ?? 0) / 10;

      // Estimate free transfers from history
      let freeTransfers = 1;
      if (latestHistory && latestHistory.length >= 2) {
        const sorted = [...latestHistory].sort(
          (a: { event: number }, b: { event: number }) => b.event - a.event
        );
        const prevGwHistory = sorted.find(
          (h: { event: number }) => h.event === gw - 1
        );
        if (prevGwHistory && prevGwHistory.event_transfers === 0) {
          freeTransfers = 2;
        }
      }

      // Build player pool for the solver using BLENDED multi-GW xP
      const playerPool: SolverPlayer[] = [];

      // Add current squad (15 players)
      for (const el of elements as FullElement[]) {
        if (!squadIds.has(el.id)) continue;
        const pick = picks.find(
          (p: { element: number }) => p.element === el.id
        );
        const pos = ELEMENT_TYPE_TO_POS[el.element_type] ?? "MID";

        playerPool.push({
          id: el.id,
          name: el.web_name,
          team: teamShortNames[el.team] ?? `T${el.team}`,
          position: pos,
          now_cost: el.now_cost / 10,
          selling_price: el.now_cost / 10,
          xP: blendedXP.get(el.id) ?? 0,
          ownership_percent: parseFloat(el.selected_by_percent || "0"),
          in_current_squad: true,
          is_current_starter: pick ? pick.position <= 11 : false,
        });
      }

      // Add top non-squad targets by blended xP (top 10 per position, ~40 players)
      const nonSquadPlayers = (elements as FullElement[])
        .filter((el) => !squadIds.has(el.id))
        .map((el) => ({ el, xP: blendedXP.get(el.id) ?? 0 }))
        .filter((x) => x.xP > 1.0)
        .sort((a, b) => b.xP - a.xP);

      const targetCounts: Record<string, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
      const MAX_TARGETS_PER_POS = 10;

      for (const { el, xP } of nonSquadPlayers) {
        const pos = ELEMENT_TYPE_TO_POS[el.element_type] ?? "MID";
        if ((targetCounts[pos] ?? 0) >= MAX_TARGETS_PER_POS) continue;
        targetCounts[pos] = (targetCounts[pos] ?? 0) + 1;

        playerPool.push({
          id: el.id,
          name: el.web_name,
          team: teamShortNames[el.team] ?? `T${el.team}`,
          position: pos,
          now_cost: el.now_cost / 10,
          selling_price: el.now_cost / 10,
          xP,
          ownership_percent: parseFloat(el.selected_by_percent || "0"),
          in_current_squad: false,
          is_current_starter: false,
        });
      }

      // Run the TypeScript solver
      milpOptimization = solveFplTransfers({
        players: playerPool,
        bank,
        free_transfers: freeTransfers,
      });
    } catch (solverErr: unknown) {
      const message = solverErr instanceof Error ? solverErr.message : String(solverErr);
      console.error("[Solver] Failed:", message);
      milpOptimization = { error: message };
    }

    // ──────────────────────────────────────────────────
    //  Safety Score — Live EO sampling with heuristic fallback
    // ──────────────────────────────────────────────────

    const actualRank = entry?.summary_overall_rank || estimatedLiveRank;
    const tier = getRankTier(actualRank);

    let safetyResult;
    try {
      const liveEO = await sampleLiveEOForSummary(gw, tier, liveElements, elements);
      const delta = livePoints - liveEO.safetyScore;
      safetyResult = {
        safetyScore: liveEO.safetyScore,
        rankTier: tier,
        tierLabel: { top10k: "Top 10K", top50k: "Top 50K", top100k: "Top 100K", top500k: "Top 500K", top1m: "Top 1M", overall: "Overall" }[tier] ?? "Overall",
        delta,
        arrow: (delta > 0 ? "green" : delta < 0 ? "red" : "neutral") as "green" | "red" | "neutral",
      };
    } catch {
      const captainIdForSafety = findMostCaptainedPlayer(elements);
      safetyResult = computeSafetyResult(
        livePoints, liveElements, elements, actualRank, captainIdForSafety
      );
    }

    // Determine GW state for the UI
    const gwEventFinal = bootstrap.events?.find(
      (e: { id: number }) => e.id === gw
    );
    const isGwFinished = gwEventFinal?.finished ?? false;
    const isGwCurrent = gwEventFinal?.is_current ?? false;

    // Active chip for this GW (from picks endpoint)
    const activeChip: string | null = picksData.active_chip ?? null;

    // Extract bank & free transfers for planner
    const bankValue = (picksData.entry_history?.bank ?? 0) / 10;
    let freeTransfersValue = 1;
    if (latestHistory && latestHistory.length >= 2) {
      const sortedH = [...latestHistory].sort(
        (a: { event: number }, b: { event: number }) => b.event - a.event
      );
      const prevGwH = sortedH.find(
        (h: { event: number }) => h.event === gw - 1
      );
      if (prevGwH && prevGwH.event_transfers === 0) {
        freeTransfersValue = 2;
      }
    }

    // Chips used
    const chipsUsed: string[] = (latestHistory || [])
      .filter((h: { active_chip: string | null }) => h.active_chip)
      .map((h: { active_chip: string }) => h.active_chip);

    return Response.json({
      teamName: entry.name,
      playerName: `${entry.player_first_name} ${entry.player_last_name}`,
      gameweek: gw,
      isGwFinished,
      isGwCurrent,
      targetGw: (() => {
        // Transfer Brain always targets the next unstarted GW
        const nxtEv = bootstrap.events?.find((e: { is_next: boolean }) => e.is_next);
        return nxtEv?.id ?? gw + 1;
      })(),
      livePoints,
      benchPoints,
      captainPoints,
      bestCaptain,
      estimatedLiveRank,
      averageScore,
      totalPlayers,
      prevOverallRank,
      milpOptimization,
      safetyScore: safetyResult,
      picks: enrichedPicks,
      rawPicks: picks,
      liveElements,
      elements,
      teams,
      bank: bankValue,
      freeTransfers: freeTransfersValue,
      chipsUsed,
      activeChip,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

// ---------- Live EO Sampling for Summary ----------

const summaryEOCache = new Map<string, { safetyScore: number; ts: number }>();
const SUMMARY_EO_TTL = 10 * 60 * 1000;

const SUMMARY_TIER_PAGES: Record<string, number[]> = {
  top10k:  [1, 2, 3, 4],
  top50k:  [50, 51, 52, 53],
  top100k: [100, 101, 102, 103],
  top500k: [500, 501, 502, 503],
  top1m:   [1000, 1001, 1002, 1003],
  overall: [2000, 2001, 2002, 2003],
};

async function sampleLiveEOForSummary(
  gw: number,
  tier: string,
  liveElements: { id: number; stats: { total_points: number } }[],
  _bootstrapElements: { id: number }[]
): Promise<{ safetyScore: number }> {
  const cacheKey = `summary-${gw}-${tier}`;
  const cached = summaryEOCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < SUMMARY_EO_TTL) {
    return { safetyScore: cached.safetyScore };
  }

  const pages = SUMMARY_TIER_PAGES[tier] ?? SUMMARY_TIER_PAGES.top10k;

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

  if (managerIds.length === 0) throw new Error("No managers");

  const BATCH_SIZE = 25;
  const allPicks: { picks: { element: number; is_captain: boolean; position: number }[] }[] = [];

  for (let i = 0; i < managerIds.length; i += BATCH_SIZE) {
    const batch = managerIds.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((id) => fetchUserPicks(id, gw))
    );
    for (const r of results) {
      if (r.status === "fulfilled") allPicks.push(r.value);
    }
  }

  const sampleSize = allPicks.length;
  if (sampleSize === 0) throw new Error("No picks fetched");

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

  let safetyScore = 0;
  for (const player of liveElements) {
    const owned = ownershipCount.get(player.id) ?? 0;
    const captained = captaincyCount.get(player.id) ?? 0;
    if (owned === 0 && captained === 0) continue;

    const eo = ((owned + captained) / sampleSize) * 100;
    safetyScore += player.stats.total_points * (eo / 100);
  }

  safetyScore = Math.round(safetyScore);
  summaryEOCache.set(cacheKey, { safetyScore, ts: Date.now() });
  return { safetyScore };
}
