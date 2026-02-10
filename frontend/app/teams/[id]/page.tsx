import Link from "next/link";

type SearchParams = Record<string, string | string[] | undefined>;

const serverApiBase =
  process.env.INTERNAL_API_BASE ||
  process.env.NEXT_PUBLIC_API_BASE ||
  "http://backend:3000";

const TEAM_COLORS: Record<string, { bg: string; text: string }> = {
  ATL: { bg: "#E03A3E", text: "#ffffff" },
  BOS: { bg: "#007A33", text: "#ffffff" },
  BKN: { bg: "#000000", text: "#ffffff" },
  CHA: { bg: "#1D1160", text: "#ffffff" },
  CHI: { bg: "#CE1141", text: "#ffffff" },
  CLE: { bg: "#6F263D", text: "#ffffff" },
  DAL: { bg: "#0053BC", text: "#ffffff" },
  DEN: { bg: "#0E2240", text: "#ffffff" },
  DET: { bg: "#C8102E", text: "#ffffff" },
  GSW: { bg: "#1D428A", text: "#ffffff" },
  HOU: { bg: "#CE1141", text: "#ffffff" },
  IND: { bg: "#002D62", text: "#ffffff" },
  LAC: { bg: "#C8102E", text: "#ffffff" },
  LAL: { bg: "#552583", text: "#ffffff" },
  MEM: { bg: "#12173F", text: "#ffffff" },
  MIA: { bg: "#98002E", text: "#ffffff" },
  MIL: { bg: "#00471B", text: "#ffffff" },
  MIN: { bg: "#0C2340", text: "#ffffff" },
  NOP: { bg: "#0C2340", text: "#ffffff" },
  NYK: { bg: "#006BB6", text: "#ffffff" },
  OKC: { bg: "#007AC1", text: "#ffffff" },
  ORL: { bg: "#0077C0", text: "#ffffff" },
  PHI: { bg: "#006BB6", text: "#ffffff" },
  PHX: { bg: "#1D1160", text: "#ffffff" },
  POR: { bg: "#E03A3E", text: "#ffffff" },
  SAC: { bg: "#5A2D81", text: "#ffffff" },
  SAS: { bg: "#111111", text: "#ffffff" },
  TOR: { bg: "#CE1141", text: "#ffffff" },
  UTA: { bg: "#002B5C", text: "#ffffff" },
  WAS: { bg: "#002B5C", text: "#ffffff" }
};

function teamTagStyle(abbrev?: string) {
  if (!abbrev) {
    return undefined;
  }
  const color = TEAM_COLORS[abbrev.toUpperCase()];
  if (!color) {
    return undefined;
  }
  return { background: color.bg, color: color.text };
}

function formatDateOnlyEt(value?: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value).slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(parsed);
}

async function fetchJson(url: string) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      return { error: `HTTP ${res.status}` };
    }
    return res.json();
  } catch {
    return { error: "offline" };
  }
}

function renderTable(
  rows: any[],
  columns: Array<{ key: string; label: string }>
) {
  if (rows.length === 0) {
    return <div className="empty">No data.</div>;
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key}>{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={`${row.id ?? idx}`}>
              {columns.map((col) => (
                <td key={col.key}>{row[col.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function TeamPage({
  params
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<SearchParams>;
}) {
  const { id: teamId } = await params;

  const [team, players, recentGames, teams] = await Promise.all([
    fetchJson(`${serverApiBase}/nba/teams/${teamId}`),
    fetchJson(
      `${serverApiBase}/nba/players?teamId=${teamId}&currentOnly=true&page=1&pageSize=200`
    ),
    fetchJson(`${serverApiBase}/nba/games?teamId=${teamId}&page=1&pageSize=5`),
    fetchJson(`${serverApiBase}/nba/teams`)
  ]);

  const teamMap = new Map<string, { name?: string; abbrev?: string }>();
  if (Array.isArray(teams)) {
    for (const row of teams) {
      teamMap.set(row.id, row);
    }
  }

  const playerRows = Array.isArray(players?.data) ? players.data : [];
  const recentRows = Array.isArray(recentGames?.data) ? recentGames.data : [];

  return (
    <main>
      <Link className="back-link" href="/">
        ← Back to daily slate
      </Link>

      <div className="badge">Team Detail</div>
      <h1>
        {team?.name ?? "Team"} {" "}
        {team?.abbrev ? (
          <span className="team-tag" style={teamTagStyle(team.abbrev)}>
            {team.abbrev}
          </span>
        ) : null}
      </h1>
      <div className="hint">{`${serverApiBase}/nba/teams/${teamId}`}</div>

      <section>
        <div className="section-header">
          <h2>Recent Games</h2>
          <div className="hint">
            <div>Last 5</div>
            <div>{`${serverApiBase}/nba/games?teamId=${teamId}&page=1&pageSize=5`}</div>
            <div>{`${serverApiBase}/nba/teams`}</div>
          </div>
        </div>
        {renderTable(
          recentRows.map((row: any) => {
            const isHome = row.homeTeamId === teamId;
            const opponentId = isHome ? row.awayTeamId : row.homeTeamId;
            const opponent =
              (opponentId && teamMap.get(opponentId)?.abbrev) ||
              (opponentId && teamMap.get(opponentId)?.name) ||
              opponentId?.slice(0, 8) ||
              "Opp";
            const scored = isHome ? row.homeScore : row.awayScore;
            const allowed = isHome ? row.awayScore : row.homeScore;
            const result =
              scored !== null && allowed !== null
                ? `${scored}-${allowed} ${scored > allowed ? "W" : "L"}`
                : row.status ?? "-";
            return {
              date: formatDateOnlyEt(row.dateTimeUtc),
              opponent,
              result
            };
          }),
          [
            { key: "date", label: "Date" },
            { key: "opponent", label: "Opponent" },
            { key: "result", label: "Result" }
          ]
        )}
      </section>

      <section>
        <div className="section-header">
          <h2>Players</h2>
          <div className="hint">
            <div>Current roster</div>
            <div>
              {`${serverApiBase}/nba/players?teamId=${teamId}&currentOnly=true&page=1&pageSize=200`}
            </div>
          </div>
        </div>
        {renderTable(
          playerRows.map((player: any) => ({
            name: (
              <Link className="inline-link" href={`/players/${player.id}`}>
                {player.displayName ?? player.id}
              </Link>
            ),
            position: player.position ?? "-",
            status: player.isActive ? "Active" : "Inactive"
          })),
          [
            { key: "name", label: "Player" },
            { key: "position", label: "Pos" },
            { key: "status", label: "Status" }
          ]
        )}
      </section>
    </main>
  );
}
