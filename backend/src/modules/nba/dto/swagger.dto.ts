import { ApiProperty } from "@nestjs/swagger";
import { EventDto, PaginatedMarketDto } from "../../polymarket/dto/swagger.dto";

export class SyncJobResponseDto {
  @ApiProperty({ example: 12345 })
  id!: number | string;

  @ApiProperty({ example: "sync-scoreboard" })
  name!: string;

  @ApiProperty({ example: { date: "2026-02-06" } })
  data!: Record<string, any>;

  @ApiProperty({ example: 1707200000000 })
  timestamp!: number;
}

export class SyncRangeResponseDto {
  @ApiProperty({ example: ["2026-02-01", "2026-02-07"] })
  dates!: string[];

  @ApiProperty({ example: 14 })
  jobs!: number;
}

export class TeamDto {
  @ApiProperty({ example: "e1e2c5f3-3d6f-4d3a-9d6d-03b8f1a44e1d" })
  id!: string;

  @ApiProperty({ example: "nba_stats" })
  provider!: string;

  @ApiProperty({ example: "1610612747" })
  providerTeamId!: string;

  @ApiProperty({ example: "LAL" })
  abbrev!: string;

  @ApiProperty({ example: "Los Angeles Lakers" })
  name!: string;

  @ApiProperty({ example: "2026-02-06T00:01:00.000Z" })
  createdAt!: Date;

  @ApiProperty({ example: "2026-02-06T00:05:00.000Z" })
  updatedAt!: Date;
}

export class GameDto {
  @ApiProperty({ example: "9d6d84d0-9ac7-4a21-9b6a-1c2f4b9b3f6e" })
  id!: string;

  @ApiProperty({ example: "nba_stats" })
  provider!: string;

  @ApiProperty({ example: "0022500999" })
  providerGameId!: string;

  @ApiProperty({ example: 2025 })
  season!: number;

  @ApiProperty({ example: "2026-02-06T00:00:00.000Z" })
  dateTimeUtc!: Date;

  @ApiProperty({ example: "scheduled" })
  status!: string;

  @ApiProperty({ example: 110, nullable: true })
  homeScore!: number | null;

  @ApiProperty({ example: 104, nullable: true })
  awayScore!: number | null;

  @ApiProperty({ example: "e1e2c5f3-3d6f-4d3a-9d6d-03b8f1a44e1d" })
  homeTeamId!: string;

  @ApiProperty({ example: "2d4d7a1b-2f53-4b6d-9a05-4c3d6fba8a1b" })
  awayTeamId!: string;

  @ApiProperty({
    example: "2f5b3f44-2d2f-4b5f-9d2f-1e8c0b7f3e2a",
    nullable: true
  })
  polymarketEventId!: string | null;

  @ApiProperty({ example: "2026-02-06T00:01:00.000Z" })
  createdAt!: Date;

  @ApiProperty({ example: "2026-02-06T00:05:00.000Z" })
  updatedAt!: Date;
}

export class PlayerDto {
  @ApiProperty({ example: "b2e7c2f2-1d2a-4bcb-9a2a-8f6b9b1c4d8c" })
  id!: string;

  @ApiProperty({ example: "nba_stats" })
  provider!: string;

  @ApiProperty({ example: "201939" })
  providerPlayerId!: string;

  @ApiProperty({ example: "Stephen" })
  firstName!: string;

  @ApiProperty({ example: "Curry" })
  lastName!: string;

  @ApiProperty({ example: "Stephen Curry" })
  displayName!: string;

  @ApiProperty({ example: "G", nullable: true })
  position!: string | null;

  @ApiProperty({ example: 188, nullable: true })
  heightCm!: number | null;

  @ApiProperty({ example: 86, nullable: true })
  weightKg!: number | null;

  @ApiProperty({ example: "1988-03-14", nullable: true })
  birthdate!: Date | null;

  @ApiProperty({ example: "USA", nullable: true })
  country!: string | null;

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiProperty({ example: "R", nullable: true })
  shoots!: string | null;

  @ApiProperty({ example: "2026-02-06T00:01:00.000Z" })
  createdAt!: Date;

  @ApiProperty({ example: "2026-02-06T00:05:00.000Z" })
  updatedAt!: Date;
}

export class TeamGameStatDto {
  @ApiProperty({ example: "5d0cbb3a-8d2f-4dd5-9b2f-7e5c3b1a2b1c" })
  id!: string;

  @ApiProperty({ example: "9d6d84d0-9ac7-4a21-9b6a-1c2f4b9b3f6e" })
  gameId!: string;

  @ApiProperty({ example: "e1e2c5f3-3d6f-4d3a-9d6d-03b8f1a44e1d" })
  teamId!: string;

