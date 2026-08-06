import * as dotenv from "dotenv";

dotenv.config();

export interface Applicant {
  idCard: string;
  prefix: string;
  fname: string;
  lname: string;
}

export interface Config {
  bodyNumber: string;
  brand: string;
  tel: string;
  desiredNumber: string;
  carType: "1" | "2" | "3";
  pers: "1" | "2";
  // Only present (and only filled on the form) when pers === "2". For
  // pers === "1" these fields are pre-filled read-only from the ThaID
  // login instead.
  applicant?: Applicant;
  // "HH:MM" 24-hour local time. If set, the app waits until this time
  // (today) before starting the QR login, rather than starting immediately.
  // If unset, or if the time has already passed today, it starts right away.
  startTime?: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name} (see .env.example)`);
  }
  return value.trim();
}

export function loadConfig(): Config {
  const bodyNumber = required("DLT_R_BODYNUMBER");
  const brand = required("DLT_R_BRAND");
  const tel = required("DLT_R_TEL");
  const desiredNumber = required("DLT_DESIRED_NUMBER");
  const carType = required("DLT_CAR_TYPE");
  const pers = required("DLT_PERS");

  if (!/^\d{2,4}$/.test(desiredNumber)) {
    throw new Error(`DLT_DESIRED_NUMBER must be 2 to 4 digits, got "${desiredNumber}"`);
  }
  if (!/^\d{9,10}$/.test(tel)) {
    throw new Error(`DLT_R_TEL must be a 9-10 digit phone number, got "${tel}"`);
  }
  if (!["1", "2", "3"].includes(carType)) {
    throw new Error(`DLT_CAR_TYPE must be 1, 2, or 3, got "${carType}"`);
  }
  if (!["1", "2"].includes(pers)) {
    throw new Error(`DLT_PERS must be 1 or 2, got "${pers}"`);
  }

  const startTime = process.env.DLT_START_TIME?.trim();
  if (startTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) {
    throw new Error(`DLT_START_TIME must be in 24-hour "HH:MM" format, got "${startTime}"`);
  }

  let applicant: Applicant | undefined;
  if (pers === "2") {
    const idCard = required("DLT_APPLICANT_ID");
    if (idCard.length > 13) {
      throw new Error(`DLT_APPLICANT_ID must be at most 13 characters, got "${idCard}"`);
    }
    applicant = {
      idCard,
      prefix: required("DLT_APPLICANT_PREFIX"),
      fname: required("DLT_APPLICANT_FNAME"),
      lname: (process.env.DLT_APPLICANT_LNAME ?? "").trim(),
    };
  }

  return {
    bodyNumber,
    brand,
    tel,
    desiredNumber,
    carType: carType as Config["carType"],
    pers: pers as Config["pers"],
    applicant,
    startTime: startTime || undefined,
  };
}
