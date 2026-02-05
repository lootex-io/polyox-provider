from datetime import datetime, timedelta
import io
import os
import re
import time
import threading
from urllib.parse import urljoin, urlparse
from typing import Callable, TypeVar
from contextlib import contextmanager

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
import pdfplumber
import requests
from bs4 import BeautifulSoup
from nba_api.stats.endpoints import (
    scoreboardv2,
    boxscoretraditionalv3,
    boxscoreadvancedv3,
    commonallplayers,
    commonplayerinfo,
    commonteamroster
)
from nba_api.stats.library.http import NBAStatsHTTP

app = FastAPI(title="NBA API Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

T = TypeVar("T")

SCHEDULE_CACHE_TTL_SEC = int(os.getenv("NBA_SCHEDULE_CACHE_TTL_SEC", "3600"))
_SCHEDULE_CACHE: dict[tuple[int, str], tuple[float, dict]] = {}
PLAYER_INFO_CACHE_TTL_SEC = int(
    os.getenv("NBA_PLAYER_INFO_CACHE_TTL_SEC", "86400")
)
_PLAYER_INFO_CACHE: dict[str, tuple[float, dict]] = {}

PROXY_ENABLED = os.getenv("NBA_PROXY_ENABLED", "false").lower() in (
    "1",
    "true",
    "yes"
)
PROXY_SOURCE_URL = os.getenv(
    "NBA_PROXY_SOURCE_URL",
    "https://api.proxyscrape.com/v4/free-proxy-list/get?"
    "request=display_proxies&country=us&protocol=http&"
    "proxy_format=protocolipport&format=text&timeout=20000"
)
PROXY_REFRESH_SEC = max(
    60,
    int(os.getenv("NBA_PROXY_REFRESH_SEC", "900"))
)
_PROXY_STATE = {"proxies": [], "index": 0, "last_refresh": 0.0}
_PROXY_LOCK = threading.Lock()
_PROXY_REFRESH_STARTED = False

INJURY_REPORT_INDEX_URL = os.getenv(
    "NBA_INJURY_REPORT_INDEX_URL",
    "https://official.nba.com/nba-injury-report-2020-21-season/"
)


def _fetch_proxy_list() -> list[str]:
    session = requests.Session()
    session.trust_env = False
    response = session.get(PROXY_SOURCE_URL, timeout=10)
    if response.status_code >= 400:
        return []

    proxies: list[str] = []
    allowed_schemes = (
        "http://",
        "https://",
        "socks4://",
        "socks4a://",
        "socks5://",
        "socks5h://"
    )
    for raw in response.text.splitlines():
        proxy = raw.strip()
        if not proxy:
            continue
        if "://" not in proxy:
            proxy = f"http://{proxy}"
        proxy_lower = proxy.lower()
        if not proxy_lower.startswith(allowed_schemes):
            continue
        proxies.append(proxy)

    seen = set()
    deduped: list[str] = []
    for proxy in proxies:
        if proxy in seen:
            continue
        seen.add(proxy)
        deduped.append(proxy)
    return deduped


def _refresh_proxy_pool(force: bool = False) -> None:
    if not PROXY_ENABLED:
        return

    now = time.time()
    last_refresh = _PROXY_STATE["last_refresh"]
    if (
        not force
        and _PROXY_STATE["proxies"]
        and (now - last_refresh) < PROXY_REFRESH_SEC
    ):
        return

    proxies = _fetch_proxy_list()
    if proxies:
        _PROXY_STATE["proxies"] = proxies
        _PROXY_STATE["index"] = 0
        _PROXY_STATE["last_refresh"] = now
        print(f"proxy pool updated: {len(proxies)}")
    elif force:
        _PROXY_STATE["last_refresh"] = now


def _next_proxy() -> str | None:
    proxies: list[str] = _PROXY_STATE["proxies"]
    if not proxies:
        return None
    index = _PROXY_STATE["index"] % len(proxies)
    _PROXY_STATE["index"] = index + 1
    return proxies[index]


@contextmanager
def _proxy_context():
    if not PROXY_ENABLED:
        yield None
        return

    _PROXY_LOCK.acquire()
    proxy = None
    prev_http = os.environ.get("HTTP_PROXY")
    prev_https = os.environ.get("HTTPS_PROXY")
    try:
        _refresh_proxy_pool()
        proxy = _next_proxy()
        if proxy:
            os.environ["HTTP_PROXY"] = proxy
            os.environ["HTTPS_PROXY"] = proxy
        yield proxy
    finally:
        if prev_http is None:
            os.environ.pop("HTTP_PROXY", None)
        else:
            os.environ["HTTP_PROXY"] = prev_http
        if prev_https is None:
            os.environ.pop("HTTPS_PROXY", None)
        else:
            os.environ["HTTPS_PROXY"] = prev_https
        _PROXY_LOCK.release()


@app.on_event("startup")
def _start_proxy_refresh() -> None:
    global _PROXY_REFRESH_STARTED
    if not PROXY_ENABLED or _PROXY_REFRESH_STARTED:
        return
    _PROXY_REFRESH_STARTED = True

    def refresh_loop() -> None:
        while True:
            time.sleep(PROXY_REFRESH_SEC)
            with _PROXY_LOCK:
                _refresh_proxy_pool(force=True)

    with _PROXY_LOCK:
        _refresh_proxy_pool(force=True)
    threading.Thread(target=refresh_loop, daemon=True).start()


def _to_game_date(date_str: str) -> str:
    try:
        parsed = datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD") from exc

    return parsed.strftime("%m/%d/%Y")


def _pick(payload: dict, *keys: str):
    for key in keys:
        value = payload.get(key)
        if value is not None:
            return value
    return []


def _team_stats_from_boxscore(box: dict):
    teams = []
    for side in ("homeTeam", "awayTeam"):
        team = box.get(side) or {}
        stats = team.get("statistics") or {}
        team_id = team.get("teamId")
        if not team_id or not stats:
            continue
        row = {
            "teamId": team_id,
            "teamAbbreviation": team.get("teamTricode"),
            "teamCityName": team.get("teamCity"),
            "teamName": team.get("teamName"),
        }
        row.update(stats)
        teams.append(row)
    return teams


def _player_stats_from_boxscore(box: dict):
    rows = []
    for side in ("homeTeam", "awayTeam"):
        team = box.get(side) or {}
        team_id = team.get("teamId")
        starters = set(team.get("starters") or [])

        for player in team.get("players") or []:
            stats = player.get("statistics") or {}
            person_id = player.get("personId")
            first_name = player.get("firstName")
            last_name = player.get("familyName")
            display_name = " ".join(
                [name for name in [first_name, last_name] if name]
            ).strip()

            row = {
                "playerId": person_id,
                "playerName": display_name or player.get("nameI"),
                "firstName": first_name,
                "lastName": last_name,
                "teamId": team_id,
                "starter": person_id in starters if person_id else None,
                "didNotPlayReason": player.get("comment"),
            }
            row.update(stats)
            rows.append(row)
    return rows

def _with_retries(fn: Callable[[], T]) -> T:
    retries = int(os.getenv("NBA_API_RETRY", "2"))
    backoff_ms = int(os.getenv("NBA_API_RETRY_BACKOFF_MS", "500"))
    last_exc: Exception | None = None

    for attempt in range(retries + 1):
        try:
            with _proxy_context():
                return fn()
        except Exception as exc:
            last_exc = exc
            if attempt >= retries:
                break
            sleep_ms = backoff_ms * (2 ** attempt)
            time.sleep(sleep_ms / 1000)

    if last_exc:
        raise last_exc
    raise RuntimeError("NBA API request failed")


def _normalize_data_set(data_set: dict | None) -> list[dict]:
    if not data_set:
        return []
    headers = data_set.get("headers") or []
    rows = data_set.get("data") or []
    normalized: list[dict] = []
    for row in rows:
        normalized.append({headers[idx]: value for idx, value in enumerate(row)})
    return normalized


def _normalize_result_sets(payload: dict) -> dict:
    result_sets = payload.get("resultSets") or payload.get("resultSet") or []
    if isinstance(result_sets, dict):
        result_sets = [result_sets]

    normalized: dict = {}
    for result_set in result_sets:
        name = result_set.get("name") or result_set.get("name")
        headers = result_set.get("headers") or []
        rows = result_set.get("rowSet") or []
        if not name:
            continue
        normalized[name] = [
            {headers[idx]: value for idx, value in enumerate(row)}
            for row in rows
        ]
    return normalized


def _fetch_scoreboard_raw(game_date: str | None, timeout: int) -> dict:
    params = {"DayOffset": 0, "LeagueID": "00"}
    if game_date:
        params["GameDate"] = game_date
    response = NBAStatsHTTP().send_api_request(
        endpoint=scoreboardv2.ScoreboardV2.endpoint,
        parameters=params,
        timeout=timeout
    )
    try:
        data_sets = response.get_data_sets()
        return {
            "game_date": game_date,
            "game_header": _normalize_data_set(data_sets.get("GameHeader")),
            "line_score": _normalize_data_set(data_sets.get("LineScore"))
        }
    except Exception as exc:
        return {
            "game_date": game_date,
            "game_header": [],
            "line_score": [],
            "error": f"scoreboard_raw_parse_failed: {exc}"
        }


def _fetch_boxscore_raw(endpoint: str, game_id: str, timeout: int) -> dict:
    response = NBAStatsHTTP().send_api_request(
        endpoint=endpoint,
        parameters={"GameID": game_id},
        timeout=timeout
    )
    return response.get_dict()


def _parse_date(value: str) -> datetime.date:
    return datetime.strptime(value, "%Y-%m-%d").date()


def _season_year_from_date(value: datetime.date) -> int:
    # NBA season year aligns to the year the season starts (e.g., 2024 for 2024-25).
    return value.year if value.month >= 7 else value.year - 1


def _season_label_from_year(season_year: int) -> str:
    return f"{season_year}-{(season_year + 1) % 100:02d}"


def _fetch_schedule(season_year: int, season_type: str, timeout: int) -> dict:
    cache_key = (season_year, season_type)
    cached = _SCHEDULE_CACHE.get(cache_key)
    now = time.time()
    if cached and (now - cached[0]) < SCHEDULE_CACHE_TTL_SEC:
        return cached[1]

    season = _season_label_from_year(season_year)
    params = {
        "LeagueID": "00",
        "Season": season,
        "SeasonType": season_type
    }
    response = NBAStatsHTTP().send_api_request(
        endpoint="scheduleleaguev2",
        parameters=params,
        timeout=timeout
    )
    data = response.get_dict()
    _SCHEDULE_CACHE[cache_key] = (now, data)
    return data


def _fetch_common_player_info_raw(player_id: str, timeout: int) -> dict:
    response = NBAStatsHTTP().send_api_request(
        endpoint="commonplayerinfo",
        parameters={"PlayerID": player_id},
        timeout=timeout
    )
    return response.get_dict()


def _get_cached_player_info(player_id: str, allow_stale: bool = False) -> dict | None:
    cached = _PLAYER_INFO_CACHE.get(player_id)
    if not cached:
        return None
    cached_at, payload = cached
    if allow_stale or (time.time() - cached_at) <= PLAYER_INFO_CACHE_TTL_SEC:
        return payload
    return None


def _set_cached_player_info(player_id: str, payload: dict) -> None:
    _PLAYER_INFO_CACHE[player_id] = (time.time(), payload)


def _schedule_games_for_dates(data: dict, date_keys: set[str]) -> list[dict]:
    schedule = data.get("leagueSchedule", {}) or {}
    game_dates = schedule.get("gameDates", []) or []
    results: list[dict] = []
    for day in game_dates:
        for game in day.get("games", []) or []:
            date_est = game.get("gameDateEst")
            if date_est and date_est[:10] in date_keys:
                results.append(game)
    return results

def _normalize_header(value: str | None) -> str:
    text = str(value or "")
    text = re.sub(r"\s+", " ", text.replace("\n", " ")).strip().lower()
    return text


def _find_injury_report_links(html: str, base_url: str) -> list[str]:
    soup = BeautifulSoup(html, "html.parser")
    links: list[str] = []
    for anchor in soup.find_all("a", href=True):
        href = anchor["href"]
        if ".pdf" not in href.lower():
            continue
        if "injury" not in href.lower():
            continue
        links.append(urljoin(base_url, href))
    return links


def _extract_report_metadata_from_url(url: str) -> dict:
    filename = os.path.basename(urlparse(url).path)
    report_date = None
    report_time = None

    date_match = re.search(r"(\d{4})[-_]?(\d{2})[-_]?(\d{2})", filename)
    if date_match:
        report_date = (
            f"{date_match.group(1)}-{date_match.group(2)}-{date_match.group(3)}"
        )

    time_match = re.search(r"(\d{1,2})(?:[:_]?(\d{2}))?\s*(AM|PM)", filename, re.I)
    if time_match:
        hour = int(time_match.group(1))
        minute = int(time_match.group(2) or "0")
        ampm = time_match.group(3).upper()
        report_time = f"{hour}:{minute:02d} {ampm}"

    return {"report_date": report_date, "report_time": report_time}


def _select_latest_report_link(links: list[str]) -> str:
    if not links:
        raise ValueError("No injury report links found")

    scored: list[tuple[datetime, int, str]] = []
    for idx, link in enumerate(links):
        meta = _extract_report_metadata_from_url(link)
        dt_value = datetime.min
        if meta.get("report_date"):
            try:
                if meta.get("report_time"):
                    dt_value = datetime.strptime(
                        f"{meta['report_date']} {meta['report_time']}",
                        "%Y-%m-%d %I:%M %p"
                    )
                else:
                    dt_value = datetime.strptime(meta["report_date"], "%Y-%m-%d")
            except ValueError:
                dt_value = datetime.min
        scored.append((dt_value, idx, link))

    scored.sort(reverse=True)
    return scored[0][2]


def _map_table_headers(headers: list[str | None]) -> tuple[dict[int, str], list[str]]:
    alias_map = {
        "game date": "gameDate",
        "gamedate": "gameDate",
        "date": "gameDate",
        "game time": "gameTime",
        "gametime": "gameTime",
        "matchup": "matchup",
        "team": "team",
        "player name": "playerName",
        "player": "playerName",
        "current status": "status",
        "status": "status",
        "injury/illness": "injury",
        "injury": "injury",
        "reason": "reason",
        "remarks": "notes",
        "comment": "notes",
        "notes": "notes",
        "est. return date": "returnDate",
        "est return date": "returnDate"
    }

    mapping: dict[int, str] = {}
    normalized_headers: list[str] = []
    for idx, header in enumerate(headers):
        normalized = _normalize_header(header)
        normalized_headers.append(normalized)
        canonical = alias_map.get(normalized)
        if canonical:
            mapping[idx] = canonical
    return mapping, normalized_headers


def _build_entries_from_table(table: list[list[str | None]]) -> list[dict]:
    if not table or len(table) < 2:
        return []

    headers = table[0]
    mapping, normalized_headers = _map_table_headers(headers)
    if not mapping:
        return []

    entries: list[dict] = []
    for row in table[1:]:
        if not row:
            continue
        row_values = [(str(cell or "").replace("\n", " ").strip()) for cell in row]
        if not any(row_values):
            continue
        if any(_normalize_header(val) in ("player name", "player") for val in row_values):
            continue

        entry: dict = {}
        raw: dict = {}
        for idx, value in enumerate(row_values):
            header_label = normalized_headers[idx] if idx < len(normalized_headers) else f"col_{idx}"
            raw[header_label or f"col_{idx}"] = value
            if idx in mapping:
                entry[mapping[idx]] = value
        entry["raw"] = raw
        entries.append(entry)
    return entries


STATUS_OPTIONS = [
    "Game Time Decision",
    "Not With Team",
    "Questionable",
    "Probable",
    "Doubtful",
    "Available",
    "Suspended",
    "Out"
]


def _parse_player_status_reason(text: str) -> tuple[str | None, str | None, str | None]:
    if not text:
        return None, None, None
    for status in STATUS_OPTIONS:
        match = re.search(rf"\b{re.escape(status)}\b", text, flags=re.I)
        if match:
            player = text[:match.start()].strip()
            reason = text[match.end():].strip()
            return player or None, status, reason or None
    return text.strip(), None, None


def _clean_injury_line(line: str) -> str | None:
    if not line:
        return None
    if re.match(r"^Page\s*\d+\s*of\s*\d+", line, flags=re.I):
        return None
    line = re.sub(r"\s*Page\s*\d+\s*of\s*\d+\s*$", "", line, flags=re.I)
    line = re.sub(r"\s*Page\d+of\d+\s*$", "", line, flags=re.I)
    return line.strip() or None


def _apply_injury_context(entry: dict, context: dict) -> dict:
    for key in ("gameDate", "gameTime", "matchup", "team"):
        if not entry.get(key) and context.get(key):
            entry[key] = context.get(key)
    return entry


def _update_injury_context(entry: dict, context: dict) -> None:
    for key in ("gameDate", "gameTime", "matchup", "team"):
        if entry.get(key):
            context[key] = entry.get(key)
    context["lastEntry"] = entry


def _parse_injury_report_text(
    text: str, context: dict | None = None
) -> tuple[list[dict], dict]:
    entries: list[dict] = []
    context = context or {}
    current_date: str | None = context.get("gameDate")
    current_time: str | None = context.get("gameTime")
    current_matchup: str | None = context.get("matchup")
    current_team: str | None = context.get("team")
    last_entry: dict | None = context.get("lastEntry")

    for raw_line in (text or "").splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.lower().startswith("injury report"):
            continue
        if line.replace(" ", "").lower().startswith("gamedate"):
            continue
        line = _clean_injury_line(line)
        if not line:
            continue

        date_match = re.match(
            r"^(\d{2}/\d{2}/\d{4})\s+(\d{1,2}:\d{2}\(ET\))\s+(\S+)\s+(\S+)\s+(.*)$",
            line
        )
        time_match = re.match(
            r"^(\d{1,2}:\d{2}\(ET\))\s+(\S+)\s+(\S+)\s+(.*)$",
            line
        )

        if date_match:
            current_date = date_match.group(1)
            current_time = date_match.group(2)
            current_matchup = date_match.group(3)
            current_team = date_match.group(4)
            rest = date_match.group(5).strip()
            player, status, reason = _parse_player_status_reason(rest)
            entry = {
                "gameDate": current_date,
                "gameTime": current_time,
                "matchup": current_matchup,
                "team": current_team,
                "playerName": player,
                "status": status,
                "reason": reason
            }
            _apply_injury_context(entry, context)
            entries.append(entry)
            last_entry = entry
            _update_injury_context(entry, context)
            continue

        if time_match:
            current_time = time_match.group(1)
            current_matchup = time_match.group(2)
            current_team = time_match.group(3)
            rest = time_match.group(4).strip()
            player, status, reason = _parse_player_status_reason(rest)
            entry = {
                "gameDate": current_date,
                "gameTime": current_time,
                "matchup": current_matchup,
                "team": current_team,
                "playerName": player,
                "status": status,
                "reason": reason
            }
            _apply_injury_context(entry, context)
            entries.append(entry)
            last_entry = entry
            _update_injury_context(entry, context)
            continue

        has_status = any(
            re.search(rf"\b{re.escape(status)}\b", line, flags=re.I)
            for status in STATUS_OPTIONS
        )
        if "," not in line and not has_status:
            if last_entry is not None:
                existing_reason = last_entry.get("reason") or ""
                separator = " " if existing_reason else ""
                last_entry["reason"] = f"{existing_reason}{separator}{line}"
            continue

        tokens = line.split()
        if not tokens:
            continue

        rest = line
        if "," not in tokens[0]:
            current_team = tokens[0]
            rest = " ".join(tokens[1:]).strip()

        player, status, reason = _parse_player_status_reason(rest)
        if player or status or reason:
            entry = {
                "gameDate": current_date,
                "gameTime": current_time,
                "matchup": current_matchup,
                "team": current_team,
                "playerName": player,
                "status": status,
                "reason": reason
            }
            _apply_injury_context(entry, context)
            entries.append(entry)
            last_entry = entry
            _update_injury_context(entry, context)
            continue

    context["lastEntry"] = last_entry
    return entries, context


def _extract_injury_report_entries(pdf_bytes: bytes) -> list[dict]:
    entries: list[dict] = []
    context: dict = {}
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            text_entries, context = _parse_injury_report_text(
                page.extract_text() or "", context
            )
            entries.extend(text_entries)

            if not text_entries:
                table_settings = {
                    "vertical_strategy": "text",
                    "horizontal_strategy": "text",
                    "intersection_tolerance": 5,
                    "snap_tolerance": 3,
                    "join_tolerance": 2,
                    "min_words_vertical": 1,
                    "min_words_horizontal": 1
                }
                tables = page.extract_tables(table_settings) or []
                for table in tables:
                    table_entries = _build_entries_from_table(table)
                    for entry in table_entries:
                        _apply_injury_context(entry, context)
                        _update_injury_context(entry, context)
                    entries.extend(table_entries)
    return entries


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/scoreboard")
async def scoreboard(date: str = Query(None, description="YYYY-MM-DD")):
    timeout = int(os.getenv("NBA_API_TIMEOUT", "30"))
    game_date = _to_game_date(date) if date else None
    try:
        payload = _with_retries(
            lambda: scoreboardv2.ScoreboardV2(
                game_date=game_date, timeout=timeout
            ).get_normalized_dict()
        )

        return {
            "game_date": game_date,
            "game_header": payload.get("GameHeader", []),
            "line_score": payload.get("LineScore", [])
        }
    except Exception:
        try:
            return _with_retries(lambda: _fetch_scoreboard_raw(game_date, timeout))
        except Exception as raw_exc:
            return {
                "game_date": game_date,
                "game_header": [],
                "line_score": [],
                "error": f"scoreboard_failed: {raw_exc}"
            }


@app.get("/schedule")
async def schedule(
    date: str | None = Query(None, description="YYYY-MM-DD"),
    start: str | None = Query(None, alias="from", description="YYYY-MM-DD"),
    end: str | None = Query(None, alias="to", description="YYYY-MM-DD")
):
    if not date and not (start and end):
        raise HTTPException(
            status_code=400,
            detail="Provide date=YYYY-MM-DD or from=YYYY-MM-DD&to=YYYY-MM-DD"
        )

    timeout = int(os.getenv("NBA_API_TIMEOUT", "30"))

    if date:
        dates = [_parse_date(date)]
    else:
        start_date = _parse_date(start)
        end_date = _parse_date(end)
        if end_date < start_date:
            raise HTTPException(status_code=400, detail="from must be <= to")
        days = (end_date - start_date).days
        dates = [start_date]
        for offset in range(1, days + 1):
            dates.append(start_date + timedelta(days=offset))

    season_years = { _season_year_from_date(day) for day in dates }
    date_keys = { day.strftime("%Y-%m-%d") for day in dates }

    games_by_id: dict[str, dict] = {}
    for season_year in sorted(season_years):
        for season_type in ("Regular Season", "Playoffs"):
            data = _with_retries(
                lambda: _fetch_schedule(season_year, season_type, timeout)
            )
            for game in _schedule_games_for_dates(data, date_keys):
                game_id = game.get("gameId")
                if game_id:
                    games_by_id[game_id] = game

    games = list(games_by_id.values())

    return {
        "dates": [day.strftime("%Y-%m-%d") for day in dates],
        "games": [
            {
                "game_id": game.get("gameId"),
                "start_time_utc": game.get("gameDateTimeUTC"),
                "start_date_eastern": game.get("gameDateEst"),
                "start_time_eastern": game.get("gameDateTimeEst")
            }
            for game in games
        ]
    }


@app.get("/boxscore/traditional")
async def boxscore_traditional(game_id: str = Query(..., description="NBA GAME_ID")):
    timeout = int(os.getenv("NBA_API_TIMEOUT", "30"))

    try:
        payload = _with_retries(
            lambda: boxscoretraditionalv3.BoxScoreTraditionalV3(
                game_id=game_id, timeout=timeout
            ).get_dict()
        )
    except Exception:
        payload = _with_retries(
            lambda: _fetch_boxscore_raw(
                boxscoretraditionalv3.BoxScoreTraditionalV3.endpoint,
                game_id,
                timeout
            )
        )

    boxscore = payload.get("boxScoreTraditional", {})

    return {
        "team_stats": _team_stats_from_boxscore(boxscore),
        "player_stats": _player_stats_from_boxscore(boxscore)
    }


@app.get("/boxscore/advanced")
async def boxscore_advanced(game_id: str = Query(..., description="NBA GAME_ID")):
    timeout = int(os.getenv("NBA_API_TIMEOUT", "30"))

    try:
        payload = _with_retries(
            lambda: boxscoreadvancedv3.BoxScoreAdvancedV3(
                game_id=game_id, timeout=timeout
            ).get_dict()
        )
    except Exception:
        payload = _with_retries(
            lambda: _fetch_boxscore_raw(
                boxscoreadvancedv3.BoxScoreAdvancedV3.endpoint,
                game_id,
                timeout
            )
        )

    boxscore = payload.get("boxScoreAdvanced", {})

    return {
        "team_stats": _team_stats_from_boxscore(boxscore)
    }


@app.get("/players/all")
async def players_all(
    season: str = Query(..., description="e.g. 2024-25"),
    current_only: bool = Query(False)
):
    timeout = int(os.getenv("NBA_API_TIMEOUT", "30"))

    payload = _with_retries(
        lambda: commonallplayers.CommonAllPlayers(
            season=season,
            is_only_current_season=1 if current_only else 0,
            timeout=timeout
        ).get_normalized_dict()
    )

    return {
        "players": _pick(payload, "CommonAllPlayers", "commonAllPlayers")
    }


@app.get("/players/info")
async def player_info(player_id: str = Query(..., description="NBA PLAYER_ID")):
    timeout = int(os.getenv("NBA_API_TIMEOUT", "30"))

    cached = _get_cached_player_info(player_id)
    if cached:
        return cached

    try:
        payload = _with_retries(
            lambda: commonplayerinfo.CommonPlayerInfo(
                player_id=player_id, timeout=timeout
            ).get_normalized_dict()
        )
        response = {
            "player_info": _pick(payload, "CommonPlayerInfo", "commonPlayerInfo")
        }
        _set_cached_player_info(player_id, response)
        return response
    except Exception as exc:
        try:
            raw = _with_retries(
                lambda: _fetch_common_player_info_raw(player_id, timeout)
            )
            normalized = _normalize_result_sets(raw)
            response = {
                "player_info": _pick(
                    normalized, "CommonPlayerInfo", "commonPlayerInfo"
                )
            }
            if response["player_info"]:
                _set_cached_player_info(player_id, response)
            return response
        except Exception:
            stale = _get_cached_player_info(player_id, allow_stale=True)
            if stale:
                return {**stale, "cached": True, "stale": True}
            return {
                "player_info": [],
                "error": f"player_info_failed: {exc}"
            }


@app.get("/teams/roster")
async def team_roster(
    team_id: str = Query(..., description="NBA TEAM_ID"),
    season: str = Query(..., description="e.g. 2024-25")
):
    timeout = int(os.getenv("NBA_API_TIMEOUT", "30"))

    payload = _with_retries(
        lambda: commonteamroster.CommonTeamRoster(
            team_id=team_id, season=season, timeout=timeout
        ).get_normalized_dict()
    )

    return {
        "roster": _pick(payload, "CommonTeamRoster", "commonTeamRoster")
    }


@app.get("/injury-report/latest")
async def injury_report_latest():
    timeout = int(os.getenv("NBA_INJURY_REPORT_TIMEOUT", "30"))
    headers = {"User-Agent": "Mozilla/5.0"}

    try:
        response = requests.get(
            INJURY_REPORT_INDEX_URL, headers=headers, timeout=timeout
        )
    except Exception as exc:
        raise HTTPException(
            status_code=502, detail=f"Failed to fetch injury report index: {exc}"
        ) from exc

    if response.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail=f"Injury report index returned {response.status_code}"
        )

    links = _find_injury_report_links(response.text, INJURY_REPORT_INDEX_URL)
    if not links:
        raise HTTPException(status_code=502, detail="No injury report PDF links found")

    report_url = _select_latest_report_link(links)
    try:
        pdf_response = requests.get(report_url, headers=headers, timeout=timeout)
    except Exception as exc:
        raise HTTPException(
            status_code=502, detail=f"Failed to fetch injury report PDF: {exc}"
        ) from exc

    if pdf_response.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail=f"Injury report PDF returned {pdf_response.status_code}"
        )

    entries = _extract_injury_report_entries(pdf_response.content)
    meta = _extract_report_metadata_from_url(report_url)
    report = {"source_url": report_url, **meta}

    return {"report": report, "entries": entries}
