import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query
} from "@nestjs/common";
import {
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags
} from "@nestjs/swagger";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { NbaService } from "./nba.service";
import {
  GameAnalysisRequestDto,
  GameAnalysisResponseDto,
  GameContextResponseDto,
  GameDto,
  GameMarketsResponseDto,
  InjuryReportEntriesResponseDto,
  PaginatedDataConflictDto,
  PaginatedGameDto,
  PaginatedInjuryReportDto,
  PaginatedPlayerDto,
  PaginatedPlayerGameStatDto,
  PaginatedTeamGameStatDto,
  PlayerDto,
  SyncJobResponseDto,
  SyncRangeResponseDto,
  TeamDto
} from "./dto/swagger.dto";

@Controller("nba")
@ApiTags("NBA")
export class NbaController {
  constructor(
    private readonly nbaService: NbaService,
    @InjectQueue("nba-sync") private readonly queue: Queue
  ) {}

  @Post("sync/scoreboard")
  @ApiOperation({ summary: "Enqueue scoreboard sync" })
  @ApiQuery({ name: "date", required: false, description: "YYYY-MM-DD" })
  @ApiOkResponse({
    description: "BullMQ job enqueued for scoreboard sync.",
    type: SyncJobResponseDto
  })
  async syncScoreboard(@Query("date") date?: string) {
    return this.queue.add("sync-scoreboard", date ? { date } : {});
  }

  @Post("sync/final-results")
  @ApiOperation({ summary: "Enqueue final results sync" })
  @ApiQuery({ name: "date", required: false, description: "YYYY-MM-DD" })
  @ApiOkResponse({
    description: "BullMQ job enqueued for final results sync.",
    type: SyncJobResponseDto
  })
  async syncFinalResults(@Query("date") date?: string) {
    return this.queue.add("sync-final-results", date ? { date } : {});
  }

  @Post("sync/player-game-stats")
  @ApiOperation({ summary: "Enqueue player game stats sync" })
  @ApiQuery({ name: "date", required: false, description: "YYYY-MM-DD" })
  @ApiQuery({ name: "gameId", required: false, description: "NBA GAME_ID" })
  @ApiOkResponse({
    description: "BullMQ job enqueued for player game stats sync.",
    type: SyncJobResponseDto
  })
  async syncPlayerGameStats(
    @Query("date") date?: string,
    @Query("gameId") gameId?: string
  ) {
    if (!date && !gameId) {
      throw new BadRequestException("date or gameId is required");
    }
    return this.queue.add("sync-player-game-stats", { date, gameId });
  }

  @Post("sync/players")
  @ApiOperation({ summary: "Enqueue players sync" })
  @ApiQuery({ name: "season", required: true, description: "e.g. 2024-25" })
  @ApiOkResponse({
    description: "BullMQ job enqueued for players sync.",
    type: SyncJobResponseDto
  })
  async syncPlayers(@Query("season") season: string) {
    if (!season) {
      throw new BadRequestException("season is required, e.g. 2024-25");
    }
    return this.queue.add("sync-players", { season });
  }

  @Post("sync/player-season-teams")
  @ApiOperation({ summary: "Enqueue player season teams sync" })
  @ApiQuery({ name: "season", required: true, description: "e.g. 2024-25" })
  @ApiOkResponse({
    description: "BullMQ job enqueued for player season teams sync.",
    type: SyncJobResponseDto
  })
  async syncPlayerSeasonTeams(@Query("season") season: string) {
    if (!season) {
      throw new BadRequestException("season is required, e.g. 2024-25");
    }
    return this.queue.add("sync-player-season-teams", { season });
  }

  @Post("sync/injury-report")
  @ApiOperation({ summary: "Enqueue injury report sync" })
  @ApiOkResponse({
    description: "BullMQ job enqueued for injury report sync.",
    type: SyncJobResponseDto
  })
  async syncInjuryReport() {
    return this.queue.add("sync-injury-report", {});
  }

