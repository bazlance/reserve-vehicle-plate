import { Module } from "@nestjs/common";
import { RunnerModule } from "../runner/runner.module";
import { SchedulerModule } from "../scheduler/scheduler.module";
import { ReservationsController } from "./reservations.controller";
import { ReservationsService } from "./reservations.service";

@Module({
  imports: [SchedulerModule, RunnerModule],
  controllers: [ReservationsController],
  providers: [ReservationsService],
})
export class ReservationsModule {}
