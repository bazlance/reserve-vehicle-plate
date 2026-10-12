"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { api, Reservation, ReservationInput } from "@/lib/api";
import { defaultSchedule, fromCron, ScheduleState, toCron } from "@/lib/schedule";

// Known <select id="prefixZQ"> values on the DLT form (checked live at run time).
const PREFIXES = ["MR.", "MISS", "MRS.", "บริษัท", "ห้างหุ้นส่วนจำกัด", "บริษัทมหาชนจำกัด", "ห้างหุ้นส่วนสามัญ", "ไม่ระบุ"];

interface Props {
  existing?: Reservation;
}

export function ReservationForm({ existing }: Props) {
  const router = useRouter();
  const [label, setLabel] = useState(existing?.label ?? "");
  const [bodyNumber, setBodyNumber] = useState(existing?.bodyNumber ?? "");
  const [brand, setBrand] = useState(existing?.brand ?? "");
  const [tel, setTel] = useState(existing?.tel ?? "");
  const [desiredNumber, setDesiredNumber] = useState(existing?.desiredNumber ?? "");
  const [carType, setCarType] = useState(existing?.carType ?? 1);
  const [pers, setPers] = useState(existing?.pers ?? 1);
  const [idCard, setIdCard] = useState(existing?.applicantIdCard ?? "");
  const [prefix, setPrefix] = useState(existing?.applicantPrefix ?? PREFIXES[0]);
  const [fname, setFname] = useState(existing?.applicantFname ?? "");
  const [lname, setLname] = useState(existing?.applicantLname ?? "");
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);
  const [schedule, setSchedule] = useState<ScheduleState>(
    existing ? fromCron(existing.cronExpression, existing.runOnce) : defaultSchedule(),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const patchSchedule = (p: Partial<ScheduleState>) => setSchedule((s) => ({ ...s, ...p }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const { cronExpression, runOnce } = toCron(schedule);
      if (schedule.mode === "once" && Number.isNaN(new Date(schedule.onceAt).getTime())) {
        throw new Error("Pick a date and time for the run");
      }
      const body: ReservationInput = {
        label,
        bodyNumber,
        brand,
        tel,
        desiredNumber,
        carType,
        pers,
        cronExpression,
        runOnce,
        enabled,
        ...(pers === 2
          ? {
              applicantIdCard: idCard,
              applicantPrefix: prefix,
              applicantFname: fname,
              applicantLname: lname,
            }
          : {}),
      };
      await api(existing ? `/reservations/${existing.id}` : "/reservations", {
        method: existing ? "PUT" : "POST",
        body: JSON.stringify(body),
      });
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="stack">
      <fieldset>
        <legend>Reservation</legend>
        <label>
          Name
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Plate 4444" required maxLength={100} />
        </label>
        <div className="grid2">
          <label>
            Desired plate number
            <input value={desiredNumber} onChange={(e) => setDesiredNumber(e.target.value)} inputMode="numeric" pattern="\d{2,4}" title="2 to 4 digits" required />
            <small>2–4 digits, within the range shown for the current round.</small>
          </label>
          <label>
            Phone
            <input value={tel} onChange={(e) => setTel(e.target.value)} inputMode="numeric" pattern="\d{9,10}" title="9 or 10 digits, no dashes" required />
          </label>
        </div>
        <div className="grid2">
          <label>
            Vehicle body / chassis number
            <input value={bodyNumber} onChange={(e) => setBodyNumber(e.target.value)} required />
          </label>
          <label>
            Brand
            <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="TOYOTA" required />
            <small>Must match an option on the DLT form exactly; checked when the run starts.</small>
          </label>
        </div>
        <div className="grid2">
          <label>
            Car type
            <select value={carType} onChange={(e) => setCarType(Number(e.target.value))}>
              <option value={1}>1 – Sedan / 4-door pickup</option>
              <option value={2}>2 – Van</option>
              <option value={3}>3 – Pickup</option>
            </select>
          </label>
          <label>
            Applicant type
            <select value={pers} onChange={(e) => setPers(Number(e.target.value))}>
              <option value={1}>1 – Individual (from ThaID login)</option>
              <option value={2}>2 – Corporate / foreign</option>
            </select>
          </label>
        </div>
      </fieldset>

      {pers === 2 && (
        <fieldset>
          <legend>Applicant (corporate / foreign)</legend>
          <div className="grid2">
            <label>
              Trade registration / passport no.
              <input value={idCard} onChange={(e) => setIdCard(e.target.value)} maxLength={13} required />
            </label>
            <label>
              Title
              <select value={prefix} onChange={(e) => setPrefix(e.target.value)}>
                {PREFIXES.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid2">
            <label>
              Name / company name
              <input value={fname} onChange={(e) => setFname(e.target.value)} required />
            </label>
            <label>
              Surname <span className="muted">(optional for a company)</span>
              <input value={lname} onChange={(e) => setLname(e.target.value)} />
            </label>
          </div>
        </fieldset>
      )}

      <fieldset>
        <legend>Schedule</legend>
        <div className="radios">
          {(["once", "daily", "custom"] as const).map((m) => (
            <label key={m} className="inline">
              <input type="radio" name="mode" checked={schedule.mode === m} onChange={() => patchSchedule({ mode: m })} />
              {m === "once" ? "Once at a date & time" : m === "daily" ? "Every day at a time" : "Custom cron"}
            </label>
          ))}
        </div>
        {schedule.mode === "once" && (
          <label>
            Run at
            <input type="datetime-local" value={schedule.onceAt} onChange={(e) => patchSchedule({ onceAt: e.target.value })} required />
          </label>
        )}
        {schedule.mode === "daily" && (
          <label>
            Run at
            <input type="time" value={schedule.dailyAt} onChange={(e) => patchSchedule({ dailyAt: e.target.value })} required />
          </label>
        )}
        {schedule.mode === "custom" && (
          <>
            <label>
              Cron expression
              <input value={schedule.custom} onChange={(e) => patchSchedule({ custom: e.target.value })} placeholder="30 7 * * 1-5" required />
            </label>
            <label className="inline">
              <input type="checkbox" checked={schedule.customRunOnce} onChange={(e) => patchSchedule({ customRunOnce: e.target.checked })} />
              Disable after the first run
            </label>
          </>
        )}
        <small>
          The run starts a browser on the machine hosting the API, and you must scan the ThaID QR code
          (shown on the run page). Be at your phone when it fires. Times use the API server&apos;s timezone.
        </small>
        <label className="inline">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Schedule enabled
        </label>
      </fieldset>

      {error && <p className="error" role="alert">{error}</p>}
      <div className="row">
        <button type="submit" className="primary" disabled={saving}>
          {saving ? "Saving…" : existing ? "Save changes" : "Create reservation"}
        </button>
        <button type="button" onClick={() => router.push("/")}>Cancel</button>
      </div>
    </form>
  );
}
