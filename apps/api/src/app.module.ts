import { Module } from "@nestjs/common";
import { PrismaModule } from "./prisma/prisma.module";
import { ReservationsModule } from "./reservations/reservations.module";
import { RunsModule } from "./runs/runs.module";
import { SchedulerModule } from "./scheduler/scheduler.module";

@Module({
  imports: [PrismaModule, SchedulerModule, ReservationsModule, RunsModule],
})
export class AppModule {}
