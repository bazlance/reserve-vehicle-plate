import { Module } from "@nestjs/common";
import { RunEventsService } from "./run-events.service";
import { RunnerService } from "./runner.service";

@Module({
  providers: [RunnerService, RunEventsService],
  exports: [RunnerService, RunEventsService],
})
export class RunnerModule {}
