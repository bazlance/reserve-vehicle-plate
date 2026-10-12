import { Page } from "playwright";
import { ReservationResult, RunConfig, RunHooks } from "./types";

const NAV_TIMEOUT_MS = 30_000;
const SUBMIT_TIMEOUT_MS = 90_000; // confirm() dialog round-trip + invisible reCAPTCHA verification observed to take well over 45s in practice
// A single fixed delay produces suspiciously uniform keystroke intervals in
// the submitted behavior_data (e.g. "v":[94,94,93,93,95]) — real human
// typing (per the original reference capture) swings from ~150ms to over
// 2000ms within the same field. Randomize per keystroke instead of a fixed
// value. Test data (53+ submissions) showed success rate by range: 0-29ms
// 0%, 60-89ms ~15%, 90-109ms ~38%, 110ms+ ~92%+. Set to 60-89ms per explicit
// request for speed over the proven-safer 110ms+ floor — this tier at least
// showed some measured direct successes (~15%), unlike 0-29ms (0%). The
// auto-retry loop in runner.service.ts (on 302/500) is what makes this viable.
const TYPE_DELAY_MIN_MS = 60;
const TYPE_DELAY_MAX_MS = 89;
// No test data isolates hesitation's effect (median-based buckets above are
// dominated by the base range); reduced chance/amount here purely for more
// speed per request, not based on evidence like the base range is.
const HESITATION_CHANCE = 0.1;
const HESITATION_EXTRA_MIN_MS = 5;
const HESITATION_EXTRA_MAX_MS = 15;

function randomKeystrokeDelay(): number {
  let delay =
    TYPE_DELAY_MIN_MS + Math.random() * (TYPE_DELAY_MAX_MS - TYPE_DELAY_MIN_MS);
  if (Math.random() < HESITATION_CHANCE) {
    delay +=
      HESITATION_EXTRA_MIN_MS +
      Math.random() * (HESITATION_EXTRA_MAX_MS - HESITATION_EXTRA_MIN_MS);
  }
  return delay;
}

// Playwright's page.type(..., { delay }) only accepts one fixed number
// applied uniformly between every keystroke — there's no built-in per-
// character variability, so type one character at a time with a freshly
// randomized wait before each.
async function typeHumanLike(
  page: Page,
  selector: string,
  text: string,
): Promise<void> {
  await page.click(selector); // focus once, like a real user clicking into the field
  for (const char of text) {
    await page.waitForTimeout(randomKeystrokeDelay());
    await page.keyboard.type(char);
  }
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
  config: RunConfig,
  screenshotDir: string,
  hooks: RunHooks,
): Promise<ReservationResult> {
  hooks.onStatus("FILLING");

  // Step 2.1 — scrape the current round's confirm id from the accept-rules
  // form (it rotates between reservation rounds) and accept the rules.
  const formAction = await page.getAttribute("#f_rule", "action");
  if (!formAction) {
    throw new Error(
      "#f_rule has no action attribute — page structure may have changed",
    );
  }
  const confirmId = extractConfirmId(formAction, page.url());
  hooks.log(`Detected reservation round confirm=${confirmId}`);

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
      `Brand "${config.brand}" is not one of the options on the live page. ` +
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
      throw new Error("pers=2 requires applicant details but none were provided");
    }
    const availablePrefixes = await page.$$eval("#prefixZQ option", (opts) =>
      opts.map((o) => (o as HTMLOptionElement).value),
    );
    if (!availablePrefixes.includes(config.applicant.prefix)) {
      throw new Error(
        `Applicant title "${config.applicant.prefix}" is not one of the options on the live page. ` +
          `Available values: ${availablePrefixes.join(", ")}`,
      );
    }
    await typeHumanLike(page, "#r_idcard", config.applicant.idCard);
    await page.selectOption("#prefixZQ", config.applicant.prefix);
    await typeHumanLike(page, "#r_fname", config.applicant.fname);
    if (config.applicant.lname) {
      await typeHumanLike(page, "#r_lname", config.applicant.lname);
    }
  }

  await typeHumanLike(page, "#r_bodynumber", config.bodyNumber);
  await page.selectOption("#r_brand", config.brand);
  await typeHumanLike(page, "#r_tel", config.tel);
  await typeHumanLike(page, "#number", config.desiredNumber);

  hooks.onStatus("SUBMITTING");

  // Capture the actual HTTP response of the submit POST itself, decoupled
  // from waiting for the page to fully navigate/settle — a slow or fuzzy
  // navigation event shouldn't discard a status code we already have. A 500
  // here is Imperva's WAF block signature (see comment above), not a real
  // DLT verdict; any other status is a genuine DLT response, but note that
  // 200 alone doesn't mean "approved" — DLT returns 200 for rejections too
  // (e.g. a brand/chassis mismatch), so the actual outcome still has to be
  // read from the page content below (and from the dialog messages the
  // runner collects).
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
