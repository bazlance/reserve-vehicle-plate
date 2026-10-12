import { Module } from "@nestjs/common";
import { RunnerModule } from "../runner/runner.module";
import { RunsController } from "./runs.controller";

@Module({
  imports: [RunnerModule],
  controllers: [RunsController],
})
export class RunsModule {}
