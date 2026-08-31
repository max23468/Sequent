import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import {
  authenticate,
  createPracticeFromDashboard,
  openPracticeSection,
  resetFailedBlobVerification,
  unique,
  uploadFromWorkspace,
} from "./onboarding-support.ts";

test.describe.configure({ mode: "serial" });
test.afterEach(resetFailedBlobVerification);

test("conserva separatamente gli artefatti del flusso ufficiale", async ({ page, browserName }) => {
  test.skip(
    browserName !== "chromium",
    "Il contratto server è coperto dalle regressioni di integrazione.",
  );
  const practiceTitle = unique("Pratica flusso ufficiale");
  await authenticate(page);
  await createPracticeFromDashboard(page, practiceTitle);
  await openPracticeSection(page, "Invio e ricevute");

  await expect(page.getByRole("heading", { name: "Pratica modificabile" })).toBeVisible();
  await expect(page.getByText("DIZ non attivo", { exact: true })).toBeVisible();
  await page.getByLabel("Tipo").selectOption("receipt-first");
  const artifactFile = page.locator(".official-artifact-form input[type=file]");
  await artifactFile.setInputFiles({
    name: "prima-ricevuta-sintetica.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\nricevuta sintetica\n%%EOF", "ascii"),
  });
  await expect
    .poll(() => artifactFile.evaluate((input: HTMLInputElement) => input.files?.length))
    .toBe(1);
  await page.getByRole("button", { name: "Acquisisci esito" }).click();

  await expect(
    page.getByText("Trasmessa; registrazione da verificare", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Prima ricevuta · trasmissione", { exact: true })).toBeVisible();
  await expect(page.getByText(/prima-ricevuta-sintetica\.pdf/)).toBeVisible();
  await expect(page.getByText(/^SHA-256 [a-f0-9]{64}$/)).toBeVisible();
});

test("crea un backup manuale verificato dalle impostazioni", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "La copia completa viene provata una volta per runtime.");
  await authenticate(page);
  await page.goto("/impostazioni");
  await page.getByRole("button", { name: "Crea backup" }).click();
  await expect(page.getByText("Backup creato e verificato.")).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(page.getByText(/Ultimo backup:/)).toBeVisible();
});

test("l’intestazione della pratica resta compatta e consente di rinominarla", async ({ page }) => {
  const initialTitle = unique("Pratica da rinominare");
  const renamedTitle = unique("Pratica rinominata");
  await authenticate(page);
  await createPracticeFromDashboard(page, initialTitle);
  await openPracticeSection(page, "Panoramica");
  await expect(page.getByRole("heading", { name: "Panoramica", exact: true })).toBeVisible();

  const practiceHeading = page.locator(".practice-heading");
  await expect(practiceHeading.getByRole("link", { name: "Dashboard", exact: true })).toHaveCount(
    0,
  );
  await expect(practiceHeading.getByText(/Revisione \d+/)).toHaveCount(0);
  await expect(page.getByText("Vista operativa", { exact: true })).toHaveCSS(
    "white-space",
    "nowrap",
  );

  await page.getByText("Azioni", { exact: true }).click();
  await page.getByRole("button", { name: "Rinomina pratica" }).click();
  const titleInput = page.getByLabel("Nome della pratica");
  await expect(titleInput).toHaveValue(initialTitle);
  await titleInput.fill(renamedTitle);
  await page.getByRole("button", { name: "Salva", exact: true }).click();

  await expect(page.getByRole("heading", { name: renamedTitle })).toBeVisible();
  await expect(page).toHaveTitle(`${renamedTitle} · Sequent`);
  await expect(page.getByRole("heading", { name: "Panoramica", exact: true })).toBeVisible();
  await expect(page.getByText("Salvato", { exact: true })).toBeVisible();
});

