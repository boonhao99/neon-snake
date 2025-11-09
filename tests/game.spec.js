const { test, expect } = require("@playwright/test");

test.describe("Neon Snake", () => {
  const getState = (page) => page.evaluate(() => window.__neonSnake.getState());

  test.beforeEach(async ({ page }) => {
    page.on("console", (msg) => console.log(`[browser:${msg.type()}] ${msg.text()}`));
  });

  test("starts on input and snake begins to move", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => window.__neonSnakeReady || window.__neonSnake);
    const status = page.locator("#status-panel");
    await expect(status).toBeVisible();

    await page.click("#board");
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(() => window.__neonSnake.isOverlayHidden());

    const before = await getState(page);
    await page.waitForTimeout(300);
    const after = await getState(page);

    expect(after.running).toBeTruthy();
    expect(after.snake[0].x).toBeGreaterThan(before.snake[0].x);
  });

  test("reset button stops the game and shows overlay again", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => window.__neonSnakeReady || window.__neonSnake);
    await page.click("#board");
    await page.keyboard.press("ArrowUp");
    await page.waitForFunction(() => window.__neonSnake.isOverlayHidden());

    await page.click("#reset-btn");
    await expect(page.locator("#status-panel")).toBeVisible();
    await expect(page.locator("#score")).toHaveText("0");
  });
});
