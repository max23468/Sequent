import { expect, test } from "@playwright/test";

const password = "FondazioneM2Sicura2026";

async function authenticate(page: import("@playwright/test").Page) {
  await page.goto("/");
  if (page.url().endsWith("/setup")) {
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByLabel("Ripeti la password").fill(password);
    await page.getByRole("button", { name: "Crea account" }).click();
    return;
  }
  if (page.url().endsWith("/login")) {
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Accedi" }).click();
  }
}

test("crea una pratica e usa il workspace minimo", async ({ page }) => {
  await authenticate(page);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByText("Nessuna verifica da mostrare.")).toBeVisible();
  await page.getByRole("button", { name: "Nuova pratica" }).click();
  await page.getByLabel("Nome della pratica").fill("Pratica sintetica E2E");
  await page.getByRole("button", { name: "Crea pratica" }).click();
  await expect(page).toHaveURL(/\/pratiche\/.+/);
  await expect(page.getByRole("heading", { name: "Pratica sintetica E2E" })).toBeVisible();
  await expect(page.getByText("Nessun documento caricato.")).toBeVisible();
});

test("ricerca una pratica e mostra istruzioni per il launcher non qualificato", async ({
  page,
}) => {
  await authenticate(page);
  await page.getByPlaceholder("Cerca in Sequent").fill("sintetica");
  await expect(
    page.locator(".search-results").getByRole("link", { name: /Pratica sintetica E2E/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Desktop Telematico" }).click();
  await expect(page.getByRole("heading", { name: "Desktop Telematico" })).toBeVisible();
  await expect(page.getByText(/non invia dati/)).toBeVisible();
});

test("su mobile nasconde i launcher e mantiene le azioni interne", async ({ page }) => {
  await page.setViewportSize({ width: 402, height: 874 });
  await authenticate(page);
  await expect(
    page.getByRole("navigation", { name: "Navigazione principale mobile" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Desktop Telematico" })).toBeHidden();
  await page.getByRole("button", { name: "Azioni rapide" }).click();
  await expect(page.getByRole("button", { name: "Carica documenti" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Riprendi ultima pratica" })).toBeVisible();
});

test("su mobile carica un documento senza interferenze dalla navigazione fissa", async ({
  page,
}) => {
  await page.setViewportSize({ width: 402, height: 874 });
  await authenticate(page);
  await page.getByRole("link", { name: /Pratica sintetica E2E/ }).click();
  await page.getByLabel("Aggiungi un documento").setInputFiles({
    name: "documento-sintetico.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("fixture sintetica per il caricamento mobile"),
  });
  await page.getByRole("button", { name: "Carica" }).click();

  await expect(page).toHaveURL(/documento=/);
  await expect(page.getByRole("heading", { name: "documento-sintetico.txt" })).toBeVisible();
});
