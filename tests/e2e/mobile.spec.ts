import { expect, test, type Page } from "@playwright/test";

async function go(page: Page, url: string) {
  await page.goto(url);
  await page.locator("html[data-hydrated]").waitFor({ state: "attached" });
}

test("mobile layout: bottom nav, floating mic, no horizontal scroll", async ({ page }) => {
  await go(page, "/dashboard");
  const nav = page.getByRole("navigation", { name: "Main" }).last();
  await expect(nav).toBeVisible();
  for (const tab of ["Home", "Sales", "Inventory", "Khata", "More"]) await expect(nav.getByText(tab, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Talk to Suvakta (voice assistant)" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  await nav.getByText("Khata", { exact: true }).click();
  await expect(page).toHaveURL(/\/customers/);
  await nav.getByText("More", { exact: true }).click();
  await expect(page.getByRole("link", { name: "Reports" })).toBeVisible();
});

test("mobile POS sale via sticky checkout bar", async ({ page }) => {
  await go(page, "/sales/new");
  await page.getByRole("region", { name: "Products" }).getByRole("button", { name: /Lay's Chips/ }).click();
  await page.getByRole("button", { name: /1 item/ }).click();
  await page.getByRole("button", { name: /Confirm Sale/ }).click();
  await expect(page.getByRole("heading", { name: "Sale saved ✓" })).toBeVisible();
});