  @Post("sync/range")
  @ApiOperation({ summary: "Enqueue range sync" })
  @ApiQuery({ name: "from", required: true, description: "YYYY-MM-DD" })
  @ApiQuery({ name: "to", required: true, description: "YYYY-MM-DD" })
  @ApiQuery({ name: "mode", required: false, description: "scoreboard|final|player|both" })
  @ApiOkResponse({
    description: "Range sync enqueued for each date in range.",
    type: SyncRangeResponseDto
  })
  async syncRange(
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("mode") mode?: string
  ) {
    if (!from || !to) {
      throw new BadRequestException("from/to are required, e.g. 2026-02-01");
    }

    const maxDays = Number(process.env.NBA_SYNC_RANGE_MAX_DAYS || 0);
    const dates = this.expandDates(from, to, maxDays);

    const shouldScoreboard = mode !== "final";
    const shouldFinal = mode !== "scoreboard";

    const jobs: unknown[] = [];
    for (const date of dates) {
      if (shouldScoreboard) {
        jobs.push(await this.queue.add("sync-scoreboard", { date }));
      }
      if (shouldFinal) {
        jobs.push(await this.queue.add("sync-final-results", { date }));
      }
    }

    return {
      dates,
      jobs: jobs.length
    };
  }

  @Get("teams")
  @ApiOperation({ summary: "List teams" })
  @ApiOkResponse({
    description: "List NBA teams.",
    type: TeamDto,
    isArray: true
  })
  async listTeams() {
    return this.nbaService.listTeams();
  }

  @Get("teams/:id")
  @ApiOperation({ summary: "Get team" })
  @ApiParam({ name: "id", required: true })
  @ApiOkResponse({
    description: "Get a team by id.",
    type: TeamDto
  })
  async getTeam(@Param("id") id: string) {
    const team = await this.nbaService.getTeam(id);
    if (!team) {
      throw new NotFoundException("team not found");
    }
    return team;
  }

  @Get("games")
  @ApiOperation({ summary: "List games" })
  @ApiQuery({ name: "date", required: false, description: "YYYY-MM-DD" })
  @ApiQuery({ name: "from", required: false, description: "YYYY-MM-DD" })
  @ApiQuery({ name: "to", required: false, description: "YYYY-MM-DD" })
  @ApiQuery({ name: "status", required: false })
  @ApiQuery({ name: "season", required: false })
  @ApiQuery({ name: "teamId", required: false })
  @ApiQuery({ name: "page", required: false })
  @ApiQuery({ name: "pageSize", required: false })
  @ApiOkResponse({
    description: "List games with pagination.",
    type: PaginatedGameDto
  })
  async listGames(
    @Query("date") date?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("status") status?: string,
    @Query("season") season?: string,
    @Query("teamId") teamId?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string
  ) {
    if ((from && !to) || (!from && to)) {
      throw new BadRequestException("from/to must be used together");
    }
    if (date && (from || to)) {
      throw new BadRequestException("date and from/to are mutually exclusive");
    }
    if (from && to) {
      const fromDate = this.parseDate(from);
      const toDate = this.parseDate(to);
      if (toDate.getTime() < fromDate.getTime()) {
        throw new BadRequestException("to must be >= from");
      }
    }

    return this.nbaService.listGames({
      date,
      from,
      to,
      status,
      season: season ? Number(season) : undefined,
      teamId,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined
    });
  }

  @Get("games/:id")
  @ApiOperation({ summary: "Get game" })
  @ApiParam({ name: "id", required: true })
  @ApiOkResponse({
    description: "Get a game by id.",
    type: GameDto
  })
  async getGame(@Param("id") id: string) {
    const game = await this.nbaService.getGame(id);
    if (!game) {
      throw new NotFoundException("game not found");
    }
    return game;
  }