test("rende una pratica selezionata disponibile offline e sincronizza un allegato in coda", async ({
  page,
  context,
  browserName,
}) => {
  // Il caso attraversa due cicli offline/online con reload e può superare il timeout
  // standard sotto carico, pur avendo già raggiunto lo stato finale verificabile.
  test.slow();
  const practiceTitle = unique("Pratica offline selettiva");
  await authenticate(page);
  await createPracticeFromDashboard(page, practiceTitle);
  await openPracticeSection(page, "Documenti");
  await page.getByRole("button", { name: "Scarica offline" }).click();
  await expect(page.getByText("Pratica disponibile offline su questo dispositivo.")).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByRole("button", { name: "Rimuovi offline" })).toBeVisible();
  const offlineUrl = page.url();
  await context.setOffline(true);
  if (browserName === "webkit") {
    await page.evaluate(() => window.location.reload()).catch(() => undefined);
    await page.waitForLoadState("domcontentloaded");
  } else {
    await page.goto(offlineUrl, { waitUntil: "domcontentloaded" });
  }
  await expect(page.getByRole("heading", { name: practiceTitle })).toBeVisible();
  await expect(page.getByText("Offline", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Salva documenti richiesti" }).click();
  await expect(
    page.getByText(
      "Questa funzione richiede la connessione. I dati già conservati offline non sono stati modificati.",
    ),
  ).toBeVisible();
  if (browserName === "webkit") {
    await context.setOffline(false);
  }
  await page.getByLabel("Aggiungi un documento").setInputFiles({
    name: "allegato-offline.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("allegato sintetico accodato offline"),
  });
  if (browserName === "webkit") {
    await page.evaluate(() =>
      Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false }),
    );
  }
  await page.getByRole("button", { name: "Carica", exact: true }).click();
  await expect(
    page.getByText("Allegato conservato sul dispositivo e in attesa di sincronizzazione."),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/1 modifica in coda/)).toBeVisible();

  if (browserName === "webkit") {
    await page.evaluate(() => {
      Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
      window.dispatchEvent(new Event("online"));
    });
  } else {
    await context.setOffline(false);
  }
  await expect(page.getByText("Copia offline aggiornata.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "allegato-offline.txt" })).toBeVisible();

  await openPracticeSection(page, "Panoramica");
  await expect(page).toHaveURL(/sezione=overview/);
  const field = page.getByRole("checkbox", {
    name: /Dichiaro di non voler dar corso alle conseguenti volture catastali/,
  });
  await expect(field).toBeVisible();
  const fieldForm = field.locator("xpath=ancestor::form");
  const fieldOfflineUrl = page.url();
  await context.setOffline(true);
  if (browserName === "webkit") {
    await page.evaluate(() => window.location.reload()).catch(() => undefined);
    await page.waitForLoadState("domcontentloaded");
  } else {
    await page.goto(fieldOfflineUrl, { waitUntil: "domcontentloaded" });
  }
  await expect(field).toBeVisible();
  await field.check();
  await fieldForm
    .getByRole("checkbox", { name: "Confermo di aver verificato queste indicazioni" })
    .check();
  await fieldForm.getByRole("button", { name: "Salva questi dati" }).click();
  await expect(
    page.getByText("Modifica conservata sul dispositivo e in attesa di sincronizzazione."),
  ).toBeVisible({ timeout: 15_000 });

  await context.setOffline(false);
  await expect(page.getByText("Copia offline aggiornata.")).toBeVisible({ timeout: 30_000 });
  await expect(field).toBeChecked();
  await context.setOffline(true);
  if (browserName === "webkit") {
    await page.evaluate(() => window.location.reload()).catch(() => undefined);
    await page.waitForLoadState("domcontentloaded");
  } else {
    await page.reload({ waitUntil: "domcontentloaded" });
  }
  await expect(field).toBeChecked();
  await context.setOffline(false);
});

