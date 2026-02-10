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
  return `${dtf.format(parsed).replace(",", "")} ET`.replace(/\s+/g, " ").trim();
}

function formatDateOnlyEt(value?: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value).slice(0, 10);
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return dtf.format(parsed);
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

function formatPriceSummary(prices: Array<any> | undefined) {
  if (!prices || prices.length === 0) {
    return "-";
  }
  return prices
    .map((item) => {
      const label = item.outcome || item.tokenId;
      const priceValue = item.price?.price ?? item.price?.Price ?? item.price;
      const price =
        priceValue !== undefined && priceValue !== null ? priceValue : "-";
      return `${label}: ${price}`;
    })
    .join(" | ");
}

function parseLevel(level: any) {
  if (!level) {
    return null;
  }
  if (Array.isArray(level)) {
    return { price: level[0], size: level[1] };
  }
  if (typeof level === "object") {
    return {
      price: level.price ?? level.px ?? level[0],
      size: level.size ?? level.qty ?? level[1]
    };
  }
  return null;
}

function formatOrderbookSummary(orderbooks: Array<any> | undefined) {
  if (!orderbooks || orderbooks.length === 0) {
    return "-";
  }
  return orderbooks
    .map((item) => {
      const label = item.outcome || item.tokenId;
      const book = item.orderbook || item.book || {};
      const bid = parseLevel((book.bids || [])[0]);
      const ask = parseLevel((book.asks || [])[0]);
      const bidText = bid ? `${bid.price} (${bid.size})` : "-";
      const askText = ask ? `${ask.price} (${ask.size})` : "-";
      return `${label} B:${bidText} / A:${askText}`;
    })
    .join(" | ");
}

