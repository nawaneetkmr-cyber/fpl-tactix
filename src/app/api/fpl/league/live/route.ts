import {
  fetchBootstrap,
  fetchLeagueStandings,
  fetchUserPicks,
} from "@/lib/fpl";
import { analyzeLeague, LeaguePicksInfo } from "@/lib/league";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const leagueId = Number(searchParams.get("leagueId"));
    const teamId = Number(searchParams.get("teamId"));
    let gw = Number(searchParams.get("gw")) || 0;

    if (!leagueId || !teamId) {
      return Response.json(
        { error: "Missing leagueId or teamId" },
        { status: 400 }
      );
    }

    const bootstrap = await fetchBootstrap();

    if (!gw) {
      const currentEvent = bootstrap.events?.find(
        (e: { is_current: boolean }) => e.is_current
      );
      gw = currentEvent?.id ?? 1;
    }

    // Fetch league standings
    const leagueData = await fetchLeagueStandings(leagueId);

    // Fetch user's picks
    const userPicksData = await fetchUserPicks(teamId, gw);

    // Try to fetch top rival picks (top 5 closest rivals)
    const standings = leagueData.standings.results;
    const userStanding = standings.find(
      (s: { entry: number }) => s.entry === teamId
    );
    const closestRivals = standings
      .filter((s: { entry: number; total: number }) => s.entry !== teamId)
      .sort(
        (a: { total: number }, b: { total: number }) =>
          Math.abs(a.total - (userStanding?.total ?? 0)) -
          Math.abs(b.total - (userStanding?.total ?? 0))
      )
      .slice(0, 5);

    const rivalPicksMap = new Map<number, LeaguePicksInfo>();

    // Fetch rival picks in parallel (with error handling per rival)
    const rivalPickPromises = closestRivals.map(
      async (rival: {
        entry: number;
        entry_name: string;
        player_name: string;
        total: number;
        event_total: number;
      }) => {
        try {
          const picksData = await fetchUserPicks(rival.entry, gw);
          rivalPicksMap.set(rival.entry, {
            entry: rival.entry,
            entry_name: rival.entry_name,
            player_name: rival.player_name,
            total: rival.total,
            event_total: rival.event_total,
            picks: picksData.picks,
          });
        } catch {
          // Skip rival if picks unavailable
        }
      }
    );

    await Promise.all(rivalPickPromises);

    const elements = bootstrap.elements.map(
      (e: { id: number; web_name: string }) => ({
        id: e.id,
        web_name: e.web_name,
      })
    );

    const intelligence = analyzeLeague(
      leagueData,
      teamId,
      userPicksData.picks,
      rivalPicksMap,
      elements
    );

    return Response.json({
      gameweek: gw,
      ...intelligence,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