  @ApiProperty({ example: true })
  isHome!: boolean;

  @ApiProperty({ example: 110 })
  pts!: number;

  @ApiProperty({ example: 45, nullable: true })
  reb!: number | null;

  @ApiProperty({ example: 27, nullable: true })
  ast!: number | null;

  @ApiProperty({ example: 12, nullable: true })
  tov!: number | null;

  @ApiProperty({ example: 40, nullable: true })
  fgm!: number | null;

  @ApiProperty({ example: 85, nullable: true })
  fga!: number | null;

  @ApiProperty({ example: 12, nullable: true })
  fg3m!: number | null;

  @ApiProperty({ example: 33, nullable: true })
  fg3a!: number | null;

  @ApiProperty({ example: 18, nullable: true })
  ftm!: number | null;

  @ApiProperty({ example: 22, nullable: true })
  fta!: number | null;

  @ApiProperty({ example: 114.2, nullable: true })
  offRtg!: number | null;

  @ApiProperty({ example: 107.8, nullable: true })
  defRtg!: number | null;

  @ApiProperty({ example: 97.4, nullable: true })
  pace!: number | null;

  @ApiProperty({ example: 0.61, nullable: true })
  tsPct!: number | null;

  @ApiProperty({ example: "2026-02-06T00:01:00.000Z" })
  createdAt!: Date;

  @ApiProperty({ example: "2026-02-06T00:05:00.000Z" })
  updatedAt!: Date;
}

export class PlayerGameStatDto {
  @ApiProperty({ example: "a44f5f2b-5d2f-4a8c-9c6d-1d2f6b1a7c3d" })
  id!: string;

  @ApiProperty({ example: "nba_stats" })
  provider!: string;

  @ApiProperty({ example: "9d6d84d0-9ac7-4a21-9b6a-1c2f4b9b3f6e" })
  gameId!: string;

  @ApiProperty({ example: "b2e7c2f2-1d2a-4bcb-9a2a-8f6b9b1c4d8c" })
  playerId!: string;

  @ApiProperty({ example: "e1e2c5f3-3d6f-4d3a-9d6d-03b8f1a44e1d" })
  teamId!: string;

  @ApiProperty({ example: true, nullable: true })
  isStarter!: boolean | null;

  @ApiProperty({ example: 34.5, nullable: true })
  minutes!: number | null;

  @ApiProperty({ example: 32 })
  pts!: number;

  @ApiProperty({ example: 5 })
  reb!: number;

  @ApiProperty({ example: 7 })
  ast!: number;

  @ApiProperty({ example: 3 })
  tov!: number;

  @ApiProperty({ example: 2, nullable: true })
  stl!: number | null;

  @ApiProperty({ example: 0, nullable: true })
  blk!: number | null;

  @ApiProperty({ example: 11, nullable: true })
  fgm!: number | null;

  @ApiProperty({ example: 20, nullable: true })
  fga!: number | null;

  @ApiProperty({ example: 5, nullable: true })
  fg3m!: number | null;

  @ApiProperty({ example: 11, nullable: true })
  fg3a!: number | null;

  @ApiProperty({ example: 5, nullable: true })
  ftm!: number | null;

  @ApiProperty({ example: 6, nullable: true })
  fta!: number | null;

  @ApiProperty({ example: 12, nullable: true })
  plusMinus!: number | null;

  @ApiProperty({ example: null, nullable: true })
  didNotPlayReason!: string | null;

  @ApiProperty({ type: PlayerDto, required: false })
  player?: PlayerDto;

  @ApiProperty({ example: "2026-02-06T00:01:00.000Z" })
  createdAt!: Date;

  @ApiProperty({ example: "2026-02-06T00:05:00.000Z" })
  updatedAt!: Date;
}

export class DataConflictDto {
  @ApiProperty({ example: "c5b7a1d2-6d2f-4b3a-9d2f-1e6c2a9b7d1a" })
  id!: string;

  @ApiProperty({ example: "missing_player_stats" })
  conflictType!: string;

  @ApiProperty({ example: "b2e7c2f2-1d2a-4bcb-9a2a-8f6b9b1c4d8c", nullable: true })
  playerId!: string | null;

  @ApiProperty({ example: 2025, nullable: true })
  season!: number | null;

  @ApiProperty({ example: "job-12345", nullable: true })
  jobId!: string | null;

  @ApiProperty({ example: { providerGameId: "0022500999" }, nullable: true })
  detailsJson!: Record<string, any> | null;

  @ApiProperty({ example: "2026-02-06T00:01:00.000Z" })
  createdAt!: Date;
}

