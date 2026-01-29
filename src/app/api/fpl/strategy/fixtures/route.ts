import { fetchBootstrap, fetchFixtures } from "@/lib/fpl";
import { calculatePlayerProjections } from "@/lib/xpts";
import { detectFixtureSwings } from "@/lib/strategy";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    let gw = Number(searchParams.get("gw")) || 0;

    const bootstrap = await fetchBootstrap();

    if (!gw) {
      const currentEvent = bootstrap.events?.find(
        (e: { is_current: boolean }) => e.is_current
      );
      gw = currentEvent?.id ?? 1;
    }

    const fixtures = await fetchFixtures();

    // Get projections for next GW (for target players)
    const projections = calculatePlayerProjections(
      bootstrap.elements,
      bootstrap.teams,
      fixtures,
      gw + 1
    );

    const teams = bootstrap.teams.map(
      (t: { id: number; name: string; short_name: string }) => ({
        id: t.id,
        name: t.name,
        short_name: t.short_name,
      })
    );

    const swings = detectFixtureSwings(teams, fixtures, gw, projections);

    return Response.json({
      gameweek: gw,
      fixture_swings: swings,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
