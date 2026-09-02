import {
  QUADRI,
  listQuadroFields,
  type QuadroId,
  type TechnicalElement,
} from "./official-catalog/catalog.ts";
import applicationEvidence from "./official-catalog/successionionline-field-evidence.json" with { type: "json" };
import screenEvidence from "./official-catalog/successionionline-screen-commands.json" with { type: "json" };
import { buildOperationalParityMap, type OperationalParityRow } from "./operational-parity.ts";
import { successioniOnLineDisabledWhen } from "./successionionline-behavior.ts";

type SuccessioniOnLineControlKind =
  | "attachment-list"
  | "checkbox"
  | "combobox"
  | "date"
  | "input"
  | "official-search"
  | "output"
  | "print-only"
  | "radio"
  | "select"
  | "tax-code"
  | "unobserved";

type SuccessioniOnLineInputState =
  | "context-dependent"
  | "editable"
  | "read-only-automatic"
  | "read-only-derived"
  | "read-only-office"
  | "unqualified";

type SuccessioniOnLinePresence =
  | "choice-dependent"
  | "optional"
  | "required"
  | "required-when-context-active";

type SuccessioniOnLineScreenComparison =
  | "different-input-workflow"
  | "different-readonly-workflow"
  | "direct-input-consistent"
  | "direct-readonly-consistent"
  | "not-observed-in-script"
  | "unqualified";

type SuccessioniOnLineAlignmentReview =
  | "direct-equivalent"
  | "qualified-different-workflow"
  | "qualified-noninteractive"
  | "qualified-offscreen-input"
  | "unresolved";

export interface SuccessioniOnLineScreenField {
  fieldId: string;
  quadro: QuadroId;
  label: string;
  recordCode: string | null;
  screen: {
    status:
      | "direct-control"
      | "eg-attachment-control"
      | "not-observed-in-script"
      | "specialized-control";
    script: string | null;
    page: number | null;
    section: string | null;
    order: number | null;
    commands: string[];
    control: SuccessioniOnLineControlKind;
    radioGroup: string | null;
  };
  behavior: {
    inputState: SuccessioniOnLineInputState;
    handling: OperationalParityRow["handling"];
    handlingByDeclarationKind: OperationalParityRow["handlingByDeclarationKind"] | null;
    handlingBasis: OperationalParityRow["handlingBasis"];
    reviewedProducer: "automatico" | "professionista" | "riservato-ufficio" | null;
    producerBasis: string | null;
    semanticStatus: OperationalParityRow["semanticReview"]["status"];
    disabledWhen: ReturnType<typeof successioniOnLineDisabledWhen>;
  };
  specification: {
    presence: SuccessioniOnLinePresence;
    fieldMin: number;
    fieldMax: number | "unbounded";
    effectiveMin: number;
    effectiveMax: number | "unbounded";
    choiceGroup: string | null;
    declarationKinds: OperationalParityRow["applicability"]["declarationKinds"];
    technicalType: string;
    constraints: TechnicalElement["constraints"];
    optionCount: number;
    choiceSource: string | null;
  };
  alignment: {
    screenComparison: SuccessioniOnLineScreenComparison;
    review: SuccessioniOnLineAlignmentReview;
    reviewBasis: string;
    currentCoverage: OperationalParityRow["currentCoverage"];
    operationalVisibility: OperationalParityRow["operationalVisibility"];
    operationalEditability: OperationalParityRow["operationalEditability"];
    coverageReason: string;
  };
  evidence: {
    screenSourcePointers: string[];
    technicalSourcePointer: string;
    officialRuleIds: string[];
  };
}

const QUALIFIED_OFFSCREEN_INPUT_BASES = new Set<OperationalParityRow["handlingBasis"]>([
  "explicit-professional-input",
  "professional-attestation",
  "professional-object-input",
]);

function reviewedProducer(
  value: string | undefined,
): SuccessioniOnLineScreenField["behavior"]["reviewedProducer"] {
  if (value === undefined) return null;
  if (["automatico", "professionista", "riservato-ufficio"].includes(value))
    return value as NonNullable<SuccessioniOnLineScreenField["behavior"]["reviewedProducer"]>;
  throw new Error(`Produttore SuccessioniOnLine non riconosciuto: ${value}.`);
}

const INPUT_COMMANDS = new Set([
  "CampoData",
  "CampoInput",
  "CFAnagrafica",
  "CheckPannello",
  "ComboInput",
  "ListaFileSemaforo",
  "RadioPannello",
  "SingleRadio",
  "SingleRadioGroup",
]);

function inputState(row: OperationalParityRow): SuccessioniOnLineInputState {
  if (row.handling === null || row.semanticReview.status !== "qualificata") return "unqualified";
  if (row.handling === "inserito") return "editable";
  if (row.handling === "gestione-contestuale") return "context-dependent";
  if (row.handling === "derivato") return "read-only-derived";
  if (row.handling === "gestito-automaticamente") return "read-only-automatic";
  return "read-only-office";
}

