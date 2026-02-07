import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import {
  Between,
  In,
  IsNull,
  ObjectLiteral,
  Repository,
  SelectQueryBuilder
} from "typeorm";
import { Game } from "./entities/game.entity";
import { Team } from "./entities/team.entity";
import { TeamGameStat } from "./entities/team-game-stat.entity";
import { Player } from "./entities/player.entity";
import { PlayerGameStats } from "./entities/player-game-stats.entity";
import { PlayerSeasonTeam } from "./entities/player-season-team.entity";
import { DataConflict } from "./entities/data-conflict.entity";
import { InjuryReport } from "./entities/injury-report.entity";
import { InjuryReportEntry } from "./entities/injury-report-entry.entity";
import { Event } from "../polymarket/entities/event.entity";
import { Market } from "../polymarket/entities/market.entity";

const PROVIDER = "nba_stats";

type ScoreboardPayload = {
  game_date?: string | null;
  game_header?: Array<Record<string, any>>;
  line_score?: Array<Record<string, any>>;
  error?: string | null;
};

type BoxscoreTraditionalPayload = {
  team_stats?: Array<Record<string, any>>;
  player_stats?: Array<Record<string, any>>;
};

type BoxscoreAdvancedPayload = {
  team_stats?: Array<Record<string, any>>;
};

type CommonAllPlayersPayload = {
  players?: Array<Record<string, any>>;
};

type CommonPlayerInfoPayload = {
  player_info?: Array<Record<string, any>>;
};

type CommonTeamRosterPayload = {
  roster?: Array<Record<string, any>>;
};

type InjuryReportPayload = {
  report?: {
    source_url?: string | null;
    report_date?: string | null;
    report_time?: string | null;
  };
  entries?: Array<Record<string, any>>;
};

type SchedulePayload = {
  dates?: string[];
  games?: Array<{
    game_id?: string | null;
    start_time_utc?: string | null;
    start_date_eastern?: string | null;
    start_time_eastern?: string | null;
  }>;
};

export type PaginationResult<T> = {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
};

export type GameContext = {
  game: Omit<Game, "homeTeam" | "awayTeam" | "polymarketEvent">;
  homeTeam: Team | null;
  awayTeam: Team | null;
  homePlayers: Player[];
  awayPlayers: Player[];
  recentMatchups: Game[];
  recentForm: {
    home: Game[];
    away: Game[];
  };
  injuries: {
    report: InjuryReport | null;
    entries: PaginationResult<InjuryReportEntry>;
  };
  polymarket: {
    event: Event | null;
    markets: PaginationResult<Market>;
  };
  teamStats: TeamGameStat[];
};

export type GameAnalysisResult = {
  gameId: string;
  homeTeam: string | null;
  awayTeam: string | null;
  homeWinPct: number | null;
  awayWinPct: number | null;
  confidence: number | null;
  keyFactors: string[];
  analysis: string;
  model: string;
  generatedAt: string;
  disclaimer: string;
  usage?: Record<string, any> | null;
  raw?: string;
};

