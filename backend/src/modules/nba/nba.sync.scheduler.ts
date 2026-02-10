import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron } from "@nestjs/schedule";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Game } from "./entities/game.entity";

@Injectable()
export class NbaSyncScheduler {
  private readonly logger = new Logger(NbaSyncScheduler.name);
  constructor(
    private readonly configService: ConfigService,
    @InjectQueue("nba-sync") private readonly queue: Queue,
    @InjectRepository(Game) private readonly gameRepo: Repository<Game>,
  ) {}

  private resolveDateInputTimeZone(): string {
    // Date inputs (YYYY-MM-DD) are treated as "game dates" in this time zone.
    // Default to ET to match NBA schedule semantics.
    const raw =
      this.configService.get<string>("NBA_SYNC_DATE_TZ") ||
      this.configService.get<string>("NBA_DATE_INPUT_TZ") ||
      "America/New_York";

    const upper = raw.toUpperCase();
    if (upper === "ET" || upper === "EST" || upper === "EDT") {
      return "America/New_York";
    }
    if (upper === "AMERICA/NEW_YORK") {
      return "America/New_York";
    }
    if (upper === "UTC") {
      return "UTC";
    }
    return raw;
  }

  private formatDateInTimeZone(date: Date, timeZone: string): string {
    if (timeZone.toUpperCase() === "UTC") {
      return date.toISOString().slice(0, 10);
    }

    try {
      // en-CA yields YYYY-MM-DD with numeric year/month/day.
      return new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(date);
    } catch {
      // If the runtime lacks tzdata/ICU support for the configured time zone,
      // fall back to UTC rather than crashing the scheduler.
      return date.toISOString().slice(0, 10);
    }
  }

  private resolveDate(explicit?: string) {
    return explicit || this.formatToday();
  }

