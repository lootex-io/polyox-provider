"use client";

import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useReadContract,
  useSwitchChain,
  useWalletClient
} from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { x402Client, wrapFetchWithPayment, x402HTTPClient } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import type { PaymentRequired } from "@x402/core/types";
import { erc20Abi, formatUnits } from "viem";

const resolveApiBase = () => {
  if (process.env.NEXT_PUBLIC_API_BASE) {
    return process.env.NEXT_PUBLIC_API_BASE;
  }
  if (typeof window !== "undefined") {
    const { protocol, hostname } = window.location;
    return `${protocol}//${hostname}:3000`;
  }
  return "http://localhost:3000";
};
const apiBase = resolveApiBase();
const analysisEndpoint = `${apiBase}/nba/analysis`;
const usdcTokenAddress = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;
const usdcDecimals = 6;
const zeroAddress = "0x0000000000000000000000000000000000000000" as const;

type HexAddress = `0x${string}`;

function formatTokenAmount(value: string | null) {
  if (!value) {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return value;
  }
  return numeric.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4
  });
}

type PaidStatus = "idle" | "loading" | "success" | "error";

type PaidState = {
  status: PaidStatus;
  result: any;
  error: string | null;
  paymentRequiredData: PaymentRequired | null;
  paymentRequiredHeader: string | null;
  paymentRequiredBody: any | null;
  paymentResponseHeader: string | null;
  paymentSettleResponse: any | null;
  paidResponseInfo: {
    status: number;
    body: any;
    headers: Record<string, string>;
  } | null;
};

type PaidRequestParams = {
  endpoint: string;
  method: string;
  body?: Record<string, any>;
  walletClient: any;
  address?: string | null;
};

const emptyPaidState: PaidState = {
  status: "idle",
  result: null,
  error: null,
  paymentRequiredData: null,
  paymentRequiredHeader: null,
  paymentRequiredBody: null,
  paymentResponseHeader: null,
  paymentSettleResponse: null,
  paidResponseInfo: null
};