test("protegge spazio locale, restore del server, recovery export e rimozione della copia", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "I casi trasversali girano una volta; WebKit è coperto dal flusso offline completo.",
  );
  const practiceTitle = unique("Pratica recovery offline");
  await authenticate(page);
  await createPracticeFromDashboard(page, practiceTitle);
  await page.evaluate(() => {
    Object.defineProperty(navigator.storage, "estimate", {
      configurable: true,
      value: async () => ({ quota: 1, usage: 0 }),
    });
  });
  await page.getByRole("button", { name: "Scarica offline" }).click();
  await expect(page.getByText(/Spazio locale insufficiente/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Scarica offline" })).toBeVisible();

  await page.reload();
  const seedField = page.getByRole("checkbox", {
    name: /Dichiaro di non voler dar corso alle conseguenti volture catastali/,
  });
  const seedForm = seedField.locator("xpath=ancestor::form");
  await seedField.check();
  await seedForm
    .getByRole("checkbox", { name: "Confermo di aver verificato queste indicazioni" })
    .check();
  await seedForm.getByRole("button", { name: "Salva questi dati" }).click();
  await expect(seedField).toBeChecked();
  await page.getByRole("button", { name: "Scarica offline" }).click();
  await expect(page.getByText("Pratica disponibile offline su questo dispositivo.")).toBeVisible({
    timeout: 60_000,
  });
  const practiceId = page.url().match(/\/pratiche\/([^?]+)/)?.[1];
  if (!practiceId) throw new Error("Identificativo della pratica recovery non disponibile");

  const field = page.getByRole("checkbox", {
    name: /Dichiaro di non voler dar corso alle conseguenti volture catastali/,
  });
  const fieldForm = field.locator("xpath=ancestor::form");
  await context.setOffline(true);
  await field.uncheck();
  await fieldForm
    .getByRole("checkbox", { name: "Confermo di aver verificato queste indicazioni" })
    .check();
  await fieldForm.getByRole("button", { name: "Salva questi dati" }).click();
  await expect(page.getByText(/1 modifica in coda/)).toBeVisible();

  const databasePath = join(process.env.SEQUENT_E2E_DATA_DIR ?? ".test-data/e2e", "sequent.sqlite");
  const database = new Database(databasePath);
  database
    .prepare("UPDATE declarations SET revision = revision - 1 WHERE practice_id = ?")
    .run(practiceId);
  database.close();

  await context.setOffline(false);
  await expect(page.getByText("Conflitto tra server e modifiche locali")).toBeVisible({
    timeout: 30_000,
  });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Esporta copia locale" }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error("Archivio recovery non disponibile");
  const archive = unzipSync(readFileSync(downloadPath));
  const manifest = JSON.parse(strFromU8(archive["manifest.json"]!)) as {
    format: string;
    practice: { id: string };
    mutations: unknown[];
  };
  expect(manifest).toMatchObject({
    format: "sequent-offline-recovery",
    practice: { id: practiceId },
  });
  expect(manifest.mutations).toHaveLength(1);

  await page.getByRole("button", { name: "Mantieni versione server" }).click();
  await expect(page.getByText("Conflitto tra server e modifiche locali")).toHaveCount(0);
  await page.getByRole("button", { name: "Rimuovi offline" }).click();
  await expect(page.getByRole("button", { name: "Scarica offline" })).toBeVisible();
  await context.setOffline(true);
  const unavailable = await page.goto(page.url(), { waitUntil: "domcontentloaded" });
  expect(unavailable?.status()).toBe(503);
  await expect(page.getByText("Questa pagina non è disponibile offline.")).toBeVisible();
});

test("non promuove come completa una copia con documenti mancanti", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "Il caso di errore di download è indipendente dal motore.");
  const practiceTitle = unique("Pratica offline parziale");
  await authenticate(page);
  await createPracticeFromDashboard(page, practiceTitle);
  await uploadFromWorkspace(page, "fonte-offline.txt");
  const documentId = new URL(page.url()).searchParams.get("documento");
  if (!documentId) throw new Error("Documento sintetico offline non disponibile");
  await context.route("**/api/documents/*/content", (route) => route.abort("failed"));
  await page.getByRole("button", { name: "Scarica offline" }).click();
  await expect(
    page.getByText(
      "Download incompleto. La copia parziale non viene indicata come disponibile offline.",
    ),
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Scarica offline" })).toBeVisible();

  await context.unroute("**/api/documents/*/content");
  await page.getByRole("button", { name: "Scarica offline" }).click();
  await expect(page.getByText("Pratica disponibile offline su questo dispositivo.")).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByRole("button", { name: "Rimuovi offline" })).toBeVisible();
  await context.setOffline(true);
  const offlineDocument = await page.goto(`/api/documents/${documentId}/content`);
  expect(offlineDocument?.status()).toBe(200);
  const offlineHeaders = await offlineDocument?.allHeaders();
  expect(offlineHeaders?.["x-content-type-options"]).toBe("nosniff");
  expect(offlineHeaders?.["content-security-policy"]).toBe(
    "sandbox; default-src 'none'; style-src 'unsafe-inline'",
  );
  expect(offlineHeaders?.["cache-control"]).toBe("private, no-store");
  await expect(page.getByText("fixture sintetica indipendente")).toBeVisible();
});
