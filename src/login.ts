import { Page } from "playwright";

const START_URL = "https://reserve.dlt.go.th/reserve/v2/?menu=resv_m";
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Drives the ThaID QR login. DLT redirects to imauth.bora.dopa.go.th, which
 * renders a QR code and polls its own backend until the user scans it with
 * the ThaID mobile app, then redirects back to DLT with an authenticated
 * session cookie. We don't reimplement any of that — we just navigate there,
 * let the user scan the QR shown in the (headed) browser window, and wait
 * for the authenticated DLT home page to appear.
 */
export async function login(page: Page): Promise<void> {
  await page.goto(START_URL, { waitUntil: "load" });

  if (page.url().includes("imauth.bora.dopa.go.th")) {
    console.log("\nScan the QR code in the browser window with the ThaID app to log in...");
    console.log(`Waiting up to ${LOGIN_TIMEOUT_MS / 1000}s for login to complete.\n`);
  }

  // The accept-rules form only exists on the authenticated DLT home page,
  // so waiting for it is a reliable signal that the OAuth round-trip finished
  // (more reliable than matching on URL, since the QR page and the home page
  // can both live under similar-looking paths across redirects).
  await page.waitForSelector("#f_rule", { timeout: LOGIN_TIMEOUT_MS });
  console.log("Login successful.\n");
}
