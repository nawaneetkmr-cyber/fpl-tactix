import { execSync } from "child_process";
import path from "path";

import {
  fetchBootstrap,
  fetchLiveGW,
  fetchUserPicks,
  fetchEntry,
  fetchEntryHistory,
  fetchFixtures,
} from "@/lib/fpl";
import {
  calculateLivePoints,
  findBestCaptain,
  getBenchPoints,
  getCaptainPoints,
  estimateRank,
  enrichPicks,
} from "@/lib/calculations";
import { calculatePlayerProjections } from "@/lib/xpts";
import type { FullElement, TeamStrength, FixtureDetail } from "@/lib/xpts";

// Position mapping: FPL element_type (1-4) → optimizer position string
const ELEMENT_TYPE_TO_POS: Record<number, string> = {
  1: "GK",
  2: "DEF",
  3: "MID",
  4: "FWD",
};

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const teamId = Number(searchParams.get("teamId"));
    let gw = Number(searchParams.get("gw")) || 0;

    if (!teamId) {
      return Response.json({ error: "Missing teamId" }, { status: 400 });
    }

    // Fetch bootstrap + history first if gw is not provided — determine current GW
    const bootstrap = await fetchBootstrap();
    const history = await fetchEntryHistory(teamId);
    const latestHistoryEvent =
      history?.current && history.current.length > 0
        ? Math.max(...history.current.map((h: { event: number }) => h.event))
        : null;

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
        if (latestHistoryEvent && nextEvent.id > latestHistoryEvent) {
          gw = latestHistoryEvent;
        } else {
          gw = nextEvent.id;
        }
      } else if (currentEvent) {
        gw = currentEvent.id;
      } else {
        const finishedEvents = (bootstrap.events || []).filter(
          (e: { finished: boolean }) => e.finished
        );
        if (finishedEvents.length > 0) {
          gw = Math.max(...finishedEvents.map((e: { id: number }) => e.id));
        } else if (latestHistoryEvent) {
          gw = latestHistoryEvent;
        } else {
          gw = 1;
        }
      }
    }

    const currentEvent = bootstrap.events?.find(
      (e: { id: number }) => e.id === gw
    );
    const averageScore = currentEvent?.average_entry_score ?? 0;
    const totalPlayers = bootstrap.total_players ?? 10000000;

    const [live, picksData, entry, fixtures] = await Promise.all([
      fetchLiveGW(gw),
      fetchUserPicks(teamId, gw),
      fetchEntry(teamId),
      fetchFixtures(),
    ]);

    const picks = picksData.picks;
    const liveElements = live.elements;
    const elements = bootstrap.elements;

    // Core calculations
    const livePoints = calculateLivePoints(picks, liveElements);
    const bestCaptain = findBestCaptain(picks, liveElements);
    const benchPoints = getBenchPoints(picks, liveElements);
    const captainPoints = getCaptainPoints(picks, liveElements);

    // Rank estimation
    const estimatedLiveRank = estimateRank(livePoints, averageScore, totalPlayers);

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

    // ──────────────────────────────────────────────────
    //  MILP OPTIMIZER — Python subprocess integration
    // ──────────────────────────────────────────────────

    let milpOptimization = null;
    try {
      // Determine next GW for projections
      const nextEvent = bootstrap.events?.find(
        (e: { is_next: boolean }) => e.is_next
      );
      const targetGw = nextEvent?.id ?? gw + 1;

      // Build team short_name lookup
      const teamShortNames: Record<number, string> = {};
      for (const t of bootstrap.teams || []) {
        teamShortNames[t.id] = t.short_name;
      }

      // Calculate xP projections for ALL players for the target GW
      const projections = calculatePlayerProjections(
        elements as FullElement[],
        (bootstrap.teams || []) as TeamStrength[],
        fixtures.filter(
          (f: { event: number | null }) => f.event != null && f.event > 0
        ) as FixtureDetail[],
        targetGw
      );
      const projMap = new Map(projections.map((p) => [p.player_id, p]));

      // Current squad element IDs
      const squadIds = new Set(picks.map((p: { element: number }) => p.element));

      // Extract bank from picksData (in 0.1m units → £m)
      const bank = (picksData.entry_history?.bank ?? 0) / 10;

      // Estimate free transfers from history
      // FPL rule: start with 1 FT, if 0 transfers made last GW → bank 1 (max 2)
      let freeTransfers = 1;
      if (latestHistory && latestHistory.length >= 2) {
        const sorted = [...latestHistory].sort(
          (a: { event: number }, b: { event: number }) => b.event - a.event
        );
        const prevGwHistory = sorted.find(
          (h: { event: number }) => h.event === gw - 1
        );
        if (prevGwHistory && prevGwHistory.event_transfers === 0) {
          freeTransfers = 2;
        }
      }

      // Build player pool for the solver
      const playerPool: Array<{
        id: number;
        name: string;
        team: string;
        position: string;
        now_cost: number;
        selling_price: number;
        xP: number;
        ownership_percent: number;
        in_current_squad: boolean;
        is_current_starter: boolean;
      }> = [];

      // Add current squad (15 players)
      for (const el of elements as FullElement[]) {
        if (!squadIds.has(el.id)) continue;
        const proj = projMap.get(el.id);
        const pick = picks.find(
          (p: { element: number }) => p.element === el.id
        );
        const pos = ELEMENT_TYPE_TO_POS[el.element_type] ?? "MID";

        playerPool.push({
          id: el.id,
          name: el.web_name,
          team: teamShortNames[el.team] ?? `T${el.team}`,
          position: pos,
          now_cost: el.now_cost / 10, // 0.1m → £m
          selling_price: el.now_cost / 10, // approximation (no purchase price available)
          xP: proj?.expected_points ?? 0,
          ownership_percent: parseFloat(el.selected_by_percent || "0"),
          in_current_squad: true,
          is_current_starter: pick ? pick.position <= 11 : false,
        });
      }

      // Add top non-squad targets by xP (top 10 per position, ~40 players)
      const nonSquadProjections = projections
        .filter((p) => !squadIds.has(p.player_id) && p.expected_points > 1.0)
        .sort((a, b) => b.expected_points - a.expected_points);

      // Pick top targets per position to keep pool manageable
      const targetCounts: Record<string, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
      const MAX_TARGETS_PER_POS = 10;

      for (const proj of nonSquadProjections) {
        const el = (elements as FullElement[]).find((e) => e.id === proj.player_id);
        if (!el) continue;
        const pos = ELEMENT_TYPE_TO_POS[el.element_type] ?? "MID";
        if ((targetCounts[pos] ?? 0) >= MAX_TARGETS_PER_POS) continue;
        targetCounts[pos] = (targetCounts[pos] ?? 0) + 1;

        playerPool.push({
          id: el.id,
          name: el.web_name,
          team: teamShortNames[el.team] ?? `T${el.team}`,
          position: pos,
          now_cost: el.now_cost / 10,
          selling_price: el.now_cost / 10,
          xP: proj.expected_points,
          ownership_percent: parseFloat(el.selected_by_percent || "0"),
          in_current_squad: false,
          is_current_starter: false,
        });
      }

      // Build JSON input for the Python solver
      const solverInput = JSON.stringify({
        players: playerPool,
        bank,
        free_transfers: freeTransfers,
      });

      // Execute the Python optimizer as a subprocess
      const scriptPath = path.resolve(process.cwd(), "brain/optimizer.py");
      const result = execSync(`python3 "${scriptPath}" --json`, {
        input: solverInput,
        encoding: "utf-8",
        timeout: 15000, // 15s max
        maxBuffer: 1024 * 1024, // 1MB
      });

      const parsed = JSON.parse(result.trim());
      if (parsed.error) {
        console.error("[MILP] Solver error:", parsed.error);
      } else {
        milpOptimization = parsed;
      }
    } catch (milpErr) {
      // Log but don't crash the entire response — the optimizer is non-critical
      console.error(
        "[MILP] Subprocess failed:",
        milpErr instanceof Error ? milpErr.message : String(milpErr)
      );
    }

    return Response.json({
      teamName: entry.name,
      playerName: `${entry.player_first_name} ${entry.player_last_name}`,
      gameweek: gw,
      livePoints,
      benchPoints,
      captainPoints,
      bestCaptain,
      estimatedLiveRank,
      averageScore,
      totalPlayers,
      prevOverallRank,
      milpOptimization,
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
