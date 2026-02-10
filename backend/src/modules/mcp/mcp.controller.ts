import { Body, Controller, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { McpService } from "./mcp.service";
import type { McpJsonRpcRequest, McpJsonRpcResponse } from "./mcp.types";

function ok(id: any, result: any): McpJsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function err(id: any, code: number, message: string, data?: any): McpJsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message, data } };
}

@Controller("mcp")
@ApiTags("MCP")
export class McpController {
  constructor(private readonly mcpService: McpService) {}

  @Post()
  @ApiOperation({ summary: "MCP JSON-RPC endpoint" })
  async handle(@Body() body: McpJsonRpcRequest | McpJsonRpcRequest[], @Res() res: Response) {
    const handleOne = async (req: McpJsonRpcRequest): Promise<McpJsonRpcResponse | null> => {
      const id = req?.id ?? null;
      const method = String(req?.method || "");

      if (req?.jsonrpc !== "2.0") {
        return err(id, -32600, "invalid jsonrpc; expected 2.0");
      }
      if (!method) {
        return err(id, -32600, "missing method");
      }

      // Notifications (no id) are allowed.
      const isNotification = req.id === undefined;

      try {
        switch (method) {
          case "initialize": {
            const result = {
              protocolVersion:
                process.env.MCP_PROTOCOL_VERSION || "2024-11-05",
              serverInfo: {
                name: process.env.MCP_SERVER_NAME || "hoobs-mcp",
                version: process.env.MCP_SERVER_VERSION || "1.0.0"
              },
              capabilities: {
                tools: {},
                resources: {},
                prompts: {}
              }
            };
            return isNotification ? null : ok(id, result);
          }
          case "ping": {
            return isNotification ? null : ok(id, {});
          }
          case "notifications/initialized": {
            // No-op.
            return null;
          }
          case "tools/list": {
            const result = { tools: this.mcpService.toolsList() };
            return isNotification ? null : ok(id, result);
          }
          case "tools/call": {
            const name = String(req?.params?.name || "");
            const args =
              (req?.params?.arguments ?? req?.params?.args ?? {}) as any;
            if (!name) {
              return err(id, -32602, "params.name is required");
            }
            const output = await this.mcpService.toolsCall(name, args);
            const result = {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(output, null, 2)
                }
              ]
            };
            return isNotification ? null : ok(id, result);
          }
          case "resources/list": {
            return isNotification ? null : ok(id, { resources: [] });
          }
          case "prompts/list": {
            return isNotification ? null : ok(id, { prompts: [] });
          }
          default: {
            return isNotification ? null : err(id, -32601, `method not found: ${method}`);
          }
        }
      } catch (e: any) {
        const message = e instanceof Error ? e.message : String(e);
        return isNotification ? null : err(id, -32000, message);
      }
    };

    if (Array.isArray(body)) {
      const responses = (await Promise.all(body.map((item) => handleOne(item)))).filter(
        (r): r is McpJsonRpcResponse => Boolean(r)
      );
      if (responses.length === 0) {
        res.status(204).end();
        return;
      }
      res.status(200).json(responses);
      return;
    }

    const single = await handleOne(body);
    if (!single) {
      res.status(204).end();
      return;
    }
    res.status(200).json(single);
  }
}
