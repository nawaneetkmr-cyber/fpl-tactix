"use client";

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
  activeChip?: string | null;
}

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
  chipLabel,
}: {
  pick: EnrichedPick;
  element?: BootstrapElement;
  team?: FPLTeam;
  isBench?: boolean;
  chipLabel?: string | null;
}) {
  const isGK = pick.elementType === 1;
  const jerseyUrl = team
    ? isGK
      ? getGKJerseyUrl(team.code)
      : getJerseyUrl(team.code)
    : null;

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
          {jerseyUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={jerseyUrl}
              alt={pick.webName}
              width={48}
              height={48}
              loading="eager"
              style={{ objectFit: "contain" }}
            />
          ) : (
            <div className="w-12 h-12 rounded bg-gray-700 flex items-center justify-center text-gray-500 text-xs">
              ?
            </div>
          )}
        </div>

        {/* Captain badge */}
        {pick.isCaptain && (
          <div
            className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-yellow-500 flex items-center justify-center text-xs font-bold text-black"
            title="Captain"
          >
            {chipLabel === "3xc" ? "3x" : "\u2605"}
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

export default function PitchView({ picks, elements, teams, activeChip }: PitchViewProps) {
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

  // Chip label
  const chipLabels: Record<string, string> = {
    "3xc": "Triple Captain Active",
    bboost: "Bench Boost Active",
    freehit: "Free Hit Active",
    wildcard: "Wildcard Active",
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
          chipLabel={activeChip}
        />
      ))}
    </div>
  );

  return (
    <div className="w-full">
      {/* Active chip banner */}
      {activeChip && chipLabels[activeChip] && (
        <div className="flex items-center justify-center gap-2 py-2 px-4 bg-gradient-to-r from-purple-900/60 to-purple-800/30 border-b border-purple-700/50">
          <span className="text-purple-300 text-sm font-semibold">{chipLabels[activeChip]}</span>
        </div>
      )}

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
          <div
            className="absolute left-0 right-0 h-px bg-white/20"
            style={{ top: "50%" }}
          />
          <div
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-24 rounded-full border border-white/20"
          />
          <div
            className="absolute left-1/2 -translate-x-1/2 top-0 w-48 h-16 border-b border-l border-r border-white/20"
          />
          <div
            className="absolute left-1/2 -translate-x-1/2 bottom-0 w-48 h-16 border-t border-l border-r border-white/20"
          />
        </div>

        {/* Player positions */}
        <div className="relative z-10 flex flex-col justify-between py-4" style={{ minHeight: 420 }}>
          {fwd.length > 0 && renderRow(fwd)}
          {mid.length > 0 && renderRow(mid)}
          {def.length > 0 && renderRow(def)}
          {gkp.length > 0 && renderRow(gkp)}
        </div>
      </div>

      {/* Bench Section */}
      <div className={`mt-4 p-4 rounded-xl border ${
        activeChip === "bboost"
          ? "bg-purple-900/30 border-purple-700"
          : "bg-gray-800/50 border-gray-700"
      }`}>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Bench
          </span>
          {activeChip === "bboost" && (
            <span className="text-[10px] font-semibold text-purple-300 bg-purple-800/60 px-1.5 py-0.5 rounded">
              BENCH BOOST
            </span>
          )}
        </div>
        <div className="flex justify-center gap-4">
          {bench.map((pick) => (
            <PlayerCard
              key={pick.element}
              pick={pick}
              element={elementMap.get(pick.element)}
              team={teamMap.get(pick.teamId)}
              isBench={activeChip !== "bboost"}
              chipLabel={activeChip}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
