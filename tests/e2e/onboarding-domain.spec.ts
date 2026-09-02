import { expect, test } from "@playwright/test";
import {
  authenticate,
  confirmOfficialInstructions,
  createPracticeFromDashboard,
  expectOfficialCheckboxesAligned,
  expectOfficialFieldHeadingsSeparated,
  openDetails,
  openPracticeQuadro,
  openPracticeSection,
  resetFailedBlobVerification,
  selectPracticeView,
  submitOnlinePracticeForm,
  unique,
} from "./onboarding-support.ts";

test.describe.configure({ mode: "serial" });
test.afterEach(resetFailedBlobVerification);

test("mantiene mutuamente esclusive le scelte radio qualificate da SuccessioniOnLine", async ({
  page,
}) => {
  test.slow();
  const practiceTitle = unique("Pratica radio SuccessioniOnLine");
  await authenticate(page);
  await createPracticeFromDashboard(page, practiceTitle);
  await selectPracticeView(page, "quadri");
  await openPracticeQuadro(page, "Quadro EH");

  await expect(page.getByRole("heading", { name: /^Pagina 2 ·/ }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Pagina 3 ·/ }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Pagina 4 ·/ }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Pagina 1 ·/ })).toHaveCount(0);

  const testamentChoice = page.locator("details.official-fields-group").filter({
    has: page.getByRole("heading", { name: "Scelta esclusiva · Testamento" }),
  });
  await openDetails(testamentChoice);
  const noTestament = page.getByRole("radio", { name: /Flag Assenza Testamento/ });
  const hasTestament = page.getByRole("radio", { name: /Flag Testamento/ });
  const testamentRegistryOffice = page.locator(
    'input[id*="/PresenzaTestamento/RegistrazioneTestamento/UfficioDiRegistrazione"]',
  );
  await expect(testamentRegistryOffice).toBeEnabled();
  await noTestament.check();
  await expect(testamentRegistryOffice).toBeDisabled();
  await hasTestament.check();
  await expect(testamentRegistryOffice).toBeEnabled();

  const section = page.locator("details.official-fields-group").filter({
    has: page.getByRole("heading", { name: "Scelta esclusiva · Opzioni" }),
  });
  await openDetails(section);
  let firstHome = page.getByRole("radio", { name: /Flag Comune Residenza/ });
  let workTown = page.getByRole("radio", { name: /Flag Comune Attività/ });
  await expect(firstHome).toHaveAttribute("name", "successioniOnLineRadio:EH:radio-EH001");
  await expect(workTown).toHaveAttribute("name", "successioniOnLineRadio:EH:radio-EH001");

  await firstHome.check();
  await expect(firstHome).toBeChecked();
  await workTown.check();
  await expect(workTown).toBeChecked();
  await expect(firstHome).not.toBeChecked();

  const save = section.getByRole("button", { name: "Salva il quadro" });
  await confirmOfficialInstructions(save);
  await submitOnlinePracticeForm(save);
  const reloadedSection = page.locator("details.official-fields-group").filter({
    has: page.getByRole("heading", { name: "Scelta esclusiva · Opzioni" }),
  });
  await openDetails(reloadedSection);
  firstHome = page.getByRole("radio", { name: /Flag Comune Residenza/ });
  workTown = page.getByRole("radio", { name: /Flag Comune Attività/ });
  await expect(workTown).toBeChecked();
  await expect(firstHome).not.toBeChecked();

  await openPracticeQuadro(page, "Quadro EG");
  await expect(page.getByText(/Gli 11 conteggi EG derivano dai documenti collegati/)).toBeVisible();
  await expect(page.locator(".official-field")).toHaveCount(11);
  await expect(page.locator(".official-field output")).toHaveCount(11);
  await expect(page.locator('.official-field input:not([type="hidden"])')).toHaveCount(0);
});

