const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

const base = process.env.UI_TEST_URL || "http://localhost:3000";
const output =
  process.env.UI_TEST_OUTPUT || path.join(__dirname, "../../.ui-qa");
fs.mkdirSync(output, { recursive: true });

async function overflow(page) {
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
    "Page must not overflow horizontally",
  );
}

(async () => {
  const browser = await chromium.launch({
    channel: process.env.UI_BROWSER || "msedge",
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/?view=overview`);
  await page
    .getByText("Billing data connected", { exact: true })
    .waitFor({ timeout: 60000 });
  await page
    .locator(".metric-value")
    .filter({ hasText: /^\$[0-9,.]+M$/ })
    .waitFor();
  await page.waitForTimeout(1000);
  assert(
    (await page.locator(".demand-chart .recharts-line-curve").count()) >= 2,
    "Actual and forecast curves must render",
  );
  assert(
    await page
      .locator(".plant-photo img")
      .evaluate((img) => img.complete && img.naturalWidth > 0),
    "Facility asset must render",
  );
  await overflow(page);
  await page.screenshot({
    path: path.join(output, "overview-desktop.png"),
    fullPage: true,
  });

  await page
    .getByRole("combobox", { name: "Demand grade" })
    .selectOption("UBEPOL BR150L");
  await page.getByText("Billing data connected", { exact: true }).waitFor();
  assert.equal(
    await page.getByRole("combobox", { name: "Demand grade" }).inputValue(),
    "UBEPOL BR150L",
  );
  await page
    .getByRole("button", { name: "Raw material details", exact: true })
    .click();
  await page.getByRole("dialog", { name: "Raw material outlook" }).waitFor();
  await page.keyboard.press("Shift+Tab");
  assert.equal(
    await page.evaluate(() => document.activeElement?.textContent?.trim()),
    "Open scenario studio",
  );
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 0);

  await page
    .locator("nav")
    .getByRole("button", { name: "Scenario studio" })
    .click();
  await page.getByRole("slider", { name: "Demand change" }).focus();
  await page.keyboard.press("ArrowRight");
  await page.getByText("Changes not applied", { exact: true }).waitFor();
  assert(
    await page.getByRole("button", { name: "Save snapshot" }).isDisabled(),
  );
  await page
    .getByRole("button", { name: "Run optimization", exact: true })
    .click();
  await page
    .getByText("Results match current inputs", { exact: true })
    .waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: "Save snapshot" }).click();
  await page
    .locator("nav")
    .getByRole("button", { name: "Saved plans" })
    .click();
  await page.getByText("1 saved plan", { exact: true }).waitFor();
  await page.reload();
  await page
    .locator("nav")
    .getByRole("button", { name: "Saved plans" })
    .click();
  await page.getByText("1 saved plan", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.getByText("Explore the trade-offs.", { exact: true }).waitFor();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export plan", exact: true }).click();
  const download = await downloadPromise;
  assert(download.suggestedFilename().endsWith(".json"));
  await page.screenshot({
    path: path.join(output, "studio-desktop.png"),
    fullPage: true,
  });

  await page
    .locator("nav")
    .getByRole("button", { name: "Decision map" })
    .click();
  await page.waitForTimeout(800);
  assert.equal(
    await page.locator(".allocation-chart .recharts-sankey-nodes rect").count(),
    7,
  );
  assert.equal(
    await page
      .locator(".allocation-chart .recharts-sankey-links path[stroke]")
      .count(),
    6,
  );
  await overflow(page);
  await page.screenshot({
    path: path.join(output, "decision-map-desktop.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Search workspace", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Search views and grades" })
    .fill("observatory");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Model observatory" })
    .click();
  await page.getByText("Model evidence", { exact: true }).waitFor();
  await page.screenshot({
    path: path.join(output, "models-desktop.png"),
    fullPage: true,
  });
  await page
    .locator("nav")
    .getByRole("button", { name: "Demand intelligence" })
    .click();
  await page.waitForTimeout(1000);
  await overflow(page);
  await page.screenshot({
    path: path.join(output, "forecast-desktop.png"),
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  for (const [name, file] of [
    ["Overview", "overview-mobile.png"],
    ["Scenario studio", "studio-mobile.png"],
    ["Decision map", "map-mobile.png"],
    ["Demand intelligence", "forecast-mobile.png"],
    ["Model observatory", "models-mobile.png"],
    ["Saved plans", "saved-mobile.png"],
  ]) {
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page
      .locator("nav")
      .getByRole("button", { name, exact: name !== "Scenario studio" })
      .click();
    await page.waitForTimeout(800);
    await overflow(page);
    if (name === "Decision map") {
      assert(await page.locator('.reactor-system').evaluate(system => {
        const bounds = system.getBoundingClientRect();
        return [...system.querySelectorAll('.reactor')].every(reactor => {
          const box = reactor.getBoundingClientRect();
          return box.left >= bounds.left && box.right <= bounds.right;
        });
      }), 'All four reactor illustrations must remain visible on mobile');
    }
    await page.screenshot({ path: path.join(output, file), fullPage: true });
  }
  await page.goto(`${base}/classic`);
  await page.locator("h1").waitFor();
  assert.equal(errors.length, 0, errors.join("\n"));

  const offline = await context.newPage();
  await offline.route("**/api/v1/**", (route) => route.abort());
  await offline.goto(`${base}/?view=overview`);
  await offline
    .getByText(
      "Billing forecast unavailable. No sample values are substituted.",
    )
    .waitFor({ timeout: 30000 });
  await offline.locator('.error-banner[role="alert"]').waitFor();
  assert(
    await offline.getByRole("button", { name: "Export plan" }).isDisabled(),
  );
  await overflow(offline);
  await offline.screenshot({
    path: path.join(output, "offline-mobile.png"),
    fullPage: true,
  });
  await browser.close();
  console.log(
    "PASS: desktop/mobile views, chart assets, sliders, solver, saved-plan persistence, JSON export, search, focus trap, offline state, classic route, no page errors.",
  );
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
