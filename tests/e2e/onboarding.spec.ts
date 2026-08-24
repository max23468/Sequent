import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { join } from "node:path";

test.describe.configure({ mode: "serial" });

const password = "FondazioneM2Sicura2026";
const suffix = `${process.pid}-${Date.now()}`;
const practiceTitle = `Pratica sintetica ${suffix}`;
const uploadedPracticeTitle = `Pratica da upload ${suffix}`;
const documentName = `documento-${suffix}.txt`;

test.afterEach(() => {
  const databasePath = join(process.env.SEQUENT_E2E_DATA_DIR ?? ".test-data/e2e", "sequent.sqlite");
  if (!existsSync(databasePath)) return;
  const database = new Database(databasePath);
  database
    .prepare(
      `UPDATE jobs
       SET status = 'completed', progress = 100, error_code = NULL, updated_at = ?
       WHERE type = 'foundation.verify_blob' AND error_code = 'BLOB_HASH_MISMATCH'`,
    )
    .run(new Date().toISOString());
  database.close();
});

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

async function openAccountMenu(page: import("@playwright/test").Page) {
  await page.getByLabel("Apri menu utente").click();
}

test("crea una pratica e usa il workspace minimo", async ({ page }) => {
  await authenticate(page);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByText("Nessuna verifica da mostrare.")).toBeVisible();
  await page.getByRole("button", { name: "Nuova pratica" }).click();
  await page.getByLabel("Nome della pratica").fill(practiceTitle);
  await page.getByRole("button", { name: "Crea pratica" }).click();
  await expect(page).toHaveURL(/\/pratiche\/.+/);
  await expect(page.getByRole("heading", { name: practiceTitle })).toBeVisible();
  await expect(page.getByText("Revisione 1")).toBeVisible();
  await expect(page.getByText("Nessun documento caricato.")).toBeVisible();
});

test("esercita tutte le azioni desktop e i due percorsi di upload", async ({ page }) => {
  await authenticate(page);
  await expect(page.getByRole("link", { name: "Riprendi ultima pratica" })).toBeVisible();

  await page.getByRole("button", { name: "Desktop Telematico" }).click();
  await expect(page.getByRole("heading", { name: "Desktop Telematico" })).toBeVisible();
  await expect(page.getByText(/non invia dati/)).toBeVisible();
  await page.getByRole("button", { name: "Chiudi" }).click();

  await page.getByRole("button", { name: "SuccessioniOnLine" }).click();
  await expect(page.getByRole("heading", { name: "SuccessioniOnLine" })).toBeVisible();
  await expect(page.getByText(/OpenWebStart/)).toBeVisible();
  await page.getByRole("button", { name: "Chiudi" }).click();

  await page.getByRole("button", { name: "Carica documenti" }).click();
  await page.getByLabel("Pratica esistente").selectOption({ label: practiceTitle });
  await page.getByLabel("Documento").setInputFiles({
    name: documentName,
    mimeType: "text/plain",
    buffer: Buffer.from("fixture sintetica per il caricamento desktop"),
  });
  await page.getByRole("button", { name: "Carica", exact: true }).click();
  await expect(page).toHaveURL(/documento=/);
  await expect(page.getByRole("heading", { name: documentName })).toBeVisible();

  await page.goto("/");
  await page.getByRole("button", { name: "Carica documenti" }).click();
  await page.getByLabel("Nome della nuova pratica").fill(uploadedPracticeTitle);
  await page.getByLabel("Documento").setInputFiles({
    name: `nuova-pratica-${suffix}.txt`,
    mimeType: "text/plain",
    buffer: Buffer.from("fixture sintetica con pratica creata dall’upload"),
  });
  await page.getByRole("button", { name: "Carica", exact: true }).click();
  await expect(page.getByRole("heading", { name: uploadedPracticeTitle })).toBeVisible();
});

test("ricerca da tastiera una pratica e un documento", async ({ page }) => {
  await authenticate(page);
  await page.getByRole("link", { name: "Impostazioni" }).focus();
  await page.keyboard.press("Tab");
  const search = page.getByPlaceholder("Cerca in Sequent");
  await expect(search).toBeFocused();
  await search.fill(practiceTitle);
  await expect(
    page.locator(".search-results").getByRole("link", { name: new RegExp(practiceTitle) }),
  ).toBeVisible();
  await search.press("Escape");
  await expect(page.locator(".search-results")).toBeHidden();

  await search.fill(documentName);
  await expect(
    page.locator(".search-results").getByRole("link", { name: new RegExp(documentName) }),
  ).toBeVisible();
  await search.press("Enter");
  await expect(page).toHaveURL(/\/pratiche\/.+\?documento=/);
  await expect(page.getByRole("heading", { name: documentName })).toBeVisible();
});