test("completa il percorso di dominio tra soggetti, beni, Quadri, devoluzione, calcoli e dossier", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  const practiceTitle = unique("Pratica soggetti e beni");
  const beneficiaryName = unique("Beneficiario sintetico");
  const canonicalBeneficiaryName = "ROSSI MARIO";
  const decedentName = unique("Defunto sintetico");
  const assetName = unique("Immobile sintetico");
  const taxCode = "RSSMRA80A01H501U";
  const decedentTaxCode = "VRDLGI80A01H501U";
  await authenticate(page);
  await createPracticeFromDashboard(page, practiceTitle);

  const fieldLegend = page.locator(".field-necessity-legend");
  await expect(fieldLegend.getByText("Come leggere i campi", { exact: true })).toBeVisible();
  await expect(fieldLegend.getByText("Obbligatorio", { exact: true })).toBeVisible();
  await expect(fieldLegend.getByText("Alternativa", { exact: true })).toBeVisible();
  await expect(fieldLegend.getByText("Solo se pertinente", { exact: true })).toBeVisible();
  await expect(fieldLegend.getByText("Automatico", { exact: true })).toBeVisible();
  const conditionalField = page.locator(".official-field").filter({ hasText: "Lingua di stampa" });
  await expect(conditionalField.getByText("Solo se pertinente", { exact: true })).toBeVisible();
  const optionalGroup = page.locator("details.operational-fields-group").filter({
    hasText: "Indicatori generali del Quadro EH della dichiarazione selezionata · nuova posizione",
  });
  await expect(optionalGroup.first()).not.toHaveAttribute("open", "");
  await expect(optionalGroup.first().locator("summary")).toContainText("Blocco solo se pertinente");

  await openPracticeSection(page, "Devoluzione");
  const professionalGroup = page
    .locator("details.operational-fields-group")
    .filter({ hasText: "Testamento estero" });
  const professionalField = professionalGroup
    .locator(".official-field")
    .filter({ hasText: "Testamento estero" });
  await openDetails(professionalGroup);
  await expect(professionalField).toBeVisible();
  await expect(professionalField.locator("input:not([type=hidden]), select, textarea")).toHaveCount(
    1,
  );

  await openPracticeSection(page, "Riepilogo finale");
  const automaticGroup = page
    .locator("details.operational-fields-group")
    .filter({ hasText: "Casella quadri compilati: 'EA'" });
  const automaticField = automaticGroup
    .locator(".official-field")
    .filter({ hasText: "Casella quadri compilati: 'EA'" });
  await openDetails(automaticGroup);
  await expect(automaticField).toBeVisible();
  await expect(automaticField.locator("output")).toHaveText("Non indicato");
  await expect(automaticField.locator("input:not([type=hidden]), select, textarea")).toHaveCount(0);
  await expect(
    automaticField.getByText("Valore gestito automaticamente dalle regole ufficiali.", {
      exact: true,
    }),
  ).toBeVisible();

  await openPracticeSection(page, "Controlli finali");
  const officeGroup = page.locator("details.operational-fields-group").filter({
    hasText: "Dati prodotti dal software o riservati all’ufficio",
  });
  const officeField = officeGroup
    .locator(".official-field")
    .filter({ hasText: "Flag 1 (presentazione di doppie prime dichiarazioni)" });
  await openDetails(officeGroup);
  await expect(officeField).toBeVisible();
  await expect(officeField.locator("input:not([type=hidden]), select, textarea")).toHaveCount(0);
  await expect(
    officeField.getByText(
      "Campo riservato all’ufficio: Sequent lo conserva in sola lettura e non lo produce.",
      { exact: true },
    ),
  ).toBeVisible();

  await openPracticeSection(page, "Persone");
  await expect(page.getByRole("alert").filter({ hasText: "Defunto da aggiungere" })).toBeVisible();
  const subjectForm = page.locator("form.domain-inline-form");
  await subjectForm.getByLabel("Ruolo").selectOption("decedent");
  await subjectForm.getByLabel("Nome o denominazione").fill(decedentName);
  await subjectForm.getByLabel("Codice fiscale").fill(decedentTaxCode);
  await submitOnlinePracticeForm(subjectForm.getByRole("button", { name: "Aggiungi" }));
  await expect(page.getByText(decedentName, { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Defunto da aggiungere" })).toHaveCount(0);
  const operationalDecedentGroup = page
    .locator("details.operational-fields-group")
    .filter({ hasText: decedentName });
  await openDetails(operationalDecedentGroup);
  await expect(
    operationalDecedentGroup.getByRole("textbox", { name: /Codice fiscale del defunto/ }),
  ).toBeVisible();
  await expect(
    operationalDecedentGroup.getByRole("radio", { name: "Maschile", exact: true }),
  ).toBeVisible();
  await expect(
    operationalDecedentGroup.getByRole("radio", { name: "Femminile", exact: true }),
  ).toBeVisible();

  await subjectForm.getByLabel("Ruolo").selectOption("beneficiary");
  await subjectForm.getByLabel("Nome o denominazione").fill(beneficiaryName);
  await subjectForm.getByLabel("Codice fiscale").fill(taxCode);
  await submitOnlinePracticeForm(subjectForm.getByRole("button", { name: "Aggiungi" }));
  await expect(page.getByText(beneficiaryName, { exact: true }).first()).toBeVisible();

  const operationalSubjectGroup = page
    .locator("details.operational-fields-group")
    .filter({ hasText: beneficiaryName });
  await openDetails(operationalSubjectGroup);
  const operationalSubjectMale = operationalSubjectGroup.getByRole("radio", {
    name: "Maschile",
    exact: true,
  });
  await expect(operationalSubjectMale).toBeVisible();
  await operationalSubjectMale.check();
  await expect(
    operationalSubjectGroup.getByRole("combobox", { name: /Codice dello Stato estero/ }),
  ).toBeVisible();
  await operationalSubjectGroup.getByRole("textbox", { name: /^\d+ Cognome$/ }).fill("ROSSI");
  const saveOperationalSubject = operationalSubjectGroup.getByRole("button", {
    name: "Salva questa scheda",
  });
  await confirmOfficialInstructions(saveOperationalSubject);
  await submitOnlinePracticeForm(saveOperationalSubject);

  await openPracticeSection(page, "Patrimonio");
  const assetForm = page.locator("form.domain-inline-form");
  await assetForm.getByLabel("Tipo").selectOption("building");
  await assetForm.getByLabel("Descrizione").fill(assetName);
  await assetForm.getByLabel("Valore").fill("200000,00");
  await submitOnlinePracticeForm(assetForm.getByRole("button", { name: "Aggiungi" }));
  await expect(page.getByText(assetName, { exact: true }).first()).toBeVisible();

  await selectPracticeView(page, "quadri");
  await expect(page.getByRole("heading", { name: "Quadro EA", level: 2 })).toBeVisible();
  await expect(page.locator(".quadri-navigation")).not.toContainText(/\d+\/\d+/);
  await expect(page.getByRole("link", { name: "ROSSI" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("textbox", { name: "1 Codice fiscale", exact: true })).toHaveValue(
    taxCode,
  );
  await expect(page.getByRole("textbox", { name: /Cognome/, exact: false })).toHaveValue("ROSSI");
  await expect(page.getByRole("radio", { name: "Maschile", exact: true })).toBeChecked();
  const quadriForeignState = page
    .locator(".official-field")
    .filter({ hasText: "Codice dello Stato estero" });
  await expect(quadriForeignState.locator("output")).toBeVisible();
  await expect(
    quadriForeignState.locator("input:not([type=hidden]), select, textarea"),
  ).toHaveCount(0);
  await expect(
    quadriForeignState.getByText(
      "Valore acquisito nella Vista operativa e mostrato qui in sola lettura, come in SuccessioniOnLine.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByRole("textbox", { name: /^\d+ Nome$/ }).fill("MARIO");
  await page.getByRole("combobox", { name: "2 Tipo soggetto", exact: true }).selectOption("1");
  await page
    .getByRole("combobox", { name: "4 Grado di parentela", exact: true })
    .selectOption("10");
  const saveOfficialSubject = page.getByRole("button", { name: "Salva questa posizione" });
  await confirmOfficialInstructions(saveOfficialSubject);
  await submitOnlinePracticeForm(saveOfficialSubject);
  await openPracticeQuadro(page, "Frontespizio");
  await expect(page.getByRole("heading", { name: "Frontespizio", level: 2 })).toBeVisible();
  const foreignResidentGroup = page
    .locator("details.official-fields-group")
    .filter({ hasText: "Riservato ai residenti all’estero" });
  await openDetails(foreignResidentGroup);
  await expect(page.getByRole("textbox", { name: /Località di residenza estera$/ })).toBeVisible();
  await expect(page.getByText(decedentName, { exact: true })).toBeVisible();
  const quadriDecedentTaxCode = page
    .locator(".official-field")
    .filter({ hasText: "Codice fiscale del defunto" });
  await expect(quadriDecedentTaxCode.locator("output")).toBeVisible();
  await expect(
    quadriDecedentTaxCode.locator("input:not([type=hidden]), select, textarea"),
  ).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "Maschile", exact: true })).toBeVisible();
  await expect(page.locator('output[id="field-frontespizio.beneficiari.numero-eredi"]')).toHaveText(
    "1",
  );
  await expect(
    page.locator('output[id="field-frontespizio.beneficiari.numero-chiamati"]'),
  ).toHaveText("0");
  const legalDevolution = page.getByRole("checkbox", { name: "Devoluzione per legge" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expectOfficialCheckboxesAligned(page);
  await expectOfficialFieldHeadingsSeparated(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expectOfficialCheckboxesAligned(page);
  await expectOfficialFieldHeadingsSeparated(page);
  await legalDevolution.check();
  const saveGeneralData = legalDevolution
    .locator("xpath=ancestor::form")
    .getByRole("button", { name: "Salva il quadro" });
  await confirmOfficialInstructions(saveGeneralData);
  await submitOnlinePracticeForm(saveGeneralData);
  await expect(legalDevolution).toBeChecked();
  await expect(quadriDecedentTaxCode.locator("output")).toHaveText(decedentTaxCode);
  const civilStatus = page.getByRole("combobox", { name: "Stato civile" });
  const deathDate = page.getByRole("textbox", {
    name: "Data del decesso, assenza o morte presunta",
  });
  await expect(
    page.locator('.official-fields button[type="submit"]').filter({ hasText: /^Salva/ }),
  ).toHaveCount(15);
  await civilStatus.selectOption("3");
  await deathDate.fill("01012025");
  const saveDecedent = page.getByRole("button", { name: "Salva dati del defunto" });
  await confirmOfficialInstructions(saveDecedent);
  await submitOnlinePracticeForm(saveDecedent);
  await expect(civilStatus).toHaveValue("3");
  await expect(deathDate).toHaveValue("01012025");
  // Il salvataggio SvelteKit invalida i dati della pagina in background: attendiamo
  // il completamento prima di iniziare una navigazione esplicita verso la Dashboard.
  await page.waitForLoadState("networkidle");
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
  await openPracticeQuadro(page, "Quadro EA");
  await expect(
    page.locator(".official-fields").getByRole("button", { name: /^Salva/ }),
  ).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Salva questa posizione" })).toBeVisible();
  await submitOnlinePracticeForm(
    page.getByRole("button", { name: "Aggiungi un’altra posizione per questo soggetto" }),
  );
  await expect(
    page.getByRole("link", { name: `${canonicalBeneficiaryName} · posizione 1` }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: `${canonicalBeneficiaryName} · posizione 2` }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("textbox", { name: "1 Codice fiscale", exact: true })).toHaveValue(
    taxCode,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.setViewportSize({ width: 1440, height: 1000 });

  await openPracticeQuadro(page, "Quadro EC");
  await expect(page.getByRole("heading", { name: "Quadro EC", level: 2 })).toBeVisible();
  await expect(page.getByRole("link", { name: assetName })).toHaveAttribute("aria-current", "page");
  const buildingsGroup = page
    .locator("details.official-fields-group")
    .filter({
      has: page.getByRole("heading", {
        name: "Quadro EC · Fabbricati",
        exact: true,
        level: 3,
      }),
    })
    .first();
  await openDetails(buildingsGroup);
  const officialAssetValue = buildingsGroup.getByRole("textbox", { name: /^\d+ Valore$/ });
  await officialAssetValue.fill("200000");
  const saveOfficialAsset = officialAssetValue
    .locator("xpath=ancestor::form")
    .getByRole("button", { name: "Salva questo bene" });
  await confirmOfficialInstructions(saveOfficialAsset);
  await submitOnlinePracticeForm(saveOfficialAsset);
  await openDetails(buildingsGroup);
  await expect(officialAssetValue).toHaveValue("200000");

  await openPracticeQuadro(page, "Quadro EH");
  const newOccurrenceGroup = page.locator("details.official-fields-group").filter({
    has: page.getByRole("heading", {
      name: /Presenza interdetti · nuova posizione$/,
    }),
  });
  await openDetails(newOccurrenceGroup);
  await newOccurrenceGroup.getByRole("textbox", { name: "3 Certificatore" }).fill("CERT1");
  await submitOnlinePracticeForm(
    newOccurrenceGroup.getByRole("button", { name: "Aggiungi questa posizione" }),
  );
  const savedOccurrenceGroup = page.locator("details.official-fields-group").filter({
    has: page.getByRole("heading", { name: /Presenza interdetti · posizione 1$/ }),
  });
  await openDetails(savedOccurrenceGroup);
  await expect(savedOccurrenceGroup.getByRole("textbox", { name: "3 Certificatore" })).toHaveValue(
    "CERT1",
  );
  const secondOccurrenceGroup = page.locator("details.official-fields-group").filter({
    has: page.getByRole("heading", {
      name: /Presenza interdetti · nuova posizione$/,
    }),
  });
  await openDetails(secondOccurrenceGroup);
  await secondOccurrenceGroup.getByRole("textbox", { name: "3 Certificatore" }).fill("CERT2");
  await submitOnlinePracticeForm(
    secondOccurrenceGroup.getByRole("button", { name: "Aggiungi questa posizione" }),
  );

  await selectPracticeView(page, "operational");
  await openPracticeSection(page, "Panoramica");
  let operationalOccurrenceGroup = page.locator("details.operational-fields-group").filter({
    has: page.getByText(
      "Indicatori generali del Quadro EH della dichiarazione selezionata · posizione 1",
      { exact: true },
    ),
  });
  await openDetails(operationalOccurrenceGroup);
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
  await openDetails(secondOperationalOccurrence);
  await expect(
    secondOperationalOccurrence.getByRole("textbox", { name: "3 Certificatore" }),
  ).toHaveValue("CERT2");
  await submitOnlinePracticeForm(
    secondOperationalOccurrence.getByRole("button", { name: "Sposta prima" }),
  );

  operationalOccurrenceGroup = page.locator("details.operational-fields-group").filter({
    has: page.getByText(
      "Indicatori generali del Quadro EH della dichiarazione selezionata · posizione 1",
      { exact: true },
    ),
  });
  await openDetails(operationalOccurrenceGroup);
  await expect(
    operationalOccurrenceGroup.getByRole("textbox", { name: "3 Certificatore" }),
  ).toHaveValue("CERT2");
  const movedSecondOccurrence = page.locator("details.operational-fields-group").filter({
    has: page.getByText(
      "Indicatori generali del Quadro EH della dichiarazione selezionata · posizione 2",
      { exact: true },
    ),
  });
  await openDetails(movedSecondOccurrence);
  await expect(movedSecondOccurrence.getByRole("textbox", { name: "3 Certificatore" })).toHaveValue(
    "CERT1",
  );
  await submitOnlinePracticeForm(
    movedSecondOccurrence.getByRole("button", { name: "Rimuovi posizione" }),
  );
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
  await openDetails(operationalOccurrenceGroup);
  const survivingOccurrenceValue = operationalOccurrenceGroup.getByRole("textbox", {
    name: "3 Certificatore",
  });
  await survivingOccurrenceValue.fill("CERT3");
  await submitOnlinePracticeForm(
    operationalOccurrenceGroup.getByRole("button", { name: "Salva questa posizione" }),
  );
  await selectPracticeView(page, "quadri");
  await openPracticeQuadro(page, "Quadro EH");
  const reloadedOccurrenceGroup = page.locator("details.official-fields-group").filter({
    has: page.getByRole("heading", {
      name: /Presenza interdetti · posizione 1$/,
    }),
  });
  await openDetails(reloadedOccurrenceGroup);
  await expect(
    reloadedOccurrenceGroup.getByRole("textbox", { name: "3 Certificatore" }),
  ).toHaveValue("CERT3");
  await selectPracticeView(page, "operational");
  await openPracticeSection(page, "Devoluzione");
  await expect(page.locator('output[id="field-frontespizio.beneficiari.numero-eredi"]')).toHaveText(
    "2",
  );
  await openPracticeSection(page, "Patrimonio");
  const operationalAssetGroup = page
    .locator("details.operational-fields-group")
    .filter({ hasText: assetName });
  await openDetails(operationalAssetGroup);
  await expect(
    operationalAssetGroup.getByRole("textbox", { name: /^\d+ Valore$/ }).first(),
  ).toHaveValue("200000");
  await openPracticeSection(page, "Persone");
  const reloadedOperationalSubject = page
    .locator("details.operational-fields-group")
    .filter({ hasText: `${canonicalBeneficiaryName} · posizione 2` });
  await openDetails(reloadedOperationalSubject);
  await expect(reloadedOperationalSubject.getByRole("textbox", { name: /^\d+ Nome$/ })).toHaveValue(
    "MARIO",
  );
  await openPracticeSection(page, "Devoluzione");
  const devolutionForm = page.locator("form").filter({
    has: page.getByRole("button", { name: "Salva proposta di devoluzione" }),
  });
  await devolutionForm.getByLabel("Numeratore", { exact: true }).fill("1");
  await devolutionForm.getByLabel("Denominatore", { exact: true }).fill("1");
  await submitOnlinePracticeForm(
    devolutionForm.getByRole("button", { name: "Salva proposta di devoluzione" }),
  );
  await expect(page.getByText("Proposta pronta per la conferma")).toBeVisible();
  await submitOnlinePracticeForm(page.getByRole("button", { name: "Conferma professionalmente" }));
  await expect(page.getByText("Devoluzione confermata")).toBeVisible();

  await openPracticeSection(page, "Imposte e pagamenti");
  await submitOnlinePracticeForm(page.getByRole("button", { name: "Esegui il calcolo" }));
  await expect(page.getByText(/Imposta di successione:/)).toBeVisible();
  await expect(page.getByText("Dati da completare")).toBeVisible();
  await expect(page.getByRole("button", { name: "Conferma il calcolo" })).toHaveCount(0);

  await openPracticeSection(page, "Documenti");
  await expect(page.locator(".checklist-row")).not.toHaveCount(0);

  await openPracticeSection(page, "Riepilogo finale");
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
  await expect(page.getByText(canonicalBeneficiaryName, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(assetName, { exact: true }).first()).toBeVisible();
  const checklistRows = await page
    .locator("section")
    .filter({ hasText: "Documenti richiesti" })
    .locator("tbody tr")
    .allTextContents();
  expect(new Set(checklistRows).size).toBe(checklistRows.length);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