  @Get("games/context")
  @ApiOperation({
    summary: "Get game context by date + team abbreviations"
  })
  @ApiQuery({ name: "date", required: true, description: "YYYY-MM-DD" })
  @ApiQuery({ name: "home", required: true, description: "Home team abbrev" })
  @ApiQuery({ name: "away", required: true, description: "Away team abbrev" })
  @ApiQuery({ name: "matchupLimit", required: false })
  @ApiQuery({ name: "recentLimit", required: false })
  @ApiQuery({ name: "marketPage", required: false })
  @ApiQuery({ name: "marketPageSize", required: false })
  @ApiOkResponse({
    description: "Aggregated context for a single matchup.",
    type: GameContextResponseDto
  })
  async getGameContextByMatchup(
    @Query("date") date?: string,
    @Query("home") home?: string,
    @Query("away") away?: string,
    @Query("matchupLimit") matchupLimit?: string,
    @Query("recentLimit") recentLimit?: string,
    @Query("marketPage") marketPage?: string,
    @Query("marketPageSize") marketPageSize?: string
  ) {
    if (!date) {
      throw new BadRequestException("date is required, YYYY-MM-DD");
    }
    if (!home || !away) {
      throw new BadRequestException("home and away are required");
    }
    this.parseDate(date);

    const context = await this.nbaService.getGameContextByMatchup({
      date,
      home,
      away,
      matchupLimit: matchupLimit ? Number(matchupLimit) : undefined,
      recentLimit: recentLimit ? Number(recentLimit) : undefined,
      marketPage: marketPage ? Number(marketPage) : undefined,
      marketPageSize: marketPageSize ? Number(marketPageSize) : undefined
    });
    if (!context) {
      throw new NotFoundException("game not found");
    }
    return this.stripContextFields(context);
  }

  @Get("games/:id/markets")
  @ApiOperation({ summary: "List Polymarket markets for game" })
  @ApiParam({ name: "id", required: true })
  @ApiQuery({ name: "page", required: false })
  @ApiQuery({ name: "pageSize", required: false })
  @ApiOkResponse({
    description: "Polymarket event and markets for the given game.",
    type: GameMarketsResponseDto
  })
  async listGameMarkets(
    @Param("id") id: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string
  ) {
    return this.nbaService.listPolymarketMarketsForGame(id, {
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined
    });
  }

  @Post("analysis")
  @ApiOperation({ summary: "AI analysis for a matchup (x402 paid)" })
  @ApiBody({ type: GameAnalysisRequestDto })
  @ApiOkResponse({
    description: "AI analysis result with win probabilities.",
    type: GameAnalysisResponseDto
  })
  async analyzeGame(@Body() body: GameAnalysisRequestDto) {
    if (!body?.date) {
      throw new BadRequestException("date is required, YYYY-MM-DD");
    }
    if (!body?.home || !body?.away) {
      throw new BadRequestException("home and away are required");
    }

    this.parseDate(body.date);

    const result = await this.nbaService.analyzeGameByMatchup(
      {
        date: body.date,
        home: body.home,
        away: body.away
      },
      {
        matchupLimit:
          body.matchupLimit !== undefined ? Number(body.matchupLimit) : undefined,
        recentLimit:
          body.recentLimit !== undefined ? Number(body.recentLimit) : undefined
      }
    );

    if (!result) {
      throw new NotFoundException("game not found");
    }

    return result;
  }

  @Get("players")
  @ApiOperation({ summary: "List players" })
  @ApiQuery({ name: "search", required: false })
  @ApiQuery({ name: "isActive", required: false, description: "true|false" })
  @ApiQuery({ name: "teamId", required: false })
  @ApiQuery({ name: "season", required: false })
  @ApiQuery({ name: "currentOnly", required: false, description: "true|false" })
  @ApiQuery({ name: "page", required: false })
  @ApiQuery({ name: "pageSize", required: false })
  @ApiOkResponse({
    description: "List players with pagination.",
    type: PaginatedPlayerDto
  })
  async listPlayers(
    @Query("search") search?: string,
    @Query("isActive") isActive?: string,
    @Query("teamId") teamId?: string,
    @Query("season") season?: string,
    @Query("currentOnly") currentOnly?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string
  ) {
    return this.nbaService.listPlayers({
      search,
      isActive: this.parseBoolean(isActive),
      teamId,
      season: season ? Number(season) : undefined,
      currentOnly: this.parseBoolean(currentOnly) ?? false,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined
    });
  }

  @Get("players/:id")
  @ApiOperation({ summary: "Get player" })
  @ApiParam({ name: "id", required: true })
  @ApiOkResponse({
    description: "Get a player by id.",
    type: PlayerDto
  })
  async getPlayer(@Param("id") id: string) {
    const player = await this.nbaService.getPlayer(id);
    if (!player) {
      throw new NotFoundException("player not found");
    }
    return player;
  }