function presence(row: OperationalParityRow): SuccessioniOnLinePresence {
  if (row.applicability.choiceGroup) return "choice-dependent";
  if (row.cardinality.fieldMin === 0) return "optional";
  return row.cardinality.effectiveMin > 0 ? "required" : "required-when-context-active";
}

function controlKind(
  commands: readonly string[],
  field: ReturnType<typeof listQuadroFields>[number],
  attachment: boolean,
): SuccessioniOnLineControlKind {
  if (attachment || commands.includes("ListaFileSemaforo")) return "attachment-list";
  if (commands.some((command) => ["CampoOutput", "CheckPannelloOutput"].includes(command)))
    return "output";
  if (commands.some((command) => ["CheckPannello", "SingleRadio"].includes(command)))
    return "checkbox";
  if (commands.some((command) => ["RadioPannello", "SingleRadioGroup"].includes(command)))
    return "radio";
  if (commands.includes("CampoData")) return "date";
  if (commands.includes("CFAnagrafica")) return "tax-code";
  if (commands.includes("ComboInput")) {
    if (field.choiceSource) return "official-search";
    if (field.options.length > 0) return "select";
    return "combobox";
  }
  if (commands.includes("CampoInput")) return "input";
  if (commands.includes("CampiStampa")) return "print-only";
  if (field.control === "checkbox") return "checkbox";
  if (field.control === "select") return "select";
  if (field.control === "combobox") return field.choiceSource ? "official-search" : "combobox";
  return "unobserved";
}

function screenComparison(
  status: SuccessioniOnLineScreenField["screen"]["status"],
  state: SuccessioniOnLineInputState,
  commands: readonly string[],
): SuccessioniOnLineScreenComparison {
  if (status === "not-observed-in-script") return "not-observed-in-script";
  if (state === "unqualified") return "unqualified";
  const hasInput = commands.some((command) => INPUT_COMMANDS.has(command));
  const expectsInput = state === "editable" || state === "context-dependent";
  if (expectsInput) return hasInput ? "direct-input-consistent" : "different-input-workflow";
  return hasInput ? "different-readonly-workflow" : "direct-readonly-consistent";
}

function alignmentReview(
  row: OperationalParityRow,
  comparison: SuccessioniOnLineScreenComparison,
  screenSourcePointers: readonly string[],
  reviewedProducer: SuccessioniOnLineScreenField["behavior"]["reviewedProducer"],
  producerBasis: string | null,
): Pick<SuccessioniOnLineScreenField["alignment"], "review" | "reviewBasis"> {
  if (
    row.semanticReview.status !== "qualificata" ||
    row.handling === null ||
    row.currentCoverage !== "coperto" ||
    comparison === "unqualified"
  )
    return {
      review: "unresolved",
      reviewBasis:
        row.semanticReview.blocker ??
        "Manca una classificazione ufficiale qualificata o la copertura operativa completa.",
    };

  if (comparison.startsWith("direct-"))
    return {
      review: "direct-equivalent",
      reviewBasis:
        "Il controllo della schermata ufficiale e lo stato di input qualificato concordano direttamente.",
    };

  if (comparison.startsWith("different-") && screenSourcePointers.length > 0)
    return {
      review: "qualified-different-workflow",
      reviewBasis:
        "Il comando ufficiale è presente, ma acquisizione o sola lettura avvengono in un workflow diverso, qualificato dalla semantica del campo.",
    };

  if (comparison === "not-observed-in-script") {
    if (
      row.handling === "gestito-automaticamente" ||
      row.handling === "derivato" ||
      row.handling === "riservato-ufficio"
    )
      return {
        review: "qualified-noninteractive",
        reviewBasis:
          reviewedProducer && producerBasis
            ? `Il produttore ufficiale è ${reviewedProducer} (${producerBasis}); il campo non richiede un controllo editabile nel quadro.`
            : `La regola qualificata ${row.handlingBasis} rende il campo non interattivo nel quadro.`,
      };

    if (
      QUALIFIED_OFFSCREEN_INPUT_BASES.has(row.handlingBasis) ||
      (row.handlingBasis === "official-application-behavior" &&
        reviewedProducer === "professionista" &&
        producerBasis !== null)
    )
      return {
        review: "qualified-offscreen-input",
        reviewBasis:
          reviewedProducer && producerBasis
            ? `Il valore è acquisito dal ${reviewedProducer} nel workflow ${producerBasis}, fuori dallo script principale del quadro.`
            : `La provenienza qualificata ${row.handlingBasis} colloca l’inserimento nell’oggetto professionale o nell’attestazione dedicata.`,
      };
  }

  return {
    review: "unresolved",
    reviewBasis:
      "La differenza di schermata non è spiegata da un comando ufficiale o da una regola esplicita sul produttore del valore.",
  };
}

