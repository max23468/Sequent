import { expect, test } from "@playwright/test";
import {
  authenticate,
  createPracticeFromDashboard,
  openAccountMenu,
  password,
  resetFailedBlobVerification,
  suffix,
  unique,
  uploadFromWorkspace,
  username,
} from "./onboarding-support.ts";

test.describe.configure({ mode: "serial" });
test.afterEach(resetFailedBlobVerification);

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

test("anima le superfici e azzera il movimento quando richiesto dal sistema", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
  await authenticate(page);
  const panel = page.locator(".dashboard-panel").first();
  expect(await panel.evaluate((element) => getComputedStyle(element).animationName)).toContain(
    "surface-enter",
  );

  await page.getByRole("button", { name: "Nuova pratica" }).click();
  const dialog = page.getByRole("dialog", { name: "Assegna un nome alla pratica" });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((element) => getComputedStyle(element).animationName)).toContain(
    "dialog-enter",
  );
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  const reducedDuration = await page
    .locator(".dashboard-panel")
    .first()
    .evaluate((element) => {
      const value = getComputedStyle(element).animationDuration;
      return value.endsWith("ms") ? Number.parseFloat(value) : Number.parseFloat(value) * 1_000;
    });
  expect(reducedDuration).toBeLessThanOrEqual(0.01);
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
  await expect(page.locator(".account-menu-trigger")).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(page.locator(".account-menu-trigger")).toHaveAttribute("aria-expanded", "false");

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
