import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import { Reservation, Run } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";
import { Browser, BrowserContext, chromium } from "playwright";
import { PrismaService } from "../prisma/prisma.service";
import { login } from "./login";
import { runReservation } from "./reserve";
import { RunEventsService } from "./run-events.service";
import { ReservationResult, RunConfig, RunHooks, RunStatusName } from "./types";

const SCREENSHOT_DIR = path.resolve(process.cwd(), "screenshots");
const DEBUG_DIR = path.resolve(process.cwd(), "debug");
// After a run ends the browser is left open so the result can be inspected
// (replaces the old "press Enter to close" prompt). It closes on Stop, on the
// next run, or after this long.
const LINGER_MS = 10 * 60 * 1000;

interface ActiveRun {
  runId: string;
  stopRequested: boolean;
  close: () => Promise<void>;
}

function toRunConfig(r: Reservation): RunConfig {
  return {
    bodyNumber: r.bodyNumber,
    brand: r.brand,
    tel: r.tel,
    desiredNumber: r.desiredNumber,
    carType: String(r.carType) as RunConfig["carType"],
    pers: String(r.pers) as RunConfig["pers"],
    applicant:
      r.pers === 2
        ? {
            idCard: r.applicantIdCard ?? "",
            prefix: r.applicantPrefix ?? "",
            fname: r.applicantFname ?? "",
            lname: r.applicantLname ?? "",
          }
        : undefined,
  };
}

