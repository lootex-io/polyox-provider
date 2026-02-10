import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Body,
  Req,
  Res
} from "@nestjs/common";
import { ApiOperation, ApiParam, ApiQuery, ApiTags } from "@nestjs/swagger";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import type { Request, Response } from "express";
import type {
  A2ACapabilityName,
  A2AJsonRpcRequest,
  A2AJsonRpcResponse,
  A2ATask,
} from "./a2a.types";
import { A2AEventsService } from "./a2a.events";
import { buildAgentCard } from "./agent-card";

function nowIso() {
  return new Date().toISOString();
}

function buildPublicBase(req: Request): string {
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

function mapState(state: string | null): A2ATask["state"] {
  switch (state) {
    case "waiting":
    case "delayed":
    case "paused":
      return "queued";
    case "active":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    default:
      return "queued";
  }
}

function mapStateWithReason(state: string | null, failedReason?: string | null): A2ATask["state"] {
  const mapped = mapState(state);
  if (mapped === "failed" && failedReason && failedReason.toLowerCase().includes("cancelled")) {
    return "cancelled";
  }
  return mapped;
}

function rpcOk(id: any, result: any): A2AJsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function rpcErr(
  id: any,
  code: number,
  message: string,
  data?: any
): A2AJsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message, data } };
}

@Controller("a2a")
@ApiTags("A2A")
export class A2AController {
  constructor(
    @InjectQueue("a2a") private readonly queue: Queue,
    private readonly eventsService: A2AEventsService
  ) {}

  @Post("rpc")
  @ApiOperation({ summary: "JSON-RPC shim for A2A tasks (subset)" })
  async rpcShim(@Req() req: Request, @Body() body: A2AJsonRpcRequest, @Res() res: Response) {
    const id = body?.id ?? null;
    const method = String(body?.method || "");

    if (body?.jsonrpc !== "2.0") {
      res.status(200).json(rpcErr(id, -32600, "invalid jsonrpc; expected 2.0"));
      return;
    }
    if (!method) {
      res.status(200).json(rpcErr(id, -32600, "missing method"));
      return;
    }

    // Notifications (no id) are allowed.
    const isNotification = body.id === undefined;

    try {
      switch (method) {
        case "agent.getCard": {
          if (isNotification) {
            res.status(204).end();
            return;
          }
          res.status(200).json(rpcOk(id, buildAgentCard(req)));
          return;
        }
        case "tasks.create": {
          const cap = String(body?.params?.capability || "").trim() as A2ACapabilityName;
          if (cap !== "nba.matchup_brief" && cap !== "nba.matchup_full") {
            res.status(200).json(rpcErr(id, -32602, "invalid params.capability"));
            return;
          }

          // If x402 is enabled, the paid capability must go through the paywalled REST route
          // because JSON-RPC doesn't carry the capability in query params for middleware bypass.
          const x402Enabled = process.env.X402_ENABLED !== "false";
          if (x402Enabled && cap === "nba.matchup_full") {
            res.status(200).json(
              rpcErr(id, 402, "payment required", {
                hint: "Use POST /a2a/tasks?capability=nba.matchup_full (x402-protected).",
              })
            );
            return;
          }

          const input =
            body?.params?.input && typeof body.params.input === "object"
              ? body.params.input
              : body?.params?.arguments && typeof body.params.arguments === "object"
                ? body.params.arguments
                : {};

          const job = await this.queue.add(cap, {
            ...(input ?? {}),
            _meta: {
              capability: cap,
              payerAddress: null,
              createdAt: nowIso(),
            },
          });
          const base = buildPublicBase(req);
          const payload = {
            id: String(job.id),
            capability: cap,
            state: "queued",
            createdAt: nowIso(),
            endpoints: {
              task: `${base}/a2a/tasks/${job.id}`,
              events: `${base}/a2a/tasks/${job.id}/events`,
              cancel: `${base}/a2a/tasks/${job.id}/cancel`,
            },
          };
          if (isNotification) {
            res.status(204).end();
            return;
          }
          res.status(200).json(rpcOk(id, payload));
          return;
        }
        case "tasks.get": {
          const taskId = String(body?.params?.id || "");
          if (!taskId) {
            res.status(200).json(rpcErr(id, -32602, "params.id is required"));
            return;
          }
          const task = await this.getTask(taskId);
          if (isNotification) {
            res.status(204).end();
            return;
          }
          res.status(200).json(rpcOk(id, task));
          return;
        }
        case "tasks.events": {
          const taskId = String(body?.params?.id || "");
          if (!taskId) {
            res.status(200).json(rpcErr(id, -32602, "params.id is required"));
            return;
          }
          const base = buildPublicBase(req);
          const payload = { events: `${base}/a2a/tasks/${taskId}/events` };
          if (isNotification) {
            res.status(204).end();
            return;
          }
          res.status(200).json(rpcOk(id, payload));
          return;
        }
        case "tasks.cancel": {
          const taskId = String(body?.params?.id || "");
          if (!taskId) {
            res.status(200).json(rpcErr(id, -32602, "params.id is required"));
            return;
          }
          const result = await this.cancelTask(taskId);
          if (isNotification) {
            res.status(204).end();
            return;
          }
          res.status(200).json(rpcOk(id, result));
          return;
        }
        default: {
          if (isNotification) {
            res.status(204).end();
            return;
          }
          res.status(200).json(rpcErr(id, -32601, `method not found: ${method}`));
          return;
        }
      }
    } catch (e: any) {
      const message = e instanceof Error ? e.message : String(e);
      if (isNotification) {
        res.status(204).end();
        return;
      }
      res.status(200).json(rpcErr(id, -32000, message));
    }
  }

