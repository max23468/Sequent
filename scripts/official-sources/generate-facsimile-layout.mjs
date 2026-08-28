import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const sourceManifest = JSON.parse(
  readFileSync(resolve(repositoryRoot, "src/domain/official-catalog/source-manifest.json"), "utf8"),
);
const source = sourceManifest.sources.find((candidate) => candidate.id === "SRC-03");
if (!source) throw new Error("SRC-03 non presente nel manifest ufficiale");

const sourcePath = resolve(repositoryRoot, "private/official-sources", source.alias);
const sourceBytes = readFileSync(sourcePath);
const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
if (sourceSha256 !== source.sha256)
  throw new Error(`SRC-03 non coincide con il manifest: ${sourceSha256}`);

const pageBands = {
  EA: [{ page: 3, top: 0, bottom: 842 }],
  EB: [{ page: 4, top: 0, bottom: 842 }],
  EC: [{ page: 5, top: 0, bottom: 842 }],
  ER: [{ page: 6, top: 0, bottom: 842 }],
  ED: [{ page: 7, top: 0, bottom: 842 }],
  EE: [{ page: 8, top: 0, bottom: 230 }],
  EF: [{ page: 8, top: 230, bottom: 690 }],
  EG: [{ page: 8, top: 690, bottom: 842 }],
  EH: [9, 10, 11, 12].map((page) => ({ page, top: 0, bottom: 842 })),
  EI: [{ page: 13, top: 0, bottom: 842 }],
  EL: [{ page: 14, top: 0, bottom: 842 }],
  EM: [{ page: 15, top: 0, bottom: 842 }],
  EN: [{ page: 16, top: 0, bottom: 842 }],
  EO: [{ page: 17, top: 0, bottom: 842 }],
  EP: [{ page: 18, top: 0, bottom: 325 }],
  EQ: [{ page: 18, top: 325, bottom: 842 }],
};

const pageWords = new Map();
for (let page = 2; page <= source.pages; page += 1) {
  const html = execFileSync(
    "pdftotext",
    ["-f", String(page), "-l", String(page), "-bbox", sourcePath, "-"],
    { encoding: "utf8" },
  );
  const words = [
    ...html.matchAll(
      /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]+)<\/word>/g,
    ),
  ].map((match) => ({
    xMin: Number(match[1]),
    yMin: Number(match[2]),
    xMax: Number(match[3]),
    yMax: Number(match[4]),
    text: match[5],
  }));
  pageWords.set(page, words);
}

const quadri = {};
for (const [quadro, bands] of Object.entries(pageBands)) {
  const anchors = [];
  for (const band of bands) {
    const numericWords = (pageWords.get(band.page) ?? [])
      .filter((word) => /^\d+$/.test(word.text))
      .filter((word) => {
        const height = word.yMax - word.yMin;
        return height >= 5.4 && height <= 6.1;
      })
      .filter((word) => word.yMin >= band.top && word.yMin < band.bottom)
      .sort((left, right) => left.yMin - right.yMin || left.xMin - right.xMin);
    for (const word of numericWords) {
      const sameRow = numericWords.filter(
        (candidate) =>
          candidate !== word &&
          Math.abs(candidate.yMin - word.yMin) <= 2.2 &&
          candidate.xMin > word.xMin,
      );
      const next = sameRow.sort((left, right) => left.xMin - right.xMin)[0];
      anchors.push({
        number: word.text,
        page: band.page,
        x: Number((word.xMax + 3).toFixed(3)),
        top: Number((word.yMin - 0.5).toFixed(3)),
        width: Number(Math.max(12, Math.min(430, (next?.xMin ?? 552) - word.xMax - 7)).toFixed(3)),
      });
    }
  }
  quadri[quadro] = { bands, anchors };
}

const layout = {
  schemaVersion: 1,
  sourceId: source.id,
  sourceAlias: source.alias,
  sourceSha256,
  sourcePages: source.pages,
  omittedSourcePages: [1],
  quadri,
};

writeFileSync(
  resolve(repositoryRoot, "src/domain/official-catalog/facsimile-layout.json"),
  `${JSON.stringify(layout, null, 2)}\n`,
);
