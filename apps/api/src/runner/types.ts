export type RunStatusName =
  | "STARTING"
  | "WAITING_QR"
  | "LOGGED_IN"
  | "FILLING"
  | "SUBMITTING"
  | "RETRYING"
  | "DONE"
  | "FAILED"
  | "STOPPED";

export interface Applicant {
  idCard: string;
  prefix: string;
  fname: string;
  lname: string;
}

export interface RunConfig {
  bodyNumber: string;
  brand: string;
  tel: string;
  desiredNumber: string;
  carType: "1" | "2" | "3";
  pers: "1" | "2";
  // Only present (and only filled on the form) when pers === "2". For
  // pers === "1" these fields are pre-filled read-only from the ThaID login.
  applicant?: Applicant;
}

export interface RunHooks {
  log(message: string): void;
  onStatus(status: RunStatusName): void;
}

export interface ReservationResult {
  confirmId: string;
  screenshotPath: string;
  pageTitle: string;
  bodyText: string;
  submitStatus: number;
}