  @Post("tasks")
  @ApiOperation({ summary: "Create an A2A task" })
  @ApiQuery({
    name: "capability",
    required: true,
    description: "e.g. nba.matchup_brief | nba.matchup_full"
  })
  async createTask(
    @Req() req: Request,
    @Query("capability") capability?: string,
    @Body() body?: any
  ) {
    const cap = String(capability || "").trim() as A2ACapabilityName;
    if (cap !== "nba.matchup_brief" && cap !== "nba.matchup_full") {
      throw new BadRequestException("invalid capability");
    }

    // x402 middleware only attaches req.x402 when route is protected.
    const x402 = (req as any).x402 as
      | { payerAddress?: string | null; sessionId?: string | null }
      | undefined;

    const input = body?.input && typeof body.input === "object" ? body.input : body;
    const job = await this.queue.add(cap, {
      ...(input ?? {}),
      _meta: {
        capability: cap,
        payerAddress: x402?.payerAddress ?? null,
        createdAt: nowIso()
      }
    });

    const base = buildPublicBase(req);
    return {
      id: String(job.id),
      capability: cap,
      state: "queued",
      createdAt: nowIso(),
      endpoints: {
        task: `${base}/a2a/tasks/${job.id}`,
        events: `${base}/a2a/tasks/${job.id}/events`,
        cancel: `${base}/a2a/tasks/${job.id}/cancel`
      }
    };
  }

  @Get("tasks/:id")
  @ApiOperation({ summary: "Get task status/result" })
  @ApiParam({ name: "id", required: true })
  async getTask(@Param("id") id: string): Promise<A2ATask> {
    const job = await this.queue.getJob(id);
    if (!job) {
      throw new NotFoundException("task not found");
    }
    const state = (await job.getState()) as string;
    const updatedAt = job.finishedOn
      ? new Date(job.finishedOn).toISOString()
      : job.processedOn
        ? new Date(job.processedOn).toISOString()
        : nowIso();
    const createdAt = job.timestamp
      ? new Date(job.timestamp).toISOString()
      : nowIso();

    const meta = job.data?._meta ?? {};
    const payerAddress =
      typeof meta?.payerAddress === "string" || meta?.payerAddress === null
        ? meta.payerAddress
        : null;

    const taskState = mapStateWithReason(state, job.failedReason);
    return {
      id: String(job.id),
      capability: job.name as any,
      state: taskState,
      createdAt,
      updatedAt,
      result: taskState === "completed" ? job.returnvalue ?? null : undefined,
      error:
        taskState === "failed" || taskState === "cancelled"
          ? { message: job.failedReason || "failed" }
          : undefined,
      payerAddress
    };
  }

