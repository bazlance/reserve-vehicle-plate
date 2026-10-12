"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { api, API_URL, RUNNING_STATUSES, RunStatus } from "@/lib/api";

interface Result {
  submitStatus?: number;
  confirmId?: string;
  pageTitle?: string;
  bodyText?: string;
  dialogMessages: string[];
  error?: string;
}

interface Snapshot {
  status: RunStatus;
  attempts: number;
  qr?: string;
  logs: string[];
  result?: Result;
}

export default function RunPage() {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const es = new EventSource(`${API_URL}/runs/${id}/events`);
    const parse = <T,>(e: Event) => JSON.parse((e as MessageEvent).data) as T;

    es.addEventListener("snapshot", (e) => {
      const s = parse<Snapshot>(e);
      setState({ ...s, logs: s.logs ?? [] });
    });
    es.addEventListener("status", (e) => {
      const d = parse<{ status: RunStatus; attempts: number }>(e);
      setState((s) =>
        s ? { ...s, status: d.status, attempts: d.attempts, qr: d.status === "WAITING_QR" ? s.qr : undefined } : s,
      );
    });
    es.addEventListener("qr", (e) => {
      const { png } = parse<{ png: string }>(e);
      setState((s) => (s ? { ...s, qr: png } : s));
    });
    es.addEventListener("log", (e) => {
      const { line } = parse<{ line: string }>(e);
      setState((s) => (s ? { ...s, logs: [...s.logs.slice(-299), line] } : s));
    });
    es.addEventListener("result", (e) => {
      const result = parse<Result>(e);
      setState((s) => (s ? { ...s, result } : s));
    });
    es.onerror = () => {
      // EventSource retries on its own; only surface it if we never connected.
      setState((s) => {
        if (!s) setError("Cannot reach the API event stream. Is the API running and is this run id valid?");
        return s;
      });
    };
    return () => es.close();
  }, [id]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [state?.logs.length]);

  async function stop() {
    setStopping(true);
    try {
      await api(`/runs/${id}/stop`, { method: "POST" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStopping(false);
    }
  }

  if (error && !state) return <p className="error" role="alert">{error}</p>;
  if (!state) return <p className="muted">Connecting…</p>;

  const running = RUNNING_STATUSES.includes(state.status);

  return (
    <>
      <p><Link href="/">← Back</Link></p>
      <div className="row between">
        <h1>Run <span className="muted">{id.slice(0, 8)}</span></h1>
        <div className="row">
          <StatusBadge status={state.status} />
          <span className="muted">attempt {state.attempts}</span>
        </div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}

      {state.status === "WAITING_QR" && (
        <div className="card">
          <strong>Scan this QR code with the ThaID app</strong>
          <p className="muted">It is a live view of the DLT login page and refreshes automatically. The browser window on the API machine shows the same page.</p>
          {state.qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="qr" src={`data:image/png;base64,${state.qr}`} alt="ThaID login QR code" />
          ) : (
            <p className="muted">Loading QR…</p>
          )}
        </div>
      )}

      {state.result && (
        <div className="card stack">
          <strong>Result</strong>
          {state.result.error && <p className="error">{state.result.error}</p>}
          {state.result.submitStatus !== undefined && <div>HTTP status: {state.result.submitStatus}</div>}
          {state.result.dialogMessages.length > 0 && (
            <div>
              <div className="muted">Dialog messages (likely the real verdict)</div>
              <pre className="result">{state.result.dialogMessages.join("\n")}</pre>
            </div>
          )}
          {state.result.pageTitle && <div>Page title: {state.result.pageTitle}</div>}
          {state.result.bodyText && (
            <div>
              <div className="muted">Page text</div>
              <pre className="result">{state.result.bodyText}</pre>
            </div>
          )}
          {!running && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="qr" src={`${API_URL}/runs/${id}/screenshot`} alt="Result screenshot" onError={(e) => (e.currentTarget.style.display = "none")} />
          )}
          <small>HTTP 200 does not mean approved: DLT also returns 200 for rejections. Read the messages above.</small>
        </div>
      )}

      <div className="row" style={{ margin: "12px 0" }}>
        <button className="danger" onClick={stop} disabled={stopping}>
          {running ? "Stop run" : "Close browser"}
        </button>
        {!running && <small>The browser stays open for 10 minutes after a run so you can inspect it.</small>}
      </div>

      <h2>Log</h2>
      <div className="log" ref={logRef}>{state.logs.join("\n") || "No output yet."}</div>
    </>
  );
}
