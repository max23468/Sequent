import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const fixturePath = (name: string) => join(process.cwd(), "tests", "fixtures", name);
const fixture = (name: string) => readFileSync(fixturePath(name));

function unique(label: string) {
  return `${label} ${suffix}`;
}

async function authenticate(page: import("@playwright/test").Page) {
  await page.goto("/");
  if (page.url().endsWith("/setup")) {
    await page.getByLabel("Nome utente").fill("E2E Owner");
    await page.getByLabel("Password").fill("SequentE2EPassword2026!");
    await page.getByLabel("Conferma password").fill("SequentE2EPassword2026!");
    await page.getByRole("button", { name: "Crea accesso" }).click();
    await expect(page).toHaveURL(/\/$/);
    return;
  }
  if (page.url().endsWith("/login")) {
    await page.getByLabel("Nome utente").fill("E2E Owner");
    await page.getByLabel("Password").fill("SequentE2EPassword2026!");
    await page.getByRole("button", { name: "Accedi" }).click();
    await expect(page).toHaveURL(/\/$/);
  }
}

async function createPracticeFromDashboard(
  page: import("@playwright/test").Page,
  practiceTitle: string,
) {
  await page.getByRole("button", { name: "Nuova" }).click();
  await page.getByLabel("Titolo pratica").fill(practiceTitle);
  await page.getByRole("button", { name: "Crea pratica" }).click();
}

async function uploadFromDashboard(
  page: import("@playwright/test").Page,
  name: string,
  content: string,
) {
  await page.getByRole("button", { name: "Carica documenti" }).click();
  const fileInput = page.locator("#dashboard-file");
  await fileInput.setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(content) });
  await page.getByRole("button", { name: "Carica", exact: true }).click();
}

