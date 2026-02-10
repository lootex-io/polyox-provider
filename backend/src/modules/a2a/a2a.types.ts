export type A2ACapabilityName = "nba.matchup_brief" | "nba.matchup_full";

export type A2ATaskState =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type A2ATask = {
  id: string;
  capability: A2ACapabilityName;
  state: A2ATaskState;
  createdAt: string;
  updatedAt: string;
  result?: any;
  error?: { message: string };
  payerAddress?: string | null;
};

export type A2AJsonRpcId = string | number | null;

export type A2AJsonRpcRequest = {
  jsonrpc?: string;
  id?: A2AJsonRpcId;
  method?: string;
  params?: any;
};

export type A2AJsonRpcResponse = {
  jsonrpc: "2.0";
  id: A2AJsonRpcId;
  result?: any;
  error?: { code: number; message: string; data?: any };
};
