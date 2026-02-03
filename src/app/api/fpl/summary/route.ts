import {
  fetchBootstrap,
  fetchLiveGW,
  fetchUserPicks,
  fetchEntry,
  fetchEntryHistory,
} from "@/lib/fpl";
import {
  calculateLivePoints,
  findBestCaptain,
  getBenchPoints,
  getCaptainPoints,
  calculateOptimizedSquad,
  estimateRank,
  enrichPicks,
} from "@/lib/calculations";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const teamId = Number(searchParams.get("teamId"));
    let gw = Number(searchParams.get("gw")) || 0;

    if (!teamId) {
      return Response.json({ error: "Missing teamId" }, { status: 400 });
    }

    // Fetch bootstrap first if gw is not provided — determine current GW
    const bootstrap = await fetchBootstrap();

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
        gw = nextEvent.id;
      } else if (currentEvent) {
        gw = currentEvent.id;
      } else {
        const finishedEvents = (bootstrap.events || []).filter(
          (e: { finished: boolean }) => e.finished
        );
        gw =
          finishedEvents.length > 0
            ? Math.max(...finishedEvents.map((e: { id: number }) => e.id))
            : 1;
      }
    }

    const currentEvent = bootstrap.events?.find(
      (e: { id: number }) => e.id === gw
    );
    const averageScore = currentEvent?.average_entry_score ?? 0;
    const totalPlayers = bootstrap.total_players ?? 10000000;

    const [live, picksData, entry, history] = await Promise.all([
      fetchLiveGW(gw),
      fetchUserPicks(teamId, gw),
      fetchEntry(teamId),
      fetchEntryHistory(teamId),
    ]);

    const picks = picksData.picks;
    const liveElements = live.elements;
    const elements = bootstrap.elements;

    // Core calculations
    const livePoints = calculateLivePoints(picks, liveElements);
    const bestCaptain = findBestCaptain(picks, liveElements);
    const benchPoints = getBenchPoints(picks, liveElements);
    const captainPoints = getCaptainPoints(picks, liveElements);

    // AI Optimization
    const optimization = calculateOptimizedSquad(picks, liveElements, elements);

    // Rank estimation
    const estimatedLiveRank = estimateRank(livePoints, averageScore, totalPlayers);
    const estimatedOptimizedRank = estimateRank(
      optimization.optimizedPoints,
      averageScore,
      totalPlayers
    );

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

    return Response.json({
      teamName: entry.name,
      playerName: `${entry.player_first_name} ${entry.player_last_name}`,
      gameweek: gw,
      livePoints,
      benchPoints,
      captainPoints,
      bestCaptain,
      estimatedLiveRank,
      estimatedOptimizedRank,
      averageScore,
      totalPlayers,
      prevOverallRank,
      optimization,
      picks: enrichedPicks,
      rawPicks: picks,
      liveElements,
      elements,
      teams,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
