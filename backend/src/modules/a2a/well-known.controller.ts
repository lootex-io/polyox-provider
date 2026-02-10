import { Controller, Get, Req } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { buildAgentCard } from "./agent-card";

@Controller(".well-known")
@ApiTags("A2A")
export class WellKnownController {
  @Get("agent-card.json")
  @ApiOperation({ summary: "A2A agent card" })
  async getAgentCard(@Req() req: Request) {
    return buildAgentCard(req);
  }
}
