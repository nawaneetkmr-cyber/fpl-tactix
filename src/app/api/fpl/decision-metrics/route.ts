import { fetchBootstrap, fetchFixtures, fetchUserPicks } from "@/lib/fpl";
import { calculatePlayerProjections } from "@/lib/xpts";
import { evaluateDecisions } from "@/lib/decision";

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

    const [fixtures, picksData] = await Promise.all([
      fetchFixtures(),
      fetchUserPicks(teamId, gw),
    ]);

    // Generate projections
    const projections = calculatePlayerProjections(
      bootstrap.elements,
      bootstrap.teams,
      fixtures,
      gw
    );

    // Evaluate decisions
    const metrics = evaluateDecisions(
      picksData.picks,
      bootstrap.elements,
      projections
    );

    return Response.json({
      gameweek: gw,
      teamId,
      metrics,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
