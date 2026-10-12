import { RunStatus } from "@/lib/api";

const LABELS: Record<RunStatus, string> = {
  STARTING: "Starting",
  WAITING_QR: "Waiting for QR scan",
  LOGGED_IN: "Logged in",
  FILLING: "Filling form",
  SUBMITTING: "Submitting",
  RETRYING: "Retrying",
  DONE: "Done",
  FAILED: "Failed",
  STOPPED: "Stopped",
};

const TONE: Record<RunStatus, string> = {
  STARTING: "info",
  WAITING_QR: "warn",
  LOGGED_IN: "info",
  FILLING: "info",
  SUBMITTING: "info",
  RETRYING: "warn",
  DONE: "ok",
  FAILED: "bad",
  STOPPED: "muted",
};

export function StatusBadge({ status }: { status: RunStatus }) {
  return <span className={`badge badge-${TONE[status]}`}>{LABELS[status]}</span>;
}
