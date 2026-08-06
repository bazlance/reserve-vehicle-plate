import * as fs from "fs";
import * as readline from "readline";
import { chromium } from "playwright";
import { loadConfig } from "./config";
import { login } from "./login";
import { runReservation } from "./reserve";

const SCREENSHOT_DIR = `${__dirname}/../screenshots`;
const DEBUG_DIR = `${__dirname}/../debug`;

function waitForEnter(prompt: string): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(prompt, () => { rl.close(); resolve(); }));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Resolves "HH:MM" against today's date in local time. Reservation rounds
// open at a specific time, and starting the QR login (let alone clicking
// through) too early just wastes the session — so the whole flow, not just
// the reservation steps, waits for this.
function resolveTargetTime(hhmm: string): Date {
  const [hours, minutes] = hhmm.split(":").map(Number);
  const target = new Date();
  target.setHours(hours, minutes, 0, 0);
  return target;
}

async function waitUntil(target: Date): Promise<void> {
  const targetMs = target.getTime();
  if (targetMs <= Date.now()) {
    console.log(`Target start time ${target.toLocaleTimeString()} has already passed today — starting now.`);
    return;
  }
  console.log(`Waiting until ${target.toLocaleTimeString()} to start...`);
  while (Date.now() < targetMs) {
    const remainingMs = targetMs - Date.now();
    if (remainingMs > 60_000) {
      console.log(`  ${Math.ceil(remainingMs / 60_000)} min remaining...`);
      await sleep(Math.min(remainingMs, 60_000));
    } else {
      await sleep(remainingMs);
    }
  }
  console.log("Target time reached — starting now.");
}

async function main(): Promise<void> {
  const config = loadConfig();
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  fs.mkdirSync(DEBUG_DIR, { recursive: true });

  const harPath = `${DEBUG_DIR}/run-${Date.now()}.har`;

  const browser = await chromium.launch({ headless: false });
  // Record the full network trace so a failure can be diagnosed from the
  // actual requests/responses instead of guessing — same approach used to
  // reverse-engineer the flow from reserve.dlt.go.th.har originally.
  const context = await browser.newContext({ recordHar: { path: harPath, content: "embed" } });
  const page = await context.newPage();

  // The reservation form pops a native confirm() dialog before actually
  // submitting. Playwright auto-dismisses (cancels) any dialog with no
  // listener attached, which silently aborted the reservation. Accept it.
  page.on("dialog", async (dialog) => {
    console.log(`Dialog (${dialog.type()}): ${dialog.message()}`);
    await dialog.accept();
  });

  if (config.startTime) {
    await waitUntil(resolveTargetTime(config.startTime));
  }

  // A 302 or 500 on the submit means no usable verdict came back (see
  // reserve.ts for what's confirmed vs. not about what causes these) — retry
  // from a fresh ?menu=resv_m visit rather than stopping. A 200 (even a
  // rejection like a brand/chassis mismatch) is a real answer and must not
  // be retried, since retrying a deterministic outcome just wastes attempts.
  let attempt = 0;
  let result: Awaited<ReturnType<typeof runReservation>> | undefined;

  try {
    while (true) {
      attempt++;
      if (attempt > 1) {
        console.log(`\nAttempt ${attempt}: redirecting to ?menu=resv_m and starting over...`);
      }
      await login(page);
      result = await runReservation(page, config, SCREENSHOT_DIR);

      if (result.submitStatus === 302 || result.submitStatus === 500) {
        console.log(`\nAttempt ${attempt} got HTTP ${result.submitStatus} — no usable verdict, retrying.`);
        continue;
      }
      break;
    }

    console.log("\n=== Reservation submitted ===");
    console.log(`Attempts: ${attempt}`);
    console.log(`Round (confirm id): ${result.confirmId}`);
    console.log(`Submit response status: ${result.submitStatus}`);
    console.log(`Page title: ${result.pageTitle}`);
    console.log(`Screenshot: ${result.screenshotPath}`);
    console.log("\n--- Page text (first 1000 chars) ---");
    console.log(result.bodyText);
    console.log("-------------------------------------");
    console.log(
      `\nGot a real response from DLT (HTTP ${result.submitStatus}). ` +
        "That status alone doesn't confirm approval, though — DLT returns 200 for " +
        "rejections too (e.g. a brand/chassis mismatch). Read the page text/screenshot " +
        "above to see the actual verdict."
    );
  } catch (err) {
    console.error("\nReservation flow failed:", err instanceof Error ? err.message : err);
    // A thrown error (e.g. a wait timing out) doesn't mean the page didn't
    // actually get where it was going — Chromium keeps navigating in the
    // background regardless of our Node code's timeouts, so the page may
    // have already settled on a real result by the time we get here. Report
    // its current state rather than just a screenshot, so a timeout that
    // masks a real (successful or rejected) outcome isn't mistaken for a
    // hard crash.
    const failurePath = `${SCREENSHOT_DIR}/failure-${Date.now()}.png`;
    await page.screenshot({ path: failurePath, fullPage: true }).catch(() => {});
    console.error(`Screenshot at point of failure: ${failurePath}`);
    try {
      console.error(`Current URL: ${page.url()}`);
      console.error(`Current page title: ${await page.title()}`);
      console.error("--- Current page text (first 1000 chars) ---");
      console.error((await page.locator("body").innerText()).slice(0, 1000));
    } catch {
      // page may already be closed/navigating; the screenshot above is the fallback
    }
  }

  await waitForEnter("\nPress Enter to close the browser...");

  // HAR content is flushed to disk on context close, not guaranteed by
  // browser.close() alone.
  await context.close();
  await browser.close();
  console.log(`\nNetwork trace saved: ${harPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
