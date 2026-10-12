"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ReservationForm } from "@/components/ReservationForm";
import { StatusBadge } from "@/components/StatusBadge";
import { api, Reservation, Run } from "@/lib/api";

export default function EditReservation() {
  const { id } = useParams<{ id: string }>();
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api<Reservation>(`/reservations/${id}`),
      api<Run[]>(`/reservations/${id}/runs`),
    ])
      .then(([r, rs]) => {
        setReservation(r);
        setRuns(rs);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!reservation) return <p className="muted">Loading…</p>;

  return (
    <>
      <h1>Edit “{reservation.label}”</h1>
      <ReservationForm existing={reservation} />

      <h2>Run history</h2>
      {runs.length === 0 ? (
        <p className="muted">No runs yet.</p>
      ) : (
        <div className="card">
          <table>
            <thead>
              <tr><th>Started</th><th>Trigger</th><th>Status</th><th>Attempts</th><th>HTTP</th><th /></tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td>{new Date(run.startedAt).toLocaleString()}</td>
                  <td>{run.trigger}</td>
                  <td><StatusBadge status={run.status} /></td>
                  <td>{run.attempts}</td>
                  <td>{run.submitStatus ?? "—"}</td>
                  <td><Link href={`/runs/${run.id}`}>Details</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
