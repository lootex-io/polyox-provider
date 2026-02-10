import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { QueueEvents } from "bullmq";

@Injectable()
export class A2AEventsService implements OnModuleInit, OnModuleDestroy {
  private queueEvents: QueueEvents | null = null;

  async onModuleInit() {
    const connection = {
      host: process.env.REDIS_HOST || "redis",
      port: Number(process.env.REDIS_PORT || 6379)
    };
    this.queueEvents = new QueueEvents("a2a", { connection });
    await this.queueEvents.waitUntilReady();
  }

  get events(): QueueEvents {
    if (!this.queueEvents) {
      throw new Error("A2A QueueEvents not initialized yet");
    }
    return this.queueEvents;
  }

  async onModuleDestroy() {
    try {
      await this.queueEvents?.close();
    } catch {
      // ignore
    }
    this.queueEvents = null;
  }
}

