const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.UI_TEST_URL || "http://localhost:3000";
const out = path.join(__dirname, "../../.ui-qa");
fs.mkdirSync(out, { recursive: true });
async function pixels(page) {
  return page.locator(".factory-twin canvas").evaluate((canvas) => {
    const gl = canvas.getContext("webgl2");
    const data = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(
      0,
      0,
      canvas.width,
      canvas.height,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      data,
    );
    let visible = 0,
      bright = 0,
      checksum = 0;
    const colors = new Set();
    for (let i = 0; i < data.length; i += 4 * 17) {
      if (data[i + 3]) {
        visible++;
        if (data[i] + data[i + 1] + data[i + 2] > 220) bright++;
        colors.add(`${data[i] >> 3},${data[i + 1] >> 3},${data[i + 2] >> 3}`);
      }
      checksum +=
        data[i] * (1 + (i % 97)) + data[i + 1] * (1 + (i % 131)) + data[i + 2];
    }
    return { visible, bright, colors: colors.size, checksum };
  });
}
(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const context = await browser.newContext({
    viewport: { width: 1680, height: 1100 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page
    .locator('.factory-twin canvas[data-ready="true"]')
    .waitFor({ timeout: 60000 });
  await page.waitForTimeout(300);
  const initial = await pixels(page);
  assert(
    initial.visible > 2000 && initial.bright > 1500 && initial.colors > 50,
    JSON.stringify(initial),
  );
  assert.equal(await page.getByTestId("exec-service").textContent(), "69%");
  await page.screenshot({
    path: path.join(out, "executive-desktop.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Inspect reactor RX4", exact: true })
    .click();
  assert.equal(
    await page.locator(".exec-reactor-inspector h3").textContent(),
    "RX4",
  );
  const canvas = page.locator(".factory-twin canvas");
  const rect = await canvas.boundingBox();
  const beforeOrbit = await pixels(page);
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height * 0.65);
  await page.mouse.down();
  await page.mouse.move(
    rect.x + rect.width * 0.65,
    rect.y + rect.height * 0.7,
    { steps: 12 },
  );
  await page.mouse.up();
  await page.waitForTimeout(350);
  assert.notEqual((await pixels(page)).checksum, beforeOrbit.checksum);
  await page
    .getByRole("button", { name: "Top-down factory view", exact: true })
    .click();
  await page.waitForTimeout(250);
  const top = await pixels(page);
  assert(top.visible > 2000);
  await page
    .getByRole("button", { name: "Top-down factory view", exact: true })
    .click();

  const baseCost = await page.getByTestId("exec-cost").textContent();
  const baseService = await page.getByTestId("exec-service").textContent();
  await page.getByRole("button", { name: /BD price jump/ }).click();
  assert.notEqual(await page.getByTestId("exec-cost").textContent(), baseCost);
  assert.equal(
    await page.getByTestId("exec-service").textContent(),
    baseService,
  );
  assert(
    (await page.locator(".exec-cost-chart .recharts-bar-rectangle").count()) >=
      7,
  );
  await page.getByRole("button", { name: /Material arrives late/ }).click();
  assert.notEqual(
    await page.getByTestId("exec-service").textContent(),
    baseService,
  );
  await page
    .getByRole("slider", { name: "Factory snapshot day", exact: true })
    .fill("6");
  assert.equal(
    await page.locator(".factory-label[data-status='Material hold']").count(),
    4,
  );
  await page.getByRole("button", { name: /Restore receipt dates/ }).click();
  assert.equal(
    await page.getByTestId("exec-service").textContent(),
    baseService,
  );
  await page.getByRole("button", { name: /Agree delivery extensions/ }).click();
  await page
    .getByText("Against revised dates / customer agreement needed", {
      exact: true,
    })
    .waitFor();

  await page.getByRole("button", { name: "Present", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Executive presentation",
    exact: true,
  });
  await dialog.waitFor();
  await dialog
    .getByRole("button", { name: "Next presentation chapter", exact: true })
    .click();
  assert.equal(await dialog.locator(".exec-disruption").count(), 1);
  assert.equal(await dialog.locator(".exec-situation").count(), 0);
  await dialog
    .getByRole("button", { name: "Next presentation chapter", exact: true })
    .click();
  assert.equal(await dialog.locator(".exec-response").count(), 3);
  await page.screenshot({
    path: path.join(out, "executive-presentation.png"),
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: "Next presentation chapter", exact: true })
    .click();
  await dialog
    .getByRole("checkbox", {
      name: "Discussed: Confirm supplier recovery dates",
      exact: true,
    })
    .check();
  await dialog
    .getByRole("textbox", { name: "Executive meeting note", exact: true })
    .fill("Confirm lead times with procurement. No factory approval yet.");
  const downloadPromise = page.waitForEvent("download");
  await dialog
    .getByRole("button", {
      name: "Export executive scenario data",
      exact: true,
    })
    .click();
  const download = await downloadPromise;
  const file = path.join(out, download.suggestedFilename());
  await download.saveAs(file);
  const payload = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(
    payload.status,
    "illustrative_executive_brief_not_approved_factory_plan",
  );
  assert.equal(payload.reviews_for_discussion_only.supply, true);
  assert.equal(payload.selected_response, "reschedule");
  const htmlDownloadEvent = page.waitForEvent("download");
  await dialog
    .getByRole("button", { name: "Board brief", exact: true })
    .click();
  const htmlDownload = await htmlDownloadEvent;
  const htmlPath = path.join(out, htmlDownload.suggestedFilename());
  await htmlDownload.saveAs(htmlPath);
  const briefPage = await context.newPage();
  await briefPage.setContent(fs.readFileSync(htmlPath, "utf8"));
  await briefPage
    .getByRole("heading", {
      name: "Operating exposure & response options",
      exact: true,
    })
    .waitFor();
  assert(
    await briefPage
      .getByText("STANDALONE MOCK / NOT AN APPROVED FACTORY PLAN", {
        exact: true,
      })
      .isVisible(),
  );
  await briefPage.screenshot({
    path: path.join(out, "executive-board-brief.png"),
    fullPage: true,
  });
  await briefPage.close();
  const demands = payload.options.map((o) => o.evaluation.totalDemand);
  assert(demands.every((d) => Math.abs(d - demands[0]) < 1e-6));
  await page.keyboard.press("Escape");
  assert.equal(
    await page.getByRole("dialog", { name: "Executive presentation" }).count(),
    0,
  );
  await page
    .locator(".exec-drilldown")
    .getByRole("button", { name: /Production plan/ })
    .click();
  await page.locator(".gantt-grid").waitFor();
  await page
    .locator("nav")
    .getByRole("button", { name: "Executive cockpit", exact: true })
    .click();
  assert.equal(
    await page
      .getByRole("slider", { name: "Raw material receipt delay", exact: true })
      .inputValue(),
    "7",
  );
  await page
    .getByRole("button", { name: "Reset executive scenario", exact: true })
    .click();
  await page
    .getByRole("slider", { name: "Factory snapshot day", exact: true })
    .fill("35");
  assert.equal(
    await page.locator(".factory-label[data-status='Cleaning']").count(),
    2,
  );
  await page
    .getByRole("button", { name: "Play factory playback", exact: true })
    .click();
  await page.waitForTimeout(950);
  assert(
    Number(
      await page
        .getByRole("slider", { name: "Factory snapshot day", exact: true })
        .inputValue(),
    ) > 35,
  );
  await page
    .getByRole("button", { name: "Pause factory playback", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  const mobile = await pixels(page);
  assert(
    mobile.visible > 1000 && mobile.bright > 500 && mobile.colors > 50,
    JSON.stringify(mobile),
  );
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await page.screenshot({
    path: path.join(out, "executive-mobile.png"),
    fullPage: true,
  });
  assert.deepEqual(errors, []);

  const normalMotion = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const moving = await normalMotion.newPage();
  await moving.goto(`${base}/?view=executive`);
  await moving.locator('.factory-twin canvas[data-ready="true"]').waitFor();
  await moving.waitForTimeout(350);
  const a = await pixels(moving);
  await moving.waitForTimeout(300);
  assert.notEqual(
    (await pixels(moving)).checksum,
    a.checksum,
    "Process flow moves when production is credited",
  );
  const fallbackContext = await browser.newContext();
  await fallbackContext.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return type === "webgl" || type === "webgl2"
        ? null
        : get.call(this, type, ...args);
    };
  });
  const fallback = await fallbackContext.newPage();
  await fallback.route("**/api/v1/**", (route) => route.abort());
  await fallback.goto(`${base}/?view=executive`);
  await fallback.locator('.factory-twin[data-failed="true"]').waitFor();
  await fallback
    .locator(".error-banner")
    .filter({ hasText: "Monthly optimizer unavailable. Executive mock remains usable." })
    .waitFor();
  await fallback.getByRole("button", { name: /BD price jump/ }).click();
  assert.notEqual(
    await fallback.getByTestId("exec-cost").textContent(),
    baseCost,
  );
  console.log(
    "PASS: nonblank desktop/mobile 3D factory, reactor selection, orbit/top view, moving flow, shock-to-cost/service effects, response comparison, presentation, follow-ups/export, preserved navigation, playback and WebGL fallback.",
  );
  console.log(JSON.stringify({ desktop: initial, mobile }));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