@Injectable()
export class NbaService {
  private readonly nbaBase: string;
  private openaiClient: any | null = null;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(Team) private readonly teamRepo: Repository<Team>,
    @InjectRepository(Game) private readonly gameRepo: Repository<Game>,
    @InjectRepository(TeamGameStat)
    private readonly teamGameStatRepo: Repository<TeamGameStat>,
    @InjectRepository(Player)
    private readonly playerRepo: Repository<Player>,
    @InjectRepository(PlayerGameStats)
    private readonly playerGameStatsRepo: Repository<PlayerGameStats>,
    @InjectRepository(PlayerSeasonTeam)
    private readonly playerSeasonTeamRepo: Repository<PlayerSeasonTeam>,
    @InjectRepository(DataConflict)
    private readonly dataConflictRepo: Repository<DataConflict>,
    @InjectRepository(InjuryReport)
    private readonly injuryReportRepo: Repository<InjuryReport>,
    @InjectRepository(InjuryReportEntry)
    private readonly injuryReportEntryRepo: Repository<InjuryReportEntry>,
    @InjectRepository(Event)
    private readonly eventRepo: Repository<Event>,
    @InjectRepository(Market)
    private readonly marketRepo: Repository<Market>
  ) {
    this.nbaBase =
      this.configService.get<string>("NBA_SERVICE_BASE") ||
      "http://nba_service:8000";
  }

  async syncScoreboard(
    date?: string,
    scheduleByGameId?: Map<string, Date>
  ) {
    const payload = await this.fetchScoreboard(date);
    if (!payload) {
      await this.recordConflict({
        conflictType: "scoreboard_failed",
        detailsJson: { date }
      });
      return { games: 0, teams: 0, teamStats: 0 };
    }
    const gameHeaders = payload.game_header ?? [];
    const lineScores = payload.line_score ?? [];

    const teamsPayload = this.buildTeams(lineScores);
    if (teamsPayload.length === 0) {
      return { games: 0, teams: 0, teamStats: 0 };
    }

    await this.teamRepo.upsert(teamsPayload, ["provider", "providerTeamId"]);

    const providerTeamIds = teamsPayload.map((team) => team.providerTeamId);
    const teams = await this.teamRepo.find({
      where: {
        provider: PROVIDER,
        providerTeamId: In(providerTeamIds)
      }
    });

    const teamIdByProvider = new Map(
      teams.map((team) => [team.providerTeamId, team.id])
    );

    const gamesPayload = this.buildGames(gameHeaders, teamIdByProvider);
    if (gamesPayload.length > 0) {
      const scheduleLookup =
        scheduleByGameId ?? (await this.buildScheduleLookup(date, gamesPayload));

      const providerGameIds = gamesPayload
        .map((game) => game.providerGameId)
        .filter((value): value is string => Boolean(value));

      const existingGames = providerGameIds.length
        ? await this.gameRepo.find({
            where: {
              provider: PROVIDER,
              providerGameId: In(providerGameIds)
            }
          })
        : [];

      const existingByProvider = new Map(
        existingGames.map((game) => [game.providerGameId, game])
      );

      for (const payload of gamesPayload) {
        if (!payload.hasTipoffTime) {
          const scheduled =
            payload.providerGameId &&
            scheduleLookup?.get(payload.providerGameId);
          if (scheduled) {
            payload.dateTimeUtc = scheduled;
            delete payload.hasTipoffTime;
            delete payload.dateOnly;
            continue;
          }
          const existing = payload.providerGameId
            ? existingByProvider.get(payload.providerGameId)
            : null;
          if (existing?.dateTimeUtc) {
            payload.dateTimeUtc = existing.dateTimeUtc;
          } else if (payload.dateOnly) {
            payload.dateTimeUtc = payload.dateOnly;
          }
        }
        delete payload.hasTipoffTime;
        delete payload.dateOnly;
      }

      await this.gameRepo.upsert(
        gamesPayload as Partial<Game>[],
        ["provider", "providerGameId"]
      );
    }

    const providerGameIds = gamesPayload
      .map((game) => game.providerGameId)
      .filter((value): value is string => Boolean(value));
    const games = providerGameIds.length
      ? await this.gameRepo.find({
          where: {
            provider: PROVIDER,
            providerGameId: In(providerGameIds)
          }
        })
      : [];

    const gameIdByProvider = new Map(
      games.map((game) => [game.providerGameId, game.id])
    );

    const teamStatsPayload = this.buildTeamStats(
      lineScores,
      gameHeaders,
      teamIdByProvider,
      gameIdByProvider
    );

    if (teamStatsPayload.length > 0) {
      await this.teamGameStatRepo.upsert(teamStatsPayload, [
        "gameId",
        "teamId"
      ]);
    }

    return {
      games: gamesPayload.length,
      teams: teamsPayload.length,
      teamStats: teamStatsPayload.length
    };
  }

  async syncFinalResults(
    date?: string,
    options?: { includePlayerStats?: boolean }
  ) {
    const games = await this.findGamesForFinalResults(date);
    const includePlayerStats = options?.includePlayerStats !== false;
    let updated = 0;
    let teams = 0;
    let teamStats = 0;
    let players = 0;
    let playerStats = 0;

    for (const game of games) {
      const result = await this.syncFinalResultForGame(
        game,
        includePlayerStats
      );
      if (result.updated) {
        updated += 1;
      }
      teams += result.teams;
      teamStats += result.teamStats;
      players += result.players;
      playerStats += result.playerStats;
    }

    return {
      games: games.length,
      updated,
      teams,
      teamStats,
      players,
      playerStats
    };
  }

  async syncPlayerGameStats(date?: string, gameId?: string) {
    const games = await this.findGamesForPlayerStats(date, gameId);
    let players = 0;
    let playerStats = 0;

    for (const game of games) {
      const result = await this.syncPlayerStatsForGame(game);
      players += result.players;
      playerStats += result.playerStats;
    }

    return {
      games: games.length,
      players,
      playerStats
    };
  }

  async syncInjuryReport() {
    const payload = await this.fetchInjuryReport();
    if (!payload?.report?.source_url) {
      await this.recordConflict({
        conflictType: "injury_report_failed",
        detailsJson: { message: "missing injury report payload" }
      });
      return { reports: 0, entries: 0 };
    }

    const reportDate = this.toDateString(payload.report.report_date);
    const reportTime = payload.report.report_time ?? null;
    const sourceUrl = payload.report.source_url;

    await this.injuryReportRepo.upsert(
      {
        reportDate,
        reportTime,
        sourceUrl
      },
      ["sourceUrl"]
    );

    const report = await this.injuryReportRepo.findOne({
      where: { sourceUrl }
    });

    if (!report) {
      await this.recordConflict({
        conflictType: "injury_report_failed",
        detailsJson: { message: "unable to load report after upsert", sourceUrl }
      });
      return { reports: 0, entries: 0 };
    }

    let entriesPayload = this.buildInjuryReportEntries(
      payload.entries ?? [],
      report.id
    );

    if (entriesPayload.length > 0) {
      entriesPayload = await this.matchInjuryReportEntries(
        entriesPayload,
        report.reportDate
      );
    }

    if (entriesPayload.length > 0) {
      await this.injuryReportEntryRepo.upsert(entriesPayload, [
        "reportId",
        "teamAbbrev",
        "playerName",
        "matchup",
        "gameDate",
        "gameTime"
      ]);
    }

    return { reports: 1, entries: entriesPayload.length };
  }

  async syncPlayers(seasonInput?: string) {
    const season = this.normalizeSeason(seasonInput);
    const payload = await this.fetchCommonAllPlayers(season.seasonLabel);
    const players = payload.players ?? [];
    const playerPayload = this.buildPlayersFromCommonAll(players).map((row) =>
      this.stripNullPlayerFields(row)
    );

    if (playerPayload.length === 0) {
      return { players: 0, enriched: 0 };
    }

    await this.playerRepo.upsert(playerPayload, [
      "provider",
      "providerPlayerId"
    ]);

    const providerPlayerIds = playerPayload
      .map((player) => player.providerPlayerId)
      .filter((value): value is string => Boolean(value));

    const enriched = await this.enrichPlayersByProviderIds(
      providerPlayerIds,
      season.seasonYear
    );

    return { players: playerPayload.length, enriched };
  }

  async syncPlayerSeasonTeams(seasonInput?: string) {
    const season = this.normalizeSeason(seasonInput);
    const seasonStart = this.getSeasonStart(season.seasonYear);
    if (!seasonStart) {
      await this.recordConflict({
        conflictType: "missing_season_start",
        season: season.seasonYear
      });
      throw new Error(
        `missing season start env SEASON_START_UTC_${season.seasonYear}`
      );
    }

    const teams = await this.teamRepo.find({
      where: { provider: PROVIDER }
    });

    let rows = 0;
    let conflicts = 0;

    const rosterByTeam = new Map<string, Array<Record<string, any>>>();
    const allRosterPlayers: Array<Record<string, any>> = [];

    for (const team of teams) {
      let rosterPlayers: Array<Record<string, any>> = [];
      try {
        const roster = await this.fetchTeamRoster(
          team.providerTeamId,
          season
        );
        rosterPlayers = roster.roster ?? [];
      } catch (error) {
        await this.recordConflict({
          conflictType: "team_roster_failed",
          season: season.seasonYear,
          detailsJson: {
            providerTeamId: team.providerTeamId,
            message: error instanceof Error ? error.message : String(error)
          }
        });
        continue;
      }

      if (rosterPlayers.length === 0) {
        continue;
      }

      rosterByTeam.set(team.id, rosterPlayers);
      allRosterPlayers.push(...rosterPlayers);
    }

    if (allRosterPlayers.length === 0) {
      return { rows, conflicts };
    }

    const playersPayload = this.buildPlayersFromRoster(allRosterPlayers);
    if (playersPayload.length > 0) {
      await this.playerRepo.upsert(playersPayload, [
        "provider",
        "providerPlayerId"
      ]);
    }

    const providerPlayerIds = playersPayload
      .map((player) => player.providerPlayerId)
      .filter((value): value is string => Boolean(value));

    if (providerPlayerIds.length > 0) {
      await this.enrichPlayersByProviderIds(
        providerPlayerIds,
        season.seasonYear
      );
    }

    if (providerPlayerIds.length === 0) {
      return { rows, conflicts };
    }

    const players = await this.playerRepo.find({
      where: {
        provider: PROVIDER,
        providerPlayerId: In(providerPlayerIds)
      }
    });

    const playerIdByProvider = new Map(
      players.map((player) => [player.providerPlayerId, player.id])
    );

    const rosterEntries: Array<Partial<PlayerSeasonTeam>> = [];

    for (const [teamId, rosterPlayers] of rosterByTeam.entries()) {
      for (const row of rosterPlayers) {
        const providerPlayerId = this.pickString(row, [
          "PLAYER_ID",
          "playerId",
          "personId"
        ]);
        if (!providerPlayerId) {
          continue;
        }

        const playerId = playerIdByProvider.get(providerPlayerId);
        if (!playerId) {
          continue;
        }

        rosterEntries.push({
          provider: PROVIDER,
          playerId,
          season: season.seasonYear,
          teamId,
          fromUtc: seasonStart,
          toUtc: null,
          role: this.pickString(row, ["ROLE", "role"]),
          contractType: this.pickString(row, [
            "CONTRACT_TYPE",
            "contractType"
          ]),
          updatedAt: new Date()
        });
      }
    }

    if (rosterEntries.length === 0) {
      return { rows, conflicts };
    }

    const playerIds = Array.from(
      new Set(rosterEntries.map((entry) => entry.playerId).filter(Boolean))
    ) as string[];

    const existingActive = await this.playerSeasonTeamRepo.find({
      where: {
        playerId: In(playerIds),
        season: season.seasonYear,
        toUtc: IsNull()
      }
    });

    const rosterTeamByPlayer = new Map<string, string>();
    for (const entry of rosterEntries) {
      if (entry.playerId && entry.teamId) {
        rosterTeamByPlayer.set(entry.playerId, entry.teamId);
      }
    }

    const closeIds: string[] = [];
    const conflictRows: Array<Partial<DataConflict>> = [];

    for (const activeRow of existingActive) {
      const rosterTeamId = rosterTeamByPlayer.get(activeRow.playerId);
      if (rosterTeamId && rosterTeamId !== activeRow.teamId) {
        closeIds.push(activeRow.id);
        conflictRows.push({
          conflictType: "player_season_team_overlap",
          playerId: activeRow.playerId,
          season: season.seasonYear,
          detailsJson: {
            previousTeamId: activeRow.teamId,
            newTeamId: rosterTeamId
          }
        });
      }
    }

    if (closeIds.length > 0) {
      await this.playerSeasonTeamRepo
        .createQueryBuilder()
        .update(PlayerSeasonTeam)
        .set({ toUtc: new Date(), updatedAt: new Date() })
        .whereInIds(closeIds)
        .execute();
      conflicts += closeIds.length;
    }

    if (conflictRows.length > 0) {
      await this.dataConflictRepo.insert(conflictRows);
    }

    await this.playerSeasonTeamRepo
      .createQueryBuilder()
      .insert()
      .values(rosterEntries)
      .orUpdate({
        conflict_target: ["player_id", "season", "team_id"],
        overwrite: [
          "from_utc",
          "to_utc",
          "role",
          "contract_type",
          "updated_at",
          "provider"
        ]
      })
      .execute();

    rows += rosterEntries.length;

    return { rows, conflicts };
  }

  async listTeams() {
    return this.teamRepo.find({
      where: { provider: PROVIDER },
      order: { name: "ASC" }
    });
  }

  async getGame(id: string) {
    return this.gameRepo.findOne({
      where: { id, provider: PROVIDER }
    });
  }

  async getTeam(id: string) {
    return this.teamRepo.findOne({
      where: { id, provider: PROVIDER }
    });
  }

  async getPlayer(id: string) {
    return this.playerRepo.findOne({
      where: { id, provider: PROVIDER }
    });
  }

  async listGames(filters: {
    date?: string;
    from?: string;
    to?: string;
    status?: string;
    season?: number;
    teamId?: string;
    page?: number;
    pageSize?: number;
  }): Promise<PaginationResult<Game>> {
    const page = this.clampPage(filters.page);
    const pageSize = this.clampPageSize(filters.pageSize);
    const qb = this.gameRepo.createQueryBuilder("game");

    qb.where("game.provider = :provider", { provider: PROVIDER });

    if (filters.status) {
      qb.andWhere("game.status = :status", { status: filters.status });
    }

    if (filters.season) {
      qb.andWhere("game.season = :season", { season: filters.season });
    }

    if (filters.teamId) {
      qb.andWhere(
        "(game.home_team_id = :teamId OR game.away_team_id = :teamId)",
        { teamId: filters.teamId }
      );
    }

    if (filters.from && filters.to) {
      const { start, end } = this.dateRangeBetween(filters.from, filters.to);
      qb.andWhere("game.date_time_utc BETWEEN :start AND :end", { start, end });
    } else if (filters.date) {
      const { start, end } = this.dateRange(filters.date);
      qb.andWhere("game.date_time_utc BETWEEN :start AND :end", { start, end });
    }

    qb.orderBy("game.dateTimeUtc", "DESC");
    return this.paginate(qb, page, pageSize);
  }

  async listPlayers(filters: {
    search?: string;
    isActive?: boolean;
    teamId?: string;
    season?: number;
    currentOnly?: boolean;
    page?: number;
    pageSize?: number;
  }): Promise<PaginationResult<Player>> {
    const page = this.clampPage(filters.page);
    const pageSize = this.clampPageSize(filters.pageSize);

    const qb = this.playerRepo.createQueryBuilder("player");
    qb.where("player.provider = :provider", { provider: PROVIDER });

    if (filters.search) {
      qb.andWhere("player.display_name ILIKE :search", {
        search: `%${filters.search}%`
      });
    }

    if (filters.isActive !== undefined) {
      qb.andWhere("player.is_active = :isActive", {
        isActive: filters.isActive
      });
    }

    if (filters.teamId || filters.season || filters.currentOnly) {
      qb.innerJoin(
        "player_season_team",
        "pst",
        "pst.player_id = player.id"
      );
      qb.distinct(true);

      if (filters.teamId) {
        qb.andWhere("pst.team_id = :teamId", { teamId: filters.teamId });
      }

      if (filters.season) {
        qb.andWhere("pst.season = :season", { season: filters.season });
      }

      if (filters.currentOnly) {
        qb.andWhere("pst.to_utc IS NULL");
      }
    }

    qb.orderBy("player.displayName", "ASC");

    return this.paginate(qb, page, pageSize);
  }

  async listTeamStats(filters: {
    gameId?: string;
    teamId?: string;
    page?: number;
    pageSize?: number;
  }): Promise<PaginationResult<TeamGameStat>> {
    const page = this.clampPage(filters.page);
    const pageSize = this.clampPageSize(filters.pageSize);

    const qb = this.teamGameStatRepo.createQueryBuilder("stat");
    qb.where("1=1");

    if (filters.gameId) {
      qb.andWhere("stat.game_id = :gameId", { gameId: filters.gameId });
    }

    if (filters.teamId) {
      qb.andWhere("stat.team_id = :teamId", { teamId: filters.teamId });
    }

    qb.orderBy("stat.createdAt", "DESC");

    return this.paginate(qb, page, pageSize);
  }

  async listPlayerStats(filters: {
    gameId?: string;
    playerId?: string;
    teamId?: string;
    autoSync?: boolean;
    page?: number;
    pageSize?: number;
  }): Promise<PaginationResult<PlayerGameStats>> {
    if (filters.autoSync && filters.gameId) {
      const existing = await this.playerGameStatsRepo.count({
        where: {
          provider: PROVIDER,
          gameId: filters.gameId
        }
      });
      if (existing === 0) {
        const game =
          (await this.gameRepo.findOne({ where: { id: filters.gameId } })) ??
          (await this.gameRepo.findOne({
            where: { provider: PROVIDER, providerGameId: filters.gameId }
          }));
        if (game?.status === "finished") {
          await this.syncPlayerStatsForGame(game);
        }
      }
    }

    const page = this.clampPage(filters.page);
    const pageSize = this.clampPageSize(filters.pageSize);

    const qb = this.playerGameStatsRepo
      .createQueryBuilder("stat")
      .leftJoinAndSelect("stat.player", "player");
    qb.where("stat.provider = :provider", { provider: PROVIDER });

    if (filters.gameId) {
      qb.andWhere("stat.game_id = :gameId", { gameId: filters.gameId });
    }

    if (filters.playerId) {
      qb.andWhere("stat.player_id = :playerId", { playerId: filters.playerId });
    }

    if (filters.teamId) {
      qb.andWhere("stat.team_id = :teamId", { teamId: filters.teamId });
    }

    qb.orderBy("stat.createdAt", "DESC");

    return this.paginate(qb, page, pageSize);
  }

  async listConflicts(filters: {
    conflictType?: string;
    playerId?: string;
    season?: number;
    page?: number;
    pageSize?: number;
  }): Promise<PaginationResult<DataConflict>> {
    const page = this.clampPage(filters.page);
    const pageSize = this.clampPageSize(filters.pageSize);

    const qb = this.dataConflictRepo.createQueryBuilder("conflict");
    qb.where("1=1");

    if (filters.conflictType) {
      qb.andWhere("conflict.conflict_type = :conflictType", {
        conflictType: filters.conflictType
      });
    }

    if (filters.playerId) {
      qb.andWhere("conflict.player_id = :playerId", {
        playerId: filters.playerId
      });
    }

    if (filters.season) {
      qb.andWhere("conflict.season = :season", { season: filters.season });
    }

    qb.orderBy("conflict.createdAt", "DESC");

    return this.paginate(qb, page, pageSize);
  }

  async listInjuryReportEntries(filters: {
    reportId?: string;
    date?: string;
    from?: string;
    to?: string;
    team?: string;
    status?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = this.clampPage(filters.page);
    const pageSize = this.clampPageSize(filters.pageSize);

    let report = null;
    if (filters.reportId) {
      report = await this.injuryReportRepo.findOne({
        where: { id: filters.reportId }
      });
    } else if (filters.date) {
      const reportDate = this.toDateString(filters.date);
      if (reportDate) {
        report = await this.injuryReportRepo.findOne({
          where: { reportDate },
          order: { createdAt: "DESC" }
        });
      }
    } else if (filters.from && filters.to) {
      const start = this.toDateString(filters.from);
      const end = this.toDateString(filters.to);
      if (start && end) {
        report = await this.injuryReportRepo
          .createQueryBuilder("report")
          .where("report.report_date BETWEEN :start AND :end", { start, end })
          .orderBy("report.reportDate", "DESC")
          .addOrderBy("report.createdAt", "DESC")
          .getOne();
      }
    }

    if (!report) {
      report = await this.injuryReportRepo
        .createQueryBuilder("report")
        .orderBy("report.reportDate", "DESC")
        .addOrderBy("report.createdAt", "DESC")
        .getOne();
    }

    if (!report) {
      return {
        report: null,
        entries: { data: [], page, pageSize, total: 0 }
      };
    }

    const qb = this.injuryReportEntryRepo.createQueryBuilder("entry");
    qb.where("entry.report_id = :reportId", { reportId: report.id });

    if (filters.team) {
      qb.andWhere("entry.team_abbrev = :team", { team: filters.team });
    }

    if (filters.status) {
      qb.andWhere("entry.status ILIKE :status", {
        status: `%${filters.status}%`
      });
    }

    qb.orderBy("entry.createdAt", "DESC");

    const entries = await this.paginate(qb, page, pageSize);
    return { report, entries };
  }

  async listInjuryReports(filters: {
    date?: string;
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = this.clampPage(filters.page);
    const pageSize = this.clampPageSize(filters.pageSize);
    const qb = this.injuryReportRepo.createQueryBuilder("report");

    if (filters.date) {
      const reportDate = this.toDateString(filters.date);
      if (reportDate) {
        qb.where("report.report_date = :reportDate", { reportDate });
      }
    } else if (filters.from && filters.to) {
      const start = this.toDateString(filters.from);
      const end = this.toDateString(filters.to);
      if (start && end) {
        qb.where("report.report_date BETWEEN :start AND :end", {
          start,
          end
        });
      }
    }

    qb.orderBy("report.reportDate", "DESC");
    qb.addOrderBy("report.createdAt", "DESC");

    return this.paginate(qb, page, pageSize);
  }

  async listPolymarketMarketsForGame(
    gameId: string,
    options?: { page?: number; pageSize?: number }
  ) {
    const game = await this.getGame(gameId);
    if (!game) {
      return {
        event: null,
        markets: { data: [], page: 1, pageSize: 50, total: 0 }
      };
    }

    let event: Event | null = null;
    if (game.polymarketEventId) {
      event = await this.eventRepo.findOne({
        where: { id: game.polymarketEventId }
      });
    }

    if (!event) {
      event = await this.resolveEventForGame(game);
      if (event) {
        await this.gameRepo.update(game.id, {
          polymarketEventId: event.id,
          updatedAt: new Date()
        });
      }
    }

    if (!event) {
      return {
        event: null,
        markets: { data: [], page: 1, pageSize: 50, total: 0 }
      };
    }

    const page = this.clampPage(options?.page);
    const pageSize = this.clampPageSize(options?.pageSize);
    const qb = this.marketRepo.createQueryBuilder("market");
    qb.where("market.event_id = :eventId", { eventId: event.id });
    qb.orderBy("market.updatedAt", "DESC");

    const markets = await this.paginate(qb, page, pageSize);
    return { event, markets };
  }

  async getGameContext(
    gameId: string,
    options?: {
      matchupLimit?: number;
      recentLimit?: number;
      marketPage?: number;
      marketPageSize?: number;
    }
  ): Promise<GameContext | null> {
    const game = await this.findGameWithTeams(gameId);
    if (!game) {
      return null;
    }

    return this.buildGameContext(game, options);
  }

  async getGameContextByMatchup(input: {
    date: string;
    home: string;
    away: string;
    matchupLimit?: number;
    recentLimit?: number;
    marketPage?: number;
    marketPageSize?: number;
  }): Promise<GameContext | null> {
    const game = await this.findGameByMatchup(input);
    if (!game) {
      return null;
    }
    return this.buildGameContext(game, input);
  }

  async analyzeGameByMatchup(
    input: {
      date: string;
      home: string;
      away: string;
    },
    options?: {
      model?: string;
      temperature?: number;
      matchupLimit?: number;
      recentLimit?: number;
    }
  ): Promise<GameAnalysisResult | null> {
    const context = await this.getGameContextByMatchup({
      ...input,
      matchupLimit: options?.matchupLimit,
      recentLimit: options?.recentLimit,
      marketPage: 1,
      marketPageSize: 10
    });
    if (!context) {
      return null;
    }

    return this.runAnalysis(context, options);
  }

  async recordConflict(input: {
    conflictType: string;
    playerId?: string;
    season?: number;
    jobId?: string | number | null;
    detailsJson?: Record<string, any> | null;
  }) {
    await this.dataConflictRepo.insert({
      conflictType: input.conflictType,
      playerId: input.playerId ?? null,
      season: input.season ?? null,
      jobId: input.jobId ? String(input.jobId) : null,
      detailsJson: input.detailsJson ?? null
    });
  }

  private async syncFinalResultForGame(
    game: Game,
    includePlayerStats = true
  ) {
    const traditional = await this.fetchBoxscoreTraditional(game.providerGameId);
    const teamStatsRows = traditional?.team_stats ?? [];
    const playerStatsRows = traditional?.player_stats ?? [];

    if (!traditional || teamStatsRows.length === 0) {
      await this.recordConflict({
        conflictType: "missing_team_stats",
        detailsJson: { providerGameId: game.providerGameId }
      });
      return {
        updated: false,
        teams: 0,
        teamStats: 0,
        players: 0,
        playerStats: 0
      };
    }

    let advancedRows: Array<Record<string, any>> = [];
    const advanced = await this.fetchBoxscoreAdvanced(game.providerGameId);
    if (advanced) {
      advancedRows = advanced.team_stats ?? [];
    }

    const providerTeamIds = teamStatsRows
      .map((row) => this.pickString(row, ["TEAM_ID", "teamId"]))
      .filter((value): value is string => Boolean(value));

    const teamPayload = this.buildTeamsFromTeamStats(teamStatsRows);
    if (teamPayload.length > 0) {
      await this.teamRepo.upsert(teamPayload, ["provider", "providerTeamId"]);
    }

    const teams = providerTeamIds.length
      ? await this.teamRepo.find({
          where: {
            provider: PROVIDER,
            providerTeamId: In(providerTeamIds)
          }
        })
      : [];

    const teamIdByProvider = new Map(
      teams.map((team) => [team.providerTeamId, team.id])
    );

    const teamStatsPayload = this.buildTeamStatsFromBoxscore(
      teamStatsRows,
      advancedRows,
      game,
      teamIdByProvider
    );

    if (teamStatsPayload.length > 0) {
      await this.teamGameStatRepo.upsert(teamStatsPayload, [
        "gameId",
        "teamId"
      ]);
    }

    let players: Player[] = [];
    let playerStatsPayload: Array<Partial<PlayerGameStats>> = [];
    if (includePlayerStats) {
      const playerPayload = this.buildPlayersFromBoxscore(playerStatsRows);
      if (playerPayload.length > 0) {
        await this.playerRepo.upsert(playerPayload, [
          "provider",
          "providerPlayerId"
        ]);
      }

      const providerPlayerIds = playerPayload
        .map((player) => player.providerPlayerId)
        .filter((value): value is string => Boolean(value));
      if (providerPlayerIds.length > 0) {
        await this.enrichPlayersByProviderIds(providerPlayerIds, game.season);
      }
      players = providerPlayerIds.length
        ? await this.playerRepo.find({
            where: {
              provider: PROVIDER,
              providerPlayerId: In(providerPlayerIds)
            }
          })
        : [];

      const playerIdByProvider = new Map(
        players.map((player) => [player.providerPlayerId, player.id])
      );

      playerStatsPayload = this.buildPlayerGameStats(
        playerStatsRows,
        game,
        teamIdByProvider,
        playerIdByProvider
      );

      if (playerStatsPayload.length > 0) {
        await this.playerGameStatsRepo.upsert(playerStatsPayload, [
          "gameId",
          "playerId"
        ]);
      }
      await this.ensurePlayerSeasonTeams(game, playerStatsPayload);
    }

    const { homeScore, awayScore } = this.resolveScores(
      teamStatsPayload,
      game
    );

    const updatePayload: Partial<Game> = {
      updatedAt: new Date()
    };

    if (homeScore !== null) {
      updatePayload.homeScore = homeScore;
    }
    if (awayScore !== null) {
      updatePayload.awayScore = awayScore;
    }
    if (homeScore !== null && awayScore !== null) {
      updatePayload.status = "finished";
    }

    await this.gameRepo.update(game.id, updatePayload);

    return {
      updated: true,
      teams: teams.length,
      teamStats: teamStatsPayload.length,
      players: players.length,
      playerStats: playerStatsPayload.length
    };
  }

  private async syncPlayerStatsForGame(game: Game) {
    const traditional = await this.fetchBoxscoreTraditional(game.providerGameId);
    const playerStatsRows = traditional?.player_stats ?? [];

    if (!traditional || playerStatsRows.length === 0) {
      await this.recordConflict({
        conflictType: "missing_player_stats",
        detailsJson: { providerGameId: game.providerGameId }
      });
      return { players: 0, playerStats: 0 };
    }

    const providerTeamIds = Array.from(
      new Set(
        playerStatsRows
          .map((row) => this.pickString(row, ["TEAM_ID", "teamId"]))
          .filter((value): value is string => Boolean(value))
      )
    );

    const teams = providerTeamIds.length
      ? await this.teamRepo.find({
          where: {
            provider: PROVIDER,
            providerTeamId: In(providerTeamIds)
          }
        })
      : [];

    const teamIdByProvider = new Map(
      teams.map((team) => [team.providerTeamId, team.id])
    );

    const playerPayload = this.buildPlayersFromBoxscore(playerStatsRows);
    if (playerPayload.length > 0) {
      await this.playerRepo.upsert(playerPayload, [
        "provider",
        "providerPlayerId"
      ]);
    }

    const providerPlayerIds = playerPayload
      .map((player) => player.providerPlayerId)
      .filter((value): value is string => Boolean(value));
    if (providerPlayerIds.length > 0) {
      await this.enrichPlayersByProviderIds(providerPlayerIds, game.season);
    }

    const players = providerPlayerIds.length
      ? await this.playerRepo.find({
          where: {
            provider: PROVIDER,
            providerPlayerId: In(providerPlayerIds)
          }
        })
      : [];

    const playerIdByProvider = new Map(
      players.map((player) => [player.providerPlayerId, player.id])
    );

    const playerStatsPayload = this.buildPlayerGameStats(
      playerStatsRows,
      game,
      teamIdByProvider,
      playerIdByProvider
    );

    if (playerStatsPayload.length > 0) {
      await this.playerGameStatsRepo.upsert(playerStatsPayload, [
        "gameId",
        "playerId"
      ]);
    }

    await this.ensurePlayerSeasonTeams(game, playerStatsPayload);

    return {
      players: players.length,
      playerStats: playerStatsPayload.length
    };
  }

  private async fetchBoxscoreTraditional(
    gameId: string
  ): Promise<BoxscoreTraditionalPayload | null> {
    const url = new URL("/boxscore/traditional", this.nbaBase);
    url.searchParams.set("game_id", gameId);

    try {
      const response = await fetch(url.toString(), {
        headers: { Accept: "application/json" }
      });

      if (!response.ok) {
        await this.recordConflict({
          conflictType: "boxscore_traditional_failed",
          detailsJson: { gameId, status: response.status }
        });
        return null;
      }

      return (await response.json()) as BoxscoreTraditionalPayload;
    } catch (error) {
      await this.recordConflict({
        conflictType: "boxscore_traditional_failed",
        detailsJson: {
          gameId,
          message: error instanceof Error ? error.message : String(error)
        }
      });
      return null;
    }
  }

  private async fetchBoxscoreAdvanced(
    gameId: string
  ): Promise<BoxscoreAdvancedPayload | null> {
    const url = new URL("/boxscore/advanced", this.nbaBase);
    url.searchParams.set("game_id", gameId);

    try {
      const response = await fetch(url.toString(), {
        headers: { Accept: "application/json" }
      });

      if (!response.ok) {
        await this.recordConflict({
          conflictType: "boxscore_advanced_failed",
          detailsJson: { gameId, status: response.status }
        });
        return null;
      }

      return (await response.json()) as BoxscoreAdvancedPayload;
    } catch (error) {
      await this.recordConflict({
        conflictType: "boxscore_advanced_failed",
        detailsJson: {
          gameId,
          message: error instanceof Error ? error.message : String(error)
        }
      });
      return null;
    }
  }

  private async fetchScoreboard(
    date?: string
  ): Promise<ScoreboardPayload | null> {
    const url = new URL("/scoreboard", this.nbaBase);
    if (date) {
      url.searchParams.set("date", date);
    }

    try {
      const response = await fetch(url.toString(), {
        headers: { Accept: "application/json" }
      });

      if (!response.ok) {
        await this.recordConflict({
          conflictType: "scoreboard_failed",
          detailsJson: { date, status: response.status }
        });
        return null;
      }

      const payload = (await response.json()) as ScoreboardPayload;
      if (payload?.error) {
        await this.recordConflict({
          conflictType: "scoreboard_failed",
          detailsJson: { date, error: payload.error }
        });
        return null;
      }
      return payload;
    } catch (error) {
      await this.recordConflict({
        conflictType: "scoreboard_failed",
        detailsJson: {
          date,
          message: error instanceof Error ? error.message : String(error)
        }
      });
      return null;
    }
  }

  private async fetchSchedule(date: string): Promise<SchedulePayload | null> {
    const url = new URL("/schedule", this.nbaBase);
    url.searchParams.set("date", date);

    try {
      const response = await fetch(url.toString(), {
        headers: { Accept: "application/json" }
      });

      if (!response.ok) {
        await this.recordConflict({
          conflictType: "schedule_failed",
          detailsJson: { date, status: response.status }
        });
        return null;
      }

      return (await response.json()) as SchedulePayload;
    } catch (error) {
      await this.recordConflict({
        conflictType: "schedule_failed",
        detailsJson: {
          date,
          message: error instanceof Error ? error.message : String(error)
        }
      });
      return null;
    }
  }

  private async fetchScheduleRange(
    from: string,
    to: string
  ): Promise<SchedulePayload | null> {
    const url = new URL("/schedule", this.nbaBase);
    url.searchParams.set("from", from);
    url.searchParams.set("to", to);

    try {
      const response = await fetch(url.toString(), {
        headers: { Accept: "application/json" }
      });

      if (!response.ok) {
        await this.recordConflict({
          conflictType: "schedule_failed",
          detailsJson: { from, to, status: response.status }
        });
        return null;
      }

      return (await response.json()) as SchedulePayload;
    } catch (error) {
      await this.recordConflict({
        conflictType: "schedule_failed",
        detailsJson: {
          from,
          to,
          message: error instanceof Error ? error.message : String(error)
        }
      });
      return null;
    }
  }

  async buildScheduleMap(from: string, to: string) {
    const schedule = await this.fetchScheduleRange(from, to);
    const scheduleByGameId = new Map<string, Date>();
    for (const entry of schedule?.games ?? []) {
      if (!entry.game_id || !entry.start_time_utc) {
        continue;
      }
      const parsed = new Date(entry.start_time_utc);
      if (!Number.isNaN(parsed.getTime())) {
        scheduleByGameId.set(entry.game_id, parsed);
      }
    }
    return scheduleByGameId;
  }

  private async buildScheduleLookup(
    date: string | undefined,
    gamesPayload: Array<Partial<Game> & { hasTipoffTime?: boolean; dateOnly?: Date | null }>
  ) {
    if (!gamesPayload.some((game) => !game.hasTipoffTime)) {
      return null;
    }

    const scheduleDates = new Set<string>();
    if (date) {
      scheduleDates.add(date);
    } else {
      for (const game of gamesPayload) {
        if (!game.hasTipoffTime && game.dateOnly) {
          scheduleDates.add(this.formatDateOnly(game.dateOnly));
        }
      }
    }

    if (scheduleDates.size === 0) {
      return null;
    }

    const scheduleByGameId = new Map<string, Date>();
    if (scheduleDates.size === 1) {
      const [scheduleDate] = Array.from(scheduleDates);
      const schedule = await this.fetchSchedule(scheduleDate);
      for (const entry of schedule?.games ?? []) {
        if (!entry.game_id || !entry.start_time_utc) {
          continue;
        }
        const parsed = new Date(entry.start_time_utc);
        if (!Number.isNaN(parsed.getTime())) {
          scheduleByGameId.set(entry.game_id, parsed);
        }
      }
      return scheduleByGameId;
    }

    const sortedDates = Array.from(scheduleDates).sort();
    const schedule = await this.fetchScheduleRange(
      sortedDates[0],
      sortedDates[sortedDates.length - 1]
    );
    for (const entry of schedule?.games ?? []) {
      if (!entry.game_id || !entry.start_time_utc) {
        continue;
      }
      const parsed = new Date(entry.start_time_utc);
      if (!Number.isNaN(parsed.getTime())) {
        scheduleByGameId.set(entry.game_id, parsed);
      }
    }
    return scheduleByGameId;
  }

  private async fetchCommonAllPlayers(seasonLabel: string) {
    const url = new URL("/players/all", this.nbaBase);
    url.searchParams.set("season", seasonLabel);
    const currentOnly = this.configService.get<string>(
      "NBA_PLAYERS_CURRENT_ONLY"
    );
    if (currentOnly !== undefined) {
      url.searchParams.set("current_only", currentOnly);
    }

    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" }
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`nba_service error ${response.status}: ${body}`);
    }

    return (await response.json()) as CommonAllPlayersPayload;
  }

  private async fetchPlayerInfo(playerId: string) {
    const url = new URL("/players/info", this.nbaBase);
    url.searchParams.set("player_id", playerId);

    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" }
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`nba_service error ${response.status}: ${body}`);
    }

    return (await response.json()) as CommonPlayerInfoPayload;
  }

  private async fetchTeamRoster(teamId: string, season: SeasonInfo) {
    const url = new URL("/teams/roster", this.nbaBase);
    url.searchParams.set("team_id", teamId);
    url.searchParams.set("season", season.seasonLabel);

    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" }
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`nba_service error ${response.status}: ${body}`);
    }

    return (await response.json()) as CommonTeamRosterPayload;
  }

  private async fetchInjuryReport(): Promise<InjuryReportPayload | null> {
    const url = new URL("/injury-report/latest", this.nbaBase);

    try {
      const response = await fetch(url.toString(), {
        headers: { Accept: "application/json" }
      });

      if (!response.ok) {
        await this.recordConflict({
          conflictType: "injury_report_failed",
          detailsJson: { status: response.status }
        });
        return null;
      }

      return (await response.json()) as InjuryReportPayload;
    } catch (error) {
      await this.recordConflict({
        conflictType: "injury_report_failed",
        detailsJson: {
          message: error instanceof Error ? error.message : String(error)
        }
      });
      return null;
    }
  }

  private async findGamesForFinalResults(date?: string) {
    const now = new Date();
    let start: Date;
    let end: Date;

    if (date) {
      const { start: rangeStart, end: rangeEnd } = this.dateRange(date);
      start = rangeStart;
      end = rangeEnd;
    } else {
      const lookbackDays = Number(
        this.configService.get<string>("NBA_FINAL_LOOKBACK_DAYS") || 2
      );
      end = now;
      start = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
    }

    return this.gameRepo.find({
      where: {
        provider: PROVIDER,
        dateTimeUtc: Between(start, end)
      }
    });
  }

  private async findGamesForPlayerStats(date?: string, gameId?: string) {
    if (gameId) {
      return this.gameRepo.find({
        where: {
          provider: PROVIDER,
          providerGameId: gameId
        }
      });
    }

    const now = new Date();
    let start: Date;
    let end: Date;

    if (date) {
      const range = this.dateRange(date);
      start = range.start;
      end = range.end;
    } else {
      const lookbackDays = Number(
        this.configService.get<string>("NBA_FINAL_LOOKBACK_DAYS") || 2
      );
      end = now;
      start = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
    }

    return this.gameRepo
      .createQueryBuilder("game")
      .innerJoin(
        "team_game_stat",
        "tgs",
        "tgs.game_id = game.id"
      )
      .where("game.provider = :provider", { provider: PROVIDER })
      .andWhere("game.date_time_utc BETWEEN :start AND :end", { start, end })
      .groupBy("game.id")
      .having("COUNT(tgs.id) >= 2")
      .getMany();
  }

  private async resolveEventForGame(game: Game): Promise<Event | null> {
    if (!game.dateTimeUtc) {
      return null;
    }

    const [homeTeam, awayTeam] = await Promise.all([
      this.teamRepo.findOne({ where: { id: game.homeTeamId } }),
      this.teamRepo.findOne({ where: { id: game.awayTeamId } })
    ]);

    if (!homeTeam || !awayTeam) {
      return null;
    }

    const dateEt = this.formatDateInTimeZone(
      game.dateTimeUtc,
      "America/New_York"
    );
    const dateUtc = game.dateTimeUtc.toISOString().slice(0, 10);
    const dateCandidates = Array.from(new Set([dateEt, dateUtc]));
    const homeAbbrev = homeTeam.abbrev?.toLowerCase();
    const awayAbbrev = awayTeam.abbrev?.toLowerCase();

    const slugCandidates = new Set<string>();
    if (homeAbbrev && awayAbbrev) {
      for (const date of dateCandidates) {
        slugCandidates.add(`nba-${awayAbbrev}-${homeAbbrev}-${date}`);
        slugCandidates.add(`nba-${homeAbbrev}-${awayAbbrev}-${date}`);
      }
    }

    if (slugCandidates.size > 0) {
      const bySlug = await this.eventRepo.find({
        where: { slug: In(Array.from(slugCandidates)) },
        take: 1
      });
      if (bySlug.length > 0) {
        return bySlug[0];
      }
    }

    const qb = this.eventRepo.createQueryBuilder("event");

    const homeName = homeTeam.name;
    const awayName = awayTeam.name;
    if (homeName && awayName) {
      qb.andWhere(
        "(event.title ILIKE :home AND event.title ILIKE :away)",
        { home: `%${homeName}%`, away: `%${awayName}%` }
      );
    }

    qb.orderBy("event.startDate", "DESC");
    qb.addOrderBy("event.polymarketEventId", "DESC");

    const matches = await qb.getMany();
    if (matches.length === 0) {
      return null;
    }

    const slugMatch = matches.find((event) =>
      dateCandidates.some((candidate) => event.slug?.includes(candidate))
    );
    return slugMatch ?? matches[0];
  }

  private buildTeams(lineScores: Array<Record<string, any>>): Partial<Team>[] {
    const seen = new Map<string, Partial<Team>>();

    for (const row of lineScores) {
      const providerTeamId = this.pickString(row, ["TEAM_ID", "teamId"]);
      if (!providerTeamId) {
        continue;
      }

      const abbrev = this.pickString(row, [
        "TEAM_ABBREVIATION",
        "teamAbbreviation"
      ]);

      const city = this.pickString(row, ["TEAM_CITY_NAME", "teamCityName"]);
      const name = this.pickString(row, ["TEAM_NAME", "teamName"]);
      const displayName = [city, name].filter(Boolean).join(" ").trim();

      seen.set(providerTeamId, {
        provider: PROVIDER,
        providerTeamId,
        abbrev: abbrev || providerTeamId,
        name: displayName || name || city || providerTeamId,
        updatedAt: new Date()
      });
    }

    return Array.from(seen.values());
  }

  private buildTeamsFromTeamStats(
    teamStatsRows: Array<Record<string, any>>
  ): Partial<Team>[] {
    const seen = new Map<string, Partial<Team>>();

    for (const row of teamStatsRows) {
      const providerTeamId = this.pickString(row, ["TEAM_ID", "teamId"]);
      if (!providerTeamId) {
        continue;
      }

      const abbrev = this.pickString(row, [
        "TEAM_ABBREVIATION",
        "teamTricode",
        "teamAbbreviation"
      ]);
      const city = this.pickString(row, [
        "TEAM_CITY",
        "TEAM_CITY_NAME",
        "teamCity",
        "teamCityName"
      ]);
      const name = this.pickString(row, ["TEAM_NAME", "teamName"]);
      const displayName = [city, name].filter(Boolean).join(" ").trim();

      seen.set(providerTeamId, {
        provider: PROVIDER,
        providerTeamId,
        abbrev: abbrev || providerTeamId,
        name: displayName || name || city || providerTeamId,
        updatedAt: new Date()
      });
    }

    return Array.from(seen.values());
  }

  private buildGames(
    gameHeaders: Array<Record<string, any>>,
    teamIdByProvider: Map<string, string>
  ): Array<
    Partial<Game> & { hasTipoffTime?: boolean; dateOnly?: Date | null }
  > {
    const byGameId = new Map<
      string,
      Partial<Game> & { hasTipoffTime?: boolean; dateOnly?: Date | null }
    >();

    for (const row of gameHeaders) {
      const providerGameId = this.pickString(row, ["GAME_ID", "gameId"]);
      if (!providerGameId) {
        continue;
      }

      const dateStr = this.pickString(row, ["GAME_DATE_EST", "gameDateEst"]);
      const statusText = this.pickString(row, [
        "GAME_STATUS_TEXT",
        "gameStatusText"
      ]);
      const parsed = this.parseGameDateTimeUtc(dateStr, statusText);
      const date =
        parsed.dateTimeUtc ||
        parsed.dateOnly ||
        (dateStr ? new Date(dateStr) : new Date());
      const season = Number(row.SEASON ?? date.getUTCFullYear());

      const homeProviderId = this.pickString(row, [
        "HOME_TEAM_ID",
        "homeTeamId"
      ]);
      const awayProviderId = this.pickString(row, [
        "VISITOR_TEAM_ID",
        "visitorTeamId"
      ]);

      const homeTeamId = homeProviderId
        ? teamIdByProvider.get(homeProviderId)
        : undefined;
      const awayTeamId = awayProviderId
        ? teamIdByProvider.get(awayProviderId)
        : undefined;

      if (!homeTeamId || !awayTeamId) {
        continue;
      }

      const statusId = Number(row.GAME_STATUS_ID ?? row.gameStatusId ?? 0);
      const status = statusId === 3 ? "finished" : "scheduled";

      byGameId.set(providerGameId, {
        provider: PROVIDER,
        providerGameId,
        season,
        dateTimeUtc: date,
        hasTipoffTime: parsed.hasTipoffTime,
        dateOnly: parsed.dateOnly,
        status,
        homeTeamId,
        awayTeamId,
        updatedAt: new Date()
      });
    }

    return Array.from(byGameId.values());
  }

  private buildTeamStats(
    lineScores: Array<Record<string, any>>,
    gameHeaders: Array<Record<string, any>>,
    teamIdByProvider: Map<string, string>,
    gameIdByProvider: Map<string, string>
  ): Partial<TeamGameStat>[] {
    const homeTeamByGame = new Map<string, string>();
    const awayTeamByGame = new Map<string, string>();

    for (const row of gameHeaders) {
      const providerGameId = this.pickString(row, ["GAME_ID", "gameId"]);
      const homeProviderId = this.pickString(row, [
        "HOME_TEAM_ID",
        "homeTeamId"
      ]);
      const awayProviderId = this.pickString(row, [
        "VISITOR_TEAM_ID",
        "visitorTeamId"
      ]);

      if (providerGameId && homeProviderId) {
        homeTeamByGame.set(providerGameId, homeProviderId);
      }
      if (providerGameId && awayProviderId) {
        awayTeamByGame.set(providerGameId, awayProviderId);
      }
    }

    return lineScores
      .map((row) => {
        const providerGameId = this.pickString(row, ["GAME_ID", "gameId"]);
        const providerTeamId = this.pickString(row, ["TEAM_ID", "teamId"]);
        if (!providerGameId || !providerTeamId) {
          return null;
        }

        const gameId = gameIdByProvider.get(providerGameId);
        const teamId = teamIdByProvider.get(providerTeamId);

        if (!gameId || !teamId) {
          return null;
        }

        const isHome = homeTeamByGame.get(providerGameId) === providerTeamId;
        const pts = this.pickNumber(row, ["PTS", "pts"], 0) ?? 0;

        return {
          gameId,
          teamId,
          isHome,
          pts,
          updatedAt: new Date()
        } as Partial<TeamGameStat>;
      })
      .filter((item): item is Partial<TeamGameStat> => Boolean(item));
  }

  private buildTeamStatsFromBoxscore(
    traditionalRows: Array<Record<string, any>>,
    advancedRows: Array<Record<string, any>>,
    game: Game,
    teamIdByProvider: Map<string, string>
  ): Partial<TeamGameStat>[] {
    const advancedByTeam = new Map<string, Record<string, any>>();

    for (const row of advancedRows) {
      const teamId = this.pickString(row, ["TEAM_ID", "teamId"]);
      if (teamId) {
        advancedByTeam.set(teamId, row);
      }
    }

    return traditionalRows
      .map((row) => {
        const providerTeamId = this.pickString(row, ["TEAM_ID", "teamId"]);
        if (!providerTeamId) {
          return null;
        }

        const teamId = teamIdByProvider.get(providerTeamId);
        if (!teamId) {
          return null;
        }

        const advanced = advancedByTeam.get(providerTeamId);
        const isHome = teamId === game.homeTeamId;

        return {
          gameId: game.id,
          teamId,
          isHome,
          pts: this.pickNumber(row, ["PTS", "points", "pts"], 0) ?? 0,
          reb: this.pickNumber(row, ["REB", "reboundsTotal", "reb"], null),
          ast: this.pickNumber(row, ["AST", "assists", "ast"], null),
          tov: this.pickNumber(row, ["TOV", "turnovers", "tov"], null),
          fgm: this.pickNumber(row, ["FGM", "fieldGoalsMade", "fgm"], null),
          fga: this.pickNumber(row, ["FGA", "fieldGoalsAttempted", "fga"], null),
          fg3m: this.pickNumber(row, ["FG3M", "threePointersMade", "fg3m"], null),
          fg3a: this.pickNumber(row, ["FG3A", "threePointersAttempted", "fg3a"], null),
          ftm: this.pickNumber(row, ["FTM", "freeThrowsMade", "ftm"], null),
          fta: this.pickNumber(row, ["FTA", "freeThrowsAttempted", "fta"], null),
          offRtg: advanced
            ? this.pickNumber(advanced, ["offensiveRating", "OFF_RTG", "offRtg"], null)
            : null,
          defRtg: advanced
            ? this.pickNumber(advanced, ["defensiveRating", "DEF_RTG", "defRtg"], null)
            : null,
          pace: advanced ? this.pickNumber(advanced, ["pace", "PACE"], null) : null,
          tsPct: advanced
            ? this.pickNumber(advanced, ["trueShootingPercentage", "TS_PCT", "tsPct"], null)
            : null,
          updatedAt: new Date()
        } as Partial<TeamGameStat>;
      })
      .filter((item): item is Partial<TeamGameStat> => Boolean(item));
  }

  private buildPlayersFromCommonAll(
    playerRows: Array<Record<string, any>>
  ): Partial<Player>[] {
    const seen = new Map<string, Partial<Player>>();

    for (const row of playerRows) {
      const providerPlayerId = this.pickString(row, [
        "PERSON_ID",
        "personId",
        "PLAYER_ID",
        "playerId"
      ]);
      if (!providerPlayerId) {
        continue;
      }

      const displayName =
        this.pickString(row, ["DISPLAY_FIRST_LAST", "displayFirstLast"]) ||
        this.pickString(row, ["DISPLAY_LAST_COMMA_FIRST", "displayLastCommaFirst"]) ||
        providerPlayerId;

      const rosterStatus = this.pickString(row, [
        "ROSTERSTATUS",
        "rosterStatus",
        "isActive"
      ]);

      const isActive = rosterStatus
        ? rosterStatus === "1" || rosterStatus === "true"
        : true;

      seen.set(providerPlayerId, {
        provider: PROVIDER,
        providerPlayerId,
        firstName: this.pickString(row, ["FIRST_NAME", "firstName"]) || displayName.split(" ")[0] || displayName,
        lastName: this.pickString(row, ["LAST_NAME", "lastName"]) || displayName.split(" ").slice(1).join(" ") || "",
        displayName,
        position: this.pickString(row, ["POSITION", "position"]),
        heightCm: this.parseHeightToCm(this.pickString(row, ["HEIGHT", "height"])),
        weightKg: this.parseWeightToKg(this.pickString(row, ["WEIGHT", "weight"])),
        birthdate: this.parseBirthdate(this.pickString(row, ["BIRTHDATE", "birthdate"])),
        country: this.pickString(row, ["COUNTRY", "country"]),
        isActive,
        shoots: this.pickString(row, ["SHOOTS", "shoots"]),
        updatedAt: new Date()
      });
    }

    return Array.from(seen.values());
  }

  private buildPlayersFromBoxscore(
    playerRows: Array<Record<string, any>>
  ): Partial<Player>[] {
    const seen = new Map<string, Partial<Player>>();

    for (const row of playerRows) {
      const providerPlayerId = this.pickString(row, [
        "PLAYER_ID",
        "playerId",
        "personId"
      ]);
      if (!providerPlayerId) {
        continue;
      }

      const displayName =
        this.pickString(row, ["PLAYER_NAME", "playerName", "name"]) ||
        this.pickString(row, ["firstName", "first_name"]) ||
        providerPlayerId;

      const firstName =
        this.pickString(row, ["firstName", "FIRST_NAME", "first_name"]) ||
        displayName.split(" ")[0] ||
        displayName;
      const lastName =
        this.pickString(row, ["lastName", "LAST_NAME", "last_name"]) ||
        displayName.split(" ").slice(1).join(" ") ||
        "";

      seen.set(providerPlayerId, {
        provider: PROVIDER,
        providerPlayerId,
        firstName,
        lastName,
        displayName,
        isActive: true,
        updatedAt: new Date()
      });
    }

    return Array.from(seen.values());
  }

  private buildPlayersFromRoster(
    rosterRows: Array<Record<string, any>>
  ): Partial<Player>[] {
    const seen = new Map<string, Partial<Player>>();

    for (const row of rosterRows) {
      const providerPlayerId = this.pickString(row, [
        "PLAYER_ID",
        "playerId",
        "personId"
      ]);
      if (!providerPlayerId) {
        continue;
      }

      const displayName =
        this.pickString(row, ["PLAYER", "PLAYER_NAME", "playerName"]) ||
        providerPlayerId;

      seen.set(providerPlayerId, {
        provider: PROVIDER,
        providerPlayerId,
        firstName: displayName.split(" ")[0] || displayName,
        lastName: displayName.split(" ").slice(1).join(" ") || "",
        displayName,
        isActive: true,
        updatedAt: new Date()
      });
    }

    return Array.from(seen.values());
  }

  private buildPlayerFromInfo(
    payload: CommonPlayerInfoPayload
  ): Partial<Player> | null {
    const info = payload.player_info?.[0];
    if (!info) {
      return null;
    }

    return {
      firstName: this.pickString(info, ["FIRST_NAME", "firstName"]) || "",
      lastName: this.pickString(info, ["LAST_NAME", "lastName"]) || "",
      displayName:
        this.pickString(info, ["DISPLAY_FIRST_LAST", "displayFirstLast"]) ||
        this.pickString(info, ["DISPLAY_LAST_COMMA_FIRST", "displayLastCommaFirst"]) ||
        "",
      position: this.pickString(info, ["POSITION", "position"]),
      heightCm: this.parseHeightToCm(this.pickString(info, ["HEIGHT", "height"])),
      weightKg: this.parseWeightToKg(this.pickString(info, ["WEIGHT", "weight"])),
      birthdate: this.parseBirthdate(this.pickString(info, ["BIRTHDATE", "birthdate"])),
      country: this.pickString(info, ["COUNTRY", "country"]),
      shoots: this.pickString(info, ["SHOOTS", "shoots"])
    };
  }

  private buildPlayerGameStats(
    playerRows: Array<Record<string, any>>,
    game: Game,
    teamIdByProvider: Map<string, string>,
    playerIdByProvider: Map<string, string>
  ): Partial<PlayerGameStats>[] {
    const byPlayer = new Map<string, Partial<PlayerGameStats>>();

    for (const row of playerRows) {
        const providerPlayerId = this.pickString(row, [
          "PLAYER_ID",
          "playerId",
          "personId"
        ]);
        const providerTeamId = this.pickString(row, ["TEAM_ID", "teamId"]);

        if (!providerPlayerId || !providerTeamId) {
          continue;
        }

        const playerId = playerIdByProvider.get(providerPlayerId);
        const teamId = teamIdByProvider.get(providerTeamId);

        if (!playerId || !teamId) {
          continue;
        }

        const minutes = this.parseMinutes(
          row.MINUTES ?? row.minutes ?? row.min ?? row.MIN ?? null
        );

        byPlayer.set(playerId, {
          provider: PROVIDER,
          gameId: game.id,
          playerId,
          teamId,
          isStarter: this.pickBoolean(row, ["STARTER", "starter", "isStarter"]),
          minutes,
          pts: this.pickNumber(row, ["PTS", "points", "pts"], 0) ?? 0,
          reb: this.pickNumber(row, ["REB", "reboundsTotal", "reb"], 0) ?? 0,
          ast: this.pickNumber(row, ["AST", "assists", "ast"], 0) ?? 0,
          tov: this.pickNumber(row, ["TOV", "turnovers", "tov"], 0) ?? 0,
          stl: this.pickNumber(row, ["STL", "steals", "stl"], null),
          blk: this.pickNumber(row, ["BLK", "blocks", "blk"], null),
          fgm: this.pickNumber(row, ["FGM", "fieldGoalsMade", "fgm"], null),
          fga: this.pickNumber(row, ["FGA", "fieldGoalsAttempted", "fga"], null),
          fg3m: this.pickNumber(row, ["FG3M", "threePointersMade", "fg3m"], null),
          fg3a: this.pickNumber(row, ["FG3A", "threePointersAttempted", "fg3a"], null),
          ftm: this.pickNumber(row, ["FTM", "freeThrowsMade", "ftm"], null),
          fta: this.pickNumber(row, ["FTA", "freeThrowsAttempted", "fta"], null),
          plusMinus: this.pickNumber(row, ["PLUS_MINUS", "plusMinus"], null),
          didNotPlayReason: this.pickString(row, [
            "DNP",
            "didNotPlayReason",
            "notPlayingReason"
          ]),
          updatedAt: new Date()
        });
      }

    return Array.from(byPlayer.values());
  }

  private resolveScores(
    teamStatsPayload: Array<Partial<TeamGameStat>>,
    game: Game
  ) {
    let homeScore: number | null = null;
    let awayScore: number | null = null;

    for (const stat of teamStatsPayload) {
      if (!stat.teamId) {
        continue;
      }
      if (stat.teamId === game.homeTeamId) {
        homeScore = stat.pts ?? homeScore;
      }
      if (stat.teamId === game.awayTeamId) {
        awayScore = stat.pts ?? awayScore;
      }
    }

    return { homeScore, awayScore };
  }

  private parseGameDateTimeUtc(
    dateStr: string | null,
    statusText: string | null
  ): { dateTimeUtc: Date | null; dateOnly: Date | null; hasTipoffTime: boolean } {
    if (!dateStr) {
      return { dateTimeUtc: null, dateOnly: null, hasTipoffTime: false };
    }

    const dateOnly = new Date(dateStr);
    if (Number.isNaN(dateOnly.getTime())) {
      return { dateTimeUtc: null, dateOnly: null, hasTipoffTime: false };
    }

    const match = statusText?.match(/(\d{1,2}):(\d{2})\s*([ap]m)\s*ET/i);
    if (!match) {
      return { dateTimeUtc: null, dateOnly, hasTipoffTime: false };
    }

    const hour12 = Number(match[1]);
    const minute = Number(match[2]);
    const ampm = match[3].toLowerCase();
    let hour = hour12 % 12;
    if (ampm === "pm") {
      hour += 12;
    }

    const year = dateOnly.getUTCFullYear();
    const month = dateOnly.getUTCMonth() + 1;
    const day = dateOnly.getUTCDate();
    const dateTimeUtc = this.zonedTimeToUtc(
      { year, month, day, hour, minute },
      "America/New_York"
    );

    return { dateTimeUtc, dateOnly, hasTipoffTime: true };
  }

  private formatDateOnly(date: Date) {
    return date.toISOString().slice(0, 10);
  }

  private formatDateInTimeZone(date: Date, timeZone: string) {
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

  private zonedTimeToUtc(
    parts: { year: number; month: number; day: number; hour: number; minute: number },
    timeZone: string
  ) {
    const utcDate = new Date(
      Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0)
    );
    const offset = this.getTimeZoneOffset(utcDate, timeZone);
    return new Date(utcDate.getTime() - offset);
  }

  private getTimeZoneOffset(date: Date, timeZone: string) {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
    const parts = dtf.formatToParts(date);
    const values: Record<string, string> = {};
    for (const part of parts) {
      if (part.type !== "literal") {
        values[part.type] = part.value;
      }
    }
    const asUtc = Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute),
      Number(values.second)
    );
    return asUtc - date.getTime();
  }

  private async ensurePlayerSeasonTeams(
    game: Game,
    stats: Array<Partial<PlayerGameStats>>
  ) {
    if (stats.length === 0) {
      return;
    }

    const seasonStart =
      this.getSeasonStart(game.season) ?? game.dateTimeUtc;

    if (!this.getSeasonStart(game.season)) {
      await this.recordConflict({
        conflictType: "missing_season_start",
        season: game.season,
        detailsJson: { providerGameId: game.providerGameId }
      });
    }

    const pairs = Array.from(
      new Map(
        stats
          .filter((row) => row.playerId && row.teamId)
          .map((row) => [`${row.playerId}:${row.teamId}`, row])
      ).values()
    ) as Array<Partial<PlayerGameStats>>;

    const playerIds = Array.from(
      new Set(pairs.map((row) => row.playerId).filter(Boolean))
    ) as string[];
    const teamIds = Array.from(
      new Set(pairs.map((row) => row.teamId).filter(Boolean))
    ) as string[];

    const existing = await this.playerSeasonTeamRepo.find({
      where: {
        playerId: In(playerIds),
        teamId: In(teamIds),
        season: game.season
      }
    });

    const existingKey = new Set(
      existing.map((row) => `${row.playerId}:${row.teamId}`)
    );

    const inserts: Array<Partial<PlayerSeasonTeam>> = [];
    for (const row of pairs) {
      if (!row.playerId || !row.teamId) {
        continue;
      }
      const key = `${row.playerId}:${row.teamId}`;
      if (existingKey.has(key)) {
        continue;
      }
      inserts.push({
        provider: PROVIDER,
        playerId: row.playerId,
        teamId: row.teamId,
        season: game.season,
        fromUtc: seasonStart,
        toUtc: null,
        updatedAt: new Date()
      });
    }

    if (inserts.length > 0) {
      await this.playerSeasonTeamRepo
        .createQueryBuilder()
        .insert()
        .values(inserts)
        .orIgnore()
        .execute();
    }
  }

  private needsPlayerInfo(player: Partial<Player>) {
    return (
      !player.position ||
      !player.heightCm ||
      !player.weightKg ||
      !player.birthdate ||
      !player.country ||
      !player.shoots
    );
  }

  private stripNullPlayerFields(player: Partial<Player>) {
    const cleaned: Partial<Player> = { ...player };
    const optionalFields: Array<keyof Player> = [
      "position",
      "heightCm",
      "weightKg",
      "birthdate",
      "country",
      "shoots"
    ];
    for (const field of optionalFields) {
      if (cleaned[field] === null || cleaned[field] === undefined) {
        delete cleaned[field];
      }
    }
    return cleaned;
  }

  private async enrichPlayersByProviderIds(
    providerPlayerIds: string[],
    season?: number
  ) {
    const uniqueIds = Array.from(new Set(providerPlayerIds)).filter(Boolean);
    if (uniqueIds.length === 0) {
      return 0;
    }

    const players = await this.playerRepo.find({
      where: {
        provider: PROVIDER,
        providerPlayerId: In(uniqueIds)
      }
    });

    const candidates = players.filter((player) =>
      this.needsPlayerInfo(player)
    );

    if (candidates.length === 0) {
      return 0;
    }

    const infoLimit = Number(
      this.configService.get<string>("NBA_PLAYER_INFO_LIMIT") || 0
    );
    const toEnrich =
      infoLimit > 0 ? candidates.slice(0, infoLimit) : candidates;

    let enriched = 0;

    for (const player of toEnrich) {
      if (!player.providerPlayerId) {
        continue;
      }
      try {
        const info = await this.fetchPlayerInfo(player.providerPlayerId);
        const infoPayload = this.buildPlayerFromInfo(info);
        if (!infoPayload) {
          continue;
        }
        await this.playerRepo.update(
          { provider: PROVIDER, providerPlayerId: player.providerPlayerId },
          {
            ...infoPayload,
            updatedAt: new Date()
          }
        );
        enriched += 1;
      } catch (error) {
        await this.recordConflict({
          conflictType: "player_info_failed",
          playerId: player.id,
          season,
          detailsJson: {
            providerPlayerId: player.providerPlayerId,
            message: error instanceof Error ? error.message : String(error)
          }
        });
      }
    }

    if (infoLimit > 0 && candidates.length > infoLimit) {
      await this.recordConflict({
        conflictType: "player_info_limit",
        season,
        detailsJson: {
          total: candidates.length,
          processed: infoLimit
        }
      });
    }

    return enriched;
  }

  private normalizeSeason(seasonInput?: string): SeasonInfo {
    const trimmed = seasonInput?.trim();
    if (!trimmed) {
      throw new Error("season is required, e.g. 2024-25");
    }

    const yearMatch = trimmed.match(/(\d{4})/);
    const seasonYear = yearMatch ? Number(yearMatch[1]) : NaN;
    if (Number.isNaN(seasonYear)) {
      throw new Error("invalid season format, expected 2024-25");
    }

    const seasonLabel =
      trimmed.length >= 7 && trimmed.includes("-")
        ? trimmed
        : `${seasonYear}-${String((seasonYear + 1) % 100).padStart(2, "0")}`;

    return { seasonYear, seasonLabel };
  }

  private getSeasonStart(seasonYear: number): Date | null {
    const key = `SEASON_START_UTC_${seasonYear}`;
    const value = this.configService.get<string>(key);
    if (!value) {
      return null;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private dateRange(date: string): { start: Date; end: Date } {
    const parsed = this.parseDate(date);
    const start = new Date(
      Date.UTC(
        parsed.getUTCFullYear(),
        parsed.getUTCMonth(),
        parsed.getUTCDate(),
        0,
        0,
        0
      )
    );
    const end = new Date(
      Date.UTC(
        parsed.getUTCFullYear(),
        parsed.getUTCMonth(),
        parsed.getUTCDate(),
        23,
        59,
        59,
        999
      )
    );

    return { start, end };
  }

  private dateRangeBetween(from: string, to: string): { start: Date; end: Date } {
    const startDate = this.parseDate(from);
    const endDate = this.parseDate(to);

    const start = new Date(
      Date.UTC(
        startDate.getUTCFullYear(),
        startDate.getUTCMonth(),
        startDate.getUTCDate(),
        0,
        0,
        0,
        0
      )
    );
    const end = new Date(
      Date.UTC(
        endDate.getUTCFullYear(),
        endDate.getUTCMonth(),
        endDate.getUTCDate(),
        23,
        59,
        59,
        999
      )
    );

    if (end.getTime() < start.getTime()) {
      throw new Error("to must be >= from");
    }

    return { start, end };
  }

  private parseDate(value: string): Date {
    const parsed = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error("date must be YYYY-MM-DD");
    }
    return parsed;
  }

  private pickString(row: Record<string, any>, keys: string[]): string | null {
    for (const key of keys) {
      const value = row?.[key];
      if (value !== undefined && value !== null && String(value).trim() !== "") {
        return String(value);
      }
    }
    return null;
  }

  private pickNumber(
    row: Record<string, any>,
    keys: string[],
    fallback: number | null
  ): number | null {
    for (const key of keys) {
      const value = row?.[key];
      if (value === undefined || value === null || value === "") {
        continue;
      }
      const parsed = Number(value);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
    return fallback;
  }

  private pickBoolean(row: Record<string, any>, keys: string[]): boolean | null {
    for (const key of keys) {
      const value = row?.[key];
      if (value === undefined || value === null) {
        continue;
      }
      if (typeof value === "boolean") {
        return value;
      }
      if (value === "1" || value === 1) {
        return true;
      }
      if (value === "0" || value === 0) {
        return false;
      }
      if (value === "true") {
        return true;
      }
      if (value === "false") {
        return false;
      }
    }
    return null;
  }

  private buildInjuryReportEntries(
    entries: Array<Record<string, any>>,
    reportId: string
  ): Partial<InjuryReportEntry>[] {
    return entries
      .map((entry) => {
        const normalized = this.normalizeInjuryEntry(entry);

        const gameDate = this.toDateString(
          this.pickEntry(normalized, ["gamedate"])
        );
        const gameTime = this.pickEntry(normalized, ["gametime"]);
        const matchup = this.pickEntry(normalized, ["matchup"]);
        const teamAbbrev = this.pickEntry(normalized, [
          "team",
          "teamabbrev",
          "teamabbr"
        ]);
        const playerName = this.pickEntry(normalized, [
          "playername",
          "player"
        ]);
        const status = this.pickEntry(normalized, [
          "status",
          "currentstatus"
        ]);
        const injury = this.pickEntry(normalized, [
          "injury",
          "injuryillness"
        ]);
        const reason = this.pickEntry(normalized, ["reason"]);
        const notes = this.pickEntry(normalized, [
          "notes",
          "comment",
          "remarks"
        ]);

        if (!teamAbbrev && !playerName && !matchup) {
          return null;
        }

        return {
          reportId,
          gameDate,
          gameTime: gameTime ? String(gameTime) : null,
          matchup: matchup ? String(matchup) : null,
          teamAbbrev: teamAbbrev ? String(teamAbbrev) : null,
          playerName: playerName ? String(playerName) : null,
          status: status ? String(status) : null,
          injury: injury ? String(injury) : null,
          reason: reason ? String(reason) : null,
          notes: notes ? String(notes) : null,
          rawJson: entry ?? null,
          updatedAt: new Date()
        } as Partial<InjuryReportEntry>;
      })
      .filter((item): item is Partial<InjuryReportEntry> => Boolean(item));
  }

  private async matchInjuryReportEntries(
    entries: Partial<InjuryReportEntry>[],
    reportDate?: string | null
  ): Promise<Partial<InjuryReportEntry>[]> {
    const teams = await this.teamRepo.find({
      where: { provider: PROVIDER }
    });
    const teamMatches = this.buildTeamMatchMap(teams);

    const teamIds = new Set<string>();
    for (const entry of entries) {
      const teamName = entry.teamAbbrev || "";
      const team = this.matchTeam(teamName, teams, teamMatches);
      if (team) {
        entry.teamId = team.id;
        teamIds.add(team.id);
      }
    }

    const seasonYear = reportDate
      ? this.inferSeasonYear(reportDate)
      : undefined;

    const playerContext = await this.buildPlayerMatchContext(
      Array.from(teamIds),
      seasonYear
    );

    for (const entry of entries) {
      if (!entry.playerName) {
        continue;
      }
      const playerId = this.matchPlayer(
        entry.playerName,
        entry.teamId ?? null,
        playerContext
      );
      if (playerId) {
        entry.playerId = playerId;
      }
    }

    return entries;
  }

  private inferSeasonYear(reportDate: string): number | null {
    const parsed = new Date(`${reportDate}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    const year = parsed.getUTCFullYear();
    const month = parsed.getUTCMonth() + 1;
    return month >= 10 ? year : year - 1;
  }

  private buildTeamMatchMap(teams: Team[]) {
    const map = new Map<string, Team[]>();
    for (const team of teams) {
      const keys = new Set<string>();
      if (team.abbrev) {
        keys.add(this.normalizeName(team.abbrev));
      }
      if (team.name) {
        keys.add(this.normalizeName(team.name));
      }
      for (const key of keys) {
        if (!key) {
          continue;
        }
        const list = map.get(key) || [];
        list.push(team);
        map.set(key, list);
      }
    }
    return map;
  }

  private matchTeam(
    teamLabel: string,
    teams: Team[],
    teamMatches: Map<string, Team[]>
  ): Team | null {
    const normalized = this.normalizeName(teamLabel);
    if (!normalized) {
      return null;
    }
    const direct = teamMatches.get(normalized);
    if (direct && direct.length > 0) {
      return direct[0];
    }

    let best: Team | null = null;
    let bestScore = 0;
    for (const team of teams) {
      const nameKey = this.normalizeName(team.name || "");
      const abbrevKey = this.normalizeName(team.abbrev || "");
      const candidates = [nameKey, abbrevKey];
      for (const candidate of candidates) {
        if (!candidate) {
          continue;
        }
        if (candidate.includes(normalized) || normalized.includes(candidate)) {
          const score = Math.min(candidate.length, normalized.length);
          if (score > bestScore) {
            best = team;
            bestScore = score;
          }
        }
      }
    }
    return best;
  }

  private async buildPlayerMatchContext(
    teamIds: string[],
    seasonYear?: number | null
  ) {
    const players = await this.playerRepo.find({
      where: { provider: PROVIDER }
    });

    let teamRows: Array<{ playerId: string; teamId: string }> = [];
    if (teamIds.length > 0) {
      const qb = this.playerSeasonTeamRepo
        .createQueryBuilder("pst")
        .select(["pst.player_id AS playerId", "pst.team_id AS teamId"]);

      if (seasonYear) {
        qb.where("pst.season = :season", { season: seasonYear });
      } else {
        qb.where("pst.to_utc IS NULL");
      }
      qb.andWhere("pst.team_id IN (:...teamIds)", { teamIds });
      teamRows = await qb.getRawMany();
    }

    const teamByPlayer = new Map<string, Set<string>>();
    for (const row of teamRows) {
      const set = teamByPlayer.get(row.playerId) || new Set<string>();
      set.add(row.teamId);
      teamByPlayer.set(row.playerId, set);
    }

    const nameMap = new Map<string, string[]>();
    for (const player of players) {
      const keys = this.buildPlayerNameKeys(player);
      for (const key of keys) {
        const list = nameMap.get(key) || [];
        list.push(player.id);
        nameMap.set(key, list);
      }
    }

    return { nameMap, teamByPlayer };
  }

  private matchPlayer(
    playerName: string,
    teamId: string | null,
    context: {
      nameMap: Map<string, string[]>;
      teamByPlayer: Map<string, Set<string>>;
    }
  ): string | null {
    const keys = this.buildEntryNameKeys(playerName);
    const candidates = new Set<string>();
    for (const key of keys) {
      const ids = context.nameMap.get(key);
      if (ids) {
        ids.forEach((id) => candidates.add(id));
      }
    }

    if (candidates.size === 0) {
      return null;
    }

    if (teamId) {
      for (const playerId of candidates) {
        const teamSet = context.teamByPlayer.get(playerId);
        if (teamSet && teamSet.has(teamId)) {
          return playerId;
        }
      }
    }

    if (candidates.size === 1) {
      return Array.from(candidates)[0];
    }

    return null;
  }

  private buildPlayerNameKeys(player: Player): Set<string> {
    const keys = new Set<string>();
    const first = player.firstName || "";
    const last = player.lastName || "";
    const display = player.displayName || "";

    const normalizedDisplay = this.normalizePersonName(display);
    const normalizedFirstLast = this.normalizePersonName(`${first} ${last}`);
    const normalizedLastFirst = this.normalizePersonName(`${last},${first}`);

    if (normalizedDisplay) {
      keys.add(normalizedDisplay);
    }
    if (normalizedFirstLast) {
      keys.add(normalizedFirstLast);
    }
    if (normalizedLastFirst) {
      keys.add(normalizedLastFirst);
    }
    return keys;
  }

  private buildEntryNameKeys(name: string): Set<string> {
    const keys = new Set<string>();
    const trimmed = (name || "").trim();
    if (!trimmed) {
      return keys;
    }
    keys.add(this.normalizePersonName(trimmed));

    if (trimmed.includes(",")) {
      const [last, first] = trimmed.split(",").map((part) => part.trim());
      if (last && first) {
        keys.add(this.normalizePersonName(`${first} ${last}`));
        keys.add(this.normalizePersonName(`${last} ${first}`));
      }
    }
    return keys;
  }

  private normalizeName(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }

  private normalizePersonName(value: string): string {
    const cleaned = value
      .toLowerCase()
      .replace(/[^a-z]/g, "")
      .replace(/(jr|sr|ii|iii|iv)$/g, "");
    return cleaned;
  }

  private normalizeInjuryEntry(entry: Record<string, any>) {
    const normalized: Record<string, any> = {};
    for (const [key, value] of Object.entries(entry || {})) {
      const normalizedKey = String(key)
        .replace(/[\s_]+/g, "")
        .toLowerCase();
      normalized[normalizedKey] = value;
    }
    return normalized;
  }

  private pickEntry(
    entry: Record<string, any>,
    keys: string[]
  ): string | null {
    for (const key of keys) {
      const value = entry[key];
      if (value !== undefined && value !== null && value !== "") {
        return String(value);
      }
    }
    return null;
  }

  private toDateString(value?: string | null): string | null {
    if (!value) {
      return null;
    }
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }
    const usMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (usMatch) {
      const month = usMatch[1].padStart(2, "0");
      const day = usMatch[2].padStart(2, "0");
      return `${usMatch[3]}-${month}-${day}`;
    }
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
    return null;
  }

  private parseMinutes(value: unknown): number | null {
    if (value === undefined || value === null || value === "") {
      return null;
    }

    if (typeof value === "number") {
      return value;
    }

    const text = String(value);

    if (/^\d+(\.\d+)?$/.test(text)) {
      return Number(text);
    }

    const clockMatch = text.match(/^(\d+):(\d{2})$/);
    if (clockMatch) {
      const minutes = Number(clockMatch[1]);
      const seconds = Number(clockMatch[2]);
      return minutes + seconds / 60;
    }

    const isoMatch = text.match(/PT(\d+)M(\d+)?S?/);
    if (isoMatch) {
      const minutes = Number(isoMatch[1]);
      const seconds = isoMatch[2] ? Number(isoMatch[2]) : 0;
      return minutes + seconds / 60;
    }

    return null;
  }

  private parseHeightToCm(height: string | null): number | null {
    if (!height) {
      return null;
    }
    const match = height.match(/(\d+)[-'](\d+)/);
    if (match) {
      const feet = Number(match[1]);
      const inches = Number(match[2]);
      if (!Number.isNaN(feet) && !Number.isNaN(inches)) {
        return Math.round((feet * 12 + inches) * 2.54);
      }
    }
    const numeric = Number(height);
    return Number.isNaN(numeric) ? null : Math.round(numeric * 2.54);
  }

  private parseWeightToKg(weight: string | null): number | null {
    if (!weight) {
      return null;
    }
    const numeric = Number(weight);
    if (Number.isNaN(numeric)) {
      return null;
    }
    return Math.round(numeric / 2.20462);
  }

  private parseBirthdate(value: string | null): Date | null {
    if (!value) {
      return null;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private clampPage(value?: number) {
    if (!value || value < 1) {
      return 1;
    }
    return Math.floor(value);
  }

  private clampPageSize(value?: number) {
    const size = value && value > 0 ? Math.floor(value) : 50;
    return Math.min(size, 200);
  }

  private clampLimit(
    value: number | undefined,
    fallback: number,
    min: number,
    max: number
  ) {
    const parsed = Number.isFinite(value as number)
      ? Math.floor(value as number)
      : fallback;
    if (parsed < min) {
      return min;
    }
    if (parsed > max) {
      return max;
    }
    return parsed;
  }

  private clampFloat(value: number, min: number, max: number) {
    if (!Number.isFinite(value)) {
      return min;
    }
    return Math.min(Math.max(value, min), max);
  }

  private parseEnvNumber(key: string, fallback: number) {
    const raw = this.configService.get<string>(key);
    const parsed = raw !== undefined ? Number(raw) : NaN;
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private async findGameWithTeams(gameId: string) {
    return this.gameRepo.findOne({
      where: [
        { id: gameId, provider: PROVIDER },
        { provider: PROVIDER, providerGameId: gameId }
      ],
      relations: ["homeTeam", "awayTeam"]
    });
  }

  private async findTeamByAbbrev(abbrev: string) {
    const normalized = (abbrev || "").trim().toLowerCase();
    if (!normalized) {
      return null;
    }
    return this.teamRepo
      .createQueryBuilder("team")
      .where("team.provider = :provider", { provider: PROVIDER })
      .andWhere("lower(team.abbrev) = :abbrev", { abbrev: normalized })
      .getOne();
  }

  private async findGameByMatchup(input: {
    date: string;
    home: string;
    away: string;
  }) {
    const homeTeam = await this.findTeamByAbbrev(input.home);
    const awayTeam = await this.findTeamByAbbrev(input.away);
    if (!homeTeam || !awayTeam) {
      return null;
    }

    const { start, end } = this.dateRange(input.date);
    return this.gameRepo
      .createQueryBuilder("game")
      .leftJoinAndSelect("game.homeTeam", "homeTeam")
      .leftJoinAndSelect("game.awayTeam", "awayTeam")
      .where("game.provider = :provider", { provider: PROVIDER })
      .andWhere("game.home_team_id = :homeTeamId", { homeTeamId: homeTeam.id })
      .andWhere("game.away_team_id = :awayTeamId", { awayTeamId: awayTeam.id })
      .andWhere("game.date_time_utc BETWEEN :start AND :end", { start, end })
      .orderBy("game.dateTimeUtc", "ASC")
      .getOne();
  }

  private stripGameRelations(game: Game) {
    const { homeTeam, awayTeam, polymarketEvent, ...rest } = game as Game & {
      homeTeam?: Team;
      awayTeam?: Team;
      polymarketEvent?: Event | null;
    };
    return rest;
  }

  private async buildGameContext(
    game: Game,
    options?: {
      matchupLimit?: number;
      recentLimit?: number;
      marketPage?: number;
      marketPageSize?: number;
    }
  ): Promise<GameContext> {
    const homeTeam =
      (game as any).homeTeam ??
      (await this.teamRepo.findOne({ where: { id: game.homeTeamId } }));
    const awayTeam =
      (game as any).awayTeam ??
      (await this.teamRepo.findOne({ where: { id: game.awayTeamId } }));
    const gameDate = game.dateTimeUtc ?? new Date();

    const matchupLimit = this.clampLimit(options?.matchupLimit, 5, 1, 20);
    const recentLimit = this.clampLimit(options?.recentLimit, 5, 1, 20);

    const [homePlayers, awayPlayers, recentMatchups, recentHome, recentAway] =
      await Promise.all([
        homeTeam
          ? this.listRosterForTeam(homeTeam.id, game.season, gameDate)
          : Promise.resolve([]),
        awayTeam
          ? this.listRosterForTeam(awayTeam.id, game.season, gameDate)
          : Promise.resolve([]),
        homeTeam && awayTeam
          ? this.listRecentMatchups(
              homeTeam.id,
              awayTeam.id,
              gameDate,
              matchupLimit
            )
          : Promise.resolve([]),
        homeTeam
          ? this.listRecentGamesForTeam(homeTeam.id, gameDate, recentLimit)
          : Promise.resolve([]),
        awayTeam
          ? this.listRecentGamesForTeam(awayTeam.id, gameDate, recentLimit)
          : Promise.resolve([])
      ]);

    const [teamStats, polymarket, injuries] = await Promise.all([
      this.teamGameStatRepo.find({ where: { gameId: game.id } }),
      this.listPolymarketMarketsForGame(game.id, {
        page: options?.marketPage,
        pageSize: options?.marketPageSize
      }),
      this.getLatestInjuryReportForTeams(
        [homeTeam?.abbrev, awayTeam?.abbrev].filter(
          (value): value is string => Boolean(value)
        )
      )
    ]);

    return {
      game: this.stripGameRelations(game),
      homeTeam: homeTeam ?? null,
      awayTeam: awayTeam ?? null,
      homePlayers,
      awayPlayers,
      recentMatchups,
      recentForm: {
        home: recentHome,
        away: recentAway
      },
      injuries,
      polymarket,
      teamStats
    };
  }

  private async runAnalysis(
    context: GameContext,
    options?: {
      model?: string;
      temperature?: number;
    }
  ): Promise<GameAnalysisResult> {
    const model =
      options?.model ||
      this.configService.get<string>("OPENAI_MODEL") ||
      "gpt-4o-mini";
    const envTemperature = Number(
      this.configService.get<string>("OPENAI_TEMPERATURE")
    );
    const baseTemperature = Number.isFinite(envTemperature)
      ? envTemperature
      : 0.2;
    const temperature = this.clampFloat(
      options?.temperature ?? baseTemperature,
      0,
      1
    );
    const maxOutputTokens = this.parseEnvNumber(
      "OPENAI_MAX_OUTPUT_TOKENS",
      700
    );

    const payload = await this.buildAnalysisPayload(context);
    const prompt = this.buildAnalysisPrompt(payload);

    const client = await this.getOpenAIClient();
    const response = await client.responses.create({
      model,
      input: prompt,
      temperature,
      max_output_tokens: maxOutputTokens
    });

    const outputText =
      typeof response.output_text === "string"
        ? response.output_text.trim()
        : "";
    const parsed = this.parseAnalysisJson(outputText);

    return this.buildAnalysisResult({
      context,
      model,
      outputText,
      parsed,
      usage: (response as any).usage ?? null
    });
  }

  private async listRosterForTeam(
    teamId: string,
    season: number,
    asOf: Date
  ) {
    const qb = this.playerSeasonTeamRepo
      .createQueryBuilder("pst")
      .innerJoinAndSelect("pst.player", "player")
      .where("pst.provider = :provider", { provider: PROVIDER })
      .andWhere("player.provider = :provider", { provider: PROVIDER })
      .andWhere("pst.team_id = :teamId", { teamId })
      .andWhere("pst.season = :season", { season })
      .andWhere("pst.from_utc <= :asOf", { asOf })
      .andWhere("(pst.to_utc IS NULL OR pst.to_utc >= :asOf)", {
        asOf
      })
      .orderBy("player.displayName", "ASC");

    let rows = await qb.getMany();
    if (rows.length === 0) {
      rows = await this.playerSeasonTeamRepo
        .createQueryBuilder("pst")
        .innerJoinAndSelect("pst.player", "player")
        .where("pst.provider = :provider", { provider: PROVIDER })
        .andWhere("player.provider = :provider", { provider: PROVIDER })
        .andWhere("pst.team_id = :teamId", { teamId })
        .andWhere("pst.season = :season", { season })
        .andWhere("pst.to_utc IS NULL")
        .orderBy("player.displayName", "ASC")
        .getMany();
    }

    const players = rows
      .map((row) => row.player)
      .filter((player): player is Player => Boolean(player));
    const seen = new Set<string>();
    return players.filter((player) => {
      if (seen.has(player.id)) {
        return false;
      }
      seen.add(player.id);
      return true;
    });
  }

  private async listRecentMatchups(
    homeTeamId: string,
    awayTeamId: string,
    before: Date,
    limit: number
  ) {
    return this.gameRepo
      .createQueryBuilder("game")
      .where("game.provider = :provider", { provider: PROVIDER })
      .andWhere(
        "(game.home_team_id = :homeTeamId AND game.away_team_id = :awayTeamId) OR (game.home_team_id = :awayTeamId AND game.away_team_id = :homeTeamId)",
        { homeTeamId, awayTeamId }
      )
      .andWhere("game.date_time_utc < :before", { before })
      .orderBy("game.dateTimeUtc", "DESC")
      .take(limit)
      .getMany();
  }

  private async listRecentGamesForTeam(
    teamId: string,
    before: Date,
    limit: number
  ) {
    return this.gameRepo
      .createQueryBuilder("game")
      .where("game.provider = :provider", { provider: PROVIDER })
      .andWhere(
        "(game.home_team_id = :teamId OR game.away_team_id = :teamId)",
        { teamId }
      )
      .andWhere("game.date_time_utc < :before", { before })
      .orderBy("game.dateTimeUtc", "DESC")
      .take(limit)
      .getMany();
  }

  private async getLatestInjuryReportForTeams(teamAbbrevs: string[]) {
    const report = await this.injuryReportRepo
      .createQueryBuilder("report")
      .orderBy("report.reportDate", "DESC")
      .addOrderBy("report.createdAt", "DESC")
      .getOne();

    if (!report) {
      return {
        report: null,
        entries: { data: [], page: 1, pageSize: 0, total: 0 }
      };
    }

    const qb = this.injuryReportEntryRepo.createQueryBuilder("entry");
    qb.where("entry.report_id = :reportId", { reportId: report.id });
    qb.orderBy("entry.createdAt", "DESC");
    let data = await qb.getMany();

    if (teamAbbrevs.length > 0) {
      const teams = await this.teamRepo.find({
        where: { provider: PROVIDER, abbrev: In(teamAbbrevs) }
      });
      const teamIds = new Set(teams.map((team) => team.id));
      const normalized = new Set<string>();

      for (const team of teams) {
        if (team.abbrev) {
          normalized.add(this.normalizeName(team.abbrev));
        }
        if (team.name) {
          normalized.add(this.normalizeName(team.name));
        }
      }
      for (const abbrev of teamAbbrevs) {
        normalized.add(this.normalizeName(abbrev));
      }

      data = data.filter((entry) => {
        if (entry.teamId && teamIds.has(entry.teamId)) {
          return true;
        }
        const label = entry.teamAbbrev || "";
        const normalizedLabel = this.normalizeName(label);
        return normalizedLabel ? normalized.has(normalizedLabel) : false;
      });
    }

    return {
      report,
      entries: {
        data,
        page: 1,
        pageSize: data.length,
        total: data.length
      }
    };
  }

  private async getOpenAIClient() {
    if (this.openaiClient) {
      return this.openaiClient;
    }
    const apiKey = this.configService.get<string>("OPENAI_API_KEY");
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is required to use /nba/analysis.");
    }
    const { default: OpenAI } = await import("openai");
    this.openaiClient = new OpenAI({ apiKey });
    return this.openaiClient;
  }

  private async buildAnalysisPayload(context: GameContext) {
    const teamIds = new Set<string>();
    const collectTeams = (game: Game) => {
      if (game.homeTeamId) {
        teamIds.add(game.homeTeamId);
      }
      if (game.awayTeamId) {
        teamIds.add(game.awayTeamId);
      }
    };

    context.recentMatchups.forEach(collectTeams);
    context.recentForm.home.forEach(collectTeams);
    context.recentForm.away.forEach(collectTeams);
    if (context.homeTeam?.id) {
      teamIds.add(context.homeTeam.id);
    }
    if (context.awayTeam?.id) {
      teamIds.add(context.awayTeam.id);
    }

    const teamNameById = await this.buildTeamNameLookup(
      Array.from(teamIds)
    );

    const summarizeGame = (game: Game) => {
      const homeName =
        teamNameById.get(game.homeTeamId) ?? game.homeTeamId;
      const awayName =
        teamNameById.get(game.awayTeamId) ?? game.awayTeamId;
      return {
        date: game.dateTimeUtc?.toISOString(),
        status: game.status,
        homeTeam: homeName,
        awayTeam: awayName,
        homeScore: game.homeScore,
        awayScore: game.awayScore
      };
    };

    const summarizeGameForTeam = (game: Game, teamId: string) => {
      const isHome = game.homeTeamId === teamId;
      const opponentId = isHome ? game.awayTeamId : game.homeTeamId;
      const opponent =
        teamNameById.get(opponentId) ?? opponentId ?? "unknown";
      const teamScore = isHome ? game.homeScore : game.awayScore;
      const opponentScore = isHome ? game.awayScore : game.homeScore;
      let result: string | null = null;
      if (teamScore !== null && opponentScore !== null) {
        if (teamScore > opponentScore) {
          result = "W";
        } else if (teamScore < opponentScore) {
          result = "L";
        } else {
          result = "T";
        }
      }
      return {
        date: game.dateTimeUtc?.toISOString(),
        opponent,
        isHome,
        teamScore,
        opponentScore,
        result,
        status: game.status
      };
    };

    const rosterLimit = 12;
    const homeRoster = context.homePlayers
      .slice(0, rosterLimit)
      .map((player) => player.displayName || `${player.firstName} ${player.lastName}`.trim())
      .filter(Boolean);
    const awayRoster = context.awayPlayers
      .slice(0, rosterLimit)
      .map((player) => player.displayName || `${player.firstName} ${player.lastName}`.trim())
      .filter(Boolean);

    const injuries = context.injuries.entries.data.map((entry) => ({
      team: entry.teamAbbrev ?? entry.teamId ?? null,
      player: entry.playerName ?? null,
      status: entry.status ?? null,
      injury: entry.injury ?? null,
      notes: entry.notes ?? null
    }));

    const markets = context.polymarket.markets.data
      .slice(0, 5)
      .map((market) => ({
        marketId: market.polymarketMarketId ?? market.id,
        question: market.question,
        outcomes: market.outcomes,
        outcomePrices: market.outcomePrices,
        marketType: market.marketType,
        liquidity: market.liquidity,
        volume: market.volume
      }));

    return {
      game: {
        id: context.game.id,
        providerGameId: context.game.providerGameId,
        dateTimeUtc: context.game.dateTimeUtc?.toISOString(),
        status: context.game.status,
        season: context.game.season,
        homeScore: context.game.homeScore,
        awayScore: context.game.awayScore
      },
      teams: {
        home: context.homeTeam?.name ?? context.homeTeam?.abbrev ?? context.game.homeTeamId,
        away: context.awayTeam?.name ?? context.awayTeam?.abbrev ?? context.game.awayTeamId
      },
      roster: {
        home: homeRoster,
        away: awayRoster
      },
      recentMatchups: context.recentMatchups.map(summarizeGame),
      recentForm: {
        home: context.recentForm.home.map((game) =>
          summarizeGameForTeam(game, context.game.homeTeamId)
        ),
        away: context.recentForm.away.map((game) =>
          summarizeGameForTeam(game, context.game.awayTeamId)
        )
      },
      injuries,
      markets
    };
  }

  private buildAnalysisPrompt(payload: Record<string, any>) {
    return [
      "You are an NBA analytics assistant. Use only the data provided.",
      "Return JSON only, no markdown.",
      "Schema: { homeWinPct: number, awayWinPct: number, confidence: number, keyFactors: string[], analysis: string }",
      "Rules: homeWinPct + awayWinPct must equal 100. confidence is 0-100. analysis is 2-4 sentences. keyFactors has 3-6 short phrases.",
      "Data:",
      JSON.stringify(payload, null, 2)
    ].join("\n");
  }

  private parseAnalysisJson(text: string) {
    if (!text) {
      return null;
    }
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    const candidate = fenced ? fenced[1] : text.trim();
    const jsonStart = candidate.indexOf("{");
    const jsonEnd = candidate.lastIndexOf("}");
    if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
      return null;
    }
    const jsonText = candidate.slice(jsonStart, jsonEnd + 1);
    try {
      return JSON.parse(jsonText) as Record<string, any>;
    } catch {
      return null;
    }
  }

  private buildAnalysisResult(input: {
    context: GameContext;
    model: string;
    outputText: string;
    parsed: Record<string, any> | null;
    usage: Record<string, any> | null;
  }): GameAnalysisResult {
    const disclaimer =
      "AI-generated analysis. For informational use only; not financial advice.";
    const base: GameAnalysisResult = {
      gameId: input.context.game.id,
      homeTeam:
        input.context.homeTeam?.name ??
        input.context.homeTeam?.abbrev ??
        null,
      awayTeam:
        input.context.awayTeam?.name ??
        input.context.awayTeam?.abbrev ??
        null,
      homeWinPct: null,
      awayWinPct: null,
      confidence: null,
      keyFactors: [],
      analysis: input.outputText || "",
      model: input.model,
      generatedAt: new Date().toISOString(),
      disclaimer,
      usage: input.usage ?? null
    };

    if (!input.parsed) {
      return { ...base, raw: input.outputText || undefined };
    }

    const parsed = input.parsed;
    let homeWinPct =
      this.coerceNumber(parsed.homeWinPct) ??
      this.coerceNumber(parsed.home_win_pct) ??
      this.coerceNumber(parsed.homeWinProbability) ??
      this.coerceNumber(parsed.home_win_probability);
    let awayWinPct =
      this.coerceNumber(parsed.awayWinPct) ??
      this.coerceNumber(parsed.away_win_pct) ??
      this.coerceNumber(parsed.awayWinProbability) ??
      this.coerceNumber(parsed.away_win_probability);

    if (homeWinPct !== null && awayWinPct === null) {
      awayWinPct = 100 - homeWinPct;
    }
    if (awayWinPct !== null && homeWinPct === null) {
      homeWinPct = 100 - awayWinPct;
    }
    if (homeWinPct !== null && awayWinPct !== null) {
      const sum = homeWinPct + awayWinPct;
      if (sum > 0 && Math.abs(sum - 100) > 0.5) {
        const scale = 100 / sum;
        homeWinPct = this.roundPct(homeWinPct * scale);
        awayWinPct = this.roundPct(awayWinPct * scale);
      } else {
        homeWinPct = this.roundPct(homeWinPct);
        awayWinPct = this.roundPct(awayWinPct);
      }
    }

    const confidence =
      this.coerceNumber(parsed.confidence) ??
      this.coerceNumber(parsed.confidencePct) ??
      this.coerceNumber(parsed.confidence_pct);

    const keyFactorsRaw =
      parsed.keyFactors ??
      parsed.key_factors ??
      parsed.factors ??
      [];
    const keyFactors = Array.isArray(keyFactorsRaw)
      ? keyFactorsRaw
          .map((item: any) =>
            typeof item === "string" ? item.trim() : String(item || "").trim()
          )
          .filter((item: string) => Boolean(item))
          .slice(0, 8)
      : [];

    const analysis =
      typeof parsed.analysis === "string"
        ? parsed.analysis
        : typeof parsed.summary === "string"
          ? parsed.summary
          : input.outputText || "";

    return {
      ...base,
      homeWinPct:
        homeWinPct !== null ? this.clampFloat(homeWinPct, 0, 100) : null,
      awayWinPct:
        awayWinPct !== null ? this.clampFloat(awayWinPct, 0, 100) : null,
      confidence:
        confidence !== null ? this.clampFloat(confidence, 0, 100) : null,
      keyFactors,
      analysis
    };
  }

  private coerceNumber(value: unknown): number | null {
    if (value === undefined || value === null || value === "") {
      return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private roundPct(value: number) {
    return Math.round(value * 10) / 10;
  }

  private async buildTeamNameLookup(teamIds: string[]) {
    if (teamIds.length === 0) {
      return new Map<string, string>();
    }
    const teams = await this.teamRepo.find({
      where: { id: In(teamIds) }
    });
    const map = new Map<string, string>();
    for (const team of teams) {
      map.set(team.id, team.name || team.abbrev || team.id);
    }
    return map;
  }

  private async paginate<T extends ObjectLiteral>(
    qb: SelectQueryBuilder<T>,
    page: number,
    pageSize: number
  ): Promise<PaginationResult<T>> {
    const [data, total] = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    return {
      data,
      page,
      pageSize,
      total
    };
  }
}

type SeasonInfo = {
  seasonYear: number;
  seasonLabel: string;
};
