import { expect, test } from "@playwright/test";

const benchmarkSamples = 7;
const password = "SequentSviluppoSicuro2026";
const practiceTitle = "Benchmark sintetico prestazioni";

interface NavigationSample {
  responseStart: number;
  domContentLoaded: number;
  load: number;
  firstContentfulPaint: number | null;
  largestContentfulPaint: number | null;
  cumulativeLayoutShift: number;
  resourceCount: number;
  totalEncodedBytes: number;
  javascriptEncodedBytes: number;
  cssEncodedBytes: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function summarize(samples: NavigationSample[]) {
  return {
    samples: samples.length,
    responseStartMs: median(samples.map((sample) => sample.responseStart)),
    domContentLoadedMs: median(samples.map((sample) => sample.domContentLoaded)),
    loadMs: median(samples.map((sample) => sample.load)),
    firstContentfulPaintMs: median(
      samples
        .map((sample) => sample.firstContentfulPaint)
        .filter((value): value is number => value !== null),
    ),
    largestContentfulPaintMs: median(
      samples
        .map((sample) => sample.largestContentfulPaint)
        .filter((value): value is number => value !== null),
    ),
    cumulativeLayoutShift: median(samples.map((sample) => sample.cumulativeLayoutShift)),
    resourceCount: median(samples.map((sample) => sample.resourceCount)),
    totalEncodedBytes: median(samples.map((sample) => sample.totalEncodedBytes)),
    javascriptEncodedBytes: median(samples.map((sample) => sample.javascriptEncodedBytes)),
    cssEncodedBytes: median(samples.map((sample) => sample.cssEncodedBytes)),
  };
}

test("misura Dashboard, ricerca e apertura pratica sulla build di produzione", async ({
  page,
  context,
}) => {
  await page.goto("/");
  if (page.url().endsWith("/login")) {
    await page.getByLabel("Nome utente").fill("Benchmark");
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Accedi" }).click();
  }
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  await page.getByRole("button", { name: "Nuova pratica" }).click();
  await page.getByLabel("Nome della pratica").fill(practiceTitle);
  await page.getByRole("button", { name: "Crea pratica" }).click();
  await expect(page.getByRole("heading", { name: practiceTitle })).toBeVisible();

  await page.addInitScript(() => {
    const state = window as typeof window & {
      __sequentLcp?: number;
      __sequentCls?: number;
    };
    state.__sequentLcp = 0;
    state.__sequentCls = 0;
    try {
      new PerformanceObserver((list) => {
        const entry = list.getEntries().at(-1);
        if (entry) state.__sequentLcp = entry.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const shift = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
          if (!shift.hadRecentInput) state.__sequentCls! += shift.value ?? 0;
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch {
      // Le metriche di navigazione e payload restano comunque disponibili.
    }
  });

  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });

  const samples: NavigationSample[] = [];
  for (let index = 0; index < benchmarkSamples; index += 1) {
    await page.goto("/", { waitUntil: "load" });
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await page.waitForTimeout(100);
    samples.push(
      await page.evaluate(() => {
        const state = window as typeof window & {
          __sequentLcp?: number;
          __sequentCls?: number;
        };
        const navigation = performance.getEntriesByType("navigation")[0] as
          | PerformanceNavigationTiming
          | undefined;
        if (!navigation) throw new Error("PERFORMANCE_NAVIGATION_MISSING");
        const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
        return {
          responseStart: navigation.responseStart,
          domContentLoaded: navigation.domContentLoadedEventEnd,
          load: navigation.loadEventEnd,
          firstContentfulPaint:
            performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null,
          largestContentfulPaint: state.__sequentLcp || null,
          cumulativeLayoutShift: state.__sequentCls ?? 0,
          resourceCount: resources.length,
          totalEncodedBytes: resources.reduce(
            (total, resource) => total + resource.encodedBodySize,
            0,
          ),
          javascriptEncodedBytes: resources
            .filter((resource) => resource.initiatorType === "script")
            .reduce((total, resource) => total + resource.encodedBodySize, 0),
          cssEncodedBytes: resources
            .filter(
              (resource) => resource.initiatorType === "link" && resource.name.endsWith(".css"),
            )
            .reduce((total, resource) => total + resource.encodedBodySize, 0),
        };
      }),
    );
  }

  await cdp.send("Network.setCacheDisabled", { cacheDisabled: false });
  await page.goto("/");
  const searchRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/search") searchRequests.push(request.url());
  });
  await page.getByRole("searchbox", { name: "Cerca in Sequent" }).pressSequentially("Benchmark", {
    delay: 20,
  });
  await page.waitForTimeout(700);
  await expect(
    page.locator("#global-search-results").getByText(practiceTitle, { exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Cancella ricerca" }).click();
  const navigationStartedAt = performance.now();
  await page.getByRole("link", { name: "Riprendi ultima pratica" }).click();
  await expect(page.getByRole("heading", { name: practiceTitle })).toBeVisible();
  const practiceNavigationMs = performance.now() - navigationStartedAt;

  const dashboard = summarize(samples);
  const result = {
    dashboard,
    searchRequestsForNineCharacters: searchRequests.length,
    practiceNavigationMs,
  };
  console.log(`SEQUENT_WEB_PERFORMANCE ${JSON.stringify(result)}`);

  expect(dashboard.totalEncodedBytes).toBeLessThanOrEqual(165_000);
  expect(dashboard.cssEncodedBytes).toBeLessThanOrEqual(30_000);
  expect(dashboard.javascriptEncodedBytes).toBeLessThanOrEqual(135_000);
  expect(dashboard.cumulativeLayoutShift).toBeLessThanOrEqual(0.01);
  expect(searchRequests.length).toBe(1);
});
