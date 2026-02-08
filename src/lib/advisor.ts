/**
 * FPL Transfer Advisor — Strategic Tagging & Recommendation Engine
 * ================================================================
 * TypeScript port of the Python brain's advisory logic.
 * Assigns strategic tags and generates natural-language reasoning
 * for transfer recommendations displayed in the dashboard.
 */

import type { FullElement, PlayerProjection } from "./xpts";

// ---------- Tag Definitions ----------

export type TagId =
  | "template"
  | "differential"
  | "ultra_differential"
  | "trap"
  | "value_beast";

export interface PlayerTag {
  id: TagId;
  label: string;
  emoji: string;
  context: string;
  color: string; // Tailwind text color class
  bgColor: string; // Tailwind bg class for badge
}

export const TAG_DEFS: Record<TagId, PlayerTag> = {
  template: {
    id: "template",
    label: "Template",
    emoji: "🛡️",
    context: "High ownership safety pick.",
    color: "text-blue-400",
    bgColor: "bg-blue-600/20 text-blue-400 border border-blue-500/30",
  },
  differential: {
    id: "differential",
    label: "Differential",
    emoji: "📈",
    context: "Rank climber.",
    color: "text-purple-400",
    bgColor: "bg-purple-600/20 text-purple-400 border border-purple-500/30",
  },
  ultra_differential: {
    id: "ultra_differential",
    label: "Ultra-Diff",
    emoji: "🚀",
    context: "High risk, massive reward potential.",
    color: "text-orange-400",
    bgColor: "bg-orange-600/20 text-orange-400 border border-orange-500/30",
  },
  trap: {
    id: "trap",
    label: "Trap",
    emoji: "⚠️",
    context: "Overperforming stats — likely to regress.",
    color: "text-red-400",
    bgColor: "bg-red-600/20 text-red-400 border border-red-500/30",
  },
  value_beast: {
    id: "value_beast",
    label: "Value",
    emoji: "💰",
    context: "Frees up budget for premiums.",
    color: "text-emerald-400",
    bgColor: "bg-emerald-600/20 text-emerald-400 border border-emerald-500/30",
  },
};

// ---------- Tagged Player ----------

export interface TaggedTarget {
  playerId: number;
  webName: string;
  teamId: number;
  teamShortName: string;
  position: number;
  price: number; // in 0.1m units
  xPts: number; // next GW expected points
  ownership: number; // percentage
  form: number;
  tags: PlayerTag[];
  reasoning: string;
}

export interface TransferPair {
  playerOut: {
    id: number;
    webName: string;
    teamShortName: string;
    price: number;
    xPts: number;
    tags: PlayerTag[];
  };
  playerIn: TaggedTarget;
  xpGain: number;
  budgetDelta: number; // positive = saves money
  reasoning: string;
  priority: number;
}

// ---------- Core Tagging Engine ----------

export function tagPlayer(
  element: FullElement,
  projection: PlayerProjection | undefined,
  allProjections: PlayerProjection[],
): PlayerTag[] {
  const tags: PlayerTag[] = [];
  const ownership = parseFloat(element.selected_by_percent || "0");
  const form = parseFloat(element.form || "0");
  const price = element.now_cost / 10;

  // Get xP for next 3 GWs (using single-GW projection as proxy)
  const xpNext = projection?.expected_points ?? 0;
  const xpNext3 = xpNext * 3; // Approximate

  // Top-25% threshold
  const allXps = allProjections
    .map((p) => p.expected_points)
    .sort((a, b) => b - a);
  const top25Threshold = allXps[Math.floor(allXps.length / 4)] ?? 0;

  // Value ratio: xP per £m over next 3 GWs
  const valueRatio = price > 0 ? xpNext3 / price : 0;

  // --- Template (High Ownership) ---
  if (ownership > 30) {
    tags.push(TAG_DEFS.template);
  }

  // --- Differential ---
  if (ownership < 10 && xpNext > top25Threshold) {
    tags.push(TAG_DEFS.differential);
  }

  // --- Ultra-Differential ---
  if (ownership < 2) {
    tags.push(TAG_DEFS.ultra_differential);
  }

  // --- The Trap ---
  // Compare actual points_per_game to expected output
  const ppg = parseFloat(element.points_per_game || "0");
  const xgPerGame =
    parseFloat(element.expected_goals || "0") / Math.max(element.starts, 1);
  const xaPerGame =
    parseFloat(element.expected_assists || "0") / Math.max(element.starts, 1);
  // Rough expected ppg: appearance(2) + goals*pts + assists*3
  const goalPts = { 1: 6, 2: 6, 3: 5, 4: 4 }[element.element_type] ?? 4;
  const expectedPpg = 2 + xgPerGame * goalPts + xaPerGame * 3;
  if (expectedPpg > 0 && ppg > expectedPpg * 1.5 && element.starts >= 5) {
    tags.push(TAG_DEFS.trap);
  }

  // --- Value Beast ---
  if (valueRatio > 0.8) {
    tags.push(TAG_DEFS.value_beast);
  }

  return tags;
}

