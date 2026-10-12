# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A monorepo that reserves a vehicle license plate on the Thai DLT portal
(`https://reserve.dlt.go.th/reserve/v2/?menu=resv_m`) for personal
reservations. It has two apps:

- **`apps/api`** — NestJS + Prisma + PostgreSQL. Stores reservation configs,
  schedules them with cron, and runs the Playwright automation (ThaID QR login,
  then the reservation form driven through the browser UI).
- **`apps/web`** — Next.js control panel. Collects what used to live in `.env`,
  sets the schedule, and shows a live run (status, QR code to scan, logs, result).

## Commands

```bash
npm install                      # install all workspaces
npm run install-browsers         # one-time Chromium download for Playwright
cp apps/api/.env.example apps/api/.env   # then set DATABASE_URL
npm run db:migrate               # prisma migrate dev (creates tables)
npm run dev:api                  # NestJS on http://127.0.0.1:3001
npm run dev:web                  # Next.js on http://127.0.0.1:3000
npm run build                    # builds both (typecheck is the only verification)
```

There are no automated tests or lint config. `npm run build` is the only
verification step (strict TypeScript in both apps).

A run opens a **headed** (visible) Chromium window on the machine hosting the
API, needs the user to scan a ThaID QR code (streamed to the run page as
screenshots, also visible in the browser window), and submits a **real
reservation request** against the live government site using the saved personal
data. Do not trigger runs speculatively — they have real-world side effects.
The API must run on a machine with a display.

## Architecture (apps/api/src)

- **`prisma/`** (+ `apps/api/prisma/schema.prisma`) — `Reservation` (vehicle
  details, applicant fields for `pers=2`, `cronExpression`, `runOnce`,
  `enabled`) and `Run` (status, attempts, HTTP status, page text, captured
  dialog messages, screenshot path, error). The DB is the source of truth.
- **`reservations/`** — CRUD. DTO validation mirrors the old `.env` rules
  (plate 2–4 digits, phone 9–10 digits, `carType` 1–3, `pers` 1–2; applicant
  fields required only when `pers=2`, ID ≤ 13 chars). Cron expressions are
  validated on save. PUT is a full replace.
- **`scheduler/`** — `SchedulerService` keeps one `CronJob` per enabled
  reservation (registered by reservation id in `SchedulerRegistry`), rebuilt
  from the DB on boot and re-synced on every change. Timezone is
  `SCHEDULE_TIMEZONE` (default `Asia/Bangkok`). `runOnce` reservations disable
  themselves after firing. A tick while another run is active is skipped.
- **`runner/`** — `RunnerService` runs **one run at a time** (single QR login,
  single headed browser). `login.ts` and `reserve.ts` are the original
  automation, now taking `hooks` (log / status / QR) instead of `console.log`.
  `RunEventsService` fans progress out to SSE subscribers with a snapshot for
  late joiners.
- **`runs/`** — `GET /runs/:id/events` (SSE: `snapshot|status|qr|log|result`),
  `POST /runs/:id/stop`, `GET /runs/:id/screenshot`, `GET /runs/current`.

### Automation decisions that must be preserved

- **UI automation, not raw HTTP.** The site has three anti-bot layers (F5
  BIG-IP ASM fingerprinting, invisible reCAPTCHA v2, and `behavior-detection.js`
  which signs keystroke/mouse timing). Those tokens only come from real
  interaction, so clicks/typing go through the browser. Typing is per-keystroke
  randomized (`typeHumanLike`), not `page.fill()`.
- **The `dialog` handler must be registered before any navigation/click.** The
  form pops a native `confirm()` before submitting; Playwright cancels dialogs
  with no listener, which silently aborted reservations. The handler accepts
  and now **records every dialog message** into `Run.dialogMessages`.
- **Retry on HTTP 302/500** (Imperva WAF block, no verdict) with a fresh login;
  a 200 is a real answer (even a rejection) and is never retried. `MAX_ATTEMPTS`
  (default 0 = unlimited) caps retries; the Stop button cancels.
- The `confirm` round id is scraped from `#f_rule`'s `action` — it rotates, never
  hardcode it. `pers=1` fields are pre-filled read-only from ThaID and must not
  be touched; `pers=2` fields are filled and the title/brand are validated
  against the live option lists.
- After a run the browser is left open for 10 minutes (or until Stop / next
  run) so the result can be inspected; this replaced the old "press Enter" prompt.

## Known unresolved area

Success/failure detection after submit is still not confirmed reliable. HTTP 200
does not mean approved. The UI shows the captured dialog messages, page text and
a screenshot so a human can read the real verdict; if a post-submit dialog turns
out to be the definitive signal, parse it in `runner.service.ts` and set a
distinct status instead of always `DONE`.

## Sensitive data

- `apps/api/.env` holds the DB connection string. The database itself holds
  personal data (ID/plate/phone). The API binds to `127.0.0.1` only and has no
  authentication — never expose it on a network.
- `*.har` (network captures; `apps/api/debug/` gets one per run), and
  `apps/api/screenshots/` may contain personal data — all gitignored.
- A legacy root `.env` from the old CLI may still exist locally; it is no longer
  read. Its values are meant to be re-entered in the web UI.
