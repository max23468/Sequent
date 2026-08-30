import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { saveCanonicalFieldsFromView } from "../../src/lib/server/canonical-field-views.ts";
import { closeDatabase, openDatabase } from "../../src/lib/server/database.ts";
import {
  confirmCalculationRun,
  confirmDevolutionScenario,
  createSharedAsset,
  createSharedSubject,
  runSuccessionCalculation,
  saveDevolutionScenario,
} from "../../src/lib/server/domain.ts";
import { createSuccessiveDeclaration, getDeclaration } from "../../src/lib/server/practices.ts";
import { strFromU8, unzipSync } from "fflate";

test.describe.configure({ mode: "serial" });

const password = "SequentSviluppoSicuro2026";
const username = "Sviluppo";
const suffix = `${process.pid}-${Date.now()}`;

function unique(label: string) {
  return `${label} ${suffix}`;
}

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
    await page.getByLabel("Nome utente").fill(username);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByLabel("Ripeti la password").fill(password);
    await page.getByRole("button", { name: "Crea account" }).click();
  } else if (page.url().endsWith("/login")) {
    await page.getByLabel("Nome utente").fill(username.toUpperCase());
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Accedi" }).click();
  }
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

async function openAccountMenu(page: import("@playwright/test").Page) {
  await page.getByLabel("Apri menu utente").click();
}

async function createPracticeFromDashboard(
  page: import("@playwright/test").Page,
  practiceTitle: string,
) {
  await page.goto("/");
  await page.getByRole("button", { name: /^Nuova(?: pratica)?$/ }).click();
  await page.getByLabel("Nome della pratica").fill(practiceTitle);
  await page.getByRole("button", { name: "Crea pratica" }).click();
  await expect(page.getByRole("heading", { name: practiceTitle })).toBeVisible();
}

async function openPracticeSection(page: import("@playwright/test").Page, name: string) {
  const section = page.getByRole("button", { name, exact: true });
  if (!(await section.isVisible())) {
    await page.getByRole("button", { name: /Apri il menu Sezioni/ }).click();
  }
  await section.click();
}

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

async function uploadFromWorkspace(
  page: import("@playwright/test").Page,
  documentName: string,
  content = "fixture sintetica indipendente",
) {
  await openPracticeSection(page, "Documenti");
  await page.getByLabel("Aggiungi un documento").setInputFiles({
    name: documentName,
    mimeType: "text/plain",
    buffer: Buffer.from(content),
  });
  await page.getByRole("button", { name: "Carica", exact: true }).click();
  await expect(page).toHaveURL(/documento=/);
  await expect(page.getByRole("heading", { name: documentName })).toBeVisible();
}

test("rende una pratica selezionata disponibile offline e sincronizza un allegato in coda", async ({
  page,
  context,
  browserName,
}) => {
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
  const fieldForm = field.locator("xpath=ancestor::form");
  const fieldOfflineUrl = page.url();
  await context.setOffline(true);
  if (browserName === "webkit") {
    await page.evaluate(() => window.location.reload()).catch(() => undefined);
    await page.waitForLoadState("domcontentloaded");
  } else {
    await page.goto(fieldOfflineUrl, { waitUntil: "domcontentloaded" });
  }
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
  await expect(page.getByText("fixture sintetica indipendente")).toBeVisible();
});

async function confirmOfficialInstructions(button: import("@playwright/test").Locator) {
  const confirmation = button
    .locator("xpath=ancestor::form")
    .getByRole("checkbox", { name: "Confermo di aver verificato queste indicazioni" });
  if ((await confirmation.count()) > 0) await confirmation.check();
}

function prepareConfirmedAutomaticFields(practiceId: string) {
  const dataDirectory = process.env.SEQUENT_E2E_DATA_DIR ?? ".test-data/e2e";
  const database = openDatabase(dataDirectory);
  const declaration = database
    .prepare("SELECT id FROM declarations WHERE practice_id = ? ORDER BY sequence ASC LIMIT 1")
    .get(practiceId) as { id: string } | undefined;
  if (!declaration) throw new Error("Dichiarazione sintetica E2E non trovata");
  const decedent = createSharedSubject(database, practiceId, {
    role: "decedent",
    displayName: "Defunto automatici E2E",
  });
  const beneficiary = createSharedSubject(database, practiceId, {
    role: "beneficiary",
    displayName: "Beneficiario automatici E2E",
  });
  const company = createSharedAsset(database, practiceId, {
    kind: "company",
    displayName: "Azienda automatica E2E",
    valueCents: 20_000_000n,
  });
  let revision = getDeclaration(database, declaration.id, practiceId)!.revision;
  revision = saveCanonicalFieldsFromView(database, {
    practiceId,
    declarationId: declaration.id,
    expectedRevision: revision,
    view: { kind: "quadri", quadro: "EA" },
    entityId: beneficiary.id,
    fields: [
      { fieldId: "quadro-ea.soggetto.tipo", value: "1" },
      { fieldId: "quadro-ea.soggetto.grado-parentela", value: "10" },
    ],
    confirmOfficialRules: true,
  }).revision;
  revision = saveCanonicalFieldsFromView(database, {
    practiceId,
    declarationId: declaration.id,
    expectedRevision: revision,
    view: { kind: "quadri", quadro: "Frontespizio" },
    entityId: decedent.id,
    fields: [{ fieldId: "frontespizio.defunto.data-decesso", value: "01012025" }],
    confirmOfficialRules: true,
  }).revision;
  revision = saveCanonicalFieldsFromView(database, {
    practiceId,
    declarationId: declaration.id,
    expectedRevision: revision,
    view: { kind: "quadri", quadro: "EN" },
    entityId: company.id,
    fields: [
      {
        fieldId: "xsd:/Fornitura/Dichiarazione/QuadroEN/Modulo/Aziende/Valore",
        value: "200000",
      },
    ],
    confirmOfficialRules: true,
  }).revision;
  revision = saveCanonicalFieldsFromView(database, {
    practiceId,
    declarationId: declaration.id,
    expectedRevision: revision,
    view: { kind: "quadri", quadro: "EF" },
    fields: [
      {
        fieldId:
          "xsd:/Fornitura/Dichiarazione/QuadroEF/SezioneVBis_ImpostaSuccessione/ImpostaCalcolata/TempisticaPagamento",
        value: "1",
      },
    ],
    confirmOfficialRules: true,
  }).revision;
  const scenario = saveDevolutionScenario(database, {
    practiceId,
    declarationId: declaration.id,
    expectedRevision: revision,
    shares: [
      {
        assetId: company.id,
        beneficiaryId: beneficiary.id,
        numerator: 1n,
        denominator: 1n,
        rightCode: "1",
      },
    ],
  });
  if (scenario.issues.length > 0) throw new Error("Devoluzione sintetica E2E non valida");
  revision = confirmDevolutionScenario(database, {
    practiceId,
    declarationId: declaration.id,
    scenarioId: scenario.id,
    expectedRevision: revision,
  });
  const calculation = runSuccessionCalculation(database, {
    practiceId,
    declarationId: declaration.id,
  });
  if (calculation.status !== "draft" || calculation.issues.length > 0)
    throw new Error("Calcolo sintetico E2E non confermabile");
  confirmCalculationRun(database, {
    practiceId,
    declarationId: declaration.id,
    calculationId: calculation.id,
    expectedRevision: revision,
  });
  closeDatabase(dataDirectory);
}

