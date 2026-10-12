import { Injectable } from "@nestjs/common";
import { Observable, Subject } from "rxjs";
import { RunStatusName } from "./types";

export interface RunSnapshot {
  runId: string;
  status: RunStatusName;
  attempts: number;
  qr?: string; // latest QR-page screenshot, PNG base64
  logs: string[];
  result?: {
    submitStatus?: number;
    confirmId?: string;
    pageTitle?: string;
    bodyText?: string;
    dialogMessages: string[];
    error?: string;
  };
}

export type RunEvent =
  | { type: "snapshot"; data: RunSnapshot }
  | { type: "status"; data: { status: RunStatusName; attempts: number } }
  | { type: "qr"; data: { png: string } }
  | { type: "log"; data: { line: string } }
  | { type: "result"; data: NonNullable<RunSnapshot["result"]> };

const MAX_LOG_LINES = 300;

interface Channel {
  subject: Subject<RunEvent>;
  snapshot: RunSnapshot;
}

/**
 * In-memory fan-out of a run's progress to SSE subscribers. The snapshot lets
 * a client that connects mid-run (or after it finished) catch up instead of
 * only seeing future events. Durable state lives in the Run table; this is
 * just the live view.
 */
@Injectable()
export class RunEventsService {
  private readonly channels = new Map<string, Channel>();

  open(runId: string): void {
    this.channels.set(runId, {
      subject: new Subject<RunEvent>(),
      snapshot: { runId, status: "STARTING", attempts: 0, logs: [] },
    });
  }

  has(runId: string): boolean {
    return this.channels.has(runId);
  }

  status(runId: string, status: RunStatusName, attempts?: number): void {
    const ch = this.channels.get(runId);
    if (!ch) return;
    ch.snapshot.status = status;
    if (attempts !== undefined) ch.snapshot.attempts = attempts;
    // The QR is only useful while waiting for the scan.
    if (status !== "WAITING_QR") ch.snapshot.qr = undefined;
    ch.subject.next({
      type: "status",
      data: { status, attempts: ch.snapshot.attempts },
    });
  }

  qr(runId: string, png: string): void {
    const ch = this.channels.get(runId);
    if (!ch) return;
    ch.snapshot.qr = png;
    ch.subject.next({ type: "qr", data: { png } });
  }

  log(runId: string, line: string): void {
    const ch = this.channels.get(runId);
    if (!ch) return;
    const stamped = `${new Date().toLocaleTimeString("en-GB")}  ${line}`;
    ch.snapshot.logs.push(stamped);
    if (ch.snapshot.logs.length > MAX_LOG_LINES) ch.snapshot.logs.shift();
    ch.subject.next({ type: "log", data: { line: stamped } });
  }

  result(runId: string, result: NonNullable<RunSnapshot["result"]>): void {
    const ch = this.channels.get(runId);
    if (!ch) return;
    ch.snapshot.result = result;
    ch.subject.next({ type: "result", data: result });
  }

  stream(runId: string): Observable<RunEvent> | undefined {
    const ch = this.channels.get(runId);
    if (!ch) return undefined;
    return new Observable<RunEvent>((subscriber) => {
      subscriber.next({ type: "snapshot", data: { ...ch.snapshot } });
      const sub = ch.subject.subscribe(subscriber);
      return () => sub.unsubscribe();
    });
  }
}
