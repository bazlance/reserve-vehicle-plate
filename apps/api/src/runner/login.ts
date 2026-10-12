import { Page } from "playwright";
import { RunHooks } from "./types";

const START_URL = "https://reserve.dlt.go.th/reserve/v2/?menu=resv_m";
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const QR_REFRESH_MS = 2000;

export interface LoginHooks extends RunHooks {
  onQr(pngBase64: string): void;
}

/**
 * Drives the ThaID QR login. DLT redirects to imauth.bora.dopa.go.th, which
 * renders a QR code and polls its own backend until the user scans it with
 * the ThaID mobile app, then redirects back to DLT with an authenticated
 * session cookie. We don't reimplement any of that — we navigate there,
 * stream screenshots of the QR page to the UI so it can be scanned remotely
 * (the headed browser window works too), and wait for the authenticated DLT
 * home page to appear.
 */
export async function login(page: Page, hooks: LoginHooks): Promise<void> {
  await page.goto(START_URL, { waitUntil: "load" });

  let timer: NodeJS.Timeout | undefined;
  if (page.url().includes("imauth.bora.dopa.go.th")) {
    hooks.onStatus("WAITING_QR");
    hooks.log(
      `Scan the QR code with the ThaID app. Waiting up to ${LOGIN_TIMEOUT_MS / 1000}s.`,
    );
    const snap = async () => {
      try {
        const png = await page.screenshot({ type: "png" });
        hooks.onQr(png.toString("base64"));
      } catch {
        // page may be mid-navigation right after the scan; next tick retries
      }
    };
    await snap();
    timer = setInterval(snap, QR_REFRESH_MS);
  }

  try {
    // The accept-rules form only exists on the authenticated DLT home page,
    // so waiting for it is a reliable signal that the OAuth round-trip
    // finished (more reliable than matching on URL across redirects).
    await page.waitForSelector("#f_rule", { timeout: LOGIN_TIMEOUT_MS });
  } finally {
    if (timer) clearInterval(timer);
  }
  hooks.onStatus("LOGGED_IN");
  hooks.log("Login successful.");
}