export default async function GameDetail({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<SearchParams>;
}) {
  const { id: gameId } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const dateParam = getParam(resolvedSearchParams, "date");

  const [teams, game] = await Promise.all([
    fetchJson(`${serverApiBase}/nba/teams`),
    fetchJson(`${serverApiBase}/nba/games/${gameId}`)
  ]);

  const [teamStats, playerStats, gameMarkets, recentHome, recentAway] =
    await Promise.all([
      fetchJson(
        `${serverApiBase}/nba/team-game-stat?gameId=${gameId}&page=1&pageSize=50`
      ),
      fetchJson(
        `${serverApiBase}/nba/player-game-stat?gameId=${gameId}&page=1&pageSize=400&autoSync=true`
      ),
      fetchJson(
        `${serverApiBase}/nba/games/${gameId}/markets?page=1&pageSize=50`
      ),
      fetchJson(
        `${serverApiBase}/nba/games?teamId=${game?.homeTeamId ?? ""}&status=finished&page=1&pageSize=200`
      ),
      fetchJson(
        `${serverApiBase}/nba/games?teamId=${game?.awayTeamId ?? ""}&status=finished&page=1&pageSize=200`
      )
    ]);

  const marketList = Array.isArray(gameMarkets?.markets?.data)
    ? gameMarkets.markets.data
    : [];
  const marketIds = marketList
    .map((row: any) => row.polymarketMarketId)
    .filter((value: any) => value);
  const [livePrices, liveOrderbooks] = marketIds.length
    ? await Promise.all([
        fetchJson(
          `${serverApiBase}/polymarket/price?marketIds=${marketIds.join(",")}&side=buy`
        ),
        fetchJson(
          `${serverApiBase}/polymarket/orderbook?marketIds=${marketIds.join(",")}`
        )
      ])
    : [null, null];

  const priceByMarketId = new Map<number, any>();
  if (Array.isArray(livePrices?.markets)) {
    for (const entry of livePrices.markets) {
      if (entry?.marketId) {
        priceByMarketId.set(entry.marketId, entry);
      }
    }
  }

  const orderbookByMarketId = new Map<number, any>();
  if (Array.isArray(liveOrderbooks?.markets)) {
    for (const entry of liveOrderbooks.markets) {
      if (entry?.marketId) {
        orderbookByMarketId.set(entry.marketId, entry);
      }
    }
  }

  const teamMap = new Map<string, { name?: string; abbrev?: string }>();
  if (Array.isArray(teams)) {
    for (const team of teams) {
      teamMap.set(team.id, team);
    }
  }

  const home = teamMap.get(game?.homeTeamId) ?? {};
  const away = teamMap.get(game?.awayTeamId) ?? {};
  const homeLabel = home.name ?? home.abbrev ?? "Home";
  const awayLabel = away.name ?? away.abbrev ?? "Away";

  const gameDate = game?.dateTimeUtc
    ? formatDateOnlyEt(String(game.dateTimeUtc))
    : dateParam;
  const homeAbbrev = home?.abbrev?.toUpperCase();
  const awayAbbrev = away?.abbrev?.toUpperCase();
  const expectedMatchup =
    homeAbbrev && awayAbbrev ? `${awayAbbrev}@${homeAbbrev}` : null;

  const injuryReport = await fetchJson(
    `${serverApiBase}/nba/injury-reports/entries?date=${gameDate}&page=1&pageSize=500`
  );
  const injuryRows = Array.isArray(injuryReport?.entries?.data)
    ? injuryReport.entries.data.filter((row: any) => {
        if (expectedMatchup && row.matchup) {
          return String(row.matchup).toUpperCase() === expectedMatchup;
        }
        return [game?.homeTeamId, game?.awayTeamId].includes(row.teamId);
      })
    : [];
  const injuryReportMeta = injuryReport?.report ?? null;

  const teamStatRows = Array.isArray(teamStats?.data)
    ? teamStats.data.map((row: any) => ({
        team: teamMap.get(row.teamId)?.name ?? row.teamId,
        pts: row.pts,
        reb: row.reb,
        ast: row.ast,
        tov: row.tov
      }))
    : [];

  const playerRows = Array.isArray(playerStats?.data) ? playerStats.data : [];
  const playerRowsByTeam = new Map<string, any[]>();
  for (const row of playerRows) {
    const list = playerRowsByTeam.get(row.teamId) ?? [];
    list.push(row);
    playerRowsByTeam.set(row.teamId, list);
  }

  const renderPlayers = (teamId?: string) => {
    const rows = (teamId && playerRowsByTeam.get(teamId)) || [];
    const sorted = [...rows].sort((a, b) => (b.pts ?? 0) - (a.pts ?? 0));
    return renderTable(
      sorted.map((row) => ({
        name: (
          <Link className="inline-link" href={`/players/${row.playerId}`}>
            {row.player?.displayName ?? row.playerId}
          </Link>
        ),
        pts: row.pts,
        reb: row.reb,
        ast: row.ast,
        tov: row.tov,
        minutes: row.minutes ?? "-"
      })),
      [
        { key: "name", label: "Player" },
        { key: "pts", label: "PTS" },
        { key: "reb", label: "REB" },
        { key: "ast", label: "AST" },
        { key: "tov", label: "TOV" },
        { key: "minutes", label: "MIN" }
      ]
    );
  };

  const event = gameMarkets?.event ?? null;
  const marketRows = marketList.map((row: any) => {
    const marketId = row.polymarketMarketId;
    const priceEntry = marketId ? priceByMarketId.get(marketId) : null;
    const orderbookEntry = marketId ? orderbookByMarketId.get(marketId) : null;
    return {
      id: marketId,
      question: row.question ?? row.title ?? row.slug,
      event: event?.title ?? event?.slug ?? event?.polymarketEventId ?? "-",
      volume: row.volume ?? row.volume24hr ?? "-",
      liquidity: row.liquidity ?? "-",
      price: formatPriceSummary(priceEntry?.prices),
      orderbook: formatOrderbookSummary(orderbookEntry?.orderbooks)
    };
  });

  const isFinishedGame = (row: any) => {
    const status = String(row?.status || "").toLowerCase();
    if (status === "finished" || status === "final" || status === "complete") {
      return true;
    }
    return row?.homeScore !== null && row?.awayScore !== null;
  };

  const renderRecentGames = (rows: any[], teamId?: string) => {
    const cutoff = game?.dateTimeUtc
      ? new Date(game.dateTimeUtc).getTime()
      : null;
    const filtered = rows.filter((row) => {
      if (teamId && row.id === gameId) {
        return false;
      }
      if (!isFinishedGame(row)) {
        return false;
      }
      if (cutoff && row.dateTimeUtc) {
        return new Date(row.dateTimeUtc).getTime() < cutoff;
      }
      return true;
    });
    const recent = filtered.slice(0, 5);
    return renderTable(
      recent.map((row) => {
        const isHome = row.homeTeamId === teamId;
        const opponentId = isHome ? row.awayTeamId : row.homeTeamId;
        const opponent = teamMap.get(opponentId) ?? {};
        const opponentLabel = opponent.abbrev ?? opponent.name ?? "Opp";
        const scored = isHome ? row.homeScore : row.awayScore;
        const allowed = isHome ? row.awayScore : row.homeScore;
        const result =
          scored !== null && allowed !== null
            ? `${scored}-${allowed} ${scored > allowed ? "W" : "L"}`
            : row.status ?? "-";
        return {
          date: formatDateOnlyEt(row.dateTimeUtc),
          opponent: opponentLabel,
          result
        };
      }),
      [
        { key: "date", label: "Date" },
        { key: "opponent", label: "Opponent" },
        { key: "result", label: "Result" }
      ]
    );
  };

  return (
    <main>
      <Link className="back-link" href={`/?date=${dateParam || gameDate || ""}`}>
        ← Back to daily slate
      </Link>

      <div className="badge">Game Detail</div>
      <h1>
        <Link className="inline-link" href={`/teams/${game?.awayTeamId}`}>
          {awayLabel}
        </Link>{" "}
        @{" "}
        <Link className="inline-link" href={`/teams/${game?.homeTeamId}`}>
          {homeLabel}
        </Link>
      </h1>
      <p>
        {formatDateTime(game?.dateTimeUtc)} · Season {game?.season} ·{" "}
        {game?.status ?? "unknown"}
      </p>
      <div className="hint">{`${serverApiBase}/nba/games/${gameId}`}</div>
      <div className="hint">{`${serverApiBase}/nba/teams`}</div>

      <section>
        <div className="section-header">
          <h2>Team Stats</h2>
          <span className="hint">
            {`${serverApiBase}/nba/team-game-stat?gameId=${gameId}&page=1&pageSize=50`}
          </span>
        </div>
        {renderTable(teamStatRows, [
          { key: "team", label: "Team" },
          { key: "pts", label: "PTS" },
          { key: "reb", label: "REB" },
          { key: "ast", label: "AST" },
          { key: "tov", label: "TOV" }
        ])}
      </section>

      <section>
        <div className="section-header">
          <h2>Recent Form</h2>
          <div className="hint">
            <div>Last 5 finished games before this matchup</div>
            <div>
              {`${serverApiBase}/nba/games?teamId=${game?.awayTeamId ?? ""}&status=finished&page=1&pageSize=200`}
            </div>
            <div>
              {`${serverApiBase}/nba/games?teamId=${game?.homeTeamId ?? ""}&status=finished&page=1&pageSize=200`}
            </div>
          </div>
        </div>
        <div className="grid">
          <div>
            <div className="card-title">
              <span
                className="team-tag"
                style={teamTagStyle(away.abbrev)}
              >
                {away.abbrev ?? awayLabel}
              </span>
            </div>
            {renderRecentGames(
              Array.isArray(recentAway?.data) ? recentAway.data : [],
              game?.awayTeamId
            )}
          </div>
          <div>
            <div className="card-title">
              <span
                className="team-tag"
                style={teamTagStyle(home.abbrev)}
              >
                {home.abbrev ?? homeLabel}
              </span>
            </div>
            {renderRecentGames(
              Array.isArray(recentHome?.data) ? recentHome.data : [],
              game?.homeTeamId
            )}
          </div>
        </div>
      </section>

      <section>
        <div className="section-header">
          <h2>Injury Report</h2>
          <div className="hint">
            <div>
              {injuryReportMeta?.reportDate
                ? `${injuryReportMeta.reportDate} ${injuryReportMeta.reportTime || ""}`.trim()
                : "latest"}
            </div>
            <div>
              {`${serverApiBase}/nba/injury-reports/entries?date=${gameDate}&page=1&pageSize=500`}
            </div>
          </div>
        </div>
        {injuryReport?.error ? (
          <div className="error">Failed to load injury report.</div>
        ) : injuryRows.length === 0 ? (
          <div className="empty">No injury report entries for this game.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Team</th>
                  <th>Player</th>
                  <th>Status</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {injuryRows.map((row: any, idx: number) => (
                  <tr key={`${row.playerName}-${row.teamId}-${idx}`}>
                    <td>
                      {teamMap.get(row.teamId)?.name ||
                        row.teamAbbrev ||
                        row.teamId ||
                        "-"}
                    </td>
                    <td>{row.playerName || row.playerId || "-"}</td>
                    <td>{row.status || "-"}</td>
                    <td>{row.reason || row.injury || row.notes || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <div className="section-header">
          <h2>{awayLabel} Players</h2>
          <span className="hint">
            {`${serverApiBase}/nba/player-game-stat?gameId=${gameId}&page=1&pageSize=400&autoSync=true`}
          </span>
        </div>
        {renderPlayers(game?.awayTeamId)}
      </section>

      <section>
        <div className="section-header">
          <h2>{homeLabel} Players</h2>
          <span className="hint">
            {`${serverApiBase}/nba/player-game-stat?gameId=${gameId}&page=1&pageSize=400&autoSync=true`}
          </span>
        </div>
        {renderPlayers(game?.homeTeamId)}
      </section>

      <section>
        <div className="section-header">
          <h2>Polymarket Markets</h2>
          <div className="hint">
            <div>{`${serverApiBase}/nba/games/${gameId}/markets?page=1&pageSize=50`}</div>
            <div>{`${serverApiBase}/polymarket/price?marketIds=...&side=buy`}</div>
            <div>{`${serverApiBase}/polymarket/orderbook?marketIds=...`}</div>
          </div>
        </div>
        <div className="market-event">
          <div>
            <div className="card-title">Event</div>
            <div className="value">{event?.title ?? "Not linked yet"}</div>
            <p>{event?.slug ?? ""}</p>
          </div>
          <div>
            <div className="card-title">Event Date</div>
            <div className="value">
              {event?.startDate ? formatDateTime(event.startDate) : gameDate}
            </div>
            <p>Polymarket ID: {event?.polymarketEventId ?? "-"}</p>
          </div>
        </div>
        {renderTable(marketRows, [
          { key: "id", label: "Market ID" },
          { key: "question", label: "Question" },
          { key: "event", label: "Event" },
          { key: "volume", label: "Volume" },
          { key: "liquidity", label: "Liquidity" },
          { key: "price", label: "Live Price" },
          { key: "orderbook", label: "Orderbook Top" }
        ])}
      </section>
    </main>
  );
}