  @Get("team-stats")
  @ApiOperation({ summary: "List team stats" })
  @ApiQuery({ name: "gameId", required: false })
  @ApiQuery({ name: "teamId", required: false })
  @ApiQuery({ name: "page", required: false })
  @ApiQuery({ name: "pageSize", required: false })
  @ApiOkResponse({
    description: "List team game stats with pagination.",
    type: PaginatedTeamGameStatDto
  })
  async listTeamStats(
    @Query("gameId") gameId?: string,
    @Query("teamId") teamId?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string
  ) {
    return this.nbaService.listTeamStats({
      gameId,
      teamId,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined
    });
  }

  @Get("team-game-stat")
  @ApiOperation({ summary: "List team game stats" })
  @ApiQuery({ name: "gameId", required: false })
  @ApiQuery({ name: "teamId", required: false })
  @ApiQuery({ name: "page", required: false })
  @ApiQuery({ name: "pageSize", required: false })
  @ApiOkResponse({
    description: "List team game stats with pagination (alias of team-stats).",
    type: PaginatedTeamGameStatDto
  })
  async listTeamGameStat(
    @Query("gameId") gameId?: string,
    @Query("teamId") teamId?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string
  ) {
    return this.nbaService.listTeamStats({
      gameId,
      teamId,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined
    });
  }

  @Get("player-stats")
  @ApiOperation({ summary: "List player stats" })
  @ApiQuery({ name: "gameId", required: false })
  @ApiQuery({ name: "playerId", required: false })
  @ApiQuery({ name: "teamId", required: false })
  @ApiQuery({ name: "page", required: false })
  @ApiQuery({ name: "pageSize", required: false })
  @ApiOkResponse({
    description: "List player stats with pagination.",
    type: PaginatedPlayerGameStatDto
  })
  async listPlayerStats(
    @Query("gameId") gameId?: string,
    @Query("playerId") playerId?: string,
    @Query("teamId") teamId?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string
  ) {
    return this.nbaService.listPlayerStats({
      gameId,
      playerId,
      teamId,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined
    });
  }

  @Get("player-game-stat")
  @ApiOperation({ summary: "List player game stats" })
  @ApiQuery({ name: "gameId", required: false })
  @ApiQuery({ name: "playerId", required: false })
  @ApiQuery({ name: "teamId", required: false })
  @ApiQuery({ name: "autoSync", required: false, description: "true|false" })
  @ApiQuery({ name: "page", required: false })
  @ApiQuery({ name: "pageSize", required: false })
  @ApiOkResponse({
    description: "List player game stats with pagination (supports autoSync).",
    type: PaginatedPlayerGameStatDto
  })
  async listPlayerGameStat(
    @Query("gameId") gameId?: string,
    @Query("playerId") playerId?: string,
    @Query("teamId") teamId?: string,
    @Query("autoSync") autoSync?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string
  ) {
    return this.nbaService.listPlayerStats({
      gameId,
      playerId,
      teamId,
      autoSync: this.parseBoolean(autoSync) ?? false,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined
    });
  }

  @Get("conflicts")
  @ApiOperation({ summary: "List data conflicts" })
  @ApiQuery({ name: "conflictType", required: false })
  @ApiQuery({ name: "playerId", required: false })
  @ApiQuery({ name: "season", required: false })
  @ApiQuery({ name: "page", required: false })
  @ApiQuery({ name: "pageSize", required: false })
  @ApiOkResponse({
    description: "List data conflicts with pagination.",
    type: PaginatedDataConflictDto
  })
  async listConflicts(
    @Query("conflictType") conflictType?: string,
    @Query("playerId") playerId?: string,
    @Query("season") season?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string
  ) {
    return this.nbaService.listConflicts({
      conflictType,
      playerId,
      season: season ? Number(season) : undefined,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined
    });
  }

  @Get("injury-reports/latest")
  @ApiOperation({ summary: "Get latest injury report entries" })
  @ApiQuery({ name: "reportId", required: false })
  @ApiQuery({ name: "date", required: false, description: "YYYY-MM-DD" })
  @ApiQuery({ name: "from", required: false, description: "YYYY-MM-DD" })
  @ApiQuery({ name: "to", required: false, description: "YYYY-MM-DD" })
  @ApiQuery({ name: "team", required: false })
  @ApiQuery({ name: "status", required: false })
  @ApiQuery({ name: "page", required: false })
  @ApiQuery({ name: "pageSize", required: false })
  @ApiOkResponse({
    description: "Latest injury report with paginated entries.",
    type: InjuryReportEntriesResponseDto
  })
  async listLatestInjuryReport(
    @Query("reportId") reportId?: string,
    @Query("date") date?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("team") team?: string,
    @Query("status") status?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string
  ) {
    return this.nbaService.listInjuryReportEntries({
      reportId,
      date,
      from,
      to,
      team,
      status,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined
    });
  }

