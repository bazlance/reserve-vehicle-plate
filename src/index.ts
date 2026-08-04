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

async function main(): Promise<void> {
  const config = loadConfig();
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  fs.mkdirSync(DEBUG_DIR, { recursive: true });

  const harPath = `${DEBUG_DIR}/run-${Date.now()}.har`;

  const browser = await chromium.launch({ headless: false });
  // Record the full network trace (including the raw context.request calls
  // used in the hybrid API steps) so a failure can be diagnosed from the
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

  try {
    await login(page);
    const result = await runReservation(page, config, SCREENSHOT_DIR);

    console.log("\n=== Reservation submitted ===");
    console.log(`Round (confirm id): ${result.confirmId}`);
    console.log(`Page title: ${result.pageTitle}`);
    console.log(`Screenshot: ${result.screenshotPath}`);
    console.log("\n--- Page text (first 2000 chars) ---");
    console.log(result.bodyText);
    console.log("-------------------------------------");
    console.log(
      "\nSuccess/failure could not be auto-detected with certainty (no confirmed " +
        "success message was available at build time). Please verify the outcome " +
        "in the browser window and/or the screenshot above."
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
      console.error("--- Current page text (first 2000 chars) ---");
      console.error((await page.locator("body").innerText()).slice(0, 2000));
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
