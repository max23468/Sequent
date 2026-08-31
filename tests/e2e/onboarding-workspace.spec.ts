import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  authenticate,
  createPracticeFromDashboard,
  openDetails,
  createSubstituteOneForE2e,
  prepareConfirmedAutomaticFields,
  resetFailedBlobVerification,
  suffix,
  unique,
  uploadFromWorkspace,
} from "./onboarding-support.ts";

test.describe.configure({ mode: "serial" });
test.afterEach(resetFailedBlobVerification);

test("limita i box della Dashboard e mantiene le scorciatoie", async ({ page }) => {
  await authenticate(page);
  for (let index = 1; index <= 6; index += 1) {
    await createPracticeFromDashboard(page, unique(`Pratica Dashboard ${index}`));
  }
  await page.goto("/");

  await expect(page.locator(".attention-panel .verification-list li")).toHaveCount(4);
  await expect(page.locator(".recent-panel .practice-row")).toHaveCount(5);
  await expect(page.locator(".dashboard-panel .panel-shortcut")).toHaveCount(3);
  await expect(page.locator(".deadlines-panel .panel-shortcut")).toHaveCSS(
    "border-top-style",
    "solid",
  );

  const documentShortcut = await page.locator(".attention-panel .panel-shortcut").boundingBox();
  const practiceShortcut = await page.locator(".deadlines-panel .panel-shortcut").boundingBox();
  expect(documentShortcut).not.toBeNull();
  expect(practiceShortcut).not.toBeNull();
  await expect
    .poll(async () => {
      const currentDocumentShortcut = await page
        .locator(".attention-panel .panel-shortcut")
        .boundingBox();
      const currentPracticeShortcut = await page
        .locator(".deadlines-panel .panel-shortcut")
        .boundingBox();
      return Math.abs((currentDocumentShortcut?.y ?? 0) - (currentPracticeShortcut?.y ?? 0));
    })
    .toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 390, height: 844 });
  const recentRow = page.locator(".recent-panel .practice-row").first();
  const recentDate = await recentRow.locator(".recent-date").boundingBox();
  const recentChevron = await recentRow.locator(".recent-chevron").boundingBox();
  expect(recentDate).not.toBeNull();
  expect(recentChevron).not.toBeNull();
  const dateCenter = (recentDate?.y ?? 0) + (recentDate?.height ?? 0) / 2;
  const chevronCenter = (recentChevron?.y ?? 0) + (recentChevron?.height ?? 0) / 2;
  expect(Math.abs(dateCenter - chevronCenter)).toBeLessThanOrEqual(1);
  await expect(recentRow.locator(".document-count")).toHaveText(/^\d+\sdocumenti?$/);
  await expect(recentRow.locator(".status-cell")).not.toContainText("documenti");
});

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
  await openDetails(operationalAutomatic);
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
  await openDetails(group);
  const operationalJurisdiction = group
    .locator(".official-field")
    .filter({ hasText: "EF15 - Tassa ipotecaria - Valore" });
  await expect(operationalJurisdiction.locator('input:not([type="hidden"])')).toHaveCount(1);
  await expect(operationalJurisdiction.locator("output")).toHaveCount(0);
});

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
  const attentionPanel = page.getByRole("region", { name: "Da verificare" });
  const deadlinesPanel = page.getByRole("region", { name: "Scadenze" });
  const recentPanel = page.getByRole("region", { name: "Pratiche recenti" });
  await expect(attentionPanel).toBeVisible();
  await expect(attentionPanel.getByRole("link", { name: "Apri Documenti" })).toHaveAttribute(
    "href",
    "/documenti",
  );
  await expect(deadlinesPanel.getByRole("link", { name: "Apri Pratiche" })).toHaveAttribute(
    "href",
    "/pratiche",
  );
  await expect(recentPanel.getByRole("link", { name: "Vedi tutte le pratiche" })).toHaveAttribute(
    "href",
    "/pratiche",
  );
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

  const workspaceActions = page.locator(".workspace-actions-trigger");
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