  @Get("injury-reports")
  @ApiOperation({ summary: "List injury reports" })
  @ApiQuery({ name: "date", required: false, description: "YYYY-MM-DD" })
  @ApiQuery({ name: "from", required: false, description: "YYYY-MM-DD" })
  @ApiQuery({ name: "to", required: false, description: "YYYY-MM-DD" })
  @ApiQuery({ name: "page", required: false })
  @ApiQuery({ name: "pageSize", required: false })
  @ApiOkResponse({
    description: "List injury reports with pagination.",
    type: PaginatedInjuryReportDto
  })
  async listInjuryReports(
    @Query("date") date?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string
  ) {
    return this.nbaService.listInjuryReports({
      date,
      from,
      to,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined
    });
  }

  @Get("injury-reports/entries")
  @ApiOperation({ summary: "List injury report entries" })
  @ApiQuery({ name: "reportId", required: false })
  @ApiQuery({ name: "date", required: false, description: "YYYY-MM-DD" })
  @ApiQuery({ name: "from", required: false, description: "YYYY-MM-DD" })
  @ApiQuery({ name: "to", required: false, description: "YYYY-MM-DD" })
  @ApiQuery({ name: "team", required: false })
  @ApiQuery({ name: "status", required: false })
  @ApiQuery({ name: "page", required: false })
  @ApiQuery({ name: "pageSize", required: false })
  @ApiOkResponse({
    description: "Injury report entries with the resolved report metadata.",
    type: InjuryReportEntriesResponseDto
  })
  async listInjuryReportEntries(
    @Query("reportId") reportId?: string,
    @Query("date") date?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("team") team?: string,
    @Query("status") status?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string
  ) {
    return this.nbaService.listInjuryReportEntries({
      reportId,
      date,
      from,
      to,
      team,
      status,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined
    });
  }

  private parseBoolean(value?: string) {
    if (value === undefined) {
      return undefined;
    }
    if (value === "true" || value === "1") {
      return true;
    }
    if (value === "false" || value === "0") {
      return false;
    }
    return undefined;
  }

  private expandDates(from: string, to: string, maxDays: number) {
    const start = this.parseDate(from);
    const end = this.parseDate(to);

    if (end.getTime() < start.getTime()) {
      throw new BadRequestException("to must be >= from");
    }

    const dates: string[] = [];
    const cursor = new Date(start);
    let count = 0;

    while (cursor.getTime() <= end.getTime()) {
      dates.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      count += 1;
      if (maxDays > 0 && count > maxDays) {
        throw new BadRequestException(
          `range too large, max days = ${maxDays}`
        );
      }
    }

    return dates;
  }

  private parseDate(value: string) {
    const parsed = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException("date must be YYYY-MM-DD");
    }
    return parsed;
  }

  private stripContextFields<T>(value: T): T {
    const shouldOmit = (key: string) => {
      const normalized = key.toLowerCase();
      if (normalized === "id") {
        return true;
      }
      if (normalized.endsWith("id") || normalized.endsWith("_id")) {
        return true;
      }
      if (
        normalized === "createdat" ||
        normalized === "updatedat" ||
        normalized === "created_at" ||
        normalized === "updated_at"
      ) {
        return true;
      }
      return false;
    };

    const visit = (input: any): any => {
      if (input === null || input === undefined) {
        return input;
      }
      if (input instanceof Date) {
        return input;
      }
      if (Array.isArray(input)) {
        return input.map(visit);
      }
      if (typeof input === "object") {
        const result: Record<string, any> = {};
        for (const [key, val] of Object.entries(input)) {
          if (shouldOmit(key)) {
            continue;
          }
          result[key] = visit(val);
        }
        return result;
      }
      return input;
    };

    return visit(value);
  }
}
