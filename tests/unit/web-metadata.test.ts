import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appHtml = readFileSync("src/app.html", "utf8");
const robots = readFileSync("static/robots.txt", "utf8");
const manifest = JSON.parse(readFileSync("static/site.webmanifest", "utf8")) as {
  name: string;
  short_name: string;
  icons: Array<{ src: string; sizes: string; purpose: string }>;
};

describe("production browser metadata", () => {
  it("declares adaptive browser chrome and icon metadata", () => {
    expect(appHtml).toContain('name="color-scheme" content="light dark"');
    expect(appHtml).toContain('id="sequent-theme-color"');
    expect(appHtml).toContain('href="/favicon.ico"');
    expect(appHtml).toContain('href="/favicon-dark.svg"');
    expect(appHtml).toContain('media="(prefers-color-scheme: dark)"');
    expect(appHtml).toContain('href="/apple-touch-icon.png"');
    expect(appHtml).toContain('href="/site.webmanifest"');
    expect(appHtml).toContain('src="/browser-theme.js"');
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
      "static/favicon-dark.svg",
      "static/apple-touch-icon.png",
      "static/browser-theme.js",
      "static/robots.txt",
    ]) {
      expect(existsSync(asset), `${asset} must exist`).toBe(true);
    }
  });
});
