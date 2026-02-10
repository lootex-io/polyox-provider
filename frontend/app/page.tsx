import Link from "next/link";

type SearchParams = Record<string, string | string[] | undefined>;

const serverApiBase =
  process.env.INTERNAL_API_BASE ||
  process.env.NEXT_PUBLIC_API_BASE ||
  "http://backend:3000";

function getParam(
  searchParams: SearchParams | undefined,
  key: string,
  fallback = ""
) {
  const value = searchParams?.[key];
  if (Array.isArray(value)) {
    return value[0] ?? fallback;
  }
  return value ?? fallback;
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

function formatDateTime(value?: string | null) {
  if (!value) {
    return "TBD";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  // Display tipoff in ET since the rest of the product uses "game date" in ET.
  const timeZone = "America/New_York";
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  // en-CA yields: "YYYY-MM-DD, HH:MM" (implementation-dependent literals)
  return `${dtf.format(parsed).replace(",", "")} ET`.replace(/\s+/g, " ").trim();
}

const TEAM_COLORS: Record<
  string,
  { bg: string; text: string }
> = {
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

function formatDateInTimeZone(date: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = dtf.formatToParts(date);
  const values: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }
  return `${values.year}-${values.month}-${values.day}`;
}

export default async function Home({
  searchParams
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const date = getParam(
    resolvedSearchParams,
    "date",
    formatDateInTimeZone(new Date(), "America/New_York")
  );

  const [teams, games] = await Promise.all([
    fetchJson(`${serverApiBase}/nba/teams`),
    fetchJson(
      `${serverApiBase}/nba/games?date=${date}&page=1&pageSize=50`
    )
  ]);

  const teamMap = new Map<string, { name?: string; abbrev?: string }>();
  if (Array.isArray(teams)) {
    for (const team of teams) {
      teamMap.set(team.id, team);
    }
  }

  const gameRows = Array.isArray(games?.data) ? games.data : [];
  const sortedGames = [...gameRows].sort((a, b) => {
    const aTime = a?.dateTimeUtc ? new Date(a.dateTimeUtc).getTime() : NaN;
    const bTime = b?.dateTimeUtc ? new Date(b.dateTimeUtc).getTime() : NaN;
    if (Number.isNaN(aTime) && Number.isNaN(bTime)) {
      return 0;
    }
    if (Number.isNaN(aTime)) {
      return 1;
    }
    if (Number.isNaN(bTime)) {
      return -1;
    }
    return aTime - bTime;
  });

  return (
    <main>
      <div className="badge">Daily Matchups</div>
      <h1>NBA Daily Slate</h1>
      <p>
        Pick a date to see matchups. Click a game to view player stats and the
        Polymarket markets tied to that day.
      </p>
      <section>
        <div className="section-header">
          <h2>x402 Paywall</h2>
          <Link className="inline-link" href="/x402">
            Try the one-time paid API
          </Link>
        </div>
        <p>
          Unlock a protected endpoint with a single 0.001 USDC payment on Base.
          After payment, the session is unlocked until the browser session ends.
        </p>
      </section>

      <section className="toolbar">
        <form className="date-form" method="get">
          <label className="field">
            <span>Date (ET)</span>
            <input name="date" defaultValue={date} />
          </label>
          <button type="submit">Load games</button>
        </form>
      </section>

      <section>
        <div className="section-header">
          <h2>Matchups</h2>
          <div className="hint">
            <div>{gameRows.length} games</div>
            <div>{`${serverApiBase}/nba/games?date=${date}&page=1&pageSize=50`}</div>
            <div>{`${serverApiBase}/nba/teams`}</div>
          </div>
        </div>
        <div className="matchup-list">
          {sortedGames.length === 0 ? (
            <div className="empty">No games for this date.</div>
          ) : (
            sortedGames.map((game: any) => {
              const home = teamMap.get(game.homeTeamId) ?? {};
              const away = teamMap.get(game.awayTeamId) ?? {};
              const homeLabel = home.name ?? home.abbrev ?? "Home";
              const awayLabel = away.name ?? away.abbrev ?? "Away";
              const score =
                game.homeScore !== null && game.awayScore !== null
                  ? `${awayLabel} ${game.awayScore} · ${homeLabel} ${game.homeScore}`
                  : `${awayLabel} vs ${homeLabel}`;
              return (
                <Link
                  key={game.id}
                  className="matchup-card"
                  href={`/games/${game.id}?date=${date}`}
                >
                  <div className="matchup-head">
                    <div className="matchup-title">{score}</div>
                    <span className={`status status-${game.status || "na"}`}>
                      {game.status || "unknown"}
                    </span>
                  </div>
                  <div className="matchup-tags">
                    {away.abbrev && game.awayTeamId ? (
                      <Link
                        className="team-tag"
                        style={teamTagStyle(away.abbrev)}
                        href={`/teams/${game.awayTeamId}`}
                      >
                        {away.abbrev}
                      </Link>
                    ) : null}
                    {home.abbrev && game.homeTeamId ? (
                      <Link
                        className="team-tag"
                        style={teamTagStyle(home.abbrev)}
                        href={`/teams/${game.homeTeamId}`}
                      >
                        {home.abbrev}
                      </Link>
                    ) : null}
                  </div>
                  <div className="matchup-meta">
                    <span>{formatDateTime(game.dateTimeUtc)}</span>
                    <span>Season {game.season}</span>
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </section>
    </main>
  );
}
