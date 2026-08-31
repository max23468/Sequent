import { expect } from "@playwright/test";
import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { saveCanonicalFieldsFromView } from "../../src/lib/server/canonical-field-views.ts";
import { closeDatabase, openDatabase } from "../../src/lib/server/database.ts";
import { createSharedAsset } from "../../src/lib/server/domain-assets.ts";
import {
  confirmCalculationRun,
  runSuccessionCalculation,
} from "../../src/lib/server/domain-calculations.ts";
import {
  confirmDevolutionScenario,
  saveDevolutionScenario,
} from "../../src/lib/server/domain-devolution.ts";
import { createSharedSubject } from "../../src/lib/server/domain-subjects.ts";
import { createSuccessiveDeclaration, getDeclaration } from "../../src/lib/server/practices.ts";

export const password = "SequentSviluppoSicuro2026";
export const username = "Sviluppo";
export const suffix = `${process.pid}-${Date.now()}`;

export function unique(label: string) {
  return `${label} ${suffix}`;
}

export function resetFailedBlobVerification() {
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
}

export async function authenticate(page: import("@playwright/test").Page) {
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

export async function openAccountMenu(page: import("@playwright/test").Page) {
  await page.getByLabel("Apri menu utente").click();
}

export async function createPracticeFromDashboard(
  page: import("@playwright/test").Page,
  practiceTitle: string,
) {
  await page.goto("/");
  await page.getByRole("button", { name: /^Nuova(?: pratica)?$/ }).click();
  await page.getByLabel("Nome della pratica").fill(practiceTitle);
  await page.getByRole("button", { name: "Crea pratica" }).click();
  await expect(page.getByRole("heading", { name: practiceTitle })).toBeVisible();
}

export async function openPracticeSection(page: import("@playwright/test").Page, name: string) {
  const section = page.getByRole("button", { name, exact: true });
  if (!(await section.isVisible())) {
    await page.getByRole("button", { name: /Apri il menu Sezioni/ }).click();
  }
  const sectionId = await section.getAttribute("data-section");
  if (!sectionId) throw new Error(`La sezione ${name} non espone il proprio identificativo`);
  await section.click();
  await expect.poll(() => new URL(page.url()).searchParams.get("sezione")).toBe(sectionId);
}

export async function submitOnlinePracticeForm(button: import("@playwright/test").Locator) {
  const page = button.page();
  const navigation = page.waitForEvent("framenavigated", (frame) => frame === page.mainFrame());
  await button.click();
  await navigation;
  await page.waitForLoadState("domcontentloaded");
}

export async function uploadFromWorkspace(
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

export async function confirmOfficialInstructions(button: import("@playwright/test").Locator) {
  const confirmation = button
    .locator("xpath=ancestor::form")
    .getByRole("checkbox", { name: "Confermo di aver verificato queste indicazioni" });
  if ((await confirmation.count()) > 0) await confirmation.check();
}

export function prepareConfirmedAutomaticFields(practiceId: string) {
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

export function createSubstituteOneForE2e(practiceId: string): string {
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

export async function expectOfficialCheckboxesAligned(page: import("@playwright/test").Page) {
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
