import { error, fail, redirect } from "@sveltejs/kit";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Actions, PageServerLoad } from "./$types";
import { openDatabase } from "$lib/server/database";
import { isCodexEnabled } from "$lib/server/config";
import { describeDocumentIngestionFailure, ingestDocument } from "$lib/server/document-ingestion";
import { decideReviewItem, getDocumentText, listReviewItems } from "$lib/server/documents";
import {
  enqueuePracticeAnalysis,
  listFailedBlobVerifications,
  listPracticeJobs,
  retryJob,
} from "$lib/server/jobs";
import { hasCodexThread, listCodexRuns, resetCodexThread } from "$lib/server/codex-analysis";
import { cancelPracticeJob } from "$lib/server/job-runner";
import {
  createSuccessiveDeclaration,
  getDeclaration,
  getPractice,
  listDeclarations,
  listPracticeDocuments,
  renamePractice,
} from "$lib/server/practices";
import {
  buildComplianceReport,
  confirmCalculationRun,
  confirmDevolutionScenario,
  createDeclarationSubjectEntry,
  createSharedAsset,
  createSharedSubject,
  listCalculationRuns,
  listDevolutionScenarios,
  listDomainAuditEvents,
  listDeclarationSubjectEntries,
  listSharedAssets,
  listSharedSubjects,
  runSuccessionCalculation,
  saveCanonicalField,
  saveCanonicalFields,
  saveDevolutionScenario,
  synchronizeChecklist,
  updateChecklistItem,
  type AssetKind,
} from "$lib/server/domain";
import {
  getCatalogStatus,
  listQuadroFields,
  listQuadroSummaries,
  QUADRI,
  type QuadroId,
} from "../../../domain/official-catalog/catalog.ts";
import {
  OPERATIONAL_SECTION_AREAS,
  isOperationalSectionId,
  isOperationalParityEditable,
  listOperationalAreaFields,
  type OperationalSectionId,
} from "../../../domain/operational-parity.ts";
import { validateFieldValue } from "../../../domain/validation.ts";
import {
  listOfficialAttachments,
  prepareOfficialAttachment,
} from "$lib/server/official-attachments";

const shortLabel = z.string().trim().min(1, "Inserisci una descrizione.").max(160);
const practiceTitle = z
  .string()
  .trim()
  .min(1, "Inserisci un nome.")
  .max(120, "Usa al massimo 120 caratteri.");
const subjectRole = z.enum(["decedent", "beneficiary", "representative", "other"]);
const assetKind = z.enum([
  "land",
  "building",
  "tavolare_land",
  "tavolare_building",
  "company",
  "securities",
  "aircraft",
  "vessel",
  "money",
  "inventory",
  "other",
  "liability",
  "donation",
]);
const declarationKind = z.enum(["substitute-1", "substitute-2", "substitute-3"]);

const OPERATIONAL_FIELD_SECTIONS = new Map<string, OperationalSectionId>(
  (
    Object.entries(OPERATIONAL_SECTION_AREAS) as Array<
      [OperationalSectionId, (typeof OPERATIONAL_SECTION_AREAS)[OperationalSectionId]]
    >
  ).flatMap(([section, area]) =>
    listOperationalAreaFields(area).map((field) => [field.canonicalId, section]),
  ),
);

function issueOperationalSection(issue: {
  id: string;
  fieldId: string | null;
}): OperationalSectionId | null {
  if (issue.fieldId) return OPERATIONAL_FIELD_SECTIONS.get(issue.fieldId) ?? null;
  if (issue.id.startsWith("CHECKLIST_") || issue.id.startsWith("OFFICIAL_ATTACHMENTS_"))
    return "documents";
  if (issue.id.startsWith("DEVOLUTION_")) return "devolution";
  if (issue.id.startsWith("CALCULATION_")) return "taxes";
  return null;
}

function euroToCents(value: unknown): bigint | null {
  const normalized = String(value ?? "")
    .trim()
    .replaceAll(".", "")
    .replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [euros = "0", cents = ""] = normalized.split(".");
  return BigInt(euros) * 100n + BigInt(cents.padEnd(2, "0"));
}