async function performPaidRequest(
  params: PaidRequestParams
): Promise<PaidState> {
  const { endpoint, method, body, walletClient, address } = params;
  const signingAddress = (walletClient?.account?.address || address) as
    | HexAddress
    | undefined;
  if (!walletClient) {
    throw new Error("Please connect a wallet first.");
  }
  if (!signingAddress) {
    throw new Error("Missing wallet address.");
  }

  const signer = {
    address: signingAddress,
    signTypedData: (typedData: {
      domain: Record<string, unknown>;
      types: Record<string, unknown>;
      primaryType: string;
      message: Record<string, unknown>;
    }) =>
      walletClient.signTypedData({
        ...typedData,
        account: signingAddress
      })
  };

  const client = new x402Client();
  registerExactEvmScheme(client, { signer });
  const fetchWithPayment = wrapFetchWithPayment(fetch, client);

  const headers: Record<string, string> = {
    Accept: "application/json"
  };
  let requestBody: string | undefined;
  if (body && method.toUpperCase() !== "GET") {
    headers["Content-Type"] = "application/json";
    requestBody = JSON.stringify(body);
  }

  const paidResponse = await fetchWithPayment(endpoint, {
    method,
    credentials: "include",
    headers,
    body: requestBody
  });

  const debugHeaders: Record<string, string> = {};
  const debugHeaderNames = [
    "payment-required",
    "payment-response",
    "x-payment-response",
    "x402-debug-has-payment",
    "x402-debug-payment-len"
  ];
  for (const name of debugHeaderNames) {
    const value = paidResponse.headers.get(name);
    if (value) {
      debugHeaders[name] = value;
    }
  }

  const settleHeader =
    paidResponse.headers.get("payment-response") ||
    paidResponse.headers.get("PAYMENT-RESPONSE") ||
    paidResponse.headers.get("x-payment-response") ||
    paidResponse.headers.get("X-PAYMENT-RESPONSE");

  const responseText = await paidResponse.text();
  let payloadBody: any = {};
  if (responseText) {
    try {
      payloadBody = JSON.parse(responseText);
    } catch {
      payloadBody = { raw: responseText };
    }
  }

  let paymentRequiredHeader: string | null = null;
  let paymentRequiredData: PaymentRequired | null = null;
  let paymentRequiredBody: any | null = null;
  let parsedRequiredForError: PaymentRequired | null = null;

  if (paidResponse.status === 402) {
    const requiredHeader =
      paidResponse.headers.get("payment-required") ||
      paidResponse.headers.get("PAYMENT-REQUIRED");
    if (requiredHeader) {
      paymentRequiredHeader = requiredHeader;
      try {
        const parsedRequired = decodePaymentRequiredHeader(requiredHeader);
        paymentRequiredData = parsedRequired as PaymentRequired;
        parsedRequiredForError = parsedRequired as PaymentRequired;
      } catch {
        paymentRequiredData = null;
      }
    }
    paymentRequiredBody = payloadBody;
  }

  const paidResponseInfo = {
    status: paidResponse.status,
    body: payloadBody,
    headers: debugHeaders
  };

  let paymentSettleResponse: any | null = null;
  if (paidResponse.ok) {
    const httpClient = new x402HTTPClient(client);
    const paymentResponse = httpClient.getPaymentSettleResponse((name) =>
      paidResponse.headers.get(name)
    );
    if (paymentResponse) {
      paymentSettleResponse = paymentResponse;
    }
  }

  if (!paidResponse.ok) {
    if (payloadBody?.error) {
      const details = payloadBody?.details ? `: ${payloadBody.details}` : "";
      return {
        status: "error",
        result: payloadBody,
        error: `${payloadBody.error}${details}`,
        paymentRequiredData,
        paymentRequiredHeader,
        paymentRequiredBody,
        paymentResponseHeader: settleHeader,
        paymentSettleResponse,
        paidResponseInfo
      };
    }
    if (paidResponse.status === 402) {
      return {
        status: "error",
        result: payloadBody,
        error: parsedRequiredForError?.error
          ? `Payment failed: ${parsedRequiredForError.error}`
          : "Payment failed on retry (HTTP 402).",
        paymentRequiredData,
        paymentRequiredHeader,
        paymentRequiredBody,
        paymentResponseHeader: settleHeader,
        paymentSettleResponse,
        paidResponseInfo
      };
    }
    const details = payloadBody?.details ? `: ${payloadBody.details}` : "";
    return {
      status: "error",
      result: payloadBody,
      error: `HTTP ${paidResponse.status}${details}`,
      paymentRequiredData,
      paymentRequiredHeader,
      paymentRequiredBody,
      paymentResponseHeader: settleHeader,
      paymentSettleResponse,
      paidResponseInfo
    };
  }

  return {
    status: "success",
    result: payloadBody,
    error: null,
    paymentRequiredData,
    paymentRequiredHeader,
    paymentRequiredBody,
    paymentResponseHeader: settleHeader,
    paymentSettleResponse,
    paidResponseInfo
  };
}

