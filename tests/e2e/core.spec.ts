import { expect, test, type Page } from "@playwright/test";

/** Navigate and wait until React has hydrated (typing earlier would be lost). */
async function go(page: Page, url: string) {
  await page.goto(url);
  await page.locator("html[data-hydrated]").waitFor({ state: "attached" });
}

async function stockOf(page: Page, name: string): Promise<string> {
  await go(page, "/inventory");
  await page.getByLabel("Search products").fill(name);
  const row = page.getByRole("link", { name: new RegExp(name) }).first();
  await expect(row).toBeVisible();
  return (await row.textContent()) ?? "";
}

test("dashboard shows today's numbers and quick actions", async ({ page }) => {
  await go(page, "/dashboard");
  await expect(page.getByRole("heading", { name: /E2E General Store/ })).toBeVisible();
  await expect(page.getByText("Today's Sales")).toBeVisible();
  await expect(page.getByRole("button", { name: /Talk to DukaanOS/ }).first()).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Quick actions" })).toBeVisible();
});

test("create a product with opening stock", async ({ page }) => {
  await go(page, "/products/new");
  await page.getByLabel("Product name").fill("Maggi 70g");
  await page.getByLabel("Selling price").fill("14");
  await page.getByLabel(/Opening stock/).fill("50");
  await page.getByRole("button", { name: "Add product" }).click();
  await expect(page).toHaveURL(/\/inventory\//);
  await expect(page.getByRole("heading", { name: "Maggi 70g" })).toBeVisible();
  await expect(page.getByText("Opening stock", { exact: true })).toBeVisible();
});

test("create a sale from the POS and see stock go down", async ({ page }) => {
  expect(await stockOf(page, "Pepsi 500ml")).toContain("20");
  await go(page, "/sales/new");
  const pepsi = page.getByRole("region", { name: "Products" }).getByRole("button", { name: /Pepsi 500ml/ });
  await pepsi.click();
  await pepsi.click();
  await page.getByRole("button", { name: /Checkout/ }).click();
  await page.getByRole("button", { name: /Confirm Sale/ }).click();
  await expect(page.getByRole("heading", { name: "Sale saved ✓" })).toBeVisible();
  await expect(page.getByText(/INV-\d+/)).toBeVisible();
  expect(await stockOf(page, "Pepsi 500ml")).toContain("18");
});

test("record a purchase and see stock go up", async ({ page }) => {
  await go(page, "/purchases/new");
  await page.getByLabel("Search product to add").fill("Bread");
  await page.getByRole("button", { name: /Bread 400g/ }).click();
  await page.getByRole("button", { name: /Save purchase/ }).click();
  await expect(page.getByRole("heading", { name: "Purchase saved ✓" })).toBeVisible();
  expect(await stockOf(page, "Bread 400g")).toContain("16");
});

test("customer khata: udhaar then payment", async ({ page }) => {
  await go(page, "/customers");
  await page.getByRole("link", { name: /Ramesh/ }).click();
  await page.getByRole("button", { name: "Add udhaar" }).click();
  await page.getByLabel("Amount").fill("850");
  await page.getByRole("button", { name: "Add udhaar" }).last().click();
  await expect(page.getByText("₹850.00").first()).toBeVisible();

  await page.getByRole("button", { name: "Payment received" }).click();
  await page.getByLabel("Amount").fill("500");
  await page.getByRole("button", { name: "Save payment" }).click();
  await expect(page.getByText("₹350.00").first()).toBeVisible();
});

test("voice intent: understand → confirm → stock updated", async ({ page }) => {
  await go(page, "/dashboard");
  await page.getByRole("button", { name: "Talk to DukaanOS (voice assistant)" }).click();
  const dialog = page.getByRole("dialog");
  // Headless browsers have no microphone: use the typed fallback (same pipeline).
  await dialog.getByRole("button", { name: "Type instead" }).click();
  await dialog.getByLabel("Type your command").fill("Aaj 3 Coke 500ml biki");
  await dialog.getByRole("button", { name: "Send" }).click();
  await expect(dialog.getByText("Stock impact")).toBeVisible();
  await expect(dialog.getByText("Coke 500ml").first()).toBeVisible();
  await dialog.getByRole("button", { name: /Sale confirm karein|Confirm Sale/ }).click();
  await expect(dialog.getByText(/Ho gaya ✓/)).toBeVisible();
  await expect(dialog.getByText(/Coke 500ml: 31/)).toBeVisible();
});

test("voice asks which product when ambiguous (never guesses)", async ({ page }) => {
  await go(page, "/ai");
  await page.getByLabel("Message").fill("2 Sprite biki");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Kaunsa Sprite?")).toBeVisible();
  await page.getByRole("button", { name: /Sprite 250ml/ }).click();
  await expect(page.getByText("Stock impact")).toBeVisible();
  await page.getByRole("button", { name: /Cancel/ }).last().click();
  await expect(page.getByText(/nothing was saved/)).toBeVisible();
});