function nonNegativeInteger(value: unknown): bigint | null {
  const normalized = String(value ?? "").trim() || "0";
  return /^\d+$/.test(normalized) ? BigInt(normalized) : null;
}

export const load: PageServerLoad = ({ locals, params, url }) => {
  if (!locals.ownerId) redirect(303, "/login");
  const database = openDatabase();
  const practice = getPractice(database, params.id);
  if (!practice) error(404, "Pratica non trovata");
  const documents = listPracticeDocuments(database, params.id);
  const selectedId = url.searchParams.get("documento");
  const reviewItems = listReviewItems(database, params.id);
  const selectedReviewId = url.searchParams.get("verifica");
  const selectedReview =
    reviewItems.find((item) => item.id === selectedReviewId) ?? reviewItems.at(0) ?? null;
  const selectedDocument =
    documents.find((document) => document.id === selectedId) ??
    documents.find((document) => document.id === selectedReview?.documentId) ??
    documents.at(0) ??
    null;
  const jobs = listPracticeJobs(database, params.id);
  const selectedQuadro = QUADRI.includes(url.searchParams.get("quadro") as QuadroId)
    ? (url.searchParams.get("quadro") as QuadroId)
    : "EA";
  const declarations = listDeclarations(database, params.id);
  const requestedDeclarationId = url.searchParams.get("dichiarazione");
  const declaration =
    declarations.find((candidate) => candidate.id === requestedDeclarationId) ??
    declarations.find((candidate) => candidate.id === practice.declarationId) ??
    declarations.at(-1) ??
    null;
  if (!declaration) error(500, "Dichiarazione non disponibile");
  const subjects = listSharedSubjects(database, params.id);
  const selectedDecedent = subjects.find((subject) => subject.role === "decedent") ?? null;
  const quadroSubjects = listDeclarationSubjectEntries(database, params.id, declaration.id);
  const selectedSubject =
    quadroSubjects.find((subject) => subject.id === url.searchParams.get("soggetto")) ??
    quadroSubjects.at(0) ??
    null;
  const assets = listSharedAssets(database, params.id, declaration.id);
  const quadroAssets = assets.filter((asset) => asset.quadro === selectedQuadro);
  const selectedAsset =
    quadroAssets.find((asset) => asset.id === url.searchParams.get("bene")) ??
    quadroAssets.at(0) ??
    null;
  const complianceReport = buildComplianceReport(database, params.id, declaration.id);
  const quadroFields = listQuadroFields(selectedQuadro).filter(
    (field) => field.visibleFieldId !== null,
  );
  const requestedSection = url.searchParams.get("sezione") ?? "overview";
  const operationalArea = isOperationalSectionId(requestedSection)
    ? OPERATIONAL_SECTION_AREAS[requestedSection]
    : null;
  const operationalFields = operationalArea ? listOperationalAreaFields(operationalArea) : [];
  const newOccurrenceIds = Object.fromEntries(
    [
      ...new Set(
        [...quadroFields, ...operationalFields]
          .map((field) => field.occurrenceGroup)
          .filter(Boolean),
      ),
    ].map((group) => [group, randomUUID()]),
  );
  return {
    practice,
    documents,
    failedVerifications: listFailedBlobVerifications(database, params.id),
    selectedDocument,
    officialAttachments: listOfficialAttachments(database, params.id),
    selectedDocumentPages: selectedDocument ? getDocumentText(database, selectedDocument.id) : [],
    reviewItems,
    selectedReview,
    activeJobs: jobs.filter((job) => job.status === "queued" || job.status === "running"),
    failedJobs: jobs.filter((job) => job.status === "failed" || job.status === "cancelled"),
    codexRuns: listCodexRuns(database, params.id),
    hasCodexThread: hasCodexThread(database, params.id),
    declaration,
    declarations,
    subjects,
    selectedDecedent,
    quadroSubjects,
    selectedSubject,
    assets,
    quadroAssets,
    selectedAsset,
    checklist: synchronizeChecklist(database, params.id, declaration.id),
    devolutionScenarios: listDevolutionScenarios(database, params.id, declaration.id),
    calculationRuns: listCalculationRuns(database, params.id, declaration.id),
    auditEvents: listDomainAuditEvents(database, params.id),
    catalogStatus: getCatalogStatus(),
    quadri: listQuadroSummaries(),
    selectedQuadro,
    quadroFields,
    operationalArea,
    operationalFields,
    newOccurrenceIds,
    declarationIssues: complianceReport.issues.map((issue) => ({
      ...issue,
      operationalSection: issueOperationalSection(issue),
    })),
    declarationReady: complianceReport.ready,
    codexEnabled: isCodexEnabled(),
  };
};