  private resolveDays(value?: string, fallback = 7) {
    if (!value) {
      return fallback;
    }
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed < 0) {
      return fallback;
    }
    return parsed;
  }

  private buildDateRange(startDate: string, daysAhead: number) {
    const start = new Date(`${startDate}T00:00:00Z`);
    if (Number.isNaN(start.getTime())) {
      return [startDate];
    }
    const dates: string[] = [];
    for (let offset = 0; offset <= daysAhead; offset += 1) {
      const current = new Date(start);
      current.setUTCDate(start.getUTCDate() + offset);
      dates.push(current.toISOString().slice(0, 10));
    }
    return dates;
  }

  private addDays(date: string, offset: number) {
    const parsed = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) {
      return date;
    }
    parsed.setUTCDate(parsed.getUTCDate() + offset);
    return parsed.toISOString().slice(0, 10);
  }

  private formatToday() {
    const tz = this.resolveDateInputTimeZone();
    return this.formatDateInTimeZone(new Date(), tz);
  }

  @Cron(process.env.NBA_SCOREBOARD_CRON || "10 * * * *")
  async enqueueScoreboard() {
    const date = this.resolveDate(
      this.configService.get<string>("NBA_SCOREBOARD_DATE"),
    );
    await this.queue.add("sync-scoreboard", { date }, {});
    this.logger.log(
      `[cron] enqueue sync-scoreboard date=${date} at ${new Date().toISOString()}`,
    );
  }

  @Cron(process.env.NBA_FINAL_RESULTS_CRON || "20 * * * *")
  async enqueueFinalResults() {
    const date = this.resolveDate(
      this.configService.get<string>("NBA_FINAL_RESULTS_DATE"),
    );
    await this.queue.add("sync-final-results", { date }, {});
    this.logger.log(
      `[cron] enqueue sync-final-results date=${date} at ${new Date().toISOString()}`,
    );
  }

  @Cron(process.env.NBA_HOURLY_CRON || "0 * * * *")
  async enqueueHourly() {
    const enabled = this.configService.get<string>("NBA_HOURLY_ENABLED");
    if (enabled !== "true") {
      return;
    }

    const date = this.resolveDate(
      this.configService.get<string>("NBA_HOURLY_DATE"),
    );
    await this.queue.add("sync-scoreboard", { date }, {});
    await this.queue.add("sync-final-results", { date }, {});
    this.logger.log(
      `[cron] enqueue hourly sync-scoreboard+sync-final-results date=${date} at ${new Date().toISOString()}`,
    );
  }

  @Cron(process.env.NBA_INJURY_REPORT_CRON || "30 * * * *")
  async enqueueInjuryReport() {
    await this.queue.add("sync-injury-report", {}, {});
    this.logger.log(
      `[cron] enqueue sync-injury-report at ${new Date().toISOString()}`,
    );
  }

  @Cron(process.env.NBA_UPCOMING_SCHEDULE_CRON || "0 * * * *")
  async enqueueUpcomingSchedule() {
    const enabled = this.configService.get<string>(
      "NBA_UPCOMING_SCHEDULE_ENABLED",
    );
    if (enabled === "false") {
      return;
    }

    const explicitStartDate = this.configService.get<string>(
      "NBA_UPCOMING_SCHEDULE_DATE",
    );
    // Default to "tomorrow" so this job covers future 7 days (not including today).
    const startDate = explicitStartDate
      ? explicitStartDate
      : this.addDays(this.formatToday(), 1);
    const daysAhead = this.resolveDays(
      this.configService.get<string>("NBA_UPCOMING_SCHEDULE_DAYS"),
      6,
    );
    const dates = this.buildDateRange(startDate, daysAhead);

    const jobs = dates.map((date) => ({
      name: "sync-scoreboard",
      data: { date },
    }));
    if (jobs.length) {
      await this.queue.addBulk(jobs as any);
    }

    this.logger.log(
      `[cron] enqueue upcoming schedule range ${dates[0]}..${dates[dates.length - 1]} count=${dates.length} at ${new Date().toISOString()}`,
    );
  }

  @Cron(process.env.NBA_STALE_SCHEDULED_CRON || "0 */6 * * *")
  async enqueueStaleScheduledGames() {
    const enabled = this.configService.get<string>(
      "NBA_STALE_SCHEDULED_ENABLED",
    );
    if (enabled === "false") {
      return;
    }

    const lookbackHoursRaw =
      this.configService.get<string>("NBA_STALE_SCHEDULED_LOOKBACK_HOURS") ||
      "24";
    const lookbackHours = Math.max(
      1,
      Number.parseInt(lookbackHoursRaw, 10) || 24,
    );
    const maxGamesRaw =
      this.configService.get<string>("NBA_STALE_SCHEDULED_MAX_GAMES") || "200";
    const maxGames = Math.max(1, Number.parseInt(maxGamesRaw, 10) || 200);
    const maxDatesRaw =
      this.configService.get<string>("NBA_STALE_SCHEDULED_MAX_DATES") || "14";
    const maxDates = Math.max(1, Number.parseInt(maxDatesRaw, 10) || 14);

    const cutoff = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);
    const staleGames = await this.gameRepo
      .createQueryBuilder("game")
      .select(["game.id", "game.status", "game.dateTimeUtc"])
      .where("LOWER(game.status) = :status", { status: "scheduled" })
      .andWhere("game.dateTimeUtc < :cutoff", { cutoff: cutoff.toISOString() })
      .orderBy("game.dateTimeUtc", "DESC")
      .limit(maxGames)
      .getMany();

    if (staleGames.length === 0) {
      this.logger.log(
        `[cron] stale scheduled games: none (cutoff=${cutoff.toISOString()})`,
      );
      return;
    }

    const tz = this.resolveDateInputTimeZone();
    const datesInTz = Array.from(
      new Set(
        staleGames.map((game) =>
          this.formatDateInTimeZone(game.dateTimeUtc, tz),
        ),
      ),
    ).slice(0, maxDates);

    // Enqueue scoreboard first, then final results for each date so that status updates land first.
    const jobs = datesInTz.flatMap((date) => [
      { name: "sync-scoreboard", data: { date } },
      { name: "sync-final-results", data: { date } },
    ]);
    await this.queue.addBulk(jobs as any);

    this.logger.warn(
      `[cron] stale scheduled games: games=${staleGames.length} dates=${datesInTz.length} cutoff=${cutoff.toISOString()}`,
    );
  }
}