// ---------- Build Tagged Transfer Targets ----------

export function buildTaggedTargets(
  projections: PlayerProjection[],
  elements: FullElement[],
  teams: { id: number; short_name: string }[],
  squadIds: number[],
  maxResults: number = 8,
): TaggedTarget[] {
  const elementMap = new Map(elements.map((e) => [e.id, e]));
  const teamMap = new Map(teams.map((t) => [t.id, t.short_name]));
  const squadSet = new Set(squadIds);

  // Filter to non-squad, reliable starters only
  // minutes_probability >= 0.6 AND minimum 5 starts to avoid low-sample inflation
  const candidates = projections.filter((p) => {
    if (squadSet.has(p.player_id)) return false;
    if (p.minutes_probability < 0.6) return false;
    const el = elementMap.get(p.player_id);
    if (!el) return false;
    // Hard filter: must have meaningful game time
    if (el.starts < 5) return false;
    if (el.minutes < 400) return false;
    return true;
  });

  return candidates.slice(0, maxResults).map((proj) => {
    const el = elementMap.get(proj.player_id);
    const tags = el ? tagPlayer(el, proj, projections) : [];
    const teamName = teamMap.get(proj.team_id) ?? "???";
    const ownership = parseFloat(el?.selected_by_percent || "0");
    const form = parseFloat(el?.form || "0");

    // Build reasoning
    const reasonParts: string[] = [];
    if (tags.some((t) => t.id === "differential")) {
      reasonParts.push(`Only ${ownership.toFixed(1)}% owned — rank climber`);
    }
    if (tags.some((t) => t.id === "value_beast")) {
      reasonParts.push(
        `£${((el?.now_cost ?? 0) / 10).toFixed(1)}m — elite value per £`,
      );
    }
    if (tags.some((t) => t.id === "template")) {
      reasonParts.push(`${ownership.toFixed(0)}% owned — must-have`);
    }
    if (form >= 5) {
      reasonParts.push(`Form: ${form.toFixed(1)} — hot streak`);
    }
    if (reasonParts.length === 0) {
      reasonParts.push(`${proj.expected_points.toFixed(1)} xPts projected`);
    }

    return {
      playerId: proj.player_id,
      webName: proj.web_name,
      teamId: proj.team_id,
      teamShortName: teamName,
      position: proj.position,
      price: el?.now_cost ?? 0,
      xPts: proj.expected_points,
      ownership,
      form,
      tags,
      reasoning: reasonParts.join(". ") + ".",
    };
  });
}

// ---------- Build Transfer Pairs (Sell → Buy) ----------

