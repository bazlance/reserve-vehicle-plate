import * as fs from "fs";
import * as readline from "readline";
import { chromium } from "playwright";
import { loadConfig } from "./config";
import { login } from "./login";
import { runReservation } from "./reserve";

const SCREENSHOT_DIR = `${__dirname}/../screenshots`;

function waitForEnter(prompt: string): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(prompt, () => { rl.close(); resolve(); }));
}

async function main(): Promise<void> {
  const config = loadConfig();
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

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
    const failurePath = `${SCREENSHOT_DIR}/failure-${Date.now()}.png`;
    await page.screenshot({ path: failurePath, fullPage: true }).catch(() => {});
    console.error(`Screenshot at point of failure: ${failurePath}`);
  }

  await waitForEnter("\nPress Enter to close the browser...");
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
