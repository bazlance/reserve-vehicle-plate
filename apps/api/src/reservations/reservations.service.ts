import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Reservation } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { assertValidCron, nextRunAt } from "../scheduler/scheduler.service";
import { SchedulerService } from "../scheduler/scheduler.service";
import { ReservationDto } from "./dto/reservation.dto";

function toData(dto: ReservationDto) {
  assertCron(dto.cronExpression);
  const corporate = dto.pers === 2;
  return {
    label: dto.label.trim(),
    bodyNumber: dto.bodyNumber.trim(),
    brand: dto.brand.trim(),
    tel: dto.tel,
    desiredNumber: dto.desiredNumber,
    carType: dto.carType,
    pers: dto.pers,
    // pers = 1 comes from the ThaID login; don't keep stale applicant data.
    applicantIdCard: corporate ? dto.applicantIdCard?.trim() : null,
    applicantPrefix: corporate ? dto.applicantPrefix?.trim() : null,
    applicantFname: corporate ? dto.applicantFname?.trim() : null,
    applicantLname: corporate ? (dto.applicantLname?.trim() ?? "") : null,
    cronExpression: dto.cronExpression.trim(),
    runOnce: dto.runOnce,
    enabled: dto.enabled,
  };
}

function assertCron(expression: string): void {
  try {
    assertValidCron(expression.trim());
  } catch {
    throw new BadRequestException(`Invalid cron expression: "${expression}"`);
  }
}

function withNextRun(r: Reservation) {
  return { ...r, nextRunAt: r.enabled ? nextRunAt(r.cronExpression) : null };
}

@Injectable()
export class ReservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduler: SchedulerService,
  ) {}

  async list() {
    const rows = await this.prisma.reservation.findMany({
      orderBy: { createdAt: "desc" },
      include: { runs: { orderBy: { startedAt: "desc" }, take: 1 } },
    });
    return rows.map(({ runs, ...r }) => ({ ...withNextRun(r), lastRun: runs[0] ?? null }));
  }

  async get(id: string) {
    const r = await this.prisma.reservation.findUnique({ where: { id } });
    if (!r) throw new NotFoundException("Reservation not found");
    return withNextRun(r);
  }

  async create(dto: ReservationDto) {
    const r = await this.prisma.reservation.create({ data: toData(dto) });
    this.scheduler.sync(r);
    return withNextRun(r);
  }

  async update(id: string, dto: ReservationDto) {
    await this.get(id);
    const r = await this.prisma.reservation.update({ where: { id }, data: toData(dto) });
    this.scheduler.sync(r);
    return withNextRun(r);
  }

  async setEnabled(id: string, enabled: boolean) {
    await this.get(id);
    const r = await this.prisma.reservation.update({ where: { id }, data: { enabled } });
    this.scheduler.sync(r);
    return withNextRun(r);
  }

  async remove(id: string) {
    await this.get(id);
    this.scheduler.remove(id);
    await this.prisma.reservation.delete({ where: { id } });
  }

  runs(reservationId: string) {
    return this.prisma.run.findMany({
      where: { reservationId },
      orderBy: { startedAt: "desc" },
      take: 50,
    });
  }
}
