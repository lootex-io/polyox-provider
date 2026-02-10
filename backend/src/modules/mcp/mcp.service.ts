import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { NbaService } from "../nba/nba.service";
import { PolymarketService } from "../polymarket/polymarket.service";
import { ClobClient } from "../polymarket/clob.client";
import { Game } from "../nba/entities/game.entity";
import { IngestionState } from "../polymarket/entities/ingestion-state.entity";
import { Event } from "../polymarket/entities/event.entity";
import { Market } from "../polymarket/entities/market.entity";

@Injectable()
export class McpService {
  constructor(
    private readonly nbaService: NbaService,
    private readonly polymarketService: PolymarketService,
    private readonly clobClient: ClobClient,
    @InjectRepository(Game) private readonly gameRepo: Repository<Game>,
    @InjectRepository(IngestionState)
    private readonly ingestionStateRepo: Repository<IngestionState>,
    @InjectRepository(Event) private readonly eventRepo: Repository<Event>,
    @InjectRepository(Market) private readonly marketRepo: Repository<Market>
  ) {}

  toolsList() {
    return [
      {
        name: "nba.getGameContext",
        description: "Get aggregated NBA matchup context by date + teams.",
        inputSchema: {
          type: "object",
          required: ["date", "home", "away"],
          properties: {
            date: { type: "string", format: "date" },
            home: { type: "string" },
            away: { type: "string" },
            matchupLimit: { type: "number" },
            recentLimit: { type: "number" },
            marketPage: { type: "number" },
            marketPageSize: { type: "number" }
          }
        }
      },
      {
        name: "pm.getPrices",
        description: "Fetch live Polymarket CLOB prices by marketId(s) or tokenId.",
        inputSchema: {
          type: "object",
          properties: {
            tokenId: { type: "string" },
            marketId: { type: "number" },
            marketIds: { type: "array", items: { type: "number" } },
            side: { type: "string", enum: ["buy", "sell"] }
          }
        }
      },
      {
        name: "analysis.nbaMatchup",
        description: "Run NBA matchup analysis (uses configured OpenAI model).",
        inputSchema: {
          type: "object",
          required: ["date", "home", "away"],
          properties: {
            date: { type: "string", format: "date" },
            home: { type: "string" },
            away: { type: "string" },
            matchupLimit: { type: "number" },
            recentLimit: { type: "number" }
          }
        }
      },
      {
        name: "analysis.computeEdge",
        description:
          "Compute simple edge and Kelly fraction from model probability vs market price.",
        inputSchema: {
          type: "object",
          required: ["modelYesProb", "marketYesPrice"],
          properties: {
            modelYesProb: { type: "number", minimum: 0, maximum: 1 },
            marketYesPrice: { type: "number", minimum: 0, maximum: 1 },
            marketNoPrice: { type: "number", minimum: 0, maximum: 1 },
            kellyFractionCap: { type: "number", minimum: 0, maximum: 1 }
          }
        }
      },
      {
        name: "pm.getRecentTrades",
        description:
          "Fetch recent trades for a CLOB token (best-effort; endpoint availability may vary).",
        inputSchema: {
          type: "object",
          required: ["tokenId"],
          properties: {
            tokenId: { type: "string" },
            limit: { type: "number" }
          }
        }
      },
      {
        name: "alerts.detectLargeTrades",
        description:
          "Detect unusually large trades from recent CLOB trades for a tokenId (best-effort).",
        inputSchema: {
          type: "object",
          required: ["tokenId"],
          properties: {
            tokenId: { type: "string" },
            limit: { type: "number" },
            minNotionalUsd: { type: "number", minimum: 0 },
            minSize: { type: "number", minimum: 0 }
          }
        }
      },
      {
        name: "ops.getFreshness",
        description:
          "Check data freshness for NBA games + Polymarket sync state (DB-based).",
        inputSchema: { type: "object", properties: {} }
      }
    ];
  }

