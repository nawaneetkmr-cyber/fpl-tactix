import { fetchBootstrap, fetchFixtures, fetchUserPicks } from "@/lib/fpl";
import {
  calculatePlayerProjections,
  calculateSquadXPts,
} from "@/lib/xpts";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const teamId = Number(searchParams.get("teamId")) || 0;
    let gw = Number(searchParams.get("gw")) || 0;

    const bootstrap = await fetchBootstrap();

    if (!gw) {
      const currentEvent = bootstrap.events?.find(
        (e: { is_current: boolean }) => e.is_current
      );
      gw = currentEvent?.id ?? 1;
    }

    const fixtures = await fetchFixtures();

    // Calculate projections for all players
    const projections = calculatePlayerProjections(
      bootstrap.elements,
      bootstrap.teams,
      fixtures,
      gw
    );

    // If teamId provided, also calculate squad-specific xPts
    let squadXPts = null;
    if (teamId) {
      const picksData = await fetchUserPicks(teamId, gw);
      squadXPts = calculateSquadXPts(picksData.picks, projections);
    }

    // Return top 50 projections + squad data
    return Response.json({
      gameweek: gw,
      top_projections: projections.slice(0, 50),
      squad_xpts: squadXPts,
      total_projected_players: projections.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
