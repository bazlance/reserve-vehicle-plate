import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { RunnerModule } from "../runner/runner.module";
import { SchedulerService } from "./scheduler.service";

@Module({
  imports: [ScheduleModule.forRoot(), RunnerModule],
  providers: [SchedulerService],
  exports: [SchedulerService],
})
export class SchedulerModule {}
