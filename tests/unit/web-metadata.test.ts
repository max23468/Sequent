import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appHtml = readFileSync("src/app.html", "utf8");
const faviconSvg = readFileSync("static/favicon.svg", "utf8");
const pinnedTabSvg = readFileSync("static/safari-pinned-tab.svg", "utf8");
const robots = readFileSync("static/robots.txt", "utf8");
const manifest = JSON.parse(readFileSync("static/site.webmanifest", "utf8")) as {
  name: string;
  short_name: string;
  icons: Array<{ src: string; sizes: string; type: string; purpose: string }>;
};

describe("production browser metadata", () => {
  it("declares adaptive browser chrome and Apple icon metadata", () => {
    expect(appHtml).toContain('name="color-scheme" content="light dark"');
    expect(appHtml).toContain('id="sequent-theme-color"');
    expect(appHtml).toContain('href="/favicon.ico"');
    expect(appHtml).toContain('href="/favicon.svg"');
    expect(appHtml).toContain('rel="mask-icon"');
    expect(appHtml).toContain('href="/safari-pinned-tab.svg"');
    expect(appHtml).toContain('href="/apple-touch-icon.png"');
    expect(appHtml).toContain('href="/site.webmanifest"');
    expect(appHtml).toContain('src="/browser-theme.js"');
  });

  it("keeps the SVG favicon readable when Safari ignores dark-mode SVG media queries", () => {
    expect(faviconSvg).toContain('class="tile"');
    expect(faviconSvg).toContain("@media (prefers-color-scheme: dark)");
    expect(faviconSvg).toContain("#001e42");
    expect(faviconSvg).toContain("#41c4c9");
  });

  it("keeps the Safari pinned-tab asset monochrome", () => {
    expect(pinnedTabSvg).toContain('viewBox="0 0 16 16"');
    expect(pinnedTabSvg).toContain('fill="#000"');
  });

  it("keeps crawler discovery disabled", () => {
    expect(robots).toBe("User-agent: *\nDisallow: /\n");
  });

  it("keeps all manifest icon assets present", () => {
    expect(manifest.name).toBe("Sequent");
    expect(manifest.short_name).toBe("Sequent");
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: "/icons/sequent-192.png", sizes: "192x192" }),
        expect.objectContaining({ src: "/icons/sequent-512.png", sizes: "512x512" }),
        expect.objectContaining({
          src: "/icons/sequent-maskable.svg",
          sizes: "any",
          type: "image/svg+xml",
          purpose: "maskable",
        }),
        expect.objectContaining({
          src: "/icons/sequent-maskable-512.png",
          sizes: "512x512",
          purpose: "maskable",
        }),
      ]),
    );

    for (const icon of manifest.icons) {
      expect(existsSync(`static${icon.src}`), `${icon.src} must exist`).toBe(true);
    }
  });

  it("keeps standalone browser assets present", () => {
    for (const asset of [
      "static/favicon.ico",
      "static/favicon.svg",
      "static/safari-pinned-tab.svg",
      "static/apple-touch-icon.png",
      "static/browser-theme.js",
      "static/robots.txt",
    ]) {
      expect(existsSync(asset), `${asset} must exist`).toBe(true);
    }
  });
});
