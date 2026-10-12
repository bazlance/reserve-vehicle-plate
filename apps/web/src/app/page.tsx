"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { api, Reservation, Run } from "@/lib/api";

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—");

export default function Dashboard() {
  const router = useRouter();
  const [items, setItems] = useState<Reservation[] | null>(null);
  const [current, setCurrent] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, cur] = await Promise.all([
        api<Reservation[]>("/reservations"),
        api<Run | null>("/runs/current"),
      ]);
      setItems(list);
      setCurrent(cur && Object.keys(cur).length ? cur : null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  async function runNow(r: Reservation) {
    if (!confirm(`Start "${r.label}" now? This opens a browser and submits a real reservation request.`)) return;
    try {
      const run = await api<Run>(`/reservations/${r.id}/run`, { method: "POST" });
      router.push(`/runs/${run.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function toggle(r: Reservation) {
    try {
      await api(`/reservations/${r.id}/enabled`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !r.enabled }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function remove(r: Reservation) {
    if (!confirm(`Delete "${r.label}" and its run history?`)) return;
    try {
      await api(`/reservations/${r.id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <>
      <h1>Reservations</h1>
      {error && <p className="error" role="alert">{error}</p>}
      {current && (
        <div className="banner">
          A run is in progress ({current.status.toLowerCase().replace("_", " ")}).{" "}
          <Link href={`/runs/${current.id}`}>Open it</Link>
        </div>
      )}
      {items === null && !error && <p className="muted">Loading…</p>}
      {items?.length === 0 && (
        <div className="card">
          <p>No reservations yet.</p>
          <Link href="/reservations/new" className="button primary">Create your first reservation</Link>
        </div>
      )}
      {items?.map((r) => (
        <div className="card" key={r.id}>
          <div className="row between">
            <div>
              <strong>{r.label}</strong>{" "}
              <span className="muted">
                plate {r.desiredNumber} · {r.brand} · {r.pers === 1 ? "individual" : "corporate/foreign"}
              </span>
            </div>
            {r.lastRun && <StatusBadge status={r.lastRun.status} />}
          </div>
          <p className="muted" style={{ margin: "8px 0" }}>
            {r.enabled ? (
              <>Next run: <strong>{fmt(r.nextRunAt)}</strong> <code>{r.cronExpression}</code>{r.runOnce && " (once)"}</>
            ) : (
              <>Schedule disabled <code>{r.cronExpression}</code></>
            )}
          </p>
          <div className="row">
            <button className="primary" onClick={() => runNow(r)} disabled={!!current}>Run now</button>
            <button onClick={() => toggle(r)}>{r.enabled ? "Disable" : "Enable"}</button>
            <Link href={`/reservations/${r.id}`} className="button">Edit / history</Link>
            <button className="danger" onClick={() => remove(r)}>Delete</button>
          </div>
        </div>
      ))}
    </>
  );
}