  async toolsCall(name: string, args: any) {
    switch (name) {
      case "nba.getGameContext": {
        const date = String(args?.date || "");
        const home = String(args?.home || "");
        const away = String(args?.away || "");
        if (!date || !home || !away) {
          throw new Error("date/home/away are required");
        }
        const context = await this.nbaService.getGameContextByMatchup({
          date,
          home,
          away,
          matchupLimit:
            args?.matchupLimit !== undefined ? Number(args.matchupLimit) : undefined,
          recentLimit:
            args?.recentLimit !== undefined ? Number(args.recentLimit) : undefined,
          marketPage:
            args?.marketPage !== undefined ? Number(args.marketPage) : undefined,
          marketPageSize:
            args?.marketPageSize !== undefined
              ? Number(args.marketPageSize)
              : undefined
        });
        if (!context) {
          return { ok: false, error: "game_not_found" };
        }
        return { ok: true, context };
      }
      case "pm.getPrices": {
        const tokenId = args?.tokenId ? String(args.tokenId) : undefined;
        const marketId =
          args?.marketId !== undefined ? Number(args.marketId) : undefined;
        const marketIds = Array.isArray(args?.marketIds)
          ? args.marketIds.map((v: any) => Number(v)).filter((v: any) => Number.isFinite(v))
          : undefined;
        const side = args?.side ? String(args.side) : undefined;
        const result = await this.polymarketService.getLivePrices({
          tokenId,
          marketId: marketId && Number.isFinite(marketId) ? marketId : undefined,
          marketIds,
          side
        });
        return { ok: true, ...result };
      }
      case "analysis.nbaMatchup": {
        const date = String(args?.date || "");
        const home = String(args?.home || "");
        const away = String(args?.away || "");
        if (!date || !home || !away) {
          throw new Error("date/home/away are required");
        }
        const result = await this.nbaService.analyzeGameByMatchup(
          { date, home, away },
          {
            matchupLimit:
              args?.matchupLimit !== undefined ? Number(args.matchupLimit) : undefined,
            recentLimit:
              args?.recentLimit !== undefined ? Number(args.recentLimit) : undefined
          }
        );
        if (!result) {
          return { ok: false, error: "game_not_found" };
        }
        return { ok: true, ...result };
      }
      case "analysis.computeEdge": {
        const modelYesProb = Number(args?.modelYesProb);
        const marketYesPrice = Number(args?.marketYesPrice);
        const marketNoPrice =
          args?.marketNoPrice !== undefined ? Number(args.marketNoPrice) : null;
        const cap =
          args?.kellyFractionCap !== undefined
            ? Number(args.kellyFractionCap)
            : 0.25;
        if (!Number.isFinite(modelYesProb) || !Number.isFinite(marketYesPrice)) {
          throw new Error("modelYesProb/marketYesPrice must be numbers");
        }
        const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
        const p = clamp01(modelYesProb);
        const m = clamp01(marketYesPrice);

        // EV per share (profit expectation): p - m
        const edgeYes = p - m;
        const impliedYes = m;
        const impliedNo = marketNoPrice !== null ? clamp01(marketNoPrice) : 1 - m;

        // Kelly fraction for buying YES at price m (binary contract, pays 1 if YES).
        // Odds b in standard Kelly form: profit per unit stake = (1 - m) / m.
        const b = m > 0 ? (1 - m) / m : Infinity;
        const q = 1 - p;
        let kelly = 0;
        if (Number.isFinite(b) && b > 0) {
          kelly = (b * p - q) / b;
        }
        kelly = clamp01(kelly);
        const kellyCap = clamp01(Number.isFinite(cap) ? cap : 0.25);

        // Symmetric edge for NO if caller wants it:
        const edgeNo = (1 - p) - impliedNo;

        return {
          ok: true,
          model: { yes: p, no: 1 - p },
          market: { yes: impliedYes, no: impliedNo },
          edge: { yes: edgeYes, no: edgeNo },
          kelly: { yes: Math.min(kelly, kellyCap), uncapped: kelly }
        };
      }
      case "pm.getRecentTrades": {
        const tokenId = String(args?.tokenId || "");
        const limit = args?.limit !== undefined ? Number(args.limit) : 50;
        if (!tokenId) {
          throw new Error("tokenId is required");
        }
        try {
          const trades = await this.clobClient.getRecentTrades(tokenId, limit);
          return { ok: true, tokenId, trades };
        } catch (err: any) {
          const msg = err instanceof Error ? err.message : String(err);
          // Friendly fallback when endpoint isn't available.
          if (msg.includes("404")) {
            return {
              ok: true,
              tokenId,
              trades: [],
              warning: "CLOB /trades endpoint unavailable; returned empty list"
            };
          }
          throw err;
        }
      }
      case "alerts.detectLargeTrades": {
        const tokenId = String(args?.tokenId || "");
        const limit = args?.limit !== undefined ? Number(args.limit) : 100;
        const minNotionalUsd =
          args?.minNotionalUsd !== undefined ? Number(args.minNotionalUsd) : 2500;
        const minSize = args?.minSize !== undefined ? Number(args.minSize) : 0;
        if (!tokenId) {
          throw new Error("tokenId is required");
        }

        const payload = await this.clobClient.getRecentTrades(tokenId, limit);
        const tradesRaw = Array.isArray(payload)
          ? payload
          : Array.isArray((payload as any)?.trades)
            ? (payload as any).trades
            : Array.isArray((payload as any)?.data)
              ? (payload as any).data
              : [];

        const trades = tradesRaw
          .map((t: any) => {
            const price = Number(t?.price ?? t?.p ?? t?.rate);
            const size = Number(t?.size ?? t?.qty ?? t?.amount ?? t?.shares);
            const ts = t?.timestamp ?? t?.ts ?? t?.createdAt ?? t?.created_at ?? null;
            const notional = Number.isFinite(price) && Number.isFinite(size) ? price * size : null;
            return {
              ...t,
              _computed: {
                price: Number.isFinite(price) ? price : null,
                size: Number.isFinite(size) ? size : null,
                notionalUsd: notional !== null && Number.isFinite(notional) ? notional : null,
                timestamp: ts
              }
            };
          })
          .filter((t: any) => {
            const n = t?._computed?.notionalUsd;
            const s = t?._computed?.size;
            const passNotional = minNotionalUsd > 0 ? (n !== null && n >= minNotionalUsd) : true;
            const passSize = minSize > 0 ? (s !== null && s >= minSize) : true;
            return passNotional && passSize;
          });

        return {
          ok: true,
          tokenId,
          scanned: tradesRaw.length,
          matches: trades.length,
          thresholds: { minNotionalUsd, minSize },
          trades
        };
      }
      case "ops.getFreshness": {
        const now = Date.now();
        const polyState = await this.ingestionStateRepo.findOne({
          where: { key: "polymarket_nba_last_sync" }
        });

        const nbaLatest = await this.gameRepo
          .createQueryBuilder("g")
          .select("MAX(g.updatedAt)", "max")
          .getRawOne<{ max: string | null }>();

        const polyEventLatest = await this.eventRepo
          .createQueryBuilder("e")
          .select("MAX(e.updatedAt)", "max")
          .getRawOne<{ max: string | null }>();

        const polyMarketLatest = await this.marketRepo
          .createQueryBuilder("m")
          .select("MAX(m.updatedAt)", "max")
          .getRawOne<{ max: string | null }>();

        const minutesAgo = (iso: string | null) => {
          if (!iso) return null;
          const t = new Date(iso).getTime();
          if (Number.isNaN(t)) return null;
          return Math.round((now - t) / 60000);
        };

        const polySyncedAt =
          (polyState?.value as any)?.syncedAt && typeof (polyState?.value as any)?.syncedAt === "string"
            ? (polyState?.value as any).syncedAt
            : null;

        return {
          ok: true,
          polymarket: {
            lastSync: polySyncedAt,
            minutesAgo: minutesAgo(polySyncedAt),
            lastDbEventUpdate: polyEventLatest?.max ?? null,
            lastDbMarketUpdate: polyMarketLatest?.max ?? null
          },
          nba: {
            lastDbGameUpdate: nbaLatest?.max ?? null,
            minutesAgo: minutesAgo(nbaLatest?.max ?? null)
          }
        };
      }
      default:
        throw new Error(`unknown tool: ${name}`);
    }
  }
}
