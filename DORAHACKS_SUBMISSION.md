# DoraHacks x402 Hackathon Submission

## SF Agentic Commerce x402 Hackathon

---

# Profile

## BUIDL (Project) Name
**PolyOx Hoops - NBA Sports Intelligence Agent**

## Vision
> Agent of Truth's Convergence, powered by prediction markets.

## Category
- AI Agent
- Prediction Markets
- Agentic Commerce

## Is this BUIDL an AI Agent?
**Yes**

---

# Links

| Field | URL |
|-------|-----|
| **GitHub** | https://github.com/lootex-io/polyox-provider |
| **Project Website** | http://polyox.io/ |
| **Demo Video** | http://polyox.io/ |
| **Social** | http://polyox.io/ |

---

# Details

## What We Built

**An autonomous AI agent enabling agent-to-agent commerce for real-time sports analytics with native x402 micropayments.**

NBA Sports Intelligence Agent aggregates real-time NBA data (schedules, scores, player stats, injury reports) and Polymarket betting markets, providing AI-powered matchup analysis that other agents can discover and pay for autonomously.

---

## Key Features

- **A2A Protocol**: Full agent-to-agent discovery and task execution via `/.well-known/agent-card.json`
- **x402 Payments**: Native micropayments on Base network — agents pay $0.05 USDC for premium AI analysis
- **MCP Tools**: 7 tools for LLM integration (game context, prices, edge computation, whale alerts)
- **ERC-8004 Identity**: [Registered on Base Mainnet](https://www.8004scan.io/agents/base/14352)

---

## How It Works

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Your Agent │ ──► │   x402 Pay  │ ──► │  NBA Agent  │
└─────────────┘     └─────────────┘     └─────────────┘
```

1. **Discover**: Agents find us via A2A protocol
2. **Request**: Call `nba.matchup_full` capability
3. **Pay**: Receive 402, pay USDC on Base
4. **Receive**: Get AI-powered betting insights

---

## Payment Flow

```
Agent → POST /a2a/tasks?capability=nba.matchup_full
     ← 402 Payment Required
     → USDC payment on Base ($0.05)
     ← Payment signature
     → Retry with proof
     ← 200 OK + AI Analysis
```

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Backend | NestJS + TypeORM + BullMQ |
| Frontend | Next.js (App Router) |
| NBA Data | FastAPI + nba_api |
| AI | GPT-4o for matchup analysis |
| Payments | x402 + Coinbase facilitator |
| Chain | Base Mainnet (ERC-8004 + USDC) |
| Database | PostgreSQL 15 |
| Queue | Redis 7 + BullMQ |

---

## Capabilities

| Capability | Price | Description |
|------------|-------|-------------|
| `nba.matchup_brief` | Free | Quick game overview |
| `nba.matchup_full` | $0.05 USDC | Full AI analysis with model outputs |

---

## MCP Tools

| Tool | Description |
|------|-------------|
| `nba.getGameContext` | Get comprehensive game context |
| `pm.getPrices` | Fetch Polymarket live prices |
| `analysis.nbaMatchup` | AI-powered matchup analysis |
| `analysis.computeEdge` | Calculate betting edge |
| `pm.getRecentTrades` | Recent market activity |
| `alerts.detectLargeTrades` | Whale movement alerts |
| `ops.getFreshness` | Data freshness check |

---

## Live Demo

| Endpoint | URL |
|----------|-----|
| **API** | https://api-hoobs.polyox.io |
| **App** | https://app-hoobs.polyox.io |
| **Agent Card** | https://api-hoobs.polyox.io/.well-known/agent-card.json |
| **ERC-8004** | https://www.8004scan.io/agents/base/14352 |
| **A2A Console** | https://app-hoobs.polyox.io/a2a |
| **MCP Console** | https://app-hoobs.polyox.io/mcp |

---

## Quick Test

```bash
# 1. Check agent capabilities
curl -s https://api-hoobs.polyox.io/.well-known/agent-card.json | jq '.capabilities'

# 2. Create a free task
curl -sX POST 'https://api-hoobs.polyox.io/a2a/tasks?capability=nba.matchup_brief' \
  -H 'content-type: application/json' \
  -d '{"input":{"date":"2026-02-13","home":"LAL","away":"BOS"}}'

# 3. List MCP tools
curl -sX POST https://api-hoobs.polyox.io/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

---

## Hackathon Alignment

| Requirement | Implementation |
|-------------|----------------|
| **x402 Payments** | Native x402 middleware with Coinbase facilitator |
| **A2A Protocol** | Full A2A JSON-RPC + REST implementation |
| **ERC-8004** | [Registered on Base Mainnet](https://www.8004scan.io/agents/base/14352) |
| **Agents/AI** | GPT-4o powered matchup analysis |
| **Real-world utility** | Live NBA data + Polymarket integration |

---

# Team

## Team Information

Since 2018, our team has been at the forefront of the Web3 revolution. We began our journey as **Lootex**, where we built one of the earliest and most versatile NFT marketplaces, empowering creators and gamers to trade digital assets in a decentralized world.

As the landscape evolved, so did we. Today, we are proud to introduce **Team PolyOx**, a name that reflects our multidisciplinary approach to the next frontier of the internet. We have successfully pivoted our core focus to the intersection of **Prediction Markets** and **AI Agents**.

### Our New Vision

By leveraging the foundation of blockchain and the intelligence of modern AI, we are creating a more efficient, automated, and insightful ecosystem:

- **Advanced Prediction Markets**: Moving beyond simple betting, we provide platforms for crowd-sourced forecasting and decentralized decision-making.
- **AI Agent Integration**: We are developing autonomous AI agents capable of analyzing market trends, managing liquidity, and executing sophisticated strategies on behalf of users.
- **Legacy of Innovation**: Team PolyOx carries the technical rigor and community-first mindset of Lootex into the era of autonomous finance and artificial intelligence.

---

## Recruitment

### Building the Future of Autonomous Markets

Team PolyOx (formerly the core team behind Lootex) is pivoting from the NFT space to pioneer the next frontier: AI-Agent driven Prediction Markets. We are building a decentralized ecosystem where autonomous agents don't just trade—they analyze, forecast, and provide liquidity.

We are looking for **Full-stack Engineers (Next.js/Node)** and **Solidity Developers** who are obsessed with market efficiency and agentic workflows (LangGraph/Flowise). If you want to build the infrastructure for the "Internet of Agents," join us.

### Need Teammates? Roles

- AI Agent Architect (LangGraph / Vercel AI SDK)
- Full-Stack Web3 Developer (Next.js / Wagmi / Viem)
- Smart Contract Engineer (Solidity / SKALE / Base)

### Description

We are Team PolyOx, the core team behind Lootex (est. 2018). After years in the NFT space, we are now building at the intersection of Prediction Markets and Agentic AI. Our goal for this hackathon is to leverage SKALE's zero gas fees to power high-frequency AI Agent interactions and decentralized forecasting. We are looking for hackers who want to move beyond "chatbots" and build autonomous agents that can actually execute, verify, and predict on-chain.

### Ask Hackers Questions

1. Have you worked with Agentic frameworks like LangGraph or AutoGPT before?
2. What is your experience with cross-chain communication or zero-gas environments?
3. Are you more interested in the AI logic layer or the on-chain settlement layer?

### Ask BUIDLers Questions

1. What is the most complex "Agentic" workflow you've built?
2. How would you optimize an AI agent to react to real-time prediction market fluctuations?

---

# Contact

| Field | Value |
|-------|-------|
| **Telegram (Primary)** | @dtseng |
| **Phone** | +886921469099 |

---

# Submission

## What interests you about SKALE on Base?

> "The combination of Base's massive liquidity/ecosystem and SKALE's zero-gas architecture is the perfect 'sandbox' for AI Agents. Agents require high transaction throughput to update states and execute strategies without being hindered by gas costs—SKALE makes this economically viable for our PolyOx agents."

## Quote about your BUIDL and the Hackathon

> "At PolyOx, we believe the next billion users on-chain won't be humans, but AIs. This hackathon is our opportunity to build the zero-latency, zero-cost infrastructure they need to predict and shape the future."

---

# External Links

- **GitHub**: https://github.com/lootex-io/polyox-provider
- **Mirror GitHub**: https://github.com/InjayTseng/polymarket_nba_provider
- **ERC-8004**: https://www.8004scan.io/agents/base/14352
- **x402 Protocol**: https://www.x402.org/
- **DoraHacks Hackathon**: https://dorahacks.io/hackathon/x402
