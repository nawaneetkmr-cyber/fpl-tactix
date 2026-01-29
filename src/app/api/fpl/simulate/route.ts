import { fetchBootstrap, fetchLiveGW, fetchUserPicks } from "@/lib/fpl";
import {
  simulateCaptainChange,
  simulateBenchSwap,
  simulateViceCaptain,
  estimateRank,
} from "@/lib/calculations";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { teamId, gw, type, newCaptainId, starterId, benchId } = body;

    if (!teamId || !gw || !type) {
      return Response.json(
        { error: "Missing teamId, gw, or type" },
        { status: 400 }
      );
    }

    const [bootstrap, live, picksData] = await Promise.all([
      fetchBootstrap(),
      fetchLiveGW(gw),
      fetchUserPicks(teamId, gw),
    ]);

    const picks = picksData.picks;
    const liveElements = live.elements;
    const elements = bootstrap.elements;

    const currentEvent = bootstrap.events?.find(
      (e: { id: number }) => e.id === gw
    );
    const averageScore = currentEvent?.average_entry_score ?? 0;
    const totalPlayers = bootstrap.total_players ?? 10000000;

    let result;

    switch (type) {
      case "captain":
        if (!newCaptainId) {
          return Response.json(
            { error: "Missing newCaptainId" },
            { status: 400 }
          );
        }
        result = simulateCaptainChange(
          picks,
          liveElements,
          newCaptainId,
          elements
        );
        break;

      case "bench_swap":
        if (!starterId || !benchId) {
          return Response.json(
            { error: "Missing starterId or benchId" },
            { status: 400 }
          );
        }
        result = simulateBenchSwap(
          picks,
          liveElements,
          starterId,
          benchId,
          elements
        );
        break;

      case "vice_captain":
        result = simulateViceCaptain(picks, liveElements, elements);
        break;

      default:
        return Response.json(
          { error: "Invalid type. Use: captain, bench_swap, vice_captain" },
          { status: 400 }
        );
    }

    // Estimate ranks for original and simulated points
    const originalRank = estimateRank(
      result.originalPoints,
      averageScore,
      totalPlayers
    );
    const simulatedRank = estimateRank(
      result.simulatedPoints,
      averageScore,
      totalPlayers
    );

    return Response.json({
      ...result,
      originalRank,
      simulatedRank,
      rankDifference: originalRank - simulatedRank,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
