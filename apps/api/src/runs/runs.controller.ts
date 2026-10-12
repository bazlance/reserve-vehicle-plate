import {
  Controller,
  Get,
  HttpCode,
  MessageEvent,
  NotFoundException,
  Param,
  Post,
  Res,
  Sse,
} from "@nestjs/common";
import type { Response } from "express";
import * as fs from "fs";
import { Observable, concat, map, of } from "rxjs";
import { PrismaService } from "../prisma/prisma.service";
import { RunEventsService, RunSnapshot } from "../runner/run-events.service";
import { RunnerService } from "../runner/runner.service";
import { RunStatusName } from "../runner/types";

@Controller("runs")
export class RunsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: RunEventsService,
    private readonly runner: RunnerService,
  ) {}

  @Get("current")
  async current() {
    // The newest run that hasn't finished, if any (for the dashboard banner).
    return this.prisma.run.findFirst({
      where: { finishedAt: null },
      orderBy: { startedAt: "desc" },
    });
  }

  @Get(":id")
  async get(@Param("id") id: string) {
    const run = await this.prisma.run.findUnique({
      where: { id },
      include: { reservation: { select: { id: true, label: true } } },
    });
    if (!run) throw new NotFoundException("Run not found");
    return run;
  }

  /** Server-sent events: snapshot first, then live status/qr/log/result. */
  @Sse(":id/events")
  async stream(@Param("id") id: string): Promise<Observable<MessageEvent>> {
    const live = this.events.stream(id);
    if (live) {
      return live.pipe(map((e) => ({ type: e.type, data: e.data })));
    }

    // Not in memory (e.g. API restarted since the run) — rebuild from the DB.
    const run = await this.prisma.run.findUnique({ where: { id } });
    if (!run) throw new NotFoundException("Run not found");
    const snapshot: RunSnapshot = {
      runId: run.id,
      status: run.status as RunStatusName,
      attempts: run.attempts,
      logs: [],
      result: run.finishedAt
        ? {
            submitStatus: run.submitStatus ?? undefined,
            confirmId: run.confirmId ?? undefined,
            pageTitle: run.pageTitle ?? undefined,
            bodyText: run.bodyText ?? undefined,
            dialogMessages: run.dialogMessages,
            error: run.error ?? undefined,
          }
        : undefined,
    };
    return concat(of<MessageEvent>({ type: "snapshot", data: snapshot }));
  }

  /** Stops an active run or closes the browser left open after a finished one. */
  @Post(":id/stop")
  @HttpCode(204)
  async stop(@Param("id") id: string) {
    await this.runner.stop(id);
  }

  @Get(":id/screenshot")
  async screenshot(@Param("id") id: string, @Res() res: Response) {
    const run = await this.prisma.run.findUnique({ where: { id } });
    if (!run?.screenshotPath || !fs.existsSync(run.screenshotPath)) {
      throw new NotFoundException("No screenshot for this run");
    }
    res.sendFile(run.screenshotPath);
  }
}
