import { expect, test } from "@playwright/test";

test("crea l’account owner e la prima pratica", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/setup$/);
  await page.getByLabel("Password", { exact: true }).fill("FondazioneM2Sicura2026");
  await page.getByLabel("Ripeti la password").fill("FondazioneM2Sicura2026");
  await page.getByRole("button", { name: "Crea account" }).click();
  await expect(page.getByRole("heading", { name: "Le tue pratiche" })).toBeVisible();
  await page.getByRole("button", { name: /Crea pratica/ }).click();
  await page.getByLabel("Nome della pratica").fill("Pratica sintetica E2E");
  await page.getByRole("button", { name: "Salva" }).click();
  await expect(page.getByText("Pratica sintetica E2E")).toBeVisible();
});