export function X402Client() {
  const { address, isConnected, chain } = useAccount();
  const { connectors, connect, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const { data: walletClient } = useWalletClient();

  const [analysisState, setAnalysisState] = useState<PaidState>(emptyPaidState);
  const [analysisForm, setAnalysisForm] = useState({
    date: "",
    home: "",
    away: ""
  });
  const [autoGameLabel, setAutoGameLabel] = useState<string | null>(null);

  const isOnBase = chain?.id === baseSepolia.id;
  const { data: usdcBalanceRaw, isLoading: isUsdcLoading, error: usdcError } =
    useReadContract({
      abi: erc20Abi,
      address: usdcTokenAddress,
      functionName: "balanceOf",
      args: [(address ?? zeroAddress) as HexAddress],
      chainId: baseSepolia.id,
      query: {
        enabled: Boolean(address && isOnBase)
      }
    });
  const usdcBalance =
    typeof usdcBalanceRaw === "bigint"
      ? formatUnits(usdcBalanceRaw, usdcDecimals)
      : null;

  const buildPayDisabledReason = (status: PaidStatus) => {
    if (!isConnected) {
      return "Connect MetaMask first.";
    }
    if (!isOnBase) {
      return "Switch to Base first.";
    }
    if (status === "loading") {
      return "Request in progress.";
    }
    return "";
  };

  const handlePaidRequest = async (
    params: Omit<PaidRequestParams, "walletClient" | "address">,
    setState: Dispatch<SetStateAction<PaidState>>
  ) => {
    setState({ ...emptyPaidState, status: "loading" });
    try {
      const nextState = await performPaidRequest({
        ...params,
        walletClient,
        address
      });
      setState(nextState);
    } catch (err) {
      setState({
        ...emptyPaidState,
        status: "error",
        error: err instanceof Error ? err.message : "Request failed"
      });
    }
  };

  const handleAnalysisRequest = async () => {
    if (!analysisForm.date.trim()) {
      setAnalysisState({
        ...emptyPaidState,
        status: "error",
        error: "Please enter a date."
      });
      return;
    }
    if (!analysisForm.home.trim() || !analysisForm.away.trim()) {
      setAnalysisState({
        ...emptyPaidState,
        status: "error",
        error: "Please enter home and away team abbreviations."
      });
      return;
    }
    const payload: Record<string, any> = {
      date: analysisForm.date.trim(),
      home: analysisForm.home.trim().toUpperCase(),
      away: analysisForm.away.trim().toUpperCase()
    };
    // Temperature/model are server-controlled; do not send from client.
    await handlePaidRequest(
      { endpoint: analysisEndpoint, method: "POST", body: payload },
      setAnalysisState
    );
  };

  useEffect(() => {
    if (analysisForm.home && analysisForm.away && analysisForm.date) {
      return;
    }

    const controller = new AbortController();
    const fetchTodayFirstGame = async () => {
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const dd = String(now.getDate()).padStart(2, "0");
      const date = `${yyyy}-${mm}-${dd}`;

      try {
        const [teamsResponse, gamesResponse] = await Promise.all([
          fetch(`${apiBase}/nba/teams`, { signal: controller.signal }),
          fetch(`${apiBase}/nba/games?date=${date}&page=1&pageSize=50`, {
            signal: controller.signal
          })
        ]);
        if (!teamsResponse.ok || !gamesResponse.ok) {
          return;
        }
        const teamsPayload = await teamsResponse.json();
        const gamesPayload = await gamesResponse.json();

        const teamMap = new Map<string, string>();
        if (Array.isArray(teamsPayload)) {
          for (const team of teamsPayload) {
            if (team?.id && team?.abbrev) {
              teamMap.set(team.id, team.abbrev);
            }
          }
        }

        const games = Array.isArray(gamesPayload?.data)
          ? gamesPayload.data
          : [];
        if (games.length === 0) {
          return;
        }
        const sorted = games
          .filter((game: any) => game?.dateTimeUtc)
          .sort(
            (a: any, b: any) =>
              new Date(a.dateTimeUtc).getTime() -
              new Date(b.dateTimeUtc).getTime()
          );
        const first = sorted[0] || games[0];
        const homeAbbrev = teamMap.get(first?.homeTeamId) || "";
        const awayAbbrev = teamMap.get(first?.awayTeamId) || "";
        setAnalysisForm((prev) => ({
          ...prev,
          date: prev.date || date,
          home: prev.home || homeAbbrev,
          away: prev.away || awayAbbrev
        }));
        if (homeAbbrev && awayAbbrev) {
          setAutoGameLabel(`${awayAbbrev}@${homeAbbrev}`);
        }
      } catch {
        // ignore
      }
    };

    fetchTodayFirstGame();

    return () => {
      controller.abort();
    };
  }, [analysisForm.date, analysisForm.home, analysisForm.away]);

  return (
    <div className="x402-body">
      <div className="x402-panel">
        <div className="card-title">Wallet</div>
        {isConnected ? (
          <div className="wallet-info">
            <div>Connected: {address}</div>
            <div>Network: {chain?.name || "Unknown"}</div>
            <div>
              USDC balance:{" "}
              {!isOnBase
                ? "Switch to Base"
                : isUsdcLoading
                  ? "Loading..."
                  : usdcError
                    ? "Unavailable"
                    : `${formatTokenAmount(usdcBalance) ?? "0"} USDC`}
            </div>
            {usdcError ? (
              <div className="hint">USDC read failed.</div>
            ) : null}
            <button onClick={() => disconnect()}>Disconnect</button>
          </div>
        ) : (
          <div className="wallet-actions">
            <button
              onClick={() => connectors[0] && connect({ connector: connectors[0] })}
              disabled={isConnecting || connectors.length === 0}
            >
              Connect MetaMask
            </button>
          </div>
        )}
        {isConnected && !isOnBase ? (
          <button onClick={() => switchChain({ chainId: baseSepolia.id })} disabled={isSwitching}>
            Switch to Base
          </button>
        ) : null}
        {!isConnected ? (
          <div className="hint">
            Please ensure the MetaMask browser extension is installed.
          </div>
        ) : null}
      </div>

      <div className="x402-panel">
        <div className="card-title">AI Analysis</div>
        <div className="hint">Endpoint: {analysisEndpoint}</div>
        <label className="field">
          <span>Date (YYYY-MM-DD)</span>
          <input
            type="text"
            placeholder="2026-02-07"
            value={analysisForm.date}
            onChange={(event) =>
              setAnalysisForm((prev) => ({ ...prev, date: event.target.value }))
            }
          />
        </label>
        <div className="form-row">
          <label className="field">
            <span>Home (abbrev)</span>
            <input
              type="text"
              placeholder="SAS"
              value={analysisForm.home}
              onChange={(event) =>
                setAnalysisForm((prev) => ({
                  ...prev,
                  home: event.target.value
                }))
              }
            />
          </label>
          <label className="field">
            <span>Away (abbrev)</span>
            <input
              type="text"
              placeholder="DAL"
              value={analysisForm.away}
              onChange={(event) =>
                setAnalysisForm((prev) => ({
                  ...prev,
                  away: event.target.value
                }))
              }
            />
          </label>
        </div>
        {autoGameLabel ? (
          <div className="hint">Auto-selected today first game: {autoGameLabel}</div>
        ) : null}
        <button
          onClick={handleAnalysisRequest}
          disabled={
            !isConnected ||
            !isOnBase ||
            analysisState.status === "loading"
          }
        >
          Call Paid Analysis (auto)
        </button>
        {buildPayDisabledReason(analysisState.status) ? (
          <div className="hint">
            Disabled: {buildPayDisabledReason(analysisState.status)}
          </div>
        ) : null}
        {analysisState.status === "loading" ? (
          <div className="hint">Waiting for wallet signature and payment...</div>
        ) : null}
        {analysisState.paymentRequiredHeader ? (
          <pre>{`PAYMENT-REQUIRED: ${analysisState.paymentRequiredHeader}`}</pre>
        ) : null}
        {analysisState.paymentRequiredData?.accepts?.[0]?.asset ? (
          <div className="hint">
            USDC token address: {analysisState.paymentRequiredData.accepts[0].asset}
          </div>
        ) : null}
        {analysisState.paymentRequiredData ? (
          <pre>{JSON.stringify(analysisState.paymentRequiredData, null, 2)}</pre>
        ) : null}
        {analysisState.paymentRequiredBody ? (
          <pre>{JSON.stringify(analysisState.paymentRequiredBody, null, 2)}</pre>
        ) : null}
        {analysisState.paymentResponseHeader ? (
          <pre>{`PAYMENT-RESPONSE: ${analysisState.paymentResponseHeader}`}</pre>
        ) : null}
        {analysisState.paymentSettleResponse ? (
          <pre>{JSON.stringify(analysisState.paymentSettleResponse, null, 2)}</pre>
        ) : null}
        {analysisState.paidResponseInfo ? (
          <pre>{JSON.stringify(analysisState.paidResponseInfo, null, 2)}</pre>
        ) : null}
        {analysisState.status === "success" ? (
          <pre>{JSON.stringify(analysisState.result, null, 2)}</pre>
        ) : null}
        {analysisState.status === "error" ? (
          <div className="error">{analysisState.error}</div>
        ) : null}
      </div>
    </div>
  );
}