function createSubstituteOneForE2e(practiceId: string): string {
  const dataDirectory = process.env.SEQUENT_E2E_DATA_DIR ?? ".test-data/e2e";
  const database = openDatabase(dataDirectory);
  const source = database
    .prepare("SELECT id FROM declarations WHERE practice_id = ? ORDER BY sequence ASC LIMIT 1")
    .get(practiceId) as { id: string } | undefined;
  if (!source) throw new Error("Dichiarazione sorgente E2E non trovata");
  const successive = createSuccessiveDeclaration(database, practiceId, source.id, "substitute-1");
  closeDatabase(dataDirectory);
  return successive.id;
}

test("mostra gli automatici confermati dalla stessa fonte e in sola lettura nelle due viste", async ({
  page,
}) => {
  const practiceTitle = unique("Parità automatici");
  await authenticate(page);
  await createPracticeFromDashboard(page, practiceTitle);
  const practiceId = page.url().match(/\/pratiche\/([^?]+)/)?.[1];
  if (!practiceId) throw new Error("Identificativo pratica E2E non disponibile");
  prepareConfirmedAutomaticFields(practiceId);

  await page.reload();
  await page.getByRole("button", { name: "Vista Quadri" }).click();
  await page.getByRole("button", { name: "Quadro EF", exact: true }).click();
  const automaticName =
    "5 EF18bis - Imposta di successione - Imposta calcolata - Imposta da versare";
  const quadriAutomaticOutput = page.getByRole("status", { name: automaticName });
  const quadriAutomatic = quadriAutomaticOutput.locator("xpath=../..");
  await expect(quadriAutomaticOutput).toHaveText("6600");
  await expect(quadriAutomatic.locator("input, select, textarea")).toHaveCount(0);
  await expect(
    quadriAutomatic.getByText(
      "Valore prodotto automaticamente dall’elaborazione ufficiale confermata.",
    ),
  ).toBeVisible();
  const quadriJurisdiction = page
    .locator(".official-field")
    .filter({ hasText: "EF15 - Tassa ipotecaria - Valore" });
  await expect(quadriJurisdiction.locator("output")).toHaveText("0");
  await expect(
    quadriJurisdiction.locator("input:not([type=hidden]), select, textarea"),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Vista operativa" }).click();
  await page.getByRole("button", { name: "Imposte e pagamenti" }).click();
  const operationalAutomatic = page.locator("details.operational-fields-group").filter({
    hasText: "Liquidazione e importi da versare",
  });
  await operationalAutomatic.locator(":scope > summary").click();
  const operationalAutomaticOutput = operationalAutomatic.getByRole("status", {
    name: automaticName,
  });
  const operationalAutomaticField = operationalAutomaticOutput.locator("xpath=../..");
  await expect(operationalAutomaticOutput).toHaveText("6600");
  await expect(operationalAutomaticField.locator("input, select, textarea")).toHaveCount(0);
  const operationalJurisdiction = operationalAutomatic
    .locator(".official-field")
    .filter({ hasText: "EF15 - Tassa ipotecaria - Valore" });
  await expect(operationalJurisdiction.locator("output")).toHaveText("0");
  await expect(
    operationalJurisdiction.locator("input:not([type=hidden]), select, textarea"),
  ).toHaveCount(0);
});

test("rende modificabili le circoscrizioni soltanto nella sostitutiva di tipo 1", async ({
  page,
}) => {
  const practiceTitle = unique("Parità circoscrizioni sostitutiva");
  await authenticate(page);
  await createPracticeFromDashboard(page, practiceTitle);
  const practiceId = page.url().match(/\/pratiche\/([^?]+)/)?.[1];
  if (!practiceId) throw new Error("Identificativo pratica E2E non disponibile");
  const declarationId = createSubstituteOneForE2e(practiceId);

  await page.goto(
    `/pratiche/${practiceId}?sezione=quadri&vista=quadri&quadro=EF&dichiarazione=${declarationId}`,
  );
  const quadriJurisdiction = page
    .locator(".official-field")
    .filter({ hasText: "EF15 - Tassa ipotecaria - Valore" });
  await expect(quadriJurisdiction.locator('input:not([type="hidden"])')).toHaveCount(1);
  await expect(quadriJurisdiction.locator("output")).toHaveCount(0);

  await page.getByRole("button", { name: "Vista operativa" }).click();
  await page.getByRole("button", { name: "Imposte e pagamenti" }).click();
  const group = page.locator("details.operational-fields-group").filter({
    hasText: "Liquidazione e importi da versare",
  });
  await group.locator(":scope > summary").click();
  const operationalJurisdiction = group
    .locator(".official-field")
    .filter({ hasText: "EF15 - Tassa ipotecaria - Valore" });
  await expect(operationalJurisdiction.locator('input:not([type="hidden"])')).toHaveCount(1);
  await expect(operationalJurisdiction.locator("output")).toHaveCount(0);
});

async function expectOfficialCheckboxesAligned(page: import("@playwright/test").Page) {
  const fieldCheckboxes = page.locator(".official-checkbox-control input[type=checkbox]");
  const confirmations = page.locator(".official-confirmation");
  expect(await fieldCheckboxes.count()).toBeGreaterThan(0);
  expect(await confirmations.count()).toBeGreaterThan(0);
  expect(
    await fieldCheckboxes.evaluateAll((checkboxes) =>
      checkboxes.every((checkbox) => {
        const box = checkbox.getBoundingClientRect();
        const text = checkbox.nextElementSibling?.getBoundingClientRect();
        return Boolean(
          text &&
          box.height <= 19 &&
          Math.abs(box.top + box.height / 2 - (text.top + text.height / 2)) <= 1,
        );
      }),
    ),
  ).toBe(true);
  expect(
    await confirmations.evaluateAll((labels) =>
      labels.every((label) => {
        const checkbox = label.querySelector<HTMLInputElement>('input[type="checkbox"]');
        const text = label.querySelector("span");
        if (!checkbox || !text) return false;
        const box = checkbox.getBoundingClientRect();
        const copy = text.getBoundingClientRect();
        return box.height <= 19 && Math.abs(box.top - copy.top) <= 2;
      }),
    ),
  ).toBe(true);
}

test("crea una pratica e usa il workspace minimo", async ({ page }) => {
  const practiceTitle = unique("Pratica workspace");
  const workspaceDocument = `workspace-${suffix}.txt`;
  await authenticate(page);
  const protectedResponse = await page.reload();
  expect(protectedResponse?.headers()["x-robots-tag"]).toBe("noindex, nofollow, noarchive");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "noindex, nofollow, noarchive",
  );
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Da verificare" })).toBeVisible();
  await expect(page.locator(".topbar-divider")).toBeVisible();
  await expect(page.locator(".attention-panel")).toHaveCSS("min-height", "0px");
  await expect(page.locator(".recent-panel")).toHaveCSS("min-height", "0px");
  const dashboardTitleSize = await page
    .getByRole("heading", { name: "Dashboard" })
    .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
  await createPracticeFromDashboard(page, practiceTitle);
  await expect(page).toHaveURL(/\/pratiche\/.+/);
  await expect(page.getByRole("heading", { name: practiceTitle })).toBeVisible();
  await expect(page.locator(".practice-heading").getByText(/Revisione \d+/)).toHaveCount(0);
  await page.getByRole("button", { name: "Documenti" }).click();
  await expect(page.getByText("Nessun documento caricato.")).toBeVisible();
  const practiceTitleSize = await page
    .getByRole("heading", { name: practiceTitle })
    .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
  expect(practiceTitleSize).toBeLessThan(dashboardTitleSize);

  await page.getByRole("button", { name: "Panoramica" }).click();
  await expect(page.getByRole("heading", { name: "Dichiarazione selezionata" })).toBeVisible();
  expect(
    (await page.locator(".workspace-panel-heading").nth(1).locator(":scope > span").boundingBox())
      ?.width,
  ).toBeGreaterThanOrEqual(46);
  await expect(
    page.locator(".declaration-list").getByText("Prima dichiarazione", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Aggiungi una dichiarazione successiva" }),
  ).toBeVisible();

  const workspaceActions = page.locator(".workspace-actions-menu summary");
  await workspaceActions.click();
  await expect(
    page.locator(".workspace-actions-popover").getByRole("link", { name: "Apri il riepilogo" }),
  ).toBeVisible();
  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Carica documento" }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name: workspaceDocument,
    mimeType: "text/plain",
    buffer: Buffer.from("fixture dal menu azioni"),
  });
  await expect(page.getByRole("heading", { name: "Documenti", exact: true })).toBeVisible();
  await expect(page.getByText(workspaceDocument, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Carica", exact: true }).click();
  await expect(page.getByRole("heading", { name: workspaceDocument })).toBeVisible();

  await page.getByRole("button", { name: "Panoramica" }).click();
  await expect(page).not.toHaveURL(/documento=/);
  const search = page.getByPlaceholder("Cerca in Sequent");
  await search.fill(workspaceDocument);
  await page
    .locator(".search-results")
    .getByRole("link", { name: new RegExp(workspaceDocument) })
    .click();
  await expect(page.getByRole("heading", { name: "Documenti", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: workspaceDocument })).toBeVisible();
});

test("esercita tutte le azioni desktop e i due percorsi di upload", async ({ page }) => {
  const practiceTitle = unique("Pratica azioni desktop");
  const uploadedPracticeTitle = unique("Pratica creata da upload");
  const documentName = `desktop-${suffix}.txt`;
  await authenticate(page);
  await createPracticeFromDashboard(page, practiceTitle);
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Riprendi ultima pratica" })).toBeVisible();

  await page.getByRole("button", { name: "Desktop Telematico" }).click();
  await expect(page.getByRole("heading", { name: "Desktop Telematico" })).toBeVisible();
  await expect(page.getByText(/non invia dati/)).toBeVisible();
  await page.getByRole("button", { name: "Chiudi" }).click();

  await page.getByRole("button", { name: "SuccessioniOnLine" }).click();
  await expect(page.getByRole("heading", { name: "SuccessioniOnLine" })).toBeVisible();
  await expect(page.getByText(/DIZ è disattivata/)).toBeVisible();
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
  const incompletePracticeTitle = `Pratica senza documento ${suffix}`;
  await page.getByLabel("Nome della nuova pratica").fill(incompletePracticeTitle);
  await page.getByLabel("Documento").evaluate((input) => input.removeAttribute("required"));
  await page.getByRole("button", { name: "Carica", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Scegli un documento da caricare.");
  await page.getByRole("button", { name: "Chiudi" }).click();
  await expect(page.getByRole("link", { name: incompletePracticeTitle })).toHaveCount(0);

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
  const practiceTitle = unique("Pratica ricerca");
  const documentName = `ricerca-${suffix}.txt`;
  await authenticate(page);
  await createPracticeFromDashboard(page, practiceTitle);
  await uploadFromWorkspace(page, documentName);
  await page.goto("/");
  await page.getByRole("link", { name: "Impostazioni" }).focus();
  await page.keyboard.press("Tab");
  const search = page.getByPlaceholder("Cerca in Sequent");
  await expect(search).toBeFocused();
  await search.fill(practiceTitle);
  const practiceResult = page.locator(".search-results a").filter({
    has: page.locator("strong", { hasText: practiceTitle }),
  });
  await expect(practiceResult).toBeVisible();
  await practiceResult.click();
  await expect(page.getByRole("heading", { name: practiceTitle })).toBeVisible();
  await expect(page.locator(".search-results")).toBeHidden();

  await page.goto("/");
  await search.fill(documentName);
  await expect(
    page.locator(".search-results").getByRole("link", { name: new RegExp(documentName) }),
  ).toBeVisible();
  await search.press("Enter");
  await expect(page).toHaveURL(
    (url) => url.pathname.startsWith("/pratiche/") && url.searchParams.has("documento"),
  );
  await expect(page.getByRole("heading", { name: documentName })).toBeVisible();
});

test("mostra una verifica tecnica fallita nella Dashboard e nella pratica", async ({ page }) => {
  const practiceTitle = unique("Pratica verifica fallita");
  const documentName = `verifica-${suffix}.txt`;
  await authenticate(page);
  await createPracticeFromDashboard(page, practiceTitle);
  await uploadFromWorkspace(page, documentName);
  const dataDirectory = process.env.SEQUENT_E2E_DATA_DIR ?? ".test-data/e2e";
  const database = new Database(join(dataDirectory, "sequent.sqlite"));
  const failedAt = new Date().toISOString();
  const result = database
    .prepare(
      `UPDATE jobs
       SET status = 'failed', attempts = 3, progress = 0,
           error_code = 'BLOB_HASH_MISMATCH', updated_at = ?
       WHERE type = 'foundation.verify_blob'
         AND document_id = (SELECT id FROM documents WHERE original_name = ?)`,
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

test("mostra la fonte e registra una correzione manuale", async ({ page }) => {
  const practiceTitle = unique("Pratica revisione documentale");
  const documentName = `revisione-${suffix}.txt`;
  await authenticate(page);
  await createPracticeFromDashboard(page, practiceTitle);
  await uploadFromWorkspace(page, documentName, "Data proposta: 31/12/2026");

  const dataDirectory = process.env.SEQUENT_E2E_DATA_DIR ?? ".test-data/e2e";
  const database = new Database(join(dataDirectory, "sequent.sqlite"));
  const document = database
    .prepare("SELECT id, practice_id AS practiceId FROM documents WHERE original_name = ?")
    .get(documentName) as { id: string; practiceId: string };
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO review_items (
        id, practice_id, document_id, page_number, subject_key, label,
        proposed_value_json, alternatives_json, method, confidence, source_excerpt,
        source_refs_json, prompt_version, critical, status, created_at, updated_at
      ) VALUES (?, ?, ?, 1, ?, ?, ?, '[]', 'ocr', 0.72, ?, ?, NULL, 0, 'pending', ?, ?)`,
    )
    .run(
      randomUUID(),
      document.practiceId,
      document.id,
      "document.date",
      "Data del documento",
      JSON.stringify("31/12/2026"),
      "Data proposta: 31/12/2026",
      JSON.stringify([{ documentId: document.id, pageNumber: 1, value: "31/12/2026" }]),
      now,
      now,
    );
  database.close();

  await page.reload();
  await page.getByRole("button", { name: /Da verificare/ }).click();
  await expect(page.getByText("Data del documento", { exact: true })).toBeVisible();
  await expect(page.locator(".source-excerpt")).toHaveText("Data proposta: 31/12/2026");
  await expect(page.getByRole("heading", { name: documentName })).toBeVisible();
  await page.getByLabel("Correggi prima di confermare").fill("30/12/2026");
  await page.getByRole("button", { name: "Conferma correzione" }).click();
  await expect(page.getByText("Nessuna verifica in sospeso.")).toBeVisible();
});

test("completa il percorso di dominio tra soggetti, beni, Quadri, devoluzione, calcoli e dossier", async ({
  page,
}) => {
  test.slow();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const practiceTitle = unique("Pratica soggetti e beni");
  const beneficiaryName = unique("Beneficiario sintetico");
  const decedentName = unique("Defunto sintetico");
  const assetName = unique("Immobile sintetico");
  const taxCode = "RSSMRA80A01H501U";
  const decedentTaxCode = "VRDLGI80A01H501U";
  await authenticate(page);
  await createPracticeFromDashboard(page, practiceTitle);

  await page.getByRole("button", { name: "Devoluzione" }).click();
  const professionalGroup = page
    .locator("details.operational-fields-group")
    .filter({ hasText: "Testamento estero" });
  const professionalField = professionalGroup
    .locator(".official-field")
    .filter({ hasText: "Testamento estero" });
  await expect(professionalField).toBeVisible();
  await expect(professionalField.locator("input:not([type=hidden]), select, textarea")).toHaveCount(
    1,
  );

  await page.getByRole("button", { name: "Riepilogo finale" }).click();
  const automaticGroup = page
    .locator("details.operational-fields-group")
    .filter({ hasText: "Casella quadri compilati: 'EA'" });
  const automaticField = automaticGroup
    .locator(".official-field")
    .filter({ hasText: "Casella quadri compilati: 'EA'" });
  await expect(automaticField).toBeVisible();
  await expect(automaticField.locator("output")).toHaveText("Non indicato");
  await expect(automaticField.locator("input:not([type=hidden]), select, textarea")).toHaveCount(0);
  await expect(
    automaticField.getByText("Valore gestito automaticamente dalle regole ufficiali.", {
      exact: true,
    }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Controlli finali" }).click();
  const officeGroup = page.locator("details.operational-fields-group").filter({
    hasText: "Dati prodotti dal software o riservati all’ufficio",
  });
  const officeField = officeGroup
    .locator(".official-field")
    .filter({ hasText: "Flag 1 (presentazione di doppie prime dichiarazioni)" });
  await expect(officeField).toBeVisible();
  await expect(officeField.locator("input:not([type=hidden]), select, textarea")).toHaveCount(0);
  await expect(
    officeField.getByText(
      "Campo riservato all’ufficio: Sequent lo conserva in sola lettura e non lo produce.",
      { exact: true },
    ),
  ).toBeVisible();

  await page.getByRole("button", { name: "Persone" }).click();
  const subjectForm = page.locator("form.domain-inline-form");
  await subjectForm.getByLabel("Ruolo").selectOption("decedent");
  await subjectForm.getByLabel("Nome o denominazione").fill(decedentName);
  await subjectForm.getByLabel("Codice fiscale").fill(decedentTaxCode);
  await subjectForm.getByRole("button", { name: "Aggiungi" }).click();
  await expect(page.getByText(decedentName, { exact: true }).first()).toBeVisible();

  await subjectForm.getByLabel("Ruolo").selectOption("beneficiary");
  await subjectForm.getByLabel("Nome o denominazione").fill(beneficiaryName);
  await subjectForm.getByLabel("Codice fiscale").fill(taxCode);
  await subjectForm.getByRole("button", { name: "Aggiungi" }).click();
  await expect(page.getByText(beneficiaryName, { exact: true }).first()).toBeVisible();

  const operationalSubjectGroup = page
    .locator("details.operational-fields-group")
    .filter({ hasText: beneficiaryName });
  await operationalSubjectGroup.locator(":scope > summary").click();
  await operationalSubjectGroup.getByRole("textbox", { name: /^\d+ Cognome$/ }).fill("ROSSI");
  const saveOperationalSubject = operationalSubjectGroup.getByRole("button", {
    name: "Salva questa scheda",
  });
  await confirmOfficialInstructions(saveOperationalSubject);
  await saveOperationalSubject.click();

  await page.getByRole("button", { name: "Patrimonio" }).click();
  const assetForm = page.locator("form.domain-inline-form");
  await assetForm.getByLabel("Tipo").selectOption("building");
  await assetForm.getByLabel("Descrizione").fill(assetName);
  await assetForm.getByLabel("Valore").fill("200000,00");
  await assetForm.getByRole("button", { name: "Aggiungi" }).click();
  await expect(page.getByText(assetName, { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Vista Quadri" }).click();
  await expect(page.getByRole("heading", { name: "Quadro EA", level: 2 })).toBeVisible();
  await expect(page.locator(".quadri-navigation")).not.toContainText(/\d+\/\d+/);
  await expect(page.getByRole("link", { name: beneficiaryName })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("textbox", { name: "1 Codice fiscale", exact: true })).toHaveValue(
    taxCode,
  );
  await expect(page.getByRole("textbox", { name: /Cognome/, exact: false })).toHaveValue("ROSSI");
  await page.getByRole("textbox", { name: /^\d+ Nome$/ }).fill("MARIO");
  await page.getByRole("combobox", { name: "2 Tipo soggetto", exact: true }).selectOption("1");
  await page
    .getByRole("combobox", { name: "4 Grado di parentela", exact: true })
    .selectOption("10");
  const saveOfficialSubject = page.getByRole("button", { name: "Salva questa posizione" });
  await confirmOfficialInstructions(saveOfficialSubject);
  await saveOfficialSubject.click();
  await page.getByRole("button", { name: "Frontespizio", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Frontespizio", level: 2 })).toBeVisible();
  await expect(page.getByRole("textbox", { name: /Località di residenza estera$/ })).toBeVisible();
  await expect(page.getByText(decedentName, { exact: true })).toBeVisible();
  await expect(page.locator('output[id="field-frontespizio.beneficiari.numero-eredi"]')).toHaveText(
    "1",
  );
  await expect(
    page.locator('output[id="field-frontespizio.beneficiari.numero-chiamati"]'),
  ).toHaveText("0");
  const legalDevolution = page.getByRole("checkbox", { name: "Devoluzione per legge" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expectOfficialCheckboxesAligned(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expectOfficialCheckboxesAligned(page);
  await legalDevolution.check();
  const saveGeneralData = page.getByRole("button", { name: "Salva dati generali" });
  await confirmOfficialInstructions(saveGeneralData);
  await saveGeneralData.click();
  await expect(legalDevolution).toBeChecked();
  await expect(page.getByRole("textbox", { name: "Codice fiscale del defunto" })).toHaveValue(
    decedentTaxCode,
  );
  const civilStatus = page.getByRole("combobox", { name: "Stato civile" });
  const deathDate = page.getByRole("textbox", {
    name: "Data del decesso, assenza o morte presunta",
  });
  await expect(
    page.locator(".official-fields").getByRole("button", { name: /^Salva/ }),
  ).toHaveCount(13);
  await civilStatus.selectOption("3");
  await deathDate.fill("01012025");
  const saveDecedent = page.getByRole("button", { name: "Salva dati del defunto" });
  await confirmOfficialInstructions(saveDecedent);
  await saveDecedent.click();
  await expect(civilStatus).toHaveValue("3");
  await expect(deathDate).toHaveValue("01012025");
  const quadriUrl = page.url();
  await page.goto("/");
  const deadlines = page.getByRole("region", { name: "Scadenze" });
  const practiceDeadline = deadlines.getByRole("link", { name: new RegExp(practiceTitle) });
  await expect(practiceDeadline.getByText("Presentazione della dichiarazione")).toBeVisible();
  await expect(practiceDeadline.getByText("Scaduta da", { exact: false })).toBeVisible();
  await expect(practiceDeadline.getByText("1 gen 2026")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(deadlines).toBeVisible();
  const deadlineCopy = practiceDeadline.locator("small");
  expect(
    await deadlineCopy.evaluate((copy) => {
      const copyBounds = copy.getBoundingClientRect();
      const rowBounds = copy.closest("li")!.getBoundingClientRect();
      return rowBounds.bottom - copyBounds.bottom;
    }),
  ).toBeGreaterThanOrEqual(10);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(quadriUrl);
  await page.getByRole("button", { name: "Quadro EA", exact: true }).click();
  await expect(
    page.locator(".official-fields").getByRole("button", { name: /^Salva/ }),
  ).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Salva questa posizione" })).toBeVisible();
  await page
    .getByRole("button", { name: "Aggiungi un’altra posizione per questo soggetto" })
    .click();
  await expect(page.getByRole("link", { name: `${beneficiaryName} · posizione 1` })).toBeVisible();
  await expect(
    page.getByRole("link", { name: `${beneficiaryName} · posizione 2` }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("textbox", { name: "1 Codice fiscale", exact: true })).toHaveValue(
    taxCode,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.getByRole("button", { name: "Quadro EC", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Quadro EC", level: 2 })).toBeVisible();
  await expect(page.getByRole("link", { name: assetName })).toHaveAttribute("aria-current", "page");
  const officialAssetValue = page.getByRole("textbox", { name: /^\d+ Valore$/ });
  await officialAssetValue.fill("200000");
  const saveOfficialAsset = page
    .locator("form")
    .filter({ has: officialAssetValue })
    .getByRole("button", { name: "Salva questo bene" });
  await confirmOfficialInstructions(saveOfficialAsset);
  await saveOfficialAsset.click();
  await expect(officialAssetValue).toHaveValue("200000");

  await page.getByRole("button", { name: "Quadro EH", exact: true }).click();
  const newOccurrenceGroup = page.locator("section.official-fields-group").filter({
    has: page.getByRole("heading", {
      name: "Presenza interdetti · nuova posizione",
      exact: true,
    }),
  });
  await newOccurrenceGroup.getByRole("textbox", { name: "3 Certificatore" }).fill("CERT1");
  await newOccurrenceGroup.getByRole("button", { name: "Aggiungi questa posizione" }).click();
  const savedOccurrenceGroup = page.locator("section.official-fields-group").filter({
    has: page.getByRole("heading", { name: "Presenza interdetti · posizione 1", exact: true }),
  });
  await expect(savedOccurrenceGroup.getByRole("textbox", { name: "3 Certificatore" })).toHaveValue(
    "CERT1",
  );
  const secondOccurrenceGroup = page.locator("section.official-fields-group").filter({
    has: page.getByRole("heading", {
      name: "Presenza interdetti · nuova posizione",
      exact: true,
    }),
  });
  await secondOccurrenceGroup.getByRole("textbox", { name: "3 Certificatore" }).fill("CERT2");
  await secondOccurrenceGroup.getByRole("button", { name: "Aggiungi questa posizione" }).click();

  await page.getByRole("button", { name: "Vista operativa" }).click();
  await page.getByRole("button", { name: "Panoramica" }).click();
  let operationalOccurrenceGroup = page.locator("details.operational-fields-group").filter({
    has: page.getByText(
      "Indicatori generali del Quadro EH della dichiarazione selezionata · posizione 1",
      { exact: true },
    ),
  });
  await operationalOccurrenceGroup.locator(":scope > summary").click();
  const operationalOccurrenceValue = operationalOccurrenceGroup.getByRole("textbox", {
    name: "3 Certificatore",
  });
  await expect(operationalOccurrenceValue).toHaveValue("CERT1");
  const secondOperationalOccurrence = page.locator("details.operational-fields-group").filter({
    has: page.getByText(
      "Indicatori generali del Quadro EH della dichiarazione selezionata · posizione 2",
      { exact: true },
    ),
  });
  await secondOperationalOccurrence.locator(":scope > summary").click();
  await expect(
    secondOperationalOccurrence.getByRole("textbox", { name: "3 Certificatore" }),
  ).toHaveValue("CERT2");
  await secondOperationalOccurrence.getByRole("button", { name: "Sposta prima" }).click();

  operationalOccurrenceGroup = page.locator("details.operational-fields-group").filter({
    has: page.getByText(
      "Indicatori generali del Quadro EH della dichiarazione selezionata · posizione 1",
      { exact: true },
    ),
  });
  await operationalOccurrenceGroup.locator(":scope > summary").click();
  await expect(
    operationalOccurrenceGroup.getByRole("textbox", { name: "3 Certificatore" }),
  ).toHaveValue("CERT2");
  const movedSecondOccurrence = page.locator("details.operational-fields-group").filter({
    has: page.getByText(
      "Indicatori generali del Quadro EH della dichiarazione selezionata · posizione 2",
      { exact: true },
    ),
  });
  await movedSecondOccurrence.locator(":scope > summary").click();
  await expect(movedSecondOccurrence.getByRole("textbox", { name: "3 Certificatore" })).toHaveValue(
    "CERT1",
  );
  await movedSecondOccurrence.getByRole("button", { name: "Rimuovi posizione" }).click();
  await expect(
    page.getByText(
      "Indicatori generali del Quadro EH della dichiarazione selezionata · posizione 2",
      { exact: true },
    ),
  ).toHaveCount(0);

  operationalOccurrenceGroup = page.locator("details.operational-fields-group").filter({
    has: page.getByText(
      "Indicatori generali del Quadro EH della dichiarazione selezionata · posizione 1",
      { exact: true },
    ),
  });
  await operationalOccurrenceGroup.locator(":scope > summary").click();
  const survivingOccurrenceValue = operationalOccurrenceGroup.getByRole("textbox", {
    name: "3 Certificatore",
  });
  await survivingOccurrenceValue.fill("CERT3");
  await operationalOccurrenceGroup.getByRole("button", { name: "Salva questa posizione" }).click();
  await page.getByRole("button", { name: "Vista Quadri" }).click();
  await page.getByRole("button", { name: "Quadro EH", exact: true }).click();
  await expect(
    page
      .locator("section.official-fields-group")
      .filter({
        has: page.getByRole("heading", {
          name: "Presenza interdetti · posizione 1",
          exact: true,
        }),
      })
      .getByRole("textbox", { name: "3 Certificatore" }),
  ).toHaveValue("CERT3");
  await page.getByRole("button", { name: "Vista operativa" }).click();
  await page.getByRole("button", { name: "Devoluzione" }).click();
  await expect(page.locator('output[id="field-frontespizio.beneficiari.numero-eredi"]')).toHaveText(
    "2",
  );
  await page.getByRole("button", { name: "Patrimonio" }).click();
  const operationalAssetGroup = page
    .locator("details.operational-fields-group")
    .filter({ hasText: assetName });
  await operationalAssetGroup.locator(":scope > summary").first().click();
  await expect(
    operationalAssetGroup.getByRole("textbox", { name: /^\d+ Valore$/ }).first(),
  ).toHaveValue("200000");
  await page.getByRole("button", { name: "Persone" }).click();
  const reloadedOperationalSubject = page
    .locator("details.operational-fields-group")
    .filter({ hasText: `${beneficiaryName} · posizione 2` });
  await reloadedOperationalSubject.locator(":scope > summary").click();
  await expect(reloadedOperationalSubject.getByRole("textbox", { name: /^\d+ Nome$/ })).toHaveValue(
    "MARIO",
  );
  await page.getByRole("button", { name: "Devoluzione" }).click();
  const devolutionForm = page.locator("form").filter({
    has: page.getByRole("button", { name: "Salva proposta di devoluzione" }),
  });
  await devolutionForm.getByLabel("Numeratore", { exact: true }).fill("1");
  await devolutionForm.getByLabel("Denominatore", { exact: true }).fill("1");
  await devolutionForm.getByRole("button", { name: "Salva proposta di devoluzione" }).click();
  await expect(page.getByText("Proposta pronta per la conferma")).toBeVisible();
  await page.getByRole("button", { name: "Conferma professionalmente" }).click();
  await expect(page.getByText("Devoluzione confermata")).toBeVisible();

  await page.getByRole("button", { name: "Imposte e pagamenti" }).click();
  await page.getByRole("button", { name: "Esegui il calcolo" }).click();
  await expect(page.getByText(/Imposta di successione:/)).toBeVisible();
  await expect(page.getByText("Dati da completare")).toBeVisible();
  await expect(page.getByRole("button", { name: "Conferma il calcolo" })).toHaveCount(0);

  await page.getByRole("button", { name: "Documenti" }).click();
  await expect(page.locator(".checklist-row")).not.toHaveCount(0);

  await page.getByRole("button", { name: "Riepilogo finale" }).click();
  const summaryHref = await page
    .locator(".export-grid")
    .getByRole("link", { name: "Apri il dossier" })
    .getAttribute("href");
  const facsimilePreviewLink = page
    .locator(".export-grid")
    .getByRole("link", { name: "Apri fac-simile" });
  const facsimileDownloadLink = page
    .locator(".export-grid")
    .getByRole("link", { name: "Scarica PDF" });
  await expect(facsimilePreviewLink).toHaveAttribute("target", "_blank");
  await expect(facsimilePreviewLink).toHaveAttribute("rel", "noreferrer");
  await expect(facsimileDownloadLink).toHaveAttribute("download", "");
  const facsimilePreviewHref = await facsimilePreviewLink.getAttribute("href");
  const facsimileDownloadHref = await facsimileDownloadLink.getAttribute("href");
  const dossierPdfHref = await page
    .locator(".export-grid")
    .getByRole("link", { name: "Scarica il dossier" })
    .getAttribute("href");
  if (!summaryHref || !facsimilePreviewHref || !facsimileDownloadHref || !dossierPdfHref)
    throw new Error("I collegamenti di esportazione devono avere un URL");
  const facsimileResponses = [
    [facsimilePreviewHref, "inline"],
    [facsimileDownloadHref, "attachment"],
  ] as const;
  for (const [href, disposition] of facsimileResponses) {
    const pdfResponse = await page.request.get(href);
    expect(pdfResponse.status()).toBe(200);
    expect(pdfResponse.headers()["content-type"]).toBe("application/pdf");
    expect(pdfResponse.headers()["content-disposition"]).toMatch(new RegExp(`^${disposition};`));
    expect((await pdfResponse.body()).subarray(0, 5).toString()).toBe("%PDF-");
  }
  const dossierPdfResponse = await page.request.get(dossierPdfHref);
  expect(dossierPdfResponse.status()).toBe(200);
  expect(dossierPdfResponse.headers()["content-type"]).toBe("application/pdf");
  expect((await dossierPdfResponse.body()).subarray(0, 5).toString()).toBe("%PDF-");
  await page.goto(summaryHref);
  await expect(page.getByRole("link", { name: "Apri fac-simile" })).toHaveAttribute(
    "target",
    "_blank",
  );
  await expect(page.getByRole("link", { name: "Scarica PDF" })).toHaveAttribute(
    "href",
    facsimileDownloadHref,
  );
  await expect(page.getByRole("link", { name: "Scarica PDF" })).toHaveAttribute("download", "");
  await expect(page.getByText("Bozza — controlli da completare", { exact: true })).toBeVisible();
  await expect(page.getByText(beneficiaryName, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(assetName, { exact: true }).first()).toBeVisible();
  const checklistRows = await page
    .locator("section")
    .filter({ hasText: "Documenti richiesti" })
    .locator("tbody tr")
    .allTextContents();
  expect(new Set(checklistRows).size).toBe(checklistRows.length);
  expect(pageErrors).toEqual([]);
});

test("persiste i temi chiaro e scuro e ripristina il tema di sistema", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await authenticate(page);
  await expect(page.locator("html")).not.toHaveAttribute("data-theme");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(15, 18, 20)");

  await page.goto("/impostazioni");
  const settingsTheme = page.locator(".appearance-panel").getByRole("group", {
    name: "Tema dell’interfaccia",
  });
  await settingsTheme.getByRole("button", { name: "Chiaro" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await openAccountMenu(page);
  const compactTheme = page.locator(".account-popover").getByRole("group", {
    name: "Tema dell’interfaccia",
  });
  const compactButtonRows = await compactTheme
    .locator("button")
    .evaluateAll((buttons) =>
      buttons.map((button) => Math.round(button.getBoundingClientRect().y)),
    );
  expect(new Set(compactButtonRows).size).toBe(1);
  await compactTheme.getByRole("button", { name: "Scuro" }).click();
  await expect(settingsTheme.getByRole("button", { name: "Scuro" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await settingsTheme.getByRole("button", { name: "Sistema" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(15, 18, 20)");
});

test("su mobile nasconde i launcher e mantiene soltanto le azioni interne", async ({ page }) => {
  const practiceTitle = unique("Pratica azioni mobile");
  await page.setViewportSize({ width: 402, height: 874 });
  await authenticate(page);
  await createPracticeFromDashboard(page, practiceTitle);
  const workspaceUrl = page.url();
  await page.goto("/");
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
  await page.keyboard.press("Escape");
  await expect(quickActions).toBeHidden();

  await openAccountMenu(page);
  await expect(page.locator(".account-menu")).toHaveAttribute("open", "");
  await page.keyboard.press("Escape");
  await expect(page.locator(".account-menu")).not.toHaveAttribute("open", "");

  await page.goto(workspaceUrl);
  expect((await page.locator(".workspace-sections").boundingBox())?.height).toBeLessThan(120);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByText("Azioni", { exact: true }).click();
  const workspacePopover = page.locator(".workspace-actions-popover");
  await expect(workspacePopover).toBeVisible();
  const popoverBounds = await workspacePopover.boundingBox();
  expect(popoverBounds).not.toBeNull();
  expect(popoverBounds!.x).toBeGreaterThanOrEqual(0);
  expect(popoverBounds!.x + popoverBounds!.width).toBeLessThanOrEqual(402);
  await page.keyboard.press("Escape");
  await expect(workspacePopover).toBeHidden();
});

test("su mobile la ricerca è compatta e richiudibile, la barra è ridotta e il logo torna alla Dashboard da ogni superficie", async ({
  page,
}) => {
  await page.setViewportSize({ width: 402, height: 874 });
  await authenticate(page);
  await page.goto("/pratiche");

  const mobileNavigation = page.getByRole("navigation", {
    name: "Navigazione principale mobile",
  });
  await expect(mobileNavigation).toBeVisible();
  expect((await mobileNavigation.boundingBox())?.height).toBeLessThanOrEqual(62);

  const searchButton = page.getByRole("button", { name: "Apri ricerca" });
  const searchBox = page.locator(".search-box");
  const searchIcon = searchButton.locator("svg");
  const [buttonBounds, iconBounds] = await Promise.all([
    searchButton.boundingBox(),
    searchIcon.boundingBox(),
  ]);
  expect(buttonBounds).not.toBeNull();
  expect(iconBounds).not.toBeNull();
  expect(
    Math.abs(buttonBounds!.x + buttonBounds!.width / 2 - (iconBounds!.x + iconBounds!.width / 2)),
  ).toBeLessThan(1);
  expect(
    Math.abs(buttonBounds!.y + buttonBounds!.height / 2 - (iconBounds!.y + iconBounds!.height / 2)),
  ).toBeLessThan(1);

  await searchButton.click();
  await expect(page.getByPlaceholder("Cerca in Sequent")).toBeFocused();
  await expect(page.getByRole("button", { name: "Chiudi ricerca" })).toBeVisible();
  expect((await searchBox.boundingBox())?.width).toBeLessThanOrEqual(320);
  await page.getByRole("button", { name: "Chiudi ricerca" }).click();
  await expect(searchButton).toBeVisible();
  await expect(page.getByPlaceholder("Cerca in Sequent")).toBeHidden();

  for (const route of ["/pratiche", "/documenti", "/impostazioni", "/pagina-inesistente"]) {
    await page.goto(route);
    await page.getByRole("link", { name: /Sequent,/ }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  }

  await page.goto("/pratiche");
  if ((await page.locator(".index-list a").count()) === 0) {
    await createPracticeFromDashboard(page, unique("Pratica navigazione mobile"));
    await page.goto("/pratiche");
  }
  const practiceHref = await page.locator(".index-list a").first().getAttribute("href");
  expect(practiceHref).toBeTruthy();
  for (const route of [practiceHref!, `${practiceHref}/riepilogo`]) {
    await page.goto(route);
    await page.getByRole("link", { name: "Sequent, Dashboard" }).click();
    await expect(page).toHaveURL(/\/$/);
  }
});

test("su mobile carica un documento senza interferenze dalla navigazione fissa", async ({
  page,
}) => {
  const practiceTitle = unique("Pratica upload mobile");
  const documentName = `mobile-${suffix}.txt`;
  await page.setViewportSize({ width: 402, height: 874 });
  await authenticate(page);
  await createPracticeFromDashboard(page, practiceTitle);
  await uploadFromWorkspace(page, documentName, "fixture sintetica per il caricamento mobile");
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
  await expect(checks.locator(".mobile-row-chevron").first()).toBeVisible();
  const activeHome = page
    .getByRole("navigation", { name: "Navigazione principale mobile" })
    .getByRole("link", { name: "Dashboard" })
    .locator("svg");
  await expect(activeHome).toHaveAttribute("fill", "currentColor");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("chiude la sessione e consente un nuovo accesso", async ({ page }) => {
  await authenticate(page);
  await openAccountMenu(page);
  await page.getByRole("button", { name: "Esci" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator(".brand-logo-static")).toBeVisible();
  await expect(page.locator(".brand-logo")).not.toHaveAttribute("href", /.+/);
  await page.getByLabel("Nome utente").fill(username.toUpperCase());
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Accedi" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});