async function openPractice(page: import("@playwright/test").Page, title: string) {
  await page.getByRole("link", { name: title }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
}

async function setTheme(page: import("@playwright/test").Page, theme: "light" | "dark") {
  await page.locator("details.account-menu > summary").click();
  await page.locator(`.theme-selector button[data-theme="${theme}"]`).click();
  await page.keyboard.press("Escape");
}

async function confirmOfficialInstructions(button: import("@playwright/test").Locator) {
  const confirmation = button
    .locator("xpath=ancestor::form")
    .getByRole("checkbox", { name: "Confermo di aver verificato queste indicazioni" });
  if ((await confirmation.count()) > 0) await confirmation.check();
}

test("crea una pratica e usa il workspace minimo", async ({ page }) => {
  const practiceTitle = unique("Pratica workspace");
  const workspaceDocument = `workspace-${suffix}.txt`;
  await authenticate(page);
  const protectedResponse = await page.reload();
  const crawlerPolicy = "noindex, nofollow, noarchive, nosnippet, noimageindex";
  expect(protectedResponse?.headers()["x-robots-tag"]).toBe(crawlerPolicy);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", crawlerPolicy);
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
  await expect(page).toHaveTitle(`${practiceTitle} · Sequent`);
  await expect(page.getByRole("button", { name: "Documenti", exact: true })).toBeVisible();
  const workspaceTitleSize = await page
    .getByRole("heading", { name: practiceTitle })
    .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
  expect(workspaceTitleSize).toBeGreaterThan(dashboardTitleSize);
  await page.locator("#workspace-file").setInputFiles({
    name: workspaceDocument,
    mimeType: "text/plain",
    buffer: Buffer.from("Documento sintetico per workspace E2E"),
  });
  await page.getByRole("button", { name: "Carica", exact: true }).click();
  await expect(page.getByText(workspaceDocument)).toBeVisible();
});

test("carica un documento dalla dashboard e lo associa a una pratica", async ({ page }) => {
  const practiceTitle = unique("Pratica dashboard upload");
  await authenticate(page);
  await createPracticeFromDashboard(page, practiceTitle);
  await page.getByRole("link", { name: "Dashboard" }).click();
  await uploadFromDashboard(page, `dashboard-${suffix}.txt`, "Documento sintetico dashboard E2E");
  await page.getByRole("combobox", { name: "Associa a pratica" }).selectOption({ label: practiceTitle });
  await page.getByRole("button", { name: "Associa" }).click();
  await openPractice(page, practiceTitle);
  await expect(page.getByText(`dashboard-${suffix}.txt`)).toBeVisible();
});

test("crea una pratica da file DIZ sintetico", async ({ page }) => {
  await authenticate(page);
  await page.getByRole("button", { name: "Nuova" }).click();
  await page.getByRole("button", { name: "Importa DIZ" }).click();
  await page.locator("#practice-diz").setInputFiles({
    name: `synthetic-${suffix}.diz`,
    mimeType: "application/octet-stream",
    buffer: Buffer.from("DIZ-SYNTHETIC-E2E"),
  });
  await page.getByRole("button", { name: "Importa pratica" }).click();
  await expect(page).toHaveURL(/\/pratiche\/.+/);
  await expect(page.getByRole("heading", { name: /synthetic-/i })).toBeVisible();
});

test("ricerca una pratica dalla testata", async ({ page }) => {
  const practiceTitle = unique("Pratica ricerca");
  await authenticate(page);
  await createPracticeFromDashboard(page, practiceTitle);
  await page.getByRole("link", { name: "Dashboard" }).click();
  const search = page.getByRole("searchbox", { name: "Cerca pratiche e documenti" });
  await search.fill(practiceTitle);
  await expect(page.getByRole("link", { name: practiceTitle })).toBeVisible();
});

test("cambia tema e lo mantiene dopo il reload", async ({ page }) => {
  await authenticate(page);
  await setTheme(page, "dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#0F1214");
  await setTheme(page, "light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#FFFEFF");
});

test("apre le sezioni principali dalla navigazione", async ({ page }) => {
  await authenticate(page);
  await page.getByRole("link", { name: "Pratiche", exact: true }).click();
  await expect(page).toHaveTitle("Pratiche · Sequent");
  await page.getByRole("link", { name: "Documenti", exact: true }).click();
  await expect(page).toHaveTitle("Documenti · Sequent");
  await page.getByRole("link", { name: "Impostazioni", exact: true }).click();
  await expect(page).toHaveTitle("Impostazioni · Sequent");
});

test("mostra la pagina di errore con titolo contestuale", async ({ page }) => {
  await authenticate(page);
  await page.goto("/pagina-inesistente-e2e");
  await expect(page).toHaveTitle("Pagina non trovata · Sequent");
  await expect(page.getByText("La pagina richiesta non esiste.")).toBeVisible();
});

test("mantiene il design lab fuori dall'istanza normale salvo flag di test", async ({ page }) => {
  await authenticate(page);
  await page.goto("/__design");
  await expect(page).toHaveURL(/\/__design$/);
  await expect(page).toHaveTitle("Design Lab · Sequent");
});

test("espone gli asset browser e la policy crawler", async ({ request }) => {
  const [favicon, appleIcon, pinnedTab, manifest, robots] = await Promise.all([
    request.get("/favicon.svg"),
    request.get("/apple-touch-icon.png"),
    request.get("/safari-pinned-tab.svg"),
    request.get("/site.webmanifest"),
    request.get("/robots.txt"),
  ]);
  expect(favicon.ok()).toBe(true);
  expect(appleIcon.ok()).toBe(true);
  expect(pinnedTab.ok()).toBe(true);
  expect(manifest.ok()).toBe(true);
  expect(robots.ok()).toBe(true);
  expect(await robots.text()).toBe("User-agent: *\nDisallow: /\n");
});

test("preserva una revisione esplicita prima di applicare un dato proposto", async ({ page }) => {
  const practiceTitle = unique("Pratica revisione");
  await authenticate(page);
  await createPracticeFromDashboard(page, practiceTitle);
  await page.getByRole("button", { name: "Da verificare" }).click();
  const analyze = page.getByRole("button", { name: /Analizza/ });
  if (await analyze.isEnabled()) {
    await confirmOfficialInstructions(analyze);
    await analyze.click();
  }
});

test("usa fixture PDF sintetica per il caricamento documentale", async ({ page }) => {
  const practiceTitle = unique("Pratica PDF");
  await authenticate(page);
  await createPracticeFromDashboard(page, practiceTitle);
  const pdf = fixture("synthetic-document.pdf");
  await page.locator("#workspace-file").setInputFiles({
    name: `synthetic-${suffix}.pdf`,
    mimeType: "application/pdf",
    buffer: pdf,
  });
  await page.getByRole("button", { name: "Carica", exact: true }).click();
  await expect(page.getByText(`synthetic-${suffix}.pdf`)).toBeVisible();
});
