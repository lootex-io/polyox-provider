import type { Request } from "express";

function buildPublicBase(req: Request): string {
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

export function buildAgentCard(req: Request) {
  const base = process.env.A2A_PUBLIC_BASE || buildPublicBase(req);
  return {
    id: process.env.A2A_AGENT_ID || "hoobs-sports-agent",
    name: process.env.A2A_AGENT_NAME || "Hoobs Sports Agent",
    version: process.env.A2A_AGENT_VERSION || "1.0.0",
    description:
      process.env.A2A_AGENT_DESCRIPTION ||
      "An agent that provides NBA matchup analysis, Polymarket market data, and simple edge computations.",
    endpoints: {
      rpc: `${base}/a2a/rpc`,
      tasks: `${base}/a2a/tasks`,
      task_events: `${base}/a2a/tasks/{taskId}/events`
    },
    auth: {
      type: "x402",
      description: "Some capabilities require an x402 micropayment."
    },
    task_model: {
      async: true,
      supports_streaming: true,
      supports_cancel: true,
      estimated_duration_sec: { min: 5, max: 30 }
    },
    capabilities: [
      {
        name: "nba.matchup_brief",
        description: "Quick NBA single-game matchup brief.",
        input_schema: {
          type: "object",
          required: ["date", "home", "away"],
          properties: {
            date: { type: "string", format: "date" },
            home: { type: "string" },
            away: { type: "string" },
            marketId: { type: "number" }
          }
        }
      },
      {
        name: "nba.matchup_full",
        description:
          "Full NBA single-game analysis with model outputs and risk notes.",
        input_schema: {
          type: "object",
          required: ["date", "home", "away"],
          properties: {
            date: { type: "string", format: "date" },
            home: { type: "string" },
            away: { type: "string" },
            marketId: { type: "number" },
            modelVersion: { type: "string", default: "latest" }
          }
        },
        pricing: {
          model: "x402",
          price_usd: Number(process.env.A2A_MATCHUP_FULL_PRICE_USD || 0.05)
        }
      }
    ],
    output: {
      formats: ["application/json"],
      contains_investment_advice: false,
      risk_notes: [
        "Results are not guaranteed and may be wrong.",
        "Model confidence depends on data freshness and injury information."
      ]
    }
  };
}

