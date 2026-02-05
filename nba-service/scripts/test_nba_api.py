import os
import sys
import time

from nba_api.stats.endpoints import scoreboardv2
from nba_api.stats.library.http import NBAStatsHTTP


def _enable_custom_headers() -> None:
    enabled = os.getenv("NBA_API_CUSTOM_HEADERS", "").lower() in (
        "1",
        "true",
        "yes"
    )
    if not enabled:
        return

    NBAStatsHTTP.headers = {
        "Host": "stats.nba.com",
        "Connection": "keep-alive",
        "Accept": "application/json, text/plain, */*",
        "x-nba-stats-token": "true",
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        "x-nba-stats-origin": "stats",
        "Referer": "https://www.nba.com/",
        "Accept-Language": "en-US,en;q=0.9"
    }


def _test_scoreboard(timeout: int) -> None:
    date = os.getenv("NBA_TEST_DATE", "01/01/2026")
    started = time.time()
    payload = scoreboardv2.ScoreboardV2(
        game_date=date,
        timeout=timeout
    ).get_dict()
    elapsed = time.time() - started
    print(
        f"scoreboard ok in {elapsed:.2f}s "
        f"(resultSets={len(payload.get('resultSets', []))})"
    )


def _test_schedule(timeout: int) -> None:
    season_year = int(os.getenv("NBA_TEST_SEASON_YEAR", "2025"))
    season_type = os.getenv("NBA_TEST_SEASON_TYPE", "Regular Season")
    season = f"{season_year}-{(season_year + 1) % 100:02d}"
    started = time.time()
    payload = NBAStatsHTTP().send_api_request(
        endpoint="scheduleleaguev2",
        parameters={
            "LeagueID": "00",
            "Season": season,
            "SeasonType": season_type
        },
        timeout=timeout
    ).get_dict()
    elapsed = time.time() - started
    schedule = payload.get("leagueSchedule", {}) or {}
    game_dates = schedule.get("gameDates", []) or []
    print(
        f"schedule ok in {elapsed:.2f}s "
        f"(gameDates={len(game_dates)})"
    )


def main() -> int:
    mode = sys.argv[1].lower() if len(sys.argv) > 1 else "scoreboard"
    timeout = int(os.getenv("NBA_API_TIMEOUT", "30"))
    _enable_custom_headers()

    try:
        if mode == "scoreboard":
            _test_scoreboard(timeout)
        elif mode == "schedule":
            _test_schedule(timeout)
        else:
            print("Usage: python scripts/test_nba_api.py [scoreboard|schedule]")
            return 2
    except Exception as exc:
        print(f"error: {type(exc).__name__}: {exc}")
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
