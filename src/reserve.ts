import { Page } from "playwright";
import { Config } from "./config";

const NAV_TIMEOUT_MS = 30_000;
const SUBMIT_TIMEOUT_MS = 45_000; // confirm() dialog round-trip + invisible reCAPTCHA verification adds latency before the real POST fires
const TYPE_DELAY_MS = 90; // per-keystroke delay so behavior-detection.js sees realistic timing, not a burst

export interface ReservationResult {
  confirmId: string;
  screenshotPath: string;
  pageTitle: string;
  bodyText: string;
}

async function clickAndWaitForNav(page: Page, selector: string): Promise<void> {
  await Promise.all([
    page.waitForNavigation({ waitUntil: "load", timeout: NAV_TIMEOUT_MS }),
    page.click(selector),
  ]);
}

function extractConfirmId(formAction: string, pageUrl: string): string {
  const resolved = new URL(formAction, pageUrl);
  const confirmId = resolved.searchParams.get("confirm");
  if (!confirmId) {
    throw new Error(`Could not find "confirm" id in #f_rule action="${formAction}"`);
  }
  return confirmId;
}

export async function runReservation(page: Page, config: Config, screenshotDir: string): Promise<ReservationResult> {
  // Step 2.1 — scrape the current round's confirm id from the accept-rules
  // form (it rotates between reservation rounds) and accept the rules.
  const formAction = await page.getAttribute("#f_rule", "action");
  if (!formAction) {
    throw new Error("#f_rule has no action attribute — page structure may have changed");
  }
  const confirmId = extractConfirmId(formAction, page.url());
  console.log(`Detected reservation round confirm=${confirmId}`);

  await clickAndWaitForNav(page, "#f_rule input[type=submit]");

  // Step 2.2 — pick car type.
  const carTypeSelector = `input[onclick*="car_type=${config.carType}'"]`;
  await page.waitForSelector(carTypeSelector, { timeout: NAV_TIMEOUT_MS });
  await clickAndWaitForNav(page, carTypeSelector);

  // Step 2.3 — pick applicant type (individual / corporate).
  const persSelector = `input[onclick*="pers=${config.pers}'"]`;
  await page.waitForSelector(persSelector, { timeout: NAV_TIMEOUT_MS });
  await clickAndWaitForNav(page, persSelector);

  // Step 2.4 — fill and submit the reservation form.
  await page.waitForSelector("#f_reserve", { timeout: NAV_TIMEOUT_MS });

  const availableBrands = await page.$$eval("#r_brand option", (opts) =>
    opts.map((o) => (o as HTMLOptionElement).value)
  );
  if (!availableBrands.includes(config.brand)) {
    throw new Error(
      `DLT_R_BRAND="${config.brand}" is not one of the options on the live page. ` +
        `Available values include: ${availableBrands.slice(0, 15).join(", ")}...`
    );
  }

  await page.type("#r_bodynumber", config.bodyNumber, { delay: TYPE_DELAY_MS });
  await page.selectOption("#r_brand", config.brand);
  await page.type("#r_tel", config.tel, { delay: TYPE_DELAY_MS });
  await page.type("#number", config.desiredNumber, { delay: TYPE_DELAY_MS });

  await Promise.all([
    page.waitForNavigation({ waitUntil: "load", timeout: SUBMIT_TIMEOUT_MS }),
    page.click("#s_resz"),
  ]);

  const screenshotPath = `${screenshotDir}/result-${Date.now()}.png`;
  await page.screenshot({ path: screenshotPath, fullPage: true });

  const pageTitle = await page.title();
  const bodyText = (await page.locator("body").innerText()).slice(0, 2000);

  return { confirmId, screenshotPath, pageTitle, bodyText };
}
