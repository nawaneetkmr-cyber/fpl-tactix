import { fetchBootstrap, fetchLiveGW, fetchUserPicks, fetchEntry } from "@/lib/fpl";
import { calculateLivePoints, findBestCaptain } from "@/lib/calculations";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const teamId = Number(searchParams.get("teamId"));
    const gw = Number(searchParams.get("gw"));

    if (!teamId || !gw) {
      return Response.json({ error: "Missing teamId or gw" }, { status: 400 });
    }

    const [bootstrap, live, picksData, entry] = await Promise.all([
      fetchBootstrap(),
      fetchLiveGW(gw),
      fetchUserPicks(teamId, gw),
      fetchEntry(teamId),
    ]);

    const livePoints = calculateLivePoints(picksData.picks, live.elements);
    const bestCaptain = findBestCaptain(picksData.picks, live.elements);

    return Response.json({
      teamName: entry.name,
      playerName: `${entry.player_first_name} ${entry.player_last_name}`,
      livePoints,
      bestCaptain,
      picks: picksData.picks,
      elements: bootstrap.elements,
    });
  } catch (err: any) {
    return Response.json({ error: String(err?.message || err) }, { status: 500 });
  }
}
