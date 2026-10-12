export type ScheduleMode = "once" | "daily" | "custom";

export interface ScheduleState {
  mode: ScheduleMode;
  onceAt: string; // datetime-local value: YYYY-MM-DDTHH:mm
  dailyAt: string; // HH:mm
  custom: string;
  customRunOnce: boolean;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function defaultSchedule(): ScheduleState {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  return {
    mode: "once",
    onceAt: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`,
    dailyAt: "07:30",
    custom: "30 7 * * *",
    customRunOnce: false,
  };
}

/** Turns the friendly schedule inputs into a cron expression + runOnce flag. */
export function toCron(s: ScheduleState): { cronExpression: string; runOnce: boolean } {
  if (s.mode === "daily") {
    const [h, m] = s.dailyAt.split(":").map(Number);
    return { cronExpression: `${m} ${h} * * *`, runOnce: false };
  }
  if (s.mode === "once") {
    const d = new Date(s.onceAt);
    return {
      cronExpression: `${d.getMinutes()} ${d.getHours()} ${d.getDate()} ${d.getMonth() + 1} *`,
      runOnce: true,
    };
  }
  return { cronExpression: s.custom.trim(), runOnce: s.customRunOnce };
}

/** Best-effort inverse of toCron for editing an existing reservation. */
export function fromCron(cron: string, runOnce: boolean): ScheduleState {
  const base = defaultSchedule();
  const daily = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(cron);
  if (daily && !runOnce) {
    return { ...base, mode: "daily", dailyAt: `${pad(+daily[2])}:${pad(+daily[1])}` };
  }
  const once = /^(\d{1,2}) (\d{1,2}) (\d{1,2}) (\d{1,2}) \*$/.exec(cron);
  if (once && runOnce) {
    const year = new Date().getFullYear();
    return {
      ...base,
      mode: "once",
      onceAt: `${year}-${pad(+once[4])}-${pad(+once[3])}T${pad(+once[2])}:${pad(+once[1])}`,
    };
  }
  return { ...base, mode: "custom", custom: cron, customRunOnce: runOnce };
}