export function buildSuccessioniOnLineScreenModel(): SuccessioniOnLineScreenField[] {
  const parityRows = buildOperationalParityMap();
  const layoutByFieldId = new Map(applicationEvidence.layout.map((item) => [item.fieldId, item]));
  const reviewedByFieldId = new Map(
    applicationEvidence.fields.map((item) => [item.fieldId, item] as const),
  );
  const attachmentByFieldId = new Map(
    applicationEvidence.attachmentBuckets.map((item) => [item.fieldId, item] as const),
  );
  const fieldById = new Map(
    QUADRI.flatMap((quadro) =>
      listQuadroFields(quadro).map((field) => [field.canonicalId, field] as const),
    ),
  );
  const commandsByQuadroAndRecordCode = new Map<
    string,
    (typeof screenEvidence.commands)[number][]
  >();
  for (const command of screenEvidence.commands) {
    for (const recordCode of command.recordCodes) {
      const key = `${command.quadro}|${recordCode}`;
      const commands = commandsByQuadroAndRecordCode.get(key) ?? [];
      commands.push(command);
      commandsByQuadroAndRecordCode.set(key, commands);
    }
  }
  return parityRows.map((row) => {
    const field = fieldById.get(row.fieldId)!;
    const layout = layoutByFieldId.get(row.fieldId) ?? null;
    const reviewed = reviewedByFieldId.get(row.fieldId) ?? null;
    const attachment = attachmentByFieldId.get(row.fieldId) ?? null;
    const producer = reviewedProducer(reviewed?.reviewedProducer);
    const recordCode = layout?.recordCode ?? attachment?.recordCode ?? reviewed?.recordCode ?? null;
    const screenCommands = recordCode
      ? (commandsByQuadroAndRecordCode.get(`${row.quadro}|${recordCode}`) ?? [])
      : [];
    const commands = [...new Set(screenCommands.map((command) => command.command))].sort();
    const screenSourcePointers = screenCommands.map((command) => command.sourcePointer);
    const status = layout
      ? ("direct-control" as const)
      : attachment
        ? ("eg-attachment-control" as const)
        : commands.length > 0
          ? ("specialized-control" as const)
          : ("not-observed-in-script" as const);
    const comparison = screenComparison(status, inputState(row), commands);
    const review = alignmentReview(
      row,
      comparison,
      screenSourcePointers,
      producer,
      reviewed?.producerBasis ?? null,
    );
    return {
      fieldId: row.fieldId,
      quadro: row.quadro,
      label: row.label,
      recordCode,
      screen: {
        status,
        script: layout?.script ?? screenCommands[0]?.script ?? null,
        page: layout?.page ?? screenCommands[0]?.page ?? null,
        section: layout?.section ?? screenCommands[0]?.section ?? null,
        order: layout?.order ?? attachment?.order ?? screenCommands[0]?.order ?? null,
        commands,
        control: controlKind(commands, field, attachment !== null),
        radioGroup: layout?.radioGroup ?? null,
      },
      behavior: {
        inputState: inputState(row),
        handling: row.handling,
        handlingByDeclarationKind: row.handlingByDeclarationKind ?? null,
        handlingBasis: row.handlingBasis,
        reviewedProducer: producer,
        producerBasis: reviewed?.producerBasis ?? null,
        semanticStatus: row.semanticReview.status,
        disabledWhen: successioniOnLineDisabledWhen(row.fieldId),
      },
      specification: {
        presence: presence(row),
        fieldMin: row.cardinality.fieldMin,
        fieldMax: row.cardinality.fieldMax,
        effectiveMin: row.cardinality.effectiveMin,
        effectiveMax: row.cardinality.effectiveMax,
        choiceGroup: row.applicability.choiceGroup,
        declarationKinds: row.applicability.declarationKinds,
        technicalType: field.type,
        constraints: field.constraints,
        optionCount: field.options.length,
        choiceSource: field.choiceSource,
      },
      alignment: {
        screenComparison: comparison,
        ...review,
        currentCoverage: row.currentCoverage,
        operationalVisibility: row.operationalVisibility,
        operationalEditability: row.operationalEditability,
        coverageReason: row.coverageReason,
      },
      evidence: {
        screenSourcePointers,
        technicalSourcePointer: field.sourcePointer,
        officialRuleIds: row.applicability.officialRuleIds,
      },
    };
  });
}

export function listSuccessioniOnLineScreenFields(
  quadro: QuadroId,
): SuccessioniOnLineScreenField[] {
  return buildSuccessioniOnLineScreenModel().filter((field) => field.quadro === quadro);
}