@Injectable()
export class RunnerService implements OnModuleInit {
  private readonly logger = new Logger(RunnerService.name);
  private active?: ActiveRun;
  private readonly lingering = new Map<string, { close: () => Promise<void>; timer: NodeJS.Timeout }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: RunEventsService,
  ) {}

  /**
   * A run can only be in progress while this process is alive. Any row still
   * unfinished at boot belongs to an API that died mid-run (crash, restart,
   * watch reload); leaving it open would also block the dashboard's Run now.
   */
  async onModuleInit(): Promise<void> {
    const { count } = await this.prisma.run.updateMany({
      where: { finishedAt: null },
      data: {
        status: "FAILED",
        error: "API stopped or restarted while this run was in progress",
        finishedAt: new Date(),
      },
    });
    if (count > 0) this.logger.warn(`Marked ${count} interrupted run(s) as failed`);
  }

  isBusy(): boolean {
    return this.active !== undefined;
  }

  /** Starts a run in the background and returns the created Run row. */
  async start(reservationId: string, trigger: "cron" | "manual"): Promise<Run> {
    // Only one run at a time: there is a single ThaID QR login and a single
    // headed browser. Claim the slot synchronously so two triggers racing
    // can't both pass the check.
    if (this.active) {
      throw new ConflictException("Another run is already in progress");
    }
    const slot: ActiveRun = { runId: "", stopRequested: false, close: async () => {} };
    this.active = slot;

    try {
      const reservation = await this.prisma.reservation.findUnique({
        where: { id: reservationId },
      });
      if (!reservation) throw new NotFoundException("Reservation not found");

      const run = await this.prisma.run.create({
        data: { reservationId, trigger, status: "STARTING" },
      });
      slot.runId = run.id;
      this.events.open(run.id);

      await this.closeAllLingering();
      void this.execute(run.id, toRunConfig(reservation), slot).finally(() => {
        this.active = undefined;
      });
      return run;
    } catch (err) {
      this.active = undefined;
      throw err;
    }
  }

  /** Stops the active run, or closes the lingering browser of a finished one. */
  async stop(runId: string): Promise<void> {
    if (this.active?.runId === runId) {
      this.active.stopRequested = true;
      // Closing the browser makes whatever Playwright call is pending reject;
      // execute() sees stopRequested and records STOPPED rather than FAILED.
      await this.active.close();
      return;
    }
    const l = this.lingering.get(runId);
    if (l) {
      clearTimeout(l.timer);
      this.lingering.delete(runId);
      await l.close();
      return;
    }
    // Nothing left to close (already stopped, timed out, or the API restarted
    // since). That's the state the caller wanted, so only a bad id is an error.
    const exists = await this.prisma.run.findUnique({
      where: { id: runId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException("Run not found");
  }

  private async closeAllLingering(): Promise<void> {
    for (const [id, l] of this.lingering) {
      clearTimeout(l.timer);
      this.lingering.delete(id);
      await l.close();
    }
  }

  private async execute(runId: string, config: RunConfig, slot: ActiveRun): Promise<void> {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    fs.mkdirSync(DEBUG_DIR, { recursive: true });

    const maxAttempts = Number(process.env.MAX_ATTEMPTS ?? 0);
    const dialogMessages: string[] = [];
    let attempts = 0;
    let browser: Browser | undefined;
    let context: BrowserContext | undefined;

    const setStatus = (status: RunStatusName) => {
      this.events.status(runId, status, attempts);
      void this.prisma.run
        .update({ where: { id: runId }, data: { status, attempts } })
        .catch((e) => this.logger.warn(`run status update failed: ${e.message}`));
    };
    const log = (line: string) => {
      this.logger.log(`[${runId.slice(0, 8)}] ${line}`);
      this.events.log(runId, line);
    };
    const hooks: RunHooks & { onQr(png: string): void } = {
      log,
      onStatus: setStatus,
      onQr: (png) => this.events.qr(runId, png),
    };

    const closeBrowser = async () => {
      await context?.close().catch(() => {});
      await browser?.close().catch(() => {});
    };
    slot.close = closeBrowser;

    try {
      browser = await chromium.launch({ headless: false });
      // Record the full network trace so a failure can be diagnosed from the
      // actual requests/responses instead of guessing. HAR content is flushed
      // to disk on context close.
      const harPath = path.join(DEBUG_DIR, `run-${runId}.har`);
      context = await browser.newContext({ recordHar: { path: harPath, content: "embed" } });
      const page = await context.newPage();
      // Stop may have been pressed while Chromium was still launching, when
      // there was nothing to close yet.
      if (slot.stopRequested) throw new Error("Stopped by user");

      // The reservation form pops a native confirm() dialog before actually
      // submitting. Playwright auto-dismisses (cancels) any dialog with no
      // listener attached, which silently aborted the reservation. Accept it,
      // and keep the message — it is likely the real success/failure signal.
      page.on("dialog", async (dialog) => {
        const message = `(${dialog.type()}) ${dialog.message()}`;
        dialogMessages.push(message);
        log(`Dialog ${message}`);
        // Throws if the page closed mid-dialog (e.g. Stop); an unhandled
        // rejection here would otherwise take the whole API down.
        await dialog.accept().catch(() => {});
      });

      // A 302 or 500 on the submit means no usable verdict came back (see
      // reserve.ts) — retry from a fresh ?menu=resv_m visit rather than
      // stopping. A 200 (even a rejection like a brand/chassis mismatch) is a
      // real answer and must not be retried.
      let result: ReservationResult;
      while (true) {
        attempts++;
        if (attempts > 1) {
          log(`Attempt ${attempts}: starting over from the entry URL...`);
          setStatus("RETRYING");
        }
        await login(page, hooks);
        result = await runReservation(page, config, SCREENSHOT_DIR, hooks);

        if (result.submitStatus === 302 || result.submitStatus === 500) {
          log(`Attempt ${attempts} got HTTP ${result.submitStatus} — no usable verdict.`);
          if (maxAttempts > 0 && attempts >= maxAttempts) {
            throw new Error(
              `Gave up after ${attempts} attempts (last HTTP ${result.submitStatus})`,
            );
          }
          continue;
        }
        break;
      }

      log(`Got a real response from DLT (HTTP ${result.submitStatus}). Check the result text below.`);
      this.events.result(runId, {
        submitStatus: result.submitStatus,
        confirmId: result.confirmId,
        pageTitle: result.pageTitle,
        bodyText: result.bodyText,
        dialogMessages,
      });
      await this.prisma.run.update({
        where: { id: runId },
        data: {
          status: "DONE",
          attempts,
          confirmId: result.confirmId,
          submitStatus: result.submitStatus,
          pageTitle: result.pageTitle,
          bodyText: result.bodyText,
          dialogMessages,
          screenshotPath: result.screenshotPath,
          finishedAt: new Date(),
        },
      });
      this.events.status(runId, "DONE", attempts);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const stopped = slot.stopRequested;
      log(stopped ? "Stopped by user." : `Reservation flow failed: ${message}`);

      // A thrown error (e.g. a wait timing out) doesn't mean the page didn't
      // actually get where it was going — Chromium keeps navigating in the
      // background regardless of our Node code's timeouts. Capture the page's
      // current state so a timeout that masks a real outcome isn't mistaken
      // for a hard crash.
      let screenshotPath: string | undefined;
      let pageTitle: string | undefined;
      let bodyText: string | undefined;
      if (!stopped) {
        const page = context?.pages()[0];
        if (page) {
          const p = path.join(SCREENSHOT_DIR, `failure-${runId}.png`);
          await page.screenshot({ path: p, fullPage: true }).then(() => (screenshotPath = p)).catch(() => {});
          pageTitle = await page.title().catch(() => undefined);
          bodyText = await page.locator("body").innerText().then((t) => t.slice(0, 1000)).catch(() => undefined);
        }
      }
      const status: RunStatusName = stopped ? "STOPPED" : "FAILED";
      this.events.result(runId, {
        pageTitle,
        bodyText,
        dialogMessages,
        error: stopped ? "Stopped by user" : message,
      });
      await this.prisma.run
        .update({
          where: { id: runId },
          data: {
            status,
            attempts,
            error: stopped ? "Stopped by user" : message,
            pageTitle,
            bodyText,
            dialogMessages,
            screenshotPath,
            finishedAt: new Date(),
          },
        })
        .catch((e) => this.logger.warn(`final run update failed: ${e.message}`));
      this.events.status(runId, status, attempts);
    }

    if (slot.stopRequested) {
      await closeBrowser();
      return;
    }
    // Leave the browser open for inspection, but free the run slot.
    const timer = setTimeout(() => {
      this.lingering.delete(runId);
      void closeBrowser();
    }, LINGER_MS);
    this.lingering.set(runId, { close: closeBrowser, timer });
  }
}
