import * as dotenv from "dotenv";

dotenv.config();

export interface Config {
  bodyNumber: string;
  brand: string;
  tel: string;
  desiredNumber: string;
  carType: "1" | "2" | "3";
  pers: "1" | "2";
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

  if (!/^\d{4}$/.test(desiredNumber)) {
    throw new Error(`DLT_DESIRED_NUMBER must be exactly 4 digits, got "${desiredNumber}"`);
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

  return {
    bodyNumber,
    brand,
    tel,
    desiredNumber,
    carType: carType as Config["carType"],
    pers: pers as Config["pers"],
  };
}
