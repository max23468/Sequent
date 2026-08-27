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
  await expect(page.getByText("Nessuna verifica da mostrare.")).toBeVisible();
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
  await expect(page.getByText("Funzionalità non ancora disponibile")).toBeVisible();
  await expect(page.getByRole("button", { name: "Conferma" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Modifica" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Rifiuta" })).toBeDisabled();

  const workspaceActions = page.locator(".workspace-actions-menu summary");
  await workspaceActions.click();
  await expect(page.getByRole("button", { name: /Esporta riepilogo/ })).toBeDisabled();
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
  const practiceResult = page
    .locator(".search-results")
    .getByRole("link", { name: new RegExp(practiceTitle) });
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
  await expect(page.getByText("Data proposta: 31/12/2026", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: documentName })).toBeVisible();
  await page.getByLabel("Correggi prima di confermare").fill("30/12/2026");
  await page.getByRole("button", { name: "Conferma correzione" }).click();
  await expect(page.getByText("Nessuna verifica in sospeso.")).toBeVisible();
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
