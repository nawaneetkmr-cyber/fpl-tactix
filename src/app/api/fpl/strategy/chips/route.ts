import {
  fetchBootstrap,
  fetchFixtures,
  fetchUserPicks,
  fetchEntryHistory,
} from "@/lib/fpl";
import { calculatePlayerProjections } from "@/lib/xpts";
import { analyzeChipStrategy } from "@/lib/strategy";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const teamId = Number(searchParams.get("teamId"));
    let gw = Number(searchParams.get("gw")) || 0;

    if (!teamId) {
      return Response.json({ error: "Missing teamId" }, { status: 400 });
    }

    const bootstrap = await fetchBootstrap();

    if (!gw) {
      const currentEvent = bootstrap.events?.find(
        (e: { is_current: boolean }) => e.is_current
      );
      gw = currentEvent?.id ?? 1;
    }

    const [fixtures, picksData, history] = await Promise.all([
      fetchFixtures(),
      fetchUserPicks(teamId, gw),
      fetchEntryHistory(teamId),
    ]);

    // Current GW projections
    const projections = calculatePlayerProjections(
      bootstrap.elements,
      bootstrap.teams,
      fixtures,
      gw
    );

    // Future GW projections (next 3)
    const multiGwProjections = [];
    for (let futureGw = gw + 1; futureGw <= Math.min(gw + 3, 38); futureGw++) {
      const prj = calculatePlayerProjections(
        bootstrap.elements,
        bootstrap.teams,
        fixtures,
        futureGw
      );
      multiGwProjections.push({ gw: futureGw, projections: prj });
    }

    // Determine chips used from history
    const chipsUsed: string[] = [];
    if (history?.chips) {
      for (const chip of history.chips) {
        // FPL chip names: bboost, 3xc, freehit, wildcard
        const chipMap: Record<string, string> = {
          bboost: "bench_boost",
          "3xc": "triple_captain",
          freehit: "free_hit",
          wildcard: "wildcard",
        };
        const mapped = chipMap[chip.name] || chip.name;
        chipsUsed.push(mapped);
      }
    }

    const picks = picksData.picks.map(
      (p: { element: number; position: number; is_captain: boolean }) => ({
        element: p.element,
        position: p.position,
        is_captain: p.is_captain,
      })
    );

    const chipStrategy = analyzeChipStrategy(
      picks,
      projections,
      multiGwProjections,
      bootstrap.elements,
      gw,
      chipsUsed
    );

    return Response.json({
      gameweek: gw,
      teamId,
      ...chipStrategy,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
