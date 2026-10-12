import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Patch,
} from "@nestjs/common";
import { RunnerService } from "../runner/runner.service";
import { ReservationDto, SetEnabledDto } from "./dto/reservation.dto";
import { ReservationsService } from "./reservations.service";

@Controller("reservations")
export class ReservationsController {
  constructor(
    private readonly reservations: ReservationsService,
    private readonly runner: RunnerService,
  ) {}

  @Get()
  list() {
    return this.reservations.list();
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.reservations.get(id);
  }

  @Post()
  create(@Body() dto: ReservationDto) {
    return this.reservations.create(dto);
  }

  @Put(":id")
  update(@Param("id") id: string, @Body() dto: ReservationDto) {
    return this.reservations.update(id, dto);
  }

  @Patch(":id/enabled")
  setEnabled(@Param("id") id: string, @Body() dto: SetEnabledDto) {
    return this.reservations.setEnabled(id, dto.enabled);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(@Param("id") id: string) {
    return this.reservations.remove(id);
  }

  @Get(":id/runs")
  runs(@Param("id") id: string) {
    return this.reservations.runs(id);
  }

  /** Manual "run now" — same code path as the cron trigger. */
  @Post(":id/run")
  runNow(@Param("id") id: string) {
    return this.runner.start(id, "manual");
  }
}
