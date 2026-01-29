import { fetchBootstrap, fetchUserPicks } from "@/lib/fpl";
import { analyzeRiskProfile } from "@/lib/strategy";

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

    const picksData = await fetchUserPicks(teamId, gw);

    const squad = picksData.picks.map(
      (p: { element: number; position: number }) => ({
        element: p.element,
        position: p.position,
      })
    );

    const riskProfile = analyzeRiskProfile(squad, bootstrap.elements);

    return Response.json({
      gameweek: gw,
      teamId,
      ...riskProfile,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
