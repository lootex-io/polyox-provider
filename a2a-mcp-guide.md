# A2A + MCP Usage Guide

This repo exposes two agent-facing interfaces on the backend:

- A2A (task-based agent API with SSE streaming)
- MCP (HTTP JSON-RPC tools endpoint)

This document describes the current usage flow and request/response shapes.

## Base URLs

Local (Docker Compose):

- Backend: `http://localhost:3000`
- Frontend: `http://localhost:3001`

Production (example):

- App: `https://app-hoobs.polyox.io`
- API: `https://api-hoobs.polyox.io`
- MCP: `https://mcp-hoobs.polyox.io`

## Frontend Consoles (Visualization UI)

The frontend provides simple consoles (no homepage link required):

- A2A console: `/a2a`
- MCP console: `/mcp`

In production, these are served from the app host, for example:

- `https://app-hoobs.polyox.io/a2a`
- `https://app-hoobs.polyox.io/mcp`

## A2A

### Agent Card

Capability discovery endpoint:

- `GET /.well-known/agent-card.json`

The agent card includes:

- `capabilities[]`: supported capability names and input schemas
- `endpoints`: task endpoints and RPC entry
- `auth`: declared as `x402` (some capabilities are paywalled)

### Date Semantics

All `YYYY-MM-DD` inputs are treated as "game dates" in US Eastern time (ET, `America/New_York`) by default.

This applies to:

- `A2A` inputs: `date`
- NBA query/sync endpoints: `date`, `from`, `to`

You can override backend interpretation via `NBA_DATE_INPUT_TZ`.

### REST Task Flow

1. Create task

Endpoint:

- `POST /a2a/tasks?capability=nba.matchup_brief`
- `POST /a2a/tasks?capability=nba.matchup_full` (x402 paywalled when enabled)

Body:

- You can send either `{ "input": { ... } }` or put fields at the top level.

Example:

```bash
curl -sS -X POST 'http://localhost:3000/a2a/tasks?capability=nba.matchup_brief' \
  -H 'content-type: application/json' \
  -d '{
    "input": {
      "date": "2026-02-09",
      "home": "SAS",
      "away": "DAL",
      "matchupLimit": 5,
      "recentLimit": 5
    }
  }'
```

Response:

- `id`: BullMQ job id
- `state`: `queued`
- `endpoints`: task polling + SSE + cancel URLs

2. Poll task status/result

Endpoint:

- `GET /a2a/tasks/:id`

Example:

```bash
curl -sS 'http://localhost:3000/a2a/tasks/1'
```

States:

- `queued`
- `running`
- `completed`
- `failed`
- `cancelled` (best-effort cancellation; represented by failed job reason)

3. Stream task events (SSE)

Endpoint:

- `GET /a2a/tasks/:id/events`

Example:

```bash
curl -N 'http://localhost:3000/a2a/tasks/1/events'
```

Event types you may receive:

- `state` (initial)
- `waiting`
- `active`
- `progress` (stage updates from the processor)
- `completed`
- `failed`
- `cancelled`
- `ping` (heartbeat)

4. Cancel task (best-effort)

Endpoint:

- `POST /a2a/tasks/:id/cancel`

Example:

```bash
curl -sS -X POST 'http://localhost:3000/a2a/tasks/1/cancel'
```

Notes:

- If a job is still waiting/delayed, we remove it from the queue.
- If a job is already running, we set a cancel flag that the worker checks.

### JSON-RPC Shim (`/a2a/rpc`)

Endpoint:

- `POST /a2a/rpc`

Supported methods (subset):

- `agent.getCard`
- `tasks.create`
- `tasks.get`
- `tasks.events` (returns the REST SSE URL)
- `tasks.cancel`

Example (`agent.getCard`):

```bash
curl -sS -X POST 'http://localhost:3000/a2a/rpc' \
  -H 'content-type: application/json' \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "agent.getCard",
    "params": {}
  }'
```

Example (`tasks.create`):

```bash
curl -sS -X POST 'http://localhost:3000/a2a/rpc' \
  -H 'content-type: application/json' \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tasks.create",
    "params": {
      "capability": "nba.matchup_brief",
      "input": { "date": "2026-02-09", "home": "SAS", "away": "DAL" }
    }
  }'
```

Important limitation:

- When `X402_ENABLED` is enabled, `nba.matchup_full` over JSON-RPC is not supported yet.
- Use REST `POST /a2a/tasks?capability=nba.matchup_full` so the x402 middleware can enforce pricing.

## MCP

### Endpoint

MCP is served as HTTP JSON-RPC 2.0:

- `POST /mcp`

This endpoint supports:

- Single JSON-RPC request
- Batch JSON-RPC request (array)
- Notifications (missing `id`) returning HTTP 204

### Typical Handshake

1. `initialize`
2. `notifications/initialized` (optional, notification)
3. `tools/list`
4. `tools/call`

### Methods

#### `initialize`

```bash
curl -sS -X POST 'http://localhost:3000/mcp' \
  -H 'content-type: application/json' \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {}
  }'
```

#### `tools/list`

```bash
curl -sS -X POST 'http://localhost:3000/mcp' \
  -H 'content-type: application/json' \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list",
    "params": {}
  }'
```

#### `tools/call`

Tool call request shape:

- `params.name`: tool name
- `params.arguments`: tool arguments

Example (`nba.getGameContext`):

```bash
curl -sS -X POST 'http://localhost:3000/mcp' \
  -H 'content-type: application/json' \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "nba.getGameContext",
      "arguments": { "date": "2026-02-09", "home": "SAS", "away": "DAL" }
    }
  }'
```

Response shape:

- `result.content[]` is an array of content blocks
- For now we return a single `{ "type": "text", "text": "..." }` block
- The `text` field contains JSON (stringified), so clients should parse it if they want structured data

### Tools

Current tools (see `tools/list` for latest schemas):

- `nba.getGameContext`
- `pm.getPrices`
- `analysis.nbaMatchup`
- `analysis.computeEdge`
- `pm.getRecentTrades`
- `alerts.detectLargeTrades`
- `ops.getFreshness`

## Auth and x402 Notes

- The backend can enable x402 with `X402_ENABLED=true` plus required payment config.
- In this repo, `POST /a2a/tasks` is protected by x402 by default, with a free bypass for `capability=nba.matchup_brief`.
- If you need to make more capabilities free or add pricing tiers, update the x402 middleware routing rules.