test("mostra una verifica tecnica fallita nella Dashboard e nella pratica", async ({ page }) => {
  await authenticate(page);
  const dataDirectory = process.env.SEQUENT_E2E_DATA_DIR ?? ".test-data/e2e";
  const database = new Database(join(dataDirectory, "sequent.sqlite"));
  const failedAt = new Date().toISOString();
  const result = database
    .prepare(
      `UPDATE jobs
       SET status = 'failed', attempts = 3, progress = 0,
           error_code = 'BLOB_HASH_MISMATCH', updated_at = ?
       WHERE document_id = (SELECT id FROM documents WHERE original_name = ?)`,
    )
    .run(failedAt, documentName);
  expect(result.changes).toBe(1);
  database.close();

  await page.goto("/");
  const issue = page.getByRole("link", {
    name: new RegExp(`Verifica tecnica non riuscita.*${documentName}`),
  });
  await expect(issue).toBeVisible();
  await issue.click();
  await expect(page.getByRole("alert")).toContainText("Verifica tecnica non riuscita");
  await expect(page.getByRole("alert").getByRole("link", { name: documentName })).toBeVisible();
});

test("persiste i temi chiaro e scuro e ripristina il tema di sistema", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await authenticate(page);
  await expect(page.locator("html")).not.toHaveAttribute("data-theme");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(15, 18, 20)");

  await openAccountMenu(page);
  await page.getByRole("button", { name: "Chiaro" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await openAccountMenu(page);
  await page.getByRole("button", { name: "Scuro" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await openAccountMenu(page);
  await page.getByRole("button", { name: "Sistema" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(15, 18, 20)");
});

test("su mobile nasconde i launcher e mantiene soltanto le azioni interne", async ({ page }) => {
  await page.setViewportSize({ width: 402, height: 874 });
  await authenticate(page);
  await expect(
    page.getByRole("navigation", { name: "Navigazione principale mobile" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Nuova", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Desktop Telematico" })).toBeHidden();
  await expect(page.getByRole("button", { name: "SuccessioniOnLine" })).toBeHidden();
  await page.getByRole("button", { name: "Azioni rapide" }).click();
  const quickActions = page.locator(".quick-actions-popover");
  await expect(quickActions.getByRole("button", { name: "Carica documenti" })).toBeVisible();
  await expect(quickActions.getByRole("link", { name: "Riprendi ultima pratica" })).toBeVisible();
  await expect(quickActions.getByRole("button")).toHaveCount(1);
  await expect(quickActions.getByRole("link")).toHaveCount(1);
});

test("su mobile carica un documento senza interferenze dalla navigazione fissa", async ({
  page,
}) => {
  await page.setViewportSize({ width: 402, height: 874 });
  await authenticate(page);
  await page.getByRole("link", { name: uploadedPracticeTitle }).click();
  const mobileDocumentName = `mobile-${documentName}`;
  await page.getByLabel("Aggiungi un documento").setInputFiles({
    name: mobileDocumentName,
    mimeType: "text/plain",
    buffer: Buffer.from("fixture sintetica per il caricamento mobile"),
  });
  await page.getByRole("button", { name: "Carica", exact: true }).click();

  await expect(page).toHaveURL(/documento=/);
  await expect(page.getByRole("heading", { name: mobileDocumentName })).toBeVisible();
});

test("il design lab mobile segue la tavola senza overflow", async ({ page }) => {
  await page.setViewportSize({ width: 402, height: 874 });
  await authenticate(page);
  await page.goto("/__design");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Nuova", exact: true })).toBeVisible();
  const checks = page.locator(".lab-checks");
  await expect(checks.getByText("PR-2026-046", { exact: true })).toBeVisible();
  await expect(checks.getByText("PR-2026-045", { exact: true })).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("chiude la sessione e consente un nuovo accesso", async ({ page }) => {
  await authenticate(page);
  await openAccountMenu(page);
  await page.getByRole("button", { name: "Esci" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Accedi" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});