  @Get("tasks/:id/events")
  @ApiOperation({ summary: "Stream task events (SSE)" })
  @ApiParam({ name: "id", required: true })
  async streamEvents(@Param("id") id: string, @Req() req: Request, @Res() res: Response) {
    const job = await this.queue.getJob(id);
    if (!job) {
      throw new NotFoundException("task not found");
    }

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    // Let nginx know not to buffer (also configured on edge).
    res.setHeader("X-Accel-Buffering", "no");

    const send = (event: string, data: any) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const initialState = await job.getState();
    const initialMapped = mapStateWithReason(initialState as any, job.failedReason);
    send("state", { id: String(job.id), state: initialMapped, at: nowIso() });

    if (initialState === "completed") {
      send("completed", { id: String(job.id), returnvalue: job.returnvalue ?? null, at: nowIso() });
      res.end();
      return;
    }
    if (initialState === "failed") {
      const reason = job.failedReason || "failed";
      const evt = reason.toLowerCase().includes("cancelled") ? "cancelled" : "failed";
      send(evt, { id: String(job.id), failedReason: reason, at: nowIso() });
      res.end();
      return;
    }

    const queueEvents = this.eventsService.events;

    const handler = (evtName: string) => (payload: any) => {
      if (!payload || String(payload.jobId) !== String(job.id)) {
        return;
      }
      send(evtName, { ...payload, at: nowIso() });
      if (evtName === "completed" || evtName === "failed") {
        // Allow a brief flush window then close.
        setTimeout(() => res.end(), 50);
      }
    };

    const onProgress = handler("progress");
    const onCompleted = handler("completed");
    const onFailed = handler("failed");
    const onActive = handler("active");
    const onWaiting = handler("waiting");

    queueEvents.on("progress", onProgress);
    queueEvents.on("completed", onCompleted);
    queueEvents.on("failed", onFailed);
    queueEvents.on("active", onActive);
    queueEvents.on("waiting", onWaiting);

    const heartbeat = setInterval(() => {
      if (res.writableEnded) return;
      send("ping", { at: nowIso() });
    }, 15000);

    const cleanup = async () => {
      clearInterval(heartbeat);
      queueEvents.removeListener("progress", onProgress);
      queueEvents.removeListener("completed", onCompleted);
      queueEvents.removeListener("failed", onFailed);
      queueEvents.removeListener("active", onActive);
      queueEvents.removeListener("waiting", onWaiting);
    };

    req.on("close", cleanup);
  }

  @Post("tasks/:id/cancel")
  @ApiOperation({ summary: "Cancel a task (best-effort)" })
  @ApiParam({ name: "id", required: true })
  async cancelTask(@Param("id") id: string) {
    const job = await this.queue.getJob(id);
    if (!job) {
      throw new NotFoundException("task not found");
    }

    const redis = await this.queue.client;
    // Keep the cancel flag long enough for delayed/backlogged jobs to observe it.
    await redis.set(`a2a:cancel:${job.id}`, "1", "PX", 24 * 60 * 60 * 1000);

    const state = (await job.getState()) as string;
    if (
      state === "waiting" ||
      state === "delayed" ||
      state === "prioritized" ||
      state === "waiting-children"
    ) {
      await job.remove();
      return { id: String(job.id), cancelled: true, removed: true };
    }

    return { id: String(job.id), cancelled: true, removed: false, state };
  }
}
