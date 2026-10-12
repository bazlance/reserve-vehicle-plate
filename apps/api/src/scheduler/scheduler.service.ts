import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";
import { Reservation } from "@prisma/client";
import { CronJob, CronTime } from "cron";
import { PrismaService } from "../prisma/prisma.service";
import { RunnerService } from "../runner/runner.service";

export const SCHEDULE_TIMEZONE = process.env.SCHEDULE_TIMEZONE || "Asia/Bangkok";

/** Throws if the expression is not a valid cron expression. */
export function assertValidCron(expression: string): void {
  // CronTime parses on construction and throws on bad input.
  new CronTime(expression, SCHEDULE_TIMEZONE);
}

export function nextRunAt(expression: string): Date | null {
  try {
    return new CronTime(expression, SCHEDULE_TIMEZONE).sendAt().toJSDate();
  } catch {
    return null;
  }
}

/**
 * Keeps one CronJob per enabled reservation, registered under the reservation
 * id. Jobs are rebuilt from the database on boot and re-synced whenever a
 * reservation changes, so the DB is the single source of truth.
 */
@Injectable()
export class SchedulerService implements OnModuleInit {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly registry: SchedulerRegistry,
    private readonly prisma: PrismaService,
    private readonly runner: RunnerService,
  ) {}

  async onModuleInit(): Promise<void> {
    const reservations = await this.prisma.reservation.findMany({ where: { enabled: true } });
    for (const r of reservations) this.sync(r);
    this.logger.log(
      `Scheduled ${reservations.length} reservation(s) in ${SCHEDULE_TIMEZONE}`,
    );
  }

  /** (Re)registers or removes the job so it matches the reservation row. */
  sync(reservation: Reservation): void {
    this.remove(reservation.id);
    if (!reservation.enabled) return;

    const job = new CronJob(
      reservation.cronExpression,
      () => void this.fire(reservation.id),
      null,
      false,
      SCHEDULE_TIMEZONE,
    );
    this.registry.addCronJob(reservation.id, job);
    job.start();
    this.logger.log(
      `"${reservation.label}" scheduled: ${reservation.cronExpression} (next ${nextRunAt(reservation.cronExpression)?.toISOString()})`,
    );
  }

  remove(reservationId: string): void {
    if (this.registry.doesExist("cron", reservationId)) {
      this.registry.deleteCronJob(reservationId);
    }
  }

  private async fire(reservationId: string): Promise<void> {
    const reservation = await this.prisma.reservation.findUnique({ where: { id: reservationId } });
    if (!reservation || !reservation.enabled) return;

    try {
      const run = await this.runner.start(reservationId, "cron");
      this.logger.log(`Cron fired "${reservation.label}" -> run ${run.id}`);
    } catch (err) {
      this.logger.warn(
        `Cron tick for "${reservation.label}" skipped: ${err instanceof Error ? err.message : err}`,
      );
    }

    if (reservation.runOnce) {
      const updated = await this.prisma.reservation.update({
        where: { id: reservationId },
        data: { enabled: false },
      });
      this.sync(updated);
    }
  }
}
