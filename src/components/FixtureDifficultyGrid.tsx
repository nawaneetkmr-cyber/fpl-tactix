"use client";

import { useState, useMemo } from "react";
import {
  FixtureDifficultyRow,
  difficultyBgClass,
} from "@/lib/projections";

interface FixtureDifficultyGridProps {
  rows: FixtureDifficultyRow[];
  currentGW: number;
  numGWs?: number;
  highlightTeamIds?: number[];
}

type SortMode = "best" | "alpha";
type FilterMode = "all" | "squad";

export default function FixtureDifficultyGrid({
  rows,
  currentGW,
  numGWs = 10,
  highlightTeamIds = [],
}: FixtureDifficultyGridProps) {
  const [sortMode, setSortMode] = useState<SortMode>("best");
  const [filterMode, setFilterMode] = useState<FilterMode>("all");

  const highlightSet = useMemo(
    () => new Set(highlightTeamIds),
    [highlightTeamIds]
  );

  // Calculate average difficulty for each team
  const rowsWithAvg = useMemo(() => {
    return rows.map((row) => {
      const difficulties = row.fixtures.map((f) => f.difficulty);
      const avgDifficulty =
        difficulties.length > 0
          ? difficulties.reduce((a, b) => a + b, 0) / difficulties.length
          : 3;
      return { ...row, avgDifficulty };
    });
  }, [rows]);

  // Filter and sort rows
  const sortedRows = useMemo(() => {
    let filtered = rowsWithAvg;

    if (filterMode === "squad" && highlightTeamIds.length > 0) {
      filtered = filtered.filter((r) => highlightSet.has(r.teamId));
    }

    if (sortMode === "best") {
      return [...filtered].sort((a, b) => a.avgDifficulty - b.avgDifficulty);
    } else {
      return [...filtered].sort((a, b) =>
        a.teamName.localeCompare(b.teamName)
      );
    }
  }, [rowsWithAvg, sortMode, filterMode, highlightSet, highlightTeamIds.length]);

  // Generate GW columns
  const gwColumns = useMemo(() => {
    const cols: number[] = [];
    for (let i = 0; i < numGWs; i++) {
      cols.push(currentGW + i);
    }
    return cols;
  }, [currentGW, numGWs]);

  return (
    <div className="fade-in">
      {/* Controls */}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="flex gap-1">
          <button
            onClick={() => setSortMode("best")}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              sortMode === "best"
                ? "bg-green-600 text-white"
                : "bg-gray-700 text-gray-300 hover:bg-gray-600"
            }`}
          >
            Best Fixtures
          </button>
          <button
            onClick={() => setSortMode("alpha")}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              sortMode === "alpha"
                ? "bg-green-600 text-white"
                : "bg-gray-700 text-gray-300 hover:bg-gray-600"
            }`}
          >
            A-Z
          </button>
        </div>

        {highlightTeamIds.length > 0 && (
          <div className="flex gap-1">
            <button
              onClick={() => setFilterMode("all")}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                filterMode === "all"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-700 text-gray-300 hover:bg-gray-600"
              }`}
            >
              All Teams
            </button>
            <button
              onClick={() => setFilterMode("squad")}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                filterMode === "squad"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-700 text-gray-300 hover:bg-gray-600"
              }`}
            >
              My Squad Only
            </button>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-2 mb-4 text-sm">
        <span className="text-gray-400">Difficulty:</span>
        <span className={`px-2 py-0.5 rounded ${difficultyBgClass(1)}`}>
          1
        </span>
        <span className={`px-2 py-0.5 rounded ${difficultyBgClass(2)}`}>
          2
        </span>
        <span className={`px-2 py-0.5 rounded ${difficultyBgClass(3)}`}>
          3
        </span>
        <span className={`px-2 py-0.5 rounded ${difficultyBgClass(4)}`}>
          4
        </span>
        <span className={`px-2 py-0.5 rounded ${difficultyBgClass(5)}`}>
          5
        </span>
        <span className="text-gray-500 ml-2">Easy → Hard</span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-800">
              <th className="sticky left-0 z-10 bg-gray-800 px-3 py-2 text-left font-semibold text-gray-300 min-w-[120px]">
                Team
              </th>
              {gwColumns.map((gw) => (
                <th
                  key={gw}
                  className="px-2 py-2 text-center font-semibold text-gray-300 min-w-[70px]"
                >
                  GW{gw}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, idx) => {
              const isHighlighted = highlightSet.has(row.teamId);
              const bgClass = idx % 2 === 0 ? "bg-gray-900" : "bg-gray-800";

              return (
                <tr
                  key={row.teamId}
                  className={`${bgClass} ${
                    isHighlighted ? "ring-1 ring-inset ring-blue-500" : ""
                  }`}
                >
                  <td
                    className={`sticky left-0 z-10 px-3 py-2 font-medium ${bgClass} ${
                      isHighlighted ? "text-blue-400" : "text-gray-200"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span>{row.teamName}</span>
                      {isHighlighted && (
                        <span className="text-xs bg-blue-600 text-white px-1.5 py-0.5 rounded">
                          Squad
                        </span>
                      )}
                    </div>
                  </td>
                  {gwColumns.map((gw) => {
                    const gwFixtures = row.fixtures.filter(
                      (f) => f.gameweek === gw
                    );

                    return (
                      <td
                        key={gw}
                        className="px-2 py-1.5 text-center align-middle"
                      >
                        {gwFixtures.length === 0 ? (
                          <span className="text-gray-600">—</span>
                        ) : (
                          <div className="flex flex-col gap-1 items-center">
                            {gwFixtures.map((fix, i) => (
                              <span
                                key={i}
                                className={`px-2 py-0.5 rounded text-xs font-semibold ${difficultyBgClass(
                                  fix.difficulty
                                )}`}
                              >
                                {fix.opponent} ({fix.isHome ? "H" : "A"})
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer note */}
      <p className="mt-3 text-xs text-gray-500">
        Difficulty ratings from the official FPL API. Double gameweeks show two
        badges per cell. Squad players highlighted in blue.
      </p>
    </div>
  );
}
