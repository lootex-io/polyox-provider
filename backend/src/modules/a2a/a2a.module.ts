import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { A2AController } from "./a2a.controller";
import { WellKnownController } from "./well-known.controller";
import { A2AService } from "./a2a.service";
import { A2AProcessor } from "./a2a.processor";
import { NbaModule } from "../nba/nba.module";
import { PolymarketModule } from "../polymarket/polymarket.module";
import { A2AEventsService } from "./a2a.events";

@Module({
  imports: [
    BullModule.registerQueue({
      name: "a2a",
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 5000
        },
        removeOnComplete: 100,
        removeOnFail: 100
      }
    }),
    NbaModule,
    PolymarketModule
  ],
  controllers: [A2AController, WellKnownController],
  providers: [A2AService, A2AProcessor, A2AEventsService]
})
export class A2AModule {}
