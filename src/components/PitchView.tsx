"use client";

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

// ---------- Jersey URL Builder ----------

function getJerseyUrl(teamCode: number): string {
  // FPL serves jerseys at this URL pattern
  // shirt_TYPE_NUMBER.webp where TYPE is the team code
  return `https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_${teamCode}-110.webp`;
}

function getGKJerseyUrl(teamCode: number): string {
  // Goalkeeper jerseys have different pattern
  return `https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_${teamCode}_1-110.webp`;
}

// ---------- Player Card Component ----------

function PlayerCard({
  pick,
  element,
  team,
  isBench = false,
}: {
  pick: EnrichedPick;
  element?: BootstrapElement;
  team?: FPLTeam;
  isBench?: boolean;
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
      className={`flex flex-col items-center ${isBench ? "opacity-70" : ""}`}
      style={{ width: 70 }}
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
            ★
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

// ---------- Main PitchView Component ----------

export default function PitchView({ picks, elements, teams }: PitchViewProps) {
  // Create lookup maps
  const elementMap = new Map(elements.map((e) => [e.id, e]));
  const teamMap = new Map(teams.map((t) => [t.id, t]));

  // Separate starters and bench
  const starters = picks.filter((p) => p.position <= 11);
  const bench = picks.filter((p) => p.position > 11);

  // Group starters by position
  const gkp = starters.filter((p) => p.elementType === 1);
  const def = starters.filter((p) => p.elementType === 2);
  const mid = starters.filter((p) => p.elementType === 3);
  const fwd = starters.filter((p) => p.elementType === 4);

  // Render a row of players
  const renderRow = (players: EnrichedPick[], rowLabel: string) => (
    <div className="flex justify-center gap-2 py-3">
      {players.map((pick) => (
        <PlayerCard
          key={pick.element}
          pick={pick}
          element={elementMap.get(pick.element)}
          team={teamMap.get(pick.teamId)}
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
          {fwd.length > 0 && renderRow(fwd, "FWD")}

          {/* Midfielders */}
          {mid.length > 0 && renderRow(mid, "MID")}

          {/* Defenders */}
          {def.length > 0 && renderRow(def, "DEF")}

          {/* Goalkeeper (bottom) */}
          {gkp.length > 0 && renderRow(gkp, "GKP")}
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
            />
          ))}
        </div>
      </div>
    </div>
  );
}