export const actions = {
  rename: async ({ locals, params, request, url }) => {
    if (!locals.ownerId) redirect(303, "/login");
    const database = openDatabase();
    if (!getPractice(database, params.id)) error(404, "Pratica non trovata");
    const formData = await request.formData();
    const parsed = practiceTitle.safeParse(formData.get("title"));
    if (!parsed.success) return fail(400, { renameError: parsed.error.issues[0]?.message });
    if (!renamePractice(database, params.id, parsed.data)) error(404, "Pratica non trovata");
    const search = new URLSearchParams(url.searchParams);
    for (const key of Array.from(search.keys())) {
      if (key.startsWith("/")) search.delete(key);
    }
    redirect(303, `${url.pathname}${search.size > 0 ? `?${search}` : ""}`);
  },
  upload: async ({ locals, params, request }) => {
    if (!locals.ownerId) redirect(303, "/login");
    const database = openDatabase();
    const practice = getPractice(database, params.id);
    if (!practice) error(404, "Pratica non trovata");
    const file = (await request.formData()).get("file");
    if (!(file instanceof File) || file.size === 0)
      return fail(400, { uploadError: "Scegli un documento da caricare." });
    try {
      const document = await ingestDocument(database, file, { practiceId: params.id });
      redirect(303, `/pratiche/${params.id}?documento=${document.id}`);
    } catch (uploadError) {
      const failure = describeDocumentIngestionFailure(uploadError);
      if (failure) return fail(failure.status, { uploadError: failure.message });
      throw uploadError;
    }
  },
  analyze: ({ locals, params }) => {
    if (!locals.ownerId) redirect(303, "/login");
    if (!isCodexEnabled())
      return fail(403, { analyzeError: "L’analisi Codex è disattivata in questo ambiente." });
    const database = openDatabase();
    if (!getPractice(database, params.id)) error(404, "Pratica non trovata");
    const documents = listPracticeDocuments(database, params.id);
    if (documents.length === 0)
      return fail(400, { analyzeError: "Carica almeno un documento prima dell’analisi." });
    if (
      documents.every(
        (document) => document.status !== "processed" && document.status !== "to_review",
      )
    )
      return fail(409, {
        analyzeError: "Attendi il completamento dell’elaborazione dei documenti.",
      });
    enqueuePracticeAnalysis(database, params.id);
    redirect(303, `/pratiche/${params.id}?sezione=verifications`);
  },
  review: async ({ locals, params, request }) => {
    if (!locals.ownerId) redirect(303, "/login");
    const formData = await request.formData();
    const itemId = String(formData.get("itemId") ?? "");
    const decision = String(formData.get("decision") ?? "");
    const database = openDatabase();
    const item = listReviewItems(database, params.id).find((candidate) => candidate.id === itemId);
    if (!item) return fail(404, { reviewError: "Verifica non trovata o già risolta." });
    if (!["confirmed", "edited", "rejected", "ignored"].includes(decision))
      return fail(400, { reviewError: "Decisione non valida." });
    const editedValue = String(formData.get("value") ?? "").trim();
    if (decision === "edited" && (!editedValue || editedValue.length > 2_000))
      return fail(400, { reviewError: "Inserisci un valore valido da confermare." });
    if (decision === "confirmed" && item.proposedValue === null)
      return fail(400, {
        reviewError: "Scegli o inserisci il valore autorevole prima di confermare il conflitto.",
      });
    const accepted = decideReviewItem(database, params.id, itemId, {
      status: decision as "confirmed" | "edited" | "rejected" | "ignored",
      value: decision === "edited" ? editedValue : item.proposedValue,
    });
    if (!accepted) return fail(409, { reviewError: "La verifica è già stata aggiornata." });
    redirect(303, `/pratiche/${params.id}?sezione=verifications`);
  },
  retry: async ({ locals, params, request }) => {
    if (!locals.ownerId) redirect(303, "/login");
    const formData = await request.formData();
    const jobId = String(formData.get("jobId") ?? "");
    if (!retryJob(openDatabase(), jobId, params.id))
      return fail(409, { retryError: "Il lavoro non può essere ritentato." });
    redirect(303, `/pratiche/${params.id}`);
  },
  cancel: async ({ locals, params, request }) => {
    if (!locals.ownerId) redirect(303, "/login");
    const formData = await request.formData();
    const jobId = String(formData.get("jobId") ?? "");
    if (!cancelPracticeJob(openDatabase(), jobId, params.id))
      return fail(409, { cancelError: "Il lavoro non può più essere annullato." });
    redirect(303, `/pratiche/${params.id}`);
  },
  resetCodex: ({ locals, params }) => {
    if (!locals.ownerId) redirect(303, "/login");
    const database = openDatabase();
    if (!getPractice(database, params.id)) error(404, "Pratica non trovata");
    resetCodexThread(database, params.id);
    redirect(303, `/pratiche/${params.id}?sezione=verifications`);
  },
  prepareAttachment: async ({ locals, params, request }) => {
    if (!locals.ownerId) redirect(303, "/login");
    const formData = await request.formData();
    const documentId = String(formData.get("documentId") ?? "");
    if (!documentId) return fail(400, { attachmentError: "Documento non identificato." });
    try {
      await prepareOfficialAttachment(openDatabase(), { practiceId: params.id, documentId });
    } catch (attachmentError) {
      const messages: Record<string, string> = {
        FORMATO_ALLEGATO_NON_PREPARABILE:
          "Questo formato non può ancora essere trasformato in un allegato ufficiale.",
        ALLEGATO_OLTRE_5_MB:
          "L’allegato supera 5 MB anche dopo la preparazione e deve essere suddiviso.",
        PAGINA_PDF_OLTRE_5_MB:
          "Una singola pagina supera 5 MB e non può essere inclusa senza una nuova scansione.",
        PACCHETTO_ALLEGATI_OLTRE_40_MB:
          "L’insieme degli allegati supererebbe il limite complessivo di 40 MB.",
        VALIDAZIONE_PDFA_NON_SUPERATA:
          "La conversione non ha superato il controllo effettivo PDF/A-1b.",
        VALIDAZIONE_TIFF_NON_SUPERATA:
          "La conversione non ha superato il controllo TIFF in bianco e nero a 300 DPI.",
      };
      if (attachmentError instanceof Error)
        return fail(400, {
          attachmentError:
            messages[attachmentError.message] ??
            "Non è stato possibile preparare e controllare l’allegato.",
        });
      throw attachmentError;
    }
    redirect(303, `/pratiche/${params.id}?documento=${encodeURIComponent(documentId)}`);
  },
  addSubject: async ({ locals, params, request }) => {
    if (!locals.ownerId) redirect(303, "/login");
    const database = openDatabase();
    const practice = getPractice(database, params.id);
    if (!practice) error(404, "Pratica non trovata");
    const formData = await request.formData();
    const declarationId = String(formData.get("declarationId") ?? practice.declarationId);
    const targetDeclaration = getDeclaration(database, declarationId, params.id);
    if (!targetDeclaration) return fail(404, { domainError: "Dichiarazione non trovata." });
    const parsed = z
      .object({
        displayName: shortLabel,
        role: subjectRole,
        taxCode: z.string().trim().max(32).optional(),
      })
      .safeParse({
        displayName: formData.get("displayName"),
        role: formData.get("role"),
        taxCode: formData.get("taxCode"),
      });
    if (!parsed.success)
      return fail(400, { domainError: parsed.error.issues[0]?.message ?? "Dati non validi." });
    const taxCode = parsed.data.taxCode ?? "";
    if (taxCode) {
      const issues = validateFieldValue(
        parsed.data.role === "decedent"
          ? "frontespizio.defunto.codice-fiscale"
          : "quadro-ea.soggetto.codice-fiscale",
        taxCode,
      );
      if (issues.length > 0)
        return fail(400, { domainError: issues[0]?.message ?? "Codice fiscale non valido." });
    }
    try {
      database.transaction(() => {
        const subject = createSharedSubject(database, params.id, {
          ...parsed.data,
          declarationId,
        });
        if (!taxCode) return;
        const currentDeclaration = getDeclaration(database, declarationId, params.id);
        if (!currentDeclaration) throw new Error("DECLARATION_NOT_FOUND");
        const result = saveCanonicalField(database, {
          practiceId: params.id,
          declarationId,
          expectedRevision: currentDeclaration.revision,
          fieldId:
            parsed.data.role === "decedent"
              ? "frontespizio.defunto.codice-fiscale"
              : "quadro-ea.soggetto.codice-fiscale",
          value: taxCode,
          entityId: subject.id,
        });
        if (result.issues.length > 0) throw new Error("SUBJECT_FIELD_SEED_FAILED");
      })();
    } catch (subjectError) {
      if (subjectError instanceof Error && subjectError.message === "DECEDENT_ALREADY_EXISTS")
        return fail(409, { domainError: "Il defunto è già presente nella pratica." });
      throw subjectError;
    }
    redirect(303, `/pratiche/${params.id}?sezione=people&dichiarazione=${declarationId}`);
  },
  addAsset: async ({ locals, params, request }) => {
    if (!locals.ownerId) redirect(303, "/login");
    const database = openDatabase();
    if (!getPractice(database, params.id)) error(404, "Pratica non trovata");
    const formData = await request.formData();
    const declarationId = String(formData.get("declarationId") ?? "");
    const legacyCategory = String(formData.get("category") ?? "");
    const fallbackKind: AssetKind =
      legacyCategory === "property"
        ? "building"
        : legacyCategory === "financial"
          ? "securities"
          : legacyCategory === "liability"
            ? "liability"
            : legacyCategory === "donation"
              ? "donation"
              : "other";
    const parsed = z.object({ displayName: shortLabel, kind: assetKind }).safeParse({
      displayName: formData.get("displayName"),
      kind: formData.get("kind") ?? fallbackKind,
    });
    if (!parsed.success)
      return fail(400, { domainError: parsed.error.issues[0]?.message ?? "Dati non validi." });
    const valueCents = euroToCents(formData.get("value"));
    if (valueCents === null)
      return fail(400, {
        domainError: "Inserisci il valore in euro, usando al massimo due decimali.",
      });
    createSharedAsset(database, params.id, { ...parsed.data, valueCents, declarationId });
    redirect(303, `/pratiche/${params.id}?sezione=estate&dichiarazione=${declarationId}`);
  },
  saveFields: async ({ locals, params, request }) => {
    if (!locals.ownerId) redirect(303, "/login");
    const formData = await request.formData();
    const declarationId = String(formData.get("declarationId") ?? "");
    const fieldIds = formData.getAll("fieldId").map(String);
    const returnSection = String(formData.get("returnSection") ?? "");
    const entityId = String(formData.get("entityId") ?? "") || null;
    const occurrenceIdValue = String(formData.get("occurrenceId") ?? "") || null;
    const occurrenceId = occurrenceIdValue
      ? z.string().uuid().safeParse(occurrenceIdValue).data
      : null;
    const expectedRevision = Number(formData.get("expectedRevision"));
    if (
      !declarationId ||
      fieldIds.length === 0 ||
      fieldIds.length > 100 ||
      (occurrenceIdValue !== null && occurrenceId === undefined) ||
      !Number.isSafeInteger(expectedRevision)
    )
      return fail(400, {
        fieldError: "Non è stato possibile identificare i dati da salvare.",
      });
    if (isOperationalSectionId(returnSection)) {
      const editableFieldIds = new Set(
        listOperationalAreaFields(OPERATIONAL_SECTION_AREAS[returnSection])
          .filter((field) => isOperationalParityEditable(field.operationalParity))
          .map((field) => field.canonicalId),
      );
      const unsupportedField = fieldIds.find((fieldId) => !editableFieldIds.has(fieldId));
      if (unsupportedField)
        return fail(400, {
          fieldError:
            "Questo dato non è modificabile dalla Vista operativa finché la sua modalità di compilazione non viene qualificata.",
        });
    }
    try {
      const result = saveCanonicalFields(openDatabase(), {
        practiceId: params.id,
        declarationId,
        expectedRevision,
        entityId,
        occurrenceId,
        confirmOfficialRules: formData.get("confirmOfficialRules") === "yes",
        fields: fieldIds.map((fieldId) => ({
          fieldId,
          value: String(formData.getAll(`value:${fieldId}`).at(-1) ?? "").trim(),
        })),
      });
      if (result.issues.length > 0)
        return fail(400, {
          fieldError: result.issues[0]?.message ?? "Il valore non supera i controlli.",
        });
    } catch (saveError) {
      if (saveError instanceof Error && saveError.message === "REVISION_CONFLICT")
        return fail(409, {
          fieldError: "La dichiarazione è stata aggiornata altrove. Ricarica la pagina e riprova.",
        });
      throw saveError;
    }
    const quadro = String(formData.get("quadro") ?? "EA");
    if (isOperationalSectionId(returnSection))
      redirect(
        303,
        `/pratiche/${params.id}?sezione=${returnSection}&vista=operational&dichiarazione=${declarationId}`,
      );
    const subjectQuery =
      quadro === "EA" && entityId ? `&soggetto=${encodeURIComponent(entityId)}` : "";
    const assetQuery =
      entityId && !["EA", "Frontespizio", "EE", "EF", "EG", "EH", "EI"].includes(quadro)
        ? `&bene=${encodeURIComponent(entityId)}`
        : "";
    redirect(
      303,
      `/pratiche/${params.id}?sezione=quadri&vista=quadri&quadro=${encodeURIComponent(quadro)}&dichiarazione=${declarationId}${subjectQuery}${assetQuery}`,
    );
  },
  updateChecklist: async ({ locals, params, request }) => {
    if (!locals.ownerId) redirect(303, "/login");
    const formData = await request.formData();
    const declarationId = String(formData.get("declarationId") ?? "");
    const itemIds = formData.getAll("itemId").map(String);
    if (!declarationId || itemIds.length === 0 || itemIds.length > 50)
      return fail(400, { checklistError: "Non è stato possibile aggiornare il documento." });
    const updates: Array<{
      itemId: string;
      status: "missing" | "available" | "overridden";
      documentId: string | null;
      decisionNote: string | null;
    }> = [];
    for (const itemId of itemIds) {
      const status = z
        .enum(["missing", "available", "overridden"])
        .safeParse(formData.get(`status:${itemId}`));
      if (!status.success) return fail(400, { checklistError: "Lo stato scelto non è valido." });
      const decisionNote = String(formData.get(`decisionNote:${itemId}`) ?? "") || null;
      if (status.data === "overridden" && !decisionNote)
        return fail(400, { checklistError: "Motiva ogni deroga prima di salvare." });
      updates.push({
        itemId,
        status: status.data,
        documentId: String(formData.get(`documentId:${itemId}`) ?? "") || null,
        decisionNote,
      });
    }
    const database = openDatabase();
    try {
      database.transaction(() => {
        for (const update of updates) {
          const saved = updateChecklistItem(database, {
            practiceId: params.id,
            declarationId,
            ...update,
          });
          if (!saved) throw new Error("CHECKLIST_UPDATE_FAILED");
        }
      })();
    } catch (checklistError) {
      if (checklistError instanceof Error && checklistError.message === "CHECKLIST_UPDATE_FAILED")
        return fail(400, {
          checklistError: "Non è stato possibile salvare tutti i documenti richiesti.",
        });
      throw checklistError;
    }
    redirect(303, `/pratiche/${params.id}?sezione=documents&dichiarazione=${declarationId}`);
  },
  saveDevolution: async ({ locals, params, request }) => {
    if (!locals.ownerId) redirect(303, "/login");
    const database = openDatabase();
    const formData = await request.formData();
    const declarationId = String(formData.get("declarationId") ?? "");
    const expectedRevision = Number(formData.get("expectedRevision"));
    if (!declarationId || !Number.isSafeInteger(expectedRevision))
      return fail(400, { devolutionError: "Dichiarazione non identificata." });
    const assets = listSharedAssets(database, params.id, declarationId).filter(
      (asset) => asset.kind !== "donation",
    );
    const beneficiaries = listSharedSubjects(database, params.id).filter(
      (subject) => subject.role === "beneficiary",
    );
    const shares = [];
    for (const asset of assets) {
      for (const beneficiary of beneficiaries) {
        const prefix = `share:${asset.id}:${beneficiary.id}`;
        const numerator = nonNegativeInteger(formData.get(`${prefix}:numerator`));
        const denominator = nonNegativeInteger(formData.get(`${prefix}:denominator`));
        const reductionYears = Number(formData.get(`${prefix}:reductionYears`) ?? 0);
        if (
          numerator === null ||
          denominator === null ||
          ![0, 1, 2, 3, 4, 5].includes(reductionYears)
        )
          return fail(400, {
            devolutionError: "Inserisci quote e riduzioni usando soltanto numeri validi.",
          });
        if (numerator <= 0n) continue;
        shares.push({
          assetId: asset.id,
          beneficiaryId: beneficiary.id,
          numerator,
          denominator,
          rightCode: String(formData.get(`${prefix}:rightCode`) ?? "1").trim(),
          reliefCode: String(formData.get(`${prefix}:reliefCode`) ?? "").trim(),
          reductionYears: reductionYears as 0 | 1 | 2 | 3 | 4 | 5,
          previousSuccessionValueCents: euroToCents(formData.get(`${prefix}:previousValue`)) ?? 0n,
          foreignTaxCents: euroToCents(formData.get(`${prefix}:foreignTax`)) ?? 0n,
        });
      }
    }
    try {
      const scenario = saveDevolutionScenario(database, {
        practiceId: params.id,
        declarationId,
        expectedRevision,
        shares,
      });
      if (scenario.issues.length > 0)
        return fail(400, {
          devolutionError: scenario.issues[0]?.message ?? "La ripartizione non è completa.",
        });
    } catch (scenarioError) {
      if (scenarioError instanceof Error && scenarioError.message === "REVISION_CONFLICT")
        return fail(409, {
          devolutionError: "La dichiarazione è cambiata. Ricarica la pagina e riprova.",
        });
      throw scenarioError;
    }
    redirect(303, `/pratiche/${params.id}?sezione=devolution&dichiarazione=${declarationId}`);
  },
  confirmDevolution: async ({ locals, params, request }) => {
    if (!locals.ownerId) redirect(303, "/login");
    const formData = await request.formData();
    try {
      confirmDevolutionScenario(openDatabase(), {
        practiceId: params.id,
        declarationId: String(formData.get("declarationId") ?? ""),
        scenarioId: String(formData.get("scenarioId") ?? ""),
        expectedRevision: Number(formData.get("expectedRevision")),
      });
    } catch (confirmationError) {
      if (
        confirmationError instanceof Error &&
        confirmationError.message === "DEVOLUTION_NOT_CONFIRMABLE"
      )
        return fail(400, {
          devolutionError: "Correggi la ripartizione prima di confermarla.",
        });
      if (confirmationError instanceof Error && confirmationError.message === "REVISION_CONFLICT")
        return fail(409, {
          devolutionError: "La dichiarazione è cambiata. Ricarica la pagina e riprova.",
        });
      throw confirmationError;
    }
    redirect(
      303,
      `/pratiche/${params.id}?sezione=devolution&dichiarazione=${String(formData.get("declarationId") ?? "")}`,
    );
  },
  runCalculation: async ({ locals, params, request }) => {
    if (!locals.ownerId) redirect(303, "/login");
    const database = openDatabase();
    const practice = getPractice(database, params.id);
    if (!practice) error(404, "Pratica non trovata");
    const formData = await request.formData();
    const declarationId = String(formData.get("declarationId") ?? practice.declarationId);
    try {
      runSuccessionCalculation(database, {
        practiceId: params.id,
        declarationId,
      });
    } catch (calculationError) {
      if (calculationError instanceof Error && calculationError.message === "DEVOLUTION_REQUIRED")
        return fail(400, {
          calculationError: "Conferma prima la ripartizione dei beni e delle passività.",
        });
      throw calculationError;
    }
    redirect(303, `/pratiche/${params.id}?sezione=taxes&dichiarazione=${declarationId}`);
  },
  confirmCalculation: async ({ locals, params, request }) => {
    if (!locals.ownerId) redirect(303, "/login");
    const formData = await request.formData();
    try {
      confirmCalculationRun(openDatabase(), {
        practiceId: params.id,
        declarationId: String(formData.get("declarationId") ?? ""),
        calculationId: String(formData.get("calculationId") ?? ""),
        expectedRevision: Number(formData.get("expectedRevision")),
      });
    } catch (confirmationError) {
      if (
        confirmationError instanceof Error &&
        confirmationError.message === "CALCULATION_NOT_CONFIRMABLE"
      )
        return fail(400, {
          calculationError: "Completa i dati indicati prima di confermare il calcolo.",
        });
      if (confirmationError instanceof Error && confirmationError.message === "REVISION_CONFLICT")
        return fail(409, {
          calculationError: "La dichiarazione è cambiata. Ricarica la pagina e riprova.",
        });
      throw confirmationError;
    }
    redirect(
      303,
      `/pratiche/${params.id}?sezione=taxes&dichiarazione=${String(formData.get("declarationId") ?? "")}`,
    );
  },
  duplicateSubjectEntry: async ({ locals, params, request }) => {
    if (!locals.ownerId) redirect(303, "/login");
    const formData = await request.formData();
    const parsed = z
      .object({
        declarationId: z.string().uuid(),
        sourceEntryId: z.string().uuid(),
        expectedRevision: z.coerce.number().int().safe().min(1),
      })
      .safeParse({
        declarationId: formData.get("declarationId"),
        sourceEntryId: formData.get("sourceEntryId"),
        expectedRevision: formData.get("expectedRevision"),
      });
    if (!parsed.success)
      return fail(400, {
        duplicateError: "Non è stato possibile identificare la posizione da ripetere.",
      });
    try {
      const { entry } = createDeclarationSubjectEntry(openDatabase(), {
        practiceId: params.id,
        ...parsed.data,
      });
      redirect(
        303,
        `/pratiche/${params.id}?sezione=quadri&vista=quadri&quadro=EA&dichiarazione=${parsed.data.declarationId}&soggetto=${entry.id}`,
      );
    } catch (entryError) {
      if (entryError instanceof Error && entryError.message === "REVISION_CONFLICT")
        return fail(409, {
          duplicateError:
            "La dichiarazione è stata aggiornata altrove. Ricarica la pagina e riprova.",
        });
      if (
        entryError instanceof Error &&
        ["DECLARATION_NOT_FOUND", "SUBJECT_ENTRY_NOT_FOUND"].includes(entryError.message)
      )
        return fail(404, {
          duplicateError: "La posizione scelta non è più disponibile in questa dichiarazione.",
        });
      throw entryError;
    }
  },
  createDeclaration: async ({ locals, params, request }) => {
    if (!locals.ownerId) redirect(303, "/login");
    const database = openDatabase();
    const practice = getPractice(database, params.id);
    if (!practice) error(404, "Pratica non trovata");
    const formData = await request.formData();
    const parsed = declarationKind.safeParse(formData.get("kind"));
    if (!parsed.success) return fail(400, { domainError: "Scegli il tipo di dichiarazione." });
    const sourceDeclarationId = String(
      formData.get("sourceDeclarationId") ?? practice.declarationId,
    );
    const declaration = createSuccessiveDeclaration(
      database,
      params.id,
      sourceDeclarationId,
      parsed.data,
    );
    redirect(303, `/pratiche/${params.id}?sezione=overview&dichiarazione=${declaration.id}`);
  },
} satisfies Actions;
