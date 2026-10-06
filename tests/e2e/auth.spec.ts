import { expect, test, type Page } from "@playwright/test";

async function go(page: Page, url: string) {
  await page.goto(url);
  await page.locator("html[data-hydrated]").waitFor({ state: "attached" });
}

test("signup → onboarding → dashboard, then logout and login", async ({ page }) => {
  const mobile = `97${String(Date.now()).slice(-8)}`;
  await go(page, "/signup");
  await page.getByLabel("Your name").fill("Asha Verma");
  await page.getByLabel("Mobile number").fill(mobile);
  await page.getByLabel("Password", { exact: true }).fill("asha-password-1");
  await page.getByLabel("Business name").fill("Asha Kirana");
  await page.getByLabel("City").fill("Pune");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/onboarding/);
  await expect(page.getByRole("heading", { name: "Tell us about your business" })).toBeVisible();
  await page.getByRole("button", { name: /Continue/ }).click();
  await expect(page.getByRole("heading", { name: "How do you run your business?" })).toBeVisible();
  await page.getByRole("radio", { name: /Grocery/ }).click();
  await page.getByRole("button", { name: /Continue/ }).click();
  await expect(page.getByRole("heading", { name: "Add your first products" })).toBeVisible();
  await page.getByRole("button", { name: "Add sample products" }).click();
  await expect(page.getByText("You have products — great!")).toBeVisible();
  await page.getByRole("button", { name: /Continue/ }).click();
  await expect(page.getByRole("heading", { name: "Meet your AI assistant" })).toBeVisible();
  await page.getByRole("button", { name: /Start using DukaanOS/ }).click();

  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { name: /Asha Kirana/ })).toBeVisible();

  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.getByLabel("Mobile number or email").fill(mobile);
  await page.getByLabel("Password", { exact: true }).fill("asha-password-1");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
});

test("rejects a wrong password with a clear message", async ({ page }) => {
  await go(page, "/login");
  await page.getByLabel("Mobile number or email").fill("9999999999");
  await page.getByLabel("Password", { exact: true }).fill("not-the-password");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("alert")).toContainText("incorrect");
});

test("protected pages redirect to login", async ({ page }) => {
  await go(page, "/sales");
  await expect(page).toHaveURL(/\/login/);
});
