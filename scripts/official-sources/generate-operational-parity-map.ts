import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { format } from "oxfmt";
import { buildOperationalParityMap } from "../../src/domain/operational-parity.ts";

const outputPath = resolve(
  process.cwd(),
  "src/domain/official-catalog/operational-view-parity.json",
);

const matrix = buildOperationalParityMap();
for (const row of matrix) {
  if (
    row.destinationReview.uiDecision === "definitiva" &&
    row.destinationReview.status !== "qualificata"
  )
    throw new Error(`Destinazione UI definitiva senza qualificazione: ${row.fieldId}`);
  if (
    row.destinationReview.uiDecision === "non-definitiva" &&
    row.destinationReview.status !== "irrisolta"
  )
    throw new Error(`Destinazione UI non definitiva senza blocker: ${row.fieldId}`);
  if (row.semanticReview.status === "irrisolta" && row.handling !== null)
    throw new Error(`Modalità assegnata senza qualificazione sufficiente: ${row.fieldId}`);
  if (row.semanticReview.status === "irrisolta" && row.semanticReview.blocker === null)
    throw new Error(`Classificazione irrisolta senza blocker: ${row.fieldId}`);
}

const source = `${JSON.stringify(matrix, null, 2)}\n`;
const formatted = await format(outputPath, source);
if (formatted.errors.length > 0)
  throw new Error(`Impossibile formattare la matrice: ${formatted.errors[0]?.message}`);
await writeFile(outputPath, formatted.code, "utf8");
const qualificationCounts = Object.fromEntries(
  ["qualificata", "candidata", "irrisolta"].map((status) => [
    status,
    matrix.filter((row) => row.semanticReview.status === status).length,
  ]),
);
const coverageCounts = Object.fromEntries(
  ["coperto", "parziale", "mancante"].map((status) => [
    status,
    matrix.filter((row) => row.currentCoverage === status).length,
  ]),
);
console.log(
  `Matrice di parità operativa aggiornata: ${outputPath} (qualificazione ${JSON.stringify(qualificationCounts)}, copertura ${JSON.stringify(coverageCounts)})`,
);
