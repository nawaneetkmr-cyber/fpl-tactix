import {
  fetchBootstrap,
  fetchFixtures,
  fetchUserPicks,
  fetchEntry,
} from "@/lib/fpl";
import { calculatePlayerProjections } from "@/lib/xpts";
import { optimizeTransfers } from "@/lib/strategy";

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

    const [fixtures, picksData, entry] = await Promise.all([
      fetchFixtures(),
      fetchUserPicks(teamId, gw),
      fetchEntry(teamId),
    ]);

    // Calculate projections for current and next 3 GWs
    const currentProjections = calculatePlayerProjections(
      bootstrap.elements,
      bootstrap.teams,
      fixtures,
      gw
    );

    const futureProjections = [];
    for (let futureGw = gw + 1; futureGw <= Math.min(gw + 3, 38); futureGw++) {
      const prj = calculatePlayerProjections(
        bootstrap.elements,
        bootstrap.teams,
        fixtures,
        futureGw
      );
      futureProjections.push(prj);
    }

    // Build current squad with selling prices
    const currentSquad = picksData.picks.map(
      (p: { element: number; position: number }) => ({
        element: p.element,
        position: p.position,
        selling_price:
          bootstrap.elements.find((e: { id: number }) => e.id === p.element)
            ?.now_cost ?? 0,
      })
    );

    // Get budget and free transfers from entry
    const budget = (entry.last_deadline_bank ?? 0);
    const freeTransfers = entry.last_deadline_total_transfers === 0 ? 1 :
      Math.min(5, Math.max(1, 2)); // Simplified: FPL allows 1-5 FT accumulation

    const transferPlan = optimizeTransfers(
      currentSquad,
      bootstrap.elements,
      currentProjections,
      futureProjections,
      budget,
      freeTransfers
    );

    return Response.json({
      gameweek: gw,
      teamId,
      ...transferPlan,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
