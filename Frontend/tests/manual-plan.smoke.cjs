const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.UI_TEST_URL || "http://localhost:3000";
const out = process.env.UI_TEST_OUTPUT || path.join(__dirname, "../../.ui-qa");
fs.mkdirSync(out, { recursive: true });

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
  await page.goto(`${base}/?view=timeline`);
  await page
    .getByText("Engine connected", { exact: true })
    .waitFor({ timeout: 60000 });
  await page.locator(".gantt-grid").waitFor();
  await page.waitForTimeout(300);
  const bar = page.locator('[data-kind="campaign"][data-id="campaign-0"]');
  assert.equal(await bar.getAttribute("data-start"), "0");
  const before = await page
    .locator(".manual-metric")
    .nth(1)
    .locator("strong")
    .first()
    .textContent();
  const handle = bar.locator(".gantt-item-body");
  const rect = await handle.boundingBox();
  await page.mouse.move(rect.x + 35, rect.y + 15);
  await page.mouse.down();
  await page.mouse.move(rect.x + 35 + 7 * 34, rect.y + 15, { steps: 10 });
  await page.getByText("Live drag preview", { exact: true }).waitFor();
  assert(
    await page
      .getByRole("button", { name: "Save draft", exact: true })
      .isDisabled(),
  );
  await page.mouse.up();
  assert.equal(
    await bar.getAttribute("data-start"),
    "7",
    "Pointer drag must snap to calendar days",
  );
  assert.notEqual(
    await page
      .locator(".manual-metric")
      .nth(1)
      .locator("strong")
      .first()
      .textContent(),
    before,
    "Dragging must recalculate shortage",
  );
  await page
    .getByRole("button", { name: "Undo plan edit", exact: true })
    .click();
  assert.equal(await bar.getAttribute("data-start"), "0");
  await page
    .getByRole("button", { name: "Redo plan edit", exact: true })
    .click();
  assert.equal(await bar.getAttribute("data-start"), "7");
  await page
    .getByRole("button", { name: "Undo plan edit", exact: true })
    .click();

  await handle.focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  assert.equal(
    await bar.getAttribute("data-start"),
    "1",
    "Keyboard dragging must move exactly one day",
  );
  await page
    .getByRole("button", { name: "Undo plan edit", exact: true })
    .click();
  const oldDuration = Number(await bar.getAttribute("data-duration"));
  const resize = await bar
    .getByRole("button", { name: "Resize BR150L campaign" })
    .boundingBox();
  await page.mouse.move(resize.x + 5, resize.y + 10);
  await page.mouse.down();
  await page.mouse.move(resize.x + 5 - 34, resize.y + 10, { steps: 5 });
  await page.mouse.up();
  assert.equal(
    Number(await bar.getAttribute("data-duration")),
    oldDuration - 1,
    "Resize handle must change run duration",
  );
  await page
    .getByRole("button", { name: "Undo plan edit", exact: true })
    .click();
  await handle.click();
  const regionEnd =
    Number(
      await page.locator('[data-id="campaign-1"]').getAttribute("data-start"),
    ) +
    Number(
      await page
        .locator('[data-id="campaign-1"]')
        .getAttribute("data-duration"),
    );
  await page.getByRole("button", { name: "Swap later", exact: true }).click();
  assert.equal(
    await page.locator('[data-id="campaign-1"]').getAttribute("data-start"),
    "0",
  );
  assert.equal(
    Number(await bar.getAttribute("data-start")) +
      Number(await bar.getAttribute("data-duration")),
    regionEnd,
    "Swap must preserve the occupied sequence window",
  );
  await page
    .getByRole("button", { name: "Undo plan edit", exact: true })
    .click();

  await page
    .getByRole("button", { name: "Fit whole planning horizon" })
    .click();
  await page.screenshot({
    path: path.join(out, "manual-gantt-after-edit.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Export manual plan", exact: true })
    .click({ trial: true });
  await page
    .getByRole("combobox", { name: "New planning event" })
    .selectOption("cleaning");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page
    .getByRole("spinbutton", { name: "Duration / calendar days" })
    .fill("3");
  await page.getByRole("tab", { name: /^Checks/ }).click();
  await page.getByText(/cleaning must last 7 days/).waitFor();
  await page.getByRole("tab", { name: "Edit event", exact: true }).click();

  const arrival = page.locator('[data-kind="purchase"][data-id="purchase-0"]');
  await arrival.getByRole("button").click();
  await page.getByLabel("Event date", { exact: true }).fill("2026-10-01");
  assert.equal(await arrival.getAttribute("data-start"), "30");
  await page.getByText("Demo receipt-month price").waitFor();
  assert((await page.locator(".event-fact").textContent()).includes("1,401.5"));
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page
    .locator("nav")
    .getByRole("button", { name: "Overview", exact: true })
    .click();
  await page
    .locator("nav")
    .getByRole("button", { name: "Interactive plan", exact: true })
    .click();
  assert.equal(
    await arrival.getAttribute("data-start"),
    "30",
    "Switching views must preserve manual edits",
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Restore saved manual draft", exact: true })
    .click();
  assert.equal(await arrival.getAttribute("data-start"), "30");
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export manual plan", exact: true })
    .click();
  const download = await downloadPromise;
  const filename = path.join(out, "manual-plan-export.json");
  await download.saveAs(filename);
  const exported = JSON.parse(fs.readFileSync(filename, "utf8"));
  assert.equal(exported.assumptions.lag, 3);
  assert.equal(exported.draft.purchases[0].start, 30);
  assert.equal(
    exported.status,
    "unverified_manual_simulation_not_factory_plan",
  );
  assert(exported.evaluation.issues.length > 0);

  await page.getByRole("button", { name: "Reset to initial draft" }).click();
  await page.getByRole("dialog", { name: "Replace manual draft" }).waitFor();
  await page.keyboard.press("Escape");
  assert.equal(
    await arrival.getAttribute("data-start"),
    "30",
    "Cancel reset must preserve edits",
  );
  await page.getByRole("button", { name: "Reset to initial draft" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm", exact: true })
    .click();
  assert.equal(await arrival.getAttribute("data-start"), "0");
  assert.equal(errors.length, 0, errors.join("\n"));
  await browser.close();
  console.log(
    "PASS: day-snapped pointer and keyboard dragging, live impact, resize, undo/redo, checks, date edits, monthly pricing, persistent draft, view preservation, export and reset confirmation.",
  );
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
