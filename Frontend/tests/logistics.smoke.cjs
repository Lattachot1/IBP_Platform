const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.UI_TEST_URL || "http://localhost:3000";
const out = process.env.UI_TEST_OUTPUT || path.join(__dirname, "../../.ui-qa");
fs.mkdirSync(out, { recursive: true });

async function pixels(page) {
  return page.locator(".world-globe canvas").evaluate((canvas) => {
    const gl = canvas.getContext("webgl2");
    if (!gl) return null;
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
    let opaque = 0,
      bright = 0;
    const colors = new Set();
    let checksum = 0;
    for (let i = 0; i < data.length; i += 4 * 17) {
      if (data[i + 3] > 0) {
        opaque++;
        if (data[i] + data[i + 1] + data[i + 2] > 200) bright++;
        colors.add(`${data[i] >> 3},${data[i + 1] >> 3},${data[i + 2] >> 3}`);
      }
      checksum +=
        data[i] * (1 + (i % 97)) + data[i + 1] * (1 + (i % 131)) + data[i + 2];
    }
    return {
      opaque,
      bright,
      colors: colors.size,
      checksum,
      width: canvas.width,
      height: canvas.height,
    };
  });
}
(async () => {
  const browser = await chromium.launch({
    channel: process.env.UI_BROWSER || "msedge",
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1680, height: 1100 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/?view=logistics`);
  await page
    .locator('.world-globe[data-status="ready"]')
    .waitFor({ timeout: 60000 });
  const canvas = page.locator('.world-globe canvas[data-texture="loaded"]');
  await canvas.waitFor();
  await page.waitForTimeout(500);
  const initial = await pixels(page);
  assert(
    initial &&
      initial.opaque > 3000 &&
      initial.bright > 500 &&
      initial.colors > 100,
    `Nonblank textured Earth: ${JSON.stringify(initial)}`,
  );
  assert.equal(await canvas.getAttribute("data-routes"), "8");
  await page.screenshot({
    path: path.join(out, "logistics-desktop.png"),
    fullPage: true,
  });

  // Raycast the Thailand hub marker through the actual canvas.
  await page
    .getByRole("button", { name: "Focus Thailand hub", exact: true })
    .click();
  await page.waitForTimeout(250);
  const rect = await canvas.boundingBox();
  await canvas.click({ position: { x: rect.width / 2, y: rect.height / 2 } });
  await page
    .locator(".route-identity > span")
    .filter({ hasText: "IN-001" })
    .waitFor();
  const preOrbit = await pixels(page);
  await page.mouse.move(rect.x + rect.width * 0.5, rect.y + rect.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(
    rect.x + rect.width * 0.72,
    rect.y + rect.height * 0.68,
    { steps: 12 },
  );
  await page.mouse.up();
  await page.waitForTimeout(350);
  assert.notEqual(
    (await pixels(page)).checksum,
    preOrbit.checksum,
    "Pointer orbit changes the canvas",
  );
  const beforeRotation = await pixels(page);
  await page
    .getByRole("button", { name: "Auto rotate globe", exact: true })
    .click();
  await page.waitForTimeout(450);
  assert.notEqual(
    (await pixels(page)).checksum,
    beforeRotation.checksum,
    "Explicit auto rotation changes the canvas",
  );
  await page
    .getByRole("button", { name: "Auto rotate globe", exact: true })
    .click();

  await page
    .getByRole("button", { name: "Select shipment OUT-001", exact: true })
    .click();
  assert.match(
    await page.getByTestId("scenario-arrival").textContent(),
    /^20 Sept?$/,
  );
  await page
    .getByRole("slider", { name: "Additional transit delay", exact: true })
    .fill("10");
  assert.equal(await page.getByTestId("network-ontime").textContent(), "0%");
  assert.match(
    await page.getByTestId("scenario-arrival").textContent(),
    /^30 Sept?$/,
  );
  await page
    .getByRole("slider", { name: "Additional transit delay", exact: true })
    .fill("0");
  await page
    .getByRole("spinbutton", { name: "Shipment transit days", exact: true })
    .fill("20");
  assert.match(
    await page.getByTestId("scenario-arrival").textContent(),
    /^28 Sept?$/,
  );
  await page
    .getByLabel("Shipment departure", { exact: true })
    .fill("2026-10-28");
  await page.getByText("Beyond displayed horizon", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Decision map", exact: true }).click();
  await page
    .getByRole("button", { name: /Logistics globe/, exact: false })
    .click();
  await page.locator('.world-globe[data-status="ready"]').waitFor();
  assert.equal(
    await page
      .getByRole("spinbutton", { name: "Shipment transit days", exact: true })
      .inputValue(),
    "20",
    "View navigation preserves shipment edits",
  );
  await page.getByRole("button", { name: "Raw material", exact: true }).click();
  assert.equal(await page.locator(".shipment-table tbody tr").count(), 3);
  assert.equal(await canvas.getAttribute("data-routes"), "3");
  await page.getByRole("button", { name: "All flows", exact: true }).click();
  const snapshot = page.getByRole("slider", {
    name: "Network snapshot day",
    exact: true,
  });
  await snapshot.fill("60");
  assert(
    await page
      .getByRole("button", { name: "Next shipment day", exact: true })
      .isDisabled(),
  );
  await snapshot.fill("10");
  await page
    .getByRole("button", { name: "Play shipment timeline", exact: true })
    .click();
  await page.waitForTimeout(1000);
  assert(Number(await snapshot.inputValue()) > 10);
  await page
    .getByRole("button", { name: "Pause shipment timeline", exact: true })
    .click();

  const downloadEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export mock network", exact: true })
    .click();
  const download = await downloadEvent;
  const exportPath = path.join(out, download.suggestedFilename());
  await download.saveAs(exportPath);
  const payload = JSON.parse(fs.readFileSync(exportPath, "utf8"));
  assert.equal(
    payload.status,
    "mock_logistics_not_live_not_connected_to_optimizer",
  );
  assert.equal(
    payload.shipments.find((s) => s.id === "OUT-001").transitDays,
    20,
  );
  assert(payload.assumptions.length >= 7);
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Reset mock shipments", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Select shipment OUT-001", exact: true })
    .click();
  assert.equal(
    await page
      .getByRole("spinbutton", { name: "Shipment transit days", exact: true })
      .inputValue(),
    "12",
  );
  await page
    .getByRole("slider", { name: "Additional transit delay", exact: true })
    .fill("5");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: path.join(out, "logistics-stress.png"),
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(350);
  const mobile = await pixels(page);
  assert(
    mobile &&
      mobile.opaque > 1000 &&
      mobile.bright > 100 &&
      mobile.colors > 100,
    `Mobile nonblank: ${JSON.stringify(mobile)}`,
  );
  const mobileBounds = await canvas.boundingBox();
  assert(mobileBounds.width <= 390 && mobileBounds.height >= 400);
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
    "Mobile content does not escape viewport",
  );
  await page.screenshot({
    path: path.join(out, "logistics-mobile.png"),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  const fallbackContext = await browser.newContext();
  await fallbackContext.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (type === "webgl" || type === "webgl2") return null;
      return original.call(this, type, ...args);
    };
  });
  const fallback = await fallbackContext.newPage();
  await fallback.goto(`${base}/?view=logistics`);
  await fallback.locator('.world-globe[data-status="unavailable"]').waitFor();
  assert.equal(await fallback.locator(".shipment-table tbody tr").count(), 8);
  await fallback
    .getByRole("spinbutton", { name: "Shipment transit days", exact: true })
    .fill("30");
  await fallback
    .getByText("15 days late at arrival", { exact: true })
    .waitFor();
  console.log(
    "PASS: textured nonblank desktop/mobile canvas, raycast selection, pointer/auto orbit, filters, transit stress, preserved edits, beyond-horizon warning, timeline playback, export, reset and non-WebGL fallback.",
  );
  console.log(JSON.stringify({ desktop: initial, mobile }));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
