"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Capability = "nba.matchup_brief" | "nba.matchup_full";

type TaskCreateResponse = {
  id: string;
  capability: Capability;
  status?: string;
  state?: string;
  createdAt?: string;
  endpoints?: {
    task?: string;
    events?: string;
    cancel?: string;
  };
};

function safeJsonParse(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isoToday() {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = dtf.formatToParts(new Date());
  const values: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }
  return `${values.year}-${values.month}-${values.day}`;
}

function useEventLog(limit = 250) {
  const [events, setEvents] = useState<Array<{ ts: string; event: string; data: any }>>([]);
  const push = (event: string, data: any) => {
    const row = { ts: new Date().toISOString(), event, data };
    setEvents((prev) => {
      const next = [...prev, row];
      return next.length > limit ? next.slice(next.length - limit) : next;
    });
  };
  const clear = () => setEvents([]);
  return { events, push, clear };
}

export function A2AClient() {
  const [capability, setCapability] = useState<Capability>("nba.matchup_brief");
  const [date, setDate] = useState(isoToday());
  const [home, setHome] = useState("SAS");
  const [away, setAway] = useState("DAL");
  const [matchupLimit, setMatchupLimit] = useState("5");
  const [recentLimit, setRecentLimit] = useState("5");
  const [marketId, setMarketId] = useState("");
  const [side, setSide] = useState<"buy" | "sell">("buy");

  const [agentCard, setAgentCard] = useState<any>(null);
  const [agentCardError, setAgentCardError] = useState<string | null>(null);

  const [taskId, setTaskId] = useState<string>("");
  const [task, setTask] = useState<any>(null);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const { events, push, clear } = useEventLog();
  const eventSourceRef = useRef<EventSource | null>(null);

  const inputPayload = useMemo(() => {
    const payload: any = {
      date,
      home: home.trim(),
      away: away.trim()
    };
    if (matchupLimit.trim()) payload.matchupLimit = Number(matchupLimit);
    if (recentLimit.trim()) payload.recentLimit = Number(recentLimit);
    if (marketId.trim()) payload.marketId = Number(marketId);
    payload.side = side;
    return payload;
  }, [date, home, away, matchupLimit, recentLimit, marketId, side]);

  const stopStream = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  };

  const startStream = (id: string) => {
    stopStream();
    const es = new EventSource(`/api/a2a/tasks/${encodeURIComponent(id)}/events`);
    eventSourceRef.current = es;
    es.addEventListener("state", (msg: MessageEvent) => {
      push("state", safeJsonParse(msg.data) ?? msg.data);
    });
    es.addEventListener("active", (msg: MessageEvent) => {
      push("active", safeJsonParse(msg.data) ?? msg.data);
    });
    es.addEventListener("progress", (msg: MessageEvent) => {
      push("progress", safeJsonParse(msg.data) ?? msg.data);
    });
    es.addEventListener("completed", (msg: MessageEvent) => {
      push("completed", safeJsonParse(msg.data) ?? msg.data);
      // final fetch for result
      void refreshTask(id);
      setTimeout(stopStream, 250);
    });
    es.addEventListener("failed", (msg: MessageEvent) => {
      push("failed", safeJsonParse(msg.data) ?? msg.data);
      void refreshTask(id);
      setTimeout(stopStream, 250);
    });
    es.addEventListener("cancelled", (msg: MessageEvent) => {
      push("cancelled", safeJsonParse(msg.data) ?? msg.data);
      void refreshTask(id);
      setTimeout(stopStream, 250);
    });
    es.addEventListener("ping", (msg: MessageEvent) => {
      push("ping", safeJsonParse(msg.data) ?? msg.data);
    });
    es.onerror = () => {
      push("sse_error", { message: "EventSource error" });
    };
  };

  const refreshAgentCard = async () => {
    setAgentCardError(null);
    try {
      const res = await fetch("/api/a2a/agent-card", { cache: "no-store" });
      const text = await res.text();
      const parsed = safeJsonParse(text);
      if (!res.ok) {
        setAgentCardError(parsed?.message || parsed?.error || `HTTP ${res.status}`);
        return;
      }
      setAgentCard(parsed ?? text);
    } catch (e: any) {
      setAgentCardError(e?.message || "failed");
    }
  };

  const refreshTask = async (id: string) => {
    setTaskError(null);
    try {
      const res = await fetch(`/api/a2a/tasks/${encodeURIComponent(id)}`, {
        cache: "no-store"
      });
      const text = await res.text();
      const parsed = safeJsonParse(text);
      if (!res.ok) {
        setTaskError(parsed?.message || parsed?.error || `HTTP ${res.status}`);
        setTask(parsed ?? text);
        return;
      }
      setTask(parsed ?? text);
    } catch (e: any) {
      setTaskError(e?.message || "failed");
    }
  };

  const createTask = async () => {
    setCreating(true);
    setTaskError(null);
    setTask(null);
    clear();
    stopStream();
    try {
      const res = await fetch(
        `/api/a2a/tasks?capability=${encodeURIComponent(capability)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ input: inputPayload })
        }
      );
      const text = await res.text();
      const parsed = safeJsonParse(text);
      if (!res.ok) {
        setTaskError(parsed?.message || parsed?.error || `HTTP ${res.status}`);
        setTask(parsed ?? text);
        return;
      }
      const out = (parsed ?? {}) as TaskCreateResponse;
      setTaskId(out.id);
      push("created", out);
      await refreshTask(out.id);
      startStream(out.id);
    } catch (e: any) {
      setTaskError(e?.message || "failed");
    } finally {
      setCreating(false);
    }
  };

  const cancelTask = async () => {
    if (!taskId) return;
    setTaskError(null);
    try {
      const res = await fetch(
        `/api/a2a/tasks/${encodeURIComponent(taskId)}/cancel`,
        { method: "POST", headers: { "content-type": "application/json" } }
      );
      const text = await res.text();
      const parsed = safeJsonParse(text);
      if (!res.ok) {
        setTaskError(parsed?.message || parsed?.error || `HTTP ${res.status}`);
        return;
      }
      push("cancelled", parsed ?? text);
      await refreshTask(taskId);
    } catch (e: any) {
      setTaskError(e?.message || "failed");
    }
  };

  useEffect(() => {
    void refreshAgentCard();
    return () => stopStream();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!taskId) return;
    const timer = setInterval(() => {
      void refreshTask(taskId);
    }, 1500);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  const requestPreview = useMemo(() => {
    return {
      capability,
      input: inputPayload
    };
  }, [capability, inputPayload]);

  return (
    <div className="console-grid">
      <div className="console-pane">
        <div className="section-header">
          <h2>Create Task</h2>
          <div className="hint">`POST /a2a/tasks`</div>
        </div>

        <div className="query-form">
          <div className="form-row">
            <label className="field">
              <span>Capability</span>
              <select
                value={capability}
                onChange={(e) => setCapability(e.target.value as Capability)}
              >
                <option value="nba.matchup_brief">nba.matchup_brief (free)</option>
                <option value="nba.matchup_full">nba.matchup_full (x402)</option>
              </select>
            </label>
            <label className="field">
              <span>Date (ET)</span>
              <input value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="field">
              <span>Home</span>
              <input value={home} onChange={(e) => setHome(e.target.value)} />
            </label>
            <label className="field">
              <span>Away</span>
              <input value={away} onChange={(e) => setAway(e.target.value)} />
            </label>
          </div>

          <div className="form-row">
            <label className="field">
              <span>Matchup limit</span>
              <input
                value={matchupLimit}
                onChange={(e) => setMatchupLimit(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Recent limit</span>
              <input
                value={recentLimit}
                onChange={(e) => setRecentLimit(e.target.value)}
              />
            </label>
            <label className="field">
              <span>MarketId (optional)</span>
              <input
                value={marketId}
                onChange={(e) => setMarketId(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Side</span>
              <select value={side} onChange={(e) => setSide(e.target.value as any)}>
                <option value="buy">buy</option>
                <option value="sell">sell</option>
              </select>
            </label>
          </div>

          <div className="form-row">
            <button type="button" onClick={createTask} disabled={creating}>
              {creating ? "Creating..." : "Create + Stream"}
            </button>
            <button
              type="button"
              onClick={() => taskId && refreshTask(taskId)}
              disabled={!taskId}
              className="ghost"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={cancelTask}
              disabled={!taskId}
              className="ghost danger"
            >
              Cancel
            </button>
            <button type="button" onClick={() => { clear(); setTask(null); setTaskError(null); }} className="ghost">
              Clear output
            </button>
          </div>
        </div>

        <div className="console-split">
          <div>
            <div className="card-title">Request preview</div>
            <pre>{JSON.stringify(requestPreview, null, 2)}</pre>
          </div>
          <div>
            <div className="card-title">Agent card</div>
            {agentCardError ? (
              <div className="error">{agentCardError}</div>
            ) : null}
            <pre>{agentCard ? JSON.stringify(agentCard, null, 2) : "loading..."}</pre>
          </div>
        </div>
      </div>

      <div className="console-pane">
        <div className="section-header">
          <h2>Task + Events</h2>
          <div className="hint">
            {taskId ? (
              <span className="pill">taskId: {taskId}</span>
            ) : (
              <span className="pill muted">no task yet</span>
            )}
          </div>
        </div>

        {taskError ? <div className="error">{taskError}</div> : null}

        <div className="console-split">
          <div>
            <div className="card-title">Task JSON</div>
            <pre>{task ? JSON.stringify(task, null, 2) : "Create a task to begin."}</pre>
          </div>
          <div>
            <div className="card-title">SSE events</div>
            <div className="log">
              {events.length === 0 ? (
                <div className="empty">No events yet.</div>
              ) : (
                events.map((row, idx) => (
                  <div key={idx} className="log-row">
                    <div className="log-meta">
                      <span className="pill">{row.event}</span>
                      <span className="hint">{row.ts.slice(11, 19)}Z</span>
                    </div>
                    <pre className="log-pre">{JSON.stringify(row.data, null, 2)}</pre>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="hint">
          Notes: if `nba.matchup_full` returns HTTP 402, finish x402 payment and retry. The existing `/x402`
          page can unlock the session; this console uses same-origin `/api/*` proxy so cookies stay on the app domain.
        </div>
      </div>
    </div>
  );
}