export class InjuryReportDto {
  @ApiProperty({ example: "8a2c5f1b-9d2f-4d2f-9b2f-1d2f7b1a3c4d" })
  id!: string;

  @ApiProperty({ example: "2026-02-06", nullable: true })
  reportDate!: string | null;

  @ApiProperty({ example: "1:30 PM ET", nullable: true })
  reportTime!: string | null;

  @ApiProperty({ example: "https://official.nba.com/injury-report.pdf" })
  sourceUrl!: string;

  @ApiProperty({ example: "2026-02-06T00:01:00.000Z" })
  createdAt!: Date;

  @ApiProperty({ example: "2026-02-06T00:05:00.000Z" })
  updatedAt!: Date;
}

export class InjuryReportEntryDto {
  @ApiProperty({ example: "3d4b6f1a-2d2f-4b9a-9d2f-7b2c1a5d3f4a" })
  id!: string;

  @ApiProperty({ example: "8a2c5f1b-9d2f-4d2f-9b2f-1d2f7b1a3c4d" })
  reportId!: string;

  @ApiProperty({ example: "e1e2c5f3-3d6f-4d3a-9d6d-03b8f1a44e1d", nullable: true })
  teamId!: string | null;

  @ApiProperty({ example: "b2e7c2f2-1d2a-4bcb-9a2a-8f6b9b1c4d8c", nullable: true })
  playerId!: string | null;

  @ApiProperty({ example: "2026-02-06", nullable: true })
  gameDate!: string | null;

  @ApiProperty({ example: "7:30 PM ET", nullable: true })
  gameTime!: string | null;

  @ApiProperty({ example: "LAL@BOS", nullable: true })
  matchup!: string | null;

  @ApiProperty({ example: "LAL", nullable: true })
  teamAbbrev!: string | null;

  @ApiProperty({ example: "Stephen Curry", nullable: true })
  playerName!: string | null;

  @ApiProperty({ example: "Questionable", nullable: true })
  status!: string | null;

  @ApiProperty({ example: "Ankle", nullable: true })
  injury!: string | null;

  @ApiProperty({ example: "Sprain", nullable: true })
  reason!: string | null;

  @ApiProperty({ example: "Expected to play", nullable: true })
  notes!: string | null;

  @ApiProperty({ example: { status: "Questionable" }, nullable: true })
  rawJson!: Record<string, any> | null;

  @ApiProperty({ example: "2026-02-06T00:01:00.000Z" })
  createdAt!: Date;

  @ApiProperty({ example: "2026-02-06T00:05:00.000Z" })
  updatedAt!: Date;
}

export class PaginatedGameDto {
  @ApiProperty({ type: [GameDto] })
  data!: GameDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 50 })
  pageSize!: number;

  @ApiProperty({ example: 82 })
  total!: number;
}

export class PaginatedPlayerDto {
  @ApiProperty({ type: [PlayerDto] })
  data!: PlayerDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 50 })
  pageSize!: number;

  @ApiProperty({ example: 500 })
  total!: number;
}

export class PaginatedTeamGameStatDto {
  @ApiProperty({ type: [TeamGameStatDto] })
  data!: TeamGameStatDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 50 })
  pageSize!: number;

  @ApiProperty({ example: 2 })
  total!: number;
}

export class PaginatedPlayerGameStatDto {
  @ApiProperty({ type: [PlayerGameStatDto] })
  data!: PlayerGameStatDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 50 })
  pageSize!: number;

  @ApiProperty({ example: 20 })
  total!: number;
}

export class PaginatedDataConflictDto {
  @ApiProperty({ type: [DataConflictDto] })
  data!: DataConflictDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 50 })
  pageSize!: number;

  @ApiProperty({ example: 4 })
  total!: number;
}

export class PaginatedInjuryReportDto {
  @ApiProperty({ type: [InjuryReportDto] })
  data!: InjuryReportDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 50 })
  pageSize!: number;

  @ApiProperty({ example: 7 })
  total!: number;
}

export class PaginatedInjuryReportEntryDto {
  @ApiProperty({ type: [InjuryReportEntryDto] })
  data!: InjuryReportEntryDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 50 })
  pageSize!: number;

  @ApiProperty({ example: 24 })
  total!: number;
}

export class InjuryReportEntriesResponseDto {
  @ApiProperty({ type: InjuryReportDto, nullable: true })
  report!: InjuryReportDto | null;

  @ApiProperty({ type: PaginatedInjuryReportEntryDto })
  entries!: PaginatedInjuryReportEntryDto;
}

export class GameMarketsResponseDto {
  @ApiProperty({ type: EventDto, nullable: true })
  event!: EventDto | null;

