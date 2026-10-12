export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3001";

export type RunStatus =
  | "STARTING"
  | "WAITING_QR"
  | "LOGGED_IN"
  | "FILLING"
  | "SUBMITTING"
  | "RETRYING"
  | "DONE"
  | "FAILED"
  | "STOPPED";

export interface ReservationInput {
  label: string;
  bodyNumber: string;
  brand: string;
  tel: string;
  desiredNumber: string;
  carType: number;
  pers: number;
  applicantIdCard?: string;
  applicantPrefix?: string;
  applicantFname?: string;
  applicantLname?: string;
  cronExpression: string;
  runOnce: boolean;
  enabled: boolean;
}

export interface Run {
  id: string;
  reservationId: string;
  trigger: "cron" | "manual";
  status: RunStatus;
  attempts: number;
  confirmId: string | null;
  submitStatus: number | null;
  pageTitle: string | null;
  bodyText: string | null;
  dialogMessages: string[];
  screenshotPath: string | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  reservation?: { id: string; label: string };
}

export interface Reservation extends ReservationInput {
  id: string;
  createdAt: string;
  updatedAt: string;
  nextRunAt: string | null;
  lastRun?: Run | null;
}

export const RUNNING_STATUSES: RunStatus[] = [
  "STARTING",
  "WAITING_QR",
  "LOGGED_IN",
  "FILLING",
  "SUBMITTING",
  "RETRYING",
];

export class ApiError extends Error {}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
      cache: "no-store",
    });
  } catch {
    throw new ApiError(`Cannot reach the API at ${API_URL}. Is it running?`);
  }
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      const m = body?.message;
      message = Array.isArray(m) ? m.join("; ") : (m ?? message);
    } catch {
      // non-JSON error body
    }
    throw new ApiError(message);
  }
  // Nest sends an empty 200 body when a handler returns null (e.g. no active
  // run), which res.json() would reject.
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}
