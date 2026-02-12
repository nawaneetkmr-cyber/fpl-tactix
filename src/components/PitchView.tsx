"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import Image from "next/image";

// ---------- Types ----------

interface EnrichedPick {
  element: number;
  position: number;
  multiplier: number;
  isCaptain: boolean;
  isViceCaptain: boolean;
  webName: string;
  teamId: number;
  elementType: number;
  points: number;
  minutes: number;
  isPlaying: boolean;
  isFinished: boolean;
}

interface BootstrapElement {
  id: number;
  web_name: string;
  team: number;
  element_type: number;
  selected_by_percent: string;
  form: string;
  photo: string;
  now_cost?: number;
}

interface FPLTeam {
  id: number;
  name: string;
  short_name: string;
  code: number;
}

interface PitchViewProps {
  picks: EnrichedPick[];
  elements: BootstrapElement[];
  teams: FPLTeam[];
}

const POS_LABELS: Record<number, string> = { 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" };

// ---------- Jersey URL Builder ----------

function getJerseyUrl(teamCode: number): string {
  return `https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_${teamCode}-110.webp`;
}

function getGKJerseyUrl(teamCode: number): string {
  return `https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_${teamCode}_1-110.webp`;
}

// ---------- Player Card Component ----------

function PlayerCard({
  pick,
  element,
  team,
  isBench = false,
  onClick,
  isSelected = false,
}: {
  pick: EnrichedPick;
  element?: BootstrapElement;
  team?: FPLTeam;
  isBench?: boolean;
  onClick?: () => void;
  isSelected?: boolean;
}) {
  const isGK = pick.elementType === 1;
  const jerseyUrl = team
    ? isGK
      ? getGKJerseyUrl(team.code)
      : getJerseyUrl(team.code)
    : "/placeholder-jersey.png";

  const displayPoints = pick.points * (pick.multiplier || 1);
  const ownership = element?.selected_by_percent ?? "0";
  const form = element?.form ?? "0.0";

  return (
    <div
      className={`flex flex-col items-center cursor-pointer transition-all ${
        isBench ? "opacity-70" : ""
      } ${isSelected ? "ring-2 ring-emerald-400 rounded-lg scale-105" : "hover:scale-105"}`}
      style={{ width: 70 }}
      onClick={onClick}
    >
      {/* Jersey + badges */}
      <div className="relative">
        <div
          className="relative rounded-lg overflow-hidden bg-gray-800/50"
          style={{
            width: 56,
            height: 56,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Image
            src={jerseyUrl}
            alt={pick.webName}
            width={48}
            height={48}
            className="object-contain"
            unoptimized
          />
        </div>

        {/* Captain badge */}
        {pick.isCaptain && (
          <div
            className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-yellow-500 flex items-center justify-center text-xs font-bold text-black"
            title="Captain"
          >
            C
          </div>
        )}

        {/* Vice-captain badge */}
        {pick.isViceCaptain && (
          <div
            className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-gray-400 flex items-center justify-center text-xs font-bold text-black"
            title="Vice Captain"
          >
            V
          </div>
        )}

        {/* Playing indicator */}
        {pick.minutes > 0 && !pick.isFinished && (
          <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-green-500 animate-pulse" />
        )}
      </div>

      {/* Player name */}
      <div
        className="text-xs font-semibold text-white mt-1 text-center truncate w-full"
        title={pick.webName}
      >
        {pick.webName}
      </div>

      {/* Points */}
      <div
        className={`text-lg font-bold ${
          displayPoints > 0
            ? "text-green-400"
            : displayPoints < 0
              ? "text-red-400"
              : "text-gray-400"
        }`}
      >
        {displayPoints}
      </div>

      {/* Small stats */}
      <div className="flex gap-1 text-[10px] text-gray-400">
        <span title="Ownership">{ownership}%</span>
        <span>|</span>
        <span title="Form">{form}</span>
      </div>
    </div>
  );
}

// ---------- Replace Player Panel ----------

function ReplacePlayerPanel({
  selectedPick,
  elements,
  teams,
  squadIds,
  onClose,
}: {
  selectedPick: EnrichedPick;
  elements: BootstrapElement[];
  teams: FPLTeam[];
  squadIds: Set<number>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const teamMap = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Filter: same position, not in squad, match search query
  const candidates = useMemo(() => {
    const posType = selectedPick.elementType;
    const q = query.trim().toLowerCase();

    return elements
      .filter((el) => {
        if (el.element_type !== posType) return false;
        if (squadIds.has(el.id)) return false;
        if (q && !el.web_name.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => {
        // Sort by form descending, then ownership
        const formA = parseFloat(a.form || "0");
        const formB = parseFloat(b.form || "0");
        if (formB !== formA) return formB - formA;
        return parseFloat(b.selected_by_percent || "0") - parseFloat(a.selected_by_percent || "0");
      })
      .slice(0, 50);
  }, [elements, selectedPick.elementType, squadIds, query]);

  const selectedElement = elements.find((e) => e.id === selectedPick.element);
  const selectedTeam = teamMap.get(selectedPick.teamId);

  return (
    <div className="mt-4 bg-slate-900 rounded-xl border border-slate-700 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-800 border-b border-slate-700">
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold px-2 py-0.5 rounded bg-red-600/20 text-red-400 border border-red-500/30">
            REPLACE
          </span>
          <span className="text-white font-medium">{selectedPick.webName}</span>
          <span className="text-slate-500 text-sm">
            {selectedTeam?.short_name ?? ""} | {POS_LABELS[selectedPick.elementType] ?? ""}
            {selectedElement?.now_cost ? ` | \u00A3${(selectedElement.now_cost / 10).toFixed(1)}m` : ""}
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-white text-lg px-2"
          title="Close"
        >
          &times;
        </button>
      </div>

      {/* Search */}
      <div className="px-4 py-3 border-b border-slate-700/50">
        <input
          ref={inputRef}
          type="text"
          placeholder={`Search ${POS_LABELS[selectedPick.elementType] ?? "player"}s...`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-50 placeholder-slate-500 focus:outline-none focus:border-emerald-500 text-sm"
        />
      </div>

      {/* Results */}
      <div className="max-h-64 overflow-y-auto">
        {candidates.length === 0 ? (
          <div className="px-4 py-6 text-center text-slate-500 text-sm">
            No players found{query ? ` matching "${query}"` : ""}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-500 text-xs border-b border-slate-700/50">
                <th className="text-left px-4 py-2">Player</th>
                <th className="text-left px-2 py-2">Team</th>
                <th className="text-right px-2 py-2">Price</th>
                <th className="text-right px-2 py-2">Form</th>
                <th className="text-right px-4 py-2">EO%</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((el) => {
                const t = teamMap.get(el.team);
                return (
                  <tr
                    key={el.id}
                    className="border-b border-slate-800/50 hover:bg-slate-800/50 cursor-pointer"
                  >
                    <td className="px-4 py-2 text-white font-medium">{el.web_name}</td>
                    <td className="px-2 py-2 text-slate-400">{t?.short_name ?? ""}</td>
                    <td className="px-2 py-2 text-right text-slate-300">
                      {el.now_cost ? `\u00A3${(el.now_cost / 10).toFixed(1)}m` : "-"}
                    </td>
                    <td className="px-2 py-2 text-right text-emerald-400">{el.form || "0.0"}</td>
                    <td className="px-4 py-2 text-right text-amber-300">
                      {parseFloat(el.selected_by_percent || "0").toFixed(1)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 bg-slate-800/50 text-xs text-slate-500 border-t border-slate-700/50">
        {candidates.length} {POS_LABELS[selectedPick.elementType] ?? "player"}s available
      </div>
    </div>
  );
}

// ---------- Main PitchView Component ----------

export default function PitchView({ picks, elements, teams }: PitchViewProps) {
  const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null);

  // Create lookup maps
  const elementMap = new Map(elements.map((e) => [e.id, e]));
  const teamMap = new Map(teams.map((t) => [t.id, t]));
  const squadIds = useMemo(() => new Set(picks.map((p) => p.element)), [picks]);

  // Separate starters and bench
  const starters = picks.filter((p) => p.position <= 11);
  const bench = picks.filter((p) => p.position > 11);

  // Group starters by position
  const gkp = starters.filter((p) => p.elementType === 1);
  const def = starters.filter((p) => p.elementType === 2);
  const mid = starters.filter((p) => p.elementType === 3);
  const fwd = starters.filter((p) => p.elementType === 4);

  const selectedPick = picks.find((p) => p.element === selectedPlayerId) ?? null;

  const handlePlayerClick = (elementId: number) => {
    setSelectedPlayerId((prev) => (prev === elementId ? null : elementId));
  };

  // Render a row of players
  const renderRow = (players: EnrichedPick[]) => (
    <div className="flex justify-center gap-2 py-3">
      {players.map((pick) => (
        <PlayerCard
          key={pick.element}
          pick={pick}
          element={elementMap.get(pick.element)}
          team={teamMap.get(pick.teamId)}
          onClick={() => handlePlayerClick(pick.element)}
          isSelected={selectedPlayerId === pick.element}
        />
      ))}
    </div>
  );

  return (
    <div className="w-full">
      {/* Pitch Container */}
      <div
        className="relative rounded-xl overflow-hidden"
        style={{
          background: `
            linear-gradient(180deg,
              #1a472a 0%,
              #2d5a3d 10%,
              #1a472a 20%,
              #2d5a3d 30%,
              #1a472a 40%,
              #2d5a3d 50%,
              #1a472a 60%,
              #2d5a3d 70%,
              #1a472a 80%,
              #2d5a3d 90%,
              #1a472a 100%
            )
          `,
          minHeight: 420,
        }}
      >
        {/* Pitch markings */}
        <div className="absolute inset-0 pointer-events-none">
          {/* Center line */}
          <div
            className="absolute left-0 right-0 h-px bg-white/20"
            style={{ top: "50%" }}
          />
          {/* Center circle */}
          <div
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-24 rounded-full border border-white/20"
          />
          {/* Top penalty box */}
          <div
            className="absolute left-1/2 -translate-x-1/2 top-0 w-48 h-16 border-b border-l border-r border-white/20"
          />
          {/* Bottom penalty box */}
          <div
            className="absolute left-1/2 -translate-x-1/2 bottom-0 w-48 h-16 border-t border-l border-r border-white/20"
          />
        </div>

        {/* Player positions */}
        <div className="relative z-10 flex flex-col justify-between py-4" style={{ minHeight: 420 }}>
          {/* Forwards (top) */}
          {fwd.length > 0 && renderRow(fwd)}

          {/* Midfielders */}
          {mid.length > 0 && renderRow(mid)}

          {/* Defenders */}
          {def.length > 0 && renderRow(def)}

          {/* Goalkeeper (bottom) */}
          {gkp.length > 0 && renderRow(gkp)}
        </div>
      </div>

      {/* Bench Section */}
      <div className="mt-4 p-4 rounded-xl bg-gray-800/50 border border-gray-700">
        <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
          Bench
        </div>
        <div className="flex justify-center gap-4">
          {bench.map((pick) => (
            <PlayerCard
              key={pick.element}
              pick={pick}
              element={elementMap.get(pick.element)}
              team={teamMap.get(pick.teamId)}
              isBench
              onClick={() => handlePlayerClick(pick.element)}
              isSelected={selectedPlayerId === pick.element}
            />
          ))}
        </div>
      </div>

      {/* Replace Player Panel */}
      {selectedPick && elements.length > 0 && (
        <ReplacePlayerPanel
          selectedPick={selectedPick}
          elements={elements}
          teams={teams}
          squadIds={squadIds}
          onClose={() => setSelectedPlayerId(null)}
        />
      )}
    </div>
  );
}