export function buildTransferPairs(
  squadPicks: { element: number; position: number }[],
  projections: PlayerProjection[],
  elements: FullElement[],
  teams: { id: number; short_name: string }[],
  maxPairs: number = 5,
): TransferPair[] {
  const elementMap = new Map(elements.map((e) => [e.id, e]));
  const teamMap = new Map(teams.map((t) => [t.id, t.short_name]));
  const projMap = new Map(projections.map((p) => [p.player_id, p]));
  const squadIds = new Set(squadPicks.map((p) => p.element));

  // Count teams in squad for team-limit check
  const teamCounts = new Map<number, number>();
  for (const pick of squadPicks) {
    const el = elementMap.get(pick.element);
    if (el) {
      teamCounts.set(el.team, (teamCounts.get(el.team) ?? 0) + 1);
    }
  }

  const pairs: TransferPair[] = [];

  for (const pick of squadPicks) {
    const outEl = elementMap.get(pick.element);
    if (!outEl) continue;

    const outProj = projMap.get(pick.element);
    const outXp = outProj?.expected_points ?? 0;
    const outPrice = outEl.now_cost;
    const outTags = outEl ? tagPlayer(outEl, outProj, projections) : [];

    // Find best replacement at same position within budget
    // Hard filter: must have >= 5 starts and >= 400 minutes to avoid low-sample picks
    const candidates = projections.filter((p) => {
      if (squadIds.has(p.player_id)) return false;
      if (p.minutes_probability < 0.6) return false;
      const cEl = elementMap.get(p.player_id);
      if (!cEl) return false;
      if (cEl.element_type !== outEl.element_type) return false;
      if (cEl.starts < 5 || cEl.minutes < 400) return false;
      // Team limit: after removing outEl's team slot, can we add this player?
      const currentTeamCount = teamCounts.get(cEl.team) ?? 0;
      const adjustedCount =
        cEl.team === outEl.team ? currentTeamCount - 1 : currentTeamCount;
      if (adjustedCount >= 3) return false;
      return true;
    });

    for (const inProj of candidates) {
      const inEl = elementMap.get(inProj.player_id);
      if (!inEl) continue;

      const xpGain = inProj.expected_points - outXp;
      if (xpGain <= 0.3) continue; // Only meaningful upgrades

      const budgetDelta = (outPrice - inEl.now_cost) / 10;
      const inTags = tagPlayer(inEl, inProj, projections);

      // Build reasoning
      const reasonParts: string[] = [];
      const pctOutput =
        outXp > 0
          ? Math.round((inProj.expected_points / outXp) * 100)
          : 100;
      if (pctOutput >= 100) {
        reasonParts.push(
          `${inEl.web_name} projects ${inProj.expected_points.toFixed(1)} xPts vs ${outEl.web_name}'s ${outXp.toFixed(1)}`,
        );
      } else if (pctOutput >= 85) {
        reasonParts.push(
          `${inEl.web_name} provides ${pctOutput}% of ${outEl.web_name}'s output`,
        );
      }

      if (budgetDelta > 0.5) {
        reasonParts.push(`saving £${budgetDelta.toFixed(1)}m to upgrade elsewhere`);
      }
      if (inTags.some((t) => t.id === "differential")) {
        reasonParts.push("differential pick for rank gains");
      }
      if (inTags.some((t) => t.id === "value_beast")) {
        reasonParts.push("elite value per £m");
      }
      if (outTags.some((t) => t.id === "trap")) {
        reasonParts.push(`${outEl.web_name} flagged as regression risk`);
      }

      pairs.push({
        playerOut: {
          id: pick.element,
          webName: outEl.web_name,
          teamShortName: teamMap.get(outEl.team) ?? "???",
          price: outPrice,
          xPts: outXp,
          tags: outTags,
        },
        playerIn: {
          playerId: inProj.player_id,
          webName: inEl.web_name,
          teamId: inEl.team,
          teamShortName: teamMap.get(inEl.team) ?? "???",
          position: inEl.element_type,
          price: inEl.now_cost,
          xPts: inProj.expected_points,
          ownership: parseFloat(inEl.selected_by_percent || "0"),
          form: parseFloat(inEl.form || "0"),
          tags: inTags,
          reasoning: "",
        },
        xpGain: Math.round(xpGain * 10) / 10,
        budgetDelta: Math.round(budgetDelta * 10) / 10,
        reasoning:
          reasonParts.length > 0
            ? reasonParts.join(". ") + "."
            : "Fixture-based upgrade.",
        priority: 0,
      });
    }
  }

  // Sort by xP gain, assign priority
  pairs.sort((a, b) => b.xpGain - a.xpGain);
  return pairs.slice(0, maxPairs).map((p, i) => ({ ...p, priority: i + 1 }));
}

// ---------- Safety Score ----------

/**
 * GW-performance based safety score (0–100).
 * 50 = exactly average, scales ±25 per standard deviation.
 * Uses FPL typical std dev of ~13 points.
 */
export function calculateSafetyScore(
  livePoints: number,
  averageScore: number,
): number {
  const STD_DEV = 13;
  const zScore = (livePoints - averageScore) / STD_DEV;
  const raw = 50 + zScore * 25;
  return Math.min(99, Math.max(1, Math.round(raw)));
}
