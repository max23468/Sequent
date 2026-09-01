import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  authenticate,
  confirmOfficialInstructions,
  createPracticeFromDashboard,
  openPracticeQuadro,
  openPracticeSection,
  resetFailedBlobVerification,
  selectPracticeView,
  submitOnlinePracticeForm,
  unique,
} from "./onboarding-support.ts";

test.afterEach(resetFailedBlobVerification);

async function chooseOfficialOption(
  page: Page,
  combobox: Locator,
  query: string,
  optionName: string,
): Promise<void> {
  await combobox.fill(query);
  await expect(page.getByRole("option", { name: optionName, exact: true })).toBeVisible();
  await page.getByRole("option", { name: optionName, exact: true }).click();
}

async function saveFieldGroup(field: Locator): Promise<void> {
  const button = field
    .locator("xpath=ancestor::form")
    .getByRole("button", { name: "Salva questo bene" });
  await confirmOfficialInstructions(button);
  await submitOnlinePracticeForm(button);
}

async function openFieldGroup(page: Page, name: string): Promise<void> {
  const group = page
    .locator("details.official-fields-group")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });
  if (!(await group.evaluate((element: HTMLDetailsElement) => element.open))) {
    await group.locator(":scope > summary").click();
  }
}

test("vincola ai cataloghi ufficiali tutti i campi a scelta del Quadro EC", async ({ page }) => {
  test.slow();
  const practiceTitle = unique("Scelte ufficiali");
  const assetName = unique("Fabbricato cataloghi");
  await authenticate(page);
  await createPracticeFromDashboard(page, practiceTitle);

  await openPracticeSection(page, "Patrimonio");
  const assetForm = page.locator("form.domain-inline-form");
  await assetForm.getByLabel("Tipo").selectOption("building");
  await assetForm.getByLabel("Descrizione").fill(assetName);
  await assetForm.getByLabel("Valore").fill("200000,00");
  await submitOnlinePracticeForm(assetForm.getByRole("button", { name: "Aggiungi" }));

  await selectPracticeView(page, "quadri");
  await openPracticeQuadro(page, "Quadro EC");
  await expect(page.getByRole("link", { name: assetName })).toHaveAttribute("aria-current", "page");
  await expect(page.locator("datalist")).toHaveCount(0);

  await openFieldGroup(page, "Quadro EC · Luogo");
  const province = page.getByRole("combobox", { name: "1 Provincia", exact: true });
  await province.fill("Provincia inesistente");
  expect(await province.evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(false);
  await chooseOfficialOption(page, province, "Milano", "MI — Milano");
  await saveFieldGroup(province);
  await openFieldGroup(page, "Quadro EC · Luogo");
  await expect(province).toHaveValue("MI");

  await openFieldGroup(page, "Quadro EC · Italia");
  const municipality = page.getByRole("combobox", {
    name: "2 Comune amministrativo",
    exact: true,
  });
  await chooseOfficialOption(page, municipality, "Milano", "MILANO (MI)");
  const municipalityCode = page.getByRole("combobox", {
    name: "3 Codice comune",
    exact: true,
  });
  await chooseOfficialOption(page, municipalityCode, "F205", "F205 — MILANO (MI)");
  await saveFieldGroup(municipality);
  await openFieldGroup(page, "Quadro EC · Italia");
  await expect(municipality).toHaveValue("MILANO");
  await expect(municipalityCode).toHaveValue("F205");

  await openFieldGroup(page, "Quadro EC · Dati fabbricati");
  const category = page.getByRole("combobox", { name: "10 Categoria", exact: true });
  const propertyClass = page.getByRole("textbox", { name: "11 Classe", exact: true });
  await category.selectOption("A1");
  await propertyClass.fill("03");
  await saveFieldGroup(propertyClass);
  await openFieldGroup(page, "Quadro EC · Dati fabbricati");
  await expect(category).toHaveValue("A1");
  await expect(propertyClass).toHaveValue("03");
  await expect(propertyClass).not.toHaveAttribute("role", "combobox");
});
