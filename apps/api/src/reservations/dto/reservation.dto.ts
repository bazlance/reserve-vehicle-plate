import { Type } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from "class-validator";

/** Full-replace payload used for both create (POST) and update (PUT). */
export class ReservationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  label: string;

  // Vehicle body / chassis number from the registration book.
  @IsString()
  @IsNotEmpty()
  bodyNumber: string;

  // Must match a <select id="r_brand"> option value; checked against the live
  // page at run time.
  @IsString()
  @IsNotEmpty()
  brand: string;

  @Matches(/^\d{9,10}$/, { message: "tel must be a 9-10 digit phone number" })
  tel: string;

  @Matches(/^\d{2,4}$/, { message: "desiredNumber must be 2 to 4 digits" })
  desiredNumber: string;

  @Type(() => Number)
  @IsIn([1, 2, 3], { message: "carType must be 1, 2 or 3" })
  carType: number;

  @Type(() => Number)
  @IsIn([1, 2], { message: "pers must be 1 (individual) or 2 (corporate/foreign)" })
  pers: number;

  // Applicant fields: required only for pers = 2. For pers = 1 they come
  // pre-filled from the ThaID login and are ignored.
  @ValidateIf((o: ReservationDto) => o.pers === 2)
  @IsString()
  @IsNotEmpty()
  @MaxLength(13)
  applicantIdCard?: string;

  @ValidateIf((o: ReservationDto) => o.pers === 2)
  @IsString()
  @IsNotEmpty()
  applicantPrefix?: string;

  @ValidateIf((o: ReservationDto) => o.pers === 2)
  @IsString()
  @IsNotEmpty()
  applicantFname?: string;

  @IsOptional()
  @IsString()
  applicantLname?: string;

  // 5-field (or 6-field with seconds) cron expression, evaluated in
  // SCHEDULE_TIMEZONE. Validated in the service.
  @IsString()
  @IsNotEmpty()
  cronExpression: string;

  @IsBoolean()
  runOnce: boolean;

  @IsBoolean()
  enabled: boolean;
}

export class SetEnabledDto {
  @IsBoolean()
  enabled: boolean;
}