  @ApiProperty({ type: PaginatedMarketDto })
  markets!: PaginatedMarketDto;
}

export class GameContextRecentFormDto {
  @ApiProperty({ type: [GameDto] })
  home!: GameDto[];

  @ApiProperty({ type: [GameDto] })
  away!: GameDto[];
}

export class GameContextResponseDto {
  @ApiProperty({ type: GameDto })
  game!: GameDto;

  @ApiProperty({ type: TeamDto, nullable: true })
  homeTeam!: TeamDto | null;

  @ApiProperty({ type: TeamDto, nullable: true })
  awayTeam!: TeamDto | null;

  @ApiProperty({ type: [PlayerDto] })
  homePlayers!: PlayerDto[];

  @ApiProperty({ type: [PlayerDto] })
  awayPlayers!: PlayerDto[];

  @ApiProperty({ type: [GameDto] })
  recentMatchups!: GameDto[];

  @ApiProperty({ type: GameContextRecentFormDto })
  recentForm!: GameContextRecentFormDto;

  @ApiProperty({ type: InjuryReportEntriesResponseDto })
  injuries!: InjuryReportEntriesResponseDto;

  @ApiProperty({ type: GameMarketsResponseDto })
  polymarket!: GameMarketsResponseDto;

  @ApiProperty({ type: [TeamGameStatDto] })
  teamStats!: TeamGameStatDto[];
}

export class GameAnalysisRequestDto {
  @ApiProperty({ example: "2026-02-07" })
  date!: string;

  @ApiProperty({ example: "SAS" })
  home!: string;

  @ApiProperty({ example: "DAL" })
  away!: string;

  @ApiProperty({ example: 5, required: false })
  matchupLimit?: number;

  @ApiProperty({ example: 5, required: false })
  recentLimit?: number;
}

export class GameAnalysisResponseDto {
  @ApiProperty({ example: "9d6d84d0-9ac7-4a21-9b6a-1c2f4b9b3f6e" })
  gameId!: string;

  @ApiProperty({ example: "Los Angeles Lakers", nullable: true })
  homeTeam!: string | null;

  @ApiProperty({ example: "Boston Celtics", nullable: true })
  awayTeam!: string | null;

  @ApiProperty({ example: 54.3, nullable: true })
  homeWinPct!: number | null;

  @ApiProperty({ example: 45.7, nullable: true })
  awayWinPct!: number | null;

  @ApiProperty({ example: 62.5, nullable: true })
  confidence!: number | null;

  @ApiProperty({
    example: [
      "Home team recent offensive efficiency",
      "Key injury status impacts",
      "Head-to-head trend"
    ]
  })
  keyFactors!: string[];

  @ApiProperty({
    example: "Home team has a stronger recent form with fewer injuries."
  })
  analysis!: string;

  @ApiProperty({ example: "gpt-4o-mini" })
  model!: string;

  @ApiProperty({ example: "2026-02-06T12:34:56.000Z" })
  generatedAt!: string;

  @ApiProperty({
    example: "AI-generated analysis. For informational use only; not financial advice."
  })
  disclaimer!: string;

  @ApiProperty({ required: false, example: { total_tokens: 1234 } })
  usage?: Record<string, any> | null;

  @ApiProperty({ required: false, example: "raw model output" })
  raw?: string;
}

export class TeamListResponseDto {
  @ApiProperty({ type: [TeamDto] })
  data!: TeamDto[];
}

export class PlayerSeasonTeamDto {
  @ApiProperty({ example: "4f6b9b1c-1d2a-4bcb-9a2a-8f6b9b1c4d8c" })
  id!: string;

  @ApiProperty({ example: "nba_stats" })
  provider!: string;

  @ApiProperty({ example: "b2e7c2f2-1d2a-4bcb-9a2a-8f6b9b1c4d8c" })
  playerId!: string;

  @ApiProperty({ example: 2025 })
  season!: number;

  @ApiProperty({ example: "e1e2c5f3-3d6f-4d3a-9d6d-03b8f1a44e1d" })
  teamId!: string;

  @ApiProperty({ example: "2025-10-01T00:00:00.000Z" })
  fromUtc!: Date;

  @ApiProperty({ example: null, nullable: true })
  toUtc!: Date | null;

  @ApiProperty({ example: "Starter", nullable: true })
  role!: string | null;

  @ApiProperty({ example: "Standard", nullable: true })
  contractType!: string | null;

  @ApiProperty({ example: "2026-02-06T00:01:00.000Z" })
  createdAt!: Date;

  @ApiProperty({ example: "2026-02-06T00:05:00.000Z" })
  updatedAt!: Date;
}
