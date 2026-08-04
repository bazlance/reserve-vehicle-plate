# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Playwright/TypeScript automation for reserving a vehicle license plate on
the Thai DLT portal (`https://reserve.dlt.go.th/reserve/v2/?menu=resv_m`), for
a single personal reservation. It logs in via ThaID QR OAuth, then drives the
reservation form through the browser UI.

## Commands

```bash
npm install                  # install deps
npx playwright install chromium   # one-time browser binary download
npm run build                 # tsc typecheck/compile to dist/
npm start                     # ts-node src/index.ts — runs the full flow live
```

There are no automated tests or lint config in this repo. `npm run build` is
the only verification step (TypeScript strict mode compile).

Running `npm start` opens a **headed** (visible) browser window, requires the
user to scan a QR code with the ThaID mobile app, and submits a real
reservation request against the live government site using the personal data
in `.env`. Do not run it speculatively — it has real-world side effects.

## Architecture

Four files in `src/`, run in sequence by `src/index.ts`:

1. **`config.ts`** — loads and validates `.env` into a typed `Config`
   (vehicle body/chassis number, brand, phone, desired plate number (2-4 digits),
   car type, applicant type). Fails fast on missing/malformed values; no
   defaults for personal-data fields. When `DLT_PERS=2`, also requires and
   loads `config.applicant` (trade-registration/passport number, title,
   name, surname) — unset/unused when `DLT_PERS=1`, since those fields come
   from the ThaID login on the site instead. Copy `.env.example` to `.env`
   to run.

2. **`login.ts`** — navigates to the DLT entry URL, which redirects through
   ThaID OAuth2 (`imauth.bora.dopa.go.th`) to a QR code page. The QR-scan
   polling is handled entirely by that site's own JS; this code just waits
   (`page.waitForSelector('#f_rule', ...)`, 5 min timeout) for the
   authenticated DLT home page to appear — that selector only exists once
   logged in, which is more reliable than matching on URL across redirects.

3. **`reserve.ts`** — `runReservation(page, config, screenshotDir)` drives the
   rest of the flow as real UI interactions (clicks/fills), not raw HTTP
   requests. This is a deliberate architectural choice, not a shortcut: the
   site is protected by three anti-bot layers (F5 BIG-IP ASM device
   fingerprinting, invisible Google reCAPTCHA v2, and a custom
   `behavior-detection.js` that signs real keystroke/mouse timing into a
   `behavior_data` payload). None of these tokens can be legitimately
   produced by hand-crafting requests — only by actually running the page's
   JS against real interaction. The flow:
   - Scrapes the `confirm` round id out of the `#f_rule` form's `action`
     attribute (it rotates between reservation rounds — never hardcode it).
   - Clicks through: accept rules → car type (`car_type=1/2/3`) → applicant
     type (`pers=1/2`) — each is a plain `window.location` nav triggered by a
     button click.
   - On the reservation form, validates `config.brand` against the live
     `#r_brand` option list (fails fast rather than silently submitting an
     invalid brand), then types into fields with `page.type(..., { delay })`
     (not `page.fill()`) so per-keystroke timing is realistic — the fields
     have `onKeyPress`/`onKeyUp` handlers the behavior-detection script relies
     on.
   - `r_idcard`/`prefixZQ`/`r_fname`/`r_lname` behave differently depending
     on `pers`: for `pers=1` (individual) they're pre-filled read-only
     from the ThaID login and must not be touched; for `pers=2`
     (corporate/foreign) they're empty and required instead (the applicant
     may not be the logged-in individual — e.g. a company or a foreigner's
     passport). `reserve.ts` branches on `config.pers` and only fills/selects
     them for `pers=2`, validating `prefixZQ` against the live option list
     the same way as `r_brand`.
   - Clicks `#s_resz` to submit.

4. **`index.ts`** — entrypoint. Launches headed Chromium, and — important —
   registers `page.on("dialog", ...)` to **accept** native dialogs before
   anything else happens. The reservation form pops a native `confirm()`
   dialog before it actually submits; Playwright's default behavior with no
   listener is to auto-dismiss (cancel) any dialog, which was silently
   aborting the reservation (looked like the click did nothing). This handler
   must stay registered before any navigation/click occurs. After the run, it
   waits for Enter before closing the browser so the user can inspect the
   result visually — success/failure detection from page content alone is
   not yet confirmed reliable (see below).

## Known unresolved area

Success/failure detection after the final submit is not fully nailed down.
What's confirmed so far: the submit response comes back either as `200`
with the outcome rendered inline (e.g. a rejection like "brand/chassis
doesn't match DLT's database"), or as a `302` redirect straight to the bare
home page with no inline verdict. `reserve.ts` now follows through on a
non-200 by navigating to the "check reservation result" page
(`?menu=search_m`, sidebar link "ตรวจสอบผลการจอง") and capturing that page's
content instead (`ReservationResult.checkedResultPage` flags this). What's
still unverified: whether that result page needs additional interaction
(e.g. a search/lookup form) to show anything, since no live test has yet
produced a genuine approval to observe — every real submission so far used
a fake chassis number and got rejected before reaching that ambiguity. Also
unconfirmed whether a `302` always means "accepted for processing" as
opposed to some other silent-failure case (e.g. a stale/expired token) —
needs more live samples once real vehicle data is used.

## Sensitive files

- `.env` holds real personal data (ID/plate details) — gitignored.
- `reserve.dlt.go.th.har` (if present) is a network capture used during
  development to reverse-engineer the flow; it contains real session/PII
  data and is gitignored (`*.har`).
- `screenshots/` holds run artifacts (may contain personal data shown on the
  form) — gitignored.
