import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";

test.describe.configure({ mode: "serial" });

const password = "SequentSviluppoSicuro2026";
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
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByLabel("Ripeti la password").fill(password);
    await page.getByRole("button", { name: "Crea account" }).click();
  } else if (page.url().endsWith("/login")) {
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

async function uploadFromWorkspace(
  page: import("@playwright/test").Page,
  documentName: string,
  content = "fixture sintetica indipendente",
) {
  await page.getByLabel("Aggiungi un documento").setInputFiles({
    name: documentName,
    mimeType: "text/plain",
    buffer: Buffer.from(content),
  });
  await page.getByRole("button", { name: "Carica", exact: true }).click();
  await expect(page).toHaveURL(/documento=/);
  await expect(page.getByRole("heading", { name: documentName })).toBeVisible();
}

test("crea una pratica e usa il workspace minimo", async ({ page }) => {
  const practiceTitle = unique("Pratica workspace");
  const workspaceDocument = `workspace-${suffix}.txt`;
  await authenticate(page);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Da verificare" })).toBeVisible();
  await expect(page.locator(".topbar-divider")).toBeVisible();
  expect((await page.locator(".attention-panel").boundingBox())?.height).toBeGreaterThanOrEqual(
    420,
  );
  expect((await page.locator(".recent-panel").boundingBox())?.height).toBeGreaterThanOrEqual(380);
  const dashboardTitleSize = await page
    .getByRole("heading", { name: "Dashboard" })
    .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
  await createPracticeFromDashboard(page, practiceTitle);
  await expect(page).toHaveURL(/\/pratiche\/.+/);
  await expect(page.getByRole("heading", { name: practiceTitle })).toBeVisible();
  await expect(page.getByText("Revisione 1")).toBeVisible();
  await expect(page.getByText("Nessun documento caricato.")).toBeVisible();
  const practiceTitleSize = await page
    .getByRole("heading", { name: practiceTitle })
    .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
  expect(practiceTitleSize).toBeLessThan(dashboardTitleSize);

  await page.getByRole("button", { name: /Defunto e dichiarazione/ }).click();
  await expect(page.getByRole("heading", { name: "Defunto e dichiarazione" })).toBeVisible();
  expect(
    (await page.locator(".workspace-panel-heading").nth(1).locator(":scope > span").boundingBox())
      ?.width,
  ).toBeGreaterThanOrEqual(46);
  await expect(page.getByText("Prima dichiarazione")).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "Documenti" })).toBeVisible();
  await expect(page.getByText(workspaceDocument, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Carica", exact: true }).click();
  await expect(page.getByRole("heading", { name: workspaceDocument })).toBeVisible();

  await page.getByRole("button", { name: /Defunto e dichiarazione/ }).click();
  await expect(page).not.toHaveURL(/documento=/);
  const search = page.getByPlaceholder("Cerca in Sequent");
  await search.fill(workspaceDocument);
  await page
    .locator(".search-results")
    .getByRole("link", { name: new RegExp(workspaceDocument) })
    .click();
  await expect(page.getByRole("heading", { name: "Documenti" })).toBeVisible();
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
  await expect(page).toHaveURL(/\/pratiche\/.+\?documento=/);
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

  await page.getByRole("button", { name: "Soggetti" }).click();
  const subjectForm = page.locator("form.domain-inline-form");
  await subjectForm.getByLabel("Ruolo").selectOption("decedent");
  await subjectForm.getByLabel("Nome o denominazione").fill(decedentName);
  await subjectForm.getByLabel("Codice fiscale").fill(decedentTaxCode);
  await subjectForm.getByRole("button", { name: "Aggiungi" }).click();
  await expect(page.getByText(decedentName, { exact: true })).toBeVisible();

  await subjectForm.getByLabel("Ruolo").selectOption("beneficiary");
  await subjectForm.getByLabel("Nome o denominazione").fill(beneficiaryName);
  await subjectForm.getByLabel("Codice fiscale").fill(taxCode);
  await subjectForm.getByRole("button", { name: "Aggiungi" }).click();
  await expect(page.getByText(beneficiaryName, { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Beni e passività" }).click();
  const assetForm = page.locator("form.domain-inline-form");
  await assetForm.getByLabel("Tipo").selectOption("building");
  await assetForm.getByLabel("Descrizione").fill(assetName);
  await assetForm.getByLabel("Valore").fill("200000,00");
  await assetForm.getByRole("button", { name: "Aggiungi" }).click();
  await expect(page.getByText(assetName, { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Vista Quadri" }).click();
  await expect(page.getByRole("heading", { name: "Quadro EA", level: 2 })).toBeVisible();
  await expect(page.getByRole("link", { name: beneficiaryName })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("textbox", { name: "1 Codice fiscale", exact: true })).toHaveValue(
    taxCode,
  );
  await page.getByRole("combobox", { name: "2 Tipo soggetto", exact: true }).selectOption("1");
  await page
    .getByRole("combobox", { name: "4 Grado di parentela", exact: true })
    .selectOption("10");
  await page.getByRole("button", { name: "Salva questa posizione" }).click();
  await page.getByRole("button", { name: /^Frontespizio:/ }).click();
  await expect(page.getByRole("heading", { name: "Frontespizio", level: 2 })).toBeVisible();
  await expect(page.getByText(decedentName, { exact: true })).toBeVisible();
  await expect(page.locator('output[id="field-frontespizio.beneficiari.numero-eredi"]')).toHaveText(
    "1",
  );
  await expect(
    page.locator('output[id="field-frontespizio.beneficiari.numero-chiamati"]'),
  ).toHaveText("0");
  const legalDevolution = page.getByRole("checkbox", { name: "Devoluzione per legge" });
  await legalDevolution.check();
  await page.getByRole("button", { name: "Salva dati generali" }).click();
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
  ).toHaveCount(15);
  await civilStatus.selectOption("3");
  await deathDate.fill("01012025");
  await page.getByRole("button", { name: "Salva dati del defunto" }).click();
  await expect(civilStatus).toHaveValue("3");
  await expect(deathDate).toHaveValue("01012025");
  await page.getByRole("button", { name: /^Quadro EA:/ }).click();
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

  await page.getByRole("button", { name: "Vista operativa" }).click();
  await page.getByRole("button", { name: "Devoluzione" }).click();
  await page.getByLabel("Numeratore").fill("1");
  await page.getByLabel("Denominatore").fill("1");
  await page.getByRole("button", { name: "Salva proposta di devoluzione" }).click();
  await expect(page.getByText("Proposta pronta per la conferma")).toBeVisible();
  await page.getByRole("button", { name: "Conferma professionalmente" }).click();
  await expect(page.getByText("Devoluzione confermata")).toBeVisible();

  await page.getByRole("button", { name: "Calcoli" }).click();
  await page.getByRole("button", { name: "Esegui il calcolo" }).click();
  await expect(page.getByText(/Imposta complessiva:/)).toBeVisible();
  await page.getByRole("button", { name: "Conferma il calcolo" }).click();
  await expect(page.getByText("Calcolo confermato")).toBeVisible();

  await page.getByRole("button", { name: "Documenti richiesti" }).click();
  for (const status of await page.locator('.checklist-row select[name^="status:"]').all())
    await status.selectOption("available");
  await page.getByRole("button", { name: "Salva documenti richiesti" }).click();

  await page.getByRole("button", { name: "Riepilogo ed esportazione" }).click();
  const summaryHref = await page
    .locator(".export-grid")
    .getByRole("link", { name: "Apri il dossier" })
    .getAttribute("href");
  const pdfHref = await page
    .locator(".export-grid")
    .getByRole("link", { name: "Scarica il PDF" })
    .getAttribute("href");
  expect(summaryHref).toBeTruthy();
  expect(pdfHref).toBeTruthy();
  const pdfResponse = await page.request.get(pdfHref!);
  expect(pdfResponse.status()).toBe(200);
  expect(pdfResponse.headers()["content-type"]).toBe("application/pdf");
  expect((await pdfResponse.body()).subarray(0, 5).toString()).toBe("%PDF-");
  await page.goto(summaryHref!);
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
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Accedi" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});
