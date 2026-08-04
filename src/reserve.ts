import { Page } from "playwright";
import { Config } from "./config";

const NAV_TIMEOUT_MS = 30_000;
const SUBMIT_TIMEOUT_MS = 90_000; // confirm() dialog round-trip + invisible reCAPTCHA verification observed to take well over 45s in practice
const TYPE_DELAY_MS = 90; // per-keystroke delay so behavior-detection.js sees realistic timing, not a burst

export interface ReservationResult {
  confirmId: string;
  screenshotPath: string;
  pageTitle: string;
  bodyText: string;
  submitStatus: number;
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
    throw new Error(
      `Could not find "confirm" id in #f_rule action="${formAction}"`,
    );
  }
  return confirmId;
}

export async function runReservation(
  page: Page,
  config: Config,
  screenshotDir: string,
): Promise<ReservationResult> {
  // Step 2.1 — scrape the current round's confirm id from the accept-rules
  // form (it rotates between reservation rounds) and accept the rules.
  const formAction = await page.getAttribute("#f_rule", "action");
  if (!formAction) {
    throw new Error(
      "#f_rule has no action attribute — page structure may have changed",
    );
  }
  const confirmId = extractConfirmId(formAction, page.url());
  console.log(`Detected reservation round confirm=${confirmId}`);

  // Steps 2.1-2.3 are driven as real clicks, not raw HTTP calls. An earlier
  // attempt fired them via context.request (with browser-matched headers) to
  // save time; that run got the real final submit blocked by Imperva
  // Incapsula (500). A later run using real clicks for every step got the
  // same block too, so raw HTTP isn't confirmed as the cause — the block
  // looks like intermittent WAF session-risk scoring that isn't fully
  // understood. Real clicks are kept because they're the only approach
  // proven to work when Imperva doesn't intervene; retry on a 500.
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
  const persUrl = page.url();
  await page.waitForSelector("#f_reserve", { timeout: NAV_TIMEOUT_MS });

  const availableBrands = await page.$$eval("#r_brand option", (opts) =>
    opts.map((o) => (o as HTMLOptionElement).value),
  );
  if (!availableBrands.includes(config.brand)) {
    throw new Error(
      `DLT_R_BRAND="${config.brand}" is not one of the options on the live page. ` +
        `Available values include: ${availableBrands.slice(0, 15).join(", ")}...`,
    );
  }

  // pers=1 (individual): r_idcard/prefixZQ/r_fname/r_lname are pre-filled
  // read-only from the ThaID login session — do not touch them (they're
  // not even editable). pers=2 (corporate/foreign): the same fields are
  // empty and required instead, since the applicant may not be the logged
  // -in individual (e.g. a company or a foreigner's passport).
  if (config.pers === "2") {
    if (!config.applicant) {
      throw new Error("pers=2 requires config.applicant but none was loaded");
    }
    const availablePrefixes = await page.$$eval("#prefixZQ option", (opts) =>
      opts.map((o) => (o as HTMLOptionElement).value),
    );
    if (!availablePrefixes.includes(config.applicant.prefix)) {
      throw new Error(
        `DLT_APPLICANT_PREFIX="${config.applicant.prefix}" is not one of the options on the live page. ` +
          `Available values: ${availablePrefixes.join(", ")}`,
      );
    }
    await page.type("#r_idcard", config.applicant.idCard, { delay: TYPE_DELAY_MS });
    await page.selectOption("#prefixZQ", config.applicant.prefix);
    await page.type("#r_fname", config.applicant.fname, { delay: TYPE_DELAY_MS });
    if (config.applicant.lname) {
      await page.type("#r_lname", config.applicant.lname, { delay: TYPE_DELAY_MS });
    }
  }

  await page.type("#r_bodynumber", config.bodyNumber, { delay: TYPE_DELAY_MS });
  await page.selectOption("#r_brand", config.brand);
  await page.type("#r_tel", config.tel, { delay: TYPE_DELAY_MS });
  await page.type("#number", config.desiredNumber, { delay: TYPE_DELAY_MS });

  // Capture the actual HTTP response of the submit POST itself, decoupled
  // from waiting for the page to fully navigate/settle — a slow or fuzzy
  // navigation event shouldn't discard a status code we already have. A 500
  // here is Imperva's WAF block signature (see comment above), not a real
  // DLT verdict; any other status is a genuine DLT response, but note that
  // 200 alone doesn't mean "approved" — DLT returns 200 for rejections too
  // (e.g. a brand/chassis mismatch), so the actual outcome still has to be
  // read from the page content below.
  const responsePromise = page.waitForResponse(
    (res) => res.request().method() === "POST" && res.url() === persUrl,
    { timeout: SUBMIT_TIMEOUT_MS },
  );
  // page.click() has its own built-in wait for any navigation the click
  // triggers, using its own default 30s timeout — independent of the
  // response wait above. Without matching it explicitly, the click's
  // internal wait can time out before our intended budget is used, even
  // though the real navigation was still going to happen.
  await page.click("#s_resz", { timeout: SUBMIT_TIMEOUT_MS });
  const submitResponse = await responsePromise;
  const submitStatus = submitResponse.status();

  // Best-effort: let the page finish settling after the response before
  // capturing its content. Not fatal if this doesn't resolve cleanly — we
  // already have the response status, which is the reliable signal.
  await page
    .waitForLoadState("load", { timeout: SUBMIT_TIMEOUT_MS })
    .catch(() => {});

  const screenshotPath = `${screenshotDir}/result-${Date.now()}.png`;
  await page.screenshot({ path: screenshotPath, fullPage: true });

  const pageTitle = await page.title();
  const bodyText = (await page.locator("body").innerText()).slice(0, 1000);

  return { confirmId, screenshotPath, pageTitle, bodyText, submitStatus };
}
